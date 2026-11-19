import * as vscode from 'vscode';

export function registerHelpCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.showHelp', () => {
            HelpPanel.createOrShow();
        })
    );
}

class HelpPanel {
    public static currentPanel: HelpPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => { HelpPanel.currentPanel = undefined; });
    }

    public static createOrShow() {
        if (HelpPanel.currentPanel) {
            HelpPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel('aiHelp', 'Beast AI Help', vscode.ViewColumn.One, { enableScripts: true });
        HelpPanel.currentPanel = new HelpPanel(panel);
    }

    private _update() {
        this._panel.webview.html = `
            <html>
            <head>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 30px; }
                    h1 { color: #58a6ff; border-bottom: 2px solid #30363d; padding-bottom: 15px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); border-radius: 8px; overflow: hidden; }
                    th, td { padding: 12px 20px; text-align: left; border-bottom: 1px solid #30363d; }
                    th { background: #161b22; color: #8b949e; text-transform: uppercase; font-size: 12px; }
                    tr:hover { background: #21262d; }
                    .cmd { color: #aff5b4; font-family: monospace; font-weight: bold; }
                    .key { background: #30363d; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #f0f6fc; }
                    .category { color: #d2a8ff; font-weight: 500; }
                </style>
            </head>
            <body>
                <h1>🩸 Beast AI Assistant: Help & Commands</h1>
                <table>
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th>Feature</th>
                            <th>Command ID</th>
                            <th>Shortcut</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td><span class="category">Chat</span></td><td>Ask anything</td><td class="cmd">ai-assistant.generate</td><td><span class="key">Ctrl + Alt + L</span></td></tr>
                        <tr><td><span class="category">Review</span></td><td>AI Code Review</td><td class="cmd">ai-assistant.reviewCode</td><td><span class="key">Ctrl + Alt + C</span></td></tr>
                        <tr><td><span class="category">Algorithm</span></td><td>Optimize Logic</td><td class="cmd">ai-assistant.analyzeAlgorithms</td><td><span class="key">Ctrl + Alt + A</span></td></tr>
                        <tr><td><span class="category">Interview</span></td><td>Prep Mode</td><td class="cmd">ai-assistant.startInterview</td><td><span class="key">Ctrl + Alt + I</span></td></tr>
                        <tr><td><span class="category">DevOps</span></td><td>Generate README</td><td class="cmd">ai-assistant.generateReadme</td><td>-</td></tr>
                        <tr><td><span class="category">Patterns</span></td><td>Design Advisor</td><td class="cmd">ai-assistant.suggestPatterns</td><td>-</td></tr>
                        <tr><td><span class="category">Library</span></td><td>Save Snippet</td><td class="cmd">ai-assistant.saveSnippet</td><td><span class="key">Ctrl + Alt + S</span></td></tr>
                        <tr><td><span class="category">Library</span></td><td>Search Snippets</td><td class="cmd">ai-assistant.searchSnippets</td><td>-</td></tr>
                        <tr><td><span class="category">Performance</span></td><td>Profile Code</td><td class="cmd">ai-assistant.profileCode</td><td>-</td></tr>
                        <tr><td><span class="category">Learning</span></td><td>Personal Coach</td><td class="cmd">ai-assistant.myWeaknesses</td><td>-</td></tr>
                        <tr><td><span class="category">Translate</span></td><td>Code Language X</td><td class="cmd">ai-assistant.translateCode</td><td><span class="key">Ctrl + Alt + X</span></td></tr>
                        <tr><td><span class="category">Feature</span></td><td>Multi-File Gen</td><td class="cmd">ai-assistant.generateFeature</td><td><span class="key">Ctrl + Alt + F</span></td></tr>
                        <tr><td><span class="category">Logic</span></td><td>Repo-Brain</td><td class="cmd">ai-assistant.repoBrain</td><td><span class="key">Ctrl + Alt + R</span></td></tr>
                        <tr><td><span class="category">History</span></td><td>Time Machine</td><td class="cmd">ai-assistant.gitTimeMachine</td><td><span class="key">Ctrl + Alt + G</span></td></tr>
                        <tr><td><span class="category">Debug</span></td><td>Self-Healing Fix</td><td class="cmd">ai-assistant.healCode</td><td>-</td></tr>
                        <tr><td><span class="category">Git</span></td><td>Explain Diff</td><td class="cmd">ai-assistant.explainGitDiff</td><td>-</td></tr>
                        <tr><td><span class="category">Static</span></td><td>Complexity Analysis</td><td class="cmd">ai-assistant.analyzeComplexity</td><td>-</td></tr>
                        <tr><td><span class="category">Test</span></td><td>Auto Test Generator</td><td class="cmd">ai-assistant.generateTests</td><td>-</td></tr>
                        <tr><td><span class="category">Docs</span></td><td>Generate Docstring</td><td class="cmd">ai-assistant.generateDocstring</td><td>-</td></tr>
                        <tr><td><span class="category">Admin</span></td><td>Live Dashboard</td><td class="cmd">ai-assistant.openDashboard</td><td>-</td></tr>
                    </tbody>
                </table>
            </body>
            </html>
        `;
    }
}
