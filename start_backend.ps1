# start_backend.ps1
# Run this script to start the AI Assistant backend
# You can double-click this from File Explorer or run it in any PowerShell terminal

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   AI Assistant Backend Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Ollama is running
Write-Host "[1/3] Checking Ollama..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:11434" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "      Ollama is already running." -ForegroundColor Green
} catch {
    Write-Host "      Ollama not running. Starting Ollama..." -ForegroundColor Yellow
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Host "      Ollama started." -ForegroundColor Green
}

# Activate virtual environment
Write-Host "[2/3] Activating virtual environment..." -ForegroundColor Yellow
if (Test-Path ".venv\Scripts\Activate.ps1") {
    & .venv\Scripts\Activate.ps1
    Write-Host "      Virtual environment activated." -ForegroundColor Green
} else {
    Write-Host "      ERROR: .venv not found! Run: python -m venv .venv" -ForegroundColor Red
    Write-Host "      Then run: .venv\Scripts\pip install -r backend\requirements.txt" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Start FastAPI backend
Write-Host "[3/3] Starting FastAPI backend on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Backend is RUNNING. Press Ctrl+C to stop." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
