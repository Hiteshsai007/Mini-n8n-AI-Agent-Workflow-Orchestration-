const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';

const ORG_A_OWNER = 'd0000000-0000-0000-0000-00000000a001';
const ORG_A_VIEWER = 'd0000000-0000-0000-0000-00000000a003';
const ORG_A_WORKFLOW = 'e0000000-0000-0000-0000-00000000a001';
const ORG_A_ORG_ID = 'a0000000-0000-0000-0000-000000000001';

async function gql(query, variables, userId, role) {
  const headers = { 'Content-Type': 'application/json', 'X-Hasura-Admin-Secret': ADMIN_SECRET };
  if (userId) { headers['X-Hasura-User-Id'] = userId; headers['X-Hasura-Role'] = role || 'owner'; }
  const res = await fetch(`${HASURA_URL}/v1/graphql`, {
    method: 'POST', headers, body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ FAIL: ${name}`); failed++; }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Slice 2 — Execution Loop & Quota Tests  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Clean up
  await gql('mutation { delete_step_runs(where: {}) { affected_rows } }');
  await gql('mutation { delete_workflow_runs(where: {}) { affected_rows } }');
  await gql(`mutation { update_organizations(where: {id: {_eq: "${ORG_A_ORG_ID}"}}, _set: {calls_used: 0, calls_allowed: 100}) { affected_rows } }`);

  // Restore http_request config
  const goodConfig = JSON.stringify({url: "http://localhost:3001/healthz", method: "GET", headers: {}});
  await gql(`mutation { update_workflow_steps(where: {workflow_id: {_eq: "${ORG_A_WORKFLOW}"}, type: {_eq: "http_request"}}, _set: {config: ${JSON.stringify(goodConfig)}}) { affected_rows } }`);

  // ── Happy Path ──
  console.log('── Executing Workflow (Happy Path) ──');
  const triggerRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: ORG_A_WORKFLOW }, ORG_A_OWNER, 'owner'
  );
  const runId = triggerRes.data?.triggerWorkflowRun?.id;
  assert(!!runId, 'triggerWorkflowRun returns a run ID');

  const runCheck = await gql(
    `query($rid: uuid!) {
      workflow_runs_by_pk(id: $rid) { status }
      step_runs(where: {workflow_run_id: {_eq: $rid}}, order_by: {started_at: asc}) {
        status attempt_count error workflow_step { type }
      }
    }`, { rid: runId }, ORG_A_OWNER, 'owner'
  );
  const wr = runCheck.data?.workflow_runs_by_pk;
  const srs = runCheck.data?.step_runs || [];

  assert(wr?.status === 'completed', 'Workflow run completes successfully');
  assert(srs.length === 3, 'All 3 step_runs were created');
  assert(srs[0]?.status === 'completed', 'llm_call step completed');
  assert(srs[0]?.attempt_count === 1, 'llm_call attempt_count = 1');
  assert(srs[1]?.status === 'completed', 'http_request step completed');

  // Check quota incremented
  const quotaCheck = await gql(`query { org_usage_this_month(where: {org_id: {_eq: "${ORG_A_ORG_ID}"}}) { calls_used } }`);
  assert(quotaCheck.data?.org_usage_this_month?.[0]?.calls_used === 1, 'Quota incremented by 1 after completed run');

  // ── AT-007: Quota enforcement ──
  console.log('\n── AT-007: Quota enforcement ──');
  await gql(`mutation { update_organizations(where: {id: {_eq: "${ORG_A_ORG_ID}"}}, _set: {calls_used: 100}) { affected_rows } }`);

  const quotaFailRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: ORG_A_WORKFLOW }, ORG_A_OWNER, 'owner'
  );
  const quotaErr = quotaFailRes.errors?.[0];
  assert(
    quotaErr?.extensions?.code === 'ORG_QUOTA_EXCEEDED' || quotaErr?.message?.includes('Quota'),
    'Fails with ORG_QUOTA_EXCEEDED when quota exhausted (AT-007)'
  );

  // ── AT-008: Retry on failure ──
  console.log('\n── AT-008: Retry on failure ──');
  await gql(`mutation { update_organizations(where: {id: {_eq: "${ORG_A_ORG_ID}"}}, _set: {calls_used: 0}) { affected_rows } }`);

  // Set http_request to a URL that will fail inside Docker
  const badConfig = JSON.stringify({url: "http://this-will-definitely-not-resolve.invalid/fail", method: "GET"});
  await gql(`mutation { update_workflow_steps(where: {workflow_id: {_eq: "${ORG_A_WORKFLOW}"}, type: {_eq: "http_request"}}, _set: {config: ${JSON.stringify(badConfig)}}) { affected_rows } }`);

  const retryRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: ORG_A_WORKFLOW }, ORG_A_OWNER, 'owner'
  );
  const retryRunId = retryRes.data?.triggerWorkflowRun?.id;
  assert(!!retryRunId, 'Triggered retry workflow run');

  const retryCheck = await gql(
    `query($rid: uuid!) {
      workflow_runs_by_pk(id: $rid) { status }
      step_runs(where: {workflow_run_id: {_eq: $rid}}, order_by: {started_at: asc}) {
        status attempt_count workflow_step { type }
      }
    }`, { rid: retryRunId }, ORG_A_OWNER, 'owner'
  );
  const retryWr = retryCheck.data?.workflow_runs_by_pk;
  const retrySrs = retryCheck.data?.step_runs || [];
  const httpStep = retrySrs.find(s => s.workflow_step?.type === 'http_request');

  assert(retryWr?.status === 'failed', 'Workflow run fails after step exhausts retries (AT-008)');
  assert(httpStep?.status === 'failed', 'HTTP step status is failed');
  assert(httpStep?.attempt_count === 2, 'HTTP step attempted exactly 2 times (1 retry) (AT-008)');

  // ── AT-010 (Layer 2): Viewer cannot trigger ──
  console.log('\n── AT-010: Viewer cannot trigger (Layer 2) ──');
  await gql(`mutation { update_organizations(where: {id: {_eq: "${ORG_A_ORG_ID}"}}, _set: {calls_used: 0}) { affected_rows } }`);
  const viewerRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: ORG_A_WORKFLOW }, ORG_A_VIEWER, 'viewer'
  );
  assert(
    viewerRes.errors?.length > 0,
    'Viewer cannot trigger a workflow run (Layer 2 FORBIDDEN_ROLE)'
  );

  // Restore
  await gql(`mutation { update_workflow_steps(where: {workflow_id: {_eq: "${ORG_A_WORKFLOW}"}, type: {_eq: "http_request"}}, _set: {config: ${JSON.stringify(goodConfig)}}) { affected_rows } }`);

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(44));
  if (failed > 0) process.exit(1);
}

main().catch(console.error);
