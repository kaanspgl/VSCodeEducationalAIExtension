const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// edits.ts imports 'vscode' only for the diff content provider; stub it for plain Node.
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return { Uri: { from: (o) => o } };
  return load.call(this, request, ...rest);
};
const { parseBlocks, applyBlocks, fencedToBlocks, normalizePath } = require('../out/vibe/edits');
Module._load = load;

const FENCE = '```';

test('parseBlocks extracts SEARCH/REPLACE blocks and keeps the explanation', () => {
  const text = [
    'Summary: change it.',
    '<<<<<<< SEARCH src/a.js',
    'let x = 1;',
    '=======',
    'let x = 2;',
    '>>>>>>> REPLACE',
    'In plain terms: x is now 2.',
  ].join('\n');
  const { blocks, rest } = parseBlocks(text);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { path: 'src/a.js', search: 'let x = 1;', replace: 'let x = 2;' });
  assert.match(rest, /Summary: change it\./);
  assert.match(rest, /In plain terms/);
  assert.doesNotMatch(rest, /SEARCH|REPLACE/);
});

test('parseBlocks reads an empty SEARCH as a new file', () => {
  const { blocks } = parseBlocks('<<<<<<< SEARCH game.py\n=======\nprint("hi")\n>>>>>>> REPLACE');
  assert.equal(blocks[0].search, '');
  assert.equal(blocks[0].replace, 'print("hi")');
});

test('normalizePath rejects paths that escape the workspace', () => {
  assert.equal(normalizePath('./src/a.js'), 'src/a.js');
  assert.equal(normalizePath('src\\a.js'), 'src/a.js');
  assert.equal(normalizePath('../evil.js'), undefined);
  assert.equal(normalizePath('/etc/passwd'), undefined);
  assert.equal(normalizePath('C:/Windows/x.js'), undefined);
  assert.equal(normalizePath('node_modules/x/index.js'), undefined);
  assert.equal(normalizePath('.git/config'), undefined);
});

test('applyBlocks applies an exact match and counts lines', () => {
  const r = applyBlocks('a\nb\nc\n', [{ path: 'f', search: 'b', replace: 'B1\nB2' }]);
  assert.equal(r.content, 'a\nB1\nB2\nc\n');
  assert.equal(r.applied, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.added, 2);
  assert.equal(r.removed, 1);
});

test('applyBlocks tolerates wrong indentation and re-indents the replacement', () => {
  const file = 'def total(nums):\n    t = 0\n    for n in nums:\n        t += n\n    return t\n';
  const r = applyBlocks(file, [{
    path: 'f',
    search: '  for n in nums:\n      t += n',
    replace: '  for n in nums:\n      if n > 0:\n          t += n',
  }]);
  assert.equal(r.applied, 1);
  assert.equal(r.content, 'def total(nums):\n    t = 0\n    for n in nums:\n        if n > 0:\n            t += n\n    return t\n');
});

test('applyBlocks reports a SEARCH that does not exist', () => {
  const r = applyBlocks('a\nb\n', [{ path: 'f', search: 'zzz', replace: 'y' }]);
  assert.equal(r.applied, 0);
  assert.equal(r.failed, 1);
  assert.equal(r.content, 'a\nb\n');
});

test('applyBlocks creates a new file and preserves Windows line endings', () => {
  assert.equal(applyBlocks(undefined, [{ path: 'f', search: '', replace: 'x = 1' }]).content, 'x = 1\n');
  const r = applyBlocks('a\r\nb\r\n', [{ path: 'f', search: 'b', replace: 'c' }]);
  assert.equal(r.content, 'a\r\nc\r\n');
});

test('fencedToBlocks turns plain fenced code into a new file when nothing is named', () => {
  const text = `Here it is:\n${FENCE}javascript\nconst a = [3, 1];\na.sort();\nconsole.log(a);\n${FENCE}\nIn plain terms: sorts.`;
  const { blocks, rest } = fencedToBlocks(text, new Set(['main.js']));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'program.js'); // main.js already exists
  assert.equal(blocks[0].search, '');
  assert.match(rest, /proposed as a change to `program\.js`/);
});

test('fencedToBlocks uses the file named in the reply and the project folder', () => {
  const named = fencedToBlocks(`Create utils.js:\n${FENCE}js\nfunction a() {}\nfunction b() {}\nmodule.exports = { a, b };\n${FENCE}`, new Set());
  assert.equal(named.blocks[0].path, 'utils.js');
  const scoped = fencedToBlocks(`${FENCE}python\na = 1\nb = 2\nprint(a + b)\n${FENCE}`, new Set(), undefined, 'sorter');
  assert.equal(scoped.blocks[0].path, 'sorter/main.py');
});

test('fencedToBlocks replaces the active file when the code is a full rewrite of it', () => {
  const current = 'function total(nums) {\n  let t = 0;\n  for (const n of nums) t += n;\n  return t;\n}\n';
  const code = 'function total(nums) {\n  let t = 0;\n  for (const n of nums) if (n > 0) t += n;\n  return t;\n}';
  const { blocks } = fencedToBlocks(`${FENCE}javascript\n${code}\n${FENCE}`, new Set(['main.js']), { path: 'main.js', content: current });
  assert.equal(blocks[0].path, 'main.js');
});

test('fencedToBlocks leaves short inline examples in the explanation', () => {
  const { blocks, rest } = fencedToBlocks(`Use ${FENCE}js\nx++\n${FENCE} to add one.`, new Set());
  assert.equal(blocks.length, 0);
  assert.match(rest, /x\+\+/);
});
