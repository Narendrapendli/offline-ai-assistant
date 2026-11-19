# start.ps1 - Launch script for Offline VS Code AI Assistant
# Run from project root: .\start.ps1
# Starts FastAPI backend in a new window, then opens VS Code

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host "`n[START] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK]  $msg"  -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [!]   $msg"  -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  [ERR] $msg"  -ForegroundColor Red; exit 1 }

$ProjectRoot = $PSScriptRoot
$EnvFile     = Join-Path $ProjectRoot ".env"
$PythonExe   = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$UvicornExe  = Join-Path $ProjectRoot ".venv\Scripts\uvicorn.exe"
$BackendDir  = Join-Path $ProjectRoot "backend"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "   OFFLINE VS CODE AI ASSISTANT -- STARTING               " -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Magenta

# Load .env
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            $key   = $Matches[1].Trim()
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
    Write-Ok "Loaded environment from .env"
} else {
    Write-Warn ".env not found -- using default values"
}

$FastApiHost = if ($env:FASTAPI_HOST) { $env:FASTAPI_HOST } else { "127.0.0.1" }
$FastApiPort = if ($env:FASTAPI_PORT) { $env:FASTAPI_PORT } else { "8000" }

# Guard: venv must exist
if (-not (Test-Path $PythonExe)) {
    Write-Fail "Python venv not found at .venv\Scripts\python.exe -- run .\setup.ps1 first"
}
if (-not (Test-Path $UvicornExe)) {
    Write-Fail "uvicorn not found -- run .\setup.ps1 to install dependencies"
}

# Guard: backend must exist
if (-not (Test-Path $BackendDir)) {
    Write-Fail "backend\ directory not found"
}
$BackendMain = Join-Path $BackendDir "main.py"
if (-not (Test-Path $BackendMain)) {
    Write-Fail "backend\main.py not found"
}

# Step 1: Check if Ollama is running
Write-Step "Checking Ollama service"
try {
    $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
    Write-Ok "Ollama is running on :11434"
} catch {
    Write-Warn "Ollama not detected on :11434"
    Write-Host "         Attempting to start Ollama..." -ForegroundColor Yellow
    try {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction Stop
        Start-Sleep -Seconds 3
        Write-Ok "Ollama started (background process)"
    } catch {
        Write-Warn "Could not auto-start Ollama. Please start it manually: 'ollama serve'"
        Write-Warn "The backend will retry connections -- you can start Ollama after launching."
    }
}

# Step 2: Check if FastAPI is already running
Write-Step "Checking for existing backend on :$FastApiPort"
$backendRunning = $false
try {
    $null = Invoke-WebRequest -Uri "http://${FastApiHost}:${FastApiPort}/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Ok "FastAPI backend already running on :$FastApiPort"
    $backendRunning = $true
} catch {
    $backendRunning = $false
    Write-Host "  [--]  Backend not running -- will start it now" -ForegroundColor DarkGray
}

# Step 3: Launch FastAPI backend in a new PowerShell window
if (-not $backendRunning) {
    Write-Step "Starting FastAPI backend (new PowerShell window)"

    $activateCmd = ". `"$ProjectRoot\.venv\Scripts\Activate.ps1`""
    $uvicornCmd  = "uvicorn main:app --host $FastApiHost --port $FastApiPort --reload --log-level info"
    $fullCmd     = "$activateCmd; Set-Location '$BackendDir'; Write-Host 'FastAPI Backend Starting...' -ForegroundColor Cyan; $uvicornCmd"

    $psArgs = @("-NoExit", "-Command", $fullCmd)

    $proc = Start-Process "powershell.exe" `
        -ArgumentList $psArgs `
        -PassThru `
        -WindowStyle Normal

    Write-Ok "Backend process started (PID: $($proc.Id))"

    # Wait for backend to become healthy
    Write-Host "  [..] Waiting for backend to be ready" -ForegroundColor Gray
    $maxWait  = 30
    $elapsed  = 0
    $interval = 2
    $ready    = $false
    while ($elapsed -lt $maxWait) {
        Start-Sleep -Seconds $interval
        $elapsed += $interval
        try {
            $null = Invoke-WebRequest -Uri "http://${FastApiHost}:${FastApiPort}/health" -TimeoutSec 2 -ErrorAction Stop
            $ready = $true
            Write-Ok "Backend healthy after ${elapsed}s"
            break
        } catch {
            Write-Host "  [..] Still waiting... (${elapsed}s / ${maxWait}s)" -ForegroundColor DarkGray
        }
    }

    if (-not $ready) {
        Write-Warn "Backend did not respond within ${maxWait}s"
        Write-Warn "Check the backend window for errors"
        Write-Warn "VS Code will still open -- the extension will retry connections"
    }
} else {
    Write-Ok "Skipping backend start -- already running"
}

# Step 4: Open VS Code in project root
Write-Step "Opening VS Code"
try {
    code $ProjectRoot
    Write-Ok "VS Code opened at: $ProjectRoot"
} catch {
    Write-Warn "Could not open VS Code via 'code' CLI"
    Write-Warn "Open VS Code manually and navigate to: $ProjectRoot"
}

# Done
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   ALL SERVICES RUNNING                                   " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Ollama:     http://localhost:11434" -ForegroundColor White
Write-Host "  FastAPI:    http://${FastApiHost}:${FastApiPort}" -ForegroundColor White
Write-Host "  Swagger UI: http://${FastApiHost}:${FastApiPort}/docs" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C in the backend window to stop the server." -ForegroundColor Gray
Write-Host ""
