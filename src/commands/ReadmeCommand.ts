import * as vscode from 'vscode';
import * as path from 'path';
import { BackendClient } from '../clients/BackendClient';

export function registerReadmeCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.generateReadme', async () => {
            await generateReadme(client);
        })
    );
}

async function generateReadme(client: BackendClient) {
    const outputChannel = vscode.window.createOutputChannel('README Generator');
    outputChannel.show();
    outputChannel.appendLine('[README] Scanning workspace...');

    const pyFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
    const cppFiles = await vscode.workspace.findFiles('**/*.cpp', '**/node_modules/**');
    const allFiles = [...pyFiles, ...cppFiles];

    if (allFiles.length === 0) {
        vscode.window.showWarningMessage('No Python or C++ files found to analyze.');
        return;
    }

    const summaries: string[] = [];
    
    for (const file of allFiles) {
        try {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const relPath = vscode.workspace.asRelativePath(file);
            
            // Basic extraction
            const functions = (content.match(/def\s+(\w+)\s*\(/g) || []).map(f => f.replace('def ', '').replace('(', '').trim());
            const classes = (content.match(/class\s+(\w+)/g) || []).map(c => c.replace('class ', '').trim());
            
            summaries.push(`File: ${relPath}\nFunctions: ${functions.join(', ')}\nClasses: ${classes.join(', ')}\nSnippet: ${content.substring(0, 500)}...`);
        } catch (err) {
            outputChannel.appendLine(`[README] Error reading ${file.fsPath}: ${err}`);
        }
    }

    const filesSummary = summaries.join('\n\n---\n\n');
    outputChannel.appendLine(`[README] Analyzing ${allFiles.length} files...`);

    const prompt = `Generate a complete professional README.md for this project based on these files and their contents:\n\n${filesSummary}\n\nInclude:\n1. Project title and description\n2. Features list\n3. Installation instructions for Python and dependencies\n4. Usage examples for each major function\n5. API documentation if any\n6. File structure table\n7. License section\nMake it look professional like a real GitHub README. Give ONLY the markdown content.`;

    try {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating README...",
            cancellable: false
        }, async () => {
            const fullResponse = await client.generate(prompt);
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            
            const readmePath = path.join(workspaceFolders[0].uri.fsPath, 'README.md');
            await vscode.workspace.fs.writeFile(vscode.Uri.file(readmePath), Buffer.from(fullResponse));
            
            const doc = await vscode.workspace.openTextDocument(readmePath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage('README.md generated successfully!');
        });
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to generate README: ${err}`);
    }
}
