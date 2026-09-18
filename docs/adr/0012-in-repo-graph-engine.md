# ADR-0012 — In-repo workflow graph engine, no graph library

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** planner (per the `workflow-graph` skill)
- **Related:** ADR-0003, ADR-0004, ADR-0011

## Context

Several flows have multiple steps with external side effects that must survive crashes without duplicating those effects:
Instagram publishing (validate → quota → create container → poll → approve → publish → verify → record), Facebook Page
publishing, comment triage, and the message reply flow. Retries, polling with backoff, and a human-approval pause are all
part of the picture.

The `workflow-graph` skill supplies a ~70-line reference engine and states: *"Do not add a graph library unless an ADR
proves the engine is insufficient."* This ADR records that the reference engine is sufficient.

## Options considered

1. **A workflow framework** (LangGraph.js, Temporal, BullMQ-style job runners). Powerful, and correspondingly heavy:
   large dependency trees, in some cases an external server or Redis, and abstractions far beyond four small graphs.
   Directly contradicts the dependency budget in ADR-0011.
2. **Ad-hoc async functions with try/catch and manual state flags.** No new dependency, but resume logic ends up scattered
   through each service, and "exactly one side effect after a crash" becomes unprovable.
3. **The ~70-line engine from the skill, adapted (chosen).** Nodes are `async (state) => { state, next, pause? }`;
   checkpoints persist to SQLite before each node runs; `pause` stops the run; `maxSteps` guards loops.

## Decision

Adapt `.claude/skills/workflow-graph/references/graph-engine.ts` into `src/workflows/engine.ts` (slice S08) with a
`CheckpointStore` backed by the `workflow_runs` table (ADR-0003). Keep it approximately this small.

Rules that make the engine sufficient rather than merely small:

- **The checkpoint is saved *before* each node runs.** A crash therefore resumes *at* that node, which means every
  side-effect node **must be idempotent** — it checks first whether the effect already happened (a stored container id, a
  stored post id, an idempotency key) before acting. This is the single most important rule in the engine's contract.
- **Every side-effect node is followed by a verify node** that reads the result back from Meta. A graph is not done until
  the effect is confirmed to exist.
- **Decisions live in edges** (the `next` a node returns), never hidden inside a service, so the state machine is readable
  from the node table alone.
- **Errors split cleanly:** transient → return `next` to self with an incremented `attempt` and an injected backoff delay;
  permanent → `next: "fail"` with a typed domain error in state.
- **Checkpointed state is JSON-serializable and must never contain a token.** The checkpoint store rejects token-like keys.
- **`pause: true`** is how human approval works: the run stops, and re-invoking `runGraph` with the same `runId` resumes.
  This composes with the MRTR retry contract (ADR-0002), which is likewise "return and be called again".
- Time is injected (clock + delay function) so tests never sleep.

Every graph ships with the test set the skill requires: happy path, each failure edge, pause → resume, a crash injected at
each side-effect node proving **exactly one** side effect, and `maxSteps` exceeded. Each graph is documented as Mermaid in
`docs/architecture.md`, kept in sync by a test asserting every graph name appears there.

## Consequences

**Positive.** Zero dependencies for the most safety-critical control flow in the project. The engine is small enough to
read in one sitting and to reason about during security review. Because checkpoints are SQLite rows, crash-and-resume is
testable in-process with a temp database — no infrastructure. The design fits the stateless protocol core (ADR-0001):
continuity lives in the database, not in a connection.

**Negative.** No parallel fan-out, no distributed execution, no built-in scheduling, no visual tooling — all of which a
framework would give. Idempotency is the author's responsibility on every side-effect node; the engine cannot enforce it,
only the tests can. `maxSteps` is a blunt loop guard.

**Revisit if:** graphs need to fan out across accounts concurrently, or the server becomes multi-process, or step counts
grow past what a single table and a `maxSteps` guard can sensibly express. At that point a new ADR supersedes this one and
must justify the dependency against ADR-0011.
