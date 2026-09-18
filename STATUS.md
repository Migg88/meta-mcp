# Status

## Current slice

S01 — Repo skeleton, verify gate, CI — **SPEC**

> Plan written 2026-09-18. No implementation exists yet: no `src/`, no `package.json`, no tests.
> S01 must not start until open questions 1 and 2 in `PLAN.md` are answered (see Blockers below).

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

## Blockers / questions

Full list in `PLAN.md` → "Open questions". Blocking the start of S01:

1. **`node:sqlite` and the Node 22 flag.** On Node 22 LTS, `node:sqlite` requires `--experimental-sqlite`. Choose:
   (a) `engines: ">=22.5.0"` + a `bin` shim that re-execs with the flag + a documented
   `claude mcp add ... -- node --experimental-sqlite dist/server/index.js`; (b) require Node 24+ where it is unflagged;
   (c) ship `better-sqlite3` behind the driver interface instead. **Default if unanswered: (a).** Determines `engines`,
   `bin` and the README command. See ADR-0003.
2. **npm publishing.** Publish to npm or not? Changes `package.json` (`name` scope, `files` allowlist, provenance in CI).
   **Default: no.**

Planned defaults awaiting confirmation (do not block S01, but shape later slices): transport stdio-only (ADR-0006) and
polling-only inbox with the accepted deletion-notification risk (ADR-0007).
