// A trained model that decides and copies, behind the adapter every translator model sits behind: the evaluation and
// a run call it as they call any other (`--model decide/<name>`: the model in $OIKOS_TRANSLATOR_MODELS/<name>, by
// default runs/translator-model/<name>). It reads the request and the forms out of what the translator would send a
// language model, and answers with a program. Below `threshold` of sureness it asks back: none(unclear).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join, resolve } from "node:path";
import type { LlmAdapter, LlmRequest, LlmResponse } from "@oikos/participants/llm";
import { decode, inputOf } from "./encode";
import { pieces } from "./export";

const HERE = import.meta.dir;

/** The request and the forms, from the translator's words to a model (translatorContext, translator/src/index.ts). */
export function shown(text: string): { request: string; forms: string[] } {
  const marker = "\n\nForms this person knows of:\n";
  const at = text.indexOf(marker);
  const head = at < 0 ? text : text.slice(0, at);
  const request = head.startsWith("Request: ") ? head.slice(9) : head;
  return { request, forms: at < 0 ? [] : text.slice(at + marker.length).split("\n").filter((l) => l.startsWith("- ")) };
}

export class DecideAdapter implements LlmAdapter {
  provider = "decide";
  private proc?: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => void)[] = [];
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  /** Each answer's sureness and time, in the order asked (for whoever measures). */
  answers: { sure: number; ms: number; program: string }[] = [];
  constructor(public model: string, private o: { dir?: string; threshold?: number } = {}) {}

  private start(): void {
    const dir = this.o.dir ?? join(process.env.OIKOS_TRANSLATOR_MODELS ?? resolve(HERE, "../../runs/translator-model"), this.model);
    this.proc = spawn("uv", ["run", "--project", join(HERE, "py"), "python", join(HERE, "py/predict.py"), dir], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc.stdout.on("data", (d: Buffer) => {
      this.buffer += d.toString();
      for (let nl = this.buffer.indexOf("\n"); nl >= 0; nl = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.waiting.shift()?.(line);
        if (!this.waiting.length) this.hold(false);
      }
    });
    this.waiting.push(() => {}); // the line that says it is ready
  }

  /** While an answer is awaited the model’s process keeps this one alive; between answers it doesn’t, so whoever
   * has finished asking can end with the model still loaded. */
  private hold(on: boolean): void {
    for (const x of [this.proc, this.proc?.stdout, this.proc?.stdin] as any[]) (on ? x?.ref : x?.unref)?.call(x);
  }

  private ask(o: object): Promise<any> {
    const next = this.queue.then(() => new Promise<any>((done) => {
      if (!this.proc) this.start();
      this.waiting.push((line) => done(JSON.parse(line)));
      this.hold(true);
      this.proc!.stdin.write(JSON.stringify(o) + "\n");
    }));
    this.queue = next.catch(() => {});
    return next;
  }

  /** The program for a request and the forms known, and how sure the model is. */
  async translate(request: string, forms: string[]): Promise<{ program: string; sure: number; ms: number }> {
    const input = inputOf(request, forms);
    const ps = pieces(input);
    const breaks: number[] = [];
    for (let at = input.indexOf("\n"); at >= 0; at = input.indexOf("\n", at + 1)) breaks.push(ps.findIndex((p) => p.at[0] > at));
    const a = await this.ask({ pieces: ps.map((p) => p.text), breaks });
    let program: string;
    try {
      program = decode(input, a.steps.map((s: string | [string, number, number]) => (typeof s === "string" ? s : [s[0], ps[s[1]]!.at[0], ps[s[2]]!.at[1]])));
    } catch {
      program = "none(unclear)"; // steps no program is made of: it asks back
    }
    if (a.sure < (this.o.threshold ?? 0)) program = "none(unclear)";
    this.answers.push({ sure: a.sure, ms: a.ms, program });
    return { program, sure: a.sure, ms: a.ms };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const first = req.messages.find((m) => m.role === "user");
    const text = typeof first?.content === "string" ? first.content : (first?.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
    const { request, forms } = shown(text);
    const { program } = await this.translate(request, forms);
    return { content: [{ type: "tool_use", id: "decide", name: req.tools?.[0]?.name ?? "call", input: { program } }], usage: { input_tokens: 0, output_tokens: 0 }, estimated: true };
  }

  close(): void {
    this.proc?.stdin.end();
  }
}
