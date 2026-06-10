import * as vscode from 'vscode';

/**
 * Manages the lifecycle and messaging for the chat webview panel.
 * Ensures only one panel exists at a time.
 */

export class ChatPanel {
  public static readonly viewType = 'vibelearner.chatPanel';
  public static currentPanel: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private isReady = false;
  private readonly pendingMessages: any[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    // Open beside code (avoid full screen)
    const groups = vscode.window.tabGroups.all;
    if (groups.length === 1) {
      void vscode.commands.executeCommand('workbench.action.splitEditorRight');
    }
    const column = vscode.window.tabGroups.activeTabGroup?.viewColumn ?? vscode.ViewColumn.Two;

    // If panel already exists, simply reveal it
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'VibeLearner — Tutor',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
  }

  public static postToWebview(message: any) {
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.postMessage(message);
    }
  }

  private postMessage(message: any) {
    if (!this.isReady) {
      this.pendingMessages.push(message);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready': {
          this.isReady = true;
          for (const message of this.pendingMessages.splice(0)) {
            void this.panel.webview.postMessage(message);
          }
          break;
        }
        case 'ask': {
          try {
            const res = await vscode.commands.executeCommand<{ text?: string; usage?: any; meta?: any }>(
              'vibelearner.backend.chat',
              { text: msg.payload?.text ?? msg.payload, meta: msg.payload?.meta ?? msg.meta }
            );
            this.panel.webview.postMessage({ type: 'answer', payload: res?.text ?? String(res) });
            this.panel.webview.postMessage({ type: 'usage', payload: res?.usage });
            if (res?.meta?.policyRepaired) {
              this.panel.webview.postMessage({
                type: 'policyStatus',
                payload: { assist: res.meta.assist }
              });
            }
          } catch (err: any) {
            this.panel.webview.postMessage({ type: 'answer', payload: `⚠️ ${err?.message || err}` });
          }
          break;
        }
        case 'requestActiveContext': {
          const selection = await vscode.commands.executeCommand('vibelearner.backend.getContext', { scope: 'selection' });
          const payload = {
            scope: 'selection',
            result: selection,
          };
          this.panel.webview.postMessage({ type: 'activeContext', payload });
          break;
        }
        case 'ctx:request': {
          const result = await vscode.commands.executeCommand('vibelearner.backend.getContext', { scope: msg.payload?.scope });
          this.panel.webview.postMessage({ type: 'ctx:result', payload: { scope: msg.payload?.scope, result } });
          break;
        }
        case 'editor:insert': {
          await vscode.commands.executeCommand('vibelearner.backend.insertCode', msg.payload);
          break;
        }
        case 'thread:save': {
          await vscode.commands.executeCommand('vibelearner.backend.saveThread', msg.payload);
          break;
        }
        case 'thread:export': {
          const href = await vscode.commands.executeCommand('vibelearner.backend.exportThread', msg.payload);
          this.panel.webview.postMessage({ type: 'thread:exported', payload: { href } });
          break;
        }
        case 'feedback': {
          await vscode.commands.executeCommand('vibelearner.backend.feedback', msg.payload);
          break;
        }
      }
    });

     /**
     * Cleanup when the panel is closed.
     * Clears the static reference so a new one can be created later.
     */

    this.panel.onDidDispose(() => this.dispose(), null);
  }

  dispose() {
    ChatPanel.currentPanel = undefined;
  }

   /**
   * Returns the HTML content rendered inside the webview.
   * This is intentionally minimal and can be expanded later.
   */

  private getHtml(webview: vscode.Webview) {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'));
    const jsUri  = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));

    const cfg = vscode.workspace.getConfiguration('vibelearner');
    const model = (cfg.get('model') as string) || (cfg.get('defaultModel') as string) || 'qwen2.5:7b-instruct';

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
  <title>VibeLearner — Tutor</title>
</head>
<body>
  <!-- Top bar -->
  <header class="topbar">
    <div class="brand"><span class="dot"></span>VibeLearner</div>

    <!-- Assist dropdown with inline explanations -->
    <details class="assist" id="assistDetails">
      <summary id="assistSummary">
        <span class="hint">Assist Mode:</span>
        <span id="assistLabel">Socratic</span>
      </summary>
      <div class="assist-body" role="listbox" aria-label="Assist Mode">
        <label class="assist-opt"><input type="radio" name="assist" value="Socratic" checked> <b>Socratic</b><br><span>Asks one guiding question, then gives a small hint if you’re stuck.</span></label>
        <label class="assist-opt"><input type="radio" name="assist" value="Hinted"> <b>Hinted</b><br><span>2–3 actionable hints and a short plan; no full solution unless asked.</span></label>
        <label class="assist-opt"><input type="radio" name="assist" value="Show-and-Tell"> <b>Show &amp; Tell</b><br><span>Step-by-step with a tiny example and why it works.</span></label>
      </div>
    </details>

    <div class="grow"></div>

    <label class="control" title="Model">
      <span class="hint">Model</span>
      <select id="model"></select>
    </label>

    <span id="tokenStats" class="badge" title="Approximate token usage">0 tokens</span>
    <button id="new-chat" class="chip" title="Start a clean learning conversation">New Chat</button>
  </header>

  <!-- Single full-height main with sticky composer -->
  <main class="main one">
    <section class="pane chat" aria-label="Conversation">
      <div class="learning-policy" id="learningPolicy">
        <b>Learning-first mode:</b>
        <span id="policyText">I will ask one focused question and withhold the final fix.</span>
      </div>

      <!-- Context & Objectives dropdown (declutters UI) -->
      <details class="ctx" id="ctxDetails">
        <summary>
          <span class="hint">Context & Objectives</span>
          <span class="badge" id="ctxBadge"><span id="attachedCount">0</span> attached</span>
        </summary>
        <div class="ctx-body">
          <div class="group">
            <div class="group-title">Attach Context</div>
            <div class="ctx-list">
              <div class="ctx-row">
                <div>
                  <div class="ctx-name">Active file</div>
                  <div class="ctx-desc">Attach the entire current editor file (truncated).</div>
                </div>
                <button class="chip ctx-btn" data-scope="activeFile">Attach</button>
              </div>
              <div class="ctx-row">
                <div>
                  <div class="ctx-name">Selection</div>
                  <div class="ctx-desc">Attach only your selected code/text.</div>
                </div>
                <button class="chip ctx-btn" data-scope="selection">Attach</button>
              </div>
              <div class="ctx-row">
                <div>
                  <div class="ctx-name">Problems</div>
                  <div class="ctx-desc">Attach top diagnostics (errors & warnings) across the workspace.</div>
                </div>
                <button class="chip ctx-btn" data-scope="problems">Attach</button>
              </div>
              <div class="ctx-row">
                <div>
                  <div class="ctx-name">Tests</div>
                  <div class="ctx-desc">Attach a brief test summary if available.</div>
                </div>
                <button class="chip ctx-btn" data-scope="tests">Attach</button>
              </div>
            </div>
            <div class="hint" style="margin-top:8px">
              Attached (<span id="attachedCount2">0</span>): <span id="attachedList" class="muted">none</span>
            </div>
          </div>

          <div class="group">
            <div class="group-title">Learning Objectives</div>
            <div id="objectives" class="chips"></div>
            <div class="lo-legend">
              Click chips to cycle: <b>Unassessed → Partial → Done</b>.
              <div id="loCounts" class="muted" style="margin-top:4px"></div>
            </div>
          </div>
        </div>
      </details>

      <div id="log" class="scroll" role="log" aria-live="polite" aria-relevant="additions"></div>

      <div class="composer">
        <!-- Quick toolbar near input -->
        <div class="qa-toolbar" role="toolbar" aria-label="Quick actions">
          <button class="chip qa" data-action="explain"  title="Ctrl+Alt+1">Explain</button>
          <button class="chip qa" data-action="review"   title="Ctrl+Alt+2">Review</button>
          <button class="chip qa" data-action="plan"     title="Ctrl+Alt+3">Plan</button>
          <button class="chip qa" data-action="hints"    title="Ctrl+Alt+4">Hints</button>
          <button class="chip qa" data-action="reflect"  title="Ctrl+Alt+5">Reflect</button>
          <button class="chip qa" data-action="quiz"     title="Ctrl+Alt+6">CFU Quiz</button>
        </div>

        <textarea id="prompt" placeholder="Ask for help… or use the toolbar"></textarea>
        <div class="composer-row">
          <button id="use-selection" class="btn secondary" title="Insert your current selection into the prompt">Use Selection</button>

          <div class="grow hint">Ctrl/Cmd + Enter to send</div>

          <div class="composer-status" aria-live="polite" aria-atomic="true">
            <span id="status-dot" class="idle" aria-hidden="true"></span>
            <span id="status2" class="status-text">Idle</span>
          </div>

          <button id="send" class="btn">Send</button>
        </div>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    window.__VIBELEARNER_BOOT__ = ${bootJson};
    (function initBoot(){
      try{
        var boot = window.__VIBELEARNER_BOOT__ || {};
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
