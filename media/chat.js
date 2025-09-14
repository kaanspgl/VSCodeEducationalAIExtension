(function () {
const vscode = acquireVsCodeApi();
const log = document.getElementById('log');
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const useSel = document.getElementById('use-selection');


window.addEventListener('message', (event) => {
const { type, payload } = event.data || {};
if (type === 'answer') {
append('bot', payload);
} else if (type === 'seedSelection') {
prompt.value = prompt.value ? prompt.value + '\n\n' + payload : payload;
} else if (type === 'activeContext') {
const { language, selection, filename } = payload || {};
const part = selection ? `\n\nSelection (\`${language}\`, ${filename}):\n\n${selection}` : '';
prompt.value = (prompt.value || '') + part;
}
});


useSel.addEventListener('click', () => {
vscode.postMessage({ type: 'requestActiveContext' });
});


send.addEventListener('click', () => run());
prompt.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
});


function run() {
const text = (prompt.value || '').trim();
if (!text) return;
append('user', text);
prompt.value = '';
vscode.postMessage({ type: 'ask', payload: text });
}


function append(who, text) {
const el = document.createElement('div');
el.className = `msg ${who}`;
el.textContent = text;
log.appendChild(el);
log.scrollTop = log.scrollHeight;
}
})();