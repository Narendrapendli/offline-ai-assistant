import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BackendClient } from '../clients/BackendClient';

export function registerProfilerCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.profileCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('Performance profiling is currently only supported for Python.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Profiling code performance...',
                cancellable: false
            }, async () => {
                try {
                    const originalCode = editor.document.getText();
                    const instrumentedCode = instrumentPython(originalCode);
                    const tmpFile = path.join(path.dirname(editor.document.uri.fsPath), '__profiler_tmp.py');
                    fs.writeFileSync(tmpFile, instrumentedCode);

                    const result = cp.execSync(`python "${tmpFile}"`).toString();

                    fs.unlinkSync(tmpFile);

                    const prompt = `Here are the performance profiling results for this code: ${result}. Analyze and provide: (1) Slowest functions ranked by time, (2) Memory usage estimates, (3) Specific optimization for each slow function with code, (4) Expected speedup after optimization. Return ONLY JSON: {"slowest": [{"name":"func", "time":1.2, "count":10}], "optimizations": [{"name":"func", "fix":"...", "speedup":"2x"}]}`;
                    const aiAnalysis = await client.generate(prompt, originalCode, 'python');
                    
                    const jsonStart = aiAnalysis.indexOf('{');
                    const jsonEnd = aiAnalysis.lastIndexOf('}') + 1;
                    const analysis = JSON.parse(aiAnalysis.substring(jsonStart, jsonEnd));

                    ProfilerPanel.createOrShow(analysis);
                } catch (err) {
                    vscode.window.showErrorMessage(`Profiling failed: ${err}`);
                }
            });
        })
    );
}

function instrumentPython(code: string): string {
    return `
import time
import functools
_PROFILER_DATA = {}

def _profile_func(name):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            res = func(*args, **kwargs)
            end = time.perf_counter()
            if name not in _PROFILER_DATA: _PROFILER_DATA[name] = {'time': 0, 'count': 0}
            _PROFILER_DATA[name]['time'] += (end - start)
            _PROFILER_DATA[name]['count'] += 1
            return res
        return wrapper
    return decorator

${code.replace(/def (\w+)\(/g, '@_profile_func("$1")\ndef $1(')}

import atexit
@atexit.register
def _reporter():
    import json
    print("PROFILER_OUTPUT:" + json.dumps(_PROFILER_DATA))
`;
}

class ProfilerPanel {
    public static currentPanel: ProfilerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel, analysis: any) {
        this._panel = panel;
        this._update(analysis);
        this._panel.onDidDispose(() => { ProfilerPanel.currentPanel = undefined; });
    }

    public static createOrShow(data: any) {
        if (ProfilerPanel.currentPanel) {
            ProfilerPanel.currentPanel._update(data);
            return;
        }
        const panel = vscode.window.createWebviewPanel('profiler', 'Performance Profile', vscode.ViewColumn.Two, { enableScripts: true });
        ProfilerPanel.currentPanel = new ProfilerPanel(panel, data);
    }

    private _update(analysis: any) {
        const rows = analysis.slowest.map((f: any) => `
            <div class="func-row">
                <span class="name">${f.name}</span>
                <div class="bar-container">
                    <div class="bar" style="width: ${Math.min(100, f.time * 100)}%; background: ${f.time > 0.5 ? '#f44336' : '#4caf50'}"></div>
                </div>
                <span class="time">${f.time.toFixed(4)}s</span>
            </div>
        `).join('');

        this._panel.webview.html = `
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }
                    .func-row { display: flex; align-items: center; margin-bottom: 15px; }
                    .name { width: 150px; font-family: monospace; }
                    .bar-container { flex: 1; height: 12px; background: #333; border-radius: 6px; margin: 0 10px; overflow: hidden; }
                    .bar { height: 100%; transition: width 0.3s; }
                    .time { width: 80px; text-align: right; }
                    .card { background: #252526; border: 1px solid #333; padding: 15px; border-radius: 8px; margin-top: 20px; }
                    pre { background: #111; padding: 10px; border-radius: 4px; border: 1px solid #222; font-size: 0.9em; }
                    h2 { color: #569cd6; }
                </style>
            </head>
            <body>
                <h2>📊 Execution Profile</h2>
                ${rows}
                <div class="card">
                    <h3>💡 AI Optimization Suggestions</h3>
                    ${analysis.optimizations.map((o: any) => `
                        <h4>Function: <code>${o.name}</code> (Speedup: ${o.speedup})</h4>
                        <pre><code>${o.fix}</code></pre>
                    `).join('')}
                </div>
            </body>
            </html>
        `;
    }
}
