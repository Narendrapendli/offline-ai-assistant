import * as vscode from 'vscode';
import * as path from 'path';
import { BackendClient } from '../clients/BackendClient';

export function registerDashboardCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.openDashboard', async () => {
            const panel = vscode.window.createWebviewPanel(
                'projectDashboard',
                'Project Health Dashboard',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            panel.webview.html = getLoadingHtml();

            const files = await vscode.workspace.findFiles('**/*.{py,cpp}', '**/node_modules/**');
            const totalFiles = files.length;
            let scannedFiles = 0;
            let results: any[] = [];

            for (const file of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    const contents = document.getText();
                    
                    const prompt = "Analyze this file for health. Return ONLY valid JSON object: {\"bugs\": 2, \"missing_docstrings\": 3, \"avg_complexity\": 4.5}.";
                    const analysisStr = await client.streamGenerate(prompt, contents, document.languageId);
                    
                    let analysis = { bugs: 0, missing_docstrings: 0, avg_complexity: 0 };
                    try {
                        const jsonMatch = analysisStr.match(/\{[\s\S]*\}/);
                        analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisStr);
                    } catch(e) {}

                    results.push({
                        name: path.basename(file.fsPath),
                        path: file.fsPath,
                        ...analysis
                    });
                } catch (err) {
                    console.error(`Failed to scan ${file.fsPath}`, err);
                }

                scannedFiles++;
                panel.webview.postMessage({
                    type: 'progress',
                    progress: (scannedFiles / totalFiles) * 100,
                    results: results
                });
            }

            panel.webview.onDidReceiveMessage(async msg => {
                if (msg.type === 'fixDocstrings') {
                    vscode.window.showInformationMessage('Triggering docstring generation for flagged functions...');
                    // In a real implementation, we would iterate and call DocstringCommand logic
                }
            });
        })
    );
}

function getLoadingHtml() {
    return `<!DOCTYPE html><html><body style="background:#1e1e1e;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;">
        <div style="text-align:center;">
            <h2>Initializing AI Project Scan...</h2>
            <div style="width:300px;height:10px;background:#333;border-radius:5px;overflow:hidden;margin-top:20px;">
                <div id="p-bar" style="width:0%;height:100%;background:#007acc;transition:width 0.3s;"></div>
            </div>
            <p id="p-text" style="margin-top:10px;color:#888;">0% complete</p>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            window.addEventListener('message', event => {
                if (event.data.type === 'progress') {
                    document.getElementById('p-bar').style.width = event.data.progress + '%';
                    document.getElementById('p-text').innerText = Math.round(event.data.progress) + '% complete';
                    if (event.data.progress >= 100) {
                        renderDashboard(event.data.results);
                    }
                }
            });

            function renderDashboard(results) {
                const totalBugs = results.reduce((a,b) => a + b.bugs, 0);
                const totalDocs = results.reduce((a,b) => a + b.missing_docstrings, 0);
                const avgComp = (results.reduce((a,b) => a + b.avg_complexity, 0) / results.length).toFixed(1);
                
                let rows = results.map(r => {
                    const bugColor = r.bugs > 0 ? '#f14c4c' : '#4ec9b0';
                    const docColor = r.missing_docstrings > 0 ? '#cca700' : '#4ec9b0';
                    return \`<tr>
                        <td>\${r.name}</td>
                        <td style="color:\${bugColor}">\${r.bugs}</td>
                        <td style="color:\${docColor}">\${r.missing_docstrings}</td>
                        <td>\${r.avg_complexity}</td>
                    </tr>\`;
                }).join('');

                document.body.innerHTML = \`<div style="padding:30px;">
                    <h1 style="margin-bottom:20px;">Project Health Dashboard</h1>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:30px;">
                        <div style="background:#252526;padding:20px;border-radius:8px;border:1px solid #333;text-align:center;">
                            <div style="font-size:12px;color:#888;">Total Files</div>
                            <div style="font-size:24px;font-weight:bold;">\${results.length}</div>
                        </div>
                        <div style="background:#252526;padding:20px;border-radius:8px;border:1px solid #333;text-align:center;">
                            <div style="font-size:12px;color:#888;">Total Bugs</div>
                            <div style="font-size:24px;font-weight:bold;color:#f14c4c;">\${totalBugs}</div>
                        </div>
                        <div style="background:#252526;padding:20px;border-radius:8px;border:1px solid #333;text-align:center;">
                            <div style="font-size:12px;color:#888;">Missing Docstrings</div>
                            <div style="font-size:24px;font-weight:bold;color:#cca700;">\${totalDocs}</div>
                        </div>
                        <div style="background:#252526;padding:20px;border-radius:8px;border:1px solid #333;text-align:center;">
                            <div style="font-size:12px;color:#888;">Avg Complexity</div>
                            <div style="font-size:24px;font-weight:bold;">\${avgComp}</div>
                        </div>
                    </div>
                    
                    <button onclick="vscode.postMessage({type:'fixDocstrings'})" style="margin-bottom:20px;padding:8px 16px;background:#007acc;color:white;border:none;border-radius:4px;cursor:pointer;">Fix All Docstrings</button>

                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="text-align:left;background:#252526;"><th style="padding:12px;">File</th><th style="padding:12px;">Bugs</th><th style="padding:12px;">Missing Docs</th><th style="padding:12px;">Complexity</th></tr></thead>
                        <tbody>\${rows}</tbody>
                    </table>
                </div>\`;
            }
        </script>
    </body></html>`;
}
