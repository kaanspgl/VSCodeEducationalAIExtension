import * as vscode from 'vscode';
import { StudySession } from '../study/session';

/**
 * Hosts the study webview. The webview is a thin renderer: all workflow state lives in
 * StudySession (extension host), which pushes a full view snapshot on every change.
 * Ensures only one panel exists at a time.
 */
export class ChatPanel {
  public static readonly viewType = 'vibelearner.chatPanel';
  public static currentPanel: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  public static createOrShow(extensionUri: vscode.Uri, session: StudySession) {
    // Open beside code (the generated code is shown in column one)
    if (vscode.window.tabGroups.all.length === 1) {
      void vscode.commands.executeCommand('workbench.action.splitEditorRight');
    }
    const column = vscode.window.tabGroups.activeTabGroup?.viewColumn ?? vscode.ViewColumn.Two;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'VibeLearner',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, session);
  }

  /** Pushes the latest session snapshot to the webview, if it is open. */
  public static pushState(view: unknown) {
    ChatPanel.currentPanel?.panel.webview.postMessage({ type: 'state', payload: view });
  }

  private constructor(panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, session: StudySession) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready': ChatPanel.pushState(session.getView()); break;
        case 'begin': await session.begin(String(msg.payload?.participant ?? ''), !!msg.payload?.consent); break;
        case 'send': await session.send(String(msg.payload?.text ?? '')); break;
        case 'runTests': await session.runTestsNow(); break;
        case 'needCode': await session.needCode(); break;
        case 'startCheck': await session.startCheck(); break;
        case 'quizAnswer': await session.answerQuiz(Number(msg.payload?.choice)); break;
        case 'finish': await session.finishTask(); break;
        case 'survey':
          await session.submitSurvey(Number(msg.payload?.effort), Number(msg.payload?.need), String(msg.payload?.comment ?? ''));
          break;
        case 'revealCode': void vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'); break;
      }
    });

    this.panel.onDidDispose(() => { ChatPanel.currentPanel = undefined; }, null);
  }

  private getHtml(webview: vscode.Webview) {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));

    // No network access is needed in the webview: all model calls go through the extension host.
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cssUri}">
  <title>VibeLearner</title>
</head>
<body>
  <div id="app"></div>
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
