# Snippet 002 - Refactoring Strategy

## Date
2025-12-19

## Challenge
Obsidian module incompatible with programmatic registration pattern:
1. Each tool file creates its own Obsidian client at module load
2. Environment variables checked at import time
3. Decorator-based registration coupled to server instance
4. Relative imports throughout

## Refactoring Plan
1. Create singleton client pattern (`client.py`)
2. Convert all tools to plain functions
3. Update imports to absolute paths
4. Export tools via `__init__.py`
5. Register in `main.py`

## Key Insight
User preference: **Avoid relative imports**. Use `from src.module.submodule import ...` format throughout.

This ensures:
- Clear module boundaries
- Consistent import style
- No relative import confusion
- Better IDE support
