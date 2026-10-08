# One-time setup for demoing VibeLearner on this machine (Windows PowerShell).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup-demo.ps1 [ollama-model]
param([string]$Model = "qwen2.5-coder:7b")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host "1/4 Checking tools"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js is missing: install it from https://nodejs.org (LTS)"; exit 1 }
Ok "node $(node -v)"
if (Get-Command code -ErrorAction SilentlyContinue) { Ok "VS Code CLI found" } else { Warn "'code' not on PATH" }
if (Get-Command python -ErrorAction SilentlyContinue) { Ok "python found" } else { Warn "python not found: Python programs won't run (JavaScript still will)" }

Write-Host "2/4 Installing, compiling and testing the extension"
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit 1 }
npm test | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Tests failed: run 'npm test' to see why"; exit 1 }
Ok "compiled, all tests pass"

Write-Host "3/4 Checking Ollama and model '$Model'"
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Warn "Ollama is not installed: get it from https://ollama.com, then re-run this script"
} else {
  try { Invoke-RestMethod http://127.0.0.1:11434/api/tags | Out-Null; $running = $true } catch { $running = $false }
  if (-not $running) {
    Warn "Ollama is installed but not running: start the Ollama app, then re-run"
  } else {
    ollama pull $Model
    Ok "model $Model ready"
    if ($Model -ne "qwen2.5-coder:7b") {
      $f = "demo-workspace\.vscode\settings.json"
      (Get-Content $f -Raw) -replace '"vibelearner.model": "[^"]*"', "`"vibelearner.model`": `"$Model`"" | Set-Content $f
      Ok "demo-workspace now uses $Model"
    }
  }
}

Write-Host "4/4 Done. To start the demo:"
Write-Host "  code .    then press F5 and pick 'Demo: VibeLearner in demo-workspace'"
Write-Host "  (see DEMO.md for the 5-minute walkthrough)"
