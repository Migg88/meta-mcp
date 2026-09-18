# ADR-0010 — Ad Library research behind a feature flag

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed: in scope for v1, behind a flag)
- **Evidence:** `docs/meta-endpoints.md` item 5c (verified 2026-09-17)
- **Related:** ADR-0005, ADR-0008

## Context

The Ad Library API (`ads_archive`) exposes ads other advertisers are running — genuinely useful competitive research and a
natural companion to Business Discovery and hashtag search.

It is also the one research capability with a hard human prerequisite: access requires **Meta identity verification**
(government ID verification, plus business verification / App Review justification for the app). Political and issue ads
carry further advertiser-verification and disclaimer requirements. Verification confirmed the requirement exists; the
commonly cited "1–3 business days" turnaround came only from a blog and is explicitly **unverifiable**.

So the feature cannot be assumed to work for any given user of this repository, including someone cloning it to evaluate
the code. Meanwhile every registered tool costs tokens in the host's context on every single turn — a tool that will always
fail for most users is a permanent tax.

## Options considered

1. **Leave Ad Library out of v1.** Simplest, but drops a scoped feature the user wants and leaves a gap in the research
   pillar.
2. **Always register the tool; fail at call time with a helpful error.** Discoverable, but pays the token cost on every
   turn for a tool most installations can never use, and invites the model to retry a permanently failing call.
3. **Register only when `ADS_LIBRARY_ENABLED=true` (chosen).** Zero cost when off, full capability when on, and the flag
   doubles as documentation that a manual prerequisite exists.

## Decision

Implement `meta_ad_library_search` in v1 (slice S20) gated on `ADS_LIBRARY_ENABLED`, default **false**.

- When the flag is off, the tool is **not registered at all** — it does not appear in `tools/list` and costs no tokens.
  A contract test asserts absence when off and presence when on.
- When the flag is on but access fails on verification grounds, the error explains the identity-verification requirement
  and points at the documented process. It does **not** retry, and it does not assert any turnaround time — no fixed SLA is
  encoded anywhere, per the verification note.
- Results are paginated, and all ad creative text is third-party content: control characters stripped, fields truncated,
  wrapped and labelled as **untrusted data**, exactly as competitor captions are (slice S18's sanitizer is reused). Each
  result keeps its ad archive id so every claim is traceable to a source.
- The exact permission/scope for `ads_archive` was not independently verified and must be confirmed by
  `meta-docs-researcher` at the start of slice S20, then recorded in `docs/meta-endpoints.md` (ADR-0013).

The same flag pattern is the project's general answer to capability-gated features: gate registration, not just execution.

## Consequences

**Positive.** Default installations carry no token cost and no confusing dead tool. The flag makes the prerequisite
explicit at configuration time rather than at call time. Reviewers cloning the repo see a working server without needing
identity verification.

**Negative.** A conditionally registered tool means `tools/list` differs between configurations, so contract tests must
cover both, and the README must explain that the tool's absence is expected. Feature flags that change the tool surface are
a small ongoing complexity cost — acceptable here, but the pattern should not be applied liberally.

**Evidence gap.** If the user does not hold Meta identity verification (open question 11 in `PLAN.md`), slice S20 can only
be proven against mocked HTTP and `test/live/` stays empty for this feature. That is acceptable, but it must be recorded in
`STATUS.md` as a known evidence gap rather than silently passing as verified.
