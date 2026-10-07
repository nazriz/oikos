// Every model call goes through here, so every one is recorded: a usage
// annotation (tokens and cost, priced from the table recorded in the log's
// orchestrator annotation) and a transcript annotation (what was sent and
// what came back). Every run records token usage and cost (CLAUDE.md).
//
// A call that fails (after its adapter's own time limits and retries) is
// recorded too, as a model_call_failed annotation: what was sent, and the
// error. The run goes on (its participant waits this wake), so the failure is
// part of what happened: a resumed run is served it as a failure at the same
// point, and takes the same path (orchestrator/src/resume.ts).

import { costMicroUsd, estimateTokens, PRICES, requestText, type LlmAdapter, type LlmRequest, type LlmResponse, type Price } from "./adapter";

/** A run's spending limit: no call is made that could take spending past it (its worst case: the prompt, and every output token allowed). */
export interface Budget {
  limitMicroUsd: number;
  spentMicroUsd: number;
  /** The worst cases of calls in flight: calls made at once (several participants deciding in the same moment) can't
   * together take spending past the limit. */
  reservedMicroUsd?: number;
}

/** Thrown instead of making a call that could exceed the run's spending limit. The run stops, and says why. */
export class SpendingLimitReached extends Error {
  override name = "SpendingLimitReached";
}

/** A provider's usage limit reached (a subscription's, per few hours): no call can be made for a while. The run stops as
 * it does at a spending limit, cleanly and saying why, to be resumed later (`oikos resume <log>`): every answer
 * up to the stop is served from its log. */
export class UsageLimitReached extends SpendingLimitReached {
  override name = "UsageLimitReached";
}

/** The model can't be reached (call after call failing: a network down, a machine asleep): the run stops as it does at
 * a spending limit, to be resumed once it can (pilot 8: three failures retired every model seat for the rest of the year). */
export class ModelUnreachable extends SpendingLimitReached {
  override name = "ModelUnreachable";
}

/** A model call that failed after its adapter's own timeouts and retries (D59). The participant waits this wake, and
 * it's recorded: the run goes on, and replays exactly, because what the model said (nothing) is in the log. */
export class ModelCallFailed extends Error {
  override name = "ModelCallFailed";
}

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
  let worst = 0;
  if (io.budget) {
    // The worst case for this call: the prompt (estimated generously: characters / 3) and every output token allowed.
    worst = costMicroUsd(price, { input_tokens: Math.ceil(estimateTokens(requestText(req)) * 4 / 3), output_tokens: req.maxTokens })!;
    // 5% of the limit is kept back for debriefs (VISION §15.3): the run stops before it's touched.
    const limit = req.purpose === "debrief" ? io.budget.limitMicroUsd : Math.floor(io.budget.limitMicroUsd * 0.95);
    const reserved = io.budget.reservedMicroUsd ?? 0;
    if (io.budget.spentMicroUsd + reserved + worst > limit)
      throw new SpendingLimitReached(`spending limit reached: $${(io.budget.spentMicroUsd / 1e6).toFixed(4)} spent of $${(io.budget.limitMicroUsd / 1e6).toFixed(2)}${reserved ? ` (up to $${(reserved / 1e6).toFixed(4)} more in calls under way)` : ""}; the next call could cost up to $${(worst / 1e6).toFixed(4)}`);
    io.budget.reservedMicroUsd = reserved + worst;
  }
  let res: LlmResponse;
  try {
    res = await adapter.complete(req);
  } catch (e) {
    // (A limit stops the run: nothing was answered, and the call is made again when the run is resumed.)
    if (e instanceof SpendingLimitReached) throw e;
    // (One already in these words is a recorded failure, served again by a resumed run: the same words go in its log.)
    const failed = e instanceof ModelCallFailed ? e : new ModelCallFailed(`${key} (${req.purpose}, for ${req.subject}): ${(e as Error).message}`.slice(0, 2000));
    // Recorded as a transcript is, without an answer: what was sent (the system prompt by its hash), and the error.
    await io.annotate({
      annotation: "model_call_failed", subject: req.subject,
      data: {
        purpose: req.purpose, ...(req.ref ? { ref: req.ref } : {}), t: io.now(), provider: adapter.provider, model: adapter.model, system_sha256: sha256(req.system),
        turn: req.messages.length, input: req.messages.at(-1)?.content ?? "", error: failed.message,
      },
    });
    throw failed;
  } finally {
    if (io.budget) io.budget.reservedMicroUsd = (io.budget.reservedMicroUsd ?? 0) - worst;
  }
  const cost = Math.max(costMicroUsd(price, res.usage)!, Math.ceil(res.usage.reported_cost_microusd ?? 0));
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
      purpose: req.purpose, ...(req.ref ? { ref: req.ref } : {}), t: io.now(), provider: adapter.provider, model: adapter.model, system_sha256: systemHash,
      ...(newSystem ? { system: req.system } : {}),
      turn: req.messages.length, input: last?.content ?? "", output: res.content,
      ...(res.estimated ? { usage_estimated: true } : {}),
    },
  });
  return res;
}
