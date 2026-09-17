# Build `meta-content-mcp` — MCP server for Meta accounts

## 0. How you work on this project

You are the **orchestrator**: a senior TypeScript engineer and MCP server author with a security-first mindset.
This is a **public portfolio project**: architecture, security, tests, cost efficiency and documentation will be reviewed by other engineers.

Follow this order strictly:

1. Read every skill in `.claude/skills/` and every subagent in `.claude/agents/`.
2. Delegate verification of the facts in section 2 to `meta-docs-researcher`. Report any difference.
3. Ask me the questions in section 8 (plus any other real ambiguity) in **one grouped message**. Do not write code yet.
4. Delegate `PLAN.md` to `planner` (vertical slices with acceptance criteria, tests, permissions and assigned subagent). Wait for my approval.
5. Implement slice by slice with the `dev-loop` skill, delegating each step to the right subagent (`model-orchestration` skill). Never skip the verification gate.

If something here conflicts with official Meta, MCP or Anthropic docs, the docs win: write an ADR and tell me.

## 1. Goal

An MCP server that lets an MCP host (Claude Code, Claude Desktop, etc.) manage **Facebook Pages and Instagram professional accounts** to:

- **Publish**: draft, validate, approve, publish and schedule content.
- **Organize**: tag, group and search content; expose a content calendar.
- **Research**: insights on my accounts; public research on competitors, hashtags and ads.
- **Engage**: triage and answer comments and direct messages, always within Meta policy and with human approval.

And do it **token-efficiently**: code decides first, the cheapest capable model second, a stronger model only when needed.

## 2. Verified context (re-check at start, dates matter)

- **MCP spec** latest revision is `2026-07-28`: stateless core, Multi Round-Trip Requests for elicitation, and **Sampling deprecated**. TypeScript SDK v2 ships split packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`) with Standard Schema (Zod v4). Confirm stable names and APIs before installing.
- **Graph API version**: a single config value (`META_GRAPH_VERSION`), defaulting to the latest stable version at implementation time.
- **Instagram publishing quota**: Meta docs show different numbers on different pages. Always read `GET /{ig-user-id}/content_publishing_limit`; never hardcode it.
- **Messaging policy**: 24-hour standard window; Human Agent tag (7 days) only for humans and needs approval; private replies are a single message per comment within a time limit; a human escalation path is required; messaging permissions need Advanced Access + App Review.
- **Claude Code subagents** accept `model` per agent (`haiku`, `sonnet`, `opus`, full ids or `inherit`). Do not set `CLAUDE_CODE_SUBAGENT_MODEL`; verify in a subagent transcript that routing works.

## 3. Scope v1

### Tools (one per intent, snake_case, `meta_` prefix — keep the list short, each definition costs tokens)

| Area | Tools | Side effects |
|---|---|---|
| Accounts | `meta_list_accounts`, `meta_account_health` | read-only |
| Publish | `meta_draft_create`, `meta_draft_update`, `meta_draft_list`, `meta_publish_prepare`, `meta_schedule` | local writes / prepare |
| Organize | `meta_tag_add`, `meta_tag_remove`, `meta_content_search` | local writes |
| Research | `meta_insights_get`, `meta_competitor_lookup`, `meta_hashtag_research`, `meta_ad_library_search` (optional) | read-only |
| Comments | `meta_comments_list`, `meta_comments_triage`, `meta_comment_action_prepare` (reply, hide, unhide, delete, private_reply) | read / prepare |
| Messages | `meta_conversations_list`, `meta_conversation_get`, `meta_message_send_prepare`, `meta_reply_draft` (router only) | read / prepare |
| Execution | `meta_confirm` — the only tool that performs external writes | destructive |

### Resources
`meta://accounts`, `meta://calendar/{yyyy-mm}`, `meta://drafts/{id}`, `meta://usage` (tokens by task and model), `meta://knowledge` (facts I approve for reply drafts)

### Prompts
`weekly_content_plan`, `competitor_report`, `inbox_daily_review`

### Out of scope v1
Ads buying/management, Threads, WhatsApp, fully automatic replies without approval. Design so they can be added without refactoring the core.

## 4. Model orchestration and token economy

Apply the `model-orchestration` skill in two layers:

**Build time (Claude Code)** — delegate each step to the subagent with the cheapest capable model:
`planner` (opus) · `security-reviewer` (opus) · `meta-docs-researcher` (sonnet) · `implementer` (sonnet) · `verifier` (haiku) · `docs-writer` (haiku). Subagents return compact reports; the orchestrator never loads full logs.

**Runtime (inside the server)**
- By default the server does **not** call an LLM: it returns small, pre-filtered, structured data (`detail: "summary"` by default, pagination, ids + excerpts, rules in code).
- Optional `LLM_ROUTER_ENABLED` for bulk triage and drafts: task → tier (`fast` / `balanced` / `deep`) → model id from config, escalation only on invalid output or low confidence, content-hash cache, provider prompt caching, batch API for non-urgent jobs, per-run and daily token budgets, usage recorded in `meta://usage`.
- Model output can label and draft but never trigger a write.

## 5. Non-negotiables

### Architecture
```
src/
  server/      MCP wiring only (thin)
  tools/       input schema → one service call → output mapping
  services/    domain logic: publish, organize, research, comments, messages, accounts
  workflows/   state graphs: publish, research, comment triage, reply
  llm/         optional model router, budgets, usage (no Meta calls)
  meta/        the ONLY module that talks HTTP to Meta
  storage/     SQLite repositories, encrypted token vault, encrypted message bodies
  config/      env parsing and validation, fails fast
  lib/         errors, logger with redaction, small utilities
```
Dependencies point inward. `tools` never imports `meta` or `llm` directly.

### Write safety
- Every external write is two-phase: `*_prepare` validates (quota, messaging window, private-reply usage, payload) and returns a preview + short-lived single-use confirmation id bound to a payload hash; `meta_confirm` executes exactly that payload.
- Use Multi Round-Trip Requests to ask the human for approval when the client supports it.
- Idempotency keys prevent duplicates on retries and resumes. `DRY_RUN=true` blocks all Meta writes.

### Security and privacy
Apply the full `security-hardening` and `inbox-management` skills. Minimum: encrypted tokens and message bodies, nothing secret in tool output or logs, all third-party and model text treated as untrusted, least-privilege permissions per feature, retention and purge, Meta deletion notifications honored.

### Code quality
TypeScript `strict`, no `any`, ESM, Node.js LTS. Clean and simple: small functions, clear names, no clever abstractions, no dead code. Every dependency justified in an ADR. ESLint + Prettier, Conventional Commits.

### Testing
Vitest. No real Meta or LLM calls in CI. Unit, workflow path (including crash + resume), integration with mocked HTTP, contract and smoke tests. Required domain tests are listed in the skills. Optional live tests behind `LIVE_TESTS=true`.

## 6. Deliverables

```
README.md            features, quick start, `claude mcp add` command, config table, required Meta permissions
SECURITY.md          threat model, accepted risks, vulnerability reporting
docs/architecture.md Mermaid: layers, publish, research, triage and reply graphs, model routing
docs/cost.md         routing table, budgets, how to read meta://usage, measured token savings
docs/adr/            one ADR per significant decision
docs/meta-endpoints.md every endpoint/permission/metric/policy used, with link and verification date
PLAN.md / STATUS.md  living plan and loop state
.env.example         every variable documented, no real values
.github/workflows/   CI: typecheck, lint, test, audit, build, secret scan (actions pinned by SHA)
LICENSE, CHANGELOG.md
```

## 7. Definition of done

- [ ] `npm run verify` passes from a clean clone
- [ ] Coverage ≥ 90% on `services/`, `workflows/` and `llm/`
- [ ] Every tool has annotations, strict input schema and output schema
- [ ] Security checklist fully checked with evidence in `STATUS.md`
- [ ] Publish and reply flows proven in DRY_RUN with graph path tests (happy, quota/window closed, API error, crash + resume)
- [ ] Messaging policy tests pass (window, private reply, human agent tag, deletion)
- [ ] Router tests pass (fast path, escalation, cache, budget) and `docs/cost.md` shows a measured comparison: triage of a fixture of 200 comments with rules + router vs. sending everything to the host model
- [ ] Subagent model routing verified once in a transcript and recorded
- [ ] Works in Claude Code via `claude mcp add` (documented)
- [ ] No secrets in git history (secret scan documented)

## 8. Open decisions — ask me before coding

1. TypeScript strict (recommended) or plain JavaScript with JSDoc types?
2. Login: Instagram API with Instagram Login, Facebook Login for Business, or both? (Private replies and some messaging features require Facebook Login.)
3. Transport: stdio only for v1, or also Streamable HTTP with OAuth?
4. Storage: SQLite (recommended)?
5. Inbox data flow: polling only (recommended for v1) or a separate webhook receiver?
6. Enable the runtime LLM router in v1? Which provider, and daily token budget?
7. Instagram scheduling: local scheduler worker, or only Facebook native scheduling in v1?
8. Include Ad Library research (requires Meta identity verification)?
9. Where will Instagram media be hosted (public HTTPS URL required)?
10. License (MIT?).
