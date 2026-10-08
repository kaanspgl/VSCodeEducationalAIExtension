/**
 * Study task bank. Each task carries the instructor-reviewed material the proposal calls for:
 * a learning objective, core ideas, acceptable approaches, common misconceptions, program
 * tests, and comprehension focus areas. Review these with your supervisor before piloting.
 *
 * Tests are input -> expected-output pairs against a named function, so the same bank works
 * for every supported language.
 */

export type TestCase = { args: unknown[]; expected: unknown };

export type StudyTask = {
  id: string;
  title: string;
  /** Plain-language statement shown to the student. */
  statement: string;
  /** snake_case function name; the JavaScript name is derived (camelCase). */
  fn: string;
  /** Concept(s) this task targets (instructor-facing, also given to the model). */
  objective: string;
  /** Ideas a student should be able to express before code is generated. */
  coreIdeas: string[];
  acceptableApproaches: string[];
  misconceptions: string[];
  /** Suggested comprehension-question angles for the generated code. */
  comprehensionFocus: string[];
  tests: TestCase[];
};

export const TASKS: StudyTask[] = [
  {
    id: 'sum_positives',
    title: 'Sum of the positive numbers',
    statement:
      'Write a function that takes a list of numbers and returns the sum of only the positive numbers in it. ' +
      'For example, [3, -1, 4, -5] gives 7. An empty list, or a list with no positives, gives 0.',
    fn: 'sum_positives',
    objective: 'Accumulation with a conditional inside a loop.',
    coreIdeas: [
      'Visit every item in the list (repeat for each element).',
      'Check whether the current item is positive (strictly greater than 0).',
      'Only when it is positive, add it to a running total that starts at 0.',
    ],
    acceptableApproaches: [
      'for-loop with if and a running total',
      'while-loop with an index',
      'built-in filter/sum or a comprehension (acceptable if the student can explain the same three ideas)',
    ],
    misconceptions: [
      'Adding every item and then subtracting negatives',
      'Resetting the total to 0 inside the loop',
      'Treating 0 as positive',
      'Returning inside the loop after the first item',
    ],
    comprehensionFocus: [
      'Predict the output for a list that contains 0 and negative numbers',
      'Why the total is initialised to 0 before the loop',
      'What changes if the condition is >= 0 instead of > 0',
    ],
    tests: [
      { args: [[3, -1, 4, -5]], expected: 7 },
      { args: [[]], expected: 0 },
      { args: [[-2, -9]], expected: 0 },
      { args: [[0, 2, 0]], expected: 2 },
      { args: [[10]], expected: 10 },
    ],
  },
  {
    id: 'letter_grade',
    title: 'Letter grade from a score',
    statement:
      'Write a function that takes a numeric score (0-100) and returns a letter grade as a string: ' +
      '"A" for 90 and above, "B" for 80-89, "C" for 70-79, "D" for 60-69, and "F" for anything below 60.',
    fn: 'letter_grade',
    objective: 'Multi-branch conditionals and ordering of conditions / boundary values.',
    coreIdeas: [
      'Compare the score against thresholds from highest to lowest (or use explicit ranges).',
      'Boundary values belong to the higher grade (90 is an A, not a B).',
      'A final fallback case covers everything below the lowest threshold.',
    ],
    acceptableApproaches: [
      'if / elif / else chain from highest to lowest',
      'nested ranges with explicit upper and lower bounds',
      'lookup over a list of (threshold, grade) pairs',
    ],
    misconceptions: [
      'Using > instead of >= so boundary scores get the wrong grade',
      'Checking the lowest threshold first so every score matches it',
      'Separate non-exclusive if statements that overwrite one another',
    ],
    comprehensionFocus: [
      'Predict the grade for a boundary score such as 80 or 89',
      'Why the order of the conditions matters',
      'What happens if the order of the first two conditions is swapped',
    ],
    tests: [
      { args: [95], expected: 'A' },
      { args: [90], expected: 'A' },
      { args: [89], expected: 'B' },
      { args: [80], expected: 'B' },
      { args: [79], expected: 'C' },
      { args: [65], expected: 'D' },
      { args: [60], expected: 'D' },
      { args: [59], expected: 'F' },
      { args: [0], expected: 'F' },
    ],
  },
  {
    id: 'find_max',
    title: 'Largest number in a list',
    statement:
      'Write a function that takes a non-empty list of numbers and returns the largest one, ' +
      'without using a built-in max function. For example, [3, 9, 2] gives 9.',
    fn: 'find_max',
    objective: 'Loop with a "best so far" variable that is updated conditionally.',
    coreIdeas: [
      'Keep a variable holding the largest value seen so far.',
      'Initialise it from the list (the first item), not from an arbitrary number like 0.',
      'Compare each item to it and replace it when the item is larger.',
    ],
    acceptableApproaches: [
      'start with the first element and loop through the rest',
      'start with the first element and loop through every element',
      'sort and take the last element (acceptable only if the student can explain why it works)',
    ],
    misconceptions: [
      'Initialising the best-so-far to 0, which breaks for all-negative lists',
      'Comparing neighbours only instead of against the best so far',
      'Returning the index instead of the value',
    ],
    comprehensionFocus: [
      'Predict the result for an all-negative list',
      'Why the best-so-far is initialised from the list rather than 0',
      'Trace the value of the best-so-far at each step for a short list',
    ],
    tests: [
      { args: [[3, 9, 2]], expected: 9 },
      { args: [[-4, -1, -7]], expected: -1 },
      { args: [[5]], expected: 5 },
      { args: [[2, 2, 2]], expected: 2 },
      { args: [[1, 8, 3, 8, 0]], expected: 8 },
    ],
  },
  {
    id: 'count_above_average',
    title: 'Count values above the average',
    statement:
      'Write a function that takes a list of numbers and returns how many of them are strictly greater than ' +
      'the average of the list. For example, [1, 2, 3, 10] has average 4, so the answer is 1. An empty list gives 0.',
    fn: 'count_above_average',
    objective: 'Two-pass list processing: compute a summary value, then count against it.',
    coreIdeas: [
      'First compute the average (total divided by length) before comparing anything.',
      'Then loop again and count the items strictly greater than that average.',
      'Handle the empty list so there is no division by zero.',
    ],
    acceptableApproaches: [
      'one loop to total, a second loop to count',
      'sum() and len() for the average, then a loop or comprehension to count',
    ],
    misconceptions: [
      'Recomputing or updating the average inside the same loop that counts',
      'Using >= so items equal to the average are counted',
      'Dividing by zero for an empty list',
    ],
    comprehensionFocus: [
      'Predict the result for a list where some items equal the average',
      'Why the average must be computed before the counting loop',
      'How the function changes to count items below the average',
    ],
    tests: [
      { args: [[1, 2, 3, 10]], expected: 1 },
      { args: [[]], expected: 0 },
      { args: [[5, 5, 5]], expected: 0 },
      { args: [[1, 2, 3, 4, 5]], expected: 2 },
      { args: [[-3, 0, 3, 9]], expected: 2 },
    ],
  },
  {
    id: 'first_negative_index',
    title: 'Position of the first negative number',
    statement:
      'Write a function that takes a list of numbers and returns the position (index, starting at 0) of the first ' +
      'negative number. If there is no negative number, return -1. For example, [4, 7, -2, -8] gives 2.',
    fn: 'first_negative_index',
    objective: 'Loop with early exit and a "not found" result.',
    coreIdeas: [
      'Go through the list in order while keeping track of the position.',
      'Stop and return as soon as a negative number is found.',
      'Return -1 only after the whole list has been checked.',
    ],
    acceptableApproaches: [
      'for i in range(len(list)) with early return',
      'enumerate with early return',
      'while loop with a manually advanced index',
    ],
    misconceptions: [
      'Returning -1 inside the loop on the first non-negative item',
      'Returning the value instead of the index',
      'Not stopping, so the last negative position is returned',
    ],
    comprehensionFocus: [
      'Predict the result when there are several negatives',
      'Why the -1 return sits after the loop',
      'What changes to return the last negative instead of the first',
    ],
    tests: [
      { args: [[4, 7, -2, -8]], expected: 2 },
      { args: [[1, 2, 3]], expected: -1 },
      { args: [[]], expected: -1 },
      { args: [[-1, 5]], expected: 0 },
      { args: [[0, 0, -3]], expected: 2 },
    ],
  },
];

export function getTask(id: string): StudyTask | undefined {
  return TASKS.find(t => t.id === id);
}

export function fnNameFor(task: StudyTask, language: string): string {
  if (language === 'javascript') {
    return task.fn.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }
  return task.fn;
}

export function signatureHint(task: StudyTask, language: string): string {
  const name = fnNameFor(task, language);
  if (language === 'javascript') return `function ${name}(...)`;
  return `def ${name}(...)`;
}

/** Open-ended build: no fixed task, the student decides what program they want. */
export function makeFreeTask(n: number): StudyTask {
  return {
    id: 'free_' + n,
    title: 'Build a program',
    statement: '',
    fn: '',
    objective: 'Understand conceptually how the program they asked for works.',
    coreIdeas: [],
    acceptableApproaches: [],
    misconceptions: [],
    comprehensionFocus: [
      'Predict what the program prints for a specific input',
      'Why a key line, condition, or starting value is needed',
      'What must change for a modified requirement',
    ],
    tests: [],
  };
}

export function isFree(task: StudyTask): boolean {
  return task.id.startsWith('free_');
}
