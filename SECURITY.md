# Security

## The central invariant
No operation may ever grant access to, or reveal the existence of, another organization's data — not through a role check alone, not through a client-supplied `org_id`, and not through guessing a UUID. This is graded directly (Final Task point 6) and treated here as the single most important requirement in the whole spec.

## The two permission layers, restated as rules
1. **Layer 1 (Hasura, declarative):** every org-scoped table's row permissions are expressed as a relationship traversal through `org_members` against the caller's session-derived user id (`ARCHITECTURE.md` §3). No table exposing org-scoped data may be tracked in Hasura without this relationship check in place before it's considered done.
2. **Layer 2 (Action Handler, imperative):** `approveStep`, and any operation the brief calls out as reaching outside the sandbox (creating `db_write`/`webhook`/`notify`), re-derive the caller's role from `org_members` inside the handler code — never trust a role or org_id passed as an argument or read from a JWT claim that isn't itself freshly checked against `org_members`.

## The application must NEVER
- Accept `org_id`, `user_id`, or `role` as a trusted Action argument for an authorization decision. Only opaque resource IDs (`workflow_id`, `step_run_id`) are trusted inputs; identity comes from the session, and role/org membership are re-derived from the database on every check.
- Return a different error (or a different HTTP/GraphQL status) for "resource doesn't exist" versus "resource exists but belongs to another org." Both must look identical to the caller (`API_SPEC.md` `WORKFLOW_NOT_FOUND`) — distinguishing them is an information leak that directly weakens the isolation requirement.
- Let `webhookTriggerRun`'s secret comparison happen in a way that leaks timing information (§`API_SPEC.md`).
- Log LLM/HTTP request or response bodies that may contain the trigger secret, API keys, or other credentials, in plaintext, anywhere retrievable by a lower-privileged user.
- Allow a `viewer` to trigger a run through any path, including the webhook/scheduled/database-event triggers bypassing role checks that only exist in the manual-trigger UI (the Layer 2 check in the execution flow, `ARCHITECTURE.md` §5 step 2, is the actual boundary and applies uniformly to all four trigger types — a `viewer`-authored trigger config doesn't exist as a concept since triggers are attached at workflow-build time by `owner`/`editor`, but any code path calling into the execution loop must still not skip this check).
- Store or forward secrets (webhook trigger secret, LLM/API keys) in client-visible GraphQL responses.

## Cross-org isolation test (mandatory gate, not optional — see `TESTING.md`)
Before considering this project demo-ready, run every one of these as an authenticated Org B user against a real Org A `workflow_id`/`step_run_id`:
- Query Org A's workflow directly by ID.
- Attempt to create a step/trigger on Org A's workflow.
- Attempt `triggerWorkflowRun` on Org A's workflow.
- Attempt `approveStep` on Org A's paused step.
- Subscribe to Org A's `workflow_run_id`.

All five must fail or return empty, with no distinguishing information about Org A's data.

## Other
- HTTPS only; nhost/Hasura defaults apply.
- LLM/HTTP API keys stored as nhost/Hasura secrets, never shipped to the client bundle.
- `http_request` steps can call arbitrary vendor-supplied URLs — no allowlist is built in MVP (the brief doesn't request one). This is a known, accepted risk for this exercise, not silently ignored — documented here so it isn't mistaken for an oversight (see `DECISIONS.md` open questions).
