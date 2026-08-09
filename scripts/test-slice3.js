const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';

const ORG_A_OWNER = 'd0000000-0000-0000-0000-00000000a001';
const ORG_A_VIEWER = 'd0000000-0000-0000-0000-00000000a003';
const ORG_A_ORG_ID = 'a0000000-0000-0000-0000-000000000001';

const WF_BRANCH = 'e0000000-0000-0000-0000-00000000a002'; // New workflow for branching
const WF_APPROVAL = 'e0000000-0000-0000-0000-00000000a003'; // New workflow for approval

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

async function setupTestData() {
  // Delete old runs and test workflows to have a clean slate
  await gql('mutation { delete_step_runs(where: {}) { affected_rows } }');
  await gql('mutation { delete_workflow_runs(where: {}) { affected_rows } }');
  await gql(`mutation { delete_workflow_steps(where: {workflow_id: {_in: ["${WF_BRANCH}", "${WF_APPROVAL}"]}}) { affected_rows } }`);
  await gql(`mutation { delete_workflows(where: {id: {_in: ["${WF_BRANCH}", "${WF_APPROVAL}"]}}) { affected_rows } }`);

  // We need to insert a branching workflow
  const branchWf = `
    mutation {
      insert_workflows_one(object: {
        id: "${WF_BRANCH}",
        org_id: "${ORG_A_ORG_ID}",
        name: "Branching Workflow",
        created_by: "${ORG_A_OWNER}",
        workflow_steps: {
          data: [
            { id: "f0000000-0000-0000-0000-00000000b001", order_index: 1, type: "llm_call", config: "{\\"prompt\\": \\"success\\"}" },
            { id: "f0000000-0000-0000-0000-00000000b002", order_index: 2, type: "conditional_branch", config: "{\\"field\\": \\"text\\", \\"operator\\": \\"contains\\", \\"value\\": \\"success\\", \\"on_true_step_order\\": 3, \\"on_false_step_order\\": 99}" },
            { id: "f0000000-0000-0000-0000-00000000b003", order_index: 3, type: "notify", config: "{}" }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [] }) { id }
    }
  `;
  await gql(branchWf);

  // We need to insert an approval workflow
  const approvalWf = `
    mutation {
      insert_workflows_one(object: {
        id: "${WF_APPROVAL}",
        org_id: "${ORG_A_ORG_ID}",
        name: "Approval Workflow",
        created_by: "${ORG_A_OWNER}",
        workflow_steps: {
          data: [
            { id: "f0000000-0000-0000-0000-00000000c001", order_index: 1, type: "llm_call", config: "{}" },
            { id: "f0000000-0000-0000-0000-00000000c002", order_index: 2, type: "approval_gate", config: "{}" },
            { id: "f0000000-0000-0000-0000-00000000c003", order_index: 3, type: "notify", config: "{}" }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [] }) { id }
    }
  `;
  await gql(approvalWf);
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Slice 3 — Branching & Wait States Tests ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await setupTestData();
  await gql(`mutation { update_organizations(where: {id: {_eq: "${ORG_A_ORG_ID}"}}, _set: {calls_used: 0, calls_allowed: 100}) { affected_rows } }`);

  // ── AT-004: Branch routing ──
  console.log('── AT-004: Branch routing ──');
  // Trigger branch workflow. llm_call returns "Stubbed response for prompt: success", which contains "success". 
  // It should route to step 3 (notify) and skip step 4.
  const branchRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: WF_BRANCH }, ORG_A_OWNER, 'owner'
  );
  
  const branchRunId = branchRes.data?.triggerWorkflowRun?.id;
  assert(!!branchRunId, 'Triggered branch workflow');

  const branchCheck = await gql(
    `query($rid: uuid!) {
      workflow_runs_by_pk(id: $rid) { status }
      step_runs(where: {workflow_run_id: {_eq: $rid}}, order_by: {started_at: asc}) {
        status workflow_step { type order_index }
      }
    }`, { rid: branchRunId }, ORG_A_OWNER, 'owner'
  );
  
  const b_srs = branchCheck.data?.step_runs || [];
  assert(branchCheck.data?.workflow_runs_by_pk?.status === 'completed', 'Branch workflow completed');
  assert(b_srs.length === 3, 'Executed exactly 3 steps (skipped the false branch)');
  assert(b_srs[2]?.workflow_step?.type === 'notify', 'True branch (notify) was executed');

  // ── AT-003: Approval Gate stops execution ──
  console.log('\n── AT-003: Approval Gate stops execution ──');
  const approvalRes = await gql(
    'mutation($wid: uuid!) { triggerWorkflowRun(workflow_id: $wid) { id } }',
    { wid: WF_APPROVAL }, ORG_A_OWNER, 'owner'
  );

  const approvalRunId = approvalRes.data?.triggerWorkflowRun?.id;
  assert(!!approvalRunId, 'Triggered approval workflow');

  const approvalCheck = await gql(
    `query($rid: uuid!) {
      workflow_runs_by_pk(id: $rid) { status }
      step_runs(where: {workflow_run_id: {_eq: $rid}}, order_by: {started_at: asc}) {
        id status workflow_step { type order_index }
      }
    }`, { rid: approvalRunId }, ORG_A_OWNER, 'owner'
  );

  const a_wr = approvalCheck.data?.workflow_runs_by_pk;
  const a_srs = approvalCheck.data?.step_runs || [];
  
  assert(a_wr?.status === 'paused', 'Workflow run is paused at approval gate');
  assert(a_srs.length === 2, 'Execution stopped at step 2');
  assert(a_srs[1]?.status === 'paused', 'Approval gate step_run is paused');

  const approvalStepRunId = a_srs[1]?.id;

  // ── AT-010: Viewer cannot approve ──
  console.log('\n── AT-010: Viewer cannot approve (Layer 2) ──');
  const viewerApproveRes = await gql(
    'mutation($srid: uuid!) { approveStep(step_run_id: $srid) { id } }',
    { srid: approvalStepRunId }, ORG_A_VIEWER, 'viewer'
  );
  assert(viewerApproveRes.errors?.length > 0, 'Viewer cannot approve a step (Layer 2 FORBIDDEN_ROLE)');

  // ── AT-009: Resume execution on approval ──
  console.log('\n── AT-009: Resume execution on approval ──');
  const ownerApproveRes = await gql(
    'mutation($srid: uuid!) { approveStep(step_run_id: $srid) { id } }',
    { srid: approvalStepRunId }, ORG_A_OWNER, 'owner'
  );
  
  assert(!ownerApproveRes.errors && ownerApproveRes.data?.approveStep?.id === approvalStepRunId, 'Owner successfully approved the step');

  const resumeCheck = await gql(
    `query($rid: uuid!) {
      workflow_runs_by_pk(id: $rid) { status }
      step_runs(where: {workflow_run_id: {_eq: $rid}}, order_by: {started_at: asc}) {
        id status workflow_step { type order_index }
      }
    }`, { rid: approvalRunId }, ORG_A_OWNER, 'owner'
  );

  const r_wr = resumeCheck.data?.workflow_runs_by_pk;
  const r_srs = resumeCheck.data?.step_runs || [];

  assert(r_wr?.status === 'completed', 'Workflow resumed and completed');
  assert(r_srs.length === 3, 'Workflow executed the final step after approval');
  assert(r_srs[1]?.status === 'completed', 'Approval gate step_run is marked completed');
  assert(r_srs[2]?.workflow_step?.type === 'notify', 'Post-approval step (notify) executed');

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(44));
  if (failed > 0) process.exit(1);
}

main().catch(console.error);
