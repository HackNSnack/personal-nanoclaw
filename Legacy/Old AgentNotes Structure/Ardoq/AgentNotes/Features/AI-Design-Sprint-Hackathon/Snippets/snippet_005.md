# Snippet 005 - Fixed Arguments Parsing Bug

## Issue
`part.args` from Pydantic AI was returning a JSON string instead of a dict, causing validation error when creating ToolCall objects.

## Error
```
ValidationError: 1 validation error for ToolCall
arguments
  Input should be a valid dictionary [type=dict_type, input_value='{"operation": "add", "a": 2, "b": 2}', input_type=str]
```

## Fix
Added JSON parsing in `backend/src/llm_client.py`:
```python
args = part.args
if isinstance(args, str):
    args = json.loads(args)
```

## Test Result
Query: "What's 2+2?"
- Output: "2 + 2 = 4"
- Tool calls: calculator with {"operation": "add", "a": 2, "b": 2}
- is_saveable: True ✓
