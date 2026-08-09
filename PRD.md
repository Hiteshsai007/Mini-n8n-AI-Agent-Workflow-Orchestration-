# PRD — Mini n8n (AI Agent Workflow Orchestration)

## 1. Problem
Teams want to chain AI agent steps (LLM calls, external API calls, conditional logic, human approval) into repeatable workflows, scoped to an organization, started multiple ways, with real permission enforcement — not a toy demo where anyone can see or trigger anything.

## 2. Product
A multi-tenant workflow builder and executor. Users inside an organization build workflows out of ordered steps, attach a trigger, and run them. Every action is checked against two independent permission layers (org+role scoping, and step-level gating). Execution streams live to the UI via GraphQL subscriptions.

## 3. Target user
Whoever is evaluating this take-home submission, standing in for: an org `owner` building/administering workflows, an `editor` building and running them, and a `viewer` with read-only access. The product must also correctly refuse a second organization's users at every layer, including direct ID guessing — this is graded as a first-class requirement, not an edge case.

## 4. Scope is fixed by the assignment brief — build exactly this, nothing more
### Step types (exactly these six)
`llm_call`, `http_request`, `db_write`, `notify`, `conditional_branch`, `approval_gate`.

### Trigger types (exactly these four)
`manual`, `webhook`, `scheduled`, `database_event`.

### Data model (minimum, per the brief)
`organizations`, `org_members`, `workflows`, `workflow_steps`, `workflow_triggers`, `workflow_runs`, `step_runs`. Field names are flexible; the relationships (`org → members → workflows → steps/triggers`, `workflow → runs → step_runs`) are not.

### Required GraphQL surface
- A query returning an org's workflows with their steps, triggers, and most recent run status.
- A mutation to create/edit a workflow, its steps, and its triggers.
- A mutation to approve a paused `approval_gate` step.
- A subscription on `step_runs` filtered by `workflow_run_id`, including a paused/awaiting-approval state.

### Required Hasura Actions
- `triggerWorkflowRun(workflow_id)` — the core orchestrator (see `ARCHITECTURE.md` §4).
- `approveStep(step_run_id)` — resumes a paused `approval_gate` step after an imperative role check.
- A trigger-authenticating entry point for at least one non-manual trigger, actually wired (see `ARCHITECTURE.md` §5).

### Required frontend
Auth + org context, a workflow builder (add/reorder steps, attach a trigger), a Run button hidden for viewers, live per-step status with pause/approve UI, and a usage/quota indicator.

## 5. Non-goals (explicit — prevents overbuilding under time pressure)
- No step or trigger types beyond the six/four listed above.
- No workflow versioning or editing a workflow while a run is in progress.
- No SSO, billing, multi-region, or horizontal scaling concerns.
- No retry policy beyond the one retry the brief asks for (see `DECISIONS.md` ADR-002).
- No general-purpose "any node can call any other node" graph editor — steps are an ordered sequence with `conditional_branch` providing the only branching, per the brief's model.
- No admin/superuser role above `owner` — the three roles named in the brief are the complete role set.
- No numeric compatibility/quality scoring of any kind (not applicable to this product, noted only for consistency with prior work in this workspace).

## 6. Acceptance criteria — the Final Task (verbatim from the brief, this is the actual grading bar)
1. Two separate organizations exist, each with their own users and roles.
2. In Org A, an owner builds a workflow with at least 3 step types, including one `llm_call`, one `http_request`, and one `conditional_branch` that changes behavior based on the LLM's output.
3. The workflow can be started two ways — manually, and via a webhook or event trigger.
4. One step is an `approval_gate` — the run pauses, and only an owner/editor in that org can approve it forward.
5. While running, live status streams step-by-step with no refresh, including the paused state.
6. Logged in as an Org B user, they cannot see, trigger, or approve anything belonging to Org A — not even by guessing an ID directly.

This is graded as one deliverable, live — not six things graded separately. See `ACCEPTANCE_TESTS.md`.

## 7. Success metrics (for this exercise)
- The Final Task passes live, weighted above everything else.
- Cross-org isolation holds under direct ID guessing (`SECURITY.md`).
- Step-level permission gating (Layer 2) is enforced in the Action handler code, not merely assumed from Layer 1.
- Retry/failure handling and quota enforcement behave as specified.
- Schema/Hasura relationship correctness.
- Code and documentation clarity, delivered fast without shortcuts that only work in a demo.
