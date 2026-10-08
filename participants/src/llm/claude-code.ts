// Anthropic models through Claude Code's non-interactive mode (`claude -p`), so a Claude plan's sign-in can stand in
// for an API key. Each call runs `claude -p` once: our system prompt (and the tools, which are the same call after
// call) replace Claude Code's own; the conversation goes in on stdin; the answer comes back as one structured object in
// the shape the Codex adapter's schema has (`--json-schema`), which we read, exactly or not at all (answer.ts), as tool
// uses or text. Token counts, cached ones too, come from the result.
//
// Caveats, recorded with every run that uses it (docs/real-models.md):
//  - It is not free: `claude -p` draws on the plan's monthly Agent SDK credit, at API rates; when that is
//    spent, calls stop (or, if the account has usage credits switched on, are billed). So a run needs a spending limit
//    like any priced model, and the price is the model's published API price.
//  - Claude Code keeps what is the same from call to call cached for an hour by itself (the system prompt and tools):
//    that is why the tools are put with the system prompt and not with the conversation.
//  - How the answer is asked for was chosen on a measurement (2026-10-08, docs/real-models.md): asked for as an object
//    in words, Sonnet 5.5 wrote its own tool-use markup instead in about half of 19 sittings replayed (and Haiku 5.5 in
//    1 in 13), and asked for in that markup it was read whole in 79%; the schema, which Claude Code answers through a
//    tool of its own, was read whole in every one of 38, at 2 to 8 model turns but a cost within 10% of the others
//    (the turns re-read what is cached).
//  - Claude Code makes a small call to a smaller model of its own beside ours, which our counts leave out; and the
//    cost it reports for a call is more than its token counts come to at the published price (about twice, same
//    measurement: why is not known). With OIKOS_CLAUDE_CODE_LOG=<file>, each call's counts and cost as Claude Code
//    reports them are added to that file (never the prompt or the answer), to set beside what the log's tokens come to.
//  - The model version is the one named; the plan's limits apply.
// It runs with no tools of its own, no settings, skills or servers, keeping no session files, in an empty directory.

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, LlmAdapter, LlmRequest, LlmResponse } from "./adapter";
import { readAnswerObject, readAnswerText } from "./answer";
import { UsageLimitReached } from "./call";
import { answerSchema, runBounded, transcript } from "./codex";

/** What Claude Code says when no call will go through for a while: the plan's limit or credit is used up, or its own
 * retries on rate limits gave up. Only those: any other failure is retried and then reported. */
export const CLAUDE_CODE_LIMITED = /usage[ _-]?limit|session[ _-]?limit|weekly[ _-]?limit|hit your [a-z -]*limit|rate[ _-]?limit|too many requests|\b429\b|credit balance|out of (extra |usage )?credits?|limit reached/i;

/** Runs the claude binary: args, stdin and a working directory in; stdout out; ended if it takes longer than
 * `timeoutMs`. Injectable for tests. */
export type ClaudeCodeRunner = (args: string[], stdin: string, cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;

/** (Without ANTHROPIC_API_KEY: with one set, Claude Code would bill that key and not the plan. And without what a
 * Claude Code session sets for the commands it runs, CLAUDECODE, CLAUDE_CODE_… and CLAUDE_EFFORT among them: a run
 * started from inside such a session must be the run it would be from a plain terminal, with its own effort and
 * counted as its own.) */
export const spawnClaudeCode: ClaudeCodeRunner = (args, stdin, cwd, timeoutMs) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ANTHROPIC_API_KEY" && !/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)));
  // (OIKOS_CLAUDE_BIN: which Claude Code to run, where the first on the path is too old for a model: Fable 5.1 wants 2.1.251 or newer.)
  return runBounded([process.env.OIKOS_CLAUDE_BIN || "claude", ...args], stdin, cwd, timeoutMs, undefined, undefined, env);
};

/** What is the same call after call for one seat: its instructions, then the tools and how an answer is given. */
export function claudeCodeSystem(req: LlmRequest): string {
  // (An answer asked for as one object of a shape of the caller's own: no tools to describe.)
  if (req.answer) return [req.system, "", "=== How you answer ===\nGive your answer in the structured output asked for, and nothing besides."].join("\n");
  const tools = (req.tools ?? []).map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`).join("\n");
  return [
    req.system,
    ...(tools
      ? ["", "=== Tools you can use ===", tools, "",
        // (How many tools an answer may use is the instructions' to say: a participant's say several, the translator's one.)
        "=== How you answer ===\nGive your answer in the structured output asked for: the tool you use in `tool`, its input as a JSON object in input_json; any further tools, if your instructions allow several, in `also`, each with its own input_json, in the order they're to be carried out."]
      : []),
  ].join("\n");
}

/** A call's answer as content blocks, read exactly or not at all (answer.ts): the structured output Claude Code returns
 * for the schema, or, failing that, a reply that is exactly the same object. With no tools, its words. */
export function answerFrom(result: any, tools: string[], nextId: () => string): ContentBlock[] {
  if (!tools.length) return [{ type: "text", text: String(result.result ?? "").slice(0, 4000) }];
  const o = result.structured_output;
  if (o !== undefined && o !== null) return readAnswerObject(o, tools, JSON.stringify(o), nextId);
  return readAnswerText(String(result.result ?? ""), tools, nextId);
}

/** A call's answer where the caller asked for one object of its own shape (`answer`): that object as a tool_use block of
 * the name given, or, if what came back is not an object, one unread block. */
export function objectAnswer(result: any, name: string, nextId: () => string): ContentBlock[] {
  let o = result.structured_output;
  if (o === undefined || o === null) {
    try {
      o = JSON.parse(String(result.result ?? "").trim().replace(/^```(?:json)?\s*\n/i, "").replace(/\n```$/, ""));
    } catch {
      o = undefined;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return [{ type: "text", text: String(result.result ?? "").slice(0, 4000), unread: "it wasn't in the form asked for" }];
  return [{ type: "tool_use", id: nextId(), name, input: o }];
}

export class ClaudeCodeAdapter implements LlmAdapter {
  readonly provider = "claude-code";
  private calls = 0;
  constructor(
    readonly model: string,
    private readonly run: ClaudeCodeRunner = spawnClaudeCode,
    /** One attempt's time limit, and how many attempts (D59: a call that never answers mustn't hang the run); how hard
     * the model reasons (Claude Code's --effort; recorded with the model, as it changes what the model does). */
    private readonly o: { timeoutMs?: number; attempts?: number; effort?: string; log?: string } = {},
  ) {}

  /** How hard the model reasons: "claude-sonnet-5-5@low" names it with the model (so every log records it), or the option. */
  private get effort(): string | undefined {
    return this.model.includes("@") ? this.model.split("@")[1] : this.o.effort;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const dir = mkdtempSync(join(tmpdir(), "oikos-claude-code-"));
    try {
      const system = join(dir, "system.txt");
      writeFileSync(system, claudeCodeSystem(req));
      const names = (req.tools ?? []).map((t) => t.name);
      const args = ["-p", "--model", this.model.split("@")[0]!, ...(this.effort ? ["--effort", this.effort] : []), "--system-prompt-file", system, "--tools", "", "--output-format", "json", "--no-session-persistence", "--setting-sources", "",
        "--strict-mcp-config", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections", ...(req.answer ? ["--json-schema", JSON.stringify(req.answer.schema)] : names.length ? ["--json-schema", JSON.stringify(answerSchema(names))] : [])];
      const timeoutMs = this.o.timeoutMs ?? 180_000;
      const attempts = this.o.attempts ?? 3;
      // (A seat's answer that can't be read is not asked for again here: the seat is told what couldn't be read, once, in its
      // own exchange, which is recorded. The other purposes, with no one to tell, are asked again as before.)
      const askAgain = req.purpose !== "participant";
      let result: any;
      let content: ContentBlock[] = [];
      for (let n = 1; ; n++) {
        const r = await this.run(args, transcript(req.messages), dir, timeoutMs);
        try {
          result = JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "");
        } catch {
          result = undefined;
        }
        const nextId = () => `claude-code-${++this.calls}`;
        content = !result || result.is_error ? [] : req.answer ? objectAnswer(result, req.answer.name, nextId) : answerFrom(result, names, nextId);
        const unread = content.some((b) => b.type === "text" && b.unread !== undefined);
        const failed = r.timedOut || r.code !== 0 || !result || result.is_error || (unread && askAgain && n < attempts);
        // (What it said only when it failed: a word in a good answer isn't a limit.)
        const said = failed && !r.timedOut ? [r.stderr, typeof result?.result === "string" ? result.result : "", result?.api_error_status === 429 ? "429" : ""].find((s) => CLAUDE_CODE_LIMITED.test(s)) : undefined;
        if (said) throw new UsageLimitReached(`the Claude plan's limit for claude -p was reached (${said.trim().slice(0, 300)}): the run stops here; resume it once the limit resets (oikos resume <log>)`);
        if (!failed) break;
        const why = r.timedOut ? `no answer within ${Math.round(timeoutMs / 1000)} s` : `exit ${r.code}: ${(r.stderr || String(result?.result ?? r.stdout)).slice(0, 500)}`;
        if (n >= attempts) throw new Error(`claude -p failed after ${n} attempts (${why})`);
        await Bun.sleep(1000 * 2 ** (n - 1));
      }
      const u = result.usage ?? {};
      const usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0, ...(typeof result.total_cost_usd === "number" ? { reported_cost_microusd: Math.ceil(result.total_cost_usd * 1e6) } : {}) };
      const log = this.o.log ?? process.env.OIKOS_CLAUDE_CODE_LOG;
      if (log) appendFileSync(log, JSON.stringify({ subject: req.subject, purpose: req.purpose, model: this.model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_tokens: usage.cache_read_tokens, cache_write_tokens: usage.cache_write_tokens, turns: result.num_turns, reported_usd: result.total_cost_usd, by_model: result.modelUsage, ms: result.duration_ms }) + "\n");
      return { content, usage };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
