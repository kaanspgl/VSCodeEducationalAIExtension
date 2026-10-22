const test = require('node:test');
const assert = require('node:assert/strict');
const { matchChoices, sameResult } = require('../out/vibe/checks');

// The answer key of a "what would it print if…" question is checked against the real output of the changed
// program. These cases come from real model runs on "add up every whole number from 0 to 100".
const current = 'The sum of numbers from 0 to 100 is: 5050';
const choices = [
  'The program would print 5050, the same as now',
  'The program would print 4950',
  'The program would print 0 because the loop never runs',
  'The program would print 100',
];

test('a labelled output that changes matches the choice naming the new value', () => {
  assert.deepEqual(matchChoices(choices, 'The sum of numbers from 0 to 100 is: 4950', current), [1]);
});

test('an unchanged output matches "the same", not the numbers in its label', () => {
  assert.deepEqual(matchChoices(choices, current, current), [0]);
});

test('a choice that also names a wrong number does not match', () => {
  assert.deepEqual(matchChoices(['4950 or 5050', '4950'], 'The sum of numbers from 0 to 100 is: 4950', current), [1]);
});

test('a number that only appears in the label is not the answer', () => {
  assert.deepEqual(matchChoices(['100', '2550'], 'The sum of numbers from 0 to 100 is: 2550', current), [1]);
});

test('plain outputs match exactly', () => {
  assert.deepEqual(matchChoices(['5050', '4950', '0', '100'], '4950', '5050'), [1]);
  assert.deepEqual(matchChoices(['It prints 4950', 'It prints 5050'], '4950', undefined), [0]);
});

test('with several candidates, the one covering more of the output wins', () => {
  assert.deepEqual(matchChoices(['It prints 1, 2 and 3', 'It prints 3'], '1\n2\n3', '1\n2'), [0]);
});

test('no choice matching the real output means the question gets dropped', () => {
  assert.deepEqual(matchChoices(['It prints 10', 'It prints 20'], 'The sum of numbers from 0 to 100 is: 4950', current), []);
});

// Choices written in words instead of exact outputs (seen in real runs).
test('word choices: "a smaller number" matches when the result goes down', () => {
  const words = [
    'The program would print a smaller number because the loop would exclude 100 from the sum.',
    'The program would print the same result because 100 is already included in the sum.',
    'The program would print a larger number because the loop would include 101 in the sum.',
    'The program would cause a runtime error because the loop condition would never be true.',
  ];
  assert.deepEqual(matchChoices(words, 'The sum of numbers from 0 to 100 is: 4950', current), [0]);
  assert.deepEqual(matchChoices(words, current, current), [1]);
});

// "Check my work" is decided by running the student's program when the solution's output is known.
test('sameResult: right result with different label wording counts as done', () => {
  const expected = 'The sum of even numbers from 0 to 100 is: 2550';
  assert.equal(sameResult('The sum of numbers from 0 to 100 is: 2550', expected, current), true);
  assert.equal(sameResult('2550', expected, current), true);
});

test('sameResult: unchanged or wrong result is not done', () => {
  const expected = 'The sum of even numbers from 0 to 100 is: 2550';
  assert.equal(sameResult(current, expected, current), false);
  assert.equal(sameResult('The sum of numbers from 0 to 100 is: 2500', expected, current), false);
});

test('sameResult: no numbers to compare leaves the decision to the model', () => {
  assert.equal(sameResult('Hello, Ada!', 'Hello, ADA!', 'Hello, Ada'), undefined);
});

test('choices that differ only in their reasoning both fit the real output', () => {
  const reasons = [
    'The loop would exclude 100 from the sum, so the total would be 4950 instead of 5050',
    'The loop would include 100 in the sum, so the total would be 5150 instead of 5050',
    'The loop would exclude 0 from the sum, so the total would be 4950 instead of 5050',
    'The loop would run infinitely because i would never reach 100',
  ];
  // Running can't tell the reasons apart, so both fit; the AI's key (0) is kept because it is one of them.
  assert.deepEqual(matchChoices(reasons, 'The sum of numbers from 0 to 100 is: 4950', current), [0, 2]);
});
