# Snippet 018 - Session Summary: Sidebar & Variable Parameters

## Session Overview
This session focused on implementing a sidebar for saved actions and adding variable parameter support, enabling reusable actions with configurable inputs.

---

## Part 1: Sidebar with Saved Actions

### Goal
Display saved actions in a sidebar where users can view, execute, and delete them.

### Backend Implementation

**New Endpoint:**
```python
DELETE /actions/{action_id}
```

### Frontend Implementation

**New Components:**
1. **ActionCard.tsx + CSS**
   - Displays individual saved action
   - Shows tool name, arguments (JSON), timestamp, description
   - Execute button (blue)
   - Delete button (× icon, red hover)

2. **Sidebar.tsx + CSS**
   - 350px fixed width, right side
   - Header: "Saved Actions" + refresh button (↻)
   - Auto-fetches on mount
   - Loading/error/empty states
   - Scrollable action list

**Layout Changes:**
- Updated App.tsx: Split layout (Chat left + Sidebar right)
- Chat: Changed from `width: 100%` to `flex: 1`

**API Updates:**
- Added `deleteAction(actionId)`
- Added `executeAction(actionId)` (already existed but documented)

### Auto-Refresh Feature

**Problem:** Sidebar didn't update when action was saved in Chat

**Solution:** Lift state to App component
```tsx
// App.tsx
const [refreshTrigger, setRefreshTrigger] = useState(0);

<Chat onActionSaved={() => setRefreshTrigger(prev => prev + 1)} />
<Sidebar refreshTrigger={refreshTrigger} />
```

**Flow:**
1. User saves action → Chat calls `onActionSaved()`
2. App increments `refreshTrigger`
3. Sidebar's `useEffect` detects change → refetches actions
4. New action appears immediately

---

## Part 2: Variable Parameters

### Goal
Allow users to configure action parameters as variables, enabling parameter changes at execution time without saving multiple similar actions.

### Use Case
Save "Execute Report" once, but execute with different report IDs (ABC123, XYZ789, etc.) each time.

### Backend Implementation

#### 1. Variable Resolver (`variable_resolver.py`)

**Variable Syntax:**
```
{{var:name:type:label}}

Example: {{var:report_id:string:Report ID}}

Parts:
- name: Variable identifier (required)
- type: "string" | "number" (optional, default: "string")
- label: Display name (optional, default: name)
```

**Functions:**
- `extract_variables(arguments)` → Finds all `{{var:...}}` patterns
- `parse_variable(value)` → Parses syntax into dict
- `resolve_variables(arguments, values)` → Replaces variables with actual values

**Example:**
```python
# Stored arguments
{"report_id": "{{var:report_id:string:Report ID}}"}

# User provides
{"report_id": "XYZ789"}

# Resolved
{"report_id": "XYZ789"}
```

#### 2. Updated Endpoints

**GET /actions/{action_id}/variables**
- Returns list of variables needed for action
- Returns: `[{parameter_name, variable_name, variable_type, variable_label}]`

**POST /actions/{action_id}/execute**
- Now accepts request body: `{variables: dict}`
- Resolves variables before execution

### Frontend Implementation

#### 1. ParameterConfigModal Component

**Purpose:** Configure parameters when saving action

**UI:**
```
┌─────────────────────────────────┐
│ Configure Action: execute_report│
│                                 │
│ Description (optional):         │
│ [Monthly report             ]   │
│                                 │
│ Parameters:                     │
│ ┌─────────────────────────────┐ │
│ │ report_id                   │ │
│ │ [ABC123                 ]   │ │
│ │ ☑ Make this a variable      │ │
│ │   Label: [Report ID     ]   │ │
│ └─────────────────────────────┘ │
│                                 │
│ [Cancel] [Save Action]          │
└─────────────────────────────────┘
```

**Features:**
- Shows all tool parameters
- Checkbox to mark as variable
- Label input for custom display name
- Optional description field

#### 2. VariablePromptModal Component

**Purpose:** Prompt for variable values at execution time

**UI:**
```
┌─────────────────────────────────┐
│ Enter Variable Values           │
│                                 │
│ Report ID:                      │
│ [                           ]   │
│                                 │
│ [Cancel] [Execute]              │
└─────────────────────────────────┘
```

**Features:**
- Input fields for each variable
- Type-aware inputs (text/number)
- Custom labels from configuration

#### 3. Updated Chat.tsx

**Changes:**
- Added state: `configModalOpen`, `selectedToolCall`
- `handleSaveAction` → Opens ParameterConfigModal
- `handleSaveWithConfig` → Saves with configured parameters
- Renders ParameterConfigModal when open

#### 4. Updated Sidebar.tsx

**Changes:**
- Added state: `promptModalOpen`, `selectedActionId`, `variables`
- `handleExecute` → Checks for variables via `getActionVariables()`
- If variables exist → Opens VariablePromptModal
- If no variables → Direct execution
- `handleExecuteWithVariables` → Executes with provided values
- Renders VariablePromptModal when open

#### 5. Updated api.ts

**New Interface:**
```typescript
interface VariableInfo {
  parameter_name: string;
  variable_name: string;
  variable_type: string;
  variable_label: string;
}
```

**New Function:**
```typescript
getActionVariables(actionId: string): Promise<VariableInfo[]>
```

**Updated Function:**
```typescript
executeAction(
  actionId: string,
  variables?: Record<string, any>
): Promise<string>
```

---

## Complete User Flows

### Flow 1: Save Action with Variable

1. **User asks:** "Execute report ABC123"
2. **LLM calls:** `execute_report(report_id="ABC123")`
3. **User clicks:** "Save this action"
4. **Modal appears:** ParameterConfigModal
5. **User checks:** "Make this a variable"
6. **User enters label:** "Report ID"
7. **User adds description:** "Monthly report"
8. **Clicks:** "Save Action"
9. **Stored as:**
   ```json
   {
     "tool_name": "execute_report",
     "arguments": {
       "report_id": "{{var:report_id:string:Report ID}}"
     },
     "description": "Monthly report"
   }
   ```
10. **Action appears in sidebar immediately** (auto-refresh)

### Flow 2: Execute Action with Variable

1. **User clicks:** "Execute" button on saved action in sidebar
2. **Backend checks:** `GET /actions/{id}/variables` → finds `report_id` variable
3. **Modal appears:** VariablePromptModal
4. **Shows:** "Report ID: [____]"
5. **User enters:** "XYZ789"
6. **Clicks:** "Execute"
7. **Frontend calls:** `POST /actions/{id}/execute` with `{variables: {report_id: "XYZ789"}}`
8. **Backend resolves:** `{{var:report_id:string:Report ID}}` → `"XYZ789"`
9. **Executes:** `execute_report(report_id="XYZ789")`
10. **Alert shows:** "Executed Ardoq report with ID: XYZ789..."

### Flow 3: Save Action without Variables (Quick Save)

1. **User asks:** "Calculate 2+2"
2. **LLM calls:** `calculator(operation="add", a=2, b=2)`
3. **User clicks:** "Save this action"
4. **Modal appears:** ParameterConfigModal with all params
5. **User clicks:** "Save Action" (without checking any variables)
6. **Stored as:**
   ```json
   {
     "tool_name": "calculator",
     "arguments": {
       "operation": "add",
       "a": 2,
       "b": 2
     }
   }
   ```
7. **When executed:** No prompt, executes directly with saved values

---

## Technical Architecture

### Data Flow

**Save with Variable:**
```
Chat → "Save action" click
  → Open ParameterConfigModal
  → User configures
  → Save with {{var:...}} syntax
  → Call onActionSaved()
  → App increments refreshTrigger
  → Sidebar refetches
  → Action appears
```

**Execute with Variable:**
```
Sidebar → "Execute" click
  → GET /actions/{id}/variables
  → If variables exist:
      → Open VariablePromptModal
      → User enters values
      → POST /actions/{id}/execute with variables
      → Backend resolves {{var:...}}
      → Execute tool
      → Return result
```

### Variable Resolution Algorithm

```python
# 1. Extract (backend)
arguments = {"report_id": "{{var:report_id:string:Report ID}}"}
variables = extract_variables(arguments)
# → [{parameter_name: "report_id", variable_name: "report_id", ...}]

# 2. Prompt (frontend)
user_input = {"report_id": "XYZ789"}

# 3. Resolve (backend)
resolved = resolve_variables(arguments, user_input)
# → {"report_id": "XYZ789"}

# 4. Execute (backend)
tool_func(**resolved)
```

---

## Key Design Decisions

### 1. Variable Syntax in Arguments
**Decision:** Store variables as special strings `{{var:...}}` in arguments dict
**Alternative considered:** Separate `variables` field in SavedAction model
**Rationale:** Simpler, no schema change, backward compatible

### 2. Configuration Modal vs Quick Save
**Decision:** Always show modal when saving
**Alternative considered:** Quick save by default, "Configure" button for advanced
**Rationale:** Variables are core feature, user should see options

**Note:** Could change to Option B in future for better UX

### 3. Variable Prompt Timing
**Decision:** Prompt at execution time
**Alternative considered:** Variables set at save time with option to override
**Rationale:** More flexible, clearer UX

### 4. Modal vs Inline Forms
**Decision:** Modal overlays for both config and prompt
**Alternative considered:** Inline forms in sidebar/chat
**Rationale:** Less UI clutter, clearer focus, easier to implement

---

## Files Created/Modified

### Backend
- ✅ **variable_resolver.py** (new) - Variable extraction and resolution
- ✅ **actions_router.py** - Added variables endpoint, updated execute

### Frontend
- ✅ **ParameterConfigModal.tsx** (new) - Parameter configuration UI
- ✅ **ParameterConfigModal.css** (new) - Shared modal styles
- ✅ **VariablePromptModal.tsx** (new) - Variable input prompt UI
- ✅ **ActionCard.tsx** (new) - Individual action display
- ✅ **ActionCard.css** (new) - Action card styles
- ✅ **Sidebar.tsx** (new) - Actions sidebar
- ✅ **Sidebar.css** (new) - Sidebar styles
- ✅ **Chat.tsx** - Added config modal integration
- ✅ **App.tsx** - Split layout + refresh trigger
- ✅ **App.css** - Layout styles
- ✅ **api.ts** - Added variable functions

---

## Benefits Achieved

✅ **Reusability:** Save once, execute many times with different inputs
✅ **Flexibility:** Change parameters without reconfiguring action
✅ **Organization:** All actions visible in sidebar
✅ **Instant Updates:** Sidebar refreshes automatically on save
✅ **Type Safety:** Support for string/number types
✅ **Clean UX:** Clear modals for configuration and prompting
✅ **Backwards Compatible:** Actions without variables work as before

---

## Current State Summary

**Working Features:**
- ✅ LLM chat with tool execution (calculator, text_transformer, list_formatter, execute_report)
- ✅ Save tool executions as actions
- ✅ Configure parameters as variables when saving
- ✅ Sidebar displays all saved actions
- ✅ Execute actions with variable prompts
- ✅ Delete actions
- ✅ Auto-refresh sidebar on save
- ✅ Markdown rendering in chat
- ✅ Full-screen responsive layout

**Ready for Next Phase:**
- Workflows (chaining actions)
- Drag-and-drop workflow builder
- Workflow execution
- Input mapping between workflow steps

---

## Lessons Learned

1. **State Management:** Lifting state to parent (App) enables clean communication between siblings (Chat ↔ Sidebar)

2. **Modal Patterns:** Reusable modal overlay pattern works well for configuration flows

3. **Special Syntax:** Using `{{var:...}}` in strings is simple but powerful for variable support

4. **Type Resolution:** Supporting both string and number types covers most use cases

5. **UX Flow:** Immediate visual feedback (auto-refresh) improves user experience significantly

---

## Next Steps (Future Sessions)

Based on earlier planning (snippet_016):

### Phase 2A: Workflow Backend
- Create Workflow and WorkflowStep models
- Implement workflow storage (in-memory)
- Add workflow CRUD endpoints
- Test with Postman/curl

### Phase 2B: Workflow Execution
- Implement sequential execution without input mapping (MVP)
- Later: Add input mapping between steps
- Handle errors gracefully

### Phase 2C: Workflow UI
- Add "Workflows" tab to sidebar
- Implement workflow list and execution
- Show execution results

### Phase 2D: Workflow Builder (Complex)
- Drag-and-drop interface
- Visual step ordering
- Save/edit workflows

---

## Summary

This session successfully implemented:
1. **Sidebar with saved actions** - Complete CRUD + execution
2. **Variable parameters** - Flexible, reusable actions
3. **Auto-refresh** - Real-time UI updates
4. **Clean modals** - Configuration and prompt flows

The foundation is now ready for building workflow functionality on top of individual actions!
