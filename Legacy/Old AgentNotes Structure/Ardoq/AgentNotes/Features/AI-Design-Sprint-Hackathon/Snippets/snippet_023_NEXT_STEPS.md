# Snippet 023 - Next Steps & Future Enhancements

## Current State Summary

### ✅ Completed
- **Backend**: Actions with variables, tool execution, action storage
- **Backend**: Workflows with CRUD, sequential execution, validation
- **Frontend**: Chat interface with tool calls and action saving
- **Frontend**: Workflows tab with full CRUD + execution UI
- **Integration**: Complete end-to-end workflow system

### 🎯 Demo-Ready Features
- Create actions from chat
- Configure action parameters as variables
- Save actions for reuse
- Create workflows from saved actions
- Execute workflows sequentially
- View detailed execution results

---

## Immediate Next Steps (Pre-Demo)

### 1. Testing & Bug Fixes
**Priority:** High
**Time:** 1-2 hours

**Tasks:**
- Test complete user flow end-to-end
- Create test actions via chat
- Create workflow from actions
- Execute workflow and verify results
- Test edge cases (empty workflows, failed steps, etc.)
- Fix any bugs discovered
- Verify error messages are user-friendly

**Testing Script:**
```bash
# Terminal 1: Start backend
cd backend
uvicorn src.main:app --reload

# Terminal 2: Start frontend
cd frontend
npm run dev

# Browser: http://localhost:5173
```

### 2. Create Python Test Suite
**Priority:** Medium
**Time:** 1-2 hours

**What to Create:**
```python
# backend/tests/test_workflows.py
- Test workflow creation
- Test workflow execution
- Test variable validation
- Test error handling
- Test CRUD operations

# backend/tests/test_integration.py
- Test complete user flow
- Create actions → create workflow → execute
```

**Why:** Automated testing for confidence, easier debugging

### 3. Add Demo Data Script
**Priority:** Medium
**Time:** 30 minutes

**Create:**
```python
# backend/scripts/seed_demo_data.py
- Creates sample actions
- Creates sample workflows
- Useful for demos and testing
```

**Example:**
```python
# Seed with:
# - 5 sample actions (calculator, text transformer, etc.)
# - 2 sample workflows
# - Execute one workflow to show results
```

---

## Short-Term Enhancements (Post-Demo)

### 4. Data Passing Between Steps
**Priority:** High
**Time:** 4-6 hours
**Complexity:** High

**Goal:** Steps can use previous step outputs as inputs

**Backend Changes:**
```python
# Input mapping syntax
step = WorkflowStep(
    action_id="action-2",
    order=1,
    input_mapping={
        "text": "{{step.0.result}}"  # Use step 0's result
    }
)

# Execution engine resolves mappings
def resolve_inputs(mapping, context):
    # Replace {{step.X.result}} with actual values
    pass
```

**Frontend Changes:**
- Add "Input Mapping" section in WorkflowBuilder
- For each step, allow mapping parameters to previous steps
- Dropdown: "Use step X result" or "Use saved value"

**Benefits:**
- Real data pipelines
- Chaining transformations
- More powerful workflows

**Challenges:**
- Type compatibility (number → string)
- Nested data access
- Error propagation

### 5. Workflow-Level Variables
**Priority:** High
**Time:** 3-4 hours
**Complexity:** Medium

**Goal:** Prompt for variables once at workflow start, use in multiple steps

**Backend Changes:**
```python
# Workflow model
class Workflow(BaseModel):
    ...
    variables: dict[str, WorkflowVariable] = {}

class WorkflowVariable(BaseModel):
    name: str
    type: str  # "string" | "number"
    label: str
    default_value: str | None

# Step input mapping
step.input_mapping = {
    "report_id": "{{workflow.var.report_id}}"
}

# Execution
def execute_workflow(workflow_id, variable_values):
    # Resolve workflow variables first
    # Then resolve step mappings
    pass
```

**Frontend Changes:**
- Add "Workflow Variables" section in builder
- Prompt for all variables at execution time
- One modal at start instead of per-step

**Benefits:**
- Can include actions with variables in workflows
- Reusable workflows with different inputs
- Cleaner UX (one prompt vs many)

### 6. Execution History
**Priority:** Medium
**Time:** 3-4 hours
**Complexity:** Medium

**Goal:** Track all workflow executions with results

**Backend Changes:**
```python
# New model
class WorkflowExecution(BaseModel):
    id: str
    workflow_id: str
    started_at: datetime
    completed_at: datetime | None
    result: WorkflowExecutionResult
    status: str

# New storage
class ExecutionStorage:
    executions: dict[str, WorkflowExecution] = {}
    
    def save_execution(...)
    def list_executions(workflow_id) -> list[WorkflowExecution]
    def get_execution(execution_id) -> WorkflowExecution

# New endpoints
GET /workflows/{id}/executions
GET /executions/{id}
```

**Frontend Changes:**
- Add "History" tab in workflow details
- Show list of past executions with timestamps
- Click to view detailed results
- Filter by success/failure

**Benefits:**
- Audit trail
- Debug failed workflows
- Compare execution results over time

---

## Medium-Term Enhancements

### 7. Drag-and-Drop Step Reordering
**Priority:** Medium
**Time:** 2-3 hours
**Complexity:** Medium

**Libraries:**
- `@dnd-kit/core` - Modern drag-and-drop
- `@dnd-kit/sortable` - Sortable lists

**Implementation:**
```tsx
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

// Wrap step list with drag-and-drop
<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={steps} strategy={verticalListSortingStrategy}>
    {steps.map(step => <SortableStep key={step.id} step={step} />)}
  </SortableContext>
</DndContext>
```

**Benefits:**
- Intuitive reordering
- Better UX than remove/re-add
- Visual feedback

### 8. Visual Flow Diagram
**Priority:** Low
**Time:** 6-8 hours
**Complexity:** High

**Libraries:**
- ReactFlow - Node-based graph editor
- or custom SVG with D3.js

**Implementation:**
- Nodes represent steps
- Edges show data flow
- Click node to configure
- Pan/zoom canvas

**Benefits:**
- Visual understanding of workflow
- See data dependencies
- Professional look

### 9. Conditional Steps (If/Else)
**Priority:** Low
**Time:** 8-10 hours
**Complexity:** Very High

**Goal:** Steps execute based on conditions

**Example:**
```
Step 1: Execute report
Step 2: If step 1 result contains "error"
  → Step 3a: Send error notification
Step 2: Else
  → Step 3b: Process results
```

**Backend Changes:**
- Add condition field to WorkflowStep
- Execution engine evaluates conditions
- Branch to different steps based on result

**Complexity:**
- Condition expression parser
- Multiple execution paths
- Testing complexity

---

## Long-Term Enhancements

### 10. Persistent Storage (Database)
**Priority:** High (for production)
**Time:** 4-6 hours
**Complexity:** Medium

**Options:**
- SQLite (simple, file-based)
- PostgreSQL (robust, production-ready)
- MongoDB (flexible schema)

**Implementation:**
```python
# Replace in-memory dicts with database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Models
class ActionModel(Base):
    __tablename__ = "actions"
    id = Column(String, primary_key=True)
    tool_name = Column(String)
    ...

# Repositories
class ActionRepository:
    def save(self, action): ...
    def get(self, id): ...
    def list(self): ...
```

**Benefits:**
- Data persists across restarts
- Can scale to multiple servers
- Query optimization
- Backups

### 11. Authentication & Multi-User
**Priority:** High (for production)
**Time:** 8-12 hours
**Complexity:** High

**Requirements:**
- User registration/login
- JWT authentication
- User-specific actions/workflows
- Permissions (view/edit/delete)

**Stack:**
- FastAPI OAuth2 with JWT
- Password hashing (bcrypt)
- Frontend: Store token, add to requests

**Changes:**
```python
# Add user_id to models
class SavedAction(BaseModel):
    ...
    user_id: str

# Filter by user
def list_actions(user_id):
    return [a for a in actions if a.user_id == user_id]

# Protected endpoints
@router.get("/actions/")
async def list_actions(current_user: User = Depends(get_current_user)):
    return action_storage.list_actions(current_user.id)
```

### 12. Real Ardoq Integration
**Priority:** High (for production)
**Time:** 4-8 hours
**Complexity:** Medium

**Goal:** Replace mock `execute_report` with real Ardoq API calls

**Requirements:**
- Ardoq API credentials
- Authentication (API key or OAuth)
- Real report execution
- Data fetching from Ardoq

**Implementation:**
```python
import httpx

async def execute_report(ctx, report_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{ARDOQ_API_BASE}/reports/{report_id}/execute",
            headers={"Authorization": f"Bearer {ARDOQ_API_KEY}"}
        )
        return response.json()
```

**Tools to Add:**
- `get_workspace` - Fetch workspace data
- `search_components` - Search components by query
- `get_references` - Get relationships
- `create_component` - Create new component
- `update_component` - Update component

### 13. Scheduled Workflows
**Priority:** Medium
**Time:** 6-8 hours
**Complexity:** High

**Goal:** Run workflows on schedule (daily, weekly, etc.)

**Requirements:**
- Task scheduler (Celery, APScheduler)
- Cron-like syntax
- Execution queue
- Notifications on completion

**Implementation:**
```python
from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler()

# Schedule workflow
scheduler.add_job(
    func=execute_workflow,
    trigger="cron",
    args=[workflow_id],
    hour=9,  # Daily at 9am
    minute=0
)

scheduler.start()
```

**Frontend:**
- Add "Schedule" button on workflows
- Modal to configure schedule
- View scheduled jobs
- Enable/disable schedules

### 14. Workflow Templates & Marketplace
**Priority:** Low
**Time:** 10-15 hours
**Complexity:** High

**Goal:** Share reusable workflow templates

**Features:**
- Template library (public workflows)
- Category/tag system
- Search templates
- "Use Template" button creates copy
- Rate/review templates

**Example Templates:**
- "Daily Report Pipeline"
- "Data Validation Workflow"
- "Notification Workflow"

---

## Demo Preparation Checklist

### Before Demo
- [ ] Test complete user flow (create action → workflow → execute)
- [ ] Create 2-3 demo workflows
- [ ] Verify UI looks good (no layout issues)
- [ ] Test on different screen sizes
- [ ] Clear any test data before demo
- [ ] Have backend + frontend running
- [ ] Test error cases (so you know what to avoid)

### Demo Script
1. **Introduction** (30 sec)
   - "AI-powered workflow automation for Ardoq"
   - "Chain actions into reusable workflows"

2. **Create Actions via Chat** (1 min)
   - Ask: "Calculate 10 + 20"
   - Save action: "Add numbers"
   - Ask: "Transform 'hello world' to uppercase"
   - Save action: "Uppercase text"

3. **Create Workflow** (1 min)
   - Switch to Workflows tab
   - Click "Create Workflow"
   - Name: "Number Processing"
   - Add both actions
   - Save

4. **Execute Workflow** (30 sec)
   - Click Execute
   - Show results modal
   - Highlight per-step results

5. **Edit Workflow** (30 sec)
   - Click Edit
   - Add another step or change order
   - Save

6. **Highlight Features** (30 sec)
   - Variable parameters (show but don't deep dive)
   - Action filtering (can't add variable actions to workflows)
   - Execution history in results

### Questions to Anticipate
- **Q: Can workflows pass data between steps?**
  - A: Not in MVP, but planned for next phase

- **Q: Can I schedule workflows?**
  - A: Not yet, but on roadmap

- **Q: Does it work with real Ardoq reports?**
  - A: Currently mock, but designed for easy integration

- **Q: What about authentication?**
  - A: Proof of concept - production would add auth

---

## Architecture Evolution

### Current: MVP
```
FastAPI Backend (In-Memory Storage)
    ↓
React Frontend (Local State)
```

### Short-Term: Data Persistence
```
FastAPI Backend
    ↓
Database (SQLite/Postgres)
    ↓
React Frontend
```

### Medium-Term: Production-Ready
```
FastAPI Backend + Auth
    ↓
Database + Redis Cache
    ↓
React Frontend + State Management (Zustand/Redux)
    ↓
Real Ardoq API Integration
```

### Long-Term: Enterprise
```
FastAPI Backend + Microservices
    ↓
PostgreSQL + Redis + Message Queue
    ↓
React Frontend + SSO Auth
    ↓
Ardoq API + Other Integrations
    ↓
Monitoring + Logging + Analytics
```

---

## Technical Debt & Improvements

### Code Quality
- [ ] Add TypeScript strict mode
- [ ] Add ESLint rules
- [ ] Add Prettier formatting
- [ ] Add pre-commit hooks
- [ ] Add backend type checking (mypy)
- [ ] Add backend linting (ruff)

### Testing
- [ ] Backend unit tests
- [ ] Backend integration tests
- [ ] Frontend component tests (Vitest + React Testing Library)
- [ ] Frontend E2E tests (Playwright)
- [ ] API contract tests

### DevOps
- [ ] Docker containerization
- [ ] Docker Compose for local dev
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Automated testing on PR
- [ ] Deployment scripts

### Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Frontend component documentation (Storybook)
- [ ] User guide
- [ ] Developer setup guide
- [ ] Architecture diagrams

---

## Prioritized Roadmap

### Phase 1: Demo Polish (1-2 days)
1. Testing & bug fixes
2. Create demo data script
3. Polish UI rough edges
4. Practice demo script

### Phase 2: Core Enhancements (1 week)
1. Data passing between steps
2. Workflow-level variables
3. Execution history
4. Database persistence

### Phase 3: UX Improvements (3-5 days)
1. Drag-and-drop reordering
2. Better error messages
3. Loading improvements
4. Workflow templates

### Phase 4: Production Readiness (1-2 weeks)
1. Authentication & authorization
2. Real Ardoq API integration
3. Testing suite
4. Docker deployment

### Phase 5: Advanced Features (2-3 weeks)
1. Scheduled workflows
2. Conditional logic
3. Visual flow diagram
4. Monitoring & analytics

---

## Success Metrics

### MVP Success
- ✅ Can create workflows
- ✅ Can execute workflows
- ✅ Can view results
- ✅ UI is intuitive
- ✅ Demo-ready

### Production Success
- [ ] 10+ users actively using
- [ ] 50+ workflows created
- [ ] 1000+ workflow executions
- [ ] <100ms API response time
- [ ] 99.9% uptime

### Business Success
- [ ] Saves users 5+ hours/week
- [ ] Reduces manual errors
- [ ] Integrates with Ardoq effectively
- [ ] Users report high satisfaction

---

## Questions for Stakeholders

### Product Direction
1. What's the primary use case? (Reports, data processing, notifications?)
2. Who are the target users? (Admins, analysts, developers?)
3. What Ardoq operations are most common?
4. What existing pain points does this solve?

### Technical Decisions
1. Preferred authentication method? (SSO, OAuth, API keys?)
2. Hosting preferences? (Cloud, on-premise, hybrid?)
3. Data retention policies?
4. Performance requirements?

### Roadmap Priorities
1. Which features are must-haves for production?
2. Timeline for production deployment?
3. Budget for infrastructure?
4. Team resources available?

---

## Summary

### Immediate Focus
1. **Test thoroughly** - Find and fix bugs
2. **Create tests** - Python test suite for confidence
3. **Demo prep** - Practice, polish, prepare

### Short-Term Goals
1. Data passing between steps
2. Workflow variables
3. Execution history
4. Database persistence

### Long-Term Vision
Full-featured workflow automation platform integrated with Ardoq, supporting scheduled execution, conditional logic, and visual flow design.

**Current Status:** MVP Complete, Demo-Ready ✅
**Next Milestone:** Production-Ready System 🎯
