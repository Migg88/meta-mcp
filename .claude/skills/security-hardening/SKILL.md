---
name: security-hardening
description: Threat model and security checklist for meta-content-mcp — secrets, token vault, prompt injection, SSRF, logging, supply chain, CI and transports. Use this skill in every REVIEW step of the dev loop, and whenever code handles tokens, config, external URLs, third-party content, logs, dependencies, GitHub Actions or HTTP endpoints — even if the change looks small.
---

# Security hardening

## Threat model (keep `SECURITY.md` in sync)

| Asset | Threat | Control |
|---|---|---|
| Meta access tokens | Leak via logs, errors, tool output, git | Encrypted vault, redaction, never returned, secret scanning |
| Publishing ability | Prompt injection makes the model post | Two-phase confirm bound to payload hash, human approval, DRY_RUN |
| Research content, comments, DMs | Malicious text instructs the model | Treat as untrusted data, sanitize, label in output; drafts never trigger writes |
| Personal data in DMs/comments | Leak, over-retention | Encrypt bodies at rest, mask in logs, retention + purge, honor Meta deletion notifications |
| LLM provider key and spend | Leak, runaway cost | Encrypted config, token budgets, usage records |
| Media URLs | SSRF / internal network access | HTTPS only, DNS resolve + block private ranges, size/type limits |
| Local database | Tampering or theft | File permissions `0600`, no secrets in plain text |
| Dependencies / CI | Supply-chain compromise | Lockfile, audit, pinned actions, minimal deps |

## Checklist (paste results with evidence into STATUS.md)

### Secrets and tokens
- [ ] Config parsed and validated at startup; the process exits with a clear message if something is missing. No defaults for secrets.
- [ ] `.env` is git-ignored; `.env.example` has placeholders only.
- [ ] Tokens encrypted at rest with AES-256-GCM (`node:crypto`), random IV per record, auth tag verified. Encryption key from env or OS keychain, never stored next to the DB.
- [ ] No tool, resource, error or log ever contains a token (tested: search outputs for token-like patterns).
- [ ] `appsecret_proof` used where supported; token sent in header, not URL.
- [ ] Secret scanning (e.g. gitleaks) runs in CI.

### Input and output
- [ ] Every tool input validated with strict schemas and bounds.
- [ ] Media URLs: `https:` only, resolve DNS and reject private, loopback and link-local ranges, verify content type and size.
- [ ] Third-party text: strip control characters, truncate, wrap as data. Never concatenated into instructions or prompts as if it were ours.
- [ ] Errors are generic to the client with a correlation id; details only in redacted logs.

### Write safety
- [ ] External writes only through `*_prepare` → `*_confirm`; confirmation ids random (`crypto.randomUUID`), single-use, expiring, bound to payload hash. Compare hashes with `crypto.timingSafeEqual`.
- [ ] Idempotency key prevents duplicate posts on retries and resumes.
- [ ] `DRY_RUN` blocks every write endpoint at the Meta client level (tested).
- [ ] Local rate limiting per account in addition to Meta's limits.

### Inbox and messaging
- [ ] Messaging window enforced in the service layer (not only in tool descriptions).
- [ ] Human Agent tag impossible to attach to drafted or automated sends (tested).
- [ ] Private reply limited to one per comment (tested).
- [ ] Message bodies encrypted at rest; retention job and purge command exist.
- [ ] Deletion notifications remove stored data (tested).

### LLM router (if enabled)
- [ ] Provider key encrypted, never logged; router disabled by default.
- [ ] Model outputs schema-validated; they can label and draft but never call a write.
- [ ] Per-run and daily token budgets enforced (tested).

### Logging
- [ ] Structured logs to stderr only; a redaction layer removes `access_token`, `Authorization`, `appsecret_proof`, `client_secret`, codes and cookies (unit tested).
- [ ] No full request/response bodies logged by default.

### Storage
- [ ] Parameterized queries only.
- [ ] DB and data directory created with restrictive permissions.
- [ ] Retention policy for research caches; a command to purge an account's data.

### Supply chain and CI
- [ ] Minimal dependencies, each justified in an ADR; lockfile committed; `npm ci` in CI.
- [ ] `npm audit --audit-level=high` in the verify gate.
- [ ] GitHub Actions pinned by commit SHA, `permissions: contents: read` by default.
- [ ] Dependabot (or Renovate) configured.
- [ ] If published to npm: provenance enabled, `files` allowlist in `package.json`.

### HTTP transport (only if enabled)
- [ ] Authorization per the MCP spec; tokens issued for this server are audience-checked; no token passthrough.
- [ ] `Origin` validated; bound to `127.0.0.1` unless explicitly deployed.
- [ ] Webhooks (if any) verify `X-Hub-Signature-256` with `timingSafeEqual` on the raw body.

## Review procedure

1. `git diff` the slice and mark which rows of the threat model it touches.
2. Walk the matching checklist sections. Each checked item needs evidence: a test name, a command output or a file reference.
3. Anything unchecked is a blocker unless the user explicitly accepts the risk (record it in `SECURITY.md` under "Accepted risks").
