-- Mini n8n Schema — all 7 tables + 1 view (DATA_MODEL.md)
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

------------------------------------------------------------
-- ENUMS
------------------------------------------------------------
CREATE TYPE org_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TYPE step_type AS ENUM (
  'llm_call', 'http_request', 'db_write',
  'notify', 'conditional_branch', 'approval_gate'
);

CREATE TYPE trigger_type AS ENUM (
  'manual', 'webhook', 'scheduled', 'database_event'
);

CREATE TYPE run_status AS ENUM (
  'pending', 'running', 'paused', 'completed', 'failed'
);

------------------------------------------------------------
-- 1. organizations
------------------------------------------------------------
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  calls_used    INTEGER NOT NULL DEFAULT 0,
  calls_allowed INTEGER NOT NULL DEFAULT 100,
  quota_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

------------------------------------------------------------
-- 2. org_members  (many-to-many: user ↔ org, ADR-007)
------------------------------------------------------------
CREATE TABLE org_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       org_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org  ON org_members(org_id);

------------------------------------------------------------
-- 3. workflows
------------------------------------------------------------
CREATE TABLE workflows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflows_org ON workflows(org_id);

------------------------------------------------------------
-- 4. workflow_steps
------------------------------------------------------------
CREATE TABLE workflow_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  type        step_type NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, order_index)
);

CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);

------------------------------------------------------------
-- 5. workflow_triggers
------------------------------------------------------------
CREATE TABLE workflow_triggers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  type        trigger_type NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_triggers_workflow ON workflow_triggers(workflow_id);

------------------------------------------------------------
-- 6. workflow_runs
------------------------------------------------------------
CREATE TABLE workflow_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status       run_status NOT NULL DEFAULT 'pending',
  triggered_by TEXT,  -- user_id for manual, or trigger-type label
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);

------------------------------------------------------------
-- 7. step_runs
------------------------------------------------------------
CREATE TABLE step_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id  UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  status           run_status NOT NULL DEFAULT 'pending',
  input            JSONB,
  output           JSONB,
  error            TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX idx_step_runs_workflow_run ON step_runs(workflow_run_id);
CREATE INDEX idx_step_runs_workflow_step ON step_runs(workflow_step_id);

------------------------------------------------------------
-- View: org_usage_this_month  (ARCHITECTURE.md §10)
-- Compute-on-read quota reset (ADR-001)
------------------------------------------------------------
CREATE OR REPLACE VIEW org_usage_this_month AS
SELECT
  id AS org_id,
  CASE
    WHEN now() >= quota_period_start + INTERVAL '1 month'
    THEN 0
    ELSE calls_used
  END AS calls_used,
  calls_allowed,
  CASE
    WHEN now() >= quota_period_start + INTERVAL '1 month'
    THEN date_trunc('month', now())
    ELSE quota_period_start
  END AS quota_period_start
FROM organizations;
