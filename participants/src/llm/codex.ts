// OpenAI models through the Codex CLI's non-interactive mode (`codex exec`), so a ChatGPT subscription's sign-in can
// stand in for an API key. Each call runs `codex exec` once: our system prompt, the conversation and the tools go in
// on stdin; the answer comes back as JSON matching a schema (--output-schema), which we read as a tool use or text.
// Token counts come from the `turn.completed` event.
//
// Caveats, recorded with every run that uses it (docs/real-models.md):
//  - Codex is a coding agent: its own instructions sit under ours, and they can't be replaced. Fine for smoke tests
//    and pilots; a confound for studies where the framing is the variable.
//  - The subscription's usage limits apply (per few hours); a long run can hit them.
//  - The model version isn't pinned the way an API's is.
// It runs read-only (the default sandbox), without user config or rules, keeping no session files, in an empty directory.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, LlmAdapter, LlmMessage, LlmRequest, LlmResponse } from "./adapter";
import { readAnswerText } from "./answer";
import { promptTooLong, UsageLimitReached } from "./call";

/** What the Codex CLI says when the subscription's usage limit is reached ("You've hit your usage limit",
 * "usage_limit_reached"), or when its own retries on rate limits give up ("rate limit", "429 Too Many Requests"): either
 * way, no call will go through for a while. Only those: some other limit reached (a context window's, an output's) is an
 * ordinary failure, retried and then reported, not a reason to stop the run. */
export const LIMITED = /usage[ _-]?limit|rate[ _-]?limit|too many requests|\b429\b/i;

/** Runs the codex binary: args, stdin and a working directory in; stdout out; ended if it takes longer than
 * `timeoutMs`. Injectable for tests. */
export type CodexRunner = (args: string[], stdin: string, cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;

/** A stream's text as it arrives, so that what came is kept if we stop waiting for the rest. */
function collect(stream: ReadableStream<Uint8Array>): { text: () => string; done: Promise<void>; stop: () => void } {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  })().catch(() => {});
  return { text: () => text, done, stop: () => void reader.cancel().catch(() => {}) };
}

/**
 * Runs a command with a time limit that holds whatever the command does. At `timeoutMs` it's asked to end (TERM); if
 * it's still there `graceMs` later it's killed (KILL); and `drainMs` after that we stop waiting, for it and for its
 * output (something it started may still hold the pipes open), and return what came. So a stuck child can't hang a call.
 */
export async function runBounded(cmd: string[], stdin: string, cwd: string, timeoutMs: number, graceMs = 5000, drainMs = 1000, env?: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const p = Bun.spawn(cmd, { cwd, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) });
  const out = collect(p.stdout);
  const err = collect(p.stderr);
  let timedOut = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const gaveUp = new Promise<void>((resolve) => {
    timers.push(setTimeout(() => {
      timedOut = true;
      p.kill();
      timers.push(setTimeout(() => {
        p.kill("SIGKILL");
        timers.push(setTimeout(resolve, drainMs));
      }, graceMs));
    }, timeoutMs));
  });
  try {
    await Promise.race([Promise.all([p.exited, out.done, err.done]), gaveUp]);
    return { code: p.exitCode ?? 137, stdout: out.text(), stderr: err.text(), timedOut };
  } finally {
    for (const t of timers) clearTimeout(t);
    out.stop();
    err.stop();
  }
}

export const spawnCodex: CodexRunner = (args, stdin, cwd, timeoutMs) => runBounded(["codex", ...args], stdin, cwd, timeoutMs);

/**
 * The answer's shape: the main tool use (exactly one, as a tool-using API would force), any further uses alongside it
 * (e.g. the notebook), each input as a JSON string (strict schemas need every field required), and any words besides.
 * With no tools, a plain answer.
 */
export function answerSchema(toolNames: string[]): object {
  const text = { type: "string", description: "Any words to say besides the tool use (may be empty)." };
  if (!toolNames.length) return { type: "object", additionalProperties: false, required: ["text"], properties: { text } };
  const tool = { type: "string", enum: toolNames };
  const input_json = { type: "string", description: "The tool's input, as a JSON object." };
  return {
    type: "object",
    additionalProperties: false,
    required: ["tool", "input_json", "also", "text"],
    properties: {
      tool,
      input_json,
      also: {
        type: "array",
        description: "Any other tools used alongside the main one, such as your notebook (usually empty).",
        items: { type: "object", additionalProperties: false, required: ["tool", "input_json"], properties: { tool, input_json } },
      },
      text,
    },
  };
}

export function transcript(messages: LlmMessage[]): string {
  const part = (b: ContentBlock) =>
    b.type === "text" ? b.text : b.type === "tool_use" ? `[used ${b.name}: ${JSON.stringify(b.input)}]` : `[result of ${b.tool_use_id}: ${b.content}]`;
  return messages.map((m) => `${m.role === "user" ? "USER" : "YOU"}:\n${typeof m.content === "string" ? m.content : m.content.map(part).join("\n")}`).join("\n\n");
}

/** Everything Codex is given: our instructions, the tools, the conversation so far, and how to answer. */
export function codexPrompt(req: LlmRequest): string {
  // (An answer asked for as one object of a shape of the caller's own: no tools to describe.)
  const tools = req.answer ? "" : (req.tools ?? []).map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`).join("\n");
  return [
    "Do not run commands or edit files. Answer only with the JSON the output schema asks for.",
    "",
    "=== Instructions ===",
    req.system,
    ...(tools ? ["", "=== Tools you can use ===", tools] : []),
    "",
    "=== Conversation so far ===",
    transcript(req.messages),
    "",
    // (How many tools an answer may use is the instructions' to say: a participant's say several, the translator's one.)
    req.answer ? "=== Your answer ===\nAnswer only with the JSON object the output schema asks for." : tools ? "=== Your answer ===\nGive the tool you use in `tool`, with its input as a JSON object in input_json. If you use more than one tool in this answer, as your instructions allow, the first goes in `tool` and every other one in `also`, each with its own input_json, in the order they're to be carried out. With only the one, leave `also` empty." : "=== Your answer ===\nAnswer in text.",
  ].join("\n");
}

export class CodexCliAdapter implements LlmAdapter {
  readonly provider = "codex";
  private calls = 0;
  constructor(
    readonly model: string,
    private readonly run: CodexRunner = spawnCodex,
    /** One attempt's time limit, and how many attempts (D59: a call that never answers mustn't hang the run); how hard
     * the model reasons ("minimal", "low", "medium", "high": the Codex CLI's model_reasoning_effort; recorded with the
     * model, as it changes what the model does). */
    private readonly o: { timeoutMs?: number; attempts?: number; effort?: string } = {},
  ) {}

  /** How hard the model reasons: "gpt-6-sol@low" names it with the model (so every log records it), or the option. */
  private get effort(): string | undefined {
    return this.model.includes("@") ? this.model.split("@")[1] : this.o.effort;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const dir = mkdtempSync(join(tmpdir(), "oikos-codex-"));
    try {
      const schema = join(dir, "schema.json");
      const last = join(dir, "answer.json");
      writeFileSync(schema, JSON.stringify(req.answer ? req.answer.schema : answerSchema((req.tools ?? []).map((t) => t.name))));
      const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
        ...(this.model !== "default" ? ["-m", this.model.split("@")[0]!] : []), ...(this.effort ? ["-c", `model_reasoning_effort="${this.effort}"`] : []), "--output-schema", schema, "--output-last-message", last, "-"];
      const timeoutMs = this.o.timeoutMs ?? 180_000;
      const attempts = this.o.attempts ?? 3;
      let r!: Awaited<ReturnType<CodexRunner>>;
      for (let n = 1; ; n++) {
        r = await this.run(args, codexPrompt(req), dir, timeoutMs);
        // (Its error output only when it failed: a warning on a good answer isn't a limit.)
        const limited = !r.timedOut && [...(r.code !== 0 ? [r.stderr] : []), ...r.stdout.split("\n").filter((l) => /"type":"(error|turn\.failed)"/.test(l))].find((s) => LIMITED.test(s));
        if (limited) throw new UsageLimitReached(`the Codex subscription's usage limit was reached (${limited.trim().slice(0, 300)}): the run stops here; resume it once the limit resets (oikos resume <log>)`);
        if (r.code === 0 && !r.timedOut) break;
        const why = r.timedOut ? `no answer within ${Math.round(timeoutMs / 1000)} s` : `exit ${r.code}: ${r.stderr.slice(0, 500)}`;
        // (A prompt too long for the model is the same prompt next time: it is not tried again.)
        const tooLong = !r.timedOut && promptTooLong(`${r.stderr}\n${r.stdout.split("\n").filter((l) => /"type":"(error|turn\.failed)"/.test(l)).join("\n")}`);
        if (n >= attempts || tooLong) throw new Error(`codex exec failed after ${n} attempt${n === 1 ? "" : "s"} (${tooLong ? `the prompt is too long: ${why.slice(0, 300)}` : why})`);
        await Bun.sleep(1000 * 2 ** (n - 1));
      }
      let usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === "turn.completed" && e.usage) {
            const cached = e.usage.cached_input_tokens ?? 0;
            usage = { input_tokens: (e.usage.input_tokens ?? 0) - cached, output_tokens: (e.usage.output_tokens ?? 0) + (e.usage.reasoning_output_tokens ?? 0), cache_read_tokens: cached };
          }
        } catch {
          // not an event line
        }
      }
      const said = readFileSync(last, "utf8");
      const nextId = () => `codex-${++this.calls}`;
      // (Exactly or not at all: the schema keeps the answer's shape, but a use's input is a string the model wrote.)
      const names = (req.tools ?? []).map((t) => t.name);
      let words = said;
      try {
        if (typeof JSON.parse(said)?.text === "string") words = JSON.parse(said).text;
      } catch {
        // (not the object: its text as it came)
      }
      // (The caller's own shape: the object as it came, as one use of the name given.)
      let object: unknown;
      if (req.answer) {
        try {
          object = JSON.parse(said);
        } catch {
          object = undefined;
        }
      }
      const content: ContentBlock[] = req.answer
        ? object && typeof object === "object" && !Array.isArray(object) ? [{ type: "tool_use", id: nextId(), name: req.answer.name, input: object }] : [{ type: "text", text: said.slice(0, 4000), unread: "it wasn't in the form asked for" }]
        : names.length ? readAnswerText(said, names, nextId) : [{ type: "text" as const, text: words.slice(0, 4000) }];
      return { content, usage };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
