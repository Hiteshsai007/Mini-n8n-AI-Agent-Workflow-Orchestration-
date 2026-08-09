# Tech Stack

These choices are fixed by the assignment brief, not open decisions — this document records rationale and specific implementation notes only.

## Backend
- **nhost** — bundles Postgres, Hasura, Auth, Storage, and Functions; avoids assembling these separately under time pressure.
- **Hasura GraphQL Engine** — schema tracking, relationships, Layer 1 permissions (`ARCHITECTURE.md` §3), Actions, Scheduled Triggers, Event Triggers. Prefer Hasura's native features (Scheduled/Event Triggers, relationship permissions) over hand-rolled equivalents — see `CLAUDE.md` §Dependency discipline.
- **PostgreSQL** — source of truth; the `org_usage_this_month` view (`ARCHITECTURE.md` §10) lives here.
- **nhost Functions** (or an equivalent serverless handler nhost supports) — hosts the Action Handler logic in `ARCHITECTURE.md` §5–§8.

## LLM API
Any free-tier provider (Groq, OpenRouter, Gemini) for `llm_call`. If unavailable, a stubbed call with a **disclosed** artificial delay is acceptable per the brief — "disclosed" means the README and write-up must say plainly that it's stubbed, not present it as real.

## Frontend
- **Next.js** (required by the brief) with a GraphQL client (Apollo or urql — either is fine; pick one and use it consistently) for queries/mutations/subscriptions.
- **nhost Auth** client for session/org context.

## Auth/session model
Users authenticate via nhost Auth. Org context is **not** a static JWT claim (see `ARCHITECTURE.md` §3, ADR-004/ADR-007) — the frontend maintains an "active org" selector purely for UX convenience; every server-side authorization decision re-derives membership from `org_members`, so a stale or manipulated client-side "active org" value cannot grant access it shouldn't.

## What NOT to add
- No separate job queue/worker system — Hasura Scheduled/Event Triggers and the single Action Handler cover every async need in this spec. Adding e.g. a Redis queue would be unrequested infrastructure under time pressure (the brief explicitly warns against "shortcuts that happen to work in a demo," which cuts both ways — don't over-engineer either).
- No custom auth system — nhost Auth is sufficient.
- No microservices split — one Action Handler codebase is enough for six step types and two Actions.
