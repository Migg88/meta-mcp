# ADR-0013 — Graph API version from config, and no hardcoded Meta limits

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** planner (per the `meta-graph-api` skill and the verification log)
- **Evidence:** `docs/meta-endpoints.md` items 1a, 1b, 2b, 2d–2f, 5b, 5d, 6a (verified 2026-09-17)
- **Related:** ADR-0008

## Context

Meta changes Graph API versions, metrics, limits and permissions frequently, and its own documentation pages sometimes
disagree with each other. The verification log shows this concretely rather than theoretically:

- The **daily publishing quota** appears as 25, 50 **and** 100 across different cached and versioned pages. No single number
  could be confirmed from the primary source.
- Caption length (2,200), hashtag count (30) and mention count (20) came only from third-party blogs and are marked
  **UNVERIFIABLE**.
- The rate-limit code range in the skill (`80001–80014`) is not confirmed as accurate or exhaustive — one source shows
  `80000` for Ads Insights, outside the stated range.
- `impressions` is deprecated in favour of `views` (Instagram media 2025-04-21, Facebook Page insights 2025-11-15) — both
  cutoffs are already in the past.
- Versions live roughly two years: **v20.0 expired 2026-09-24**; v21.0–v26.0 are the currently live window.

Any constant copied from memory or from a blog into `src/meta/` is therefore a latent bug with a known expiry date.

## Options considered

1. **Hardcode current values as constants.** Fast, and wrong within months — and in the quota case, wrong *today*, because
   the sources disagree.
2. **Read every limit from Meta at runtime.** Ideal where an endpoint exists (the publishing quota), impossible where none
   does (caption length).
3. **Config values with documented provenance, plus live reads wherever Meta exposes an endpoint (chosen).**

## Decision

**Version.** A single config value `META_GRAPH_VERSION`, default **`v26.0`**, validated against `/^v\d+\.\d+$/`. The base
URL and version come from config only; no module embeds a version in a path string. Never default below v21.0.

**The publishing quota is never hardcoded.** It is read live from `GET /{ig-user-id}/content_publishing_limit` on every
prepare, and `quota_usage`/`quota_total`/`quota_duration` are taken from the response. Slice S12 includes a test that greps
`src/` for `25`, `50` or `100` near quota identifiers and fails if any is found. The response field names themselves were
reconstructed from a third-party reproduction and must be re-verified before parsing.

**Other limits are config values with provenance.** Caption length, hashtag count, mention count, carousel child count,
private-reply time limit and the hashtag unique-query window all live in configuration, each with a comment naming its
source and verification date. Every value currently marked UNVERIFIABLE in `docs/meta-endpoints.md` must be re-verified by
`meta-docs-researcher` in the slice that first enforces it — S12 for caption/hashtag/mention, S19 for the hashtag window,
S23 for the private-reply limit — and the log updated before the code ships.

**Metrics go through an allowlist** maintained in `docs/meta-endpoints.md` and mirrored in config. `impressions` is
rejected with a message pointing at `views`.

**Rate-limit codes are matched by range, not enumeration.** Treat `4`, `17`, `32`, `613` and **any** code in `80000–80014`
as throttling, with unknown business-use-case codes defaulting to `RateLimitError` rather than `UnknownMetaError`.
Backoff is sized from `estimated_time_to_regain_access` in `X-Business-Use-Case-Usage` when present, and `X-App-Usage`
drives proactive slowdown before limits are hit.

**`docs/meta-endpoints.md` is a living verification log**, not documentation. Every endpoint, permission, metric and policy
records its doc link and verification date. The rule for every slice touching `src/meta/`: verify first, record, then code.
Re-verify before every release.

## Consequences

**Positive.** A Graph API version bump is a config change plus a verification pass, not a refactor. The quota cannot drift
because it is never stored. The verification log makes staleness visible — a reviewer can see exactly which facts were
confirmed from a primary source and which were not.

**Negative.** A live quota read costs an extra request on every publish prepare. Config carries values the user cannot
reasonably be expected to know, so `.env.example` must document each one with its source. Several values ship as
*unverified placeholders* until their slice re-checks them, which is a real correctness risk if a slice skips that step —
hence the explicit `meta-docs-researcher` step in S12, S17, S19 and S20 of the plan.

**Known outstanding verifications** (all blocked by the sandbox egress proxy on 2026-09-17, all must be redone against
`developers.facebook.com` before the affected slice): `content_publishing_limit` response field names; caption/hashtag/
mention limits; the private-reply time limit and whether it differs between Facebook and Instagram comments; the full
business-use-case rate-limit code set; the exact hashtag-search window figures; IG-Login insights permission names; the
Ad Library scope.
