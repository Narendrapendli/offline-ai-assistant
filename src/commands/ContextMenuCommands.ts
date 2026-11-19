import * as vscode from 'vscode';
import { ChatViewProvider } from '../chat/chatProvider';

export function registerContextMenuCommands(context: vscode.ExtensionContext, chatProvider: ChatViewProvider) {
    const commands = [
        {
            id: 'ai-assistant.explain',
            prompt: "Explain this code step by step. Be clear and give examples."
        },
        {
            id: 'ai-assistant.fixBug',
            prompt: "Find and fix all bugs. Show fixed code with explanation of each fix."
        },
        {
            id: 'ai-assistant.addComments',
            prompt: "Add professional inline comments. Return only commented code."
        },
        {
            id: 'ai-assistant.writeTests',
            prompt: "Write comprehensive pytest tests covering normal, edge, error cases. Return only test code."
        },
        {
            id: 'ai-assistant.optimize',
            prompt: "Optimize for performance and readability. Show optimized code and explain each change."
        }
    ];

    for (const { id, prompt } of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(id, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor.');
                    return;
                }
                const selection = editor.selection;
                if (selection.isEmpty) {
                    vscode.window.showWarningMessage('Please select some code first.');
                    return;
                }
                
                const text = editor.document.getText(selection);
                const language = editor.document.languageId;
                
                // Stream result into sidebar using our custom system prompt
                await chatProvider.streamContextMenuCommand(prompt, text, language);
            })
        );
    }
}
