// src/shared/callBackend.ts
import * as vscode from 'vscode';

type CallArgs = {
  model: string;
  prompt: string;
  system?: string;
};

type CallResult = {
  text: string;
  usage?: { totalTokens?: number };
  provider: 'ollama' | 'openai' | 'gemini';
};

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration('eduai');

  // Force Gemini as default if not explicitly set
  const apiProvider = String(cfg.get('apiProvider') ?? 'gemini').toLowerCase();

  // Prefer an explicit model, else eduai.model, else eduai.gemini.model, else Gemini default
  const model =
    args.model ||
    String(cfg.get('model') ?? cfg.get('gemini.model') ?? 'gemini-2.0-flash');

  const shouldUseGemini =
    apiProvider === 'gemini' ||
    (apiProvider === 'auto' && model.toLowerCase().startsWith('gemini'));

  if (shouldUseGemini) {
    const geminiApiKey =
      (cfg.get<string>('gemini.apiKey') ?? cfg.get<string>('eduai.gemini.apiKey') ?? '') ||
      process.env.GEMINI_API_KEY ||
      '';

    const geminiModel =
      model || (cfg.get<string>('gemini.model') ?? 'gemini-2.0-flash');

    if (!geminiApiKey) {
      throw new Error(
        "Gemini API key missing. Set 'eduai.gemini.apiKey' in Settings or GEMINI_API_KEY in env."
      );
    }

    const text = await callGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      userText: args.prompt,
      systemText: args.system,
      temperature: cfg.get<number>('temperature') ?? 0.2,
    });

    return { text, usage: approxUsage(text, args.prompt), provider: 'gemini' };
  }

  // --- Fallback path: OpenAI/Ollama-compatible endpoint (kept for backwards compat) ---
  const endpoint =
    (cfg.get('endpoint') as string) ||
    'http://127.0.0.1:11434/api/generate';

  const isChat = /\/api\/chat(?:\/?$)/.test(endpoint);

  const body = isChat
    ? {
        model,
        messages: [
          args.system ? { role: 'system', content: args.system } : undefined,
          { role: 'user', content: args.prompt },
        ].filter(Boolean),
        stream: false,
      }
    : {
        model,
        prompt: (args.system ? `System: ${args.system}\n\n` : '') + `User: ${args.prompt}`,
        stream: false,
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const data: any = await res.json();
  const text = isChat ? data?.message?.content || '' : data?.response || '';
  return { text, usage: approxUsage(text, args.prompt), provider: 'ollama' };
}

function approxUsage(output: string, input: string) {
  const total = Math.round((input.length + output.length) / 4);
  return { totalTokens: total };
}

// --- Gemini REST call with smart fallbacks (supports 2.0 + 1.5; v1beta & v1) ---
async function callGemini(params: {
  apiKey: string;
  model: string;
  userText: string;
  systemText?: string;
  temperature?: number;
}): Promise<string> {
  const { apiKey, model, userText, systemText, temperature = 0.2 } = params;

  // Pick a family based on input; try safe aliases
  const base = (model || '').trim().toLowerCase();

  const families: Record<string, string[]> = {
    'gemini-2.0-flash': [
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-lite'
    ],
    'gemini-1.5-pro': [
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro-002'
    ],
    'gemini-1.5-flash': [
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-002'
    ]
  };

  let familyKey: keyof typeof families = 'gemini-1.5-flash';
  if (base.startsWith('gemini-2.0-flash')) familyKey = 'gemini-2.0-flash';
  else if (base.startsWith('gemini-1.5-pro')) familyKey = 'gemini-1.5-pro';
  else if (base.startsWith('gemini-1.5-flash')) familyKey = 'gemini-1.5-flash';

  const modelsToTry = Array.from(new Set([model, ...(families[familyKey] || [])]))
    .filter(Boolean) as string[];

  const apiVersions = ['v1beta', 'v1']; // try both

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: params.userText }] }],
    generationConfig: { temperature }
  };
  if (systemText) body.systemInstruction = { role: 'system', parts: [{ text: systemText }] };

  let lastError = '';
  for (const ver of apiVersions) {
    for (const m of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(m)}:generateContent`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body)
      });

      if (resp.ok) {
        const json: any = await resp.json();
        const text =
          json?.candidates?.[0]?.content?.parts
            ?.map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join('') ?? '';
        return text;
      }

      const errText = await resp.text();
      lastError = `Gemini ${resp.status} ${resp.statusText} (${ver}, ${m}): ${errText}`;
      // keep trying next alias/version
    }
  }
  throw new Error(lastError || 'Gemini request failed.');
}



// `fetch` is provided by VS Code web runtime in Node >=18; declare for TS.
declare const fetch: any;
