# Snippet 003 - Singleton Pattern Implementation

## Date
2025-12-19

## Implementation
Created `src/obsidian_module/client.py` with singleton pattern:

```python
import os
from src.obsidian_module.obsidian import Obsidian

_obsidian_client = None

def get_obsidian_client() -> Obsidian:
    global _obsidian_client
    
    if _obsidian_client is None:
        api_key = os.getenv("OBSIDIAN_API_KEY", "")
        obsidian_host = os.getenv("OBSIDIAN_HOST", "127.0.0.1")
        
        if api_key == "":
            raise ValueError(
                f"OBSIDIAN_API_KEY environment variable required. Working directory: {os.getcwd()}"
            )
        
        _obsidian_client = Obsidian(api_key=api_key, host=obsidian_host)
    
    return _obsidian_client
```

## Benefits
1. **Lazy initialization** - Client created only when first tool is called
2. **Single instance** - Reused across all tool calls
3. **Resource efficiency** - No repeated client creation
4. **Clear error messages** - Env var validation centralized

## Usage in Tools
Before:
```python
api = Obsidian(api_key=api_key, host=obsidian_host)
content = api.get_file_contents(filepath)
```

After:
```python
api = get_obsidian_client()
content = api.get_file_contents(filepath)
```

## Pattern Applied
Same pattern used for web search agent:
```python
_agent = None

def get_agent() -> Agent:
    global _agent
    if _agent is None:
        _agent = Agent()
    return _agent
```
