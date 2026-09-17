---
name: verification
description: The verification gate and testing strategy for meta-content-mcp — `npm run verify`, test layers, HTTP mocking of Meta, fixtures, MCP smoke tests and evidence rules. Use this skill whenever you write or run tests, set up CI, record fixtures, claim a feature works, or finish any slice of the dev loop.
---

# Verification

## Evidence rule

Nothing is "done" or "working" without command output that proves it. Paste the summary into `STATUS.md`. If you could not run something, say so explicitly.

## The gate: `npm run verify`

Runs, in order, and stops at the first failure:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format:check": "prettier --check .",
    "test": "vitest run --coverage",
    "audit": "npm audit --audit-level=high",
    "build": "tsc -p tsconfig.build.json",
    "smoke": "vitest run --config vitest.smoke.config.ts",
    "verify": "npm run typecheck && npm run lint && npm run format:check && npm run test && npm run audit && npm run build && npm run smoke"
  }
}
```

CI runs the same `npm run verify` from `npm ci`. Local and CI must never diverge.

## Test layers

| Layer | What | Where | Tooling |
|---|---|---|---|
| Unit | services, graph nodes, redaction, crypto, config | `test/unit/` | Vitest, fakes |
| Workflow | full graph paths incl. crash + resume | `test/workflows/` | Vitest, in-memory or temp SQLite |
| Integration | `src/meta/` against mocked HTTP | `test/integration/` | Vitest + HTTP mocking at the fetch boundary (e.g. MSW) |
| Contract | tool list, schemas, annotations | `test/contract/` | SDK client over in-memory transport |
| Smoke | built server over stdio: list tools, call a read-only tool in DRY_RUN | `test/smoke/` | SDK client spawning `dist/` |
| Live (optional) | real Meta test app | `test/live/` | only with `LIVE_TESTS=true`, never in CI |

Domain-specific required tests are listed in `inbox-management`, `model-orchestration` and `workflow-graph`. LLM calls are always faked in tests (no provider calls in CI).

Coverage thresholds enforced in Vitest config: ≥ 90% lines/branches for `src/services` and `src/workflows`.

## Mocking Meta

- Mock only at the HTTP boundary. Services and graphs run real code.
- Fixtures live in `test/fixtures/meta/<endpoint>/<case>.json`, one file per case (success, each error code, pagination, throttling headers).
- Fixtures recorded from live calls must be scrubbed: tokens, ids of real people, names, emails, URLs. A test fails if any fixture contains token-like strings.
- Unhandled requests fail the test (no silent passthrough to the network).

## Test quality rules

- Test names describe behavior: `publish_confirm rejects a reused confirmation id`.
- Arrange / Act / Assert, one behavior per test.
- No sleeps: inject a clock and a delay function.
- Deterministic: seed or inject randomness (ids, jitter).
- For every bug fixed, first add a failing test that reproduces it.

## Manual check before a release

1. `npm run build`
2. Register locally: `claude mcp add meta-content -- node /abs/path/dist/index.js` (confirm current `claude mcp add` syntax in Claude Code docs).
3. In Claude Code: list tools, run `meta_account_health`, run a full publish in `DRY_RUN=true`.
4. Optionally inspect with the MCP Inspector (check its current CLI flags).
5. Record results in `STATUS.md`.
