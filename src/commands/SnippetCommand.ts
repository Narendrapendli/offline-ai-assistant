import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerSnippetCommand(context: vscode.ExtensionContext, client: BackendClient) {
    // 1. Save Snippet
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.saveSnippet', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const selection = editor.selection;
            const text = editor.document.getText(selection);
            if (!text) {
                vscode.window.showWarningMessage('Please select code to save as a snippet.');
                return;
            }

            const description = await vscode.window.showInputBox({ prompt: 'Enter snippet description' });
            if (!description) return;

            const tags = await vscode.window.showInputBox({ prompt: 'Enter tags (comma separated)' });
            
            try {
                await client.saveSnippet({
                    language: editor.document.languageId,
                    description,
                    code: text,
                    tags: tags || ''
                });
                vscode.window.showInformationMessage('Snippet saved successfully.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to save snippet: ${err}`);
            }
        })
    );

    // 2. Search Snippets
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.searchSnippets', async () => {
            const q = await vscode.window.showInputBox({ prompt: 'Search snippets...' });
            if (q === undefined) return;

            const results = await client.searchSnippets(q);
            if (results.length === 0) {
                vscode.window.showInformationMessage('No snippets found.');
                return;
            }

            const items = results.map((s: any) => ({
                label: s.description || 'No description',
                description: s.language,
                detail: s.tags,
                snippet: s
            }));

            const selected = await vscode.window.showQuickPick(items as (vscode.QuickPickItem & { snippet: any })[], { 
                title: 'Select snippet to insert' 
            });
            
            if (selected && selected.snippet) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.insertSnippet(new vscode.SnippetString(selected.snippet.code));
                    await client.useSnippet(selected.snippet.id);
                }
            }
        })
    );
}
