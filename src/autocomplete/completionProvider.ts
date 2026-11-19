import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';
import { ContextExtractor } from '../utils/ContextExtractor';

export const SUPPORTED_LANGUAGES = [
    'python', 'cpp', 'javascript', 'typescript', 'java', 'go', 'rust', 
    'csharp', 'html', 'css', 'sql', 'php', 'ruby', 'swift', 
    'kotlin', 'r', 'bash', 'json', 'yaml'
];

export class AICompletionProvider implements vscode.InlineCompletionItemProvider {
    private client: BackendClient;
    private timeout: any | undefined;
    private abortController: AbortController | undefined;

    constructor(client: BackendClient) {
        this.client = client;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        
        if (this.timeout) clearTimeout(this.timeout);
        if (this.abortController) this.abortController.abort();

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        token.onCancellationRequested(() => this.abortController?.abort());

        return new Promise((resolve) => {
            this.timeout = setTimeout(async () => {
                if (signal.aborted) { resolve(undefined); return; }

                const fimContext = ContextExtractor.extractFIMContext(document, position);
                const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
                
                // Prompt K: Check for snippets in comments
                if (linePrefix.trim().startsWith('//') || linePrefix.trim().startsWith('#')) {
                    try {
                        const snippet = await this.client.getSuggestion(linePrefix.trim(), document.languageId);
                        if (snippet && snippet.code) {
                            const item = new vscode.InlineCompletionItem(
                                snippet.code,
                                new vscode.Range(position, position)
                            );
                            resolve([item]);
                            return;
                        }
                    } catch (err) {
                        console.error('Snippet suggest error:', err);
                    }
                }

                if (!fimContext.prefix.trim()) { resolve(undefined); return; }

                try {
                    const generator = this.client.streamAutocomplete({
                        prefix: fimContext.prefix,
                        suffix: fimContext.suffix,
                        language: document.languageId,
                        max_tokens: 150
                    }, signal);

                    let completionText = '';
                    for await (const chunk of generator) {
                        if (signal.aborted) { resolve(undefined); return; }
                        completionText += chunk;
                    }

                    if (!completionText.trim()) { resolve(undefined); return; }

                    const item = new vscode.InlineCompletionItem(
                        completionText,
                        new vscode.Range(position, position)
                    );

                    // Prompt P: Schedule prefetch on success
                    item.command = {
                        title: 'Prefetch',
                        command: 'ai-assistant.prefetchOnAccept',
                        arguments: [document, position, completionText]
                    };

                    resolve([item]);

                } catch (error) {
                    if ((error as Error).name !== 'AbortError') console.error('Autocomplete error:', error);
                    resolve(undefined);
                }
            }, 150);

            // Prompt P: Schedule prefetch when user pauses 2 seconds
            setTimeout(async () => {
                if (!token.isCancellationRequested) {
                    const ctx = ContextExtractor.extractFIMContext(document, position);
                    this.client.schedulePrefetch(ctx.prefix, ctx.suffix, document.languageId);
                }
            }, 2000);
        });
    }
}
