// Run: node --test --experimental-strip-types model-router.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTask, TokenBudget, type LlmClient, type TaskOutput } from "./model-router.ts";

const models = { fast: "model-fast", balanced: "model-balanced", deep: "model-deep" };

type Label = "question" | "spam" | "praise";

// Fake LLM: returns a scripted JSON answer per model and records calls.
function fakeLlm(answers: Record<string, string>) {
  const calls: string[] = [];
  const llm: LlmClient = {
    complete: async ({ model }) => {
      calls.push(model);
      return { text: answers[model] ?? "not json", inputTokens: 100, outputTokens: 20 };
    },
  };
  return { llm, calls };
}

function parseLabel(text: string): TaskOutput<Label> | undefined {
  try {
    const data = JSON.parse(text);
    const valid = ["question", "spam", "praise"].includes(data.label) && typeof data.confidence === "number";
    return valid ? { value: data.label, confidence: data.confidence } : undefined;
  } catch {
    return undefined;
  }
}

const base = { kind: "classify_comment" as const, system: "Classify.", prompt: "Where do you ship?", models, parse: parseLabel };

test("uses only the fast model when it is confident", async () => {
  const { llm, calls } = fakeLlm({ "model-fast": '{"label":"question","confidence":0.95}' });
  const result = await runTask({ ...base, llm, budget: new TokenBudget(10_000) });

  assert.equal(result.value, "question");
  assert.deepEqual(calls, ["model-fast"]);
});

test("escalates to the balanced model on low confidence", async () => {
  const { llm, calls } = fakeLlm({
    "model-fast": '{"label":"spam","confidence":0.4}',
    "model-balanced": '{"label":"question","confidence":0.9}',
  });
  const result = await runTask({ ...base, llm, budget: new TokenBudget(10_000) });

  assert.equal(result.model, "model-balanced");
  assert.deepEqual(calls, ["model-fast", "model-balanced"]);
});

test("escalates on invalid output and fails if still invalid", async () => {
  const { llm, calls } = fakeLlm({});
  await assert.rejects(runTask({ ...base, llm, budget: new TokenBudget(10_000) }), /Invalid model output/);
  assert.deepEqual(calls, ["model-fast", "model-balanced"]);
});

test("serves repeated content from cache without calling the model", async () => {
  const { llm, calls } = fakeLlm({ "model-fast": '{"label":"praise","confidence":0.99}' });
  const cache = new Map<string, TaskOutput<Label>>();
  const options = { ...base, llm, budget: new TokenBudget(10_000), cache, cacheKey: "hash-1" };

  await runTask(options);
  const second = await runTask(options);

  assert.equal(second.fromCache, true);
  assert.equal(calls.length, 1);
});

test("stops when the token budget is exhausted", async () => {
  const { llm, calls } = fakeLlm({ "model-fast": '{"label":"spam","confidence":0.1}' });
  const budget = new TokenBudget(100); // first call spends 120 tokens

  await assert.rejects(runTask({ ...base, llm, budget }), /Token budget exhausted/);
  assert.deepEqual(calls, ["model-fast"]);
});
