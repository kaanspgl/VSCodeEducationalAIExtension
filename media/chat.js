(function () {
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (e) { return; }

  const boot = (window.__EDUAI_BOOT__ || { model: 'qwen3-coder:30b' });

  // --- State ---------------------------------------------------------------
  let messages = [];   // {id, role, text, kind?}
  let attached = {};   // scope -> result
  let lastQuizJson = null; // stored quiz for evaluation round-trips
  const uid = () => Math.random().toString(36).slice(2);
  const $ = (id) => document.getElementById(id);

  // Simple objectives display
  let objectives = [
    { id: 'ob1', label: 'Explain the intent', status: 'partial' },
    { id: 'ob2', label: 'Choose a correct strategy', status: 'unassessed' },
    { id: 'ob3', label: 'Generalize with a what-if', status: 'unassessed' },
  ];
  renderObjectives();

  // --- Webview receive -----------------------------------------------------
  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    if (type === 'answer') {
      handleAnswer(payload);
      setStatus('Idle');
    } else if (type === 'activeContext') {
      const { language, selection, filename } = payload || {};
      const part = selection ? `\n\nSelection (\`${language}\`, ${filename}):\n\n${selection}` : '';
      if ($('prompt')) $('prompt').value = ( $('prompt').value || '' ) + part;
    } else if (type === 'ctx:result') {
      attached[payload.scope] = payload.result;
      renderContext();
    } else if (type === 'thread:exported') {
      const a = document.createElement('a'); a.href = payload.href; a.download = ''; a.click(); a.remove();
    } else if (type === 'usage') {
      const total = payload?.totalTokens || payload?.total || 0;
      if ($('tokenStats')) $('tokenStats').textContent = `${total} tokens`;
    }
  });

  // --- UI wiring -----------------------------------------------------------
  on('use-selection', 'click', () => vscode.postMessage({ type: 'requestActiveContext' }));
  on('send', 'click', runChat);
  on('newThread', 'click', () => { messages = []; attached = {}; lastQuizJson = null; render(); renderContext(); persist(); });
  on('saveThread', 'click', () => vscode.postMessage({ type: 'thread:save', payload: { title: '', messages } }));
  on('exportMd', 'click', () => vscode.postMessage({ type: 'thread:export', payload: { format: 'md', messages } }));
  on('exportJson', 'click', () => vscode.postMessage({ type: 'thread:export', payload: { format: 'json', messages } }));
  on('clearChat', 'click', () => { messages = []; render(); persist(); });

  // Quick actions
  document.querySelectorAll('.qa')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-action');
      if (act === 'quiz') { fireQuiz(); return; } // send immediately, ignore Socratic in backend
      const map = {
        hints: 'Give only guiding questions, no answers.',
        explain: 'Explain this like Khan Academy with one tiny runnable example and two CFU questions.',
        plan: 'Show a step-by-step plan with subgoals and pitfalls.',
        review: 'Review this code for correctness, readability, and edge cases. Provide a short diff patch.',
        reflect: 'Ask me for a 1–2 sentence reflection about what I changed and why.',
      };
      if ($('prompt')) { $('prompt').value = map[act] || ''; $('prompt').focus(); }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runChat();
  });

  // --- Actions -------------------------------------------------------------
  function fireQuiz() {
    const assist = $('assist')?.value || 'Socratic';
    const model  = $('model')?.value  || (boot && boot.model) || 'qwen3-coder:30b';
    const text   = 'Generate a 3-question multiple-choice quiz about my current selection/context.';

    appendUser('[CFU Quiz]');
    setStatus('Building quiz…');

    vscode.postMessage({
      type: 'ask',
      payload: {
        text,
        meta: {
          assist,      // passed but IGNORED by backend for quiz modes
          model,
          mode: 'quiz',
          objectives: objectives.map(o => o.label),
          context: attached,
        }
      }
    });
  }

  function runChat() {
    const text = ($('prompt')?.value || '').trim();
    if (!text) return;
    const assist = $('assist')?.value || 'Socratic';
    const model  = $('model')?.value  || (boot && boot.model) || 'qwen3-coder:30b';

    appendUser(text);
    $('prompt').value = '';
    setStatus('Thinking…');

    vscode.postMessage({
      type: 'ask',
      payload: {
        text,
        meta: {
          assist,
          model,
          mode: inferModeFromText(text),
          objectives: objectives.map(o => o.label),
          context: attached,
        }
      }
    });
  }

  function inferModeFromText(t) {
    if (/CFU|quiz/i.test(t)) return 'quiz';
    if (/review/i.test(t)) return 'review';
    if (/hints/i.test(t)) return 'hints';
    if (/plan/i.test(t)) return 'plan';
    if (/reflect/i.test(t)) return 'reflect';
    if (/explain/i.test(t)) return 'explain';
    return 'chat';
  }

  // --- Handling answers -----------------------------------------------------
  function handleAnswer(text) {
    const parsed = tryParseJson(text);
    if (parsed && parsed.type === 'quiz' && Array.isArray(parsed.questions)) {
      lastQuizJson = parsed;
      appendQuiz(parsed);
      persist();
      return;
    }
    if (parsed && parsed.type === 'quiz-eval' && parsed.qId) {
      applyQuizEval(parsed);
      persist();
      return;
    }
    appendAI(text); // normal message
  }

  function tryParseJson(s) {
    try {
      const trimmed = String(s).trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
      return JSON.parse(trimmed);
    } catch { return null; }
  }

  // --- Rendering ------------------------------------------------------------
  function appendUser(text)  { messages.push({ id: uid(), role: 'user', text }); render(); persist(); }
  function appendAI(text)    { messages.push({ id: uid(), role: 'assistant', text }); render(); persist(); }
  function appendQuiz(quiz)  { messages.push({ id: uid(), role: 'assistant', kind: 'quiz', text: JSON.stringify(quiz) }); render(); }

  function render() {
    const log = $('log'); if (!log) return;
    log.innerHTML = messages.map(tplMessage).join('');
    wireMessageActions(log);
    log.scrollTop = log.scrollHeight;
  }

  function tplMessage(m) {
    const isAI = m.role === 'assistant';
    if (isAI && m.kind === 'quiz') {
      const quiz = tryParseJson(m.text);
      return renderQuizHtml(m.id, quiz);
    }
    return `
      <div class="msg ${isAI ? 'ai' : 'user'}">
        <div class="avatar">${isAI ? '🧑‍🏫' : '👩‍💻'}</div>
        <div class="bubble">${renderMarkdown(escapeHtml(m.text))}
          <div class="meta">${isAI ? 'Tutor' : 'You'}</div>
        </div>
      </div>`;
  }

  function renderQuizHtml(msgId, quiz) {
    if (!quiz || !Array.isArray(quiz.questions)) return '';
    const blocks = quiz.questions.map(q => `
      <div class="q" data-qid="${q.id}">
        <div class="stem"><b>Q:</b> ${escapeHtml(q.stem || '')}</div>
        ${q.choices.map(c => `
          <label class="choice">
            <input type="radio" name="rad-${msgId}-${q.id}" value="${c.id}">
            <span>${escapeHtml(c.text)}</span>
          </label>
        `).join('')}
        <div class="actions">
          <button class="btn secondary submit-q" data-qid="${q.id}" data-msg="${msgId}">Submit</button>
        </div>
        <div class="feedback" id="fb-${q.id}"></div>
      </div>
    `).join('');
    return `
      <div class="msg ai">
        <div class="avatar">🧑‍🏫</div>
        <div class="bubble">
          <div class="quiz" data-msg="${msgId}">
            ${quiz.title ? `<div class="hint" style="margin-bottom:6px">${escapeHtml(quiz.title)}</div>` : ''}
            ${blocks}
          </div>
          <div class="meta">Tutor • Interactive Quiz</div>
        </div>
      </div>`;
  }

  function wireMessageActions(root) {
    // Per-question submit
    root.querySelectorAll('.submit-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const qId = btn.getAttribute('data-qid');
        const msgId = btn.getAttribute('data-msg');
        const group = `rad-${msgId}-${qId}`;
        const selected = root.querySelector(`input[name="${group}"]:checked`);
        const fb = document.getElementById(`fb-${qId}`);
        if (!selected) {
          if (fb) fb.textContent = 'Pick an option before submitting.';
          return;
        }
        const choiceId = selected.value;
        // Disable inputs for this q
        root.querySelectorAll(`input[name="${group}"]`).forEach(inp => inp.disabled = true);
        btn.disabled = true;
        evalQuizChoice(qId, choiceId);
      });
    });
  }

  // --- Quiz evaluation ------------------------------------------------------
  function evalQuizChoice(qId, choiceId) {
    if (!lastQuizJson || !qId || !choiceId) return;
    const assist = $('assist')?.value || 'Socratic';
    const model  = $('model')?.value  || (boot && boot.model) || 'qwen3-coder:30b';

    setStatus('Grading…');

    const evalPayload = JSON.stringify({ quiz: lastQuizJson, qId, choiceId });

    vscode.postMessage({
      type: 'ask',
      payload: {
        text: `Evaluate this quiz answer:\n${evalPayload}`,
        meta: {
          assist, // ignored in backend for quiz-eval
          model,
          mode: 'quiz-eval',
          objectives: objectives.map(o => o.label),
          context: attached,
        }
      }
    });
  }

  function applyQuizEval(res) {
    const fb = document.getElementById(`fb-${res.qId}`);
    if (!fb) return;
    const isCorrect = !!res.correct;
    fb.textContent = res.feedback || (isCorrect ? 'Correct!' : 'Not quite.');

    // Add a small chip-style marker to chosen & correct answers (visual cue)
    const chosen = document.querySelector(`input[value="${res.choiceId}"][name^="rad-"][name$="-${res.qId}"]`);
    if (chosen) {
      const label = chosen.closest('label.choice');
      if (label) label.classList.add(isCorrect ? 'correct' : 'incorrect');
    }
    if (!isCorrect && res.correctChoiceId) {
      const correct = document.querySelector(`input[value="${res.correctChoiceId}"][name^="rad-"][name$="-${res.qId}"]`);
      if (correct) {
        const label = correct.closest('label.choice');
        if (label) label.classList.add('correct');
      }
    }
  }

  // --- Helpers --------------------------------------------------------------
  function renderContext() {
    const count = Object.keys(attached).length;
    if ($('attachedCount')) $('attachedCount').textContent = String(count);
  }

  function renderObjectives() {
    const host = $('objectives'); if (!host) return;
    host.innerHTML = objectives.map(o => `<button class="chip" data-obj="${o.id}">${dot(o.status)}${escapeHtml(o.label)}</button>`).join('');
    host.querySelectorAll('[data-obj]').forEach(btn => {
      btn.addEventListener('click', () => cycleObjStatus(btn.getAttribute('data-obj')));
    });
  }
  function cycleObjStatus(id) {
    const o = objectives.find(x => x.id === id); if (!o) return;
    o.status = o.status === 'unassessed' ? 'partial' : o.status === 'partial' ? 'done' : 'unassessed';
    renderObjectives();
  }
  function dot(status) {
    const color = status === 'done' ? '#10b981' : status === 'partial' ? '#f59e0b' : '#9ca3af';
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;
  }

  function setStatus(s) { const el = $('status'); if (el) el.textContent = s; }
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }
  function renderMarkdown(md) {
    const esc = String(md);
    const fenced = esc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code data-lang="${lang||''}">${escapeHtml(code)}</code></pre>`);
    return fenced.replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  }

  // Persist restore
  function persist() { try { vscode.setState({ messages, attached, lastQuizJson, objectives }); } catch {} }
  (function restore() {
    try {
      const saved = vscode.getState();
      if (!saved) return;
      messages = saved.messages || [];
      attached = saved.attached || {};
      lastQuizJson = saved.lastQuizJson || null;
      objectives = saved.objectives || objectives;
      render();
      renderObjectives();
      renderContext();
    } catch {}
  })();
})();
