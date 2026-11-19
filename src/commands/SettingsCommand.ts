import * as vscode from 'vscode';

export function registerSettingsCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-assistant.openSettings', () => {
            const panel = vscode.window.createWebviewPanel(
                'aiAssistantSettings',
                'AI Assistant Settings',
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            panel.webview.html = getSettingsHtml();

            panel.webview.onDidReceiveMessage(async (message) => {
                const config = vscode.workspace.getConfiguration('ai-assistant');
                switch (message.type) {
                    case 'fetchModels':
                        try {
                            const response = await fetch('http://localhost:11434/api/tags');
                            const data = await response.json() as any;
                            const models = data.models.map((m: any) => m.name);
                            panel.webview.postMessage({ type: 'modelsLoaded', models });
                        } catch (e) {
                            vscode.window.showErrorMessage('Failed to fetch Ollama models. Is Ollama running?');
                        }
                        break;
                    case 'saveSettings':
                        await config.update('chatModel', message.settings.chatModel, vscode.ConfigurationTarget.Global);
                        await config.update('autocompleteModel', message.settings.autocompleteModel, vscode.ConfigurationTarget.Global);
                        await config.update('temperature', parseFloat(message.settings.temperature), vscode.ConfigurationTarget.Global);
                        await config.update('maxTokens', parseInt(message.settings.maxTokens), vscode.ConfigurationTarget.Global);
                        await config.update('contextLines', parseInt(message.settings.contextLines), vscode.ConfigurationTarget.Global);
                        await config.update('systemPrompt', message.settings.systemPrompt, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('AI Assistant settings saved!');
                        break;
                    case 'resetDefaults':
                        await config.update('chatModel', undefined, vscode.ConfigurationTarget.Global);
                        await config.update('autocompleteModel', undefined, vscode.ConfigurationTarget.Global);
                        await config.update('temperature', undefined, vscode.ConfigurationTarget.Global);
                        await config.update('maxTokens', undefined, vscode.ConfigurationTarget.Global);
                        await config.update('contextLines', undefined, vscode.ConfigurationTarget.Global);
                        await config.update('systemPrompt', undefined, vscode.ConfigurationTarget.Global);
                        panel.webview.postMessage({ type: 'defaultsRestored' });
                        vscode.window.showInformationMessage('Settings reset to defaults.');
                        break;
                }
            });

            // Initial load of current values
            const config = vscode.workspace.getConfiguration('ai-assistant');
            panel.webview.postMessage({
                type: 'init',
                settings: {
                    chatModel: config.get('chatModel'),
                    autocompleteModel: config.get('autocompleteModel'),
                    temperature: config.get('temperature'),
                    maxTokens: config.get('maxTokens'),
                    contextLines: config.get('contextLines'),
                    systemPrompt: config.get('systemPrompt')
                }
            });
        })
    );
}

function getSettingsHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        h2 { border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 10px; }
        .section { margin-bottom: 20px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        select, input, textarea { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; box-sizing: border-box; }
        .slider-container { display: flex; align-items: center; gap: 10px; }
        .slider-value { min-width: 40px; text-align: right; }
        .buttons { display: flex; gap: 10px; margin-top: 30px; }
        button { padding: 10px 20px; cursor: pointer; border: none; border-radius: 4px; font-weight: bold; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        textarea { height: 100px; resize: vertical; }
    </style>
</head>
<body>
    <div class="container">
        <h2>AI Assistant Settings</h2>
        
        <div class="section">
            <label>Chat Model</label>
            <select id="chatModel"><option>Loading models...</option></select>
        </div>

        <div class="section">
            <label>Autocomplete Model</label>
            <select id="autocompleteModel"><option>Loading models...</option></select>
        </div>

        <div class="section">
            <label>Temperature (<span id="tempVal">0.7</span>)</label>
            <div class="slider-container">
                <input type="range" id="temperature" min="0" max="1" step="0.1" value="0.7">
            </div>
        </div>

        <div class="section">
            <label>Max Tokens (<span id="maxTokensVal">500</span>)</label>
            <div class="slider-container">
                <input type="range" id="maxTokens" min="60" max="2000" step="10" value="500">
            </div>
        </div>

        <div class="section">
            <label>Context Lines (<span id="contextLinesVal">50</span>)</label>
            <div class="slider-container">
                <input type="range" id="contextLines" min="10" max="100" step="1" value="50">
            </div>
        </div>

        <div class="section">
            <label>Custom System Prompt</label>
            <textarea id="systemPrompt" placeholder="You are a senior developer..."></textarea>
        </div>

        <div class="buttons">
            <button class="btn-primary" id="saveBtn">Save Settings</button>
            <button class="btn-secondary" id="resetBtn">Reset Defaults</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // UI elements
        const chatModel = document.getElementById('chatModel');
        const autocompleteModel = document.getElementById('autocompleteModel');
        const tempSlider = document.getElementById('temperature');
        const tempVal = document.getElementById('tempVal');
        const maxTokensSlider = document.getElementById('maxTokens');
        const maxTokensVal = document.getElementById('maxTokensVal');
        const contextLinesSlider = document.getElementById('contextLines');
        const contextLinesVal = document.getElementById('contextLinesVal');
        const systemPrompt = document.getElementById('systemPrompt');

        // Update displays
        tempSlider.oninput = () => tempVal.innerText = tempSlider.value;
        maxTokensSlider.oninput = () => maxTokensVal.innerText = maxTokensSlider.value;
        contextLinesSlider.oninput = () => contextLinesVal.innerText = contextLinesSlider.value;

        // Fetch models on load
        vscode.postMessage({ type: 'fetchModels' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'modelsLoaded':
                    [chatModel, autocompleteModel].forEach(select => {
                        const previousValue = select.dataset.val;
                        select.innerHTML = message.models.map(m => \`<option value="\${m}" \${m === previousValue ? 'selected' : ''}>\${m}</option>\`).join('');
                    });
                    break;
                case 'init':
                    chatModel.dataset.val = message.settings.chatModel;
                    autocompleteModel.dataset.val = message.settings.autocompleteModel;
                    tempSlider.value = message.settings.temperature;
                    tempVal.innerText = message.settings.temperature;
                    maxTokensSlider.value = message.settings.maxTokens;
                    maxTokensVal.innerText = message.settings.maxTokens;
                    contextLinesSlider.value = message.settings.contextLines;
                    contextLinesVal.innerText = message.settings.contextLines;
                    systemPrompt.value = message.settings.systemPrompt || '';
                    break;
                case 'defaultsRestored':
                    location.reload();
                    break;
            }
        });

        document.getElementById('saveBtn').onclick = () => {
            vscode.postMessage({
                type: 'saveSettings',
                settings: {
                    chatModel: chatModel.value,
                    autocompleteModel: autocompleteModel.value,
                    temperature: tempSlider.value,
                    maxTokens: maxTokensSlider.value,
                    contextLines: contextLinesSlider.value,
                    systemPrompt: systemPrompt.value
                }
            });
        };

        document.getElementById('resetBtn').onclick = () => {
            vscode.postMessage({ type: 'resetDefaults' });
        };
    </script>
</body>
</html>`;
}
