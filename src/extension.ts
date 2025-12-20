import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { callBackend } from './shared/callBackend';

export async function activate(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('vibelearner');

  // Show the chat panel
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.showChat', () => {
      ChatPanel.createOrShow(context.extensionUri);
    })
  );

  // Open chat (no selection required)
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.openChat', () => {
      ChatPanel.createOrShow(context.extensionUri);
    })
  );

  // Ask about current selection
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.askSelection', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage('No active editor.');
        return;
      }
      const sel = ed.selection;
      if (!sel || sel.isEmpty) {
        vscode.window.showInformationMessage('Select some text first.');
        return;
      }

      const doc = ed.document;
      const language = doc.languageId;
      const filename = doc.uri.toString();
      const selection = doc.getText(sel).slice(0, 10000);

      ChatPanel.createOrShow(context.extensionUri);

      setTimeout(() => {
        ChatPanel.postToWebview({
          type: 'activeContext',
          payload: { language, filename, selection }
        });

        ChatPanel.postToWebview({
          type: 'presetPrompt',
          payload: {
            text: `Explain this ${language} code step by step: \n\n${selection}`,
            autoSend: false
          }
        });
      }, 200);
    })
  );

  // Ask about a file from Explorer context menu
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.askFile', async (resourceUri?: vscode.Uri) => {
      try {
        const uri = resourceUri ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          vscode.window.showInformationMessage('No file selected.');
          return;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const language = doc.languageId;
        const filename = uri.toString();
        const content = doc.getText().slice(0, 20000); 

        ChatPanel.createOrShow(context.extensionUri);

        ChatPanel.postToWebview({
          type: 'activeContext',
          payload: { language, filename, selection: content }
        });

        ChatPanel.postToWebview({
          type: 'presetPrompt',
          payload: {
            text: 'Give me a high-level explanation of this file, then suggest 2 improvements.',
            autoSend: false
          }
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`VibeLearner: Failed to load file — ${err?.message || err}`);
      }
    })
  );

  // === Backend: learning-first chat ===
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.backend.chat', async (payload: any) => {
      const text = payload?.text ?? payload;
      const meta = payload?.meta ?? {};
      const config = vscode.workspace.getConfiguration('vibelearner');

      // Updated default to Qwen
      const model =
        config.get<string>('model') ||
        'qwen3-coder:30b';

      const assist = meta.assist || 'Socratic';
      const objectives = Array.isArray(meta.objectives) ? meta.objectives.slice(0, 6) : [];
      const mode = meta.mode || 'chat';

      const system = buildSystemPrompt(assist, mode);
      const finalPrompt = buildLearningPrompt({
        userText: text,
        assist,
        objectives,
        mode,
        contextData: meta.context || {},
        history: meta.history || []
      });

      try {
        const res = await callBackend({
          model,
          prompt: finalPrompt,
          system,
          context, 
        });

        const clean = (res.text || '')
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .trim();

        return {
          text: clean,
          usage: res.usage,
          meta: { model, provider: res.provider, assist, mode },
        };
      } catch (err: any) {
        throw new Error(`Chat failed: ${err?.message || err}`);
      }
    })
  );

  // Context providers
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.backend.getContext', async ({ scope }) => {
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
          (list || [])
            .slice(0, 50)
            .forEach((d) =>
              problems.push({
                path,
                message: d.message,
                severity: d.severity,
                range: d.range,
              })
            );
        });
        return { count: problems.length, items: problems.slice(0, 200) };
      }

      if (scope === 'tests') {
        return { summary: 'No test adapter connected.' };
      }

      return { error: 'Unknown scope' };
    })
  );

  // Insert code into editor
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.backend.insertCode', async ({ code, where }) => {
      const ed =
        vscode.window.activeTextEditor ||
        (await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument({ content: '' })
        ));
      await ed.edit((builder) => {
        if (where === 'newFile') builder.insert(new vscode.Position(0, 0), code);
        else if (ed.selections?.length)
          ed.selections.forEach((sel) => builder.replace(sel, code));
        else builder.insert(ed.selection.active, code);
      });
      vscode.window.showInformationMessage('Inserted AI suggestion.');
    })
  );

  // Logging for research data
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.backend.feedback', async (payload: any) => {
      try {
        const logEntry = {
          timestamp: new Date().toISOString(),
          assistMode: payload.meta?.assist || 'unknown',
          model: payload.meta?.model || 'unknown',
          userPrompt: payload.lastPrompt || 'N/A',
          aiResponse: payload.lastResponse || 'N/A',
          userRating: payload.value, 
        };

        const storageUri = context.globalStorageUri;
        await vscode.workspace.fs.createDirectory(storageUri); 
        const logFileUri = vscode.Uri.joinPath(storageUri, 'research_data_log.jsonl');

        const encoded = new TextEncoder().encode(JSON.stringify(logEntry) + '\n');
        const existingData = await vscode.workspace.fs.readFile(logFileUri).then(data => data, () => new Uint8Array());
        
        const combined = new Uint8Array(existingData.length + encoded.length);
        combined.set(existingData);
        combined.set(encoded, existingData.length);

        await vscode.workspace.fs.writeFile(logFileUri, combined);
      } catch (err) {
        console.error('Failed to log research data:', err);
      }
    })
  );

  const quick = (action: string) => {
    ChatPanel.createOrShow(context.extensionUri);
    setTimeout(() => {
      ChatPanel.postToWebview({ type: 'quickAction', payload: { action } });
    }, 100);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearner.quick.explain', () => quick('explain')),
    vscode.commands.registerCommand('vibelearner.quick.review',  () => quick('review')),
    vscode.commands.registerCommand('vibelearner.quick.plan',    () => quick('plan')),
    vscode.commands.registerCommand('vibelearner.quick.hints',   () => quick('hints')),
    vscode.commands.registerCommand('vibelearner.quick.reflect', () => quick('reflect')),
    vscode.commands.registerCommand('vibelearner.quick.quiz',    () => quick('quiz')),
  );
}

export function deactivate() {}

// --- Prompts & Helpers ---

function buildSystemPrompt(assist: string, mode: string) {
  if (mode === 'quiz') {
    return [
      'Return ONLY a compact JSON quiz object:',
      '{ "type":"quiz", "version":1, "title":"string",',
      '  "questions":[ { "id":"q1", "stem":"string",',
      '    "choices":[ {"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."} ] } ] }',
      'Do NOT include correct answers in this JSON.',
      'No prose before or after the JSON.',
    ].join(' ');
  }
  if (mode === 'quiz-eval') {
    return [
      'You will receive the quiz JSON plus qId and choiceId.',
      'Respond ONLY with JSON: { "type":"quiz-eval","qId":"...","choiceId":"...","correct":true|false,"correctChoiceId":"A|B|C|D","feedback":"short explanation" }',
      'No prose before or after the JSON.',
    ].join(' ');
  }

  const base = [
    'You are VibeLearner, a course-aware coding tutor.',
    'Use a warm, concise, conversational tone.',
    'Write as a single cohesive explanation (no section headers).',
    'Begin with one focused guiding question, then explain the strategy simply.',
    'Provide a tiny runnable example only if it helps.',
    'Include one quick check-for-understanding and end with a brief reflection.',
  ];

  if (assist === 'Socratic') {
    base.push(
      'Use at most ONE targeted question at a time. If the student seems stuck or asks for help, give a small hint.',
      'If they remain stuck, follow with a short 2–3 sentence explanation that unblocks them.',
      'Avoid interrogating every line; focus on the next actionable step.'
    );
  } else if (assist === 'Hinted') {
    base.push('Offer 2–3 actionable hints and a high-level plan. Keep answers short; no full solution unless asked.');
  } else if (assist === 'Show-and-Tell') {
    base.push('Walk through step-by-step with a micro example and a brief why-it-works.');
  } else if (assist === 'Direct') {
    base.push('Provide a clear solution first, then a short why/when to use it.');
  }

  return base.join(' ');
}

type ChatTurn = { role: 'user' | 'assistant'; text: string };

function buildLearningPrompt({
  userText,
  assist,
  objectives,
  mode,
  contextData,
  history = []
}: {
  userText: string;
  assist: string;
  objectives: string[];
  mode: string;
  contextData: any;
  history?: ChatTurn[];
}) {
  const parts: string[] = [];
  const ctx = normalizeCtx(contextData);

  parts.push(`Mode:${mode}; Assist:${assist}; Objectives:${objectives.join(' | ') || 'N/A'}`);

  if (history?.length) {
    const lines = history
      .slice(0, 8)
      .map(h => `${h.role === 'assistant' ? 'Tutor' : 'User'}: ${String(h.text).slice(0, 800)}`)
      .join('\n');
    parts.push(`Recent Chat (most recent first, truncated):\n${lines}`);
  }

  if (ctx.activeFile?.content) {
    const skeleton = getFileSkeleton(ctx.activeFile.content);
    parts.push(`File Structure:\n${skeleton}\n\nActive File (truncated):\n${ctx.activeFile.content.slice(0, 4000)}`);
  }
  if (ctx.selection?.content) parts.push(`Selection:\n${ctx.selection.content.slice(0, 6000)}`);
  if (ctx.problems?.items?.length) parts.push(`Problems (top): ${JSON.stringify(ctx.problems.items.slice(0, 10))}`);
  if (ctx.tests) parts.push(`Tests: ${JSON.stringify(ctx.tests)}`);

  if (mode === 'quiz') {
    parts.push(
      'Create a 3-question multiple-choice quiz that is SPECIFIC to the most recent discussion and attached code/context.',
      'OUTPUT: JSON only (as specified). No answers embedded.'
    );
    parts.push(`User:\n${userText || 'Generate quiz.'}`);
  } else if (mode === 'quiz-eval') {
    parts.push('Evaluate the selected choice. OUTPUT: JSON only (as specified).');
    parts.push(`User:\n${userText}`);
  } else {
    const guidance = [
      'Write a cohesive tutoring reply (no headings).',
      '- If the user gave a statement/answer: first say right or wrong, then explain why in 1–3 sentences.',
      '- For questions: begin with one focused guiding question, then explain the strategy simply.',
      '- Ask one quick CFU.'
    ].join('\n');
    parts.push(guidance);
    parts.push(`User:\n${userText}`);
  }

  return parts.join('\n\n');
}

function normalizeCtx(ctx: any) {
  return {
    activeFile: ctx.activeFile || ctx['activeFile'],
    selection: ctx.selection || ctx['selection'],
    problems: ctx.problems || ctx['problems'],
    tests: ctx.tests || ctx['tests'],
  };
}

function getFileSkeleton(content: string): string {
  const lines = content.split('\n');
  return lines
    .filter(line => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('import ') || 
        trimmed.startsWith('export ') || 
        trimmed.includes('class ') || 
        trimmed.includes('function ') ||
        trimmed.includes('interface ') ||
        (trimmed.startsWith('public ') && trimmed.includes('('))
      );
    })
    .join('\n');
}