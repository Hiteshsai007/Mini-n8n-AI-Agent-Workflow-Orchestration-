# API Specification

## GraphQL — required operations (per `PRD.md` §4)

### Query — org workflows with steps, triggers, latest run status
```graphql
query OrgWorkflows($org_id: uuid!) {
  workflows(where: { org_id: { _eq: $org_id } }) {
    id
    name
    workflow_steps(order_by: { order_index: asc }) { id order_index type config }
    workflow_triggers { id type config }
    workflow_runs(order_by: { started_at: desc }, limit: 1) { id status started_at completed_at }
  }
}
```
Authorization is enforced entirely by the Layer 1 Hasura permission on `workflows` (`ARCHITECTURE.md` §3) — this query needs no application-level org check; a request for an org the caller isn't a member of returns an empty set, not an error, which is correct (it must not reveal whether the org exists).

### Mutation — create/edit a workflow, its steps, and its triggers
Use nested GraphQL mutations against `workflows`/`workflow_steps`/`workflow_triggers` (Hasura supports nested inserts/upserts). Adding a `db_write`, `webhook`, or `notify` step/trigger is additionally restricted to `owner` — enforce via a Hasura permission check on `workflow_steps`/`workflow_triggers` insert scoped by `type`, in addition to the general org+role check (this keeps the restriction declarative, at Layer 1, rather than needing a Layer 2 check for step creation — reserve Layer 2 for genuinely mid-execution decisions per `ARCHITECTURE.md` §4).

### Mutation — approve a paused approval_gate step
Not a direct table mutation — calls the `approveStep` Action (below), because the role check here is explicitly a Layer 2, imperative decision per the brief.

### Subscription — live step_runs for a run
```graphql
subscription StepRunProgress($workflow_run_id: uuid!) {
  step_runs(
    where: { workflow_run_id: { _eq: $workflow_run_id } }
    order_by: { started_at: asc }
  ) {
    id status output error attempt_count approved_by approved_at started_at completed_at
  }
}
```
The `paused` status value is what the frontend uses to render the approve UI (`UX_SPEC.md`).

## Hasura Actions

### triggerWorkflowRun(workflow_id: uuid!): WorkflowRun
See `ARCHITECTURE.md` §5. Trusted input: `workflow_id` only. The caller's identity and role are re-derived server-side from the session variable and `org_members` — never accepted as Action arguments.

### approveStep(step_run_id: uuid!): StepRun
See `ARCHITECTURE.md` §8. Same trust rule — `step_run_id` is the only trusted input.

### webhookTriggerRun(workflow_id: uuid!, secret: String!): WorkflowRun
See `ARCHITECTURE.md` §11. This is the one Action that intentionally accepts no authenticated session (external callers) — authorization here is entirely the `secret` matching `workflow_triggers.config.secret` for that workflow's webhook trigger row. This is a materially different trust model from the other two Actions and must not be confused with them.

## Error model
```json
{ "error": { "code": "ORG_QUOTA_EXCEEDED", "message": "This organization has used its quota for the current period." } }
```

Defined error codes:
- `ORG_QUOTA_EXCEEDED` — quota check (§`ARCHITECTURE.md` §5 step 3) failed; no run created
- `FORBIDDEN_ROLE` — caller lacks the required role for this operation (Layer 2)
- `WORKFLOW_NOT_FOUND` — either genuinely missing, or belongs to an org the caller can't see (these two cases return the identical error and identical response shape, deliberately — do not let a coding agent implement a more specific "belongs to another org" message, which would leak org existence and weaken the Final Task's isolation requirement)
- `STEP_NOT_PAUSED` — `approveStep` called on a step_run that isn't in `paused` status
- `INVALID_TRIGGER_SECRET` — `webhookTriggerRun` secret mismatch
- `UPSTREAM_CALL_FAILED` — an `llm_call`/`http_request` step exhausted its retry (`ARCHITECTURE.md` §5 step 5d); this is a terminal `step_run`/`workflow_run` state, not a GraphQL-level error, since it's a normal, expected outcome the UI needs to render rather than an exceptional condition

## Security
- HTTPS only.
- Actions never accept caller identity, org_id, or role as arguments — only resource IDs, re-derived and re-checked server-side every time (`ARCHITECTURE.md` §3–§4, restated here because this is the single most important rule in this document).
- `webhookTriggerRun`'s secret is compared using a constant-time comparison, not a plain `==`, to avoid timing side-channels.
