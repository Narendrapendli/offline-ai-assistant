import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerLearningCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.myWeaknesses', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Analyzing your coding patterns...',
                cancellable: false
            }, async () => {
                try {
                    const patterns = await client.getLearningPatterns();
                    const prompt = `Based on these repeated coding errors: ${JSON.stringify(patterns)}. Create: (1) Analysis of my top 3 weaknesses, (2) Custom practice exercises targeting each weakness with solutions, (3) Tips to avoid these mistakes. Return ONLY JSON: {"weaknesses": [{"title":"Topic", "desc":"..."}], "exercises": [{"task":"...", "hint":"...", "solution":"..."}]}`;
                    const aiReport = await client.generate(prompt);

                    const jsonStart = aiReport.indexOf('{');
                    const jsonEnd = aiReport.lastIndexOf('}') + 1;
                    const report = JSON.parse(aiReport.substring(jsonStart, jsonEnd));

                    LearningPanel.createOrShow(report);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to load learning report: ${err}`);
                }
            });
        })
    );
}

class LearningPanel {
    public static currentPanel: LearningPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel, report: any) {
        this._panel = panel;
        this._update(report);
        this._panel.onDidDispose(() => { LearningPanel.currentPanel = undefined; });
    }

    public static createOrShow(report: any) {
        if (LearningPanel.currentPanel) {
            LearningPanel.currentPanel._update(report);
            LearningPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }
        const panel = vscode.window.createWebviewPanel('learningTracker', 'My Learning Report', vscode.ViewColumn.Two, { enableScripts: true });
        LearningPanel.currentPanel = new LearningPanel(panel, report);
    }

    private _update(report: any) {
        this._panel.webview.html = `
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }
                    .weakness { border-left: 4px solid #f44336; padding: 10px 15px; background: #252526; margin-bottom: 20px; }
                    h3 { color: #ce9178; }
                    .exercise { background: #333; padding: 15px; border-radius: 8px; margin-top: 15px; }
                    button { background: #007acc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
                </style>
            </head>
            <body>
                <h1>📈 Personal Learning Report</h1>
                <h2>Your Top Weaknesses</h2>
                ${report.weaknesses.map((w: any) => `
                    <div class="weakness">
                        <h3>${w.title}</h3>
                        <p>${w.desc}</p>
                    </div>
                `).join('')}

                <h2>💪 Hands-on Practice</h2>
                ${report.exercises.map((e: any, i: number) => `
                    <div class="exercise">
                        <p><strong>Goal:</strong> ${e.task}</p>
                        <p><em>Hint:</em> ${e.hint}</p>
                        <button onclick="showSolution(${i})">Show Solution</button>
                        <pre id="solution-${i}" style="display:none; margin-top:10px; background:#111; padding:10px;"><code>${e.solution}</code></pre>
                    </div>
                `).join('')}

                <script>
                    function showSolution(id) {
                        const el = document.getElementById('solution-' + id);
                        el.style.display = el.style.display === 'none' ? 'block' : 'none';
                    }
                </script>
            </body>
            </html>
        `;
    }
}
