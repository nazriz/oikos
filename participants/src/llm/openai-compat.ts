// Open-weight (and other) models on a hosted OpenAI-compatible chat API: Fireworks AI, Together, OpenRouter, named
// "openai-compat/<host>/<model>" (docs/real-models.md, "Hosted open-weight models"). The provider is "openai-compat" and
// the model is "<host>/<model>", so a price, a usage record and a transcript all name the host the call went to.
//
// How an answer is asked for is the model's, from its entry in the price table (`answer`), because open-weight models
// differ in what they do reliably:
//  - "tools": the API's own function calling (the mapping of openai.ts);
//  - "json": the answer's shape (codex.ts's `answerSchema`, or the caller's own `answer` shape) written into the prompt
//    and the reply asked for as a JSON object (`response_format: json_object`);
//  - "text" (the default, the path for a model with no reliable tool or JSON mode): the same prompt, nothing asked of the
//    API, and the reply read exactly or not at all (answer.ts): an answer that can't be read is a text block marked
//    unread, which the participant tells the seat about and asks once more, as for every other way in.
// The key is sent in the authorization header and nowhere else: never in a URL, an error or a log line.
// Errors: the account's credit or quota spent stops the run (CreditExhausted: nothing is bought); a rate limit that
// outlasts the retries stops it as a usage limit does (UsageLimitReached), to be resumed (`oikos resume <log>`).

import type { ContentBlock, LlmAdapter, LlmRequest, LlmResponse } from "./adapter";
import { post, type HttpOptions } from "./anthropic";
import { readAnswerText } from "./answer";
import { CreditExhausted, UsageLimitReached } from "./call";
import { answerSchema, codexPrompt } from "./codex";
import { OpenAICompatibleAdapter } from "./openai";

export type CompatAnswer = "tools" | "json" | "text";

/** Where each host is, and which environment variable holds its key (never the key itself). A base URL can be set from
 * the environment (`OIKOS_<HOST>_BASE_URL`) or with --base-url. */
export const COMPAT_HOSTS: Record<string, { baseUrl: string; keyEnv: string }> = {
  fireworks: { baseUrl: "https://api.fireworks.ai/inference/v1", keyEnv: "OIKOS_FIREWORKS_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", keyEnv: "OIKOS_TOGETHER_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OIKOS_OPENROUTER_KEY" },
};

/** A provider's words, or its status, saying the account's credit or quota is spent (OpenRouter answers 402; OpenAI's
 * shape, which several hosts copy, says insufficient_quota; Fireworks' and Together's wording is to confirm). */
export const COMPAT_CREDIT = /HTTP 402\b|insufficient[_ ](credit|quota|balance|funds)|credit balance|out of credits?|quota (exceeded|exhausted)|exceeded your (current )?quota|payment required|billing/i;
/** A rate limit (after the retries: post() tries a 429 again with backoff before it gets here). */
export const COMPAT_LIMITED = /HTTP 429\b|rate[ _-]?limit|too many requests/i;

export interface CompatOptions extends Omit<HttpOptions, "apiKey" | "cache"> {
  apiKey: string;
  baseUrl: string;
  answer?: CompatAnswer;
}

export class OpenAICompatHostedAdapter implements LlmAdapter {
  readonly provider = "openai-compat";
  readonly model: string;
  private calls = 0;
  constructor(
    readonly host: string,
    readonly hostModel: string,
    private readonly o: CompatOptions,
  ) {
    this.model = `${host}/${hostModel}`;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.ask(req);
    } catch (e) {
      // (The key is never in a message: post() puts the URL and the provider's reply in it, not the headers. It is
      // taken out anyway, should a provider ever echo it.)
      const m = (e as Error).message.split(this.o.apiKey).join("[key]");
      if (COMPAT_CREDIT.test(m)) throw new CreditExhausted(`the ${this.host} account's credit or quota is spent (${m.slice(0, 300)}): no further call is made, and nothing is bought`);
      if (COMPAT_LIMITED.test(m)) throw new UsageLimitReached(`${this.host}'s rate limit was reached and outlasted the retries (${m.slice(0, 300)}): the run stops here; resume it later (oikos resume <log>)`);
      throw new Error(m);
    }
  }

  private async ask(req: LlmRequest): Promise<LlmResponse> {
    const mode = this.o.answer ?? "text";
    if (mode === "tools") {
      const inner = new OpenAICompatibleAdapter("openai-compat", this.hostModel, { ...this.o, tokenField: "max_tokens" });
      return inner.complete(req);
    }
    const names = (req.tools ?? []).map((t) => t.name);
    const shape = req.answer ? req.answer.schema : answerSchema(names);
    // (Codex's prompt, with its first line, which is about a command-line tool, replaced, and the shape written out.)
    const prompt = codexPrompt(req).split("\n").slice(1).join("\n");
    const body = {
      model: this.hostModel,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: `Answer only with one JSON object of this shape (a JSON Schema), and nothing before or after it:\n${JSON.stringify(shape)}\n${prompt}` },
      ],
      ...(mode === "json" ? { response_format: { type: "json_object" } } : {}),
      ...(this.o.temperatureMilli !== undefined ? { temperature: this.o.temperatureMilli / 1000 } : {}),
      // (OpenRouter reports what a call cost when asked; other hosts ignore the field.)
      ...(this.host === "openrouter" ? { usage: { include: true } } : {}),
    };
    const r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl}/chat/completions`, { authorization: `Bearer ${this.o.apiKey}` }, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000, this.o.timeoutMs);
    const said: string = typeof r.choices?.[0]?.message?.content === "string" ? r.choices[0].message.content : "";
    const nextId = () => `compat-${++this.calls}`;
    let content: ContentBlock[];
    if (req.answer) {
      let o: unknown;
      try {
        o = JSON.parse(said.trim().replace(/^```(?:json)?\s*\n/i, "").replace(/\n```$/, ""));
      } catch {
        o = undefined;
      }
      content = o && typeof o === "object" && !Array.isArray(o) ? [{ type: "tool_use", id: nextId(), name: req.answer.name, input: o }] : [{ type: "text", text: said.slice(0, 4000), unread: "it wasn't in the form asked for" }];
    } else if (!names.length) {
      // (No tools: a plain answer, its words in `text`, or the reply as it came.)
      let words = said;
      try {
        const o = JSON.parse(said);
        if (typeof o?.text === "string") words = o.text;
      } catch {
        // (not the object: its words as they came)
      }
      content = words ? [{ type: "text", text: words }] : [];
    } else content = readAnswerText(said, names, nextId);
    return { content, usage: usageOf(r) };
  }
}

/** Tokens as the chat-completions API reports them (cached prompt tokens apart), and the cost where the host reports it. */
export function usageOf(r: any): LlmResponse["usage"] {
  const cached = r.usage?.prompt_tokens_details?.cached_tokens;
  const cost = r.usage?.cost;
  return {
    input_tokens: (r.usage?.prompt_tokens ?? 0) - (cached ?? 0),
    output_tokens: r.usage?.completion_tokens ?? 0,
    ...(cached !== undefined ? { cache_read_tokens: cached } : {}),
    ...(typeof cost === "number" ? { reported_cost_microusd: Math.ceil(cost * 1e6) } : {}),
  };
}
