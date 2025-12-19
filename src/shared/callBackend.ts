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
  provider: 'ollama' | 'openai' | 'gemini' | 'vibelearner';
};

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration('vibelearner');

  // Default to Gemini unless user explicitly selects otherwise.
  const apiProvider = String(cfg.get('apiProvider') ?? 'gemini').toLowerCase();

  // Prefer an explicit model, else vibelearner.model, else vibelearner.gemini.model, else Gemini default.
  const model =
    args.model ||
    String(
      cfg.get('model') ??
        cfg.get('gemini.model') ??
        cfg.get('defaultModel') ??
        'gemini-2.0-flash'
    );

  // -------------------------------------------------------------
  // 1) VibeLearner Backend (course-aware RAG via VibeLearner Core Learning)
  // -------------------------------------------------------------
  const shouldUseVibeLearner =
    apiProvider === 'vibelearner' ||
    (apiProvider === 'auto' && model.toLowerCase().startsWith('vibelearner'));

  if (shouldUseVibeLearner) {
    const endpoint =
      (cfg.get<string>('vibelearnerEndpoint') as string) ||
      (cfg.get<string>('endpoint') as string) ||
      'https://vibelearner.ok.ubc.ca/api/chat';

    const apiKey =
      (cfg.get<string>('vibelearnerApiKey') as string) ||
      (cfg.get<string>('openaiApiKey') as string) ||
      '';

    const courseCode =
      (cfg.get<string>('courseCode') as string) || 'DEMO101';

    if (!endpoint) {
      throw new Error(
        "VibeLearner endpoint missing. Set 'vibelearner.vibelearnerEndpoint' in Settings."
      );
    }

    if (!apiKey) {
      throw new Error(
        "VibeLearner API key missing. Set 'vibelearner.vibelearnerApiKey' in Settings."
      );
    }

    const body: any = {
      messages: [
        args.system ? { role: 'system', content: args.system } : undefined,
        { role: 'user', content: args.prompt },
      ].filter(Boolean),
      model,
      apiKeys: {
        vibelearner: {
          isEnabled: true,
          apiKey,
        },
      },
      courseCode,
      streaming: false,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`VibeLearner ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const text: string =
      data?.response ||
      data?.text ||
      data?.message ||
      data?.choices?.[0]?.message?.content ||
      '';

    return {
      text,
      usage: approxUsage(text, args.prompt),
      provider: 'vibelearner',
    };
  }

  // -------------------------------------------------------------
  // 2) Gemini (Google Generative Language)
  // -------------------------------------------------------------
  const shouldUseGemini =
    apiProvider === 'gemini' ||
    (apiProvider === 'auto' && model.toLowerCase().startsWith('gemini'));

  if (shouldUseGemini) {
    const geminiApiKey =
      (cfg.get<string>('gemini.apiKey') ??
        cfg.get<string>('vibelearner.gemini.apiKey') ??
        '') ||
      process.env.GEMINI_API_KEY ||
      '';

    const geminiModel =
      model || (cfg.get<string>('gemini.model') ?? 'gemini-2.0-flash');

    if (!geminiApiKey) {
      throw new Error(
        "Gemini API key missing. Set 'vibelearner.gemini.apiKey' in Settings or GEMINI_API_KEY in env."
      );
    }

    const text = await callGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      userText: args.prompt,
      systemText: args.system,
      temperature: cfg.get<number>('temperature') ?? 0.2,
    });

    return {
      text,
      usage: approxUsage(text, args.prompt),
      provider: 'gemini',
    };
  }

  // -------------------------------------------------------------
  // 3) Fallback: OpenAI / Ollama compatible endpoint (backwards compat)
  // -------------------------------------------------------------
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
        prompt:
          (args.system ? `System: ${args.system}\n\n` : '') +
          `User: ${args.prompt}`,
        stream: false,
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  const text: string = isChat
    ? data?.message?.content || data?.choices?.[0]?.message?.content || ''
    : data?.response || '';

  return {
    text,
    usage: approxUsage(text, args.prompt),
    provider: 'ollama',
  };
}

function approxUsage(output: string, input: string) {
  const total = Math.round((input.length + output.length) / 4);
  return { totalTokens: total };
}

// --- Gemini REST call (simple v1beta generateContent) ---
async function callGemini(params: {
  apiKey: string;
  model: string;
  userText: string;
  systemText?: string;
  temperature?: number;
}): Promise<string> {
  const { apiKey, model, userText, systemText, temperature = 0.2 } = params;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature },
  };

  if (systemText) {
    body.systemInstruction = {
      role: 'system',
      parts: [{ text: systemText }],
    };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(
      `Gemini ${resp.status} ${resp.statusText}: ${errText || 'request failed'}`
    );
  }

  const json: any = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('') ?? '';

  return text;
}

// `fetch` is provided by VS Code web runtime in Node >=18; declare for TS.
declare const fetch: any;
