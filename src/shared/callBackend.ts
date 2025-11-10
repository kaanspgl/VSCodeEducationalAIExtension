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
  provider: 'ollama';
};

export async function callBackend(args: CallArgs): Promise<CallResult> {
  const endpoint =
    (vscode.workspace.getConfiguration('eduai').get('endpoint') as string) ||
    'http://127.0.0.1:11434/api/generate';

  const isChat = /\/api\/chat(?:\/?$)/.test(endpoint);

  const body = isChat
    ? {
        model: args.model,
        messages: [
          args.system ? { role: 'system', content: args.system } : undefined,
          { role: 'user', content: args.prompt },
        ].filter(Boolean),
        stream: false,
      }
    : {
        model: args.model,
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

// `fetch` is provided by VS Code web runtime in Node >=18; declare for TS.
declare const fetch: any;
