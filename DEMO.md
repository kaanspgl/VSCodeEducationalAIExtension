# Demoing VibeLearner

## One-time setup (≈10 min, mostly the model download)

1. Install [VS Code](https://code.visualstudio.com), [Node.js LTS](https://nodejs.org), [Ollama](https://ollama.com) (start the app) and, optionally, Python 3.
2. From the repo folder run:
   - macOS / Linux: `./scripts/setup-demo.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts\setup-demo.ps1`

   This installs dependencies, compiles, runs the tests, and pulls the demo model (`qwen2.5-coder:7b`, ~5 GB).
   On a machine with 32 GB+ RAM, pass a bigger model for better answers: `./scripts/setup-demo.sh qwen3-coder:30b`.
3. **No Ollama?** Run **VibeLearner: Set Gemini API Key** in the demo window and set `vibelearner.apiProvider` to `gemini` in `demo-workspace/.vscode/settings.json`.

## Start the demo

1. `code .` in the repo folder, press **F5**, and choose **Demo: VibeLearner in demo-workspace**.
2. A second VS Code window opens on `demo-workspace/`. Run **VibeLearner: Check Ollama Connection** once, to catch problems before your audience sees them.
3. Open the panel with **Ctrl+Alt+;** (Cmd+Alt+; on Mac).

## 5-minute script

| # | Do | Point to make |
|---|---|---|
| 1 | Learning level **Guided**. Type a vague request: *"make a grade program"* | Prompt coach scores the request and asks clarifying questions: learning to vibe code means learning to specify |
| 2 | Answer, or send: *"Python program that asks for 5 scores and prints the average and letter grade"* | Plan splits it into small steps; *Think first* asks for the student's idea |
| 3 | Step through the **Walkthrough**, then **Accept** | Code is reviewed *before* it's accepted; nothing is written until then |
| 4 | **Predict & run**, then **Check** | Student's prediction vs. real output; misconception-based quiz |
| 5 | **Your turn** challenge | Moves the student from using code to modifying it |
| 6 | Open `learning-playground.js`, select `printItems`, **Ctrl+Alt+E** | Explain Selection on a buggy off-by-one |
| 7 | Switch level to **Off**, repeat a request | Same assistant, no learning loop: this is the study's control condition |
| 8 | Show **Your progress** | Per-skill scores; with consent, these events go to the research log |

Local models can take 10–30 s per answer on a laptop. Warm the model up with one request before the meeting.
