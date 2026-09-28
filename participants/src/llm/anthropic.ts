// The Anthropic Messages API as an LlmAdapter. The adapter interface is
// shaped like this API, so the mapping is direct. No call is made unless a
// run is explicitly started with a real model and a spending limit
// (orchestrator/src/cli.ts); tests inject `fetch`.

import type { ContentBlock, LlmAdapter, LlmRequest, LlmResponse } from "./adapter";

export interface HttpOptions {
  apiKey: string;
  baseUrl?: string;
  /** For tests: a stand-in for the network. */
  fetch?: typeof fetch;
  /** Sampling temperature, in thousandths (a world's controller params: temperature_milli). */
  temperatureMilli?: number;
  /** Retries on rate limits and server errors (default 4), with exponential backoff from `backoffMs`. */
  retries?: number;
  backoffMs?: number;
}

/** Retry a request on 429 and 5xx, with exponential backoff. Other errors are thrown with the provider's message. */
export async function post(f: typeof fetch, url: string, headers: Record<string, string>, body: object, retries: number, backoffMs: number): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
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
    const body = {
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(this.o.temperatureMilli !== undefined ? { temperature: this.o.temperatureMilli / 1000 } : {}),
    };
    const r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" }, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000);
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
