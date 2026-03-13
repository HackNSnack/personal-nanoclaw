# Snippet 016 - Workflow System: Detailed Planning

## Overview
Create a system to chain saved actions into executable workflows with drag-and-drop UI.

---

## Part 1: Data Model & Backend Architecture

### 1.1 Workflow Data Model

```python
class WorkflowStep(BaseModel):
    id: str                    # UUID for this step
    action_id: str             # Reference to SavedAction
    order: int                 # Execution order (0, 1, 2...)
    input_mapping: dict | None # Map previous step outputs to inputs
    # Example: {"text": "{{step_0.result}}"} 
    # means take result from step 0 and use as "text" param

class Workflow(BaseModel):
    id: str
    name: str
    description: str | None
    steps: list[WorkflowStep]  # Ordered list
    created_at: datetime
    updated_at: datetime
```

### 1.2 Storage (`workflow_storage.py`)

```python
class WorkflowStorage:
    workflows: dict[str, Workflow] = {}
    
    def create_workflow(name, description, steps) -> Workflow
    def get_workflow(workflow_id) -> Workflow | None
    def list_workflows() -> list[Workflow]
    def update_workflow(workflow_id, data) -> Workflow
    def delete_workflow(workflow_id) -> bool
```

### 1.3 Execution Engine

**Challenges:**
1. **Type Compatibility**: Not all tool outputs match next tool's inputs
2. **Data Flow**: How to pass data between steps?
3. **Error Handling**: What if step 2 fails?

**Proposed Solution: Simple Sequential Execution**

```python
class WorkflowExecutor:
    async def execute_workflow(workflow_id: str) -> WorkflowExecutionResult:
        workflow = workflow_storage.get_workflow(workflow_id)
        results = []
        context = {}  # Store step results
        
        for step in sorted(workflow.steps, key=lambda s: s.order):
            # Get the saved action
            action = action_storage.get_action(step.action_id)
            
            # Resolve input mapping
            args = self._resolve_inputs(
                action.arguments, 
                step.input_mapping, 
                context
            )
            
            # Execute tool
            tool_func = get_tool(action.tool_name)
            try:
                result = tool_func(None, **args)
                context[f"step_{step.order}"] = {"result": result}
                results.append({
                    "step": step.order,
                    "tool": action.tool_name,
                    "result": result,
                    "status": "success"
                })
            except Exception as e:
                results.append({
                    "step": step.order,
                    "tool": action.tool_name,
                    "error": str(e),
                    "status": "failed"
                })
                # Stop on error? Or continue?
                break
        
        return WorkflowExecutionResult(
            workflow_id=workflow_id,
            steps=results,
            status="completed" if all ok else "failed"
        )
    
    def _resolve_inputs(self, base_args, mapping, context):
        """Replace {{step_X.result}} with actual values"""
        if not mapping:
            return base_args
        
        resolved = base_args.copy()
        for key, value in mapping.items():
            if isinstance(value, str) and "{{" in value:
                # Extract step reference: {{step_0.result}}
                resolved[key] = self._extract_from_context(value, context)
        return resolved
```

### 1.4 API Endpoints (`workflow_router.py`)

```python
POST   /workflows/              # Create workflow
GET    /workflows/              # List all workflows
GET    /workflows/{id}          # Get workflow
PUT    /workflows/{id}          # Update workflow
DELETE /workflows/{id}          # Delete workflow
POST   /workflows/{id}/execute  # Execute workflow
GET    /workflows/{id}/history  # Execution history (future)
```

### 1.5 Input Mapping Strategy

**Option A: Simple String Replacement**
- Pro: Easy to implement
- Con: Limited flexibility
- Example: `{"text": "{{step_0.result}}"}`

**Option B: JSON Path**
- Pro: Can extract nested values
- Con: More complex
- Example: `{"text": "$.steps[0].result.value"}`

**Recommendation**: Start with Option A, add Option B later if needed.

---

## Part 2: Frontend UI/UX Design

### 2.1 Component Architecture

```
App
├── Chat (left, flex: 1)
├── Sidebar (right, 350px)
│   ├── SavedActions (current)
│   └── [Future: WorkflowList]
└── WorkflowBuilder (modal/separate page?)
    ├── WorkflowCanvas
    │   ├── StepNode (draggable)
    │   ├── ConnectionLine
    │   └── AddStepButton
    ├── WorkflowPanel (left sidebar)
    │   └── AvailableActions (drag source)
    └── WorkflowToolbar
        ├── Save button
        ├── Execute button
        └── Settings
```

### 2.2 Workflow Builder UI Sketch

```
┌─────────────────────────────────────────────────────────────┐
│  Workflow Builder: "My Workflow"                    [X Close]│
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐                                            │
│  │ Available    │  ┌─────────────────────────────────────┐  │
│  │ Actions      │  │        Workflow Canvas              │  │
│  ├──────────────┤  │                                     │  │
│  │              │  │  ┌──────────────┐                  │  │
│  │ [Action 1]   │  │  │   Step 1     │                  │  │
│  │ calculator   │  │  │ calculator   │                  │  │
│  │              │  │  │ add(2, 2)    │                  │  │
│  │ [Action 2]   │  │  └──────┬───────┘                  │  │
│  │ text_trans.. │  │         │                          │  │
│  │              │  │         ▼                          │  │
│  │ [Action 3]   │  │  ┌──────────────┐                  │  │
│  │ execute_rep..│  │  │   Step 2     │                  │  │
│  │              │  │  │ text_trans.. │                  │  │
│  │              │  │  │ uppercase(..)│                  │  │
│  │              │  │  └──────────────┘                  │  │
│  │              │  │                                     │  │
│  │ + Add Action │  │  [+ Add Step]                      │  │
│  └──────────────┘  └─────────────────────────────────────┘  │
│                                                               │
│  [Save Workflow] [Execute] [Cancel]                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 User Interaction Flow

**Creating a Workflow:**
1. Click "Create Workflow" button in sidebar
2. Opens WorkflowBuilder modal/page
3. Drag actions from left panel to canvas
4. Actions appear as step nodes in order
5. Click step node to configure input mapping
6. Save workflow with name/description

**Configuring Step Inputs:**
```
┌──────────────────────────────┐
│ Configure Step 2             │
├──────────────────────────────┤
│ Tool: text_transformer       │
│                              │
│ Parameter: text              │
│ Source: [dropdown]           │
│   ○ Use saved value         │
│   ● Use previous step result│
│   ○ Enter custom value      │
│                              │
│ Previous step: Step 1        │
│ Result: "4"                  │
│                              │
│ Parameter: transformation    │
│ Value: [uppercase ▼]        │
│                              │
│ [Save] [Cancel]              │
└──────────────────────────────┘
```

**Executing a Workflow:**
1. In sidebar, click workflow name
2. Click "Execute" button
3. Shows progress/loading
4. Displays results for each step
5. Shows final output

### 2.4 Sidebar Updates

**Add Tabs:**
```
┌────────────────────┐
│ [Actions] [Workflows] │
├────────────────────┤
│ ... content ...    │
└────────────────────┘
```

**Workflow Tab Content:**
```
┌────────────────────┐
│ My Workflows       │
│ [+ New Workflow]   │
├────────────────────┤
│ ┌────────────────┐ │
│ │ Workflow 1     │ │
│ │ 3 steps        │ │
│ │ [▶] [✎] [×]   │ │
│ └────────────────┘ │
│ ┌────────────────┐ │
│ │ Workflow 2     │ │
│ │ 2 steps        │ │
│ │ [▶] [✎] [×]   │ │
│ └────────────────┘ │
└────────────────────┘
```

---

## Part 3: Implementation Phases

### Phase 2A: Backend Foundation (First)
1. Create `Workflow` and `WorkflowStep` models
2. Create `WorkflowStorage` class
3. Create workflow API endpoints (CRUD)
4. Test with manual API calls (Postman/curl)

### Phase 2B: Simple Execution Engine
1. Implement `WorkflowExecutor.execute_workflow()`
2. Start with sequential execution, no input mapping
3. Test: Create workflow with 2 calculator steps
4. Add input mapping support
5. Test: Step 2 uses Step 1 output

### Phase 2C: Frontend - Workflow List
1. Add "Workflows" tab to sidebar
2. Fetch and display workflows
3. Add "Create Workflow" button
4. Add execute/edit/delete buttons per workflow
5. Show execution results in modal/alert

### Phase 2D: Frontend - Workflow Builder (Complex)
1. Install drag-and-drop library (`@dnd-kit/core`)
2. Create `WorkflowBuilder` component (modal or separate page)
3. Implement drag from actions list to canvas
4. Show steps as ordered list/cards
5. Add input mapping UI (dropdowns/forms)
6. Save workflow to backend

### Phase 2E: Visual Enhancements
1. Add visual connections between steps (SVG lines)
2. Add step validation (red border if misconfigured)
3. Add execution progress indicators
4. Add workflow execution history

---

## Part 4: Open Questions & Design Decisions

### Q1: How to handle incompatible types?
**Example:** Calculator returns `float`, but text_transformer expects `string`.

**Options:**
1. **Auto-convert**: `str(result)` automatically
2. **Explicit cast step**: Add "Convert to String" tool
3. **Type checking**: Validate at workflow creation time
4. **Let it fail**: Show error during execution

**Recommendation**: Option 1 (auto-convert) for MVP, Option 3 later.

### Q2: What if a step has multiple parameters?
**Example:** `calculator(operation, a, b)` - need 3 inputs.

**Options:**
1. **Each param separately**: Map each to previous steps or constants
2. **Only map one**: Others use saved action defaults
3. **Complex mapping**: JSON editor for advanced users

**Recommendation**: Option 2 for MVP (map one key param), Option 1 later.

### Q3: Workflow builder: Modal or separate page?
**Options:**
1. **Modal**: Overlay on current page, quick access
2. **Separate page/tab**: More space, less clutter
3. **Sidebar expansion**: Expand sidebar to full width

**Recommendation**: Option 1 (modal) for MVP - easier to implement.

### Q4: How to show execution results?
**Options:**
1. **Alert/notification**: Simple, quick
2. **Results panel**: Dedicated UI for viewing
3. **Add to chat**: Show in chat as assistant message
4. **Execution history page**: Separate view

**Recommendation**: Option 1 for MVP, Option 3 (add to chat) later for UX.

### Q5: Can workflows call other workflows?
**For MVP**: No. Too complex.
**Future**: Yes, treat workflows as "meta-tools".

---

## Part 5: Example Use Cases

### Use Case 1: Simple Report Pipeline
```
Step 1: execute_report(report_id="ABC123")
  → Output: "Executed... results: 1, 4, 92874..."

Step 2: text_transformer(text={{step_1.result}}, transformation="uppercase")
  → Output: "EXECUTED... RESULTS: 1, 4, 92874..."

Step 3: list_formatter(items={{step_2.result.split()}}, format_type="bulleted")
  → Output: "- EXECUTED...\n- RESULTS:\n- 1,\n- 4,..."
```

### Use Case 2: Data Processing Chain
```
Step 1: calculator(operation="add", a=10, b=5)
  → Output: 15.0

Step 2: calculator(operation="multiply", a={{step_1.result}}, b=2)
  → Output: 30.0

Step 3: text_transformer(text="Result: {{step_2.result}}", transformation="uppercase")
  → Output: "RESULT: 30.0"
```

---

## Part 6: Tech Stack for Workflow Builder

### Drag & Drop Library Options

**Option 1: @dnd-kit/core**
- Modern, lightweight
- Good TypeScript support
- Flexible API
- **Recommended** ✅

**Option 2: react-beautiful-dnd**
- Popular, mature
- Great for lists
- Less flexible than dnd-kit
- Archived (maintenance mode)

**Option 3: react-dnd**
- Powerful, flexible
- Complex API
- Steeper learning curve

### Visual Flow Library (Optional)

For fancy node-based UI with connections:

**Option 1: ReactFlow**
- Professional node editor
- Built-in edge routing
- Good for complex workflows
- Might be overkill for MVP

**Option 2: Custom SVG**
- Full control
- Lighter weight
- More work
- **Recommended for MVP** ✅

---

## Part 7: MVP Scope Recommendation

### Include in MVP:
✅ Workflow CRUD (backend)
✅ Simple sequential execution (no input mapping yet)
✅ Workflows tab in sidebar
✅ Create workflow from list of actions (drag-drop)
✅ Display workflow steps as ordered list
✅ Execute workflow button
✅ Show results in alert/modal

### Defer to Later:
❌ Input mapping between steps (complex!)
❌ Visual node graph with connections
❌ Execution history
❌ Workflow versioning
❌ Conditional logic (if/else)
❌ Parallel execution
❌ Loops

### Simplification for MVP:
- **Workflows = Ordered list of actions**
- **Each action uses its saved parameters**
- **No data passing between steps (for now)**
- **Results shown as separate list per step**

This makes MVP achievable in hackathon timeframe!

---

## Part 8: Recommended Next Steps

1. **Agree on MVP scope** (include/defer list above)
2. **Choose: Modal vs separate page** for builder
3. **Implement Phase 2A** (backend models & API)
4. **Test workflow CRUD** with Postman
5. **Implement Phase 2B** (execution without input mapping)
6. **Implement Phase 2C** (frontend workflow list)
7. **Implement Phase 2D** (workflow builder UI)
8. **Demo & iterate**

---

## Summary

**Core Concept**: Chain saved actions into workflows.

**Backend**: Workflow model, storage, CRUD API, execution engine.

**Frontend**: Workflows tab, workflow builder (drag-drop), execution UI.

**MVP Focus**: Simple sequential execution without data passing.

**Future**: Input mapping, visual graph, execution history.

Ready to start implementing? Which phase would you like to tackle first?
