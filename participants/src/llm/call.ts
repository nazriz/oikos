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
  /** What is kept back for the run's end (every seat's debrief, and the exit accounts of a sample of people: VISION 15,
   * point 7), so that a run that stops at its limit can still debrief: no other call may take spending past the
   * limit less this. Set by the run from who is to be asked (`endReserveMicroUsd`); absent: a twentieth of the limit. */
  keptBackMicroUsd?: number;
}

/** The purposes that may spend what is kept back for a run's end. */
const AT_THE_END = new Set(["debrief", "account"]);

/**
 * What a run keeps back of its spending limit for its end, in micro-USD: for each model seat a debrief of `calls`
 * calls, each priced as its whole prompt read afresh (no cache) and an answer of `answerTokens`; and for each exit
 * account one call the same way. An estimate with room in it (a way in that caches pays a tenth of this for what it
 * re-reads), never less than a twentieth of the limit and never more than half of it.
 */
export function endReserveMicroUsd(limitMicroUsd: number, o: { seats: number; seatPrice?: Price; calls: number; promptChars: number; answerTokens: number; accounts?: number; accountPrice?: Price; accountChars?: number; accountTokens?: number }): number {
  const one = (price: Price | undefined, chars: number, out: number) => (price ? costMicroUsd(price, { input_tokens: Math.ceil(chars / 4), output_tokens: out })! : 0);
  const debriefs = o.seats * o.calls * one(o.seatPrice, o.promptChars, o.answerTokens);
  const accounts = (o.accounts ?? 0) * one(o.accountPrice, o.accountChars ?? 0, o.accountTokens ?? 0);
  return Math.min(Math.floor(limitMicroUsd / 2), Math.max(Math.floor(limitMicroUsd / 20), debriefs + accounts));
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
  /** When the seat the call was for sits again (its participant's own reckoning: the next working day's sitting): the
   * run has it woken then. Without it a seat would wait out its whole usual rhythm, days, with nobody in it. */
  backAt?: number;
}

/** Whether a failed call's words say the prompt was more than the model takes. Such a call is never made again
 * unchanged: an adapter does not try it again, and whoever made it sends less next time. */
export const promptTooLong = (message: string): boolean => /prompt is too long|input is too long|too many (input )?tokens|context[ _](length|window)|maximum context|exceeds? the (model'?s? )?(maximum|context|token)/i.test(message);

export interface LlmIO {
  adapter: LlmAdapter;
  /** Append an annotation to the run's log. */
  annotate(annotation: object): Promise<void>;
  /** Current world time, for transcripts. */
  now(): number;
  prices?: Record<string, Price>;
  /** A spending limit (required for a real model; the mock costs nothing). */
  budget?: Budget;
  /** Where a seat's words in its debrief are kept, apart from the run's log (a file beside it, kept with the run for
   * ever, as the log is): each debrief call's answer, and each whole interview. With it, the log's transcript of a
   * debrief call holds a digest of the answer in place of the answer, so that a log can be published whatever a seat
   * asked to be kept back (VISION 15, point 7). A resumed run is served those answers from that file. */
  apart?(entry: { kind: "call"; subject: string; ref: string; sha256: string; output: unknown } | { kind: "debrief"; subject: string; record: unknown }): Promise<void>;
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
    // Part of the limit is kept back for the run's end (debriefs and exit accounts: VISION 15, point 7): the run stops
    // before it is touched. How much: what the run set from who is to be asked, or a twentieth of the limit.
    const limit = AT_THE_END.has(req.purpose) ? io.budget.limitMicroUsd : io.budget.limitMicroUsd - (io.budget.keptBackMicroUsd ?? Math.ceil(io.budget.limitMicroUsd * 0.05));
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
  // A debrief's answer is kept apart from the log, where the run has somewhere to keep it: the log gets its digest.
  let apart: string | undefined;
  if (req.purpose === "debrief" && io.apart) {
    apart = sha256(JSON.stringify(res.content));
    await io.apart({ kind: "call", subject: req.subject, ref: req.ref ?? "", sha256: apart, output: res.content });
  }
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
      turn: req.messages.length, input: last?.content ?? "", ...(apart ? { output_apart: true, output_sha256: apart } : { output: res.content }), ...(req.effort ? { effort: req.effort } : {}),
      ...(res.estimated ? { usage_estimated: true } : {}),
    },
  });
  return res;
}
