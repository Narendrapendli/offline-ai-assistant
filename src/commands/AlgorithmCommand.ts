import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerAlgorithmCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.analyzeAlgorithms', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const text = editor.document.getText();
            if (!text.trim()) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing Algorithm Complexity...",
                cancellable: false
            }, async () => {
                try {
                    const prompt = `Analyze every function in this code for time and space complexity. 
                    If complexity is worse than O(n log n), suggest a better algorithm with complete implementation.
                    Return ONLY valid JSON: [
                        {"name": "func", "line": 5, "time": "O(n2)", "space": "O(1)", "canOptimize": true, "suggestion": "Use quicksort instead", "optimizedCode": "def quicksort()..."}
                    ]`;

                    const response = await client.streamGenerate(prompt, text, editor.document.languageId);
                    let results = [];
                    try {
                        const jsonMatch = response.match(/\[[\s\S]*\]/);
                        results = JSON.parse(jsonMatch ? jsonMatch[0] : response);
                    } catch (e) {
                        vscode.window.showErrorMessage('Failed to parse algorithm analysis.');
                        return;
                    }

                    const panel = vscode.window.createWebviewPanel(
                        'algoAnalysis',
                        'Algorithm Optimizer',
                        vscode.ViewColumn.Beside,
                        { enableScripts: true }
                    );
                    panel.title = "Algorithm Optimizer";
                    panel.reveal(vscode.ViewColumn.Beside);

                    panel.webview.html = getAlgoWebviewContent(results);

                    panel.webview.onDidReceiveMessage(async message => {
                        if (message.type === 'optimize') {
                            await handleApplyOptimization(message.funcName, message.code, editor);
                        }
                    });

                } catch (err) {
                    vscode.window.showErrorMessage('Algorithm analysis failed.');
                }
            });
        })
    );
}

async function handleApplyOptimization(funcName: string, optimizedCode: string, editor: vscode.TextEditor) {
    // This is a simplified replacement - in a real app we'd find the specific function range
    // For now, we'll open it in a new document for the user to review
    const doc = await vscode.workspace.openTextDocument({ content: optimizedCode, language: editor.document.languageId });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    vscode.window.showInformationMessage(`Optimization for ${funcName} generated in split view.`);
}

function getAlgoWebviewContent(results: any[]): string {
    const rows = results.map(r => {
        const timeColor = r.time.includes('n2') || r.time.includes('n!') || r.time.includes('2^n') ? '#f14c4c' : 
                         (r.time.includes('n log') || r.time.includes('O(n)') ? '#cca700' : '#4ec9b0');
        
        return `<tr>
            <td><strong>${r.name}</strong><br><span style="color:#666;font-size:11px;">Line ${r.line}</span></td>
            <td><span style="color:${timeColor};font-weight:bold;">${r.time}</span></td>
            <td>${r.space}</td>
            <td>${r.suggestion}</td>
            <td>
                ${r.canOptimize ? `<button onclick="optimize('${r.name}', ${JSON.stringify(r.optimizedCode).replace(/"/g, '&quot;')})">Optimize</button>` : 'Optimal'}
            </td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><style>
        body { font-family: sans-serif; background:#1e1e1e; color:#ccc; padding:20px; }
        table { width:100%; border-collapse:collapse; margin-top:10px; }
        th, td { text-align:left; padding:12px; border-bottom:1px solid #333; }
        th { background:#252526; color:#fff; font-size:13px; }
        td { font-size:13px; }
        button { background:#4ec9b0; border:none; color:#1e1e1e; padding:5px 10px; border-radius:3px; cursor:pointer; font-weight:bold; }
        button:hover { background:#3eb199; }
    </style></head><body>
        <h2>Algorithm Complexity & Optimization</h2>
        <table><thead><tr><th>Function</th><th>Time</th><th>Space</th><th>Suggestion</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <script>
            const vscode = acquireVsCodeApi();
            function optimize(name, code) { vscode.postMessage({type:'optimize', funcName: name, code: code}); }
        </script>
    </body></html>`;
}
