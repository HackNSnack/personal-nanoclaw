# Snippet 006 - Moved is_saveable to Tool Call Level

## Change
Moved `is_saveable` from ChatResponse to individual ToolCallInfo objects.

## Updated Models
`backend/src/models.py`:
- Added `is_saveable: bool` to ToolCallInfo
- Removed `is_saveable` from ChatResponse

`backend/src/router.py`:
- Each ToolCallInfo now has `is_saveable=True`
- All tool executions are saveable by design

## Response Structure
```json
{
  "response": "2 + 2 = 4",
  "tool_calls": [
    {
      "tool_name": "calculator",
      "arguments": {"operation": "add", "a": 2, "b": 2},
      "is_saveable": true
    }
  ]
}
```
