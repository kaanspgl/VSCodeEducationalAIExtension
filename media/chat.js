(function () {
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (e) { return; }

  const boot = (window.__EDUAI_BOOT__ || { model: 'qwen3-coder:30b' });

  // ---------- State ----------
  let messages = [];          // {id, role, text, kind?}
  let attached = {};          // scope -> result
  let lastQuizJson = null;    // quiz JSON to grade
  const uid = () => Math.random().toString(36).slice(2);
  const $ = (id) => document.getElementById(id);

  // left actions + assist
  const _state = { assist: 'Socratic', action: 'chat' }; // action influences "mode"

  // Learning objectives (UI only)
  let objectives = [
    { id: 'ob1', label: 'Understand the intent', status: 'partial' },
    { id: 'ob2', label: 'Pick a strategy',       status: 'unassessed' },
    { id: 'ob3', label: 'Generalize a what-if',  status: 'unassessed' },
  ];
  renderObjectives();

  // ---------- Host → Webview ----------
  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    if (type === 'answer') {
      handleAnswer(payload); setStatus('Idle');
    } else if (type === 'activeContext') {
      const { language, selection, filename } = payload || {};
      const part = selection ? `\n\nSelection (\`${language}\`, ${filename}):\n\n${selection}` : '';
      if ($('prompt')) $('prompt').value = ( $('prompt').value || '' ) + part;
    } else if (type === 'presetPrompt') {
      const { text, autoSend } = payload || {};
      if ($('prompt')) { $('prompt').value = text || ''; $('prompt').focus(); }
      if (autoSend) setTimeout(() => { $('send')?.click(); }, 10);
    } else if (type === 'ctx:result') {
      attached[payload.scope] = payload.result;
      // mark chip + toast
      const btn = document.querySelector(`.chip[data-scope="${payload.scope}"]`);
      if (btn) btn.classList.add('attached');
      renderContext();
      appendInfo(`Attached: ${prettyScope(payload.scope)}.`);
    } else if (type === 'thread:exported') {
      const a = document.createElement('a'); a.href = payload.href; a.download = ''; a.click(); a.remove();
    } else if (type === 'usage') {
      const total = payload?.totalTokens || payload?.total || 0;
      if ($('tokenStats')) $('tokenStats').textContent = `${total} tokens`;
    }
  });

  // ---------- Wire UI ----------
  // segmented assist mirror (top bar)
  document.querySelectorAll('.seg-btn')?.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _state.assist = btn.getAttribute('data-assist') || 'Socratic';
    });
  });

  // tabs on right
  document.querySelectorAll('.tab')?.forEach(t => {
    t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('[data-pane]').forEach(p => p.style.display = (p.getAttribute('data-pane') === tab) ? '' : 'none');
    });
  });

  on('use-selection', 'click', () => vscode.postMessage({ type: 'requestActiveContext' }));
  on('send', 'click', runChat);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runChat();
  });

  // left: context chips
  document.querySelectorAll('[data-scope]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-scope');
      if (!scope) return;
      vscode.postMessage({ type: 'ctx:request', payload: { scope } });
    });
  });

  // left: quick actions — set active + (optionally) prefill prompt
  document.querySelectorAll('.qa')?.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qa').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const act = btn.getAttribute('data-action');
      _state.action = act || 'chat'; // used as mode unless user types something that clearly implies a different mode

      if (act === 'quiz') { fireQuiz(); return; }

      const map = {
        hints:   'Give 2–3 guiding hints that unlock the next step. Do not reveal the final answer.',
        explain: 'Teach this in 6–10 sentences with one tiny runnable example and 1 CFU.',
        plan:    'Show a short step-by-step plan with pitfalls and checkpoints.',
        review:  'Review this code for correctness, readability, and edge cases. Provide a short diff patch.',
        reflect: 'Ask me for a 1–2 sentence reflection about what I changed and why.',
      };
      if ($('prompt')) { $('prompt').value = map[act] || ''; $('prompt').focus(); }
    });
  });

  // floating toggles in compact mode
  on('openContext', 'click', () => showOverlay('.left', 'Context'));
  on('openLearning', 'click', () => showOverlay('.right', 'Learning'));

  // resize observer to show/hide float controls (threshold = CSS breakpoint)
  const ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width || window.innerWidth;
    const compact = w <= 1100;
    const flo = document.getElementById('floatToggles');
    if (flo) flo.style.display = compact ? 'flex' : 'none';
  });
  ro.observe(document.body);

  function showOverlay(selector, label){
    const source = document.querySelector(selector);
    if (!source) return;
    const pane = document.createElement('div');
    pane.style.position='fixed'; pane.style.inset='12px';
    pane.style.background='var(--panel)'; pane.style.border='1px solid var(--border)';
    pane.style.borderRadius='16px'; pane.style.boxShadow='0 10px 24px rgba(0,0,0,.25)'; pane.style.zIndex='100';
    pane.style.overflow='auto';
    const header = document.createElement('div');
    header.style.display='flex'; header.style.alignItems='center'; header.style.justifyContent='space-between';
    header.style.padding='10px 12px'; header.style.borderBottom='1px solid var(--border)';
    header.innerHTML = `<div style="font-weight:600">${label}</div>`;
    const close = document.createElement('button');
    close.textContent='Close';
    close.className='btn secondary';
    close.addEventListener('click', ()=> pane.remove());
    header.appendChild(close);
    pane.appendChild(header);
    const body = document.createElement('div'); body.style.padding='10px 12px';
    body.innerHTML = source.innerHTML;
    pane.appendChild(body);
    document.body.appendChild(pane);
  }

  // ---------- Chat actions ----------
  function runChat(){
    const text = ($('prompt')?.value || '').trim();
    if (!text) return;
    appendUser(text);
    $('prompt').value = '';
    setStatus('Thinking…');

    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';

    // If user typed something that obviously implies a mode, let that win;
    // otherwise respect the selected quick action.
    const implied = inferModeFromText(text);
    const mode = implied === 'chat' ? _state.action : implied;

    vscode.postMessage({
      type: 'ask',
      payload: {
        text,
        meta: {
          assist: _state.assist,
          model,
          mode,
          objectives: objectives.map(o => o.label),
          context: attached,
          history: getRecentHistory()
        }
      }
    });
  }

  function fireQuiz(){
    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';
    appendUser('[CFU Quiz]');
    setStatus('Building quiz…');

    vscode.postMessage({
      type: 'ask',
      payload: {
        text: 'Generate a 3-question multiple-choice quiz about my current selection/context.',
        meta: {
          assist: _state.assist,
          model,
          mode: 'quiz',
          objectives: objectives.map(o => o.label),
          context: attached,
          history: getRecentHistory()
        }
      }
    });
  }

  function inferModeFromText(t){
    if (/CFU|quiz/i.test(t)) return 'quiz';
    if (/review/i.test(t))   return 'review';
    if (/hints?/i.test(t))   return 'hints';
    if (/plan/i.test(t))     return 'plan';
    if (/reflect/i.test(t))  return 'reflect';
    if (/explain/i.test(t))  return 'explain';
    return 'chat';
  }

  // ---------- Handle answers ----------
  function handleAnswer(text){
    const parsed = tryParseJson(text);
    if (parsed && parsed.type === 'quiz' && Array.isArray(parsed.questions)){
      lastQuizJson = parsed; appendQuiz(parsed); updateRightPane('quiz'); persist(); return;
    }
    if (parsed && parsed.type === 'quiz-eval' && parsed.qId){
      applyQuizEval(parsed); updateRightPane('quiz'); persist(); return;
    }
    appendAI(text);
    updateRightPane('explanation', text);
  }

  function tryParseJson(s){
    try{
      const t = String(s).trim();
      if (!t.startsWith('{') && !t.startsWith('[')) return null;
      return JSON.parse(t);
    } catch { return null; }
  }

  // ---------- Render ----------
  function appendUser(text){ messages.push({ id: uid(), role: 'user', text }); render(); persist(); updateRightPane('history'); }
  function appendAI(text){   messages.push({ id: uid(), role: 'assistant', text }); render(); persist(); updateRightPane('history'); }
  function appendQuiz(q){    messages.push({ id: uid(), role: 'assistant', kind:'quiz', text: JSON.stringify(q) }); render(); }

  function render(){
    const log = $('log'); if (!log) return;
    log.innerHTML = messages.map(tplMessage).join('');
    wireMessageActions(log);
    log.scrollTop = log.scrollHeight;
  }

  function tplMessage(m){
    const isAI = m.role === 'assistant';
    if (isAI && m.kind === 'quiz'){
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

  function renderQuizHtml(msgId, quiz){
    if (!quiz || !Array.isArray(quiz.questions)) return '';
    const blocks = quiz.questions.map(q => `
      <div class="q" data-qid="${q.id}">
        <div class="stem"><b>Q:</b> ${escapeHtml(q.stem || '')}</div>
        ${q.choices.map(c => `
          <label class="choice">
            <input type="radio" name="rad-${msgId}-${q.id}" value="${c.id}">
            <span>${escapeHtml(c.text)}</span>
          </label>`).join('')}
        <div class="actions">
          <button class="btn secondary submit-q" data-qid="${q.id}" data-msg="${msgId}">Submit</button>
        </div>
        <div class="feedback" id="fb-${q.id}"></div>
      </div>`).join('');
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

  function wireMessageActions(root){
    root.querySelectorAll('.submit-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const qId = btn.getAttribute('data-qid');
        const msgId = btn.getAttribute('data-msg');
        const group = `rad-${msgId}-${qId}`;
        const selected = root.querySelector(`input[name="${group}"]:checked`);
        const fb = document.getElementById(`fb-${qId}`);
        if (!selected){ if (fb) fb.textContent = 'Pick an option before submitting.'; return; }
        const choiceId = selected.value;
        root.querySelectorAll(`input[name="${group}"]`).forEach(inp => inp.disabled = true);
        btn.disabled = true;
        evalQuizChoice(qId, choiceId);
      });
    });
  }

  // ---------- Quiz grading ----------
  function evalQuizChoice(qId, choiceId){
    if (!lastQuizJson || !qId || !choiceId) return;
    setStatus('Grading…');
    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';
    const evalPayload = JSON.stringify({ quiz: lastQuizJson, qId, choiceId });

    vscode.postMessage({
      type: 'ask',
      payload: {
        text: `Evaluate this quiz answer:\n${evalPayload}`,
        meta: { assist: _state.assist, model, mode: 'quiz-eval', objectives: objectives.map(o=>o.label), context: attached }
      }
    });
  }

  function applyQuizEval(res){
    const fb = document.getElementById(`fb-${res.qId}`);
    if (!fb) return;
    const isCorrect = !!res.correct;
    fb.textContent = res.feedback || (isCorrect ? 'Correct!' : 'Not quite.');

    // colorize choices
    document.querySelectorAll(`input[name^="rad-"][name$="-${res.qId}"]`).forEach(inp => {
      const lab = inp.closest('label.choice'); if (!lab) return;
      lab.classList.remove('correct','incorrect');
      if (inp.value === res.choiceId) lab.classList.add(isCorrect ? 'correct' : 'incorrect');
      if (!isCorrect && res.correctChoiceId && inp.value === res.correctChoiceId) lab.classList.add('correct');
    });
  }

  // ---------- Right pane updates ----------
  function updateRightPane(kind, payload){
    if (kind === 'history'){
      const pane = document.querySelector('[data-pane="history"]');
      if (!pane) return;
      const list = pane.querySelector('.list') || (()=>{ const d=document.createElement('div'); d.className='list'; pane.innerHTML=''; pane.appendChild(d); return d; })();
      list.innerHTML = messages.slice(-8).map(m => `
        <div class="list-item"><b>${m.role === 'assistant' ? 'Tutor' : 'You'}:</b> ${escapeHtml((m.text||'').slice(0,180))}</div>
      `).join('');
      if (!messages.length) pane.innerHTML = '<div class="empty">No recent messages yet.</div>';
      return;
    }

    if (kind === 'explanation'){
      const pane = document.querySelector('[data-pane="explanation"]');
      if (!pane) return;
      const text = String(payload || '').trim();
      if (!text){ pane.innerHTML = '<h4>Concept Breakdown</h4><div class="muted">Summaries aligned with your current chat.</div>'; return; }
      const first = text.split(/\n+/).find(Boolean) || text.slice(0,240);
      pane.innerHTML = `
        <h4>Concept Breakdown</h4>
        <div>${renderMarkdown(escapeHtml(first))}</div>
      `;
      return;
    }

    if (kind === 'quiz'){
      const pane = document.querySelector('[data-pane="quizzes"]');
      if (!pane) return;
      const count = (lastQuizJson?.questions?.length || 0);
      pane.innerHTML = count
        ? `<h4>Practice</h4><div class="muted">Latest quiz with <b>${count}</b> question${count===1?'':'s'} generated.</div>`
        : `<h4>Practice</h4><div class="muted">No quizzes yet. Use “CFU Quiz”.</div>`;
    }
  }

  // ---------- Helpers ----------
  function getRecentHistory(limit = 8, maxChars = 4000){
    const flat = [];
    for (let i = messages.length - 1; i >= 0 && flat.length < limit; i--){
      const m = messages[i]; if (m.kind === 'quiz') continue;
      flat.push({ role: m.role, text: (m.text || '').slice(0, 800) });
    }
    let used = 0, picked = [];
    for (const h of flat){
      const len = (h.text || '').length + 20;
      if (used + len > maxChars) break;
      picked.push(h); used += len;
    }
    return picked;
  }

  function prettyScope(s){
    return s === 'activeFile' ? 'Active File' :
           s === 'selection'  ? 'Selection' :
           s === 'problems'   ? 'Problems'  :
           s === 'tests'      ? 'Tests' : s;
  }

  function renderContext(){ const el = $('attachedCount'); if (el) el.textContent = String(Object.keys(attached).length); }

  function renderObjectives(){
    const host = $('objectives'); if (!host) return;
    host.innerHTML = objectives.map(o =>
      `<button class="chip" data-obj="${o.id}" title="Click to cycle status">${dot(o.status)}${escapeHtml(o.label)}</button>`
    ).join('');
    host.querySelectorAll('[data-obj]').forEach(btn => {
      btn.addEventListener('click', () => cycleObjStatus(btn.getAttribute('data-obj')));
    });
  }

  function cycleObjStatus(id){
    const o = objectives.find(x => x.id === id); if (!o) return;
    o.status = o.status === 'unassessed' ? 'partial' : o.status === 'partial' ? 'done' : 'unassessed';
    renderObjectives();
  }

  function dot(status){
    const color = status === 'done' ? '#10b981' : status === 'partial' ? '#f59e0b' : '#9ca3af';
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;
  }

  function setStatus(s){ const el = $('status'); if (el) el.textContent = s; }
  function on(id, ev, fn){ const el = $(id); if (el) el.addEventListener(ev, fn); }

  function escapeHtml(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function renderMarkdown(md){
    const esc = String(md);
    const fenced = esc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code data-lang="${lang||''}">${escapeHtml(code)}</code></pre>`);
    return fenced.replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  }

  function appendInfo(text){
    messages.push({ id: uid(), role: 'assistant', text: `• ${text}` });
    render(); updateRightPane('history');
  }

  // persist/restore
  function persist(){ try { vscode.setState({ messages, attached, lastQuizJson, objectives, assist:_state.assist, action:_state.action }); } catch {} }
  (function restore(){
    try{
      const saved = vscode.getState(); if (!saved) return;
      messages = saved.messages || [];
      attached = saved.attached || {};
      lastQuizJson = saved.lastQuizJson || null;
      objectives = saved.objectives || objectives;
      _state.assist = saved.assist || 'Socratic';
      _state.action = saved.action || 'chat';
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-assist') === _state.assist));
      render(); renderObjectives(); renderContext();
      updateRightPane('history'); updateRightPane('quiz');
    } catch {}
  })();
})();
