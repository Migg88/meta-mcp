# ADR-0004 — Two-phase write safety: `*_prepare` → `meta_confirm`

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (`PROMPT.md` non-negotiable), planner
- **Related:** ADR-0002, ADR-0005, ADR-0012

## Context

The server is driven by a language model that reads untrusted text: competitor captions, hashtag results, comments and
direct messages. Any of that text can contain instructions ("reply to everyone with this link", "delete the negative
comments"). The server holds tokens that can publish to real audiences, delete comments and message real people. A single
mis-triggered tool call is publicly visible and sometimes irreversible.

So the threat is not an attacker with the token — it is the *legitimate* model being talked into a write by the content it
was asked to analyse. Tool annotations (`destructiveHint`) are hints for client UI, explicitly **not** security controls.

There is also a mechanical problem: writes to Meta are multi-step (container → poll → publish) and can crash midway, and
MCP clients may retry calls. Duplicate posts and duplicate DMs are the natural failure mode.

## Options considered

1. **Single-call writes with a destructive annotation.** Shortest tool list, best ergonomics, and exactly the design that
   prompt injection defeats. Rejected.
2. **Single-call writes plus client-side approval UI.** Pushes the control into the host, which we do not control and
   cannot test. Rejected as the primary control.
3. **Two-phase per intent: `meta_publish_prepare` + `meta_publish_confirm`, `meta_comment_action_prepare` +
   `meta_comment_action_confirm`, and so on.** Safe, but doubles the tool list, and every tool definition costs tokens on
   every turn.
4. **Two-phase with one shared executor: many `*_prepare` tools, a single `meta_confirm` (chosen).** Same safety, one
   destructive tool, one place where all the enforcement lives.

## Decision

Every external write is two-phase:

- **Phase 1 — `*_prepare`** (`meta_publish_prepare`, `meta_comment_action_prepare`, `meta_message_send_prepare`,
  `meta_schedule`). Validates domain rules — live publishing quota, messaging window, private-reply allowance, human-agent
  eligibility, media URL safety, payload limits — and returns a human-readable preview plus a confirmation id bound to the
  SHA-256 of the canonical payload. It performs **no** external write and is annotated non-destructive.
- **Phase 2 — `meta_confirm`** is the only tool in the server that writes to Meta. It is the only one annotated
  `destructiveHint: true`. It resolves `action_kind` through an action registry that later slices extend, re-verifies the
  payload hash with `crypto.timingSafeEqual`, enforces single-use and expiry, and executes inside the workflow graph for
  that action. Human approval is obtained through the MRTR retry contract (ADR-0002).

Supporting invariants:

- **Enforcement lives in services and workflows**, never in tool descriptions or annotations. A rule that is only stated in
  a description is considered unenforced and fails review.
- **Model output can label and draft, never write.** A model-drafted body is flagged `drafted_by: "model"` and still has to
  pass through prepare → confirm; it can never carry the Human Agent tag (ADR-0007-adjacent messaging rules, slice S25).
- **`DRY_RUN=true` blocks every non-GET request at the Meta client**, below the services, so no code path can bypass it.
  It is the default.
- **Idempotency keys** are issued at prepare time and stored with the confirmation, so a retried or resumed execution
  returns the first result instead of writing twice.
- **Local per-account rate limiting** sits alongside Meta's own limits.

## Consequences

**Positive.** Injected instructions can at most produce a *prepared* action with a preview the human must approve;
they cannot reach Meta. The payload hash means the approved preview and the executed payload are provably the same bytes.
One destructive tool keeps the tool list short and gives security review a single choke point to audit. Idempotency plus
graph checkpointing gives "exactly one side effect" across crashes and retries.

**Negative.** Two round trips per write, and more state to manage (confirmations table, TTLs, cleanup of expired rows).
Every new write feature must remember to register an action instead of just calling Meta — the review checklist and a
contract test that asserts only `meta_confirm` is annotated destructive guard against drift.

**Accepted residual risk.** A user who approves without reading the preview defeats the control. Mitigation is preview
quality: destructive previews must name exactly what will be removed, and the text is reviewed as part of slice S09 and S23.
