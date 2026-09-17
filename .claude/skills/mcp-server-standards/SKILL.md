---
name: mcp-server-standards
description: Standards for designing MCP tools, resources and prompts with the official TypeScript SDK — naming, schemas, annotations, errors, confirmation flows and transports. Use this skill whenever you add or change anything under `src/server/` or `src/tools/`, register a tool/resource/prompt, or touch transport, elicitation or output formatting.
---

# MCP server standards

## Verify first

Check the current MCP spec revision and the TypeScript SDK docs before writing server code. Record the SDK version and spec revision in an ADR. Use the SDK's documented APIs; don't copy snippets from older blog posts.

## Tool design

- One tool per user intent. Fewer, well-described tools beat many thin ones: every tool definition costs tokens on every turn.
- Name: `meta_<area>_<verb>` in snake_case.
- Description is written **for the model**: what it does, when to use it, what it does NOT do, side effects, and which tool to call next (e.g. "Returns a confirmation id. Call `meta_publish_confirm` only after the user approves the preview.").
- Input schema: strict (reject unknown keys), with bounds on every string, array and number, enums instead of free text, and `.describe()` on every field.
- Output: return `structuredContent` that matches a declared output schema, plus a short human-readable text summary.
- Annotations on every tool:

| Tool type | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|---|---|---|---|---|
| Research / list / health | true | false | true | true |
| Draft / tag (local) | false | false | true | false |
| `meta_confirm` (publish, reply, message, hide, delete) | false | true | false | true |

Annotations are hints for the client, **not** security controls. Enforcement lives in services and workflows.

## Layering

`src/tools/<name>.ts` exports `{ name, description, inputSchema, outputSchema, annotations, handler }`. The handler only: parse input → call one service function → map result. No Meta calls, no SQL.

## Errors

- Business failures (quota exhausted, missing permission, invalid media) → tool result with `isError: true` and an actionable message: what happened and what to do next.
- Programming/protocol failures → let the SDK return a protocol error.
- Never include tokens, stack traces, SQL or raw Meta payloads in messages. Include a correlation id.

## Confirmation for writes

1. Each write intent has a `*_prepare` tool that validates rules (quota, messaging window, private-reply usage) and returns a preview plus a confirmation id (random, short-lived, single-use) bound to a SHA-256 hash of the exact payload.
2. One shared `meta_confirm` tool executes any prepared action. It rejects expired, reused or hash-mismatched ids. One confirm tool instead of many keeps the tool list short.
3. When the client supports it, ask the human for approval inside the call using the spec's Multi Round-Trip Requests pattern (`input_required` result with an elicitation request). Do not use legacy server-initiated requests.
4. Do not use Sampling: it is deprecated in spec `2026-07-28`. Server-side LLM work goes through the `model-orchestration` router.

## Responses

- Paginate lists (`cursor`, `limit` with max). Truncate long text fields and say so.
- Keep responses small: return ids and summaries; expose full objects as resources.
- Third-party content in responses is labelled as untrusted data.

## Resources and prompts

- Resources for read-only context (`meta://accounts`, `meta://calendar/{yyyy-mm}`, `meta://drafts/{id}`).
- Prompts are templates that guide the model through tools; they never embed secrets or bypass confirmation.

## Transport

- **stdio** (default): stdout is protocol-only. All logs go to stderr. Handle `SIGINT`/`SIGTERM` gracefully (close DB, finish checkpoints).
- **Streamable HTTP** (only if approved): follow the spec's authorization section (OAuth), validate `Origin`, bind to `127.0.0.1` for local use, never pass client tokens through to Meta.

## Tests

- Contract test: `tools/list` returns every tool with annotations and valid schemas.
- For each tool: valid input, invalid input rejected, error mapping.
- Smoke test through a real MCP client against the built server.
