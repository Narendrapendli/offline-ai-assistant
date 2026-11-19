import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { BackendClient } from '../clients/BackendClient';
import { FileCommandParser } from '../utils/FileCommandParser';
import { TerminalAI } from '../commands/TerminalCommand';

const SYSTEM_PROMPTS: Record<string, string> = {
    '/explain': "You are an expert software engineer. Explain the provided code concisely. Use bullet points for key concepts. Focus on 'why' and 'how'.",
    '/fix': "You are a senior debugger. Identify bugs, security vulnerabilities, and logic errors in the code. For each bug, describe the issue and provide the fix. Finally, provide the full corrected code.",
    '/test': "You are a QA engineer. Write comprehensive unit tests for the provided code using standard testing frameworks (e.g., pytest, jest, unittest). Ensure edge cases are covered.",
    '/optimize': "You are a performance specialist. Analyze the time and space complexity. Identify bottlenecks and suggest optimized versions with better complexity if possible.",
    '/translate': "You are a polyglot programmer. Translate the provided code to the requested language (or the most appropriate one if not specified), preserving logic and idiomatic patterns.",
    '/review': "You are a senior reviewer. Conduct a thorough code review. Grade the code (A-F) based on readability, maintainability, and correctness. List critical issues first.",
    '/docstring': "You are a technical writer. Generate high-quality, descriptive docstrings or comments for the provided code following the language's standard conventions (e.g., Google or Sphinx for Python)."
};

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-assistant.chatView';
    
    private client: BackendClient;
    private _view?: vscode.WebviewView;
    private conversationHistory: Array<{role: 'user'|'assistant'|'system', content: string}> = [];
    private currentSessionId?: string;
    private abortController?: AbortController;
    private pendingQuery?: string;

    constructor(private readonly extensionUri: vscode.Uri, client: BackendClient) {
        this.client = client;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
        this._setWebviewHtml(webviewView.webview);
        
        // Load history but don't force create a new session if we already have one
        this.handleLoadHistory();

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'newMessage': await this.handleNewMessage(message.value); break;
                case 'cancelGeneration': this.abortController?.abort(); break;
                case 'clearChat': this.conversationHistory = []; break;
                case 'insertCode': this.insertCodeIntoEditor(message.value); break;
                case 'runSnippet': await this.handleRunSnippet(message.id, message.lang, message.code); break;
                case 'getFileSuggestions': await this.handleGetFileSuggestions(message.value); break;
                case 'inlineDiff': await this.handleInlineDiff(message.value); break;
                case 'loadHistory': await this.handleLoadHistory(); break;
                case 'loadSession': await this.handleLoadSession(message.id); break;
                case 'deleteSession': await this.handleDeleteSession(message.id); break;
                case 'searchHistory': await this.handleSearchHistory(message.query); break;
                case 'runTerminal': await this.handleRunTerminal(message.command); break;
                case 'getModels': await this.handleGetModels(); break;
                case 'setModel': await this.handleSetModel(message.model); break;
            }
        });

        if (this.pendingQuery) {
            this.handleNewMessage(this.pendingQuery);
            this.pendingQuery = undefined;
        }
    }

    private async handleRunSnippet(id: string, lang: string, code: string) {
        const startTime = Date.now();
        const tmpDir = os.tmpdir();
        const ext = (lang === 'python' || lang === 'py') ? '.py' : (lang === 'cpp' || lang === 'c++') ? '.cpp' : (lang === 'java') ? '.java' : '.txt';
        const tmpFileName = lang === 'java' ? 'Snippet' : `ai_snippet_${id}`;
        const tmpFile = path.join(tmpDir, `${tmpFileName}${ext}`);
        
        try {
            fs.writeFileSync(tmpFile, code);
            
            let command = '';
            if (ext === '.py') {
                command = `python "${tmpFile}"`;
            } else if (ext === '.cpp') {
                const exeFile = path.join(tmpDir, `ai_snippet_${id}.exe`);
                command = `g++ "${tmpFile}" -static-libgcc -static-libstdc++ -o "${exeFile}" && "${exeFile}"`;
            } else if (ext === '.java') {
                command = `java "${tmpFile}"`;
            }

            if (!command) {
                this._view?.webview.postMessage({ type: 'executionResult', id, success: false, output: 'Unsupported language for execution.', duration: 0 });
                return;
            }

            cp.exec(command, { timeout: 10000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
                const duration = Date.now() - startTime;
                let output = (stdout + stderr).trim();
                
                if (error && error.killed) {
                    output += '\n\n[Warning]: Execution timed out or hung! Background snippet execution currently does not support interactive inputs (like `input()` or `cin`).';
                } else if (!output && error) {
                    output = error.message;
                }

                this._view?.webview.postMessage({ 
                    type: 'executionResult', 
                    id, 
                    success: !error, 
                    output: output.trim() || 'No output.', 
                    duration 
                });
                
                // Cleanup temp files
                try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
                if (ext === '.cpp') {
                    const exeFile = path.join(tmpDir, `ai_snippet_${id}.exe`);
                    try { if (fs.existsSync(exeFile)) fs.unlinkSync(exeFile); } catch {}
                }
            });

        } catch (err) {
            this._view?.webview.postMessage({ type: 'executionResult', id, success: false, output: `Execution setup failed: ${err}`, duration: 0 });
        }
    }

    public async streamContextMenuCommand(prompt: string, code: string, language: string) {
        if (this._view) {
            this._view.show?.(true);
            await this.handleNewMessage(`${prompt}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\``);
        } else {
            this.pendingQuery = `${prompt}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\``;
            vscode.commands.executeCommand('ai-assistant.chatView.focus');
        }
    }

    public askQuery(query: string) {
        if (this._view) {
            this._view.show?.(true);
            this.handleNewMessage(query);
        } else {
            this.pendingQuery = query;
            vscode.commands.executeCommand('ai-assistant.chatView.focus');
        }
    }

    private async handleNewMessage(text: string, systemPromptOverride?: string) {
        if (!text.trim() || !this._view) return;

        this._view.webview.postMessage({ type: 'userMessage', value: text });

        let systemPrompt = systemPromptOverride || "";
        let userMessage = text;

        // Detect slash commands at the start
        const firstWord = text.split(/\s+/)[0];
        if (SYSTEM_PROMPTS[firstWord]) {
            systemPrompt = SYSTEM_PROMPTS[firstWord];
            userMessage = text.substring(firstWord.length).trim() || "Analyze the following context.";
        }

        const cmd = FileCommandParser.parse(userMessage);
        let enrichedPrompt = userMessage;
        let codeContext = '';
        const editor = vscode.window.activeTextEditor;

        // Detect @filename mentions — use resolveFileContent which checks open docs first
        const atMentions = userMessage.match(/@([-\w.]+\.\w+)/g);
        if (atMentions) {
            let mentionContext = "=== REFERENCED FILES ===\n";
            for (const mention of atMentions) {
                const filename = mention.substring(1);
                const content = await this.resolveFileContent(filename);
                if (content) {
                    const lang = filename.split('.').pop() || 'text';
                    mentionContext += `FILE: ${filename}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
                } else {
                    mentionContext += `FILE: ${filename}\n(File not found or empty)\n\n`;
                }
            }
            enrichedPrompt = mentionContext + "\n=== USER QUERY ===\n" + userMessage;
        }
        
        if (cmd && cmd.type !== 'none') {
            const fileContent = await this.resolveFileContent(cmd.filename);
            if (fileContent) {
                try {
                    const content = fileContent;
                    if (cmd.type === 'fix') {
                        enrichedPrompt = `Fix all bugs in this file. Be extremely concise. For each bug: "Line X: [Problem] -> [Fix]". Then provide the full fixed code.\n\nFile: ${cmd.filename}\n\`\`\`\n${content}\n\`\`\``;
                    } else if (cmd.type === 'analyze') {
                        enrichedPrompt = `Explain this file concisely. Use bullet points.\n\nFile: ${cmd.filename}\n\`\`\`\n${content}\n\`\`\``;
                    } else if (cmd.type === 'review') {
                        enrichedPrompt = `Senior Review: List top 3-5 issues concisely (Critical/Warning). File: ${cmd.filename}\n\`\`\`\n${content}\n\`\`\``;
                    } else if (cmd.type === 'optimize') {
                        enrichedPrompt = `Algorithm Check: Identify complexity and suggest a faster way if possible. File: ${cmd.filename}\n\`\`\`\n${content}\n\`\`\``;
                    } else if (cmd.type === 'write') {
                        codeContext = content;
                    } else if (cmd.type === 'run') {
                        const runFiles = await vscode.workspace.findFiles(`**/${cmd.filename}`, '{**/node_modules/**,**/.venv/**}', 1);
                        if (runFiles.length > 0) {
                            await this.runFile(runFiles[0], cmd.filename);
                        } else {
                            this._view.webview.postMessage({ type: 'error', value: `File not found: ${cmd.filename}` });
                        }
                        return;
                    }
                    this._view.webview.postMessage({ type: 'token', value: `*⚙️ Analyzing ${cmd.filename}...*\n\n` });
                } catch (e) {
                    this._view.webview.postMessage({ type: 'error', value: `Could not read file ${cmd.filename}` });
                }
            }
        } else if (editor) {
            // Smart context: Only send full file if user hasn't pasted a code block in the message
            const hasCodeBlock = text.includes('```');
            if (!hasCodeBlock) {
                codeContext = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
                if (codeContext.length > 5000) codeContext = codeContext.substring(0, 5000) + '... (truncated)';
            }
        }

        if (!cmd || cmd.type !== 'run') {
            const waitMsg = text.length > 50 ? "*🧠 Deep Thinking (this may take a few seconds)...*\n\n" : "*🧠 Thinking...*\n\n";
            this._view.webview.postMessage({ type: 'token', value: waitMsg });
        }

        if (TerminalAI.detectTerminalIntent(text)) {
            const terminalResult = await TerminalAI.processMessage(text, this.client);
            if (terminalResult) {
                this._view.webview.postMessage({ 
                    type: 'terminalCommand', 
                    command: terminalResult.command, 
                    explanation: terminalResult.explanation,
                    safe: terminalResult.safe
                });
                return;
            }
        }

        this.abortController?.abort();
        this.abortController = new AbortController();

        try {
            if (!this.currentSessionId) {
                await this.createNewSession();
            }

            // ONLY save the original raw text to history to prevent context explosion
            this.conversationHistory.push({ role: 'user', content: userMessage });
            if (this.currentSessionId) {
                await this.client.saveHistoryMessage(this.currentSessionId, 'user', userMessage);
            }
            this._boundHistory();
            const config = vscode.workspace.getConfiguration('ai-assistant');
            const temp = config.get<number>('temperature') ?? 0.7;
            const maxTokens = config.get<number>('maxTokens') ?? 500;
            const customSystemPrompt = config.get<string>('systemPrompt');
            // chatModel is set either by model picker or VS Code settings
            const chatModel = config.get<string>('chatModel') || undefined;

            const finalSystemPrompt = customSystemPrompt || systemPrompt;

            const historySlice = this.conversationHistory.slice(-5);
            
            // Build the messages for this specific inference call
            // We use enrichedPrompt for the current turn, but history has the raw texts
            const currentMessages = finalSystemPrompt ? [{ role: 'system', content: finalSystemPrompt }] : [];
            for (let i = 0; i < historySlice.length; i++) {
                if (i === historySlice.length - 1 && historySlice[i].role === 'user') {
                    // Inject the enriched prompt (with @mentions/slash commands) ONLY into the current turn's message
                    currentMessages.push({ role: 'user', content: enrichedPrompt });
                } else {
                    currentMessages.push(historySlice[i]);
                }
            }

            const generator = this.client.streamChat({
                messages: currentMessages as Array<{role: string, content: string}>,
                code_context: codeContext || undefined,
                language: editor?.document.languageId || 'plaintext',
                temperature: temp,
                max_tokens: maxTokens,
                model: chatModel
            }, this.abortController.signal);


            let assistantReply = '';
            for await (const chunk of generator) {
                if (this.abortController.signal.aborted) break;
                assistantReply += chunk;
                this._view.webview.postMessage({ type: 'token', value: chunk });
            }

            if (!this.abortController.signal.aborted) {
                this._view.webview.postMessage({ type: 'done', model: chatModel || 'phi3:mini' });
                this.conversationHistory.push({ role: 'assistant', content: assistantReply });
                if (this.currentSessionId) {
                    await this.client.saveHistoryMessage(this.currentSessionId, 'assistant', assistantReply);
                }
                this._boundHistory();

                if (cmd && cmd.type === 'write') {
                    await this.handleFileWriting(cmd.filename, assistantReply);
                }
            }
        } catch (error) {
            console.error('Chat stream error:', error);
            if ((error as Error).name !== 'AbortError') {
                this._view.webview.postMessage({ type: 'error', value: `Request failed: ${(error as Error).message}` });
            } else {
                this._view.webview.postMessage({ type: 'error', value: `Request cancelled or timed out.` });
            }
        } finally {
            this._view.webview.postMessage({ type: 'done' });
        }
    }

    /**
     * Resolve a @mentioned filename to its text content.
     * Priority:
     *   1. Any currently open text document (includes untitled/unsaved files)
     *   2. Any file on disk found via workspace search
     * Returns null when the file cannot be found.
     */
    private async resolveFileContent(filename: string): Promise<string | null> {
        const nameLower = filename.toLowerCase();
        const nameNoExt = nameLower.replace(/\.\w+$/, '');

        // 1. Search all open documents (covers untitled & unsaved files)
        const openDoc = vscode.workspace.textDocuments.find(d => {
            const base = path.basename(d.uri.fsPath).toLowerCase();
            const baseNoExt = path.basename(d.uri.fsPath, path.extname(d.uri.fsPath)).toLowerCase();
            // Match "untitled-1.py" → "untitled-1" as well as exact matches
            return base === nameLower || baseNoExt === nameNoExt;
        });
        if (openDoc) {
            const text = openDoc.getText();
            if (text.trim()) { return text; }
        }

        // 2. Search workspace disk files
        try {
            const found = await vscode.workspace.findFiles(
                `**/${filename}`,
                '{**/node_modules/**,**/.venv/**,**/dist/**}',
                1
            );
            if (found.length > 0) {
                const bytes = await vscode.workspace.fs.readFile(found[0]);
                return bytes.toString();
            }
        } catch { /* file not found on disk */ }

        return null;
    }

    private async handleFileWriting(filename: string, aiResponse: string) {
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;
        const blocks: {lang: string, code: string}[] = [];
        while ((match = codeBlockRegex.exec(aiResponse)) !== null) {
            blocks.push({ lang: match[1]?.toLowerCase() || '', code: match[2] });
        }

        const ext = path.extname(filename).toLowerCase().replace('.', '');
        const bestBlock = blocks.find(b => b.lang.includes(ext) || ext.includes(b.lang) || (ext === 'c++' && b.lang === 'cpp') || (ext === 'cpp' && b.lang === 'c++')) || blocks[0];
        const codeToWrite = bestBlock ? bestBlock.code : aiResponse;

        try {
            // For file writing we need the actual URI — resolve from workspace
            const found = await vscode.workspace.findFiles(`**/${filename}`, '{**/node_modules/**,**/.venv/**}', 1);
            let fileUri: vscode.Uri;
            if (found.length > 0) {
                fileUri = found[0];
            } else {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) { return; }
                fileUri = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, filename));
            }
            try { await vscode.workspace.fs.stat(fileUri); } catch { await vscode.workspace.fs.writeFile(fileUri, new Uint8Array()); }

            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
            await editor.edit(editBuilder => {
                const position = new vscode.Position(document.lineCount, 0);
                editBuilder.insert(position, (document.getText().length > 0 ? '\n\n' : '') + codeToWrite);
            });
            await document.save();
            this._view?.webview.postMessage({ type: 'token', value: `\n\n✅ **Written to ${filename}**` });
            this._view?.webview.postMessage({ type: 'done' });
        } catch (err) {
            vscode.window.showErrorMessage(`AI: Failed to write to file: ${err}`);
        }
    }

    private async runFile(fileUri: vscode.Uri, filename: string) {
        this._view?.webview.postMessage({ type: 'token', value: `\n\n▶ **Running ${filename}...**\n` });
        const ext = path.extname(filename);
        let cmd = '';
        if (ext === '.py') cmd = `python "${fileUri.fsPath}"`;
        else if (ext === '.js') cmd = `node "${fileUri.fsPath}"`;
        else {
             this._view?.webview.postMessage({ type: 'token', value: `❌ Cannot run ${ext} files automatically.` });
             this._view?.webview.postMessage({ type: 'done' });
             return;
        }

        cp.exec(cmd, { timeout: 10000, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
            let output = (stdout + stderr).trim();
            if (err && err.killed) {
                output += '\n\n[Warning]: Execution timed out or hung! Background execution currently does not support interactive inputs.';
            } else if (!output && err) {
                output = err.message;
            }
            if (!output) output = 'Process exited with no output.';
            
            this._view?.webview.postMessage({ type: 'token', value: `\`\`\`\n${output}\n\`\`\`` });
            this._view?.webview.postMessage({ type: 'done' });
        });
    }

    private _boundHistory() { if (this.conversationHistory.length > 20) this.conversationHistory = this.conversationHistory.slice(-20); }
    private async insertCodeIntoEditor(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        await editor.edit(eb => eb.replace(editor.selection, code));
    }

    private async handleGetFileSuggestions(query: string) {
        if (!this._view) return;
        // Limit to 10 suggestions for performance
        const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
        const fileNames = files.map(f => path.basename(f.fsPath));
        this._view.webview.postMessage({ type: 'fileSuggestions', value: fileNames });
    }

    private async handleInlineDiff(newText: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor to apply diff.');
            return;
        }

        // Use selection if it's not empty, otherwise we might want to suggest selecting something
        if (editor.selection.isEmpty) {
            vscode.window.showInformationMessage('Please select the code you want to replace with the suggested diff.');
            return;
        }

        await vscode.commands.executeCommand('ai-assistant.inlineDiff', editor, editor.selection, newText);
    }

    private async createNewSession() {
        try {
            const res = await this.client.createHistorySession();
            this.currentSessionId = res.id;
        } catch (e) {
            console.error('Failed to create chat session', e);
        }
    }

    private async handleLoadHistory() {
        if (!this._view) return;
        try {
            const sessions = await this.client.getHistorySessions();
            this._view.webview.postMessage({ type: 'historyList', value: sessions });
        } catch (e) {
            console.error('Failed to load history', e);
        }
    }

    private async handleLoadSession(id: string) {
        if (!this._view) return;
        try {
            const messages = await this.client.getHistoryMessages(id);
            this.currentSessionId = id;
            this.conversationHistory = messages.map((m: any) => ({ role: m.role, content: m.content }));
            this._view.webview.postMessage({ type: 'chatLoaded', value: messages });
        } catch (e) {
            console.error('Failed to load session', e);
        }
    }

    private async handleDeleteSession(id: string) {
        try {
            await this.client.deleteHistorySession(id);
            if (this.currentSessionId === id) {
                this.createNewSession();
                this.conversationHistory = [];
                this._view?.webview.postMessage({ type: 'clearChat' });
            }
            this.handleLoadHistory();
        } catch (e) {
            console.error('Failed to delete session', e);
        }
    }

    private async handleSearchHistory(query: string) {
        if (!this._view) return;
        try {
            const results = await this.client.searchHistory(query);
            this._view.webview.postMessage({ type: 'searchResults', value: results });
        } catch (e) {
            console.error('Failed to search history', e);
        }
    }

    private async handleRunTerminal(command: string) {
        TerminalAI.executeInTerminal(command);
    }

    /**
     * Fetch all locally installed Ollama models from the backend
     * and send the list back to the webview model picker.
     */
    private async handleGetModels() {
        if (!this._view) { return; }
        try {
            const res = await fetch('http://127.0.0.1:8000/models/list');
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            const data = await res.json() as { models: Array<{name:string;size_gb:number|null;modified_at:string}>; active: string };
            this._view.webview.postMessage({
                type: 'modelList',
                models: data.models,
                active: data.active
            });
        } catch (err) {
            // Backend may not be up yet — try direct Ollama as fallback
            try {
                const res = await fetch('http://localhost:11434/api/tags');
                if (!res.ok) { throw new Error(`Ollama HTTP ${res.status}`); }
                const data = await res.json() as { models: Array<{name:string;size:number}> };
                const models = data.models.map(m => ({
                    name: m.name,
                    size_gb: m.size ? Math.round(m.size / 1_073_741_824 * 10) / 10 : null,
                    modified_at: ''
                }));
                const config = vscode.workspace.getConfiguration('ai-assistant');
                const active = config.get<string>('chatModel') || (models[0]?.name ?? 'phi3:mini');
                this._view.webview.postMessage({ type: 'modelList', models, active });
            } catch {
                this._view.webview.postMessage({ type: 'modelList', models: [], active: 'phi3:mini' });
            }
        }
    }

    /**
     * Save the user-selected model to VS Code configuration so all subsequent
     * chat requests use it (chatProvider already reads chatModel from config).
     */
    private async handleSetModel(modelName: string) {
        await vscode.workspace.getConfiguration('ai-assistant').update(
            'chatModel',
            modelName,
            vscode.ConfigurationTarget.Global
        );
        vscode.window.setStatusBarMessage(`🧠 AI Model: ${modelName}`, 4000);
    }

    private _setWebviewHtml(wv: vscode.Webview) {
        const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'chat.html');
        try { if (fs.existsSync(htmlPath)) { wv.html = fs.readFileSync(htmlPath, 'utf8'); return; } } catch(e) {}
        wv.html = `<!DOCTYPE html><html><body><h1>Error loading Chat UI</h1></body></html>`;
    }
}
