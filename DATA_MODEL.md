# Data Model

Field names below are a concrete default (the brief says field names are flexible); the relationships are not: `org → members → workflows → steps/triggers`, `workflow → runs → step_runs`.

## organizations
- id
- name
- calls_used
- calls_allowed
- quota_period_start — see `ARCHITECTURE.md` §9 for the compute-on-read reset rule
- created_at

## org_members
- id
- user_id
- org_id
- role — enum: `owner` | `editor` | `viewer`
- created_at
- unique on (user_id, org_id) — a user has at most one role per org; a user MAY belong to multiple orgs (ADR-007), each with its own row/role here

## workflows
- id
- org_id
- name
- created_by — user_id
- created_at
- updated_at

## workflow_steps
- id
- workflow_id
- order_index — integer, defines sequence; `conditional_branch` jumps reference other steps' `order_index` (`ARCHITECTURE.md` §6), not raw array position
- type — enum: `llm_call` | `http_request` | `db_write` | `notify` | `conditional_branch` | `approval_gate`
- config — JSONB, shape depends on `type` (documented per type in `ARCHITECTURE.md` §6)
- created_at

## workflow_triggers
- id
- workflow_id
- type — enum: `manual` | `webhook` | `scheduled` | `database_event`
- config — JSONB: `webhook` → `{ secret }` (ADR-005); `scheduled` → `{ cron }`; `database_event` → `{ watched_table, watched_event }`; `manual` → `{}`
- created_at

## workflow_runs
- id
- workflow_id
- status — enum: `pending` | `running` | `paused` | `completed` | `failed`
- triggered_by — nullable; user_id for manual, or a trigger-type label for the other three
- started_at
- completed_at — nullable until terminal

## step_runs
- id
- workflow_run_id
- workflow_step_id
- status — enum: `pending` | `running` | `paused` | `completed` | `failed`
- input — JSONB, nullable until the step starts
- output — JSONB, nullable until the step produces a result (null = not yet produced; `{}` = produced, but empty — these are not the same thing)
- error — text, nullable (null = no error)
- attempt_count — integer, starts at 0, incremented per retry (`ARCHITECTURE.md` §5, ADR-002)
- approved_by — nullable; user_id, set only for `approval_gate` steps once approved
- approved_at — nullable; set alongside `approved_by`
- started_at
- completed_at — nullable until terminal

## org_usage_this_month (view, not a table — `ARCHITECTURE.md` §10)
- org_id
- calls_used
- calls_allowed
- quota_period_start

## Design rules
- `output = null` means the step has not yet produced a result; `output = {}` means it produced an empty/no-op result. Do not collapse these.
- `error = null` means no error occurred, including for steps that never ran (`pending`) — check `status`, not `error`, to determine whether a step ran at all.
- `approved_by`/`approved_at` are only ever set on `approval_gate` step_runs; leave both `null` for every other step type rather than special-casing them elsewhere in the schema.
- Never store a client-supplied `org_id` or `role` on a row as the basis for a later authorization decision — authorization is always re-derived from `org_members` at the time of the check (`ARCHITECTURE.md` §3–§4), not read back from a previously-stored value.
