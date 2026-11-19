import socket
import requests
import subprocess
import os
import sys

def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def get_pid_on_port(port):
    try:
        output = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True).decode()
        for line in output.splitlines():
            if "LISTENING" in line:
                return line.strip().split()[-1]
    except:
        return None
    return None

print("--- AI Assistant Doctor ---")

# 1. Check Ollama
print(f"Ollama (11434): {'ALIVE' if check_port(11434) else 'OFFLINE'}")

# 2. Check Backend Port
backend_alive = check_port(8000)
print(f"Backend Port (8000): {'OCCUPIED' if backend_alive else 'FREE'}")

if backend_alive:
    pid = get_pid_on_port(8000)
    print(f"  PID on 8000: {pid}")
    try:
        res = requests.get("http://localhost:8000/health", timeout=2)
        print(f"  Health Check: {res.status_code} {res.json()}")
    except Exception as e:
        print(f"  Health Check: FAILED ({e})")
else:
    print("  Port 8000 is free. Backend is NOT running.")

# 3. Check Venv
venv_python = r"c:\Users\HP\Downloads\New folder (5)\.venv\Scripts\python.exe"
if os.path.exists(venv_python):
    print(f"Venv Python: FOUND")
    try:
        output = subprocess.check_output([venv_python, "-c", "import fastapi; import uvicorn; import tree_sitter; print('Deps: OK')"], stderr=subprocess.STDOUT).decode()
        print(f"  {output.strip()}")
    except Exception as e:
        print(f"  Deps Check: FAILED ({e})")
else:
    print(f"Venv Python: NOT FOUND at {venv_python}")

# 4. Environment Check
print(f"Current Directory: {os.getcwd()}")
print(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'Not set')}")

print("--- End ---")
