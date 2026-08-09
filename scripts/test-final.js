const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';
const ACTION_URL = 'http://localhost:3001';

// Users
const A_OWNER = 'd0000000-0000-0000-0000-00000000a001';
const B_OWNER = 'd0000000-0000-0000-0000-00000000b001';
const A_ORG = 'a0000000-0000-0000-0000-000000000001';

// Artifact IDs
const WF_ID = 'e0000000-0000-0000-0000-00000000f001';

async function gql(query, variables, userId, role) {
  const headers = { 'Content-Type': 'application/json', 'X-Hasura-Admin-Secret': ADMIN_SECRET };
  if (userId) {
    headers['X-Hasura-User-Id'] = userId;
    headers['X-Hasura-Role'] = role || 'owner';
  }
  const res = await fetch(`${HASURA_URL}/v1/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  return res.json();
}

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ FAIL: ${name}`); failed++; }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Slice 5 — The Final Task (End-to-End)  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Cleanup
  await gql('mutation { delete_step_runs(where: {}) { affected_rows } delete_workflow_runs(where: {}) { affected_rows } delete_workflow_steps(where: {workflow_id: {_eq: "'+WF_ID+'"}}) { affected_rows } delete_workflow_triggers(where: {workflow_id: {_eq: "'+WF_ID+'"}}) { affected_rows } delete_workflows(where: {id: {_eq: "'+WF_ID+'"}}) { affected_rows } }');
  await gql(`mutation { update_organizations(where: {id: {_eq: "${A_ORG}"}}, _set: {calls_used: 0, calls_allowed: 100}) { affected_rows } }`);

  console.log('── Step 1 & 2: Builder (Owner creates a 4-step workflow + 2 triggers) ──');
  
  // Org A Owner builds the workflow
  const wfRes = await gql(`
    mutation {
      insert_workflows_one(object: {
        id: "${WF_ID}", org_id: "${A_ORG}", name: "Final Task Workflow", created_by: "${A_OWNER}"
      }) { id }
    }
  `, {}, A_OWNER, 'owner');
  
  assert(wfRes.data?.insert_workflows_one?.id === WF_ID, 'Owner built workflow successfully');

  const stepsRes = await gql(`
    mutation {
      insert_workflow_steps(objects: [
        { workflow_id: "${WF_ID}", order_index: 1, type: "llm_call", config: "{\\"prompt\\": \\"success\\"}" },
        { workflow_id: "${WF_ID}", order_index: 2, type: "conditional_branch", config: "{\\"field\\": \\"text\\", \\"operator\\": \\"contains\\", \\"value\\": \\"success\\", \\"on_true_step_order\\": 3, \\"on_false_step_order\\": 99}" },
        { workflow_id: "${WF_ID}", order_index: 3, type: "approval_gate", config: "{}" },
        { workflow_id: "${WF_ID}", order_index: 4, type: "http_request", config: "{\\"url\\": \\"http://localhost:3001/healthz\\", \\"method\\": \\"GET\\"}" }
      ]) { affected_rows }
    }
  `, {}, A_OWNER, 'owner');
  
  assert(stepsRes.data?.insert_workflow_steps?.affected_rows === 4, 'Owner added 4 steps');

  const triggersRes = await gql(`
    mutation {
      insert_workflow_triggers(objects: [
        { workflow_id: "${WF_ID}", type: "manual", config: "{}" },
        { workflow_id: "${WF_ID}", type: "webhook", config: "{\\"secret\\": \\"my-secret\\"}" }
      ]) { affected_rows }
    }
  `, {}, A_OWNER, 'owner');

  assert(triggersRes.data?.insert_workflow_triggers?.affected_rows === 2, 'Owner added 2 triggers');

  console.log('\n── Step 3: Trigger via Webhook ──');
  
  const whRes = await fetch(`${ACTION_URL}/webhook-trigger-run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: WF_ID, secret: "my-secret" })
  });
  const whData = await whRes.json();
  assert(whRes.ok && whData.status === 'queued', 'Workflow successfully started via Webhook');

  // Wait for it to hit the approval gate
  await new Promise(r => setTimeout(r, 4000));

  console.log('\n── Step 4 & 5: Live Status & Approval Gate ──');
  
  const statusRes = await gql(`
    query {
      workflow_runs(where: {workflow_id: {_eq: "${WF_ID}"}}, order_by: {started_at: desc}, limit: 1) {
        id status
        step_runs(order_by: {started_at: asc}) { id status workflow_step { type order_index } }
      }
    }
  `, {}, A_OWNER, 'owner');
  
  const run = statusRes.data?.workflow_runs[0];
  assert(run?.status === 'paused', 'Workflow run is in paused state');
  assert(run?.step_runs.length === 3, 'First 3 steps executed (llm_call -> branch -> approval_gate)');
  assert(run?.step_runs[2].workflow_step.type === 'approval_gate' && run?.step_runs[2].status === 'paused', 'Approval gate step is paused');

  const approvalStepRunId = run?.step_runs[2].id;

  console.log('\n── Step 6: Org B Cross-Org Isolation ──');
  
  // Org B Owner tries to see the workflow
  const bList = await gql(`query { workflows(where: {id: {_eq: "${WF_ID}"}}) { id } }`, {}, B_OWNER, 'owner');
  assert(bList.data?.workflows?.length === 0, 'Org B Owner cannot see Org A workflow');
  
  // Org B Owner tries to trigger the workflow
  const bTrigger = await gql(`mutation { triggerWorkflowRun(workflow_id: "${WF_ID}") { id } }`, {}, B_OWNER, 'owner');
  assert(bTrigger.errors?.length > 0, 'Org B Owner cannot trigger Org A workflow');
  
  // Org B Owner tries to approve the step
  const bApprove = await gql(`mutation { approveStep(step_run_id: "${approvalStepRunId}") { id } }`, {}, B_OWNER, 'owner');
  assert(bApprove.errors?.length > 0, 'Org B Owner cannot approve Org A step');

  console.log('\n── Finalizing: Org A Owner approves and finishes ──');
  const aApprove = await gql(`mutation { approveStep(step_run_id: "${approvalStepRunId}") { id } }`, {}, A_OWNER, 'owner');
  assert(aApprove.data?.approveStep?.id === approvalStepRunId, 'Org A Owner successfully approves step');

  // Wait for finish
  await new Promise(r => setTimeout(r, 2000));
  
  const finalStatus = await gql(`
    query { workflow_runs(where: {workflow_id: {_eq: "${WF_ID}"}}, order_by: {started_at: desc}, limit: 1) { status step_runs(order_by: {started_at: asc}) { status workflow_step { type } } } }
  `, {}, A_OWNER, 'owner');
  
  assert(finalStatus.data?.workflow_runs[0]?.status === 'completed', 'Workflow successfully completed after approval');
  assert(finalStatus.data?.workflow_runs[0]?.step_runs.length === 4, 'Final http_request step executed');

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`Final Task Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(44));
  if (failed > 0) process.exit(1);
}

main().catch(console.error);
