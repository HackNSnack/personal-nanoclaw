# Snippet 013 - Added Ardoq Report Execution Tool

## New Tool

### `execute_report` (tools.py)
```python
def execute_report(ctx: RunContext[None], report_id: str) -> str:
    return f"Executed Ardoq report with ID: {report_id}. Report completed successfully with 42 results."
```

**Parameters:**
- `report_id` (str): The ID of the Ardoq report to execute

**Returns:**
- Deterministic string with report ID and fake result count

## Updated Files

1. **backend/src/tools.py** - Added `execute_report` function
2. **backend/src/llm_client.py** - Added to tools list in Agent
3. **backend/src/actions_router.py** - Added to tool_map for execution

## Usage Example

**User query**: "Execute report ABC123"

**LLM will call**: `execute_report(report_id="ABC123")`

**Response**: "Executed Ardoq report with ID: ABC123. Report completed successfully with 42 results."

## Saveable
Yes - can be saved and re-executed like other tools.
