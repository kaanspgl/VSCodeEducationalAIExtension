import * as vscode from 'vscode';
return;
}
const code = editor.document.getText(editor.selection);
const explanation = await callAI(
'Explain the following code to a student and suggest improvements.\n\n' + code
);
if (explanation) {
const doc = await vscode.workspace.openTextDocument({ content: explanation, language: 'markdown' });
vscode.window.showTextDocument(doc, { preview: true });
}
})
);
}


export function deactivate() {}


async function callAI(prompt: string): Promise<string | null> {
const cfg = vscode.workspace.getConfiguration('eduai');
const endpoint = cfg.get<string>('endpoint') || '';
const apiKey = cfg.get<string>('apiKey') || '';
const model = cfg.get<string>('model') || 'gpt-4o-mini';


if (!endpoint) {
vscode.window.showErrorMessage('EduAI endpoint is not set (eduai.endpoint).');
return null;
}
if (!apiKey) {
vscode.window.showErrorMessage('EduAI API key is not set (eduai.apiKey).');
return null;
}


try {
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
throw new Error(`HTTP ${res?.status}: ${text}`);
}


const data: any = await res.json();
const content = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
return content;
} catch (err: any) {
vscode.window.showErrorMessage(`EduAI request failed: ${err.message}`);
return null;
}
}