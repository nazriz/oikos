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

/** Runs the codex binary: args, stdin and a working directory in; stdout out. Injectable for tests. */
export type CodexRunner = (args: string[], stdin: string, cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const spawnCodex: CodexRunner = async (args, stdin, cwd) => {
  const p = Bun.spawn(["codex", ...args], { cwd, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, stdout, stderr };
};

/** The answer's shape: which tool (or "text"), and its input as a JSON string (strict schemas need every field required). */
export function answerSchema(toolNames: string[]): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["tool", "input_json", "text"],
    properties: {
      tool: { type: "string", enum: [...toolNames, "none"] },
      input_json: { type: "string", description: "The tool's input as a JSON object (\"{}\" when tool is none)." },
      text: { type: "string", description: "Any words to say besides the tool use (may be empty)." },
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
    `=== Your answer ===\nChoose one tool${tools ? "" : ' ("none", with text, if there are no tools)'} and give its input as a JSON object in input_json.`,
  ].join("\n");
}

export class CodexCliAdapter implements LlmAdapter {
  readonly provider = "codex";
  private calls = 0;
  constructor(
    readonly model: string,
    private readonly run: CodexRunner = spawnCodex,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const dir = mkdtempSync(join(tmpdir(), "terrarium-codex-"));
    try {
      const schema = join(dir, "schema.json");
      const last = join(dir, "answer.json");
      writeFileSync(schema, JSON.stringify(answerSchema((req.tools ?? []).map((t) => t.name))));
      const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
        ...(this.model !== "default" ? ["-m", this.model] : []), "--output-schema", schema, "--output-last-message", last, "-"];
      const r = await this.run(args, codexPrompt(req), dir);
      if (r.code !== 0) throw new Error(`codex exec failed (exit ${r.code}): ${r.stderr.slice(0, 500)}`);
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
      let answer: { tool?: string; input_json?: string; text?: string } = {};
      try {
        answer = JSON.parse(readFileSync(last, "utf8"));
      } catch {
        answer = { tool: "none", text: readFileSync(last, "utf8").slice(0, 4000) };
      }
      const content: ContentBlock[] = [];
      if (answer.text) content.push({ type: "text", text: answer.text });
      if (answer.tool && answer.tool !== "none") {
        let input: any;
        try {
          input = JSON.parse(answer.input_json ?? "{}");
        } catch {
          input = { _unparsed: answer.input_json };
        }
        content.push({ type: "tool_use", id: `codex-${++this.calls}`, name: answer.tool, input });
      }
      return { content, usage };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
