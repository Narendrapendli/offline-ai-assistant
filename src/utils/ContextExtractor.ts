/**
 * src/utils/ContextExtractor.ts
 * Extracts FIM (fill-in-the-middle) context from the active document.
 *
 * Budget: 12 000 characters total.
 *   prefix = 70% of budget (above cursor)
 *   suffix = 30% of budget (below cursor)
 */

import * as vscode from 'vscode';

const TOTAL_CHAR_BUDGET = 12_000;
const PREFIX_RATIO      = 0.70;
const SUFFIX_RATIO      = 0.30;

export interface FIMContext {
    prefix: string;
    suffix: string;
    /** Language identifier from VS Code (e.g. "python", "typescript"). */
    language: string;
    /** Line number (0-indexed) of the cursor. */
    cursorLine: number;
    /** Column (0-indexed) of the cursor. */
    cursorCol: number;
}

/**
 * Extract prefix and suffix around the cursor position, respecting character budgets.
 *
 * @param document - The VS Code TextDocument being edited.
 * @param position - The current cursor position.
 * @returns FIMContext with prefix / suffix strings within budget.
 */
export function extractFIMContext(
    document: vscode.TextDocument,
    position: vscode.Position
): FIMContext {
    const prefixBudget = Math.floor(TOTAL_CHAR_BUDGET * PREFIX_RATIO);
    const suffixBudget = Math.floor(TOTAL_CHAR_BUDGET * SUFFIX_RATIO);

    // Full text split at cursor
    const fullText    = document.getText();
    const cursorOffset = document.offsetAt(position);

    // Raw prefix / suffix (may exceed budget)
    const rawPrefix = fullText.slice(0, cursorOffset);
    const rawSuffix = fullText.slice(cursorOffset);

    // Trim prefix from the LEFT (keep the most recent code near cursor)
    const prefix = rawPrefix.length > prefixBudget
        ? rawPrefix.slice(rawPrefix.length - prefixBudget)
        : rawPrefix;

    // Trim suffix from the RIGHT (keep the nearest code below cursor)
    const suffix = rawSuffix.length > suffixBudget
        ? rawSuffix.slice(0, suffixBudget)
        : rawSuffix;

    return {
        prefix,
        suffix,
        language: document.languageId,
        cursorLine: position.line,
        cursorCol:  position.character,
    };
}

/**
 * Returns the content of the current function/class that the cursor is in.
 * Uses a simple heuristic (indent-based for Python, brace-tracking for C-like).
 * For a more accurate implementation, see backend/context/code_window_extractor.py.
 *
 * @param document - Active document.
 * @param position - Cursor position.
 * @returns The best-effort function/class body as a string, or empty string.
 */
export function extractCurrentBlock(
    document: vscode.TextDocument,
    position: vscode.Position
): string {
    const lang  = document.languageId;
    const lines  = document.getText().split('\n');
    const curLine = position.line;

    if (lang === 'python') {
        return _extractPythonBlock(lines, curLine);
    }
    return _extractBraceBlock(lines, curLine);
}

// ── Python: indent-based block detection ─────────────────────────────────────

export const ContextExtractor = {
    extractFIMContext,
    extractCurrentBlock
};

function _extractPythonBlock(lines: string[], cursorLine: number): string {
    // Walk up to find the nearest def / class
    let startLine = cursorLine;
    const curIndent = _indent(lines[cursorLine] ?? '');

    for (let i = cursorLine; i >= 0; i--) {
        const line = lines[i] ?? '';
        if (/^\s*(def |class |async def )/.test(line) && _indent(line) <= curIndent) {
            startLine = i;
            break;
        }
    }

    // Walk down until indent drops back to the level of the def/class or EOF
    const defIndent = _indent(lines[startLine] ?? '');
    let endLine = startLine + 1;
    while (endLine < lines.length) {
        const line = lines[endLine] ?? '';
        if (line.trim() === '') { endLine++; continue; }
        if (_indent(line) <= defIndent && endLine > startLine + 1) { break; }
        endLine++;
    }

    return lines.slice(startLine, Math.min(endLine, startLine + 120)).join('\n');
}

// ── C-like: brace-counting block detection ───────────────────────────────────

function _extractBraceBlock(lines: string[], cursorLine: number): string {
    // Find opening brace above cursor
    let depth = 0;
    let startLine = cursorLine;

    for (let i = cursorLine; i >= 0; i--) {
        const line = lines[i] ?? '';
        for (const ch of line) {
            if (ch === '}') { depth++; }
            if (ch === '{') {
                if (depth === 0) { startLine = i; break; }
                depth--;
            }
        }
        if (depth === 0 && i < cursorLine) { startLine = i; break; }
    }

    // Find matching closing brace below
    depth = 0;
    let endLine = startLine;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (const ch of line) {
            if (ch === '{') { depth++; }
            if (ch === '}') {
                depth--;
                if (depth === 0) { endLine = i; break; }
            }
        }
        if (depth === 0 && i > startLine) { endLine = i; break; }
    }

    return lines.slice(startLine, Math.min(endLine + 1, startLine + 120)).join('\n');
}

function _indent(line: string): number {
    return line.length - line.trimStart().length;
}
