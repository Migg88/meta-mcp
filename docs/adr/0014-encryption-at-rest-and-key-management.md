# ADR-0014 — AES-256-GCM encryption at rest and key management

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** planner (per the `security-hardening` skill); key source is **open question 8** in `PLAN.md`
- **Related:** ADR-0003, ADR-0007, ADR-0008

## Context

The local SQLite database holds two classes of material that must not be readable from the file alone:

- **Meta access tokens** — long-lived user tokens, Page tokens, Instagram tokens. Whoever holds one can publish, delete
  comments and read direct messages, for as long as it lives.
- **Personal data** — direct message bodies and comment text belonging to third parties who never consented to being stored
  on this machine. Under the polling-only decision (ADR-0007) this data may also outlive its upstream deletion by up to one
  reconciliation window, which raises the stakes on at-rest protection.

The threat model is a stolen or backed-up database file, an over-broad `tar` of the home directory, or a synced folder —
not a live attacker with code execution, against whom at-rest encryption does nothing.

## Options considered

1. **Plaintext with `0600` file permissions.** Trivial, and one careless backup away from leaking tokens. Rejected.
2. **Whole-database encryption (SQLCipher / `better-sqlite3-multiple-ciphers`).** Encrypts everything including indexes,
   but requires a native dependency, contradicting ADR-0003 and ADR-0011, and would force the storage decision to be
   reopened.
3. **Field-level AES-256-GCM with `node:crypto` (chosen).** Zero dependencies, authenticated encryption, and the sensitive
   fields are a small, well-defined set. Leaves metadata (ids, timestamps) in the clear.
4. **OS keychain for tokens, plaintext for message bodies.** Protects the higher-value asset but abandons the personal data,
   which is the part with a compliance dimension.

## Decision

Field-level **AES-256-GCM** via `node:crypto`, applied in `src/storage/vault.ts`.

- **Encrypted fields:** every access token and refresh token; every message body; comment body text. Ids, timestamps,
  labels and counters stay in the clear so they remain indexable and queryable.
- **Per record:** a fresh random 12-byte IV, stored alongside the ciphertext and the GCM auth tag. The same plaintext
  encrypted twice must produce different ciphertexts, and that is asserted by test.
- **Auth tag verified on every decrypt.** A tampered ciphertext or tag throws a typed `CryptoError`; no partial plaintext is
  ever returned.
- **Key:** 32 bytes, base64, from `META_MCP_ENCRYPTION_KEY`. Validated at startup for length and encoding — the process
  exits with a clear message otherwise. **The key never lives next to the database**, is never written to disk by the
  server, never logged, and never appears in tool output or errors.
- **Additional authenticated data:** the record's table and primary key are passed as AAD, so a ciphertext cannot be moved
  from one row to another.
- **Defence in depth:** the data directory is created `0700` and the DB file `0600` (ADR-0003); logs redact token-like
  patterns and mask usernames and message bodies; tokens are never returned by any tool, resource or error.
- **Tests (slice S04):** round-trip; unique IV; tampered ciphertext rejected; tampered auth tag rejected; wrong key
  rejected; identical plaintext yields differing ciphertext; and a **raw byte scan of the database file** asserting the
  plaintext token does not appear. The byte-scan test is repeated for message bodies in slice S24.

**Key rotation** is not implemented in v1. Recovery from a lost or rotated key is re-authorization: tokens are reissued
through the login flows and encrypted message bodies are purged. This is documented rather than automated.

## Consequences

**Positive.** A stolen database file yields no tokens and no message text. Authenticated encryption means silent tampering
is detected rather than decrypted into garbage. No new dependency, so the storage layer stays third-party-code-free.

**Negative.** Metadata is not encrypted — who messaged which account and when is visible in a stolen file, which is itself
meaningful information and must be stated honestly in `SECURITY.md`. Encrypted bodies cannot be searched with SQL, so
`meta_content_search` operates over local drafts, tags and captions rather than over DM bodies. Every read of a message
body pays a decrypt. Losing the key means losing the data.

**Accepted risk.** With the key in an environment variable, a process that can read this process's environment — or a
shell history, or a process listing on some platforms — can obtain it. This is standard for local developer tooling but is
weaker than an OS keychain. Record it in `SECURITY.md` under "Accepted risks".

**Open question 8 in `PLAN.md`:** confirm the environment-variable key source for v1, with OS keychain integration
(`libsecret` / Keychain / DPAPI) deferred to a later additive slice and its own ADR.
