# ARCHITECTURE.md — Offline VS Code AI Assistant

## Overview

A fully offline, privacy-first AI coding assistant that runs entirely on a developer's local machine.
All inference, embeddings, and retrieval happen on `localhost` — no data ever leaves the machine.

---

## 1. System Component Diagram

```mermaid
graph TB
    subgraph VS_Code["VS Code (Extension Host)"]
        EXT["vscode-ai-assistant<br/>Extension (TypeScript)"]
        WV["Chat WebView<br/>(HTML/JS/CSS)"]
        AC["Inline Autocomplete<br/>Provider"]
        SB["Status Bar<br/>Controller"]
        EXT --> WV
        EXT --> AC
        EXT --> SB
    end

    subgraph Backend["FastAPI Backend  :8000"]
        direction TB
        API["FastAPI App<br/>main.py"]
        COMP["Completions Router<br/>/v1/completions"]
        CHAT["Chat Router<br/>/v1/chat"]
        RAG["RAG Router<br/>/v1/rag"]
        EMB["Embeddings Service<br/>/v1/embed"]
        IDX["Indexer Service<br/>/v1/index"]
        CACHE["Ghost Prefetch Cache<br/>(in-memory + SQLite)"]
        WATCH["File Watcher<br/>(watchdog)"]
        API --> COMP
        API --> CHAT
        API --> RAG
        API --> EMB
        API --> IDX
        COMP --> CACHE
        WATCH --> IDX
    end

    subgraph Ollama["Ollama Runtime  :11434"]
        OL_API["Ollama REST API"]
        SM["deepseek-coder:1.3b<br/>(Autocomplete — fast)"]
        LM["deepseek-coder:6.7b<br/>(Chat — smart)"]
        EM["nomic-embed-text<br/>(Embeddings)"]
        OL_API --> SM
        OL_API --> LM
        OL_API --> EM
    end

    subgraph Storage["Local Storage"]
        FAISS["FAISS Index<br/>(vector store)"]
        SQLITE["SQLite DB<br/>(metadata + cache)"]
        GGUF["GGUF Model Files<br/>(4-bit quantized)"]
    end

    EXT -- "HTTP/SSE  localhost:8000" --> API
    CHAT --> OL_API
    COMP --> OL_API
    EMB --> OL_API
    RAG --> FAISS
    IDX --> FAISS
    IDX --> SQLITE
    CACHE --> SQLITE
    OL_API --> GGUF
```

---

## 2. Autocomplete Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant DEV as Developer (Types Code)
    participant EXT as VS Code Extension
    participant CACHE as Ghost Cache (FastAPI)
    participant OLLAMA as Ollama :11434
    participant MODEL as deepseek-coder:1.3b

    DEV->>EXT: keystroke (debounce 150ms)
    EXT->>EXT: extract prefix + suffix context
    EXT->>CACHE: GET /v1/completions/prefetch?hash=<ctx_hash>
    alt Cache HIT
        CACHE-->>EXT: 200 { completion, source: "HIT" }
        EXT-->>DEV: inline ghost text (instant ~5ms)
    else Cache MISS
        CACHE-->>EXT: 404
        EXT->>OLLAMA: POST /api/generate { model, prompt, stream:false }
        OLLAMA->>MODEL: run inference (4-bit GGUF)
        MODEL-->>OLLAMA: token stream
        OLLAMA-->>EXT: { response: "completion text" }
        EXT-->>DEV: inline ghost text (~200-800ms)
        EXT->>CACHE: POST /v1/completions/prefetch { context, completion }
        Note over CACHE: Store for next identical context
    end
    DEV->>EXT: Tab key (accept)
    EXT->>EXT: insertText at cursor position
```

---

## 3. Chat Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant WV as Chat WebView
    participant EXT as Extension (message bus)
    participant API as FastAPI :8000
    participant OLLAMA as Ollama :11434
    participant MODEL as deepseek-coder:6.7b

    DEV->>WV: types message + hits Send
    WV->>EXT: postMessage({ type:'chat', text, context })
    EXT->>API: POST /v1/chat/stream { messages[], model, context }
    API->>OLLAMA: POST /api/chat { model, messages, stream:true }
    OLLAMA->>MODEL: begin streaming inference
    loop Token Stream (SSE)
        MODEL-->>OLLAMA: next token
        OLLAMA-->>API: { message.content: token, done: false }
        API-->>EXT: data: {"token":"...", "done":false}\n\n
        EXT-->>WV: postMessage({ type:'token', token })
        WV->>WV: append token to response bubble
    end
    OLLAMA-->>API: { done: true }
    API-->>EXT: data: {"token":"", "done":true}\n\n
    EXT-->>WV: postMessage({ type:'done' })
    WV->>WV: render final markdown + code blocks
```

---

## 4. RAG Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant EXT as VS Code Extension
    participant API as FastAPI :8000
    participant EMB as Embedding Service
    participant OLLAMA_E as Ollama (nomic-embed-text)
    participant FAISS as FAISS Index
    participant SQLITE as SQLite Metadata
    participant CHAT as Chat Router
    participant OLLAMA_C as Ollama (deepseek-coder:6.7b)

    Note over DEV,SQLITE: Indexing Phase (background / on-demand)
    DEV->>EXT: command: ai-assistant.indexProject
    EXT->>API: POST /v1/index { workspace_path }
    API->>API: walk files, chunk by function/class (tree-sitter)
    loop for each chunk
        API->>OLLAMA_E: POST /api/embeddings { model, prompt: chunk }
        OLLAMA_E-->>API: { embedding: float[768] }
        API->>FAISS: add vector + chunk_id
        API->>SQLITE: INSERT chunk metadata (file, lines, text)
    end
    API-->>EXT: { indexed: N, status: "complete" }

    Note over DEV,OLLAMA_C: Query Phase
    DEV->>EXT: chat message with @workspace or code question
    EXT->>API: POST /v1/rag/query { question, top_k:5 }
    API->>OLLAMA_E: POST /api/embeddings { model, prompt: question }
    OLLAMA_E-->>API: { embedding: float[768] }
    API->>FAISS: search(query_vec, k=5) → [chunk_ids, distances]
    API->>SQLITE: SELECT text WHERE id IN [chunk_ids]
    SQLITE-->>API: [{ file, lines, text }...]
    API->>CHAT: build prompt with retrieved context
    CHAT->>OLLAMA_C: POST /api/chat { model, messages_with_context, stream:true }
    loop Token Stream
        OLLAMA_C-->>API: token
        API-->>EXT: SSE token
        EXT-->>DEV: rendered in webview
    end
```

---

## 5. File Watcher Flow

```mermaid
sequenceDiagram
    participant FS as File System
    participant WATCH as watchdog (FileWatcher)
    participant IDX as Incremental Indexer
    participant FAISS as FAISS Index
    participant SQLITE as SQLite

    FS->>WATCH: file created / modified / deleted
    WATCH->>IDX: queue_reindex(file_path)
    IDX->>IDX: debounce 2s (batch changes)
    IDX->>SQLITE: DELETE old chunks WHERE file=path
    IDX->>FAISS: remove old vectors by ids
    IDX->>IDX: parse file with tree-sitter → new chunks
    loop new chunks
        IDX->>IDX: embed chunk (nomic-embed-text via Ollama)
        IDX->>FAISS: add new vector
        IDX->>SQLITE: INSERT new chunk metadata
    end
```

---

## 6. Data Flow Architecture

```mermaid
flowchart LR
    subgraph Input
        SRC["Source Files\n(.py .ts .js .go .rs)"]
        PROMPT["User Prompts\n(Chat / Commands)"]
    end

    subgraph Processing
        TS["tree-sitter\nParser/Chunker"]
        EMB["Embedding Pipeline\nnomic-embed-text"]
        GEN["Generation Pipeline\ndeepseek-coder"]
    end

    subgraph Storage
        FAISS["FAISS\n(float32 vectors)"]
        DB["SQLite\n(metadata, cache)"]
        MODELS["GGUF Files\n(4-bit Q4_K_M)"]
    end

    SRC --> TS --> EMB --> FAISS
    TS --> DB
    PROMPT --> GEN
    FAISS --> GEN
    MODELS --> GEN
    GEN --> PROMPT
```

---

## 7. Network Topology

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Laptop (localhost)               │
│                                                               │
│  ┌──────────────┐   HTTP/SSE    ┌──────────────────────────┐ │
│  │ VS Code      │──────────────>│ FastAPI  :8000           │ │
│  │ Extension    │<──────────────│ (Python + uvicorn)       │ │
│  └──────────────┘               └────────────┬─────────────┘ │
│                                              │ HTTP          │
│                                              v               │
│                                 ┌──────────────────────────┐ │
│                                 │ Ollama   :11434          │ │
│                                 │ (llama.cpp runtime)      │ │
│                                 │  ├─ deepseek-coder:1.3b  │ │
│                                 │  ├─ deepseek-coder:6.7b  │ │
│                                 │  └─ nomic-embed-text     │ │
│                                 └──────────────────────────┘ │
│                                                               │
│  NO EXTERNAL CONNECTIONS — 100% localhost                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Directory Structure

```
vscode-ai-assistant/
├── ARCHITECTURE.md
├── SYSTEM_DESIGN.md
├── .env
├── requirements.txt
├── package.json
├── tsconfig.json
├── webpack.config.js
├── setup.ps1
├── start.ps1
│
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # App entry point, router registration
│   ├── config.py               # Settings (pydantic-settings)
│   ├── routers/
│   │   ├── completions.py      # POST /v1/completions
│   │   ├── chat.py             # POST /v1/chat/stream (SSE)
│   │   ├── rag.py              # POST /v1/rag/query
│   │   ├── embeddings.py       # POST /v1/embed
│   │   └── indexer.py          # POST /v1/index
│   ├── services/
│   │   ├── ollama_client.py    # httpx async Ollama wrapper
│   │   ├── faiss_store.py      # FAISS index manager
│   │   ├── sqlite_store.py     # SQLite metadata store
│   │   ├── prefetch_cache.py   # Ghost prefetch cache
│   │   ├── file_watcher.py     # watchdog integration
│   │   └── tree_sitter_parser.py  # Code chunker
│   └── models/
│       └── schemas.py          # Pydantic request/response models
│
├── src/                        # VS Code Extension TypeScript
│   ├── extension.ts            # Entry point, command registration
│   ├── chat/
│   │   ├── chatProvider.ts     # WebView provider
│   │   └── chatPanel.ts        # WebView HTML + message bus
│   ├── autocomplete/
│   │   ├── completionProvider.ts  # InlineCompletionItemProvider
│   │   └── prefetchClient.ts   # Ghost prefetch trigger
│   ├── rag/
│   │   └── indexCommands.ts    # Index project command
│   ├── api/
│   │   └── backendClient.ts    # Axios/fetch wrapper for FastAPI
│   └── ui/
│       ├── statusBar.ts        # Status bar item
│       └── webview/
│           ├── chat.html       # Chat UI
│           ├── chat.css        # Styles
│           └── chat.js         # Frontend logic
│
├── data/                       # Runtime data (gitignored)
│   ├── faiss_index/            # FAISS index files
│   └── chroma.db               # SQLite database
│
└── dist/                       # Compiled extension (gitignored)
    └── extension.js
```
