# ADR-0007 — Polling-only inbox in v1, and the deletion-notification risk

- **Status:** Accepted (planning default — user decision still **open**, see `PLAN.md` open question 4)
- **Date:** 2026-09-18
- **Deciders:** planner (proposed), user (to confirm, including the accepted risk)
- **Evidence:** `.claude/skills/inbox-management/SKILL.md`; `docs/meta-endpoints.md` items 4a–4e
- **Related:** ADR-0006

## Context

Comments and direct messages can reach the server two ways: polling Meta's endpoints, or receiving webhooks. Webhooks are
push, so they need a publicly reachable HTTPS endpoint, a TLS-terminating host, a verification-challenge handler, and
`X-Hub-Signature-256` validation with `timingSafeEqual` over the **raw** body. With stdio-only transport (ADR-0006) there is
no HTTP server in the process at all, so a webhook receiver would be a second process with its own deployment story.

There is one asymmetry that polling cannot paper over: **Meta delivers deletion notifications by webhook**. When a person
deletes a message or a comment, the polling API simply stops returning it — there is no "deleted" event to read. The
`inbox-management` skill requires that "when Meta sends a deletion notification, delete the stored message data", and the
server stores encrypted message bodies, which are personal data.

## Options considered

1. **Polling only (chosen for v1).** No public endpoint, no TLS, no signature verification, no second process. Costs
   latency (bounded by the poll interval) and, critically, loses real-time deletion notifications.
2. **Webhook receiver in v1.** Real-time everything including deletions — but requires a public HTTPS host, a second
   process, signature verification code and its own threat model, all before a single inbox feature ships.
3. **Polling plus a hosted relay (ngrok/tunnel).** Convenience with a third party inserted into the path of personal data.
   Rejected on privacy grounds.

## Decision

v1 polls, with these structural commitments so that adding webhooks later is additive (deferred slice **A2**):

- **Incremental `since` cursors per account**, stored in a `cursors` table. The cursor advances only for pages that were
  fully persisted, so an interrupted poll leaves no gap.
- **All inbound items land in `inbox_events`**, a queue table with `(account_id, source, external_id, kind, payload,
  status, created_at)`. The poller is just one producer. A future webhook receiver writes rows in the same shape, and
  **readers never learn which process wrote them**. No reader may branch on `source`.
- **The deletion handler is written now** (slice S26) as a consumer of `inbox_events` rows of kind `deleted`, even though in
  v1 nothing produces them from a webhook. It is unit-tested by inserting a deletion event directly. When A2 ships, the
  receiver only has to insert rows.
- Poll intervals and lookbacks are configuration, respecting Meta rate limits and the usage headers.

### Accepted risk: delayed honouring of deletion notifications

**Risk.** Because v1 has no webhook receiver, a deletion notification from Meta is not received. A message or comment the
person deleted on Meta's side remains in the local encrypted store until it is noticed by other means. This is a privacy
and compliance gap, not merely a freshness gap.

**Mitigation — reconciliation and purge job (slice S26), mandatory, not optional:**

1. A scheduled reconciliation re-reads items within a configurable lookback (proposed 30 days) and **purges any stored item
   Meta no longer returns**, treating absence upstream as deletion.
2. The job is **fail-closed**: if Meta returns an error or a partial result, it purges nothing, so a transient API failure
   can never cause mass false-positive deletion.
3. Retention limits cap exposure independently of deletions (proposed: message bodies 90 days, comments 180 days).
4. A manual purge command removes all data for an account or an individual person across every table.
5. Bodies are encrypted at rest throughout (ADR-0014), so the residual exposure is to someone holding both the database
   file and the encryption key.

**Residual exposure.** Up to one reconciliation interval, bounded by the lookback window. Items deleted upstream *older*
than the lookback are caught only by the retention policy. This must be recorded in `SECURITY.md` under "Accepted risks"
and stated plainly in the README — a portfolio project should not quietly under-claim a compliance gap.

**Trigger to revisit.** If this server is ever used for an account that is not the author's own, or is deployed for another
person's data, webhooks stop being optional and slice A2 becomes required.

## Consequences

**Positive.** No public attack surface, no second process, no TLS or tunnel to operate in v1. The queue-table shape means
webhooks can be added later without touching a single reader. Polling is far easier to test deterministically — no signature
fixtures, no replay concerns.

**Negative.** Inbox freshness is bounded by the poll interval. Polling burns rate-limit budget that webhooks would not.
And the deletion gap above, which is the real cost of this decision.

**Additive path (A2).** A separate process: HTTPS, challenge response, `X-Hub-Signature-256` verified with
`timingSafeEqual` on the raw body, fast ACK, insert into `inbox_events`, never treat webhook content as instructions.
Its tests are already specified in the `inbox-management` skill (valid, invalid, missing, tampered signature).
