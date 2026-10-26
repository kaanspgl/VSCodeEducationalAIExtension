import path from "node:path";
import { extractJson, stripThinking } from "@core/study/prompts";
import { matchChoices, onlyWordingChanged, sameResult } from "@core/vibe/checks";
import { formatContext, numbered, type ContextFile, type Selection } from "@core/vibe/contextFormat";
import { applyBlocks, blocksToText, fencedToBlocks, locateLines, parseBlocks, type EditBlock } from "@core/vibe/edits";
import * as P from "@core/vibe/prompts";
import type { EditorView, Level, MsgButton, Snapshot, Stage, StageStatus, VibeChange, VibeMsg, VibeView } from "~/lib/types";
import { DATA_DIR, loadSettings, type Settings } from "./config";
import { callBackend, type ChatMsg } from "./llm";
import { safeName, StudyLogger } from "./logger";
import { runFile, runProgram } from "./runner";
import { Workspace } from "./workspace";

/*
 * Project mode on the web: a port of the VS Code extension's VibeSession (src/vibe/session.ts). The flow, the
 * prompts and the research log are the same; VS Code's editor, files, terminal and decorations are replaced by
 * a per-participant folder on the server and an editor state that the browser renders (EditorView).
 */

// After the code is written: walk through it (before accepting), then predict & run, a question, and a change to make.
const STAGES: Stage[] = ["tour", "predict", "check", "challenge"];
const STAGE_LABEL: Record<Stage, string> = { tour: "Walk through", predict: "Predict & run", check: "Questions", challenge: "Modify" };
const INPUT_RE = /\binput\s*\(|sys\.stdin|readline|process\.stdin|prompt\s*\(/;
/** Where the assistant says it lives, in its system prompt. */
const WHERE = "inside a web-based code editor";

type ProjectContext = {
  /** Text block given to the model: file listing, file contents (numbered), and selection. */
  text: string;
  /** Files whose full text is included. */
  files: string[];
  fileCount: number;
  /** Every project path (project-relative, POSIX). */
  paths: string[];
  active?: string;
  activeContent?: string;
  selection?: Selection;
};

type Proposal = {
  id: string;
  path: string;
  blocks: EditBlock[];
  oldContent: string | undefined;
  newContent: string;
  request: string;
  concepts: string[];
  card: VibeChange;
  planStep?: number;
  planAll?: boolean;
  /** Part of structured vibe coding: the walkthrough, then predict, question and modify, run on it automatically in guided mode. */
  structured: boolean;
  idea?: string;
  steps?: string;
  viewedDiff: boolean;
  toured: boolean;
  learn: Record<Stage, StageStatus>;
  challenge?: { task: string; hint: string; criteria: string; baseline: string; msgId: number; viaAi: boolean; open: boolean; before?: string; expected?: string };
  nextPrompted?: boolean;
};

type Plan = {
  goal: string;
  steps: { title: string; detail: string; status: "todo" | "doing" | "done" }[];
  request: string;
};

type ActOpts = { planStep?: number; planAll?: boolean; structured?: boolean };

/** Before any code is written: explain the idea (and, with requireSteps, write the steps). */
type Gate = {
  request: string;
  opts: ActOpts;
  step: 1 | 2;
  rounds: number;
  turns: { role: "student" | "tutor"; text: string }[];
  ideaParts: string[];
  idea: string;
  steps: string;
  keyIdeas: string[];
  scaffolded: { idea: boolean; steps: boolean };
  stepsNote?: string;
  msgIds: number[];
};

type Edit = { find?: string; replace?: string };
type Mcq = { stem: string; choices: string[]; correct: number; explanation: string; concept?: string; change?: Edit };
type QuizState = { kind: "change" | "project"; items: Mcq[]; index: number; right: number; changeId?: string; fallbackConcepts: string[] };
type Awaiting =
  | { kind: "gate" }
  | { kind: "predict"; id: string; truth: string; stdin: string; msgId: number };
type Tour = {
  id: string;
  stops: { start: number; end: number; title: string; text: string }[];
  index: number;
  pending: boolean;
};
type EditorState = {
  mode: EditorView["mode"];
  path?: string;
  content?: string;
  version: number;
  readOnly: boolean;
  highlight?: { start: number; end: number };
  diff?: { title: string; original: string; modified: string };
  selection?: { path: string; start: number; end: number };
};

export class VibeSession {
  private view: VibeView;
  private msgSeq = 0;
  private changeSeq = 0;

  private cfg: Settings = loadSettings();
  private ws!: Workspace;
  private files: string[] = [];
  private ed: EditorState = { mode: "none", version: 0, readOnly: false };
  private readonly logger = new StudyLogger();

  private level: Level = "guided";
  private clarify = true;
  private maxClarifications = 2;
  private perChange = 1;
  private projectQuizCount = 3;
  private maxChars = 24000;
  private model = "";
  private pythonPath: string | undefined;
  private projectDir: string | undefined;
  private target = "auto";
  private lastRequest: { text: string; opts: ActOpts; student?: { idea?: string; steps?: string } } | undefined;
  private maxRoundsPerStep = 3;
  private allowSkipSteps = true;
  /** Optional "write every step before the code" step (off by default: the code comes right after the idea). */
  private requireSteps = false;
  private gate: Gate | undefined;
  /** The structured change the 1-2-3 bar follows; cleared when a new structured request starts (not by questions along the way). */
  private currentStructured: string | undefined;

  private history: ChatMsg[] = [];
  private clarRound = 0;
  private proposals = new Map<string, Proposal>();
  private concepts = new Map<string, { seen: number; right: number; total: number }>();
  private quiz: QuizState | undefined;
  private tour: Tour | undefined;
  private plan: Plan | undefined;
  private awaiting: Awaiting | undefined;
  private askedQuiz: string[] = [];
  private errors: { path: string; err: string }[] = [];
  private stats = { prompts: [] as number[], accepted: 0, reviewed: 0, predRight: 0, predTotal: 0, checkRight: 0, checkTotal: 0, chDone: 0, chGiven: 0, gates: 0, gatesUnaided: 0 };

  constructor(
    private readonly id: string,
    private readonly onChange: (s: Snapshot) => void
  ) {
    this.view = {
      kind: "vibe", stage: "setup", level: "guided", logging: false, participant: "", messages: [], busy: false, busyLabel: "",
      inputEnabled: false, placeholder: "", concepts: [], skills: [], ctx: { files: 0, active: "", selection: "" }, target: "auto",
      targets: [], levelLocked: false,
    };
  }

  snapshot(): Snapshot {
    if (this.view.stage === "setup") this.view.level = parseLevel(loadSettings().get<string>("learning.level"));
    return { view: this.view, editor: this.editorView() };
  }

  // ================================================================== setup

  async begin(participant?: string, consent?: boolean, pickedLevel?: string) {
    if (this.view.stage === "chat") return;
    const cfg = (this.cfg = loadSettings());
    this.level = parseLevel(cfg.get<string>("learning.level"));
    this.clarify = cfg.get<boolean>("learning.clarify") ?? true;
    this.maxClarifications = clamp(cfg.get<number>("learning.maxClarifications") ?? 2, 0, 5);
    this.perChange = clamp(cfg.get<number>("learning.questionsPerChange") ?? 1, 1, 3);
    this.projectQuizCount = clamp(cfg.get<number>("learning.projectQuizQuestions") ?? 3, 1, 6);
    this.maxChars = clamp(cfg.get<number>("context.maxChars") ?? 24000, 4000, 200000);
    this.model = cfg.get<string>("model") || "qwen3-coder:30b";
    this.pythonPath = cfg.get<string>("pythonPath") || undefined;
    this.maxRoundsPerStep = clamp(cfg.get<number>("learning.maxRoundsPerStep") ?? 3, 1, 8);
    this.allowSkipSteps = cfg.get<boolean>("learning.allowSkipSteps") ?? true;
    this.requireSteps = cfg.get<boolean>("learning.requireSteps") ?? false;

    const code = (participant ?? "").trim();
    // The Start-screen picker applies only outside research sessions; study conditions come from settings.
    if (!code && pickedLevel) this.level = parseLevel(pickedLevel);
    if (code) {
      this.view.setupError = !consent ? "Tick the consent box to turn on research logging, or clear the participant code."
        : !/^[A-Za-z0-9_-]{2,32}$/.test(code) ? "Participant code must be 2-32 letters, digits, - or _." : undefined;
      if (this.view.setupError) return this.refresh();
      this.logger.enable(code, `vibe:${this.level}`);
      this.view.logging = true;
      this.view.participant = code;
      this.logger.log("vibe_session", undefined, {
        platform: "web", promptVersion: P.VIBE_PROMPT_VERSION, model: this.model, provider: cfg.get("apiProvider"), temperature: cfg.get("temperature"),
        level: this.level, condition: conditionName(this.level), clarify: this.clarify, maxClarifications: this.maxClarifications,
        maxRoundsPerStep: this.maxRoundsPerStep, allowSkipSteps: this.allowSkipSteps, requireSteps: this.requireSteps, questionsPerChange: this.perChange,
        projectQuizQuestions: this.projectQuizCount, contextMaxChars: this.maxChars,
      });
    }
    // A participant keeps their files across visits; anyone else gets a folder for this browser.
    this.ws = new Workspace(path.join(DATA_DIR, "workspaces", code ? `p-${safeName(code)}` : `anon-${safeName(this.id)}`));
    await this.ws.ensure();

    this.view.setupError = undefined;
    this.view.stage = "chat";
    this.view.level = this.level;
    if (this.level === "off") {
      this.say("tutor", "Hi! I can see your whole project. Ask me to build something, change or fix code, or explain how something works.");
    } else if (this.level === "guided") {
      this.say("tutor",
        "Hi! I'm your vibe-coding partner. Tell me what you want to build, change or fix. I can see your whole project, and if you select code first I'll focus on that.\n\n" +
        "For anything that needs real logic, we'll go through three steps:\n" +
        "1. **Explain the idea**: tell me in a sentence or two what the program needs to do.\n" +
        "2. **Walk through the code**: I write it from your idea, then we go through it together before you accept it.\n" +
        "3. **Predict, run & modify**: guess what it prints, run it, answer a question about it, and make a small change yourself.\n\n" +
        "You keep the thinking; I do the typing.");
    } else {
      this.say("tutor",
        "Hi! I'm your vibe-coding partner. Tell me what you want to build, change, fix or understand. I can see your whole project, and if you select code first I'll focus on that.\n\n" +
        "Each change comes with learning tools (predict & run, walk through, questions, modify) that you can use whenever you like.");
    }
    await this.touchNow();
  }

  // ================================================================== chat

  async send(raw: string, target?: string) {
    if (target !== undefined) this.setTarget(target);
    const text = raw.trim();
    if (!text || this.view.busy || this.view.stage !== "chat" || this.quiz) return;

    if (this.awaiting?.kind === "predict") return this.guard(() => this.handlePrediction(text));
    if (this.awaiting?.kind === "gate") return this.guard(() => this.handleGate(text));

    const snapshot = { msgs: this.view.messages.length, hist: this.history.length, round: this.clarRound };
    this.setBusy(true, "Reading your project…");
    let ctx: ProjectContext;
    try {
      ctx = await this.buildContext();
      // A question during a walkthrough is about the code being walked through, which may not be accepted yet.
      if (this.tour) ctx = { ...ctx, text: ctx.text + this.tourNote() };
    } catch (err: any) {
      this.setBusy(false);
      this.say("system", `⚠️ Couldn't read the project: ${err?.message || err}`);
      return this.refresh();
    }
    const selNote = ctx.selection ? `\n\n_(about ${ctx.selection.path}, lines ${ctx.selection.startLine}–${ctx.selection.endLine})_` : "";
    const studentMsg = this.say("student", text + selNote);
    this.logger.log("vibe_request", undefined, {
      text, active: ctx.active, selection: ctx.selection && { path: ctx.selection.path, start: ctx.selection.startLine, end: ctx.selection.endLine },
      files: ctx.fileCount, clarRound: this.clarRound, inTour: !!this.tour,
    });

    try {
      if (this.level !== "off") {
        this.setBusy(true, "Thinking…");
        const listing = this.listing(ctx);
        const route = await this.askJson<{ intent: string; size?: string; logic?: boolean; detail: string; reply?: string; prompt_review?: any }>(
          P.ROUTER_SYSTEM, P.routerPrompt(listing, text, this.clarRound + 1, this.maxClarifications, this.plan ? P.planText(this.plan, undefined, false) : undefined),
          (v) => typeof v.detail === "string", this.recentHistory()
        );
        this.logger.log("vibe_route", undefined, { intent: route?.intent, size: route?.size, logic: route?.logic, detail: route?.detail, reply: route?.reply, promptReview: route?.prompt_review, round: this.clarRound });

        // Prompt coach: feedback on the request as a vibe-coding prompt.
        const pr = route?.prompt_review;
        if (pr && ["build", "edit", "debug"].includes(route!.intent) && typeof pr.tip === "string" && pr.tip.trim()) {
          const score = [pr.goal, pr.io, pr.details].reduce((a: number, n: any) => a + clamp(Number(n) || 0, 0, 2), 0);
          studentMsg.tip = { text: stripThinking(pr.tip), improved: pr.improved ? stripThinking(String(pr.improved)) : undefined, score };
          this.stats.prompts.push(score);
        }

        if (this.clarify && this.clarRound < this.maxClarifications && route && route.detail !== "enough" && route.reply?.trim()) {
          const reply = stripThinking(route.reply);
          this.clarRound++;
          this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
          this.setBusy(false);
          this.say("tutor", reply);
          return this.refresh();
        }
        this.clarRound = 0;

        if (route?.intent === "build" && route.size === "large") {
          const planned = await this.makePlan(text, ctx);
          if (planned) return this.refresh();
        }
        // Structured vibe coding: requests that need programming logic start with Step 1 (explain the idea).
        const needsLogic = route ? ["build", "edit", "debug"].includes(route.intent) && route.logic !== false : false;
        if (this.level === "guided" && needsLogic) {
          await this.startGate(text, { structured: true });
          return this.refresh();
        }
      }
      this.clarRound = 0;
      await this.act(text, ctx, {});
    } catch (err: any) {
      this.view.messages.length = snapshot.msgs;
      this.history.length = snapshot.hist;
      this.clarRound = snapshot.round;
      this.view.draft = text;
      this.setBusy(false);
      this.logger.log("vibe_error", undefined, { message: String(err?.message || err) });
      this.say("system", `⚠️ ${err?.message || err}\n\nYour message was not lost — press Send to try again.`);
    }
    this.refresh();
  }

  private listing(ctx: ProjectContext): string {
    return ctx.text.split("\n\nFILE CONTENTS")[0] +
      (ctx.selection ? `\n\nSTUDENT SELECTION (${ctx.selection.path} lines ${ctx.selection.startLine}-${ctx.selection.endLine}):\n${ctx.selection.text}` : "");
  }

  private async act(request: string, ctx: ProjectContext, opts: ActOpts, student?: { idea?: string; steps?: string }) {
    this.lastRequest = { text: request, opts, student };
    this.setBusy(true, opts.planStep !== undefined ? `Building step ${opts.planStep + 1}…` : "Working on it…");
    const pText = this.plan && opts.planStep !== undefined ? P.planText(this.plan, opts.planStep, !!opts.planAll) : undefined;
    const res = await callBackend({
      model: this.model, system: P.actionSystem(this.level, WHERE),
      prompt: P.actionPrompt(ctx.text, [request, P.targetInstruction(this.target, this.projectDir)].filter(Boolean).join("\n\n"), pText, student?.idea, student?.steps),
      history: this.recentHistory(), settings: this.cfg,
    });
    this.setBusy(false);

    let { blocks, rest } = parseBlocks(stripThinking(res.text));
    let usedFallback = false;
    if (!blocks.length) {
      // The model answered with plain fenced code instead of edit blocks: turn it into reviewable changes.
      let active = ctx.active && ctx.activeContent !== undefined ? { path: ctx.active, content: ctx.activeContent } : undefined;
      if (this.target === "new") active = undefined;
      else if (this.target !== "auto") active = { path: this.target, content: (await this.ws.read(this.target)) ?? "" };
      const fb = fencedToBlocks(rest, new Set(ctx.paths), active, this.projectDir);
      if (fb.blocks.length) {
        blocks = fb.blocks;
        rest = fb.rest;
        usedFallback = true;
      }
    }
    const split = P.splitConcepts(rest);
    const shown = split.text;
    const concepts = this.level === "off" ? [] : split.concepts;
    this.history.push({ role: "user", content: request }, { role: "assistant", content: shown.slice(0, 1500) });

    blocks = await this.fixPaths(blocks, ctx);
    blocks = await this.repairIfNeeded(blocks, request);
    const cards = await this.makeProposals(blocks, request, concepts, opts, student);
    if (!blocks.length) concepts.forEach((c) => this.bumpSeen(c));

    this.logger.log("vibe_reply", undefined, {
      text: shown, concepts, blocks: blocks.length, fencedFallback: usedFallback, planStep: opts.planStep, raw: res.text.slice(0, 4000),
      changes: cards.map((c) => ({ id: c.id, path: c.path, status: c.status, added: c.added, removed: c.removed, isNew: c.isNew })),
    }, res.ms);

    const hint = cards.some((c) => c.status === "pending") && this.level === "guided" && opts.structured
      ? "\n\n" + (this.requireSteps
        ? "**Step 3: Read the code.** I wrote it from your steps. Let's walk through it, then you can accept it and we'll predict, run and modify it."
        : "**Step 2: Walk through the code.** I wrote it from your idea. Let's go through it together before you accept it.")
      : "";
    this.view.messages.push({
      id: ++this.msgSeq, role: "tutor",
      text: (shown || (blocks.length ? "Here are the changes:" : "(no reply)")) + hint,
      changes: cards.length ? cards : undefined,
    });
    const first = cards.find((c) => c.status === "pending");
    if (first && this.level === "guided" && opts.structured) await this.startStage(first.id, "tour");
    if (cards.some((c) => c.status === "failed")) {
      this.say("system", "Some edits still didn't match your current code, even after a second try.", [
        { label: "Try again", cmd: "retryLast" },
        { label: "Put it in a new file instead", cmd: "retryNew", primary: true },
      ]);
    }
    if (opts.planStep !== undefined && this.plan && !cards.some((c) => c.status === "pending")) {
      this.plan.steps.forEach((s) => { if (s.status === "doing") s.status = "todo"; });
    }
  }

  private async makeProposals(blocks: EditBlock[], request: string, concepts: string[], opts: ActOpts, student?: { idea?: string; steps?: string }): Promise<VibeChange[]> {
    if (!blocks.length) return [];
    const byPath = new Map<string, EditBlock[]>();
    for (const b of blocks) byPath.set(b.path, [...(byPath.get(b.path) ?? []), b]);

    const cards: VibeChange[] = [];
    for (const [p, bs] of byPath) {
      const old = await this.ws.read(p);
      const r = applyBlocks(old, bs);
      const card: VibeChange = {
        id: `c${++this.changeSeq}`, path: p, isNew: old === undefined, added: r.added, removed: r.removed,
        status: r.applied ? "pending" : "failed",
        note: r.failed ? `${r.failed} of ${bs.length} edit${bs.length > 1 ? "s" : ""} didn't match the current code` : undefined,
      };
      cards.push(card);
      if (r.applied) {
        if (opts.structured && !this.currentStructured) this.currentStructured = card.id;
        this.proposals.set(card.id, {
          id: card.id, path: p, blocks: bs, oldContent: old, newContent: r.content, request, concepts, card,
          planStep: opts.planStep, planAll: opts.planAll, structured: !!opts.structured, idea: student?.idea, steps: student?.steps,
          viewedDiff: false, toured: false,
          learn: { tour: "todo", predict: /\.(py|js)$/.test(p) ? "todo" : "na", check: "todo", challenge: "todo" },
        });
      }
    }
    return cards;
  }

  // ================================================================== plan + think first

  private async makePlan(request: string, ctx: ProjectContext): Promise<boolean> {
    this.setBusy(true, "Planning the steps…");
    const res = await this.askJson<{ goal: string; steps: { title: string; detail: string }[] }>(
      P.PLAN_SYSTEM, P.planPrompt(this.listing(ctx), request),
      (v) => Array.isArray(v.steps) && v.steps.length >= 2 && v.steps.every((s) => typeof s?.title === "string"), this.recentHistory()
    );
    this.setBusy(false);
    if (!res) return false;

    const steps = res.steps.slice(0, 5).map((s) => ({ title: stripThinking(s.title), detail: stripThinking(String(s.detail ?? "")), status: "todo" as const }));
    this.plan = { goal: stripThinking(String(res.goal || request)), steps, request };
    const list = steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.detail}`).join("\n");
    this.history.push({ role: "user", content: request }, { role: "assistant", content: `Plan:\n${list}` });
    this.logger.log("vibe_plan", undefined, { goal: this.plan.goal, steps: steps.map((s) => s.title) });

    const intro = `Let's build this in **${steps.length} small steps**. That's how experienced vibe coders work: build a little, check it runs, then add more.\n\n${list}`;
    const structured = this.requireSteps ? "explain the idea, write the steps, then read the code" : "explain the idea, walk through the code, then predict, run and modify it";
    this.say("tutor", intro + (this.level === "guided" ? `\n\nWe'll do each step the structured way: ${structured}.` : ""), [
      { label: this.level === "guided" ? "Start step 1" : "Build step 1", cmd: "buildNext", primary: true },
      { label: "Do it all at once", cmd: "buildAll" },
    ]);
    return true;
  }

  // ================================================================== explain the idea (and write the steps), before any code

  private async startGate(request: string, opts: ActOpts) {
    // A new structured request: the 1-2-3 bar follows the change it produces.
    this.currentStructured = undefined;
    const g: Gate = {
      request, opts: { ...opts, structured: true }, step: 1, rounds: 0, turns: [{ role: "student", text: request }],
      ideaParts: [request], idea: "", steps: "", keyIdeas: [], scaffolded: { idea: false, steps: false }, msgIds: [],
    };
    this.gate = g;
    this.awaiting = { kind: "gate" };
    this.logger.log("vibe_gate", undefined, { kind: "start", request, planStep: opts.planStep });

    // The request itself may already explain the idea; check it before asking.
    this.setBusy(true, "Thinking…");
    const res = await this.ideaCheck(g);
    this.setBusy(false);
    if (res?.verdict === "enough") {
      this.gateSay(`${this.flowLine()}\n\n✅ **Step 1: Explain the idea.** Your request already covers it. ${stripThinking(res.reply || "")}`);
      return this.afterIdea();
    }
    const question = res?.reply ? stripThinking(res.reply) : "What does the program need to repeat or decide, what does it keep track of, and what does it show at the end?";
    g.turns.push({ role: "tutor", text: question });
    this.gateSay(`${this.flowLine()}\n\n**Step 1: Explain the idea.** In a sentence or two, what does the program need to do? ${question}`);
  }

  private async ideaCheck(g: Gate) {
    const transcript = g.turns.map((t) => `${t.role === "student" ? "STUDENT" : "TUTOR"}: ${t.text}`).join("\n");
    const res = await this.askJson<{ verdict: string; key_ideas?: string[]; covered?: number[]; reply?: string }>(
      P.IDEA_SYSTEM, P.ideaPrompt(g.request, transcript, Math.max(1, g.rounds), this.maxRoundsPerStep, g.keyIdeas.length ? g.keyIdeas : undefined),
      (v) => typeof v.verdict === "string"
    );
    if (res?.key_ideas?.length && !g.keyIdeas.length) g.keyIdeas = res.key_ideas.map(String).slice(0, 4);
    this.logger.log("vibe_gate", undefined, { kind: "idea_check", round: g.rounds, verdict: res?.verdict, keyIdeas: g.keyIdeas, covered: res?.covered, reply: res?.reply });
    return res;
  }

  private async handleGate(text: string) {
    const g = this.gate;
    if (!g) { this.awaiting = undefined; return; }
    this.say("student", text);
    g.rounds++;
    const final = g.rounds >= this.maxRoundsPerStep;

    if (g.step === 1) {
      g.turns.push({ role: "student", text });
      g.ideaParts.push(text);
      this.logger.log("vibe_gate", undefined, { kind: "idea_answer", round: g.rounds, text });
      this.setBusy(true, "Reading your idea…");
      const res = await this.ideaCheck(g);
      this.setBusy(false);
      const reply = res?.reply ? stripThinking(res.reply) : "";
      if (!res || res.verdict === "enough") {
        this.gateSay(`✅ ${reply || "That's the idea."}`);
        return this.afterIdea();
      }
      if (final) {
        // Bounded: explain what is missing and move on, so nobody gets stuck (logged as scaffolded).
        g.scaffolded.idea = true;
        g.ideaParts.push(`(explained by the tutor: ${reply})`);
        this.gateSay(this.requireSteps ? `${reply}\n\nLet's carry that idea into the steps.` : `${reply}\n\nLet's see how the code does it: I'll write it and we'll walk through it together.`);
        return this.afterIdea();
      }
      g.turns.push({ role: "tutor", text: reply });
      this.gateSay(reply);
      return;
    }

    g.steps = text;
    this.logger.log("vibe_gate", undefined, { kind: "steps_answer", round: g.rounds, text });
    this.setBusy(true, "Checking your steps…");
    const res = await this.askJson<{ verdict: string; issue?: string; reply?: string }>(
      P.STEPS_SYSTEM, P.stepsPrompt(g.request, g.idea, text, g.rounds, this.maxRoundsPerStep, g.keyIdeas),
      (v) => typeof v.verdict === "string"
    );
    this.setBusy(false);
    this.logger.log("vibe_gate", undefined, { kind: "steps_check", round: g.rounds, verdict: res?.verdict, issue: res?.issue, reply: res?.reply });
    const reply = res?.reply ? stripThinking(res.reply) : "";
    if (!res || res.verdict === "ready") {
      this.gateSay(`✅ ${reply || "Those steps work."}`);
      return this.finishGate();
    }
    if (final) {
      g.scaffolded.steps = true;
      g.stepsNote = res.issue || reply;
      this.gateSay(`${reply}\n\nI'll write the code from your steps with that fixed, and point out where.`);
      return this.finishGate();
    }
    this.gateSay(reply);
  }

  private toSteps() {
    const g = this.gate!;
    g.step = 2;
    g.rounds = 0;
    g.idea = g.ideaParts.join(" / ");
    this.gateSay(
      "**Step 2: Write the steps.** Describe every step the program takes, in order, in your own words. No code needed. " +
      "Say where values start, what repeats (and exactly where it starts and stops), any decisions, and what it shows at the end.\n\n" +
      '_Example for a different task: "Start a counter at 10. While the counter is 1 or more, show it and take 1 away. Then show Lift off!"_');
  }

  private async finishGate() {
    const g = this.gate!;
    this.gate = undefined;
    this.awaiting = undefined;
    g.msgIds.forEach((id) => this.clearButtons(id));
    this.stats.gates++;
    if (!g.scaffolded.idea && !g.scaffolded.steps) this.stats.gatesUnaided++;
    this.logger.log("vibe_gate", undefined, { kind: "done", request: g.request, idea: g.idea, steps: g.steps, scaffolded: g.scaffolded, keyIdeas: g.keyIdeas });
    const steps = !g.steps ? undefined : g.stepsNote ? `${g.steps}\n(Tutor note: ${g.stepsNote})` : g.steps;
    this.setBusy(true, "Reading your project…");
    await this.act(g.request, await this.buildContext(), g.opts, { idea: g.idea, steps });
  }

  private async skipSteps() {
    const g = this.gate;
    if (!g) return;
    this.gate = undefined;
    this.awaiting = undefined;
    g.msgIds.forEach((id) => this.clearButtons(id));
    this.logger.log("vibe_gate", undefined, { kind: "skipped", step: g.step, rounds: g.rounds, request: g.request });
    this.say("system", "Skipped the steps; writing the code now.");
    this.setBusy(true, "Reading your project…");
    await this.act(g.request, await this.buildContext(), g.opts, g.idea || g.ideaParts.length > 1 ? { idea: g.idea || g.ideaParts.join(" / ") } : undefined);
  }

  /** A tutor message before the code is written; carries the skip button (if allowed) on the latest message only. */
  private gateSay(text: string) {
    const g = this.gate;
    g?.msgIds.forEach((id) => this.clearButtons(id));
    const m = this.say("tutor", text, g && this.allowSkipSteps ? [{ label: "Skip: just write the code", cmd: "skipSteps" }] : undefined);
    g?.msgIds.push(m.id);
  }

  private nextStepIndex(): number | undefined {
    const i = this.plan?.steps.findIndex((s) => s.status !== "done");
    return i === undefined || i < 0 ? undefined : i;
  }

  private async buildStep(k: number, all: boolean) {
    const plan = this.plan;
    if (!plan || k >= plan.steps.length) return;
    const steps = all ? plan.steps.slice(k).filter((s) => s.status !== "done") : [plan.steps[k]];
    steps.forEach((s) => (s.status = "doing"));
    const request = all
      ? `Build all remaining steps of the plan: ${steps.map((s) => s.title).join("; ")}.`
      : `Build step ${k + 1} of the plan: ${plan.steps[k].title} — ${plan.steps[k].detail}`;
    this.view.messages.forEach((m) => { if (m.buttons?.some((b) => b.cmd === "buildNext")) m.buttons = undefined; });
    if (this.level === "guided") return this.startGate(request, { planStep: k, planAll: all });
    this.setBusy(true, "Reading your project…");
    await this.act(request, await this.buildContext(), { planStep: k, planAll: all });
  }

  private hasPendingFor(step: number): boolean {
    return [...this.proposals.values()].some((p) => p.planStep === step && p.card.status === "pending");
  }

  // ================================================================== change actions

  async action(cmd: string, arg?: string) {
    if (this.view.busy || this.view.stage !== "chat") return;
    const a = arg === undefined ? "" : String(arg);
    try {
      switch (cmd) {
        case "viewDiff": await this.viewDiff(a); break;
        case "accept": await this.accept(a); break;
        case "reject": this.reject(a); break;
        case "acceptAll": {
          const ids = [...this.proposals.values()].filter((p) => p.card.status === "pending" && this.msgOf(p.id) === this.msgOf(a)).map((p) => p.id);
          for (const id of ids) await this.accept(id, true);
          if (ids.length) await this.advance(ids[0]);
          break;
        }
        case "stage": {
          const [id, stage] = a.split(":");
          if (STAGES.includes(stage as Stage)) await this.startStage(id, stage as Stage);
          break;
        }
        case "tourNext": await this.tourMove(1); break;
        case "tourPrev": await this.tourMove(-1); break;
        case "tourEnd": await this.endTour(this.tour ? this.tour.index >= this.tour.stops.length - 1 : false); break;
        case "skipPredict": await this.skipPredict(); break;
        case "challengeHint": this.challengeHint(a); break;
        case "challengeCheck": await this.challengeCheck(a); break;
        case "challengeSkip": await this.challengeSkip(a); break;
        case "skipSteps": await this.skipSteps(); break;
        case "buildNext": {
          const k = this.nextStepIndex();
          if (k !== undefined) await this.buildStep(k, false);
          break;
        }
        case "buildAll": {
          const k = this.nextStepIndex();
          if (k !== undefined) await this.buildStep(k, true);
          break;
        }
        case "dropPlan":
          this.logger.log("vibe_plan", undefined, { dropped: true });
          this.plan = undefined;
          break;
        case "quizProject": await this.quizProject(); break;
        case "skipQuiz": await this.endQuiz(true); break;
        case "explainError": await this.explainError(Number(a)); break;
        case "explainSelection": await this.explainSelection(); break;
        case "runFile": await this.runActiveFile(a); break;
        case "setTarget": this.setTarget(a); break;
        case "setLevel": this.setLevel(a); break;
        case "newProject": await this.newProject(a); break;
        case "leaveProject": await this.leaveProject(); break;
        case "retryLast":
        case "retryNew": {
          const last = this.lastRequest;
          if (!last) break;
          this.view.messages.forEach((m) => { if (m.buttons?.some((b) => b.cmd === "retryLast")) m.buttons = undefined; });
          // "Put it in a new file" applies to this retry only; the picker keeps its own choice.
          const prev = this.target;
          if (cmd === "retryNew") this.target = "new";
          this.setBusy(true, "Reading your project…");
          try {
            await this.act(last.text, await this.buildContext(), last.opts, last.student);
          } finally {
            this.target = prev;
          }
          break;
        }
      }
    } catch (err: any) {
      this.setBusy(false);
      this.say("system", `⚠️ ${err?.message || err}`);
    }
    this.refresh();
  }

  private msgOf(changeId: string): number | undefined {
    return this.view.messages.find((m) => m.changes?.some((c) => c.id === changeId))?.id;
  }

  private async viewDiff(id: string) {
    const p = this.proposals.get(id);
    if (!p) return;
    p.viewedDiff = true;
    this.logger.log("vibe_change", undefined, { id, path: p.path, status: "viewed_diff" });
    const current = (await this.ws.read(p.path)) ?? "";
    this.ed = { ...this.ed, mode: "diff", path: p.path, highlight: undefined, diff: { title: `${p.path}: current ↔ proposed`, original: current, modified: p.newContent } };
  }

  private async accept(id: string, batch = false) {
    const p = this.proposals.get(id);
    if (!p || p.card.status !== "pending") return;

    if (await this.ws.isFolder(p.path)) {
      p.card.status = "failed";
      p.card.note = `${p.path} is a folder, not a file. Ask again (or pick a file in "Code goes in").`;
      this.logger.log("vibe_change", undefined, { id, path: p.path, status: "path_is_folder" });
      return;
    }
    const current = await this.ws.read(p.path);
    // Re-apply to what is on disk now, in case the student edited since the proposal.
    let content = p.newContent;
    if (current !== p.oldContent) {
      const r = applyBlocks(current, p.blocks);
      if (!r.applied) {
        p.card.status = "failed";
        p.card.note = "The file changed since this was proposed — ask again.";
        this.logger.log("vibe_change", undefined, { id, path: p.path, status: "stale" });
        return;
      }
      content = r.content;
    }
    if (this.tour?.id === id) await this.endTour(false, true);

    await this.ws.write(p.path, content);
    await this.showFile(p.path);

    p.card.status = "accepted";
    const reviewed = p.toured || p.viewedDiff;
    this.stats.accepted++;
    if (reviewed) this.stats.reviewed++;
    p.concepts.forEach((c) => this.bumpSeen(c));
    for (const other of this.proposals.values()) {
      if (other.challenge?.open && other.path === p.path) other.challenge.viaAi = true;
    }
    if (this.plan && p.planStep !== undefined) {
      const from = p.planStep;
      const to = p.planAll ? this.plan.steps.length - 1 : from;
      for (let i = from; i <= to; i++) this.plan.steps[i].status = "done";
    }
    this.logger.log("vibe_change", undefined, {
      id, path: p.path, status: "accepted", reviewedBeforeAccept: reviewed, toured: p.toured, viewedDiff: p.viewedDiff,
      added: p.card.added, removed: p.card.removed, isNew: p.card.isNew, planStep: p.planStep, content,
    });
    await this.touchNow();
    if (!batch) await this.advance(id);
  }

  private reject(id: string) {
    const p = this.proposals.get(id);
    if (!p || p.card.status !== "pending") return;
    p.card.status = "rejected";
    if (this.tour?.id === id) void this.endTour(false, true);
    if (this.ed.mode !== "file" && this.ed.path === p.path) void this.showFile(p.path);
    if (this.plan && p.planStep !== undefined && !this.hasPendingFor(p.planStep)) {
      this.plan.steps.forEach((s) => { if (s.status === "doing") s.status = "todo"; });
    }
    this.logger.log("vibe_change", undefined, { id, path: p.path, status: "rejected", toured: p.toured, viewedDiff: p.viewedDiff });
  }

  // ================================================================== learning loop

  private async startStage(id: string, stage: Stage) {
    const p = this.proposals.get(id);
    if (!p || this.level === "off" || this.quiz || this.tour || this.awaiting) return;
    if (p.learn[stage] === "na") return;
    if (stage !== "tour" && p.card.status !== "accepted") {
      this.say("system", "Accept the change first, then we can run it and investigate it together.");
      return;
    }
    switch (stage) {
      case "tour": return this.startTour(p);
      case "predict": return this.startPredict(p);
      case "check": return this.startCheck(p);
      case "challenge": return this.startChallenge(p);
    }
  }

  private async markStage(id: string, stage: Stage, status: StageStatus) {
    const p = this.proposals.get(id);
    if (!p) return;
    p.learn[stage] = status;
    this.logger.log("vibe_learn", undefined, { kind: "stage", id, stage, status });
    if (status !== "active") await this.advance(id);
  }

  /** Guided mode: run the walkthrough (before accepting), then predict, question and modify on structured changes. Both modes: offer the next plan step when done. */
  private async advance(id: string) {
    const p = this.proposals.get(id);
    if (!p) return;
    if (this.level === "guided" && p.structured) {
      for (const s of STAGES) {
        const st = p.learn[s];
        if (st === "done" || st === "skipped" || st === "na") continue;
        if (st === "active") return;
        if (s !== "tour" && p.card.status !== "accepted") return;
        return this.startStage(id, s);
      }
    }
    if (p.card.status === "accepted") this.offerNextStep(p);
  }

  private offerNextStep(p: Proposal) {
    if (!this.plan || p.planStep === undefined || p.nextPrompted) return;
    p.nextPrompted = true;
    const k = this.nextStepIndex();
    if (k === undefined) {
      this.say("tutor", `🎉 All ${this.plan.steps.length} steps of the plan are built. Try **Quiz me on my program** in Your progress, or ask for a new feature.`);
      this.logger.log("vibe_plan", undefined, { completed: true });
      return;
    }
    this.say("tutor", `Plan step ${p.planStep + 1} done ✔. Next up: **step ${k + 1}, ${this.plan.steps[k].title}**.`,
      [{ label: this.level === "guided" ? `Start step ${k + 1}` : `Build step ${k + 1}`, cmd: "buildNext", primary: true }]);
  }

  // ---- 1. Walkthrough, shown in the editor (on the proposed code, before it is accepted)
  private async startTour(p: Proposal) {
    const pending = p.card.status === "pending";
    const content = pending ? p.newContent : ((await this.ws.read(p.path)) ?? p.newContent);
    const lines = content.replace(/\r\n/g, "\n").split("\n");

    this.setBusy(true, "Preparing a walkthrough…");
    const res = await this.askJson<{ stops: { code?: string; start: number; end?: number; title: string; text: string }[] }>(
      P.TOUR_SYSTEM, P.tourPrompt(p.path, numbered(lines), changeText(p), p.request, [p.idea, p.steps && `Their steps: ${p.steps}`].filter(Boolean).join("\n") || undefined),
      (v) => Array.isArray(v.stops) && v.stops.length > 0
    );
    this.setBusy(false);
    let relocated = 0;
    const stops = (res?.stops ?? [])
      .map((s) => {
        // Highlight where the quoted code really is; the model's line numbers are only a hint.
        const found = typeof s.code === "string" ? locateLines(lines, s.code, Number(s.start) || undefined) : undefined;
        const hintStart = clamp(Number(s.start) || 1, 1, lines.length);
        const range = found ?? { start: hintStart, end: clamp(Number(s.end ?? s.start) || hintStart, hintStart, lines.length) };
        if (found && (found.start !== Number(s.start) || found.end !== Number(s.end ?? s.start))) relocated++;
        return { ...range, title: stripThinking(String(s.title ?? "")), text: stripThinking(String(s.text ?? "")) };
      })
      .filter((s) => s.text)
      // Top to bottom, so the highlight moves down the file instead of jumping around.
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .slice(0, 8);
    if (!stops.length) {
      this.say("system", "I couldn't prepare a walkthrough for that change.");
      return this.markStage(p.id, "tour", "na");
    }

    this.tour = { id: p.id, stops, index: 0, pending };
    p.learn.tour = "active";
    this.logger.log("vibe_learn", undefined, { kind: "tour_start", id: p.id, stops: stops.length, relocated, pending });
    if (p.structured) this.say("tutor", "🧭 **Walkthrough:** follow the highlighted lines in the editor and press **Next** to move on. Ask me about anything that isn't clear.");
    await this.showTourStop();
  }

  private async showTourStop() {
    const t = this.tour;
    const p = t && this.proposals.get(t.id);
    if (!t || !p) return;
    if (t.pending) this.showProposed(p.path, p.newContent);
    else if (this.ed.mode !== "file" || this.ed.path !== p.path) await this.showFile(p.path);
    const stop = t.stops[t.index];
    this.ed.highlight = { start: stop.start, end: stop.end };
  }

  private async tourMove(delta: number) {
    const t = this.tour;
    if (!t) return;
    t.index = clamp(t.index + delta, 0, t.stops.length - 1);
    await this.showTourStop();
  }

  /** `silent` = ended by Accept/Reject, which handle what happens next themselves. */
  private async endTour(finished: boolean, silent = false) {
    const t = this.tour;
    if (!t) return;
    this.tour = undefined;
    this.ed.highlight = undefined;
    const p = this.proposals.get(t.id);
    if (!p) return;
    const status: StageStatus = finished || t.index > 0 ? "done" : "skipped";
    p.toured = p.toured || status === "done";
    p.learn.tour = status;
    this.logger.log("vibe_learn", undefined, { kind: "tour_end", id: t.id, reachedStop: t.index + 1, of: t.stops.length, status });
    if (silent) return;
    if (p.card.status === "pending") {
      this.say("tutor", "That's the walkthrough. If it makes sense, press **Accept** on the change, or ask me about anything that's unclear first.");
      return;
    }
    await this.advance(p.id);
  }

  // ---- 2. Predict, then run (the program really runs; its output is the ground truth)
  private async startPredict(p: Proposal) {
    const lang = langOf(p.path);
    const file = this.ws.abs(p.path);
    if (!lang || !file) return this.markStage(p.id, "predict", "na");
    const code = (await this.ws.read(p.path)) ?? "";

    this.setBusy(true, "Getting ready to run your program…");
    let stdin = "";
    if (INPUT_RE.test(code)) {
      const r = await this.askJson<{ stdin: string }>(P.RUN_INPUT_SYSTEM, `${p.path}:\n${numbered(code.split("\n"))}`, (v) => typeof v.stdin === "string");
      stdin = (r?.stdin ?? "").replace(/\\n/g, "\n");
      if (stdin && !stdin.endsWith("\n")) stdin += "\n";
    }
    const run = await runFile(lang, file, stdin, this.pythonPath);
    this.setBusy(false);

    if (run.error) {
      this.say("system", `I can't run it here: ${run.error}`);
      return this.markStage(p.id, "predict", "na");
    }
    if (run.timedOut) {
      this.say("system", "Your program didn't finish within a few seconds (it may be waiting for input or looping forever), so I'll skip the prediction.");
      return this.markStage(p.id, "predict", "na");
    }
    const out = run.stdout.replace(/\s+$/, "");
    const err = run.stderr.trim();
    if (!out && err) {
      this.reportCrash(p.path, err);
      return this.markStage(p.id, "predict", "na");
    }
    if (!out) {
      this.say("system", `\`${p.path}\` doesn't print anything when it runs, so there's nothing to predict yet.`);
      return this.markStage(p.id, "predict", "na");
    }
    const truth = out + (err ? `\n[error]\n${err}` : "");
    const inputNote = stdin.trim() ? `It will be given this input:\n\`\`\`\n${stdin.trimEnd()}\n\`\`\`\n` : "";
    const msg = this.say("tutor",
      `🔮 **Predict:** read \`${p.path}\` in the editor. ${inputNote}Before I **run** it, what do you think it will print? Type your best guess. A wrong guess is useful too: it shows us what to look at.`,
      [{ label: "Skip", cmd: "skipPredict" }]);
    this.awaiting = { kind: "predict", id: p.id, truth, stdin, msgId: msg.id };
    p.learn.predict = "active";
    this.logger.log("vibe_learn", undefined, { kind: "predict_start", id: p.id, stdin, actual: truth });
  }

  private async handlePrediction(text: string) {
    const a = this.awaiting;
    if (a?.kind !== "predict") return;
    this.awaiting = undefined;
    this.clearButtons(a.msgId);
    this.say("student", text);
    const p = this.proposals.get(a.id)!;

    let correct = norm(text) === norm(a.truth);
    let feedback = "Spot on — that's exactly what it prints.";
    if (!correct) {
      this.setBusy(true, "Running it and comparing…");
      const code = (await this.ws.read(p.path)) ?? "";
      const r = await this.askJson<{ correct: boolean; feedback: string }>(
        P.PREDICT_FEEDBACK_SYSTEM, P.predictFeedbackPrompt(p.path, numbered(code.split("\n")), a.stdin, a.truth, text),
        (v) => typeof v.correct === "boolean"
      );
      this.setBusy(false);
      correct = !!r?.correct;
      feedback = r?.feedback ? stripThinking(r.feedback) : "Compare your guess with the real output below.";
    }
    this.stats.predTotal++;
    if (correct) this.stats.predRight++;
    this.logger.log("vibe_learn", undefined, { kind: "predict_answer", id: a.id, prediction: text, actual: a.truth, correct });
    this.say("tutor", `${correct ? "✅" : "🔍"} ${feedback}\n\n**What it actually printed:**\n\`\`\`\n${a.truth}\n\`\`\``);
    await this.markStage(a.id, "predict", "done");
  }

  private async skipPredict() {
    const a = this.awaiting;
    if (a?.kind !== "predict") return;
    this.awaiting = undefined;
    this.clearButtons(a.msgId);
    this.say("tutor", `Here's what it prints:\n\`\`\`\n${a.truth}\n\`\`\``);
    await this.markStage(a.id, "predict", "skipped");
  }

  // ---- 3. Check (multiple choice on this change)
  private async startCheck(p: Proposal) {
    const after = (await this.ws.read(p.path)) ?? p.newContent;
    this.setBusy(true, "Preparing a quick check…");
    const res = await this.askJson<{ questions: Mcq[] }>(
      P.CHANGE_QUIZ_SYSTEM,
      P.changeQuizPrompt(p.path, changeText(p), numbered(after.replace(/\r\n/g, "\n").split("\n")).slice(0, 16000), p.request, this.perChange),
      validQuiz
    );
    this.setBusy(false);
    if (!res) {
      this.say("system", "I couldn't build a question for that change.");
      return this.markStage(p.id, "check", "na");
    }
    this.setBusy(true, "Checking the question against your program…");
    const questions = await this.verifyQuestions(p, res.questions.slice(0, this.perChange));
    this.setBusy(false);
    if (!questions.length) {
      this.say("system", "I couldn't write a reliable question for that change, so I've skipped it.");
      return this.markStage(p.id, "check", "na");
    }
    p.learn.check = "active";
    this.startQuiz("change", questions, p.concepts, p.id);
  }

  /**
   * AI answer keys can be wrong. For "what would it print if…" questions the model also sends the changed
   * program; we run it and trust the real output: keep a correct key, fix a wrong one, drop a question none
   * of whose answers match.
   */
  private async verifyQuestions(p: Proposal, qs: Mcq[]): Promise<Mcq[]> {
    const kept: Mcq[] = [];
    const current = qs.some((q) => q.change) ? (await this.runWithEdit(p, undefined)).output : undefined;
    for (const q of qs) {
      if (!q.change) { kept.push(q); continue; }
      const out = await this.runWithEdit(p, q.change);
      const actual = out.output;
      if (actual === undefined || actual.length > 200) {
        this.logger.log("vibe_learn", undefined, { kind: "question_unverified", id: p.id, stem: q.stem, reason: out.reason, change: q.change });
        kept.push(q);
        continue;
      }
      const matches = matchChoices(q.choices, actual, current);
      // Running settles the output, not the reasoning: if several choices fit and the AI's key is one of them, keep it.
      const verdict = matches.includes(q.correct) ? "verified" : matches.length === 1 ? "corrected" : "dropped";
      this.logger.log("vibe_learn", undefined, { kind: "question_check", id: p.id, stem: q.stem, choices: q.choices, change: q.change, verdict, actual, current, aiKey: q.correct, matches });
      if (verdict === "dropped") continue;
      if (verdict === "corrected") {
        q.correct = matches[0];
        q.explanation = `If you make that change and run it, it prints ${actual}.`;
      }
      kept.push(q);
    }
    return kept;
  }

  /** Applies a {find, replace} edit to the change's file (in memory) and runs the result; output = what it printed. */
  private async runWithEdit(p: Proposal, edit: Edit | undefined): Promise<{ output?: string; reason?: string }> {
    const lang = langOf(p.path);
    if (!lang) return { reason: "not runnable" };
    const code = (await this.ws.read(p.path)) ?? p.newContent;
    if (INPUT_RE.test(code)) return { reason: "reads input" };
    let program = code;
    if (edit) {
      if (typeof edit.find !== "string" || typeof edit.replace !== "string" || !edit.find.trim()) return { reason: "no edit" };
      const r = applyBlocks(code, [{ path: p.path, search: edit.find, replace: edit.replace }]);
      if (!r.applied) return { reason: "edit did not match the file" };
      program = r.content;
    }
    const run = await runProgram(lang, program, "", this.pythonPath);
    if (run.error) return { reason: run.error };
    if (run.timedOut) return { reason: "timed out" };
    const output = run.stdout.trim();
    return output ? { output } : { reason: run.stderr.trim() ? "crashed" : "printed nothing" };
  }

  // ---- 4. Your turn (Modify)
  private async startChallenge(p: Proposal) {
    const code = (await this.ws.read(p.path)) ?? p.newContent;
    this.setBusy(true, "Thinking of a challenge for you…");
    // A challenge whose solution prints the same thing teaches nothing visible: check by running it.
    const before = await this.runWithEdit(p, undefined);
    type Candidate = { task: string; hint?: string; criteria?: string; solution?: Edit };
    const ask = (rejected?: string) => this.askJson<{ challenges: Candidate[] }>(
      P.CHALLENGE_SYSTEM, P.challengePrompt(p.path, numbered(code.split("\n")), p.request, p.concepts, rejected, before.output),
      (v) => Array.isArray(v.challenges) && v.challenges.some((c) => typeof c?.task === "string" && c.task.length > 5),
      undefined, rejected ? 0.7 : 0
    );
    // Pick the first candidate whose solution, when run, really changes the output. A candidate we can't
    // run (no or unusable solution) is a fallback; one that prints the same is never used.
    let res: Candidate | undefined;
    let expected: string | undefined;
    let fallback: Candidate | undefined;
    const rejected: string[] = [];
    for (let round = 0; round < 2 && !res; round++) {
      const reply = await ask(round ? `${rejected.map((t) => `"${t}"`).join(", ")} don't change what the program computes (it still prints ${before.output}).` : undefined);
      const candidates = (reply?.challenges ?? []).filter((c) => typeof c?.task === "string" && c.task.length > 5).slice(0, 4);
      for (const c of candidates) {
        if (before.output === undefined) { res = c; break; } // nothing to compare against
        const after = c.solution ? await this.runWithEdit(p, c.solution) : { output: undefined, reason: "no solution given" };
        // Same output, or only its wording changed (e.g. "drop the label"): no logic practised, so not used.
        const same = after.output !== undefined && (after.output === before.output || onlyWordingChanged(before.output, after.output));
        this.logger.log("vibe_learn", undefined, { kind: "challenge_check_solution", id: p.id, task: c.task, before: before.output, after: after.output, reason: after.reason, same });
        if (after.output !== undefined && !same) { res = c; expected = after.output; break; }
        if (same) rejected.push(c.task);
        else fallback = fallback ?? c;
      }
      if (!res && fallback) res = fallback;
    }
    this.setBusy(false);
    if (!res) return this.markStage(p.id, "challenge", "na");

    const task = stripThinking(res.task);
    const msg = this.say("tutor",
      `🛠 **Modify, your turn:** ${task}\n\nChange \`${p.path}\` yourself in the editor, **or** practise vibe coding by asking me to do it (describe exactly what should happen). Then press **Check my work**.`,
      [
        { label: "Hint", cmd: "challengeHint", arg: p.id },
        { label: "Check my work", cmd: "challengeCheck", arg: p.id, primary: true },
        { label: "Skip", cmd: "challengeSkip", arg: p.id },
      ]);
    p.challenge = { task, hint: stripThinking(String(res.hint ?? "")), criteria: String(res.criteria ?? ""), baseline: code, msgId: msg.id, viaAi: false, open: true, before: before.output, expected };
    p.learn.challenge = "active";
    this.stats.chGiven++;
    this.logger.log("vibe_learn", undefined, { kind: "challenge_start", id: p.id, task, criteria: res.criteria });
  }

  private challengeHint(id: string) {
    const c = this.proposals.get(id)?.challenge;
    if (!c?.open) return;
    const m = this.view.messages.find((x) => x.id === c.msgId);
    if (m?.buttons) m.buttons = m.buttons.filter((b) => b.cmd !== "challengeHint");
    this.say("tutor", `💡 ${c.hint || "Look at the part of the code that decides the result you want to change."}`);
    this.logger.log("vibe_learn", undefined, { kind: "challenge_hint", id });
  }

  private async challengeCheck(id: string) {
    const p = this.proposals.get(id);
    const c = p?.challenge;
    if (!p || !c?.open) return;
    const now = (await this.ws.read(p.path)) ?? "";
    if (now === c.baseline) {
      this.say("system", `I don't see any changes in \`${p.path}\` yet. Edit it in the editor, or ask me to make the change, then press **Check my work** again.`);
      return;
    }
    this.setBusy(true, "Checking your work…");
    // Ground truth first: run their program and compare with what the challenge's own solution prints.
    const ran = c.expected !== undefined && c.before !== undefined ? await this.runWithEdit(p, undefined) : undefined;
    const runVerdict = ran?.output !== undefined ? sameResult(ran.output, c.expected!, c.before!) : undefined;
    let done: boolean;
    let feedback: string;
    if (runVerdict === true) {
      done = true;
      feedback = `It works: your program now prints\n\`\`\`\n${ran!.output}\n\`\`\`\nwhich is exactly what the challenge asked for.`;
    } else if (runVerdict === false) {
      // The run is decisive; state the facts instead of asking the model (which can misdescribe the edit).
      done = false;
      feedback = `Not quite yet. Your program now prints\n\`\`\`\n${ran!.output}\n\`\`\`\nbut for this challenge it should print\n\`\`\`\n${c.expected}\n\`\`\`\nCompare the two and look at which part of your change affects that result. Press **Hint** if you're stuck.`;
    } else {
      const r = await this.askJson<{ done: boolean; feedback: string }>(
        P.CHALLENGE_CHECK_SYSTEM,
        P.challengeCheckPrompt(c.task, c.criteria, p.path, numbered(c.baseline.split("\n")), numbered(now.split("\n")), ran?.output),
        (v) => typeof v.done === "boolean"
      );
      done = !!r?.done;
      feedback = r?.feedback ? stripThinking(r.feedback) : "";
      if (!feedback) feedback = done ? "Looks done!" : "Not quite yet.";
    }
    this.setBusy(false);
    this.logger.log("vibe_learn", undefined, { kind: "challenge_check", id, done, decidedBy: runVerdict === undefined ? "model" : "run", output: ran?.output, expected: c.expected, via: c.viaAi ? "ai" : "self", code: now });
    this.say("tutor", `${done ? "🎉" : "🔍"} ${feedback}`);
    if (!done) return;
    c.open = false;
    this.stats.chDone++;
    this.clearButtons(c.msgId);
    await this.markStage(id, "challenge", "done");
  }

  private async challengeSkip(id: string) {
    const p = this.proposals.get(id);
    const c = p?.challenge;
    if (!p || !c?.open) return;
    c.open = false;
    this.clearButtons(c.msgId);
    this.logger.log("vibe_learn", undefined, { kind: "challenge_skip", id });
    await this.markStage(id, "challenge", "skipped");
  }

  // ================================================================== quizzes

  private async quizProject() {
    if (this.level === "off" || this.quiz || this.awaiting) return;
    this.setBusy(true, "Reading your program…");
    const ctx = await this.buildContext();
    if (!ctx.fileCount) { this.setBusy(false); this.say("system", "There's no code in this project to quiz you on yet."); return; }
    this.setBusy(true, "Writing your quiz…");
    const res = await this.askJson<{ questions: Mcq[] }>(P.PROJECT_QUIZ_SYSTEM, P.projectQuizPrompt(ctx.text, this.projectQuizCount, this.askedQuiz.slice(-12)), validQuiz);
    this.setBusy(false);
    if (!res) { this.say("system", "I couldn't build a quiz just now — try again in a moment."); return; }
    this.startQuiz("project", res.questions.slice(0, this.projectQuizCount), [], undefined);
  }

  private startQuiz(kind: QuizState["kind"], raw: Mcq[], fallbackConcepts: string[], changeId: string | undefined) {
    const items = raw.map((q) => shuffle({
      stem: stripThinking(String(q.stem)), choices: q.choices.map(String), correct: q.correct,
      explanation: stripThinking(String(q.explanation ?? "")), concept: q.concept ? String(q.concept).toLowerCase().trim() : undefined,
    }));
    this.quiz = { kind, items, index: 0, right: 0, changeId, fallbackConcepts };
    this.say("tutor", kind === "change"
      ? "🔍 **Question:** about how your code works:"
      : `Quiz on your program: ${items.length} question${items.length > 1 ? "s" : ""}.`);
    this.logQuizQuestion();
  }

  private logQuizQuestion() {
    const q = this.quiz!;
    const item = q.items[q.index];
    this.askedQuiz.push(item.stem.slice(0, 160));
    this.logger.log("vibe_quiz_question", undefined, { kind: q.kind, changeId: q.changeId, index: q.index, stem: item.stem, choices: item.choices, correctIndex: item.correct, concept: item.concept });
  }

  async answerQuiz(choice: number) {
    const q = this.quiz;
    if (!q || this.view.busy || !(choice >= 0 && choice <= 3)) return;
    const item = q.items[q.index];
    const correct = choice === item.correct;
    const L = (i: number) => "ABCD"[i];
    this.logger.log("vibe_quiz_response", undefined, { kind: q.kind, changeId: q.changeId, index: q.index, chosen: choice, correct });

    if (correct) q.right++;
    this.stats.checkTotal++;
    if (correct) this.stats.checkRight++;
    const names = item.concept ? [item.concept] : q.fallbackConcepts.slice(0, 1);
    names.forEach((n) => this.bumpScore(n, correct));

    this.say("student", `${L(choice)}. ${item.choices[choice]}`);
    this.say("tutor", (correct ? "✅ Correct. " : `Not quite — the answer is **${L(item.correct)}. ${item.choices[item.correct]}**. `) + item.explanation);
    q.index++;
    if (q.index >= q.items.length) await this.endQuiz(false);
    else this.logQuizQuestion();
    this.refresh();
  }

  private async endQuiz(skipped: boolean) {
    const q = this.quiz;
    if (!q) return;
    this.quiz = undefined;
    if (skipped) {
      this.logger.log("vibe_quiz_response", undefined, { kind: q.kind, changeId: q.changeId, skippedAt: q.index });
      this.say("system", "Quiz skipped.");
    } else if (q.items.length > 1) {
      this.say("tutor", `You got **${q.right} of ${q.items.length}**. ` + (q.right === q.items.length ? "Nice work!" : "Ask me about anything that didn't click."));
    }
    if (q.kind === "change" && q.changeId) await this.markStage(q.changeId, "check", skipped ? "skipped" : "done");
  }

  private bumpSeen(name: string) {
    const c = this.concepts.get(name) ?? { seen: 0, right: 0, total: 0 };
    c.seen++;
    this.concepts.set(name, c);
  }

  private bumpScore(name: string, correct: boolean) {
    const c = this.concepts.get(name) ?? { seen: 0, right: 0, total: 0 };
    c.total++;
    if (correct) c.right++;
    this.concepts.set(name, c);
  }

  // ================================================================== editor (what the browser's code editor shows)

  /** The student opened a file from the file list. */
  async open(rel: string) {
    if (this.view.stage !== "chat" || !this.files.includes(rel)) return;
    if (this.tour) await this.endTour(false);
    await this.showFile(rel);
    this.touch();
  }

  /** The student edited a file (saved automatically as they type). */
  async save(rel: string, content: string) {
    // Only existing files, and never one that is on screen as a proposal or diff (it isn't accepted yet).
    if (this.view.stage !== "chat" || !this.files.includes(rel) || (this.ed.path === rel && this.ed.mode !== "file")) return;
    await this.ws.write(rel, content);
    if (this.ed.mode === "file" && this.ed.path === rel) this.ed.content = content;
    this.logger.log("vibe_learn", undefined, { kind: "student_edit", path: rel, chars: content.length });
  }

  /** The student selected lines (or cleared the selection) in the editor. */
  select(rel: string, start?: number, end?: number) {
    if (this.view.stage !== "chat") return;
    this.ed.selection = start && end && this.ed.mode === "file" && this.ed.path === rel ? { path: rel, start: Math.min(start, end), end: Math.max(start, end) } : undefined;
    this.touch();
  }

  async closeDiff() {
    if (this.ed.mode !== "diff") return;
    if (this.ed.path && this.files.includes(this.ed.path)) await this.showFile(this.ed.path);
    else this.ed = { mode: "none", version: this.ed.version + 1, readOnly: false };
    this.refresh();
  }

  private async showFile(rel: string) {
    const content = (await this.ws.read(rel)) ?? "";
    this.ed = { mode: "file", path: rel, content, version: this.ed.version + 1, readOnly: false, selection: undefined };
  }

  private showProposed(rel: string, content: string) {
    if (this.ed.mode === "proposed" && this.ed.path === rel && this.ed.content === content) return;
    this.ed = { mode: "proposed", path: rel, content, version: this.ed.version + 1, readOnly: true, selection: undefined };
  }

  private editorView(): EditorView {
    const e = this.ed;
    return { files: this.files, mode: e.mode, path: e.path, content: e.mode === "diff" ? undefined : e.content, version: e.version, readOnly: e.readOnly || e.mode !== "file", highlight: e.highlight, diff: e.mode === "diff" ? e.diff : undefined };
  }

  /** The file the student is looking at (a real file, not a proposal or a diff). */
  private activeFile(): string | undefined {
    return this.ed.mode === "file" && this.ed.path ? this.ed.path : undefined;
  }

  private quickInfo(): { active: string; selection: string } {
    const active = this.activeFile() ?? "";
    const sel = this.ed.selection;
    return { active, selection: sel && sel.path === active ? `lines ${sel.start}–${sel.end}` : "" };
  }

  /** Gathers the whole project (within a character budget) so the model can see the entire program. */
  private async buildContext(): Promise<ProjectContext> {
    const paths = await this.ws.list(this.projectDir);
    const active = this.activeFile();
    const ordered = [...paths].sort((a, b) => Number(b === active) - Number(a === active) || a.length - b.length || a.localeCompare(b));
    const files: ContextFile[] = [];
    for (const [i, p] of ordered.entries()) files.push({ path: p, text: i < 80 || p === active ? await this.ws.readForContext(p) : undefined });

    const activeContent = active ? await this.ws.read(active) : undefined;
    const sel = this.ed.selection;
    const selection: Selection | undefined = sel && sel.path === active && activeContent !== undefined
      ? { path: sel.path, startLine: sel.start, endLine: sel.end, text: activeContent.replace(/\r\n/g, "\n").split("\n").slice(sel.start - 1, sel.end).join("\n").slice(0, 6000) }
      : undefined;
    const { text, included } = formatContext(files, this.maxChars, { scope: this.projectDir, active, selection });
    return { text, files: included, fileCount: paths.length, paths, active, activeContent, selection };
  }

  // ================================================================== editor helpers

  async explainSelection() {
    if (!this.ed.selection || this.ed.selection.path !== this.activeFile()) {
      this.say("system", "Select some code in the editor first.");
      return this.refresh();
    }
    await this.send("Explain what the selected code does and why it works this way.");
  }

  /** ▶ Run: runs the open file with the input the student typed (programs that read input need some). */
  private async runActiveFile(stdin: string) {
    const rel = this.activeFile();
    const file = rel && this.ws.abs(rel);
    if (!rel || !file) { this.say("system", "Open the file you want to run in the editor first."); return; }
    const lang = langOf(rel);
    if (!lang) { this.say("system", `I can only run Python or JavaScript files (this is \`${rel}\`).`); return; }
    const code = (await this.ws.read(rel)) ?? "";
    const input = stdin.trim() ? stdin.replace(/\r\n/g, "\n").replace(/\n?$/, "\n") : "";
    if (INPUT_RE.test(code) && !input) {
      this.say("system", `\`${rel}\` reads input. Type what it should read in the **Program input** box next to ▶ Run (one value per line), then press Run again.`);
      return;
    }
    this.setBusy(true, "Running…");
    const run = await runFile(lang, file, input, this.pythonPath);
    this.setBusy(false);
    this.logger.log("program_run", undefined, { via: "panel", file: rel, stdin: input, stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut, error: run.error });
    if (run.error) { this.say("system", `I can't run it here: ${run.error}`); return; }
    if (run.timedOut) { this.say("system", `\`${rel}\` didn't finish within 8 seconds — is there a loop that never ends, or does it need more input?`); return; }
    this.say("system", `▶ Output of \`${rel}\`${input ? " (with your input)" : ""}:\n\`\`\`\n${run.stdout.replace(/\s+$/, "") || "(nothing printed)"}\n\`\`\``);
    if (run.stderr.trim()) this.reportCrash(rel, run.stderr.trim());
  }

  private reportCrash(file: string, err: string) {
    const idx = this.errors.push({ path: file, err }) - 1;
    // Show the line that names the error (e.g. "ReferenceError: foo is not defined"), not the runtime's footer.
    const lines = err.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines.find((l) => /^\w*(Error|Exception)\b|^\w+Error:|Traceback/.test(l) && !/^Traceback/.test(l)) ?? lines.pop() ?? err;
    this.say("tutor",
      `💥 \`${file}\` crashed:\n\`\`\`\n${last.slice(0, 300)}\n\`\`\`\nErrors are clues, not failures. Want me to explain what this one means?`,
      this.level === "off" ? [] : [{ label: "Explain this error", cmd: "explainError", arg: String(idx), primary: true }]);
  }

  private async explainError(idx: number) {
    const e = this.errors[idx];
    if (!e) return;
    this.view.messages.forEach((m) => { if (m.buttons?.some((b) => b.cmd === "explainError" && b.arg === String(idx))) m.buttons = undefined; });
    await this.send(`My program \`${e.path}\` crashed with this error:\n\`\`\`\n${e.err.slice(0, 1500)}\n\`\`\`\nWhat does this error mean and why does it happen? Then fix it.`);
  }

  // ================================================================== target, project, level

  private setTarget(t: string) {
    const ok = t === "auto" || t === "new" || this.view.targets.includes(t);
    this.target = ok ? t : "auto";
    this.logger.log("vibe_learn", undefined, { kind: "set_target", target: this.target });
  }

  private setLevel(l: string) {
    if (this.view.logging) return; // study conditions are fixed for the session
    const level = parseLevel(l);
    if (level === this.level) return;
    this.level = level;
    if (level === "off") {
      if (this.tour) void this.endTour(false, true);
      this.quiz = undefined;
      this.awaiting = undefined;
    }
    if (level !== "guided" && this.gate) void this.skipSteps();
    const desc = level === "guided" ? "Structured vibe coding: explain the idea, get the code and walk through it together, then predict, run and modify it."
      : level === "light" ? "Learning tools are on each change whenever you want them."
      : "Regular vibe coding: I write code straight from your request.";
    this.say("system", `Mode: **${conditionLabel(level)}**. ${desc}`);
  }

  private async newProject(name: string) {
    const dir = name.trim();
    if (!/^[\w-]{1,40}$/.test(dir)) {
      this.say("system", "Project names can use letters, numbers, - or _ (no spaces).");
      return;
    }
    await this.ws.mkdir(dir);
    this.projectDir = dir;
    this.plan = undefined;
    this.history = [];
    this.clarRound = 0;
    this.awaiting = undefined;
    this.target = "auto";
    this.logger.log("vibe_plan", undefined, { newProject: dir });
    await this.touchNow();
    this.say("tutor", `📂 New project **${dir}/**. I'll put its files in that folder and only look at that folder. What do you want to build?`);
  }

  private async leaveProject() {
    if (!this.projectDir) return;
    this.say("system", `Left project ${this.projectDir}/ — I can see all your files again.`);
    this.projectDir = undefined;
    this.plan = undefined;
    await this.touchNow();
  }

  /**
   * Models sometimes name a folder as the file (e.g. "test" right after New project), leave out the extension,
   * or write outside the current project folder. Fix those paths before the student ever sees the change.
   */
  private async fixPaths(blocks: EditBlock[], ctx: ProjectContext): Promise<EditBlock[]> {
    if (!blocks.length) return blocks;
    const remap = new Map<string, string>();
    for (const b of blocks) {
      if (remap.has(b.path)) continue;
      let p = b.path;
      const sample = blocks.filter((x) => x.path === b.path).map((x) => x.replace).join("\n");
      const ext = guessExtension(sample, ctx);
      // outside the project folder the student is working in -> into it
      if (this.projectDir && p !== this.projectDir && !p.startsWith(this.projectDir + "/")) p = `${this.projectDir}/${p.split("/").pop()}`;
      if ((await this.ws.isFolder(p)) || p === this.projectDir) {
        p = `${p}/main.${ext}`; // a folder -> a file inside it
      } else if (!/\.[A-Za-z0-9]+$/.test(p.split("/").pop() ?? "") && !(await this.ws.read(p))) {
        p = `${p}.${ext}`; // a new file without an extension
      }
      remap.set(b.path, p);
      if (p !== b.path) this.logger.log("vibe_change", undefined, { status: "path_fixed", from: b.path, to: p });
    }
    return blocks.map((b) => ({ ...b, path: remap.get(b.path) ?? b.path }));
  }

  /** If some SEARCH text doesn't match, ask the model once more with the exact file contents. */
  private async repairIfNeeded(blocks: EditBlock[], request: string): Promise<EditBlock[]> {
    if (!blocks.length) return blocks;
    const ok: EditBlock[] = [];
    const bad: EditBlock[] = [];
    const contents = new Map<string, string | undefined>();
    const byPath = new Map<string, EditBlock[]>();
    for (const b of blocks) byPath.set(b.path, [...(byPath.get(b.path) ?? []), b]);
    for (const [p, bs] of byPath) {
      let cur = await this.ws.read(p);
      contents.set(p, cur);
      for (const b of bs) {
        const r = applyBlocks(cur, [b]);
        if (r.applied) { ok.push(b); cur = r.content; } else bad.push(b);
      }
    }
    if (!bad.length) return blocks;

    this.setBusy(true, "Fixing up the edit…");
    const files = [...new Set(bad.map((b) => b.path))].map((p) => ({ path: p, content: contents.get(p) }));
    const res = await callBackend({
      model: this.model, system: P.actionSystem(this.level, WHERE), prompt: P.repairPrompt(request, blocksToText(bad), files),
      temperature: 0, settings: this.cfg,
    });
    this.setBusy(false);
    const fixed = parseBlocks(stripThinking(res.text)).blocks;
    this.logger.log("vibe_change", undefined, { status: "repair", failed: bad.length, returned: fixed.length, raw: res.text.slice(0, 2000) }, res.ms);
    return [...ok, ...(fixed.length ? fixed : bad)];
  }

  /** Editor or selection changed: update what the header says the assistant will look at. */
  private touch() {
    if (this.view.stage !== "chat") return;
    this.view.ctx = { ...this.view.ctx, ...this.quickInfo() };
    this.refresh();
  }

  private async touchNow() {
    this.files = await this.ws.list(this.projectDir);
    this.view.ctx = { files: this.files.length, ...this.quickInfo() };
    this.view.targets = this.files.slice(0, 80);
    if (this.target !== "auto" && this.target !== "new" && !this.files.includes(this.target)) this.target = "auto";
    this.refresh();
  }

  // ================================================================== plumbing

  /** A command failed outside the session's own error handling (e.g. the route handler caught it). */
  reportError(err: unknown) {
    this.setBusy(false);
    this.logger.log("vibe_error", undefined, { message: String((err as any)?.message || err) });
    this.say("system", `⚠️ ${(err as any)?.message || err}`);
    this.refresh();
  }

  private async guard(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err: any) {
      this.setBusy(false);
      this.logger.log("vibe_error", undefined, { message: String(err?.message || err) });
      this.say("system", `⚠️ ${err?.message || err}`);
    }
    this.refresh();
  }

  private recentHistory(): ChatMsg[] {
    return this.history.slice(-10);
  }

  private async askJson<T>(system: string, prompt: string, valid: (v: T) => boolean, history?: ChatMsg[], temperature = 0): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was not valid JSON in the required format. Reply with ONLY the JSON object.`;
      const res = await callBackend({ model: this.model, system, prompt: p, history, temperature, settings: this.cfg });
      const parsed = extractJson<T>(res.text);
      if (parsed && valid(parsed)) return parsed;
      this.logger.log("parse_failure", undefined, { attempt, raw: res.text.slice(0, 600) }, res.ms);
    }
    return undefined;
  }

  private say(role: VibeMsg["role"], text: string, buttons?: MsgButton[]): VibeMsg {
    const m: VibeMsg = { id: ++this.msgSeq, role, text, buttons: buttons?.length ? buttons : undefined };
    this.view.messages.push(m);
    return m;
  }

  private clearButtons(msgId: number) {
    const m = this.view.messages.find((x) => x.id === msgId);
    if (m) m.buttons = undefined;
  }

  private setBusy(busy: boolean, label = "") {
    this.view.busy = busy;
    this.view.busyLabel = label;
    this.refresh();
  }

  refresh() {
    const v = this.view;
    v.inputEnabled = v.stage === "chat" && !v.busy && !this.quiz;
    v.project = this.projectDir;
    v.target = this.target;
    v.levelLocked = v.logging;
    v.level = this.level;
    v.placeholder =
      this.awaiting?.kind === "gate" && this.gate?.step === 1 ? "Step 1: explain the idea in a sentence or two…"
      : this.awaiting?.kind === "gate" ? "Step 2: write every step, in your own words…"
      : this.awaiting?.kind === "predict" ? "What will it print? Your best guess…"
      : this.tour ? "Ask about this part of the code…"
      : v.ctx.selection ? "Ask about, or ask to change, the selected code…"
      : "Describe what to build, change, fix, or explain…";

    const q = this.quiz;
    v.quiz = q ? {
      label: q.kind === "change" ? "Check on your change" : "Quiz on your program",
      index: q.index, total: q.items.length, stem: q.items[q.index].stem, choices: q.items[q.index].choices,
    } : undefined;

    v.structured = this.structuredProgress();

    const t = this.tour;
    v.tour = t ? {
      index: t.index, total: t.stops.length, title: t.stops[t.index].title, text: t.stops[t.index].text,
      path: this.proposals.get(t.id)?.path ?? "", start: t.stops[t.index].start, end: t.stops[t.index].end, pending: t.pending,
    } : undefined;

    const plan = this.plan;
    if (plan) {
      const k = this.nextStepIndex();
      const idle = !this.awaiting && !this.quiz && !this.tour && k !== undefined && plan.steps[k].status === "todo";
      v.plan = {
        goal: plan.goal, steps: plan.steps.map((s) => ({ title: s.title, status: s.status })),
        next: idle ? { index: k!, title: plan.steps[k!].title } : undefined,
        remaining: plan.steps.filter((s) => s.status === "todo").length,
      };
    } else {
      v.plan = undefined;
    }

    for (const p of this.proposals.values()) {
      p.card.learn = this.level === "off" || p.card.status === "rejected" || p.card.status === "failed"
        ? undefined
        : STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], status: p.learn[s] }));
    }

    v.concepts = this.level === "off" ? [] : [...this.concepts.entries()]
      .map(([name, c]) => ({ name, ...c }))
      .sort((a, b) => b.seen + b.total - (a.seen + a.total));
    v.skills = this.level === "off" ? [] : this.skillRows();
    this.onChange({ view: v, editor: this.editorView() });
    v.draft = undefined;
  }

  /** What the 1-2-3 bar shows: the gate step, or where the latest structured change is (walkthrough, or predict / question / modify). */
  private structuredProgress(): VibeView["structured"] {
    if (this.level !== "guided") return undefined;
    const labels = this.requireSteps
      ? ["Explain the idea", "Write the steps", "Read the code"]
      : ["Explain the idea", "Walk through the code", "Predict, run & modify"];
    if (this.gate) return { labels, step: this.gate.step };
    const latest = this.currentStructured ? this.proposals.get(this.currentStructured) : undefined;
    if (!latest || latest.card.status === "rejected" || latest.card.status === "failed") return undefined;
    const next = STAGES.find((s) => latest.learn[s] === "active" || latest.learn[s] === "todo");
    const sub = latest.card.status === "pending" && latest.learn.tour !== "active" ? "accept the code"
      : next === "predict" ? "predict & run" : next === "check" ? "question" : next === "challenge" ? "modify" : next === "tour" ? "walkthrough" : "";
    if (!next && latest.card.status === "accepted") return undefined;
    if (this.requireSteps) return { labels, step: 3, sub };
    const inWalkthrough = latest.card.status === "pending" || next === "tour";
    return { labels, step: inWalkthrough ? 2 : 3, sub: inWalkthrough ? (latest.card.status === "pending" && latest.learn.tour !== "active" ? "accept the code" : "") : sub };
  }

  /** The flow in one line, as configured. */
  private flowLine(): string {
    return this.requireSteps
      ? "Before I write any code: **1. Explain the idea → 2. Write the steps → 3. Read the code.**"
      : "Quick one before I write the code: **1. Explain the idea → 2. Walk through the code → 3. Predict, run & modify.**";
  }

  /** What the student is looking at during a walkthrough: the current stop, and the code itself if it isn't accepted yet. */
  private tourNote(): string {
    const t = this.tour;
    const p = t && this.proposals.get(t.id);
    if (!t || !p) return "";
    const stop = t.stops[t.index];
    return [
      `\n\nWALKTHROUGH: the student is at stop ${t.index + 1} of ${t.stops.length} ("${stop.title}"), lines ${stop.start}-${stop.end} of ${p.path}. Their question is probably about these lines.`,
      t.pending ? `This code is PROPOSED and not accepted yet, so it is not in the files above. Answer about it; do not write SEARCH/REPLACE blocks for it.\nPROPOSED ${p.path}:\n${numbered(p.newContent.replace(/\r\n/g, "\n").split("\n"))}` : "",
    ].filter(Boolean).join("\n");
  }

  /** After Step 1: either ask for the steps (if required) or write the code straight away. */
  private async afterIdea() {
    if (this.requireSteps) return this.toSteps();
    const g = this.gate!;
    g.idea = g.ideaParts.join(" / ");
    return this.finishGate();
  }

  private skillRows(): VibeView["skills"] {
    const s = this.stats;
    const frac = (a: number, b: number) => (b ? `${a}/${b}` : "—");
    let prompting = "—";
    if (s.prompts.length) {
      const recent = s.prompts.slice(-5);
      const avg = recent.reduce((a, n) => a + n, 0) / recent.length;
      let trend = "";
      if (s.prompts.length >= 4) {
        const early = s.prompts.slice(0, 2).reduce((a, n) => a + n, 0) / 2;
        const late = s.prompts.slice(-2).reduce((a, n) => a + n, 0) / 2;
        trend = late > early ? " ↑" : late < early ? " ↓" : "";
      }
      prompting = `${avg.toFixed(1)}/6${trend}`;
    }
    const accepted = [...this.proposals.values()].filter((p) => p.card.status === "accepted");
    const read = accepted.filter((p) => p.viewedDiff || p.toured || p.learn.predict === "done").length;
    return [
      { label: "Explaining", value: frac(s.gatesUnaided, s.gates), detail: "Times you explained the idea without the tutor having to fill it in." },
      { label: "Prompting", value: prompting, detail: "How clearly your requests describe the goal, inputs/outputs and details (average of your last 5)." },
      { label: "Reading code", value: frac(read, accepted.length), detail: "Accepted changes you actually read: viewed the diff, walked through it, or predicted its output." },
      { label: "Predicting", value: frac(s.predRight, s.predTotal), detail: "Times you correctly predicted what your program prints." },
      { label: "Understanding", value: frac(s.checkRight, s.checkTotal), detail: "Check and quiz questions answered correctly." },
      { label: "Modifying", value: frac(s.chDone, s.chGiven), detail: '"Your turn" challenges completed.' },
    ];
  }
}

function parseLevel(l: string | undefined): Level {
  if (l === "off" || l === "regular") return "off";
  if (l === "light" || l === "offer") return "light";
  return "guided";
}

/** The study's names for the conditions (COSC 449 thesis): structured vs regular vibe coding. */
function conditionName(level: Level): string {
  return level === "guided" ? "structured" : level === "off" ? "regular" : "light";
}

function conditionLabel(level: Level): string {
  return level === "guided" ? "Structured vibe coding" : level === "off" ? "Regular vibe coding" : "Light";
}

function langOf(p: string): "python" | "javascript" | undefined {
  return p.endsWith(".py") ? "python" : p.endsWith(".js") ? "javascript" : undefined;
}

/** File extension for new code with no usable name: from the code itself, else the project's main language. */
function guessExtension(code: string, ctx: ProjectContext): string {
  if (/^\s*(def |import \w+$|from \w+ import|print\(|elif |input\()/m.test(code) && !/[;{}]\s*$/m.test(code)) return "py";
  if (/\b(console\.log|const |let |function |require\(|=>)/.test(code)) return "js";
  const counts = new Map<string, number>();
  for (const p of ctx.paths) { const e = p.split(".").pop() ?? ""; if (/^(py|js|ts|java|c|cpp|cs|go|rb)$/.test(e)) counts.set(e, (counts.get(e) ?? 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : (ctx.active?.split(".").pop() || "js");
}

function changeText(p: Proposal): string {
  return p.blocks.map((b) => b.search.trim()
    ? `--- before ---\n${b.search}\n--- after ---\n${b.replace}`
    : `--- whole file ---\n${b.replace}`).join("\n\n").slice(0, 8000);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/["'`[\](),]/g, " ").replace(/\s+/g, " ").trim();
}

function validQuiz(v: { questions: Mcq[] }): boolean {
  return Array.isArray(v.questions) && v.questions.length > 0 && v.questions.every((q) =>
    typeof q.stem === "string" && Array.isArray(q.choices) && q.choices.length === 4 &&
    Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3);
}

function shuffle(q: Mcq): Mcq {
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, choices: order.map((i) => q.choices[i]), correct: order.indexOf(q.correct) };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
