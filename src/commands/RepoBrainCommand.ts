import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerRepoBrainCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.repoBrain', async () => {
            const query = await vscode.window.showInputBox({ 
                prompt: 'What feature or module do you want to understand?',
                placeHolder: 'e.g. auth system, database flow...'
            });
            if (!query) return;

            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Building knowledge graph...',
                cancellable: false
            }, async () => {
                try {
                    const result = await client.queryGraph(query, workspacePath);
                    RepoBrainPanel.createOrShow(result);
                } catch (err) {
                    vscode.window.showErrorMessage(`Repo-Brain failed: ${err}`);
                }
            });
        })
    );
}

class RepoBrainPanel {
    public static currentPanel: RepoBrainPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel, data: any) {
        this._panel = panel;
        this._update(data);
        this._panel.onDidDispose(() => { RepoBrainPanel.currentPanel = undefined; });
    }

    public static createOrShow(data: any) {
        if (RepoBrainPanel.currentPanel) {
            RepoBrainPanel.currentPanel._update(data);
            RepoBrainPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }
        const panel = vscode.window.createWebviewPanel('repoBrain', 'Repo Brain', vscode.ViewColumn.Two, { enableScripts: true });
        RepoBrainPanel.currentPanel = new RepoBrainPanel(panel, data);
    }

    private _update(data: any) {
        this._panel.webview.html = `
            <html>
            <head>
                <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
                <style>
                    body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }
                    #graph { background: #fff; padding: 10px; border-radius: 8px; margin-bottom: 20px; }
                    .file-list { display: flex; flex-wrap: wrap; gap: 10px; }
                    .file-tag { background: #333; padding: 4px 8px; border-radius: 4px; font-family: monospace; cursor: pointer; }
                    .summary { background: #252526; padding: 15px; border-radius: 8px; border-left: 4px solid #4ec9b0; margin-top: 20px; line-height: 1.6; }
                </style>
            </head>
            <body>
                <h1>🧠 Repo-Brain Map</h1>
                <div id="graph" class="mermaid">${data.mermaid}</div>
                
                <h3>📂 Related Files</h3>
                <div class="file-list">
                    ${data.files.map((f: string) => `<span class="file-tag">${f}</span>`).join('')}
                </div>

                <div class="summary">
                    <h3>AI Summary</h3>
                    <p>${data.summary}</p>
                </div>

                <script>
                    mermaid.initialize({ startOnLoad: true, theme: 'default' });
                </script>
            </body>
            </html>
        `;
    }
}
