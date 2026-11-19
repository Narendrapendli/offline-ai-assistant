import * as vscode from 'vscode';

export class SelfHealingProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        return context.diagnostics
            .filter(diag => diag.severity === vscode.DiagnosticSeverity.Error || diag.severity === vscode.DiagnosticSeverity.Warning)
            .map(diag => this.createFixAction(document, diag));
    }

    private createFixAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const msg = diagnostic.message.length > 40 ? diagnostic.message.substring(0, 37) + '...' : diagnostic.message;
        const action = new vscode.CodeAction(`Beast Fix: ${msg}`, vscode.CodeActionKind.QuickFix);
        
        action.command = {
            command: 'ai-assistant.healCode',
            title: 'Self-Healing Bug Fix',
            arguments: [{
                message: diagnostic.message,
                line: diagnostic.range.start.line,
                file: document.fileName,
                range: diagnostic.range
            }]
        };
        
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        return action;
    }
}
