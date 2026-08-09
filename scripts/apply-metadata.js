/**
 * Hasura Metadata Setup Script
 * Applies table tracking, relationships, and Layer 1 permissions via Hasura Metadata API.
 * 
 * Layer 1 = relationship-based row permissions through org_members (ADR-004).
 * Every org-scoped table's permission traverses org_members filtered on X-Hasura-User-Id.
 */

const HASURA_URL = process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080';
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'myadminsecret';
const SOURCE = 'default';

async function hasuraAPI(type, args) {
  const res = await fetch(`${HASURA_URL}/v1/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hasura-Admin-Secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ type, args }),
  });
  const data = await res.json();
  if (data.error || data.code) {
    // Ignore "already tracked" / "already exists" errors
    const msg = data.error || data.message || '';
    if (msg.includes('already tracked') || msg.includes('already exists') || 
        msg.includes('already-exists') || msg.includes('already_exists') ||
        (data.code === 'already-exists') || (data.code === 'already-tracked')) {
      console.log(`  [skip] ${type}: ${msg}`);
      return data;
    }
    console.error(`  [ERROR] ${type}:`, JSON.stringify(data));
    // Don't throw — continue applying remaining metadata
  }
  return data;
}

async function waitForHasura(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${HASURA_URL}/healthz`);
      if (res.ok) {
        console.log('✓ Hasura is ready');
        return;
      }
    } catch (e) {
      // not ready yet
    }
    console.log(`  Waiting for Hasura... (${i + 1}/${maxRetries})`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Hasura did not become ready');
}

// ─── Table tracking ─────────────────────────────────────────
const TABLES = [
  'organizations', 'org_members', 'workflows', 'workflow_steps',
  'workflow_triggers', 'workflow_runs', 'step_runs',
];
const VIEWS = ['org_usage_this_month'];

async function trackTables() {
  console.log('\n── Tracking tables ──');
  for (const table of [...TABLES, ...VIEWS]) {
    console.log(`  Tracking: ${table}`);
    await hasuraAPI('pg_track_table', {
      source: SOURCE,
      table: { schema: 'public', name: table },
    });
  }
}

// ─── Relationships ──────────────────────────────────────────
async function createRelationships() {
  console.log('\n── Creating relationships ──');

  const rels = [
    // organizations ↔ org_members
    { table: 'organizations', name: 'org_members', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'org_members' }, column: 'org_id' } } },
    { table: 'org_members', name: 'organization', type: 'object',
      using: { foreign_key_constraint_on: 'org_id' } },

    // organizations ↔ workflows
    { table: 'organizations', name: 'workflows', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'workflows' }, column: 'org_id' } } },
    { table: 'workflows', name: 'organization', type: 'object',
      using: { foreign_key_constraint_on: 'org_id' } },

    // workflows ↔ workflow_steps
    { table: 'workflows', name: 'workflow_steps', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'workflow_steps' }, column: 'workflow_id' } } },
    { table: 'workflow_steps', name: 'workflow', type: 'object',
      using: { foreign_key_constraint_on: 'workflow_id' } },

    // workflows ↔ workflow_triggers
    { table: 'workflows', name: 'workflow_triggers', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'workflow_triggers' }, column: 'workflow_id' } } },
    { table: 'workflow_triggers', name: 'workflow', type: 'object',
      using: { foreign_key_constraint_on: 'workflow_id' } },

    // workflows ↔ workflow_runs
    { table: 'workflows', name: 'workflow_runs', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'workflow_runs' }, column: 'workflow_id' } } },
    { table: 'workflow_runs', name: 'workflow', type: 'object',
      using: { foreign_key_constraint_on: 'workflow_id' } },

    // workflow_runs ↔ step_runs
    { table: 'workflow_runs', name: 'step_runs', type: 'array',
      using: { foreign_key_constraint_on: { table: { schema: 'public', name: 'step_runs' }, column: 'workflow_run_id' } } },
    { table: 'step_runs', name: 'workflow_run', type: 'object',
      using: { foreign_key_constraint_on: 'workflow_run_id' } },

    // step_runs → workflow_steps
    { table: 'step_runs', name: 'workflow_step', type: 'object',
      using: { foreign_key_constraint_on: 'workflow_step_id' } },

    // org_usage_this_month (view) → organizations (manual relationship)
    { table: 'org_usage_this_month', name: 'organization', type: 'object',
      using: { manual_configuration: {
        remote_table: { schema: 'public', name: 'organizations' },
        column_mapping: { org_id: 'id' },
      } } },
  ];

  for (const rel of rels) {
    const apiType = rel.type === 'array' ? 'pg_create_array_relationship' : 'pg_create_object_relationship';
    console.log(`  ${rel.type}: ${rel.table}.${rel.name}`);
    await hasuraAPI(apiType, {
      source: SOURCE,
      table: { schema: 'public', name: rel.table },
      name: rel.name,
      using: rel.using,
    });
  }
}

// ─── Layer 1 Permissions (ADR-004) ──────────────────────────
// Every org-scoped table uses relationship traversal through org_members
// filtered on {user_id: {_eq: X-Hasura-User-Id}} for its permission filter.

// Helper: builds the org_members existence check via relationship traversal
function orgMemberFilter(path = []) {
  // path = chain of relationship names from the current table to organizations
  // Final check: organizations.org_members.user_id = X-Hasura-User-Id
  let filter = { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } };
  for (let i = path.length - 1; i >= 0; i--) {
    filter = { [path[i]]: filter };
  }
  return filter;
}

// Like orgMemberFilter but also requires a specific role
function orgMemberRoleFilter(path, roles) {
  let filter = {
    org_members: {
      user_id: { _eq: 'X-Hasura-User-Id' },
      role: { _in: roles },
    },
  };
  for (let i = path.length - 1; i >= 0; i--) {
    filter = { [path[i]]: filter };
  }
  return filter;
}

const ALL_ORG_COLS   = ['id', 'name', 'calls_used', 'calls_allowed', 'quota_period_start', 'created_at'];
const ALL_MEMBER_COLS = ['id', 'user_id', 'org_id', 'role', 'created_at'];
const ALL_WF_COLS    = ['id', 'org_id', 'name', 'created_by', 'created_at', 'updated_at'];
const ALL_STEP_COLS  = ['id', 'workflow_id', 'order_index', 'type', 'config', 'created_at'];
const ALL_TRIG_COLS  = ['id', 'workflow_id', 'type', 'config', 'created_at'];
const ALL_RUN_COLS   = ['id', 'workflow_id', 'status', 'triggered_by', 'started_at', 'completed_at'];
const ALL_SRUN_COLS  = ['id', 'workflow_run_id', 'workflow_step_id', 'status', 'input', 'output', 'error', 'attempt_count', 'approved_by', 'approved_at', 'started_at', 'completed_at'];
const ALL_USAGE_COLS = ['org_id', 'calls_used', 'calls_allowed', 'quota_period_start'];

async function applyPermissions() {
  console.log('\n── Applying Layer 1 permissions ──');

  const permissions = [];

  // ─── ROLES: owner, editor, viewer ───
  const roles = ['owner', 'editor', 'viewer'];

  // ── organizations ──
  // All roles can SELECT their own orgs (via org_members relationship)
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'organizations',
      role,
      filter: orgMemberFilter([]),
      columns: ALL_ORG_COLS,
      allow_aggregations: role === 'owner',
    });
  }
  // owner can UPDATE their org (e.g., quota fields updated by action handler via admin)
  permissions.push({
    type: 'pg_create_update_permission',
    table: 'organizations',
    role: 'owner',
    filter: orgMemberRoleFilter([], ['owner']),
    columns: ['name', 'calls_used', 'calls_allowed', 'quota_period_start'],
  });

  // ── org_members ──
  // All roles can see members of orgs they belong to
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'org_members',
      role,
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ALL_MEMBER_COLS,
    });
  }
  // owner can INSERT/UPDATE/DELETE org_members in their org
  permissions.push({
    type: 'pg_create_insert_permission',
    table: 'org_members',
    role: 'owner',
    check: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' }, role: { _eq: 'owner' } } } },
    columns: ALL_MEMBER_COLS,
  });
  permissions.push({
    type: 'pg_create_update_permission',
    table: 'org_members',
    role: 'owner',
    filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' }, role: { _eq: 'owner' } } } },
    columns: ['role'],
  });
  permissions.push({
    type: 'pg_create_delete_permission',
    table: 'org_members',
    role: 'owner',
    filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' }, role: { _eq: 'owner' } } } },
  });

  // ── workflows ──
  // All roles can SELECT their org's workflows
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'workflows',
      role,
      filter: orgMemberFilter(['organization']),
      columns: ALL_WF_COLS,
    });
  }
  // owner + editor can INSERT workflows
  for (const role of ['owner', 'editor']) {
    permissions.push({
      type: 'pg_create_insert_permission',
      table: 'workflows',
      role,
      check: orgMemberRoleFilter(['organization'], ['owner', 'editor']),
      columns: ['id', 'org_id', 'name', 'created_by'],
      set: {},  // created_at/updated_at have defaults
    });
  }
  // owner + editor can UPDATE workflows
  for (const role of ['owner', 'editor']) {
    permissions.push({
      type: 'pg_create_update_permission',
      table: 'workflows',
      role,
      filter: orgMemberRoleFilter(['organization'], ['owner', 'editor']),
      columns: ['name', 'updated_at'],
    });
  }
  // owner can DELETE workflows
  permissions.push({
    type: 'pg_create_delete_permission',
    table: 'workflows',
    role: 'owner',
    filter: orgMemberRoleFilter(['organization'], ['owner']),
  });

  // ── workflow_steps ──
  // All roles can SELECT steps of their org's workflows
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'workflow_steps',
      role,
      filter: orgMemberFilter(['workflow', 'organization']),
      columns: ALL_STEP_COLS,
    });
  }
  // owner can INSERT any step type
  permissions.push({
    type: 'pg_create_insert_permission',
    table: 'workflow_steps',
    role: 'owner',
    check: orgMemberRoleFilter(['workflow', 'organization'], ['owner']),
    columns: ['id', 'workflow_id', 'order_index', 'type', 'config'],
  });
  // editor can INSERT steps EXCEPT db_write and notify (AT-011, ARCHITECTURE.md §4)
  permissions.push({
    type: 'pg_create_insert_permission',
    table: 'workflow_steps',
    role: 'editor',
    check: {
      _and: [
        orgMemberRoleFilter(['workflow', 'organization'], ['editor', 'owner']),
        { type: { _nin: ['db_write', 'notify'] } },
      ],
    },
    columns: ['id', 'workflow_id', 'order_index', 'type', 'config'],
  });
  // owner + editor can UPDATE steps (owner: any, editor: not db_write/notify)
  permissions.push({
    type: 'pg_create_update_permission',
    table: 'workflow_steps',
    role: 'owner',
    filter: orgMemberRoleFilter(['workflow', 'organization'], ['owner']),
    columns: ['order_index', 'type', 'config'],
  });
  permissions.push({
    type: 'pg_create_update_permission',
    table: 'workflow_steps',
    role: 'editor',
    filter: {
      _and: [
        orgMemberRoleFilter(['workflow', 'organization'], ['editor', 'owner']),
        { type: { _nin: ['db_write', 'notify'] } },
      ],
    },
    columns: ['order_index', 'type', 'config'],
  });
  // owner can DELETE steps
  permissions.push({
    type: 'pg_create_delete_permission',
    table: 'workflow_steps',
    role: 'owner',
    filter: orgMemberRoleFilter(['workflow', 'organization'], ['owner']),
  });
  permissions.push({
    type: 'pg_create_delete_permission',
    table: 'workflow_steps',
    role: 'editor',
    filter: orgMemberRoleFilter(['workflow', 'organization'], ['editor', 'owner']),
  });

  // ── workflow_triggers ──
  // All roles can SELECT triggers
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'workflow_triggers',
      role,
      filter: orgMemberFilter(['workflow', 'organization']),
      columns: ALL_TRIG_COLS,
    });
  }
  // owner can INSERT any trigger type
  permissions.push({
    type: 'pg_create_insert_permission',
    table: 'workflow_triggers',
    role: 'owner',
    check: orgMemberRoleFilter(['workflow', 'organization'], ['owner']),
    columns: ['id', 'workflow_id', 'type', 'config'],
  });
  // editor can INSERT triggers EXCEPT webhook (ARCHITECTURE.md §4)
  permissions.push({
    type: 'pg_create_insert_permission',
    table: 'workflow_triggers',
    role: 'editor',
    check: {
      _and: [
        orgMemberRoleFilter(['workflow', 'organization'], ['editor', 'owner']),
        { type: { _nin: ['webhook'] } },
      ],
    },
    columns: ['id', 'workflow_id', 'type', 'config'],
  });
  // owner + editor can DELETE triggers
  for (const role of ['owner', 'editor']) {
    permissions.push({
      type: 'pg_create_delete_permission',
      table: 'workflow_triggers',
      role,
      filter: orgMemberRoleFilter(['workflow', 'organization'], [role === 'owner' ? 'owner' : 'editor', 'owner']),
    });
  }

  // ── workflow_runs ──
  // All roles can SELECT runs in their org
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'workflow_runs',
      role,
      filter: orgMemberFilter(['workflow', 'organization']),
      columns: ALL_RUN_COLS,
    });
  }
  // Insert/update on workflow_runs is done by the action handler via admin secret,
  // not by end users directly — so no user-role insert permission needed.

  // ── step_runs ──
  // All roles can SELECT step_runs for runs in their org
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'step_runs',
      role,
      filter: orgMemberFilter(['workflow_run', 'workflow', 'organization']),
      columns: ALL_SRUN_COLS,
    });
  }
  // Insert/update on step_runs is done by the action handler via admin secret.

  // ── org_usage_this_month (view) ──
  for (const role of roles) {
    permissions.push({
      type: 'pg_create_select_permission',
      table: 'org_usage_this_month',
      role,
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ALL_USAGE_COLS,
    });
  }

  // Apply all permissions
  for (const perm of permissions) {
    const { type, table, role, ...rest } = perm;
    console.log(`  ${type}: ${table} [${role}]`);
    
    const args = {
      source: SOURCE,
      table: { schema: 'public', name: table },
      role,
    };

    if (type.includes('select')) {
      args.permission = {
        filter: rest.filter,
        columns: rest.columns,
        allow_aggregations: rest.allow_aggregations || false,
      };
    } else if (type.includes('insert')) {
      args.permission = {
        check: rest.check,
        columns: rest.columns,
      };
      if (rest.set) args.permission.set = rest.set;
    } else if (type.includes('update')) {
      args.permission = {
        filter: rest.filter,
        columns: rest.columns,
      };
    } else if (type.includes('delete')) {
      args.permission = {
        filter: rest.filter,
      };
    }

    await hasuraAPI(type, args);
  }
}

async function createEventTrigger() {
  const eventTriggerRes = await fetch(`${HASURA_URL}/v1/metadata`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hasura-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({
      type: 'pg_create_event_trigger',
      args: {
        name: 'notify_step_trigger',
        source: 'default',
        table: { schema: 'public', name: 'step_runs' },
        webhook: '{{ACTION_HANDLER_URL}}/event-notify',
        insert: { columns: '*' },
        update: { columns: ['status'] },
        retry_conf: { num_retries: 0, interval_sec: 10, timeout_sec: 60 },
        headers: [{ name: 'X-Hasura-Admin-Secret', value: ADMIN_SECRET }]
      }
    })
  });
  const data = await eventTriggerRes.json();
  if (data.error && data.error !== 'event trigger with name notify_step_trigger already exists') {
    console.error('Failed to create Event Trigger:', data);
  } else {
    console.log('5. Event trigger configured.');
  }
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Mini n8n — Hasura Metadata Setup      ║');
  console.log('╚══════════════════════════════════════════╝');

  await waitForHasura();
  await trackTables();
  await createRelationships();
  await applyPermissions();
  await createEventTrigger();

  console.log('\n✓ Metadata setup complete');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
