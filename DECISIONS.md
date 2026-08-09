# Decisions

Architecture decision records for every point where the assignment brief was ambiguous or silent. Each was locked with reasoning rather than left for a coding agent to invent silently, following the same discipline used in this workspace's earlier PC Capability Agent audit.

## ADR-001: Quota period and reset mechanism
Status: Accepted

Decision: quota period = calendar month; reset is computed at read/write time from `quota_period_start` rather than via a separate scheduled reset job.

Reason: the brief says "usage quota (calls used / allowed per period)" without naming the period or reset mechanism. A compute-on-read approach is one fewer moving part than a cron reset job for identical observable behavior, and avoids a race between a reset job and a concurrent quota check.

## ADR-002: Retry policy
Status: Accepted

Decision: exactly one retry (two attempts total) for `llm_call`/`http_request` steps on failure, with a short fixed delay between attempts. A step-level failure after retries is treated as fatal to the whole `workflow_run` — no partial-failure/continue-past-a-failed-step semantics in MVP.

Reason: the brief requires "at least one retry" and specifies no policy beyond that. Fatal-on-failure is the simplest correct behavior consistent with an ordered, sequential step model; partial-failure continuation isn't requested and would need its own semantics (skip vs. abort downstream steps) the brief doesn't define.

## ADR-003: conditional_branch condition schema
Status: Accepted

Decision: `{ field, operator: "equals"|"contains"|"exists", value, on_true_step_order, on_false_step_order }`, evaluated against the immediately preceding step_run's `output`.

Reason: the brief only says "if/else based on the previous step's output." A minimal three-operator schema is sufficient to demonstrate the Final Task's requirement ("changes behavior based on the LLM's output") without building a general expression/rules engine that wasn't asked for.

## ADR-004: Layer 1 mechanism — relationship-based Hasura permissions, not JWT org claims
Status: Accepted

Decision: org+role scoping (Layer 1) is implemented via Hasura permission rules that traverse `org_members` by relationship, not a static `org_id`/`role` baked into the JWT.

Reason: a static claim would either force one-org-per-user (contradicting the natural many-to-many shape of `org_members`) or require re-issuing tokens on org switch. Relationship-based permissions evaluate live against the database on every request, which is also what makes ID-guessing fail correctly by construction (Final Task point 6) rather than by an additional manual check.

## ADR-005: Webhook trigger authentication
Status: Accepted

Decision: `webhookTriggerRun(workflow_id, secret)` — a per-trigger shared secret, generated at trigger-creation time and stored in `workflow_triggers.config.secret`, compared with constant-time comparison.

Reason: the brief describes the webhook trigger as "external systems call to start a run" but does not specify authentication for it. Leaving it unauthenticated would let anyone who learns a `workflow_id` trigger runs against another org's quota — a real security gap the brief's own emphasis on "proper security... not shortcuts" argues against leaving open.

## ADR-006: notify dispatch via Event Trigger, not inline
Status: Accepted

Decision: the Action Handler creates the `notify` step's `step_run` row but does not itself call Slack/email; a Hasura Event Trigger on `step_runs` insert (filtered to `notify`-type steps) dispatches the actual notification.

Reason: this is the brief's explicit, literal instruction ("notify — Slack/email alert, implemented as an Event Trigger"), not an audit-derived inference.

## ADR-007: Users may belong to multiple organizations
Status: Accepted

Decision: `org_members` is treated as genuinely many-to-many; the frontend carries an "active org" selector, but it is UX-only and never the authorization boundary (see ADR-004).

Reason: the brief's own schema (`org_members — user_id, org_id, role`) is naturally many-to-many and doesn't state a one-org-per-user restriction; assuming single-org membership would be adding an unstated constraint, not removing ambiguity.

## Open questions (not decided here — flagging rather than guessing further)
1. **`http_request` SSRF exposure.** No allowlist/blocklist is built for outbound URLs in MVP, since the brief doesn't request one (see `SECURITY.md`). Worth asking the assignment-giver whether this is acceptable for the exercise's scope, or building a minimal allowlist if time permits after the Final Task passes.
2. **Aggregation choice.** The brief asks for "org-level usage this month, OR average run duration" — one is required, `org_usage_this_month` was chosen (ADR is implicit in `ARCHITECTURE.md` §10) because it directly powers the required quota indicator UI. Adding the average-run-duration view too is optional polish, not required.
3. **Exact retry delay and backoff shape** — a fixed short delay was assumed; if the LLM/HTTP provider used has stricter rate-limit behavior, this may need tuning, but isn't a design question worth resolving further in advance of actually hitting a real provider.
