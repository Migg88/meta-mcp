# ADR-0001 — MCP TypeScript SDK v2 and spec revision 2026-07-28

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed), planner
- **Evidence:** `docs/research/mcp-sdk-verification.md` items 1a–1d, 2a–2e (verified 2026-09-17)

## Context

`meta-content-mcp` is a public portfolio MCP server, so it should target the current protocol rather than the version
most blog posts describe. Verification on 2026-09-17 confirmed:

- `2026-07-28` is the current spec revision. Its core is **stateless**: servers MUST NOT rely on prior requests over the
  same connection; `protocolVersion` and capabilities travel in `_meta` on every request, and the `initialize`/`initialized`
  handshake and session tracking are gone.
- The TypeScript SDK v2 ships as split packages — `@modelcontextprotocol/server` and `@modelcontextprotocol/client` at
  **2.0.0** — with `@modelcontextprotocol/core` as a shared transitive dependency. Tool and prompt schemas use
  **Standard Schema**; the `server` package's peer dependency is `zod: ^4.2.0`.
- **Roots, Sampling and Logging are all deprecated** (SEP-2577), not just Sampling. They keep working for at least 12
  months from the deprecating revision.
- The monolithic v1 package `@modelcontextprotocol/sdk` (latest 1.30.0) is still published and not deprecated; it remains a
  live fallback.

A couple of v2 documentation sub-pages 404'd during verification, so the installed package's TypeScript types — not the
docs site — are the final authority on exact signatures and import paths.

## Options considered

1. **SDK v1 (`@modelcontextprotocol/sdk` ^1.30)** — the most documented path, the one every existing example uses. But it
   targets the pre-stateless model and would have to be migrated within months; a portfolio project shipping on the
   superseded line is a weak signal.
2. **SDK v2 split packages ^2.0.0 with Zod v4** — current, stateless-native, and the elicitation model matches the
   prepare/confirm design this project needs anyway. Cost: thinner documentation and fewer examples to copy.
3. **No SDK, hand-rolled JSON-RPC** — full control, but reimplements schema validation, transports and the MRTR machinery.
   Pure downside for this project.

## Decision

Depend on `@modelcontextprotocol/server` and `@modelcontextprotocol/client` at `^2.0.0` with `zod@^4.2.0`, and target spec
revision `2026-07-28`. Record the exact resolved versions in the lockfile and in `README.md`.

Consequences for the code:

- Treat every request as **stateless**. No server-side memory of a "session"; all continuity lives in SQLite (confirmations,
  workflow checkpoints, cursors) keyed by ids the client passes back.
- Do **not** build on Sampling, Roots or Logging. Server-side LLM work calls the Anthropic API directly (ADR-0005), and all
  logging goes to stderr through our own logger.
- Register tools with `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)`
  and return `{ content, structuredContent }`.
- Before writing server code in slice S05, re-verify the `serveStdio` import path and `registerTool`/`inputRequired`
  signatures against the installed package's `.d.ts` files, and note the result in `docs/research/`.

## Consequences

**Positive.** The server matches the current spec on day one; stateless design forces durable state into SQLite, which is
where crash-resumable workflows need it anyway; Standard Schema keeps input/output validation in one Zod definition.

**Negative.** Fewer worked examples, so slices S05 and S09 carry extra verification cost. The v2 docs site proved patchy,
which is why type-level re-verification is written into the plan.

**Risk and fallback.** If a v2 API turns out to be incomplete once installed, the fallback is `@modelcontextprotocol/sdk`
v1.x (still maintained, security fixes for at least 6 months past v2's release) plus the official
`@modelcontextprotocol/codemod` for the return trip. Because only `src/server/` touches the SDK, this fallback is contained
to one directory. Revisit this ADR if the fallback is ever taken.
