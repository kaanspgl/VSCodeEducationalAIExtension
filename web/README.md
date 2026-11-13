# VibeLearner Web

The VibeLearner project mode as a web app (React Router), so participants in a study only need a browser. It's a port of the VS Code extension in the parent folder: same structured flow (explain the idea → walk through the code → predict, run & modify), same prompts, same JSONL research log. The parts that don't depend on an editor (prompts, edit matching, run-based checks, project context) are imported straight from `../src`, so both versions send the model exactly the same prompts.

## Running it

Needs Node 22.22 or newer, and Python if you want to run Python programs (set `pythonPath` if it's not on the PATH; on Windows the Microsoft Store "python" alias is skipped for a real install). Only this folder's dependencies are needed; you don't have to install the extension's.

**Running programs on Judge0 instead.** If the server has a [Judge0](https://judge0.com) instance (e.g. self-hosted on port 2358) and no Python of its own, set `"judge0Url": "http://127.0.0.1:2358"` (and `"judge0Token"` if Judge0 has an `AUTHN_TOKEN`). Every run then goes there: the ▶ Run button, *Predict & run*, the checks on the AI's questions and challenges, and *Check my work*, about 5 to 15 runs per task. It picks the newest Python 3 and Node.js the server lists; set `judge0.pythonId` / `judge0.javascriptId` to use other ones. Judge0 runs each program in its own sandbox, as one file, so a program can't import another file of the project there. The researcher page's *Running Python* check runs a test program on it. Use your own Judge0, not a public one: participants' code would go to a third party.

```bash
npm install
npm run dev:mock     # canned "mock" model: click through the whole flow with no model (never use with participants)
npm run dev          # http://localhost:5173, uses the model from vibelearner.config.json (default: local Ollama)
npm run build && npm start   # production server on http://localhost:3000 (PORT=... to change it)
```

Add `-- --port 5180` to either dev command if 5173 is taken.

## Settings

Copy `vibelearner.config.example.json` to `vibelearner.config.json`. Without it, the defaults are used (Ollama with `qwen3-coder:30b`). The keys are the same as the extension's settings, with or without the `vibelearner.` prefix, so you can paste in a settings.json. The file is re-read whenever a session starts.

Providers: `ollama` (default), `openrouter` (set `openrouter.model`), `gemini` (set `gemini.model`), `openai` (any OpenAI-compatible server via `openaiBaseUrl`), `eduai`, and `mock`.

The easiest way to switch is the **Model** section on the start screen: pick Ollama, OpenRouter or Gemini, choose a model and paste a key. It writes to `vibelearner.config.json` (git ignores it) and never sends a saved key back to the browser. The section only appears when you open the app on the machine running the server (`localhost`), never for participants on other machines (also not behind a reverse proxy such as Apache, where every request arrives as `localhost`), and never at `/study`. Set `"lockSettings": true` to turn it off completely on a study machine.

No money needed: OpenRouter's models ending in `:free` cost nothing (make a free account at openrouter.ai and create a key), but they have a daily request limit and the list changes, so the start screen shows the current ones. Google AI Studio keys have a free tier too.

To show the app inside another site's page (a hosted preview, a demo in a frame), start it with `VL_EMBEDDED=1`: its cookies are then sent inside the frame, over HTTPS or localhost only. Never use that for a study; the researcher page flags it.

Secrets and a few settings can come from environment variables instead (they win over the config file): `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EDUAI_API_KEY`, `VL_PROVIDER`, `VL_MODEL`, `VL_LEVEL`, `OLLAMA_URL`, `OPENAI_BASE_URL`, `VL_PYTHON`, `VL_JUDGE0_URL`, `VL_JUDGE0_TOKEN`, `VL_DATA_DIR`, `VL_CONFIG`.

## Deploying on S378 (dev.sandbox.ok.ubc.ca)

Apache already serves dev.sandbox.ok.ubc.ca over HTTPS and forwards it to `localhost:2025`. Leave its conf alone: it's Ansible managed and shared with other lab sites, so a deploy never restarts it. PM2 runs the app from `web/` with `web/ecosystem.config.cjs` (copy `ecosystem.config.example.cjs`; git ignores it because it holds the password). Participants' programs run on Judge0 in Docker: `web/judge0/`, set up once with `sudo ./setup.sh`.

In `ecosystem.config.cjs`: `ADMIN_PASSWORD` (the researcher page), `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN` (printed by `judge0/setup.sh`), the model (`VL_PROVIDER`, `EDUAI_API_KEY`), `PORT: 2025` and `HOST: 127.0.0.1`. The `VL_` names (`VL_ADMIN_PASSWORD`, `VL_JUDGE0_URL`, `VL_JUDGE0_TOKEN`) work too. In `web/vibelearner.config.json`, set `"lockSettings": true`.

To update the site: `cd /srv/www/vibelearner/web && ./deploy.sh` (`--force` rebuilds without a new commit). It pulls the branch, runs `npm ci` and `npm run build`, restarts the app under PM2 and checks that it answers. A restart ends every open session (participants sign in again with their code and carry on), so don't deploy while someone is taking part.

`react-router.config.ts` lists the site's host name in `allowedActionOrigins`. Behind Apache the app sees `localhost:2025` instead of the browser's address, and React Router answers "Bad Request" to the admin page's buttons from any host not listed there, so add a new host there before using it.

The study itself (plan, quiz links, consent text, participant list) lives in `web/data/`, not in git: set it up on https://dev.sandbox.ok.ubc.ca/admin.

## Running a study

Everything is set up on the researcher page at `/admin`. It is off until the server is started with an admin password:

```bash
VL_ADMIN_PASSWORD='choose-a-long-one' npm start
```

Give participants the address `/study`. It opens straight on the consent form and offers nothing but the study. (The ordinary start screen has the same way in, under **Taking part in a research study?**.)

### What a participant sees

1. **Consent form.** They read it and tick the box. Nothing is recorded, and they can't sign in, before that. *I don't want to take part* ends there.
2. **Sign-in** with the participant code the researcher handed out. Codes aren't case-sensitive.
3. For each part of the plan: **quiz before** (opens in a new tab) → **the tasks**, one at a time above the conversation, with a clock → **quiz after**. *Next question* and *Previous* move between tasks; *Finish part* is always there and ends the part for good. In Structured mode the tutor says when all three steps for a task are done and offers *Next question* in the conversation (on the last task it points to *Finish part*, which stays on the bar because it can't be undone).
4. A link to the **closing questionnaire**, and a button for the researcher to sign the browser out for the next participant.

A participant who closes the tab, signs out, or whose session ends with a server restart signs in again with the same code and carries on at the same part and task, with their files.

In a study session the screen never names the mode (participants aren't told which version they are using in each part).

### What the researcher sets up

* **Ready for a session?** A checklist against what the study needs: the plan, all four quiz links and the questionnaire link, the participant list and how even the two order groups are, the model (the mock model and outside providers are flagged), Python (run on this machine, or on Judge0 if `judge0Url` is set), the study protocol, the consent text, and whether the configuration is frozen. **Test the model** sends one real request. **Freeze this configuration** records a fingerprint of the model, prompts, settings, where programs run (here or Judge0) and tasks; afterwards any change is flagged, and every session logs the fingerprint it ran with (`configHash`).
* **Study plan.** One or more parts, each with a concept, a set of tasks and quiz links for before and after the part (e.g. Qualtrics). Part 1 runs in the participant's own condition and each later part switches to the other one, so with two parts everyone works once with structured vibe coding and once with regular AI, and the list decides which comes first. Each part has its own conversation and its own folder, so the AI never sees an earlier part's code. Each part can have a suggested time, which shows the participant a clock (nothing is cut off when it runs out), and the plan can end with a link to a closing questionnaire. **Load the Loops and Lists plan** fills in the COSC 449 study's two parts (12 minutes each); paste your quiz links in afterwards. A step without a link is skipped, which is why the checklist flags a missing one.
* **Consent form.** The built-in text sums up the study from its proposal. Replace it with the wording the ethics board approved. Each consent is logged with the version of the text that was on screen.
* **Participant list.** Add the codes you hand out (e.g. `P001 P002 …`) and an order for each, or *Random*, which puts each new code in the smaller order group. Once the list has codes, only those codes can sign in. While the list is empty, any code is accepted and the condition comes from `learning.level`.
* **Participants.** Where each one is in the plan and what they've done; **Conversation** (everything they typed and what the AI answered, with each step in between, tagged e.g. *during Modify*, and the reason any step couldn't be done), their raw log, and a .zip of everything recorded for them. Under *More*: **Restart** sends them back to the start of the plan, **Withdraw** deletes their log, files and progress for good (the code stays on the list as withdrawn and can't sign in again; someone who withdrew no longer counts when *Random* balances the groups), **Remove** takes a code off the list and keeps its data.
* **Data.** The summary CSV (below), the requests to score, and everything in one .zip for moving to long-term storage.

Quiz links get `?pid=<code>&part=<n>&when=pre|post` added (`when=end` for the questionnaire). In Qualtrics, add `pid`, `part` and `when` as embedded data fields in the survey flow to record them with the answers. VibeLearner can't see whether a quiz was submitted: the participant presses a button to say they've finished.

### The study protocol

In a study-plan session the two modes differ only in what the study describes: explaining the idea before any code (up to 3 rounds of guiding questions), the walkthrough before accepting, predicting the output and then running it, and a "what if" question followed by a change to make. Everything else Structured mode can do outside a study is off: clarifying questions, the prompt tip under each request, plans for big builds and the progress panel. Both modes write code from the same system prompt (the teaching one, which among other things never says what the program prints). Diffs, accept and reject, running programs, and the *Explain this error* and *Explain selection* buttons are the same in both.

`"study.strictProtocol": false` turns the extras back on, and `"study.sameCodePrompt": false` gives regular mode its own plainer prompt. Both are recorded in every session's first log event, with the rest of the settings.

### The summary CSV

One line per participant and part. The columns follow the study's measures:

| Measure | Columns |
| --- | --- |
| Which mode, in which order | `order_group`, `part`, `concept`, `mode` |
| Tasks reached in the suggested time | `question_reached`, `question_reached_in_time`, `tasks_with_code_accepted`, `tasks_with_code_accepted_in_time` |
| Time | `part_seconds` (first task to *Finish part*), `active_seconds` (gaps over five minutes left out), `ai_wait_seconds`, `active_seconds_without_ai_wait` |
| Code viewed before accepting | `changes_accepted`, `accepted_after_viewing_code` |
| What the participant chose to do | `questions_about_code` (requests answered without a code change), `program_runs`, `own_edits`, `changes_rejected` |
| Explaining the idea | `ideas_unaided`, `ideas_scaffolded`, `ideas_skipped` |
| Prediction and modification | `predictions_right`, `predictions_total`, `predictions_skipped`, `modify_done`, `modify_given` |
| The platform's checks on its own items | `quiz_items_verified`, `quiz_items_corrected`, `quiz_items_dropped`, `modify_tasks_verified`, `modify_tasks_dropped` |
| Configuration | `config` (the fingerprint each session ran with) |

What Structured mode requires is kept out of the "chose to do" columns: the run inside *Predict*, and edits or requests made while a *Modify* challenge is open (`duringChallenge` in the log). `own_edits` counts bursts of typing: edits to a file within 30 seconds of each other count once.

**Requests to score** has the first request each participant typed for each task that asked for a program, in an order that says nothing about who or when, without the participant or the mode, and with empty columns for the three scores. A fixed pseudo-random fifth is marked for the second scorer. **Scoring key** maps each row back to its participant, part and mode.

The admin password is checked on the server, sign-in is held for a minute after five wrong tries, and the page is signed out when the password changes. Serve the app over HTTPS if it is reachable from outside the lab: the password and the participants' work travel over the same connection.

## Research use

* The condition comes from the participant list, or from `learning.level` while the list is empty (`guided` = structured, `off` = regular vibe coding). With a participant code, the mode can't be changed in the browser.
* Data goes in `data/` (or `VL_DATA_DIR`), with each participant's data under their own code:
  * `study_logs/<code>.jsonl`: one log per participant, written only after consent. It starts with a `consent` event; each session's first `vibe_session` event records `platform: "web"`, the prompt version, the model and the settings. With a study plan, every event's `taskId` says which part and task it belongs to (`part1:q2`, `part2:pre`) and its `condition` says which mode was in force; `study_step` events mark each quiz and task being shown and finished.
  * `progress/<code>.json`: where the participant is in the plan.
  * `workspaces/p-<code>/`: the participant's files, kept across visits (in `part1/`, `part2/`, … with a study plan). Visitors without a code get `workspaces/anon-<id>/`.
  * `roster.json`, `study.json`, `consent.md`, `frozen.json`: the participant list, the plan, your consent wording and the frozen configuration.
* Time waiting for the system is logged so it can be taken out of active time: every model call has its duration (`llmMs`), and each stretch of waiting is one `vibe_wait` event.
* Student code runs on the server, with an 8-second limit and without the server's environment variables (so it can't read API keys), or in Judge0's sandbox when `judge0Url` is set. Each session's first log event says which (`runner`). If the machine is reachable from outside the lab, run the app in a container.
* Sessions live in server memory, so a restart ends them. Files, logs and progress stay.
