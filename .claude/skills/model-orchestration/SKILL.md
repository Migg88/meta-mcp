---
name: model-orchestration
description: How to route every task to the cheapest model that can do it well and keep token usage low — both while BUILDING the project (Claude Code subagents per task) and at RUNTIME inside the MCP server (model router with escalation, cache, batching and budgets). Use this skill whenever you delegate work to a subagent, choose a model, add any LLM call to the server, design tool outputs, or notice high token usage — even if the user doesn't mention cost.
---

# Model orchestration and token economy

Two layers, same principle: **code decides first, the cheapest capable model second, a stronger model only when needed.**

## Layer 1 — Building the project (Claude Code)

Subagents live in `.claude/agents/`. Each declares its `model` and a minimal `tools` allowlist.

| Subagent | Model | Used for |
|---|---|---|
| `planner` | opus | PLAN.md, slice design, ADRs, graph design |
| `security-reviewer` | opus | REVIEW step on security-sensitive diffs |
| `meta-docs-researcher` | sonnet | Verify Meta/MCP docs, update `docs/meta-endpoints.md` |
| `implementer` | sonnet | RED and GREEN steps of a slice |
| `verifier` | haiku | Run `npm run verify`, return only failures |
| `docs-writer` | haiku | README, CHANGELOG, Mermaid sync |

Rules:
- The main session orchestrates and delegates. It does not read long logs or large files itself.
- Every subagent returns a **compact report** (≤ 200 words): result, files touched, failures with file:line, next action. No full logs.
- Escalate a task to a stronger subagent only after the cheaper one failed twice or flagged ambiguity.
- Do **not** set `CLAUDE_CODE_SUBAGENT_MODEL`: it overrides every subagent model. Check current model-resolution rules in the Claude Code docs, and verify in the subagent transcript that the intended model actually ran. Record the check in `STATUS.md` once.
- Token hygiene: rely on `STATUS.md` as memory instead of re-reading history; read files by range; grep before opening; use quiet test reporters; compact the conversation between slices.

## Layer 2 — Runtime inside the MCP server

### Default: the server does not call an LLM

The host model (Claude Code / Desktop) already reasons. The server's job is to return **small, structured, pre-filtered data**. Biggest savings come from tool design:
- Few tools with precise descriptions (tool definitions cost tokens on every turn).
- `detail: "summary" | "full"` inputs; summary by default.
- Return ids, counts and short excerpts; full objects via resources.
- Pagination with low default limits; cache hints on list results where the SDK supports them.
- Deterministic filters in code (unanswered, date range, keyword rules, spam heuristics) before anything reaches a model.

Note: in MCP spec `2026-07-28` Sampling is deprecated. Do not build on it.

### Optional: server-side LLM router (feature flag `LLM_ROUTER_ENABLED`)

Only for **bulk** work where sending everything to the host would waste tokens (e.g. triaging 500 comments). Implementation reference: `references/model-router.ts` (tested in `model-router.test.ts`).

- Task kinds map to tiers (`fast`, `balanced`, `deep`); tiers map to model ids **from config**, never hardcoded. Verify current model ids in the provider docs.
- Pipeline per item: rules in code → `fast` model → escalate to `balanced` only if output is invalid or confidence < threshold.
- Outputs are JSON validated with a schema. Invalid twice → error, never guessed.
- Cache by `sha256(taskKind + normalized content)`.
- Static system prompts so provider prompt caching applies.
- Non-urgent bulk jobs use the provider's batch API.
- A `TokenBudget` per workflow run and per day; exhausted budget stops the run with a clear message.
- Record usage (task, model, input/output tokens, cache hit) in SQLite; expose it as the `meta://usage` resource.
- Model output is untrusted: it can label and draft, never trigger a write. Writes still go through prepare → confirm.
- The provider API key lives in the encrypted config like Meta secrets and is never logged.

### Default task routing

| Task | Tier | Escalate |
|---|---|---|
| Comment/message classification (question, complaint, spam, praise, lead) | fast | balanced if confidence < 0.8 |
| Thread summary | fast | balanced if confidence < 0.7 |
| Reply draft | balanced | — |
| Competitor / weekly strategy report | deep | — |

Tune thresholds with data: log confidence and human corrections, review weekly.

## Tests

- Router: confident fast path, escalation on low confidence, escalation on invalid output, cache hit, budget exhaustion (see reference tests).
- Tool outputs: snapshot the size of `summary` responses and fail if they grow beyond an agreed limit.
