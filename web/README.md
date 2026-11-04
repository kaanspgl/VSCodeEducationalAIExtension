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

To put it on a UBC Okanagan server behind Apache with PM2, see [DEPLOY.md](DEPLOY.md).

## Settings

Copy `vibelearner.config.example.json` to `vibelearner.config.json`. Without it, the defaults are used (Ollama with `qwen3-coder:30b`). The keys are the same as the extension's settings, with or without the `vibelearner.` prefix, so you can paste in a settings.json. The file is re-read whenever a session starts.

Providers: `ollama` (default), `openai` (any OpenAI-compatible server via `openaiBaseUrl`), `gemini` (set `gemini.model` too), `eduai`, and `mock`.

Secrets and a few settings can come from environment variables instead: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EDUAI_API_KEY`, `VL_PROVIDER`, `VL_MODEL`, `VL_LEVEL`, `OLLAMA_URL`, `OPENAI_BASE_URL`, `VL_PYTHON`, `VL_DATA_DIR`, `VL_CONFIG`, `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN`, `VL_RUNNER`, `SITE_PASSWORD`.

With `SITE_PASSWORD` set, the site asks for that password first (once per browser for 30 days; changing the password signs everyone out). Without it the site is open, which is fine on your own machine.

Where programs run: with `judge0.url` (or `JUDGE0_URL`) set, every run goes to that [Judge0](https://judge0.com) server, in a sandbox with no network that holds only the student's project files. `judge0.authToken` is sent in the `judge0.authHeader` header (default `X-Auth-Token`). The newest Python 3 and Node.js on the server are picked automatically; `judge0.pythonLanguageId` / `judge0.javascriptLanguageId` override that. Without a URL, or with `runner` set to `local`, programs run on this machine. To run Judge0 yourself, `judge0/setup.sh` starts it in Docker on 127.0.0.1:2358 and prints its token. `npm run check:runner` tests the configured Judge0, and `npm test` runs the runner's and the password's tests.

## Research use

* The condition comes from `learning.level` (`guided` = structured, `off` = regular vibe coding). With a participant code, the mode can't be changed in the browser.
* Data goes in `data/` (or `VL_DATA_DIR`):
  * `study_logs/<code>.jsonl`: one log per participant, written only after consent. Each session's first event records `platform: "web"`, the prompt version, the model and the settings.
  * `workspaces/p-<code>/`: the participant's files, kept across visits. Visitors without a code get `workspaces/anon-<id>/`.
* Student code runs with an 8-second limit: on Judge0 when it's configured (use this for any deployment), otherwise on the server itself without its environment variables, which still lets it read the server's files.
* Sessions live in server memory, so a restart ends them. Files and logs stay.
