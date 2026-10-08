import * as path from 'path';
import * as vscode from 'vscode';
import { callBackend, ChatMsg } from '../shared/callBackend';
import { StudyLogger } from '../study/logger';
import { extractJson, stripThinking } from '../study/prompts';
import { interpreterFor, runFile } from '../study/runner';
import { buildContext, listFiles, numbered, ProjectContext, quickInfo } from './context';
import { applyBlocks, blocksToText, EditBlock, fencedToBlocks, parseBlocks, ProposedContent } from './edits';
import * as P from './prompts';

type Level = P.Level;
type Stage = 'tour' | 'predict' | 'check' | 'challenge';
type StageStatus = 'todo' | 'active' | 'done' | 'skipped' | 'na';
const STAGES: Stage[] = ['tour', 'predict', 'check', 'challenge'];
const STAGE_LABEL: Record<Stage, string> = { tour: 'Walk through', predict: 'Predict & run', check: 'Check', challenge: 'Your turn' };
const INPUT_RE = /\binput\s*\(|sys\.stdin|readline|process\.stdin|prompt\s*\(/;

export type VibeChange = {
  id: string;
  path: string;
  isNew: boolean;
  added: number;
  removed: number;
  status: 'pending' | 'accepted' | 'rejected' | 'failed';
  note?: string;
  learn?: { stage: Stage; label: string; status: StageStatus }[];
};

export type MsgButton = { label: string; cmd: string; arg?: string; primary?: boolean };

export type VibeMsg = {
  id: number;
  role: 'student' | 'tutor' | 'system';
  text: string;
  changes?: VibeChange[];
  buttons?: MsgButton[];
  tip?: { text: string; improved?: string; score: number };
};

export type VibeView = {
  kind: 'vibe';
  stage: 'setup' | 'chat';
  level: Level;
  hasFolder: boolean;
  logging: boolean;
  participant: string;
  messages: VibeMsg[];
  busy: boolean;
  busyLabel: string;
  inputEnabled: boolean;
  placeholder: string;
  draft?: string;
  quiz?: { label: string; index: number; total: number; stem: string; choices: string[] };
  tour?: { index: number; total: number; title: string; text: string; path: string; start: number; end: number; pending: boolean };
  plan?: { goal: string; steps: { title: string; status: string }[]; next?: { index: number; title: string }; remaining: number };
  concepts: { name: string; seen: number; right: number; total: number }[];
  skills: { label: string; value: string; detail: string }[];
  ctx: { files: number; active: string; selection: string };
  /** Folder of the current "new project", if any. */
  project?: string;
  /** Where code goes: 'auto', 'new', or a workspace-relative file path. */
  target: string;
  targets: string[];
  levelLocked: boolean;
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
  viewedDiff: boolean;
  toured: boolean;
  learn: Record<Stage, StageStatus>;
  challenge?: { task: string; hint: string; criteria: string; baseline: string; msgId: number; viaAi: boolean; open: boolean };
  nextPrompted?: boolean;
};

type Plan = {
  goal: string;
  steps: { title: string; detail: string; status: 'todo' | 'doing' | 'done' }[];
  request: string;
  think?: { question: string; answer?: string; msgId: number };
};

type Mcq = { stem: string; choices: string[]; correct: number; explanation: string; concept?: string };
type QuizState = { kind: 'change' | 'project'; items: Mcq[]; index: number; right: number; changeId?: string; fallbackConcepts: string[] };
type Awaiting =
  | { kind: 'think' }
  | { kind: 'predict'; id: string; truth: string; stdin: string; msgId: number };
type Tour = {
  id: string;
  stops: { start: number; end: number; title: string; text: string }[];
  index: number;
  uri: vscode.Uri;
  pending: boolean;
  editor?: vscode.TextEditor;
};

export class VibeSession {
  private view: VibeView;
  private msgSeq = 0;
  private changeSeq = 0;

  private level: Level = 'guided';
  private clarify = true;
  private maxClarifications = 2;
  private perChange = 1;
  private projectQuizCount = 3;
  private maxChars = 24000;
  private model = '';
  private projectDir: string | undefined;
  private target = 'auto';
  private lastRequest: { text: string; opts: { planStep?: number; planAll?: boolean } } | undefined;

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
  private stats = { prompts: [] as number[], accepted: 0, reviewed: 0, predRight: 0, predTotal: 0, checkRight: 0, checkTotal: 0, chDone: 0, chGiven: 0 };
  private terminal: vscode.Terminal | undefined;
  private touchTimer: NodeJS.Timeout | undefined;
  private deco: vscode.TextEditorDecorationType | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: StudyLogger,
    private readonly onChange: (v: VibeView) => void
  ) {
    this.view = {
      kind: 'vibe', stage: 'setup', level: 'guided', hasFolder: !!vscode.workspace.workspaceFolders?.length,
      logging: false, participant: '', messages: [], busy: false, busyLabel: '', inputEnabled: false, placeholder: '',
      concepts: [], skills: [], ctx: { files: 0, active: '', selection: '' }, target: 'auto', targets: [], levelLocked: false,
    };
  }

  getView(): VibeView {
    this.view.hasFolder = !!vscode.workspace.workspaceFolders?.length;
    if (this.view.stage === 'setup') {
      this.view.level = parseLevel(vscode.workspace.getConfiguration('vibelearner').get<string>('learning.level'));
    }
    return this.view;
  }

  // ================================================================== setup

  async begin(participant?: string, consent?: boolean, pickedLevel?: string) {
    if (this.view.stage === 'chat') return;
    const cfg = vscode.workspace.getConfiguration('vibelearner');
    this.level = parseLevel(cfg.get<string>('learning.level'));
    this.clarify = cfg.get<boolean>('learning.clarify') ?? true;
    this.maxClarifications = clamp(cfg.get<number>('learning.maxClarifications') ?? 2, 0, 5);
    this.perChange = clamp(cfg.get<number>('learning.questionsPerChange') ?? 1, 1, 3);
    this.projectQuizCount = clamp(cfg.get<number>('learning.projectQuizQuestions') ?? 3, 1, 6);
    this.maxChars = clamp(cfg.get<number>('context.maxChars') ?? 24000, 4000, 200000);
    this.model = cfg.get<string>('model') || cfg.get<string>('defaultModel') || 'qwen3-coder:30b';

    const code = (participant ?? '').trim();
    // The Start-screen picker applies only outside research sessions; study conditions come from settings.
    if (!code && pickedLevel) this.level = parseLevel(pickedLevel);
    if (code) {
      if (!consent) return void vscode.window.showWarningMessage('Tick the consent box to turn on research logging, or clear the participant code.');
      if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) return void vscode.window.showWarningMessage('Participant code must be 2-32 letters, digits, - or _.');
      this.logger.enable(code, `vibe:${this.level}`);
      this.view.logging = true;
      this.view.participant = code;
      this.logger.log('vibe_session', undefined, {
        promptVersion: P.VIBE_PROMPT_VERSION, model: this.model, provider: cfg.get('apiProvider'), temperature: cfg.get('temperature'),
        level: this.level, clarify: this.clarify, maxClarifications: this.maxClarifications, questionsPerChange: this.perChange,
        projectQuizQuestions: this.projectQuizCount, contextMaxChars: this.maxChars,
      });
    }

    this.view.stage = 'chat';
    this.view.level = this.level;
    if (!this.view.hasFolder) {
      this.say('tutor', '⚠️ No folder is open. Use **File → Open Folder** so I can see (and create) your program\'s files, then reopen this panel.');
    } else if (this.level === 'off') {
      this.say('tutor', 'Hi! I can see your whole project. Ask me to build something, change or fix code, or explain how something works.');
    } else {
      this.say('tutor',
        'Hi! I\'m your vibe-coding partner. Tell me what you want to build, change, fix or understand. I can see your whole project, and if you select code first I\'ll focus on that.\n\n' +
        'I\'ll write the code, and along the way I\'ll help you **think it through, walk through it, predict what it does, and try changes yourself**. That\'s how you learn from vibe coding instead of just copying.' +
        (this.level === 'guided' ? ' Every step can be skipped.' : ''));
    }
    await this.touchNow();
  }

  /** Commands from the editor (explain/change selection) start the session without the setup screen. */
  async ensureStarted() {
    if (this.view.stage === 'setup') await this.begin();
  }

  // ================================================================== chat

  async send(raw: string, target?: string) {
    if (target !== undefined) this.setTarget(target);
    const text = raw.trim();
    if (!text || this.view.busy || this.view.stage !== 'chat' || this.quiz) return;

    if (this.awaiting?.kind === 'predict') return this.guard(() => this.handlePrediction(text));
    if (this.awaiting?.kind === 'think') return this.guard(() => this.handleThink(text));

    const snapshot = { msgs: this.view.messages.length, hist: this.history.length, round: this.clarRound };
    this.setBusy(true, 'Reading your project…');
    let ctx: ProjectContext;
    try {
      ctx = await buildContext(this.maxChars, this.projectDir);
    } catch (err: any) {
      this.setBusy(false);
      this.say('system', `⚠️ Couldn't read the project: ${err?.message || err}`);
      return this.refresh();
    }
    const selNote = ctx.selection ? `\n\n_(about ${ctx.selection.path}, lines ${ctx.selection.startLine}–${ctx.selection.endLine})_` : '';
    const studentMsg = this.say('student', text + selNote);
    this.logger.log('vibe_request', undefined, {
      text, active: ctx.active, selection: ctx.selection && { path: ctx.selection.path, start: ctx.selection.startLine, end: ctx.selection.endLine },
      files: ctx.fileCount, clarRound: this.clarRound, inTour: !!this.tour,
    });

    try {
      if (this.level !== 'off') {
        this.setBusy(true, 'Thinking…');
        const listing = this.listing(ctx);
        const route = await this.askJson<{ intent: string; size?: string; detail: string; reply?: string; prompt_review?: any }>(
          P.ROUTER_SYSTEM, P.routerPrompt(listing, text, this.clarRound + 1, this.maxClarifications, this.plan ? P.planText(this.plan, undefined, false) : undefined),
          v => typeof v.detail === 'string', this.recentHistory()
        );
        this.logger.log('vibe_route', undefined, { intent: route?.intent, size: route?.size, detail: route?.detail, reply: route?.reply, promptReview: route?.prompt_review, round: this.clarRound });

        // Prompt coach: feedback on the request as a vibe-coding prompt.
        const pr = route?.prompt_review;
        if (pr && ['build', 'edit', 'debug'].includes(route!.intent) && typeof pr.tip === 'string' && pr.tip.trim()) {
          const score = [pr.goal, pr.io, pr.details].reduce((a: number, n: any) => a + clamp(Number(n) || 0, 0, 2), 0);
          studentMsg.tip = { text: stripThinking(pr.tip), improved: pr.improved ? stripThinking(String(pr.improved)) : undefined, score };
          this.stats.prompts.push(score);
        }

        if (this.clarify && this.clarRound < this.maxClarifications && route && route.detail !== 'enough' && route.reply?.trim()) {
          const reply = stripThinking(route.reply);
          this.clarRound++;
          this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
          this.setBusy(false);
          this.say('tutor', reply);
          return this.refresh();
        }
        this.clarRound = 0;

        if (route?.intent === 'build' && route.size === 'large') {
          const planned = await this.makePlan(text, ctx);
          if (planned) return this.refresh();
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
      this.logger.log('vibe_error', undefined, { message: String(err?.message || err) });
      this.say('system', `⚠️ ${err?.message || err}\n\nYour message was not lost — press Send to try again.`);
    }
    this.refresh();
  }

  private listing(ctx: ProjectContext): string {
    return ctx.text.split('\n\nFILE CONTENTS')[0] +
      (ctx.selection ? `\n\nSTUDENT SELECTION (${ctx.selection.path} lines ${ctx.selection.startLine}-${ctx.selection.endLine}):\n${ctx.selection.text}` : '');
  }

  private async act(request: string, ctx: ProjectContext, opts: { planStep?: number; planAll?: boolean }) {
    this.lastRequest = { text: request, opts };
    this.setBusy(true, opts.planStep !== undefined ? `Building step ${opts.planStep + 1}…` : 'Working on it…');
    const pText = this.plan && opts.planStep !== undefined ? P.planText(this.plan, opts.planStep, !!opts.planAll) : undefined;
    const idea = this.plan?.think?.answer;
    const res = await callBackend({
      model: this.model, system: P.actionSystem(this.level),
      prompt: P.actionPrompt(ctx.text, [request, P.targetInstruction(this.target, this.projectDir)].filter(Boolean).join('\n\n'), pText, idea),
      history: this.recentHistory(), context: this.context,
    });
    this.setBusy(false);

    let { blocks, rest } = parseBlocks(stripThinking(res.text));
    let usedFallback = false;
    if (!blocks.length && ctx.folder) {
      // The model answered with plain fenced code instead of edit blocks: turn it into reviewable changes.
      let active = ctx.active && ctx.activeContent !== undefined ? { path: ctx.active, content: ctx.activeContent } : undefined;
      if (this.target === 'new') active = undefined;
      else if (this.target !== 'auto') active = { path: this.target, content: (await readCurrent(this.fileUri(this.target))) ?? '' };
      const fb = fencedToBlocks(rest, new Set(ctx.paths), active, this.projectDir);
      if (fb.blocks.length) {
        blocks = fb.blocks;
        rest = fb.rest;
        usedFallback = true;
      }
    }
    const split = P.splitConcepts(rest);
    const shown = split.text;
    const concepts = this.level === 'off' ? [] : split.concepts;
    this.history.push({ role: 'user', content: request }, { role: 'assistant', content: shown.slice(0, 1500) });

    blocks = await this.repairIfNeeded(blocks, request);
    const cards = await this.makeProposals(blocks, request, concepts, ctx, opts);
    if (!blocks.length) concepts.forEach(c => this.bumpSeen(c));

    this.logger.log('vibe_reply', undefined, {
      text: shown, concepts, blocks: blocks.length, fencedFallback: usedFallback, planStep: opts.planStep, raw: res.text.slice(0, 4000),
      changes: cards.map(c => ({ id: c.id, path: c.path, status: c.status, added: c.added, removed: c.removed, isNew: c.isNew })),
    }, res.ms);

    const hint = cards.some(c => c.status === 'pending') && this.level === 'guided'
      ? '\n\n_Let\'s walk through it before you accept it._' : '';
    this.view.messages.push({
      id: ++this.msgSeq, role: 'tutor',
      text: (shown || (blocks.length ? 'Here are the changes:' : '(no reply)')) + hint,
      changes: cards.length ? cards : undefined,
    });
    if (cards.some(c => c.status === 'failed')) {
      this.say('system', 'Some edits still didn\'t match your current code, even after a second try.', [
        { label: 'Try again', cmd: 'retryLast' },
        { label: 'Put it in a new file instead', cmd: 'retryNew', primary: true },
      ]);
    }
    if (opts.planStep !== undefined && this.plan && !cards.some(c => c.status === 'pending')) {
      this.plan.steps.forEach(s => { if (s.status === 'doing') s.status = 'todo'; });
    }

    const first = cards.find(c => c.status === 'pending');
    if (first && this.level === 'guided') await this.startStage(first.id, 'tour');
  }

  private async makeProposals(blocks: EditBlock[], request: string, concepts: string[], ctx: ProjectContext, opts: { planStep?: number; planAll?: boolean }): Promise<VibeChange[]> {
    const folder = ctx.folder;
    if (!blocks.length) return [];
    if (!folder) {
      this.say('system', 'Open a folder so I can apply changes to your files.');
      return [];
    }
    const byPath = new Map<string, EditBlock[]>();
    for (const b of blocks) byPath.set(b.path, [...(byPath.get(b.path) ?? []), b]);

    const cards: VibeChange[] = [];
    for (const [p, bs] of byPath) {
      const uri = vscode.Uri.joinPath(folder, ...p.split('/'));
      const old = await readCurrent(uri);
      const r = applyBlocks(old, bs);
      const card: VibeChange = {
        id: `c${++this.changeSeq}`, path: p, isNew: old === undefined, added: r.added, removed: r.removed,
        status: r.applied ? 'pending' : 'failed',
        note: r.failed ? `${r.failed} of ${bs.length} edit${bs.length > 1 ? 's' : ''} didn't match the current code` : undefined,
      };
      cards.push(card);
      if (r.applied) {
        this.proposals.set(card.id, {
          id: card.id, path: p, blocks: bs, oldContent: old, newContent: r.content, request, concepts, card,
          planStep: opts.planStep, planAll: opts.planAll, viewedDiff: false, toured: false,
          learn: { tour: 'todo', predict: /\.(py|js)$/.test(p) ? 'todo' : 'na', check: 'todo', challenge: 'todo' },
        });
      }
    }
    return cards;
  }

  // ================================================================== plan + think first

  private async makePlan(request: string, ctx: ProjectContext): Promise<boolean> {
    this.setBusy(true, 'Planning the steps…');
    const res = await this.askJson<{ goal: string; steps: { title: string; detail: string }[]; think_question?: string }>(
      P.PLAN_SYSTEM, P.planPrompt(this.listing(ctx), request),
      v => Array.isArray(v.steps) && v.steps.length >= 2 && v.steps.every(s => typeof s?.title === 'string'), this.recentHistory()
    );
    this.setBusy(false);
    if (!res) return false;

    const steps = res.steps.slice(0, 5).map(s => ({ title: stripThinking(s.title), detail: stripThinking(String(s.detail ?? '')), status: 'todo' as const }));
    this.plan = { goal: stripThinking(String(res.goal || request)), steps, request };
    const list = steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.detail}`).join('\n');
    this.history.push({ role: 'user', content: request }, { role: 'assistant', content: `Plan:\n${list}` });
    this.logger.log('vibe_plan', undefined, { goal: this.plan.goal, steps: steps.map(s => s.title), thinkQuestion: res.think_question });

    const intro = `Let's build this in **${steps.length} small steps** — that's how experienced vibe coders work: build a little, check it runs, then add more.\n\n${list}`;
    const q = res.think_question ? stripThinking(res.think_question) : '';
    if (q) {
      const msg = this.say('tutor', `${intro}\n\n**Before I write step 1, have a think:** ${q}\n\n_Type your idea below — a sentence in plain words is plenty. I'll build it your way if it works._`, [
        { label: 'Skip — build step 1', cmd: 'skipThink' },
        { label: 'Build everything at once', cmd: 'buildAll' },
      ]);
      this.plan.think = { question: q, msgId: msg.id };
      this.awaiting = { kind: 'think' };
    } else {
      this.say('tutor', intro, [{ label: 'Build step 1', cmd: 'buildNext', primary: true }, { label: 'Build everything at once', cmd: 'buildAll' }]);
    }
    return true;
  }

  private async handleThink(text: string) {
    const plan = this.plan;
    this.awaiting = undefined;
    if (!plan?.think) return;
    plan.think.answer = text;
    this.clearButtons(plan.think.msgId);
    this.say('student', text);
    this.logger.log('vibe_learn', undefined, { kind: 'think_answer', question: plan.think.question, answer: text });
    await this.buildStep(this.nextStepIndex() ?? 0, false);
  }

  private nextStepIndex(): number | undefined {
    const i = this.plan?.steps.findIndex(s => s.status !== 'done');
    return i === undefined || i < 0 ? undefined : i;
  }

  private async buildStep(k: number, all: boolean) {
    const plan = this.plan;
    if (!plan || k >= plan.steps.length) return;
    if (this.awaiting?.kind === 'think') {
      this.awaiting = undefined;
      if (plan.think) {
        this.clearButtons(plan.think.msgId);
        this.logger.log('vibe_learn', undefined, { kind: 'think_skipped', question: plan.think.question });
      }
    }
    const steps = all ? plan.steps.slice(k).filter(s => s.status !== 'done') : [plan.steps[k]];
    steps.forEach(s => (s.status = 'doing'));
    const request = all
      ? `Build all remaining steps of the plan: ${steps.map(s => s.title).join('; ')}.`
      : `Build step ${k + 1} of the plan: ${plan.steps[k].title} — ${plan.steps[k].detail}`;
    this.setBusy(true, 'Reading your project…');
    const ctx = await buildContext(this.maxChars, this.projectDir);
    await this.act(request, ctx, { planStep: k, planAll: all });
  }

  private hasPendingFor(step: number): boolean {
    return [...this.proposals.values()].some(p => p.planStep === step && p.card.status === 'pending');
  }

  // ================================================================== change actions

  async action(cmd: string, arg?: string) {
    if (this.view.busy) return;
    const a = arg === undefined ? '' : String(arg);
    try {
      switch (cmd) {
        case 'viewDiff': await this.viewDiff(a); break;
        case 'accept': await this.accept(a); break;
        case 'reject': this.reject(a); break;
        case 'acceptAll': {
          const ids = [...this.proposals.values()].filter(p => p.card.status === 'pending' && this.msgOf(p.id) === this.msgOf(a)).map(p => p.id);
          for (const id of ids) await this.accept(id, true);
          if (ids.length) await this.advance(ids[0]);
          break;
        }
        case 'stage': {
          const [id, stage] = a.split(':');
          if (STAGES.includes(stage as Stage)) await this.startStage(id, stage as Stage);
          break;
        }
        case 'tourNext': await this.tourMove(1); break;
        case 'tourPrev': await this.tourMove(-1); break;
        case 'tourEnd': await this.endTour(this.tour ? this.tour.index >= this.tour.stops.length - 1 : false); break;
        case 'skipPredict': await this.skipPredict(); break;
        case 'challengeHint': this.challengeHint(a); break;
        case 'challengeCheck': await this.challengeCheck(a); break;
        case 'challengeSkip': await this.challengeSkip(a); break;
        case 'skipThink': await this.buildStep(this.nextStepIndex() ?? 0, false); break;
        case 'buildNext': {
          const k = this.nextStepIndex();
          if (k !== undefined) await this.buildStep(k, false);
          break;
        }
        case 'buildAll': {
          const k = this.nextStepIndex();
          if (k !== undefined) await this.buildStep(k, true);
          break;
        }
        case 'dropPlan':
          this.logger.log('vibe_plan', undefined, { dropped: true });
          this.plan = undefined;
          if (this.awaiting?.kind === 'think') this.awaiting = undefined;
          break;
        case 'quizProject': await this.quizProject(); break;
        case 'skipQuiz': await this.endQuiz(true); break;
        case 'explainError': await this.explainError(Number(a)); break;
        case 'explainSelection': await this.explainSelection(); break;
        case 'runFile': await this.runActiveFile(); break;
        case 'setTarget': this.setTarget(a); break;
        case 'setLevel': this.setLevel(a); break;
        case 'newProject': await this.newProject(); break;
        case 'leaveProject': await this.leaveProject(); break;
        case 'retryLast':
        case 'retryNew': {
          const last = this.lastRequest;
          if (!last) break;
          this.view.messages.forEach(m => { if (m.buttons?.some(b => b.cmd === 'retryLast')) m.buttons = undefined; });
          // "Put it in a new file" applies to this retry only; the picker keeps its own choice.
          const prev = this.target;
          if (cmd === 'retryNew') this.target = 'new';
          this.setBusy(true, 'Reading your project…');
          try {
            await this.act(last.text, await buildContext(this.maxChars, this.projectDir), last.opts);
          } finally {
            this.target = prev;
          }
          break;
        }
      }
    } catch (err: any) {
      this.setBusy(false);
      this.say('system', `⚠️ ${err?.message || err}`);
    }
    this.refresh();
  }

  private msgOf(changeId: string): number | undefined {
    return this.view.messages.find(m => m.changes?.some(c => c.id === changeId))?.id;
  }

  private fileUri(rel: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, ...rel.split('/'));
  }

  private async viewDiff(id: string) {
    const p = this.proposals.get(id);
    if (!p) return;
    p.viewedDiff = true;
    const name = path.posix.basename(p.path);
    const right = ProposedContent.put(id, name, p.newContent);
    const left = p.oldContent === undefined ? ProposedContent.put(`${id}-empty`, name, '') : this.fileUri(p.path);
    this.logger.log('vibe_change', undefined, { id, path: p.path, status: 'viewed_diff' });
    await vscode.commands.executeCommand('vscode.diff', left, right, `${p.path}: current ↔ proposed`, { preview: true });
  }

  private async accept(id: string, batch = false) {
    const p = this.proposals.get(id);
    if (!p || p.card.status !== 'pending') return;
    const uri = this.fileUri(p.path);

    const current = await readCurrent(uri);
    // Re-apply to what is on disk/in the editor now, in case the student edited since the proposal.
    let content = p.newContent;
    if (current !== p.oldContent) {
      const r = applyBlocks(current, p.blocks);
      if (!r.applied) {
        p.card.status = 'failed';
        p.card.note = 'The file changed since this was proposed — ask again.';
        this.logger.log('vibe_change', undefined, { id, path: p.path, status: 'stale' });
        return;
      }
      content = r.content;
    }
    if (this.tour?.id === id) await this.endTour(false, true);

    if (current === undefined) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), content);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: false });

    p.card.status = 'accepted';
    const reviewed = p.toured || p.viewedDiff;
    this.stats.accepted++;
    if (reviewed) this.stats.reviewed++;
    p.concepts.forEach(c => this.bumpSeen(c));
    for (const other of this.proposals.values()) {
      if (other.challenge?.open && other.path === p.path) other.challenge.viaAi = true;
    }
    if (this.plan && p.planStep !== undefined) {
      const from = p.planStep;
      const to = p.planAll ? this.plan.steps.length - 1 : from;
      for (let i = from; i <= to; i++) this.plan.steps[i].status = 'done';
    }
    this.logger.log('vibe_change', undefined, {
      id, path: p.path, status: 'accepted', reviewedBeforeAccept: reviewed, toured: p.toured, viewedDiff: p.viewedDiff,
      added: p.card.added, removed: p.card.removed, isNew: p.card.isNew, planStep: p.planStep, content,
    });
    void this.touchNow();
    if (!batch) await this.advance(id);
  }

  private reject(id: string) {
    const p = this.proposals.get(id);
    if (!p || p.card.status !== 'pending') return;
    p.card.status = 'rejected';
    if (this.tour?.id === id) void this.endTour(false, true);
    if (this.plan && p.planStep !== undefined && !this.hasPendingFor(p.planStep)) {
      this.plan.steps.forEach(s => { if (s.status === 'doing') s.status = 'todo'; });
    }
    this.logger.log('vibe_change', undefined, { id, path: p.path, status: 'rejected', toured: p.toured, viewedDiff: p.viewedDiff });
  }

  // ================================================================== learning loop

  private async startStage(id: string, stage: Stage) {
    const p = this.proposals.get(id);
    if (!p || this.level === 'off' || this.quiz || this.tour || this.awaiting) return;
    if (p.learn[stage] === 'na') return;
    if (stage !== 'tour' && p.card.status !== 'accepted') {
      this.say('system', 'Accept the change first — then we can run it and check it together.');
      return;
    }
    switch (stage) {
      case 'tour': return this.startTour(p);
      case 'predict': return this.startPredict(p);
      case 'check': return this.startCheck(p);
      case 'challenge': return this.startChallenge(p);
    }
  }

  private async markStage(id: string, stage: Stage, status: StageStatus) {
    const p = this.proposals.get(id);
    if (!p) return;
    p.learn[stage] = status;
    this.logger.log('vibe_learn', undefined, { kind: 'stage', id, stage, status });
    if (status !== 'active') await this.advance(id);
  }

  /** Guided mode: start the next learning step for this change. Both modes: offer the next plan step when done. */
  private async advance(id: string) {
    const p = this.proposals.get(id);
    if (!p) return;
    if (this.level === 'guided') {
      for (const s of STAGES) {
        const st = p.learn[s];
        if (st === 'done' || st === 'skipped' || st === 'na') continue;
        if (st === 'active') return;
        if (s !== 'tour' && p.card.status !== 'accepted') return;
        return this.startStage(id, s);
      }
    }
    if (p.card.status === 'accepted') this.offerNextStep(p);
  }

  private offerNextStep(p: Proposal) {
    if (!this.plan || p.planStep === undefined || p.nextPrompted) return;
    p.nextPrompted = true;
    const k = this.nextStepIndex();
    if (k === undefined) {
      this.say('tutor', `🎉 All ${this.plan.steps.length} steps of the plan are built. Try **Quiz me on my program** in Your progress, or ask for a new feature.`);
      this.logger.log('vibe_plan', undefined, { completed: true });
      return;
    }
    this.say('tutor', `Step ${p.planStep + 1} done ✔. Next up — **step ${k + 1}: ${this.plan.steps[k].title}**.\n\n_Tip: try describing step ${k + 1} in your own words (what it should do, what goes in, what comes out) — or just press the button._`,
      [{ label: `Build step ${k + 1}`, cmd: 'buildNext', primary: true }]);
  }

  // ---- 1. Walkthrough (Investigate), shown in the real editor
  private async startTour(p: Proposal) {
    const pending = p.card.status === 'pending';
    const content = pending ? p.newContent : ((await readCurrent(this.fileUri(p.path))) ?? p.newContent);
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    this.setBusy(true, 'Preparing a walkthrough…');
    const res = await this.askJson<{ stops: { start: number; end?: number; title: string; text: string }[] }>(
      P.TOUR_SYSTEM, P.tourPrompt(p.path, numbered(lines), changeText(p), p.request, this.plan?.think?.answer),
      v => Array.isArray(v.stops) && v.stops.length > 0
    );
    this.setBusy(false);
    const stops = (res?.stops ?? [])
      .map(s => {
        const start = clamp(Number(s.start) || 1, 1, lines.length);
        return { start, end: clamp(Number(s.end ?? s.start) || start, start, Math.min(lines.length, start + 14)), title: stripThinking(String(s.title ?? '')), text: stripThinking(String(s.text ?? '')) };
      })
      .filter(s => s.text)
      .slice(0, 7);
    if (!stops.length) {
      this.say('system', 'I couldn\'t prepare a walkthrough for that change.');
      return this.markStage(p.id, 'tour', 'na');
    }

    const uri = pending ? ProposedContent.put(`${p.id}-tour`, path.posix.basename(p.path), content) : this.fileUri(p.path);
    this.tour = { id: p.id, stops, index: 0, uri, pending };
    p.learn.tour = 'active';
    this.logger.log('vibe_learn', undefined, { kind: 'tour_start', id: p.id, stops: stops.length, pending });
    await this.showTourStop();
  }

  private async showTourStop() {
    const t = this.tour;
    if (!t) return;
    const stop = t.stops[t.index];
    try {
      const doc = await vscode.workspace.openTextDocument(t.uri);
      const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: true });
      const range = new vscode.Range(stop.start - 1, 0, stop.end - 1, doc.lineAt(Math.min(stop.end - 1, doc.lineCount - 1)).text.length);
      if (t.editor && t.editor !== ed) t.editor.setDecorations(this.tourDeco(), []);
      ed.setDecorations(this.tourDeco(), [range]);
      ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      t.editor = ed;
    } catch { /* editor may be closed; the panel still shows the text */ }
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
    t.editor?.setDecorations(this.tourDeco(), []);
    const p = this.proposals.get(t.id);
    if (!p) return;
    const status: StageStatus = finished || t.index > 0 ? 'done' : 'skipped';
    p.toured = p.toured || status === 'done';
    p.learn.tour = status;
    this.logger.log('vibe_learn', undefined, { kind: 'tour_end', id: t.id, reachedStop: t.index + 1, of: t.stops.length, status });
    if (silent) return;
    if (p.card.status === 'pending') {
      this.say('tutor', 'That\'s the walkthrough. If it makes sense, press **Accept** on the change — or ask me about anything that\'s unclear first.');
      return;
    }
    await this.advance(p.id);
  }

  private tourDeco(): vscode.TextEditorDecorationType {
    if (!this.deco) {
      this.deco = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.wordHighlightStrongForeground'),
        borderWidth: '0 0 0 3px',
        borderStyle: 'solid',
        borderColor: new vscode.ThemeColor('focusBorder'),
      });
      this.context.subscriptions.push(this.deco);
    }
    return this.deco;
  }

  // ---- 2. Predict, then run (the program really runs; its output is the ground truth)
  private async startPredict(p: Proposal) {
    const lang = p.path.endsWith('.py') ? 'python' : p.path.endsWith('.js') ? 'javascript' : undefined;
    if (!lang) return this.markStage(p.id, 'predict', 'na');
    const uri = this.fileUri(p.path);
    const code = (await readCurrent(uri)) ?? '';

    this.setBusy(true, 'Getting ready to run your program…');
    let stdin = '';
    if (INPUT_RE.test(code)) {
      const r = await this.askJson<{ stdin: string }>(P.RUN_INPUT_SYSTEM, `${p.path}:\n${numbered(code.split('\n'))}`, v => typeof v.stdin === 'string');
      stdin = (r?.stdin ?? '').replace(/\\n/g, '\n');
      if (stdin && !stdin.endsWith('\n')) stdin += '\n';
    }
    const run = await runFile(lang, uri.fsPath, stdin);
    this.setBusy(false);

    if (run.error) {
      this.say('system', `I can't run it here: ${run.error}`);
      return this.markStage(p.id, 'predict', 'na');
    }
    if (run.timedOut) {
      this.say('system', 'Your program didn\'t finish within a few seconds (it may be waiting for input or looping forever), so I\'ll skip the prediction.');
      return this.markStage(p.id, 'predict', 'na');
    }
    const out = run.stdout.replace(/\s+$/, '');
    const err = run.stderr.trim();
    if (!out && err) {
      this.reportCrash(p.path, err);
      return this.markStage(p.id, 'predict', 'na');
    }
    if (!out) {
      this.say('system', `\`${p.path}\` doesn't print anything when it runs, so there's nothing to predict yet.`);
      return this.markStage(p.id, 'predict', 'na');
    }
    const truth = out + (err ? `\n[error]\n${err}` : '');
    const inputNote = stdin.trim() ? `It will be given this input:\n\`\`\`\n${stdin.trimEnd()}\n\`\`\`\n` : '';
    const msg = this.say('tutor',
      `🔮 **Predict, then run.** ${inputNote}Before I run \`${p.path}\`, what do you think it will print? Type your best guess — a wrong guess is useful too, it shows us what to look at.`,
      [{ label: 'Skip', cmd: 'skipPredict' }]);
    this.awaiting = { kind: 'predict', id: p.id, truth, stdin, msgId: msg.id };
    p.learn.predict = 'active';
    this.logger.log('vibe_learn', undefined, { kind: 'predict_start', id: p.id, stdin, actual: truth });
  }

  private async handlePrediction(text: string) {
    const a = this.awaiting;
    if (a?.kind !== 'predict') return;
    this.awaiting = undefined;
    this.clearButtons(a.msgId);
    this.say('student', text);
    const p = this.proposals.get(a.id)!;

    let correct = norm(text) === norm(a.truth);
    let feedback = 'Spot on — that\'s exactly what it prints.';
    if (!correct) {
      this.setBusy(true, 'Running it and comparing…');
      const code = (await readCurrent(this.fileUri(p.path))) ?? '';
      const r = await this.askJson<{ correct: boolean; feedback: string }>(
        P.PREDICT_FEEDBACK_SYSTEM, P.predictFeedbackPrompt(p.path, numbered(code.split('\n')), a.stdin, a.truth, text),
        v => typeof v.correct === 'boolean'
      );
      this.setBusy(false);
      correct = !!r?.correct;
      feedback = r?.feedback ? stripThinking(r.feedback) : 'Compare your guess with the real output below.';
    }
    this.stats.predTotal++;
    if (correct) this.stats.predRight++;
    this.logger.log('vibe_learn', undefined, { kind: 'predict_answer', id: a.id, prediction: text, actual: a.truth, correct });
    this.say('tutor', `${correct ? '✅' : '🔍'} ${feedback}\n\n**What it actually printed:**\n\`\`\`\n${a.truth}\n\`\`\``);
    await this.markStage(a.id, 'predict', 'done');
  }

  private async skipPredict() {
    const a = this.awaiting;
    if (a?.kind !== 'predict') return;
    this.awaiting = undefined;
    this.clearButtons(a.msgId);
    this.say('tutor', `Here's what it prints:\n\`\`\`\n${a.truth}\n\`\`\``);
    await this.markStage(a.id, 'predict', 'skipped');
  }

  // ---- 3. Check (multiple choice on this change)
  private async startCheck(p: Proposal) {
    const after = (await readCurrent(this.fileUri(p.path))) ?? p.newContent;
    this.setBusy(true, 'Preparing a quick check…');
    const res = await this.askJson<{ questions: Mcq[] }>(
      P.CHANGE_QUIZ_SYSTEM,
      P.changeQuizPrompt(p.path, changeText(p), numbered(after.replace(/\r\n/g, '\n').split('\n')).slice(0, 16000), p.request, this.perChange),
      validQuiz
    );
    this.setBusy(false);
    if (!res) {
      this.say('system', 'I couldn\'t build a question for that change.');
      return this.markStage(p.id, 'check', 'na');
    }
    p.learn.check = 'active';
    this.startQuiz('change', res.questions.slice(0, this.perChange), p.concepts, p.id);
  }

  // ---- 4. Your turn (Modify)
  private async startChallenge(p: Proposal) {
    const code = (await readCurrent(this.fileUri(p.path))) ?? p.newContent;
    this.setBusy(true, 'Thinking of a challenge for you…');
    const res = await this.askJson<{ task: string; hint: string; criteria: string }>(
      P.CHALLENGE_SYSTEM, P.challengePrompt(p.path, numbered(code.split('\n')), p.request, p.concepts),
      v => typeof v.task === 'string' && v.task.length > 5
    );
    this.setBusy(false);
    if (!res) return this.markStage(p.id, 'challenge', 'na');

    const task = stripThinking(res.task);
    const msg = this.say('tutor',
      `🛠 **Your turn:** ${task}\n\nChange \`${p.path}\` yourself in the editor, **or** practise vibe coding by asking me to do it — describe exactly what should happen. Then press **Check my work**.`,
      [
        { label: 'Hint', cmd: 'challengeHint', arg: p.id },
        { label: 'Check my work', cmd: 'challengeCheck', arg: p.id, primary: true },
        { label: 'Skip', cmd: 'challengeSkip', arg: p.id },
      ]);
    p.challenge = { task, hint: stripThinking(String(res.hint ?? '')), criteria: String(res.criteria ?? ''), baseline: code, msgId: msg.id, viaAi: false, open: true };
    p.learn.challenge = 'active';
    this.stats.chGiven++;
    this.logger.log('vibe_learn', undefined, { kind: 'challenge_start', id: p.id, task, criteria: res.criteria });
  }

  private challengeHint(id: string) {
    const c = this.proposals.get(id)?.challenge;
    if (!c?.open) return;
    const m = this.view.messages.find(x => x.id === c.msgId);
    if (m?.buttons) m.buttons = m.buttons.filter(b => b.cmd !== 'challengeHint');
    this.say('tutor', `💡 ${c.hint || 'Look at the part of the code that decides the result you want to change.'}`);
    this.logger.log('vibe_learn', undefined, { kind: 'challenge_hint', id });
  }

  private async challengeCheck(id: string) {
    const p = this.proposals.get(id);
    const c = p?.challenge;
    if (!p || !c?.open) return;
    const now = (await readCurrent(this.fileUri(p.path))) ?? '';
    if (now === c.baseline) {
      this.say('system', `I don't see any changes in \`${p.path}\` yet. Edit it (and save), or ask me to make the change, then press **Check my work** again.`);
      return;
    }
    this.setBusy(true, 'Checking your work…');
    const r = await this.askJson<{ done: boolean; feedback: string }>(
      P.CHALLENGE_CHECK_SYSTEM,
      P.challengeCheckPrompt(c.task, c.criteria, p.path, numbered(c.baseline.split('\n')), numbered(now.split('\n'))),
      v => typeof v.done === 'boolean'
    );
    this.setBusy(false);
    const done = !!r?.done;
    this.logger.log('vibe_learn', undefined, { kind: 'challenge_check', id, done, via: c.viaAi ? 'ai' : 'self', code: now });
    this.say('tutor', `${done ? '🎉' : '🔍'} ${r?.feedback ? stripThinking(r.feedback) : (done ? 'Looks done!' : 'Not quite yet.')}`);
    if (!done) return;
    c.open = false;
    this.stats.chDone++;
    this.clearButtons(c.msgId);
    await this.markStage(id, 'challenge', 'done');
  }

  private async challengeSkip(id: string) {
    const p = this.proposals.get(id);
    const c = p?.challenge;
    if (!p || !c?.open) return;
    c.open = false;
    this.clearButtons(c.msgId);
    this.logger.log('vibe_learn', undefined, { kind: 'challenge_skip', id });
    await this.markStage(id, 'challenge', 'skipped');
  }

  // ================================================================== quizzes

  private async quizProject() {
    if (this.level === 'off' || this.quiz || this.awaiting) return;
    this.setBusy(true, 'Reading your program…');
    const ctx = await buildContext(this.maxChars, this.projectDir);
    if (!ctx.fileCount) { this.setBusy(false); this.say('system', 'There\'s no code in this folder to quiz you on yet.'); return; }
    this.setBusy(true, 'Writing your quiz…');
    const res = await this.askJson<{ questions: Mcq[] }>(P.PROJECT_QUIZ_SYSTEM, P.projectQuizPrompt(ctx.text, this.projectQuizCount, this.askedQuiz.slice(-12)), validQuiz);
    this.setBusy(false);
    if (!res) { this.say('system', 'I couldn\'t build a quiz just now — try again in a moment.'); return; }
    this.startQuiz('project', res.questions.slice(0, this.projectQuizCount), [], undefined);
  }

  private startQuiz(kind: QuizState['kind'], raw: Mcq[], fallbackConcepts: string[], changeId: string | undefined) {
    const items = raw.map(q => shuffle({
      stem: stripThinking(String(q.stem)), choices: q.choices.map(String), correct: q.correct,
      explanation: stripThinking(String(q.explanation ?? '')), concept: q.concept ? String(q.concept).toLowerCase().trim() : undefined,
    }));
    this.quiz = { kind, items, index: 0, right: 0, changeId, fallbackConcepts };
    this.say('tutor', kind === 'change'
      ? '✅ **Quick check** on the change you just accepted:'
      : `Quiz on your program: ${items.length} question${items.length > 1 ? 's' : ''}.`);
    this.logQuizQuestion();
  }

  private logQuizQuestion() {
    const q = this.quiz!;
    const item = q.items[q.index];
    this.askedQuiz.push(item.stem.slice(0, 160));
    this.logger.log('vibe_quiz_question', undefined, { kind: q.kind, changeId: q.changeId, index: q.index, stem: item.stem, choices: item.choices, correctIndex: item.correct, concept: item.concept });
  }

  async answerQuiz(choice: number) {
    const q = this.quiz;
    if (!q || this.view.busy || !(choice >= 0 && choice <= 3)) return;
    const item = q.items[q.index];
    const correct = choice === item.correct;
    const L = (i: number) => 'ABCD'[i];
    this.logger.log('vibe_quiz_response', undefined, { kind: q.kind, changeId: q.changeId, index: q.index, chosen: choice, correct });

    if (correct) q.right++;
    this.stats.checkTotal++;
    if (correct) this.stats.checkRight++;
    const names = item.concept ? [item.concept] : q.fallbackConcepts.slice(0, 1);
    names.forEach(n => this.bumpScore(n, correct));

    this.say('student', `${L(choice)}. ${item.choices[choice]}`);
    this.say('tutor', (correct ? '✅ Correct. ' : `Not quite — the answer is **${L(item.correct)}. ${item.choices[item.correct]}**. `) + item.explanation);
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
      this.logger.log('vibe_quiz_response', undefined, { kind: q.kind, changeId: q.changeId, skippedAt: q.index });
      this.say('system', 'Quiz skipped.');
    } else if (q.items.length > 1) {
      this.say('tutor', `You got **${q.right} of ${q.items.length}**. ` + (q.right === q.items.length ? 'Nice work!' : 'Ask me about anything that didn\'t click.'));
    }
    if (q.kind === 'change' && q.changeId) await this.markStage(q.changeId, 'check', skipped ? 'skipped' : 'done');
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

  // ================================================================== editor helpers

  async explainSelection() {
    await this.ensureStarted();
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) {
      this.say('system', 'Select some code in the editor first.');
      return this.refresh();
    }
    await this.send('Explain what the selected code does and why it works this way.');
  }

  async changeSelection() {
    await this.ensureStarted();
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) {
      void vscode.window.showInformationMessage('Select the code you want to change first.');
      return;
    }
    const instruction = await vscode.window.showInputBox({ prompt: 'How should the selected code change?', placeHolder: 'e.g. make it ignore negative numbers' });
    if (instruction?.trim()) await this.send(instruction);
  }

  private async runActiveFile() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== 'file') { this.say('system', 'Open the file you want to run in the editor first.'); return; }
    const lang = ed.document.languageId;
    if (lang !== 'python' && lang !== 'javascript') { this.say('system', `I can only run Python or JavaScript files from here (this is ${lang}).`); return; }
    if (ed.document.isDirty) await ed.document.save();
    const rel = vscode.workspace.asRelativePath(ed.document.uri, false);
    const code = ed.document.getText();

    if (INPUT_RE.test(code)) {
      // Interactive programs need a real terminal so the student can type input.
      const exe = lang === 'python' ? interpreterFor('python').cmd : 'node';
      if (!this.terminal || this.terminal.exitStatus) this.terminal = vscode.window.createTerminal('VibeLearner');
      this.terminal.show(true);
      this.terminal.sendText(`${exe} "${ed.document.uri.fsPath}"`);
      this.say('system', `▶ Running \`${rel}\` in the terminal below (it asks for input there).`);
      this.logger.log('program_run', undefined, { via: 'terminal', file: rel });
      return;
    }
    this.setBusy(true, 'Running…');
    const run = await runFile(lang, ed.document.uri.fsPath, '');
    this.setBusy(false);
    this.logger.log('program_run', undefined, { via: 'panel', file: rel, stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut, error: run.error });
    if (run.error) { this.say('system', `I can't run it here: ${run.error}`); return; }
    if (run.timedOut) { this.say('system', `\`${rel}\` didn't finish within 8 seconds — is there a loop that never ends?`); return; }
    this.say('system', `▶ Output of \`${rel}\`:\n\`\`\`\n${run.stdout.replace(/\s+$/, '') || '(nothing printed)'}\n\`\`\``);
    if (run.stderr.trim()) this.reportCrash(rel, run.stderr.trim());
  }

  private reportCrash(file: string, err: string) {
    const idx = this.errors.push({ path: file, err }) - 1;
    // Show the line that names the error (e.g. "ReferenceError: foo is not defined"), not the runtime's footer.
    const lines = err.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const last = lines.find(l => /^\w*(Error|Exception)\b|^\w+Error:|Traceback/.test(l) && !/^Traceback/.test(l)) ?? lines.pop() ?? err;
    this.say('tutor',
      `💥 \`${file}\` crashed:\n\`\`\`\n${last.slice(0, 300)}\n\`\`\`\nErrors are clues, not failures. Want me to explain what this one means?`,
      this.level === 'off' ? [] : [{ label: 'Explain this error', cmd: 'explainError', arg: String(idx), primary: true }]);
  }

  private async explainError(idx: number) {
    const e = this.errors[idx];
    if (!e) return;
    this.view.messages.forEach(m => { if (m.buttons?.some(b => b.cmd === 'explainError' && b.arg === String(idx))) m.buttons = undefined; });
    await this.send(`My program \`${e.path}\` crashed with this error:\n\`\`\`\n${e.err.slice(0, 1500)}\n\`\`\`\nWhat does this error mean and why does it happen? Then fix it.`);
  }

  // ================================================================== target, project, level

  private setTarget(t: string) {
    const ok = t === 'auto' || t === 'new' || this.view.targets.includes(t);
    this.target = ok ? t : 'auto';
    this.logger.log('vibe_learn', undefined, { kind: 'set_target', target: this.target });
  }

  private setLevel(l: string) {
    if (this.view.logging) return; // study conditions are fixed for the session
    const level = parseLevel(l);
    if (level === this.level) return;
    this.level = level;
    if (level === 'off') {
      if (this.tour) void this.endTour(false, true);
      this.quiz = undefined;
      this.awaiting = undefined;
    }
    const desc = level === 'guided' ? 'I\'ll walk you through each change automatically.'
      : level === 'light' ? 'Learning tools are on the change cards whenever you want them.'
      : 'Just coding — no teaching extras.';
    this.say('system', `Learning level: **${level}**. ${desc}`);
  }

  private async newProject() {
    const name = await vscode.window.showInputBox({
      prompt: 'Name your new project. A folder with this name is created, and VibeLearner works only inside it.',
      value: 'my-project',
      validateInput: v => /^[\w-]{1,40}$/.test(v.trim()) ? undefined : 'Use letters, numbers, - or _ (no spaces).',
    });
    if (!name?.trim()) return;
    const dir = name.trim();
    await vscode.workspace.fs.createDirectory(this.fileUri(dir));
    this.projectDir = dir;
    this.plan = undefined;
    this.history = [];
    this.clarRound = 0;
    this.awaiting = undefined;
    this.target = 'auto';
    this.logger.log('vibe_plan', undefined, { newProject: dir });
    await this.touchNow();
    this.say('tutor', `📂 New project **${dir}/**. I'll put its files in that folder and only look at that folder. What do you want to build?`);
  }

  private async leaveProject() {
    if (!this.projectDir) return;
    this.say('system', `Left project ${this.projectDir}/ — I can see the whole workspace again.`);
    this.projectDir = undefined;
    this.plan = undefined;
    await this.touchNow();
  }

  /** If some SEARCH text doesn't match, ask the model once more with the exact file contents. */
  private async repairIfNeeded(blocks: EditBlock[], request: string): Promise<EditBlock[]> {
    if (!blocks.length || !vscode.workspace.workspaceFolders?.length) return blocks;
    const ok: EditBlock[] = [];
    const bad: EditBlock[] = [];
    const contents = new Map<string, string | undefined>();
    const byPath = new Map<string, EditBlock[]>();
    for (const b of blocks) byPath.set(b.path, [...(byPath.get(b.path) ?? []), b]);
    for (const [p, bs] of byPath) {
      let cur = await readCurrent(this.fileUri(p));
      contents.set(p, cur);
      for (const b of bs) {
        const r = applyBlocks(cur, [b]);
        if (r.applied) { ok.push(b); cur = r.content; } else bad.push(b);
      }
    }
    if (!bad.length) return blocks;

    this.setBusy(true, 'Fixing up the edit…');
    const files = [...new Set(bad.map(b => b.path))].map(p => ({ path: p, content: contents.get(p) }));
    const res = await callBackend({
      model: this.model, system: P.actionSystem(this.level), prompt: P.repairPrompt(request, blocksToText(bad), files),
      temperature: 0, context: this.context,
    });
    this.setBusy(false);
    const fixed = parseBlocks(stripThinking(res.text)).blocks;
    this.logger.log('vibe_change', undefined, { status: 'repair', failed: bad.length, returned: fixed.length, raw: res.text.slice(0, 2000) }, res.ms);
    return [...ok, ...(fixed.length ? fixed : bad)];
  }

  /** Called on editor/selection changes so the header shows what the assistant will look at. */
  touch() {
    if (this.view.stage !== 'chat') return;
    if (this.touchTimer) clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => {
      const info = quickInfo();
      if (info.active !== this.view.ctx.active || info.selection !== this.view.ctx.selection) {
        this.view.ctx = { ...this.view.ctx, ...info };
        this.refresh();
      }
    }, 350);
  }

  private async touchNow() {
    const files = await listFiles(this.projectDir);
    this.view.ctx = { files: files.length, ...quickInfo() };
    this.view.targets = files.slice(0, 80);
    if (this.target !== 'auto' && this.target !== 'new' && !files.includes(this.target)) this.target = 'auto';
    this.refresh();
  }

  // ================================================================== plumbing

  private async guard(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err: any) {
      this.setBusy(false);
      this.logger.log('vibe_error', undefined, { message: String(err?.message || err) });
      this.say('system', `⚠️ ${err?.message || err}`);
    }
    this.refresh();
  }

  private recentHistory(): ChatMsg[] {
    return this.history.slice(-10);
  }

  private async askJson<T>(system: string, prompt: string, valid: (v: T) => boolean, history?: ChatMsg[]): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was not valid JSON in the required format. Reply with ONLY the JSON object.`;
      const res = await callBackend({ model: this.model, system, prompt: p, history, temperature: 0, context: this.context });
      const parsed = extractJson<T>(res.text);
      if (parsed && valid(parsed)) return parsed;
      this.logger.log('parse_failure', undefined, { attempt, raw: res.text.slice(0, 600) }, res.ms);
    }
    return undefined;
  }

  private say(role: VibeMsg['role'], text: string, buttons?: MsgButton[]): VibeMsg {
    const m: VibeMsg = { id: ++this.msgSeq, role, text, buttons: buttons?.length ? buttons : undefined };
    this.view.messages.push(m);
    return m;
  }

  private clearButtons(msgId: number) {
    const m = this.view.messages.find(x => x.id === msgId);
    if (m) m.buttons = undefined;
  }

  private setBusy(busy: boolean, label = '') {
    this.view.busy = busy;
    this.view.busyLabel = label;
    this.refresh();
  }

  private refresh() {
    const v = this.view;
    v.inputEnabled = v.stage === 'chat' && !v.busy && !this.quiz;
    v.project = this.projectDir;
    v.target = this.target;
    v.levelLocked = v.logging;
    v.level = this.level;
    v.placeholder =
      this.awaiting?.kind === 'think' ? 'Your idea, in plain words…'
      : this.awaiting?.kind === 'predict' ? 'What will it print? Your best guess…'
      : this.tour ? 'Ask about this part of the code…'
      : v.ctx.selection ? 'Ask about, or ask to change, the selected code…'
      : 'Describe what to build, change, fix, or explain…';

    const q = this.quiz;
    v.quiz = q ? {
      label: q.kind === 'change' ? 'Check on your change' : 'Quiz on your program',
      index: q.index, total: q.items.length, stem: q.items[q.index].stem, choices: q.items[q.index].choices,
    } : undefined;

    const t = this.tour;
    v.tour = t ? {
      index: t.index, total: t.stops.length, title: t.stops[t.index].title, text: t.stops[t.index].text,
      path: this.proposals.get(t.id)?.path ?? '', start: t.stops[t.index].start, end: t.stops[t.index].end, pending: t.pending,
    } : undefined;

    const plan = this.plan;
    if (plan) {
      const k = this.nextStepIndex();
      const idle = !this.awaiting && !this.quiz && !this.tour && k !== undefined && plan.steps[k].status === 'todo';
      v.plan = {
        goal: plan.goal, steps: plan.steps.map(s => ({ title: s.title, status: s.status })),
        next: idle ? { index: k!, title: plan.steps[k!].title } : undefined,
        remaining: plan.steps.filter(s => s.status === 'todo').length,
      };
    } else {
      v.plan = undefined;
    }

    for (const p of this.proposals.values()) {
      p.card.learn = this.level === 'off' || p.card.status === 'rejected' || p.card.status === 'failed'
        ? undefined
        : STAGES.map(s => ({ stage: s, label: STAGE_LABEL[s], status: p.learn[s] }));
    }

    v.concepts = this.level === 'off' ? [] : [...this.concepts.entries()]
      .map(([name, c]) => ({ name, ...c }))
      .sort((a, b) => b.seen + b.total - (a.seen + a.total));
    v.skills = this.level === 'off' ? [] : this.skillRows();
    this.onChange(v);
    v.draft = undefined;
  }

  private skillRows(): VibeView['skills'] {
    const s = this.stats;
    const frac = (a: number, b: number) => (b ? `${a}/${b}` : '—');
    let prompting = '—';
    if (s.prompts.length) {
      const recent = s.prompts.slice(-5);
      const avg = recent.reduce((a, n) => a + n, 0) / recent.length;
      let trend = '';
      if (s.prompts.length >= 4) {
        const early = s.prompts.slice(0, 2).reduce((a, n) => a + n, 0) / 2;
        const late = s.prompts.slice(-2).reduce((a, n) => a + n, 0) / 2;
        trend = late > early ? ' ↑' : late < early ? ' ↓' : '';
      }
      prompting = `${avg.toFixed(1)}/6${trend}`;
    }
    return [
      { label: 'Prompting', value: prompting, detail: 'How clearly your requests describe the goal, inputs/outputs and details (average of your last 5).' },
      { label: 'Reviewing', value: frac(s.reviewed, s.accepted), detail: 'Changes you walked through or looked at as a diff before accepting.' },
      { label: 'Predicting', value: frac(s.predRight, s.predTotal), detail: 'Times you correctly predicted what your program prints.' },
      { label: 'Understanding', value: frac(s.checkRight, s.checkTotal), detail: 'Check and quiz questions answered correctly.' },
      { label: 'Modifying', value: frac(s.chDone, s.chGiven), detail: '"Your turn" challenges completed.' },
    ];
  }
}

function parseLevel(l: string | undefined): Level {
  return l === 'off' ? 'off' : l === 'light' || l === 'offer' ? 'light' : 'guided';
}

function changeText(p: Proposal): string {
  return p.blocks.map(b => b.search.trim()
    ? `--- before ---\n${b.search}\n--- after ---\n${b.replace}`
    : `--- whole file ---\n${b.replace}`).join('\n\n').slice(0, 8000);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/["'`[\](),]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function readCurrent(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

function validQuiz(v: { questions: Mcq[] }): boolean {
  return Array.isArray(v.questions) && v.questions.length > 0 && v.questions.every(q =>
    typeof q.stem === 'string' && Array.isArray(q.choices) && q.choices.length === 4 &&
    Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3);
}

function shuffle(q: Mcq): Mcq {
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, choices: order.map(i => q.choices[i]), correct: order.indexOf(q.correct) };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
