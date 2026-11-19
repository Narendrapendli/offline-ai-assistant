import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

/**
 * Scans upward from the given line to find the nearest `def` statement.
 * Extracts the full function signature.
 */
function findNearestFunctionSignature(document: vscode.TextDocument, line: number): { signature: string, targetLine: number } | null {
    let currentLine = line;

    // Scan upward to find 'def'
    while (currentLine >= 0) {
        const text = document.lineAt(currentLine).text;
        if (text.trim().startsWith('def ') || text.trim().startsWith('async def ')) {
            // Found a def line. The signature might span multiple lines if it has a lot of params.
            let signature = '';
            let endLine = currentLine;
            
            // Scan downward from def until we hit a colon
            while (endLine < document.lineCount) {
                const peek = document.lineAt(endLine).text;
                signature += peek + '\n';
                if (peek.includes(':')) {
                    break;
                }
                endLine++;
            }
            
            return {
                signature: signature.trim(),
                targetLine: endLine + 1 // We want to insert the docstring *after* the def block
            };
        }
        currentLine--;
    }

    return null;
}

export function registerDocstringCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.generateDocstring', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor.');
                return;
            }

            // Only automatically support Python for this feature as requested
            if (editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('Auto docstrings currently only supported for Python.');
                return;
            }

            const selection = editor.selection;
            const doc = editor.document;
            const functionInfo = findNearestFunctionSignature(doc, selection.active.line);

            if (!functionInfo) {
                vscode.window.showErrorMessage('Could not find an enclosing function starting with "def".');
                return;
            }

            const { signature, targetLine } = functionInfo;

            // Determine indentation based on target line's indentation level + 4 spaces
            // (or base it off the def line's indentation + 4)
            const defIndentCount = doc.lineAt(targetLine - 1).text.search(/\S|$/);
            const indent = ' '.repeat(defIndentCount + 4);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AI Assistant',
                cancellable: true
            }, async (progress, token) => {
                progress.report({ message: 'Generating docstring...' });

                const prompt = `Generate a Google-style Python docstring for this function: ${signature}. Return ONLY the docstring with triple quotes, indented 4 spaces.`;
                
                // Set up abort controller for the token logic
                const ctrl = new AbortController();
                token.onCancellationRequested(() => {
                    ctrl.abort();
                });

                try {
                    // Accumulate stream
                    let fullResponse = '';
                    const generator = client.streamChat({
                        messages: [
                            { role: 'user', content: prompt }
                        ],
                        language: 'python'
                    }, ctrl.signal);

                    for await (const chunk of generator) {
                        if (ctrl.signal.aborted) break;
                        fullResponse += chunk;
                    }

                    if (ctrl.signal.aborted) {
                        return;
                    }

                    // Clean the response
                    let docstring = fullResponse.trim();
                    if (!docstring.startsWith('"""')) {
                        // Attempt to extract it if the LLM hallucinated markdown code blocks
                        const match = docstring.match(/"""[\s\S]*?"""/);
                        if (match) {
                            docstring = match[0];
                        } else {
                            docstring = `"""\n${docstring}\n"""`;
                        }
                    }

                    // Apply indentation to the docstring block
                    const indentedDocstring = docstring.split('\n')
                                                        .map(l => `${indent}${l}`)
                                                        .join('\n') + '\n';
                    
                    // Remove duplicate indents on the first line since the editor.insert places it at col 0
                    // Actually, let's insert it exactly with leading indents using insert.
                    await editor.edit(editBuilder => {
                        const position = new vscode.Position(targetLine, 0);
                        editBuilder.insert(position, indentedDocstring);
                    });

                    vscode.window.showInformationMessage('Docstring generated!');

                } catch (err) {
                    console.error('Docstring generation failed:', err);
                    vscode.window.showErrorMessage('Failed to generate docstring. Check output logs.');
                }
            });
        })
    );
}
