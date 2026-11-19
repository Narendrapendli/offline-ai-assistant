import subprocess
import os
from typing import List, Dict

class GitService:
    def get_file_history(self, file_path: str, project_path: str, max_commits: int = 20) -> str:
        try:
            return subprocess.check_output(
                ["git", "log", "--follow", "-p", f"--max-count={max_commits}", "--", file_path],
                cwd=project_path,
                stderr=subprocess.STDOUT,
                encoding='utf-8',
                errors='replace'
            )
        except Exception as e:
            return f"Error getting git history: {str(e)}"

    def get_function_history(self, file_path: str, function_name: str, project_path: str) -> str:
        try:
            return subprocess.check_output(
                ["git", "log", "-p", f"-S{function_name}", "--", file_path],
                cwd=project_path,
                stderr=subprocess.STDOUT,
                encoding='utf-8',
                errors='replace'
            )
        except Exception as e:
            return f"Error getting function history: {str(e)}"

    def get_recent_diffs(self, project_path: str, days: int = 14) -> List[Dict]:
        try:
            # Simplified version: get commit messages and diffs
            output = subprocess.check_output(
                ["git", "log", f"--since={days} days ago", "-p", "--pretty=format:COMMIT_START|%H|%an|%ad|%s"],
                cwd=project_path,
                encoding='utf-8',
                errors='replace'
            )
            
            commits = []
            parts = output.split("COMMIT_START|")
            parts = parts[1:]
            for p in parts:
                lines = p.split('\n')
                meta = lines[0].split('|')
                commits.append({
                    "hash": meta[0],
                    "author": meta[1],
                    "date": meta[2],
                    "message": meta[3],
                    "diff": '\n'.join(lines[1:])
                })
            return commits
        except:
            return []

global_git = GitService()
