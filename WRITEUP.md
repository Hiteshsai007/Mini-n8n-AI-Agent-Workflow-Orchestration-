# Mini n8n Workflow Orchestration Write-Up

## 1. Schema Reasoning & Database Design
The schema is built around PostgreSQL using Hasura for the GraphQL layer. It uses a clean, normalized structure spanning 7 tables to ensure strict referential integrity and maintain multi-tenant isolation.
- **Organizations & Members:** A many-to-many relationship using `org_members` enables cross-org isolation and sets role-based permissions (`owner`, `editor`, `viewer`). 
- **Workflows & Steps/Triggers:** Workflows are strictly scoped to an `org_id`. The execution plan (`workflow_steps`) and inbound hooks (`workflow_triggers`) heavily rely on foreign keys cascading on deletion, ensuring orphans are impossible. Steps use a schema-less `JSONB` column for configuration, making the platform easily extensible to new node types without schema migrations.
- **Run State:** Instead of a complex, stateful graph stored in memory, all state is durably persisted in `workflow_runs` and `step_runs`. This persistence guarantees that paused wait-states (like approvals) can sit indefinitely across server restarts without losing their place in the loop.

## 2. The Two-Layer Permission Model
Protecting a workflow platform requires preventing both data exfiltration (seeing someone else's workflows) and arbitrary side-effect execution (running someone else's workflow). We solved this using a strict two-layer approach:
- **Layer 1 (Data-Level Security):** 
  Implemented purely within Hasura's permission engine. Every query/mutation passes through relationships checking `org_members.user_id = X-Hasura-User-Id`. This guarantees that even if a malicious user in Org B attempts to directly query or mutate a workflow ID belonging to Org A (direct ID guessing), the database itself drops the row. The Action Handler doesn't need to reinvent these checks for basic CRUD operations.
- **Layer 2 (Imperative Execution Security):** 
  Not all actions can be solved by database visibility. When a user requests to run a workflow or approve a step via the Action Handler (`/trigger-workflow-run` or `/approve-step`), the handler performs a Layer 2 validation. It decodes the incoming `X-Hasura-User-Id`, resolves the underlying `org_id` of the workflow, and imperatively asserts the user's role (e.g., ensuring a `viewer` cannot trigger a run, or that an `approval_gate` is strictly approved by an `owner`/`editor`).

## 3. Approval-Gate Pause/Resume Mechanics
The orchestration loop is completely stateless and iterative. When the loop encounters an `approval_gate` step:
1. **Pausing:** The Action Handler logs the `step_run` with a status of `paused`. Because the Action Handler doesn't hold execution contexts in memory, the function simply exits, leaving the workflow in a halted state in the DB.
2. **Resuming:** An authorized user calls the `approveStep` Hasura Action. The handler verifies their Layer 2 permissions, marks the paused `step_run` as `completed`, and updates the parent `workflow_run` back to `running`.
3. **Re-entry:** The handler then recursively calls the core `runWorkflow()` function, passing in the `currentOrderIndex` shifted by +1. The loop picks up exactly where it left off, reading the previous step's output to continue execution seamlessly. This decoupled architecture allows workflows to pause for seconds or months with zero compute overhead.
