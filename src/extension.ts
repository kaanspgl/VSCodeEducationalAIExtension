// src/extension.ts
import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { callBackend } from './shared/callBackend';

export async function activate(context: vscode.ExtensionContext) {
  // Show the chat panel
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.showChat', () => {
      ChatPanel.createOrShow(context.extensionUri);
    })
  );

  // Open chat (no selection required)
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.openChat', () => {
      ChatPanel.createOrShow(context.extensionUri);
    })
  );

  // Ask about current selection: opens panel, injects selection, presets prompt
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.askSelection', async () => {
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

      // Open the chat panel
      ChatPanel.createOrShow(context.extensionUri);

      // Give it a moment to load before sending message
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
    vscode.commands.registerCommand('eduai.askFile', async (resourceUri?: vscode.Uri) => {
      try {
        const uri = resourceUri ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          vscode.window.showInformationMessage('No file selected.');
          return;
        }

        // Use TextDocument to get languageId reliably
        const doc = await vscode.workspace.openTextDocument(uri);
        const language = doc.languageId;
        const filename = uri.toString();
        const content = doc.getText().slice(0, 20000); // cap to keep it snappy

        ChatPanel.createOrShow(context.extensionUri);

        // Reuse the same message shape the webview understands
        ChatPanel.postToWebview({
          type: 'activeContext',
          payload: { language, filename, selection: content }
        });

        ChatPanel.postToWebview({
          type: 'presetPrompt',
          payload: {
            text: 'Give me a high-level explanation of this file, then suggest 2 improvements. Include one quick check-for-understanding.',
            autoSend: false
          }
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`EduAI: Failed to load file — ${err?.message || err}`);
      }
    })
  );

  // === Backend: learning-first chat ===
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.chat', async (payload: any) => {
      const text = payload?.text ?? payload;
      const meta = payload?.meta ?? {};
      const cfg = vscode.workspace.getConfiguration('eduai');

      const model =
        cfg.get<string>('model') ||
        cfg.get<string>('gemini.model') ||
        'gemini-2.0-pro';

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

  // Context providers used by the webview
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.getContext', async ({ scope }) => {
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
    vscode.commands.registerCommand('eduai.backend.insertCode', async ({ code, where }) => {
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

  // Save / export threads
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.saveThread', async ({ title, messages }) => {
      const name = (title?.trim() || 'eduai-thread') + '.json';
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(name),
        filters: { JSON: ['json'] },
      });
      if (!uri) return;
      const json = JSON.stringify({ title, messages }, null, 2);
      const bytes = new TextEncoder().encode(json);
      await vscode.workspace.fs.writeFile(uri, bytes);
      vscode.window.showInformationMessage('Thread saved.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.exportThread', async ({ format, messages }) => {
      const md =
        format === 'md'
          ? messages
              .map((m: any) => `**${m.role === 'assistant' ? 'Assistant' : 'You'}**\n\n${m.text}\n`)
              .join('\n')
          : JSON.stringify(messages, null, 2);
      const mime = format === 'md' ? 'text/markdown' : 'application/json';
      const base64 = toBase64(md);
      return `data:${mime};base64=${base64}`;
    })
  );

  // Feedback hook (placeholder)
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.feedback', async ({ messageId, value }) => {
      console.log('feedback', messageId, value);
    })
  );

  // === Quick Action commands -> tell the webview to activate that action ===
  const quick = (action: string) => {
    ChatPanel.createOrShow(context.extensionUri);
    setTimeout(() => {
      ChatPanel.postToWebview({ type: 'quickAction', payload: { action } });
    }, 100);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.quick.explain', () => quick('explain')),
    vscode.commands.registerCommand('eduai.quick.review',  () => quick('review')),
    vscode.commands.registerCommand('eduai.quick.plan',    () => quick('plan')),
    vscode.commands.registerCommand('eduai.quick.hints',   () => quick('hints')),
    vscode.commands.registerCommand('eduai.quick.reflect', () => quick('reflect')),
    vscode.commands.registerCommand('eduai.quick.quiz',    () => quick('quiz')),
  );
}

export function deactivate() {}

/* -------------------- PROMPTS -------------------- */
// IMPORTANT: If mode is quiz/quiz-eval, we IGNORE assistive scaffolding (JSON only).
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

  // Teaching modes (friendly, cohesive, low-clutter responses)
  const base = [
    'You are a course-aware coding tutor.',
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

  // include recent chat if present
  if (history?.length) {
    const lines = history
      .slice(0, 8)
      .map(h => `${h.role === 'assistant' ? 'Tutor' : 'User'}: ${String(h.text).slice(0, 800)}`)
      .join('\n');
    parts.push(`Recent Chat (most recent first, truncated):\n${lines}`);
  }

  if (ctx.activeFile?.content) parts.push(`Active File (truncated):\n${ctx.activeFile.content.slice(0, 6000)}`);
  if (ctx.selection?.content) parts.push(`Selection:\n${ctx.selection.content.slice(0, 6000)}`);
  if (ctx.problems?.items?.length) parts.push(`Problems (top): ${JSON.stringify(ctx.problems.items.slice(0, 10))}`);
  if (ctx.tests) parts.push(`Tests: ${JSON.stringify(ctx.tests)}`);

  if (mode === 'quiz') {
    parts.push(
      'Create a 3-question multiple-choice quiz that is SPECIFIC to the most recent discussion and attached code/context.',
      'Prefer questions about the last user difficulty, misstatements, or the code shown.',
      'Use concrete stems that reference variable names or behavior from the recent messages/selection.',
      'OUTPUT: JSON only (as specified). No answers embedded.'
    );
    parts.push(`User:\n${userText || 'Generate quiz for what we just discussed.'}`);
  } else if (mode === 'quiz-eval') {
    parts.push('Evaluate the selected choice. OUTPUT: JSON only (as specified).');
    parts.push(`User:\n${userText}`);
  } else {
    const guidance = [
      'Write a cohesive tutoring reply (no headings).',
      '- If the user gave a statement/answer: first say right or wrong, then explain why in 1–3 sentences; only then optionally ask ONE follow-up.',
      '- For questions: begin with one focused guiding question, then explain the strategy simply.',
      '- Tiny runnable example only if helpful.',
      '- Ask one quick CFU; end with a short reflection when appropriate.'
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

function toBase64(s: string) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // @ts-ignore
  return btoa(binary);
}
