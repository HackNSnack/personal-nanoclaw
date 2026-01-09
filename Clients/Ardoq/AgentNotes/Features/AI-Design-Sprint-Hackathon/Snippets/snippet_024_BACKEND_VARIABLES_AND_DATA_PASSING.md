# Snippet 024 - Backend Implementation: Workflow Variables & Step Data Passing

## Summary

Successfully implemented backend support for:
1. **Workflow-level variables**: Define variables at workflow creation, prompt user at execution
2. **Step-to-step data passing**: Chain step outputs as inputs to subsequent steps

## Implementation Details

### 1. Data Models (`workflow_models.py`)

Added three new models:

```python
class WorkflowVariable(BaseModel):
    name: str
    type: str  # "string" | "number"
    label: str
    default_value: str | None = None

class WorkflowStep(BaseModel):
    action_id: str
    order: int
    input_mapping: dict[str, str] = {}  # NEW

class Workflow(BaseModel):
    # ... existing fields
    variables: dict[str, WorkflowVariable] = {}  # NEW
```

### 2. Variable Resolution (`variable_resolver.py`)

Extended with new functions:

```python
def resolve_step_inputs(
    base_arguments: dict,
    input_mapping: dict[str, str],
    workflow_variables: dict[str, Any],
    step_results: dict[int, Any]
) -> dict:
    """
    Merges base arguments with input_mapping overrides,
    resolving {{workflow.X}} and {{step.X.result}} patterns
    """

def resolve_mapping_pattern(
    pattern: str,
    workflow_variables: dict[str, Any],
    step_results: dict[int, Any]
) -> Any:
    """
    Resolves:
    - {{workflow.var_name}} → workflow variable value
    - {{step.X.result}} → result from step X
    
    Automatically converts to string for compatibility
    """
```

**Supported Patterns:**
- `{{workflow.var_name}}` - Workflow variable
- `{{step.X.result}}` - Output from step with order X

**Type Conversion:**
- All resolved values are converted to strings to ensure compatibility between steps
- Example: calculator returns `15.0`, text_transformer receives `"15.0"`

### 3. Workflow Storage (`workflow_storage.py`)

#### Enhanced Create/Update:
```python
def create_workflow(
    name: str,
    description: str | None,
    variables: dict[str, WorkflowVariable],  # NEW
    steps: list[WorkflowStep]
) -> Workflow
```

#### Validation:
```python
def _validate_workflow_steps(
    steps: list[WorkflowStep],
    variables: dict[str, WorkflowVariable]
):
    """
    Validates:
    1. Workflow variables exist before being referenced
    2. Step references are to earlier steps only (no forward/circular refs)
    3. Referenced steps exist in the workflow
    """
```

**Validation Rules:**
- ✅ Step 1 can reference step 0
- ❌ Step 0 cannot reference step 1 (forward reference)
- ❌ Cannot reference non-existent workflow variables
- ❌ Cannot reference non-existent steps

### 4. Workflow Executor (`workflow_storage.py`)

#### Enhanced Execution:
```python
def execute_workflow(
    workflow_id: str,
    workflow_variable_values: dict[str, Any] = None  # NEW
) -> WorkflowExecutionResult:
    """
    1. Stores step results in execution context
    2. Resolves inputs for each step using:
       - Base arguments from action
       - Input mapping overrides
       - Workflow variables
       - Previous step results
    """
```

**Execution Flow:**
1. Iterate through steps in order
2. For each step:
   - Get action's base arguments
   - Apply input_mapping overrides
   - Resolve {{workflow.X}} patterns
   - Resolve {{step.X.result}} patterns
   - Execute tool with resolved arguments
   - Store result for next steps
3. Continue until all steps complete or one fails

### 5. API Endpoints (`workflow_router.py`)

#### New/Updated Endpoints:

```python
# Get workflow variables (for frontend to prompt user)
GET /workflows/{workflow_id}/variables
Response: dict[str, WorkflowVariable]

# Execute workflow with variable values
POST /workflows/{workflow_id}/execute
Request: { "variable_values": {"var_name": value} }
Response: WorkflowExecutionResult

# Create workflow with variables
POST /workflows/
Request: {
    "name": str,
    "description": str | None,
    "variables": dict[str, WorkflowVariable],
    "steps": list[WorkflowStep]
}

# Update workflow with variables
PUT /workflows/{workflow_id}
Request: {
    "name": str | None,
    "description": str | None,
    "variables": dict[str, WorkflowVariable] | None,
    "steps": list[WorkflowStep] | None
}
```

## Testing

Created comprehensive test suite: `backend/test_workflow_features.py`

Uses FastAPI's `TestClient` for in-process testing (no server required).

### Test Coverage:

1. ✅ **Workflow Variables**
   - Create workflow with variables
   - Fetch variables via API
   - Execute with user-provided values
   - Variable values correctly passed to steps

2. ✅ **Step Data Passing**
   - Create workflow with step chaining
   - Step 0 output → Step 1 input
   - Type conversion (number → string)
   - Execution completes successfully

3. ✅ **Validation**
   - Invalid workflow variable reference → Rejected
   - Forward step reference → Rejected
   - Helpful error messages

### Test Results:

```
============================================================
Testing Workflow Variables & Step Data Passing
============================================================

1. Creating test actions directly...
   ✓ Action 1 created: Calculate 10 + 5
   ✓ Action 2 created: Transform to uppercase

2. Creating workflow with variables and step chaining...
   ✓ Workflow created: Test Workflow with Variables
   ✓ Variables: ['multiplier', 'text_input']

3. Fetching workflow variables endpoint...
   ✓ Retrieved variables: ['multiplier', 'text_input']

4. Executing workflow with variable values...
   ✓ Execution status: completed
   Step 0: calculator → Result: 15.0
   Step 1: text_transformer → Result: WORLD

5. Testing step-to-step data passing...
   ✓ Created chaining workflow: Step Chaining Test
   ✓ Execution status: completed
   Step 0: calculator → Result: 15.0
   Step 1: text_transformer → Result: 15.0
   ✓ Verified data passing

6. Testing validation errors...
   a) Invalid workflow variable reference:
     ✓ Correctly rejected
   b) Invalid step reference (future step):
     ✓ Correctly rejected

✓ All tests completed!
============================================================
```

## Example Usage

### 1. Workflow with Variables

```json
{
  "name": "Daily Report Pipeline",
  "variables": {
    "report_id": {
      "name": "report_id",
      "type": "string",
      "label": "Report ID",
      "default_value": "report-123"
    }
  },
  "steps": [
    {
      "action_id": "action-1",
      "order": 0,
      "input_mapping": {
        "report_id": "{{workflow.report_id}}"
      }
    }
  ]
}
```

### 2. Workflow with Step Chaining

```json
{
  "name": "Process and Transform",
  "variables": {},
  "steps": [
    {
      "action_id": "calculator-action",
      "order": 0,
      "input_mapping": {}
    },
    {
      "action_id": "text-transformer-action",
      "order": 1,
      "input_mapping": {
        "text": "{{step.0.result}}"
      }
    }
  ]
}
```

### 3. Combined: Variables + Chaining

```json
{
  "name": "Full Pipeline",
  "variables": {
    "initial_value": {
      "name": "initial_value",
      "type": "string",
      "label": "Initial Value"
    }
  },
  "steps": [
    {
      "action_id": "step-1",
      "order": 0,
      "input_mapping": {
        "text": "{{workflow.initial_value}}"
      }
    },
    {
      "action_id": "step-2",
      "order": 1,
      "input_mapping": {
        "text": "{{step.0.result}}"
      }
    }
  ]
}
```

## Files Modified

1. `backend/src/workflow_models.py` - Added WorkflowVariable, updated Workflow and WorkflowStep
2. `backend/src/variable_resolver.py` - Added resolve_step_inputs() and resolve_mapping_pattern()
3. `backend/src/workflow_storage.py` - Updated create/update/execute, added validation
4. `backend/src/workflow_router.py` - Updated API endpoints for variables
5. `backend/test_workflow_features.py` - Created comprehensive test suite

## Key Design Decisions

### 1. String Conversion
All resolved values are converted to strings to avoid type mismatch errors. This is a pragmatic choice for MVP:
- **Pro**: Simple, avoids runtime errors
- **Con**: Loses type information
- **Future**: Could add type hints in mapping to preserve types

### 2. Forward Reference Prevention
Steps can only reference earlier steps (lower order numbers):
- Prevents circular dependencies
- Simplifies execution logic
- Clear data flow direction

### 3. Validation at Creation Time
Workflows are validated when created/updated, not at execution time:
- Fail fast with clear error messages
- Frontend can provide better UX
- Prevents invalid workflows from being saved

### 4. In-Memory Step Results
Results stored in dict during execution:
- Simple, efficient for MVP
- No persistence needed
- Lost after execution completes
- **Future**: Could store in execution history

## Known Limitations

1. **No nested access**: Cannot access `{{step.0.result.field}}` for complex objects
2. **No partial substitution**: Cannot do `"Value: {{step.0.result}}"` - it's all or nothing
3. **No array indexing**: Cannot access `{{step.0.result[0]}}`
4. **String conversion**: All values become strings, loses numeric precision
5. **No conditional execution**: All steps run in sequence

## Next Steps

### Immediate (for frontend integration):
- ✅ Backend complete and tested
- ⏭️ Update frontend TypeScript types
- ⏭️ Add workflow variables UI in builder
- ⏭️ Add input mapping dropdowns per step
- ⏭️ Add variable prompt modal before execution

### Future Enhancements:
- Execution history (persist results)
- Nested data access (`{{step.0.result.data}}`)
- Partial substitution (`"Report {{workflow.id}}"`)
- Type preservation (keep numbers as numbers)
- Conditional execution
- Parallel steps

## Backend Status

✅ **Phase 1 & 2 Complete:**
- Workflow variables: Fully implemented
- Step data passing: Fully implemented
- Validation: Comprehensive
- Testing: All tests passing
- Ready for frontend integration

**Estimated frontend implementation time:** 6-8 hours
