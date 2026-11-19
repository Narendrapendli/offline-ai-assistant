import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export class TerminalAI {
    private static terminal: vscode.Terminal | undefined;

    static detectTerminalIntent(message: string): boolean {
        const keywords = [
            "install", "run", "execute", "create file", "delete", "how do i", 
            "pip", "npm", "git", "mkdir", "cd to", "list files", "terminal",
            "directory", "folder", "npm install", "python run"
        ];
        const lower = message.toLowerCase();
        return keywords.some(k => lower.includes(k));
    }

    static async processMessage(userMessage: string, client: BackendClient): Promise<{ command: string; explanation: string; safe: boolean } | null> {
        const prompt = `You are a terminal command expert on Windows. The user wants to do this: '${userMessage}'. Respond with ONLY a JSON object: {command: 'the exact terminal command', explanation: 'one line what it does', safe: true/false}. If unsafe set safe:false. Only provide commands safe to run on Windows PowerShell.`;
        
        try {
            const response = await client.generate(prompt);
            // AI might return triple backticks, need to clean
            const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanJson);
            return {
                command: result.command,
                explanation: result.explanation,
                safe: !!result.safe
            };
        } catch (e) {
            console.error('Terminal AI processing failed', e);
            return null;
        }
    }

    static executeInTerminal(command: string) {
        if (!this.terminal || this.terminal.exitStatus !== undefined) {
            this.terminal = vscode.window.createTerminal("AI Terminal");
        }
        this.terminal.show();
        this.terminal.sendText(command);
    }

    static async promptAndExecute(command: string, explanation: string) {
        const answer = await vscode.window.showInformationMessage(
            `Run this command? \n${explanation}\n\n${command}`,
            { modal: true },
            "Yes", "No"
        );
        if (answer === "Yes") {
            this.executeInTerminal(command);
        }
    }
}
