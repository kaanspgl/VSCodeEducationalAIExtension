import * as vscode from 'vscode';

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

type CallArgs = {
  model: string;
  prompt: string;
  system?: string;
  /** Earlier turns of the conversation (oldest first). `prompt` is the newest user turn. */
  history?: ChatMsg[];
  /** Overrides the configured temperature (e.g. 0 for judge calls). */
  temperature?: number;
  context: vscode.ExtensionContext;
};

type CallResult = {
  text: string;
  usage?: { totalTokens?: number };
  provider: 'ollama' | 'openai' | 'gemini' | 'eduai';
  /** Wall-clock time spent waiting on the model, kept separate from student time in study logs. */
  ms: number;
};

export async function checkOllamaConnection(): Promise<{ models: string[] }> {
  const res = await fetch(`${ollamaBaseUrl()}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  return {
    models: Array.isArray(data?.models)
      ? data.models.map((item: any) => String(item?.name || item?.model || '')).filter(Boolean)
      : []
  };
}

function ollamaBaseUrl(): string {
  const cfg = vscode.workspace.getConfiguration('vibelearner');
  return String(cfg.get('ollamaUrl') ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const started = Date.now();
  const res = await route(args);
  return { ...res, ms: Date.now() - started };
}

async function route(args: CallArgs): Promise<Omit<CallResult, 'ms'>> {
  const cfg = vscode.workspace.getConfiguration('vibelearner');
  const history = args.history ?? [];
  const temperature = args.temperature ?? cfg.get<number>('temperature') ?? 0.2;

  // 1. Determine Provider
  let apiProvider = String(cfg.get('apiProvider') ?? 'ollama').toLowerCase();

  // 2. Determine Model
  const model = args.model || String(cfg.get('model') ?? 'qwen3-coder:30b');

  // Auto-detection logic: If "auto", guess provider from model name
  if (apiProvider === 'auto') {
    if (model.startsWith('gemini')) apiProvider = 'gemini';
    else if (model.startsWith('eduai')) apiProvider = 'eduai';
    else apiProvider = 'ollama';
  }

  console.log(`[VibeLearner] Routing: Provider=${apiProvider}, Model=${model}`);

  // -------------------------------------------------------------
  // ROUTE 1: EduAI
  // -------------------------------------------------------------
  if (apiProvider === 'eduai') {
    const endpoint = (cfg.get<string>('eduaiEndpoint') as string) || 'https://eduai.ok.ubc.ca/api/chat';
    const apiKey = cfg.get<string>('eduaiApiKey') || '';
    if (!apiKey) throw new Error('EduAI API key missing.');

    const messages = [
      ...(args.system ? [{ role: 'user', content: `[Instructions]\n${args.system}` }] : []),
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: args.prompt },
    ];
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        messages,
        model,
        courseCode: cfg.get<string>('courseCode') || 'DEMO101',
      }),
    });
    if (!res.ok) throw new Error(`EduAI Error: ${res.status}`);
    const data: any = await res.json();
    return { text: data?.response || '', provider: 'eduai' };
  }

  // -------------------------------------------------------------
  // ROUTE 2: Gemini
  // -------------------------------------------------------------
  if (apiProvider === 'gemini') {
    const geminiApiKey =
      process.env.GEMINI_API_KEY ||
      (await args.context.secrets.get('gemini_api_key')) ||
      cfg.get<string>('gemini.apiKey') ||
      '';

    if (!geminiApiKey) throw new Error('Gemini API key missing.');

    const geminiModel = cfg.get<string>('gemini.model') || model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const body: any = {
      contents: [
        ...history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
        { role: 'user', parts: [{ text: args.prompt }] },
      ],
      generationConfig: { temperature },
    };
    if (args.system) body.systemInstruction = { role: 'system', parts: [{ text: args.system }] };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini Error (${res.status}): ${txt}`);
    }
    const json: any = await res.json();
    return {
      text: json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      provider: 'gemini',
    };
  }

  // -------------------------------------------------------------
  // ROUTE 3: Ollama (Default)
  // -------------------------------------------------------------
  const configuredEndpoint = String(cfg.get('endpoint') ?? '').trim();
  const endpoint = configuredEndpoint || `${ollamaBaseUrl()}/api/chat`;

  const messages = [
    ...(args.system ? [{ role: 'system', content: args.system }] : []),
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: args.prompt },
  ];

  const body = {
    model,
    messages,
    // Streamed: a long answer (slow machine, big file) keeps the connection alive instead of hitting
    // fetch's five-minute limit on waiting for a response.
    stream: true,
    // Ollama defaults to a 4096-token window and silently drops the start of longer prompts (our
    // instructions). Keep this fixed across calls: changing it makes Ollama reload the model.
    options: { temperature, num_ctx: cfg.get<number>('ollamaContextLength') ?? 16384 },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Ollama Error: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    const text = await readOllamaReply(res);

    return {
      text,
      usage: approxUsage(text, args.prompt),
      provider: 'ollama',
    };
  } catch (err: any) {
    throw new Error(`Ollama connection failed. Is 'ollama serve' running? Error: ${err.message}`);
  }
}

/** Collects a streamed (newline-delimited JSON) Ollama chat reply; falls back to a single JSON body. */
async function readOllamaReply(res: any): Promise<string> {
  if (!res.body?.getReader) {
    const data: any = await res.json();
    return data?.message?.content || data?.response || '';
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let text = '';
  const take = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(String(chunk.error));
    text += chunk.message?.content ?? chunk.response ?? '';
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      take(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  }
  take(buffered + decoder.decode());
  return text;
}

function approxUsage(output: string, input: string) {
  const total = Math.round((input.length + output.length) / 4);
  return { totalTokens: total };
}

// `fetch` provided by VS Code runtime
declare const fetch: any;
