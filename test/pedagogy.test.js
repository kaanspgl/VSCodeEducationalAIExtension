const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSystemPrompt,
  deriveDialogueProgress,
  deriveLearnerState,
  findDialogueViolations,
  findPolicyViolations,
  findQuizViolations,
  normalizeAssist,
  safeFallback,
  safeQuizFallback,
  sanitizePolicyViolations,
} = require('../out/shared/pedagogy');

test('only the three paper-defined interaction modes are accepted', () => {
  assert.equal(normalizeAssist('Socratic'), 'Socratic');
  assert.equal(normalizeAssist('Hinted'), 'Hinted');
  assert.equal(normalizeAssist('Show-and-Tell'), 'Show-and-Tell');
  assert.equal(normalizeAssist('Direct'), 'Socratic');
});

test('Socratic policy explicitly withholds copyable solutions', () => {
  const prompt = buildSystemPrompt('Socratic', 'chat');
  assert.match(prompt, /Do not provide corrected code/);
  assert.match(prompt, /Ask exactly one focused question/);
});

test('learner state detects solution-seeking and attempted reasoning', () => {
  const state = deriveLearnerState(
    'I tried changing the loop because I think the last index is wrong. Just give me the corrected code.',
    []
  );
  assert.equal(state.directSolutionRequest, true);
  assert.equal(state.attemptEvidence, true);
  assert.equal(state.scaffoldStage, 'consolidate');
});

test('dialogue progress identifies previously asked tutor questions', () => {
  const progress = deriveDialogueProgress([
    { role: 'user', text: 'That will be the last item in the array?' },
    { role: 'assistant', text: 'What happens when index equals items.length?' },
  ]);
  assert.equal(progress.hasPriorExchange, true);
  assert.deepEqual(progress.previousTutorQuestions, [
    'What happens when index equals items.length?'
  ]);
});

test('dialogue validator rejects a semantic repeat of the prior question', () => {
  const violations = findDialogueViolations(
    'What do you predict will happen when index equals items.length?',
    [
      { role: 'assistant', text: 'What happens when index equals items.length?' },
      { role: 'user', text: 'That will be the last item?' },
    ]
  );
  assert.deepEqual(violations, ['repeats a previously asked tutor question']);
});

test('dialogue validator detects a repeated concept from the whole prior tutor move', () => {
  const violations = findDialogueViolations(
    'What happens when index equals items.length during loop execution?',
    [
      {
        role: 'assistant',
        text: 'Let us think about what happens when index equals items.length. What do you predict in that case?'
      },
      { role: 'user', text: 'That will be the last item?' },
    ]
  );
  assert.deepEqual(violations, ['repeats a previously asked tutor question']);
});

test('dialogue validator allows progression to a new conceptual rung', () => {
  const violations = findDialogueViolations(
    'If an array has length 3, what is its largest valid index?',
    [
      { role: 'assistant', text: 'What happens when index equals items.length?' },
      { role: 'user', text: 'That will be the last item?' },
    ]
  );
  assert.deepEqual(violations, []);
});

test('dialogue validator rejects praise for an array-boundary misconception', () => {
  const violations = findDialogueViolations(
    'Exactly! When index equals items.length, the access is out of bounds. What is the largest valid index?',
    [
      { role: 'assistant', text: 'What happens when index equals items.length?' },
      { role: 'user', text: 'The condition includes the array length.' },
    ],
    'That will be the last item in the array?'
  );
  assert.ok(violations.includes('incorrectly affirms an array-boundary misconception'));
});

test('dialogue validator requires progression to count-versus-index reasoning', () => {
  const violations = findDialogueViolations(
    'Not quite. When index equals items.length, it accesses items[items.length]. What could go wrong?',
    [
      { role: 'assistant', text: 'What happens when index equals items.length?' },
      { role: 'user', text: 'The condition includes the array length.' },
    ],
    'That will be the last item in the array?'
  );
  assert.ok(violations.includes(
    'fails to advance from access prediction to index-boundary reasoning'
  ));
});

test('dialogue validator rejects incorrect shadowing explanations', () => {
  const learnerText =
    'function f() { let total = 0; for (const x of xs) { let total = total + x; } return total; }';
  const violations = findDialogueViolations(
    'The total inside the loop is overwriting the original total. What could you try?',
    [],
    learnerText
  );
  assert.ok(violations.includes('mischaracterizes variable shadowing as overwriting'));
  assert.ok(violations.includes('fails to distinguish the two scoped bindings'));
});

test('Show-and-Tell rejects rewriting the learner async function', () => {
  const learnerText =
    'async function loadUserName(userId) { const response = fetch(`/users/${userId}`); const user = response.json(); return user.name; }';
  const response =
    '```js\nasync function loadUserName(userId) {\nconst response = await fetch(`/users/${userId}`);\nconst user = await response.json();\nreturn user.name;\n}\n```';
  assert.ok(findPolicyViolations(response, 'Show-and-Tell').includes(
    'uses a complete implementation instead of a tiny distinct example'
  ));
  assert.ok(findDialogueViolations(response, [], learnerText).includes(
    'rewrites the learner async function instead of using a distinct example'
  ));
});

test('fallback advances an array-boundary misconception', () => {
  const response = safeFallback(
    'Socratic',
    [
      { role: 'assistant', text: 'What happens when index equals items.length?' },
      { role: 'user', text: 'That will be the last item?' },
    ],
    'That will be the last item?'
  );
  assert.match(response, /number of items/);
  assert.match(response, /largest valid index/);
  assert.doesNotMatch(response, /what happens when index equals items\.length/i);
});

test('Hinted fallback explains shadowing without rewriting the function', () => {
  const response = safeFallback(
    'Hinted',
    [],
    'function f() { let total = 0; for (const x of xs) { let total = total + x; } return total; }'
  );
  assert.match(response, /separate bindings/);
  assert.match(response, /which of those two bindings is still in scope/);
  assert.doesNotMatch(response, /\b(remove|replace|change)\s+(the|your|this)\b/i);
});

test('Show-and-Tell fallback uses an analogy for async sequencing', () => {
  const response = safeFallback(
    'Show-and-Tell',
    [],
    'const response = fetch(url); const user = response.json(); return user.name;'
  );
  assert.match(response, /claim tickets/);
  assert.match(response, /which two expressions/);
  assert.doesNotMatch(response, /await fetch|await response/);
});

test('quiz validator rejects optional-property questions about an undefined student variable', () => {
  const quiz = JSON.stringify({
    type: 'quiz',
    questions: [
      {
        id: 'q1',
        stem: 'What happens if student is not defined?',
        choices: [{}, {}, {}, {}],
      },
      {
        id: 'q2',
        stem: 'What happens when the course property is missing?',
        choices: [{}, {}, {}, {}],
      },
      {
        id: 'q3',
        stem: 'How does optional nested property reasoning transfer?',
        choices: [{}, {}, {}, {}],
      },
    ],
  });
  const violations = findQuizViolations(quiz, [
    { role: 'user', text: 'Why can student.course.title fail?' },
  ]);
  assert.ok(violations.includes('optional-property quiz contains an unrelated question'));
  assert.ok(violations.includes(
    'quiz confuses a missing nested course with a missing student variable'
  ));
});

test('optional-property quiz fallback remains focused on the discussed misconception', () => {
  const quiz = JSON.parse(safeQuizFallback([
    { role: 'user', text: 'Why can student.course.title fail?' },
  ]));
  assert.equal(quiz.questions.length, 3);
  assert.ok(quiz.questions.every(question =>
    /\b(course|nested|property|missing|optional|title)\b/i.test(question.stem)
  ));
});

test('Socratic validator catches common solution leakage', () => {
  const violations = findPolicyViolations(
    'Here is the fix:\n```js\nfor (let i = 0; i < items.length; i++) {}\n```\nDoes that make sense?',
    'Socratic'
  );
  assert.ok(violations.includes('contains a code block'));
  assert.ok(violations.includes('states a direct solution'));
});

test('Hinted and Show-and-Tell detect imperative final edits', () => {
  for (const mode of ['Hinted', 'Show-and-Tell']) {
    const violations = findPolicyViolations(
      'Try changing the condition to `<` instead of `<=`; this is the corrected condition.',
      mode
    );
    assert.ok(violations.length > 0, `${mode} should reject a copyable final edit`);
  }
});

test('response validator rejects headings and hidden policy narration', () => {
  const violations = findPolicyViolations(
    '### Hint 1\nAs a tutor, I will preserve productive struggle. What happens next?',
    'Hinted'
  );
  assert.ok(violations.includes('uses titled instructional sections'));
  assert.ok(violations.includes('narrates hidden teaching policy'));
});

test('sanitizer removes a leaked final edit while preserving hints', () => {
  const sanitized = sanitizePolicyViolations(
    'Hint 1: trace the last iteration.\n\nTry changing the condition to `<` instead of `<=`.\n\nWhat value is out of range?',
    'Hinted'
  );
  assert.match(sanitized, /trace the last iteration/);
  assert.doesNotMatch(sanitized, /instead of/);
  assert.match(sanitized, /\?/);
  assert.deepEqual(findPolicyViolations(sanitized, 'Hinted'), []);
});

test('a focused Socratic question passes policy validation', () => {
  const violations = findPolicyViolations(
    'On the final iteration, what value does the index have compared with the largest valid array index?',
    'Socratic'
  );
  assert.deepEqual(violations, []);
});
