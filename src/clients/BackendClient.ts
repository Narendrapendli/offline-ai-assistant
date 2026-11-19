import * as vscode from 'vscode';

const BASE_URL = 'http://127.0.0.1:8000';

// ── Shared helpers ────────────────────────────────────────────────────────────

function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'Content-Type': 'application/json', ...extra };
}

/**
 * Read a streaming plain-text response and call onToken for each chunk.
 * Used by streamAutocomplete and streamGenerate.
 */
async function consumeTextStream(
    res: Response,
    onToken: (token: string) => void
): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) { return ''; }
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        onToken(chunk);
    }
    return full;
}


// ── BackendClient ─────────────────────────────────────────────────────────────

export class BackendClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string = BASE_URL) {
        this.baseUrl = baseUrl;
    }

    // ── Health ──────────────────────────────────────────────────────────────

    async checkHealth(): Promise<boolean> {
        try {
            const ctrl  = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 3000);
            const res   = await fetch(`${this.baseUrl}/health`, { signal: ctrl.signal });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    // ── Autocomplete (plain-text stream) ────────────────────────────────────

    async *streamAutocomplete(
        params: { prefix: string; suffix: string; language: string; max_tokens?: number; temperature?: number },
        signal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const res = await fetch(`${this.baseUrl}/autocomplete`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                prefix: params.prefix,
                suffix: params.suffix,
                language: params.language,
                max_tokens: params.max_tokens ?? 60,
                temperature: params.temperature ?? 0.1,
                model: vscode.workspace.getConfiguration('aiAssistant').get('model') || undefined
            }),
            signal,
        });
        
        if (!res.ok) {
            throw new Error(`Autocomplete failed: ${res.status}`);
        }
        
        const reader = res.body?.getReader();
        if (!reader) { return; }
        
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
        }
    }

    // ── Chat (SSE stream) ────────────────────────────────────────────────────

    async *streamChat(
        params: { 
            messages: Array<{ role: string; content: string }>; 
            code_context?: string; 
            language?: string;
            temperature?: number;
            max_tokens?: number;
            model?: string;
        },
        signal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 10000); // 10s timeout for connection
        
        const res = await fetch(`${this.baseUrl}/chat/stream`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                messages: params.messages,
                code_context: params.code_context ?? '',
                language: params.language ?? 'text',
                temperature: params.temperature ?? 0.7,
                max_tokens: params.max_tokens ?? 500,
                model: params.model
            }),
            signal: signal || ctrl.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            throw new Error(`Chat stream failed: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) { return; }
        
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data:')) { continue; }
                const data = line.slice(5).trim();
                if (data === '[DONE]') { return; }
                try {
                    const obj = JSON.parse(data) as { token?: string; done?: boolean; error?: string };
                    if (obj.error) throw new Error(obj.error);
                    if (obj.token) yield obj.token;
                    if (obj.done) return;
                } catch {
                    // skip malformed
                }
            }
        }
    }

    // ── Generate (plain-text stream) ─────────────────────────────────────────

    async streamGenerate(
        instruction: string,
        context = '',
        language = 'text',
        maxTokens = 1024,
        temperature = 0.7,
        onToken: (token: string) => void = () => {},
        signal?: AbortSignal
    ): Promise<string> {
        const res = await fetch(`${this.baseUrl}/generate`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ 
                instruction, 
                context, 
                language, 
                max_tokens: maxTokens,
                temperature: temperature,
                model: vscode.workspace.getConfiguration('aiAssistant').get('model') || undefined
            }),
            signal,
        });
        if (!res.ok) {
            throw new Error(`Generate failed: ${res.status}`);
        }
        return consumeTextStream(res, onToken);
    }

    async generate(
        instruction: string,
        context = '',
        language = 'text',
        maxTokens = 2048
    ): Promise<string> {
        const res = await fetch(`${this.baseUrl}/generate`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ 
                instruction, 
                context, 
                language, 
                max_tokens: maxTokens,
                model: vscode.workspace.getConfiguration('aiAssistant').get('model') || undefined
            })
        });
        if (!res.ok) {
            throw new Error(`Generate failed: ${res.status}`);
        }
        return res.text();
    }

    // ── RAG indexing ──────────────────────────────────────────────────────────

    async indexProject(
        projectPath: string,
        extensions?: string[],
        excludeDirs?: string[]
    ): Promise<{ status: string; message: string }> {
        const res = await fetch(`${this.baseUrl}/index/project`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
                project_path: projectPath,
                ...(extensions  ? { extensions }   : {}),
                ...(excludeDirs ? { exclude_dirs: excludeDirs } : {}),
            }),
        });
        if (!res.ok) {
            throw new Error(`Index project failed: ${res.status}`);
        }
        return res.json() as Promise<{ status: string; message: string }>;
    }

    // ── Index status ──────────────────────────────────────────────────────────

    async getIndexStatus(): Promise<{
        status: string;
        files_total: number;
        files_done: number;
        chunks_indexed: number;
        error?: string;
    }> {
        const res = await fetch(`${this.baseUrl}/index/status`);
        if (!res.ok) { throw new Error(`Index status failed: ${res.status}`); }
        return res.json() as Promise<{
            status: string;
            files_total: number;
            files_done: number;
            chunks_indexed: number;
            error?: string;
        }>;
    }

    // ── Snippets ─────────────────────────────────────────────────────────────
    
    async saveSnippet(params: { language: string; description: string; code: string; tags: string }): Promise<any> {
        const res = await fetch(`${this.baseUrl}/snippets/save`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(params)
        });
        if (!res.ok) throw new Error(`Save snippet failed: ${res.status}`);
        return res.json();
    }

    async searchSnippets(query: string, language?: string): Promise<any[]> {
        const url = new URL(`${this.baseUrl}/snippets/search`);
        url.searchParams.append('q', query);
        if (language) url.searchParams.append('lang', language);
        
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Search snippets failed: ${res.status}`);
        return res.json();
    }

    async getSuggestion(prefix: string, language: string): Promise<any | null> {
        const url = new URL(`${this.baseUrl}/snippets/suggest`);
        url.searchParams.append('prefix', prefix);
        url.searchParams.append('lang', language);
        
        try {
            const res = await fetch(url.toString());
            if (!res.ok) return null;
            return res.json();
        } catch {
            return null;
        }
    }

    async useSnippet(id: number): Promise<any> {
        const res = await fetch(`${this.baseUrl}/snippets/use/${id}`, { method: 'POST' });
        if (!res.ok) throw new Error(`Use snippet failed: ${res.status}`);
        return res.json();
    }

    // ── Learning Tracker ─────────────────────────────────────────────────────

    async recordError(params: { language: string; error_type: string; message: string; file: string }): Promise<any> {
        const res = await fetch(`${this.baseUrl}/learning/record`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(params)
        });
        if (!res.ok) throw new Error(`Record error failed: ${res.status}`);
        return res.json();
    }

    async getLearningPatterns(): Promise<any[]> {
        const res = await fetch(`${this.baseUrl}/learning/patterns`);
        if (!res.ok) throw new Error(`Get patterns failed: ${res.status}`);
        return res.json();
    }

    async getWeaknesses(): Promise<any[]> {
        const res = await fetch(`${this.baseUrl}/learning/weaknesses`);
        if (!res.ok) throw new Error(`Get weaknesses failed: ${res.status}`);
        return res.json();
    }

    async schedulePrefetch(prefix: string, suffix: string, language: string): Promise<void> {
        try {
            await fetch(`${this.baseUrl}/prefetch/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prefix, suffix, language })
            });
        } catch {
            // Fire and forget
        }
    }

    async queryGraph(query: string, projectPath: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/graph/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, project_path: projectPath })
        });
        if (!res.ok) throw new Error(`Query graph failed: ${res.status}`);
        return res.json();
    }

    async *streamHistoryExplanation(file: string, question: string, projectPath: string): AsyncIterableIterator<string> {
        const res = await fetch(`${this.baseUrl}/git/explain-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: file, question, project_path: projectPath })
        });
        if (!res.ok) throw new Error(`Git history explain failed: ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value);
        }
    }

    // ── History ─────────────────────────────────────────────────────────────

    async createHistorySession(title?: string): Promise<{ id: string }> {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        try {
            const res = await fetch(`${this.baseUrl}/history/session`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ title }),
                signal: ctrl.signal
            });
            if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    async getHistorySessions(): Promise<any[]> {
        const res = await fetch(`${this.baseUrl}/history/sessions`);
        if (!res.ok) throw new Error(`Get sessions failed: ${res.status}`);
        return res.json();
    }

    async getHistoryMessages(sessionId: string): Promise<any[]> {
        const res = await fetch(`${this.baseUrl}/history/session/${sessionId}`);
        if (!res.ok) throw new Error(`Get messages failed: ${res.status}`);
        return res.json();
    }

    async saveHistoryMessage(sessionId: string, role: string, content: string): Promise<any> {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        try {
            const res = await fetch(`${this.baseUrl}/history/message`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ session_id: sessionId, role, content }),
                signal: ctrl.signal
            });
            if (!res.ok) throw new Error(`Save message failed: ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    async deleteHistorySession(sessionId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/history/session/${sessionId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Delete session failed: ${res.status}`);
        return res.json();
    }

    async searchHistory(query: string): Promise<any[]> {
        const res = await fetch(`${this.baseUrl}/history/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error(`Search history failed: ${res.status}`);
        return res.json();
    }
}
