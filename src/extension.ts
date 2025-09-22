// src/extension.ts
import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { callBackend } from './shared/callBackend';

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.showChat', () => ChatPanel.createOrShow(context.extensionUri))
  );

  // Main chat backend (Ollama only)
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.chat', async (payload: any) => {
      const text = payload?.text ?? payload;
      const meta = payload?.meta ?? {};
      const model =
        (vscode.workspace.getConfiguration('eduai').get('model') as string) ||
        'qwen3:4b';
      const contextData: any = meta.context || {};

      const system =
        'You are a helpful coding tutor. Give concise explanations, runnable examples when useful, and brief checks for understanding.';

      const finalPrompt = buildPrompt(text, contextData);

      try {
        const res = await callBackend({ model, prompt: finalPrompt, system });

        // --- Fix: strip <think> ... </think> blocks from reasoning models ---
        const clean = res.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        return { text: clean, usage: res.usage, meta: { model, provider: 'ollama' } };
      } catch (err: any) {
        throw new Error(`Chat failed: ${err?.message || err}`);
      }
    })
  );

  // Context providers
  context.subscriptions.push(vscode.commands.registerCommand('eduai.backend.getContext', async ({ scope }) => {
    if (scope === 'activeFile') {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return { error: 'No active editor' };
      const doc = ed.document;
      return {
        uri: doc.uri.toString(),
        language: doc.languageId,
        content: doc.getText().slice(0, 20000),
      };
    }
    if (scope === 'selection') {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return { error: 'No active editor' };
      const sel = ed.selections?.[0];
      if (!sel || sel.isEmpty) return { bytes: 0, content: '' };
      const text = ed.document.getText(sel);
      return { bytes: text.length, content: text.slice(0, 10000) };
    }
    if (scope === 'problems') {
      const problems: any[] = [];
      const diags = vscode.languages.getDiagnostics();
      diags.forEach(([uri, list]) => {
        const path = uri.fsPath;
        (list || []).slice(0, 50).forEach(d => problems.push({ path, message: d.message, severity: d.severity, range: d.range }));
      });
      return { count: problems.length, items: problems.slice(0, 200) };
    }
    if (scope === 'tests') {
      return { summary: 'No test adapter connected.' };
    }
    return { error: 'Unknown scope' };
  }));

  // Insert code
  context.subscriptions.push(vscode.commands.registerCommand('eduai.backend.insertCode', async ({ code, where }) => {
    const ed =
      vscode.window.activeTextEditor ||
      (await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' })));
    await ed.edit(builder => {
      if (where === 'newFile') builder.insert(new vscode.Position(0, 0), code);
      else if (ed.selections?.length) ed.selections.forEach(sel => builder.replace(sel, code));
      else builder.insert(ed.selection.active, code);
    });
    vscode.window.showInformationMessage('Inserted AI suggestion.');
  }));

  // Save / export
  context.subscriptions.push(vscode.commands.registerCommand('eduai.backend.saveThread', async ({ title, messages }) => {
    const name = (title?.trim() || 'eduai-thread') + '.json';
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), filters: { JSON: ['json'] } });
    if (!uri) return;
    const json = JSON.stringify({ title, messages }, null, 2);
    const bytes = new TextEncoder().encode(json);
    await vscode.workspace.fs.writeFile(uri, bytes);
    vscode.window.showInformationMessage('Thread saved.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('eduai.backend.exportThread', async ({ format, messages }) => {
    const md = format === 'md'
      ? messages.map((m: any) => `**${m.role === 'assistant' ? 'Assistant' : 'You'}**\n\n${m.text}\n`).join('\n')
      : JSON.stringify(messages, null, 2);
    const mime = format === 'md' ? 'text/markdown' : 'application/json';
    const base64 = toBase64(md);
    return `data:${mime};base64=${base64}`;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('eduai.backend.feedback', async ({ messageId, value }) => {
    console.log('feedback', messageId, value);
  }));
}

export function deactivate() {}

function buildPrompt(userText: string, ctx: any): string {
  const parts: string[] = [];
  if (ctx?.activeFile?.content) parts.push(`Active File:\n${ctx.activeFile.content.slice(0, 6000)}`);
  if (ctx?.selection?.content) parts.push(`Selection:\n${ctx.selection.content.slice(0, 6000)}`);
  if (ctx?.problems?.items?.length) parts.push(`Problems: ${JSON.stringify(ctx.problems.items.slice(0, 20))}`);
  if (ctx?.tests) parts.push(`Tests: ${JSON.stringify(ctx.tests)}`);
  const ctxBlock = parts.length ? `\n\nContext:\n${parts.join('\n\n')}` : '';
  return `${userText}${ctxBlock}`;
}

declare const Buffer: any;
function toBase64(s: string) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // @ts-ignore
  return btoa(binary);
}
