"""
backend/ast_analysis/prompt_enricher.py
Injects AST structural context into LLM prompts.
"""

from __future__ import annotations

from .schemas import CodeStructure


class PromptEnricher:
    """Modifies context/prompts based on the structural AST analysis."""

    @staticmethod
    def enrich_autocomplete_prompt(structure: CodeStructure | None, prefix: str) -> str:
        """
        Enhance the FIM prefix by whispering the current structural context
        to the model.
        """
        if not structure:
            return prefix

        context_clues = []
        
        # Are we inside a class?
        if structure.current_class:
            c = structure.current_class
            base_str = f"({', '.join(c.bases)})" if c.bases else ""
            context_clues.append(f"Inside class {c.name}{base_str}")

        # Are we inside a function?
        if structure.current_function:
            f = structure.current_function
            param_str = ", ".join(f.parameters)
            ret_str = f" -> {f.return_type}" if f.return_type else ""
            context_clues.append(f"Inside function {f.name}({param_str}){ret_str}")

        if not context_clues:
            return prefix

        # DeepSeek-Coder handles commented hints well at the very top of the prefix
        comment_symbol = "#" if structure.language == "python" else "//"
        
        hint_lines = [f"{comment_symbol} Context: {clue}" for clue in context_clues]
        hint_block = "\n".join(hint_lines) + "\n\n"

        # Prepend the structural hint to the prefix
        return hint_block + prefix

    @staticmethod
    def enrich_chat_prompt(structure: CodeStructure | None, query: str) -> str:
        """
        Enhance a chat query with the overall file structure.
        """
        if not structure:
            return query

        lines = [f"### Structural Context ({structure.file_path}) ###\n"]
        
        if structure.imports:
            lines.append("Imports:")
            lines.extend(f"  - {i}" for i in structure.imports[:10])  # limit
            
        if structure.classes:
            lines.append("\nClasses:")
            for c in structure.classes:
                lines.append(f"  class {c.name}:")
                for m in c.methods:
                    lines.append(f"    def {m.name}()")
                    
        if structure.functions:
            lines.append("\nTop-level Functions:")
            for f in structure.functions:
                lines.append(f"  def {f.name}()")

        structure_text = "\n".join(lines)
        
        # Inject before the actual user query
        return f"{structure_text}\n\nUser Query: {query}"
