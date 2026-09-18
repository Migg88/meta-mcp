# ADR-0002 — Confirmation contract on the MRTR retry model

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed the constraint), planner
- **Evidence:** `docs/research/mcp-sdk-verification.md` item 2e (verified 2026-09-17)
- **Related:** ADR-0001, ADR-0004

## Context

`PROMPT.md` says to "use Multi Round-Trip Requests to ask the human for approval when the client supports it". Verification
showed this is **not** a push channel and not a callback API, which changes the design materially:

> A tool handler that needs input **returns** `resultType: "input_required"` (`inputRequired.elicit(...)` /
> `inputRequired.elicitUrl(...)` in the TS SDK) instead of a normal result. The client answers the elicitation and then
> **retries the original `tools/call`** with `inputResponses` plus an opaque `requestState`. The SDK offers
> `createRequestStateCodec` for typed, tamper-evident state across rounds, and enforces a round limit.

Combined with the stateless core (ADR-0001), this means a confirmation flow is not "pause and wait" — it is
"return, get called again, and recognise where you were". A naive implementation has three failure modes:

- consuming the confirmation id on the first (pre-approval) call, so the retry finds it already used;
- treating each retry as a fresh intent, so a client that retries twice publishes twice;
- trusting `requestState` as authenticated state and letting a tampered value change what gets executed.

## Options considered

1. **Consume the confirmation id on the first call, re-issue a new one in the elicitation.** Simple, but the id no longer
   survives the retry, and the payload the user approved is not provably the payload that executes.
2. **Carry the whole payload inside `requestState`.** Avoids storage, but puts caption text and recipient ids into a value
   that travels through the client, and makes "single-use" impossible to enforce server-side.
3. **Server-side confirmation record; `requestState` carries only the id and a nonce.** The confirmation row is the single
   source of truth: id, `action_kind`, payload, SHA-256 payload hash, `expires_at`, `used_at`, `idempotency_key`. The retry
   re-presents the id; the server re-checks hash, expiry and single-use, then consumes it inside the same transaction that
   records execution.
4. **Skip elicitation entirely; require two explicit tool calls.** Works on every client, but loses the in-call approval UX
   the spec now offers.

## Decision

Take option 3, with option 4 as the automatic fallback when the client does not advertise elicitation.

The contract:

1. `*_prepare` validates domain rules, stores a confirmation row and returns a preview plus the confirmation id. It makes
   **no** external write.
2. `meta_confirm(confirmation_id)` loads the row. If the client supports elicitation and no approval has been recorded, the
   handler **returns** `inputRequired.elicit({...})` carrying the human-readable preview — the row is *not* consumed, its
   `expires_at` is *not* extended.
3. The client retries `tools/call` with `inputResponses` + `requestState`. `requestState` carries only the confirmation id
   and a nonce, encoded with the SDK's request-state codec; it is treated as **untrusted** and cross-checked against the
   stored row. A mismatch aborts.
4. On approval the server recomputes the SHA-256 of the canonical-JSON payload it is about to execute and compares it to the
   stored hash with `crypto.timingSafeEqual`. Only on a match does it mark `used_at` and execute, in one transaction.
5. A rejected elicitation marks the row rejected. Any later use of the id fails as `already_used`.
6. Execution is additionally guarded by the `idempotency_key`: a duplicate retry after a network failure returns the first
   result instead of writing again.

Confirmation ids are `crypto.randomUUID()`, default TTL 10 minutes, single-use, never reused across actions.

## Consequences

**Positive.** The id survives the retry because nothing consumes it until approval. Single-use and expiry are enforced
where state actually lives. The payload the user saw is cryptographically bound to the payload that executes, so prompt
injection between prepare and confirm cannot swap the content. The design degrades cleanly to a two-call flow on clients
without elicitation, and works unchanged under a stateless protocol.

**Negative.** Every write path pays a database round trip and a canonical-JSON hash. Canonical serialization must be exact
and key-order independent, or hashes will mismatch spuriously — this gets its own unit test. The TTL is a real UX edge: a
user who walks away mid-approval must re-run `*_prepare`.

**Testing obligation (slice S09).** A second retry carrying the same `requestState` must not execute twice; a tampered
`requestState` must be rejected; expired, reused and hash-mismatched ids must each be rejected with no side effect.
