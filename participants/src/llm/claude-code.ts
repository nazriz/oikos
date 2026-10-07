// Anthropic models through Claude Code's non-interactive mode (`claude -p`), so a Claude plan's sign-in can stand in
// for an API key. Each call runs `claude -p` once: our system prompt (and the tools, which are the same call after
// call) replace Claude Code's own; the conversation goes in on stdin; the answer comes back as one JSON object in the
// shape the Codex adapter's schema has, which we read as a tool use or text. Token counts, cached ones too, come from
// the result.
//
// Caveats, recorded with every run that uses it (docs/real-models.md):
//  - It is not free: `claude -p` draws on the plan's monthly Agent SDK credit, at API rates; when that is
//    spent, calls stop (or, if the account has usage credits switched on, are billed). So a run needs a spending limit
//    like any priced model, and the price is the model's published API price.
//  - Claude Code keeps what is the same from call to call cached for an hour by itself (the system prompt and tools):
//    that is why the tools are put with the system prompt and not with the conversation.
//  - The answer's shape is asked for in words, not forced with --json-schema: forced, Claude Code takes two to four
//    turns of the model for one answer and writes the cache again each time (measured 2026-10-07 on one seat-sized
//    call: forced cost about twice what asked did; docs/real-models.md). An answer that is no such object is asked for again, then taken as words.
//  - Claude Code makes a small call to a smaller model of its own beside ours, which our counts leave out; and the
//    cost it reports for a call is more than its token counts come to at the published price (about twice, same
//    measurement: why is not known). With OIKOS_CLAUDE_CODE_LOG=<file>, each call's counts and cost as Claude Code
//    reports them are added to that file (never the prompt or the answer), to set beside what the log's tokens come to.
//  - The model version is the one named; the plan's limits apply.
// It runs with no tools of its own, no settings, skills or servers, keeping no session files, in an empty directory.

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmAdapter, LlmRequest, LlmResponse } from "./adapter";
import { UsageLimitReached } from "./call";
import { answerContent, leadingObject, runBounded, transcript } from "./codex";

/** What Claude Code says when no call will go through for a while: the plan's limit or credit is used up, or its own
 * retries on rate limits gave up. Only those: any other failure is retried and then reported. */
export const CLAUDE_CODE_LIMITED = /usage[ _-]?limit|rate[ _-]?limit|too many requests|\b429\b|credit balance|out of (extra |usage )?credits?|limit reached/i;

/** Runs the claude binary: args, stdin and a working directory in; stdout out; ended if it takes longer than
 * `timeoutMs`. Injectable for tests. */
export type ClaudeCodeRunner = (args: string[], stdin: string, cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;

/** (Without ANTHROPIC_API_KEY: with one set, Claude Code would bill that key and not the plan.) */
export const spawnClaudeCode: ClaudeCodeRunner = (args, stdin, cwd, timeoutMs) => {
  const { ANTHROPIC_API_KEY: _, ...env } = process.env;
  return runBounded(["claude", ...args], stdin, cwd, timeoutMs, undefined, undefined, env);
};

/** What is the same call after call for one seat: its instructions, then the tools and how an answer is given. */
export function claudeCodeSystem(req: LlmRequest): string {
  const tools = (req.tools ?? []).map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`).join("\n");
  return [
    req.system,
    ...(tools
      ? ["", "=== Tools you can use ===", tools, "",
        // (How many tools an answer may use is the instructions' to say: a participant's say several, the translator's one.)
        "=== How you answer ===\nAnswer with one JSON object and nothing else (no words before or after it, no code fence): {\"tool\": the tool you use, \"input_json\": its input, a JSON object written as a string, \"also\": [{\"tool\": …, \"input_json\": …}, …], \"text\": any words to say besides, which may be empty}. If you use more than one tool in this answer, as your instructions allow, the first goes in `tool` and every other one in `also`, each with its own input_json, in the order they're to be carried out. With only the one, `also` is an empty list."]
      : []),
  ].join("\n");
}

/** The object an answer is, if it is one in the shape asked for (a code fence around it, or stray words after it, are
 * let pass); with no tools, its words. */
export function answerOf(said: string, tools: string[]): { tool?: string; input_json?: string; also?: { tool?: string; input_json?: string }[]; text?: string } | undefined {
  if (!tools.length) return { text: said.slice(0, 4000) };
  const o: any = leadingObject(said.trim().replace(/^```(?:json)?\s*/i, ""));
  if (!o || typeof o.tool !== "string" || !tools.includes(o.tool)) return undefined;
  const input = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? {}));
  const also = Array.isArray(o.also) ? o.also.filter((u: any) => u && typeof u.tool === "string" && tools.includes(u.tool)).map((u: any) => ({ tool: u.tool, input_json: input(u.input_json) })) : [];
  return { tool: o.tool, input_json: input(o.input_json), also, ...(typeof o.text === "string" && o.text ? { text: o.text } : {}) };
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
      const args = ["-p", "--model", this.model.split("@")[0]!, ...(this.effort ? ["--effort", this.effort] : []), "--system-prompt-file", system, "--tools", "", "--output-format", "json", "--no-session-persistence", "--setting-sources", "",
        "--strict-mcp-config", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections"];
      const timeoutMs = this.o.timeoutMs ?? 180_000;
      const attempts = this.o.attempts ?? 3;
      const names = (req.tools ?? []).map((t) => t.name);
      let result: any;
      let answer: ReturnType<typeof answerOf>;
      for (let n = 1; ; n++) {
        const r = await this.run(args, transcript(req.messages), dir, timeoutMs);
        try {
          result = JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "");
        } catch {
          result = undefined;
        }
        answer = result && !result.is_error ? answerOf(String(result.result ?? ""), names) : undefined;
        // (An answer that isn't the object asked for is a failed attempt, but the last one's words are kept.)
        const failed = r.timedOut || r.code !== 0 || !result || result.is_error || (!answer && n < attempts);
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
      return { content: answerContent(answer ?? { text: String(result.result ?? "").slice(0, 4000) }, () => `claude-code-${++this.calls}`), usage };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
