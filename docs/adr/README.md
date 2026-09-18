# Architecture Decision Records

One ADR per significant decision. Format: Context · Options considered · Decision · Consequences.
Status values: `Proposed` · `Accepted` · `Superseded by ADR-XXXX` · `Deprecated`.

Never edit an accepted ADR to change its decision — write a new one that supersedes it.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-mcp-sdk-v2-and-spec-revision.md) | MCP TypeScript SDK v2 and spec revision 2026-07-28 | Accepted | 2026-09-18 |
| [0002](0002-elicitation-confirmation-contract.md) | Confirmation contract on the MRTR retry model | Accepted | 2026-09-18 |
| [0003](0003-node-sqlite-storage.md) | Storage on the native `node:sqlite` module | Accepted | 2026-09-18 |
| [0004](0004-two-phase-write-safety.md) | Two-phase write safety: `*_prepare` → `meta_confirm` | Accepted | 2026-09-18 |
| [0005](0005-runtime-router-off-by-default.md) | Runtime LLM router implemented but disabled by default | Accepted | 2026-09-18 |
| [0006](0006-stdio-only-transport-v1.md) | stdio-only transport in v1 | **Superseded by [0016](0016-dual-transport-stdio-and-streamable-http.md)** | 2026-09-18 |
| [0007](0007-polling-only-inbox-v1.md) | Polling-only inbox in v1 and the deletion-notification risk | **Superseded by [0017](0017-webhooks-primary-inbox-with-polling-backfill.md)** | 2026-09-18 |
| [0008](0008-dual-login-paths.md) | Both Instagram Login and Facebook Login for Business | Accepted | 2026-09-18 |
| [0009](0009-cloudflare-r2-media-hosting.md) | Cloudflare R2 for Instagram media hosting | Accepted | 2026-09-18 |
| [0010](0010-ad-library-behind-flag.md) | Ad Library research behind a feature flag | Accepted | 2026-09-18 |
| [0011](0011-typescript-esm-node22-toolchain.md) | TypeScript strict, ESM, Node 22 LTS, and the dependency budget | Accepted | 2026-09-18 |
| [0012](0012-in-repo-graph-engine.md) | In-repo workflow graph engine, no graph library | Accepted | 2026-09-18 |
| [0013](0013-graph-version-and-no-hardcoded-limits.md) | Graph API version from config, no hardcoded Meta limits | Accepted | 2026-09-18 |
| [0014](0014-encryption-at-rest-and-key-management.md) | AES-256-GCM encryption at rest and key management | Accepted | 2026-09-18 |
| [0015](0015-instagram-scheduling-local-worker.md) | Instagram scheduling via a local worker | Accepted | 2026-09-18 |
| [0016](0016-dual-transport-stdio-and-streamable-http.md) | Both transports: stdio by default, Streamable HTTP with OAuth alongside | Accepted | 2026-09-18 |
| [0017](0017-webhooks-primary-inbox-with-polling-backfill.md) | Webhooks as the primary inbox producer, polling retained as backfill | Accepted | 2026-09-18 |
| [0018](0018-webhook-receiver-standalone-behind-cloudflare-tunnel.md) | Webhook receiver: standalone loopback process behind Cloudflare Tunnel | Accepted | 2026-09-18 |
