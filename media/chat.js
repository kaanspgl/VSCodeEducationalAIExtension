(function () {
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (e) { return; }

  const app = document.getElementById('app');
  let view = null;
  let lastStage = null;
  let lastTaskKey = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Minimal, safe markdown: fenced code, inline code, bold, italics, paragraphs.
  function md(src) {
    const parts = String(src).split(/```[a-zA-Z]*\n?([\s\S]*?)```/g);
    return parts.map((p, i) => {
      if (i % 2 === 1) return `<pre><code>${esc(p.replace(/\n$/, ''))}</code></pre>`;
      let t = esc(p);
      t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>')
           .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
           .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,]|$)/g, '$1<i>$2</i>');
      const lines = t.split('\n');
      let html = '', inList = false, para = [];
      const flush = () => { if (para.length) { html += `<p>${para.join('<br>')}</p>`; para = []; } };
      for (const line of lines) {
        const li = /^\s*[-•*]\s+(.*)$/.exec(line);
        if (li) { flush(); if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
        if (inList) { html += '</ul>'; inList = false; }
        if (!line.trim()) flush(); else para.push(line);
      }
      flush(); if (inList) html += '</ul>';
      return html;
    }).join('');
  }

  window.addEventListener('message', (e) => {
    const { type, payload } = e.data || {};
    if (type === 'state') { view = payload; render(); }
  });

  function render() {
    if (!view) return;
    const oldInput = document.getElementById('prompt');
    const keepText = oldInput ? oldInput.value : '';
    const hadFocus = oldInput && document.activeElement === oldInput;
    const logScroll = document.getElementById('log');
    const wasAtBottom = !logScroll || logScroll.scrollHeight - logScroll.scrollTop - logScroll.clientHeight < 40;

    if (view.kind === 'vibe') app.innerHTML = vibeHtml();
    else if (view.stage === 'setup') app.innerHTML = setupHtml();
    else if (view.stage === 'survey') app.innerHTML = surveyHtml();
    else if (view.stage === 'done') app.innerHTML = doneHtml();
    else app.innerHTML = taskHtml();

    wire();

    const taskKey = view.stage + ':' + view.taskIndex;
    const log = document.getElementById('log');
    if (log && (wasAtBottom || taskKey !== lastTaskKey)) log.scrollTop = log.scrollHeight;
    lastStage = view.stage; lastTaskKey = taskKey;

    const input = document.getElementById('prompt');
    if (input) {
      input.value = view.draft != null ? view.draft : keepText;
      if (hadFocus || view.draft != null) input.focus();
    }
  }

  // ---------------------------------------------------------------- views
  function setupHtml() {
    return `
      <div class="center-card">
        <h1><span class="dot"></span>VibeLearner</h1>
        <p class="muted">A programming practice tool. You will work through a few short tasks. Your interactions (what you type, the code, test results, and timings) are recorded for a research study.</p>
        <label class="field">Participant code
          <input id="participant" type="text" maxlength="32" autocomplete="off" placeholder="e.g. P014">
        </label>
        <label class="check">
          <input id="consent" type="checkbox">
          <span>I have read the information letter, I consent to take part, and I understand my interactions on these tasks are recorded for research.</span>
        </label>
        <button id="begin" class="btn" disabled>Begin</button>
      </div>`;
  }

  function stepperHtml() {
    if (!view.steps.length) return '';
    return `<ol class="steps">${view.steps.map((s, i) =>
      `<li class="${i < view.currentStep ? 'done' : i === view.currentStep ? 'now' : ''}">${esc(s)}</li>`).join('')}</ol>`;
  }

  function taskHtml() {
    const a = view.actions;
    const msgs = view.messages.map(m => {
      const who = m.role === 'student' ? 'You' : m.role === 'tutor' ? (view.condition === 'direct' ? 'Assistant' : 'VibeLearner') : '';
      return `<div class="msg ${m.role}"><div class="bubble">${md(m.text)}${who ? `<div class="meta">${who}</div>` : ''}</div></div>`;
    }).join('');
    const busy = view.busy
      ? `<div class="msg tutor"><div class="bubble thinking"><span class="spin"></span>${esc(view.busyLabel || 'Working…')}</div></div>` : '';
    const code = view.code
      ? `<details class="codebox" open><summary>Your code <span class="muted">(also open in the editor — you can edit it there)</span></summary><pre><code>${esc(view.code)}</code></pre></details>` : '';
    const quiz = view.quiz
      ? `<div class="quizbox"><div class="hint">Quiz · question ${view.quiz.index + 1} of ${view.quiz.total}</div><div class="stem">${md(view.quiz.stem)}</div>${view.quiz.choices.map((c, i) => `<button class="choice" data-i="${i}"><b>${'ABCD'[i]}.</b> ${esc(c)}</button>`).join('')}</div>`
      : '';
    const tests = view.testSummary ? `<div class="tests">${esc(view.testSummary).replace(/\n/g, '<br>')}</div>` : '';
    const ready = view.condition === 'vibelearner'
      ? `<button class="btn" id="btnReady" ${a.ready ? '' : 'hidden'}>Start the check</button>
         <button class="btn secondary" id="btnNeed" ${a.needCode ? '' : 'hidden'} title="Skip the questions and get the code now">I need the code now</button>` : '';

    return `
      <header class="topbar">
        <div class="brand"><span class="dot"></span>${view.task.free ? 'Build ' + (view.taskIndex + 1) : 'Task ' + (view.taskIndex + 1) + ' / ' + view.taskCount}</div>
        <div class="grow"></div>
        <span class="badge">${esc(view.participant)}</span>
      </header>
      ${stepperHtml()}
      <main class="main">
        ${view.task.free ? '' : `<details class="taskbox" ${view.messages.length <= 2 ? 'open' : ''}>
          <summary><b>${esc(view.task.title)}</b></summary>
          <div class="task-body">${esc(view.task.statement)}<br><span class="muted">Function name: <code>${esc(view.task.fn)}</code> · ${esc(view.task.language)}</span></div>
        </details>`}
        ${code}
        <div id="log" class="scroll" role="log" aria-live="polite">${msgs}${busy}</div>
        ${tests}
        ${quiz}
        <div class="composer">
          <div class="actions">
            <button class="btn secondary" id="btnTests" ${a.runTests ? '' : 'disabled'}>${view.task.free ? 'Run program' : 'Run tests'}</button>
            ${ready}
            <div class="grow"></div>
            <button class="btn secondary" id="btnFinish" ${a.finish ? '' : 'disabled'}>Finish task</button>
          </div>
          <textarea id="prompt" ${view.inputEnabled ? '' : 'disabled'} placeholder="${esc(view.placeholder || '')}"></textarea>
          <div class="composer-row">
            <span class="hint">Enter to send · Shift+Enter for a new line</span>
            <div class="grow"></div>
            <button id="send" class="btn" ${view.inputEnabled ? '' : 'disabled'}>Send</button>
          </div>
        </div>
      </main>`;
  }

  function scale(name, lo, hi, labels) {
    let out = '';
    for (let v = lo; v <= hi; v++) out += `<label class="pt"><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`;
    return `<div class="scale">${out}</div><div class="scale-labels"><span>${esc(labels[0])}</span><span>${esc(labels[1])}</span></div>`;
  }

  function surveyHtml() {
    return `
      <div class="center-card">
        <h2>${view.taskCount === 0 ? 'Build ' : 'Task '}${view.taskIndex + 1} finished</h2>
        <p class="muted">Two quick questions before we continue.</p>
        <div class="q"><div>How much mental effort did this task take?</div>${scale('effort', 1, 9, ['Very low', 'Very high'])}</div>
        <div class="q"><div>“I felt I needed another tool, website, or direct answer to finish this task or understand the code.”</div>${scale('need', 1, 7, ['Strongly disagree', 'Strongly agree'])}</div>
        <label class="field">Anything else? (optional)
          <textarea id="comment" rows="2"></textarea>
        </label>
        <button id="submitSurvey" class="btn">${view.taskCount === 0 ? 'Build something else' : view.taskIndex + 1 < view.taskCount ? 'Next task' : 'Finish'}</button>
      </div>`;
  }

  function doneHtml() {
    return `<div class="center-card"><h2>All done 🎉</h2>${view.messages.map(m => md(m.text)).join('')}</div>`;
  }

  // ---------------------------------------------------------------- events
  function post(type, payload) { vscode.postMessage({ type, payload }); }

  function wire() {
    if (view.kind === 'vibe') return wireVibe();
    const $ = (id) => document.getElementById(id);

    if (view.stage === 'setup') {
      const b = $('begin'), p = $('participant'), c = $('consent');
      const upd = () => { b.disabled = !(p.value.trim().length >= 2 && c.checked); };
      p.addEventListener('input', upd); c.addEventListener('change', upd);
      b.addEventListener('click', () => post('begin', { participant: p.value.trim(), consent: c.checked }));
      return;
    }

    if (view.stage === 'survey') {
      $('submitSurvey').addEventListener('click', () => {
        const effort = document.querySelector('input[name="effort"]:checked');
        const need = document.querySelector('input[name="need"]:checked');
        if (!effort || !need) { $('submitSurvey').textContent = 'Please answer both questions'; return; }
        post('survey', { effort: effort.value, need: need.value, comment: $('comment').value });
      });
      return;
    }

    if (view.stage !== 'task') return;

    const send = () => {
      const t = $('prompt');
      const text = t.value.trim();
      if (!text || t.disabled) return;
      t.value = '';
      post('send', { text });
    };
    $('send').addEventListener('click', send);
    $('prompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => post('quizAnswer', { choice: Number(b.getAttribute('data-i')) })));
    $('btnTests').addEventListener('click', () => post('runTests'));
    $('btnFinish').addEventListener('click', () => post('finish'));
    if ($('btnReady')) $('btnReady').addEventListener('click', () => post('startCheck'));
    if ($('btnNeed')) $('btnNeed').addEventListener('click', () => post('needCode'));
  }

  // ================================================================ project mode (vibe)
  let progressOpen = false;
  const STAGE_ICON = { tour: '🧭', predict: '🔮', check: '✅', challenge: '🛠' };
  const LEVELS = [
    { v: 'guided', label: 'Guided', desc: 'I walk you through every change: plan, walkthrough, predict, check, your turn. Best for learning.' },
    { v: 'light', label: 'Light', desc: 'Learning tools are on each change whenever you want them; nothing starts on its own.' },
    { v: 'off', label: 'Off', desc: 'Just coding, no teaching extras.' },
  ];

  function vibeHtml() {
    if (view.stage === 'setup') return vibeSetupHtml();
    const learn = view.level !== 'off';
    const ctx = view.ctx || { files: 0, active: '', selection: '' };
    const chip = `<span class="badge ctxchip" title="What VibeLearner can see">📁 ${ctx.files} file${ctx.files === 1 ? '' : 's'}${ctx.active ? ' · ' + esc(ctx.active) : ''}${ctx.selection ? ' · <b>' + esc(ctx.selection) + '</b>' : ''}</span>`;
    const msgs = view.messages.map(vMsg).join('');
    const busy = view.busy
      ? `<div class="msg tutor"><div class="bubble thinking"><span class="spin"></span>${esc(view.busyLabel || 'Working…')}</div></div>` : '';

    const q = view.quiz;
    const quiz = q
      ? `<div class="quizbox"><div class="quiz-head"><span class="hint">${esc(q.label)} · question ${q.index + 1} of ${q.total}</span><button class="linkbtn" data-cmd="skipQuiz">Skip</button></div><div class="stem">${md(q.stem)}</div>${q.choices.map((c, i) => `<button class="choice" data-i="${i}"><b>${'ABCD'[i]}.</b> ${esc(c)}</button>`).join('')}</div>`
      : '';

    const t = view.tour;
    const tour = t
      ? `<div class="tourbox">
          <div class="quiz-head"><span class="hint">🧭 Walkthrough · stop ${t.index + 1} of ${t.total} · <code>${esc(t.path)}</code> line${t.start === t.end ? ' ' + t.start : 's ' + t.start + '–' + t.end}${t.pending ? ' (proposed)' : ''}</span><button class="linkbtn" data-cmd="tourEnd">Exit</button></div>
          <div class="tour-title">${esc(t.title)}</div>
          <div>${md(t.text)}</div>
          <div class="cactions">
            <button class="btn secondary sm" data-cmd="tourPrev" ${t.index === 0 ? 'disabled' : ''}>◀ Back</button>
            ${t.index + 1 < t.total
              ? '<button class="btn sm" data-cmd="tourNext">Next ▶</button>'
              : '<button class="btn sm" data-cmd="tourEnd">Finish walkthrough</button>'}
            <span class="hint">The highlighted lines are in the editor.</span>
          </div>
        </div>`
      : '';

    const p = view.plan;
    const plan = p
      ? `<div class="planbox">
          <div class="quiz-head"><span class="hint">📋 Plan: ${esc(p.goal)}</span><button class="linkbtn" data-cmd="dropPlan" title="Stop following this plan">Close</button></div>
          <ol class="plansteps">${p.steps.map(s => `<li class="${s.status}">${s.status === 'done' ? '✓' : s.status === 'doing' ? '▶' : '○'} ${esc(s.title)}</li>`).join('')}</ol>
          ${p.next ? `<div class="cactions"><button class="btn sm" data-cmd="buildNext">Build step ${p.next.index + 1}: ${esc(p.next.title)}</button>${p.remaining > 1 ? '<button class="btn secondary sm" data-cmd="buildAll">Build the rest at once</button>' : ''}</div>` : ''}
        </div>`
      : '';

    const progress = learn ? progressHtml() : '';

    return `
      <header class="topbar">
        <div class="brand"><span class="dot"></span>VibeLearner</div>
        ${view.project ? `<span class="badge projchip" title="Working only inside this folder">📂 ${esc(view.project)}/ <button class="linkbtn" data-cmd="leaveProject" title="Leave project (see the whole workspace)">✕</button></span>` : ''}
        ${chip}
        <div class="grow"></div>
        <label class="levelpick" title="${view.levelLocked ? 'Fixed for this research session' : 'How much learning support to add'}">Learning
          <select id="level" ${view.levelLocked ? 'disabled' : ''}>${LEVELS.map(l => `<option value="${l.v}" ${view.level === l.v ? 'selected' : ''}>${l.label}</option>`).join('')}</select>
        </label>
        ${view.logging ? `<span class="badge" title="Research logging is on">● ${esc(view.participant)}</span>` : ''}
      </header>
      ${progress}
      <main class="main">
        ${plan}
        <div id="log" class="scroll" role="log" aria-live="polite">${msgs}${busy}</div>
        ${tour}
        ${quiz}
        <div class="composer">
          <div class="actions">
            <label class="targetpick" title="Where should new code go?">Code goes in
              <select id="target">
                <option value="auto" ${view.target === 'auto' ? 'selected' : ''}>Auto (VibeLearner decides)</option>
                <option value="new" ${view.target === 'new' ? 'selected' : ''}>A new file</option>
                ${(view.targets || []).map(f => `<option value="${esc(f)}" ${view.target === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
              </select>
            </label>
            <button class="btn secondary sm" data-cmd="newProject" title="Start a new program in its own folder">＋ New project</button>
            <button class="btn secondary sm" data-cmd="explainSelection" ${ctx.selection && view.inputEnabled ? '' : 'disabled'} title="Select code in the editor first">Explain selection</button>
            <button class="btn secondary sm" data-cmd="runFile" ${ctx.active && !view.busy ? '' : 'disabled'} title="Run the active Python/JavaScript file">▶ Run</button>
          </div>
          <textarea id="prompt" ${view.inputEnabled ? '' : 'disabled'} placeholder="${esc(view.placeholder || '')}"></textarea>
          <div class="composer-row">
            <span class="hint">Enter to send · Shift+Enter for a new line</span>
            <div class="grow"></div>
            <button id="send" class="btn" ${view.inputEnabled ? '' : 'disabled'}>Send</button>
          </div>
        </div>
      </main>`;
  }

  function progressHtml() {
    const skills = view.skills || [];
    const concepts = view.concepts || [];
    const any = skills.some(s => s.value !== '—') || concepts.length;
    return `<details class="progress" id="progressBox" ${progressOpen ? 'open' : ''}>
      <summary>📈 Your progress${any ? '' : ' <span class="muted">(builds up as you go)</span>'}</summary>
      <div class="skills">${skills.map(s => `<div class="skill" title="${esc(s.detail)}"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`).join('')}</div>
      ${concepts.length ? `<div class="hint" style="margin-top:6px">Concepts you've worked with</div><div class="chips">${concepts.map(c =>
        `<span class="cchip" title="in ${c.seen} change(s)${c.total ? ', ' + c.right + '/' + c.total + ' questions right' : ''}">${esc(c.name)}${c.total ? ` <span class="${c.right === c.total ? 'ok' : c.right ? 'muted' : 'warn'}">${c.right}/${c.total}</span>` : ''}</span>`).join('')}</div>` : ''}
      <div class="cactions"><button class="btn secondary sm" data-cmd="quizProject" ${view.inputEnabled ? '' : 'disabled'}>Quiz me on my program</button></div>
    </details>`;
  }

  function vMsg(m) {
    const who = m.role === 'student' ? 'You' : m.role === 'tutor' ? 'VibeLearner' : '';
    const tip = m.tip
      ? `<details class="tip"><summary>💡 Prompt tip <span class="muted">(${m.tip.score}/6)</span></summary><div>${md(m.tip.text)}</div>${m.tip.improved ? `<div class="hint" style="margin-top:4px">A stronger version:</div><div class="improved">${esc(m.tip.improved)}</div>` : ''}</details>`
      : '';
    const buttons = m.buttons
      ? `<div class="cactions">${m.buttons.map(b => `<button class="btn ${b.primary ? '' : 'secondary'} sm" data-cmd="${esc(b.cmd)}" data-arg="${esc(b.arg || '')}">${esc(b.label)}</button>`).join('')}</div>`
      : '';
    return `<div class="msg ${m.role}"><div class="bubble">${md(m.text)}${m.changes ? changesHtml(m) : ''}${buttons}${tip}${who ? `<div class="meta">${who}</div>` : ''}</div></div>`;
  }

  function changesHtml(m) {
    const pending = m.changes.filter(c => c.status === 'pending');
    const cards = m.changes.map(c => {
      let act;
      if (c.status === 'pending') {
        act = `<button class="btn secondary sm" data-cmd="viewDiff" data-arg="${c.id}">View diff</button>
               <button class="btn sm" data-cmd="accept" data-arg="${c.id}">Accept</button>
               <button class="btn secondary sm" data-cmd="reject" data-arg="${c.id}">Reject</button>`;
      } else if (c.status === 'accepted') {
        act = '<span class="ok">✓ Applied</span>';
      } else if (c.status === 'rejected') {
        act = '<span class="muted">Rejected</span>';
      } else {
        act = '<span class="warn">Couldn\'t apply</span>';
      }
      const learn = c.learn
        ? `<div class="learnrow">${c.learn.map(s => {
            const needsAccept = s.stage !== 'tour' && c.status !== 'accepted';
            const cls = s.status;
            const dis = s.status === 'done' || s.status === 'na' || s.status === 'active' || needsAccept ? 'disabled' : '';
            const mark = s.status === 'done' ? ' ✓' : s.status === 'skipped' ? ' (skipped)' : s.status === 'na' ? ' —' : '';
            const title = s.status === 'na' ? 'Not available for this change' : needsAccept ? 'Accept the change first' : '';
            return `<button class="stagechip ${cls}" data-cmd="stage" data-arg="${c.id}:${s.stage}" ${dis} title="${title}">${STAGE_ICON[s.stage]} ${esc(s.label)}${mark}</button>`;
          }).join('')}</div>`
        : '';
      return `<div class="change ${c.status}">
          <div class="cfile"><code>${esc(c.path)}</code>${c.isNew ? ' <span class="tag">new file</span>' : ''}
            ${c.status === 'failed' ? '' : `<span class="diffstat"><span class="plus">+${c.added}</span> <span class="minus">−${c.removed}</span></span>`}</div>
          ${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}
          <div class="cactions">${act}</div>
          ${learn}
        </div>`;
    }).join('');
    const all = pending.length > 1 ? `<button class="btn sm" data-cmd="acceptAll" data-arg="${pending[0].id}">Accept all (${pending.length})</button>` : '';
    return `<div class="changes">${cards}${all}</div>`;
  }

  function vibeSetupHtml() {
    return `
      <div class="center-card">
        <h1><span class="dot"></span>VibeLearner</h1>
        <p class="muted">Vibe coding that teaches. Describe what you want and VibeLearner builds it in your project, then helps you understand it: thinking it through, walking through the code, predicting what it does, and trying changes yourself.</p>
        ${view.hasFolder ? '' : '<p class="warn">Open a folder first (File → Open Folder) so I can see your program.</p>'}
        <div id="levelBox" class="levelbox">
          <div class="hint">How much should I teach while we code?</div>
          ${LEVELS.map(l => `<label class="levelopt"><input type="radio" name="lvl" value="${l.v}" ${(view.level || 'guided') === l.v ? 'checked' : ''}><span><b>${l.label}</b> — ${esc(l.desc)}</span></label>`).join('')}
          <div class="hint">You can change this any time from the header.</div>
        </div>
        <button id="vStart" class="btn">Start</button>
        <details class="research">
          <summary>Taking part in a research study? (optional)</summary>
          <label class="field">Participant code
            <input id="participant" type="text" maxlength="32" autocomplete="off" placeholder="e.g. P014">
          </label>
          <label class="check">
            <input id="consent" type="checkbox">
            <span>I have read the information letter, I consent to take part, and I understand my interactions in this session (messages, code changes, answers, timings) are recorded for research.</span>
          </label>
        </details>
      </div>`;
  }

  function wireVibe() {
    const $ = (id) => document.getElementById(id);
    if (view.stage === 'setup') {
      const part = $('participant');
      const lockLevel = () => { $('levelBox').style.display = part.value.trim() ? 'none' : ''; };
      part.addEventListener('input', lockLevel);
      $('vStart').addEventListener('click', () => post('v:begin', {
        participant: (part.value || '').trim(),
        consent: !!$('consent')?.checked,
        level: (document.querySelector('input[name="lvl"]:checked') || {}).value,
      }));
      return;
    }
    const send = () => {
      const t = $('prompt');
      const text = t.value.trim();
      if (!text || t.disabled) return;
      t.value = '';
      post('v:send', { text, target: $('target') ? $('target').value : undefined });
    };
    $('send').addEventListener('click', send);
    $('prompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    if ($('target')) $('target').addEventListener('change', (e) => post('v:action', { cmd: 'setTarget', arg: e.target.value }));
    if ($('level')) $('level').addEventListener('change', (e) => post('v:action', { cmd: 'setLevel', arg: e.target.value }));
    document.querySelectorAll('[data-cmd]').forEach(b => {
      if (view.busy) b.disabled = true;
      b.addEventListener('click', () => post('v:action', { cmd: b.getAttribute('data-cmd'), arg: b.getAttribute('data-arg') || undefined }));
    });
    document.querySelectorAll('.choice').forEach(b => {
      if (view.busy) b.disabled = true;
      b.addEventListener('click', () => post('v:quizAnswer', { choice: Number(b.getAttribute('data-i')) }));
    });
    const pb = $('progressBox');
    if (pb) pb.addEventListener('toggle', () => { progressOpen = pb.open; });
  }

  post('ready');
})();
