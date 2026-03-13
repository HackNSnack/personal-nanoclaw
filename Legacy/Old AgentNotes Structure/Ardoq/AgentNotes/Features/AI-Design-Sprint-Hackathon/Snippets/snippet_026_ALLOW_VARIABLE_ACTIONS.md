# Snippet 026 - Allow Actions with Variables in Workflows

## Issue

Actions that were created with "Make this a variable" (containing `{{var:...}}` placeholders) could not be added to workflows. They were filtered out in the WorkflowBuilder UI.

## Root Cause

This was an **old MVP limitation** implemented when workflows didn't support variables or input mapping. The restriction existed in two places:

### 1. Frontend (`WorkflowBuilder.tsx`)
```typescript
// OLD CODE - Filtered out actions with variables
const availableActions = actions.filter((action) => {
  const hasVariables = Object.values(action.arguments).some(
    (val) => typeof val === "string" && val.includes("{{var:"),
  );
  return !hasVariables;  // ❌ Excluded these actions
});
```

### 2. Backend (`workflow_storage.py`)
```python
# OLD CODE - Rejected workflows with variable actions
action_variables = extract_variables(action.arguments)
if action_variables:
    raise ValueError(
        f"Action {step.action_id} contains variables. "
        "Workflows cannot include actions with variables in MVP."
    )
```

## Why This Restriction is No Longer Needed

With the new **workflow variables** and **input mapping** features:

1. **Workflow Variables**: Can define variables at workflow level
2. **Input Mapping**: Can map action parameters to:
   - Workflow variables: `{{workflow.var_name}}`
   - Previous step results: `{{step.X.result}}`

**Example Use Case:**
```
Action: execute_report(report_id="{{var:report_id}}")
         ↓ Add to workflow
Workflow: Map report_id → {{workflow.report_id}}
         ↓ Execute
User is prompted for report_id value
         ↓
Action executes with user-provided value
```

## Solution

### Frontend Fix (`WorkflowBuilder.tsx`)

**Before:**
```typescript
const availableActions = actions.filter((action) => {
  const hasVariables = Object.values(action.arguments).some(
    (val) => typeof val === "string" && val.includes("{{var:"),
  );
  return !hasVariables;
});
```

**After:**
```typescript
const availableActions = actions;
```

Also removed the UI message:
```typescript
// REMOVED:
{actions.length !== availableActions.length && (
  <div className="info-message">
    {actions.length - availableActions.length} action(s) hidden
    (contain variables)
  </div>
)}
```

### Backend Fix (`workflow_storage.py`)

**In `create_workflow()` method:**

**Before:**
```python
for step in steps:
    action = action_storage.get_action(step.action_id)
    if not action:
        raise ValueError(f"Action {step.action_id} not found")
    
    action_variables = extract_variables(action.arguments)
    if action_variables:
        raise ValueError(
            f"Action {step.action_id} contains variables. "
            "Workflows cannot include actions with variables in MVP."
        )
```

**After:**
```python
for step in steps:
    action = action_storage.get_action(step.action_id)
    if not action:
        raise ValueError(f"Action {step.action_id} not found")
```

**Same change in `update_workflow()` method.**

## How It Works Now

### Scenario 1: Action with Variables + Workflow Variables

1. **Create action with variable:**
   ```
   Tool: execute_report
   Argument: report_id = "{{var:report_id:string:Report ID}}"
   ```

2. **Add to workflow:**
   - Action now appears in WorkflowBuilder dropdown
   - Add action to workflow

3. **Configure input mapping:**
   - Click "Configure" on the step
   - See parameter: `report_id`
   - Select from dropdown: workflow variable or previous step result

4. **Option A - Map to workflow variable:**
   ```
   Workflow Variable: report_id (string)
   Step Mapping: report_id → {{workflow.report_id}}
   ```
   - User is prompted for `report_id` at execution time

5. **Option B - Map to previous step:**
   ```
   Step 0: Returns report ID
   Step 1 Mapping: report_id → {{step.0.result}}
   ```
   - Step 1 uses Step 0's output automatically

### Scenario 2: Action with Variables + Manual Execution

Actions with `{{var:...}}` can still be executed individually from the Actions tab:
1. Click "Execute" on action
2. Modal prompts for variable values
3. Action executes with provided values

This behavior is unchanged.

## Testing

### Manual Test:
1. ✅ Create action with "Make this a variable" checked
2. ✅ Go to Workflows tab → Create Workflow
3. ✅ Action appears in dropdown (not hidden)
4. ✅ Add action to workflow
5. ✅ Click "Configure" on step
6. ✅ Map parameter to workflow variable or previous step
7. ✅ Save workflow
8. ✅ Execute workflow
9. ✅ Prompt appears for workflow variables (if any)
10. ✅ Workflow executes successfully

### Backend Test:
```bash
cd backend && python test_workflow_features.py
```
**Result:** ✅ All tests pass

### Build Test:
```bash
cd frontend && npm run build
```
**Result:** ✅ Build successful

## Impact

### Positive:
- ✅ **More flexibility**: All actions can be used in workflows
- ✅ **Reusability**: Variable actions can be reused across workflows with different mappings
- ✅ **Consistency**: No special cases or hidden actions
- ✅ **User experience**: Clear and intuitive - users can add any action

### Considerations:
- Actions with `{{var:...}}` now need input mapping configured
- If not configured, the action will use the `{{var:...}}` placeholder as-is (likely to fail)
- **Future enhancement**: Could add validation warning if variable action has no input mapping

## Files Changed

1. `frontend/src/WorkflowBuilder.tsx`:
   - Removed filter for actions with variables
   - Removed "N action(s) hidden" message

2. `backend/src/workflow_storage.py`:
   - Removed validation check in `create_workflow()`
   - Removed validation check in `update_workflow()`

## Summary

**Problem:** Actions with variables couldn't be added to workflows  
**Cause:** Old MVP limitation  
**Solution:** Remove frontend filter and backend validation  
**Result:** All actions can now be added to workflows and configured with input mapping  

✅ **Status:** Fixed and tested
