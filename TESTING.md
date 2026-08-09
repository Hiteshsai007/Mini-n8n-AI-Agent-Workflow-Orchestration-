# Testing Strategy

## Unit tests
- Permission-matrix logic used inside the Action Handler (role × org, for every combination the six step-type/four-trigger-type restrictions touch).
- `conditional_branch` evaluator (`equals`/`contains`/`exists` against a fixture prior-step `output`, including a missing-field case).
- Quota compute-on-read logic (`ARCHITECTURE.md` §9): within period, at boundary, just past boundary.
- Retry logic (`ARCHITECTURE.md` §5 step 5d): success on first attempt, success on retry, failure on both attempts.
- Webhook secret comparison (constant-time; correct/incorrect secret).

## Integration tests
- Hasura Layer 1 permission rules: for every org-scoped table, an Org A `owner`/`editor`/`viewer` and an Org B user each attempt select/insert/update against Org A rows — verify the exact matrix in `PRD.md`/`ARCHITECTURE.md` §3.
- `triggerWorkflowRun`: happy path (all six step types present in one workflow), quota-exceeded path, non-member-caller path.
- `approveStep`: happy path, wrong-role path, step-not-paused path, cross-org path.
- `notify` Event Trigger actually fires on a `step_runs` insert of type `notify`.
- Scheduled Trigger actually invokes `triggerWorkflowRun` on schedule (can be tested with a near-term cron in a test environment).
- Database-event Trigger actually invokes `triggerWorkflowRun` when the watched table changes.

## Cross-org isolation test (mandatory — mirrors `SECURITY.md`)
This is not optional coverage — treat it as a release gate. Automate the five checks listed in `SECURITY.md` §Cross-org isolation test as their own test suite, run before every demo/submission.

## Concurrency
- Two `workflow_runs` of the same workflow started simultaneously (e.g., one manual, one via a database-event trigger firing at the same moment) — verify `step_runs` don't cross-contaminate `workflow_run_id`, and both complete independently.

## End-to-end — the Final Task, literally
Automate or manually script the six points in `PRD.md` §6 as one continuous test/demo run, exactly as it will be graded. This is the highest-priority test in this document — everything else exists to make this one reliable.

## What NOT to spend time testing (time-boxed exercise — see `PRD.md` §Non-goals)
- Load/performance testing beyond what's needed to demonstrate the live scenario smoothly.
- Exhaustive `http_request`/`llm_call` provider-specific edge cases — one real (or disclosed-stub) call path is sufficient.
- UI visual regression testing.
