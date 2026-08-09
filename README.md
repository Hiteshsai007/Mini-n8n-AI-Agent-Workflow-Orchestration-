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

## Source of truth
This pack is derived from the assignment brief provided by the user. Where the brief was ambiguous or silent (quota reset period, retry count details, conditional-branch condition schema, webhook trigger authentication, how permission Layer 1 is technically enforced against ID-guessing), a decision was made and recorded in `DECISIONS.md` rather than left for a coding agent to invent silently — the same principle applied in the prior PC Capability Agent audit.

Time pressure is part of the assignment ("whoever submits earliest gets priority... but broken doesn't count"). This pack is deliberately scoped to exactly what the brief asks for — no extra step types, trigger types, or screens — to avoid burning time on unrequested scope. See `PRD.md` §Non-goals.
