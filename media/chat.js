(function () {
  // --- Bootstrap / guards ----------------------------------------------------
  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch (e) {
    console.error('acquireVsCodeApi failed:', e);
    return;
  }
  console.log('[EduAI] chat.js loaded');

  const boot = (window.__EDUAI_BOOT__ || { model: 'qwen3:4b', includeSelectionByDefault: false });
  console.log('[EduAI] boot config:', boot);

  // --- State -----------------------------------------------------------------
  let messages = []; // {id, role, text}
  let attached = {}; // scope -> result

  const uid = () => Math.random().toString(36).slice(2);
  const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  // convenience getter that tolerates late DOM readiness
  const $ = (id) => document.getElementById(id);

  // --- Lazy wire: keep retrying until element available ----------------------
  function onClick(id, handler) {
    const el = $(id);
    if (el) {
      el.addEventListener('click', handler);
    } else {
      // Retry a few times in case DOM isn’t ready yet
      let attempts = 0;
      const t = setInterval(() => {
        const el2 = $(id);
        attempts++;
        if (el2) {
          clearInterval(t);
          el2.addEventListener('click', handler);
        } else if (attempts > 20) {
          clearInterval(t);
          console.warn(`[EduAI] element #${id} not found; handler not attached`);
        }
      }, 50);
    }
  }

  // --- Elements (created lazily) --------------------------------------------
  const els = new Proxy({}, {
    get(_, key) { return $(key); }
  });

  // --- Webview receive -------------------------------------------------------
  window.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    console.log('[EduAI] webview message IN:', type, payload);

    if (type === 'answer') {
      appendAI(payload);
      if (els.status) els.status.textContent = 'Idle';
    } else if (type === 'activeContext') {
      const { language, selection, filename } = payload || {};
      const part = selection ? `\n\nSelection (\`${language}\`, ${filename}):\n\n${selection}` : '';
      if (els.prompt) els.prompt.value = (els.prompt.value || '') + part;
    } else if (type === 'ctx:result') {
      attached[payload.scope] = payload.result;
      renderContext();
    } else if (type === 'thread:exported') {
      const a = document.createElement('a'); a.href = payload.href; a.download = '';
      a.click(); a.remove();
    } else if (type === 'usage') {
      const total = payload?.totalTokens || payload?.total || 0;
      if (els.tokenStats) els.tokenStats.textContent = `${total} tokens`;
    }
  });

  // --- Buttons / events ------------------------------------------------------
  onClick('use-selection', () => {
    console.log('[EduAI] Use Selection clicked');
    vscode.postMessage({ type: 'requestActiveContext' });
  });

  onClick('send', () => {
    console.log('[EduAI] Send clicked');
    run();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      console.log('[EduAI] Ctrl/Cmd+Enter');
      run();
    }
  });

  // Context chips
  function wireContextChips() {
    const chips = document.querySelectorAll('.chip[data-scope]');
    if (!chips.length) {
      setTimeout(wireContextChips, 100); // try again after DOM paints
      return;
    }
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const scope = chip.getAttribute('data-scope');
        console.log('[EduAI] ctx chip clicked:', scope);
        vscode.postMessage({ type: 'ctx:request', payload: { scope } });
      });
    });
  }
  wireContextChips();

  // Quick actions (pre-fill prompt)
  function wireQuickActions() {
    const qas = document.querySelectorAll('.qa');
    if (!qas.length) {
      setTimeout(wireQuickActions, 100);
      return;
    }
    qas.forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-action');
        const T = {
          explain: 'Explain the selected code like I\'m new to this topic. Include a tiny runnable example and a 2-question check.',
          review: 'Code review: identify issues, suggest idiomatic improvements, and provide a diff patch.',
          quiz: 'Create a 5-question multiple-choice quiz from the selection with answers and brief explanations.',
          hints: 'Give only hints (no full solutions). Ask guiding questions to lead me to the answer.',
          step: 'Create a step-by-step plan to implement this feature. Include effort and pitfalls.',
        };
        if (els.prompt) {
          els.prompt.value = T[act] || '';
          els.prompt.focus();
        }
      });
    });
  }
  wireQuickActions();

  // Thread controls
  onClick('newThread', () => { messages = []; attached = {}; render(); renderContext(); persist(); });
  onClick('saveThread', () => vscode.postMessage({ type: 'thread:save', payload: { title: els.title?.value, messages } }));
  onClick('exportMd', () => vscode.postMessage({ type: 'thread:export', payload: { format: 'md', messages } }));
  onClick('exportJson', () => vscode.postMessage({ type: 'thread:export', payload: { format: 'json', messages } }));
  onClick('clearChat', () => { messages = []; render(); persist(); });

  // --- Send flow -------------------------------------------------------------
  function run() {
    try {
      const text = (els.prompt?.value || '').trim();
      if (!text) {
        console.warn('[EduAI] No text to send');
        return;
      }
      const meta = {
        model: els.model?.value || boot.model,
        context: attached,
      };
      appendUser(text);
      if (els.prompt) els.prompt.value = '';
      if (els.status) els.status.textContent = 'Thinking…';
      console.log('[EduAI] webview message OUT: ask', { textLen: text.length, meta });
      vscode.postMessage({ type: 'ask', payload: { text, meta } });
    } catch (err) {
      console.error('[EduAI] run() error:', err);
    }
  }

  // --- Rendering -------------------------------------------------------------
  function appendUser(text) {
    const m = { id: uid(), role: 'user', text };
    messages.push(m);
    render();
    persist();
  }
  function appendAI(text) {
    const m = { id: uid(), role: 'assistant', text };
    messages.push(m);
    render();
    persist();
  }

  function render() {
    const log = els.log;
    if (!log) return console.warn('[EduAI] #log not found');
    log.innerHTML = messages.map(tplMessage).join('');
    // per-message actions
    log.querySelectorAll('[data-action]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const m = messages.find(x => x.id === id);
        if (!m) return;
        if (action === 'copy') {
          navigator.clipboard.writeText(m.text);
        } else if (action === 'insert') {
          vscode.postMessage({ type: 'editor:insert', payload: { code: extractCode(m.text), language: guessLang(m.text), where: 'cursor' } });
        } else if (action === 'edit') {
          const draft = prompt('Edit & resend:', m.text);
          if (draft && draft.trim()) { if (els.prompt) els.prompt.value = draft; run(); }
        } else if (action === 'up' || action === 'down') {
          vscode.postMessage({ type: 'feedback', payload: { messageId: id, value: action === 'up' ? 1 : -1 } });
        }
      });
    });
    log.scrollTop = log.scrollHeight;
  }

  function tplMessage(m) {
    const isAI = m.role === 'assistant';
    const roleClass = isAI ? 'role-ai' : 'role-user';
    const actions = isAI
      ? `<div class="actions">
           <button class="btn secondary" data-action="copy" data-id="${m.id}">Copy</button>
           <button class="btn secondary" data-action="insert" data-id="${m.id}">Insert</button>
           <button class="btn ghost" data-action="up" data-id="${m.id}">👍</button>
           <button class="btn ghost" data-action="down" data-id="${m.id}">👎</button>
         </div>`
      : `<div class="actions"><button class="btn secondary" data-action="edit" data-id="${m.id}">Edit & Resend</button></div>`;
    return `
      <article class="msg ${roleClass}">
        <div class="avatar">${isAI ? '🤖' : '🧑'}</div>
        <div class="bubble">
          ${renderMarkdown(m.text)}
          <div class="meta">
            <span>${isAI ? 'Assistant' : 'You'}</span>
            ${actions}
          </div>
        </div>
      </article>`;
  }

  function renderContext() {
    const keys = Object.keys(attached);
    if (els.attachedCount) els.attachedCount.textContent = String(keys.length);
    if (!els.ctxList) return;
    if (!keys.length) { els.ctxList.textContent = 'None'; return; }
    els.ctxList.innerHTML = keys.map(k => `<details open><summary><b>${k}</b></summary><pre>${escapeHtml(pretty(attached[k]))}</pre></details>`).join('');
  }

  function pretty(v) { try { return JSON.stringify(v, null, 2) } catch { return String(v) } }
  function extractCode(text) {
    const m = text.match(/```[\s\S]*?```/);
    return m ? m[0].replace(/```[\w]*\n?([\s\S]*?)```/, '$1').trim() : text;
  }
  function guessLang(text) {
    const m = text.match(/```(\w+)/);
    return m ? m[1] : 'plaintext';
  }
  function renderMarkdown(md) {
    const esc = escapeHtml(md);
    const fenced = esc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code data-lang="${lang||''}">${escapeHtml(code)}</code></pre>`);
    return fenced
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code class="kbd">$1</code>')
      .split(/\n\n+/).map(p => `<p>${p}</p>`).join('');
  }

  // Persist
  function persist() { try { vscode.setState({ messages, attached, title: els.title?.value || '' }); } catch {} }
  const saved = (function(){ try { return vscode.getState(); } catch { return null; } })();
  if (saved) { messages = saved.messages||[]; attached = saved.attached||{}; if (els.title) els.title.value = saved.title||''; }
  render(); renderContext();

  // Auto-seed selection on load if configured
  if (boot.includeSelectionByDefault) {
    console.log('[EduAI] auto seeding selection by config');
    vscode.postMessage({ type: 'requestActiveContext' });
  }
})();
