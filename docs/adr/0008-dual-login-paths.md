# ADR-0008 — Both Instagram Login and Facebook Login for Business

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed)
- **Evidence:** `docs/meta-endpoints.md` items 3a–3g, 4e (verified 2026-09-17)
- **Related:** ADR-0013, ADR-0014

## Context

Meta offers two authorization paths for Instagram professional accounts, and they are not interchangeable:

- **Instagram API with Instagram Login** — no Facebook Page required, OAuth directly against Instagram, `instagram_business_*`
  permissions.
- **Facebook Login for Business** — the Instagram account must be linked to a Facebook Page; uses `instagram_*` (without
  the `business_` prefix) plus `pages_*` permissions, and yields Page tokens.

Verification corrected a common assumption that shaped the original scope: **private replies and Instagram DMs no longer
require Facebook Login.** Both are documented natively under the Instagram Login tree
(`.../instagram-api-with-instagram-login/messaging-api/private-replies/`, `.../messaging-api/`). What genuinely requires
Facebook Login for Business is:

- **Facebook Page publishing and Page insights** (inherent — Instagram Login never touches Pages),
- **Business Discovery** (competitor lookup),
- **Hashtag Search**,
- **Facebook Messenger** (the Page inbox, as distinct from Instagram DMs).

Separately, messaging permissions on either path require **Advanced Access + App Review**; with Standard Access they work
only for accounts holding a role on the app.

## Options considered

1. **Instagram Login only.** Simplest onboarding, no Page requirement, and it now covers publishing, comments, DMs, private
   replies and Instagram insights. But it drops Facebook Pages entirely, and drops Business Discovery and Hashtag Search —
   which is most of the "Research" pillar in the project goal.
2. **Facebook Login for Business only.** Covers everything, at the cost of forcing every user to have a linked Facebook
   Page and to grant a broad `pages_*` scope set even if they only ever touch Instagram. Worst least-privilege story.
3. **Both, chosen per account, with permissions requested per enabled feature (chosen).** Most code, best privilege
   posture, and the only option that matches what the docs actually support.

## Decision

Support both paths. Each account row records its `login_path` (`ig` or `fb`), its granted scopes, and which features are
therefore available.

**Least privilege is per feature, not per app.** Scopes are requested only for features enabled in configuration, per the
permission map in `PLAN.md`. A user who only publishes to Instagram never grants messaging scopes; a user who never runs
competitor research never needs Facebook Login at all.

**Capability checks live in the service layer.** Before a feature runs, the service asserts that the account's login path
and granted scopes support it. Failures are actionable and name the fix, for example: *"Business Discovery requires Facebook
Login for Business; this account is authorized through Instagram Login. Re-authorize with the Facebook path to enable
competitor lookup."* Slices S14, S18 and S19 each carry a dedicated login-path guard test.

**`meta_account_health`** reports per account: platform, login path, token expiry, granted scopes, scopes missing for the
enabled features, and `needs_reauth` — and never the token or any prefix of it.

**Token handling differs by path** and is encapsulated in `src/meta/`: Instagram Login yields a long-lived Instagram token;
Facebook Login yields a long-lived user token that is exchanged for per-Page tokens. `appsecret_proof` is attached on the
Facebook path. Both are stored encrypted (ADR-0014) with `expires_at`, refreshed proactively, and on `AuthError` the account
is marked `needs_reauth` exactly once with no retry loop.

**README must document**, for App Review purposes, every permission requested, the feature that requires it, and the fact
that messaging needs Advanced Access.

## Consequences

**Positive.** An Instagram-only user gets a much lighter consent screen and never needs a Facebook Page. Feature
availability becomes explicit data rather than a runtime surprise. The corrected messaging finding means the heavier
Facebook path is now required only for Page publishing and the two research features.

**Negative.** Two token lifecycles, two permission vocabularies for the same capability
(`instagram_business_manage_comments` vs `instagram_manage_comments`), and a combinatorial test matrix — every inbox and
publish slice needs coverage on both paths. Error messages have to be written carefully so users understand *why* a
feature is unavailable.

**Verification obligation.** Exact scope strings are version-dependent and several in `docs/meta-endpoints.md` were
confirmed only by doc-tree placement, not by a fetched page. The first slice that uses a scope re-verifies it against
`developers.facebook.com` for the configured `META_GRAPH_VERSION` and updates the log (ADR-0013). The private-reply time
limit (item 4c, "7 days") is explicitly unverified and must be re-confirmed in slice S23 before it is enforced.
