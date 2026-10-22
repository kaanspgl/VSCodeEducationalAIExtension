/**
 * Run-based checks: does a program's real output match an answer choice or a challenge's expected result?
 * No editor dependencies, so the VS Code extension and the web platform share them.
 */

/**
 * Does `output` show the same result as `expected` (what the challenge's own solution prints)? Labels may be
 * worded differently; what must match are the numbers that changed from `before` (e.g. 5050 -> 2550).
 * Returns undefined when the result has no numbers to compare (then the model decides).
 */
export function sameResult(output: string, expected: string, before: string): boolean | undefined {
  if (output.trim() === expected.trim()) return true;
  if (output.trim() === before.trim()) return false;
  const tok = (x: string) => x.toLowerCase().replace(/["'`[\](),:;]|\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
  const isNum = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
  const beforeNums = new Map<string, number>();
  tok(before).filter(isNum).forEach(n => beforeNums.set(n, (beforeNums.get(n) ?? 0) + 1));
  const changed = tok(expected).filter(isNum).filter(n => { const k = beforeNums.get(n) ?? 0; if (k > 0) { beforeNums.set(n, k - 1); return false; } return true; });
  if (!changed.length) return undefined;
  const out = tok(output);
  return changed.every(n => out.includes(n));
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
