// The Anthropic Messages API as an LlmAdapter. The adapter interface is
// shaped like this API, so the mapping is direct. No call is made unless a
// run is explicitly started with a real model and a spending limit
// (orchestrator/src/cli.ts); tests inject `fetch`.

import type { ContentBlock, LlmAdapter, LlmRequest, LlmResponse } from "./adapter";
import { CreditExhausted } from "./call";

export interface HttpOptions {
  apiKey: string;
  baseUrl?: string;
  /** For tests: a stand-in for the network. */
  fetch?: typeof fetch;
  /** Sampling temperature, in thousandths (a world's controller params: temperature_milli). */
  temperatureMilli?: number;
  /** Retries on rate limits, server errors, timeouts and dropped connections (default 4), with exponential backoff from `backoffMs`. */
  retries?: number;
  backoffMs?: number;
  /** How long one attempt may take before it's abandoned and retried (default 180 s; D59). */
  timeoutMs?: number;
  /** Prompt caching (Anthropic only; default on): see `withCacheBreakpoints`. */
  cache?: boolean;
}

/** Whether a provider's error says the account's prepaid credit is spent. */
export const creditSpent = (message: string): boolean => /credit balance is too low|insufficient[_ ]credit|billing.*(required|limit)/i.test(message);

const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * The request with prompt-caching breakpoints (the provider's own feature; the answer is the same, the repeated input
 * costs a tenth): one after the tools and the system prompt, which are the same on every call a participant or the
 * translator makes (its standing documents, the call language), and one on the last message, so the next turn of the
 * same wake reads the conversation so far from the cache. A copy: the conversation itself, and so the transcripts,
 * are unchanged. (A prefix shorter than the provider's minimum isn't cached; it costs nothing extra.)
 */
export function withCacheBreakpoints(system: string, messages: LlmRequest["messages"]): { system: any; messages: any[] } {
  const last = messages.at(-1);
  const blocks = (c: string | ContentBlock[]): any[] => (typeof c === "string" ? [{ type: "text", text: c }] : c.map((b) => ({ ...b })));
  const marked = last ? (() => { const b = blocks(last.content); b[b.length - 1] = { ...b[b.length - 1], cache_control: EPHEMERAL }; return { role: last.role, content: b }; })() : undefined;
  return {
    system: system ? [{ type: "text", text: system, cache_control: EPHEMERAL }] : system,
    messages: marked ? [...messages.slice(0, -1), marked] : messages,
  };
}

/** Retry a request on 429, 5xx, a timeout or a dropped connection, with exponential backoff. Other errors are thrown
 * with the provider's message. Each attempt may take at most `timeoutMs` (D59: a call that never answers mustn't hang
 * the run). */
export async function post(f: typeof fetch, url: string, headers: Record<string, string>, body: object, retries: number, backoffMs: number, timeoutMs = 180_000): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // A timeout or a dropped connection: worth another try.
      if (attempt < retries) {
        await Bun.sleep(backoffMs * 2 ** attempt);
        continue;
      }
      const why = (e as Error).name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : (e as Error).message;
      throw new Error(`${url}: ${why} (after ${attempt + 1} attempts)`);
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await Bun.sleep(backoffMs * 2 ** attempt);
      continue;
    }
    throw new Error(`${url}: HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic";
  constructor(
    readonly model: string,
    private readonly o: HttpOptions,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const cached = this.o.cache === false ? { system: req.system, messages: req.messages } : withCacheBreakpoints(req.system, req.messages);
    const body = {
      model: this.model,
      max_tokens: req.maxTokens,
      system: cached.system,
      messages: cached.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(this.o.temperatureMilli !== undefined ? { temperature: this.o.temperatureMilli / 1000 } : {}),
    };
    let r: any;
    try {
      r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
        { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" }, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000, this.o.timeoutMs);
    } catch (e) {
      // (The account's prepaid credit spent: the run stops cleanly; no credit is ever bought.)
      if (creditSpent((e as Error).message)) throw new CreditExhausted(`the API account's credit is spent (${(e as Error).message.slice(0, 300)}): no further call is made, and nothing is bought`);
      throw e;
    }
    const content: ContentBlock[] = (r.content ?? []).flatMap((b: any): ContentBlock[] =>
      b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }] : []);
    return {
      content,
      usage: {
        input_tokens: r.usage?.input_tokens ?? 0,
        output_tokens: r.usage?.output_tokens ?? 0,
        ...(r.usage?.cache_read_input_tokens !== undefined ? { cache_read_tokens: r.usage.cache_read_input_tokens } : {}),
        ...(r.usage?.cache_creation_input_tokens !== undefined ? { cache_write_tokens: r.usage.cache_creation_input_tokens } : {}),
      },
    };
  }
}
