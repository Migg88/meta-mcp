# ADR-0017 — Webhooks as the primary inbox producer, polling retained as backfill

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (decision), planner (design)
- **Supersedes:** [ADR-0007](0007-polling-only-inbox-v1.md)
- **Related:** ADR-0014 (encryption at rest), ADR-0016 (transports), ADR-0018 (receiver deployment)
- **Evidence:** `.claude/skills/inbox-management/SKILL.md`; `docs/meta-endpoints.md` (webhook section to be written in S20a)
- **Slices:** S20a (receiver), S20b (normalization + queue), S20c (subscriptions + status + backfill), S21 (poller as
  backfill), S26 (reconciliation as downtime backstop)

## Context

ADR-0007 chose polling for v1 and **accepted a risk**: Meta delivers deletion notifications by webhook, and a polling API
simply stops returning a deleted item rather than announcing it. The `inbox-management` skill requires that "when Meta
sends a deletion notification, delete the stored message data", and this server stores encrypted message bodies, which are
personal data. ADR-0007 mitigated with a reconciliation job (S26) that purges anything Meta no longer returns, and
recorded the residual exposure honestly.

The user has now answered `PROMPT.md` section 8.5 with **webhooks**. Two structural facts make this much cheaper than it
would have been at planning time:

1. ADR-0007 required every inbound item to land in `inbox_events` with `(account_id, source, external_id, kind, payload,
   status, created_at)`, and forbade any reader from branching on `source`. The poller was always "just one producer".
2. ADR-0007 required the deletion handler (S26) to be written as a queue consumer, unit-tested by inserting a deletion
   event directly, before any webhook existed.

So the switch adds a producer. It does not change a single reader.

## Options considered

1. **Webhooks replace polling entirely.** Fewest moving parts and no duplicate-suppression problem — but it means that
   anything Meta fails to deliver, or that happens while the receiver or tunnel is down, or that predates the
   subscription, is simply lost, with no way to notice or recover. Rejected: webhook delivery is at-least-once at best and
   there is no catch-up API call that says "what did I miss".
2. **Polling stays primary, webhooks only for deletions.** Keeps the deletion fix but keeps the latency and the
   rate-limit burn, and leaves two inconsistent freshness models. Rejected as the worst of both.
3. **Webhooks primary, polling retained as backfill (chosen).** Webhooks carry the steady state; polling handles initial
   sync, gap recovery after downtime, and periodic reconciliation.

## Decision

Webhooks are the **primary** producer. Polling is **retained**, deliberately, for three jobs:

- **Initial sync** — history that predates the subscription.
- **Gap recovery** — anything missed while the receiver or the tunnel was down, triggered manually or by the
  `stale` signal from `meta_webhook_status` (S20c).
- **Reconciliation** (S26) — the fail-closed sweep that catches deletions which occurred during an outage.

Both producers write identical `inbox_events` rows, differing only in `source`, and no reader may branch on it. S20b's
`producer-parity.test.ts` asserts this directly: the same comment ingested by each path yields equal rows, and a reader
over both yields one item, not two. Exactly-once is enforced by a uniqueness constraint on
`(source_object, external_id, kind)`, so a Meta retry, a replayed request and an overlapping backfill poll all collapse to
one row.

Receiver rules (S20a, from the `inbox-management` and `security-hardening` skills):

- Answer the `hub.challenge` verification handshake, comparing `hub.verify_token` with `timingSafeEqual`.
- Verify `X-Hub-Signature-256` as HMAC-SHA256 over the **raw request body bytes**, captured before parsing and never
  re-serialized, keyed with the app secret, compared with `timingSafeEqual`. Invalid, missing or tampered signature →
  `401`, nothing enqueued, body never parsed.
- **Ack fast, then enqueue**: persist the verified envelope durably and return `200` within Meta's timeout; no Graph call,
  no decryption, no triage and no model on the request path. If the database is unavailable, return `503` without acking
  so Meta retries — never ack work that was not durably stored.
- **Never treat webhook content as instructions.** Payloads are third-party text: sanitized, truncated, labelled as
  untrusted data exactly like the competitor research in S18. The receiver has no tool registry and no model, so there is
  no code path by which payload content could act.
- Personal data in payloads is encrypted at rest with the S04 vault (ADR-0014).

## The ADR-0007 accepted risk is RESOLVED

**This is the point of the change, and it is a genuine improvement, not a regression.** ADR-0007's accepted risk — *"a
deletion notification from Meta is not received; a message or comment the person deleted on Meta's side remains in the
local encrypted store until noticed by other means"* — no longer applies. Meta's deletion notifications now arrive as
webhook events, normalize to `kind: "deleted"`, and drive the S26 purge path in near-real time.

`SECURITY.md` (S31a) must record this explicitly: the risk is listed as **RESOLVED by ADR-0017**, with the old wording
left visible rather than deleted, so the history reads as a decision that improved a known gap.

**Residual exposure, stated honestly.** Deletions that occur while the receiver or tunnel is down are not delivered (Meta
retries for a bounded period, then gives up). That window is covered by the S26 reconciliation sweep, which is now a
*backstop* rather than the primary defence. Retention limits continue to cap exposure independently. Since S26's
reconciliation is no longer the main mechanism, `PLAN.md` open question 10's proposed 30-day lookback may be tuned.

## Consequences

**Positive.** Near-real-time inbox freshness; deletion notifications honoured properly; far less rate-limit budget burned
on polling; and the privacy/compliance gap that ADR-0007 had to write down as accepted is closed. Because the queue shape
was designed for this, S21–S26 need no redesign.

**Negative.** A second long-running process with its own deployment story (ADR-0018), a signature-verification surface,
duplicate-suppression and out-of-order handling that polling never needed, and a real evidence limitation: **webhook
delivery cannot be proven end to end in CI.** It needs a public callback URL, a registered Meta app and Meta actually
sending. S20a/S20b therefore test the handshake, signature verification, enqueue, dedupe and ack contract against
**synthetic requests** whose signatures are computed in-test from a test app secret, which proves every line of our logic;
real delivery is a manual `LIVE_TESTS=true` run recorded in `STATUS.md` with a date. This is recorded as a known evidence
gap, not papered over.

Also negative: `docs/meta-endpoints.md` currently has **no webhook section at all**, so every field name — handshake
parameters, signature header, payload envelope, `subscribed_fields`, retry behaviour — must be verified by
`meta-docs-researcher` before S20a is written. Nothing in the receiver may be reconstructed from memory.
