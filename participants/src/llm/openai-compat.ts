// Open-weight (and other) models on a hosted OpenAI-compatible chat API: Fireworks AI, Together, OpenRouter, Featherless, named
// "openai-compat/<host>/<model>" (docs/real-models.md, "Hosted open-weight models"). The provider is "openai-compat" and
// the model is "<host>/<model>", so a price, a usage record and a transcript all name the host the call went to.
//
// How an answer is asked for is the model's, from its entry in the price table (`answer`), because open-weight models
// differ in what they do reliably:
//  - "tools": the API's own function calling (the mapping of openai.ts);
//  - "json": the answer's shape (codex.ts's `answerSchema`, or the caller's own `answer` shape) written into the prompt
//    and the reply asked for as a JSON object (`response_format: json_object`);
//  - "text" (the default, the path for a model with no reliable tool or JSON mode): a seat's sitting is answered as a
//    plain note under a few headings, as a person writes one (note.ts: "Do: ...", "Write to <id>: ...", "Look at ...",
//    "Confirm <ref>", "Notebook: ...", "Done for <n> days"), read by deterministic code into the same uses a tool-calling
//    model makes, so both reach the translator by one path; nothing about JSON or a schema is shown (2026-11-10, before
//    which the seat was shown the answer's JSON Schema and asked for a JSON object with each use's input as a string of
//    JSON). Other calls (a debrief's answer of a given shape) still ask for one JSON object. Either way the reply is
//    read exactly or not at all: an answer that can't be read is a text block marked unread, which the participant
//    tells the seat about and asks once more, as for every other way in.
// The key is sent in the authorization header and nowhere else: never in a URL, an error or a log line.
// A model's context window, where its price entry gives one (`context_tokens`), is checked before every call: a prompt,
// estimated generously, that with the room asked for the answer would pass it is never sent (no call is made, nothing is
// cut), and the error says the prompt is too long, so the participant sends less next time (participant.ts).
// A reasoning model's thinking written into its reply ahead of the answer (`<think>...</think>`) is not the answer, and
// is left out of what is read, as an API's own thinking blocks are.
// Errors: the account's credit or quota spent stops the run (CreditExhausted: nothing is bought); a rate limit that
// outlasts the retries stops it as a usage limit does (UsageLimitReached), to be resumed (`oikos resume <log>`).

import { requestText, type ContentBlock, type LlmAdapter, type LlmRequest, type LlmResponse } from "./adapter";
import { post, type HttpOptions } from "./anthropic";
import { readAnswerText } from "./answer";
import { CreditExhausted, UsageLimitReached } from "./call";
import { answerSchema, codexPrompt } from "./codex";
import { ASKED_HOW, isWayOutAsked, noteFits, noteGuide, noteMessages, readNote } from "./note";
import { OpenAICompatibleAdapter } from "./openai";

export type CompatAnswer = "tools" | "json" | "text";

/** Where each host is, and which environment variable holds its key (never the key itself). A base URL can be set from
 * the environment (`OIKOS_<HOST>_BASE_URL`) or with --base-url. */
export const COMPAT_HOSTS: Record<string, { baseUrl: string; keyEnv: string; /** The account's concurrency in the host's units, where it meters them (a call of a model costs its price entry's `concurrency_cost`). */ concurrencyUnits?: number }> = {
  fireworks: { baseUrl: "https://api.fireworks.ai/inference/v1", keyEnv: "OIKOS_FIREWORKS_KEY" },
  together: { baseUrl: "https://api.together.xyz/v1", keyEnv: "OIKOS_TOGETHER_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OIKOS_OPENROUTER_KEY" },
  // (Featherless's Developer plan: billed per token from a monthly credit, 100 concurrent units, a model's call costing 1
  // to 4 by its size; https://featherless.ai/pricing and https://api.featherless.ai/v1/models, read 2026-11-08. Its Chat
  // plan is for interactive use only and may not be used here.)
  featherless: { baseUrl: "https://api.featherless.ai/v1", keyEnv: "OIKOS_FEATHERLESS_KEY", concurrencyUnits: 100 },
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
  /** The model's context window in tokens (prompt and answer together), checked before every call. */
  contextTokens?: number;
  /** A local server's own provider name (`ollama`, `local`): the adapter is named by it, its model as given, and no key
   * is sent (a local server takes none). */
  provider?: string;
}

/** A prompt's tokens, estimated generously (a token for every three characters: open-weight tokenizers run at three
 * to four on English and JSON), so that a call let through fits. */
export const generousTokens = (chars: number) => Math.ceil(chars / 3);

/** Why a request would not fit the context window (undefined if it fits): its prompt as the host gets it (the system
 * prompt, the messages and the tools, with room for the answer's shape written in), estimated generously, and the room
 * asked for the answer. */
export function overContext(req: LlmRequest, contextTokens: number | undefined): string | undefined {
  if (!contextTokens) return undefined;
  const prompt = generousTokens(requestText(req).length + (req.answer ? JSON.stringify(req.answer.schema).length : 2_000));
  return prompt + req.maxTokens > contextTokens ? `the prompt is too long for the model's context window: about ${prompt} tokens (estimated generously) and ${req.maxTokens} for the answer, over its ${contextTokens}; no call was made` : undefined;
}

/** A reply with the model's thinking written ahead of its answer: the answer alone. */
export const withoutThinking = (said: string) => said.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");

export class OpenAICompatHostedAdapter implements LlmAdapter {
  readonly provider: string;
  readonly model: string;
  private calls = 0;
  constructor(
    readonly host: string,
    readonly hostModel: string,
    private readonly o: CompatOptions,
  ) {
    this.provider = o.provider ?? "openai-compat";
    this.model = o.provider ? hostModel : `${host}/${hostModel}`;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // (Before anything is sent: a call that could not fit is never made, and never made to fit by cutting it.)
    const over = overContext(req, this.o.contextTokens);
    if (over) throw new Error(`${this.host}/${this.hostModel}: ${over}`);
    try {
      return await this.ask(req);
    } catch (e) {
      // (The key is never in a message: post() puts the URL and the provider's reply in it, not the headers. It is
      // taken out anyway, should a provider ever echo it.)
      const m = this.o.apiKey ? (e as Error).message.split(this.o.apiKey).join("[key]") : (e as Error).message;
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
    const auth: Record<string, string> = this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {};
    const nextId = () => `compat-${++this.calls}`;
    // A seat's sitting, in text: a plain note under headings (note.ts), the conversation as plain chat.
    if (mode === "text" && !req.answer && req.tools && noteFits(req.tools)) {
      const chat = noteMessages(req.messages);
      const last = chat.at(-1);
      // (Asked whether it means to stop: the question's two answers, as a note writes them; its answer read for a clear yes.)
      const asked = last?.role === "user" && isWayOutAsked(last.content);
      if (last?.role === "user") last.content = `${last.content}\n\n${asked ? ASKED_HOW : "(Write your note now, under the headings set out at the start.)"}`;
      const body = {
        model: this.hostModel,
        max_tokens: req.maxTokens,
        messages: [{ role: "system", content: `${req.system}\n\n${noteGuide(req.tools)}` }, ...chat],
        ...(this.o.temperatureMilli !== undefined ? { temperature: this.o.temperatureMilli / 1000 } : {}),
        ...(this.host === "openrouter" ? { usage: { include: true } } : {}),
      };
      const r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl}/chat/completions`, auth, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000, this.o.timeoutMs);
      const said: string = typeof r.choices?.[0]?.message?.content === "string" ? withoutThinking(r.choices[0].message.content) : "";
      return { content: readNote(said, req.tools, nextId, { asked }), usage: usageOf(r), said };
    }
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
    const r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl}/chat/completions`, auth, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000, this.o.timeoutMs);
    const said: string = typeof r.choices?.[0]?.message?.content === "string" ? withoutThinking(r.choices[0].message.content) : "";
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
