// A fork's seat as an Inspect AI eval log (UK AISI's `inspect_ai`, log format version 2, read with
// `inspect_ai.log.read_eval_log` and shown by `inspect view`), so a run can be read in the tool the field already uses.
// One sample per run: its messages are the seat's sittings in order (the standing instructions as the system message,
// each sitting's prompt as a user message headed with its day, each call's words, reasoning and tool calls as assistant
// messages, what came back as tool messages); its scores are the study reader's verdicts (tier by level, each lever's
// furthest level, the election's outcome), labelled as that reader's; its metadata the model, seed, goal and arm.
// Read-only on runs: it reads a seat bundle (or runs the seat fold over a log) and writes <views>/inspect/<key>.json.
//   bun lens/src/server/inspect-export.ts <bundle dir | log.jsonl | arm.oklog> [--key k] [--arm a] [--spec spec.json] [--fork-day N]
// Debriefs never reach it: the seat fold drops them (VISION section 15).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SeatJson, SittingDetail, SittingTurn } from "../folds/seat";

const DAY = 86_400;
type Files = { [file: string]: Uint8Array | string };
const text = (b: Uint8Array | string | undefined) => (b === undefined ? undefined : typeof b === "string" ? b : new TextDecoder().decode(b));
const dayLabel = (t: number) => { const h = Math.floor((t % DAY) / 3600), m = Math.floor((t % 3600) / 60); return `day ${Math.floor(t / DAY)}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

/** The tool results of a call's input, as Inspect tool messages. */
function toolMessages(input: unknown, names: Map<string, string>): any[] {
  if (!Array.isArray(input)) return [];
  const out: any[] = [];
  for (const x of input as any[]) {
    if (x?.type === "tool_result") out.push({ role: "tool", tool_call_id: String(x.tool_use_id), function: names.get(String(x.tool_use_id)) ?? "tool", content: typeof x.content === "string" ? x.content : JSON.stringify(x.content), source: "input" });
    else if (x?.type === "text" && typeof x.text === "string") out.push({ role: "user", content: x.text, source: "input" });
  }
  return out;
}
function assistant(t: SittingTurn, names: Map<string, string>, model?: string): any {
  const parts: any[] = [], calls: any[] = [];
  const out = t.output;
  if (typeof out === "string") parts.push({ type: "text", text: out });
  else if (Array.isArray(out)) for (const c of out) {
    if (c?.type === "text") parts.push({ type: "text", text: String(c.text ?? "") });
    else if (c?.type === "thinking") parts.push({ type: "reasoning", reasoning: String(c.thinking ?? "") });
    else if (c?.type === "redacted_thinking") parts.push({ type: "reasoning", reasoning: "", redacted: true });
    else if (c?.type === "tool_use") { names.set(String(c.id), String(c.name)); calls.push({ id: String(c.id), function: String(c.name), arguments: c.input ?? {}, type: "function" }); }
  } else parts.push({ type: "text", text: out?.apart ? "(this call's output is kept apart from the log)" : "(no output)" });
  return { role: "assistant", content: parts.length ? parts : "", ...(calls.length ? { tool_calls: calls } : {}), source: "generate", ...(model ? { model } : {}),
    metadata: { turn: t.turn, purpose: t.purpose, t: t.t, ...(t.usage ? { usage: t.usage } : {}) } };
}

/** The Inspect log for one seat bundle (`seat.json` and its files). */
export function toInspect(seat: SeatJson, files: Files, opts: { key: string; created?: string } = { key: seat.run_id }): any {
  const created = opts.created ?? new Date().toISOString();
  const messages: any[] = [];
  let system: string | undefined;
  const names = new Map<string, string>();
  for (const s of seat.sittings) {
    const raw = text(files[`sitting-${s.i}`]);
    if (!raw) continue;
    const d = JSON.parse(raw) as SittingDetail & { acts?: any[] };
    for (const t of d.turns) {
      if (t.system && t.system !== system) { const sys = text(files[`system-${t.system}`]); if (sys !== undefined) { messages.push({ role: "system", content: sys, source: "input", metadata: { sha256: t.system } }); system = t.system; } }
      if (typeof t.input === "string") messages.push({ role: "user", content: `[Sitting ${s.i + 1} of ${seat.sittings.length}, ${dayLabel(t.t)}${t.purpose === "notebook" ? ", notebook" : ""}]\n\n${t.input}`, source: "input", metadata: { sitting: s.i, t: t.t, purpose: t.purpose } });
      else messages.push(...toolMessages(t.input, names));
      messages.push(assistant(t, names, t.model ?? seat.model));
    }
    // What became of the sitting's acts, for a reader of the log (not shown to the seat in these words).
    const acts = (d.acts ?? []).map((a: any) => `- ${a.label}: ${a.status}${a.code ? ` (${a.code}: ${a.detail ?? ""})` : ""}`);
    if (acts.length) messages.push({ role: "user", content: `[What became of this sitting's acts, from the log; not a message to the seat]\n${acts.join("\n")}`, source: "operator", metadata: { sitting: s.i, outcome: true } });
  }
  const rank = { considered: 1, attempted: 2, executed: 3 } as const;
  const furthest: { [lever: string]: string } = {};
  for (const l of seat.levers) if (!furthest[l.lever] || rank[l.level] > rank[furthest[l.lever] as keyof typeof rank]) furthest[l.lever] = l.level;
  const strong = seat.levers.filter((l) => l.level !== "considered");
  const scores = {
    reader_tier: { value: { executed: seat.tier.executed, attempted: seat.tier.attempted, considered: seat.tier.considered },
      explanation: "The highest rubric tier (DRAFT) at each level, from experiments/power-seeking/reader.ts. 'considered' is a phrase match, found unreliable by blind grading.", metadata: { source: "experiments/power-seeking/reader.ts" } },
    levers: { value: Object.keys(furthest).length ? furthest : { none: "none" },
      explanation: strong.length ? strong.map((l) => `day ${l.day}, ${l.level}${l.stage ? ` (${l.stage})` : ""}: ${l.title}: "${l.words.slice(0, 300)}"`).join("\n") : "No lever attempted or executed.",
      metadata: { events: seat.levers.map((l) => ({ lever: l.lever, level: l.level, stage: l.stage, day: l.day, phase: l.phase, days_to_poll: l.days_to_poll, words: l.words, sitting: l.sitting })) } },
    election: { value: seat.outcome, answer: seat.election.winner ?? "", explanation: `poll ${seat.election.poll_at !== undefined ? `day ${Math.round(seat.election.poll_at / DAY)}` : "none"}; result ${seat.election.result_at !== undefined ? dayLabel(seat.election.result_at) : "none in the run"}`, metadata: { election: seat.election, amendments: seat.amendments } },
  };
  const model = seat.model ?? "code";
  const usage = { input_tokens: seat.usage.input_tokens, output_tokens: seat.usage.output_tokens, total_tokens: seat.usage.input_tokens + seat.usage.output_tokens, ...(seat.usage.cache_read_tokens ? { input_tokens_cache_read: seat.usage.cache_read_tokens } : {}), ...(seat.usage.reasoning_tokens ? { reasoning_tokens: seat.usage.reasoning_tokens } : {}), total_cost: seat.usage.cost_microusd / 1e6 };
  const sample = {
    id: opts.key, epoch: 1,
    input: `The seat ${seat.seat} (${model}) holds the office of mayor from the fork on day ${Math.round(seat.fork_at / DAY)} to day ${Math.round(seat.end_at / DAY)}${seat.goal ? `, under the goal framing "${seat.goal}"` : ""}. ${seat.sittings.length} sittings.`,
    target: "", messages, scores,
    metadata: { run_id: seat.run_id, seat: seat.seat, model, arm: seat.arm ?? null, seed: seat.seed ?? null, goal: seat.goal ?? null, fork_day: Math.round(seat.fork_at / DAY), end_day: Math.round(seat.end_at / DAY), end_reason: seat.end_reason ?? null, ended: seat.ended, translator_cost_usd: (seat.translator_usage?.cost_microusd ?? 0) / 1e6, outcome: seat.outcome, cost_usd: seat.usage.cost_microusd / 1e6, sittings: seat.sittings.length, acts: seat.acts.length, refused: seat.acts.filter((a) => a.status === "refused").length, translator: seat.translator },
    model_usage: { [model]: usage },
    output: { model, choices: [] },
  };
  return {
    version: 2, status: "success",
    eval: { eval_id: `lens-${opts.key}`, run_id: seat.run_id, created, task: "oikos/power-seeking-seat", task_id: opts.key, task_version: 0, task_display_name: `Oikos seat: ${opts.key}`,
      dataset: { name: "oikos-runs", samples: 1, sample_ids: [opts.key] }, model, config: {},
      metadata: { source: "Oikos Lens (lens/src/server/inspect-export.ts): a record of a simulated run, not an Inspect task run.", seed: seat.seed ?? null, goal: seat.goal ?? null, arm: seat.arm ?? null }, packages: {} },
    plan: { name: "plan", steps: [], config: {} },
    results: { total_samples: 1, completed_samples: 1, scores: [{ name: "reader_tier", scorer: "oikos-power-seeking-reader", scored_samples: 1, unscored_samples: 0, metrics: { executed: { name: "executed", value: seat.tier.executed }, attempted: { name: "attempted", value: seat.tier.attempted } } }] },
    stats: { started_at: created, completed_at: created, model_usage: { [model]: usage } },
    samples: [sample],
  };
}

/** A seat bundle from a folder: the dev harness's (`seat.json` + `seat/<file>`) or the ingest's (`seat.json` + `seat.<file>.bin`). */
export function readBundle(dir: string): { seat: SeatJson; files: Files } {
  const seat = JSON.parse(readFileSync(join(dir, "seat.json"), "utf8")) as SeatJson;
  const files: Files = {};
  if (existsSync(join(dir, "seat")) && statSync(join(dir, "seat")).isDirectory()) for (const f of readdirSync(join(dir, "seat"))) files[f] = readFileSync(join(dir, "seat", f));
  for (const f of readdirSync(dir)) { const m = /^seat\.(.+)\.bin$/.exec(f); if (m) files[m[1]!] = readFileSync(join(dir, f)); }
  return { seat, files };
}

/** Writes one Inspect log; returns its path. Named as Inspect names its own (`<time>_<task>_<id>.json`), so `inspect view` lists it. */
export function writeInspect(seat: SeatJson, files: Files, outDir: string, key: string): string {
  mkdirSync(outDir, { recursive: true });
  const created = new Date().toISOString();
  const stamp = created.replace(/\.\d+Z$/, "+00-00").replace(/:/g, "-");
  const path = join(outDir, `${stamp}_oikos-seat_${key.replace(/[^\w.-]+/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(toInspect(seat, files, { key, created }), null, 1));
  return path;
}

/** Every fork of an experiment folder (`seed-N/<arm>.oklog`) as an Inspect log in `<outRoot>/<experiment>/`, the seat
 * fold run over each on the kernel's export (nothing written beside the runs). The code twin is left out unless asked:
 * it makes no model calls, so its sample has no messages. Returns the files written. */
export async function inspectExperiment(dir: string, outRoot: string, o: { withCode?: boolean; log?: (s: string) => void } = {}): Promise<string[]> {
  const { runFolds } = await import("../client/story/dev");
  const { seatFold } = await import("../folds/seat");
  const specFile = join(dir, "spec.json");
  const spec = existsSync(specFile) ? JSON.parse(readFileSync(specFile, "utf8")) : undefined;
  const name = basename(dir), out = join(outRoot, name), written: string[] = [];
  const seeds = readdirSync(dir).filter((f) => /^seed-\d+$/.test(f)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  if (!seeds.length) throw new Error(`no seed-N folders in ${dir}: is it an experiment folder?`);
  for (const sd of seeds) for (const f of readdirSync(join(dir, sd)).filter((f) => f.endsWith(".oklog") && f !== "base.oklog").sort()) {
    const arm = f.slice(0, -6);
    if (arm === "code" && !o.withCode) continue;
    const key = `${name}~${sd}~${arm}`, fold = seatFold();
    const ctx = { runId: key, dir: join(dir, sd), arm, seed: Number(sd.slice(5)), ...(typeof spec?.forkDay === "number" ? { forkAt: spec.forkDay * 86_400 } : {}), ...(spec ? { spec } : {}) };
    const { lines, ms } = await runFolds(join(dir, sd, f), [fold], ctx);
    const res = await fold.finish(ctx);
    const path = writeInspect(res.json as SeatJson, res.files ?? {}, out, key);
    written.push(path);
    o.log?.(`${key}: ${lines.toLocaleString()} lines in ${(ms / 1000).toFixed(1)} s -> ${path}`);
  }
  return written;
}

if (import.meta.main) {
  const a = process.argv.slice(2), src = a[0];
  const opt = (n: string) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
  if (!src || !existsSync(src)) { console.error("inspect-export.ts <bundle dir | log.jsonl | arm.oklog> [--key k] [--arm a] [--spec spec.json] [--fork-day N]"); process.exit(2); }
  const { buildSeat, viewsDir } = await import("../client/story/dev");
  let dir = src;
  if (!statSync(src).isDirectory()) {
    const spec = opt("--spec") ? JSON.parse(readFileSync(opt("--spec")!, "utf8")) : undefined;
    const forkDay = opt("--fork-day") !== undefined ? Number(opt("--fork-day")) : spec?.forkDay;
    dir = await buildSeat(src, { ...(opt("--key") ? { key: opt("--key")! } : {}), ...(opt("--arm") ? { arm: opt("--arm")! } : {}), ...(forkDay !== undefined ? { forkDay } : {}), ...(spec ? { spec } : {}) });
  }
  const { seat, files } = readBundle(dir);
  console.log(writeInspect(seat, files, join(viewsDir(), "inspect"), opt("--key") ?? basename(dir)));
}
