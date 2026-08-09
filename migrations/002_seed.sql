-- Seed data for testing Layer 1 isolation (AT-001, AT-006)
-- Two organizations, each with owner/editor/viewer users

-- UUIDs are deterministic for test reproducibility
-- Org A
INSERT INTO organizations (id, name, calls_used, calls_allowed)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Org Alpha', 0, 100);

-- Org B
INSERT INTO organizations (id, name, calls_used, calls_allowed)
VALUES ('b0000000-0000-0000-0000-000000000002', 'Org Beta', 0, 100);

-- Users (these IDs simulate nhost Auth user IDs)
-- Org A users
INSERT INTO org_members (id, user_id, org_id, role) VALUES
  ('c0000000-0000-0000-0000-00000000a001',
   'd0000000-0000-0000-0000-00000000a001',
   'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('c0000000-0000-0000-0000-00000000a002',
   'd0000000-0000-0000-0000-00000000a002',
   'a0000000-0000-0000-0000-000000000001', 'editor'),
  ('c0000000-0000-0000-0000-00000000a003',
   'd0000000-0000-0000-0000-00000000a003',
   'a0000000-0000-0000-0000-000000000001', 'viewer');

-- Org B users
INSERT INTO org_members (id, user_id, org_id, role) VALUES
  ('c0000000-0000-0000-0000-00000000b001',
   'd0000000-0000-0000-0000-00000000b001',
   'b0000000-0000-0000-0000-000000000002', 'owner'),
  ('c0000000-0000-0000-0000-00000000b002',
   'd0000000-0000-0000-0000-00000000b002',
   'b0000000-0000-0000-0000-000000000002', 'editor'),
  ('c0000000-0000-0000-0000-00000000b003',
   'd0000000-0000-0000-0000-00000000b003',
   'b0000000-0000-0000-0000-000000000002', 'viewer');

-- A sample workflow in Org A for testing
INSERT INTO workflows (id, org_id, name, created_by) VALUES
  ('e0000000-0000-0000-0000-00000000a001',
   'a0000000-0000-0000-0000-000000000001',
   'Test Workflow Alpha',
   'd0000000-0000-0000-0000-00000000a001');

-- Sample steps for that workflow
INSERT INTO workflow_steps (id, workflow_id, order_index, type, config) VALUES
  ('f0000000-0000-0000-0000-00000000a001',
   'e0000000-0000-0000-0000-00000000a001', 1, 'llm_call',
   '{"prompt": "Summarize the input", "model": "llama-3.1-8b-instant"}'),
  ('f0000000-0000-0000-0000-00000000a002',
   'e0000000-0000-0000-0000-00000000a001', 2, 'http_request',
   '{"url": "https://httpbin.org/post", "method": "POST", "headers": {}, "body": {}}'),
  ('f0000000-0000-0000-0000-00000000a003',
   'e0000000-0000-0000-0000-00000000a001', 3, 'conditional_branch',
   '{"field": "text", "operator": "contains", "value": "success", "on_true_step_order": 4, "on_false_step_order": 5}');

-- Manual trigger for the workflow
INSERT INTO workflow_triggers (id, workflow_id, type, config) VALUES
  ('70000000-0000-0000-0000-00000000a001',
   'e0000000-0000-0000-0000-00000000a001', 'manual', '{}');

-- A sample workflow in Org B (to test isolation)
INSERT INTO workflows (id, org_id, name, created_by) VALUES
  ('e0000000-0000-0000-0000-00000000b001',
   'b0000000-0000-0000-0000-000000000002',
   'Test Workflow Beta',
   'd0000000-0000-0000-0000-00000000b001');
