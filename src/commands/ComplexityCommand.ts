import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerComplexityCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.analyzeComplexity', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const text = editor.document.getText();
            if (!text.trim()) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing Code Complexity",
                cancellable: false
            }, async () => {
                try {
                    const prompt = "Analyze each function. Return ONLY valid JSON: [{\"name\":\"func\", \"line\":5, \"score\":7, \"reason\":\"too nested\", \"suggestion\":\"extract helper\"}]. Score 1-10 where 10 is most complex.";
                    const response = await client.streamGenerate(prompt, text, editor.document.languageId);

                    let results = [];
                    try {
                        const jsonMatch = response.match(/\[[\s\S]*\]/);
                        results = JSON.parse(jsonMatch ? jsonMatch[0] : response);
                    } catch (e) {
                        vscode.window.showErrorMessage('Failed to parse complexity analysis.');
                        return;
                    }

                    const panel = vscode.window.createWebviewPanel(
                        'complexityAnalysis',
                        'Code Complexity Analysis',
                        vscode.ViewColumn.Beside,
                        { enableScripts: true }
                    );

                    panel.webview.html = getWebviewContent(results);

                    panel.webview.onDidReceiveMessage(async message => {
                        if (message.type === 'refactor') {
                            await handleRefactor(message.funcName, text, editor.document.languageId, client);
                        }
                    });

                } catch (err) {
                    vscode.window.showErrorMessage('Complexity analysis failed.');
                }
            });
        })
    );
}

async function handleRefactor(funcName: string, fullCode: string, lang: string, client: BackendClient) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Refactoring ${funcName}...`,
        cancellable: false
    }, async () => {
        const prompt = `Simplify and refactor this function to reduce complexity: ${funcName}. Return ONLY the refactored function code without markdown blocks.`;
        const refactored = await client.streamGenerate(prompt, fullCode, lang);
        
        const panel = vscode.window.createWebviewPanel('refactorResult', `Refactored ${funcName}`, vscode.ViewColumn.Active, {});
        panel.webview.html = `<html><body style="background:#1e1e1e;color:#fff;padding:20px;"><pre>${refactored}</pre></body></html>`;
    });
}

function getWebviewContent(results: any[]): string {
    const rows = results.map(r => {
        const color = r.score >= 7 ? '#f14c4c' : (r.score >= 4 ? '#cca700' : '#4ec9b0');
        const width = r.score * 10;
        return `<tr>
            <td>${r.name} (Line ${r.line})</td>
            <td><div style="background:#333;width:100px;height:12px;border-radius:6px;overflow:hidden;"><div style="background:${color};width:${width}px;height:100%;"></div></div></td>
            <td>${r.score}/10</td>
            <td>${r.reason}</td>
            <td><button onclick="refactor('${r.name}')" style="cursor:pointer;background:#007acc;color:white;border:none;padding:4px 8px;border-radius:4px;">Refactor</button></td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><style>
        body { font-family: sans-serif; background:#1e1e1e; color:#ccc; padding:20px; }
        table { width:100%; border-collapse:collapse; margin-top:20px; }
        th, td { text-align:left; padding:12px; border-bottom:1px solid #333; }
        th { background:#252526; color:#fff; }
    </style></head><body>
        <h2>Function Complexity Analysis</h2>
        <table><thead><tr><th>Function</th><th>Visual</th><th>Score</th><th>Reason</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <script>
            const vscode = acquireVsCodeApi();
            function refactor(funcName) { vscode.postMessage({type:'refactor', funcName}); }
        </script>
    </body></html>`;
}
