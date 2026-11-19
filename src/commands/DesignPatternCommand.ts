import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerDesignPatternCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.suggestPatterns', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            DesignPatternPanel.createOrShow(client, editor.document.getText(), editor.document.languageId);
        })
    );
}

class DesignPatternPanel {
    public static currentPanel: DesignPatternPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, private client: BackendClient, content: string, language: string) {
        this._panel = panel;
        this._update(content, language);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async message => {
            if (message.type === 'applyPattern') {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const fullRange = new vscode.Range(
                        editor.document.positionAt(0),
                        editor.document.positionAt(editor.document.getText().length)
                    );
                    await editor.edit(editBuilder => {
                        editBuilder.replace(fullRange, message.code);
                    });
                    vscode.window.showInformationMessage(`Applied ${message.pattern} pattern.`);
                }
            }
        }, null, this._disposables);
    }

    public static createOrShow(client: BackendClient, content: string, language: string) {
        if (DesignPatternPanel.currentPanel) {
            DesignPatternPanel.currentPanel._update(content, language);
            DesignPatternPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'designPatterns',
            'Design Pattern Advisor',
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        DesignPatternPanel.currentPanel = new DesignPatternPanel(panel, client, content, language);
    }

    private async _update(content: string, language: string) {
        this._panel.webview.html = this._getHtmlForLoading();
        
        const prompt = `Analyze this ${language} code and suggest appropriate design patterns. For each suggestion: (1) Pattern name, (2) Why it applies to this code, (3) Benefits it would bring, (4) Complete refactored code using the pattern, (5) Before and after comparison. Consider: Creational patterns (Singleton, Factory, Builder), Structural patterns (Decorator, Adapter, Facade), Behavioral patterns (Observer, Strategy, Command). Return ONLY a JSON array of objects: [{"pattern":"Singleton", "reason":"...", "benefit":"...", "before":"...", "after":"..."}]`;

        try {
            const response = await this.client.generate(prompt, content, language, 3000);
            // Extraction logic for JSON
            const jsonStart = response.indexOf('[');
            const jsonEnd = response.lastIndexOf(']') + 1;
            const suggestions = JSON.parse(response.substring(jsonStart, jsonEnd));
            this._panel.webview.html = this._getHtmlForSuggestions(suggestions);
        } catch (err) {
            this._panel.webview.html = `<h3>Error: Could not analyze code.</h3><pre>${err}</pre>`;
        }
    }

    public dispose() {
        DesignPatternPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getHtmlForLoading() {
        return `<html><body style="background:#1e1e1e;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="text-align:center;">
                <div class="spinner"></div>
                <p>Analyzing architecture for design patterns...</p>
            </div>
            <style>.spinner { border: 4px solid rgba(255,255,255,0.1); border-left-color: #007acc; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: auto; } @keyframes spin { to { transform: rotate(360deg); } }</style>
        </body></html>`;
    }

    private _getHtmlForSuggestions(suggestions: any[]) {
        const cards = suggestions.map((s, i) => `
            <div class="card">
                <div class="header">
                    <span class="title">${s.pattern}</span>
                    <button onclick="applySnippet(${i})">Apply Pattern</button>
                </div>
                <div class="body">
                    <p><strong>Reason:</strong> ${s.reason}</p>
                    <p><strong>Benefit:</strong> ${s.benefit}</p>
                    <div class="comparison">
                        <div class="code-block">
                            <label>Before</label>
                            <pre><code>${this._escapeHtml(s.before)}</code></pre>
                        </div>
                        <div class="code-block">
                            <label>After</label>
                            <pre><code>${this._escapeHtml(s.after)}</code></pre>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }
                .card { background: #252526; border: 1px solid #333; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
                .header { background: #333; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; }
                .title { font-weight: bold; color: #4ec9b0; font-size: 1.1em; }
                .body { padding: 15px; }
                button { background: #007acc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
                button:hover { background: #0062a3; }
                .comparison { display: flex; gap: 10px; margin-top: 15px; }
                .code-block { flex: 1; background: #111; padding: 10px; border-radius: 4px; border: 1px solid #222; }
                .code-block label { display: block; font-size: 0.8em; color: #888; margin-bottom: 5px; text-transform: uppercase; }
                pre { margin: 0; font-size: 0.85em; overflow-x: auto; white-space: pre-wrap; }
                code { color: #d4d4d4; }
            </style>
        </head>
        <body>
            <h2>🏛️ Design Pattern Recommendations</h2>
            ${cards}
            <script>
                const vscode = acquireVsCodeApi();
                const data = ${JSON.stringify(suggestions)};
                function applySnippet(index) {
                    vscode.postMessage({
                        type: 'applyPattern',
                        pattern: data[index].pattern,
                        code: data[index].after
                    });
                }
            </script>
        </body>
        </html>`;
    }

    private _escapeHtml(text: string) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}
