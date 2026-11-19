import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerGitTimeMachineCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.gitTimeMachine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const question = await vscode.window.showInputBox({ 
                prompt: 'What do you want to know about this code history?',
                placeHolder: 'e.g. why was this changed, when was this function added...'
            });
            if (!question) return;

            const fileName = editor.document.fileName;
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

            GitTimeMachinePanel.createOrShow(fileName);

            try {
                const stream = client.streamHistoryExplanation(fileName, question, workspacePath);
                for await (const chunk of stream) {
                    GitTimeMachinePanel.currentPanel?.appendChunk(chunk);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Git Time Machine failed: ${err}`);
            }
        })
    );
}

class GitTimeMachinePanel {
    public static currentPanel: GitTimeMachinePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _explanation = '';

    private constructor(panel: vscode.WebviewPanel, filename: string) {
        this._panel = panel;
        this._update(filename);
        this._panel.onDidDispose(() => { GitTimeMachinePanel.currentPanel = undefined; });
    }

    public static createOrShow(filename: string) {
        if (GitTimeMachinePanel.currentPanel) {
            GitTimeMachinePanel.currentPanel._update(filename);
            GitTimeMachinePanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }
        const panel = vscode.window.createWebviewPanel('gitTimeMachine', `History: ${filename}`, vscode.ViewColumn.Two, { enableScripts: true });
        GitTimeMachinePanel.currentPanel = new GitTimeMachinePanel(panel, filename);
    }

    public appendChunk(chunk: string) {
        this._explanation += chunk;
        this._panel.webview.postMessage({ type: 'chunk', text: chunk });
    }

    private _update(filename: string) {
        this._panel.webview.html = `
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }
                    .header { color: #569cd6; border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                    .evolution { background: #252526; padding: 15px; border-radius: 8px; border-left: 4px solid #ce9178; line-height: 1.6; white-space: pre-wrap; }
                </style>
            </head>
            <body>
                <h1 class="header">⏳ Git Evolution: ${filename}</h1>
                <div id="content" class="evolution"></div>
                <script>
                    const content = document.getElementById('content');
                    window.addEventListener('message', event => {
                        if (event.data.type === 'chunk') {
                            content.innerText += event.data.text;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}
