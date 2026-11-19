import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerTranslatorCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.translateCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const selection = editor.selection;
            const text = editor.document.getText(selection.isEmpty ? undefined : selection);
            if (!text) return;

            const languages = ['JavaScript', 'TypeScript', 'Java', 'Go', 'Rust', 'C#', 'Python', 'C++'];
            const targetLang = await vscode.window.showQuickPick(languages, { title: 'Translate to:' });
            if (!targetLang) return;

            const sourceLang = editor.document.languageId;
            const prompt = `Translate this ${sourceLang} code to ${targetLang}. Requirements: (1) Preserve exact logic and functionality, (2) Use idiomatic ${targetLang} patterns and conventions, (3) Add proper type annotations where applicable, (4) Add brief comments explaining language-specific differences, (5) Return ONLY the translated code.`;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Translating to ${targetLang}...`,
                cancellable: false
            }, async () => {
                try {
                    const translatedCode = await client.generate(prompt, text, sourceLang);
                    const extMap: any = {
                        'JavaScript': 'js', 'TypeScript': 'ts', 'Java': 'java', 
                        'Go': 'go', 'Rust': 'rs', 'C#': 'cs', 'Python': 'py', 'C++': 'cpp'
                    };
                    const ext = extMap[targetLang] || 'txt';
                    const newUri = editor.document.uri.with({ path: editor.document.uri.path + `_translated.${ext}` });
                    
                    await vscode.workspace.fs.writeFile(newUri, Buffer.from(translatedCode));
                    const newDoc = await vscode.workspace.openTextDocument(newUri);
                    await vscode.window.showTextDocument(newDoc, vscode.ViewColumn.Beside);
                } catch (err) {
                    vscode.window.showErrorMessage(`Translation failed: ${err}`);
                }
            });
        })
    );
}
