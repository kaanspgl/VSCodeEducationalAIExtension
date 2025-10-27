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

  /** Allow other commands to send messages into the webview */
  public static postToWebview(message: any) {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.webview.postMessage(message);
    }
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
    const jsUri  = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));

    const cfg = vscode.workspace.getConfiguration('eduai');
    const model = (cfg.get('model') as string) || (cfg.get('defaultModel') as string) || 'qwen3-coder:30b';

    const bootJson = JSON.stringify({ model })
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      "font-src data:",
      "connect-src https: http: ws:"
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
  <!-- Top bar -->
  <header class="topbar">
    <div class="brand"><span class="dot"></span>EduAI</div>

    <!-- Segmented learning modes (mirrors Assist) -->
    <div class="seg" role="tablist" aria-label="Learning Mode">
      <button class="seg-btn active" data-assist="Socratic"  role="tab" aria-selected="true">Socratic</button>
      <button class="seg-btn"         data-assist="Hinted"    role="tab">Hinted</button>
      <button class="seg-btn"         data-assist="Show-and-Tell" role="tab">Show & Tell</button>
      <button class="seg-btn"         data-assist="Direct"    role="tab">Direct</button>
    </div>

    <div class="grow"></div>

    <label class="control" title="Model">
      <span class="hint">Model</span>
      <select id="model"></select>
    </label>

    <span id="tokenStats" class="badge" title="Approximate token usage">0 tokens</span>
    <span id="status" class="badge">Idle</span>
  </header>

  <!-- Three-pane main -->
  <main class="main">
    <!-- Left: Context & Actions -->
    <aside class="pane left" aria-label="Context and Actions">
      <div class="pane-header">
        <span class="pill">Context</span><span class="muted">Auto</span>
      </div>

      <section class="group">
        <div class="group-title">Quick Actions</div>
        <div class="chips">
          <button class="chip qa" data-action="explain"  title="Clear explanation with a tiny example">Explain</button>
          <button class="chip qa" data-action="quiz"     title="Quick 3-question check">CFU Quiz</button>
          <button class="chip qa" data-action="review"   title="Light code review with patch">Code Review</button>
          <button class="chip qa" data-action="plan"     title="Steps with pitfalls">Plan Steps</button>
          <button class="chip qa" data-action="hints"    title="Hints only">Hints Only</button>
          <button class="chip qa" data-action="reflect"  title="Short reflection">Reflect</button>
        </div>
      </section>

      <section class="group">
        <div class="group-title">Attach Context</div>
        <div class="chips">
          <button class="chip" data-scope="activeFile" title="Attach current file">Active file</button>
          <button class="chip" data-scope="selection"  title="Attach selection">Selection</button>
          <button class="chip" data-scope="problems"   title="Attach top diagnostics">Problems</button>
          <button class="chip" data-scope="tests"      title="Attach test summary">Tests</button>
        </div>
        <div class="hint" style="margin-top:6px">Attached: <span id="attachedCount">0</span></div>
      </section>

      <section class="group">
        <div class="group-title">Learning Objectives</div>
        <div id="objectives" class="chips"></div>
      </section>
    </aside>

    <!-- Center: Chat -->
    <section class="pane chat" aria-label="Conversation">
      <div id="log" class="scroll" role="log" aria-live="polite" aria-relevant="additions"></div>

      <div class="composer">
        <textarea id="prompt" placeholder="Ask for help… or click a Quick Action"></textarea>
        <div class="composer-row">
          <button id="use-selection" class="btn secondary" title="Insert your current selection into the prompt">Use Selection</button>
          <div class="grow hint">Ctrl/Cmd + Enter to send</div>
          <button id="send" class="btn">Send</button>
        </div>
      </div>
    </section>

    <!-- Right: Learning / Session -->
    <aside class="pane right" aria-label="Learning Resources">
      <div class="pane-header"><span class="pill">Learning</span><span class="muted">Resources</span></div>

      <div class="tabs" role="tablist" aria-label="Right Tabs">
        <button class="tab active" data-tab="explanation" aria-selected="true">Explanation</button>
        <button class="tab" data-tab="history">History</button>
        <button class="tab" data-tab="quizzes">Quizzes</button>
      </div>

      <div class="tabpanes" id="tabpanes">
        <div class="card" data-pane="explanation">
          <h4>Concept Breakdown</h4>
          <div class="muted">Summaries aligned with your current chat.</div>
        </div>
        <div class="card" data-pane="history" style="display:none;">
          <h4>Recent Sessions</h4>
          <div class="muted">Your last saved explanations & snippets.</div>
        </div>
        <div class="card" data-pane="quizzes" style="display:none;">
          <h4>Practice</h4>
          <div class="muted">Auto-generated MCQs with instant feedback.</div>
        </div>
      </div>
    </aside>
  </main>

  <!-- Floating toggles (shown in compact / half-screen) -->
  <div class="floating" id="floatToggles" style="display:none;">
    <button class="float-btn" id="openContext">Context</button>
    <button class="float-btn" id="openLearning">Learning</button>
  </div>

  <script nonce="${nonce}">
    window.__EDUAI_BOOT__ = ${bootJson};
    (function initBoot(){
      try{
        var boot = window.__EDUAI_BOOT__ || {};
        var modelSel = document.getElementById('model');
        if (modelSel && boot.model) {
          var opt = document.createElement('option');
          opt.value = String(boot.model);
          opt.textContent = String(boot.model);
          opt.selected = true;
          modelSel.appendChild(opt);
        }
      } catch(e){}
    })();
  </script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
  
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
