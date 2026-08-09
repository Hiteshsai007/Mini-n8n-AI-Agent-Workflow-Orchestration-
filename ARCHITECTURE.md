# Architecture

## 1. High-level design
```
Next.js Frontend
   |  (nhost Auth session, GraphQL client)
   v
Hasura GraphQL Engine
   |-- Queries/Mutations/Subscriptions  --> PostgreSQL (Layer 1 permissions enforced here, per-request)
   |-- Actions: triggerWorkflowRun, approveStep, webhookTriggerRun
   |         --> Action Handler (serverless function) --> Layer 2 checks --> Execution Loop
   |-- Scheduled Trigger --> calls triggerWorkflowRun on cron
   |-- Event Trigger (on step_runs insert, type=notify) --> Notification webhook
   |-- Event Trigger (on watched table, per workflow_trigger config) --> calls triggerWorkflowRun
   v
PostgreSQL (source of truth: organizations, org_members, workflows, workflow_steps,
            workflow_triggers, workflow_runs, step_runs)
```

## 2. Components

### Hasura (schema + Layer 1 permissions)
Owns table tracking, relationships, and org+role row-level permission rules (§3). This is the first, structural permission layer — it answers "can this caller see/touch this row at all."

### Action Handler ("Execution Loop") — the orchestrator
A single serverless function (or a small set sharing this logic) invoked by `triggerWorkflowRun`, `approveStep`, and `webhookTriggerRun`. This is the only place business logic that spans steps, retries, and Layer 2 checks lives. Analogous role to an "Analysis Orchestrator" in a simpler product — it is required, not optional, and nothing else should duplicate its responsibilities.

### Step executors
One executor per step type (`llm_call`, `http_request`, `db_write`, `conditional_branch`, `approval_gate`). `notify` is deliberately not a step executor — see §6.

### Trigger subsystem
Four independent entry points (manual button, webhook Action, Hasura Scheduled Trigger, Hasura Event Trigger on a watched table) that all converge on the same `triggerWorkflowRun` logic. No trigger type gets its own execution path.

### Frontend
Reads via Hasura queries/subscriptions, writes via mutations and Actions. Never computes authorization itself — it only hides controls a role can't use (`UX_SPEC.md`); the real enforcement is server-side (Layers 1 and 2).

## 3. Layer 1 — org + role scoping (locked mechanism — ADR-004)
Enforced via **Hasura relationship-based row permissions**, not a static JWT org claim. Every org-scoped table's permission rule is expressed as a relationship traversal through `org_members` filtered on `user_id: {_eq: X-Hasura-User-Id}`, e.g., a `workflows` select permission checks `organization.org_members.user_id = X-Hasura-User-Id` (and role, for role-gated operations).

This is deliberately chosen over baking a single `org_id` into the JWT: a user may belong to multiple organizations (`org_members` is many-to-many — ADR-007), and relationship-based permissions evaluate against actual database membership on every request regardless of what the client claims or which org is "active" in the UI. This is also what makes direct ID guessing fail correctly (Final Task point 6): a request for `workflow_id` belonging to Org B from an Org A user fails the relationship check regardless of the ID being syntactically valid.

Role permissions within a matched org:
- `owner` — full control over workflows, steps, triggers, and org membership.
- `editor` — create/edit workflows and steps, trigger runs; cannot manage members.
- `viewer` — read-only; cannot trigger a run.

## 4. Layer 2 — step-level gating (imperative, inside the Action Handler)
Some operations reach outside the sandbox and cannot be expressed as a database row permission because they are mid-execution decisions or creation-time policy, not row reads/writes:
- Adding a `db_write`, `webhook` trigger, or `notify` step to a workflow is restricted to `owner` — checked in the create/update-workflow mutation logic (or a Postgres check constraint plus an explicit pre-check in the handler if using a plain mutation), not left to Layer 1 alone.
- `approveStep` **must** re-derive the caller's org and role from `org_members` (never trust a client-supplied role) and confirm it is `owner` or `editor` in the step's workflow's org before resuming — this is the assignment's own explicit instruction and the reason Layer 2 exists as a distinct concept from Layer 1.

## 5. `triggerWorkflowRun(workflow_id)` — execution flow
```
1. Derive caller's user id from the Hasura session variable (never trust a client-supplied user/org field).
2. Verify caller is owner/editor in the workflow's org (re-derived from org_members — Layer 2 check,
   independent of whatever Layer 1 already allowed for the GraphQL call that reached this Action).
3. Check the org's quota is not exhausted (see §7). If exhausted, fail with ORG_QUOTA_EXCEEDED (see API_SPEC.md) —
   no workflow_run is created.
4. Create workflow_run (status = "running").
5. For each workflow_step in order:
   a. Create step_run (status = "running", attempt_count = 0).
   b. Execute per step type (§6).
   c. On success: step_run.status = "completed", output persisted.
   d. On failure (llm_call/http_request only): retry once per ADR-002. On second failure:
      step_run.status = "failed", workflow_run.status = "failed", stop the loop.
   e. On approval_gate: workflow_run.status = "paused", step_run.status = "paused", stop the loop
      (resumption happens via approveStep, §8 — this is not a failure).
6. On completing all steps without failure: workflow_run.status = "completed",
   increment org quota usage by 1 (§7).
7. Every status change in this loop is a Postgres write, which is what the step_runs subscription
   observes live — there is no separate "push" mechanism to build.
```

## 6. Step execution semantics
- **`llm_call`** — calls a real LLM API (Groq/OpenRouter/Gemini or a disclosed stub with an artificial delay, per the brief). Config: `{ prompt, model }`. Output stored as `{ text, raw }` in `step_runs.output`.
- **`http_request`** — generic external call. Config: `{ url, method, headers, body }`. Output: `{ status, body }`.
- **`db_write`** — writes a result into the platform's own tables. Config: `{ target_table, mapping }` where `mapping` maps prior step output fields to columns. Restricted to `owner`-authored steps (§4).
- **`conditional_branch`** — locked condition schema (ADR-003): `{ field, operator, value, on_true_step_order, on_false_step_order }`. `field` is a JSONPath-style key into the immediately preceding step_run's `output`. `operator` is one of `equals | contains | exists` (minimal set — sufficient for the Final Task's "changes behavior based on the LLM's output" requirement without over-building a general expression language). Evaluates against the prior step's `output`, then the execution loop jumps to the `workflow_step` at the matching `order_index` instead of the next sequential one.
- **`approval_gate`** — config: `{ required_role }` (defaults to `owner`/`editor` per the brief; not user-configurable below that in MVP). Pauses per §5 step 5e; resumed only via `approveStep` (§8).
- **`notify`** — is **not** executed inline by the handler. See §7 — implemented via a Hasura Event Trigger, per the brief's explicit instruction.

## 7. `notify` — Event-Trigger-based dispatch (locked — ADR-006)
The execution loop still creates a `step_run` for a `notify` step (status = "pending" → "completed") so it stays in the ordered sequence and audit trail, but the actual Slack/email side effect is dispatched by a **Hasura Event Trigger** on `step_runs` INSERT, filtered to `workflow_steps.type = 'notify'`. This matches the brief's literal instruction ("notify ... implemented as an Event Trigger") and keeps the Action Handler from owning notification-delivery concerns.

## 8. `approveStep(step_run_id)` — resume flow
```
1. Derive caller's user id from session variable.
2. Load the step_run's workflow's org via joins; verify caller is owner/editor in that org
   (Layer 2 — this is the assignment's explicit "cannot be a database permission alone" case).
3. Verify the step_run.status is "paused"; otherwise fail with STEP_NOT_PAUSED.
4. Set step_run.approved_by, approved_at, status = "completed".
5. Set workflow_run.status back to "running".
6. Re-enter the execution loop (§5) at the next workflow_step in order.
```

## 9. Quota (locked — ADR-001)
`organizations` carries `calls_used`, `calls_allowed`, `quota_period_start`. Period = calendar month. Reset is **computed at read/write time** (if `now() >= quota_period_start + 1 month`, treat `calls_used` as 0 and roll `quota_period_start` forward) rather than a separate cron reset job — one fewer moving part for the same behavior. Quota increments by 1 per **completed workflow_run** (per the brief's own wording), not per external API call within a run.

## 10. Aggregation (Hasura layer requirement)
One Postgres view, `org_usage_this_month`: `(org_id, calls_used, calls_allowed, quota_period_start)`, exposed through Hasura and used directly by the frontend's quota indicator (`UX_SPEC.md`). Satisfies the brief's "one aggregation" requirement without adding a second one that isn't otherwise needed.

## 11. Trigger wiring (all four required; at least one non-manual actually wired per the brief)
- **Manual** — frontend Run button calls `triggerWorkflowRun` directly.
- **Webhook** — a dedicated Action, `webhookTriggerRun(workflow_id, secret)` (ADR-005), validates `secret` against the `workflow_triggers.config.secret` for that workflow's webhook trigger row, then calls the same execution flow as `triggerWorkflowRun`. This is the "external systems call to start a run" entry point and is deliberately not the same unauthenticated Action as the internal one.
- **Scheduled** — a Hasura Scheduled Trigger per `workflow_triggers` row of type `scheduled` (cron expression in `config.cron`), calling `triggerWorkflowRun(workflow_id)`.
- **Database event** — a Hasura Event Trigger on the table named in `config.watched_table`/`config.watched_event` for a `workflow_triggers` row of type `database_event`, calling `triggerWorkflowRun(workflow_id)`. MVP scope: the watched table/event is configured per trigger row, not dynamically arbitrary — this keeps the mechanism simple and demonstrable without building a generic table-watcher framework.

## 12. Boundaries
The step executors (§6) should be individually testable with mocked external calls — no real network dependency in their unit tests.
Layer 1 permission rules live entirely in Hasura metadata (declarative, reviewable, no business logic duplicated in application code).
Layer 2 checks live entirely in the Action Handler — never assume Layer 1 alone is sufficient for `approveStep` or step-creation restrictions (§4), per the brief's explicit warning.
