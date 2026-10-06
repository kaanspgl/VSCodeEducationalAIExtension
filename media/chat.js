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

    if (view.stage === 'setup') app.innerHTML = setupHtml();
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

  post('ready');
})();
