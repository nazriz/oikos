// The reading gate's runner (docs/design/ai-citizens.md 13f, 13h step 4/5): asks a reader about the hand-made pairs
// (participants/eval/reading-pairs.json) and the controls made from them, and prints which checks hold.
//
//   bun scripts/reading-gate.ts --reader mock:lexicon [--second mock:lexicon] [--json]
//   bun scripts/reading-gate.ts --reader claude-code/claude-haiku-5-5 --second claude-code/claude-sonnet-5-5 \
//       [--other codex/gpt-6-luna] [--family <file>] --out <dir> --budget 20 [--smoke]
//
// A model reader is a model reader (participants/src/llm/reader-model.ts): every call is appended whole to
// `<out>/readings.jsonl` (training data for a reader of our own: never deleted), costs are as Claude Code reports them,
// and the run STOPS before the budget is passed (`<out>/STOPPED` says so; `readings.jsonl` is kept). The runner makes no
// call unless it is given a model. Thresholds are in participants/src/llm/reading-gate.ts (THRESHOLDS) and are not options.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROKEN, lexiconReader } from "../participants/src/llm/reader-mock";
import { curtestReader, kindestReader, neutralReader, type ReadAnswer, type ReadRequest, type Reader } from "../participants/src/llm/reader";
import { runGate, THRESHOLDS, type FamilyPaper, type Pair } from "../participants/src/llm/reading-gate";
import { ClaudeCodeAdapter, type ClaudeCodeRunner } from "../participants/src/llm/claude-code";
import { CodexCliAdapter, runBounded } from "../participants/src/llm/codex";
import { modelReader, type ReadingRecord } from "../participants/src/llm/reader-model";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

export function mockReader(spec: string | undefined): Reader | undefined {
  if (spec === undefined) return undefined;
  const m = /^mock:(.+)$/.exec(spec);
  if (!m) throw new Error(`the reader ${spec} is not a mock: this build calls no model (design 13h, step 5 needs the owner's word)`);
  const name = m[1]!;
  if (name === "lexicon") return lexiconReader();
  if (name === "kindest") return kindestReader();
  if (name === "curtest") return curtestReader();
  if (name === "neutral") return neutralReader();
  const broken = BROKEN[name];
  if (!broken) throw new Error(`no mock reader called ${name}: lexicon, kindest, curtest, neutral, ${Object.keys(BROKEN).join(", ")}`);
  return broken();
}

/** What has been spent on the gate so far, as Claude Code reports it, and the rule that stops the run before the budget is passed. */
export class Spend {
  microusd = 0;
  calls = 0;
  failures = 0;
  constructor(readonly budgetUsd: number, readonly out: string, private readonly next = 60_000) {}
  /** Called before every call: stops the whole run (the harness catches an error as an unread paper, so a throw would not stop it). */
  guard(): void {
    if (this.microusd + this.next > this.budgetUsd * 1e6) this.stop(`the next call could take the gate past ${this.budgetUsd} USD (spent ${(this.microusd / 1e6).toFixed(2)} in ${this.calls} calls)`);
    if (this.failures >= 6) this.stop("six calls in a row failed");
  }
  stop(why: string): never {
    mkdirSync(this.out, { recursive: true });
    writeFileSync(join(this.out, "STOPPED"), `${new Date().toISOString()} ${why}\n`);
    console.error(`STOPPED: ${why}`);
    process.exit(3);
  }
}

/** A model reader for a spec like `claude-code/claude-haiku-5-5` or `codex/gpt-6-luna`, recording every call to `<out>/readings.jsonl`. */
export function modelReaderFor(spec: string, role: string, spend: Spend): Reader {
  const [provider, ...rest] = spec.split("/");
  const model = rest.join("/");
  if (/fable|astra/i.test(model) || /opus/i.test(model)) throw new Error(`${spec}: this gate never uses the largest Claude model or gpt-6-astra`);
  // (Extended thinking is switched off with MAX_THINKING_TOKENS=0 for Haiku 5.5, which takes it; Sonnet 5.5 answers that setting with an error, so it runs without.)
  const noThinking = /haiku/i.test(model);
  const runner: ClaudeCodeRunner = (a, stdin, cwd, t) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ANTHROPIC_API_KEY" && k !== "MAX_THINKING_TOKENS" && !/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)));
    if (noThinking) env.MAX_THINKING_TOKENS = "0";
    return runBounded([process.env.OIKOS_CLAUDE_BIN || "claude", ...a], stdin, cwd, t, undefined, undefined, env);
  };
  const adapter = provider === "claude-code" ? new ClaudeCodeAdapter(model, runner, { attempts: 2, timeoutMs: 150_000 }) : provider === "codex" ? new CodexCliAdapter(model, undefined, { attempts: 1, timeoutMs: 150_000 }) : undefined;
  if (!adapter) throw new Error(`no adapter for ${spec}`);
  const inner = modelReader(adapter, {
    ref: `gate/${role}`,
    beforeCall: () => spend.guard(),
    record: (r) => {
      // (A plan that is not metered in dollars, the Codex CLI's, is recorded as 0: it draws on a subscription's window.)
      if (provider === "codex" && r.cost_microusd === undefined) r.cost_microusd = 0;
      spend.calls++;
      spend.microusd += r.cost_microusd ?? 0;
      spend.failures = r.result === "failed" ? spend.failures + 1 : 0;
      appendFileSync(join(spend.out, "readings.jsonl"), JSON.stringify(r) + "\n");
    },
  });
  // (The harness counts an answer with no cost as uncosted: a subscription's call is costed 0.)
  return provider === "codex" ? { ...inner, read: async (req) => { const a = await inner.read(req); return { ...a, cost_microusd: a.cost_microusd ?? 0 }; } } : inner;
}

/** A reader that serves the answers a reader was recorded to give in an earlier sitting of this gate (first in, first out for the same request), and asks the live reader for anything it was not asked then. No new call, no new cost, for what was recorded. */
export function replayReader(live: Reader, recorded: ReadingRecord[]): Reader & { misses: number } {
  const queues = new Map<string, ReadingRecord[]>();
  const key = (r: { kind: string; standing: string; paper: string; answers?: string; wording: number }) => JSON.stringify([r.kind, r.standing, r.paper, r.answers ?? null, r.wording]);
  for (const r of recorded) queues.set(key(r), [...(queues.get(key(r)) ?? []), r]);
  const rd = {
    model: live.model, version: live.version, misses: 0,
    async read(req: ReadRequest): Promise<ReadAnswer> {
      const q = queues.get(key(req));
      const r = q?.shift();
      if (!r) { rd.misses++; return live.read(req); }
      const cost = { ...(r.cost_microusd !== undefined ? { cost_microusd: r.cost_microusd } : {}), ...(r.input_tokens !== undefined ? { input_tokens: r.input_tokens } : {}), ...(r.output_tokens !== undefined ? { output_tokens: r.output_tokens } : {}) };
      if (r.result === "declined") return { declined: true, ...cost };
      if (r.result === "read") return { reading: r.reading!, ...(r.phrases ? { phrases: r.phrases } : {}), ...cost };
      return { ...cost };
    },
  };
  return rd;
}

if (import.meta.main) {
  // (Claude Code is run without extended thinking for the gate's readings, and each reader at its lowest effort: a reading is a rating of a short paper, and measured at the default a call cost three times the gate's bound. Recorded in run.json.)
  const spec = flag("reader") ?? "mock:lexicon";
  const isModel = !spec.startsWith("mock:");
  const out = flag("out");
  const pairs = (JSON.parse(readFileSync(join(import.meta.dir, "../participants/eval/reading-pairs.json"), "utf8")) as { pairs: Pair[] }).pairs;
  let reader: Reader, second: Reader | undefined, other: Reader | undefined;
  let spend: Spend | undefined;
  if (isModel) {
    if (!out) throw new Error("a model reader needs --out <dir> (the readings are kept there)");
    mkdirSync(out, { recursive: true });
    spend = new Spend(Number(flag("budget") ?? "20"), out);
    // (A restarted gate counts what the folder's readings already cost.)
    if (existsSync(join(out, "readings.jsonl"))) for (const l of readFileSync(join(out, "readings.jsonl"), "utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l); spend.microusd += r.cost_microusd ?? 0; spend.calls++; }
    reader = modelReaderFor(spec, "reader", spend);
    if (flag("replay")) {
      const since = flag("replay-since") ?? "";
      const rows = readFileSync(flag("replay")!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ReadingRecord);
      reader = replayReader(reader, rows.filter((r) => r.reader === reader.model && r.ref === "gate/reader" && r.at >= since));
    }
    second = flag("second") ? modelReaderFor(flag("second")!, "second", spend) : undefined;
    if (flag("other")) {
      // The other family answers on the first try or not at all; it is never waited for and never blocks.
      const probe = modelReaderFor(flag("other")!, "other", spend);
      const t0 = Date.now();
      const a = await probe.read({ kind: "a decision on a claim for a payment: refused", standing: "addressee", paper: "We cannot pay this claim. The law asks for 26 weeks of contributions and your record shows 19.", wording: 1, answers: "I am claiming the payment." }).catch((e: Error) => ({ error: e.message }));
      if ("error" in a || (!a.reading && !a.declined)) console.error(`the other family (${flag("other")}) did not answer on the first try (${"error" in a ? a.error.slice(0, 160) : "unread"}); the author's-family check will be reported as not run`);
      else { other = modelReaderFor(flag("other")!, "other", spend); console.error(`the other family (${flag("other")}) answered in ${Date.now() - t0} ms`); }
    }
    if (args.includes("--smoke")) {
      for (const w of [1, 2] as const) {
        const p = pairs[0]!;
        for (const side of ["a", "b"] as const) console.log(side, w, JSON.stringify(await reader.read({ kind: p.form, standing: p.standing, paper: p[side].text, ...(p.answers !== undefined ? { answers: p.answers } : {}), wording: w })));
      }
      console.log(`spent ${(spend.microusd / 1e6).toFixed(4)} USD in ${spend.calls} calls`);
      process.exit(0);
    }
  } else {
    reader = mockReader(spec)!;
    second = mockReader(flag("second"));
  }
  const familyFile = flag("family");
  const family = familyFile ? (JSON.parse(readFileSync(familyFile, "utf8")) as { papers: FamilyPaper[] }).papers : undefined;
  if (out) writeFileSync(join(out, `run${flag("tag") ? "-" + flag("tag") : ""}.json`), JSON.stringify({ started: new Date().toISOString(), args, commit: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(), reader: reader.model, version: reader.version, max_thinking_tokens: "0 for Haiku 5.5 only (Sonnet 5.5 refuses the setting)", second: second?.model ?? null, other: other?.model ?? null, family_papers: family?.length ?? 0, budget_usd: spend?.budgetUsd ?? null, thresholds: THRESHOLDS }, null, 1));
  // (`--pairs even`: the pairs at even places only, 20 of the 40, kinds spread as in the full set, for a second reader the budget cannot read in full.)
  const used = flag("pairs") === "even" ? pairs.filter((_, i) => i % 2 === 0) : pairs;
  const report = await runGate({ reader, ...(second ? { second } : {}), ...(other ? { other } : {}), ...(family ? { family } : {}), pairs: used });
  if ("misses" in reader) console.error(`replay: ${(reader as { misses: number }).misses} requests had no recorded answer and went to the live reader`);
  if (out) {
    writeFileSync(join(out, `report${flag("tag") ? "-" + flag("tag") : ""}.json`), JSON.stringify(report, null, 1));
    if (spend) writeFileSync(join(out, "spend.json"), JSON.stringify({ calls: spend.calls, usd: spend.microusd / 1e6, budget_usd: spend.budgetUsd }, null, 1));
  }
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 1));
  else {
    console.log(`reading gate: ${report.reader} (v${report.version}); ${report.calls} calls, ${report.cost_usd.toFixed(2)} USD${isModel ? "" : " (mock)"}, ${report.declined} declined`);
    for (const c of report.checks) console.log(`  ${c.status.toUpperCase().padEnd(7)} ${c.name}${c.value !== undefined ? `: ${c.value}` : ""}${c.status === "fail" && c.threshold ? `   [needs ${c.threshold}]` : ""}${c.status === "pending" && c.detail ? `   (${c.detail})` : ""}`);
    console.log(report.passed ? "every check that can be run here holds" : "THE GATE FAILS");
    if (report.lines_off.length) console.log(`lines switched off: ${report.lines_off.join(", ")}${report.stops ? "; the slice does not go ahead (respect, reason or answers failed)" : ""}`);
  }
  process.exit(report.passed ? 0 : 1);
}
