---
name: meta-graph-api
description: Rules for integrating Meta's Graph API (Facebook Pages, Instagram professional accounts, insights, Business Discovery, hashtag search, Ad Library) safely and correctly. Use this skill whenever code touches the `src/meta/` module, access tokens, permissions, publishing endpoints, rate limits, Meta error codes or any Meta metric — even for small changes.
---

# Meta Graph API integration

## Golden rule: verify, don't remember

Meta changes endpoints, metrics, limits and permissions often, and its docs sometimes disagree with each other. Before using any endpoint, field, metric or permission:

1. Check the official docs (developers.facebook.com) for the configured `META_GRAPH_VERSION`.
2. Record it in `docs/meta-endpoints.md`: endpoint, permission(s), doc link, verification date, notes.
3. Never rely on blog posts or third-party SDK constants for limits or versions.

## Client design (`src/meta/`)

- One function performs HTTP: `graphRequest({ method, path, params, token })`. Everything else builds on it.
- Base URL and version come from config only.
- Send the token in the `Authorization: Bearer` header, never in the query string.
- Add `appsecret_proof` (HMAC-SHA256 of the token keyed with the app secret) when using Facebook Login tokens, and enable "Require App Secret" in the app settings.
- Always request explicit `fields`. Never rely on defaults.
- Timeouts on every request (`AbortSignal.timeout`).
- Parse responses with a schema. Unknown shapes become a typed error, not a crash.
- Follow cursor pagination with a hard page limit.

## Errors and rate limits

- Map Meta errors (`error.code`, `error_subcode`, `fbtrace_id`) to domain errors: `AuthError`, `PermissionError`, `RateLimitError`, `ValidationError`, `TransientError`, `UnknownMetaError`.
- Rate-limit codes to treat as throttling (verify current list): app `4`, user `17`, page `32`, custom `613`, business use case `80001–80014`.
- Read usage headers (`X-App-Usage`, `X-Business-Use-Case-Usage`) and slow down **before** hitting limits.
- Retry with exponential backoff + jitter only for throttling/transient errors, with a max attempt count. Never blindly retry a non-idempotent POST: the workflow graph decides.
- Keep `fbtrace_id` in logs (it is not secret) for debugging.

## Tokens

- Flow: short-lived user token → long-lived user token → Page tokens (Facebook Login) or long-lived Instagram token (Instagram Login). Confirm current lifetimes in docs.
- Store only encrypted tokens (see `security-hardening`). Track `expires_at`.
- `meta_account_health` uses the token debug endpoint to report expiry and granted scopes, without exposing the token.
- Refresh proactively before expiry. On `AuthError`, mark the account as needing re-auth; don't loop.

## Publishing

**Facebook Page**: page feed/photos/videos endpoints with the Page token. Native scheduling uses `published=false` + `scheduled_publish_time` (verify allowed window).

**Instagram**: 
1. `POST /{ig-user-id}/media` → container id (store it immediately).
2. Poll `GET /{container-id}?fields=status_code` until `FINISHED` (handle `ERROR`, `EXPIRED`).
3. Check `GET /{ig-user-id}/content_publishing_limit` — never hardcode the quota.
4. `POST /{ig-user-id}/media_publish` with `creation_id`.
5. Read back the media to verify.

Carousels create child containers first. Media URLs must be public HTTPS. Validate caption length, hashtag and mention counts against current documented limits before creating containers.

## Research

- **Insights**: metric names are version-dependent and some are deprecated (e.g. the move toward "views"). Validate requested metrics against an allowlist maintained in `docs/meta-endpoints.md`.
- **Business Discovery**: only public data of professional accounts; respect field limits.
- **Hashtag search**: has a limit on unique hashtags per account per rolling window — track usage locally and report remaining quota.
- **Ad Library**: requires identity verification; keep behind a feature flag.

## Comments and messages

Follow the `inbox-management` skill: messaging windows, private replies, Human Agent tag, webhooks and deletion rules.

## Compliance

- Request only the permissions each enabled feature needs; list them in README for App Review.
- Implement the data deletion and deauthorization callbacks if running as a hosted app.
- Store the minimum data needed; define retention for research caches.
