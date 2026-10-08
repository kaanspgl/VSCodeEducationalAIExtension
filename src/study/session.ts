import * as vscode from 'vscode';
import { callBackend, ChatMsg } from '../shared/callBackend';
import { StudyLogger } from './logger';
import {
  EVAL_SYSTEM, FOCUS_TYPES, QUIZ_SYSTEM, quizPrompt, FocusType, PROMPT_VERSION, QUESTION_SYSTEM, RUN_CASE_SYSTEM, REVIEW_SYSTEM, Turn,
  reasoningSystemFor, runCasePrompt,
  directSystem, directTaskPreamble, evalPrompt, extractCode, extractJson, generationPrompt, generationSystem,
  questionPrompt, reasoningPrompt, revisionPrompt, reviewPrompt, stripThinking,
} from './prompts';
import { formatReport, interpreterFor, runProgram, runTests, TestReport } from './runner';
import { fnNameFor, getTask, isFree, makeFreeTask, StudyTask, TASKS } from './tasks';

export type Condition = 'vibelearner' | 'direct';
type Phase = 'explain' | 'generating' | 'review' | 'check' | 'chat';

export type ViewMsg = { id: number; role: 'student' | 'tutor' | 'system'; text: string };

export type SessionView = {
  stage: 'setup' | 'task' | 'survey' | 'done';
  condition: Condition;
  participant: string;
  taskIndex: number;
  taskCount: number;
  quiz?: { index: number; total: number; stem: string; choices: string[] };
  task?: { title: string; statement: string; fn: string; language: string; free: boolean };
  steps: string[];
  currentStep: number;
  messages: ViewMsg[];
  busy: boolean;
  busyLabel: string;
  inputEnabled: boolean;
  placeholder: string;
  draft?: string;
  actions: { runTests: boolean; needCode: boolean; ready: boolean; finish: boolean };
  code?: string;
  testSummary?: string;
  logFile?: string;
};

type Question = { focus: FocusType; question: string; expected: string; attempt: number; concept?: string; truth?: string };
type Mcq = { stem: string; choices: string[]; correct: number; explanation: string };
type CompRecord = { focus: string; attempts: { correct: boolean }[] };

const VL_STEPS = ['1 Explain your plan', '2 Get the code', '3 Review it', '4 Check understanding'];

export class StudySession {
  private view: SessionView;
  private msgSeq = 0;

  // configuration snapshot (read at session start so the treatment cannot drift mid-study)
  private condition: Condition = 'vibelearner';
  private language = 'python';
  private model = '';
  private maxClarifications = 2;
  private compCount = 2;
  private taskIds: string[] = [];
  private mode: 'open' | 'tasks' = 'open';
  private spec = '';
  private quizCount = 3;
  private quiz: { items: Mcq[]; index: number } | undefined;
  private quizResults: { correct: boolean }[] = [];
  private quizDone = false;
  private terminal: vscode.Terminal | undefined;

  private participant = '';
  private taskIdx = 0;
  private task!: StudyTask;

  // per-task state
  private phase: Phase = 'explain';
  private taskStart = 0;
  private llmMs = 0;
  private firstPassMs: number | undefined;
  private reasoning: Turn[] = [];
  private clarRound = 0;
  private scaffolded = false;
  private usedFallback = false;
  private pendingChange: { request: string } | undefined;
  private codeUri: vscode.Uri | undefined;
  private lastCode = '';
  private codeVersions = 0;
  private lastReport: TestReport | undefined;
  private question: Question | undefined;
  private asked: string[] = [];
  private compRecords: CompRecord[] = [];
  private compIndex = 0;
  private checkDone = false;
  private directHistory: ChatMsg[] = [];
  private summary: Record<string, unknown> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: StudyLogger,
    private readonly onChange: (v: SessionView) => void
  ) {
    this.view = this.blankView();
  }

  getView(): SessionView {
    return this.view;
  }

  // ------------------------------------------------------------------ setup

  async begin(participant: string, consent: boolean) {
    const code = participant.trim();
    if (!consent) return this.toast('Consent is required before the study can begin.');
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) {
      return this.toast('Participant code must be 2-32 letters, digits, - or _.');
    }

    const cfg = vscode.workspace.getConfiguration('vibelearner');
    this.condition = cfg.get<string>('study.condition') === 'direct' ? 'direct' : 'vibelearner';
    this.language = cfg.get<string>('study.language') === 'javascript' ? 'javascript' : 'python';
    this.model = cfg.get<string>('model') || cfg.get<string>('defaultModel') || 'qwen3-coder:30b';
    this.maxClarifications = clamp(cfg.get<number>('study.maxClarifications') ?? 2, 0, 5);
    this.compCount = clamp(cfg.get<number>('study.comprehensionQuestions') ?? 1, 0, 4);
    this.quizCount = clamp(cfg.get<number>('study.quizQuestions') ?? 3, 0, 6);
    this.mode = cfg.get<string>('study.mode') === 'tasks' ? 'tasks' : 'open';
    const ids = cfg.get<string[]>('study.taskIds') ?? [];
    this.taskIds = ids.filter(id => getTask(id));
    if (!this.taskIds.length) this.taskIds = TASKS.slice(0, 4).map(t => t.id);
    if (this.mode === 'open') this.taskIds = [];

    this.participant = code;
    this.logger.enable(code, this.condition);
    this.logger.log('session_start', undefined, {
      promptVersion: PROMPT_VERSION,
      model: this.model,
      provider: cfg.get('apiProvider'),
      temperature: cfg.get('temperature'),
      language: this.language,
      mode: this.mode,
      taskIds: this.taskIds,
      maxClarifications: this.maxClarifications,
      comprehensionQuestions: this.compCount,
      quizQuestions: this.quizCount,
    });

    this.taskIdx = 0;
    this.startTask();
  }

  // ------------------------------------------------------------------ task lifecycle

  private startTask() {
    this.task = this.mode === 'open' ? makeFreeTask(this.taskIdx + 1) : getTask(this.taskIds[this.taskIdx])!;
    this.spec = '';
    this.quiz = undefined;
    this.quizResults = [];
    this.quizDone = false;
    this.phase = this.condition === 'direct' ? 'chat' : 'explain';
    this.taskStart = Date.now();
    this.llmMs = 0;
    this.firstPassMs = undefined;
    this.reasoning = [];
    this.clarRound = 0;
    this.scaffolded = false;
    this.usedFallback = false;
    this.pendingChange = undefined;
    this.codeUri = undefined;
    this.lastCode = '';
    this.codeVersions = 0;
    this.lastReport = undefined;
    this.question = undefined;
    this.asked = [];
    this.compRecords = [];
    this.compIndex = 0;
    this.checkDone = false;
    this.directHistory = [];
    this.summary = undefined;

    const fn = fnNameFor(this.task, this.language);
    const free = isFree(this.task);
    const taskIntro =
      `**Task ${this.taskIdx + 1} of ${this.taskIds.length}: ${this.task.title}**\n\n${this.task.statement}\n\n` +
      `Name your function \`${fn}\`.\n\n` +
      (this.condition === 'direct'
        ? 'Ask the assistant for what you need. You can request code, ask questions about it, or ask for changes.'
        : 'Before I write any code: in your own words, what should the program do, step by step? ' +
          'Plain English is fine — no pseudocode needed.');
    const intro = free
      ? (this.condition === 'direct'
          ? 'Describe the program you want. You can ask for code, ask how it works, or ask for changes.'
          : '**What would you like to build?**\n\nDescribe it in your own words: what it should do, what goes in, and what should come out. ' +
            'If you\'re not sure how something would work, just say so and I\'ll explain it before we build.')
      : taskIntro;

    this.view = {
      ...this.blankView(),
      stage: 'task',
      condition: this.condition,
      participant: this.participant,
      taskIndex: this.taskIdx,
      taskCount: this.mode === 'open' ? 0 : this.taskIds.length,
      task: { title: this.task.title, statement: this.task.statement, fn, language: this.language, free },
      steps: this.condition === 'direct' ? [] : VL_STEPS,
      messages: [],
      logFile: this.logger.filePath,
    };
    this.logger.log('task_start', this.task.id, { index: this.taskIdx });
    this.say('tutor', intro);
    this.refresh();
  }

  // ------------------------------------------------------------------ student input

  async send(text: string) {
    text = text.trim();
    if (!text || this.view.busy || this.view.stage !== 'task') return;

    const snapshot = { msgs: this.view.messages.length, turns: this.reasoning.length };
    this.say('student', text);
    try {
      switch (this.phase) {
        case 'explain': await this.onExplain(text); break;
        case 'review': await this.onReview(text); break;
        case 'check': await this.onCheckAnswer(text); break;
        case 'chat': await this.onDirect(text); break;
        default: break;
      }
    } catch (err: any) {
      // Roll back so the student can resend the same text without double-counting.
      this.view.messages.length = snapshot.msgs;
      this.reasoning.length = snapshot.turns;
      this.view.draft = text;
      this.setBusy(false);
      this.logger.log('model_error', this.task.id, { message: String(err?.message || err), phase: this.phase });
      this.say('system', `⚠️ ${err?.message || err}\n\nYour message was not lost — press Send to try again.`);
    }
    this.refresh();
  }

  // ---- Phase 1: elicit reasoning
  private async onExplain(text: string) {
    const first = this.reasoning.length === 0;
    this.logger.log(first ? 'student_explanation' : 'clarification_response', this.task.id, { text, round: this.clarRound });
    this.reasoning.push({ role: 'student', text });

    this.setBusy(true, 'Checking your plan…');
    const prompt = reasoningPrompt(this.task, this.language, this.reasoning, this.clarRound + 1, this.maxClarifications);
    const res = await this.askJson<{ verdict: string; reply: string; gap?: string; covered?: number[]; spec?: string }>(
      reasoningSystemFor(this.task), prompt, v => typeof v.verdict === 'string' && typeof v.reply === 'string'
    );
    this.setBusy(false);

    if (!res) {
      // Never trap a student behind a malfunctioning judge: continue to code.
      await this.generate(true, 'judge_parse_failure');
      return;
    }
    if (res.spec) this.spec = String(res.spec);
    if (res.verdict === 'sufficient') {
      this.say('tutor', stripThinking(res.reply));
      await this.generate(false, 'sufficient');
      return;
    }
    if (this.clarRound >= this.maxClarifications) {
      this.say('tutor', 'Thanks — let\'s look at working code now and I\'ll connect it back to the steps you described.');
      await this.generate(true, 'max_clarifications');
      return;
    }
    this.clarRound++;
    const reply = stripThinking(res.reply);
    this.reasoning.push({ role: 'tutor', text: reply });
    this.logger.log('clarification_prompt', this.task.id, { round: this.clarRound, verdict: res.verdict, gap: res.gap, text: reply });
    this.say('tutor', reply);
  }

  /** "I need the code now" fallback. Logged as a secondary measure, not a failure. */
  async needCode() {
    if (this.view.busy || this.phase !== 'explain') return;
    if (isFree(this.task) && !this.reasoning.length) {
      this.say('system', 'Tell me roughly what you want to build first, then I can write it.');
      this.refresh();
      return;
    }
    this.usedFallback = true;
    this.logger.log('fallback_used', this.task.id, { clarRound: this.clarRound, hadExplanation: this.reasoning.length > 0 });
    if (!this.reasoning.length) this.reasoning.push({ role: 'student', text: '(asked for the code without describing a plan)' });
    this.say('tutor', 'No problem — here is the code. After you\'ve looked it over we\'ll still do a quick check on it.');
    try {
      await this.generate(true, 'fallback');
    } catch (err: any) {
      this.setBusy(false);
      this.say('system', `⚠️ ${err?.message || err}`);
    }
    this.refresh();
  }

  // ---- Phase 2: generate + review
  private async generate(scaffolded: boolean, status: string) {
    this.scaffolded = scaffolded;
    this.logger.log('reasoning_status', this.task.id, { status, scaffolded, clarificationRounds: this.clarRound });
    this.phase = 'generating';
    this.setBusy(true, 'Writing code…');
    this.refresh();

    const { text, ms } = await this.ask(
      generationSystem(this.language, isFree(this.task)),
      generationPrompt(this.task, this.language, this.reasoning, scaffolded, this.spec),
      undefined, undefined, 'generate'
    );
    const { code, rest } = extractCode(text);
    this.setBusy(false);
    if (!code) {
      this.phase = 'explain';
      throw new Error('The model did not return code. Press Send (or "I need the code now") to try again.');
    }
    await this.setCode(code);
    this.logger.log('code_generated', this.task.id, { version: this.codeVersions, reason: 'initial', code }, ms);
    this.phase = 'review';
    this.say('tutor',
      'Here\'s your code — it\'s open in the editor. Read it, run it, and try **' + (isFree(this.task) ? 'Run program' : 'Run tests') + '**.\n\n' + (rest || '') +
      '\n\nAsk me about any line, or ask for a change. When you\'re ready, press **Start the check**.');
  }

  private async onReview(text: string) {
    await this.syncCode();

    if (this.pendingChange) {
      const request = this.pendingChange.request;
      this.logger.log('change_check_response', this.task.id, { request, text });
      this.pendingChange = undefined;
      await this.revise(request, text);
      return;
    }

    this.setBusy(true, 'Thinking…');
    const res = await this.askJson<{ type: string; alters_algorithm?: boolean; reply: string }>(
      REVIEW_SYSTEM, reviewPrompt(this.task, this.language, this.lastCode, text),
      v => (v.type === 'question' || v.type === 'change') && typeof v.reply === 'string'
    );
    this.setBusy(false);

    if (!res) {
      this.say('system', 'I could not interpret that — try rephrasing as a question about a line or a specific change.');
      return;
    }
    const reply = stripThinking(res.reply);
    if (res.type === 'question') {
      this.logger.log('review_question', this.task.id, { text, reply });
      this.say('tutor', reply);
      return;
    }
    this.logger.log('change_request', this.task.id, { text, altersAlgorithm: !!res.alters_algorithm });
    if (res.alters_algorithm) {
      this.pendingChange = { request: text };
      this.logger.log('change_check_prompt', this.task.id, { text: reply });
      this.say('tutor', reply);
    } else {
      this.say('tutor', reply);
      await this.revise(text, undefined);
    }
  }

  private async revise(request: string, studentReasoning: string | undefined) {
    this.setBusy(true, 'Updating the code…');
    const { text, ms } = await this.ask(
      generationSystem(this.language, isFree(this.task)),
      revisionPrompt(this.task, this.language, this.lastCode, request, studentReasoning),
      undefined, undefined, 'revise'
    );
    this.setBusy(false);
    const { code, rest } = extractCode(text);
    if (!code) throw new Error('The model did not return revised code. Please try the request again.');
    await this.setCode(code);
    this.logger.log('code_generated', this.task.id, { version: this.codeVersions, reason: 'revision', request, code }, ms);
    this.say('tutor', 'Updated — the editor now shows the new version.\n\n' + (rest || ''));
  }

  // ---- Phase 3: comprehension check
  async startCheck() {
    if (this.view.busy || this.phase !== 'review') return;
    try {
      await this.syncCode();
      this.phase = 'check';
      this.compIndex = 0;
      this.compRecords = [];
      this.asked = [];
      this.say('tutor',
        'Time for the check. First a short multiple-choice quiz on the ideas behind your code' +
        (this.compCount > 0 ? ', then ' + (this.compCount > 1 ? 'a few questions' : 'a question') + ' where you predict what the code does and we run it to compare.' : '.') +
        ' Your code stays open throughout.');
      await this.beginCheckParts();
    } catch (err: any) {
      this.phase = 'review';
      this.setBusy(false);
      this.say('system', `⚠️ ${err?.message || err}

Press **Start the check** to try again.`);
    }
    this.refresh();
  }

  private focusFor(i: number): FocusType {
    return FOCUS_TYPES[((isFree(this.task) ? 0 : this.taskIdx) + i) % FOCUS_TYPES.length];
  }

  private async nextQuestion(retryConcept: string | undefined) {
    const focus = this.question && retryConcept ? this.question.focus : this.focusFor(this.compIndex);
    const attempt = retryConcept ? 2 : 1;
    const runQ = focus === 'predict_output' ? await this.predictRunQuestion(attempt, retryConcept) : undefined;
    this.setBusy(true, 'Preparing a question…');
    const res = runQ ? undefined : await this.askJson<{ focus: string; question: string; expected_answer: string }>(
      QUESTION_SYSTEM,
      questionPrompt(this.task, this.language, this.lastCode, focus, this.asked, retryConcept),
      v => typeof v.question === 'string' && v.question.length > 5
    );
    this.setBusy(false);

    const q: Question = runQ ?? (res
      ? { focus, question: stripThinking(res.question), expected: String(res.expected_answer ?? ''), attempt, concept: retryConcept }
      : {
          focus, attempt, concept: retryConcept,
          question: 'Pick one line of your code and explain what would go wrong if it were removed or changed.',
          expected: 'Any accurate description of a line\'s purpose and the failure caused by removing it.',
        });
    this.question = q;
    this.asked.push(q.question);
    if (attempt === 1) this.compRecords.push({ focus, attempts: [] });
    this.logger.log('comprehension_question', this.task.id, {
      index: this.compIndex, attempt, focus, question: q.question, expectedAnswer: q.expected, truth: q.truth, fallbackQuestion: !res && !runQ,
    });
    const label = attempt === 2 ? 'Let\'s try a fresh one on the same idea' : `Question ${this.compIndex + 1} of ${this.compCount}`;
    this.say('tutor', `**${label}**\n\n${q.question}`);
  }

  private async onCheckAnswer(text: string) {
    const q = this.question;
    if (!q || this.checkDone) return;
    // The first response is recorded BEFORE any feedback is generated.
    this.logger.log('comprehension_response', this.task.id, { index: this.compIndex, attempt: q.attempt, firstResponse: q.attempt === 1, answer: text });

    this.setBusy(true, 'Reading your answer…');
    const res = await this.askJson<{ correct: boolean; concept?: string; feedback: string }>(
      EVAL_SYSTEM, evalPrompt(this.task, this.language, this.lastCode, q.question, q.expected, text, q.truth),
      v => typeof v.correct === 'boolean' && typeof v.feedback === 'string'
    );
    this.setBusy(false);

    const correct = !!res?.correct;
    const feedback = res ? stripThinking(res.feedback) : 'Thanks — I couldn\'t grade that automatically, but your answer has been saved.';
    this.compRecords[this.compRecords.length - 1]?.attempts.push({ correct });
    this.logger.log('comprehension_feedback', this.task.id, { index: this.compIndex, attempt: q.attempt, correct, concept: res?.concept, feedback });
    const reveal = q.truth !== undefined ? '\n\nActual result when the code was run:\n```\n' + q.truth + '\n```' : '';
    this.say('tutor', (correct ? '✅ ' : '') + feedback + reveal);

    if (!correct && res && q.attempt === 1) {
      await this.nextQuestion(res.concept || q.focus);
      return;
    }
    this.compIndex++;
    if (this.compIndex < this.compCount) {
      await this.nextQuestion(undefined);
      return;
    }
    this.completeCheck();
  }

  private async beginCheckParts() {
    if (this.quizCount > 0 && !this.quizDone) await this.startQuiz();
    else await this.startQuestions();
  }

  private async startQuestions() {
    if (this.compCount <= 0) return this.completeCheck();
    this.compIndex = 0;
    await this.nextQuestion(undefined);
  }

  private completeCheck() {
    this.checkDone = true;
    this.say('tutor', 'That\'s the check done. Use **' + (isFree(this.task) ? 'Run program' : 'Run tests') + '** if you want one more look, then **Finish task**.');
  }

  // ---- Phase 3b: multiple-choice quiz on the ideas behind the code
  private async startQuiz() {
    if (this.quizCount <= 0) return this.startQuestions();
    this.setBusy(true, 'Preparing the quiz…');
    const res = await this.askJson<{ questions: Mcq[] }>(
      QUIZ_SYSTEM, quizPrompt(this.task, this.language, this.lastCode, this.quizCount, this.asked),
      v => Array.isArray(v.questions) && v.questions.length > 0 && v.questions.every(q =>
        typeof q.stem === 'string' && Array.isArray(q.choices) && q.choices.length === 4 &&
        Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3)
    );
    this.setBusy(false);
    if (!res) return this.startQuestions();

    const items = res.questions.slice(0, this.quizCount).map(q => shuffleMcq({
      stem: stripThinking(q.stem), choices: q.choices.map(c => String(c)), correct: q.correct, explanation: stripThinking(String(q.explanation ?? '')),
    }));
    this.quiz = { items, index: 0 };
    this.quizResults = [];
    this.say('tutor', 'Quiz: pick the best answer for each question.');
    this.logQuizQuestion();
  }

  private logQuizQuestion() {
    if (!this.quiz) return;
    const q = this.quiz.items[this.quiz.index];
    this.logger.log('quiz_question', this.task.id, { index: this.quiz.index, stem: q.stem, choices: q.choices, correctIndex: q.correct });
  }

  async answerQuiz(choice: number) {
    const quiz = this.quiz;
    if (!quiz || this.view.busy || !(choice >= 0 && choice <= 3)) return;
    const item = quiz.items[quiz.index];
    const correct = choice === item.correct;
    const letter = (i: number) => 'ABCD'[i];
    // Only the first (and only) response is recorded; the key is revealed after.
    this.logger.log('quiz_response', this.task.id, { index: quiz.index, chosen: choice, chosenText: item.choices[choice], correct });
    this.quizResults.push({ correct });
    this.say('student', letter(choice) + '. ' + item.choices[choice]);
    this.say('tutor', (correct ? '✅ Correct. ' : 'Not quite. The answer was **' + letter(item.correct) + '. ' + item.choices[item.correct] + '**. ') + item.explanation);
    quiz.index++;
    if (quiz.index >= quiz.items.length) {
      this.quiz = undefined;
      this.quizDone = true;
      try {
        await this.startQuestions();
      } catch (err: any) {
        this.setBusy(false);
        this.say('system', `⚠️ ${err?.message || err}`);
      }
    } else {
      this.logQuizQuestion();
    }
    this.refresh();
  }

  // ---- Control condition
  private async onDirect(text: string) {
    await this.syncCode();
    this.logger.log('direct_request', this.task.id, { text });
    const first = this.directHistory.length === 0;
    const preamble = directTaskPreamble(this.task, this.language);
    const content = first && preamble ? `${preamble}\n\n${text}` : text;

    this.setBusy(true, 'Thinking…');
    const { text: reply, ms } = await this.ask(directSystem(this.language), content, [...this.directHistory], undefined, 'direct');
    this.setBusy(false);

    this.directHistory.push({ role: 'user', content }, { role: 'assistant', content: reply });
    const { code } = extractCode(reply);
    if (code) {
      await this.setCode(code);
      this.logger.log('code_generated', this.task.id, { version: this.codeVersions, reason: 'direct', code }, ms);
    }
    this.logger.log('direct_response', this.task.id, { text: reply }, ms);
    this.say('tutor', code ? `${reply}\n\n_(The code is open in the editor.)_` : reply);
  }

  // ------------------------------------------------------------------ tests & finishing

  async runTestsNow(reason: 'student' | 'final' = 'student') {
    if (this.view.busy || this.view.stage !== 'task') return;
    if (isFree(this.task)) return this.runInTerminal();
    await this.syncCode();
    if (!this.lastCode.trim()) {
      if (reason === 'student') this.say('system', 'There is no code to test yet.');
      this.refresh();
      return;
    }
    this.setBusy(true, 'Running tests…');
    this.refresh();
    const report = await runTests(this.task, this.language, this.lastCode);
    this.setBusy(false);
    this.lastReport = report;
    if (report.allPassed && this.firstPassMs === undefined) this.firstPassMs = Date.now() - this.taskStart;
    this.logger.log('tests_run', this.task.id, {
      reason, passed: report.passed, total: report.total, allPassed: report.allPassed, fatal: report.fatal,
      codeVersion: this.codeVersions, codeHash: hash(this.lastCode),
    });
    const text = formatReport(report);
    this.view.testSummary = text;
    if (reason === 'student') this.say('system', text);
    this.refresh();
  }

  /** Open mode: run the program in a real terminal so input() works. */
  private async runInTerminal() {
    await this.syncCode();
    if (!this.lastCode.trim() || !this.codeUri) {
      this.say('system', 'There is no code to run yet.');
      this.refresh();
      return;
    }
    const exe = this.language === 'javascript' ? 'node' : interpreterFor(this.language).cmd;
    if (!this.terminal || this.terminal.exitStatus) this.terminal = vscode.window.createTerminal('VibeLearner');
    this.terminal.show(true);
    this.terminal.sendText(`${exe} "${this.codeUri.fsPath}"`);
    this.logger.log('program_run', this.task.id, { via: 'terminal', codeVersion: this.codeVersions, codeHash: hash(this.lastCode) });
    this.say('system', 'Running your program in the terminal…');
    this.refresh();
  }

  /** "Predict, then run": the student predicts the real output; the tool runs the code to get the ground truth. */
  private async predictRunQuestion(attempt: number, retryConcept: string | undefined): Promise<Question | undefined> {
    if (this.language !== 'python' && this.language !== 'javascript') return undefined;
    this.setBusy(true, 'Preparing a question…');
    try {
      if (isFree(this.task)) {
        const rc = await this.askJson<{ stdin?: string; scenario: string }>(
          RUN_CASE_SYSTEM, runCasePrompt(this.task, this.language, this.lastCode, this.asked),
          v => typeof v.scenario === 'string'
        );
        if (!rc) return undefined;
        let stdin = String(rc.stdin ?? '').replace(/\\n/g, '\n');
        if (stdin && !stdin.endsWith('\n')) stdin += '\n';
        const run = await runProgram(this.language, this.lastCode, stdin);
        if (run.error || run.timedOut) return undefined;
        const out = (run.stdout + (run.stderr ? '\n[error]\n' + run.stderr : '')).trimEnd();
        const input = stdin.trim() ? 'Input given to the program:\n```\n' + stdin.trimEnd() + '\n```\n' : '';
        return {
          focus: 'predict_output', attempt, concept: retryConcept, expected: out, truth: out || '(no output)',
          question: `${rc.scenario}\n\n${input}**Predict:** exactly what will the program print? I'll run it afterwards and we'll compare.`,
        };
      }
      const tests = this.task.tests;
      if (!tests.length) return undefined;
      const tc = tests[this.asked.length % tests.length];
      const rep = await runTests({ ...this.task, tests: [tc] }, this.language, this.lastCode);
      if (!rep.ran) return undefined;
      const o = rep.outcomes[0];
      const truth = o.error ? 'error: ' + o.error : JSON.stringify(o.actual);
      const call = fnNameFor(this.task, this.language) + '(' + tc.args.map(a => JSON.stringify(a)).join(', ') + ')';
      return {
        focus: 'predict_output', attempt, concept: retryConcept, expected: truth, truth,
        question: `What does \`${call}\` return with your code? Explain how it gets there. I'll run it afterwards and we'll compare.`,
      };
    } catch {
      return undefined;
    } finally {
      this.setBusy(false);
    }
  }

  async finishTask() {
    if (this.view.busy || this.view.stage !== 'task') return;
    const free = isFree(this.task);
    const unfinishedCheck = this.condition === 'vibelearner' && !this.checkDone;
    if (unfinishedCheck || (!free && !this.lastReport?.allPassed)) {
      const why = unfinishedCheck ? 'You have not completed the comprehension check.' : 'Your code has not passed all tests.';
      const pick = await vscode.window.showWarningMessage(`${why} Finish this task anyway?`, { modal: true }, 'Finish task');
      if (pick !== 'Finish task') return;
    }
    if (!free) await this.runTestsNow('final');

    const total = Date.now() - this.taskStart;
    const report = this.lastReport;
    this.summary = {
      mode: this.mode,
      spec: this.spec || undefined,
      completed: free ? !!this.lastCode : !!report?.allPassed,
      testsPassed: report?.passed ?? 0,
      testsTotal: report?.total ?? this.task.tests.length,
      totalMs: total,
      llmMs: this.llmMs,
      studentMs: total - this.llmMs,
      timeToFirstPassMs: this.firstPassMs,
      clarificationRounds: this.clarRound,
      reasoningScaffolded: this.scaffolded,
      usedFallback: this.usedFallback,
      codeVersions: this.codeVersions,
      comprehension: this.compRecords,
      quiz: this.quizResults,
      finalCode: this.lastCode,
    };
    this.view.stage = 'survey';
    this.refresh();
  }

  async submitSurvey(effort: number, need: number, comment: string) {
    if (this.view.stage !== 'survey' || !this.summary) return;
    if (!(effort >= 1 && effort <= 9) || !(need >= 1 && need <= 7)) {
      return this.toast('Please answer both questions.');
    }
    this.logger.log('survey', this.task.id, { mentalEffort1to9: effort, neededOtherSource1to7: need, comment: comment.slice(0, 1000) });
    this.logger.log('task_end', this.task.id, this.summary, this.llmMs);

    this.taskIdx++;
    if (this.mode === 'open' || this.taskIdx < this.taskIds.length) {
      this.startTask();
      return;
    }
    await this.logger.flush();
    this.view = {
      ...this.view,
      stage: 'done',
      messages: [{ id: ++this.msgSeq, role: 'tutor', text: 'All tasks are complete — thank you! Please let the researcher know you have finished.' }],
      code: undefined,
      actions: { runTests: false, needCode: false, ready: false, finish: false },
    };
    this.refresh();
  }

  // ------------------------------------------------------------------ code document

  private async setCode(code: string) {
    this.lastCode = code;
    this.codeVersions++;
    const ext = this.language === 'javascript' ? 'js' : 'py';
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'study_code', this.participant);
    await vscode.workspace.fs.createDirectory(dir);
    const uri = vscode.Uri.joinPath(dir, `${this.task.id}.${ext}`);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(code));
    this.codeUri = uri;

    const doc = await vscode.workspace.openTextDocument(uri);
    // If the document was already open, openTextDocument returns the in-memory text, so replace it.
    if (doc.getText() !== code) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), code);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: false });
  }

  /** Reads what is currently in the editor so tests/questions refer to the exact code on screen. */
  private async syncCode() {
    if (!this.codeUri) return;
    try {
      const doc = await vscode.workspace.openTextDocument(this.codeUri);
      const current = doc.getText();
      if (current !== this.lastCode) {
        this.lastCode = current;
        this.logger.log('code_edited', this.task.id, { codeHash: hash(current), code: current });
      }
    } catch { /* file removed; keep last known code */ }
  }

  // ------------------------------------------------------------------ model helpers

  private async ask(system: string, prompt: string, history: ChatMsg[] | undefined, temperature: number | undefined, label: string) {
    const res = await callBackend({ model: this.model, prompt, system, history, temperature, context: this.context });
    this.llmMs += res.ms;
    console.log(`[VibeLearner] ${label}: ${res.ms}ms`);
    return { text: res.text, ms: res.ms };
  }

  /** Judge-style call: temperature 0, one retry on unparsable output, then gives up (returns undefined). */
  private async askJson<T>(system: string, prompt: string, valid: (v: T) => boolean): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was not valid JSON in the required format. Reply with ONLY the JSON object.`;
      const { text, ms } = await this.ask(system, p, undefined, 0, 'judge');
      const parsed = extractJson<T>(text);
      if (parsed && valid(parsed)) return parsed;
      this.logger.log('parse_failure', this.task.id, { attempt, raw: text.slice(0, 600) }, ms);
    }
    return undefined;
  }

  // ------------------------------------------------------------------ view plumbing

  private say(role: ViewMsg['role'], text: string) {
    this.view.messages.push({ id: ++this.msgSeq, role, text });
  }

  private setBusy(busy: boolean, label = '') {
    this.view.busy = busy;
    this.view.busyLabel = label;
    this.refresh();
  }

  private toast(msg: string) {
    void vscode.window.showWarningMessage(msg);
  }

  private blankView(): SessionView {
    return {
      stage: 'setup', condition: this.condition, participant: '', taskIndex: 0, taskCount: 0,
      steps: [], currentStep: 0, messages: [], busy: false, busyLabel: '',
      inputEnabled: false, placeholder: '',
      actions: { runTests: false, needCode: false, ready: false, finish: false },
    };
  }

  private refresh() {
    const v = this.view;
    const inTask = v.stage === 'task';
    const hasCode = !!this.lastCode;
    const idle = !v.busy;

    v.currentStep = this.phase === 'explain' ? 0 : this.phase === 'generating' ? 1 : this.phase === 'review' ? 2 : 3;
    v.code = inTask && hasCode ? this.lastCode : undefined;
    v.quiz = inTask && this.quiz
      ? { index: this.quiz.index, total: this.quiz.items.length, stem: this.quiz.items[this.quiz.index].stem, choices: this.quiz.items[this.quiz.index].choices }
      : undefined;

    let inputOn = false;
    let placeholder = '';
    if (inTask && idle) {
      if (this.phase === 'explain') { inputOn = true; placeholder = this.reasoning.length ? 'Reply to the tutor…' : 'Describe in your own words what the program should do…'; }
      else if (this.phase === 'review') { inputOn = !this.quiz; placeholder = this.pendingChange ? 'Answer the question above, then I\'ll make the change…' : 'Ask about a line, or request a change…'; }
      else if (this.phase === 'check') { inputOn = !this.checkDone && !this.quiz; placeholder = this.quiz ? 'Choose an answer above…' : 'Your answer (a sentence or two)…'; }
      else if (this.phase === 'chat') { inputOn = true; placeholder = 'Ask for code, an explanation, or a change…'; }
    }
    v.inputEnabled = inputOn;
    v.placeholder = placeholder;
    v.actions = {
      runTests: inTask && idle && hasCode,
      needCode: inTask && idle && this.condition === 'vibelearner' && this.phase === 'explain',
      ready: inTask && idle && this.phase === 'review' && !this.quiz,
      finish: inTask && idle,
    };
    this.onChange(v);
    v.draft = undefined;
  }
}

function shuffleMcq(q: Mcq): Mcq {
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

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
