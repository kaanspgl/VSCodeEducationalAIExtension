import * as P from "@core/vibe/prompts";

/**
 * apiProvider "mock": canned, instant replies for every prompt the session uses, so the whole flow can be
 * tried, demoed and tested without a model. It writes a "sum the numbers 0 to 100" program; the run-based
 * checks still run that program for real. Never use it with participants.
 */
export async function mockReply(system: string, prompt: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 150));
  const json = (v: unknown) => JSON.stringify(v);
  const request = /STUDENT (?:REQUEST|MESSAGE):\n([\s\S]*?)(?:\n\n|$)/.exec(prompt)?.[1] ?? prompt;
  const file = numberedFile(prompt);
  const py = /\.py\b|python/i.test(prompt) && !/\.js\b/.test(request);

  if (system === P.ROUTER_SYSTEM) {
    const question = /\?\s*$|^\s*(why|what|how|explain)\b/i.test(request);
    return json({
      intent: question ? "explain" : "build", size: "small", logic: !question, detail: "enough", reply: "",
      prompt_review: question ? undefined : { goal: 2, io: 1, details: 1, tip: "Say what the program should print, e.g. the exact message.", improved: `${request.trim()} Print it as "The sum is: <total>".` },
    });
  }
  if (system === P.IDEA_SYSTEM) {
    const said = (/CONVERSATION SO FAR \(Step 1\):\n([\s\S]*)$/.exec(prompt)?.[1] ?? "").toLowerCase();
    const enough = /print|show|display|output/.test(said);
    return json({
      verdict: enough ? "enough" : "missing", key_ideas: ["go through the numbers", "add them up", "print the total"], covered: enough ? [0, 1, 2] : [0, 1],
      reply: enough ? "You described what goes in, what happens and what comes out." : "What should the program show at the end?",
    });
  }
  if (system === P.STEPS_SYSTEM) return json({ verdict: "ready", issue: "", reply: "Those steps work." });
  if (system === P.PLAN_SYSTEM) return json({ goal: request, steps: [{ title: "The core", detail: "The simplest working version." }, { title: "The rest", detail: "Everything else." }] });
  if (system.startsWith("You are VibeLearner") || system.startsWith("You are an AI coding assistant")) {
    if (/\?\s*$|^\s*(why|what|how|explain)\b/i.test(request) || /WALKTHROUGH:/.test(prompt)) {
      return "Summary: Here's how that part works.\n\nIn plain terms: the loop visits every number from 0 to 100 and adds each one to `total`, so after the loop `total` holds the sum.\n\nConcepts: loops";
    }
    const name = /([\w-]+\.(?:py|js))\b/.exec(request)?.[1] ?? (py ? "sum.py" : "sum.js");
    const dir = /CURRENT PROJECT FOLDER: ([^\s]+)\//.exec(prompt)?.[1];
    const code = py
      ? "# Add up every whole number from 0 to 100\ntotal = 0\nfor i in range(0, 101):\n    total += i\nprint(\"The sum of numbers from 0 to 100 is:\", total)\n"
      : "// Add up every whole number from 0 to 100\nlet total = 0;\nfor (let i = 0; i <= 100; i++) {\n  total += i;\n}\nconsole.log('The sum of numbers from 0 to 100 is: ' + total);\n";
    return `Summary: I wrote a program that adds up the numbers 0 to 100.\n\n<<<<<<< SEARCH ${dir ? dir + "/" : ""}${name}\n=======\n${code}>>>>>>> REPLACE\n\nIn plain terms: a loop goes through every number and adds it to a running total, which is printed at the end.\n\nConcepts: loops, variables`;
  }
  if (system === P.TOUR_SYSTEM) {
    const lines = file.filter((l) => l.text.trim());
    const stops = [];
    for (let i = 0; i < lines.length && stops.length < 4; i += 2) {
      const part = lines.slice(i, i + 2);
      stops.push({ code: part.map((l) => l.text).join("\n"), start: part[0].n, end: part[part.length - 1].n, title: `Part ${stops.length + 1}`, text: `These lines do one step of the program: \`${part[0].text.trim()}\`.` });
    }
    return json({ stops });
  }
  if (system === P.RUN_INPUT_SYSTEM) return json({ stdin: "5" });
  if (system === P.PREDICT_FEEDBACK_SYSTEM) return json({ correct: false, feedback: "Look at where the loop stops: it includes 100." });
  if (system === P.CHANGE_QUIZ_SYSTEM || system === P.PROJECT_QUIZ_SYSTEM) {
    const header = file.find((l) => /<=\s*100|range\(0, 101\)/.test(l.text))?.text;
    const change = header ? { find: header, replace: header.replace("<= 100", "< 100").replace("range(0, 101)", "range(0, 100)") } : undefined;
    return json({ questions: [{
      stem: "What would the program print if the loop stopped before 100 (so 100 is not added)?",
      // The key is deliberately wrong (0): the run-based check should correct it to "4950".
      choices: ["5050, the same as now", "4950", "0", "100"], correct: 0,
      explanation: "The last number is left out, so the total is 100 less.", concept: "loops", change,
    }] });
  }
  if (system === P.CHALLENGE_SYSTEM) {
    const body = file.find((l) => /total \+= i/.test(l.text))?.text;
    const indent = body ? /^\s*/.exec(body)![0] : "";
    const solution = body ? { find: body, replace: py ? `${indent}if i % 2 == 0:\n${indent}    total += i` : `${indent}if (i % 2 === 0) total += i;` } : undefined;
    return json({ challenges: [
      { task: "Change the program so it adds up only the even numbers from 0 to 100.", hint: "Look at the line inside the loop that adds to the total.", criteria: "Only even numbers are added; prints 2550.", solution },
      { task: "Start the total at 1 instead of 0.", hint: "Where does total start?", criteria: "total starts at 1", solution: { find: "total = 0", replace: "total = 1" } },
    ] });
  }
  if (system === P.CHALLENGE_CHECK_SYSTEM) return json({ done: true, feedback: "You changed the loop so it only adds the even numbers." });
  return "{}";
}

function numberedFile(prompt: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  for (const line of prompt.split("\n")) {
    const m = /^\s*(\d+)\| ?(.*)$/.exec(line);
    if (m) out.push({ n: Number(m[1]), text: m[2] });
  }
  // Several numbered blocks (e.g. before/after): keep the last one.
  let start = 0;
  for (let i = 1; i < out.length; i++) if (out[i].n <= out[i - 1].n) start = i;
  return out.slice(start);
}
