# EduAI IDE Assistant


VS Code extension that integrates an AI backend with two flows:
- **EduAI: Explain Selection** → send selected code to the API; show a Markdown explanation
- **EduAI: Open Chat** → webview chat with optional selection injection


## Configure
Open Settings (JSON) and set:
```jsonc
{
"eduai.endpoint": "https://api.openai.com/v1/chat/completions",
"eduai.apiKey": "sk-…",
"eduai.model": "gpt-4o-mini",
"eduai.includeSelectionByDefault": true
}