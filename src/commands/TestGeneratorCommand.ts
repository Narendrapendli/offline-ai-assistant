import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BackendClient } from '../clients/BackendClient';

export function registerTestGeneratorCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const document = editor.document;
            let code = document.getText(editor.selection);
            
            if (!code.trim()) {
                // Heuristic: scan up/down to find function boundaries or just send full file
                code = document.getText();
            }

            const fileName = path.basename(document.fileName);
            const dirName = path.dirname(document.fileName);
            const testFileName = `test_${fileName}`;
            const testFilePath = path.join(dirName, testFileName);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Generating Unit Tests...",
                cancellable: false
            }, async () => {
                try {
                    const prompt = "Write comprehensive pytest unit tests for this function. Cover normal cases, edge cases, error cases, boundary values. Return ONLY the complete test code.";
                    const testCode = await client.streamGenerate(prompt, code, document.languageId);

                    let finalTests = testCode.trim();
                    const match = finalTests.match(/```[a-z]*\n([\s\S]*?)\n```/);
                    if (match) { finalTests = match[1].trim(); }

                    fs.writeFileSync(testFilePath, finalTests);

                    const testDoc = await vscode.workspace.openTextDocument(testFilePath);
                    await vscode.window.showTextDocument(testDoc, {
                        viewColumn: vscode.ViewColumn.Beside,
                        preview: false
                    });

                    vscode.window.showInformationMessage(`Tests generated in ${testFileName}`);

                } catch (err) {
                    vscode.window.showErrorMessage('Test generation failed.');
                }
            });
        })
    );
}
