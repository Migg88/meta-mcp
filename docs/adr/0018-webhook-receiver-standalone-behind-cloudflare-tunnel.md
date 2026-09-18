# ADR-0018 — The webhook receiver is a standalone loopback process exposed by Cloudflare Tunnel

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (hosting decision), planner (design)
- **Related:** ADR-0009 (Cloudflare R2 media hosting), ADR-0016 (transports), ADR-0017 (webhooks primary)
- **Slices:** S20a (receiver), S20c (subscriptions + status), S31 (quick start), S31a (security evidence)

## Context

ADR-0017 makes webhooks the primary inbox producer. That needs an endpoint Meta can reach over HTTPS with a valid
certificate, at a URL registered in the Meta app.

Two design questions follow, and they are separate:

1. **Same process or separate?** ADR-0016 now puts an HTTP listener inside the MCP server (S05a), so hosting the receiver
   there is suddenly possible in a way it was not under ADR-0006.
2. **Reachable how?** The user's answer, given 2026-09-18: **Cloudflare Tunnel**.

## Options considered — process placement

1. **Inside the MCP server's Streamable HTTP listener.** One process, one port, one deployment. Rejected, for reasons that
   are about lifetime and trust rather than convenience:
   - **Lifetimes differ.** The MCP server is spawned and killed by the client (`claude mcp add` starts it per session).
     The receiver must run continuously or events are lost. Tying them together means every Claude Code restart is a
     delivery gap.
   - **Trust boundaries differ.** The MCP listener authenticates *clients of ours* with OAuth (S05b). The receiver
     authenticates *Meta* with an HMAC over the raw body. Merging them puts two unrelated authentication schemes on one
     socket and invites a request that satisfies neither being handled by the wrong one.
   - **Blast radius.** A bug in the publicly-exposed receiver would sit in the same process as the token vault and the
     tool registry.
2. **Standalone process sharing config, storage and logger (chosen).** `src/webhooks/server.ts` with its own entry point,
   importing `src/config`, `src/storage` and the logger and **nothing** from `src/tools/`, `src/server/` or `src/llm/`
   (asserted by `test/unit/webhooks/isolation.test.ts`). It communicates with the MCP server only through the
   `inbox_events` table — the same queue the poller writes to, which is exactly the decoupling ADR-0007 designed for.

## Options considered — reachability

1. **VPS with a public IP, Nginx/Caddy terminating TLS.** Conventional and provider-neutral, but it means an origin server
   listening on `0.0.0.0`, a certificate to obtain and renew, a firewall to maintain, and a host to patch — for a process
   whose only legitimate caller is Meta.
2. **Cloudflare Tunnel (chosen, user's decision).** `cloudflared` holds an **outbound** connection to Cloudflare; Cloudflare
   terminates TLS at the edge and forwards to the receiver on loopback. There is **no inbound port, no public origin and
   no certificate to manage**. It is also coherent with ADR-0009: Cloudflare R2 already hosts the media, so this is one
   provider and one account rather than two.
3. **An ad-hoc developer tunnel (ngrok-style ephemeral URL).** Fine for a first manual test, useless as a registered
   callback because the hostname changes. Not a deployment.

## Decision

The receiver is a **standalone process that binds to `127.0.0.1` only** and is exposed by **Cloudflare Tunnel**.

- The receiver never listens on a public interface. A non-loopback bind requires an explicit override and logs that the
  process is now directly network-reachable and no longer behind the tunnel.
- **`cloudflared` is an operational prerequisite, not a dependency.** It is installed and run by the operator, documented
  in the README quick start and reflected in `.env.example` through the public callback URL. It never appears in
  `package.json`; `test/unit/docs/no-cloudflared-dependency.test.ts` (S31) enforces that. The dependency budget of
  ADR-0011 is untouched.
- **The tunnel is transport, not authentication.** Everything reaching the receiver is still treated as hostile: the
  `hub.challenge` handshake and `X-Hub-Signature-256` verification (ADR-0017) are ours to implement and are the only
  things that establish that a request came from Meta. A tunnel with an obscure hostname is not a security control.
- **Callback registration stays our job.** Registering the tunnel URL and the verify token in the Meta app, and
  subscribing accounts to the right `subscribed_fields`, is the S20c CLI plus a documented manual step in the Meta app
  dashboard. `meta_webhook_status` surfaces "never received an event", which is how a misregistered callback becomes
  visible instead of silent.
- **VPS + reverse proxy stays documented as a secondary path** in one short README section, with its own warning about
  the exposed origin. **No slice is built around it**, and nothing in `src/` may assume either topology: the receiver sees
  a plain HTTP request on loopback in both cases.
- Tunnel credentials are secrets, handled like any other (never committed, never logged, recorded in `SECURITY.md`).

## Consequences

**Positive.** No open inbound port anywhere in the system; no certificate lifecycle; no public origin server to harden or
patch. The `security-hardening` checklist item "bound to `127.0.0.1` unless explicitly deployed" is satisfied by both
listeners in the project, which is a stronger and simpler story than "deployed on a VPS with a firewall". Separate
processes mean the receiver keeps collecting events while Claude Code is closed, and a receiver crash cannot take down the
MCP server or touch the vault.

**Negative.** A hard dependency on a third-party edge (Cloudflare) sitting in the path of personal data — worth noting
that ADR-0007 rejected "polling plus a hosted relay" partly on that ground; the difference here is that Cloudflare is
already the media host by ADR-0009 and is a contracted provider rather than an ad-hoc relay, and payloads are stored
encrypted the moment they land. Operationally there are now two processes to run and a tunnel to keep up; tunnel downtime
is an event gap, which is precisely why polling was retained as backfill (ADR-0017) and why `meta_webhook_status` reports
`stale`. And `cloudflared` being outside `package.json` means it is outside `npm audit` and the lockfile — an operational
component the verify gate cannot see.
