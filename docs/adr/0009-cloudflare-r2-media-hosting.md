# ADR-0009 — Cloudflare R2 for Instagram media hosting

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed)
- **Evidence:** `docs/meta-endpoints.md` item 2g (public HTTPS media URL requirement, CONFIRMED)
- **Related:** ADR-0004

## Context

Instagram's Content Publishing API does not accept file uploads. `POST /{ig-user-id}/media` takes an `image_url` or
`video_url`, and Meta fetches the asset itself, so the URL must be **publicly reachable over HTTPS** for the duration of
container creation.

That requirement turns a publishing feature into an SSRF question. The URL arrives from a tool input — ultimately from a
model that may have read attacker-controlled text — and the server both validates it and hands it to Meta. A URL pointing
at `169.254.169.254`, `127.0.0.1` or an RFC1918 address is the classic cloud-metadata and internal-service attack, and a
public hostname that resolves to a private address (DNS rebinding) defeats naive string checks.

## Options considered

1. **Server uploads and hosts media itself.** Would need an HTTP server, which stdio-only v1 does not have (ADR-0006), plus
   TLS and a public address. Rejected.
2. **Accept any user-supplied public URL.** Maximum flexibility, maximum SSRF surface, and no guarantee the asset stays
   reachable long enough for Meta to fetch it. Rejected as the default.
3. **Cloudflare R2 with a public bucket (chosen).** S3-compatible, zero egress fees, a stable public HTTPS hostname, and —
   most usefully — a hostname that can be pinned in an allowlist so the SSRF question collapses from "is this URL safe?" to
   "is this our bucket?".
4. **A cloud bucket the server writes to with its own credentials.** Adds an SDK dependency and another secret to protect,
   for a capability the user can perform directly. Deferred.

## Decision

Media is hosted on **Cloudflare R2** and the server consumes **public HTTPS R2 URLs**. In v1 the server does not upload;
the user (or their tooling) places the asset in the bucket and passes the URL.

**Every media URL passes the validator in `src/lib/` (slice S11) before any container is created.** The controls, from the
`security-hardening` skill:

- `https:` scheme only. No `http:`, `file:`, `data:`, or anything else.
- No credentials in the URL, no non-standard port, no fragment.
- **DNS resolution first, then range checks on the resolved addresses** — reject loopback, private (RFC1918), link-local
  (including `169.254.169.254`), CGNAT (`100.64.0.0/10`), unique-local IPv6 (`fd00::/8`), multicast and broadcast.
  String matching on the hostname is not sufficient and is explicitly not the check.
- Redirects followed at most N times, with **every hop re-validated** — a public URL that redirects to an internal one is
  the same attack one step removed.
- `HEAD` (falling back to a ranged `GET`) confirms the content type is in the allowlist and `content-length` is within the
  configured maximum, before Meta is asked to fetch anything.
- **`MEDIA_URL_ALLOWLIST`** pins the acceptable hosts — normally just the R2 public bucket hostname. When set, it is the
  primary control and all of the above are defence in depth.
- Validation errors name the reason without echoing resolved internal IP addresses back to the caller.

The validator is pure and injectable (DNS resolver and fetch are dependencies), so every rejection case is unit-testable
without network access.

## Consequences

**Positive.** With the allowlist set, the SSRF surface is one known host. Zero egress cost makes Meta's repeated fetches
free. The validator is a small, isolated, heavily tested module that also protects any future feature accepting a URL.

**Negative.** The user must manage bucket lifecycle themselves — v1 does not upload, and it cannot guarantee the object
still exists when Meta fetches it (a 404 at fetch time surfaces as a container `ERROR`, handled by the publish graph's
fail edge). A public bucket means published assets are publicly readable, which is inherent to Meta's requirement but
should be stated in the README so nobody puts private material there expecting otherwise.

**Open item.** The R2 public hostname for `MEDIA_URL_ALLOWLIST` has not been provided — open question 12 in `PLAN.md`.
Until it is, the allowlist defaults to empty, which means "any public HTTPS host that passes the SSRF checks". That is
weaker than intended and should not be the shipped default configuration.

**Future.** Server-side upload (an R2 `PutObject` with credentials, or a presigned URL flow) is a clean additive slice
behind its own feature flag and its own ADR. It is out of scope for v1.
