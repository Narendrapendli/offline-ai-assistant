import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { BackendClient } from '../clients/BackendClient';

export function registerGitDiffCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.explainGitDiff', async () => {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspacePath) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "AI Analyzing Git Diff",
                cancellable: false
            }, async () => {
                try {
                    let diff = '';
                    try {
                        diff = execSync('git diff HEAD', { cwd: workspacePath }).toString();
                        if (!diff.trim()) {
                            diff = execSync('git diff HEAD~1', { cwd: workspacePath }).toString();
                        }
                    } catch (e) {
                        vscode.window.showErrorMessage('Error running git diff. Ensure git is installed and this is a repository.');
                        return;
                    }

                    if (!diff.trim()) {
                        vscode.window.showInformationMessage('No changes found to explain.');
                        return;
                    }

                    // Limit diff size for LLM
                    if (diff.length > 10000) {
                        diff = diff.slice(0, 10000) + '\n... (diff truncated)';
                    }

                    const prompt = "Explain this git diff in plain English. For each changed file describe what changed and why. Be concise and developer-friendly.";
                    
                    const explanation = await client.streamGenerate(prompt, diff, 'diff');

                    const panel = vscode.window.createWebviewPanel(
                        'gitDiffExplained',
                        'Git Diff Explained',
                        vscode.ViewColumn.One,
                        {}
                    );

                    panel.webview.html = getWebviewContent(explanation);

                } catch (err) {
                    vscode.window.showErrorMessage('Failed to explain git diff.');
                }
            });
        })
    );
}

function getWebviewContent(text: string): string {
    // Basic colorizing for diff-like output or headers
    const htmlBody = text
        .replace(/\n/g, '<br>')
        .replace(/^(diff --git.*$)/gm, '<h3 style="color: #007acc;">$1</h3>')
        .replace(/^\+.*$/gm, '<span style="color: #4ec9b0;">$&</span>')
        .replace(/^-.*$/gm, '<span style="color: #f14c4c;">$&</span>');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: sans-serif; padding: 20px; line-height: 1.6; background-color: #1e1e1e; color: #cccccc; }
            h2 { color: #fff; border-bottom: 1px solid #333; padding-bottom: 10px; }
            .content { background: #252526; padding: 15px; border-radius: 8px; border: 1px solid #333; white-space: pre-wrap; word-wrap: break-word; }
        </style>
    </head>
    <body>
        <h2>Git Diff Explanation</h2>
        <div class="content">${htmlBody}</div>
    </body>
    </html>`;
}
