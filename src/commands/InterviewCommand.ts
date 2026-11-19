import * as vscode from 'vscode';
import { BackendClient } from '../clients/BackendClient';

export function registerInterviewCommand(context: vscode.ExtensionContext, client: BackendClient) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.startInterview', () => {
            InterviewPanel.createOrShow(client);
        })
    );
}

class InterviewPanel {
    public static currentPanel: InterviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _messages: Array<{role: string, content: string}> = [];
    private _abortController?: AbortController;

    private constructor(panel: vscode.WebviewPanel, private client: BackendClient) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'startInterview':
                    await this.startInterview(message.difficulty, message.topic);
                    break;
                case 'submitMessage':
                    await this.handleUserMessage(message.value);
                    break;
                case 'getHint':
                    await this.handleUserMessage("I need a hint for this problem.");
                    break;
                case 'nextProblem':
                    await this.handleUserMessage("That was great. Can I have a next problem?");
                    break;
            }
        }, null, this._disposables);
    }

    public static createOrShow(client: BackendClient) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (InterviewPanel.currentPanel) {
            InterviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'interviewPrep',
            'AI Interview Prep',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        InterviewPanel.currentPanel = new InterviewPanel(panel, client);
    }

    private async startInterview(difficulty: string, topic: string) {
        this._messages = [];
        const systemPrompt = `You are a senior Google software engineer conducting a technical interview. Difficulty: ${difficulty}, Topic: ${topic}. Ask ONE DSA problem appropriate for these settings. After user submits solution: (1) check correctness, (2) ask follow-up questions about time complexity, (3) suggest optimizations, (4) give next harder problem. Never give the answer directly — guide with hints only. Act like a real interviewer.`;
        this._messages.push({ role: 'system', content: systemPrompt });
        await this.handleUserMessage(`I am ready. Let's start the ${difficulty} interview on ${topic}.`);
    }

    private async handleUserMessage(text: string) {
        this._panel.webview.postMessage({ type: 'addMessage', role: 'user', content: text });
        this._messages.push({ role: 'user', content: text });
        
        this._abortController?.abort();
        this._abortController = new AbortController();
        this._panel.webview.postMessage({ type: 'startStreaming' });

        try {
            const generator = this.client.streamChat({
                messages: this._messages,
                language: 'python'
            }, this._abortController.signal);

            let assistantReply = '';
            for await (const chunk of generator) {
                assistantReply += chunk;
                this._panel.webview.postMessage({ type: 'token', value: chunk });
            }
            this._messages.push({ role: 'assistant', content: assistantReply });
            this._panel.webview.postMessage({ type: 'done' });
        } catch (err) {
            this._panel.webview.postMessage({ type: 'error', value: 'Interview session interrupted.' });
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    public dispose() {
        InterviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <style>
                body { font-family: sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; display: flex; flex-direction: column; height: 100vh; margin: 0; box-sizing: border-box;}
                .controls { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
                select, button { padding: 8px; border-radius: 4px; background: #333; color: #fff; border: 1px solid #444; cursor: pointer; }
                button { background: #007acc; }
                #chat { flex: 1; overflow-y: auto; border: 1px solid #333; padding: 15px; border-radius: 8px; background: #252526; margin-bottom: 20px; }
                .msg { margin-bottom: 15px; line-height: 1.5; padding: 10px; border-radius: 8px; }
                .user { background: #0e639c; align-self: flex-end; }
                .assistant { background: #2d2d2d; border: 1px solid #3c3c3c; }
                .input-area { display: flex; gap: 10px; }
                textarea { flex: 1; background: #3c3c3c; color: #fff; border: 1px solid #555; border-radius: 6px; padding: 10px; resize: none; height: 80px; }
                pre { background: #111; padding: 10px; border-radius: 4px; overflow-x: auto; color: #4ec9b0; }
                .btn-row { display: flex; gap: 10px; margin-top: 10px; }
                .secondary-btn { background: #444; }
            </style>
        </head>
        <body>
            <h3>🎯 AI Interview Prep Mode</h3>
            <div class="controls" id="setup">
                <select id="difficulty">
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                </select>
                <select id="topic">
                    <option value="Arrays">Arrays</option>
                    <option value="LinkedList">LinkedList</option>
                    <option value="Trees">Trees</option>
                    <option value="DP">Dynamic Programming</option>
                    <option value="Graphs">Graphs</option>
                    <option value="Strings">Strings</option>
                </select>
                <button onclick="start()">Start Interview</button>
            </div>
            <div id="chat"></div>
            <div class="input-area" id="interaction" style="display:none;">
                <textarea id="message" placeholder="Type your solution or response..."></textarea>
                <div style="display:flex; flex-direction:column; gap:5px;">
                    <button onclick="send()" style="height:40px;">Submit</button>
                    <button class="secondary-btn" onclick="getHint()">Hint</button>
                </div>
            </div>
            <div class="btn-row" id="footer-btns" style="display:none;">
                 <button class="secondary-btn" onclick="next()">Next Problem</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const setup = document.getElementById('setup');
                const interaction = document.getElementById('interaction');
                const footerBtns = document.getElementById('footer-btns');
                const input = document.getElementById('message');

                let currentMsgDiv = null;

                function start() {
                    const diff = document.getElementById('difficulty').value;
                    const topic = document.getElementById('topic').value;
                    setup.style.display = 'none';
                    interaction.style.display = 'flex';
                    footerBtns.style.display = 'flex';
                    vscode.postMessage({ type: 'startInterview', difficulty: diff, topic: topic });
                }

                function send() {
                    const text = input.value.trim();
                    if (!text) return;
                    vscode.postMessage({ type: 'submitMessage', value: text });
                    input.value = '';
                }

                function getHint() { vscode.postMessage({ type: 'getHint' }); }
                function next() { vscode.postMessage({ type: 'nextProblem' }); }

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.type === 'addMessage') {
                        const div = document.createElement('div');
                        div.className = 'msg ' + msg.role;
                        div.innerHTML = msg.content.replace(/\\n/g, '<br>');
                        chat.appendChild(div);
                        chat.scrollTop = chat.scrollHeight;
                    }
                    if (msg.type === 'startStreaming') {
                        currentMsgDiv = document.createElement('div');
                        currentMsgDiv.className = 'msg assistant';
                        chat.appendChild(currentMsgDiv);
                    }
                    if (msg.type === 'token') {
                        currentMsgDiv.innerText += msg.value;
                        chat.scrollTop = chat.scrollHeight;
                    }
                    if (msg.type === 'done') {
                        // Optional: fancy markdown processing here
                        currentMsgDiv = null;
                    }
                });
            </script>
        </body>
        </html>`;
    }
}
