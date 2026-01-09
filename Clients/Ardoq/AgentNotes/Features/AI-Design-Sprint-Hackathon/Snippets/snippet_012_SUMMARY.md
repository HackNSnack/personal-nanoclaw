# Snippet 012 - Complete Hackathon Implementation Summary

## Project Overview
Built an LLM-based chatbot system with tool execution and action-saving capabilities for Ardoq hackathon.

---

## Backend Implementation (FastAPI + Pydantic AI)

### Core Structure
- **Framework**: FastAPI with Pydantic AI for LLM integration
- **LLM Provider**: LiteLLM (configured via env vars)
- **Model**: anthropic-claude-sonnet-4-5

### Files Created
```
backend/src/
├── main.py                 # FastAPI app with CORS
├── router.py              # Chat endpoints
├── actions_router.py      # Action management endpoints  
├── models.py              # Request/response models
├── llm_client.py          # Pydantic AI client wrapper
├── tools.py               # Tool definitions
└── storage.py             # In-memory action storage
```

### Key Features

#### 1. LLM Client (`llm_client.py`)
- Uses Pydantic AI `Agent` with OpenAIChatModel + LiteLLMProvider
- Registers tools: calculator, text_transformer, list_formatter
- Tracks tool calls from LLM responses
- Returns `CompletionResult` with output + tool_calls
- **Bug Fix**: JSON.parse args (were strings, needed dict)

#### 2. Tools (`tools.py`)
Simple deterministic functions:
- **calculator**: add, subtract, multiply, divide
- **text_transformer**: uppercase, lowercase, reverse, capitalize
- **list_formatter**: numbered, bulleted, comma-separated

#### 3. API Endpoints

**Chat Router** (`/chat/`)
- `POST /chat/` - Send message, get response with tool_calls
- `POST /chat/save-action` - Save tool execution for later

**Actions Router** (`/actions/`)
- `GET /actions/` - List all saved actions
- `GET /actions/{id}` - Get specific action
- `POST /actions/{id}/execute` - Re-run saved action

#### 4. Response Models (`models.py`)
```python
class ToolCallInfo(BaseModel):
    tool_name: str
    arguments: dict
    is_saveable: bool  # Always True for tool executions

class ChatResponse(BaseModel):
    response: str
    tool_calls: list[ToolCallInfo]
```

#### 5. Action Storage (`storage.py`)
- In-memory dict storage
- `SavedAction` model with id, tool_name, arguments, created_at, description
- CRUD operations: save, get, list, delete

#### 6. CORS Configuration (`main.py`)
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Environment Variables Required
```bash
LITELLM_API_BASE=http://localhost:4000
LITELLM_API_KEY=dummy-key
```

---

## Frontend Implementation (React + TypeScript + Vite)

### Structure
```
frontend/src/
├── App.tsx      # Root component
├── Chat.tsx     # Main chat interface
├── Chat.css     # Styling
├── api.ts       # Backend API client
└── index.css    # Global styles
```

### Key Features

#### 1. API Client (`api.ts`)
```typescript
interface ToolCall {
  tool_name: string;
  arguments: Record<string, any>;
  is_saveable: boolean;
}

interface ChatResponse {
  response: string;
  tool_calls: ToolCall[];
}

// Functions
- sendChatMessage(query, modelName)
- saveAction(toolName, args, description)
- listActions()
```

#### 2. Chat Component (`Chat.tsx`)
- Message state management (user/assistant)
- Sends to `POST /chat/`
- Displays chat history
- Shows tool calls with "Save this action" button
- Markdown rendering with `react-markdown`
- Loading states
- Thumbs up/down feedback buttons

#### 3. UI Design (`Chat.css`)
Based on provided screenshot:
- **Header**: "Assistant" + blue "Beta" badge, icon buttons (↻, ✎, −)
- **Layout**: Full-screen width, centered content (900px max-width)
- **Messages**: Rounded bubbles (grey backgrounds)
  - User: right-aligned #e5e7eb
  - Assistant: left-aligned #f3f4f6
- **Tool calls**: Yellow boxes (#fef3c7) with save button
- **Input**: Rounded pill shape with circular blue send button (↑)
- **Footer**: Disclaimer "AI can make mistakes, especially in calculations"
- **Markdown**: Styled code blocks, headers, lists, links

#### 4. Markdown Support
- Installed: `react-markdown`
- Renders: **bold**, *italic*, headers, lists, `code`, code blocks, links, blockquotes
- Styled code blocks with grey background (#f1f5f9)

---

## How It Works

### Basic Flow
1. User types message → Frontend sends to `POST /chat/`
2. Backend LLM decides if tools needed
3. If tools used → Returns response + tool_calls + is_saveable=true
4. Frontend displays message + tool info + "Save this action" button
5. User can save → `POST /chat/save-action`
6. Saved actions can be re-executed → `POST /actions/{id}/execute`

### Tool Execution Example
**User**: "What's 2+2?"

**LLM Response**:
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

**Frontend**: Shows "Save this action" button

**If saved**: Action stored with UUID, can be re-run later

---

## Key Design Decisions

### 1. Saveable Actions
- **Rule**: Only tool executions are saveable (not plain text)
- Each tool call has `is_saveable: true`
- Pure text completion has empty `tool_calls` array

### 2. Simple & Hackathon-Focused
- No abstractions or interfaces
- In-memory storage (not persistent)
- Simple deterministic tools for demo
- Direct implementation without complex architecture

### 3. Single Action Save (For Now)
- Currently saves one action at a time
- Future: Could expand to workflows with multiple actions

---

## Running the Project

### Backend
```bash
cd backend
# Set env vars in .env file
uvicorn src.main:app --reload
# Runs on http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

---

## Testing

### Manual Test Flow
1. Start backend: `uvicorn src.main:app --reload`
2. Start frontend: `npm run dev`
3. Ask: "What's 25 + 17?"
4. See tool call with calculator
5. Click "Save this action"
6. Check saved actions: `curl http://localhost:8000/actions/`

### Example Queries
- "What's 2+2?" → calculator tool
- "Convert 'hello world' to uppercase" → text_transformer tool
- "Format these as a list: apple, banana, orange" → list_formatter tool

---

## Important Bugs Fixed

### Bug 1: Arguments Parsing
- **Issue**: `part.args` was JSON string, not dict
- **Fix**: Added `json.loads()` in `llm_client.py`
```python
args = part.args
if isinstance(args, str):
    args = json.loads(args)
```

### Bug 2: CORS
- **Issue**: Browser blocked OPTIONS preflight
- **Fix**: Added CORSMiddleware to FastAPI

---

## Dependencies

### Backend
```toml
dependencies = [
    "fastapi>=0.115.12",
    "uvicorn[standard]>=0.24.0",
    "pydantic-ai>=1.0.8",
    "litellm>=1.80.0",
    "httpx>=0.28.1",
]
```

### Frontend
```json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-markdown": "latest"
  }
}
```

---

## Next Steps / Future Enhancements
- Persistent storage (database instead of in-memory)
- Workflow creation (chain multiple actions)
- More sophisticated tools
- Authentication/authorization
- Tool execution history
- Edit/delete saved actions
- Export/import actions
- Action templates
- Scheduled action execution

---

## File Locations

### Backend
`/home/mathipe/Prosjekter/Netlight/ardoq/hackathon/backend/src/`

### Frontend
`/home/mathipe/Prosjekter/Netlight/ardoq/hackathon/frontend/src/`

### Documentation
`Clients/Ardoq/AgentNotes/Features/AI-Design-Sprint-Hackathon/`

---

## Summary
Successfully built a working proof-of-concept chatbot with:
✅ LLM-based chat interface
✅ Tool execution (calculator, text transformer, list formatter)
✅ Action tracking and saving
✅ Re-execution of saved actions
✅ Clean UI matching design mockup
✅ Markdown rendering
✅ Full-screen responsive layout

Ready for hackathon demo!
