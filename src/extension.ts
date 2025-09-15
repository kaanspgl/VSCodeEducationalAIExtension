import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';

export function activate(context: vscode.ExtensionContext) {
  // Command: Open chat webview
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.openChat', async () => {
      const includeSelection = vscode.workspace
        .getConfiguration('eduai')
        .get<boolean>('includeSelectionByDefault');

      let selectionText = '';
      const editor = vscode.window.activeTextEditor;
      if (includeSelection && editor && !editor.selection.isEmpty) {
        selectionText = editor.document.getText(editor.selection);
      }
      ChatPanel.render(context.extensionUri, selectionText);
    })
  );

  // Command: Explain selection → shows Markdown explanation
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage('Select some code first.');
        return;
      }
      const code = editor.document.getText(editor.selection);
      const explanation = await callAI(
        'Explain the following code to a student and suggest improvements.\n\n' + code
      );
      if (explanation) {
        const doc = await vscode.workspace.openTextDocument({
          content: explanation,
          language: 'markdown'
        });
        vscode.window.showTextDocument(doc, { preview: true });
      }
    })
  );
}

export function deactivate() {}

async function callAI(prompt: string): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('eduai');
  const provider = (cfg.get<string>('provider') || 'openai').toLowerCase();
  const endpoint = cfg.get<string>('endpoint') || '';
  const apiKey = cfg.get<string>('apiKey') || '';
  const model = cfg.get<string>('model') || 'gpt-4o-mini';

  if (provider === 'ollama') {
    // Default Ollama endpoint if user left it blank
    const base = endpoint || 'http://localhost:11434/api/chat';
    try {
      const res = await (globalThis as any).fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Ollama chat format (non-streaming)
        body: JSON.stringify({
          model: model || 'llama3.1',
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      } as any);

      if (!res?.ok) {
        const text = await res.text?.();
        throw new Error(`HTTP ${res?.status}: ${text}`);
      }
      const data: any = await res.json();
      // Ollama returns { message: { role, content }, ... }
      const content = data?.message?.content ?? JSON.stringify(data);
      return content;
    } catch (err: any) {
      vscode.window.showErrorMessage(`EduAI (Ollama) request failed: ${err.message}`);
      return null;
    }
  }

  // Default: OpenAI-compatible
  if (!endpoint) {
    vscode.window.showErrorMessage('EduAI endpoint is not set (eduai.endpoint).');
    return null;
  }
  if (!apiKey) {
    vscode.window.showErrorMessage('EduAI API key is not set (eduai.apiKey).');
    return null;
  }

  try {
    const res = await (globalThis as any).fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant inside VS Code.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    } as any);

    if (!res?.ok) {
      const text = await res.text?.();
      throw new Error(`HTTP ${res?.status}: ${text}`);
    }
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return content;
  } catch (err: any) {
    vscode.window.showErrorMessage(`EduAI (OpenAI) request failed: ${err.message}`);
    return null;
  }
}

