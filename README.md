# VibeLearner

VibeLearner is an AI coding assistant for beginners that tries to make vibe coding teach something. Students still get complete, working code from the AI, but they explain the idea first, and afterwards they walk through the code, predict what it prints, run it and change it themselves (the PRIMM approach). It's the platform for my COSC 449 honours project, *Structured Vibe Coding with VibeLearner* (Kaan Sapoglu, supervised by Dr. Abdallah Mohamed).

The starting point from the research is that students should still get the code they ask for. VibeLearner isn't a tutor that holds answers back. It's a normal code-writing assistant, with the interaction set up so that using it also builds understanding.

There are two versions in this repo, sharing the same prompts and learning logic:

* a **VS Code extension** (the root folder, code in `src/`)
* a **web version** (`web/`), so study participants only need a browser. See [web/README.md](web/README.md) for details.

## Getting it running

You need **Node.js 22.22 or newer** (check with `node -v`; the current LTS is fine) and Git. Python 3 is only needed if you want to run Python programs.

### Quickest way to try it: web version, no model

`dev:mock` replaces the model with canned answers, so you can click through the whole flow without installing a model or getting an API key:

```bash
git clone https://github.com/kaanspgl/VSCodeEducationalAIExtension.git
cd VSCodeEducationalAIExtension/web
npm install
npm run dev:mock
```

Open http://localhost:5173, press **Start**, and ask for something like *"a Python program that adds the numbers from 0 to 100"*. The answers are fake, so don't judge the teaching by them.

### With a real model

**Local (Ollama).** Install [Ollama](https://ollama.com), then pull the model the study uses:

```bash
ollama pull qwen3-coder:30b
```

It's about 19 GB and really wants a decent GPU or a lot of RAM. On a laptop, a smaller model like `qwen2.5-coder:7b` works, just with more mistakes. Set it with `model` in the config below (web) or `vibelearner.model` (extension).

**Cloud.** The web version can also use Gemini or any OpenAI-compatible API. Copy `web/vibelearner.config.example.json` to `web/vibelearner.config.json` and set:

* for Gemini: `"apiProvider": "gemini"` and `"gemini.model"` to a current model name from Google AI Studio (the built-in default is an old preview model), with the key in the `GEMINI_API_KEY` environment variable;
* for OpenAI or a compatible server: `"apiProvider": "openai"`, `"model"`, and `"openaiBaseUrl"` if it isn't OpenAI itself, with the key in `OPENAI_API_KEY`.

`vibelearner.config.json` is gitignored, but it's still better to keep keys in environment variables than in the repo folder.

Then start it from `web/`:

```bash
npm run dev
```

### The VS Code extension

From the repo root:

```bash
npm ci
npm test
```

Open the root folder in VS Code and press **F5** (or pick **Run VibeLearner Extension** under Run and Debug). A second VS Code window opens with the extension loaded. In that window:

1. Run **VibeLearner: Check Ollama Connection** from the command palette. It checks that Ollama is running and that the model is installed. To use Gemini instead, set `vibelearner.apiProvider` to `gemini` and run **VibeLearner: Set Gemini API Key**.
2. Open a folder (**File → Open Folder**) and run **VibeLearner: Open** (Ctrl+Alt+;).

`examples/learning-playground.js` is handy for a quick test: each function has a typical beginner mistake in it, so it works well with *Explain Selection*, *Change Selection…* and *Explain this error*.

### If something goes wrong

* **`npm install` prints `EBADENGINE`, or the dev server won't start**: Node is too old. Install Node 22 (22.22+) or 24.
* **"Python is not installed"** when running a Python program: on Windows the `python` command sometimes only opens the Microsoft Store. Install Python from python.org, or point `pythonPath` at it. On macOS/Linux it uses `python3`.
* **Answers ignore half the code or get cut off** (Ollama): Ollama defaults to a 4096-token context and quietly drops the rest. Leave `ollamaContextLength` at 16384 or higher.
* **Port 5173 is taken**: `npm run dev -- --port 5180`.

## How it works

### Vibe coding

* It sees the whole project: every request includes the project's files (full text, within a size budget), the active file, and whatever you've selected. A chip in the header shows what it can see.
* Changes come as cards, one per file, with **View diff**, **Accept** and **Reject**. Nothing is written to your files until you accept.
* Small targeted edits are applied with a whitespace-tolerant matcher. If an edit doesn't match the file, it retries automatically with the exact file contents, and otherwise offers to put the code in a new file.
* The **Code goes in** picker sends code to *Auto*, *A new file*, or a specific file.
* **＋ New project** creates a folder and keeps VibeLearner working inside it, with a fresh plan and conversation.
* Editor commands: *Explain Selection* (Ctrl+Alt+E) and *Change Selection…* from the right-click menu. **▶ Run** runs the active Python/JavaScript file and shows the output; interactive programs run in a terminal.

### The three steps

PRIMM (Predict, Run, Investigate, Modify, Make; Sentance et al., 2019) is a common way to teach programming. AI tools now do the *Make* step for a lot of students, and the reading and checking that PRIMM puts around it gets skipped. VibeLearner keeps that structure but lets the AI do the *Make*: the student does the thinking, the AI does the typing. Every request that needs some programming logic goes through three steps:

| Step | What the student does | What the AI does |
|---|---|---|
| 1. Explain the idea | Says in a sentence or two what the program needs to do, e.g. *go through the numbers 0 to 100, keep a running total, print it*. | Asks guiding questions until the key ideas are there. If the request already covers them, this step passes straight away. |
| 2. Walk through the code | Follows a guided walkthrough of the new code, then accepts it. | Writes the code right away from the student's idea, then explains it stop by stop, highlighting the lines in the editor and linking each part back to the idea, before it's accepted. |
| 3. Predict, run & modify | Predicts what the program prints, answers a question about how it works, and makes a small change. | Runs the program and compares the output with the prediction, asks a "what if" question, and sets and checks a small modification. |

Step 3 in a bit more detail:

| | What happens |
|---|---|
| Predict & run | The student predicts the output, then the program actually runs and the guess is compared with the real output. |
| Questions | A "what would happen if…" question about the code (e.g. *what if the loop stopped before 100?*). |
| Modify | A small change that practises the same logic (e.g. *add only the even numbers*), done by hand or by prompting the AI, then **Check my work**. |

Local models are often confidently wrong, so VibeLearner runs the code instead of trusting what the model says:

* The answer key of a "what if" question is checked by applying that change and running the program. A wrong key gets corrected, and a question whose answers don't fit the real output is dropped.
* Every Modify challenge is checked by running its solution. Challenges that wouldn't change the output (e.g. "start the sum at 1 instead of 0") or would only reword it (e.g. "print just the number, without the text") are rejected.
* **Check my work** runs the student's program and compares its result with the challenge's solution, so wording differences don't matter and the feedback says what the program actually prints.

Step 1 has a limit: after `learning.maxRoundsPerStep` rounds (default 3), the tutor explains what's missing and moves on, and the log marks it as *scaffolded*, so nobody gets stuck. Trivial changes (renaming, comments, messages) skip Step 1. Turning on `learning.requireSteps` adds the thesis plan's *Write the steps* step (all the steps in any form, checked before the code is written) between the idea and the code.

Other bits:

* **Plan**: big requests are split into 2–5 small, runnable steps, and each one goes through Steps 1–3.
* **Prompt coach**: each request gets a short tip and a stronger example prompt, scored on goal, inputs/outputs and details (0–6).
* **Explain this error**: when a program crashes, the error is explained before it's fixed.
* **Your progress**: running scores for *Explaining, Prompting, Reading code, Predicting, Understanding* and *Modifying*, plus the concepts the student has worked with.

### Modes (the study conditions)

Pick a mode on the Start screen or from the **Mode** dropdown in the header:

| Mode | Behaviour | Study role |
|---|---|---|
| Structured (default) | Steps 1–3 for every request that needs programming logic. | Treatment |
| Regular vibe coding | The AI writes code straight from the request: no steps, coaching or learning tools. Same model and the same edit / diff / accept flow. | Comparison |
| Light | The learning tools are offered as buttons on each change; nothing is required. | Everyday use |

When a participant code is entered, the mode comes from settings (`vibelearner.learning.level`: `guided` = structured, `off` = regular) and can't be changed in the UI.

## Settings

Extension settings live under `vibelearner.*` in VS Code. The web version reads the same keys from `web/vibelearner.config.json`.

| Setting | Default | Purpose |
|---|---|---|
| `vibelearner.learning.level` | `guided` | `guided` (structured), `off` (regular vibe coding), or `light` |
| `vibelearner.learning.requireSteps` | `false` | Also ask the student to write every step before the code is written (the thesis plan's Step 2) |
| `vibelearner.learning.maxRoundsPerStep` | `3` | Guiding rounds for explaining the idea (and writing the steps, if required) before the tutor explains what's missing and moves on |
| `vibelearner.learning.allowSkipSteps` | `true` | Show *Skip: just write the code* while explaining the idea (logged). Turn off if every request must go through Step 1 |
| `vibelearner.learning.clarify` | `true` | Ask clarifying questions for vague requests |
| `vibelearner.learning.maxClarifications` | `2` | Clarifying rounds before building with stated assumptions |
| `vibelearner.learning.questionsPerChange` | `1` | Questions in the Questions step |
| `vibelearner.learning.projectQuizQuestions` | `3` | Questions in *Quiz me on my program* |
| `vibelearner.context.maxChars` | `24000` | How much of the project is sent per request (larger = more context, slower) |
| `vibelearner.apiProvider` / `vibelearner.model` | `ollama` / `qwen3-coder:30b` | Model provider and model |
| `vibelearner.ollamaContextLength` | `16384` | Context window requested from Ollama. Ollama defaults to 4096 tokens and silently cuts longer prompts, so keep this large |
| `vibelearner.pythonPath` | (none) | Python executable, if it's not on the PATH |
| `vibelearner.workflow` | `vibe` | `study` switches to the fixed-task study workflow (below) |

## Research use

* **Consent**: on the Start screen, a participant enters a code and ticks consent. Nothing is logged without both.
* **What gets logged**: one JSONL file per participant, stored locally. Every event is tagged with the condition (`vibe:guided` = structured, `vibe:off` = regular). Events cover requests, prompt-quality scores, plans, every idea (and steps) answer with the AI's verdict (and whether it was passed unaided, scaffolded or skipped), walkthroughs, every proposed / accepted / rejected change (with content), whether the code was read (diff, walkthrough or prediction), predictions against the real output, question answers with how each answer key was checked (verified, corrected or dropped), and Modify outcomes (by hand or via the AI, and whether the run or the model decided). Time spent waiting for the model is recorded separately from student time.
* **Finding the logs**: run **VibeLearner: Reveal Study Logs**. The web version keeps them in `web/data/`.
* **Before collecting data**: freeze the prompts (`src/vibe/prompts.ts`; `VIBE_PROMPT_VERSION` is written to the log), the model and the settings.
* **Study workflow** (`vibelearner.workflow = study`): the older fixed-task workflow, kept for controlled studies. It has instructor-reviewed tasks with unit tests, a request check, code generation, review, a check (multiple-choice quiz, then predict-then-run), a post-task survey, and a direct-generation control condition.

## Architecture

The extension is a standard VS Code extension: a thin webview UI and an extension-host backend that owns all the state.

* **Webview**: a plain JavaScript chat panel (`media/chat.js`, `media/chat.css`). It renders a full state snapshot pushed by the backend and sends user actions back over `postMessage`. It has no network access of its own.
* **Extension host**: Node.js/TypeScript. It reads the workspace, applies edits, runs programs, drives the learning loop, and writes the logs.
* **Model layer**: `callBackend.ts` sends requests to a local model through Ollama (the default, so nothing leaves the machine) or to Gemini / EduAI.

The web version (`web/`) is a React Router app with the same session logic on the server. It imports the editor-independent parts (prompts, edit matching, run-based checks) straight from `src/`.

```
┌──────────────────────────── VS Code ─────────────────────────────┐
│                                                                  │
│  ┌─────────────────────┐            ┌─────────────────────────┐  │
│  │ Editor              │            │ VibeLearner panel       │  │
│  │ • project files     │            │ (webview, chat.js)      │  │
│  │ • selection         │            │ • chat + change cards   │  │
│  │ • walkthrough       │            │ • plan / walkthrough    │  │
│  │   highlights        │            │ • quiz / predict        │  │
│  │ • diff view         │            │ • progress, pickers     │  │
│  └─────────▲───────────┘            └──────────▲──────────────┘  │
│            │ edits, highlights                 │ state↓ actions↑ │
│            │                                   │ (postMessage)   │
│  ┌─────────┴───────────────────────────────────┴───────────────┐ │
│  │ Extension host                                              │ │
│  │                                                             │ │
│  │  extension.ts ── commands, editor listeners                 │ │
│  │  ChatPanel.ts ── webview lifecycle, message routing         │ │
│  │                                                             │ │
│  │  vibe/session.ts ── conversation + learning loop            │ │
│  │    ├─ vibe/context.ts  whole-project context, selection     │ │
│  │    ├─ vibe/edits.ts    parse / match / apply edits, diffs   │ │
│  │    ├─ vibe/prompts.ts  prompts for each role (the treatment)│ │
│  │    ├─ study/runner.ts  run programs, capture output         │ │
│  │    └─ study/logger.ts  consent-based JSONL research log     │ │
│  │                                                             │ │
│  │  study/session.ts ── fixed-task study workflow (optional)   │ │
│  │                                                             │ │
│  │  shared/callBackend.ts ── provider router                   │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
└─────────────────────────────────┼────────────────────────────────┘
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
          ┌────────────┐   ┌────────────┐   ┌────────────┐
          │  Ollama    │   │  Gemini    │   │  EduAI     │
          │  (local,   │   │  (cloud)   │   │  (course   │
          │  default)  │   │            │   │  server)   │
          └────────────┘   └────────────┘   └────────────┘
```

### Where things are

**Webview**
- `media/chat.js`: renders the state snapshot (chat, change cards, plan, walkthrough, quiz, progress) and posts user actions
- `media/chat.css`: styling that follows the VS Code theme

**Extension host**
- `src/extension.ts`: entry point, command registration, editor listeners
- `src/panels/ChatPanel.ts`: webview controller and message routing
- `src/vibe/session.ts`: project mode, i.e. the request → coach → plan → Step 1 → build → walkthrough → Step 3 state machine, plus the run-based checks of answer keys, challenges and Check my work
- `src/vibe/context.ts`: builds the whole-project context within a character budget, scoped to the current project folder
- `src/vibe/edits.ts`: SEARCH/REPLACE parsing, fuzzy matching, fenced-code fallback, proposed-content provider for diffs
- `src/vibe/checks.ts`: comparing real program output with answer choices and challenge solutions
- `src/vibe/prompts.ts`: every prompt (idea check, optional steps check, action, router + prompt coach, plan, walkthrough, predict feedback, questions, modify challenges)
- `src/study/runner.ts`: runs programs and unit tests with captured output and timeouts
- `src/study/logger.ts`: append-only, consent-gated JSONL log
- `src/study/session.ts`, `src/study/tasks.ts`: the fixed-task study workflow and its task bank
- `src/shared/callBackend.ts`: provider abstraction (Ollama / Gemini / EduAI)

**What happens on a request**
1. The student types a request (optionally with code selected and a target file chosen).
2. The webview posts it to the extension host.
3. In Structured and Light mode, a router call classifies the request, coaches the prompt, and decides whether to clarify, plan, or (in Structured) start Step 1.
4. Once the idea is there, `context.ts` gathers the project and the action call writes the code from the student's idea, returning an explanation and edit blocks.
5. Edits are matched against the real files (with an automatic repair retry) and shown as change cards with diffs.
6. In Structured mode the walkthrough runs on the proposed code (Step 2). After **Accept**, the file is written and Step 3 runs: predict & run, a question, modify, each checked by running the code.
7. Every step updates the progress panel and, with consent, the research log.

## Security and privacy

* With the default Ollama provider, code and conversations stay on the machine.
* Research logs are only written after the participant enters a code and gives consent. The extension stores them in VS Code's extension storage.
* Programs only run from the student's own project, with an 8-second timeout. The webview has no network access; all model calls go through the extension host.
* Changes are never applied without the student accepting them, and edit paths that point outside the workspace folder are rejected.
* The Gemini key can be stored in VS Code SecretStorage (the OS keychain) or passed as the `GEMINI_API_KEY` environment variable. Keys typed into Settings (`vibelearner.gemini.apiKey`, `vibelearner.eduaiApiKey`) end up in plain text in `settings.json`, so prefer the other two on shared machines.
