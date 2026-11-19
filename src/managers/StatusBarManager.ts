/**
 * src/managers/StatusBarManager.ts
 * Polls backend stats and updates the status bar with latency and health.
 */

import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private pollInterval?: any;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(hubot) AI: Init';
        this.statusBarItem.command = 'ai-assistant.openChat';
        this.statusBarItem.show();
    }

    public startPolling() {
        this.updateStatus();
        this.pollInterval = setInterval(() => this.updateStatus(), 5000);
    }

    public refresh() {
        this.updateStatus();
    }

    private async updateStatus() {
        try {
            const start = Date.now();
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 3000);
            const res = await fetch('http://127.0.0.1:8000/stats', { signal: ctrl.signal });
            clearTimeout(timeout);
            const latency = Date.now() - start;
            
            if (res.ok) {
                const stats = await res.json();
                const configModel = vscode.workspace.getConfiguration('aiAssistant').get<string>('model');
                const model = configModel || stats.model_name || 'deepseek';
                
                let icon = '$(check)';
                let color = undefined;
                
                if (latency > 2000) {
                    icon = '$(warning)';
                    color = new vscode.ThemeColor('statusBarItem.warningBackground');
                }

                this.statusBarItem.text = `${icon} AI: ${model} (${latency}ms)`;
                this.statusBarItem.backgroundColor = color;
                this.statusBarItem.tooltip = `Model: ${model}\nUptime: ${stats.uptime_seconds}s\nRequests: ${stats.total_requests}\nAvg Latency: ${stats.avg_response_ms}ms`;
            } else {
                this.setOffline();
            }
        } catch {
            this.setOffline();
        }
    }

    private setOffline() {
        this.statusBarItem.text = '$(error) AI: Offline';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = 'Backend unreachable. Run start.ps1 to launch.';
    }

    public dispose() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.statusBarItem.dispose();
    }
}
