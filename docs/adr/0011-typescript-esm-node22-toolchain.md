# ADR-0011 — TypeScript strict, ESM, Node 22 LTS, and the dependency budget

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed TypeScript strict / ESM / Node 22 LTS)
- **Related:** ADR-0003, ADR-0001

## Context

`PROMPT.md` section 8.1 offered TypeScript strict or plain JavaScript with JSDoc types; the user chose TypeScript strict,
ESM, Node 22 LTS. This ADR records the choice and, more usefully, the dependency budget — because "every dependency
justified in an ADR" needs a place where the baseline list actually lives.

The project handles access tokens and personal data, so the smallest defensible dependency tree is a security property,
not an aesthetic preference.

## Options considered

**Language.** Plain JS with JSDoc avoids a build step but gives weaker inference at exactly the boundaries that matter here
(Zod-derived tool schemas, discriminated domain errors, graph state). TypeScript `strict` was chosen.

**Module system.** CommonJS is better supported by older tooling, but the MCP SDK v2 and modern Node are ESM-first. ESM
was chosen; `"type": "module"` with `module: nodenext`.

**Runtime.** Node 22 LTS was chosen over Node 24 for LTS stability — with the caveat that `node:sqlite` is flagged there
(ADR-0003).

## Decision

**Compiler.** `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`verbatimModuleSyntax`; `module`/`moduleResolution: nodenext`; `target: es2023`. **No `any`** — the ESLint config bans it
(including `as any`), and disabling a rule inline requires a written justification, per the `dev-loop` stop rules.

**Runtime.** Node 22 LTS. The exact `engines` floor depends on open question 1 in `PLAN.md` (the `--experimental-sqlite`
flag); CI runs the matrix of that floor plus current LTS.

**Runtime dependency budget — the complete allowed list for v1:**

| Dependency | Why it exists | Why not hand-rolled |
|---|---|---|
| `@modelcontextprotocol/server` | The protocol itself (ADR-0001) | Reimplementing JSON-RPC, schemas and MRTR is the project |
| `@modelcontextprotocol/core` | Transitive dependency of the above | — |
| `zod` (`^4.2.0`) | Standard Schema peer dep; also validates config, Meta responses and model output | Required by the SDK; reusing it everywhere avoids a second validator |
| `@anthropic-ai/sdk` | Router provider client, **only loaded when `LLM_ROUTER_ENABLED=true`** (ADR-0005) | Retries, streaming and batch handling are non-trivial; lazily imported so it is inert by default |

Everything else comes from Node's standard library: `node:sqlite` (storage), `node:crypto` (AES-256-GCM, SHA-256,
`randomUUID`, `timingSafeEqual`), `fetch`/`AbortSignal.timeout` (HTTP), `node:dns/promises` and `node:net` (SSRF checks),
`node:test`-free (Vitest is dev-only). No HTTP client library, no logger library, no ORM, no graph library (ADR-0012), no
date library, no dotenv in production paths.

**Dev dependencies:** `typescript`, `vitest` + `@vitest/coverage-v8`, `eslint` + `typescript-eslint`, `prettier`, and an
HTTP-mocking library for the fetch boundary (MSW or equivalent), plus `@modelcontextprotocol/client` for contract and smoke
tests. `gitleaks` runs as a pinned GitHub Action, not as an npm dependency.

**Adding anything to either list requires a new ADR** stating what it replaces, its transitive count and its maintenance
status. "It's convenient" is not a justification.

**Supply chain.** Lockfile committed; `npm ci` everywhere; `npm audit --audit-level=high` inside `npm run verify`;
GitHub Actions pinned by full commit SHA with `permissions: contents: read` by default; Dependabot enabled; gitleaks secret
scanning in CI.

## Consequences

**Positive.** A four-package runtime tree — one of which is lazily loaded and off by default — makes the security story
credible and `npm audit` meaningful rather than noisy. No native build step (ADR-0003) keeps `npm ci` fast and
deterministic. `strict` plus `noUncheckedIndexedAccess` catches the class of bug that hurts most when parsing Meta
responses of uncertain shape.

**Negative.** More code to write and maintain: our own logger, our own retry/backoff, our own HTTP helpers. `strict` with
`exactOptionalPropertyTypes` is genuinely more friction around optional fields. ESM plus `nodenext` requires explicit file
extensions in relative imports, which trips people up.

**Review note.** The dependency table above is the checklist item "minimal dependencies, each justified in an ADR". Any
diff adding a package without amending this ADR is a review blocker.
