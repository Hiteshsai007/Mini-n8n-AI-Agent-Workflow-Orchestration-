# Acceptance Tests

These map directly to the Final Task in `PRD.md` §6, plus supporting tests for behavior the Final Task depends on but doesn't spell out step-by-step.

## AT-001 Two independent organizations
Given Org A and Org B exist with their own users and `org_members` rows
When any user queries `OrgWorkflows` for their own org
Then they see only their own org's workflows, never the other's.

## AT-002 Multi-step workflow with a data-driven branch
Given an Org A `owner` builds a workflow with at least an `llm_call`, an `http_request`, and a `conditional_branch` step
When the workflow runs and the `llm_call` output satisfies the branch's condition
Then execution follows the `on_true_step_order` path; when it doesn't, it follows `on_false_step_order`.

## AT-003 Two trigger paths for the same workflow
Given a workflow has a `manual` trigger available and one additional trigger (`webhook` or `database_event`) configured
When the workflow is started via the Run button, and separately via the second trigger
Then both produce a new `workflow_run` through the identical execution flow (`ARCHITECTURE.md` §5).

## AT-004 Approval gate pause and resume
Given a workflow includes an `approval_gate` step
When the run reaches that step
Then `workflow_run.status` and the relevant `step_run.status` become `paused`, and execution does not proceed until `approveStep` is called by an `owner`/`editor` of that org.

## AT-005 Live streaming with no refresh
Given a run is in progress
When step statuses change, including entering `paused`
Then the frontend's subscribed view updates without a page reload.

## AT-006 Cross-org denial, including direct ID guessing
Given an authenticated Org B user and a known Org A `workflow_id`/`step_run_id`
When they attempt to query, trigger, or approve using that ID directly
Then every attempt fails or returns empty, per `SECURITY.md` §Cross-org isolation test.

## AT-007 Quota enforcement
Given an org's `calls_used` equals `calls_allowed` for the current period
When `triggerWorkflowRun` is called
Then it fails with `ORG_QUOTA_EXCEEDED` and no `workflow_run` is created.

## AT-008 Retry on failure
Given an `http_request` step's first attempt fails
When the execution loop retries per `ARCHITECTURE.md` §5 step 5d
Then `attempt_count` reflects two attempts, and the step's final status reflects the retry's outcome.

## AT-009 Notify via Event Trigger
Given a workflow includes a `notify` step
When the execution loop creates that step's `step_run` row
Then a Hasura Event Trigger fires (independent of the Action Handler's own code path) and dispatches the notification.

## AT-010 Viewer cannot trigger
Given an Org A `viewer`
When they attempt to call `triggerWorkflowRun` on an Org A workflow
Then the call is refused (Layer 2 role check), and the Run button is not shown to them in the UI.

## AT-011 Step-creation restriction enforced server-side
Given an Org A `editor` (not `owner`)
When they attempt to add a `db_write`, `webhook` trigger, or `notify` step to a workflow
Then the mutation is refused, regardless of what the frontend does or doesn't show them.
