---
name: dev-loop
description: Iterative build loop for meta-content-mcp (orient → spec → red → green → verify → review → record). Use this skill for ANY implementation work in this repository — new features, bug fixes, refactors, or when the user says "continue", "next slice", "keep going" or "resume" — even if they don't mention the loop.
---

# Dev loop

Work in small vertical slices. One slice = one user-visible capability, end to end, ≤ ~300 changed lines.

## The loop

```
ORIENT → SPEC → RED → GREEN → VERIFY → REVIEW → RECORD → (next slice)
                         ↑__________|  (on failure, max 3 attempts)
```

1. **ORIENT** — Read `PLAN.md` and `STATUS.md`. Pick the first unchecked slice. If none, stop and report.
2. **SPEC** — Write in `STATUS.md`: acceptance criteria (Given/When/Then) and the list of tests you will write. If a criterion is ambiguous, ask the user and stop.
3. **RED** — Write the tests first. Run them and confirm they fail for the expected reason.
4. **GREEN** — Write the simplest code that passes. No speculative abstractions.
5. **VERIFY** — Run `npm run verify` (see `verification` skill). Paste the summary output into `STATUS.md`.
6. **REVIEW** — Review your own diff with `git diff`:
   - Clean code: small functions, clear names, no duplication, no dead code, no `any`.
   - Layering: `tools` → `services` → `workflows` → `meta`/`storage`. No shortcuts.
   - Run the checklist in the `security-hardening` skill for the touched areas.
   - If the slice has multiple steps with side effects, it must use the `workflow-graph` skill.
7. **RECORD** — Tick the slice in `PLAN.md`, update `STATUS.md`, commit with a Conventional Commit message.

## Delegation (see `model-orchestration`)

| Step | Who | Model |
|---|---|---|
| ORIENT, SPEC | main session (uses `planner` for new areas) | opus |
| RED, GREEN | `implementer` | sonnet |
| VERIFY | `verifier` | haiku |
| REVIEW | `security-reviewer` when security-relevant; otherwise main session | opus |
| RECORD | `docs-writer`, then main session commits | haiku |
| Any doc/policy doubt | `meta-docs-researcher` | sonnet |

The main session keeps only compact subagent reports in context. Escalate to a stronger model only after two failed attempts or explicit ambiguity.

## Stop rules

- VERIFY fails 3 times for the same cause → stop, write the blocker in `STATUS.md` (what failed, what you tried, hypothesis) and ask the user.
- Never disable, skip or weaken a test, lint rule or type check to make the gate pass.
- Never claim something works without command output as evidence.
- Any change to scope, public tool contracts or security posture → ask first.
- Unexpected Meta API behavior → verify in official docs, record in `docs/meta-endpoints.md`, then continue.

## STATUS.md template

```markdown
# Status

## Current slice
<name> — <state: SPEC | RED | GREEN | VERIFY | REVIEW | DONE | BLOCKED>

## Acceptance criteria
- Given … When … Then …

## Tests
- [ ] <test name>

## Verification evidence
<summary output of npm run verify>

## Security checklist (touched areas)
- [x] <item> — <evidence>

## Blockers / questions
- …
```
