// src/shared/callBackend.ts
import * as vscode from "vscode";

type CallArgs = {
  model: string;   // used as a hint; we override from settings where needed
  prompt: string;
  system?: string;
};

type CallResult = {
  text: string;
  usage?: { totalTokens?: number };
  provider: "vibelearner" | "gemini";
};

/**
 * Single entry point for all LLM calls.
 *
 * Mode is controlled by `vibelearner.backendMode`:
 *   - "direct"      → call Gemini API directly
 *   - "vibelearner" → call the VibeLearner (EduAI) backend /api/chat
 */
export async function callBackend(args: CallArgs): Promise<CallResult> {
  const cfg = vscode.workspace.getConfiguration("vibelearner");
  const mode = (cfg.get<string>("backendMode") ?? "direct").toLowerCase();

  if (mode === "vibelearner") {
    return callVibeLearnerBackend(args, cfg);
  }

  // Default: direct Gemini
  return callGeminiDirect(args, cfg);
}

/* -------------------------------------------------------------------------- */
/*                             VibeLearner backend                             */
/* -------------------------------------------------------------------------- */

async function callVibeLearnerBackend(
  args: CallArgs,
  cfg: vscode.WorkspaceConfiguration
): Promise<CallResult> {
  const endpoint =
    (cfg.get<string>("apiUrl") ?? "").trim() ||
    "https://vibelearner.example.edu/api/chat"; // change to your real URL

  const apiKey = (cfg.get<string>("apiKey") ?? "").trim();
  const courseCode = (cfg.get<string>("courseCode") ?? "").trim();
  const modelFromConfig = (cfg.get<string>("model") ?? "").trim();

  const model = modelFromConfig || args.model || "google:gemini-2.5-flash";

  if (!endpoint) {
    throw new Error(
      "VibeLearner backend endpoint is missing. Set 'vibelearner.apiUrl' in Settings."
    );
  }

  if (!apiKey) {
    throw new Error(
      "VibeLearner backend API key is missing. Set 'vibelearner.apiKey' in Settings."
    );
  }

  const messages: any[] = [];
  if (args.system) {
    messages.push({ role: "system", content: args.system });
  }
  messages.push({ role: "user", content: args.prompt });

  const body: any = {
    messages,
    model,
    courseCode: courseCode || undefined,
    streaming: false,
    // The EduAI/VibeLearner server decides which local models/providers to use.
    apiKeys: {}
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let extra = "";
    try {
      extra = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `VibeLearner backend error ${res.status} ${res.statusText}` +
        (extra ? ` — ${extra}` : "")
    );
  }

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  const text =
    data.answer ??
    data.content ??
    data.message?.content ??
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    "";

  const textString = String(text || "");

  return {
    text: textString,
    usage: approxUsage(textString, args.prompt),
    provider: "vibelearner",
  };
}

/* -------------------------------------------------------------------------- */
/*                         Direct Gemini (default mode)                        */
/* -------------------------------------------------------------------------- */

async function callGeminiDirect(
  args: CallArgs,
  cfg: vscode.WorkspaceConfiguration
): Promise<CallResult> {
  const apiKey = (cfg.get<string>("geminiApiKey") ?? "").trim();
  const modelFromConfig = (cfg.get<string>("geminiModel") ?? "").trim();

  const model = modelFromConfig || args.model || "gemini-2.0-flash";

  if (!apiKey) {
    throw new Error(
      "Gemini API key is missing. Set 'vibelearner.geminiApiKey' in Settings or switch backendMode to 'vibelearner'."
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Simple prompt packing: prepend system text if present
  let userText = args.prompt;
  if (args.system && args.system.trim().length > 0) {
    userText = `[System]\n${args.system}\n\n[User]\n${args.prompt}`;
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let extra = "";
    try {
      extra = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Gemini error ${res.status} ${res.statusText}` +
        (extra ? ` — ${extra}` : "")
    );
  }

  const data: any = await res.json();

  const parts: string[] =
    data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "") ?? [];
  const text = parts.join("");

  const textString = String(text || "");

  return {
    text: textString,
    usage: approxUsage(textString, args.prompt),
    provider: "gemini",
  };
}

/* -------------------------------------------------------------------------- */

function approxUsage(output: string, input: string) {
  const total = Math.round((input.length + output.length) / 4);
  return { totalTokens: total };
}

// VS Code runs on Node >= 18 which has global fetch. We declare for TS.
declare const fetch: any;
