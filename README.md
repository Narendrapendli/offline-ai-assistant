# 🤖 Offline VS Code AI Assistant

> A fully **offline**, privacy-first AI coding assistant built as a VS Code extension.  
> Powered by **Ollama** + local LLMs (DeepSeek-Coder, Phi-3, Qwen2.5-Coder, LLaMA 3.1).  
> No internet required. No API keys. Your code never leaves your machine.

---

# Demonstration Video Link 


https://youtu.be/J8eHL3okBHA?si=K2UsKcGyuaOlgjxh












## 📌 Project Overview


This project implements a production-quality AI assistant integrated directly into VS Code. It provides intelligent code generation, error detection, explanation, and chat — all running **100% locally** using open-source large language models via Ollama.

Built as part of the **KARE Emerging Tech Credit Program**.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VS Code Extension                        │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Chat Panel  │   │ Autocomplete │   │  Commands/Menu │  │
│  │ (Webview UI) │   │  Provider    │   │  (Ctrl+Shift+P)│  │
│  └──────┬───────┘   └──────┬───────┘   └───────┬────────┘  │
│         │                  │                    │            │
│         └──────────────────┼────────────────────┘            │
│                            │                                 │
│                    ┌───────▼────────┐                       │
│                    │ BackendClient  │  (TypeScript)         │
│                    │ HTTP + SSE     │                       │
│                    └───────┬────────┘                       │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP (localhost:8000)
┌────────────────────────────▼────────────────────────────────┐
│                   FastAPI Backend (Python)                    │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────────┐ │
│  │  /chat  │  │/autocomplete│ │/generate│  │/models/list    │ │
│  │  /stream│  │            │ │        │  │/health        │ │
│  └────┬────┘  └─────┬──────┘ └───┬────┘  └───────────────┘ │
│       │             │            │                           │
│  ┌────▼─────────────▼────────────▼───────────────────────┐  │
│  │              OllamaService (httpx async)               │  │
│  │         SSE streaming  •  Model selection              │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼──────────────────────────────┐  │
│  │        Supporting Services                             │  │
│  │  RAG/FAISS  •  Chat History (SQLite)                  │  │
│  │  AST Analysis  •  Context Manager  •  Git Integration │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                             │ REST API (port 11434)
┌────────────────────────────▼────────────────────────────────┐
│                     Ollama Runtime                           │
│                                                              │
│   phi3:mini  •  deepseek-coder  •  qwen2.5-coder           │
│   gemma3:4b  •  llama3.1:8b  •  nomic-embed-text           │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

### 🧠 AI Chat Panel
- **Streaming chat** via Server-Sent Events (SSE) — see tokens as they arrive
- **Model selector** — switch between any locally installed Ollama model on the fly
- **@file mentions** — type `@filename.py` to inject file content into the prompt
- **Slash commands** — `/fix`, `/explain`, `/test`, `/review`, `/optimize`, `/translate`, `/docstring`
- **Chat history** — sessions persisted in SQLite, searchable, with session management
- **Code blocks** with Run ▶, Diff, Insert, Copy buttons
- **Model badge** — every AI response shows which model answered

### ⚡ Inline Autocomplete
- Ghost-text suggestions as you type (debounced, non-intrusive)
- Language-aware completions using the active file context

### 🛠️ Commands (Ctrl+Shift+P → "AI:")
| Command | Description |
|---|---|
| AI: Fix Code | Detect and fix bugs in selection |
| AI: Explain Code | Plain-English explanation |
| AI: Generate Tests | Auto-write unit tests |
| AI: Generate Docstring | Add docstrings |
| AI: Code Review | Senior engineer review |
| AI: Optimize | Complexity analysis + improvements |
| AI: Translate Code | Convert to another language |
| AI: Git Diff Explain | Explain current git changes |
| AI: Switch Model | Pick Ollama model from quick-pick |

### 🔍 Diagnostics
- **Bug Detector** — real-time AI-powered problem detection
- **Self-Healing** — one-click AI fix for detected issues

### 📚 RAG / Knowledge Base
- Index your project with FAISS vector search
- Context-aware answers based on your entire codebase

---

## 🚀 Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Python](https://python.org/) 3.10+
- [Ollama](https://ollama.com/) installed and running
- VS Code 1.80+

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/offline-ai-assistant
cd offline-ai-assistant
```

### 2. Pull Required Ollama Models
```bash
ollama pull phi3:mini
ollama pull deepseek-coder:6.7b   # optional, larger
ollama pull nomic-embed-text       # for RAG/embeddings
```

### 3. Set Up Python Backend
```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r backend/requirements.txt
```

### 4. Install VS Code Extension Dependencies
```bash
npm install
npm run compile
```

### 5. Start the Backend
```bash
# Windows — press Ctrl+Shift+B inside VS Code (uses the built-in task)
# OR run manually:
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 6. Launch the Extension
- Press **`F5`** in VS Code to open the Extension Development Host
- The AI Assistant panel appears in the left sidebar (robot icon)

---

## 📁 Project Structure

```
offline-ai-assistant/
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # App entry point, router registration
│   ├── config.py               # Settings (pydantic-settings)
│   ├── schemas.py              # Pydantic request/response models
│   ├── middleware.py           # Request logging, stats
│   ├── routers/
│   │   ├── chat.py             # POST /chat/stream (SSE), POST /chat
│   │   ├── health.py           # GET /health, GET /models/list
│   │   ├── autocomplete.py     # POST /autocomplete
│   │   ├── generate.py         # POST /generate
│   │   ├── rag.py              # POST /index/project
│   │   ├── history.py          # Chat session CRUD
│   │   └── git_router.py       # Git diff/history analysis
│   ├── services/
│   │   ├── ollama_service.py   # Async Ollama API client
│   │   ├── chat_service.py     # Chat orchestration
│   │   └── model_manager.py    # Model health/preload
│   ├── rag/                    # FAISS-based retrieval
│   ├── ast_analysis/           # Python AST code analysis
│   └── context/                # Context extraction utilities
├── src/                        # TypeScript VS Code extension
│   ├── extension.ts            # Extension activation point
│   ├── chat/
│   │   └── chatProvider.ts     # Webview + message handling
│   ├── clients/
│   │   └── BackendClient.ts    # HTTP client for backend API
│   ├── commands/               # All registered VS Code commands
│   ├── autocomplete/           # InlineCompletionItemProvider
│   ├── diagnostics/            # Bug detection, self-healing
│   └── webview/
│       └── chat.html           # Chat UI (HTML/CSS/JS)
├── .vscode/
│   └── tasks.json              # "Start Backend" keyboard shortcut
├── start_backend.ps1           # One-click backend launcher
├── package.json                # Extension manifest
└── webpack.config.js           # TypeScript bundler config
```

---

## 🔧 Configuration

Set via VS Code Settings (`Ctrl+,` → search "AI Assistant"):

| Setting | Default | Description |
|---|---|---|
| `ai-assistant.chatModel` | `phi3:mini` | Model for chat (changed by UI picker) |
| `ai-assistant.temperature` | `0.7` | Response creativity (0 = deterministic) |
| `ai-assistant.maxTokens` | `500` | Max tokens per response |
| `ai-assistant.systemPrompt` | _(built-in)_ | Custom system prompt |

---

## 🧪 Evaluation Framework

The backend exposes `/stats` for metrics:
```json
{
  "uptime_seconds": 3600,
  "total_requests": 142,
  "avg_response_ms": 1240,
  "model_name": "phi3:mini",
  "cache_hit_rate": "34.5%"
}
```

Model responses are tracked per-session in SQLite for quality analysis.

---

## 🛡️ Privacy & Security

- **100% offline** — zero telemetry, zero data sent to external servers
- All LLMs run locally via Ollama
- Chat history stored in local SQLite only
- CORS restricted to localhost

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👨‍💻 Author

Built with ❤️ using FastAPI, Ollama, and the VS Code Extension API.
