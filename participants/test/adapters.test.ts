// Real adapters, without the network: each is given a stand-in `fetch`, so
// these check what would be sent and how replies are read, never a real call.

import { expect, test } from "bun:test";
import { AnthropicAdapter, callModel, OpenAICompatibleAdapter, SpendingLimitReached, toChat, type LlmRequest } from "../src/llm";

const req: LlmRequest = {
  purpose: "participant", subject: "mayor", system: "You are the mayor.", maxTokens: 500,
  messages: [
    { role: "user", content: "It is day 1." },
    { role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "do", input: { what: "Publish a notice." } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Done." }] },
  ],
  tools: [{ name: "do", description: "Say what you do.", input_schema: { type: "object", properties: { what: { type: "string" } } } }],
};

function fakeFetch(replies: { status: number; body: any }[]) {
  const sent: { url: string; headers: any; body: any }[] = [];
  const f = (async (url: string, init: any) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, sent };
}

test("Anthropic: the request is the Messages API's, and the reply is read into content and usage", async () => {
  const { f, sent } = fakeFetch([
    { status: 429, body: { error: "slow down" } }, // retried
    { status: 200, body: { content: [{ type: "text", text: "Hi." }, { type: "tool_use", id: "t2", name: "do", input: { what: "x" } }], usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 50 } } },
  ]);
  const a = new AnthropicAdapter("claude-sonnet-5", { apiKey: "sk-test", fetch: f, backoffMs: 0, temperatureMilli: 700 });
  const r = await a.complete(req);
  expect(sent.length).toBe(2);
  expect(sent[1]!.url).toBe("https://api.anthropic.com/v1/messages");
  expect(sent[1]!.headers["x-api-key"]).toBe("sk-test");
  expect(sent[1]!.body).toMatchObject({ model: "claude-sonnet-5", max_tokens: 500, system: "You are the mayor.", temperature: 0.7, tools: req.tools });
  expect(sent[1]!.body.messages).toEqual(req.messages);
  expect(r.content).toEqual([{ type: "text", text: "Hi." }, { type: "tool_use", id: "t2", name: "do", input: { what: "x" } }]);
  expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 30, cache_read_tokens: 50 });
  // A client error isn't retried; it's reported with the provider's message.
  const bad = fakeFetch([{ status: 400, body: { error: "bad request" } }]);
  await expect(new AnthropicAdapter("m", { apiKey: "k", fetch: bad.f }).complete(req)).rejects.toThrow("HTTP 400");
});

test("OpenAI-compatible: tool uses become tool_calls, tool results become tool messages, and replies map back", async () => {
  expect(toChat("sys", req.messages)).toEqual([
    { role: "system", content: "sys" },
    { role: "user", content: "It is day 1." },
    { role: "assistant", content: "Let me look.", tool_calls: [{ id: "t1", type: "function", function: { name: "do", arguments: '{"what":"Publish a notice."}' } }] },
    { role: "tool", tool_call_id: "t1", content: "Done." },
  ]);
  const { f, sent } = fakeFetch([{ status: 200, body: {
    choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "do", arguments: '{"what":"y"}' } }, { id: "c2", type: "function", function: { name: "do", arguments: "{not json" } }] } }],
    usage: { prompt_tokens: 200, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } },
  } }]);
  const r = await new OpenAICompatibleAdapter("openai", "gpt-x", { apiKey: "sk-o", fetch: f }).complete(req);
  expect(sent[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
  expect(sent[0]!.headers.authorization).toBe("Bearer sk-o");
  expect(sent[0]!.body.max_completion_tokens).toBe(500);
  expect(sent[0]!.body.tools[0]).toEqual({ type: "function", function: { name: "do", description: "Say what you do.", parameters: req.tools![0]!.input_schema } });
  expect(r.content).toEqual([{ type: "tool_use", id: "c1", name: "do", input: { what: "y" } }, { type: "tool_use", id: "c2", name: "do", input: { _unparsed: "{not json" } }]);
  expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 20, cache_read_tokens: 80 });
  // A local server: no key, max_tokens.
  const local = fakeFetch([{ status: 200, body: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } }]);
  await new OpenAICompatibleAdapter("ollama", "qwen", { baseUrl: "http://localhost:11434/v1", fetch: local.f }).complete(req);
  expect(local.sent[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
  expect(local.sent[0]!.headers.authorization).toBeUndefined();
  expect(local.sent[0]!.body.max_tokens).toBe(500);
});

test("the spending limit: no call that could exceed it is made; debriefs may use the 5% kept back", async () => {
  let calls = 0;
  const adapter = { provider: "anthropic", model: "m", complete: async () => (calls++, { content: [{ type: "text" as const, text: "ok" }], usage: { input_tokens: 1000, output_tokens: 100 } }) };
  const prices = { "anthropic/m": { input: 3_000_000, output: 15_000_000 } }; // $3 and $15 per million
  const annotations: any[] = [];
  // Worst case of this call: ~150 input tokens (estimated generously) and 500 output: about $0.008 (7,950 micro-USD).
  // A limit of $0.017: the run may use 95% ($0.01615) and debriefs the rest.
  const io = { adapter, annotate: async (a: object) => void annotations.push(a), now: () => 0, prices, budget: { limitMicroUsd: 17_000, spentMicroUsd: 0 } };
  await callModel(io, req, new Set());
  expect(io.budget.spentMicroUsd).toBe(3000 + 1500); // what the call actually cost
  expect(annotations.find((a) => a.annotation === "usage").cost_microusd).toBe(4500);
  await callModel(io, req, new Set()); // 9,000 spent: the next could take it to ~16,950, past the 16,150 the run may use
  await expect(callModel(io, req, new Set())).rejects.toBeInstanceOf(SpendingLimitReached);
  expect(calls).toBe(2);
  // A debrief may use the whole limit.
  await callModel(io, { ...req, purpose: "debrief" }, new Set());
  expect(calls).toBe(3);
  // No price, no call.
  await expect(callModel({ ...io, prices: {} }, req, new Set())).rejects.toThrow("no price recorded");
});
