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
import { UsageLimitReached } from "./call";

/** What the Codex CLI says when the subscription's usage limit is reached, or when its own retries on rate limits give
 * up: either way, no call will go through for a while. */
const LIMITED = /usage limit|usage_limit|hit your limit|limit reached|rate limit|too many requests|\b429\b/i;

/** Runs the codex binary: args, stdin and a working directory in; stdout out; ended if it takes longer than
 * `timeoutMs`. Injectable for tests. */
export type CodexRunner = (args: string[], stdin: string, cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;

export const spawnCodex: CodexRunner = async (args, stdin, cwd, timeoutMs) => {
  const p = Bun.spawn(["codex", ...args], { cwd, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    p.kill();
  }, timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
};

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

function transcript(messages: LlmMessage[]): string {
  const part = (b: ContentBlock) =>
    b.type === "text" ? b.text : b.type === "tool_use" ? `[used ${b.name}: ${JSON.stringify(b.input)}]` : `[result of ${b.tool_use_id}: ${b.content}]`;
  return messages.map((m) => `${m.role === "user" ? "USER" : "YOU"}:\n${typeof m.content === "string" ? m.content : m.content.map(part).join("\n")}`).join("\n\n");
}

/** Everything Codex is given: our instructions, the tools, the conversation so far, and how to answer. */
export function codexPrompt(req: LlmRequest): string {
  const tools = (req.tools ?? []).map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`).join("\n");
  return [
    "Do not run commands or edit files. Answer only with the JSON the output schema asks for.",
    "",
    "=== Instructions ===",
    req.system,
    ...(tools ? ["", "=== Tools you can use (one per answer) ===", tools] : []),
    "",
    "=== Conversation so far ===",
    transcript(req.messages),
    "",
    tools ? "=== Your answer ===\nChoose one tool and give its input as a JSON object in input_json. Any other tool used alongside it (such as your notebook) goes in `also`." : "=== Your answer ===\nAnswer in text.",
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
      writeFileSync(schema, JSON.stringify(answerSchema((req.tools ?? []).map((t) => t.name))));
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
        if (n >= attempts) throw new Error(`codex exec failed after ${n} attempts (${why})`);
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
      let answer: { tool?: string; input_json?: string; also?: { tool?: string; input_json?: string }[]; text?: string } = {};
      try {
        answer = JSON.parse(readFileSync(last, "utf8"));
      } catch {
        answer = { text: readFileSync(last, "utf8").slice(0, 4000) };
      }
      const content: ContentBlock[] = [];
      if (answer.text) content.push({ type: "text", text: answer.text });
      for (const u of [{ tool: answer.tool, input_json: answer.input_json }, ...(answer.also ?? [])]) {
        if (!u.tool) continue;
        let input: any;
        try {
          input = JSON.parse(u.input_json ?? "{}");
        } catch {
          // A whole object followed by stray characters (pilot 7d: a notebook's text, then "}]}],"): the object, as the
          // model wrote it. Anything else is recorded as it came, and treated as malformed.
          input = leadingObject(u.input_json ?? "") ?? { _unparsed: u.input_json };
        }
        content.push({ type: "tool_use", id: `codex-${++this.calls}`, name: u.tool, input });
      }
      return { content, usage };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The JSON object a string starts with, if it starts with a whole one (and only stray characters follow). */
export function leadingObject(s: string): object | undefined {
  const t = s.trimStart();
  if (!t.startsWith("{")) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      if (--depth === 0) {
        try {
          const v = JSON.parse(t.slice(0, i + 1));
          return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
