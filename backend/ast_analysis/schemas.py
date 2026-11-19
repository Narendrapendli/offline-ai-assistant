"""
backend/ast_analysis/schemas.py
Pydantic models for AST parsing results.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class FunctionInfo(BaseModel):
    name: str = Field(description="Name of the function/method")
    start_line: int = Field(description="0-indexed start line")
    end_line: int = Field(description="0-indexed end line")
    parameters: list[str] = Field(default_factory=list, description="List of parameter names/signatures")
    return_type: Optional[str] = Field(default=None, description="Return type hint (if available)")
    docstring: Optional[str] = Field(default=None, description="Function docstring context")


class ClassInfo(BaseModel):
    name: str = Field(description="Name of the class")
    start_line: int = Field(description="0-indexed start line")
    end_line: int = Field(description="0-indexed end line")
    bases: list[str] = Field(default_factory=list, description="Base classes/interfaces")
    methods: list[FunctionInfo] = Field(default_factory=list, description="Methods defined in this class")


class CodeStructure(BaseModel):
    """Represents the parsed structural overview of a source file."""
    file_path: str = Field(description="Path to the parsed file")
    language: str = Field(description="Identified language (e.g. 'python', 'cpp')")
    
    functions: list[FunctionInfo] = Field(default_factory=list, description="Top-level functions")
    classes: list[ClassInfo] = Field(default_factory=list, description="Classes and their methods")
    imports: list[str] = Field(default_factory=list, description="Import/include directives")
    
    current_function: Optional[FunctionInfo] = Field(default=None, description="The function currently enclosing the cursor")
    current_class: Optional[ClassInfo] = Field(default=None, description="The class currently enclosing the cursor")
