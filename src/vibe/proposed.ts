import * as vscode from 'vscode';

/** Serves proposed file contents to VS Code's diff editor. */
export class ProposedContent implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'vibelearner-proposed';
  private static store = new Map<string, string>();

  static put(id: string, name: string, content: string): vscode.Uri {
    const key = `/${id}/${name}`;
    ProposedContent.store.set(key, content);
    return vscode.Uri.from({ scheme: ProposedContent.scheme, path: key });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return ProposedContent.store.get(uri.path) ?? '';
  }
}
