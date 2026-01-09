# Snippet 004 - Tool Execution & Saveable Actions Implementation

## Files Created/Modified

### New Files
- `backend/src/tools.py` - Three simple deterministic tools:
  - `calculator(operation, a, b)` - add, subtract, multiply, divide
  - `text_transformer(text, transformation)` - uppercase, lowercase, reverse, capitalize
  - `list_formatter(items, format_type)` - numbered, bulleted, comma-separated
  
- `backend/src/storage.py` - Action storage system:
  - `SavedAction` model (id, tool_name, arguments, created_at, description)
  - `ActionStorage` class with in-memory storage
  - Global `action_storage` instance
  
- `backend/src/actions_router.py` - Actions management endpoints:
  - `GET /actions/` - List all saved actions
  - `GET /actions/{id}` - Get specific action
  - `POST /actions/{id}/execute` - Execute saved action

### Modified Files
- `backend/src/llm_client.py`:
  - Added `ToolCall` and `CompletionResult` models
  - Agent now includes tools
  - Tracks tool calls from message history
  - Returns CompletionResult with output + tool_calls

- `backend/src/models.py`:
  - Added `ToolCallInfo` model
  - Updated `ChatResponse` to include `tool_calls` and `is_saveable` flag

- `backend/src/router.py`:
  - Updated chat endpoint to return tool execution metadata
  - Added `POST /chat/save-action` endpoint
  - `is_saveable` = True when tool_calls > 0

- `backend/src/main.py`:
  - Added actions_router

## Flow
1. User sends chat request
2. LLM decides if tools are needed
3. Response includes: text output, tool_calls list, is_saveable flag
4. If is_saveable=True, frontend can prompt: "Save this action?"
5. User can save via POST /chat/save-action
6. Saved actions can be listed, retrieved, and re-executed

## Testing
```bash
# Chat with tool use
curl -X POST http://localhost:8000/chat/ \
  -H "Content-Type: application/json" \
  -d '{"query": "Calculate 25 + 17"}'

# Save an action
curl -X POST http://localhost:8000/chat/save-action \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "calculator", "arguments": {"operation": "add", "a": 25, "b": 17}, "description": "Add 25 and 17"}'

# List actions
curl http://localhost:8000/actions/

# Execute saved action
curl -X POST http://localhost:8000/actions/{action_id}/execute
```
