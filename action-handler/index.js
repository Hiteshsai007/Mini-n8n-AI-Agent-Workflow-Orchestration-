const express = require('express');
const { Pool } = require('pg');

const path = require('path');

const app = express();
app.use(express.json());
// Serve the frontend UI
app.use(express.static(path.join(__dirname, '../frontend')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/minin8n'
});

// Sleep utility
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: re-derive org context (Layer 2 check)
async function getCallerRoleForWorkflow(userId, workflowId) {
  const res = await pool.query(`
    SELECT om.role, w.org_id
    FROM workflows w
    JOIN org_members om ON om.org_id = w.org_id
    WHERE w.id = $1 AND om.user_id = $2
  `, [workflowId, userId]);
  return res.rows[0] || null; // { role, org_id }
}

// Step Executors
async function executeLlmCall(config, input) {
  // Disclosed stub with artificial delay (per PRD)
  await sleep(1000);
  const result = `Stubbed response for prompt: ${config.prompt || 'None'}`;
  return { output: { text: result, raw: { provider: 'stub', tokens: 42 } }, error: null };
}

async function executeHttpRequest(config, input) {
  try {
    const res = await fetch(config.url, {
      method: config.method || 'GET',
      headers: config.headers || {},
      body: config.method !== 'GET' ? JSON.stringify(config.body) : undefined
    });
    const bodyText = await res.text();
    let body;
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${bodyText}`);
    }
    return { output: { status: res.status, body }, error: null };
  } catch (err) {
    return { output: null, error: err.message };
  }
}

async function executeDbWrite(config, input, orgId) {
  // config: { target_table, mapping }
  // mapping maps input fields to columns. For MVP, we'll keep it simple.
  try {
    // Only allow writes to specific safe tables if needed, or assume trusted since owner authored it.
    // In MVP, we can insert directly using parameterized queries.
    const columns = Object.keys(config.mapping);
    const values = columns.map(c => {
      const inputKey = config.mapping[c];
      return input?.[inputKey] ?? null;
    });
    
    const placeholders = columns.map((_, i) => `$${i+1}`).join(', ');
    const query = `INSERT INTO ${config.target_table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    
    const res = await pool.query(query, values);
    return { output: res.rows[0], error: null };
  } catch (err) {
    return { output: null, error: err.message };
  }
}

// Main execution loop
async function runWorkflow(workflowId, triggeredBy, runId = null, startOrderIndex = null, resumeInput = {}) {
  // 1. Create or load workflow_run
  if (!runId) {
    const wrRes = await pool.query(`
      INSERT INTO workflow_runs (workflow_id, status, triggered_by)
      VALUES ($1, 'running', $2) RETURNING id
    `, [workflowId, triggeredBy]);
    runId = wrRes.rows[0].id;
  } else {
    await pool.query(`UPDATE workflow_runs SET status = 'running' WHERE id = $1`, [runId]);
  }

  // 2. Load steps
  const stepsRes = await pool.query(`
    SELECT id, type, config, order_index FROM workflow_steps
    WHERE workflow_id = $1 ORDER BY order_index ASC
  `, [workflowId]);
  const steps = stepsRes.rows;

  let currentInput = resumeInput || {};
  let currentOrderIndex = startOrderIndex;
  
  if (currentOrderIndex === null) {
    // Start at the first step
    currentOrderIndex = steps.length > 0 ? steps[0].order_index : null;
  }

  while (currentOrderIndex !== null) {
    const step = steps.find(s => s.order_index === currentOrderIndex);
    if (!step) break; // Reached end
    
    // Create step_run
    const srRes = await pool.query(`
      INSERT INTO step_runs (workflow_run_id, workflow_step_id, status)
      VALUES ($1, $2, 'running') RETURNING id
    `, [runId, step.id]);
    const stepRunId = srRes.rows[0].id;

    let stepConfig = step.config;
    if (typeof stepConfig === 'string') {
      try { stepConfig = JSON.parse(stepConfig); } catch (e) {}
    }

    if (step.type === 'approval_gate') {
      // Pause execution
      await pool.query(`
        UPDATE step_runs SET status = 'paused', attempt_count = 1
        WHERE id = $1
      `, [stepRunId]);
      await pool.query(`UPDATE workflow_runs SET status = 'paused' WHERE id = $1`, [runId]);
      return { id: runId, status: 'paused', step_run_id: stepRunId };
    }

    let success = false;
    let finalOutput = null;
    let finalError = null;
    let attempts = 0;
    const maxAttempts = (step.type === 'llm_call' || step.type === 'http_request') ? 2 : 1;

    while (attempts < maxAttempts && !success) {
      attempts++;
      try {
        let result = { output: null, error: null };
        if (step.type === 'llm_call') {
          result = await executeLlmCall(stepConfig, currentInput);
        } else if (step.type === 'http_request') {
          result = await executeHttpRequest(stepConfig, currentInput);
        } else if (step.type === 'db_write') {
          result = await executeDbWrite(stepConfig, currentInput);
        } else if (step.type === 'conditional_branch') {
          // Evaluate condition
          const fieldVal = currentInput[stepConfig.field];
          let conditionMet = false;
          if (stepConfig.operator === 'contains') {
            conditionMet = typeof fieldVal === 'string' && fieldVal.includes(stepConfig.value);
          } else if (stepConfig.operator === 'equals') {
            conditionMet = fieldVal == stepConfig.value; // relaxed equality
          }
          result = { output: { conditionMet }, error: null };
        } else if (step.type === 'notify') {
          result = { output: { notified: true }, error: null };
        }

        if (result.error) throw new Error(result.error);
        
        success = true;
        finalOutput = result.output;
      } catch (err) {
        finalError = err.message;
        if (attempts < maxAttempts) await sleep(500);
      }
    }

    // Update step_run
    const status = success ? 'completed' : 'failed';
    await pool.query(`
      UPDATE step_runs SET status = $1, output = $2, error = $3, attempt_count = $4, completed_at = now()
      WHERE id = $5
    `, [status, finalOutput, finalError, attempts, stepRunId]);

    if (!success) {
      await pool.query(`UPDATE workflow_runs SET status = 'failed', completed_at = now() WHERE id = $1`, [runId]);
      return { id: runId, status: 'failed' };
    }
    
    currentInput = finalOutput || {};

    // Determine next step
    if (step.type === 'conditional_branch') {
      currentOrderIndex = finalOutput.conditionMet ? stepConfig.on_true_step_order : stepConfig.on_false_step_order;
    } else {
      const nextStep = steps.find(s => s.order_index > currentOrderIndex);
      currentOrderIndex = nextStep ? nextStep.order_index : null;
    }
  }

  // All steps succeeded
  await pool.query(`UPDATE workflow_runs SET status = 'completed', completed_at = now() WHERE id = $1`, [runId]);
  
  // Increment Quota
  await pool.query(`
    UPDATE organizations SET calls_used = calls_used + 1 
    WHERE id = (SELECT org_id FROM workflows WHERE id = $1)
  `, [workflowId]);

  return { id: runId, status: 'completed' };
}


// --- API Endpoints ---

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.post('/trigger-workflow-run', async (req, res) => {
  const { input } = req.body;
  const { workflow_id } = input;
  
  const sessionVariables = req.body.session_variables || {};
  const userId = sessionVariables['x-hasura-user-id'];
  if (!userId) return res.status(400).json({ code: 'UNAUTHORIZED', message: 'Missing user context' });

  try {
    const ctx = await getCallerRoleForWorkflow(userId, workflow_id);
    if (!ctx) return res.status(400).json({ code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found or access denied' });
    if (ctx.role === 'viewer') return res.status(400).json({ code: 'FORBIDDEN_ROLE', message: 'Viewers cannot trigger runs' });

    const quotaRes = await pool.query(`SELECT calls_used, calls_allowed FROM org_usage_this_month WHERE org_id = $1`, [ctx.org_id]);
    const quota = quotaRes.rows[0];
    if (quota.calls_used >= quota.calls_allowed) {
      return res.status(400).json({ code: 'ORG_QUOTA_EXCEEDED', message: 'Quota exceeded for period' });
    }

    const result = await runWorkflow(workflow_id, userId);
    return res.json(result);
  } catch (err) {
    console.error('Error triggering run:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

app.post('/approve-step', async (req, res) => {
  const { input } = req.body;
  const { step_run_id } = input;
  
  const sessionVariables = req.body.session_variables || {};
  const userId = sessionVariables['x-hasura-user-id'];
  if (!userId) return res.status(400).json({ code: 'UNAUTHORIZED', message: 'Missing user context' });

  try {
    // Look up the paused step run and its associated workflow
    const srRes = await pool.query(`
      SELECT sr.id, sr.workflow_run_id, sr.status, ws.workflow_id, ws.order_index
      FROM step_runs sr
      JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
      WHERE sr.id = $1
    `, [step_run_id]);
    const stepRun = srRes.rows[0];

    if (!stepRun) return res.status(400).json({ code: 'NOT_FOUND', message: 'Step run not found' });
    if (stepRun.status !== 'paused') return res.status(400).json({ code: 'NOT_PAUSED', message: 'Step run is not paused' });

    // Layer 2 Auth check
    const ctx = await getCallerRoleForWorkflow(userId, stepRun.workflow_id);
    if (!ctx) return res.status(400).json({ code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' });
    if (ctx.role === 'viewer') return res.status(400).json({ code: 'FORBIDDEN_ROLE', message: 'Viewers cannot approve steps' });

    // Mark the step_run as completed
    await pool.query(`
      UPDATE step_runs SET status = 'completed', output = $1, completed_at = now()
      WHERE id = $2
    `, [{ approved_by: userId, approved_at: new Date().toISOString() }, stepRun.id]);

    // Figure out the NEXT step's order index to resume from
    const wsRes = await pool.query(`
      SELECT order_index FROM workflow_steps
      WHERE workflow_id = $1 AND order_index > $2
      ORDER BY order_index ASC LIMIT 1
    `, [stepRun.workflow_id, stepRun.order_index]);
    const nextOrderIndex = wsRes.rows.length > 0 ? wsRes.rows[0].order_index : null;

    // Resume workflow asynchronously, but return success immediately to the client
    // For MVP/testing, we await it so the test can assert on completion
    await runWorkflow(stepRun.workflow_id, userId, stepRun.workflow_run_id, nextOrderIndex, { approved: true });
    
    return res.json({ id: step_run_id });
  } catch (err) {
    console.error('Error approving step:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

app.post('/event-notify', (req, res) => {
  // Receives the payload from Hasura Event Trigger on step_runs table
  const event = req.body.event;
  if (event && event.data && event.data.new) {
    console.log(`[Event Trigger] Dispatched notification for step_run ${event.data.new.id}`);
  }
  res.json({ success: true });
});

app.post('/webhook-trigger-run', async (req, res) => {
  const { workflow_id, secret, input = {} } = req.body;
  if (!workflow_id || !secret) {
    return res.status(400).json({ error: 'Missing workflow_id or secret' });
  }

  try {
    // Look up the trigger configuration directly in the DB
    const triggersRes = await pool.query(`
      SELECT id, type, config, workflow_id 
      FROM workflow_triggers 
      WHERE workflow_id = $1 AND type = 'webhook'
    `, [workflow_id]);
    
    if (triggersRes.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook trigger not found' });
    }

    const trigger = triggersRes.rows[0];
    let config = trigger.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch(e) {}
    }

    if (config.secret !== secret) {
      return res.status(401).json({ error: 'Invalid secret' });
    }

    // Quota check
    const wfRes = await pool.query(`SELECT org_id FROM workflows WHERE id = $1`, [workflow_id]);
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' });
    const orgId = wfRes.rows[0].org_id;

    const quotaRes = await pool.query(`SELECT calls_used, calls_allowed FROM org_usage_this_month WHERE org_id = $1`, [orgId]);
    const quota = quotaRes.rows[0];
    if (quota.calls_used >= quota.calls_allowed) {
      return res.status(400).json({ code: 'ORG_QUOTA_EXCEEDED', message: 'Quota exceeded for period' });
    }

    // Trigger run asynchronously (since this is a webhook response)
    runWorkflow(workflow_id, 'SYSTEM', null, null, input).catch(console.error);

    return res.json({ status: 'queued' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Action handler on :${PORT}`));
