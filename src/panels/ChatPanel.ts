// src/panels/ChatPanel.ts
// EduAI chat panel (Ollama-only). Minimal header, working Send & Selection actions.

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
      'EduAI — Chat',
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
            const res = await vscode.commands.executeCommand<{
              text?: string;
              usage?: any;
              meta?: any;
            }>('eduai.backend.chat', {
              text: msg.payload?.text ?? msg.payload,
              meta: msg.payload?.meta ?? msg.meta,
            });
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

    // read user settings so webview knows defaults (e.g., includeSelectionByDefault, model)
    const cfg = vscode.workspace.getConfiguration('eduai');
    const model =
      (cfg.get('model') as string) ||
      (cfg.get('defaultModel') as string) ||
      'qwen3:4b';
    const includeSel =
      (cfg.get('includeSelectionByDefault') as boolean) === true;

    const boot = {
      model,
      includeSelectionByDefault: includeSel,
    };

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      "font-src 'self' data:",
      "connect-src https: http: ws:",
    ].join('; ');

    return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cssUri}">
  <title>EduAI — Chat</title>
</head>
<body>
  <header class="header">
    <div class="title">EduAI • Chat <span id="status" class="badge">Idle</span></div>
    <div class="controls">
      <label class="control">
        <span class="hint">Model</span>
        <select id="model">
          <option value="${boot.model}" selected>${boot.model}</option>
        </select>
      </label>
      <span class="badge" id="tokenStats">0 tokens</span>
    </div>
  </header>

  <main class="main">
    <section id="log" class="messages" aria-live="polite"></section>
    <aside class="sidebar">
      <div class="toolbar">
        <div class="row">
          <button class="btn" id="newThread">New</button>
          <button class="btn secondary" id="saveThread">Save</button>
          <button class="btn secondary" id="exportMd">Export .md</button>
          <button class="btn secondary" id="exportJson">Export .json</button>
          <button class="btn ghost" id="clearChat">Clear</button>
        </div>
        <div class="row">
          <span class="hint">Context:</span>
          <button class="chip" data-scope="activeFile">Active file</button>
          <button class="chip" data-scope="selection">Selection</button>
          <button class="chip" data-scope="problems">Problems</button>
          <button class="chip" data-scope="tests">Tests</button>
        </div>
      </div>

      <div class="section">
        <h4>Attached context</h4>
        <div id="ctxList" class="hint">None</div>
      </div>

      <div class="section">
        <h4>Quick actions</h4>
        <div class="row">
          <button class="chip qa" data-action="explain">Explain selection</button>
          <button class="chip qa" data-action="review">Review code</button>
          <button class="chip qa" data-action="quiz">Make a quiz</button>
          <button class="chip qa" data-action="hints">Give hints only</button>
          <button class="chip qa" data-action="step">Step-through plan</button>
        </div>
      </div>
    </aside>
  </main>

  <footer class="composer">
    <textarea id="prompt" placeholder="Ask for an explanation, request a review, or generate a quiz…"></textarea>
    <div class="composer-row">
      <input id="title" class="grow" type="text" placeholder="Thread title (optional)" />
      <span class="grow hint">Attached: <span id="attachedCount">0</span></span>
      <button id="use-selection" class="btn secondary">Use Selection</button>
      <button id="send" class="btn">Send</button>
    </div>
  </footer>

  <script nonce="${nonce}">window.__EDUAI_BOOT__ = ${JSON.stringify(boot)};</script>
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
