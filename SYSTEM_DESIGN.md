# SYSTEM_DESIGN.md — Offline VS Code AI Assistant

## 1. Design Goals

| Goal | Implementation |
|------|---------------|
| **100% Offline** | All inference via Ollama on localhost; zero telemetry |
| **Privacy-First** | No cloud APIs, no logging of code to any remote endpoint |
| **Low Latency** | 1.3b model for autocomplete (<300ms p95), ghost prefetch cache |
| **High Quality** | 6.7b model for chat/RAG where latency tolerance is higher |
| **Developer UX** | Native VS Code inline completions + sidebar chat panel |
| **Incremental RAG** | File watcher + tree-sitter for live codebase indexing |

---

## 2. Dual Model Strategy

### 2.1 Model Roster

| Role | Model | Size (4-bit GGUF) | VRAM Usage | Use Cases |
|------|-------|-------------------|------------|-----------|
| **Autocomplete** | `deepseek-coder:1.3b` | ~800 MB | ~1.2 GB | Inline ghost text, single-line / FIM completion |
| **Chat & RAG** | `deepseek-coder:6.7b` | ~4.1 GB | ~5.0 GB | Multi-turn chat, code explanation, bug detection, docstrings |
| **Embeddings** | `nomic-embed-text` | ~270 MB | ~350 MB | Codebase indexing, semantic search, RAG retrieval |

**Total VRAM (worst case simultaneous):** ~6.55 GB → fits in 8 GB VRAM  
**RAM footprint (backend + Ollama runtime):** ~2–3 GB additional

### 2.2 Model Selection Rationale

#### deepseek-coder:1.3b — Autocomplete Model
- **Why:** Purpose-built for code; trained on 87 languages; Fill-In-the-Middle (FIM) support
- **Why 1.3b:** Median inference time 80–180ms on CPU+GPU hybrid; acceptable for typing cadence
- **Quantization:** Q4_K_M — best quality/speed trade-off at 4-bit
- **Context window:** 4096 tokens (sufficient for file context)
- **Prompt format:** FIM tokens `<|fim_prefix|>`, `<|fim_suffix|>`, `<|fim_middle|>`

#### deepseek-coder:6.7b — Chat & RAG Model
- **Why:** 6.7b parameter count hits the quality sweet-spot for instruction following
- **Why 6.7b not 33b:** 33b requires 20+ GB VRAM; 6.7b at Q4_K_M fits in 4–5 GB
- **Response time:** 1–5s per response (acceptable for chat, not for autocomplete)
- **Context window:** 16384 tokens (good for multi-file RAG context)
- **Instruction format:** ChatML `<|im_start|>` / `<|im_end|>` tokens

#### nomic-embed-text — Embedding Model
- **Why:** 768-dim embeddings, strong performance on code retrieval benchmarks
- **Context:** 8192 token max (can embed large functions)
- **Speed:** ~50ms per chunk on CPU; runs in parallel with inference model

### 2.3 Model Routing Logic

```
User Action
    │
    ├─► Keystroke in editor (debounced 150ms)
    │       └─► Route to: deepseek-coder:1.3b  (via /v1/completions)
    │
    ├─► Chat message sent
    │       ├─► No @workspace → Route to: deepseek-coder:6.7b (direct chat)
    │       └─► @workspace or "explain this file" → RAG pipeline
    │               ├─► Embed query: nomic-embed-text
    │               ├─► Retrieve from FAISS (top-k=5)
    │               └─► Generate with context: deepseek-coder:6.7b
    │
    ├─► Context menu: "Generate Docstring"
    │       └─► Route to: deepseek-coder:6.7b (single shot)
    │
    └─► Context menu: "Explain Git Diff"
            └─► Route to: deepseek-coder:6.7b (single shot)
```

---

## 3. Hardware Requirements

### 3.1 Target Hardware Profile

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **RAM** | 16 GB | 32 GB | OS + VS Code + Ollama + FastAPI |
| **VRAM** | 4 GB | 8 GB | 4 GB: CPU offload for 6.7b; 8 GB: full GPU |
| **CPU** | 4 cores | 8+ cores | CPU handles overflow layers |
| **Storage** | 20 GB free | 50 GB free | GGUF files + FAISS index + working space |
| **OS** | Windows 10 | Windows 11 | PowerShell 7+ recommended |

### 3.2 Memory Budget

```
RAM Allocation (16 GB system)
─────────────────────────────
  Windows OS:              4.0 GB
  VS Code + Extension:     0.8 GB
  FastAPI backend:         0.5 GB
  Ollama runtime:          0.3 GB
  GGUF model (CPU layers): 2.0 GB  ← overflow from VRAM
  FAISS index:             0.5 GB  ← depends on codebase size
  SQLite WAL buffer:       0.1 GB
  Headroom:                7.8 GB
  ────────────────────────────────
  Total:                  16.0 GB ✓

VRAM Allocation (8 GB GPU)
──────────────────────────
  deepseek-coder:1.3b:    1.2 GB  ← always loaded
  deepseek-coder:6.7b:    4.1 GB  ← loaded on first chat
  nomic-embed-text:       0.35 GB ← loaded on first index
  Driver overhead:        0.35 GB
  ───────────────────────────────
  Total:                  6.0 GB  ✓ (2 GB headroom)
```

### 3.3 GPU Offloading Strategy (Ollama num_gpu config)

```yaml
# ~/.ollama/models config (set via Ollama API Modelfile)
deepseek-coder:1.3b:
  num_gpu: 99           # all layers to GPU (model is small)
  num_thread: 4         # CPU threads for non-GPU work

deepseek-coder:6.7b:
  num_gpu: 32           # ~32 of 35 layers to GPU (8GB VRAM)
  num_thread: 8         # CPU handles remaining 3 layers

nomic-embed-text:
  num_gpu: 99           # small model, full GPU
  num_thread: 4
```

---

## 4. FAISS Index Architecture

### 4.1 Index Configuration

```python
# Index type selection
FLAT_L2      # exact search, <100k vectors: used for small repos
IVF_FLAT     # approximate, 100k–1M vectors: large monorepos
HNSW32       # graph-based, streaming updates: default choice

# Selected: IndexHNSWFlat(768, 32)
#   768  = nomic-embed-text embedding dimension
#   32   = HNSW M parameter (connections per node)
#   ef_search = 64 (query-time recall/speed trade-off)
```

### 4.2 Chunking Strategy (tree-sitter)

| Language | Chunk Unit | Max Tokens | Overlap |
|----------|-----------|------------|---------|
| Python | function, class, module | 512 | 50 (file docstring) |
| TypeScript/JS | function, class, arrow fn | 512 | 50 |
| Go | func, type, package | 512 | 50 |
| Rust | fn, impl, mod | 512 | 50 |
| Generic | line-based sliding window | 256 | 32 |

### 4.3 Metadata Schema (SQLite)

```sql
CREATE TABLE chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faiss_id    INTEGER UNIQUE NOT NULL,
    file_path   TEXT NOT NULL,
    start_line  INTEGER NOT NULL,
    end_line    INTEGER NOT NULL,
    chunk_text  TEXT NOT NULL,
    language    TEXT,
    symbol_name TEXT,        -- function/class name if parseable
    indexed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prefetch_cache (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    context_hash TEXT UNIQUE NOT NULL,
    completion   TEXT NOT NULL,
    model        TEXT NOT NULL,
    hit_count    INTEGER DEFAULT 0,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used    TIMESTAMP
);

CREATE INDEX idx_chunks_file ON chunks(file_path);
CREATE INDEX idx_prefetch_hash ON prefetch_cache(context_hash);
```

---

## 5. FastAPI Backend Design

### 5.1 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/completions` | none | FIM completion (autocomplete) |
| POST | `/v1/completions/prefetch` | none | Store pre-computed completion |
| GET | `/v1/completions/prefetch` | none | Retrieve cached completion |
| POST | `/v1/chat/stream` | none | Streaming chat (SSE) |
| POST | `/v1/chat` | none | Non-streaming chat |
| POST | `/v1/embed` | none | Generate embeddings |
| POST | `/v1/index` | none | Index workspace |
| GET | `/v1/index/status` | none | Get indexing progress |
| POST | `/v1/rag/query` | none | RAG-augmented query |
| GET | `/v1/health` | none | Health check |
| GET | `/metrics` | none | Token/request stats |

### 5.2 Pydantic Models

```python
class CompletionRequest(BaseModel):
    prefix: str
    suffix: str = ""
    language: str = "python"
    max_tokens: int = 128
    temperature: float = 0.1

class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = "deepseek-coder:6.7b"
    temperature: float = 0.7
    max_tokens: int = 2048
    context_files: list[str] = []  # for RAG

class IndexRequest(BaseModel):
    workspace_path: str
    extensions: list[str] = [".py", ".ts", ".js", ".go", ".rs", ".java"]
    exclude_dirs: list[str] = ["node_modules", ".git", "__pycache__", "dist"]

class RAGQueryRequest(BaseModel):
    question: str
    top_k: int = 5
    model: str = "deepseek-coder:6.7b"
```

---

## 6. VS Code Extension Design

### 6.1 Activation & Commands

```json
{
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "ai-assistant.openChat",      "title": "AI: Open Chat Panel" },
      { "command": "ai-assistant.generate",      "title": "AI: Generate Code" },
      { "command": "ai-assistant.indexProject",  "title": "AI: Index Workspace" },
      { "command": "ai-assistant.explainCode",   "title": "AI: Explain Selected Code" },
      { "command": "ai-assistant.generateDoc",   "title": "AI: Generate Docstring" },
      { "command": "ai-assistant.explainDiff",   "title": "AI: Explain Git Diff" },
      { "command": "ai-assistant.writeTests",    "title": "AI: Write Unit Tests" },
      { "command": "ai-assistant.detectBugs",    "title": "AI: Detect Bugs" }
    ]
  }
}
```

### 6.2 Inline Completion Implementation

```typescript
// InlineCompletionItemProvider contract
class AICompletionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList> {
    // 1. Extract FIM context (prefix = above cursor, suffix = below)
    // 2. Hash context → check ghost cache first
    // 3. If miss → POST /v1/completions to FastAPI
    // 4. Return InlineCompletionItem with completion text
    // 5. Background: POST to prefetch cache
  }
}
```

### 6.3 WebView Chat Panel

- **Rendering:** Marked.js for Markdown, Highlight.js for code blocks
- **Streaming:** EventSource (SSE) connected to FastAPI `/v1/chat/stream`
- **Message Bus:** `vscode.postMessage` ↔ `window.addEventListener('message')`
- **Actions per code block:** Copy, Insert at Cursor, Explain

---

## 7. Privacy & Security Architecture

### 7.1 Data Isolation

```
ALL traffic stays on 127.0.0.1 (loopback only)

FastAPI binds to:  127.0.0.1:8000  (NOT 0.0.0.0)
Ollama binds to:   127.0.0.1:11434 (default Ollama behavior)

No telemetry, no crash reporting, no model download at runtime.
Models must be pulled manually before first use:
  ollama pull deepseek-coder:1.3b
  ollama pull deepseek-coder:6.7b
  ollama pull nomic-embed-text
```

### 7.2 What Data Is Stored Locally

| Data | Location | Retention |
|------|----------|-----------|
| Code chunks (for RAG) | `data/chroma.db` (SQLite) | Until re-indexed |
| FAISS vectors | `data/faiss_index/` | Until re-indexed |
| Autocomplete cache | `data/chroma.db` prefetch_cache table | 7 days LRU |
| Chat history | In-memory only (not persisted) | Session only |
| Source code | Never stored — only embeddings/chunks | N/A |

### 7.3 No-Internet Guarantee

- `OLLAMA_NOPRUNE=1` — prevents Ollama from attempting registry checks
- FastAPI has no `httpx` calls to external URLs (only `localhost:11434`)
- Extension makes no calls beyond `localhost:8000`
- No VS Code Marketplace telemetry (extension runs as VSIX, not published)

---

## 8. Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Autocomplete latency (cache hit) | < 10ms | In-memory ghost cache |
| Autocomplete latency (cache miss) | < 400ms p95 | 1.3b model, Q4_K_M, full GPU |
| Chat first token | < 1.5s | 6.7b model pre-loaded in Ollama |
| Chat throughput | > 20 tok/s | Q4_K_M + GPU offload |
| RAG query latency | < 3s total | HNSW index + parallel embed |
| Indexing speed | > 100 files/min | Async batch embedding |
| Extension startup | < 500ms | Lazy activation, deferred indexing |

---

## 9. Offline Setup Instructions (End-to-End)

```powershell
# Step 1: Install prerequisites (one-time, requires internet)
# - Install Ollama: https://ollama.ai/download
# - Install VS Code: https://code.visualstudio.com/
# - Install Python 3.11+: https://python.org
# - Install Node.js 20+: https://nodejs.org

# Step 2: Pull models (one-time, requires internet)
ollama pull deepseek-coder:1.3b
ollama pull deepseek-coder:6.7b
ollama pull nomic-embed-text

# Step 3: Run setup script (automated)
.\setup.ps1

# Step 4: Start the assistant
.\start.ps1

# From this point: 100% offline operation
```
