# ADR-0016 — Both transports: stdio by default, Streamable HTTP with OAuth alongside

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (decision), planner (design)
- **Supersedes:** [ADR-0006](0006-stdio-only-transport-v1.md)
- **Related:** ADR-0001 (SDK v2, spec `2026-07-28`), ADR-0008 (Meta login paths), ADR-0018 (receiver deployment)
- **Slices:** S05 (factory + stdio), S05a (HTTP entry point), S05b (authorization), S31/S31a (docs + evidence)

## Context

ADR-0006 proposed stdio only, deferring Streamable HTTP and its authorization surface to a hypothetical additive slice
A1. The user has now answered `PROMPT.md` section 8.3 with **Streamable HTTP**.

The question that answer leaves open is whether HTTP *replaces* stdio or joins it. Section 8.3 was phrased "stdio only for
v1, or **also** Streamable HTTP with OAuth", so the natural reading is *also*. The user confirmed this reading on
2026-09-18. It is also the technically cheaper answer: the primary consumer is Claude Code on the author's own machine,
where `claude mcp add --transport stdio` spawning the process is the simplest possible trust boundary — the OS process
boundary — and requires no token, no listening socket and no authorization server.

What changes materially is the security surface. Under spec revision `2026-07-28`, doing Streamable HTTP correctly means
implementing the authorization section: this server becomes an OAuth **resource server**, tokens must be audience-checked
so that a token minted for some other service cannot be replayed here, inbound tokens must never be passed through to
Meta, `Origin` must be validated to defeat DNS rebinding from a browser, and the listener must bind to `127.0.0.1` unless
someone deliberately deploys it. The `security-hardening` skill has an "HTTP transport" section that ADR-0006 declared out
of scope; it is now in scope and must be checked with evidence.

## Options considered

1. **stdio only** (ADR-0006's position). Now contradicted by the user's answer.
2. **Streamable HTTP only.** Simplest surface to *describe*, but it makes the common local case worse: every local run
   would need a token and a listening socket, and the smoke test could no longer spawn the real binary over a pipe.
   It also throws away the strongest property the project has — that in normal use nothing listens on a port.
3. **Both, from one server factory (chosen).** `createServer(deps)` stays transport-agnostic; `src/server/stdio.ts` and
   `src/server/http.ts` are thin entry points selected by `MCP_TRANSPORT`. The contract test suite runs against both.

## Decision

Ship **both**. stdio is the default; Streamable HTTP + OAuth is additive and opt-in.

Binding commitments:

- **One server object, two entry points.** Neither entry point contains tool, service, workflow, storage or `src/meta/`
  logic. A static test (`test/unit/server/transport-isolation.test.ts`, S05a) asserts that nothing outside `src/server/`
  imports `node:http`, reads a request header, or branches on the active transport. This is what makes "HTTP-only later"
  a single-file deletion, and it is enforced mechanically rather than by convention.
- **Secure by default at the network edge (S05a).** Bind `127.0.0.1` unless `MCP_HTTP_BIND` is set explicitly; validate
  `Origin` against an allowlist and `Host` against the configured host, rejecting before the body is parsed; enforce body
  size, content type and `Accept`; issue session ids from `crypto.randomUUID`, compare them in constant time, and never
  auto-create an unknown session.
- **Authorization as a resource server (S05b).** Serve protected-resource metadata unauthenticated; challenge with
  `WWW-Authenticate`; reject any token whose audience is not this server's canonical URI **even when the signature and
  expiry are valid**; enforce per-tool scope. A non-loopback bind without authorization configured **refuses to start**.
- **Two unrelated identity domains.** The token a client presents to this server and the Meta tokens in the vault are
  different things. No inbound token is ever forwarded to Meta, stored in the vault, or logged; no Meta token is ever
  returned to a client. Meta's own authorization-code exchange stays the out-of-band CLI of S07 even though a listener
  now exists — the MCP listener must not serve a Meta redirect URI. Tested directly
  (`test/unit/server/auth-no-passthrough.test.ts`).
- **stdio demands nothing.** Running over stdio requires no OAuth configuration and performs no authorization: the
  process boundary is the trust boundary, exactly as in ADR-0006.

The v2 Streamable HTTP server API is **not yet verified** — `docs/research/mcp-sdk-verification.md` covers stdio (item 2d)
and is silent on HTTP. S05a begins with a `meta-docs-researcher` step against the installed package's types, and no code
may assume the v1 `StreamableHTTPServerTransport` shape.

## Consequences

**Positive.** Remote and non-Claude-Code clients become possible. The project now demonstrates the spec's authorization
model rather than sidestepping it, and the `security-hardening` checklist's HTTP section becomes checked-with-evidence
instead of not-applicable. Because both transports share the factory, every contract test written for stdio runs
unchanged over HTTP and catches any divergence between them.

**Negative.** Two new security-critical slices (S05a, S05b) that produce no user-visible feature; a doubled transport test
matrix; S31 had to be split because the documentation and threat model outgrew one slice; and an unresolved dependency on
which authorization server issues the tokens (`PLAN.md` open question 13). The attack surface genuinely grows: there is
now a socket where previously there was a pipe. The loopback default and the refuse-to-start guard are what keep that
growth opt-in rather than automatic.

**Sequencing.** S05a/S05b sit immediately after S05 but **block nothing** — S06 onward never import them, so publishing
work proceeds in parallel. If open question 13 stalls, S05a can ship alone (loopback-only, unauthenticated, with a loud
warning and a refuse-to-start guard for any non-loopback bind) and S05b follows.
