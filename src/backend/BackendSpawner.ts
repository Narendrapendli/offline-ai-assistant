/**
 * src/backend/BackendSpawner.ts
 * Spawns and manages the FastAPI backend process.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const BACKEND_URL = 'http://127.0.0.1:8000';
const HEALTH_URL  = `${BACKEND_URL}/health`;

export class BackendSpawner {
    private process: cp.ChildProcess | undefined;
    private running = false;

    constructor(private readonly outputChannel: vscode.OutputChannel) {}

    /** Returns true if the backend is already serving requests. */
    async checkBackend(): Promise<boolean> {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2000);
            const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Find a working Python executable and spawn uvicorn.
     * Tries .venv first (project-local venv), then system python / python3.
     */
    async start(workspacePath: string): Promise<void> {
        if (this.running) {
            this.outputChannel.appendLine('[BackendSpawner] Already running — skip start.');
            return;
        }

        const python = this._findPython(workspacePath);
        if (!python) {
            this.outputChannel.appendLine('[BackendSpawner] ❌ No Python interpreter found.');
            vscode.window.showErrorMessage(
                'AI Assistant: Python not found. Install Python 3.11+ or create a .venv in the workspace.'
            );
            return;
        }

        this.outputChannel.appendLine(`[BackendSpawner] Using Python: ${python}`);

        const backendDir = path.join(workspacePath, 'backend');
        if (!fs.existsSync(backendDir)) {
            this.outputChannel.appendLine(`[BackendSpawner] ❌ backend/ directory not found at ${backendDir}`);
            return;
        }

        this.outputChannel.appendLine('[BackendSpawner] Spawning FastAPI backend…');

        this.process = cp.spawn(
            python,
            ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000', '--log-level', 'warning'],
            {
                cwd: backendDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env },
            }
        );

        this.process.stdout?.on('data', (chunk: Buffer) => {
            this.outputChannel.append(`[backend] ${chunk.toString()}`);
        });
        this.process.stderr?.on('data', (chunk: Buffer) => {
            this.outputChannel.append(`[backend:err] ${chunk.toString()}`);
        });
        this.process.on('exit', (code) => {
            this.running = false;
            this.outputChannel.appendLine(`[BackendSpawner] Process exited (code ${code ?? '?'})`);
        });
        this.process.on('error', (err) => {
            this.running = false;
            this.outputChannel.appendLine(`[BackendSpawner] Spawn error: ${err.message}`);
        });

        this.running = true;
    }

    /**
     * Poll /health every 500 ms until the backend responds or the timeout elapses.
     * Returns true if ready, false if timed out.
     */
    async waitForReady(timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.checkBackend()) {
                return true;
            }
            await this._sleep(500);
        }
        return false;
    }

    /** Kill the backend process. */
    stop(): void {
        if (this.process && this.running) {
            this.outputChannel.appendLine('[BackendSpawner] Stopping backend process…');
            this.process.kill('SIGTERM');
            this.running = false;
        }
    }

    // ── private helpers ────────────────────────────────────────────────────

    private _findPython(workspacePath: string): string | undefined {
        const candidates: string[] = [
            // Project-local .venv (Windows)
            path.join(workspacePath, '.venv', 'Scripts', 'python.exe'),
            // Project-local venv (Windows)
            path.join(workspacePath, 'venv', 'Scripts', 'python.exe'),
            // System Python (Windows — py launcher)
            'python',
            'python3',
        ];

        for (const candidate of candidates) {
            if (candidate.includes(path.sep) || candidate.includes('/')) {
                // Absolute path — check existence
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } else {
                // Command name — try running it
                try {
                    const result = cp.spawnSync(candidate, ['--version'], { timeout: 3000 });
                    if (result.status === 0) {
                        return candidate;
                    }
                } catch {
                    // not found — try next
                }
            }
        }
        return undefined;
    }

    private _sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
