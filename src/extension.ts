import * as vscode from 'vscode';
import { ChatPanel } from './panels/ChatPanel';
import { callBackend } from './shared/callBackend';

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.showChat', () =>
      ChatPanel.createOrShow(context.extensionUri)
    )
  );

  // Learning-first chat backend (Ollama)
  context.subscriptions.push(
    vscode.commands.registerCommand('eduai.backend.chat', async (payload: any) => {
      const text = payload?.text ?? payload;
      const meta = payload?.meta ?? {};
      const model =
        (vscode.workspace.getConfiguration('eduai').get('model') as string) ||
        'qwen3-coder:30b';

      const assist: 'Socratic' | 'Hinted' | 'Show-and-Tell' | 'Direct' =
        meta.assist || 'Socratic';
      const objectives: string[] = Array.isArray(meta.objectives)
        ? meta.objectives.slice(0, 6)
        : [];
      const mode:
        | 'chat'
        | 'explain'
        | 'quiz'
        | 'quiz-eval'
        | 'review'
        | 'hints'
        | 'plan'
        | 'reflect' = meta.mode || 'chat';

      const system = buildSystemPrompt(assist, mode);
      const finalPrompt = buildLearningPrompt({
        userText: text,
        assist,
        objectives,
        mode,
        contextData: meta.context || {},
      });

      try {
        const res = await callBackend({
          model,
          prompt: finalPrompt,
          system,
          // Optional: uncomment if your callBackend supports these
          // temperature: 0.3,
          // stream: false,
        });
        const clean = (res.text || '')
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .trim();
        return {
          text: clean,
          usage: res.usage,
          meta: { model, provider: 'ollama', assist, mode },
        };
      } catch (err: any) {
        throw new Error(`Chat failed: ${err?.message || err}`);
      }
    })
  );

  // Context providers
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'eduai.backend.getContext',
      async ({ scope }) => {
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
      }
    )
  );

  // Insert code
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'eduai.backend.insertCode',
      async ({ code, where }) => {
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
      }
    )
  );

  // Save / export
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'eduai.backend.saveThread',
      async ({ title, messages }) => {
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
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'eduai.backend.exportThread',
      async ({ format, messages }) => {
        const md =
          format === 'md'
            ? messages
                .map(
                  (m: any) =>
                    `**${m.role === 'assistant' ? 'Assistant' : 'You'}**\n\n${m.text}\n`
                )
                .join('\n')
            : JSON.stringify(messages, null, 2);
        const mime = format === 'md' ? 'text/markdown' : 'application/json';
        const base64 = toBase64(md);
        return `data:${mime};base64=${base64}`;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'eduai.backend.feedback',
      async ({ messageId, value }) => {
        console.log('feedback', messageId, value);
      }
    )
  );
}

export function deactivate() {}

function buildSystemPrompt(assist: string, mode: string) {
  const base = [
    'You are a course-aware coding tutor focused on learning, not code dumping.',
    'Always tie help to objectives. Prefer Socratic questions first.',
    'Use a 3-step scaffold: (1) Nudge question, (2) Strategy, (3) Minimal example. Only show later steps if user asks or assistance policy allows.',
    'Offer tiny check-for-understanding (2 short questions) and a 1–2 sentence reflection prompt.',
  ];
  if (assist === 'Socratic')
    base.push('Do NOT provide complete solutions unless explicitly requested.');

  // Mode-specific instructions for interactive quizzes
  if (mode === 'quiz') {
    base.push(
      [
        'Return ONLY a compact JSON object for a 3-question multiple-choice quiz:',
        '{ "type":"quiz", "version":1, "title": "string",',
        '  "questions":[ { "id":"q1", "stem":"string",',
        '    "choices":[ {"id":"A","text":"..."}, {"id":"B","text":"..."}, {"id":"C","text":"..."}, {"id":"D","text":"..."} ] }',
        '  ] }',
        'Do NOT include correct answers in this JSON.',
        'Focus stems/choices on the specific code/selection/context if provided.',
      ].join(' ')
    );
  }
  if (mode === 'quiz-eval') {
    base.push(
      [
        'You will receive: the quiz JSON, the selected question id, and the chosen choice id.',
        'Respond ONLY with JSON: { "type":"quiz-eval", "qId":"...", "choiceId":"...", "correct":true|false, "correctChoiceId":"A|B|C|D", "feedback":"short explanation" }',
        'Keep feedback under 2 sentences.',
      ].join(' ')
    );
  }

  return base.join(' ');
}

function buildLearningPrompt({
  userText,
  assist,
  objectives,
  mode,
  contextData,
}: {
  userText: string;
  assist: string;
  objectives: string[];
  mode: string;
  contextData: any;
}) {
  const parts: string[] = [];
  const ctx = normalizeCtx(contextData);
  const header = `Mode:${mode}; Assist:${assist}; Objectives:${
    objectives.join(' | ') || 'N/A'
  }`;
  parts.push(header);
  if (ctx.activeFile?.content)
    parts.push(`Active File (truncated):\n${ctx.activeFile.content.slice(0, 6000)}`);
  if (ctx.selection?.content)
    parts.push(`Selection:\n${ctx.selection.content.slice(0, 6000)}`);
  if (ctx.problems?.items?.length)
    parts.push(`Problems (top): ${JSON.stringify(ctx.problems.items.slice(0, 10))}`);
  if (ctx.tests) parts.push(`Tests: ${JSON.stringify(ctx.tests)}`);

  // Quiz/eval need clean task envelopes to keep outputs strictly JSON
  if (mode === 'quiz') {
    parts.push('Create a beginner-friendly, concept-focused, 3-question multiple-choice quiz.');
    parts.push('OUTPUT: JSON only (as specified). No preamble or prose.');
    parts.push(`User:\n${userText || 'Generate quiz for my current selection/context.'}`);
  } else if (mode === 'quiz-eval') {
    parts.push('Evaluate the selected choice.');
    parts.push('OUTPUT: JSON only (as specified). No preamble or prose.');
    parts.push(`User:\n${userText}`);
  } else {
    const taskEnvelope = [
      'When responding:',
      '- Start with a one-line goal restatement tied to the objectives.',
      '- If mode=hints or Assist=Socratic: return only Nudge (a question prompting next step).',
      '- If the user clicks “Show strategy”, include Strategy (general approach) and ask a short CFU question.',
      '- If allowed, include a Minimal Example (few lines) and one What-If counterfactual.',
      '- End with a 1-sentence Reflection prompt.',
    ].join('\n');

    parts.push(taskEnvelope);
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

declare const Buffer: any;
function toBase64(s: string) {
  if (typeof Buffer !== 'undefined')
    return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // @ts-ignore
  return btoa(binary);
}
