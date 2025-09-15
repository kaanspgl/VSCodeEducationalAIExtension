import * as vscode from 'vscode';

type CallResult = { ok: true; content: string } | { ok: false; message: string };

export async function callBackend(prompt: string): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration('eduai');
  const provider = (cfg.get<string>('provider') || 'ollama').toLowerCase();
  const endpoint = cfg.get<string>('endpoint') || '';
  const apiKey = cfg.get<string>('apiKey') || '';
  const model =
    cfg.get<string>('model') ||
    (provider === 'ollama' ? 'llama3.1' : 'gpt-4o-mini');

  try {
    if (provider === 'ollama') {
      const base = endpoint || 'http://localhost:11434/api/chat';
      const res = await (globalThis as any).fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      } as any);

      if (!res?.ok) {
        const text = await res.text?.();
        return { ok: false, message: `Ollama HTTP ${res?.status}: ${text}` };
      }
      const data: any = await res.json();
      const content = data?.message?.content ?? JSON.stringify(data);
      return { ok: true, content };
    }

    // OpenAI-compatible path
    if (!endpoint) {
      return { ok: false, message: 'EduAI endpoint is not set (eduai.endpoint).' };
    }
    if (!apiKey) {
      return { ok: false, message: 'EduAI API key is not set (eduai.apiKey).' };
    }

    const res = await (globalThis as any).fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant inside VS Code.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    } as any);

    if (!res?.ok) {
      const text = await res.text?.();
      return { ok: false, message: `OpenAI HTTP ${res?.status}: ${text}` };
    }
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return { ok: true, content };
  } catch (err: any) {
    return { ok: false, message: String(err?.message || err) };
  }
}
