# Roadmap — Vertical Slices

Given the time-boxed nature of this assignment, each slice should be independently demonstrable before moving to the next, so partial progress is always a working (if incomplete) system rather than several half-built pieces — consistent with the brief's own warning that the Final Task breaks visibly if any one piece is wrong.

## Slice 1 — Schema + Layer 1 isolation
- **Objective:** all seven tables tracked in Hasura, relationships wired, Layer 1 permission rules in place and provably correct.
- **Modules:** `DATA_MODEL.md` schema, Hasura metadata (permissions per `ARCHITECTURE.md` §3), `org_usage_this_month` view.
- **Dependencies:** none.
- **Acceptance criteria:** AT-001; the cross-org isolation test suite (`SECURITY.md`) passes for plain queries/mutations (Actions come in later slices).
- **Tests:** the Hasura permission-matrix integration tests in `TESTING.md`.
- **Expected output:** in the Hasura console (or via a GraphQL client) logged in as different test users, org-scoped queries return exactly the correct rows for each role/org combination.
- **What NOT to build yet:** Actions, the execution loop, any frontend.

## Slice 2 — Execution loop: llm_call, http_request, db_write, retry, quota
- **Objective:** `triggerWorkflowRun` works end-to-end for the three "plain" step types with correct retry and quota behavior.
- **Modules:** Action Handler core (`ARCHITECTURE.md` §5), step executors for `llm_call`/`http_request`/`db_write`, quota logic (§9).
- **Dependencies:** Slice 1.
- **Acceptance criteria:** AT-007, AT-008.
- **Tests:** unit tests for retry/quota logic; integration test invoking the Action directly (no frontend needed).
- **Expected output:** calling `triggerWorkflowRun` against a fixture workflow produces a completed `workflow_run` with correct `step_runs`, and quota increments by exactly 1.
- **What NOT to build yet:** `conditional_branch`, `approval_gate`, `notify`, subscriptions, frontend, non-manual triggers.

## Slice 3 — Branching and approval
- **Objective:** `conditional_branch` and `approval_gate` work, including `approveStep`'s Layer 2 check.
- **Modules:** `conditional_branch` evaluator (§6, ADR-003), pause/resume logic (§5 step 5e, §8), `approveStep` Action.
- **Dependencies:** Slice 2.
- **Acceptance criteria:** AT-002, AT-004, AT-011.
- **Tests:** the evaluator unit tests; `approveStep` integration tests (happy path, wrong role, wrong status, cross-org).
- **Expected output:** a fixture workflow with an `approval_gate` pauses correctly and only resumes after a correctly-authorized `approveStep` call; a fixture workflow with `conditional_branch` follows the correct path for both outcomes.
- **What NOT to build yet:** `notify`, subscriptions, frontend, non-manual triggers.

## Slice 4 — Live subscriptions + minimal frontend
- **Objective:** a usable UI for one organization: auth, workflow builder, manual run, live status, approve UI, quota indicator.
- **Modules:** all frontend screens in `UX_SPEC.md`, the `step_runs` subscription (`API_SPEC.md`).
- **Dependencies:** Slices 1–3.
- **Acceptance criteria:** AT-005, AT-010.
- **Tests:** manual verification of live updates without refresh; role-visibility checks (Run button hidden for viewer, restricted step types hidden for non-owner).
- **Expected output:** a working single-org demo of build → run → watch live → (if applicable) approve.
- **What NOT to build yet:** webhook/scheduled/database-event triggers, the `notify` Event Trigger, the second organization.

## Slice 5 — Remaining triggers, notify, and the full Final Task
- **Objective:** webhook/scheduled/database-event triggers wired, `notify` dispatched via Event Trigger, and the complete two-org Final Task scenario demonstrable live.
- **Modules:** trigger wiring (`ARCHITECTURE.md` §11), `notify` Event Trigger (§7), second organization + users for the demo.
- **Dependencies:** Slices 1–4.
- **Acceptance criteria:** AT-003, AT-006, AT-009 — and the full Final Task in `PRD.md` §6 end to end.
- **Tests:** the complete cross-org isolation suite; the end-to-end Final Task script in `TESTING.md`.
- **Expected output:** the exact six-point scenario, live, matching the brief's grading bar.
- **What NOT to build yet:** nothing further is in scope — see `PRD.md` §Non-goals for what stays out permanently.

## After the Final Task passes
Time-box remaining effort to: README setup instructions, the ~1 page write-up (schema reasoning, how the two layers differ, approval-gate pause/resume mechanics), and a recording of the scenario — all required deliverables, none of which are code.
