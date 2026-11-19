import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export class BugDetector implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor(private client: BackendClient, context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('ai-bug-detector');
        context.subscriptions.push(this.diagnosticCollection);
    }

    /**
     * Called when a supported document is saved.
     * Triggers the backend analysis and creates diagnostics.
     */
    public async analyzeDocument(document: vscode.TextDocument) {
        const text = document.getText();
        if (!text.trim()) return;

        const language = document.languageId;
        const prompt = "Analyze this code for bugs. Return ONLY valid JSON array: [{line: 5, message: 'bug description', severity: 'error'}]. Return [] if no bugs.";

        try {
            // We use chat stream for text, but since we asked for JSON we should just accumulate it
            const generator = this.client.streamChat({
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: text }
                ],
                language: language
            });

            let responseText = '';
            for await (const chunk of generator) {
                responseText += chunk;
            }

            // The LLM might wrap the JSON in ```json ... ``` blocks
            let jsonStr = responseText.trim();
            const match = jsonStr.match(/\[[\s\S]*\]/);
            if (match) {
                jsonStr = match[0];
            }

            let issues: Array<{ line: number, message: string, severity: string }> = [];
            try {
                issues = JSON.parse(jsonStr);
            } catch (e) {
                console.error("Failed to parse bug detection JSON:", jsonStr);
                return;
            }

            const diagnostics: vscode.Diagnostic[] = [];

            for (const issue of issues) {
                // LLM lines are typically 1-indexed. VS Code lines are 0-indexed.
                const lineIndex = Math.max(0, (issue.line || 1) - 1);
                
                // Get the range for the whole line, or just somewhat highlight the start
                const lineRange = document.lineAt(Math.min(lineIndex, document.lineCount - 1)).range;
                
                let severity = vscode.DiagnosticSeverity.Warning;
                if (issue.severity && String(issue.severity).toLowerCase() === 'error') {
                    severity = vscode.DiagnosticSeverity.Error;
                }

                const diagnostic = new vscode.Diagnostic(lineRange, issue.message, severity);
                diagnostic.source = 'AI Bug Detector';
                
                // We'll store the original line/text in the code to power the Fix action
                diagnostic.code = 'ai-fixable';
                
                diagnostics.push(diagnostic);
            }

            this.diagnosticCollection.set(document.uri, diagnostics);

        } catch (err) {
            console.error('BugDetector analysis failed:', err);
        }
    }

    /**
     * Provide quick fixes for any AI Bug Detector diagnostics on the current line.
     */
    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'AI Bug Detector') {
                const action = new vscode.CodeAction(`AI Fix: ${diagnostic.message}`, vscode.CodeActionKind.QuickFix);
                
                // We map this action to a command that we will register
                action.command = {
                    command: 'ai-assistant.applyBugFix',
                    title: 'Apply AI Bug Fix',
                    arguments: [document, diagnostic]
                };
                
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                actions.push(action);
            }
        }

        return actions;
    }

    /**
     * Actually generate the fix when the user clicks the Code Action Quick Fix
     */
    public async applyFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic) {
        const lineIndex = diagnostic.range.start.line;
        // Grab a window of surrounding context (e.g., 5 lines up and 5 lines down)
        const startLine = Math.max(0, lineIndex - 5);
        const endLine = Math.min(document.lineCount - 1, lineIndex + 5);
        
        let contextText = '';
        for (let i = startLine; i <= endLine; i++) {
            contextText += document.lineAt(i).text + '\n';
        }

        const instruction = `Fix this bug: "${diagnostic.message}". Return ONLY the corrected code for this snippet, without markdown formatting.`;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'AI Assistant',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ message: 'Generating fix...' });

            try {
                // Call /generate endpoint (which generates non-streaming fully in BackendClient via streamGenerate)
                const fullResponse = await this.client.streamGenerate(
                    instruction,
                    contextText,
                    document.languageId
                );

                if (token.isCancellationRequested) return;

                let fixedCode = fullResponse.trim();
                // Strip markdown formatting if the LLM adds it anyway
                const match = fixedCode.match(/```[a-z]*\n([\s\S]*?)\n```/);
                if (match) {
                    fixedCode = match[1].trim();
                }

                // If the LLM returned essentially nothing or just apologized, abort.
                if (!fixedCode || fixedCode.length < 5) {
                    vscode.window.showWarningMessage("The AI could not confidently generate a fix.");
                    return;
                }

                // Replace the exact lines of context with the fixed code
                const edit = new vscode.WorkspaceEdit();
                const replaceRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
                edit.replace(document.uri, replaceRange, fixedCode);
                
                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    // Remove the diagnostic since it's "fixed"
                    const currentDiagnostics = this.diagnosticCollection.get(document.uri) || [];
                    const updatedDiagnostics = currentDiagnostics.filter(d => d !== diagnostic);
                    this.diagnosticCollection.set(document.uri, updatedDiagnostics);
                    vscode.window.showInformationMessage("AI Bug Fix applied successfully.");
                } else {
                    vscode.window.showErrorMessage("Failed to apply the document edit.");
                }

            } catch (err) {
                console.error("Failed to generate bug fix:", err);
                vscode.window.showErrorMessage("Failed to generate AI Bug Fix.");
            }
        });
    }
}
