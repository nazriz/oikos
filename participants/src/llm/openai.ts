// Any OpenAI-compatible chat-completions endpoint as an LlmAdapter: OpenAI's
// API, or a local open-weight model behind Ollama, vLLM or LM Studio (their
// /v1/chat/completions). The adapter interface is Anthropic-shaped; this maps
// it: tool uses become `tool_calls`, tool results become `tool` messages.

import type { ContentBlock, LlmAdapter, LlmMessage, LlmRequest, LlmResponse } from "./adapter";
import { post, type HttpOptions } from "./anthropic";

export interface OpenAIOptions extends Omit<HttpOptions, "apiKey"> {
  /** Not needed for a local server. */
  apiKey?: string;
  /** e.g. https://api.openai.com/v1 (default), or http://localhost:11434/v1 for Ollama. */
  baseUrl?: string;
  /** OpenAI's newer models take max_completion_tokens; most local servers take max_tokens. Default: by provider. */
  tokenField?: "max_tokens" | "max_completion_tokens";
}

/** Our messages, in the chat-completions shape. */
export function toChat(system: string, messages: LlmMessage[]): object[] {
  const out: object[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const text = m.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
    if (m.role === "assistant") {
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
      continue;
    }
    for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

export class OpenAICompatibleAdapter implements LlmAdapter {
  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly o: OpenAIOptions,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const tokenField = this.o.tokenField ?? (this.provider === "openai" ? "max_completion_tokens" : "max_tokens");
    const body = {
      model: this.model,
      [tokenField]: req.maxTokens,
      messages: toChat(req.system, req.messages),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
      ...(this.o.temperatureMilli !== undefined ? { temperature: this.o.temperatureMilli / 1000 } : {}),
    };
    const r = await post(this.o.fetch ?? fetch, `${this.o.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
      this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}, body, this.o.retries ?? 4, this.o.backoffMs ?? 2000);
    const msg = r.choices?.[0]?.message ?? {};
    const content: ContentBlock[] = [];
    if (typeof msg.content === "string" && msg.content) content.push({ type: "text", text: msg.content });
    for (const c of msg.tool_calls ?? []) {
      let input: any;
      try {
        input = JSON.parse(c.function?.arguments ?? "{}");
      } catch {
        input = { _unparsed: String(c.function?.arguments ?? "") }; // a malformed call, recorded as it came (the participant treats it as malformed)
      }
      content.push({ type: "tool_use", id: c.id, name: c.function?.name ?? "", input });
    }
    const cached = r.usage?.prompt_tokens_details?.cached_tokens;
    return {
      content,
      usage: {
        input_tokens: (r.usage?.prompt_tokens ?? 0) - (cached ?? 0),
        output_tokens: r.usage?.completion_tokens ?? 0,
        ...(cached !== undefined ? { cache_read_tokens: cached } : {}),
      },
    };
  }
}
