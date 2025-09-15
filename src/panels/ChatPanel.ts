import * as vscode from 'vscode';
import { callBackend } from '../shared/callBackend';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static render(extensionUri: vscode.Uri, selection: string) {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      ChatPanel.currentPanel._postSelection(selection);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'eduaiChat',
      'EduAI Chat',
      column ?? vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, selection);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, selection: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Listen for messages from the webview
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      const type = msg?.type;
      if (type === 'ask') {
        const text = String(msg?.payload ?? '');
        const res = await callBackend(text);
        const payload = res.ok ? (res.content || '') : `Error: ${res.message}`;
        this._panel.webview.postMessage({ type: 'answer', payload });
      } else if (type === 'requestActiveContext') {
        const ctx = this._collectEditorContext();
        this._panel.webview.postMessage({ type: 'activeContext', payload: ctx });
      }
    }, null, this._disposables);

    this._postSelection(selection);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public dispose() {
    ChatPanel.currentPanel = undefined;
    while (this._disposables.length) {
      const d = this._disposables.pop();
      try { d?.dispose(); } catch {}
    }
  }

  private _postSelection(selection: string) {
    if (selection) {
      this._panel.webview.postMessage({ type: 'seedSelection', payload: selection });
    }
  }

  private _collectEditorContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { language: '', selection: '', filename: '' };
    const doc = editor.document;
    const sel = editor.selection.isEmpty ? '' : doc.getText(editor.selection);
    return {
      language: doc.languageId,
      selection: sel,
      filename: doc.fileName
    };
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${stylesUri}">
    <title>EduAI Chat</title>
  </head>
  <body>
    <header>
      <h2>EduAI Chat</h2>
      <button id="use-selection">Insert Active Selection</button>
    </header>
    <main id="log"></main>
    <footer>
      <textarea id="prompt" rows="3" placeholder="Ask anything…"></textarea>
      <button id="send">Send</button>
    </footer>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
