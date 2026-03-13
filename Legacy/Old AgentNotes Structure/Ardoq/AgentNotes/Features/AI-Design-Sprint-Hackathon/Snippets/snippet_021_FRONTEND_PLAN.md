# Snippet 021 - Frontend Workflow Implementation Plan

## Current Frontend State Analysis

### Existing Components
- **App.tsx** - Root with Chat + Sidebar layout
- **Chat.tsx** - Chat interface with markdown, tool calls, save actions
- **Sidebar.tsx** - Displays saved actions, executes/deletes actions
- **ActionCard.tsx** - Individual action display
- **ParameterConfigModal.tsx** - Configure parameters when saving
- **VariablePromptModal.tsx** - Prompt for variable values at execution
- **api.ts** - API client functions

### Existing Layout
```
┌─────────────────────────────────────────────┐
│  Chat (flex: 1)      │  Sidebar (350px)     │
│                      │                       │
│  - Messages          │  Saved Actions        │
│  - Tool calls        │  - ActionCard 1       │
│  - Input field       │  - ActionCard 2       │
│                      │  - ActionCard 3       │
└─────────────────────────────────────────────┘
```

---

## Frontend Requirements for Workflows

### 1. Sidebar Tabs
**Goal:** Switch between Actions and Workflows views

**Changes to Sidebar.tsx:**
```tsx
// Add state for active tab
const [activeTab, setActiveTab] = useState<"actions" | "workflows">("actions");

// Render tabs
<div className="sidebar-tabs">
  <button 
    className={activeTab === "actions" ? "active" : ""}
    onClick={() => setActiveTab("actions")}
  >
    Actions
  </button>
  <button 
    className={activeTab === "workflows" ? "active" : ""}
    onClick={() => setActiveTab("workflows")}
  >
    Workflows
  </button>
</div>

// Conditional rendering
{activeTab === "actions" && <ActionsTab />}
{activeTab === "workflows" && <WorkflowsTab />}
```

### 2. ActionsTab Component (Refactor)
**Goal:** Extract current Sidebar content into reusable tab

**New file:** `ActionsTab.tsx`
- Move actions list logic from Sidebar
- Keep refresh trigger prop
- Keep variable prompt modal
- Same functionality, just extracted

### 3. WorkflowsTab Component
**Goal:** Display list of workflows with execute/edit/delete

**New file:** `WorkflowsTab.tsx`
```tsx
interface WorkflowsTabProps {
  refreshTrigger: number;
  actions: SavedAction[];  // Needed for workflow builder
}

// Features:
- Fetch workflows on mount and when refreshTrigger changes
- Display list of WorkflowCard components
- "Create Workflow" button at top
- Loading/error/empty states
- Execute workflow → show results modal
- Edit workflow → open WorkflowBuilder
- Delete workflow → confirm and delete
```

### 4. WorkflowCard Component
**Goal:** Display individual workflow

**New file:** `WorkflowCard.tsx`
```tsx
interface WorkflowCardProps {
  workflow: Workflow;
  onExecute: (workflowId: string) => void;
  onEdit: (workflowId: string) => void;
  onDelete: (workflowId: string) => void;
}

// Display:
- Workflow name
- Description (if present)
- Number of steps ("3 steps")
- Created/updated date
- Three buttons: Execute (▶), Edit (✎), Delete (×)
```

### 5. WorkflowBuilder Component
**Goal:** Create and edit workflows

**New file:** `WorkflowBuilder.tsx`
```tsx
interface WorkflowBuilderProps {
  workflow?: Workflow;           // If editing, pass existing workflow
  actions: SavedAction[];        // All available actions
  onSave: (workflow: CreateWorkflowRequest) => void;
  onCancel: () => void;
}

// Features:
- Modal overlay (like ParameterConfigModal)
- Name input field
- Description textarea
- Action selector dropdown
- Display selected actions as ordered list
- Remove action button (× per action)
- Validation: Only allow actions WITHOUT variables
- Save button (creates or updates workflow)
- Cancel button

// UI Layout:
┌────────────────────────────────────────────┐
│ Create Workflow                  [× Close] │
├────────────────────────────────────────────┤
│                                            │
│ Name: [_____________________________]      │
│                                            │
│ Description (optional):                    │
│ [_____________________________________]    │
│                                            │
│ Steps:                                     │
│ ┌────────────────────────────────────────┐ │
│ │ [Select an action ▼        ] [+ Add]  │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │ 1. Add 10+20 (calculator)          [×] │ │
│ │ 2. Uppercase world (text_trans...) [×] │ │
│ └────────────────────────────────────────┘ │
│                                            │
│               [Cancel] [Save Workflow]     │
└────────────────────────────────────────────┘
```

### 6. WorkflowExecutionModal Component
**Goal:** Display workflow execution results

**New file:** `WorkflowExecutionModal.tsx`
```tsx
interface WorkflowExecutionModalProps {
  result: WorkflowExecutionResult;
  onClose: () => void;
}

// Display:
- Workflow name
- Overall status (completed/failed)
- Each step with:
  - Step number
  - Tool name
  - Status icon (✓ success, ✗ failed)
  - Result or error message
- Close button

// UI Layout:
┌────────────────────────────────────────────┐
│ Workflow Execution: "Test Workflow"        │
│ Status: Completed                          │
├────────────────────────────────────────────┤
│                                            │
│ ✓ Step 1: calculator                       │
│   Result: 30                               │
│                                            │
│ ✓ Step 2: text_transformer                 │
│   Result: WORLD                            │
│                                            │
│                                            │
│                        [Close]             │
└────────────────────────────────────────────┘
```

### 7. API Functions (api.ts)
**Goal:** Add workflow-related API calls

**New interfaces:**
```typescript
interface WorkflowStep {
  action_id: string;
  order: number;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  created_at: string;
  updated_at: string;
}

interface CreateWorkflowRequest {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
}

interface StepResult {
  step_order: number;
  action_id: string;
  tool_name: string;
  result: string | null;
  error: string | null;
  status: string;
}

interface WorkflowExecutionResult {
  workflow_id: string;
  workflow_name: string;
  steps: StepResult[];
  overall_status: string;
}
```

**New functions:**
```typescript
// List all workflows
async function listWorkflows(): Promise<Workflow[]>

// Get specific workflow
async function getWorkflow(workflowId: string): Promise<Workflow>

// Create workflow
async function createWorkflow(request: CreateWorkflowRequest): Promise<Workflow>

// Update workflow
async function updateWorkflow(
  workflowId: string, 
  request: UpdateWorkflowRequest
): Promise<Workflow>

// Delete workflow
async function deleteWorkflow(workflowId: string): Promise<void>

// Execute workflow
async function executeWorkflow(
  workflowId: string
): Promise<WorkflowExecutionResult>
```

---

## Implementation Plan (Phased)

### Phase 1: API Layer
**Files:** `api.ts`

**Tasks:**
1. Add TypeScript interfaces for workflows
2. Add `listWorkflows()` function
3. Add `getWorkflow()` function
4. Add `createWorkflow()` function
5. Add `updateWorkflow()` function
6. Add `deleteWorkflow()` function
7. Add `executeWorkflow()` function

**Validation:** Can import and call functions (test with console.log)

---

### Phase 2: Basic Workflow Display
**Files:** `Sidebar.tsx`, `ActionsTab.tsx`, `WorkflowsTab.tsx`, `WorkflowCard.tsx`, `WorkflowCard.css`

**Tasks:**
1. Extract current Sidebar actions content into `ActionsTab.tsx`
2. Add tabs to `Sidebar.tsx` (Actions / Workflows)
3. Create `WorkflowsTab.tsx` with list view
4. Create `WorkflowCard.tsx` component
5. Add CSS for tabs and workflow cards
6. Wire up delete functionality
7. Add "Create Workflow" button (placeholder for now)

**Validation:** Can see empty workflows tab, switch between tabs

---

### Phase 3: Workflow Execution
**Files:** `WorkflowsTab.tsx`, `WorkflowExecutionModal.tsx`, `WorkflowExecutionModal.css`

**Tasks:**
1. Create `WorkflowExecutionModal.tsx`
2. Add CSS styling
3. Wire up execute button in WorkflowCard
4. Display execution results in modal
5. Handle success and failure cases
6. Show per-step results

**Validation:** Can execute workflow (if exists) and see results

---

### Phase 4: Workflow Builder
**Files:** `WorkflowBuilder.tsx`, `WorkflowBuilder.css`, `WorkflowsTab.tsx`

**Tasks:**
1. Create `WorkflowBuilder.tsx` component structure
2. Add modal styling (reuse ParameterConfigModal.css pattern)
3. Implement name and description inputs
4. Implement action selector dropdown
5. Implement selected actions list with order
6. Implement remove action functionality
7. Validate: filter out actions with variables
8. Wire up save (create new workflow)
9. Connect "Create Workflow" button to open builder

**Validation:** Can create new workflow with selected actions

---

### Phase 5: Workflow Editing
**Files:** `WorkflowBuilder.tsx`, `WorkflowsTab.tsx`

**Tasks:**
1. Add workflow prop to WorkflowBuilder (optional)
2. Pre-populate form when editing
3. Update save logic to handle both create and update
4. Wire up edit button in WorkflowCard

**Validation:** Can edit existing workflow

---

### Phase 6: Polish & UX
**Files:** Various CSS files

**Tasks:**
1. Add loading states
2. Add empty states with helpful messages
3. Add hover effects
4. Add transitions
5. Improve error handling
6. Add success notifications
7. Auto-refresh workflows after create/update/delete

**Validation:** Smooth UX, clear feedback

---

## File Structure Summary

### New Files to Create
```
frontend/src/
├── ActionsTab.tsx         (Phase 2)
├── ActionsTab.css         (Phase 2 - optional, might reuse Sidebar.css)
├── WorkflowsTab.tsx       (Phase 2)
├── WorkflowsTab.css       (Phase 2)
├── WorkflowCard.tsx       (Phase 2)
├── WorkflowCard.css       (Phase 2)
├── WorkflowBuilder.tsx    (Phase 4)
├── WorkflowBuilder.css    (Phase 4)
├── WorkflowExecutionModal.tsx    (Phase 3)
└── WorkflowExecutionModal.css    (Phase 3)
```

### Files to Modify
```
frontend/src/
├── api.ts                 (Phase 1 - add workflow functions)
├── Sidebar.tsx            (Phase 2 - add tabs, refactor)
├── Sidebar.css            (Phase 2 - add tab styles)
└── App.tsx                (Phase 6 - refresh trigger for workflows)
```

---

## State Management Strategy

### Sidebar State
```tsx
// Current
const [activeTab, setActiveTab] = useState<"actions" | "workflows">("actions");

// Pass to tabs
<ActionsTab refreshTrigger={refreshTrigger} />
<WorkflowsTab 
  refreshTrigger={workflowRefreshTrigger} 
  actions={actions}  // Needed for builder
/>
```

### App State (may need enhancement)
```tsx
// Current
const [refreshTrigger, setRefreshTrigger] = useState(0);

// Might need separate workflow refresh
const [workflowRefreshTrigger, setWorkflowRefreshTrigger] = useState(0);

// Or keep single trigger that refreshes both tabs
```

**Recommendation:** Start with single trigger, split if needed.

---

## Key Design Decisions

### Decision 1: Tabs vs Separate Pages
**Choice:** Tabs in sidebar
**Rationale:** Consistent with current UI, easy to switch, compact

### Decision 2: Builder as Modal vs Separate Page
**Choice:** Modal overlay
**Rationale:** Consistent with ParameterConfigModal, quick access, less navigation

### Decision 3: Action Selection in Builder
**Choice:** Dropdown + "Add" button
**Rationale:** Simple, clear, works well for limited actions, no drag-drop complexity

### Decision 4: Step Reordering
**Choice:** No reordering in MVP (visual order = execution order)
**Rationale:** Simplifies implementation, can add drag-drop later
**Alternative:** User removes and re-adds to change order

### Decision 5: Variable Action Filtering
**Choice:** Filter out actions with variables in dropdown
**Rationale:** Prevent user from selecting invalid actions
**UX:** Show count: "5 actions available (2 hidden - contain variables)"

### Decision 6: Auto-refresh After Operations
**Choice:** Yes - refresh workflow list after create/update/delete
**Rationale:** Immediate feedback, consistent with actions tab behavior

---

## Validation Strategy

### Actions with Variables
```tsx
// In WorkflowBuilder, filter available actions
const availableActions = actions.filter(action => {
  // Check if action has variables
  const hasVariables = Object.values(action.arguments).some(
    val => typeof val === 'string' && val.includes('{{var:')
  );
  return !hasVariables;
});

// Show info message
{actions.length !== availableActions.length && (
  <div className="info-message">
    {actions.length - availableActions.length} actions hidden (contain variables)
  </div>
)}
```

### Form Validation
```tsx
// In WorkflowBuilder
const [errors, setErrors] = useState<{name?: string, steps?: string}>({});

const validate = () => {
  const newErrors: any = {};
  
  if (!name.trim()) {
    newErrors.name = "Name is required";
  }
  
  if (steps.length === 0) {
    newErrors.steps = "At least one step is required";
  }
  
  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};

const handleSave = () => {
  if (!validate()) return;
  // ... save logic
};
```

---

## Error Handling

### API Errors
```tsx
// In WorkflowsTab
const handleExecute = async (workflowId: string) => {
  try {
    setExecuting(true);
    const result = await executeWorkflow(workflowId);
    setExecutionResult(result);
    setExecutionModalOpen(true);
  } catch (err) {
    console.error(err);
    alert(`Failed to execute workflow: ${err.message}`);
  } finally {
    setExecuting(false);
  }
};
```

### Backend Validation Errors
```tsx
// In WorkflowBuilder
const handleSave = async () => {
  try {
    const workflow = await createWorkflow({
      name,
      description,
      steps: selectedActions.map((action, idx) => ({
        action_id: action.id,
        order: idx
      }))
    });
    onSave(workflow);
  } catch (err) {
    // Backend might return error about variables
    alert(`Failed to create workflow: ${err.message}`);
  }
};
```

---

## CSS Styling Strategy

### Tab Styles (Sidebar.css)
```css
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}

.sidebar-tabs button {
  flex: 1;
  padding: 0.75rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 0.875rem;
  color: #6b7280;
}

.sidebar-tabs button.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}

.sidebar-tabs button:hover {
  color: #1f2937;
}
```

### Workflow Card Styles
```css
.workflow-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 0.75rem;
}

.workflow-card-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 0.5rem;
}

.workflow-card-name {
  font-weight: 600;
  font-size: 0.95rem;
  margin: 0;
}

.workflow-card-meta {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.workflow-card-actions {
  display: flex;
  gap: 0.5rem;
}

.workflow-card-actions button {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  border-radius: 4px;
  cursor: pointer;
}
```

---

## Testing Strategy (Manual)

### Test 1: Tab Switching
1. Open app
2. Click "Workflows" tab
3. Should show empty state
4. Click "Actions" tab
5. Should show actions list

### Test 2: Create Workflow
1. Go to Workflows tab
2. Click "Create Workflow"
3. Enter name "Test Workflow"
4. Select action from dropdown
5. Click "Add"
6. Action appears in list
7. Add second action
8. Click "Save Workflow"
9. Workflow appears in list

### Test 3: Execute Workflow
1. Click "Execute" on workflow
2. Modal opens with loading
3. Results display with success status
4. Each step shows result
5. Click "Close"

### Test 4: Edit Workflow
1. Click "Edit" on workflow
2. Builder opens with pre-filled data
3. Change name
4. Remove one action
5. Add different action
6. Click "Save"
7. Workflow updates in list

### Test 5: Delete Workflow
1. Click "Delete" on workflow
2. Confirmation dialog appears
3. Confirm deletion
4. Workflow removed from list

### Test 6: Variable Filtering
1. Create action with variables
2. Go to Workflows tab
3. Click "Create Workflow"
4. Action with variables should NOT appear in dropdown
5. Info message shows: "X actions hidden"

---

## Estimated Complexity

### Phase 1: API Layer
**Complexity:** Low
**Time:** 30 minutes
**Files:** 1 (api.ts)

### Phase 2: Basic Display
**Complexity:** Medium
**Time:** 1-2 hours
**Files:** 4 (Sidebar.tsx, ActionsTab.tsx, WorkflowsTab.tsx, WorkflowCard.tsx)

### Phase 3: Execution
**Complexity:** Low-Medium
**Time:** 45 minutes
**Files:** 2 (WorkflowsTab.tsx update, WorkflowExecutionModal.tsx)

### Phase 4: Builder (Create)
**Complexity:** High
**Time:** 2-3 hours
**Files:** 2 (WorkflowBuilder.tsx, WorkflowBuilder.css)

### Phase 5: Builder (Edit)
**Complexity:** Low
**Time:** 30 minutes
**Files:** 1 (WorkflowBuilder.tsx update)

### Phase 6: Polish
**Complexity:** Medium
**Time:** 1 hour
**Files:** Multiple CSS files

**Total Estimated Time:** 6-8 hours for complete implementation

---

## MVP Scope Reminder

### ✅ Include
- Tabs (Actions / Workflows)
- List workflows
- Create workflow (dropdown selection)
- Execute workflow
- Edit workflow
- Delete workflow
- Display execution results
- Filter actions with variables

### ❌ Defer
- Drag-and-drop step reordering
- Visual flow diagram
- Workflow templates
- Duplicate workflow
- Workflow versioning
- Execution history
- Share workflows
- Export/import workflows

---

## Success Criteria

### User Can:
1. ✅ Switch between Actions and Workflows tabs
2. ✅ See list of all workflows
3. ✅ Create new workflow by selecting actions
4. ✅ Execute workflow and see results
5. ✅ Edit existing workflow
6. ✅ Delete workflow
7. ✅ See clear error messages
8. ✅ Experience smooth UI without bugs

### System Should:
1. ✅ Prevent actions with variables in workflows
2. ✅ Show helpful empty states
3. ✅ Refresh automatically after changes
4. ✅ Handle errors gracefully
5. ✅ Display loading states
6. ✅ Match design aesthetics of existing UI

---

## Ready to Implement

Next steps:
1. Start with Phase 1 (API layer)
2. Test API functions work
3. Move to Phase 2 (basic display)
4. Iterate through phases
5. Test at each phase

Shall we begin with Phase 1?
