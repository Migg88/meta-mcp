# Status

## Current slice

S01 — Repo skeleton, verify gate, CI — **SPEC**

> Plan written 2026-09-18, revised the same day for the transport + inbox scope change. No implementation exists yet:
> no `src/`, no `package.json`, no tests.
> **Slice count: 37** (was 31). S05a, S05b, S20a, S20b, S20c and S31a were added; ids S01–S31 are unchanged.
> S01 is blocked only by open question 2 (npm publishing); question 1 is resolved (see Blockers below).

## Acceptance criteria

- Given a clean clone, When I run `npm ci && npm run verify`, Then typecheck, lint, format:check, test, audit, build and
  smoke run in that order and the command exits 0.
- Given a file with a lint error or an `any`, When `npm run verify` runs, Then it fails at the `lint`/`typecheck` step and
  does not reach `test`.
- Given the CI workflow, When it runs on push and PR, Then it executes the identical `npm run verify` from `npm ci`, plus a
  gitleaks secret scan, with `permissions: contents: read` and every action pinned by full commit SHA.
- Given `tsconfig.json`, When compiled, Then `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `module: nodenext`, `target: es2023` are on and `"type": "module"` is set.
- Given Vitest config, When coverage runs, Then thresholds of 90% lines/branches are declared for `src/services`,
  `src/workflows` and `src/llm`.
- Given Node below the `engines` floor, When `npm ci` runs, Then it fails with a clear engine error.

## Tests

- [ ] `test/unit/skeleton.test.ts` — build entry exports a version string matching `package.json`
- [ ] `test/smoke/gate.smoke.test.ts` — verify script order is typecheck→lint→format→test→audit→build→smoke
- [ ] CI green run (evidence: workflow summary pasted below)

## Verification evidence

_None yet — nothing has been implemented or run._

## Security checklist (touched areas)

_Not started. S01 touches the "Supply chain and CI" section only; evidence goes here after the REVIEW step._

> **Scope change 2026-09-18.** The `security-hardening` skill's **"HTTP transport"** section is no longer out of scope.
> All three of its items now require evidence: MCP-spec authorization with audience-checked tokens and no passthrough
> (S05b), `Origin` validation and `127.0.0.1` binding (S05a, S20a), and `X-Hub-Signature-256` verified with
> `timingSafeEqual` over the raw body (S20a). Consolidated and signed off in S31a.

## Verified once

Evidence that does not need re-checking each slice.

- **Subagent model routing — confirmed 2026-09-18.** The `verifier` subagent's transcript showed
  `claude-haiku-4-5-20251001` on all 5 messages while the main session ran Opus 5. Per-agent `model:` frontmatter is
  therefore honored and no override is active. `CLAUDE_CODE_SUBAGENT_MODEL` is not set, and neither is the stronger
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (which would override frontmatter — see `docs/research/mcp-sdk-verification.md`
  item 3b). Satisfies the Definition of Done item "Subagent model routing verified once in a transcript and recorded".
- **MCP spec / SDK / Claude Code / model-id facts — verified 2026-09-17** in
  `docs/research/mcp-sdk-verification.md`. Treated as ground truth; do not re-research. Re-verify only the two items that
  log flagged: the `serveStdio` import path and the `registerTool`/`inputRequired` signatures, against the installed
  package's `.d.ts` files, at the start of S05/S09.
- **Meta endpoints, permissions and policy — verified 2026-09-17** in `docs/meta-endpoints.md`. Treated as ground truth,
  **except** the items that log itself marks UNVERIFIABLE or reconstructed (publishing quota field names, caption/hashtag/
  mention limits, private-reply time limit, full business-use-case rate-limit code set, IG-Login insights permission names,
  Ad Library scope). Those are re-verified by `meta-docs-researcher` in the slice that first enforces them — see ADR-0013.

## Known evidence gaps

- `test/live/` will stay empty unless the user has a Meta app with Advanced Access for messaging and identity verification
  for the Ad Library (open question 11). Messaging and Ad Library slices would then be proven against mocked HTTP only.
  This is acceptable, but it is recorded here rather than presented as full verification.
- **Webhook delivery cannot be proven end to end in CI** (added 2026-09-18, ADR-0017). It needs a public callback URL, a
  registered Meta app and Meta actually sending. S20a/S20b prove the handshake, signature verification, enqueue, dedupe
  and ack contract against **synthetic requests** whose signatures are computed in-test from a test app secret — that
  covers every line of our own logic. Real delivery through the Cloudflare Tunnel is a manual `LIVE_TESTS=true` run
  (`test/live/webhook-delivery.test.ts`) to be recorded here with a date, or explicitly declared missing. It must never be
  implied that CI covers it.
- **`cloudflared` sits outside the verify gate** (ADR-0018). It is an operational prerequisite, not an npm dependency, so
  `npm audit` and the lockfile do not see it. Its version used for any live evidence should be recorded alongside that run.
- **Meta webhook documentation is not yet verified.** `docs/meta-endpoints.md` has no webhook section. Handshake
  parameters, signature header, payload envelope and `subscribed_fields` must be researched and logged before S20a.
- **The v2 Streamable HTTP server API is not yet verified.** `docs/research/mcp-sdk-verification.md` covers stdio
  (item 2d) only. S05a and S05b each begin with a research step against the installed package's types and the
  `2026-07-28` authorization section.

## Blockers / questions

Full list in `PLAN.md` → "Open questions".

**Resolved:**

1. **~~`node:sqlite` and the Node 22 flag.~~ RESOLVED 2026-09-18 — the premise was wrong.** `node:sqlite` is unflagged
   since Node v22.13.0 and a release candidate from v24.15.0. `engines: ">=22.13.0"`, no shim, `claude mcp add` stays a
   plain `node dist/server/index.js`. See ADR-0003. **Do not reopen.**
3. **~~Transport.~~ RESOLVED 2026-09-18 — Streamable HTTP *in addition to* stdio.** ADR-0006 superseded by ADR-0016.
   Slices S05a, S05b.
4. **~~Inbox data flow.~~ RESOLVED 2026-09-18 — webhooks primary, polling retained as backfill.** ADR-0007 superseded by
   ADR-0017; its accepted deletion-notification risk is now **RESOLVED**. Slices S20a–S20c.
   **~~Receiver hosting.~~ RESOLVED 2026-09-18 — Cloudflare Tunnel**, loopback bind, `cloudflared` as an operational
   prerequisite. See ADR-0018.

**Still blocking the start of S01:**

2. **npm publishing.** Publish to npm or not? Changes `package.json` (`name` scope, `files` allowlist, provenance in CI).
   **Default: no.**

**Blocking later slices only (S01–S05 may proceed):**

- **Open question 13 — the OAuth authorization server for the MCP HTTP transport.** Blocks **S05b**; S05a can be built
  first (loopback, unauthenticated, refuses a non-loopback bind).
- **Open question 14 — local-only or genuinely remote HTTP clients.** Shapes S05a defaults and the S31a threat model.
- **Open question 15 — webhook verify token and callback path.** Needed before the Meta app registration step in S20c can
  be documented concretely.
