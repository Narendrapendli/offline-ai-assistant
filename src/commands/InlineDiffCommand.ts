import * as vscode from 'vscode';

export function registerInlineDiffCommand(context: vscode.ExtensionContext) {
    const addedDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(78, 201, 176, 0.2)', // Light green
        isWholeLine: true,
        after: {
            contentText: ' (Added)',
            color: '#4ec9b0'
        }
    });

    const removedDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(209, 52, 56, 0.2)', // Light red
        isWholeLine: true,
        textDecoration: 'line-through'
    });

    interface DiffSession {
        editor: vscode.TextEditor;
        range: vscode.Range;
        originalText: string;
        newText: string;
        addedRange: vscode.Range;
        removedRange: vscode.Range;
    }

    let activeSession: DiffSession | null = null;

    const inlineDiffCommand = vscode.commands.registerCommand('ai-assistant.inlineDiff', async (editor: vscode.TextEditor, range: vscode.Range, newText: string) => {
        if (activeSession) {
            // Cancel previous session if any
            await vscode.commands.executeCommand('ai-assistant.rejectDiff');
        }

        const originalText = editor.document.getText(range);
        
        // Prepare the replacement: we'll show removed then added
        // Simple implementation: original lines followed by new lines
        const replacement = `${originalText}\n${newText}`;
        
        await editor.edit(editBuilder => {
            editBuilder.replace(range, replacement);
        });

        // Calculate ranges for decorations
        const startLine = range.start.line;
        const originalLineCount = originalText.split('\n').length;
        const newLineCount = newText.split('\n').length;

        const removedRange = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(startLine + originalLineCount - 1, 1000)
        );
        const addedRange = new vscode.Range(
            new vscode.Position(startLine + originalLineCount, 0),
            new vscode.Position(startLine + originalLineCount + newLineCount - 1, 1000)
        );

        editor.setDecorations(removedDecoration, [removedRange]);
        editor.setDecorations(addedDecoration, [addedRange]);

        activeSession = {
            editor,
            range,
            originalText,
            newText,
            addedRange,
            removedRange
        };

        // Trigger CodeLens refresh
        inlineDiffProvider.refresh();
    });

    const acceptCommand = vscode.commands.registerCommand('ai-assistant.acceptDiff', async () => {
        if (!activeSession) return;
        const { editor, removedRange } = activeSession;

        await editor.edit(editBuilder => {
            // Remove the "original" part that we were showing as removed
            editBuilder.delete(new vscode.Range(removedRange.start, new vscode.Position(removedRange.end.line + 1, 0)));
        });

        editor.setDecorations(addedDecoration, []);
        editor.setDecorations(removedDecoration, []);
        activeSession = null;
        inlineDiffProvider.refresh();
    });

    const rejectCommand = vscode.commands.registerCommand('ai-assistant.rejectDiff', async () => {
        if (!activeSession) return;
        const { editor, originalText, removedRange, addedRange } = activeSession;

        // Restore original text
        const totalRange = new vscode.Range(removedRange.start, addedRange.end);
        await editor.edit(editBuilder => {
            editBuilder.replace(totalRange, originalText);
        });

        editor.setDecorations(addedDecoration, []);
        editor.setDecorations(removedDecoration, []);
        activeSession = null;
        inlineDiffProvider.refresh();
    });

    class InlineDiffProvider implements vscode.CodeLensProvider {
        private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
        public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

        refresh() { this._onDidChangeCodeLenses.fire(); }

        provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
            if (!activeSession || activeSession.editor.document !== document) return [];

            const lensRange = new vscode.Range(activeSession.removedRange.start, activeSession.removedRange.start);
            
            return [
                new vscode.CodeLens(lensRange, {
                    title: "$(check) Accept",
                    command: "ai-assistant.acceptDiff"
                }),
                new vscode.CodeLens(lensRange, {
                    title: "$(x) Reject",
                    command: "ai-assistant.rejectDiff"
                })
            ];
        }
    }

    const inlineDiffProvider = new InlineDiffProvider();
    
    context.subscriptions.push(
        inlineDiffCommand,
        acceptCommand,
        rejectCommand,
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inlineDiffProvider)
    );
}
