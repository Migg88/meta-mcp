# ADR-0003 — Storage on the native `node:sqlite` module

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed)
- **Related:** ADR-0011, ADR-0014

## Context

The server needs durable local state: accounts, encrypted tokens, drafts, tags, confirmations, workflow checkpoints,
comments, conversations, encrypted message bodies, polling cursors, hashtag-query history and LLM usage. It is a
single-process, single-user, local stdio server (ADR-0006), so an embedded database is the right shape.

This is a public portfolio project with a security-first framing, so supply-chain surface is part of the argument:
every dependency must be justified, and a database driver with native bindings is one of the heavier things a Node project
can pull in.

`node:sqlite` is Node's built-in SQLite binding. Its status, verified 2026-09-18 against `doc/api/sqlite.md` in the Node
source tree: added in v22.5.0 behind `--experimental-sqlite`; **unflagged since v22.13.0** (and v23.4.0) while still marked
experimental; **Stability 1.2 - release candidate since v24.15.0** (and v25.7.0). On any Node 22 we would support there is
therefore no flag and no shim - `require('node:sqlite')` works as-is, emitting only an `ExperimentalWarning` on stderr.
Confirmed empirically on Node v22.22.2. That warning is harmless here because the stdio transport reserves stdout for
protocol frames and all diagnostics already go to stderr (ADR-0006); `--disable-warning=ExperimentalWarning` silences it
if it ever proves noisy.

## Options considered

1. **`better-sqlite3`** — the de-facto standard: mature, synchronous, excellent API, widely deployed. Costs a native
   addon with prebuilt binaries per platform/ABI, a transitive dependency tree, and a rebuild step that breaks on Node
   upgrades. Every install pulls compiled code from the registry.
2. **`node:sqlite` (chosen)** — zero dependencies, zero native build step, ships with the runtime, same synchronous
   statement model. Costs: experimental status in Node 22, a smaller API surface, and less community documentation.
3. **`libsql` / `@libsql/client`** — adds replication and remote options this project does not need.
4. **JSON files on disk** — no dependency at all, but no transactions, no concurrent-safe job claiming, no indexed search.
   The scheduler's "claim a job exactly once" (S15) and the workflow checkpointing (S08) both need real transactions.

## Decision

Use `node:sqlite`. All database access is confined to `src/storage/`, behind repository functions and a narrow driver
interface (`prepare`, `run`, `all`, `get`, `transaction`) so the concrete binding is replaceable in one file.

Operational rules:

- Parameterized statements only; no value is ever interpolated into SQL.
- The data directory is created `0700` and the database file `0600`.
- Schema changes go through numbered migrations applied inside a single transaction, tracked in `schema_migrations`.
- WAL journal mode and `foreign_keys = ON` set at open.
- No secret is ever stored in plaintext; tokens and message bodies are encrypted before they reach a statement (ADR-0014).

## Consequences

**Positive.** Zero third-party code in the persistence layer — the smallest possible supply-chain surface for the component
holding the encrypted token vault. No native rebuild, so `npm ci` is fast and deterministic in CI and on a clean clone.
The dependency list stays short enough that "every dependency justified in an ADR" is honest rather than ceremonial.

**Negative.** The module is still pre-stable, so its API can change between minors. On Node 22 it is "experimental"; only
from Node 24.15.0 does it reach release-candidate status. Nothing leaks into the operational story, though: no flag, no
`bin` re-exec shim, and the documented `claude mcp add` command stays a plain `node dist/server/index.js`. The choice does
fix the `engines` floor at `>=22.13.0`.

**Accepted risk.** A breaking change in `node:sqlite` between Node minors could break the server. Mitigations: pin
`engines: ">=22.13.0"`, run CI on that exact minimum plus current LTS (Node 24, where the module is a release candidate),
and keep every call behind the driver interface.

**Fallback.** If `node:sqlite` proves insufficient — missing API, unstable behaviour under the migration/transaction load,
or its pre-stable API changing under us — swap in `better-sqlite3` behind the same driver interface. That is a
single-file change plus one dependency and a new ADR superseding this one. The storage tests are written against the
repository layer, not the driver, so they carry over unchanged and act as the acceptance suite for the swap.
