// Every model call goes through here, so every one is recorded: a usage
// annotation (tokens and cost, priced from the table recorded in the log's
// orchestrator annotation) and a transcript annotation (what was sent and
// what came back). Every run records token usage and cost (CLAUDE.md).

import { costMicroUsd, PRICES, type LlmAdapter, type LlmRequest, type LlmResponse, type Price } from "./adapter";

export interface LlmIO {
  adapter: LlmAdapter;
  /** Append an annotation to the run's log. */
  annotate(annotation: object): Promise<void>;
  /** Current world time, for transcripts. */
  now(): number;
  prices?: Record<string, Price>;
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

export async function callModel(io: LlmIO, req: LlmRequest, seenSystems: Set<string>): Promise<LlmResponse> {
  const { adapter } = io;
  const res = await adapter.complete(req);
  const key = `${adapter.provider}/${adapter.model}`;
  const cost = costMicroUsd((io.prices ?? PRICES)[key], res.usage);
  if (cost === undefined) throw new Error(`no price recorded for ${key}: add it to the price table before using this model`);
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
