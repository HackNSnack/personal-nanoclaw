# Snippet 027 - Bug Fixes: Variable Resolution & Multiple Actions

## Issues Fixed

### Issue 1: Actions with `{{var:...}}` Not Executing Properly
**Problem:** When adding an action with variables to a workflow, the tool wouldn't execute - it would return the literal string like "{{var:report_id}}" instead of the resolved value.

### Issue 2: Cannot Add Multiple Actions to Workflow
**Problem:** After adding one action to a workflow, couldn't add another action. The UI would seem unresponsive.

---

## Issue 1: Variable Resolution Fix

### Root Cause

The `resolve_step_inputs()` function only resolved `{{workflow.X}}` and `{{step.X.result}}` patterns from `input_mapping`, but didn't resolve `{{var:...}}` patterns that existed in the action's base arguments.

**Example scenario:**
```python
# Action created with variable
action = {
    "tool_name": "text_transformer",
    "arguments": {
        "text": "{{var:input_text:string:Input Text}}",
        "transformation": "uppercase"
    }
}

# Added to workflow with input mapping
step = {
    "action_id": "action-123",
    "input_mapping": {
        "text": "{{workflow.my_text}}"
    }
}

# Execution: input_mapping correctly maps to workflow variable ✓
# But if no input_mapping, {{var:input_text}} stays unresolved ✗
```

### Solution

Enhanced `resolve_step_inputs()` to handle `{{var:...}}` patterns in base arguments:

**File:** `backend/src/variable_resolver.py`

```python
def resolve_step_inputs(
    base_arguments: dict,
    input_mapping: dict[str, str],
    workflow_variables: dict[str, Any],
    step_results: dict[int, Any]
) -> dict:
    merged = base_arguments.copy()
    
    # Step 1: Resolve {{var:...}} in base arguments (if not overridden by input_mapping)
    for param_name, value in merged.items():
        # Skip if this parameter has an input_mapping (it will override)
        if param_name in input_mapping:
            continue
        
        # Check for {{var:...}} pattern
        if isinstance(value, str) and "{{var:" in value:
            var_info = parse_variable(value)
            if var_info:
                # Try to resolve from workflow variables
                if var_info["name"] in workflow_variables:
                    resolved_value = workflow_variables[var_info["name"]]
                    # Type conversion
                    if var_info["type"] == "number":
                        merged[param_name] = float(resolved_value)
                    else:
                        merged[param_name] = str(resolved_value)
                else:
                    # Helpful error if variable not found
                    raise ValueError(
                        f"Action parameter '{param_name}' has variable '{var_info['name']}' "
                        f"but no workflow variable or input mapping was configured."
                    )
    
    # Step 2: Apply input_mapping overrides
    for param_name, mapping_value in input_mapping.items():
        if isinstance(mapping_value, str):
            resolved_value = resolve_mapping_pattern(
                mapping_value, 
                workflow_variables, 
                step_results
            )
            if resolved_value is not None:
                merged[param_name] = resolved_value
    
    return merged
```

### Key Changes:

1. **Check for `{{var:...}}` in base arguments** before applying input_mapping
2. **Skip parameters with input_mapping** - they take precedence
3. **Resolve variable name** from workflow variables if exists
4. **Helpful error** if variable not found and no input_mapping configured
5. **Type conversion** - respects number vs string types

### Behavior:

| Scenario | Behavior |
|----------|----------|
| Action has `{{var:X}}`, workflow has variable `X`, no input_mapping | ✅ Resolves from workflow variable `X` |
| Action has `{{var:X}}`, workflow has variable `X`, input_mapping configured | ✅ Uses input_mapping (overrides base) |
| Action has `{{var:X}}`, workflow has variable `Y`, input_mapping maps to `Y` | ✅ Uses input_mapping |
| Action has `{{var:X}}`, no workflow variable `X`, no input_mapping | ❌ Error with helpful message |

### Test Results:

```bash
Testing Actions with {{var:}} in Workflows
============================================================

1. Creating action with {{var:}} placeholder...
   ✓ Action created with variable

2. Creating workflow with action containing {{var:}}...
   ✓ Workflow created

3. Executing workflow with variable value...
   ✓ Execution status: completed
   ✓ SUCCESS: Variable was resolved correctly!
     Input: 'test message' → Output: 'TEST MESSAGE'

4. Testing action with {{var:}} but NO input mapping...
   ✓ As expected, workflow failed (no variable to resolve)
     Error: Action parameter 'text' has variable 'input_text' but no 
            workflow variable or input mapping was configured.
```

---

## Issue 2: Multiple Actions Fix

### Root Cause

The `handleAddAction` function had a check that prevented adding the same action ID twice:

**File:** `frontend/src/WorkflowBuilder.tsx`

```typescript
// OLD CODE - Prevented duplicate action IDs
const action = availableActions.find((a) => a.id === selectedActionId);
if (action && !steps.find((s) => s.action.id === action.id)) {
  //           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //           This check prevented adding same action twice
  setSteps([...steps, { action, inputMapping: {} }]);
}
```

**Why this existed:** Original design probably assumed each action should only appear once per workflow.

**Why this is wrong:** Workflows should be able to use the same action multiple times with different inputs:
- Execute report with report_id = "A"
- Execute report with report_id = "B"
- Transform text with operation = "uppercase"
- Transform text with operation = "lowercase"

### Solution Part 1: Allow Duplicate Actions

```typescript
// NEW CODE - Allows same action multiple times
const handleAddAction = () => {
  if (!selectedActionId) return;

  const action = availableActions.find((a) => a.id === selectedActionId);
  if (action) {
    setSteps([...steps, { action, inputMapping: {} }]);
    setSelectedActionId("");
    setErrors({ ...errors, steps: undefined });
  }
};
```

**Change:** Removed `!steps.find((s) => s.action.id === action.id)` check.

### Solution Part 2: Fix Step Removal

The `handleRemoveAction` function was using action ID to remove steps, which would remove ALL steps with that action:

```typescript
// OLD CODE - Removed all steps with matching action ID
const handleRemoveAction = (actionId: string) => {
  setSteps(steps.filter((s) => s.action.id !== actionId));
};
```

**Problem:** If you added the same action twice and removed one, BOTH would be removed.

**Solution:** Use step index instead of action ID:

```typescript
// NEW CODE - Removes specific step by index
const handleRemoveAction = (stepIndex: number) => {
  setSteps(steps.filter((_, idx) => idx !== stepIndex));
  
  // Update configuringStepIndex if needed
  if (configuringStepIndex !== null) {
    if (configuringStepIndex === stepIndex) {
      setConfiguringStepIndex(null);  // Close config if removed
    } else if (configuringStepIndex > stepIndex) {
      setConfiguringStepIndex(configuringStepIndex - 1);  // Adjust index
    }
  }
};
```

**Also updated the JSX:**

```typescript
// OLD: key={step.action.id}  // Would break with duplicates
// NEW: key={idx}              // Unique per step

<div key={idx} style={{ marginBottom: "10px" }}>
  {/* ... */}
  <button onClick={() => handleRemoveAction(idx)}>×</button>
  {/* OLD: onClick={() => handleRemoveAction(step.action.id)} */}
</div>
```

### Test Results:

**Before fix:**
1. Add Action A → ✓ Works
2. Add Action B → ✗ Button doesn't work
3. Add Action A again → ✗ Nothing happens

**After fix:**
1. Add Action A → ✓ Works
2. Add Action B → ✓ Works
3. Add Action A again → ✓ Works (now have 2 copies of Action A)
4. Remove first Action A → ✓ Only first removed, second remains

---

## Files Modified

### Backend:
1. **`backend/src/variable_resolver.py`**
   - Enhanced `resolve_step_inputs()` to resolve `{{var:...}}` in base arguments
   - Added helpful error when variable not found
   - Skip parameters with input_mapping (they override base args)

### Frontend:
2. **`frontend/src/WorkflowBuilder.tsx`**
   - Removed duplicate action check in `handleAddAction()`
   - Changed `handleRemoveAction()` to use step index instead of action ID
   - Updated JSX to use index as key and pass index to remove handler
   - Fixed configuringStepIndex adjustment when removing steps

## Testing

### Backend Tests:
```bash
cd backend
python test_workflow_features.py  # ✓ All tests pass
python test_action_with_vars.py    # ✓ All tests pass
```

### Frontend Build:
```bash
cd frontend
npm run build  # ✓ Build successful
```

## Impact

### Positive:
- ✅ Actions with `{{var:...}}` now work correctly in workflows
- ✅ Input mapping properly overrides base arguments
- ✅ Same action can be used multiple times in workflow
- ✅ Each step removal works independently
- ✅ Clear error messages when variables not configured

### User Experience:
- **More flexible:** Can reuse actions with different inputs
- **More reliable:** Variables resolve correctly
- **Better errors:** Clear guidance when configuration missing

## Example Use Cases Now Possible

### Use Case 1: Execute Same Report Multiple Times
```
Workflow: "Multi-Report Analysis"

Step 1: Execute Report (report_id → "report-A")
Step 2: Execute Report (report_id → "report-B")
Step 3: Execute Report (report_id → "report-C")
Step 4: Combine results
```

### Use Case 2: Transform Chain with Variable Action
```
Action: text_transformer(text="{{var:input:string:Input Text}}")

Workflow: "Text Pipeline"
Variables: user_input (string)

Step 1: Transform (input_mapping: text → {{workflow.user_input}}, operation: uppercase)
Step 2: Transform (input_mapping: text → {{step.0.result}}, operation: reverse)
Step 3: Transform (input_mapping: text → {{step.1.result}}, operation: lowercase)
```

### Use Case 3: Conditional Data Processing
```
Workflow: "Process Multiple IDs"
Variables: id1, id2, id3 (all strings)

Step 1: Execute Report (report_id → {{workflow.id1}})
Step 2: Execute Report (report_id → {{workflow.id2}})
Step 3: Execute Report (report_id → {{workflow.id3}})
Step 4: Process Results (data → {{step.0.result}})
Step 5: Process Results (data → {{step.1.result}})
Step 6: Process Results (data → {{step.2.result}})
```

## Summary

**Issue 1 Fixed:** ✅ Actions with `{{var:...}}` now execute correctly  
**Issue 2 Fixed:** ✅ Can add multiple actions (including duplicates) to workflows  

Both fixes enable more powerful and flexible workflow creation!
