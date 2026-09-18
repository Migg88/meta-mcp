# ADR-0005 — Runtime LLM router implemented but disabled by default

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed)
- **Evidence:** `docs/research/mcp-sdk-verification.md` items 1d, 4a–4c (verified 2026-09-17)
- **Related:** ADR-0001, ADR-0004

## Context

The host (Claude Code, Claude Desktop) already has a capable model. For most tasks the cheapest possible architecture is
for the server to return small, pre-filtered, structured data and let the host reason — the server calling its own model
would mean paying twice.

But bulk work breaks that: triaging 500 comments through the host means shipping 500 comment bodies into the host context,
which is expensive and slow. For that case a server-side router using a cheap tier is genuinely cheaper.

`PROMPT.md` section 7 requires `docs/cost.md` to show a **measured** comparison — triage of 200 fixture comments with
rules + router versus everything sent to the host model. That measurement cannot exist unless the router exists.

Two facts from verification shape the implementation: MCP **Sampling is deprecated** in spec `2026-07-28` (so the server
must call a provider API directly rather than asking the client to sample), and Anthropic pricing offers a **50% batch
discount** and **up to 90% off cached prompt reads**, which stack.

## Options considered

1. **No router at all.** Cheapest to build, smallest attack surface — but makes the required cost measurement impossible
   and leaves bulk triage unusable.
2. **Router enabled by default.** Best out-of-box triage, but it makes an API key mandatory, spends the user's money
   without them asking, and enlarges the default attack surface of a server whose main selling point is restraint.
3. **Router implemented, `LLM_ROUTER_ENABLED=false` by default (chosen).** The code and its tests ship; the behaviour is
   opt-in; the measurement is reproducible by anyone who flips the flag.
4. **MCP Sampling.** Deprecated in the target revision. Rejected outright.

## Decision

Implement the router in v1 with `LLM_ROUTER_ENABLED=false` as the default.

- **Provider:** Anthropic, called directly (not via Sampling).
- **Tiers from config, never hardcoded:** `fast=claude-haiku-4-5`, `balanced=claude-sonnet-5`, `deep=claude-opus-5`.
  Bare aliases, not dated snapshots, per the verification log.
- **Pipeline per item:** deterministic rules in code → `fast` tier → escalate to `balanced` once, only on invalid output or
  confidence below the task threshold. Invalid twice is an error; the router never guesses.
- **Efficiency:** static per-task system prompts so provider prompt caching applies; content-hash cache keyed by
  `sha256(taskKind + normalized content)`; batch API for non-urgent bulk jobs.
- **Budgets:** a per-run and a per-day `TokenBudget`. Exhaustion stops the run with a clear message and the caller returns
  partial results explicitly marked as partial.
- **Usage accounting:** every completion writes task, model, input/output tokens and cache-hit status to `llm_usage`,
  surfaced as the `meta://usage` resource.

Hard boundaries:

- When the flag is off, **no provider client is constructed and no API key is required by config validation** — the server
  is fully functional without one.
- `src/llm/` makes **no Meta calls**; `src/tools/` never imports it directly.
- **Model output is untrusted.** It is schema-validated, and it can label and draft but can never trigger a write —
  writes still go through prepare → confirm (ADR-0004).
- The provider key is handled like a Meta secret: encrypted at rest, never logged, never in tool output.
- No provider calls in CI. Tests fake the `LlmClient` interface; the cost harness replays a recorded transcript.

## Consequences

**Positive.** The default install is cheap, key-free and has a smaller attack surface, while the capability and its
evidence both exist. Off-by-default makes the cost story credible: the comparison is measured with the flag on, and the
recommended configuration is still the flag off.

**Negative.** Code that ships disabled is code that can rot. Mitigations: the router's unit tests (fast path, escalation,
invalid output, cache, per-run and daily budget) run in CI regardless of the flag, and slice S29's harness exercises the
full pipeline deterministically.

**Follow-up.** Default budget values are open question 5 in `PLAN.md` (proposed `LLM_DAILY_TOKEN_BUDGET=200000`,
`LLM_RUN_TOKEN_BUDGET=50000`). Model ids and prices must be re-verified against provider docs at the time of the S29
measurement, with the price source and date printed in `docs/cost.md`.
