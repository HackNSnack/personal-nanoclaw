# Snippet 017 - Variable Parameters Implementation

## Overview
Added ability to make action parameters variable, allowing users to change values at execution time.

---

## Backend Changes

### 1. variable_resolver.py (New File)

**Functions:**
- `extract_variables(arguments: dict)` - Finds all `{{var:...}}` in arguments
- `parse_variable(value: str)` - Parses `{{var:name:type:label}}` format
- `resolve_variables(arguments: dict, values: dict)` - Replaces variables with actual values

**Variable Syntax:**
```
{{var:variable_name:type:label}}

Example: {{var:report_id:string:Report ID}}
```

### 2. actions_router.py (Updated)

**New Endpoint:**
```python
GET /actions/{action_id}/variables
Returns: list[VariableInfo]
```

**Updated Endpoint:**
```python
POST /actions/{action_id}/execute
Body: { variables: dict }
```

Now accepts variable values and resolves them before execution.

---

## Frontend Changes

### 1. ParameterConfigModal Component (New)

**Purpose:** Configure action parameters when saving

**Features:**
- Shows all parameters with current values
- Checkbox to make each parameter a variable
- Text input for variable label
- Description field (optional)

**Flow:**
1. User clicks "Save this action"
2. Modal appears with parameter configuration
3. User can mark params as variable
4. Saves with `{{var:...}}` syntax

### 2. VariablePromptModal Component (New)

**Purpose:** Prompt for variable values at execution time

**Features:**
- Shows all required variables
- Input fields with appropriate types (text/number)
- Labels from configuration

**Flow:**
1. User clicks "Execute" on action with variables
2. Modal prompts for values
3. User enters values
4. Executes with provided values

### 3. Chat.tsx (Updated)

**Changes:**
- Added state for config modal
- `handleSaveAction` now opens ParameterConfigModal
- `handleSaveWithConfig` saves with configured parameters

### 4. Sidebar.tsx (Updated)

**Changes:**
- Added state for variable prompt modal
- `handleExecute` checks for variables first
- If variables found, opens VariablePromptModal
- `handleExecuteWithVariables` executes with values

### 5. api.ts (Updated)

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
executeAction(actionId: string, variables?: Record<string, any>): Promise<string>
```

---

## User Flow Examples

### Example 1: Save with Variable

**User:** "Execute report ABC123"

**LLM:** Calls `execute_report(report_id="ABC123")`

**User clicks "Save this action":**

```
┌─────────────────────────────────┐
│ Configure Action: execute_report│
│                                 │
│ Description:                    │
│ [Monthly report             ]   │
│                                 │
│ Parameters:                     │
│ ┌─────────────────────────────┐ │
│ │ report_id                   │ │
│ │ [ABC123                 ]   │ │
│ │ ☑ Make this a variable      │ │
│ │ Label: [Report ID       ]   │ │
│ └─────────────────────────────┘ │
│                                 │
│ [Cancel] [Save Action]          │
└─────────────────────────────────┘
```

**Saved as:**
```json
{
  "tool_name": "execute_report",
  "arguments": {
    "report_id": "{{var:report_id:string:Report ID}}"
  },
  "description": "Monthly report"
}
```

### Example 2: Execute with Variable

**User clicks "Execute" on saved action:**

```
┌─────────────────────────────────┐
│ Enter Variable Values           │
│                                 │
│ Report ID:                      │
│ [XYZ789                     ]   │
│                                 │
│ [Cancel] [Execute]              │
└─────────────────────────────────┘
```

**Backend executes:**
```python
execute_report(report_id="XYZ789")
```

---

## Technical Details

### Variable Format
```
{{var:name:type:label}}

Parts:
- name: Variable identifier (e.g., "report_id")
- type: "string" | "number" (optional, defaults to "string")
- label: Display name (optional, defaults to name)
```

### Resolution Process

1. **Save time:** User configures → stored as `{{var:...}}`
2. **Execute time:** 
   - Backend checks for `{{var:...}}` patterns
   - Extracts variable info
   - Frontend prompts user
   - User provides values
   - Backend resolves and executes

### Type Handling

- **String:** Used as-is
- **Number:** Parsed to float

---

## Benefits

✅ Reusable actions with different inputs
✅ No need to save multiple similar actions
✅ Flexible execution without reconfiguration
✅ Clear UI for variable management
✅ Type-safe execution

---

## Next Steps

- Add support for select/dropdown variables
- Add support for boolean variables
- Add default values for variables
- Validate required variables
- Add variable preview in ActionCard

---

## Files Modified

**Backend:**
- `variable_resolver.py` (new)
- `actions_router.py`

**Frontend:**
- `ParameterConfigModal.tsx` (new)
- `ParameterConfigModal.css` (new)
- `VariablePromptModal.tsx` (new)
- `Chat.tsx`
- `Sidebar.tsx`
- `api.ts`
