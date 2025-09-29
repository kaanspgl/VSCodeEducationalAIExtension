import * as vscode from 'vscode';

export class ChatPanel {
  public static readonly viewType = 'eduai.chatPanel';
  public static currentPanel: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'EduAI — Tutor',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ask': {
          try {
            const res = await vscode.commands.executeCommand<{ text?: string; usage?: any; meta?: any }>(
              'eduai.backend.chat',
              { text: msg.payload?.text ?? msg.payload, meta: msg.payload?.meta ?? msg.meta }
            );
            this.panel.webview.postMessage({ type: 'answer', payload: res?.text ?? String(res) });
            this.panel.webview.postMessage({ type: 'usage', payload: res?.usage });
          } catch (err: any) {
            this.panel.webview.postMessage({ type: 'answer', payload: `⚠️ ${err?.message || err}` });
          }
          break;
        }
        case 'requestActiveContext': {
          const result = await vscode.commands.executeCommand('eduai.backend.getContext', { scope: 'activeFile' });
          const selection = await vscode.commands.executeCommand('eduai.backend.getContext', { scope: 'selection' });
          const payload = {
            language: (result as any)?.language,
            filename: (result as any)?.uri,
            selection: (selection as any)?.content,
          };
          this.panel.webview.postMessage({ type: 'activeContext', payload });
          break;
        }
        case 'ctx:request': {
          const result = await vscode.commands.executeCommand('eduai.backend.getContext', { scope: msg.payload?.scope });
          this.panel.webview.postMessage({ type: 'ctx:result', payload: { scope: msg.payload?.scope, result } });
          break;
        }
        case 'editor:insert': {
          await vscode.commands.executeCommand('eduai.backend.insertCode', msg.payload);
          break;
        }
        case 'thread:save': {
          await vscode.commands.executeCommand('eduai.backend.saveThread', msg.payload);
          break;
        }
        case 'thread:export': {
          const href = await vscode.commands.executeCommand('eduai.backend.exportThread', msg.payload);
          this.panel.webview.postMessage({ type: 'thread:exported', payload: { href } });
          break;
        }
        case 'feedback': {
          await vscode.commands.executeCommand('eduai.backend.feedback', msg.payload);
          break;
        }
      }
    });

    this.panel.onDidDispose(() => this.dispose(), null);
  }

  dispose() {
    ChatPanel.currentPanel = undefined;
    this.panel.dispose();
  }

  private getHtml(webview: vscode.Webview) {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));

    const cfg = vscode.workspace.getConfiguration('eduai');
    const model = (cfg.get('model') as string) || (cfg.get('defaultModel') as string) || 'qwen3-coder:30b';

    const bootJson = JSON.stringify({ model })
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      "font-src 'self' data:",
      "connect-src https: http: ws:",
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cssUri}">
  <title>EduAI — Tutor</title>
</head>
<body>
  <header class="header">
    <div class="row gap">
      <div class="title">EduAI • Tutor <span id="status" class="badge">Idle</span></div>
      <div class="grow"></div>
      <label class="control">
        <span class="hint">Model</span>
        <select id="model"></select>
      </label>
      <label class="control">
        <span class="hint">Assist</span>
        <select id="assist">
          <option value="Socratic">Socratic</option>
          <option value="Hinted">Hinted</option>
          <option value="Show-and-Tell">Show-and-Tell</option>
          <option value="Direct">Direct</option>
        </select>
      </label>
      <span class="badge" id="tokenStats">0 tokens</span>
    </div>

    <div class="row wrap">
      <div id="objectives" class="chips" aria-label="Objectives"></div>
      <div class="grow"></div>
      <div class="chips">
        <button class="chip qa" data-action="hints">Hints Only</button>
        <button class="chip qa" data-action="explain">Explain</button>
        <button class="chip qa" data-action="quiz">CFU Quiz</button>
        <button class="chip qa" data-action="plan">Plan Steps</button>
        <button class="chip qa" data-action="review">Code Review</button>
        <button class="chip qa" data-action="reflect">Reflect</button>
      </div>
    </div>
  </header>

  <main class="content">
    <section id="log" class="messages" aria-live="polite"></section>
  </main>

  <footer class="composer">
    <div class="toolbar row wrap">
      <span class="hint">Context:</span>
      <button class="chip" data-scope="activeFile">Active file</button>
      <button class="chip" data-scope="selection">Selection</button>
      <button class="chip" data-scope="problems">Problems</button>
      <button class="chip" data-scope="tests">Tests</button>
      <div class="grow"></div>
      <button class="chip ghost" id="newThread">New</button>
      <button class="chip ghost" id="saveThread">Save</button>
      <button class="chip ghost" id="exportMd">Export .md</button>
      <button class="chip ghost" id="exportJson">Export .json</button>
      <button class="chip danger" id="clearChat">Clear</button>
    </div>

    <textarea id="prompt" placeholder="Ask for help… or click a Quick Action (Hints, Explain, CFU, Plan, Review, Reflect)"></textarea>
    <div class="composer-row">
      <button id="use-selection" class="btn secondary">Use Selection</button>
      <div class="grow hint">Attached: <span id="attachedCount">0</span></div>
      <button id="send" class="btn">Send</button>
    </div>
  </footer>

  <script nonce="${nonce}">
    window.__EDUAI_BOOT__ = ${bootJson};
    (function initBoot() {
      try {
        var boot = window.__EDUAI_BOOT__ || {};
        var modelSel = document.getElementById('model');
        if (modelSel && boot.model) {
          var opt = document.createElement('option');
          opt.value = String(boot.model);
          opt.textContent = String(boot.model);
          opt.selected = true;
          modelSel.appendChild(opt);
        }
      } catch (e) { console.error('boot init failed', e); }
    })();
  </script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
