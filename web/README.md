# VibeLearner Web

The VibeLearner project mode as a web platform (React Router), so a study needs only a browser on the
participants' side. It is a port of the VS Code extension in the parent folder: the same structured flow
(explain the idea → walk through the code → predict, run & modify), the same prompts and the same JSONL research
log. The editor-independent code (prompts, edit matching, run-based checks, project context) is shared from
`../src`, so both platforms send the model exactly the same prompts.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173, uses the model in vibelearner.config.json (default: local Ollama)
npm run dev:mock     # canned "mock" model: try the whole flow without a model (never with participants)
npm run build && npm start   # production server, http://localhost:3000 (PORT=... to change)
```

The server needs Node 20+ and, for Python programs, Python (`pythonPath` if it isn't on the PATH).

## Settings

Copy `vibelearner.config.example.json` to `vibelearner.config.json`. Keys are the extension's settings, with or
without the `vibelearner.` prefix, so a settings.json can be pasted in. Settings are read whenever a session
starts. Secrets can come from the environment instead: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EDUAI_API_KEY`, and
`VL_PROVIDER`, `VL_MODEL`, `VL_LEVEL`, `OLLAMA_URL`, `OPENAI_BASE_URL`, `VL_PYTHON`, `VL_DATA_DIR`, `VL_CONFIG`.

Providers: `ollama` (default), `openai` (any OpenAI-compatible server via `openaiBaseUrl`), `gemini`, `eduai`, `mock`.

## Research use

* **Conditions** come from `learning.level` (`guided` = structured, `off` = regular vibe coding). With a
  participant code the mode can't be changed in the browser.
* **Data** is in `data/` (or `VL_DATA_DIR`): `study_logs/<code>.jsonl`, one log per participant (only after
  consent; each session's first event records `platform: "web"`, the prompt version, model and settings), and
  `workspaces/p-<code>/`, the participant's files, kept across visits. Visitors without a code get
  `workspaces/anon-<id>/`.
* **Student code runs on the server**, with an 8-second limit and without the server's environment variables
  (so it can't read API keys). On a machine reachable from outside the lab, run the app in a container.
* Sessions live in server memory: a restart ends them (files and logs stay).
