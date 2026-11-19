import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerHealCodeCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.healCode', async (diagInfo: any) => {
            const document = await vscode.workspace.openTextDocument(diagInfo.file);
            
            const startLine = Math.max(0, diagInfo.line - 10);
            const endLine = Math.min(document.lineCount - 1, diagInfo.line + 10);
            const contextText = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Beast is healing your code...',
                cancellable: false
            }, async () => {
                try {
                    const prompt = `Fix this exact ${document.languageId} error on line ${diagInfo.line + 1}: '${diagInfo.message}'. Here is the surrounding code context:\n${contextText}\nReturn ONLY the corrected lines (from line ${startLine + 1} to ${endLine + 1}) preserving exact indentation and style. No explanations.`;
                    const fixedCode = await client.generate(prompt, contextText, document.languageId);

                    const newDoc = await vscode.workspace.openTextDocument({ content: fixedCode, language: document.languageId });
                    
                    // Show diff
                    await vscode.commands.executeCommand('vscode.diff', document.uri, newDoc.uri, 'Original vs Fixed');

                    const apply = await vscode.window.showInformationMessage('Heal complete! Apply this fix?', 'Apply Fix', 'Discard');
                    if (apply === 'Apply Fix') {
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(document.uri, new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length), fixedCode);
                        await vscode.workspace.applyEdit(edit);
                        vscode.window.showInformationMessage('Code healed successfully! 🩸');
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Heal failed: ${err}`);
                }
            });
        })
    );
}
