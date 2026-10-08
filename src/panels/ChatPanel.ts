import * as vscode from 'vscode';
import { StudySession } from '../study/session';
import { VibeSession } from '../vibe/session';

export type Sessions = { study: StudySession; vibe: VibeSession };

/**
 * Hosts the webview. The webview is a thin renderer: all state lives in the active session
 * (project-mode VibeSession by default, or the StudySession), which pushes a full view
 * snapshot on every change. Ensures only one panel exists at a time.
 */
export class ChatPanel {
  public static readonly viewType = 'vibelearner.chatPanel';
  public static currentPanel: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly workflow: 'vibe' | 'study';

  public static createOrShow(extensionUri: vscode.Uri, sessions: Sessions) {
    // Open beside the code
    if (vscode.window.tabGroups.all.length === 1) {
      void vscode.commands.executeCommand('workbench.action.splitEditorRight');
    }
    const column = vscode.window.tabGroups.activeTabGroup?.viewColumn ?? vscode.ViewColumn.Two;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'VibeLearner',
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, sessions);
  }

  /** Pushes the latest snapshot from a session, if that session is the one this panel shows. */
  public static pushState(from: 'vibe' | 'study', view: unknown) {
    const p = ChatPanel.currentPanel;
    if (p && p.workflow === from) p.panel.webview.postMessage({ type: 'state', payload: view });
  }

  private constructor(panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, sessions: Sessions) {
    this.panel = panel;
    this.workflow = vscode.workspace.getConfiguration('vibelearner').get<string>('workflow') === 'study' ? 'study' : 'vibe';
    this.panel.webview.html = this.getHtml(this.panel.webview);
    const { study, vibe } = sessions;

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      const p = msg?.payload;
      if (msg?.type === 'ready') {
        ChatPanel.pushState(this.workflow, this.workflow === 'vibe' ? vibe.getView() : study.getView());
        return;
      }
      if (this.workflow === 'vibe') {
        switch (msg?.type) {
          case 'v:begin': await vibe.begin(String(p?.participant ?? ''), !!p?.consent, p?.level ? String(p.level) : undefined); break;
          case 'v:send': await vibe.send(String(p?.text ?? ''), p?.target ? String(p.target) : undefined); break;
          case 'v:action': await vibe.action(String(p?.cmd ?? ''), p?.arg); break;
          case 'v:quizAnswer': await vibe.answerQuiz(Number(p?.choice)); break;
        }
        return;
      }
      switch (msg?.type) {
        case 'begin': await study.begin(String(p?.participant ?? ''), !!p?.consent); break;
        case 'send': await study.send(String(p?.text ?? '')); break;
        case 'runTests': await study.runTestsNow(); break;
        case 'needCode': await study.needCode(); break;
        case 'startCheck': await study.startCheck(); break;
        case 'quizAnswer': await study.answerQuiz(Number(p?.choice)); break;
        case 'finish': await study.finishTask(); break;
        case 'survey': await study.submitSurvey(Number(p?.effort), Number(p?.need), String(p?.comment ?? '')); break;
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
