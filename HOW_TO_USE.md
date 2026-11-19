# AI Assistant Setup & Usage Guide

## 1. One-Time Setup (Terminal)
The terminal is your engine. If you see security warnings, follow these steps:
- Click the terminal window.
- Type **`Y`** and press **Enter** for every prompt until it finishes.
- Once you see `[OK] Backend is running`, the system is ready.

## 2. Command Reference
| Goal | Action | Shortcut |
| --- | --- | --- |
| **Fix/Explain Code** | Right-click the code → select from "AI Assistant" menu | - |
| **Analyze Project** | `Ctrl + Shift + P` → `AI: Project Health Dashboard` | - |
| **Write Unit Tests** | Select code → `AI: Generate Tests` | `Ctrl + Shift + T` |
| **Add Docstrings** | Cursor on function → `AI: Generate Docstring` | `Ctrl + Shift + D` |
| **Help Panel** | `Ctrl + Shift + P` → `AI: Show Help` | - |

## 3. UI Features
- **Avatars**: The chat now shows **AI** and **U** icons to help you track the conversation.
- **Auto-Context**: If you don't select any code, the AI will automatically see the **entire file** you are currently editing.
- **Status Bar**: Check the bottom-right corner for **latency (ms)** and model status.

> [!TIP]
> If you change code and want the AI to see the latest version, just send another message. It automatically re-scans your active file with every query.
