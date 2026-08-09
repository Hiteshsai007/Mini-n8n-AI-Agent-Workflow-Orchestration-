const HASURA_HTTP = 'http://localhost:8080/v1/graphql';
const HASURA_WS = 'ws://localhost:8080/v1/graphql';
const ACTION_URL = 'http://localhost:3001';

let currentUser = null; // { id, role, org_id, name }
let currentWorkflowId = null;
let currentRunId = null;
let wsConnection = null;

// DOM Elements
const els = {
  authScreen: document.getElementById('auth-screen'),
  mainScreen: document.getElementById('main-screen'),
  userSelect: document.getElementById('user-select'),
  loginBtn: document.getElementById('login-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  orgName: document.getElementById('org-name'),
  userBadge: document.getElementById('user-badge'),
  quotaText: document.getElementById('quota-text'),
  quotaIndicator: document.getElementById('quota-indicator'),
  wfList: document.getElementById('workflow-list'),
  newWfBtn: document.getElementById('new-wf-btn'),
  emptyState: document.getElementById('empty-state'),
  builder: document.getElementById('builder'),
  wfName: document.getElementById('wf-name'),
  saveWfBtn: document.getElementById('save-wf-btn'),
  runWfBtn: document.getElementById('run-wf-btn'),
  stepsList: document.getElementById('steps-list'),
  addStepType: document.getElementById('add-step-type'),
  addStepBtn: document.getElementById('add-step-btn'),
  triggerType: document.getElementById('trigger-type'),
  runView: document.getElementById('run-view'),
  runIdDisplay: document.getElementById('run-id-display'),
  runStatus: document.getElementById('run-status'),
  stepRunsList: document.getElementById('step-runs-list')
};

// --- GraphQL Helpers ---
async function gql(query, variables = {}) {
  const res = await fetch(HASURA_HTTP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hasura-User-Id': currentUser.id,
      'X-Hasura-Role': currentUser.role
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message || data.errors[0].extensions?.code);
  return data.data;
}

// --- Auth ---
els.userSelect.addEventListener('change', (e) => {
  els.loginBtn.disabled = !e.target.value;
});

els.loginBtn.addEventListener('click', () => {
  const val = els.userSelect.value;
  if (!val) return;
  const [id, role, org_id, orgName] = val.split('|');
  currentUser = { id, role, org_id, name: els.userSelect.options[els.userSelect.selectedIndex].text, orgName };
  
  els.authScreen.classList.remove('active');
  els.mainScreen.classList.add('active');
  
  els.orgName.textContent = currentUser.orgName;
  els.userBadge.textContent = currentUser.role;
  els.userBadge.className = `badge ${currentUser.role}`;
  
  // Hide privileged actions for viewers
  els.runWfBtn.style.display = currentUser.role === 'viewer' ? 'none' : 'block';
  
  // Setup builder options based on role
  Array.from(els.addStepType.options).forEach(opt => {
    if (['db_write', 'notify'].includes(opt.value)) {
      opt.style.display = currentUser.role === 'owner' ? 'block' : 'none';
    }
  });
  Array.from(els.triggerType.options).forEach(opt => {
    if (['webhook', 'database_event'].includes(opt.value)) {
      opt.style.display = currentUser.role === 'owner' ? 'block' : 'none';
    }
  });

  loadWorkflows();
  updateQuota();
});

els.logoutBtn.addEventListener('click', () => {
  currentUser = null;
  currentWorkflowId = null;
  if (wsConnection) { wsConnection.close(); wsConnection = null; }
  els.mainScreen.classList.remove('active');
  els.authScreen.classList.add('active');
});

// --- Data Loading ---
async function updateQuota() {
  try {
    const data = await gql(`query { org_usage_this_month { calls_used calls_allowed } }`);
    const q = data.org_usage_this_month[0] || { calls_used: 0, calls_allowed: 100 };
    els.quotaText.textContent = `${q.calls_used} / ${q.calls_allowed} calls`;
    
    if (q.calls_used >= q.calls_allowed) {
      els.quotaIndicator.classList.add('exhausted');
      els.runWfBtn.disabled = true;
      els.runWfBtn.textContent = 'Quota Exceeded';
    } else {
      els.quotaIndicator.classList.remove('exhausted');
      els.runWfBtn.disabled = false;
      els.runWfBtn.textContent = '▶ Run';
    }
  } catch (e) { console.error('Quota load error', e); }
}

async function loadWorkflows() {
  els.wfList.innerHTML = '<li>Loading...</li>';
  try {
    const data = await gql(`query { workflows(order_by: {created_at: desc}) { id name } }`);
    els.wfList.innerHTML = '';
    data.workflows.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w.name;
      li.onclick = () => selectWorkflow(w.id);
      if (w.id === currentWorkflowId) li.classList.add('active');
      els.wfList.appendChild(li);
    });
  } catch (e) {
    els.wfList.innerHTML = `<li>Error loading</li>`;
  }
}

// --- Builder ---
let currentSteps = [];
let currentTrigger = null;

els.newWfBtn.addEventListener('click', () => {
  currentWorkflowId = null;
  currentSteps = [];
  currentTrigger = { type: 'manual', config: {} };
  els.wfName.value = 'New Workflow';
  
  els.emptyState.classList.add('hidden');
  els.runView.classList.add('hidden');
  els.builder.classList.remove('hidden');
  
  renderSteps();
  els.triggerType.value = 'manual';
});

async function selectWorkflow(id) {
  currentWorkflowId = id;
  els.emptyState.classList.add('hidden');
  els.runView.classList.add('hidden');
  els.builder.classList.remove('hidden');
  
  document.querySelectorAll('#workflow-list li').forEach(li => li.classList.remove('active'));
  
  try {
    const data = await gql(`
      query($id: uuid!) {
        workflows_by_pk(id: $id) {
          name
          workflow_steps(order_by: {order_index: asc}) { id type config order_index }
          workflow_triggers { id type config }
        }
      }
    `, { id });
    
    const wf = data.workflows_by_pk;
    els.wfName.value = wf.name;
    currentSteps = wf.workflow_steps.map(s => ({
      id: s.id, type: s.type, order_index: s.order_index,
      config: typeof s.config === 'string' ? JSON.parse(s.config) : s.config
    }));
    currentTrigger = wf.workflow_triggers[0] || { type: 'manual', config: {} };
    els.triggerType.value = currentTrigger.type;
    
    renderSteps();
  } catch (e) { alert('Error loading workflow: ' + e.message); }
}

function getDefaultConfig(type) {
  switch(type) {
    case 'llm_call': return { prompt: "Hello AI" };
    case 'http_request': return { url: "http://localhost:3001/healthz", method: "GET", headers: {} };
    case 'db_write': return { target_table: "my_table", mapping: {} };
    case 'conditional_branch': return { field: "text", operator: "contains", value: "success", on_true_step_order: 99, on_false_step_order: 99 };
    case 'approval_gate': return {};
    case 'notify': return {};
    default: return {};
  }
}

els.addStepBtn.addEventListener('click', () => {
  const type = els.addStepType.value;
  if (!type) return;
  
  // Layer 1 validation in UI
  if (['db_write', 'notify'].includes(type) && currentUser.role !== 'owner') {
    return alert('Only owners can add ' + type);
  }
  
  currentSteps.push({
    type,
    order_index: currentSteps.length + 1,
    config: getDefaultConfig(type)
  });
  renderSteps();
});

function renderSteps() {
  els.stepsList.innerHTML = '';
  currentSteps.forEach((step, idx) => {
    const div = document.createElement('div');
    div.className = 'step-card';
    div.innerHTML = `
      <div class="step-info">
        <div class="step-order">${step.order_index}</div>
        <div>
          <div class="step-type">${step.type}</div>
          <div class="step-config">${JSON.stringify(step.config)}</div>
        </div>
      </div>
      <div class="step-actions">
        <button class="btn small ghost" onclick="removeStep(${idx})">🗑</button>
      </div>
    `;
    els.stepsList.appendChild(div);
  });
}

window.removeStep = (idx) => {
  currentSteps.splice(idx, 1);
  // Re-index
  currentSteps.forEach((s, i) => s.order_index = i + 1);
  renderSteps();
};

els.saveWfBtn.addEventListener('click', async () => {
  const name = els.wfName.value;
  const triggerType = els.triggerType.value;
  
  if (['webhook', 'database_event'].includes(triggerType) && currentUser.role !== 'owner') {
    return alert('Only owners can use ' + triggerType);
  }
  
  try {
    els.saveWfBtn.textContent = 'Saving...';
    els.saveWfBtn.disabled = true;
    
    let wfId = currentWorkflowId;
    
    if (!wfId) {
      // Create
      const res = await gql(`
        mutation($name: String!, $orgId: uuid!) {
          insert_workflows_one(object: { name: $name, org_id: $orgId }) { id }
        }
      `, { name, orgId: currentUser.org_id });
      wfId = res.insert_workflows_one.id;
      currentWorkflowId = wfId;
    } else {
      // Update name
      await gql(`mutation($id: uuid!, $name: String!) { update_workflows_by_pk(pk_columns: {id: $id}, _set: {name: $name}) { id } }`, { id: wfId, name });
    }
    
    // Replace steps and triggers
    await gql(`mutation($wfId: uuid!) { delete_workflow_steps(where: {workflow_id: {_eq: $wfId}}) { affected_rows } delete_workflow_triggers(where: {workflow_id: {_eq: $wfId}}) { affected_rows } }`, { wfId });
    
    if (currentSteps.length > 0) {
      await gql(`
        mutation($steps: [workflow_steps_insert_input!]!) {
          insert_workflow_steps(objects: $steps) { affected_rows }
        }
      `, { 
        steps: currentSteps.map(s => ({
          workflow_id: wfId,
          type: s.type,
          order_index: s.order_index,
          config: s.config
        }))
      });
    }
    
    await gql(`
      mutation($wfId: uuid!, $type: String!) {
        insert_workflow_triggers_one(object: { workflow_id: $wfId, type: $type, config: "{}" }) { id }
      }
    `, { wfId, type: triggerType });
    
    await loadWorkflows();
    
    els.saveWfBtn.textContent = 'Saved!';
    setTimeout(() => els.saveWfBtn.textContent = 'Save', 2000);
  } catch (e) {
    alert('Save failed: ' + e.message);
    els.saveWfBtn.textContent = 'Save';
  } finally {
    els.saveWfBtn.disabled = false;
  }
});

// --- Execution & Live View ---

els.runWfBtn.addEventListener('click', async () => {
  if (!currentWorkflowId) return alert('Save workflow first');
  
  try {
    els.runWfBtn.disabled = true;
    els.runWfBtn.textContent = 'Triggering...';
    
    const res = await fetch(`${ACTION_URL}/trigger-workflow-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hasura-User-Id': currentUser.id,
        'X-Hasura-Role': currentUser.role
      },
      body: JSON.stringify({ input: { workflow_id: currentWorkflowId } })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.code);
    
    currentRunId = data.id;
    startLiveView();
    updateQuota(); // Update quota in background
  } catch (e) {
    alert('Run failed: ' + e.message);
  } finally {
    els.runWfBtn.disabled = false;
    els.runWfBtn.textContent = '▶ Run';
  }
});

function startLiveView() {
  els.builder.classList.add('hidden');
  els.runView.classList.remove('hidden');
  els.runIdDisplay.textContent = currentRunId;
  els.runStatus.textContent = 'RUNNING';
  els.runStatus.className = 'badge running';
  els.stepRunsList.innerHTML = '<p>Waiting for steps...</p>';
  
  if (wsConnection) wsConnection.close();
  
  wsConnection = new WebSocket(HASURA_WS, 'graphql-ws');
  
  wsConnection.onopen = () => {
    // Init payload
    wsConnection.send(JSON.stringify({
      type: 'connection_init',
      payload: {
        headers: {
          'X-Hasura-User-Id': currentUser.id,
          'X-Hasura-Role': currentUser.role
        }
      }
    }));
  };
  
  wsConnection.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'connection_ack') {
      // Subscribe
      wsConnection.send(JSON.stringify({
        id: '1',
        type: 'start',
        payload: {
          variables: { runId: currentRunId },
          query: `
            subscription($runId: uuid!) {
              workflow_runs_by_pk(id: $runId) { status }
              step_runs(where: {workflow_run_id: {_eq: $runId}}, order_by: {started_at: asc}) {
                id status attempt_count error output
                workflow_step { type order_index }
              }
            }
          `
        }
      }));
    } else if (data.type === 'data') {
      renderLiveView(data.payload.data);
    }
  };
}

function renderLiveView(data) {
  const wr = data.workflow_runs_by_pk;
  const srs = data.step_runs;
  
  if (wr) {
    els.runStatus.textContent = wr.status;
    els.runStatus.className = `badge ${wr.status}`;
    if (['completed', 'failed'].includes(wr.status)) {
      updateQuota(); // Final check
    }
  }
  
  if (!srs || srs.length === 0) return;
  
  els.stepRunsList.innerHTML = '';
  srs.forEach(sr => {
    const div = document.createElement('div');
    div.className = `step-run-card ${sr.status}`;
    
    let detailHtml = '';
    if (sr.error) detailHtml = `<div class="sr-detail sr-error">${sr.error}</div>`;
    else if (sr.output) detailHtml = `<div class="sr-detail">${JSON.stringify(sr.output, null, 2)}</div>`;
    
    let actionHtml = '';
    if (sr.status === 'paused' && ['owner', 'editor'].includes(currentUser.role)) {
      actionHtml = `<button class="btn small success" onclick="approveStep('${sr.id}')">Approve</button>`;
    } else if (sr.status === 'paused') {
      actionHtml = `<span class="badge viewer">Needs Approval</span>`;
    }
    
    div.innerHTML = `
      <div class="sr-header">
        <span class="sr-type">${sr.workflow_step.order_index}. ${sr.workflow_step.type}</span>
        <div style="display:flex; gap:10px; align-items:center;">
          ${actionHtml}
          <span class="sr-status ${sr.status}">${sr.status}</span>
        </div>
      </div>
      <div class="sr-meta">Attempts: ${sr.attempt_count}</div>
      ${detailHtml}
    `;
    els.stepRunsList.appendChild(div);
  });
}

window.approveStep = async (stepRunId) => {
  try {
    const res = await fetch(`${ACTION_URL}/approve-step`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hasura-User-Id': currentUser.id,
        'X-Hasura-Role': currentUser.role
      },
      body: JSON.stringify({ input: { step_run_id: stepRunId } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.code);
  } catch (e) {
    alert('Approval failed: ' + e.message);
  }
};
