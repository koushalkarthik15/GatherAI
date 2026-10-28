# GatherAI agent instructions

Read this file and docs/00-project-state.md at every session start. Read the relevant specifications before changing code. Repository docs are the source of truth; do not depend on chat history.

## Working rules
- Use tabs instead of spaces for indentation in new or edited code, while preserving existing formatting where unrelated.
- User instructions take precedence. Record accepted changes in docs/12-decisions.md and update affected specs and current state together.
- Do not expand the locked scope without explicit agreement. Distinguish plans, decisions and verified implementation.
- React + Vite is the selected frontend. Native mobile is future work. Do not add n8n, RAG or multiple agents to this release.
- No subagents unless the user explicitly authorizes delegation.
- All ordinary task/budget/date operations are deterministic. AI runs only on explicit generation/revision/idea requests, with server-side caps.
- Preserve stable IDs, manual edits, completed tasks, actual spending and fixed commitments in proposals.
- AI output is untrusted. Validate schemas, semantics, authorization and expected revisions server-side.
- Save proposals separately; apply or roll back atomically after review.
- Follow docs/08-coding-standards.md and docs/09-security-accessibility.md.
- Update project state with actual changes, check results, blockers and next actions before handoff.
- Never commit secrets or claim browser verification from a syntax check.

## Reading map
01 scope; 02 user flows; 03 visual design; 04 data model; 05 deterministic rules; 06 AI; 07 architecture; 08 coding standards; 09 security/accessibility; 10 testing; 11 delivery; 12 decisions; 13 research.
## Delivery workflow
Use a lightweight Scrum-inspired process only when it improves delivery: keep a prioritized backlog, choose a small milestone with clear acceptance criteria, finish and verify a usable increment, and record the result and next step. Avoid unnecessary ceremonies or process documents. The user supplied the Project Engineering Playbook in chat and it has been reviewed. Apply it proportionately: inspect current artifacts, plan and review bounded milestones with acceptance criteria, implement a vertical slice, verify behavior, inspect changes, and report actual evidence. Honor explicit approval gates when established; do not add permission stops to small authorized edits or work already approved. Keep the existing docs as the single source of truth; do not duplicate them into the playbook's unavailable templates.

