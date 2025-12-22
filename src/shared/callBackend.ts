import * as vscode from 'vscode';

type CallArgs = {
  model: string;
  prompt: string;
  system?: string;
  context: vscode.ExtensionContext;
};

type CallResult = {
  text: string;
  usage?: { totalTokens?: number };
  provider: 'ollama' | 'openai' | 'gemini' | 'eduai';
};

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration('vibelearner');

  // 1. Determine Provider
  // Priority: Args -> Config -> Default (ollama)
  let apiProvider = String(cfg.get('apiProvider') ?? 'ollama').toLowerCase();
  
  // 2. Determine Model
  const model = args.model || String(cfg.get('model') ?? 'qwen3-coder:30b');

  // Auto-detection logic: If "auto", guess provider from model name
  if (apiProvider === 'auto') {
    if (model.startsWith('gemini')) apiProvider = 'gemini';
    else if (model.startsWith('eduai')) apiProvider = 'eduai';
    else apiProvider = 'ollama'; // Default to ollama for qwen, llama, etc.
  }

  console.log(`[VibeLearner] Routing: Provider=${apiProvider}, Model=${model}`);

  // -------------------------------------------------------------
  // ROUTE 1: EduAI
  // -------------------------------------------------------------
  if (apiProvider === 'eduai') {
    const endpoint = (cfg.get<string>('eduaiEndpoint') as string) || 'https://eduai.ok.ubc.ca/api/chat';
    const apiKey = cfg.get<string>('eduaiApiKey') || '';
    if (!apiKey) throw new Error("EduAI API key missing.");

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        messages: [{ role: 'user', content: args.prompt }],
        model,
        courseCode: 'DEMO101'
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
      (cfg.get<string>('gemini.apiKey')) || '';

    if (!geminiApiKey) throw new Error("Gemini API key missing.");
    
    // Using v1beta for modern models
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: any = {
        contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
        generationConfig: { temperature: 0.2 }
    };
    if(args.system) body.systemInstruction = { role: 'system', parts: [{ text: args.system }] };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
        body: JSON.stringify(body)
    });
    
    if(!res.ok) {
        const txt = await res.text();
        throw new Error(`Gemini Error (${res.status}): ${txt}`);
    }
    const json: any = await res.json();
    return { 
        text: json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        provider: 'gemini'
    };
  }

  // -------------------------------------------------------------
  // ROUTE 3: Ollama (Default)
  // -------------------------------------------------------------
  // Standard Ollama endpoint
  const endpoint = (cfg.get('endpoint') as string) || 'http://127.0.0.1:11434/api/chat';
  
  const body = {
    model,
    messages: [
      args.system ? { role: 'system', content: args.system } : undefined,
      { role: 'user', content: args.prompt },
    ].filter(Boolean),
    stream: false,
    options: {
        temperature: cfg.get<number>('temperature') ?? 0.2
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Ollama Error: ${res.status} ${res.statusText}`);

    const data: any = await res.json();
    const text = data?.message?.content || data?.response || '';

    return {
      text,
      usage: approxUsage(text, args.prompt),
      provider: 'ollama',
    };
  } catch (err: any) {
    throw new Error(`Ollama connection failed. Is 'ollama serve' running? Error: ${err.message}`);
  }
}

function approxUsage(output: string, input: string) {
  const total = Math.round((input.length + output.length) / 4);
  return { totalTokens: total };
}

// `fetch` provided by VS Code runtime
declare const fetch: any;