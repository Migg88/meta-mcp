# ADR-0015 — Instagram scheduling via a local worker

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** user (confirmed: local scheduler worker, plus Facebook native scheduling where Meta supports it)
- **Evidence:** `docs/meta-endpoints.md` item 2c; `.claude/skills/meta-graph-api/SKILL.md` (Page native scheduling via
  `published=false` + `scheduled_publish_time`)
- **Related:** ADR-0004, ADR-0006, ADR-0012

## Context

The two platforms differ. Facebook Pages support **native** scheduling: create the post with `published=false` and a
`scheduled_publish_time`, and Meta publishes it. Instagram's Content Publishing API has no equivalent — a container is
created and then published; nothing on Meta's side holds it until a future time.

So "schedule an Instagram post" has to mean "something publishes it later". Under stdio-only transport (ADR-0006) the
server is a process the MCP client spawns, and it is not running continuously — which is the central difficulty.

## Options considered

1. **Facebook native scheduling only; no Instagram scheduling in v1.** Honest and cheap, but drops a headline capability
   on the platform this project centres on.
2. **A separate always-on daemon or system service.** Most reliable, but it is a second process with its own install,
   lifecycle and documentation — a significant step up in operational complexity for v1.
3. **Delegate to an external scheduler (cron, systemd timer, launchd).** Reliable and standard, but pushes platform-specific
   setup onto the user and makes the feature untestable as part of the server.
4. **An in-process worker that runs while the server is up, with catch-up on start (chosen).** No extra process, no extra
   install; a due job runs at the next tick, and jobs that came due while the server was down run at startup.

## Decision

- **Facebook Pages** use **native scheduling** when the target time falls inside Meta's documented allowed window:
  after confirmation, the post is created with `published=false` + `scheduled_publish_time`, and no local job is needed.
  The allowed window bounds are config values verified against the docs in slice S15.
- **Instagram** uses a **local scheduler worker**: `meta_schedule` stores a job row (target account, payload, payload hash,
  target time, status), and no external write happens at schedule time. A worker inside the server process ticks on an
  interval and runs the S13 publish graph for due jobs.
- **Exactly-once claiming**: a job is claimed with a single conditional update (`UPDATE ... SET status='running'
  WHERE id=? AND status='pending'`), so concurrent ticks cannot both take it. The publish graph's idempotency and
  checkpointing (ADR-0012) then guarantee one side effect even across a crash mid-run.
- **Catch-up on startup**: overdue jobs run once, oldest first. Jobs overdue by more than a configured staleness limit are
  marked `missed` rather than published — publishing yesterday's time-sensitive post a day late is worse than not
  publishing it.
- **Scheduling does not bypass approval.** `meta_schedule` goes through prepare → confirm like any other write
  (ADR-0004); the human approves *scheduling the payload*, and the stored payload hash is re-verified before publication.
- **`DRY_RUN=true`** makes the worker run its full logic and mark jobs `dry_run_completed` without touching Meta.
- The clock and the delay function are injected, so slice S15's tests cover due/overdue/stale/concurrent cases with no
  sleeps.

## Consequences

**Positive.** One process, one install, nothing platform-specific for the user to configure. Facebook posts get true
native reliability — once accepted by Meta they publish whether or not the machine is on. Instagram scheduling reuses the
publish graph wholesale, so it inherits crash-resume and exactly-once behaviour for free.

**Negative, and it is the significant one.** *An Instagram job only fires if the server process is running at its due
time.* Because an MCP stdio server is spawned by the client, a scheduled post can be late by however long the user's editor
stays closed — or be marked `missed` if that exceeds the staleness limit. This is a genuine limitation, not a detail: it
must be stated plainly in the README and in the `meta_schedule` tool description, so neither the user nor the model assumes
unattended publishing.

**Mitigations available now.** Keep the staleness limit conservative so stale posts fail loudly rather than surprising the
user; report pending and missed jobs in `meta://calendar` and in `meta_account_health`; document that leaving the host
application open around the scheduled time is what makes it fire.

**Revisit if** reliable unattended Instagram scheduling becomes a requirement. The natural answers are a standalone daemon
or a documented cron/systemd invocation of a `run-due-jobs` sub-command — both additive, both needing a new ADR, and both
sharing the same job table and publish graph.
