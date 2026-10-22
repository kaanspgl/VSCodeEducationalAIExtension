export const LEVELS = [
  { v: "guided", label: "Structured", desc: "Explain the idea, get the code and walk through it together, then predict, run and modify it. Best for learning." },
  { v: "light", label: "Light", desc: "The learning tools are on each change whenever you want them; nothing is required." },
  { v: "off", label: "Regular vibe coding", desc: "The AI writes code straight from your request." },
] as const;

export const STAGE_ICON = { predict: "🔮", tour: "🧭", check: "🔍", challenge: "🛠" } as const;
