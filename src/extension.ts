import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { StudyLogger } from './study/logger';
import { StudySession } from './study/session';

/**
 * Entry point for the VS Code extension.
 *
 * VibeLearner is a research prototype for studying structured vibe coding: students describe
 * their reasoning, receive complete code, review it, and answer comprehension checks. A
 * "direct" condition (plain code generation) shares the same UI, model, tasks, and logging.
 */
export async function activate(context: vscode.ExtensionContext) {
  const logger = new StudyLogger(context.globalStorageUri);
  const session = new StudySession(context, logger, (view) => ChatPanel.pushState(view));

  const open = () => ChatPanel.createOrShow(context.extensionUri, session);

  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.openChat', open),
    vscode.commands.registerCommand('vibelearner.showChat', open),

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
