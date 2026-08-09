/**
 * Adds Hasura Actions to the metadata (Slice 2/3/5)
 */
const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';
const HANDLER_URL = process.env.ACTION_HANDLER_URL || 'http://host.docker.internal:3001';

async function hasuraAPI(type, args) {
  const res = await fetch(`${HASURA_URL}/v1/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasura-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ type, args }),
  });
  const data = await res.json();
  if (data.error || data.code) {
    if (data.code === 'already-exists' || data.message?.includes('already')) {
      console.log(`[skip] ${type}: already exists`);
      return;
    }
    throw new Error(JSON.stringify(data));
  }
  console.log(`✓ ${type}`);
}

async function main() {
  console.log('Adding Custom Types...');
  await hasuraAPI('set_custom_types', {
    objects: [
      { name: 'WorkflowRunOutput', fields: [{ name: 'id', type: 'uuid!' }] },
      { name: 'StepRunOutput', fields: [{ name: 'id', type: 'uuid!' }] }
    ]
  });

  console.log('Adding Actions...');
  
  // triggerWorkflowRun
  await hasuraAPI('create_action', {
    name: 'triggerWorkflowRun',
    definition: {
      handler: `${HANDLER_URL}/trigger-workflow-run`,
      output_type: 'WorkflowRunOutput',
      arguments: [{ name: 'workflow_id', type: 'uuid!' }],
      type: 'mutation',
      kind: 'synchronous',
      forward_client_headers: true // So we can re-derive identity in the handler
    }
  });

  // approveStep (Slice 3)
  await hasuraAPI('create_action', {
    name: 'approveStep',
    definition: {
      handler: `${HANDLER_URL}/approve-step`,
      output_type: 'StepRunOutput',
      arguments: [{ name: 'step_run_id', type: 'uuid!' }],
      type: 'mutation',
      kind: 'synchronous',
      forward_client_headers: true
    }
  });

  // webhookTriggerRun (Slice 5)
  await hasuraAPI('create_action', {
    name: 'webhookTriggerRun',
    definition: {
      handler: `${HANDLER_URL}/webhook-trigger-run`,
      output_type: 'WorkflowRunOutput',
      arguments: [
        { name: 'workflow_id', type: 'uuid!' },
        { name: 'secret', type: 'String!' }
      ],
      type: 'mutation',
      kind: 'synchronous',
      forward_client_headers: false // webhook is unauthenticated; relies on secret
    }
  });

  console.log('Setting Action Permissions...');
  for (const role of ['owner', 'editor']) {
    await hasuraAPI('create_action_permission', {
      action: 'triggerWorkflowRun', role
    });
    await hasuraAPI('create_action_permission', {
      action: 'approveStep', role
    });
  }
  // webhookTriggerRun is explicitly anonymous
  await hasuraAPI('create_action_permission', {
    action: 'webhookTriggerRun', role: 'anonymous'
  });
}

main().catch(console.error);
