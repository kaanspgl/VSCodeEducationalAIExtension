import * as vscode from 'vscode';
import { callBackend } from './shared/callBackend';

export function activate(context: vscode.ExtensionContext) {
  // Command: Open chat panel (implemented inside ChatPanel)
  const openChat = vscode.commands.registerCommand('eduai.openChat', async () => {
    // Lazy-import to keep activation light
    const { ChatPanel } = await import('./panels/ChatPanel');
    const includeSelection = vscode.workspace.getConfiguration('eduai').get<boolean>('includeSelectionByDefault');
    let selectionText = '';
    const editor = vscode.window.activeTextEditor;
    if (includeSelection && editor && !editor.selection.isEmpty) {
      selectionText = editor.document.getText(editor.selection);
    }
    ChatPanel.render(context.extensionUri, selectionText);
  });

  // Command: Explain selection → shows a Markdown doc
  const explainSelection = vscode.commands.registerCommand('eduai.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Select some code first.');
      return;
    }

    const code = editor.document.getText(editor.selection);
    const prompt =
      'Explain the following code to a student and suggest improvements.\n\n' + code;

    const result = await callBackend(prompt);
    if (!result.ok) {
      vscode.window.showErrorMessage(result.message);
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: result.content || '(no content)',
      language: 'markdown'
    });
    vscode.window.showTextDocument(doc, { preview: true });
  });

  context.subscriptions.push(openChat, explainSelection);
}

export function deactivate() {}

/**
 * Shared settings accessor (optional helper you can expand later)
 */
export function getEduAISettings() {
  const cfg = vscode.workspace.getConfiguration('eduai');
  // Default to OLLAMA so local testing "just works"
  const provider = (cfg.get<string>('provider') || 'ollama').toLowerCase();
  const endpoint = cfg.get<string>('endpoint') || '';
  const apiKey = cfg.get<string>('apiKey') || '';
  const model =
    cfg.get<string>('model') ||
    (provider === 'ollama' ? 'llama3.1' : 'gpt-4o-mini');

  return { provider, endpoint, apiKey, model };
}
