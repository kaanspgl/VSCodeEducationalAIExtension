/**
 * Run-based checks: does a program's real output match an answer choice or a challenge's expected result?
 * No editor dependencies, so the VS Code extension and the web platform share them.
 */

/**
 * Does `output` show the same result as `expected` (what the challenge's own solution prints)? Labels may be
 * worded differently, or dropped ("2550" for "The sum ... is: 2550"); what must match are the numbers that
 * changed from `before` (e.g. 5050 -> 2550). Extra output is not the same result: the right number inside a
 * running total printed on every pass of the loop does not count. So it is done only when the output has the
 * changed numbers, no numbers the solution doesn't print, and as many non-empty lines as the solution.
 * Returns false when a changed number is missing, or when there are both extra numbers and a different number
 * of lines. Returns undefined when the run can't decide (then the model decides): no numbers changed, or the
 * right numbers in a different shape (an extra number on the same lines, or lines split, added or dropped
 * without new numbers).
 */
export function sameResult(output: string, expected: string, before: string): boolean | undefined {
  if (output.trim() === expected.trim()) return true;
  if (output.trim() === before.trim()) return false;
  const tok = (x: string) => x.toLowerCase().replace(/["'`[\](),:;]|\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
  const nums = (x: string) => tok(x).filter(t => /^-?\d+(\.\d+)?$/.test(t));
  const lines = (x: string) => x.split('\n').filter(l => l.trim()).length;
  const expNums = nums(expected);
  const changed = withoutAll(expNums, nums(before));
  if (!changed.length) return undefined;
  const out = nums(output);
  if (withoutAll(changed, out).length) return false;
  const extra = withoutAll(out, expNums).length > 0;
  const sameLines = lines(output) === lines(expected);
  if (!extra) return sameLines ? true : undefined;
  return sameLines ? undefined : false;
}

/** `xs` with one occurrence of each item of `remove` taken out (multiset difference). */
function withoutAll(xs: string[], remove: string[]): string[] {
  const left = new Map<string, number>();
  remove.forEach(r => left.set(r, (left.get(r) ?? 0) + 1));
  return xs.filter(x => { const k = left.get(x) ?? 0; if (k > 0) { left.set(x, k - 1); return false; } return true; });
}

/**
 * Which answer choices describe the real output of a "what if" change. A choice matches if it contains the
 * whole output, or (outputs usually carry fixed labels like "The total is:") if it names exactly the part
 * that differs from the current output, e.g. "4950" when the output goes from "...is: 5050" to "...is: 4950".
 * When the output does not change, choices saying it stays the same (or naming the current value) match.
 */
export function matchChoices(choices: string[], actual: string, current?: string): number[] {
  const whole = choices.map((c, i) => (containsTokens(c, actual) ? i : -1)).filter(i => i >= 0);
  if (whole.length || current === undefined) return whole;
  const tok = (x: string) => x.toLowerCase().replace(/["'`[\](),:;]|\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
  const isNum = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
  const act = tok(actual);
  const cur = tok(current);
  const curCount = new Map<string, number>();
  cur.forEach(t => curCount.set(t, (curCount.get(t) ?? 0) + 1));
  const changed = act.filter(t => { const n = curCount.get(t) ?? 0; if (n > 0) { curCount.set(t, n - 1); return false; } return true; });
  const actNums = new Set(act.filter(isNum));
  const curNums = new Set(cur.filter(isNum));
  const lastNum = [...act].reverse().find(isNum);
  const numsOf = (c: string) => tok(c).filter(isNum);
  const matches = choices.map((c, i) => {
    const ct = tok(c);
    const nums = numsOf(c);
    // Numbers must come from the real output (or name the current value, as in "4950 instead of 5050").
    const noWrongNumbers = nums.every(n => actNums.has(n) || curNums.has(n));
    if (!changed.length) {
      // Output unchanged: "same as before", or the result value (the last number, not a label's numbers).
      return /\b(same|unchanged|no change|still)\b/i.test(c) || (lastNum !== undefined && ct.includes(lastNum) && noWrongNumbers) ? i : -1;
    }
    return changed.every(t => ct.includes(t)) && noWrongNumbers ? i : -1;
  }).filter(i => i >= 0);
  if (!matches.length) return qualitativeMatches(choices, actual, current);
  if (matches.length < 2) return matches;
  // Several fit: keep the one(s) that account for the most of the real output's numbers.
  const score = (i: number) => numsOf(choices[i]).reduce((sc, n) => sc + (actNums.has(n) ? 1 : -1), 0);
  const best = Math.max(...matches.map(score));
  return matches.filter(i => score(i) === best);
}

/** Choices that describe the result in words ("a smaller number", "the same result") against the real change. */
function qualitativeMatches(choices: string[], actual: string, current: string): number[] {
  const lastNum = (s: string) => { const m = s.match(/-?\d+(\.\d+)?/g); return m ? Number(m[m.length - 1]) : undefined; };
  const a = lastNum(actual);
  const c = lastNum(current);
  const relation = actual.trim() === current.trim() ? 'same'
    : a !== undefined && c !== undefined ? (a < c ? 'smaller' : a > c ? 'larger' : 'same') : undefined;
  if (!relation) return [];
  const kinds: Record<string, RegExp> = {
    same: /\b(same|unchanged|no change|not change|still)\b/i,
    smaller: /\b(smaller|less|lower|decreases?d?|fewer|reduced?)\b/i,
    larger: /\b(larger|bigger|greater|higher|increases?d?)\b/i,
  };
  return choices.map((ch, i) => {
    const said = Object.keys(kinds).filter(k => kinds[k].test(ch));
    return said.length === 1 && said[0] === relation ? i : -1;
  }).filter(i => i >= 0);
}

/** True if the words of `needle` (e.g. a program's output) appear, in order and adjacent, in `text`. */
function containsTokens(text: string, needle: string): boolean {
  const tok = (x: string) => x.toLowerCase().replace(/["'`[\](),.:;]/g, ' ').split(/\s+/).filter(Boolean);
  const t = tok(text);
  const n = tok(needle);
  if (!n.length) return false;
  for (let i = 0; i + n.length <= t.length; i++) {
    if (n.every((w, k) => t[i + k] === w)) return true;
  }
  return false;
}

/**
 * True when a change only rewords or trims the output: the final result (last number) is the same and the
 * numbers left are earlier ones, in the same order (e.g. "The sum of 0 to 100 is: 5050" -> "5050"). A Modify
 * challenge like that practises no logic, so it is rejected. Real changes add, change or reorder numbers
 * ("print each number", "add only evens", "reverse the sort order"). False when the output has no numbers.
 */
export function onlyWordingChanged(before: string, after: string): boolean {
  const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g) ?? [];
  const a = nums(before);
  const b = nums(after);
  if (!a.length || !b.length || before.trim() === after.trim()) return false;
  if (a[a.length - 1] !== b[b.length - 1]) return false;
  let i = 0;
  return b.every(n => { while (i < a.length && a[i] !== n) i++; return i++ < a.length; });
}

/**
 * Does an answer choice state a result the real run rules out? It does when it names a number that is in none
 * of: the changed program's real output, the current output, or `context` (the code, the change, the question
 * and the request, where numbers like a range's end or a divisor come from, as in "counts the numbers between 1
 * and 100 that are NOT divisible by 7"). A number the choice says is printed ("would print 0", "the total is
 * 15") must be in the real output, wherever else it appears. A choice that describes the result in words, with
 * no such number, can't be ruled out by the run.
 */
export function contradictsOutput(choice: string, actual: string, current: string | undefined, context: string): boolean {
  const nums = (s: string) => new Set(s.match(/-?\d+(\.\d+)?/g) ?? []);
  const out = nums(actual);
  const claimed = [...choice.matchAll(/\b(?:prints?|printed|outputs?|shows?|displays?|returns?|gives?|would be|is now|becomes?|results? in|(?:total|count|sum|answer|result) (?:is|of|would be))\s*:?\s*(-?\d+(?:\.\d+)?)/gi)].map(m => m[1]);
  if (claimed.some(n => !out.has(n))) return true;
  const allowed = new Set([...out, ...nums(current ?? ''), ...nums(context)]);
  return [...nums(choice)].some(n => !allowed.has(n));
}

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;

/**
 * A prediction that never says what is printed: the output has numbers, and the guess names none of them
 * ("the sum of all the numbers from 1 to 50" for 1275, "the total"). That describes what the program works
 * out, not what it shows, so it can't count as correct however the model judges it. A wrong number ("1250")
 * is a real prediction and is left to the model; so are numbers in words ("fourteen").
 */
export function namesNoOutputNumber(prediction: string, actual: string): boolean {
  const nums = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(\.\d+)?/g) ?? [];
  const out = new Set(nums(actual));
  if (!out.size || nums(prediction).some(n => out.has(n))) return false;
  return !NUMBER_WORDS.test(prediction);
}

/**
 * A calculation written in a prediction instead of the number it gives: "1 + 2 + … + 50", "50 × 51 ÷ 2",
 * "(3 + 4) * 2". Working out 1275 by hand proves nothing about the code, but writing 1 + 2 + … + 50 says exactly
 * where the loop starts, where it stops and what it does each time round, and it is worked out here, not by
 * the model, so every participant is held to the same rule. Words ("the sum of 1 to 50") are not a calculation.
 */
export type Calculation = { text: string; value: number; start: number; end: number };

type Tok = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' } | { t: '(' } | { t: ')' } | { t: '...' };
const OPS: Record<string, '+' | '-' | '*' | '/'> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', 'x': '*', 'X': '*', '·': '*', '/': '/', '÷': '/' };
/** Most terms an ellipsis may stand for. */
const MAX_TERMS = 100_000;

function tokenize(s: string): Tok[] | undefined {
  const toks: Tok[] = [];
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    const ws = /^[ \t]+/.exec(rest);
    const num = /^\d+(?:\.\d+)?/.exec(rest);
    const dots = /^(?:\.{2,}|…)/.exec(rest);
    if (ws) i += ws[0].length;
    else if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; }
    else if (dots) { toks.push({ t: '...' }); i += dots[0].length; }
    else if (rest[0] in OPS) { toks.push({ t: 'op', v: OPS[rest[0]] }); i++; }
    else if (rest[0] === '(' || rest[0] === ')') { toks.push({ t: rest[0] }); i++; }
    else return undefined;
  }
  return toks;
}

/** Writes out what each "…" stands for: 1 + 2 + … + 5 is 1 + 2 + 3 + 4 + 5, and 2 + 4 + … + 10 steps by 2. */
function expandEllipses(toks: Tok[]): Tok[] | undefined {
  const i = toks.findIndex((t) => t.t === '...');
  if (i < 0) return toks;
  const op = toks[i - 1], op2 = toks[i + 1], last = toks[i + 2];
  if (op?.t !== 'op' || op2?.t !== 'op' || op.v !== op2.v || (op.v !== '+' && op.v !== '*') || last?.t !== 'num') return undefined;
  // The terms written before the "…", joined by the same operator: they give the first term and the step.
  const pre: number[] = [];
  let first = i - 2;
  for (let j = i - 2; toks[j]?.t === 'num'; j -= 2) {
    pre.unshift((toks[j] as { v: number }).v);
    first = j;
    const before = toks[j - 1];
    if (before?.t !== 'op' || before.v !== op.v) break;
  }
  if (!pre.length || ![...pre, last.v].every(Number.isInteger)) return undefined;
  const step = pre.length > 1 ? pre[1] - pre[0] : last.v >= pre[0] ? 1 : -1;
  if (!step || pre.some((v, k) => k > 0 && v - pre[k - 1] !== step)) return undefined;
  const more = (last.v - pre[pre.length - 1]) / step;
  if (!Number.isInteger(more) || more < 0 || pre.length + more > MAX_TERMS) return undefined;
  const terms = [...pre];
  for (let k = 1; k <= more; k++) terms.push(pre[pre.length - 1] + k * step);
  const written: Tok[] = terms.flatMap((v, k) => (k ? [op, { t: 'num' as const, v }] : [{ t: 'num' as const, v }]));
  return expandEllipses([...toks.slice(0, first), ...written, ...toks.slice(i + 3)]);
}

function evaluate(toks: Tok[]): number | undefined {
  let i = 0;
  const isOp = (t: Tok | undefined, ...ops: string[]): t is Extract<Tok, { t: 'op' }> => t?.t === 'op' && ops.includes(t.v);
  const factor = (): number => {
    const t = toks[i++];
    if (t?.t === 'num') return t.v;
    if (isOp(t, '-')) return -factor();
    if (t?.t === '(') {
      const v = sum();
      if (toks[i++]?.t !== ')') throw new Error('bracket');
      return v;
    }
    throw new Error('operand');
  };
  const product = (): number => {
    let v = factor();
    for (let t = toks[i]; isOp(t, '*', '/'); t = toks[i]) { i++; v = t.v === '*' ? v * factor() : v / factor(); }
    return v;
  };
  const sum = (): number => {
    let v = product();
    for (let t = toks[i]; isOp(t, '+', '-'); t = toks[i]) { i++; v = t.v === '+' ? v + product() : v - product(); }
    return v;
  };
  try {
    const v = sum();
    return i === toks.length && Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A number as a program would print it: whole numbers without ".0", others to at most six decimals. */
export function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
}

/**
 * Every calculation in a text, with what it comes to. A calculation has at least one operator between two
 * numbers; "1-50" and "1 - 50" read as a range, not a subtraction, and an open-ended "1 + 2 + …" is not one.
 */
export function findCalculations(text: string): Calculation[] {
  const out: Calculation[] = [];
  for (const m of text.matchAll(/[(\d][\d \t+\-−*×xX·/÷().…]*/g)) {
    let span = m[0];
    let start = m.index ?? 0;
    // A sentence's full stop and a dangling operator or bracket aren't part of it.
    span = span.replace(/[ \t]+$/, '');
    if (/(?:\.{2,}|…)$/.test(span)) continue;
    span = span.replace(/(?<!\.)\.$/, '').replace(/[ \t+\-−*×xX·/÷(]+$/, '');
    // Brackets around the calculation that it doesn't close, as in "(it prints 1 + 2)".
    const opens = () => (span.match(/\(/g) ?? []).length - (span.match(/\)/g) ?? []).length;
    while (opens() < 0 && span.endsWith(')')) span = span.slice(0, -1).replace(/[ \t]+$/, '');
    while (opens() > 0 && span.startsWith('(')) { span = span.slice(1).replace(/^[ \t]+/, ''); start = text.indexOf(span, start); }
    if (opens() !== 0 || /^\d+[ \t]*[-−–][ \t]*\d+$/.test(span)) continue;
    const toks = tokenize(span);
    const binary = toks?.some((t, k) => t.t === 'op' && (toks[k - 1]?.t === 'num' || toks[k - 1]?.t === ')'));
    if (!toks || !binary) continue;
    const expanded = expandEllipses(toks);
    const value = expanded && evaluate(expanded);
    if (value !== undefined) out.push({ text: span, value, start, end: start + span.length });
  }
  return out;
}

/**
 * The prediction with each calculation replaced by what it comes to ("is: 0 + 1 + … + 100" becomes "is: 5050"),
 * the calculations, and whether one of them gives a printed number that the prediction doesn't write out
 * itself: then the value was given as a calculation. Undefined when there are no calculations.
 */
export function workOutPrediction(prediction: string, actual: string):
  { worked: string; calculations: { text: string; value: string }[]; givesOutput: boolean } | undefined {
  const calcs = findCalculations(prediction);
  if (!calcs.length) return undefined;
  let worked = prediction;
  for (const c of [...calcs].reverse()) worked = worked.slice(0, c.start) + formatNumber(c.value) + worked.slice(c.end);
  const nums = (s: string) => new Set((s.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) => formatNumber(Number(n))));
  const printed = nums(actual);
  const written = nums(prediction);
  const givesOutput = calcs.some((c) => printed.has(formatNumber(c.value)) && !written.has(formatNumber(c.value)));
  return { worked, calculations: calcs.map((c) => ({ text: c.text, value: formatNumber(c.value) })), givesOutput };
}

/**
 * A question about the code rather than a request to change it: "why is it 51 and not 50", "what does range do?",
 * "how does the loop stop". Asking for a change, even as a question ("can you make it go to 100?"), is not one.
 */
export function isPlainQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  const asks = /\?\s*$/.test(t) ||
    /^(why|what|what's|whats|how come|how does|how do|how is|how are|how many|when|where|which|who|explain|is|are|does|do|did|can you explain|could you explain|i don'?t (get|understand)|i was asking)\b/.test(t);
  // "why does it use % 7" is a question; "can you make it…" and "how do I make it…" ask for a change.
  return asks && !isChangeRequest(t) && !/\bhow (do|can|could|would|should) (i|we)\b/.test(t);
}

/**
 * Are `quote` (words the model says the student wrote) really the student's? True when the quote is in `said`
 * (everything the student wrote), ignoring case, spacing and punctuation, or when nearly all of its words are
 * (a model often trims or slightly rewords what it copies). An empty quote is not evidence.
 */
export function saidByStudent(quote: string, said: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const q = words(quote);
  if (!q.length) return false;
  const s = words(said);
  if (` ${s.join(' ')} `.includes(` ${q.join(' ')} `)) return true;
  const have = new Set(s);
  const content = q.filter(w => w.length > 2);
  if (!content.length) return false;
  return content.filter(w => have.has(w)).length / content.length >= 0.75;
}

const IDEA_STOPWORDS = new Set(['the', 'and', 'then', 'that', 'this', 'them', 'they', 'with', 'from', 'each', 'every', 'one', 'all', 'its', 'are', 'for', 'into', 'onto', 'when', 'whenever', 'end', 'through', 'way', 'also', 'such', 'like', 'once', 'any', 'some', 'can', 'will', 'should', 'would', 'your', 'you', 'out', 'up', 'down', 'over', 'new']);

/**
 * Does what the student wrote contain every content word of a key idea (small words and filler left out, plurals
 * and endings ignored)? A safety net for the model's evidence: "adds the numbers from 1 to 50" contains all of "go
 * through the numbers from 1 to 50". It is strict on purpose, so a task typed out ("adds up all the whole numbers
 * from 1 to 50 and prints the total") does not count as explaining "add each number to a running total".
 */
export function wordsCoverIdea(idea: string, said: string): boolean {
  const stem = (w: string) => w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(stem);
  const need = words(idea).filter(w => (/^\d+$/.test(w) || w.length > 2) && !IDEA_STOPWORDS.has(w));
  if (!need.length) return false;
  const have = new Set(words(said));
  return need.every(w => have.has(w));
}

/**
 * Plainly asks for the code to be changed: starts with a change verb ("make it go to 100", "change 7 to 3"), or
 * asks someone to do one ("can you add a print", "I want it to count to 100"). A statement about the code ("so it
 * keeps a running total and adds each number") is not one, even though it uses "add".
 */
export function isChangeRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(please\s+|now\s+|ok(ay)?,?\s+|and\s+)?(make|change|add|write|fix|create|build|update|modify|remove|delete|replace|rewrite|turn|use|put|let|have it|get it)\b/.test(t) ||
    /\b(can|could|would|will) you\s+(please\s+)?(make|change|add|write|fix|create|build|update|modify|remove|delete|replace|rewrite|turn|use|put|let|have it|get it)\b/.test(t) ||
    /\b(i want|i'd like|i would like) (it|the program|the code|you) to\b/.test(t);
}
