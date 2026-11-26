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

Providers: `ollama` (default), `eduai` (UBC's campus models; set `eduai.model`), `openrouter` (set `openrouter.model`), `gemini` (set `gemini.model`), `openai` (any OpenAI-compatible server via `openaiBaseUrl`), and `mock`.

The easiest way to switch is the **Model** section on the start screen: pick Ollama, EduAI, OpenRouter or Gemini, choose a model and paste a key. It writes to `vibelearner.config.json` (git ignores it) and never sends a saved key back to the browser. The section only appears when you open the app on the machine running the server (`localhost`), never for participants on other machines (also not behind a reverse proxy such as Apache, where every request arrives as `localhost`), and never at `/study`. Set `"lockSettings": true` to turn it off completely on a study machine.

No money needed: OpenRouter's models ending in `:free` cost nothing (make a free account at openrouter.ai and create a key), but they have a daily request limit and the list changes, so the start screen shows the current ones. Google AI Studio keys have a free tier too (create one at aistudio.google.com/apikey); the default `gemini.model` is `gemini-3.1-flash-lite`, because the full Flash models are often busy on the free tier. Each call to Gemini waits at most 90 s and retries busy answers within 3 minutes. On the free tier Google may use what is sent to improve its products and people may read it, so use Gemini (and OpenRouter) only to try the app out, never with participants: the proposal keeps their data on UBC computers.

To show the app inside another site's page (a hosted preview, a demo in a frame), start it with `VL_EMBEDDED=1`: its cookies are then sent inside the frame, over HTTPS or localhost only. Never use that for a study; the researcher page flags it.

Secrets and a few settings can come from environment variables instead (they win over the config file): `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `EDUAI_API_KEY`, `EDUAI_MODEL`, `VL_PROVIDER`, `VL_MODEL`, `VL_LEVEL`, `OLLAMA_URL`, `OPENAI_BASE_URL`, `VL_PYTHON`, `VL_JUDGE0_URL`, `VL_JUDGE0_TOKEN`, `VL_DATA_DIR`, `VL_CONFIG`.

### EduAI

The study uses UBC's EduAI (`app/.server/eduai.ts`): `POST https://my.eduai.ok.ubc.ca/api/completion` with the key in `x-api-key`. The key needs API access from an EduAI administrator; create it in EduAI under Settings, then API Keys (it's shown once). Only campus models work, and their names start with `vllm:`:

| `eduai.model` | Context window | Notes |
| --- | --- | --- |
| `vllm:qwen3.8-27b-instruct` (default) | 65,536 tokens | Best answers; one server, shared with course chat, so it's slower when courses are busy |
| `vllm:qwen3.5-9b-instruct` | 16,384 tokens | Faster; a whole project in the prompt may not fit |
| `vllm:qwen3.5-2b-instruct` | 16,384 tokens | Fastest, weakest |

What the app does about EduAI's limits:

* **Context window.** The prompt plus `eduai.maxTokens` (default 4,096) must fit, and one token over is refused. Before sending, the app guesses the prompt's tokens (1 per 3 characters, plus 10% spare) and lowers `maxTokens` to fit. If fewer than 1,024 tokens would be left for the answer, it shows an error instead of sending.
* **Two at a time.** EduAI runs at most 2 requests from all student keys together. This server sends at most `eduai.maxConcurrent` (default 2) at once and queues the rest. When EduAI answers busy (503) or rate-limited (429), the app waits for `Retry-After` and tries again, up to 4 attempts and 90 seconds of waiting in total. After that, the participant sees "busy, try again".
* **Daily allowance.** Every participant uses the same key, and its limit is by default 200 requests and 200,000 tokens in any 24 hours. Each participant message makes a few requests, and each one carries the project's code, so this runs out after a few participants a day. Run a pilot session, check the use under "Your API access" in EduAI's Settings, then API Keys, and ask the EduAI administrator for a higher limit before the study starts. When the limit is used up, participants see a message that says so.
* **Rules.** EduAI's terms say the key is for the purpose the access was given for and must not run a service that other people use. Make sure the administrator granted the access for this study. Participants' messages and code go to EduAI's servers (the prompts aren't stored there), so the ethics approval must cover that.

## Deploying on S378 (dev.sandbox.ok.ubc.ca)

Apache already serves dev.sandbox.ok.ubc.ca over HTTPS and forwards it to `localhost:2025`. Leave its conf alone: it's Ansible managed and shared with other lab sites, so a deploy never restarts it. PM2 runs the app from `web/` with `web/ecosystem.config.cjs` (copy `ecosystem.config.example.cjs`; git ignores it because it holds the password). Participants' programs run on Judge0 in Docker: `web/judge0/`, set up once with `sudo ./setup.sh`.

In `ecosystem.config.cjs`: `ADMIN_PASSWORD` (the researcher page), `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN` (printed by `judge0/setup.sh`), the model (`VL_PROVIDER: "eduai"`, `EDUAI_API_KEY`, and `EDUAI_MODEL` if not the default), `PORT: 2025` and `HOST: 127.0.0.1`. The `VL_` names (`VL_ADMIN_PASSWORD`, `VL_JUDGE0_URL`, `VL_JUDGE0_TOKEN`) work too. In `web/vibelearner.config.json`, set `"lockSettings": true`.

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
3. For each part of the plan: **quiz before** (opens in a new tab) → **the tasks**, one at a time, with a clock in the top bar → **quiz after**. *Next question* and *Previous* move between tasks; moving on closes any step still waiting on the task left behind (an unanswered *Explain the idea*, a prediction, a walkthrough or a question), and it is logged as left. *Finish part* (bottom left) ends the part for good, and with fixed time (below) it unlocks when the clock reaches the part's minutes: until then the button reads *Finish part 1 at 12:00*, and on the last task a note above it says to keep working with the programs. In Structured mode the tutor says when all three steps for a task are done and offers *Next question* in the conversation and in the guide.
4. A link to the **closing questionnaire**, and a button for the researcher to sign the browser out for the next participant.

The working screen has three columns. **Left, the guide:** the question and the way between questions, and *Finish part*. In Structured mode it also shows a *Do this now* card (the one thing to do next, and where: the chat box, the box under the code, or the Accept / Reject bar) and the three steps as a checklist, with their parts (walk through, accept, predict, question, change it) ticked off as they happen. Regular mode shows the question only, with no steps and no *Do this now*, so the two modes still differ only in the steps the study describes. **Middle, the code:** files as tabs, ▶ Run with the program input, a bar with *Compare*, *Reject* and *Accept* while new code is waiting, the walkthrough and the "what if" question in a box right under the code they are about, and the output of the last ▶ Run at the bottom. **Right, the conversation:** folded into a section per question (outside a study, per request), and in Structured mode a section per step inside it. Earlier questions and earlier steps fold to one line each (open them with a click, or *Show everything*); a section with code still waiting to be accepted stays open.

A participant who closes the tab, signs out, or whose session ends with a server restart signs in again with the same code and carries on at the same part and task, with their files.

In a study session the screen never names the mode (participants aren't told which version they are using in each part).

### What the researcher sets up

* **Ready for a session?** A checklist against what the study needs: the plan and its key ideas, all four quiz links and the questionnaire link, the participant list and how even the two order groups are, the model (the mock model and outside providers are flagged), Python (run on this machine, or on Judge0 if `judge0Url` is set), the study protocol, the consent text, and whether the configuration is frozen. **Test the model** sends one real request. **Freeze this configuration** records a fingerprint of the model, prompts, settings, where programs run (here or Judge0), tasks and key ideas; afterwards any change is flagged, and every session logs the fingerprint it ran with (`configHash`).
* **Study plan.** One or more parts, each with a concept, a set of tasks and quiz links for before and after the part (e.g. Qualtrics). Part 1 runs in the participant's own condition and each later part switches to the other one, so with two parts everyone works once with structured vibe coding and once with regular AI, and the list decides which comes first. Each part has its own conversation and its own folder, so the AI never sees an earlier part's code, and each task's program goes in its own file (`question1.py`, `question2.py`, …) unless the participant picks another under *Code goes in*. Each part can have a time, which shows the participant a clock (nothing is cut off when it runs out), and the plan can end with a link to a closing questionnaire. A task line can end with its **key ideas** after `||`, separated by `;`: what a complete explanation of the program says (what it starts with, its steps, what it shows). Structured mode's *Explain the idea* checks every participant against the same ones; participants never see them. **Load the Loops and Lists plan** fills in the COSC 449 study's two parts (12 minutes each) with key ideas for all six tasks; paste your quiz links in afterwards. A step without a link is skipped, which is why the checklist flags a missing one.
* **Consent form.** The built-in text sums up the study from its proposal. Replace it with the wording the ethics board approved. Each consent is logged with the version of the text that was on screen.
* **Participant list.** Add the codes you hand out (e.g. `P001 P002 …`) and an order for each, or *Random*, which puts each new code in the smaller order group. Once the list has codes, only those codes can sign in. While the list is empty, any code is accepted and the condition comes from `learning.level`.
* **Participants.** Where each one is in the plan and what they've done; **Conversation** (everything they typed and what the AI answered, with each step in between, tagged e.g. *during Modify*, and the reason any step couldn't be done), their raw log, and a .zip of everything recorded for them. Under *More*: **Restart** sends them back to the start of the plan, **Withdraw** deletes their log, files and progress for good (the code stays on the list as withdrawn and can't sign in again; someone who withdrew no longer counts when *Random* balances the groups), **Remove** takes a code off the list and keeps its data.
* **Data.** The summary CSV (below), the requests to score, and everything in one .zip for moving to long-term storage.

Quiz links get `?pid=<code>&part=<n>&when=pre|post` added (`when=end` for the questionnaire). In Qualtrics, add `pid`, `part` and `when` as embedded data fields in the survey flow to record them with the answers. VibeLearner can't see whether a quiz was submitted: the participant presses a button to say they've finished.

### The study protocol

In a study-plan session the two modes differ only in what the study describes: explaining the idea before any code (up to 3 rounds of guiding questions), the walkthrough before accepting, predicting the output and then running it, and a "what if" question followed by a change to make. Everything else Structured mode can do outside a study is off: clarifying questions, the prompt tip under each request, plans for big builds and the progress panel. Both modes write code from the same system prompt (the teaching one, which among other things never says what the program prints). Diffs, accept and reject, running programs, and the *Explain this error* and *Explain selection* buttons are the same in both.

`"study.strictProtocol": false` turns the extras back on, and `"study.sameCodePrompt": false` gives regular mode its own plainer prompt. In both modes nothing can be pasted or dropped into the chat box (the box says so, and each attempt is logged as `paste_blocked`): the task text names the program's input and output, so a pasted request would score as a complete description (H3). `"study.blockPaste": false` allows pasting again.

**Fixed time** (`"study.fixedTime"`, on by default): a part can't be finished before its minutes are up. In a dry run a Regular task took under a minute and a Structured one two to three, so without it the Structured topic would get several times the time on task, and the quiz gains (H1) would partly measure time. The minutes stay a minimum: nobody is cut off when they run out. What participants do with spare time in Regular mode is their own choice, so it counts towards H2. `false` lets a part be finished at any time; the checklist then warns. All four settings are recorded in every session's first log event, with the rest of the settings.

How the steps behave, in both modes unless it says otherwise:

* **A question gets an answer, not code.** A message that asks about the code ("why is it 51 and not 50?", "what does % do?") is answered without any code change, so it is never a change to review and always counts in `questions_about_code`. During a walkthrough every message is taken as a question or comment about the code being shown; only a plain request for a change ("make it go to 100") is told to wait until the code is accepted. Without this, a question asked during the walkthrough could start a new *Explain the idea* for a program nobody asked for.
* **Explain the idea** (Structured) asks for how the program will work in plain words: what it starts with, what it does each time round, and what it shows at the end, the same three things the request rubric scores (H3). Naming the goal isn't enough: "add the numbers from 1 to 50" still gets asked how. The model quotes the participant's own words for each key idea, and the code checks the quotes against what they really wrote. An idea explained once stays explained, and every content word of an idea appearing in their words also counts. Words copied from the task only count for what the task itself states, so a task typed out still has to explain the running total. After three rounds the tutor states what's missing and writes the code (`ideas_scaffolded`). The log keeps each round's quotes (`evidence`) and what decided the verdict.
* **Predict**: a number that takes long to work out by hand (1 + 2 + … + 50 is 1275) can be written as the calculation that gives it: `1 + 2 + … + 50`, `50 × 51 ÷ 2`, `2 + 4 + … + 20`. Working out the sum proves nothing about the code, but the calculation states where the loop starts, where it stops and what it does each time round. The platform works it out, not the model: a guess that matches the output exactly once its calculations are worked out is right (`judgedBy: "calculation"`), and otherwise the model judges it with the worked-out values in front of it. Ranges ("1-50"), open-ended series ("1 + 2 + …") and words ("the sum of 1 to 50") are not calculations. A guess that names none of the printed numbers, even as a calculation ("the total of all the numbers"), still isn't counted as right, and gets the same feedback for everyone (`predictions_without_a_value`). Each prediction's calculations are logged (`calculations`, and `valueByCalculation` when one stood in for a printed number), and the conversation view on /admin shows them.
* **The "what if" question** is run to check its answer key. If no choice names the real output but the key doesn't contradict it, the question is kept and its explanation gives the real output (`quiz_items_unverified`). If every question fails the check, one more is asked for. When two choices both name the real output, either one is marked right.

### The summary CSV

One line per participant and part. The columns follow the study's measures:

| Measure | Columns |
| --- | --- |
| Which mode, in which order | `order_group`, `part`, `concept`, `mode` |
| Tasks reached in the suggested time | `question_reached`, `question_reached_in_time`, `tasks_with_code_accepted`, `tasks_with_code_accepted_in_time` |
| Time | `part_seconds` (first task to *Finish part*), `active_seconds` (gaps over five minutes left out), `ai_wait_seconds`, `active_seconds_without_ai_wait` |
| Code viewed before accepting | `changes_accepted`, `accepted_after_viewing_code` (either way), `accepted_after_opening_diff` (the participant's choice), `accepted_after_walkthrough` (required in Structured mode) |
| What the participant chose to do (H2) | `questions_about_code` (requests answered without a code change), of which `questions_in_walkthrough` and `questions_during_modify`; `program_runs`, of which `program_runs_during_modify`; `own_edits`; `changes_rejected` |
| Explaining the idea | `ideas_unaided`, `ideas_scaffolded`, `ideas_skipped` (*Skip* pressed, or moved to another task before finishing it) |
| Prediction and modification | `predictions_right` (exact, exact once its calculations are worked out, or judged right by the model), `predictions_exact`, `predictions_by_calculation` (right ones that gave a printed number as a calculation: subtract them for the strict reading), `predictions_without_a_value` (counted as not right), `predictions_total`, `predictions_skipped`, `modify_done`, `modify_given` |
| The platform's checks on its own items | `quiz_items_verified`, `quiz_items_corrected`, `quiz_items_dropped`, `quiz_items_unverified` (shown without a run confirming the key), `modify_tasks_verified`, `modify_tasks_dropped` |
| Configuration | `config` (the fingerprint each session ran with) |

The steps Structured mode requires leave no trace in the H2 columns: the run inside *Predict* is the platform's, the walkthrough and the check question have their own events, and edits made while a *Modify* challenge is open aren't in `own_edits` (`duringChallenge` in the log). Runs and questions during the walkthrough or a *Modify* challenge are the participant's choice but happen inside a required step, so they are counted in the totals and again in their own columns: subtract them for the strict reading of H2 (runs during *Modify* test the required change). `own_edits` counts bursts of typing: edits to a file within 30 seconds of each other count once. `questions_about_code` is decided by the reply: a plain question always gets a reply without code (and `question: true` on its request in the log), but a request for a program that the AI answered without code would count too, so read the logged replies in the pilot.

**Requests to score** has the first request each participant typed for each task that asked for a program, in an order that says nothing about who or when, without the participant or the mode, and with empty columns for the three scores. A fixed pseudo-random fifth is marked for the second scorer. **Scoring key** maps each row back to its participant, part and mode, and flags copying: `pasted_chars` (characters pasted into the chat box that are still in the request; always 0 while `study.blockPaste` is on), `request_chars` and `words_shared_with_task` (the longest run of words the request shares with the task text, which also catches a task typed out word for word). A request copied from the task states the input and output because the task does, not because the participant described them. `pastes_blocked` in the summary counts attempts to paste.

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
