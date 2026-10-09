// Real adapters, without the network: each is given a stand-in `fetch`, so
// these check what would be sent and how replies are read, never a real call.

import { expect, test } from "bun:test";
import { controlsEscaped } from "../src/llm/answer";
import { CodexCliAdapter, codexPrompt, LIMITED, runBounded } from "../src/llm/codex";
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
  const a = new AnthropicAdapter("claude-sonnet-5", { apiKey: "sk-test", fetch: f, backoffMs: 0, temperatureMilli: 700, cache: false });
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

test("Anthropic: prompt caching marks the system prompt and the last message, without changing the conversation", async () => {
  const { f, sent } = fakeFetch([{ status: 200, body: { content: [{ type: "text", text: "Hi." }], usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } } }]);
  const before = JSON.stringify(req);
  const r = await new AnthropicAdapter("claude-sonnet-5", { apiKey: "k", fetch: f, backoffMs: 0 }).complete(req);
  const body = sent[0]!.body;
  expect(body.system).toEqual([{ type: "text", text: "You are the mayor.", cache_control: { type: "ephemeral" } }]);
  expect(body.messages.slice(0, -1)).toEqual(req.messages.slice(0, -1));
  expect(body.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Done.", cache_control: { type: "ephemeral" } }] });
  expect(JSON.stringify(req)).toBe(before); // the participant's own conversation is untouched
  // A plain-text last message becomes a text block, marked.
  const one = fakeFetch([{ status: 200, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }]);
  await new AnthropicAdapter("m", { apiKey: "k", fetch: one.f }).complete({ ...req, messages: [{ role: "user", content: "It is day 1." }] });
  expect(one.sent[0]!.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "It is day 1.", cache_control: { type: "ephemeral" } }] }]);
  // Cached input is priced as the provider prices it: reads at a tenth, writes at 1.25x.
  expect(r.usage).toEqual({ input_tokens: 20, output_tokens: 5, cache_read_tokens: 900, cache_write_tokens: 100 });
  const price = { input: 2_000_000, output: 10_000_000, cache_read: 200_000, cache_write: 2_500_000 };
  const { costMicroUsd } = await import("../src/llm/adapter");
  expect(costMicroUsd(price, r.usage)).toBe(Math.ceil((20 * 2_000_000 + 5 * 10_000_000 + 900 * 200_000 + 100 * 2_500_000) / 1e6));
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

test("Codex CLI: one `codex exec` per call, read-only and ephemeral; the schema-shaped answer becomes tool uses (the notebook alongside an action); tokens from turn.completed", async () => {
  const { CodexCliAdapter } = await import("../src/llm/codex");
  const seen: { args: string[]; stdin: string; cwd: string; schema: any }[] = [];
  const runner = async (args: string[], stdin: string, cwd: string) => {
    const schemaPath = args[args.indexOf("--output-schema") + 1]!;
    const lastPath = args[args.indexOf("--output-last-message") + 1]!;
    seen.push({ args, stdin, cwd, schema: JSON.parse(await Bun.file(schemaPath).text()) });
    await Bun.write(lastPath, JSON.stringify({ tool: "do", input_json: '{"what":"Publish a notice."}', also: [{ tool: "notebook", input_json: '{"text":"Asked for the figures."}' }], text: "" }));
    return { code: 0, stderr: "", stdout: ['{"type":"thread.started"}', '{"type":"turn.completed","usage":{"input_tokens":2400,"cached_input_tokens":1000,"output_tokens":40,"reasoning_output_tokens":60}}'].join("\n") };
  };
  const nb = { name: "notebook", description: "Your notebook.", input_schema: { type: "object" } };
  const r = await new CodexCliAdapter("gpt-5", runner).complete({ ...req, tools: [...req.tools!, nb] });
  const a = seen[0]!;
  for (const f of ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]) expect(a.args).toContain(f);
  expect(a.args.slice(a.args.indexOf("--sandbox"), a.args.indexOf("--sandbox") + 2)).toEqual(["--sandbox", "read-only"]);
  expect(a.args.slice(a.args.indexOf("-m"), a.args.indexOf("-m") + 2)).toEqual(["-m", "gpt-5"]);
  expect(a.args.at(-1)).toBe("-"); // the prompt on stdin
  expect(a.stdin).toContain("You are the mayor.");
  expect(a.stdin).toContain("[used do:"); // the conversation so far
  expect(a.schema.properties.tool.enum).toEqual(["do", "notebook"]); // exactly one main tool use, as before
  expect(a.schema.properties.also.items.properties.tool.enum).toEqual(["do", "notebook"]);
  expect(r.content).toEqual([
    { type: "tool_use", id: "codex-1", name: "do", input: { what: "Publish a notice." } },
    { type: "tool_use", id: "codex-2", name: "notebook", input: { text: "Asked for the figures." } },
  ]);
  expect(r.usage).toEqual({ input_tokens: 1400, output_tokens: 100, cache_read_tokens: 1000 });
  // A failed run is an error, with what codex said.
  const failing = async () => ({ code: 1, stdout: "", stderr: "not signed in" });
  await expect(new CodexCliAdapter("gpt-5", failing).complete(req)).rejects.toThrow("not signed in");
  // The subscription's usage limit: not retried (it lasts hours); the run stops, to be resumed, as at a spending limit.
  const { UsageLimitReached, SpendingLimitReached: Spending } = await import("../src/llm/call");
  let tries = 0;
  const limited = async () => (tries++, { code: 1, stdout: "", stderr: "ERROR: You've hit your usage limit. Try again in 2 hours." });
  const e = await new CodexCliAdapter("gpt-5", limited).complete(req).catch((x) => x);
  expect(e).toBeInstanceOf(UsageLimitReached);
  expect(e).toBeInstanceOf(Spending);
  expect(tries).toBe(1);
  // Also when it's reported as an event and the process exits cleanly.
  const asEvent = async () => ({ code: 0, stderr: "", stdout: '{"type":"turn.failed","error":{"message":"429 Too Many Requests: usage_limit_reached"}}' });
  await expect(new CodexCliAdapter("gpt-5", asEvent).complete(req)).rejects.toBeInstanceOf(UsageLimitReached);
});

test("Codex CLI: the wrapper's wording agrees with the instructions that several tools can be used in one answer", () => {
  const prompt = codexPrompt({ ...req, system: "You can take several actions at once (up to 8)." });
  expect(prompt).not.toContain("one per answer");
  expect(prompt).not.toContain("Choose one tool");
  expect(prompt).toContain("=== Tools you can use ===");
  expect(prompt).toContain("If you use more than one tool in this answer, as your instructions allow, the first goes in `tool` and every other one in `also`");
});

test("Codex CLI: only the subscription's usage limit and rate limits stop the run; another limit reached is an ordinary failure", async () => {
  const { CodexCliAdapter } = await import("../src/llm/codex");
  const { UsageLimitReached } = await import("../src/llm/call");
  for (const s of ["ERROR: You've hit your usage limit. Try again in 2 hours.", "429 Too Many Requests: usage_limit_reached", "stream error: exceeded retry limit, last status: 429 Too Many Requests", "Rate limit reached for gpt-6.1-sol. Please try again in 20s.", "rate_limit_exceeded"]) expect(LIMITED.test(s)).toBe(true);
  for (const s of ["Your input exceeds the context window: token limit reached.", "maximum output limit reached", "the model hit your limit of 4000 tokens", "not signed in"]) expect(LIMITED.test(s)).toBe(false);
  // Through the adapter: retried like any failure, then reported as one, with what was said (the seat waits; the run goes on).
  let tries = 0;
  const contextFull = async () => (tries++, { code: 1, stdout: "", stderr: "ERROR: context length limit reached for this conversation" });
  const e = await new CodexCliAdapter("gpt-5", contextFull, { attempts: 1 }).complete(req).catch((x) => x);
  expect(e).not.toBeInstanceOf(UsageLimitReached);
  expect(String(e.message)).toContain("context length limit reached");
  expect(tries).toBe(1);
  const limited = async () => ({ code: 1, stdout: "", stderr: "Rate limit reached for gpt-6.1-sol." });
  await expect(new CodexCliAdapter("gpt-5", limited).complete(req)).rejects.toBeInstanceOf(UsageLimitReached);
  // A limit the CLI reported before it stopped answering (the call ran out of time): the run stops as at a limit, at
  // the first attempt, and is not taken for a model that was only slow and tried again (2026-10-09).
  let waits = 0;
  const hung = async () => (waits++, { code: 143, timedOut: true, stderr: "", stdout: '{"type":"error","message":"You’ve hit your usage limit. Upgrade to Pro or try again at 6:58 AM."}\n' });
  const lim = await new CodexCliAdapter("gpt-5", hung, { attempts: 3 }).complete(req).catch((x) => x);
  expect(lim).toBeInstanceOf(UsageLimitReached);
  expect(String(lim.message)).toContain("try again at 6:58 AM");
  expect(waits).toBe(1);
  // One that ran out of time saying nothing of a limit is an ordinary failure, and what the CLI last said goes with it.
  const slow = async () => ({ code: 143, timedOut: true, stdout: "", stderr: "stream disconnected, retrying 4/5\n" });
  const late = await new CodexCliAdapter("gpt-5", slow, { attempts: 1, timeoutMs: 180_000 }).complete(req).catch((x) => x);
  expect(late).not.toBeInstanceOf(UsageLimitReached);
  expect(String(late.message)).toContain("no answer within 180 s; the last it said: stream disconnected, retrying 4/5");
});

test("a command that won't end can't hang a call: asked to end at the time limit, killed after a grace period, and its pipes not waited on", async () => {
  // Ignores the request to end, and leaves something behind holding its output open.
  const stuck = ["sh", "-c", "trap '' TERM; echo started; sleep 6 & while :; do sleep 1; done"];
  const t0 = performance.now();
  const r = await runBounded(stuck, "", import.meta.dir, 300, 300, 300);
  const took = performance.now() - t0;
  expect(r.timedOut).toBe(true);
  expect(r.stdout).toBe("started\n"); // what it had said is kept
  expect(took).toBeGreaterThanOrEqual(600);
  expect(took).toBeLessThan(5000);
  // One that ends when asked is done at once, and one that finishes in time is read whole.
  const t1 = performance.now();
  expect((await runBounded(["sleep", "30"], "", import.meta.dir, 200, 5000)).timedOut).toBe(true);
  expect(performance.now() - t1).toBeLessThan(3000);
  expect(await runBounded(["sh", "-c", "cat; echo err >&2; exit 3"], "said on stdin", import.meta.dir, 5000)).toEqual({ code: 3, stdout: "said on stdin", stderr: "err\n", timedOut: false });
  // Through the adapter: a call whose every attempt times out fails, saying so.
  const { CodexCliAdapter } = await import("../src/llm/codex");
  const never = (_a: string[], stdin: string, cwd: string, timeoutMs: number) => runBounded(stuck, stdin, cwd, timeoutMs, 100, 100);
  await expect(new CodexCliAdapter("gpt-5", never, { timeoutMs: 200, attempts: 1 }).complete(req)).rejects.toThrow("no answer within");
}, 180_000);

test("a text written with its line breaks as themselves is read as the model meant it", async () => {
  const raw = '{"text":"Day 11.\nRates: 295 valued,\tnone levied.\nNext: \\"review\\" the draft."}';
  expect(() => JSON.parse(raw)).toThrow();
  expect(JSON.parse(controlsEscaped(raw))).toEqual({ text: 'Day 11.\nRates: 295 valued,\tnone levied.\nNext: "review" the draft.' });
  // (Outside a text nothing changes, and well-formed JSON comes back as it was.)
  expect(controlsEscaped('{\n "a": "b\\n"\n}')).toBe('{\n "a": "b\\n"\n}');
  // Through the adapter: the notebook is a notebook, not something unreadable.
  const answer = JSON.stringify({ tool: "notebook", input_json: raw, also: [], text: "" });
  const adapter = new CodexCliAdapter("gpt-test", async (args) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, answer);
    return { code: 0, stdout: "", stderr: "" };
  });
  const res = await adapter.complete({ purpose: "participant", subject: "x", system: "s", messages: [{ role: "user", content: "hi" }], tools: [{ name: "notebook", description: "", input_schema: {} }], maxTokens: 100 });
  expect(res.content).toEqual([{ type: "tool_use", id: "codex-1", name: "notebook", input: { text: 'Day 11.\nRates: 295 valued,\tnone levied.\nNext: "review" the draft.' } }]);
});

