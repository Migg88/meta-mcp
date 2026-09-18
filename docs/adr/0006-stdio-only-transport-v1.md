# ADR-0006 — stdio-only transport in v1

- **Status:** **Superseded by [ADR-0016](0016-dual-transport-stdio-and-streamable-http.md) (2026-09-18)** — the user
  answered `PROMPT.md` Q3 with "Streamable HTTP", so the planning default that OAuth could be deferred no longer holds;
  stdio survives as the default entry point, but it is no longer the *only* one.
- **Date:** 2026-09-18
- **Deciders:** planner (proposed), user (to confirm)
- **Related:** ADR-0001, ADR-0003, ADR-0016
- **Note:** this record is kept unedited below as the history of why stdio-only was proposed. Its structural requirements
  (transport-agnostic `createServer`, stdout protocol-only, graceful shutdown) all survive into ADR-0016.

## Context

`PROMPT.md` section 8.3 leaves the transport open: stdio only, or also Streamable HTTP with OAuth. The target usage is a
single developer running the server locally from Claude Code or Claude Desktop, holding their own Meta tokens in a local
encrypted vault on their own machine.

Streamable HTTP is not just a transport switch. Doing it correctly under spec `2026-07-28` means implementing the
authorization section: an OAuth flow, audience-checked tokens issued for this server, no token passthrough to Meta, Origin
validation, and binding to `127.0.0.1` unless deliberately deployed. That is a substantial security surface — arguably a
larger one than the rest of the server combined — and it earns nothing for the local single-user case.

## Options considered

1. **stdio only (chosen for v1).** The client spawns the process; there is no listening socket, no network authorization
   surface, no CORS or Origin question, and the OS process boundary is the trust boundary.
2. **Streamable HTTP + OAuth in v1.** Enables remote and multi-user use, and is the more impressive demo — but it is a
   large slice of security-critical code that would delay every feature behind it, and multi-user is explicitly out of the
   v1 story.
3. **Both from day one.** Doubles the transport surface and the test matrix before a single tool exists.

## Decision

Ship **stdio only** in v1, and structure `src/server/` so that adding Streamable HTTP later is purely additive.

Structural requirements enforced from slice S05:

- The server factory — `createServer(deps)`, which registers tools, resources and prompts — is **transport-agnostic**.
  `src/server/stdio.ts` is a thin entry point that wires `serveStdio` around it and owns process lifecycle.
- No tool, service, workflow, storage or `src/meta/` module may import anything transport-specific, reference a request
  origin, or read an HTTP header. A future `src/server/http.ts` must be addable without touching any of them
  (deferred slice **A1** in `PLAN.md`).
- **stdout is protocol-only.** Every log line, warning and diagnostic goes to stderr as structured JSON. This also makes
  Node's `ExperimentalWarning` from `node:sqlite` (ADR-0003) harmless.
- `SIGINT`/`SIGTERM` shut down gracefully: stop accepting work, finish or checkpoint in-flight graph runs, close the DB.
- The README documents registration as
  `claude mcp add --transport stdio meta-content-mcp -- node <flags> /abs/path/dist/server/index.js`.

Because OAuth is out of scope, the Meta authorization-code exchange runs **out of band** as a CLI sub-command (slice S07),
not through the MCP transport.

## Consequences

**Positive.** The entire "HTTP transport" section of the security checklist is out of scope for v1, which is an honest
reduction of risk rather than an unchecked box. Tokens never cross a network boundary. The smoke test can spawn the real
built binary over stdio, which is the closest possible approximation of real use.

**Negative.** No remote or shared deployment; one user per machine; no browser-based OAuth for Meta login, so first-time
setup is a CLI step that has to be documented well.

**Additive path.** Slice A1 adds `src/server/http.ts` plus an authorization module and the `Origin`/audience checks from the
`security-hardening` skill. Because `createServer` is shared, tools, services and `src/meta/` are untouched, and the
existing contract tests apply to both transports. If A1 is ever built, it needs its own security review and an ADR
recording the authorization design — this ADR is not permission for it.

**Note.** This is a planning default. If the user wants HTTP in v1, this ADR is superseded before S01 starts, because the
decision changes the `src/server/` layout and the CI matrix.
