# 🛠️ Beast AI Assistant: Troubleshooting Guide

This guide provides solutions for common issues encountered while using the VS Code AI Assistant.

## 1. Backend Startup Issues

### "Ollama not found" or "Connection refused"
- **Cause**: The extension cannot communicate with the Ollama local API.
- **Solution**: 
  1. Ensure **Ollama** is installed and running (`ollama serve`).
  2. Verify you can access `http://localhost:11434` in your browser.
  3. Check your `settings.json` for the correct `aiAssistant.backendUrl`.

### "ModuleNotFoundError" during backend start
- **Cause**: Missing Python dependencies.
- **Solution**: 
  1. Open a terminal in the `backend/` folder.
  2. Run `pip install -r requirements.txt`.
  3. Ensure you are using Python 3.9+.

## 2. Autocomplete & Ghost Text

### Autocomplete feels slow
- **Cause**: High model latency or large context.
- **Solution**: 
  1. Use a smaller model like `deepseek-coder:1.3b` for autocomplete.
  2. Ensure "Ghost Prefetch" is active (it warms up the cache as you type).

### No suggestions appear
- **Cause**: Incorrect language detection or file too large.
- **Solution**: 
  1. Verify the file language is supported (Python, C++, JS, etc.).
  2. Index the project once using `Ctrl + Shift + P` -> `AI: Index Workspace`.
  3. Ensure your Python environment is set in VS Code (`Ctrl + Shift + P` -> `Python: Select Interpreter`).

## 3. Advanced Features

### Repo-Brain Map not loading
- **Cause**: Network restriction on CDN for Mermaid.js.
- **Solution**: Ensure your firewall allows access to `cdn.jsdelivr.net`.

### Git Time Machine error
- **Cause**: Workspace is not a Git repository.
- **Solution**: Run `git init` and commit your files. The feature requires a commit history to analyze.

### Self-Healing Fix is missing
- **Cause**: Error diagnostic not recognized or severity too low.
- **Solution**: Self-healing triggers on **Red Squiggles** (Errors). Ensure your language server (e.g., Pylance) is active.

## 4. Resetting the System
If all else fails:
1. Run command `Developer: Reload Window`.
2. Delete the `backend/database/learning.db` if the Learning Tracker is corrupted.
3. Restart Ollama.

---
*For further assistance, use the `ai-assistant.showHelp` command.*
