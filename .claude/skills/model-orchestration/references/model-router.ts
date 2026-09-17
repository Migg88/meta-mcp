// Runtime model router. Reference implementation: adapt, keep it this small.
// Principle: code decides first, the cheapest model second, a stronger model only on low confidence.

export type Tier = "fast" | "balanced" | "deep";

export type TaskKind = "classify_comment" | "summarize_thread" | "draft_reply" | "research_report";

type Route = { tier: Tier; maxOutputTokens: number; escalateTo?: Tier; minConfidence: number };

export const ROUTES: Record<TaskKind, Route> = {
  classify_comment: { tier: "fast", maxOutputTokens: 150, escalateTo: "balanced", minConfidence: 0.8 },
  summarize_thread: { tier: "fast", maxOutputTokens: 400, escalateTo: "balanced", minConfidence: 0.7 },
  draft_reply: { tier: "balanced", maxOutputTokens: 300, minConfidence: 0 },
  research_report: { tier: "deep", maxOutputTokens: 2000, minConfidence: 0 },
};

export type LlmResult = { text: string; inputTokens: number; outputTokens: number };

export interface LlmClient {
  complete(request: { model: string; system: string; prompt: string; maxOutputTokens: number }): Promise<LlmResult>;
}

export type TaskOutput<T> = { value: T; confidence: number };

export type RunTaskOptions<T> = {
  kind: TaskKind;
  system: string; // static, so the provider can cache it
  prompt: string;
  models: Record<Tier, string>; // tier -> model id, from config
  llm: LlmClient;
  parse: (text: string) => TaskOutput<T> | undefined; // schema validation; undefined = invalid
  budget: TokenBudget;
  cache?: Map<string, TaskOutput<T>>;
  cacheKey?: string; // e.g. sha256(kind + content)
};

export class TokenBudget {
  used = 0;
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  charge(result: LlmResult): void {
    this.used += result.inputTokens + result.outputTokens;
  }

  assertAvailable(): void {
    if (this.used >= this.limit) throw new Error(`Token budget exhausted (${this.used}/${this.limit})`);
  }
}

export type RunTaskResult<T> = TaskOutput<T> & { model: string; fromCache: boolean };

export async function runTask<T>(options: RunTaskOptions<T>): Promise<RunTaskResult<T>> {
  const { kind, models, cache, cacheKey } = options;
  const route = ROUTES[kind];

  const cached = cacheKey ? cache?.get(cacheKey) : undefined;
  if (cached) return { ...cached, model: "cache", fromCache: true };

  const first = await attempt(options, models[route.tier], route.maxOutputTokens);
  const confident = first.output && first.output.confidence >= route.minConfidence;

  let final = first;
  if (!confident && route.escalateTo) {
    final = await attempt(options, models[route.escalateTo], route.maxOutputTokens);
  }

  if (!final.output) throw new Error(`Invalid model output for task "${kind}"`);
  if (cacheKey) cache?.set(cacheKey, final.output);
  return { ...final.output, model: final.model, fromCache: false };
}

async function attempt<T>(options: RunTaskOptions<T>, model: string, maxOutputTokens: number) {
  options.budget.assertAvailable();
  const result = await options.llm.complete({ model, system: options.system, prompt: options.prompt, maxOutputTokens });
  options.budget.charge(result);
  return { model, output: options.parse(result.text) };
}
