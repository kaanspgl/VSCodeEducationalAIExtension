# VibeLearner: Vibe Coding That Teaches

VibeLearner is a Visual Studio Code extension for **structured vibe coding**: students still get complete, working code from an AI quickly, but they explain the idea first, and then learn the code after the fact by walking through it, predicting and running it, and changing it themselves (the PRIMM way). It is the platform for the COSC 449 honours project *Structured Vibe Coding with VibeLearner* (Kaan Sapoglu, supervised by Dr. Abdallah Mohamed).

The design principle comes from the honours research behind the tool: **students should still get the code they ask for**. VibeLearner is not a tutor that withholds answers. It is a code-generating assistant whose interaction is structured so that using it also builds understanding.

## Key Features

### Vibe coding
* **Sees the whole project**: every request includes the project's files (full text within a size budget), the active file, and your selection in the editor. A header chip shows what VibeLearner can see.
* **Reviewable changes, not code dumps**: changes arrive as cards, one per file, with **View diff**, **Accept** and **Reject**. Nothing is written to your files until you accept.
* **Reliable edits**: small targeted edits are applied with a whitespace-tolerant matcher. If an edit doesn't match the file, VibeLearner retries automatically with the exact file contents, and otherwise offers to put the code in a new file.
* **You choose where code goes**: the **Code goes in** picker sends code to *Auto*, *A new file*, or a specific file.
* **New projects**: **＋ New project** creates a folder and keeps VibeLearner working inside it, with a fresh plan and conversation.
* **Editor commands**: *Explain Selection* (Ctrl+Alt+E) and *Change Selection…* from the right-click menu. **▶ Run** runs the active Python/JavaScript file and shows its output; interactive programs run in a terminal.

### Structured vibe coding: three steps
PRIMM (Predict, Run, Investigate, Modify, Make; Sentance et al., 2019) is a common way to teach programming. AI tools now do the *Make* step for many students, without the reading and checking PRIMM puts around it. VibeLearner keeps that structure with the AI doing the *Make*: **the student keeps the thinking, and the AI does the typing.** Getting working code stays easy; the learning happens around it. Every request that needs programming logic goes through three steps:

| Step | What the student does | What the AI does |
|---|---|---|
| **1. Explain the idea** | Says in a sentence or two what the program needs to do, e.g. *go through the numbers 0 to 100, keep a running total, print it*. | Asks guiding questions until the key ideas are there. If the request already covers them, this step is passed straight away. |
| **2. Walk through the code** | Follows a guided walkthrough of the new code, then accepts it. | Writes the code right away from the student's idea, then explains it stop by stop, highlighting the lines in the editor and linking each part to the student's idea, **before** it is accepted. |
| **3. Predict, run & modify** | Predicts what the program prints, answers a question about how it works, and makes a small change. | Runs the program and compares it with the prediction, asks a "what if" question, and sets and checks a small modification. |

Step 3 in detail:

| | What happens |
|---|---|
| 🔮 **Predict & run** | The student predicts the output, then the program actually runs and the guess is compared with the real output. |
| 🔍 **Questions** | A "what would happen if…" question about the code (e.g. *what if the loop stopped before 100?*). |
| 🛠 **Modify** | A small change that practises the same logic (e.g. *add only the even numbers*), done by hand or by prompting the AI, then **Check my work**. |

**Checked against reality, not the AI's word.** Local models are often confidently wrong, so VibeLearner runs the code to keep its teaching honest:
* the answer key of a "what if" question is checked by applying that change and running the program; a wrong key is corrected, and a question whose answers don't fit the real output is dropped;
* every Modify challenge is checked by running its solution, and challenges that wouldn't change the output (e.g. "start the sum at 1 instead of 0") or would only reword it (e.g. "print just the number, without the text") are rejected;
* **Check my work** runs the student's program and compares its result with the challenge's solution, so wording differences don't matter and the feedback states what the program actually prints.

Step 1 is bounded: after `learning.maxRoundsPerStep` rounds (default 3), the tutor explains what is missing and moves on, and the log marks it as *scaffolded*, so no one gets stuck. Trivial changes (renaming, comments, messages) skip Step 1. Setting `learning.requireSteps` adds the thesis plan's *Write the steps* step (every step in any form, checked before the code is written) between the idea and the code.

Also included:
* **📋 Plan**: big requests are split into 2–5 small, runnable steps, and each step goes through Steps 1–3.
* **💡 Prompt coach**: each request gets a short tip and a stronger example prompt, scored on goal, inputs/outputs and details (0–6).
* **💥 Explain this error**: when a program crashes, the error is explained before it is fixed.
* **📈 Your progress**: running scores for *Explaining, Prompting, Reading code, Predicting, Understanding* and *Modifying*, plus the concepts the student has worked with.

### Modes (the study conditions)
Pick a mode on the Start screen or from the **Mode** dropdown in the header:

| Mode | Behaviour | Study role |
|---|---|---|
| **Structured** (default) | Steps 1–3 above for every request that needs programming logic: explain the idea, walk through the code, predict, run and modify. | Treatment |
| **Regular vibe coding** | The AI writes code straight from the request; no steps, coaching or learning tools. Same model and the same edit / diff / accept flow. | Comparison |
| **Light** | The learning tools are offered as buttons on each change; nothing is required. | Everyday use |

When a participant code is entered, the mode comes from settings (`vibelearner.learning.level`: `guided` = structured, `off` = regular) and can't be changed in the UI.

## Getting Started

**Requirements**
* VS Code 1.89+ and Node.js (to build the extension)
* A model provider: [Ollama](https://ollama.com) running locally (default, e.g. `ollama pull qwen3-coder:30b`), or a Gemini / EduAI key
* Python 3, if you want to run Python programs. JavaScript runs on VS Code's built-in Node. On Windows, the `python` command that opens the Microsoft Store is detected and reported.

**Run it**
1. Install and test:
   ```bash
   npm ci
   ```
   ```bash
   npm test
   ```
2. In VS Code, choose **Run VibeLearner Extension** from Run and Debug, or press **F5**.
3. In the Extension Development Host, run **VibeLearner: Check Ollama Connection**. It confirms that Ollama is running and that your configured model is installed.
4. Open a folder (**File → Open Folder**) and run **VibeLearner: Open** (Ctrl+Alt+;).

For a quick feature test, open `examples/learning-playground.js`. Each function has an intentional beginner misconception, so it works well for *Explain Selection*, *Change Selection…* and **Explain this error**.

The default local configuration is:

```json
{
  "vibelearner.apiProvider": "ollama",
  "vibelearner.ollamaUrl": "http://127.0.0.1:11434",
  "vibelearner.model": "qwen3-coder:30b"
}
```

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `vibelearner.learning.level` | `guided` | `guided` (structured), `off` (regular vibe coding), or `light` |
| `vibelearner.learning.requireSteps` | `false` | Also ask the student to write every step before the code is written (the thesis plan's Step 2) |
| `vibelearner.learning.maxRoundsPerStep` | `3` | Guiding rounds for explaining the idea (and writing the steps, if required) before the tutor explains what is missing and moves on |
| `vibelearner.learning.allowSkipSteps` | `true` | Show *Skip: just write the code* while explaining the idea (logged). Turn off if every request must go through Step 1 |
| `vibelearner.learning.clarify` | `true` | Ask clarifying questions for vague requests |
| `vibelearner.learning.maxClarifications` | `2` | Clarifying rounds before building with stated assumptions |
| `vibelearner.learning.questionsPerChange` | `1` | Questions in the 🔍 Questions step |
| `vibelearner.learning.projectQuizQuestions` | `3` | Questions in *Quiz me on my program* |
| `vibelearner.context.maxChars` | `24000` | How much of the project is sent per request (larger = more context, slower) |
| `vibelearner.apiProvider` / `vibelearner.model` | `ollama` / `qwen3-coder:30b` | Model provider and model |
| `vibelearner.ollamaContextLength` | `16384` | Context window requested from Ollama. Ollama defaults to 4096 tokens and silently cuts longer prompts, so keep this large |
| `vibelearner.pythonPath` | — | Python executable, if not on PATH |
| `vibelearner.workflow` | `vibe` | `study` switches to the fixed-task study workflow (below) |

## Research Use

* **Consent-based logging**: on the Start screen, a participant enters a code and ticks consent. Nothing is logged without both.
* **What is logged**: one JSONL file per participant, stored locally. Every event is tagged with the condition (`vibe:guided` = structured, `vibe:off` = regular). Events cover requests, prompt-quality scores, plans, every idea (and steps) answer with the AI's verdict (and whether it was passed unaided, scaffolded or skipped), walkthroughs, every proposed / accepted / rejected change (with content), whether the code was read (diff, walkthrough or prediction), predictions against the real output, question answers with how each answer key was checked (verified, corrected or dropped), and Modify outcomes (by hand or via the AI, and whether the run or the model decided). Model waiting time is recorded separately from student time.
* **Finding the logs**: run **VibeLearner: Reveal Study Logs**.
* **Before collecting data**: freeze the prompts (`src/vibe/prompts.ts`, `VIBE_PROMPT_VERSION` is written to the log), the model and the settings.
* **Study workflow** (`vibelearner.workflow = study`): the fixed-task workflow is kept for controlled studies. It has instructor-reviewed tasks with unit tests, a request check, code generation, review, a check (multiple-choice quiz, then predict-then-run), a post-task survey, and a direct-generation control condition.

## System Architecture

VibeLearner is a standard VS Code extension: a thin webview UI and an extension-host backend that owns all state.
* **Frontend (Webview UI)**: a plain JavaScript chat panel (`media/chat.js`, `media/chat.css`). It renders a full state snapshot pushed by the backend and sends user actions back over `postMessage`. It has no network access of its own.
* **Backend (Extension Host)**: Node.js/TypeScript. It reads the workspace, applies edits, runs programs, drives the learning loop, and writes logs.
* **Provider-agnostic model layer**: `callBackend.ts` routes requests to local models through Ollama (default, privacy-first) or to Gemini / EduAI, with conversation history and per-call temperature.

## Architecture Diagram

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

### Component Breakdown

**Frontend (webview)**
- `media/chat.js`: renders the state snapshot (chat, change cards, plan, walkthrough, quiz, progress) and posts user actions
- `media/chat.css`: styling that follows the VS Code theme

**Backend (extension host)**
- `src/extension.ts`: entry point, command registration, editor listeners
- `src/panels/ChatPanel.ts`: webview controller and message routing
- `src/vibe/session.ts`: project mode, including the request → coach → plan → Step 1 → build → walkthrough → Step 3 state machine, and the run-based checks of answer keys, challenges and Check my work
- `src/vibe/context.ts`: builds whole-project context within a character budget, scoped to the current project folder
- `src/vibe/edits.ts`: SEARCH/REPLACE parsing, fuzzy matching, fenced-code fallback, proposed-content provider for diffs
- `src/vibe/prompts.ts`: every prompt (idea check, optional steps check, action, router + prompt coach, plan, walkthrough, predict feedback, questions, modify challenges)
- `src/study/runner.ts`: runs programs and unit tests with captured output and timeouts
- `src/study/logger.ts`: append-only, consent-gated JSONL log
- `src/study/session.ts`, `src/study/tasks.ts`: the fixed-task study workflow and its task bank
- `src/shared/callBackend.ts`: provider abstraction (Ollama / Gemini / EduAI)

**Data Flow**
1. The student types a request (optionally with code selected and a target file chosen).
2. The webview posts it to the extension host.
3. In Structured and Light mode, a router call classifies the request, coaches the prompt, and decides whether to clarify, plan, or (in Structured) start Step 1.
4. Once the idea is there, `context.ts` gathers the project and the action call writes the code from the student's idea, returning an explanation and edit blocks.
5. Edits are matched against the real files (with an automatic repair retry) and shown as change cards with diffs.
6. In Structured mode the walkthrough runs on the proposed code (Step 2). After **Accept**, the file is written and Step 3 runs: predict & run, a question, modify, each checked by running the code.
7. Every step updates the progress panel and, if consented, the research log.

## Security and Privacy

* **Local by default**: with the default Ollama provider, code and conversations never leave the machine.
* **Logging**: research logs are written only after the participant enters a code and gives consent. They are stored locally in VS Code's extension storage.
* **Program execution**: programs run only from the student's own project, with an 8-second timeout. The webview has no network access, and all model calls go through the extension host.
* **Proposed edits**: changes are never applied without the student accepting them, and edit paths that point outside the workspace folder are rejected.
* **API keys**: the Gemini key can be provided through VS Code SecretStorage (OS keychain) or the `GEMINI_API_KEY` environment variable. Keys entered in Settings (`vibelearner.gemini.apiKey`, `vibelearner.eduaiApiKey`) are stored in plain text in `settings.json`, so prefer SecretStorage or the environment variable on shared machines.
