# Mini n8n — AI Agent Workflow Orchestration — Development Spec Pack v1

This pack replaces the earlier PC Capability Agent pack for this workspace. It specifies a mini n8n-style platform for chaining AI agent workflow steps inside organizations, built on nhost + Hasura + PostgreSQL + GraphQL + Next.js, per the take-home assignment brief.

The most important file is `CLAUDE.md`. It defines the AI coding agent's operating rules, scope boundaries, evidence requirements, security non-negotiables (the two permission layers), and the definition of done — which is the six-point live scenario, not a feature checklist.

## Files
- `CLAUDE.md` — AI agent constitution
- `PRD.md` — product requirements, scope, non-goals
- `ARCHITECTURE.md` — components, execution flow, formal mechanics for triggers/steps/permissions
- `TECH_STACK.md` — stack choices and rationale
- `DATA_MODEL.md` — schema
- `API_SPEC.md` — GraphQL operations, Hasura Actions, error model
- `UX_SPEC.md` — screens, states, role-visibility rules
- `SECURITY.md` — the two-layer permission model and cross-org isolation invariant
- `TESTING.md` — test strategy, including the mandatory cross-org isolation test
- `ACCEPTANCE_TESTS.md` — behavioral acceptance tests, mapped to the assignment's Final Task
- `ROADMAP.md` — vertical-slice build order
- `DECISIONS.md` — architecture decision records, including every place the assignment brief was ambiguous and what was locked

## Setup Instructions

### 1. Prerequisites
- Docker & Docker Compose
- Node.js (v20+)

### 2. Running the Infrastructure
Start the database, Hasura, and the Action Handler:
```bash
docker compose up -d
```
Wait for Hasura to be ready (`http://localhost:8080/healthz`).

### 3. Applying Schema & Test Data
Initialize the database, insert deterministic seed data, and apply Hasura Layer 1 metadata (relationships, permissions, event triggers):
```bash
node scripts/apply-actions.js
```
*(Note: `apply-actions.js` orchestrates migrations, seeding, and metadata application.)*

### 4. Running the Tests & Final Task
Run the mandatory cross-org isolation test:
```bash
node scripts/test-isolation.js
```
Run the automated end-to-end Final Task scenario (PRD Section 6):
```bash
node scripts/test-final.js
```
If you see all green checks, the backend behaves exactly as specified.

### 5. Using the UI
Open your browser to the frontend served from the Action Handler:
**http://localhost:3001**
- **Test users** are pre-loaded in the login dropdown for easy role switching.
- **Alice (Owner, Org A)** can build workflows, see all steps, and approve runs.
- **Carol (Viewer, Org A)** has a read-only view and cannot trigger or approve.
- **Dave (Owner, Org B)** cannot see, access, or affect Org A workflows.
