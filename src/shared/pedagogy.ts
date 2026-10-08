export type AssistMode = 'Socratic' | 'Hinted' | 'Show-and-Tell';
export type ChatTurn = { role: 'user' | 'assistant'; text: string };
export type LearningObjective = { label: string; status?: string };

export type LearnerState = {
  directSolutionRequest: boolean;
  attemptEvidence: boolean;
  conceptFocused: boolean;
  followUpDepth: number;
  scaffoldStage: 'orient' | 'probe' | 'consolidate';
};

export type DialogueProgress = {
  previousTutorTurn: string;
  previousTutorQuestions: string[];
  hasPriorExchange: boolean;
};

export function normalizeAssist(value: unknown): AssistMode {
  return value === 'Hinted' || value === 'Show-and-Tell' ? value : 'Socratic';
}

export function deriveLearnerState(userText: string, history: ChatTurn[] = []): LearnerState {
  const text = `${userText}\n${history.filter(turn => turn.role === 'user').map(turn => turn.text).join('\n')}`;
  const directSolutionRequest =
    /\b(fix|solve|correct|rewrite|give|show|write|provide)\b.{0,35}\b(code|answer|solution|patch|implementation)\b/i.test(text) ||
    /\bjust tell me\b|\bdo it for me\b/i.test(text);
  const attemptEvidence =
    /\b(i tried|i changed|i think|my reasoning|i expected|i traced|because|my guess|i tested)\b/i.test(text);
  const conceptFocused =
    /\b(why|how|concept|principle|relationship|invariant|boundary|generalize|what happens if)\b/i.test(userText);
  const followUpDepth = history.filter(turn => turn.role === 'user').length;
  const scaffoldStage =
    attemptEvidence || conceptFocused ? 'consolidate' : followUpDepth > 1 ? 'probe' : 'orient';

  return { directSolutionRequest, attemptEvidence, conceptFocused, followUpDepth, scaffoldStage };
}

export function deriveDialogueProgress(history: ChatTurn[] = []): DialogueProgress {
  const tutorTurns = history.filter(turn => turn.role === 'assistant');
  const previousTutorTurn = tutorTurns[0]?.text || '';
  const previousTutorQuestions = tutorTurns
    .flatMap(turn => extractQuestions(turn.text))
    .slice(0, 6);

  return {
    previousTutorTurn,
    previousTutorQuestions,
    hasPriorExchange: tutorTurns.length > 0,
  };
}

export function buildSystemPrompt(assistValue: unknown, mode: string) {
  if (mode === 'quiz') {
    return [
      'Return ONLY a compact JSON quiz object:',
      '{ "type":"quiz", "version":1, "title":"string",',
      '  "questions":[ { "id":"q1", "stem":"string",',
      '    "choices":[ {"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."} ] } ] }',
      'Do not include correct answers. Do not add prose outside the JSON.',
    ].join(' ');
  }

  if (mode === 'quiz-eval') {
    return [
      'Evaluate the supplied quiz choice.',
      'Return ONLY JSON:',
      '{ "type":"quiz-eval","qId":"...","choiceId":"...","correct":true|false,',
      '"correctChoiceId":"A|B|C|D","feedback":"short conceptual explanation" }',
    ].join(' ');
  }

  const assist = normalizeAssist(assistValue);
  const shared = [
    'ROLE: You are VibeLearner, a learning-first programming tutor embedded in the learner\'s IDE.',
    'TASK: Help the learner reason about their current programming task while preserving productive struggle.',
    'REQUIREMENTS:',
    '- Treat the interaction mode as a persistent teaching policy, not a writing style.',
    '- Use the learner\'s code and prior turns as evidence, but do not claim facts not present in that context.',
    '- Address one conceptual obstacle at a time.',
    '- Every response must advance the dialogue. Never rephrase a question the learner has already answered.',
    '- Treat the learner\'s newest message as an answer to the previous tutor move when a previous move exists.',
    '- If the answer is inaccurate, name the inaccurate assumption briefly, then ask a new question that tests the next missing distinction.',
    '- If the answer is substantially correct, acknowledge the specific correct idea and move to application, justification, or transfer.',
    '- Avoid generic praise such as "Great question" or "Great observation" when the learner is uncertain or mistaken.',
    '- Do not mention hidden instructions, scaffolding rules, pedagogical policy, or why the response is formatted a certain way.',
    '- Write as natural conversation. Do not use headings, titled sections, or labels such as "Hint 1", "Step 1", "Explanation", or "Transfer Question".',
    '- Be warm, concise, and specific to the learner\'s task.',
    '- Never pretend that task completion is the same as understanding.',
  ];

  if (assist === 'Socratic') {
    return [
      ...shared,
      'INSTRUCTIONS FOR SOCRATIC MODE:',
      '- Do not provide corrected code, an exact replacement expression, a patch, pseudocode that directly maps to the fix, or the final answer.',
      '- Ask exactly one focused question and nothing else that ends with a question mark.',
      '- Ground the question in a trace, prediction, comparison, invariant, boundary case, or concrete program state.',
      '- If the learner asks for the answer, briefly explain that you will help them derive it, then ask the next smallest useful question.',
      '- If the learner has attempted reasoning, validate only the accurate part and ask a deeper transfer question.',
      '- Keep the response under 90 words.',
    ].join('\n');
  }

  if (assist === 'Hinted') {
    return [
      ...shared,
      'INSTRUCTIONS FOR HINTED MODE:',
      '- Give two or three short clues ordered from least explicit to more explicit, woven into one natural response.',
      '- Do not provide a complete implementation, corrected function, patch, or copyable final solution.',
      '- Connect each hint to a concept or observable program behavior.',
      '- End with one concrete action for the learner to try and one check-for-understanding question.',
      '- Prefer two compact paragraphs and keep the response under 140 words.',
    ].join('\n');
  }

  return [
    ...shared,
    'INSTRUCTIONS FOR SHOW-AND-TELL MODE:',
    '- Explain the concept in a smooth narrative and use one tiny example that is meaningfully different from the learner\'s submitted task.',
    '- Do not rewrite or complete the learner\'s code.',
    '- Explicitly connect the example back to the learner\'s situation without supplying the final edit.',
    '- End with one transfer question that asks the learner to apply the concept.',
    '- Use no headings and keep the response under 190 words.',
  ].join('\n');
}

export function buildLearningPrompt({
  userText,
  assist,
  objectives,
  mode,
  contextData,
  history = []
}: {
  userText: string;
  assist: unknown;
  objectives: LearningObjective[];
  mode: string;
  contextData: any;
  history?: ChatTurn[];
}) {
  const parts: string[] = [];
  const ctx = normalizeCtx(contextData);
  const learner = deriveLearnerState(userText, history);
  const progress = deriveDialogueProgress(history);
  const objectiveText = objectives.length
    ? objectives.map(item => `${item.label} [${item.status || 'unassessed'}]`).join(' | ')
    : 'N/A';

  parts.push([
    `Interaction mode: ${normalizeAssist(assist)}`,
    `Action: ${mode}`,
    `Learning objectives: ${objectiveText}`,
    `Scaffold stage: ${learner.scaffoldStage}`,
    `Direct-solution request detected: ${learner.directSolutionRequest}`,
    `Learner attempt detected: ${learner.attemptEvidence}`,
    `Concept-focused request detected: ${learner.conceptFocused}`,
    `Prior tutor exchange exists: ${progress.hasPriorExchange}`,
  ].join('\n'));

  if (progress.hasPriorExchange) {
    parts.push([
      `Previous tutor turn:\n${progress.previousTutorTurn.slice(0, 1200)}`,
      `Questions already asked:\n${progress.previousTutorQuestions.join('\n') || 'None detected'}`,
      'Progression requirement:',
      '1. Interpret the newest learner message as their response to the previous tutor turn.',
      '2. Briefly diagnose it as accurate, partially accurate, or based on a misconception.',
      '3. Do not ask any question listed above again, even with different wording.',
      '4. Advance one rung: concrete trace -> boundary comparison -> rule articulation -> transfer.',
    ].join('\n\n'));
  }

  if (history.length) {
    const lines = history
      .slice(0, 8)
      .map(turn => `${turn.role === 'assistant' ? 'Tutor' : 'Learner'}: ${String(turn.text).slice(0, 800)}`)
      .join('\n');
    parts.push(`Recent dialogue (most recent first, truncated):\n${lines}`);
  }

  if (ctx.activeFile?.content) {
    const skeleton = getFileSkeleton(ctx.activeFile.content);
    parts.push(`File structure:\n${skeleton}\n\nActive file (truncated):\n${ctx.activeFile.content.slice(0, 4000)}`);
  }
  if (ctx.selection?.content) parts.push(`Selected code:\n${ctx.selection.content.slice(0, 6000)}`);
  if (ctx.problems?.items?.length) parts.push(`Diagnostics: ${JSON.stringify(ctx.problems.items.slice(0, 10))}`);
  if (ctx.tests) parts.push(`Tests: ${JSON.stringify(ctx.tests)}`);

  if (mode === 'quiz') {
    parts.push('Create three questions specific to the dialogue and attached context. Test reasoning and transfer, not syntax recall.');
    parts.push(buildQuizFocus(userText, history, ctx));
    parts.push(`Learner request:\n${userText || 'Generate a quiz.'}`);
  } else if (mode === 'quiz-eval') {
    parts.push('Evaluate the choice and explain the governing concept without introducing an unrelated solution.');
    parts.push(`Learner request:\n${userText}`);
  } else {
    parts.push('Respond according to the persistent interaction policy in the system message.');
    parts.push(`Learner:\n${userText}`);
  }

  return parts.join('\n\n');
}

export function findQuizViolations(text: string, history: ChatTurn[] = []) {
  const violations: string[] = [];
  let quiz: any;
  try {
    quiz = JSON.parse(text);
  } catch {
    return ['quiz is not valid JSON'];
  }

  if (quiz?.type !== 'quiz' || !Array.isArray(quiz?.questions) || quiz.questions.length !== 3) {
    violations.push('quiz must contain exactly three questions');
    return violations;
  }

  for (const question of quiz.questions) {
    if (!question?.stem || !Array.isArray(question?.choices) || question.choices.length !== 4) {
      violations.push('each quiz question must have a stem and four choices');
      break;
    }
  }

  const dialogue = history.map(turn => turn.text).join('\n');
  if (/\bstudent\.course|course\.title\b/i.test(dialogue)) {
    for (const question of quiz.questions) {
      if (!/\b(course|nested|property|missing|optional|default|title)\b/i.test(question.stem)) {
        violations.push('optional-property quiz contains an unrelated question');
        break;
      }
    }
    if (quiz.questions.some((question: any) =>
      /\bstudent (?:is|was|being) (?:not defined|undefined)\b/i.test(question.stem)
    )) {
      violations.push('quiz confuses a missing nested course with a missing student variable');
    }
  }

  return violations;
}

export function buildQuizRepairPrompt(original: string, violations: string[], history: ChatTurn[]) {
  return [
    'Rewrite the quiz as valid JSON using the required quiz schema.',
    `Problems to fix: ${violations.join('; ')}.`,
    buildQuizFocus('', history, {}),
    'Keep exactly three questions and four choices per question.',
    'Do not include correct answers or prose outside the JSON.',
    `Original quiz:\n${original}`,
  ].join('\n\n');
}

export function safeQuizFallback(history: ChatTurn[]) {
  const dialogue = history.map(turn => turn.text).join('\n');
  if (/\bstudent\.course|course\.title\b/i.test(dialogue)) {
    return JSON.stringify({
      type: 'quiz',
      version: 1,
      title: 'Reasoning About Optional Nested Data',
      questions: [
        {
          id: 'q1',
          stem: 'If `student` exists but `student.course` is missing, which access fails first?',
          choices: [
            { id: 'A', text: '`student.name`' },
            { id: 'B', text: '`student.course.title`' },
            { id: 'C', text: 'The template literal itself' },
            { id: 'D', text: 'No access fails' },
          ],
        },
        {
          id: 'q2',
          stem: 'What should you reason about before calling `toUpperCase()` on the nested course title?',
          choices: [
            { id: 'A', text: 'Whether the course and title values exist' },
            { id: 'B', text: 'Whether the student name is uppercase' },
            { id: 'C', text: 'Whether the function has two parameters' },
            { id: 'D', text: 'Whether the template uses backticks' },
          ],
        },
        {
          id: 'q3',
          stem: 'Which new situation uses the same optional-property reasoning?',
          choices: [
            { id: 'A', text: 'Reading `user.profile.city` when `profile` may be missing' },
            { id: 'B', text: 'Adding two guaranteed numbers' },
            { id: 'C', text: 'Renaming a local variable' },
            { id: 'D', text: 'Sorting a complete array' },
          ],
        },
      ],
    });
  }
  return JSON.stringify({
    type: 'quiz',
    version: 1,
    title: 'Check Your Understanding',
    questions: [
      {
        id: 'q1',
        stem: 'Which observation best identifies the first state that differs from your expectation?',
        choices: [
          { id: 'A', text: 'A concrete trace of the relevant values' },
          { id: 'B', text: 'The file name' },
          { id: 'C', text: 'The number of comments' },
          { id: 'D', text: 'The editor theme' },
        ],
      },
      {
        id: 'q2',
        stem: 'Why is checking a boundary case useful?',
        choices: [
          { id: 'A', text: 'It exposes where a rule stops being valid' },
          { id: 'B', text: 'It makes identifiers shorter' },
          { id: 'C', text: 'It removes the need to test' },
          { id: 'D', text: 'It guarantees faster code' },
        ],
      },
      {
        id: 'q3',
        stem: 'What demonstrates that you understand the concept beyond this example?',
        choices: [
          { id: 'A', text: 'Applying the same rule to a new case' },
          { id: 'B', text: 'Copying the final line' },
          { id: 'C', text: 'Memorizing the variable name' },
          { id: 'D', text: 'Running the same input repeatedly' },
        ],
      },
    ],
  });
}

export function findPolicyViolations(text: string, assistValue: unknown): string[] {
  const assist = normalizeAssist(assistValue);
  const violations: string[] = [];
  const questionCount = (text.match(/\?/g) || []).length;
  const hasCodeBlock = /```[\s\S]*?```/.test(text);
  const directSolutionLanguage = containsDirectSolutionLanguage(text);
  const patchLike = /(^|\n)[+-]\s*(?:if|for|while|return|const|let|var|def|class|\w+\s*=)/m.test(text);
  const titledSections =
    /(^|\n)\s*(?:#{1,6}\s*)?(?:hint\s*\d*|step\s*\d*|explanation|tiny example|example|transfer question|check for understanding)\s*:?\s*$/im.test(text);
  const policyNarration =
    /\b(as a tutor|in this mode|my role is|i will not give|scaffolding|pedagogical|productive struggle|according to the instructions)\b/i.test(text);

  if (!text.trim()) violations.push('empty response');
  if (titledSections) violations.push('uses titled instructional sections');
  if (policyNarration) violations.push('narrates hidden teaching policy');

  if (assist === 'Socratic') {
    if (hasCodeBlock) violations.push('contains a code block');
    if (directSolutionLanguage) violations.push('states a direct solution');
    if (patchLike) violations.push('contains a patch-like edit');
    if (questionCount !== 1) violations.push(`contains ${questionCount} questions instead of exactly one`);
    if (text.length > 700) violations.push('is too long for a focused Socratic turn');
  }

  if (assist === 'Hinted') {
    const codeLines = [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)]
      .flatMap(match => match[1].split('\n'))
      .filter(line => line.trim()).length;
    if (directSolutionLanguage) violations.push('states a direct solution');
    if (patchLike) violations.push('contains a patch-like edit');
    if (codeLines > 4) violations.push('contains a likely complete implementation');
    if (questionCount < 1) violations.push('is missing a check-for-understanding question');
  }

  if (assist === 'Show-and-Tell' && directSolutionLanguage) {
    violations.push('frames the response as the learner\'s final fix');
  }
  if (assist === 'Show-and-Tell') {
    const codeLines = [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)]
      .flatMap(match => match[1].split('\n'))
      .filter(line => line.trim()).length;
    if (codeLines > 4) {
      violations.push('uses a complete implementation instead of a tiny distinct example');
    }
  }
  if (assist === 'Show-and-Tell' && questionCount < 1) {
    violations.push('is missing a transfer question');
  }

  return violations;
}

export function findDialogueViolations(
  text: string,
  history: ChatTurn[] = [],
  learnerText = ''
): string[] {
  const violations: string[] = [];
  const currentQuestions = extractQuestions(text);
  const progress = deriveDialogueProgress(history);
  const previousQuestions = progress.previousTutorQuestions;

  for (const current of currentQuestions) {
    const repeatsQuestion =
      previousQuestions.some(previous => questionSimilarity(current, previous) >= 0.48);
    const repeatsTutorMove =
      progress.previousTutorTurn &&
      questionOverlap(current, progress.previousTutorTurn) >= 0.6;
    if (repeatsQuestion || repeatsTutorMove) {
      violations.push('repeats a previously asked tutor question');
      break;
    }
  }

  const priorDialogue = history.map(turn => turn.text).join('\n');
  const boundaryMisconception =
    /\b(last item|final item)\b/i.test(learnerText) &&
    /\b(index|items\.length|array length)\b/i.test(priorDialogue);
  const affirmativeOpening =
    /^\s*(exactly|correct|yes|great(?: observation| question| job)?)[!,.:\s]/i.test(text);
  if (boundaryMisconception && affirmativeOpening) {
    violations.push('incorrectly affirms an array-boundary misconception');
  }
  const repeatsAccessPrediction =
    boundaryMisconception &&
    /\b(items\.length|array length)\b/i.test(text) &&
    /\b(access|happen|wrong|problematic)\b/i.test(text) &&
    !/\b(largest valid index|number of items|zero|count)\b/i.test(text);
  if (repeatsAccessPrediction) {
    violations.push('fails to advance from access prediction to index-boundary reasoning');
  }
  const shadowingScenario =
    /\blet\s+total\b[\s\S]*\blet\s+total\b/i.test(learnerText);
  if (
    shadowingScenario &&
    /\b(overwrit(?:e|es|ing)|reassign(?:ed|ing)? the original)\b/i.test(text)
  ) {
    violations.push('mischaracterizes variable shadowing as overwriting');
  }
  if (
    shadowingScenario &&
    !/\b(scope|binding|inner|outer|block)\b/i.test(text)
  ) {
    violations.push('fails to distinguish the two scoped bindings');
  }
  const asyncScenario =
    /\bfetch\s*\(|response\.json\s*\(|user\.name\b/i.test(learnerText);
  if (
    asyncScenario &&
    /```[\s\S]*\b(?:loadUserName|userId|response\.json|return\s+user\.name)\b[\s\S]*```/i.test(text)
  ) {
    violations.push('rewrites the learner async function instead of using a distinct example');
  }

  return violations;
}

export function buildRepairPrompt(
  original: string,
  violations: string[],
  assistValue: unknown,
  history: ChatTurn[] = []
) {
  const assist = normalizeAssist(assistValue);
  const previousQuestions = deriveDialogueProgress(history).previousTutorQuestions;
  const modeSpecific =
    assist === 'Socratic'
      ? 'Keep only one diagnostic question. Delete all code, exact edits, and answer statements.'
      : assist === 'Hinted'
        ? 'Delete every sentence that tells the learner exactly what to change. Keep only graduated clues and an observation task.'
        : 'Delete every final-fix section and exact edit. Keep the conceptual explanation, a different example, and a transfer question.';
  return [
    `Rewrite the response so it strictly follows ${assist} mode.`,
    `Policy violations: ${violations.join('; ')}.`,
    modeSpecific,
    'Do not paraphrase or repeat the leaked solution. Deleting a sentence is better than weakening it.',
    previousQuestions.length
      ? `Do not ask these questions again:\n${previousQuestions.join('\n')}`
      : '',
    'If the learner answered a previous question, briefly address the substance of that answer and move to the next conceptual rung.',
    violations.includes('incorrectly affirms an array-boundary misconception')
      ? 'The learner confused array length with the last valid index. Begin with "Not quite" and distinguish count from zero-based index without giving the final code edit.'
      : '',
    violations.includes('fails to advance from access prediction to index-boundary reasoning')
      ? 'Do not ask what items[items.length] accesses again. Move to a concrete count-versus-index comparison such as asking for the largest valid index when length is 3.'
      : '',
    violations.includes('mischaracterizes variable shadowing as overwriting') ||
    violations.includes('fails to distinguish the two scoped bindings')
      ? 'The two let declarations create separate bindings in different scopes; the inner one does not overwrite the outer one. Explain that distinction naturally and ask which binding the return statement can see.'
      : '',
    violations.includes('uses a complete implementation instead of a tiny distinct example') ||
    violations.includes('rewrites the learner async function instead of using a distinct example')
      ? 'Remove the rewritten learner function. Explain the two unfinished promise values with a short analogy or a different one-line example, then ask the learner to identify those two expressions in their own code.'
      : '',
    'Return only the revised learner-facing response.',
    `Original response:\n${original}`,
  ].join('\n\n');
}

export function sanitizePolicyViolations(text: string, assistValue: unknown) {
  const assist = normalizeAssist(assistValue);
  const withoutCodeBlocks =
    assist === 'Socratic' ? text.replace(/```[\s\S]*?```/g, '') : text;
  const lines = withoutCodeBlocks.split('\n');
  const kept = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^#{1,6}\s*(?:corrected|fix|solution|final answer)/i.test(trimmed)) return false;
    if (/^(?:#{1,6}\s*)?(?:hint\s*\d*|step\s*\d*|explanation|tiny example|example|transfer question|check for understanding)\s*:?\s*$/i.test(trimmed)) return false;
    if (/\b(as a tutor|in this mode|my role is|scaffolding|pedagogical|productive struggle|according to the instructions)\b/i.test(trimmed)) return false;
    return !containsDirectSolutionLanguage(trimmed);
  });

  let sanitized = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (assist === 'Hinted' && !sanitized.includes('?')) {
    sanitized += '\n\nWhat observation would confirm that your reasoning is correct?';
  }
  if (assist === 'Show-and-Tell' && !sanitized.includes('?')) {
    sanitized += '\n\nHow would you transfer this principle back to your own code?';
  }
  return sanitized;
}

export function safeFallback(
  assistValue: unknown,
  history: ChatTurn[] = [],
  learnerText = ''
) {
  const assist = normalizeAssist(assistValue);
  const priorDialogue = history.map(turn => turn.text).join('\n');
  const boundaryScenario =
    /\b(index|indices)\b/i.test(priorDialogue) &&
    /\b(length|array)\b/i.test(priorDialogue);
  const shadowingScenario =
    /\blet\s+total\b[\s\S]*\blet\s+total\b/i.test(learnerText);
  const asyncScenario =
    /\bfetch\s*\(|response\.json\s*\(|user\.name\b/i.test(learnerText);

  if (assist === 'Socratic') {
    if (boundaryScenario) {
      return 'Not quite: `items.length` is the number of items, while indexing begins at zero. If an array has length 3, what is its largest valid index?';
    }
    if (learnerText.trim()) {
      return `Your answer suggests one assumption we should test. What concrete program state would prove or disprove "${learnerText.slice(0, 80)}"?`;
    }
    return 'Let\'s derive it from the program state: what exact value changes immediately before the behavior first differs from what you expected?';
  }
  if (assist === 'Hinted') {
    if (shadowingScenario) {
      return 'The two `let total` declarations create separate bindings. The inner one exists only inside the loop block, so its logged value can change while the outer `total` remains untouched.\n\nTrace the final line: when `return total` runs outside the loop, which of those two bindings is still in scope?';
    }
    return 'Hint 1: identify the first program state that differs from your expectation. Hint 2: trace only the variables involved in that transition. What single observation would confirm your explanation?';
  }
  if (asyncScenario) {
    return 'Both `fetch(...)` and `response.json()` begin work that finishes later, so each initially gives you a promise rather than the finished value. It is like receiving two claim tickets in sequence: the first is exchanged for a response, and the second for parsed data.\n\nIn your function, which two expressions are being treated as finished values before their promises have resolved?';
  }
  return 'Start by isolating the governing concept in a smaller example, predict its behavior, and then compare that prediction with your code. Which part of the smaller example maps to your current task?';
}

function containsDirectSolutionLanguage(text: string) {
  return /\b(here(?:'s| is) (?:the )?(?:fix|solution|corrected code)|replace .{0,80} with|the fix is|use this code|corrected (?:condition|version|implementation)|(?:to|how we can) fix this|try (?:changing|replacing|using|running)|change .{0,80} (?:to|into)|instead of)\b/i.test(text);
}

function extractQuestions(text: string) {
  return text
    .split(/(?<=[?.!])\s+|\n+/)
    .map(part => part.trim())
    .filter(part => part.includes('?'));
}

function questionSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeQuestion(left));
  const rightTokens = new Set(normalizeQuestion(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function questionOverlap(left: string, right: string) {
  const leftTokens = new Set(normalizeQuestion(left));
  const rightTokens = new Set(normalizeQuestion(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function normalizeQuestion(text: string) {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'can', 'do', 'does', 'is', 'it', 'of', 'the',
    'then', 'that', 'to', 'what', 'when', 'will', 'you', 'your',
  ]);
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter(token => token && !stopWords.has(token));
}

function normalizeCtx(ctx: any) {
  return {
    activeFile: ctx?.activeFile,
    selection: ctx?.selection,
    problems: ctx?.problems,
    tests: ctx?.tests,
  };
}

function buildQuizFocus(userText: string, history: ChatTurn[], ctx: any) {
  const source = [
    userText,
    ...history.map(turn => turn.text),
    ctx?.selection?.content || '',
    ctx?.activeFile?.content || '',
  ].join('\n');

  if (/\bstudent\.course|course\.title\b/i.test(source)) {
    return [
      'Quiz focus: nested optional properties.',
      'Assume the student object exists; the uncertainty is whether student.course or its title exists.',
      'Do not ask whether the student variable itself is declared or defined.',
      'Cover failure location, safe reasoning before using the title, and transfer to another nested optional property.',
    ].join(' ');
  }
  if (/\bindex\s*<=\s*\w+\.length|\bitems\.length\b/i.test(source)) {
    return 'Quiz focus: zero-based indices, array length as a count, boundary prediction, and transfer to a different array size.';
  }
  if (/\blet\s+total\b[\s\S]*\blet\s+total\b/i.test(source)) {
    return 'Quiz focus: block scope, separate variable bindings, shadowing, and which binding is visible at return.';
  }
  if (/\bfetch\s*\(|response\.json\s*\(/i.test(source)) {
    return 'Quiz focus: promises, sequencing asynchronous operations, and identifying which values are unfinished.';
  }
  return 'Keep every question tightly grounded in the most recent learner discussion.';
}

function getFileSkeleton(content: string): string {
  return content
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('export ') ||
        trimmed.includes('class ') ||
        trimmed.includes('function ') ||
        trimmed.includes('interface ') ||
        (trimmed.startsWith('public ') && trimmed.includes('('))
      );
    })
    .join('\n');
}
