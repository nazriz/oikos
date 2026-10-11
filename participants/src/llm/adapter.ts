// LLM adapters: one small interface every provider is wrapped in, shaped like
// the Anthropic Messages API with tool use (an OpenAI-compatible adapter maps
// onto it). Participants, the translator and debriefs all call models through this,
// so swapping a provider, or the mock, changes nothing else.
//
// The mock adapter is how Oikos is built and tested before any real model
// is called (docs/design/m2-llm-participants.md). It is deterministic, costs nothing,
// and answers through a policy function that may read the request's structured
// `context`, which real adapters ignore: a mock can't read prose, so it is
// handed the facts the prose was rendered from.

export type ContentBlock =
  /** `unread`: an answer that could not be read whole and exactly (why, in the seat's own terms). Its words are kept as
   * written and nothing is made of them; the participant asks once more (participant.ts). */
  | { type: "text"; text: string; unread?: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: object;
}

export type Purpose = "participant" | "translator" | "debrief" | "consult" | "notebook";

export interface LlmRequest {
  purpose: Purpose;
  /** The participant or translator this call is for (usage annotations name it). */
  subject: string;
  /** What the call is about, where there's a record of it (the translator's: the draft it's writing), so its transcript
   * can be joined to the rest of the record (docs/measurement.md, the translator corpus). */
  ref?: string;
  system: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  /** The answer wanted as one object of a given shape (a JSON Schema: every object closed, every property required),
   * in place of tools and words. An adapter that asks its model for a shape directly (Claude Code, the Codex CLI) asks
   * for exactly this one and hands the object back as a tool_use block of this name, its input the object: nothing in
   * it is a string of JSON for the model to escape by hand. Other adapters leave it and use `tools`, so a caller that
   * may meet either gives both (a tool of the same name taking the same object). */
  answer?: { name: string; schema: object };
  maxTokens: number;
  /** How hard the model is to reason for this call, where whoever makes it has a say (a seat's setting): the word its
   * way in takes ("low", "medium", "high"). An adapter that takes an effort uses this one before its own; one that
   * takes none leaves it. Recorded with the call's transcript. */
  effort?: string;
  /** Structured facts behind the prompt, for mock policies only. Never sent to a real model. */
  context?: any;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  /** What the provider itself says the call cost, where it says (Claude Code does): recorded as the call's cost where
   * it is more than the tokens come to at the price on file, so a spending limit holds against what is really drawn. */
  reported_cost_microusd?: number;
}

export interface LlmResponse {
  content: ContentBlock[];
  usage: Usage;
  /** True when token counts are estimates (the mock), not a provider's report. */
  estimated?: boolean;
}

export interface LlmAdapter {
  provider: string;
  model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** What a mock answers with: content blocks, as a model would. */
export type MockPolicy = (req: LlmRequest) => ContentBlock[] | Promise<ContentBlock[]>;

/** A rough token count (about 4 characters a token), for mock usage records only. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function requestText(req: LlmRequest): string {
  return req.system + JSON.stringify(req.messages) + (req.tools ? JSON.stringify(req.tools) : "");
}

export class MockAdapter implements LlmAdapter {
  readonly provider = "mock";
  constructor(
    readonly model: string,
    private readonly policies: Partial<Record<Purpose, MockPolicy>>,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const policy = this.policies[req.purpose];
    const content = policy ? await policy(req) : [{ type: "text" as const, text: "(mock: no policy for this purpose)" }];
    return {
      content,
      usage: { input_tokens: estimateTokens(requestText(req)), output_tokens: estimateTokens(JSON.stringify(content)) },
      estimated: true,
    };
  }
}

/**
 * Prices, in micro-USD per million tokens, keyed "provider/model". Only the
 * mock is listed: real prices are added with each real adapter, from the
 * provider's published price list, and recorded in every run's log. A usage
 * record is never priced from a guess.
 */
export interface Price {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export const PRICES: Record<string, Price> = {
  "mock/mock": { input: 0, output: 0, cache_read: 0, cache_write: 0 },
};

/** Cost of one call in micro-USD (rounded up), or undefined if the model has no recorded price. */
export function costMicroUsd(price: Price | undefined, u: Usage): number | undefined {
  if (!price) return undefined;
  const perM =
    u.input_tokens * price.input +
    u.output_tokens * price.output +
    (u.cache_read_tokens ?? 0) * (price.cache_read ?? price.input) +
    (u.cache_write_tokens ?? 0) * (price.cache_write ?? price.input);
  return Math.ceil(perM / 1_000_000);
}
