# VibeLearner: Vibe Coding That Teaches

VibeLearner is a Visual Studio Code extension that turns AI-assisted "vibe coding" into a learning experience. Students describe what they want in plain language and get complete, working code in their own project, just like any AI coding assistant. Around every change, VibeLearner adds a short learning loop that helps them think it through, read the code, predict what it does, check their understanding, and try changes themselves.

The design principle comes from the honours research behind the tool: **students should still get the code they ask for**. VibeLearner is not a tutor that withholds answers. It is a code-generating assistant whose interaction is structured so that using it also builds understanding.

## Key Features

### Vibe coding
* **Sees the whole project**: every request includes the project's files (full text within a size budget), the active file, and your selection in the editor. A header chip shows what VibeLearner can see.
* **Reviewable changes, not code dumps**: changes arrive as cards, one per file, with **View diff**, **Accept** and **Reject**. Nothing is written to your files until you accept.
* **Reliable edits**: small targeted edits are applied with a whitespace-tolerant matcher. If an edit doesn't match the file, VibeLearner retries automatically with the exact file contents, and otherwise offers to put the code in a new file.
* **You choose where code goes**: the **Code goes in** picker sends code to *Auto*, *A new file*, or a specific file.
* **New projects**: **＋ New project** creates a folder and keeps VibeLearner working inside it, with a fresh plan and conversation.
* **Editor commands**: *Explain Selection* (Ctrl+Alt+E) and *Change Selection…* from the right-click menu. **▶ Run** runs the active Python/JavaScript file and shows its output; interactive programs run in a terminal.

### The learning loop
Built on **PRIMM** (Predict, Run, Investigate, Modify, Make; Sentance et al., 2019), adapted so the AI does the *Make* and the student does the rest:

| Step | What happens | Why |
|---|---|---|
| 📋 **Plan** | Big requests are split into 2–5 small, runnable steps. | Teaches decomposition, the core vibe-coding skill. |
| 💭 **Think first** | One plain-language question before step 1 (e.g. *"How would you put four cards in order by hand?"*). If the idea is correct, the code is built the student's way. | Elicits the student's reasoning and links the code to it. |
| 🧭 **Walkthrough** | A guided tour of the proposed code, highlighting lines in the editor stop by stop, **before** accepting. | Reviewing AI code before accepting it. |
| 🔮 **Predict & run** | The student predicts the output, then the program actually runs and the guess is compared with the real output. | Builds an accurate mental model of what code does. |
| ✅ **Check** | A multiple-choice question on the change. Plausible wrong answers come from common misconceptions, and the answer key stays hidden until the student answers. | Checks conceptual understanding. |
| 🛠 **Your turn** | A small modification challenge, done by hand or by prompting the AI, then **Check my work**. | Moves the student from using code to changing it. |

Also included:
* **💡 Prompt coach**: each request gets a short tip and a stronger example prompt, scored on goal, inputs/outputs and details (0–6). Learning to vibe code is largely learning to specify.
* **Clarifying questions**: vague requests get up to two questions. If the student says they don't know, they get a conceptual explanation instead, then the code is built anyway.
* **💥 Explain this error**: when a program crashes, the error is explained before it is fixed.
* **📈 Your progress**: running scores for *Prompting, Reviewing, Predicting, Understanding* and *Modifying*, plus the concepts the student has worked with.

### Learning levels
Pick a level on the Start screen or from the **Learning** dropdown in the header:

| Level | Behaviour | Research role |
|---|---|---|
| **Guided** (default) | The learning loop runs automatically around every change. Every step can be skipped. | Treatment |
| **Light** | The same tools, offered as buttons on each change. Nothing starts on its own. | Self-directed use |
| **Off** | A plain vibe-coding assistant: same model, same edit/diff/accept flow, no teaching extras. | Control |

When a participant code is entered, the level comes from settings and can't be changed in the UI.

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
| `vibelearner.learning.level` | `guided` | `off`, `light`, or `guided` (see above) |
| `vibelearner.learning.clarify` | `true` | Ask clarifying questions for vague requests |
| `vibelearner.learning.maxClarifications` | `2` | Clarifying rounds before building with stated assumptions |
| `vibelearner.learning.questionsPerChange` | `1` | Questions in the ✅ Check step |
| `vibelearner.learning.projectQuizQuestions` | `3` | Questions in *Quiz me on my program* |
| `vibelearner.context.maxChars` | `24000` | How much of the project is sent per request (larger = more context, slower) |
| `vibelearner.apiProvider` / `vibelearner.model` | `ollama` / `qwen3-coder:30b` | Model provider and model |
| `vibelearner.pythonPath` | — | Python executable, if not on PATH |
| `vibelearner.workflow` | `vibe` | `study` switches to the fixed-task study workflow (below) |

## Research Use

* **Consent-based logging**: on the Start screen, a participant enters a code and ticks consent. Nothing is logged without both.
* **What is logged**: one JSONL file per participant, stored locally. Every event is tagged with the condition (e.g. `vibe:guided`). Events cover requests, prompt-quality scores, plans and think-first answers, every proposed / accepted / rejected change (with content), whether a change was reviewed before it was accepted, predictions against the real output, quiz answers, and *your turn* outcomes (by hand or via the AI). Model waiting time is recorded separately from student time.
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
- `src/vibe/session.ts`: project mode, including the request → coach → plan → build → learning-loop state machine
- `src/vibe/context.ts`: builds whole-project context within a character budget, scoped to the current project folder
- `src/vibe/edits.ts`: SEARCH/REPLACE parsing, fuzzy matching, fenced-code fallback, proposed-content provider for diffs
- `src/vibe/prompts.ts`: every prompt (action, router + prompt coach, plan, walkthrough, predict feedback, quizzes, challenges)
- `src/study/runner.ts`: runs programs and unit tests with captured output and timeouts
- `src/study/logger.ts`: append-only, consent-gated JSONL log
- `src/study/session.ts`, `src/study/tasks.ts`: the fixed-task study workflow and its task bank
- `src/shared/callBackend.ts`: provider abstraction (Ollama / Gemini / EduAI)

**Data Flow**
1. The student types a request (optionally with code selected and a target file chosen).
2. The webview posts it to the extension host.
3. In the learning levels, a router call classifies the request, coaches the prompt, and decides whether to clarify or plan.
4. `context.ts` gathers the project. The action call returns an explanation and edit blocks.
5. Edits are matched against the real files (with an automatic repair retry) and shown as change cards with diffs.
6. In Guided, the walkthrough runs. After **Accept**, the file is written, then predict & run, check and your turn follow.
7. Every step updates the progress panel and, if consented, the research log.

## Security and Privacy

* **Local by default**: with the default Ollama provider, code and conversations never leave the machine.
* **Logging**: research logs are written only after the participant enters a code and gives consent. They are stored locally in VS Code's extension storage.
* **Program execution**: programs run only from the student's own project, with an 8-second timeout. The webview has no network access, and all model calls go through the extension host.
* **Proposed edits**: changes are never applied without the student accepting them, and edit paths that point outside the workspace folder are rejected.
* **API keys**: the Gemini key can be provided through VS Code SecretStorage (OS keychain) or the `GEMINI_API_KEY` environment variable. Keys entered in Settings (`vibelearner.gemini.apiKey`, `vibelearner.eduaiApiKey`) are stored in plain text in `settings.json`, so prefer SecretStorage or the environment variable on shared machines.
