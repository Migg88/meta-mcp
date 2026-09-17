// Minimal state-graph engine. Reference implementation: adapt, keep it this small.

export const END = "__end__";

export type NodeResult<S> = {
  state: S;
  next: string;
  pause?: boolean; // stop after this node (e.g. waiting for human approval)
};

export type GraphNode<S> = (state: S) => Promise<NodeResult<S>>;

export type Checkpoint<S> = {
  runId: string;
  node: string; // node to run next
  state: S;
  step: number;
};

export interface CheckpointStore<S> {
  load(runId: string): Promise<Checkpoint<S> | undefined>;
  save(checkpoint: Checkpoint<S>): Promise<void>;
}

export type RunResult<S> = {
  status: "done" | "paused";
  node: string;
  state: S;
};

type RunOptions<S> = {
  runId: string;
  nodes: Record<string, GraphNode<S>>;
  start: string;
  initialState: S;
  store: CheckpointStore<S>;
  maxSteps?: number;
};

export async function runGraph<S>(options: RunOptions<S>): Promise<RunResult<S>> {
  const { runId, nodes, start, initialState, store, maxSteps = 50 } = options;

  const saved = await store.load(runId);
  let checkpoint: Checkpoint<S> = saved ?? { runId, node: start, state: initialState, step: 0 };

  while (checkpoint.node !== END) {
    if (checkpoint.step >= maxSteps) {
      throw new Error(`Graph ${runId} exceeded ${maxSteps} steps at node "${checkpoint.node}"`);
    }

    const node = nodes[checkpoint.node];
    if (!node) throw new Error(`Unknown node "${checkpoint.node}"`);

    // Saved BEFORE running: a crash resumes at this node, so side-effect nodes must be idempotent.
    await store.save(checkpoint);
    const result = await node(checkpoint.state);

    checkpoint = { runId, node: result.next, state: result.state, step: checkpoint.step + 1 };

    if (result.pause) {
      await store.save(checkpoint);
      return { status: "paused", node: checkpoint.node, state: checkpoint.state };
    }
  }

  await store.save(checkpoint);
  return { status: "done", node: END, state: checkpoint.state };
}
