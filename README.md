# VibeLearner: Educational AI-Assisted Vibe Coding

VibeLearner is a Visual Studio Code (VS Code) extension designed to transform AI-assisted programming from a passive act of code generation into an active learning process. Unlike standard assistants that prioritize speed, VibeLearner serves as an interactive tutor, using pedagogical guardrails to ensure students develop problem-solving skills rather than relying on AI as an intellectual crutch.

## Key Features

### Pedagogical Interaction Modes
VibeLearner utilizes a Role Task Requirements Instructions (RTRI) framework to enforce educational behaviors:
* **Socratic Mode**: Strictly forbids providing full solution code. It uses targeted, open-ended questions to lead the user toward self-discovery and conceptual realization.
* **Hinted Mode**: Provides 2–3 actionable hints to bridge the gap between total confusion and passive copying.
* **Show-and-Tell Mode**: Prioritizes conceptual understanding by walking through step-by-step micro-examples instead of just production-ready code.

### Metacognitive Scaffolding
* **The Confidence Check**: Before explaining complex file structures, the system interrupts the generation flow and prompts the user to guess the file's purpose based on its imports.
* **Post-Fix Reflection Loop**: A background Diagnostic Listener monitors IDE errors in real-time. When a bug is fixed (errors drop to zero), the system triggers a "Nice fix!" notification and a follow-up quiz to verify the student understands why the fix worked.

## System Architecture

VibeLearner is built on a hybrid client-server architecture designed for both performance and privacy:
* **Frontend (Webview UI)**: A React-based chat interface rendered within a secure VS Code Webview, communicating via a message-passing protocol (`postMessage`).
* **Backend (Extension Host)**: A Node.js environment handling file system access, project state, and API orchestration.
* **Provider Agnostic Abstraction Layer**: Located in `callBackend.ts`, this module routes requests to local LLMs (Ollama/Qwen) for privacy or cloud providers (Google Gemini) for high-complexity reasoning.
* **Context Management**: Implements a Retrieval-Augmented Generation (RAG) pipeline that programmatically retrieves the active document state and user selections to ensure localized, accurate feedback.

## Evaluation and Performance

The system has been validated through synthetic trials comparing it against raw LLM outputs and standard industry tools like GitHub Copilot:
* **Socratic Consistency**: Successfully resisted "solution leakage" in 92% of trials, even when pressured by novice personas for direct answers.
* **Knowledge Transfer**: The reflection loop accurately detected 100% of bug resolutions, effectively pivoting the user from execution to reflective analysis.
* **Persona Adaptation**: Tailors feedback for both **Novice** actors (handling "learned helplessness") and **Intermediate** actors (supporting metacognitive engagement).

## Security

VibeLearner integrates with the **VS Code SecretStorage API**. All API keys are encrypted using the operating system's native keychain (e.g., Windows Credential Manager or macOS Keychain), ensuring sensitive student data and credentials are never stored in plaintext configuration files.