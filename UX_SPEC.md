# UX Specification

## Design direction
Clean, functional builder UI — clarity over polish given the time constraint. Prioritize the Final Task scenario being demonstrable over visual refinement.

## Screens (exactly these — no extra screens, per `PRD.md` §Non-goals)

### 1. Auth / org context
Login via nhost Auth. If the user belongs to more than one org (ADR-007), an active-org selector. This selector is UX convenience only — it does not grant access; every request is still checked server-side against real `org_members` rows (`ARCHITECTURE.md` §3).

### 2. Workflow builder
- List existing workflows for the active org.
- Add/reorder steps (drag or up/down controls) of the six types; each step type shows its own config form matching the JSONB shapes in `ARCHITECTURE.md` §6.
- Attach exactly one trigger (of the four types) per workflow, with its own config form (`DATA_MODEL.md` `workflow_triggers.config`).
- `db_write`, `webhook`, and `notify` step/trigger options are only offered to `owner`s (hidden, not just disabled, for `editor`/`viewer` — matches the Layer 1 permission in `API_SPEC.md`).

### 3. Run view
- Run button — hidden entirely for `viewer` role (per the brief).
- Live per-step status list, updated via the subscription (`API_SPEC.md`), each row showing status/output/error/attempt_count.
- When a step is `paused`, show an Approve control — visible only to `owner`/`editor` of that org (mirrors the Layer 2 check in `approveStep`; a `viewer` seeing this control would be misleading even though the backend would still reject the call).
- Terminal states (`completed`/`failed`) render distinctly from in-progress states (`running`/`paused`) — no color-only distinction (icon or label always accompanies color).

### 4. Quota indicator
Shows `calls_used / calls_allowed` for the active org's current period, sourced from `org_usage_this_month` (`ARCHITECTURE.md` §10). When exhausted, the Run button shows a disabled state with the `ORG_QUOTA_EXCEEDED` message rather than silently failing after a run attempt.

## States (every screen)
- loading
- empty (no workflows yet)
- success
- forbidden (role doesn't permit this action — shown as a disabled/hidden control per the rules above, not a runtime error, since the frontend already knows the role)
- error (network/GraphQL error)
- quota-exceeded (Run view / quota indicator only)

## Rules
- The frontend hides controls a role can't use; it never relies on hiding controls as the actual security boundary — Layers 1 and 2 do that (`ARCHITECTURE.md` §3–§4). This distinction matters for the cross-org isolation requirement: even if a control were shown by mistake, the backend must still refuse the action.
- Never display another org's data, even in aggregate or count form, to a user not a member of it.
