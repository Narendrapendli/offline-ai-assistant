import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerCodeReviewCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.reviewCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found.');
                return;
            }

            const text = editor.document.getText();
            const language = editor.document.languageId;
            if (!text.trim()) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "AI Senior Code Reviewer at work...",
                cancellable: false
            }, async () => {
                try {
                    const prompt = `You are a senior code reviewer. Review this ${language} code and provide detailed feedback. 
                    Be like a GitHub pull request reviewer.
                    Return ONLY a JSON object with this structure:
                    {
                        "score": 8,
                        "issues": [
                            {"line": 5, "severity": "critical", "message": "Security vulnerability here", "suggestion": "Use parameterized queries"},
                            {"line": 12, "severity": "warning", "message": "Complexity is high", "suggestion": "Extract to helper function"},
                            {"line": 20, "severity": "suggestion", "message": "Naming convention", "suggestion": "Rename 'x' to 'userCount'"}
                        ],
                        "bestPractices": ["Excellent error handling", "Consistent spacing"],
                        "security": "No major risks outside listed issues"
                    }`;

                    const response = await client.streamGenerate(prompt, text, language);
                    let result;
                    try {
                        const jsonMatch = response.match(/\{[\s\S]*\}/);
                        result = JSON.parse(jsonMatch ? jsonMatch[0] : response);
                    } catch (e) {
                        vscode.window.showErrorMessage('Failed to parse AI review results.');
                        return;
                    }

                    const panel = vscode.window.createWebviewPanel(
                        'aiCodeReview',
                        'AI Code Review',
                        vscode.ViewColumn.Beside,
                        { enableScripts: true }
                    );

                    panel.webview.html = getReviewWebviewContent(result);

                    panel.webview.onDidReceiveMessage(async message => {
                        if (message.type === 'fix') {
                            await handleApplyFix(message.issue, text, language, client);
                        }
                    });

                } catch (err) {
                    vscode.window.showErrorMessage('AI Code Review failed.');
                }
            });
        })
    );
}

async function handleApplyFix(issue: any, fullCode: string, lang: string, client: BackendClient) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Generating fix for line ${issue.line}...`,
        cancellable: false
    }, async () => {
        const prompt = `Provide a specific fix for this code issue: "${issue.message}". 
        The code is: ${fullCode}
        Focus on line ${issue.line}. 
        Return ONLY the fixed code block for that specific section, no commentary.`;
        
        const fixedCode = await client.streamGenerate(prompt, fullCode, lang);
        
        // Split view showing fix
        const panel = vscode.window.createWebviewPanel('fixResult', `Fix for line ${issue.line}`, vscode.ViewColumn.Active, {});
        panel.webview.html = `<html><body style="background:#1e1e1e;color:#fff;padding:20px;">
            <h3>Suggested Fix:</h3>
            <pre style="background:#252526;padding:15px;border-radius:5px;">${fixedCode}</pre>
            <p>You can copy and paste this to replace the issue.</p>
        </body></html>`;
    });
}

function getReviewWebviewContent(result: any): string {
    const scoreColor = result.score >= 8 ? '#4ec9b0' : (result.score >= 5 ? '#cca700' : '#f14c4c');
    
    const issuesHtml = result.issues.map((issue: any) => {
        const color = issue.severity === 'critical' ? '#f14c4c' : (issue.severity === 'warning' ? '#cca700' : '#3794ff');
        return `
            <div class="issue-card" style="border-left: 5px solid ${color}">
                <div class="issue-header">
                    <span class="severity" style="background:${color}">${issue.severity.toUpperCase()}</span>
                    <span class="line">Line ${issue.line}</span>
                </div>
                <div class="message">${issue.message}</div>
                <div class="suggestion"><strong>Suggestion:</strong> ${issue.suggestion}</div>
                <button class="fix-btn" onclick="applyFix(${JSON.stringify(issue).replace(/"/g, '&quot;')})">Generate Fix</button>
            </div>
        `;
    }).join('');

    const bpList = result.bestPractices.map((bp: string) => `<li>${bp}</li>`).join('');

    return `<!DOCTYPE html><html><head><style>
        body { font-family: sans-serif; background:#1e1e1e; color:#ccc; padding:20px; line-height: 1.5; }
        .score-container { text-align:center; margin-bottom:30px; }
        .score-circle { display:inline-block; width:80px; height:80px; line-height:80px; border-radius:50%; font-size:32px; font-weight:bold; color:white; }
        .issue-card { background:#252526; margin-bottom:15px; padding:15px; border-radius:4px; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
        .issue-header { display:flex; justify-content:space-between; margin-bottom:10px; }
        .severity { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:bold; }
        .line { color:#888; font-size:12px; }
        .message { font-size:14px; color:#eee; margin-bottom:10px; }
        .suggestion { font-size:13px; color:#4ec9b0; margin-bottom:12px; }
        .fix-btn { background:#007acc; border:none; color:white; padding:6px 12px; border-radius:3px; cursor:pointer; font-size:12px; }
        .fix-btn:hover { background:#0062a3; }
        section { margin-bottom: 25px; }
        h3 { color: #fff; border-bottom: 1px solid #333; padding-bottom: 5px; }
        ul { padding-left: 20px; }
    </style></head><body>
        <div class="score-container">
            <div class="score-circle" style="background:${scoreColor}">${result.score}</div>
            <p>Overall Quality Score</p>
        </div>
        
        <section>
            <h3>Critical Issues & Improvements</h3>
            ${issuesHtml}
        </section>

        <section>
            <h3>Best Practices</h3>
            <ul>${bpList}</ul>
        </section>

        <section>
            <h3>Security Scan</h3>
            <p>${result.security}</p>
        </section>

        <script>
            const vscode = acquireVsCodeApi();
            function applyFix(issue) { vscode.postMessage({type:'fix', issue}); }
        </script>
    </body></html>`;
}
