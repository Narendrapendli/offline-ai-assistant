import * as vscode from 'vscode';
import { StatusBarManager } from '../managers/StatusBarManager';

export function registerModelSwitcherCommand(context: vscode.ExtensionContext, statusBar: StatusBarManager) {
    const disposable = vscode.commands.registerCommand('ai-assistant.switchModel', async () => {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                throw new Error('Failed to fetch models from Ollama');
            }

            const data = await response.json() as { models: Array<{ name: string }> };
            const modelNames = data.models.map(m => m.name);

            if (modelNames.length === 0) {
                vscode.window.showWarningMessage('No models found in Ollama. Please pull a model first (e.g., ollama pull deepseek-coder).');
                return;
            }


            const selectedModel = await vscode.window.showQuickPick(modelNames, {
                placeHolder: 'Select an AI model to use',
                title: 'Ollama Model Switcher'
            });

            if (selectedModel) {
                await vscode.workspace.getConfiguration('aiAssistant').update('model', selectedModel, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`AI Assistant: Switched to ${selectedModel}`);
                statusBar.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to switch model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    context.subscriptions.push(disposable);
}
