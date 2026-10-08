#!/usr/bin/env bash
# One-time setup for demoing VibeLearner on this machine (macOS / Linux).
# Usage: ./scripts/setup-demo.sh [ollama-model]   (default: qwen2.5-coder:7b)
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${1:-qwen2.5-coder:7b}"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "1/4 Checking tools"
command -v node >/dev/null || { echo "Node.js is missing: install it from https://nodejs.org (LTS)"; exit 1; }
ok "node $(node -v)"
command -v code >/dev/null && ok "VS Code CLI found" || warn "'code' not on PATH (VS Code > Command Palette > 'Shell Command: Install code command')"
command -v python3 >/dev/null && ok "python3 found" || warn "python3 not found: Python programs won't run (JavaScript still will)"

echo "2/4 Installing, compiling and testing the extension"
npm ci --no-audit --no-fund
npm test >/dev/null && ok "compiled, all tests pass"

echo "3/4 Checking Ollama and model '$MODEL'"
if ! command -v ollama >/dev/null; then
  warn "Ollama is not installed: get it from https://ollama.com, then re-run this script"
elif ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  warn "Ollama is installed but not running: start the Ollama app (or 'ollama serve'), then re-run"
else
  ollama pull "$MODEL" && ok "model $MODEL ready"
  if [ "$MODEL" != "qwen2.5-coder:7b" ]; then
    sed -i.bak "s#\"vibelearner.model\": \"[^\"]*\"#\"vibelearner.model\": \"$MODEL\"#" demo-workspace/.vscode/settings.json
    rm -f demo-workspace/.vscode/settings.json.bak
    ok "demo-workspace now uses $MODEL"
  fi
fi

echo "4/4 Done. To start the demo:"
echo "  code .    then press F5 and pick 'Demo: VibeLearner in demo-workspace'"
echo "  (see DEMO.md for the 5-minute walkthrough)"
