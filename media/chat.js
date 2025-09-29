(function () {
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (e) { return; }

  let messages = [];
  let attached = {};
  const uid = () => Math.random().toString(36).slice(2);
  const $ = (id) => document.getElementById(id);

  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    if (type === 'answer') appendAI(payload);
    else if (type === 'activeContext') {
      if (payload?.selection) {
        if ($('prompt')) $('prompt').value += `\n\n${payload.selection}`;
      }
    } else if (type === 'ctx:result') {
      attached[payload.scope] = payload.result;
      renderContext();
    } else if (type === 'thread:exported') {
      const a = document.createElement('a');
      a.href = payload.href; a.download = ''; a.click(); a.remove();
    } else if (type === 'usage') {
      if ($('tokenStats')) $('tokenStats').textContent = `${payload?.totalTokens || 0} tokens`;
    }
  });

  if ($('send')) $('send').addEventListener('click', run);
  if ($('use-selection')) $('use-selection').addEventListener('click', () => vscode.postMessage({ type: 'requestActiveContext' }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  });

  document.querySelectorAll('.chip[data-scope]')?.forEach(chip => {
    chip.addEventListener('click', () => {
      const scope = chip.getAttribute('data-scope');
      vscode.postMessage({ type: 'ctx:request', payload: { scope } });
    });
  });

  document.querySelectorAll('.qa')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-action');
      const map = {
        hints: 'Give only guiding questions, no answers.',
        explain: 'Explain this like Khan Academy with a tiny runnable example.',
        quiz: 'Create a 3-question check-for-understanding quiz with answers.',
        plan: 'Show a step-by-step plan with pitfalls.',
        review: 'Review this code for issues and improvements.',
        reflect: 'Give me a 1-sentence reflection question about this topic.'
      };
      if ($('prompt')) $('prompt').value = map[act] || '';
    });
  });

  function run() {
    const text = ($('prompt')?.value || '').trim();
    if (!text) return;
    const assist = $('assist')?.value || 'Socratic';
    const model = $('model')?.value || 'qwen3:4b';
    appendUser(text);
    $('prompt').value = '';
    vscode.postMessage({ type: 'ask', payload: { text, meta: { assist, model, context: attached } } });
  }

  function appendUser(text) { messages.push({ id: uid(), role: 'user', text }); render(); }
  function appendAI(text) { messages.push({ id: uid(), role: 'assistant', text }); render(); }

  function render() {
    const log = $('log');
    if (!log) return;
    log.innerHTML = messages.map(tplMessage).join('');
    log.scrollTop = log.scrollHeight;
  }

  function tplMessage(m) {
    const isAI = m.role === 'assistant';
    return `<div class="msg ${isAI ? 'ai' : 'user'}">
      <div class="avatar">${isAI ? '🤖' : '🧑'}</div>
      <div class="bubble">${escapeHtml(m.text)}<div class="meta">${isAI ? 'Assistant' : 'You'}</div></div>
    </div>`;
  }

  function renderContext() {
    if ($('attachedCount')) $('attachedCount').textContent = String(Object.keys(attached).length);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }
})();
