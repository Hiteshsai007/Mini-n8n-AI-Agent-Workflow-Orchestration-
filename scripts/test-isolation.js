/**
 * Cross-org isolation test suite (SECURITY.md / TESTING.md)
 * Mandatory gate — not optional coverage.
 * 
 * Tests that an Org B user cannot access Org A data through any path.
 */

const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';

// Test user IDs from seed data
const ORG_A_OWNER = 'd0000000-0000-0000-0000-00000000a001';
const ORG_B_OWNER = 'd0000000-0000-0000-0000-00000000b001';
const ORG_A_VIEWER = 'd0000000-0000-0000-0000-00000000a003';

// Test resource IDs from seed data
const ORG_A_WORKFLOW = 'e0000000-0000-0000-0000-00000000a001';
const ORG_A_ORG_ID = 'a0000000-0000-0000-0000-000000000001';

async function gql(query, variables, userId, role) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Hasura-Admin-Secret': ADMIN_SECRET,
  };
  if (userId) {
    headers['X-Hasura-User-Id'] = userId;
    headers['X-Hasura-Role'] = role || 'owner';
  }
  const res = await fetch(`${HASURA_URL}/v1/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    failed++;
  }
}

async function testOrgAOwnerCanSeeOwnWorkflows() {
  const r = await gql(
    `query { workflows { id name org_id } }`,
    {}, ORG_A_OWNER, 'owner'
  );
  const wfs = r.data?.workflows || [];
  assert(wfs.length > 0, 'Org A owner sees their own workflows');
  assert(wfs.every(w => w.org_id === ORG_A_ORG_ID), 'All returned workflows belong to Org A');
}

async function testOrgBCannotSeeOrgAWorkflows() {
  // Test 1: Query all workflows — Org B user should NOT see Org A's
  const r = await gql(
    `query { workflows { id name } }`,
    {}, ORG_B_OWNER, 'owner'
  );
  const wfs = r.data?.workflows || [];
  const leakedA = wfs.filter(w => w.id.includes('a00'));
  assert(leakedA.length === 0, 'Org B owner does NOT see Org A workflows in list');
}

async function testOrgBCannotQueryOrgAWorkflowById() {
  // Test 2: Direct ID guess
  const r = await gql(
    `query($id: uuid!) { workflows(where: {id: {_eq: $id}}) { id name } }`,
    { id: ORG_A_WORKFLOW }, ORG_B_OWNER, 'owner'
  );
  const wfs = r.data?.workflows || [];
  assert(wfs.length === 0, 'Org B owner cannot query Org A workflow by ID (returns empty)');
}

async function testOrgBCannotInsertStepOnOrgAWorkflow() {
  const r = await gql(
    `mutation($wid: uuid!) {
      insert_workflow_steps_one(object: {
        workflow_id: $wid, order_index: 99, type: llm_call, config: "{}"
      }) { id }
    }`,
    { wid: ORG_A_WORKFLOW }, ORG_B_OWNER, 'owner'
  );
  const hasError = !r.data?.insert_workflow_steps_one;
  assert(hasError, 'Org B owner cannot insert step on Org A workflow');
}

async function testOrgBCannotCreateTriggerOnOrgAWorkflow() {
  const r = await gql(
    `mutation($wid: uuid!) {
      insert_workflow_triggers_one(object: {
        workflow_id: $wid, type: manual, config: "{}"
      }) { id }
    }`,
    { wid: ORG_A_WORKFLOW }, ORG_B_OWNER, 'owner'
  );
  const hasError = !r.data?.insert_workflow_triggers_one;
  assert(hasError, 'Org B owner cannot create trigger on Org A workflow');
}

async function testViewerCanSeeOrgWorkflows() {
  const r = await gql(
    `query { workflows { id name } }`,
    {}, ORG_A_VIEWER, 'viewer'
  );
  const wfs = r.data?.workflows || [];
  assert(wfs.length > 0, 'Org A viewer CAN see Org A workflows (read-only)');
}

async function testOrgBCannotSeeOrgAOrg() {
  const r = await gql(
    `query($id: uuid!) { organizations(where: {id: {_eq: $id}}) { id name } }`,
    { id: ORG_A_ORG_ID }, ORG_B_OWNER, 'owner'
  );
  const orgs = r.data?.organizations || [];
  assert(orgs.length === 0, 'Org B owner cannot see Org A organization by ID');
}

async function testOrgBCannotSeeOrgAMembers() {
  const r = await gql(
    `query { org_members { id user_id org_id role } }`,
    {}, ORG_B_OWNER, 'owner'
  );
  const members = r.data?.org_members || [];
  const leakedA = members.filter(m => m.org_id === ORG_A_ORG_ID);
  assert(leakedA.length === 0, 'Org B owner cannot see Org A members');
}

async function testEditorCannotInsertDbWriteStep() {
  // AT-011: editor cannot add db_write step
  const ORG_A_EDITOR = 'u0000000-0000-0000-0000-00000000a002';
  const r = await gql(
    `mutation($wid: uuid!) {
      insert_workflow_steps_one(object: {
        workflow_id: $wid, order_index: 98, type: db_write, config: "{}"
      }) { id }
    }`,
    { wid: ORG_A_WORKFLOW }, ORG_A_EDITOR, 'editor'
  );
  const hasError = !r.data?.insert_workflow_steps_one;
  assert(hasError, 'Editor cannot insert db_write step (AT-011)');
}

async function testEditorCannotInsertNotifyStep() {
  const ORG_A_EDITOR = 'u0000000-0000-0000-0000-00000000a002';
  const r = await gql(
    `mutation($wid: uuid!) {
      insert_workflow_steps_one(object: {
        workflow_id: $wid, order_index: 97, type: notify, config: "{}"
      }) { id }
    }`,
    { wid: ORG_A_WORKFLOW }, ORG_A_EDITOR, 'editor'
  );
  const hasError = !r.data?.insert_workflow_steps_one;
  assert(hasError, 'Editor cannot insert notify step (AT-011)');
}

async function testEditorCannotInsertWebhookTrigger() {
  const ORG_A_EDITOR = 'u0000000-0000-0000-0000-00000000a002';
  const r = await gql(
    `mutation($wid: uuid!) {
      insert_workflow_triggers_one(object: {
        workflow_id: $wid, type: webhook, config: "{}"
      }) { id }
    }`,
    { wid: ORG_A_WORKFLOW }, ORG_A_EDITOR, 'editor'
  );
  const hasError = !r.data?.insert_workflow_triggers_one;
  assert(hasError, 'Editor cannot insert webhook trigger (AT-011)');
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Cross-Org Isolation Test Suite          ║');
  console.log('║  (SECURITY.md / TESTING.md — mandatory) ║');
  console.log('╚══════════════════════════════════════════╝\n');

  console.log('── AT-001: Two independent organizations ──');
  await testOrgAOwnerCanSeeOwnWorkflows();
  await testOrgBCannotSeeOrgAWorkflows();

  console.log('\n── AT-006: Cross-org denial (direct ID guessing) ──');
  await testOrgBCannotQueryOrgAWorkflowById();
  await testOrgBCannotInsertStepOnOrgAWorkflow();
  await testOrgBCannotCreateTriggerOnOrgAWorkflow();
  await testOrgBCannotSeeOrgAOrg();
  await testOrgBCannotSeeOrgAMembers();

  console.log('\n── AT-010: Viewer read-only access ──');
  await testViewerCanSeeOrgWorkflows();

  console.log('\n── AT-011: Step-creation restriction ──');
  await testEditorCannotInsertDbWriteStep();
  await testEditorCannotInsertNotifyStep();
  await testEditorCannotInsertWebhookTrigger();

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(44));

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
