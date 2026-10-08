// How a seat's answer is asked for and read (participants/src/llm/answer.ts, claude-code.ts, codex.ts): exactly or not
// at all. The loop's side of it (telling the seat, asking once more) is in llm-participant.test.ts.

import { expect, test } from "bun:test";
import { readAnswerText } from "../src/llm/answer";
import { UsageLimitReached } from "../src/llm/call";
import { answerFrom, ClaudeCodeAdapter, claudeCodeSystem } from "../src/llm/claude-code";
import { CodexCliAdapter } from "../src/llm/codex";
import type { LlmRequest } from "../src/llm";

const req: LlmRequest = {
  purpose: "participant", subject: "mayor", system: "You are the mayor.", maxTokens: 500,
  messages: [
    { role: "user", content: "It is day 1." },
    { role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "do", input: { what: "Publish a notice." } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Done." }] },
  ],
  tools: [{ name: "do", description: "Say what you do.", input_schema: { type: "object", properties: { what: { type: "string" } } } }],
};
const ids = () => { let n = 0; return () => `u${++n}`; };

test("Claude Code: one `claude -p` per call with our system prompt in place of its own, no tools of its own, and the answer asked for as structured output, read exactly; tokens from the result; a limit stops the run", async () => {
  const seen: { args: string[]; stdin: string; system: string }[] = [];
  const result = (said: string, extra: object = {}) => JSON.stringify({ type: "result", is_error: false, num_turns: 3, result: said, total_cost_usd: 0.01, usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 2900, cache_creation_input_tokens: 120 }, ...extra });
  const structured = { tool: "do", input_json: '{"what":"Publish a notice."}', also: [{ tool: "do", input_json: '{"what":"Tell the clerk."}' }], text: "" };
  const runner = async (args: string[], stdin: string) => {
    seen.push({ args, stdin, system: await Bun.file(args[args.indexOf("--system-prompt-file") + 1]!).text() });
    return { code: 0, stderr: "", stdout: result("", { structured_output: structured }) };
  };
  const r = await new ClaudeCodeAdapter("claude-sonnet-5-5@low", runner).complete(req);
  expect(seen.length).toBe(1);
  const a = seen[0]!;
  for (const f of ["-p", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) expect(a.args).toContain(f);
  expect(a.args.slice(a.args.indexOf("--model"), a.args.indexOf("--model") + 2)).toEqual(["--model", "claude-sonnet-5-5"]);
  expect(a.args.slice(a.args.indexOf("--effort"), a.args.indexOf("--effort") + 2)).toEqual(["--effort", "low"]);
  expect(a.args.slice(a.args.indexOf("--tools"), a.args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
  // The answer's shape is the schema's: the tool among the seat's, its input as a string, others alongside.
  const schema = JSON.parse(a.args[a.args.indexOf("--json-schema") + 1]!);
  expect(schema.properties.tool.enum).toEqual(["do"]);
  expect(schema.required).toEqual(["tool", "input_json", "also", "text"]);
  // What is the same call after call (the instructions and the tools) is the system prompt; the conversation is not in it.
  expect(a.system).toBe(claudeCodeSystem(req));
  expect(a.system).toContain("You are the mayor.");
  expect(a.system).toContain("- do:");
  expect(a.system).toContain("=== How you answer ===\nGive your answer in the structured output asked for");
  expect(a.system).not.toContain("[used do:");
  expect(a.stdin).toContain("[used do:");
  expect(a.stdin).not.toContain("You are the mayor.");
  expect(r.content).toEqual([
    { type: "tool_use", id: "claude-code-1", name: "do", input: { what: "Publish a notice." } },
    { type: "tool_use", id: "claude-code-2", name: "do", input: { what: "Tell the clerk." } },
  ]);
  expect(r.usage).toEqual({ input_tokens: 4, output_tokens: 300, cache_read_tokens: 2900, cache_write_tokens: 120, reported_cost_microusd: 10000 });
  // With no tools: the words, and no schema.
  let noTools: string[] = [];
  const words = await new ClaudeCodeAdapter("claude-sonnet-5-5", async (args) => (noTools = args, { code: 0, stderr: "", stdout: result("Thanks for asking.") })).complete({ ...req, tools: undefined });
  expect(words.content).toEqual([{ type: "text", text: "Thanks for asking." }]);
  expect(noTools).not.toContain("--json-schema");
  // The plan's limit: the run stops, to be resumed.
  const limited = async () => ({ code: 1, stderr: "", stdout: result("Claude usage limit reached. Your limit will reset at 3pm.", { is_error: true }) });
  await expect(new ClaudeCodeAdapter("claude-sonnet-5-5", limited).complete(req)).rejects.toBeInstanceOf(UsageLimitReached);
  // (The words seen on 2026-10-08, when the plan's five-hour window ran out under a pilot and the agents beside it.)
  const session = async () => ({ code: 1, stderr: "", stdout: result("You've hit your session limit · resets 2:20pm (Australia/Melbourne)", { is_error: true }) });
  await expect(new ClaudeCodeAdapter("claude-sonnet-5-5", session).complete(req)).rejects.toBeInstanceOf(UsageLimitReached);
  // Any other failure is an error, with what it said.
  const failing = async () => ({ code: 1, stdout: "", stderr: "not signed in" });
  await expect(new ClaudeCodeAdapter("claude-sonnet-5-5", failing, { attempts: 1 }).complete(req)).rejects.toThrow("not signed in");
});

test("a seat's answer is read exactly or not at all: each way it can be not whole is one unread answer, never a guess (pilots 10 and 11)", () => {
  const tools = ["look", "write", "do", "done_for_now", "opt_out", "notebook"];
  const whole = JSON.stringify({ tool: "look", input_json: '{"report":"finance/who"}', also: [{ tool: "notebook", input_json: '{"add":"Looked."}' }], text: "" });
  // As asked: the object, bare or inside one code fence, or as structured output.
  const read = [readAnswerText(whole, tools, ids()), readAnswerText("```json\n" + whole + "\n```", tools, ids()), answerFrom({ structured_output: JSON.parse(whole) }, tools, ids())];
  for (const c of read) expect(c).toEqual([{ type: "tool_use", id: "u1", name: "look", input: { report: "finance/who" } }, { type: "tool_use", id: "u2", name: "notebook", input: { add: "Looked." } }]);
  // Its words come with it as words, never as a use.
  expect(readAnswerText(JSON.stringify({ tool: "write", input_json: { to: ["bank"], text: "Hello." }, text: "A note." }), tools, ids())).toEqual([{ type: "text", text: "A note." }, { type: "tool_use", id: "u1", name: "write", input: { to: ["bank"], text: "Hello." } }]);
  // A line break written as itself inside a text is the same text.
  expect(readAnswerText('{"tool":"notebook","input_json":"{\\"add\\":\\"a\nb\\"}","also":[],"text":""}', tools, ids())).toEqual([{ type: "tool_use", id: "u1", name: "notebook", input: { add: "a\nb" } }]);
  // Not whole: one unread block holding what was written, and why.
  const unread = (said: string) => {
    const c = readAnswerText(said, tools, ids());
    expect(c.length).toBe(1);
    expect(c[0]!.type).toBe("text");
    expect((c[0] as any).unread).toBeTruthy();
    return c[0] as any;
  };
  expect(unread("I would rather not.").text).toBe("I would rather not."); // words
  unread(`Here is what I do: ${whole}`); // words before it
  unread(`${whole}\nI hope that is right.`); // words after it
  unread(`${whole}\n${whole}`); // two answers
  unread(whole.slice(0, 40)); // cut off
  unread('<invoke name="look">\n<parameter name="report">finance/who</parameter>\n</invoke>'); // the model's own markup: never read as uses
  unread('{"tool":"pay","input_json":"{}","also":[],"text":""}'); // not one of its tools
  unread('{"tool":"look","input_json":"{}","also":[{"tool":"pay","input_json":"{}"}],"text":""}'); // nor an other one
  unread('{"tool":"look","input_json":"{}","also":[],"text":"","extra":1}'); // something the form doesn't have
  unread('{"tool":"look","input_json":"[1]","also":[],"text":""}'); // an input that isn't an object
  unread('{"tool":"look","input_json":"{\\"report\\": ","also":[],"text":""}'); // an input that isn't JSON
  unread('{"tool":"look","input_json":"{}","also":"notebook","text":""}'); // others not as a list
  unread('{"input_json":"{}","also":[],"text":""}'); // no tool
  // The pilot 11 answer: its real uses, then uses filled in with "x" (a letter, an opt-out, a decline), as the model's markup. None is read.
  const ranOn = '<invoke name="look">\n<parameter name="report">finance/files</parameter>\n</invoke>\n<invoke name="done_for_now">\n<parameter name="days">1</parameter>\n</invoke>\n<invoke name="write">\n<parameter name="to">["mayor"]</parameter>\n<parameter name="text">x</parameter>\n</invoke>\n<invoke name="opt_out">\n<parameter name="statement">x</parameter>\n</invoke>';
  expect(readAnswerText(ranOn, tools, ids()).some((b) => b.type === "tool_use")).toBe(false);
  // Only a way out of the study whose input can't be read is passed on, to be asked about, and not refused.
  expect(readAnswerText('{"tool":"opt_out","input_json":"{\\"statement\\": \\"I would rather not go on","also":[],"text":""}', tools, ids())).toEqual([{ type: "tool_use", id: "u1", name: "opt_out", input: { _unparsed: '{"statement": "I would rather not go on' } }]);
});

test("Claude Code: an answer a seat gave that can't be read is returned unread, not asked for again by the adapter; for the other purposes it is asked again", async () => {
  const result = (said: string) => JSON.stringify({ type: "result", is_error: false, num_turns: 1, result: said, usage: {} });
  let calls = 0;
  const words = async () => (calls++, { code: 0, stderr: "", stdout: result("I would rather not.") });
  const seat = await new ClaudeCodeAdapter("claude-sonnet-5-5", words).complete(req);
  expect(calls).toBe(1);
  expect(seat.content).toEqual([{ type: "text", text: "I would rather not.", unread: expect.any(String) }]);
  calls = 0;
  const translator = await new ClaudeCodeAdapter("claude-sonnet-5-5", words, { attempts: 2 }).complete({ ...req, purpose: "translator" });
  expect(calls).toBe(2);
  expect(translator.content[0]).toMatchObject({ type: "text", text: "I would rather not." });
});

test("Codex CLI: a use's input that is not exactly an object is unread, not repaired (a whole object followed by stray characters, pilot 7d)", async () => {
  const run = (said: string) => new CodexCliAdapter("gpt-test", async (args) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, said);
    return { code: 0, stdout: "", stderr: "" };
  }).complete(req);
  const stray = await run(JSON.stringify({ tool: "do", input_json: '{"what":"Publish a notice."}]}],', also: [], text: "" }));
  expect(stray.content).toEqual([{ type: "text", text: expect.any(String), unread: expect.any(String) }]);
  const words = await run("I do it.");
  expect(words.content).toEqual([{ type: "text", text: "I do it.", unread: expect.any(String) }]);
});

test("an answer asked for as one object of the caller's own shape: the schema is the caller's, and the object comes back as it is, with no string of JSON inside it to escape", async () => {
  const schema = { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "program"], properties: { id: { type: "string" }, program: { type: "string" } } } } } };
  const ask: LlmRequest = { purpose: "consult", subject: "reader", system: "You translate.", maxTokens: 500, messages: [{ role: "user", content: "Two requests." }], answer: { name: "hand_in", schema }, tools: [{ name: "hand_in", description: "Hand it in.", input_schema: schema }] };
  const object = { answers: [{ id: "a", program: 'message(to="the clerk", text="say \\"yes\\"")' }, { id: "b", program: "none(unclear)" }] };
  // Claude Code: the caller's schema, no tools described, the structured output as the use's input.
  let claude: { args: string[]; system: string } | undefined;
  const result = (extra: object) => JSON.stringify({ type: "result", is_error: false, result: "", usage: { input_tokens: 1, output_tokens: 2 }, ...extra });
  const c = await new ClaudeCodeAdapter("claude-sonnet-5-5", async (args) => {
    claude = { args, system: await Bun.file(args[args.indexOf("--system-prompt-file") + 1]!).text() };
    return { code: 0, stderr: "", stdout: result({ structured_output: object }) };
  }).complete(ask);
  expect(JSON.parse(claude!.args[claude!.args.indexOf("--json-schema") + 1]!)).toEqual(schema);
  expect(claude!.system).toContain("Give your answer in the structured output asked for");
  expect(claude!.system).not.toContain("=== Tools you can use ===");
  expect(c.content).toEqual([{ type: "tool_use", id: "claude-code-1", name: "hand_in", input: object }]);
  // What is not an object is unread, and (not a seat's answer) asked for again.
  let tries = 0;
  const bad = await new ClaudeCodeAdapter("claude-sonnet-5-5", async () => (tries++, { code: 0, stderr: "", stdout: result({ result: "Here are my answers." }) }), { attempts: 2 }).complete(ask).catch((e) => e);
  expect(tries).toBe(2);
  expect(bad.content).toEqual([{ type: "text", text: "Here are my answers.", unread: "it wasn't in the form asked for" }]);
  // The Codex CLI: the same schema as its output schema, the last message as the object.
  let codexSchema: unknown, prompt = "";
  const x = await new CodexCliAdapter("gpt-test", async (args, stdin) => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    codexSchema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1]!, "utf8"));
    prompt = stdin;
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify(object));
    return { code: 0, stdout: "", stderr: "" };
  }).complete(ask);
  expect(codexSchema).toEqual(schema);
  expect(prompt).toContain("Answer only with the JSON object the output schema asks for.");
  expect(prompt).not.toContain("=== Tools you can use ===");
  expect(x.content).toEqual([{ type: "tool_use", id: "codex-1", name: "hand_in", input: object }]);
});
