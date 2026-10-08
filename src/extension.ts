import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { StudyLogger } from './study/logger';
import { StudySession } from './study/session';
import { ProposedContent } from './vibe/edits';
import { VibeSession } from './vibe/session';

/**
 * Entry point for the VS Code extension.
 *
 * VibeLearner is an AI vibe-coding assistant that teaches while it builds. Project mode (default)
 * sees the whole workspace, proposes edits as reviewable diffs, explains every change in plain
 * terms, and offers understanding checks. `vibelearner.learning.level = off` turns it into a plain
 * vibe-coding assistant for comparison. The older fixed-task study workflow is kept behind
 * `vibelearner.workflow = study`.
 */
export async function activate(context: vscode.ExtensionContext) {
  const logger = new StudyLogger(context.globalStorageUri);
  const study = new StudySession(context, logger, (view) => ChatPanel.pushState('study', view));
  const vibe = new VibeSession(context, logger, (view) => ChatPanel.pushState('vibe', view));
  const sessions = { study, vibe };

  const open = () => ChatPanel.createOrShow(context.extensionUri, sessions);
  const isVibe = () => vscode.workspace.getConfiguration('vibelearner').get<string>('workflow') !== 'study';

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ProposedContent.scheme, new ProposedContent()),

    vscode.commands.registerCommand('vibelearner.openChat', open),
    vscode.commands.registerCommand('vibelearner.showChat', open),

    vscode.commands.registerCommand('vibelearner.explainSelection', async () => {
      if (!isVibe()) return void vscode.window.showInformationMessage('Explain Selection is available in project mode (vibelearner.workflow = vibe).');
      open();
      await vibe.explainSelection();
    }),
    vscode.commands.registerCommand('vibelearner.changeSelection', async () => {
      if (!isVibe()) return void vscode.window.showInformationMessage('Change Selection is available in project mode (vibelearner.workflow = vibe).');
      open();
      await vibe.changeSelection();
    }),
    vscode.commands.registerCommand('vibelearner.quizProject', async () => {
      if (!isVibe()) return;
      open();
      await vibe.ensureStarted();
      await vibe.action('quizProject');
    }),

    // Keep the header chip ("what the assistant is looking at") current.
    vscode.window.onDidChangeActiveTextEditor(() => vibe.touch()),
    vscode.window.onDidChangeTextEditorSelection(() => vibe.touch()),

    // Stores the Gemini key in the OS keychain (SecretStorage) instead of plain-text settings.
    vscode.commands.registerCommand('vibelearner.setGeminiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'Gemini API key (stored in your OS keychain)', password: true, ignoreFocusOut: true });
      if (key === undefined) return;
      if (key.trim()) await context.secrets.store('gemini_api_key', key.trim());
      else await context.secrets.delete('gemini_api_key');
      void vscode.window.showInformationMessage(key.trim() ? 'Gemini API key saved securely.' : 'Gemini API key removed.');
    }),

    // Researcher utilities
    vscode.commands.registerCommand('vibelearner.revealStudyLogs', async () => {
      const file = logger.filePath;
      const dir = vscode.Uri.joinPath(context.globalStorageUri, 'study_logs');
      await vscode.workspace.fs.createDirectory(dir);
      await logger.flush();
      void vscode.commands.executeCommand('revealFileInOS', file ? vscode.Uri.file(file) : dir);
    }),
  );
}

export function deactivate() {}
