# CLAUDE.md — AI Coding Agent Operating Rules

# 1. Role
You are implementing the mini n8n AI-agent workflow orchestration platform specified in this pack. Your job is to build exactly what `PRD.md` scopes, correctly, fast — this is a time-boxed take-home assignment graded on one live end-to-end scenario, not a checklist of features graded piece by piece.

# 2. Product summary
A multi-tenant workflow builder/executor on nhost + Hasura + PostgreSQL + Next.js. Organizations contain members with roles; members build ordered-step workflows with a trigger; runs execute steps sequentially with retry, branching, and human approval; two independent permission layers gate every action; execution streams live via GraphQL subscriptions.

# 3. Authority hierarchy
If documents conflict, this order wins:
1. `CLAUDE.md` (this file)
2. `SECURITY.md` (the cross-org isolation invariant is non-negotiable — see §4)
3. `PRD.md`
4. `ARCHITECTURE.md`
5. `DATA_MODEL.md` / `API_SPEC.md`
6. `UX_SPEC.md`
7. `TESTING.md` / `ACCEPTANCE_TESTS.md`
8. `ROADMAP.md`
9. `DECISIONS.md`

If you find an actual conflict between documents (not just a gap), stop and flag it rather than picking silently — this pack was built to be internally consistent; a conflict likely means something changed and wasn't propagated.

# 4. Non-negotiables
- **Cross-org isolation always wins over convenience.** Every org-scoped read/write is checked against real `org_members` rows, every time, regardless of what the client sends. This is graded directly (Final Task point 6) and is the single most important property of this system.
- **Layer 1 and Layer 2 are not substitutes for each other.** A Hasura row permission does not excuse skipping the imperative role check in `approveStep`, and vice versa. See `ARCHITECTURE.md` §3–§4 and `SECURITY.md`.
- **The Final Task (`PRD.md` §6) is the definition of done**, not a per-feature checklist. A feature that works in isolation but breaks the live end-to-end scenario is not done.
- **No fabricated success.** If `llm_call` uses a stubbed provider, this must be disclosed in the README/write-up, not presented as a real call.
- **Speed matters, but a fast broken submission loses to a slower correct one** — the brief says so explicitly. Do not skip the cross-org isolation test suite to save time.

# 5. Scope discipline
Build exactly the six step types, four trigger types, and screens listed in `PRD.md` §4 — no more. Before adding anything not named in `PRD.md`, check `PRD.md` §Non-goals; if it's listed there, don't build it even if it seems useful. If something seems missing that isn't in Non-goals either, that's a stop condition (§9), not a green light to invent it.

# 6. Evidence and decision rules
- Never invent a GraphQL field, table, or Action not in `DATA_MODEL.md`/`API_SPEC.md`. If the UI needs data not modeled, that's a spec gap — flag it, don't quietly extend the schema without updating `DATA_MODEL.md` first.
- Every authorization decision must be traceable to either a Hasura permission rule (Layer 1) or explicit code in the Action Handler (Layer 2) — never to "the frontend didn't show the button."
- Where `DECISIONS.md` has already resolved an ambiguity (retry count, condition schema, quota period, etc.), use that decision. Don't re-derive your own answer to a question this pack already answered.

# 7. Dependency discipline
Prefer nhost/Hasura native features (Scheduled Triggers, Event Triggers, relationship permissions, nested mutations) over hand-rolled equivalents. Before adding a new dependency (a queue library, a cron library, a custom auth layer), check `TECH_STACK.md` §What NOT to add — if it's covered by a native feature already, don't add the dependency.

# 8. Testing expectations
- The cross-org isolation test suite (`SECURITY.md`, `TESTING.md`) is a gate, not optional coverage — run it before considering any slice in `ROADMAP.md` complete if that slice touches an org-scoped table or Action.
- Every new step executor, trigger wiring, or Action gets at least the unit/integration tests named for it in `TESTING.md`.

# 9. Stop conditions — ask, don't invent
Stop and ask (or note the assumption explicitly in your response) when:
- A requirement seems to require a field, table, or Action not in this spec pack.
- Two documents in this pack appear to genuinely conflict (not just one being silent where another speaks).
- A security-relevant decision isn't covered by `SECURITY.md`/`DECISIONS.md` and you're about to make one up (e.g., a new kind of secret, a new trust boundary).
- You're about to spend significant time on something in `PRD.md` §Non-goals because it "seems like it would help."

# 10. Definition of done
A slice from `ROADMAP.md` is done when its own acceptance criteria pass, per that slice's entry — not before. The project as a whole is done when the Final Task (`PRD.md` §6) passes live, the cross-org isolation suite passes, and the deliverables list (`README.md` of the actual project repo — GitHub link, hosted URL, Hasura metadata, write-up, recording) is complete.

# 11. Standard task response format
For any non-trivial change: state which slice/module it belongs to, what it touches (schema / Hasura permissions / Action Handler / frontend), and which acceptance test(s) it's meant to satisfy. This keeps every change traceable back to `ROADMAP.md` and `ACCEPTANCE_TESTS.md` without needing a separate tracking document.

# 12. File ownership / module boundaries
| Module | Owns | Must NOT contain |
|---|---|---|
| Hasura metadata | schema tracking, relationships, Layer 1 permissions, Scheduled/Event Trigger wiring | business logic, retry/branch logic |
| Action Handler | Layer 2 checks, the execution loop (`ARCHITECTURE.md` §5), all six step executors, quota logic | Layer 1 permission logic (that's Hasura's job — don't duplicate it defensively in the handler beyond the specific Layer 2 cases named in `ARCHITECTURE.md` §4) |
| Frontend | screens/state in `UX_SPEC.md`, GraphQL queries/mutations/subscriptions | authorization decisions — it only hides controls, per `UX_SPEC.md` §Rules |
| notify Event Trigger webhook | Slack/email dispatch only | anything else the Action Handler already owns |

# 13. Final principle
Optimize for: **correctness of the Final Task scenario > cross-org security > the rest of the acceptance tests > code clarity > speed of delivery > polish.**

The goal is not to build every conceivable feature of a workflow platform. The goal is to build the smallest system that makes the six-point Final Task true, live, without cutting a corner that would make it falsely true in a demo but wrong in general.
