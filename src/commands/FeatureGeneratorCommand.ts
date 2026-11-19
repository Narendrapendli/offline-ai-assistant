import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerFeatureGeneratorCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.generateFeature', async () => {
            const request = await vscode.window.showInputBox({ 
                prompt: 'Describe the feature you want to build (e.g. \"create a login system with SQLite\")',
                placeHolder: 'Feature description...'
            });
            if (!request) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Generating feature architecture and files...',
                cancellable: false
            }, async () => {
                try {
                    const prompt = `You are a senior developer. Generate a complete implementation for: ${request}. Return ONLY valid JSON: {"files": [{"filename":"auth.py", "content":"..."}, {"filename":"database.py", "content":"..."}], "instructions":"How to use these files", "dependencies":["bcrypt","jwt"]}`;
                    const response = await client.generate(prompt);
                    
                    const jsonStart = response.indexOf('{');
                    const jsonEnd = response.lastIndexOf('}') + 1;
                    const result = JSON.parse(response.substring(jsonStart, jsonEnd));

                    const wsFolders = vscode.workspace.workspaceFolders;
                    if (!wsFolders) return;
                    const rootUri = wsFolders[0].uri;

                    for (const file of result.files) {
                        const fileUri = vscode.Uri.joinPath(rootUri, file.filename);
                        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content));
                    }

                    FeatureGeneratorPanel.createOrShow(result);
                } catch (err) {
                    vscode.window.showErrorMessage(`Feature generation failed: ${err}`);
                }
            });
        })
    );
}

class FeatureGeneratorPanel {
    public static currentPanel: FeatureGeneratorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel, data: any) {
        this._panel = panel;
        this._update(data);
        this._panel.onDidDispose(() => { FeatureGeneratorPanel.currentPanel = undefined; });
    }

    public static createOrShow(data: any) {
        if (FeatureGeneratorPanel.currentPanel) {
            FeatureGeneratorPanel.currentPanel._update(data);
            FeatureGeneratorPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel('featureGen', 'Feature Generated', vscode.ViewColumn.Two, { enableScripts: true });
        FeatureGeneratorPanel.currentPanel = new FeatureGeneratorPanel(panel, data);
    }

    private _update(data: any) {
        const filesList = data.files.map((f: any) => `<li><code>${f.filename}</code></li>`).join('');
        const depsList = data.dependencies.map((d: any) => `<code>${d}</code>`).join(', ');

        this._panel.webview.html = `
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; padding: 20px; background: #1e1e1e; color: #ccc; }
                    .card { background: #252526; border: 1px solid #333; padding: 20px; border-radius: 8px; }
                    h2 { color: #4ec9b0; }
                    pre { background: #111; padding: 10px; border-radius: 4px; border: 1px solid #222; white-space: pre-wrap; }
                    code { color: #ce9178; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>🚀 Feature Successfully Generated</h2>
                    <p>The following files have been created in your workspace:</p>
                    <ul>${filesList}</ul>
                    
                    <h3>📦 Dependencies to Install:</h3>
                    <p>${depsList || 'None'}</p>
                    <pre>pip install ${data.dependencies.join(' ')}</pre>

                    <h3>📖 Usage Instructions:</h3>
                    <p>${data.instructions}</p>
                </div>
            </body>
            </html>
        `;
    }
}
