// Every model call goes through here, so every one is recorded: a usage
// annotation (tokens and cost, priced from the table recorded in the log's
// orchestrator annotation) and a transcript annotation (what was sent and
// what came back). Every run records token usage and cost (CLAUDE.md).

import { costMicroUsd, estimateTokens, PRICES, requestText, type LlmAdapter, type LlmRequest, type LlmResponse, type Price } from "./adapter";

/** A run's spending limit: no call is made that could take spending past it (its worst case: the prompt, and every output token allowed). */
export interface Budget {
  limitMicroUsd: number;
  spentMicroUsd: number;
}

/** Thrown instead of making a call that could exceed the run's spending limit. The run stops, and says why. */
export class SpendingLimitReached extends Error {}

export interface LlmIO {
  adapter: LlmAdapter;
  /** Append an annotation to the run's log. */
  annotate(annotation: object): Promise<void>;
  /** Current world time, for transcripts. */
  now(): number;
  prices?: Record<string, Price>;
  /** A spending limit (required for a real model; the mock costs nothing). */
  budget?: Budget;
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

export async function callModel(io: LlmIO, req: LlmRequest, seenSystems: Set<string>): Promise<LlmResponse> {
  const { adapter } = io;
  const key = `${adapter.provider}/${adapter.model}`;
  const price = (io.prices ?? PRICES)[key];
  if (!price) throw new Error(`no price recorded for ${key}: add it to the price table before using this model`);
  if (io.budget) {
    // The worst case for this call: the prompt (estimated generously: characters / 3) and every output token allowed.
    const worst = costMicroUsd(price, { input_tokens: Math.ceil(estimateTokens(requestText(req)) * 4 / 3), output_tokens: req.maxTokens })!;
    // 5% of the limit is kept back for debriefs (VISION §15.3): the run stops before it's touched.
    const limit = req.purpose === "debrief" ? io.budget.limitMicroUsd : Math.floor(io.budget.limitMicroUsd * 0.95);
    if (io.budget.spentMicroUsd + worst > limit)
      throw new SpendingLimitReached(`spending limit reached: $${(io.budget.spentMicroUsd / 1e6).toFixed(4)} spent of $${(io.budget.limitMicroUsd / 1e6).toFixed(2)}; the next call could cost up to $${(worst / 1e6).toFixed(4)}`);
  }
  const res = await adapter.complete(req);
  const cost = costMicroUsd(price, res.usage)!;
  if (io.budget) io.budget.spentMicroUsd += cost;
  await io.annotate({
    annotation: "usage", purpose: req.purpose, subject: req.subject, provider: adapter.provider, model: adapter.model,
    input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
    ...(res.usage.cache_read_tokens !== undefined ? { cache_read_tokens: res.usage.cache_read_tokens } : {}),
    ...(res.usage.cache_write_tokens !== undefined ? { cache_write_tokens: res.usage.cache_write_tokens } : {}),
    cost_microusd: cost,
  });
  // The system prompt is logged in full the first time it's seen, then by hash.
  const systemHash = sha256(req.system);
  const newSystem = !seenSystems.has(systemHash);
  seenSystems.add(systemHash);
  const last = req.messages.at(-1);
  await io.annotate({
    annotation: "transcript", subject: req.subject,
    data: {
      purpose: req.purpose, t: io.now(), provider: adapter.provider, model: adapter.model, system_sha256: systemHash,
      ...(newSystem ? { system: req.system } : {}),
      turn: req.messages.length, input: last?.content ?? "", output: res.content,
      ...(res.estimated ? { usage_estimated: true } : {}),
    },
  });
  return res;
}
