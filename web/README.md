# VibeLearner Web

The VibeLearner project mode as a web app (React Router), so participants in a study only need a browser. It's a port of the VS Code extension in the parent folder: same structured flow (explain the idea → walk through the code → predict, run & modify), same prompts, same JSONL research log. The parts that don't depend on an editor (prompts, edit matching, run-based checks, project context) are imported straight from `../src`, so both versions send the model exactly the same prompts.

## Running it

Needs Node 22.22 or newer, and Python if you want to run Python programs (set `pythonPath` if it's not on the PATH). Only this folder's dependencies are needed; you don't have to install the extension's.

```bash
npm install
npm run dev:mock     # canned "mock" model: click through the whole flow with no model (never use with participants)
npm run dev          # http://localhost:5173, uses the model from vibelearner.config.json (default: local Ollama)
npm run build && npm start   # production server on http://localhost:3000 (PORT=... to change it)
```

Add `-- --port 5180` to either dev command if 5173 is taken.

## Settings

Copy `vibelearner.config.example.json` to `vibelearner.config.json`. Without it, the defaults are used (Ollama with `qwen3-coder:30b`). The keys are the same as the extension's settings, with or without the `vibelearner.` prefix, so you can paste in a settings.json. The file is re-read whenever a session starts.

Providers: `ollama` (default), `openai` (any OpenAI-compatible server via `openaiBaseUrl`), `gemini` (set `gemini.model` too), `eduai`, and `mock`.

Secrets and a few settings can come from environment variables instead: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EDUAI_API_KEY`, `VL_PROVIDER`, `VL_MODEL`, `VL_LEVEL`, `OLLAMA_URL`, `OPENAI_BASE_URL`, `VL_PYTHON`, `VL_DATA_DIR`, `VL_CONFIG`.

## Research use

* The condition comes from `learning.level` (`guided` = structured, `off` = regular vibe coding). With a participant code, the mode can't be changed in the browser.
* Data goes in `data/` (or `VL_DATA_DIR`):
  * `study_logs/<code>.jsonl`: one log per participant, written only after consent. Each session's first event records `platform: "web"`, the prompt version, the model and the settings.
  * `workspaces/p-<code>/`: the participant's files, kept across visits. Visitors without a code get `workspaces/anon-<id>/`.
* Student code runs on the server, with an 8-second limit and without the server's environment variables (so it can't read API keys). If the machine is reachable from outside the lab, run the app in a container.
* Sessions live in server memory, so a restart ends them. Files and logs stay.
