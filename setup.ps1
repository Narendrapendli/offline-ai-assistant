# setup.ps1 - One-time setup for Offline VS Code AI Assistant
# Run from project root: .\setup.ps1
# Requirements: Python 3.11+, Node.js 20+, npm, VS Code CLI in PATH

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK] $msg"   -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "   OFFLINE VS CODE AI ASSISTANT -- SETUP                  " -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Magenta

# Step 1: Verify prerequisites
Write-Step "Checking prerequisites"

try {
    $pyVer = python --version 2>&1
    if ($pyVer -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
            Write-Fail "Python 3.10+ required. Found: $pyVer"
        }
        Write-Ok "Python found: $pyVer"
    }
} catch { Write-Fail "Python not found in PATH. Install Python 3.11+ from https://python.org" }

try {
    $nodeVer = node --version 2>&1
    Write-Ok "Node.js found: $nodeVer"
} catch { Write-Fail "Node.js not found in PATH. Install Node.js 20+ from https://nodejs.org" }

try {
    $npmVer = npm --version 2>&1
    Write-Ok "npm found: v$npmVer"
} catch { Write-Fail "npm not found in PATH." }

try {
    $codeVer = code --version 2>&1 | Select-Object -First 1
    Write-Ok "VS Code CLI found: $codeVer"
} catch { Write-Warn "VS Code 'code' CLI not found. Extension install will be skipped." }

# Ollama check (non-fatal -- user may start it later)
try {
    $ollamaVer = ollama --version 2>&1
    Write-Ok "Ollama found: $ollamaVer"
} catch { Write-Warn "Ollama not found. Install from https://ollama.ai before running start.ps1" }

# Step 2: Create data directories
Write-Step "Creating data directories"
$dirs = @("data", "data\faiss_index", "backend\routers", "backend\services",
          "backend\models", "src\chat", "src\autocomplete", "src\rag",
          "src\api", "src\ui\webview")
foreach ($d in $dirs) {
    $fullPath = Join-Path $ProjectRoot $d
    if (-not (Test-Path $fullPath)) {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        Write-Ok "Created: $d"
    } else {
        Write-Host "  [SKIP] Already exists: $d" -ForegroundColor DarkGray
    }
}

# Step 3: Create Python virtual environment
Write-Step "Creating Python virtual environment (.venv)"
$venvPath = Join-Path $ProjectRoot ".venv"
if (-not (Test-Path (Join-Path $venvPath "Scripts\python.exe"))) {
    python -m venv .venv
    Write-Ok "Virtual environment created at .venv"
} else {
    Write-Ok "Virtual environment already exists -- skipping creation"
}

# Step 4: Install Python dependencies
Write-Step "Installing Python dependencies from requirements.txt"
$pip    = Join-Path $ProjectRoot ".venv\Scripts\pip.exe"

if (-not (Test-Path $pip)) { Write-Fail ".venv\Scripts\pip.exe not found -- venv creation may have failed." }

& $pip install --upgrade pip --quiet
& $pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Fail "pip install failed. Check requirements.txt." }
Write-Ok "Python dependencies installed"

# Step 5: Install Node.js dependencies
Write-Step "Installing Node.js dependencies (npm install)"
npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed." }
Write-Ok "Node.js dependencies installed"

# Step 6: Compile TypeScript extension
Write-Step "Compiling TypeScript extension (npm run compile)"
npm run compile
if ($LASTEXITCODE -ne 0) { Write-Fail "TypeScript compilation failed. Check src/ for errors." }
Write-Ok "Extension compiled to dist/extension.js"

# Step 7: Package VSIX
Write-Step "Packaging VS Code extension (.vsix)"
npx vsce package --no-yarn --allow-missing-repository 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "vsce package failed -- extension may still work in dev mode (F5)"
} else {
    $vsix = Get-ChildItem -Path $ProjectRoot -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsix) { Write-Ok "Package created: $($vsix.Name)" }
}

# Step 8: Install extension into VS Code
Write-Step "Installing extension into VS Code"
$vsix = Get-ChildItem -Path $ProjectRoot -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($vsix) {
    try {
        code --install-extension $vsix.FullName
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Extension installed: $($vsix.Name)"
        } else {
            Write-Warn "Install manually: code --install-extension $($vsix.Name)"
        }
    } catch {
        Write-Warn "Could not auto-install. Run: code --install-extension $($vsix.Name)"
    }
} else {
    Write-Warn "No .vsix found -- skipping VS Code installation"
}

# Step 9: Validate Ollama models
Write-Step "Checking Ollama model availability"
try {
    $models = ollama list 2>&1
    $requiredModels = @("deepseek-coder:1.3b", "deepseek-coder:6.7b", "nomic-embed-text")
    foreach ($m in $requiredModels) {
        if ($models -match [regex]::Escape($m.Split(":")[0])) {
            Write-Ok "Model available: $m"
        } else {
            Write-Warn "Model NOT pulled: $m -- run: ollama pull $m"
        }
    }
} catch {
    Write-Warn "Cannot check models -- start Ollama then run:"
    Write-Warn "  ollama pull deepseek-coder:1.3b"
    Write-Warn "  ollama pull deepseek-coder:6.7b"
    Write-Warn "  ollama pull nomic-embed-text"
}

# Done
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   SETUP COMPLETE                                         " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Pull Ollama models (if not done):" -ForegroundColor Gray
Write-Host "       ollama pull deepseek-coder:1.3b" -ForegroundColor DarkGray
Write-Host "       ollama pull deepseek-coder:6.7b" -ForegroundColor DarkGray
Write-Host "       ollama pull nomic-embed-text" -ForegroundColor DarkGray
Write-Host "  2. Start the assistant:" -ForegroundColor Gray
Write-Host "       .\start.ps1" -ForegroundColor DarkGray
Write-Host ""
