# Snippet 019 - Workflow System: Analysis & Planning

## Code Review Summary

### Current Backend State
✅ **Actions system fully functional**
- SavedAction model with id, tool_name, arguments, description
- ActionStorage with CRUD operations
- Variable resolution system ({{var:name:type:label}})
- Action execution with variable prompting

❌ **Missing for Workflows**
- Workflow model
- WorkflowStep model
- Workflow storage
- Workflow router/endpoints
- Workflow execution engine

### Current Frontend State
✅ **Chat & Actions UI complete**
- Chat interface with tool execution
- Sidebar with saved actions
- Variable configuration modals
- Action execution UI

❌ **Missing for Workflows**
- Workflow list/display UI
- Workflow builder interface
- Drag-and-drop functionality
- Step ordering UI
- Workflow execution UI

---

## Workflow Design: Key Questions & Decisions

### Q1: What IS a Workflow?

**Definition:** A workflow is an ordered sequence of saved actions that execute sequentially.

**Core Properties:**
- **Name** - User-defined identifier
- **Description** - Optional explanation
- **Steps** - Ordered list of action references
- **Metadata** - Created/updated timestamps, execution history

### Q2: How Do Steps Connect?

**Three Options:**

#### Option A: Independent Steps (MVP - RECOMMENDED)
Each step executes with its saved parameters, no data passing.

**Pros:**
- Simplest to implement
- Can build and test quickly
- Clear execution model

**Cons:**
- Limited usefulness
- Can't chain data transformations

**Example:**
```
Step 1: Execute report ABC123
Step 2: Calculate 2+2
Step 3: Transform "hello" to uppercase
```
All steps run, but results don't interact.

#### Option B: Sequential Data Passing (Future Phase)
Each step can use previous step's result as input.

**Pros:**
- More powerful
- Enables real data pipelines

**Cons:**
- Complex variable mapping
- Type compatibility issues
- Harder error handling

**Example:**
```
Step 1: Execute report ABC123 → output: "results: 1, 4, 92874"
Step 2: Transform {{step_1.result}} to uppercase → "RESULTS: 1, 4, 92874"
Step 3: Format as list → bulleted list
```

#### Option C: Graph-Based (Complex - Future)
Steps can have multiple inputs/outputs, conditional branches, parallel execution.

**Recommendation:** Start with **Option A**, build **Option B** next, defer **Option C**.

---

## MVP Workflow System Design

### Backend Architecture

#### 1. Models (new file: `workflow_models.py`)

```python
from pydantic import BaseModel
from datetime import datetime

class WorkflowStep(BaseModel):
    action_id: str       # Reference to SavedAction
    order: int           # Execution sequence (0, 1, 2...)

class Workflow(BaseModel):
    id: str
    name: str
    description: str | None = None
    steps: list[WorkflowStep]
    created_at: datetime
    updated_at: datetime
```

#### 2. Storage (new file: `workflow_storage.py`)

```python
class WorkflowStorage:
    workflows: dict[str, Workflow] = {}
    
    def create_workflow(name, description, steps) -> Workflow
    def get_workflow(workflow_id) -> Workflow | None
    def list_workflows() -> list[Workflow]
    def update_workflow(workflow_id, updated_data) -> Workflow
    def delete_workflow(workflow_id) -> bool
```

#### 3. Execution Engine (in `workflow_storage.py` or separate)

```python
class WorkflowExecutor:
    async def execute_workflow(workflow_id: str) -> WorkflowExecutionResult:
        workflow = workflow_storage.get_workflow(workflow_id)
        results = []
        
        # Sort steps by order
        sorted_steps = sorted(workflow.steps, key=lambda s: s.order)
        
        for step in sorted_steps:
            # Get the saved action
            action = action_storage.get_action(step.action_id)
            
            # Execute (no variable prompting - use saved values)
            # If action has variables with {{var:...}}, skip or use defaults?
            tool_func = tool_map[action.tool_name]
            try:
                result = tool_func(None, **action.arguments)
                results.append({
                    "step_order": step.order,
                    "action_id": step.action_id,
                    "tool_name": action.tool_name,
                    "result": str(result),
                    "status": "success"
                })
            except Exception as e:
                results.append({
                    "step_order": step.order,
                    "action_id": step.action_id,
                    "tool_name": action.tool_name,
                    "error": str(e),
                    "status": "failed"
                })
                break  # Stop on first error
        
        return WorkflowExecutionResult(
            workflow_id=workflow_id,
            steps=results,
            overall_status="completed" if all success else "failed"
        )
```

#### 4. API Endpoints (new file: `workflow_router.py`)

```
POST   /workflows/              # Create workflow
GET    /workflows/              # List all workflows
GET    /workflows/{id}          # Get specific workflow
PUT    /workflows/{id}          # Update workflow
DELETE /workflows/{id}          # Delete workflow
POST   /workflows/{id}/execute  # Execute workflow
```

### Frontend Architecture

#### 1. Sidebar Enhancement (tabs)

Add tabs to sidebar:
```tsx
<div className="sidebar">
  <div className="sidebar-tabs">
    <button className={activeTab === "actions" ? "active" : ""}>
      Actions
    </button>
    <button className={activeTab === "workflows" ? "active" : ""}>
      Workflows
    </button>
  </div>
  
  {activeTab === "actions" && <ActionsTab />}
  {activeTab === "workflows" && <WorkflowsTab />}
</div>
```

#### 2. Workflows Tab (new component: `WorkflowsTab.tsx`)

Display list of workflows with:
- Workflow name
- Step count
- Created date
- Execute button
- Edit button (opens builder)
- Delete button

#### 3. Workflow Builder (new component: `WorkflowBuilder.tsx`)

**UI Layout:**
```
┌──────────────────────────────────────────┐
│ Create Workflow              [X Close]   │
├──────────────────────────────────────────┤
│ Name: [________________]                 │
│ Description: [________________________]  │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Steps:                               │ │
│ │                                      │ │
│ │ [+ Add Step]                         │ │
│ │                                      │ │
│ │ 1. Execute Report ABC123     [×]     │ │
│ │ 2. Calculate 2+2             [×]     │ │
│ │ 3. Transform text            [×]     │ │
│ │                                      │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [Cancel] [Save Workflow]                 │
└──────────────────────────────────────────┘
```

**Add Step Flow:**
1. Click "+ Add Step"
2. Dropdown shows all saved actions
3. Select action → appears at bottom of list
4. Can delete with × button
5. Order is implicit (visual order = execution order)

#### 4. Workflow Execution Results (modal or panel)

```
┌──────────────────────────────────────────┐
│ Workflow Execution: "My Workflow"        │
├──────────────────────────────────────────┤
│ ✓ Step 1: Execute Report ABC123          │
│   Result: "Executed report... 1, 4..."   │
│                                          │
│ ✓ Step 2: Calculate 2+2                  │
│   Result: 4                              │
│                                          │
│ ✓ Step 3: Transform text                 │
│   Result: "HELLO WORLD"                  │
│                                          │
│ Overall: Success (3/3 steps)             │
│                                          │
│ [Close]                                  │
└──────────────────────────────────────────┘
```

---

## Implementation Plan (Phased)

### Phase 1: Backend Foundation
**Goal:** Workflow CRUD + storage, no execution yet

**Tasks:**
1. Create `workflow_models.py` with Workflow, WorkflowStep
2. Create `workflow_storage.py` with WorkflowStorage class
3. Create `workflow_router.py` with CRUD endpoints
4. Register workflow_router in main.py
5. Test with curl/Postman

**Validation:**
- Can create workflow with steps
- Can list workflows
- Can get workflow by ID
- Can update workflow (add/remove steps)
- Can delete workflow

### Phase 2: Backend Execution
**Goal:** Execute workflows (simple, no variables)

**Tasks:**
1. Add WorkflowExecutor class to workflow_storage.py
2. Implement execute_workflow() method
3. Add POST /workflows/{id}/execute endpoint
4. Handle errors gracefully

**Challenge:** What about actions with variables?

**Options:**
- Skip actions with variables
- Require all variables to be resolved beforehand
- Prompt for variables at workflow execution time

**Decision:** For MVP, **workflows can only include actions WITHOUT variables**. Add validation when creating workflow.

### Phase 3: Frontend - Workflows Tab
**Goal:** Display workflows, execute, delete

**Tasks:**
1. Add tabs to Sidebar component
2. Create WorkflowsTab.tsx component
3. Create WorkflowCard.tsx component (similar to ActionCard)
4. Add API functions (listWorkflows, executeWorkflow, deleteWorkflow)
5. Show execution results in modal

### Phase 4: Frontend - Workflow Builder
**Goal:** Create workflows by selecting actions

**Tasks:**
1. Create WorkflowBuilder.tsx component
2. Modal overlay with form (name, description)
3. Dropdown to select actions (from saved actions)
4. Display selected actions as ordered list
5. Allow removing steps
6. Save to backend

**Note:** No drag-and-drop yet - just a simple dropdown + list.

### Phase 5: Enhancements (Future)
- Drag-and-drop reordering
- Visual flow diagram
- Step input mapping (data passing)
- Workflow variables (prompt once at start)
- Execution history
- Conditional steps
- Parallel execution

---

## Open Issues & Design Choices

### Issue 1: Actions with Variables in Workflows

**Problem:** If a workflow includes an action with `{{var:report_id:string:Report ID}}`, how do we execute it?

**Options:**
1. **Block it** - Only allow actions without variables in workflows (MVP)
2. **Prompt at workflow start** - Collect all variables from all steps upfront
3. **Prompt per step** - Ask for variables when each step runs
4. **Workflow-level variables** - Map workflow variables to step variables

**Recommendation:** Option 1 for MVP (simplest), Option 4 for next phase.

### Issue 2: Error Handling

**Question:** If step 2 of 5 fails, what happens?

**Options:**
1. **Stop immediately** - Don't run remaining steps
2. **Continue anyway** - Run all steps, mark failures
3. **User choice** - Configuration per workflow

**Recommendation:** Option 1 for MVP (safer), Option 3 later.

### Issue 3: Workflow Builder UI

**Question:** Modal overlay or separate page?

**Options:**
1. **Modal** - Overlay on current page
2. **Separate page** - /workflows/create route
3. **Sidebar expansion** - Expand sidebar to full width

**Recommendation:** Option 1 (modal) for MVP - consistent with current modals.

### Issue 4: Step Reordering

**Question:** How to change step order?

**Options:**
1. **No reordering** - Delete and re-add (MVP)
2. **Up/Down buttons** - Move one position at a time
3. **Drag-and-drop** - Visual reordering

**Recommendation:** Option 1 for MVP, Option 3 later (requires library like @dnd-kit/core).

### Issue 5: Workflow Execution Display

**Question:** Where to show results?

**Options:**
1. **Alert** - Simple browser alert (quick MVP)
2. **Modal** - Styled results modal
3. **Chat** - Add to chat as assistant message
4. **Separate panel** - Dedicated execution history view

**Recommendation:** Option 1 for MVP, Option 2 for polish, Option 3 for UX.

---

## MVP Scope Summary

### ✅ Include in MVP

**Backend:**
- Workflow and WorkflowStep models
- Workflow storage (in-memory)
- CRUD endpoints (create, read, update, delete)
- Simple sequential execution (no data passing)
- Error handling (stop on first failure)
- Validation: No actions with variables allowed in workflows

**Frontend:**
- Tabs in sidebar (Actions / Workflows)
- Workflows tab showing list of workflows
- WorkflowCard component (name, steps count, execute/delete buttons)
- WorkflowBuilder modal (name, description, dropdown to add actions)
- Simple ordered list display (no drag-and-drop)
- Execution results in alert/modal

### ❌ Defer to Later

- Data passing between steps
- Actions with variables in workflows
- Workflow-level variables
- Drag-and-drop step reordering
- Visual node graph
- Execution history/logs
- Conditional logic (if/else)
- Parallel execution
- Workflow versioning

---

## Example Use Cases (MVP)

### Use Case 1: Report Processing Workflow
```
Workflow: "Morning Report Pipeline"
Steps:
1. Execute report ABC123
2. Execute report XYZ789
3. Calculate summary stats (saved action with fixed values)
```

**Execution:**
- Step 1 runs → result stored
- Step 2 runs → result stored
- Step 3 runs → result stored
- All results shown in modal

**Limitation:** Steps don't share data. Each executes independently.

### Use Case 2: Data Transformation Chain
```
Workflow: "Text Processing"
Steps:
1. Transform "hello world" to uppercase (saved action)
2. Transform "goodbye" to lowercase (different saved action)
3. Format list of ["a", "b", "c"] as numbered (saved action)
```

**Execution:**
- Each step executes with its saved parameters
- Results are independent
- No data flows between steps

**Note:** Not very useful yet, but validates execution engine!

---

## Next Steps

1. **Confirm MVP scope** - Agree on included/deferred features
2. **Start Phase 1** - Backend models + storage + CRUD
3. **Test with curl** - Create/list/delete workflows via API
4. **Implement Phase 2** - Execution engine
5. **Implement Phase 3** - Frontend workflows tab
6. **Implement Phase 4** - Workflow builder
7. **Demo and iterate**

Ready to start implementation?
