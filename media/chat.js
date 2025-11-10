(function () {
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (e) { return; }

  const boot = (window.__EDUAI_BOOT__ || { model: 'qwen3-coder:30b' });

  // ---------- State ----------
  let messages = [];
  let attached = {};          // scope -> result
  let lastQuizJson = null;
  let busy = false;

  const uid = () => Math.random().toString(36).slice(2);
  const $ = (id) => document.getElementById(id);

  const _state = { assist: 'Socratic', action: 'chat' };

  // Learning objectives
  let objectives = [
    { id: 'ob1', label: 'Understand the intent', status: 'unassessed' },
    { id: 'ob2', label: 'Pick a strategy',       status: 'unassessed' },
    { id: 'ob3', label: 'Generalize a what-if',  status: 'unassessed' },
  ];
  renderObjectives();

  // Toast element
  let toastEl;
  function ensureToast(){
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.id = 'eduaiToast';
    document.body.appendChild(toastEl);
    return toastEl;
  }
  function toast(msg, ms=1700){
    const el = ensureToast();
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(()=> el.classList.remove('show'), ms);
  }

  // ---------- Host → Webview ----------
  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};

    if (type === 'answer') {
      handleAnswer(payload);
      setBusy(false);
      setStatus('Idle');
    }

    // Background-only; we don’t prefill the chat anymore.
    else if (type === 'activeContext') { /* ignore */ }
    else if (type === 'presetPrompt')  { /* ignore */ }

    else if (type === 'ctx:result') {
      const scope = payload?.scope;
      const result = payload?.result || {};
      if (!scope) return;

      // If we asked to DETACH, we already removed; ignore any stray returns.
      if (attached[scope] && result && result.__detaching) return;

      // Save and mark UI
      attached[scope] = result;
      markAttached(scope, true);
      renderContext();
      renderScopePreview(scope, result);
      toast(`Attached: ${prettyScope(scope)} ${compactSummary(scope, result)}`);
    }

    else if (type === 'ctx:error') {
      toast(`Failed to attach: ${payload?.scope || 'unknown'} — ${payload?.message || 'error'}`, 2200);
    }

    else if (type === 'usage') {
      const total = payload?.totalTokens || payload?.total || 0;
      if ($('tokenStats')) $('tokenStats').textContent = `${total} tokens`;
    }
  });

  // ---------- Assist dropdown ----------
  const assistDetails = document.getElementById('assistDetails');
  const assistLabel = document.getElementById('assistLabel');
  if (assistDetails) {
    assistDetails.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.tagName === 'INPUT' && t.name === 'assist') {
        _state.assist = t.value || 'Socratic';
        if (assistLabel) assistLabel.textContent = _state.assist;
        setTimeout(() => assistDetails.removeAttribute('open'), 80);
      }
    });
  }

  // ---------- Wire UI ----------
  // Toggle attach/detach on click (background)
  document.querySelectorAll('.ctx-btn[data-scope]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      if (busy) return;
      const scope = btn.getAttribute('data-scope');
      if (!scope) return;

      // Toggle: if already attached → detach
      if (attached[scope]) {
        delete attached[scope];
        markAttached(scope, false);
        renderContext();
        clearScopePreview(scope);
        toast(`Detached: ${prettyScope(scope)}`);
        persist();
        return;
      }

      // Request fresh context
      vscode.postMessage({ type: 'ctx:request', payload: { scope } });
    });
  });

  // Quick actions send immediately (no user bubble)
  document.querySelectorAll('.qa-toolbar .qa')?.forEach(btn => {
    btn.addEventListener('click', () => {
      if (busy) return;
      document.querySelectorAll('.qa-toolbar .qa').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const act = btn.getAttribute('data-action');
      _state.action = act || 'chat';
      runQuickAction(_state.action);
    });
  });

  // Enter submits; Shift+Enter = newline
  const promptEl = $('prompt');
  if (promptEl) {
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runChat();
      }
    });
  }

  // Buttons
  on('use-selection', 'click', () => {
    if (busy) return;
    vscode.postMessage({ type: 'requestActiveContext' });
    toast('Inserted current selection into background context');
  });
  on('send', 'click', runChat);

  // ---------- Sending ----------
  function runChat(){
    if (busy) return;
    const text = ($('prompt')?.value || '').trim();
    if (!text) return;

    appendUser(text);  // show user bubble
    $('prompt').value = '';

    setBusy(true);
    setStatus('Thinking…');

    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';
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

  function runQuickAction(act){
    const prompts = {
      explain: 'Explain the attached context or most recent discussion in 6–10 sentences with one tiny runnable example and 1 CFU.',
      review:  'Review the attached code for correctness, readability, and edge cases. Provide a short diff patch.',
      plan:    'Propose a short step-by-step plan (3–5 steps) with pitfalls and checkpoints for the attached context.',
      hints:   'Give 2–3 guiding hints that unlock the next step based on the attached context. Do not reveal the final answer.',
      reflect: 'Prompt me for a 1–2 sentence reflection about what I changed and why, based on our recent discussion.',
      quiz:    'Generate a 3-question multiple-choice quiz about the attached context and the most recent discussion.'
    };
    const text = prompts[act] || 'Explain the attached context concisely.';
    if (act === 'quiz') return fireQuizBackground();

    setBusy(true);
    setStatus('Thinking…');

    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';
    vscode.postMessage({
      type: 'ask',
      payload: {
        text,
        meta: {
          assist: _state.assist,
          model,
          mode: act,
          objectives: objectives.map(o => o.label),
          context: attached,
          history: getRecentHistory()
        }
      }
    });
  }

  function fireQuizBackground(){
    setBusy(true);
    setStatus('Building…');
    const model = $('model')?.value || (boot && boot.model) || 'qwen3-coder:30b';
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
      lastQuizJson = parsed; appendQuiz(parsed); persist(); return;
    }
    if (parsed && parsed.type === 'quiz-eval' && parsed.qId){
      applyQuizEval(parsed); persist(); return;
    }
    appendAI(text);
  }

  function tryParseJson(s){
    try{
      const t = String(s).trim();
      if (!t.startsWith('{') && !t.startsWith('[')) return null;
      return JSON.parse(t);
    } catch { return null; }
  }

  // ---------- Render ----------
  function appendUser(text){ messages.push({ id: uid(), role: 'user', text }); render(); persist(); }
  function appendAI(text){   messages.push({ id: uid(), role: 'assistant', text }); render(); persist(); }
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
    if (!isAI) {
      return `
        <div class="msg user">
          <div class="avatar">👩‍💻</div>
          <div class="bubble">${renderMarkdown(escapeHtml(m.text))}
            <div class="meta">You</div>
          </div>
        </div>`;
    }
    return `
      <div class="msg ai">
        <div class="avatar">🧑‍🏫</div>
        <div class="bubble">${renderMarkdown(escapeHtml(m.text))}
          <div class="meta">Tutor</div>
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
        if (busy) return;
        const qId = btn.getAttribute('data-qid');
        const msgId = btn.getAttribute('data-msg');
        const group = `rad-${msgId}-${qId}`;
        const selected = root.querySelector(`input[name="${group}"]:checked`);
        const fb = document.getElementById(`fb-${qId}`);
        if (!selected){ if (fb) fb.textContent = 'Pick an option before submitting.'; return; }
        const choiceId = selected.value;
        root.querySelectorAll(`input[name="${group}"]`).forEach(inp => inp.disabled = true);
        btn.disabled = true;

        setBusy(true);
        setStatus('Grading…');

        evalQuizChoice(qId, choiceId);
      });
    });
  }

  // ---------- Context previews ----------
  function renderScopePreview(scope, result){
    const host = document.querySelector(`.ctx-row .ctx-btn[data-scope="${scope}"]`)?.closest('.ctx-row');
    if (!host) return;
    let p = host.querySelector('.ctx-preview');
    if (!p) { p = document.createElement('div'); p.className = 'ctx-preview'; host.appendChild(p); }
    p.textContent = prettyPreview(scope, result);
  }
  function clearScopePreview(scope){
    const host = document.querySelector(`.ctx-row .ctx-btn[data-scope="${scope}"]`)?.closest('.ctx-row');
    if (!host) return;
    const p = host.querySelector('.ctx-preview');
    if (p) p.remove();
  }

  function prettyPreview(scope, res){
    if (!res) return '';
    if (scope === 'activeFile') {
      const lang = res.language ? `, ${res.language}` : '';
      const bytes = (res.content || '').length;
      return `Attached ${bytes.toLocaleString()} chars${lang}`;
    }
    if (scope === 'selection') {
      const bytes = res.bytes ?? (res.content || '').length;
      return `Attached ${bytes.toLocaleString()} chars from selection`;
    }
    if (scope === 'problems') {
      const n = res.count || (res.items ? res.items.length : 0);
      return `Attached ${n} diagnostics (top ${Math.min(n, 200)})`;
    }
    if (scope === 'tests') {
      return res.summary ? `Attached: ${res.summary}` : 'Attached test summary';
    }
    return 'Attached';
  }
  function compactSummary(scope, res){
    if (!res) return '';
    if (scope === 'activeFile') return `(${(res.content||'').length.toLocaleString()} chars)`;
    if (scope === 'selection')  return `(${(res.bytes ?? (res.content||'').length).toLocaleString()} chars)`;
    if (scope === 'problems')   return `(${res.count ?? (res.items||[]).length} issues)`;
    if (scope === 'tests')      return '';
    return '';
  }

  // ---------- Context helpers ----------
  function prettyScope(s){
    return s === 'activeFile' ? 'Active File' :
           s === 'selection'  ? 'Selection' :
           s === 'problems'   ? 'Problems'  :
           s === 'tests'      ? 'Tests' : s;
  }
  function markAttached(scope, yes){
    const btn = document.querySelector(`.ctx-btn[data-scope="${scope}"]`);
    if (btn) btn.classList.toggle('attached', !!yes);
  }
  function renderContext(){
    const c1 = $('attachedCount');
    const c2 = $('attachedCount2');
    const listEl = $('attachedList');
    const n = Object.keys(attached).length;
    if (c1) c1.textContent = String(n);
    if (c2) c2.textContent = String(n);
    if (listEl) {
      const names = Object.keys(attached).map(prettyScope);
      listEl.textContent = names.length ? names.join(', ') : 'none';
    }
    persist();
  }

  // ---------- Quiz grading ----------
  function evalQuizChoice(qId, choiceId){
    if (!lastQuizJson || !qId || !choiceId) return;
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
    if (fb) {
      const isCorrect = !!res.correct;
      fb.textContent = res.feedback || (isCorrect ? 'Correct!' : 'Not quite.');
      document.querySelectorAll(`input[name^="rad-"][name$="-${res.qId}"]`).forEach(inp => {
        const lab = inp.closest('label.choice'); if (!lab) return;
        lab.classList.remove('correct','incorrect');
        if (inp.value === res.choiceId) lab.classList.add(isCorrect ? 'correct' : 'incorrect');
        if (!isCorrect && res.correctChoiceId && inp.value === res.correctChoiceId) lab.classList.add('correct');
      });
    }
    setBusy(false);
    setStatus('Idle');
  }

  // ---------- Objectives ----------
  function renderObjectives(){
    const host = $('objectives'); if (!host) return;
    host.innerHTML = objectives.map(o =>
      `<button class="chip" data-obj="${o.id}" title="Click to cycle: Unassessed → Partial → Done">${dot(o.status)}${escapeHtml(o.label)}</button>`
    ).join('');
    host.querySelectorAll('[data-obj]').forEach(btn => {
      btn.addEventListener('click', () => cycleObjStatus(btn.getAttribute('data-obj')));
    });
    updateLoCounts();
  }
  function cycleObjStatus(id){
    const o = objectives.find(x => x.id === id); if (!o) return;
    o.status = o.status === 'unassessed' ? 'partial' : o.status === 'partial' ? 'done' : 'unassessed';
    renderObjectives();
  }
  function updateLoCounts(){
    const counts = { unassessed:0, partial:0, done:0 };
    for (const o of objectives) counts[o.status] = (counts[o.status]||0)+1;
    const el = $('loCounts');
    if (el) el.textContent = `Done: ${counts.done} • Partial: ${counts.partial} • Unassessed: ${counts.unassessed}`;
  }
  function dot(status){
    const color = status === 'done' ? '#10b981' : status === 'partial' ? '#f59e0b' : '#9ca3af';
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;
  }

  // ---------- Status + utils ----------
  function setBusy(v){
    busy = !!v;
    const send = $('send');
    const ta = $('prompt');
    if (send) send.disabled = busy;
    if (ta) { ta.disabled = busy; ta.classList.toggle('disabled', busy); }
    document.querySelectorAll('.qa-toolbar .qa, .ctx-btn').forEach(el => {
      el.disabled = busy;
      el.classList.toggle('disabled', busy);
    });
  }
  function setStatus(s){
    const near = document.getElementById('status2');
    const dot = document.getElementById('status-dot');
    const txt = String(s || 'Idle');
    if (near) near.textContent = txt;
    if (dot) {
      dot.classList.remove('thinking', 'idle');
      dot.classList.add(/thinking|building|grading|loading/i.test(txt) ? 'thinking' : 'idle');
    }
  }

  function on(id, ev, fn){ const el = $(id); if (el) el.addEventListener(ev, fn); }
  function escapeHtml(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function renderMarkdown(md){
    const esc = String(md);
    const fenced = esc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code data-lang="${lang||''}">${escapeHtml(code)}</code></pre>`);
    return fenced.replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  }

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

      const assistLabel = document.getElementById('assistLabel');
      if (assistLabel) assistLabel.textContent = _state.assist;

      render(); renderContext(); renderObjectives();
      setStatus('Idle');
      Object.keys(attached).forEach(s => { markAttached(s, true); renderScopePreview(s, attached[s]); });
    } catch {}
  })();
})();
