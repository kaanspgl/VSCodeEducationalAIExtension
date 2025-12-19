import * as vscode from 'vscode';

type CallArgs = {
  model: string;
  prompt: string;
  system?: string;
};

type CallResult = {
  text: string;
  usage?: { totalTokens?: number };
  provider: 'ollama' | 'openai' | 'gemini' | 'eduai';
};

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration('eduai');

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
  // 1) EduAI Backend (course-aware RAG via VibeLearner Core Learning)
  // -------------------------------------------------------------
  const shouldUseEduAI =
    apiProvider === 'eduai' ||
    (apiProvider === 'auto' && model.toLowerCase().startsWith('eduai'));

  if (shouldUseEduAI) {
    const endpoint =
      (cfg.get<string>('eduaiEndpoint') as string) ||
      (cfg.get<string>('endpoint') as string) ||
      'https://eduai.ok.ubc.ca/api/chat';

    const apiKey =
      (cfg.get<string>('eduaiApiKey') as string) ||
      (cfg.get<string>('openaiApiKey') as string) ||
      '';

    const courseCode =
      (cfg.get<string>('courseCode') as string) || 'DEMO101';

    if (!endpoint) {
      throw new Error(
        "EduAI endpoint missing. Set 'eduai.eduaiEndpoint' in Settings."
      );
    }

    if (!apiKey) {
      throw new Error(
        "EduAI API key missing. Set 'vibelearner.eduaiApiKey' in Settings."
      );
    }

    const body: any = {
      messages: [
        args.system ? { role: 'system', content: args.system } : undefined,
        { role: 'user', content: args.prompt },
      ].filter(Boolean),
      model,
      apiKeys: {
        eduai: {
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
      throw new Error(`EduAI ${res.status} ${res.statusText}`);
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
      provider: 'eduai',
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
      process.env.GEMINI_API_KEY || // Priority 1: Environment variable
      cfg.get<string>('gemini.apiKey') || // Priority 2: Extension specific setting
      cfg.get<string>('eduai.gemini.apiKey') || // Priority 3: Legacy setting
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

async function callGemini(params: {
  apiKey: string;
  model: string;
  userText: string;
  systemText?: string;
  temperature?: number;
}): Promise<string> {
  const { apiKey, model, userText, systemText, temperature = 0.2 } = params;

  // 1. Try v1beta first (supports the dedicated systemInstruction field)
  const v1betaUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  
  const v1betaBody: any = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature },
  };

  if (systemText) {
    v1betaBody.systemInstruction = {
      role: 'system',
      parts: [{ text: systemText }],
    };
  }

  try {
    const resp = await fetch(v1betaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(v1betaBody),
    });

    if (resp.ok) {
      const json: any = await resp.json();
      return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    // 2. Fallback to v1 ONLY if v1beta fails
    const v1Url = v1betaUrl.replace('v1beta', 'v1');
    const v1Body = {
      contents: [{ 
        role: 'user', 
        parts: [{ text: systemText ? `${systemText}\n\n${userText}` : userText }] 
      }],
      generationConfig: { temperature },
      // Note: No systemInstruction field exists in this object
    };

    const v1Resp = await fetch(v1Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(v1Body),
    });

    if (v1Resp.ok) {
      const v1Json: any = await v1Resp.json();
      return v1Json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    
    const errText = await v1Resp.text();
    throw new Error(`Gemini Fallback Error: ${v1Resp.status} ${errText}`);
  } catch (err: any) {
    throw new Error(`Chat failed: ${err.message}`);
  }
}

// `fetch` is provided by VS Code web runtime in Node >=18; declare for TS.
declare const fetch: any;
