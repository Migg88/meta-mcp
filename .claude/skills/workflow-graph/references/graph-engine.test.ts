// Path tests for graph-engine.ts. Run: node --test --experimental-strip-types graph-engine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { END, runGraph, type Checkpoint, type CheckpointStore, type GraphNode } from "./graph-engine.ts";

type State = { log: string[]; approved: boolean; publishCalls: number };

function memoryStore(): CheckpointStore<State> {
  const data = new Map<string, Checkpoint<State>>();
  return {
    load: async (runId) => data.get(runId),
    save: async (cp) => { data.set(cp.runId, structuredClone(cp)); },
  };
}

const initialState = (): State => ({ log: [], approved: false, publishCalls: 0 });

function publishNodes(options: { crashOnce?: boolean } = {}): Record<string, GraphNode<State>> {
  let crashed = false;
  return {
    validate: async (s) => ({ state: { ...s, log: [...s.log, "validate"] }, next: "approval" }),
    approval: async (s) =>
      s.approved
        ? { state: { ...s, log: [...s.log, "approved"] }, next: "publish" }
        : { state: s, next: "approval", pause: true },
    publish: async (s) => {
      if (options.crashOnce && !crashed) {
        crashed = true;
        throw new Error("network down");
      }
      return { state: { ...s, publishCalls: s.publishCalls + 1, log: [...s.log, "publish"] }, next: END };
    },
  };
}

test("pauses for approval and resumes to completion", async () => {
  const store = memoryStore();
  const args = { runId: "r1", nodes: publishNodes(), start: "validate", initialState: initialState(), store };

  const first = await runGraph(args);
  assert.equal(first.status, "paused");
  assert.equal(first.node, "approval");

  const cp = await store.load("r1");
  await store.save({ ...cp!, state: { ...cp!.state, approved: true } });

  const second = await runGraph(args);
  assert.equal(second.status, "done");
  assert.deepEqual(second.state.log, ["validate", "approved", "publish"]);
  assert.equal(second.state.publishCalls, 1);
});

test("resumes at the failed node after a crash", async () => {
  const store = memoryStore();
  const nodes = publishNodes({ crashOnce: true });
  const args = { runId: "r2", nodes, start: "validate", initialState: { ...initialState(), approved: true }, store };

  await assert.rejects(runGraph(args), /network down/);
  assert.equal((await store.load("r2"))!.node, "publish");

  const result = await runGraph(args);
  assert.equal(result.status, "done");
  assert.equal(result.state.publishCalls, 1);
});

test("guards against infinite loops", async () => {
  const loop: GraphNode<State> = async (s) => ({ state: s, next: "loop" });
  const args = { runId: "r3", nodes: { loop }, start: "loop", initialState: initialState(), store: memoryStore(), maxSteps: 5 };
  await assert.rejects(runGraph(args), /exceeded 5 steps/);
});

test("fails fast on unknown node", async () => {
  const bad: GraphNode<State> = async (s) => ({ state: s, next: "missing" });
  const args = { runId: "r4", nodes: { bad }, start: "bad", initialState: initialState(), store: memoryStore() };
  await assert.rejects(runGraph(args), /Unknown node "missing"/);
});
