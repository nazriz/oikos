// The real requests a run's model seats made of the translator, read from its log (read-only: the log is exported to a
// scratch folder), with what each seat had been shown before it asked; and each replayed through the rules of this
// checkout. Shared by translator/eval/replay.ts (one run, and `--regress` over many) and its gate test
// (translator/test/regress.test.ts), which reads a compact extract of the same (`--extract`) rather than the logs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { resolve } from "../src/resolver";
import { formRules, misread, recordTest, ruled, type RuleTrace } from "../src/rules";

export interface LoggedRequest {
  ref: string; seq: number; seat: string; request: string; raw?: string; stage?: string;
  call?: string; summary?: string; decision?: "accept" | "reject"; note?: string; failure?: string; failedCall?: string;
}
/** One model arm's log: its requests, and each seat's observations in order. */
export interface ArmLog {
  run: string; arm: string; currency: unknown; model: { [seat: string]: string };
  obs: { [seat: string]: { seq: number; o: any }[] };
  requests: LoggedRequest[];
}

const DRAFT_ID = /^draft\.(.+)\.(\d+)$/;

/** A model arm's log read (exported to `scratch`, never written). */
export async function readArm(log: string, run: string, scratch: string): Promise<ArmLog> {
  const out = join(scratch, "log.jsonl");
  const ex = Bun.spawnSync([kernelBinary(), "export", log, "--out", out]);
  if (ex.exitCode !== 0) throw new Error(`export failed for ${log}: ${ex.stderr.toString().slice(0, 300)}`);
  const config = JSON.parse(readFileSync(join(log, "..", "config.json"), "utf8"));
  const reqs = new Map<string, LoggedRequest>();
  const obs: { [seat: string]: { seq: number; o: any }[] } = {};
  const model: { [seat: string]: string } = {};
  const stream = Bun.file(out).stream().pipeThrough(new TextDecoderStream());
  let rest = "";
  for await (const chunk of stream) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop()!;
    for (const l of lines) {
      if (!l.includes('"annotation"') || l.includes('"annotation":"decision"') || l.includes('"annotation":"outcome"')) continue;
      const e = JSON.parse(l);
      const b = e.body ?? {};
      const at = (ref: string) => reqs.get(ref) ?? (reqs.set(ref, { ref, seq: e.seq, seat: DRAFT_ID.exec(ref)?.[1] ?? "?", request: "" }), reqs.get(ref)!);
      if (b.annotation === "usage" && b.purpose === "participant" && typeof b.subject === "string" && !model[b.subject]) model[b.subject] = `${b.provider}/${b.model}`;
      else if (b.annotation === "observation" && typeof b.subject === "string") (obs[b.subject] ??= []).push({ seq: e.seq, o: b.data.observation });
      else if (b.annotation === "transcript" && b.data?.purpose === "translator" && typeof b.data.ref === "string") {
        const r = at(b.data.ref);
        if (!r.request) {
          r.seq = e.seq;
          r.request = String(b.data.input ?? "").split("\n\nForms this person knows of:")[0]!.replace(/^Request: /, "");
          r.raw = (b.data.output ?? []).find((o: any) => o.type === "tool_use")?.input?.program;
        }
      } else if (b.annotation === "note" && b.data?.translation_route?.draft) at(b.data.translation_route.draft).stage = b.data.translation_route.stage;
      else if (b.annotation === "draft" && b.draft?.id) Object.assign(at(b.draft.id), { call: b.draft.call, summary: b.draft.summary });
      else if (b.annotation === "signoff" && b.draft) Object.assign(at(b.draft), { decision: b.decision, note: b.note });
      else if (b.annotation === "translation_failure" && b.data?.draft && !b.data.drawn_up_again) Object.assign(at(b.data.draft), { failure: b.data.reason, failedCall: b.data.call });
    }
  }
  const requests = [...reqs.values()].filter((x) => x.request && x.raw).sort((a, b) => a.seq - b.seq);
  // (Only the observations some request was made after: the rest are never read.)
  for (const seat of Object.keys(obs)) {
    const last = Math.max(-1, ...requests.filter((r) => r.seat === seat).map((r) => r.seq));
    obs[seat] = obs[seat]!.filter((x) => x.seq < last);
    if (!obs[seat]!.length) delete obs[seat];
  }
  return { run, arm: log.split("/").pop()!.replace(/\.oklog$/, ""), currency: config.world?.currencies?.[0], model, obs, requests };
}

/** Each request with the seat's knowledge as it stood when it asked (everything it was shown before), built up in
 * order, seat by seat. The knowledge is the seat's running one: read it before the next is yielded. */
export function* withKnowledge(a: ArmLog): Generator<[LoggedRequest, Knowledge]> {
  const ks = new Map<string, { k: Knowledge; i: number }>();
  for (const r of a.requests) {
    const s = ks.get(r.seat) ?? (ks.set(r.seat, { k: new Knowledge(a.currency as any), i: 0 }), ks.get(r.seat)!);
    const seen = a.obs[r.seat] ?? [];
    while (s.i < seen.length && seen[s.i]!.seq < r.seq) s.k.absorb(seen[s.i++]!.o);
    yield [r, s.k];
  }
}

export interface Replayed { now: string; preview: string; trace: RuleTrace[]; blocks?: string }

/** A request drawn and previewed by the rules of this checkout, from the call the translator first wrote. */
export function replayOne(r: LoggedRequest, k: Knowledge): Replayed {
  let now = r.raw!, preview = "";
  const trace: RuleTrace[] = [];
  try {
    const p = calls.parseProgram(r.raw!);
    const fr = formRules(p, r.request, k, recordTest(k), trace);
    const wrong = misread(fr, r.request, k);
    const ru = ruled(fr, r.request, recordTest(k));
    // (A reading code tells is wrong goes back to the translator with why: a fresh model call, not replayed here.)
    if (wrong) { [now, preview] = [`(the translator asked again: ${wrong})`, ""]; trace.push({ rule: "misread", what: wrong }); }
    else if (ru.ok) {
      now = calls.programText(ru.program);
      const s = shown(ru.program, k);
      return { now, preview: s.preview, trace, blocks: s.blocks };
    } else preview = `asked: ${ru.ask}`;
  } catch (e) { preview = `could not be replayed: ${String((e as Error).message).slice(0, 120)}`; }
  return { now, preview, trace };
}

/** What a program does, resolved on the seat's knowledge, and what the seat is shown of it, by the code now. */
export function shown(p: calls.Program, k: Knowledge): { blocks: string; preview: string } {
  const as = [...k.held][0];
  const res = resolve(p, k, () => undefined, as, { written: true });
  if (!res.ok) return { blocks: `asked: ${res.questions.join(" ")}`, preview: `asked: ${res.questions.join(" ")}` };
  return { blocks: JSON.stringify(res.blocks), preview: new Preview(k, k.actingFor(as), () => undefined, as).of(res.blocks, givenOf(p)) };
}

/** How two programs differ, blank by blank where both are one line on the same function ("lots: [a,b] -> a"). */
export function changesBetween(then: string, now: string): string {
  try {
    const a = calls.parseProgram(then), b = calls.parseProgram(now);
    if (!("lines" in a) || !("lines" in b) || a.lines.length !== 1 || b.lines.length !== 1 || a.lines[0]!.call.fn !== b.lines[0]!.call.fn) return `${canon(then)} -> ${canon(now)}`;
    const x = a.lines[0]!.call.args, y = b.lines[0]!.call.args;
    const show = (v: unknown) => (v === undefined ? "(empty)" : JSON.stringify(v).replace(/\{"(id|text)":("[^"]*")\}/g, "$2"));
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f])).map((f) => `${f}: ${show(x[f])} -> ${show(y[f])}`).join("; ");
  } catch { return `${then} -> ${now}`; }
}

export function canon(s: string): string {
  try { return calls.programText(calls.parseProgram(s)); } catch { return s; }
}

/** The blanks a call's form lines filled, as written (translator/src/index.ts, `givenOf`). */
function givenOf(p: calls.Program): { [field: string]: unknown } | undefined {
  if (!("lines" in p)) return undefined;
  const o: { [field: string]: unknown } = {};
  for (const l of p.lines) if (l.call.fn === "form") for (const [k, v] of Object.entries(l.call.args)) if (!["form", "to", "for"].includes(k)) o[k] = "text" in v ? v.text : "id" in v ? v.id : undefined;
  return Object.keys(o).length ? o : undefined;
}

// ------------------------------------------------------------------ the compact extract

/** An arm's log with each record written once: the observations' record lists hold indexes into `records`. */
export interface CompactArm extends Omit<ArmLog, "obs"> { records: unknown[]; obs: { [seat: string]: { seq: number; o: any }[] } }

export function compact(a: ArmLog): CompactArm {
  const index = new Map<string, number>();
  const records: unknown[] = [];
  const obs: CompactArm["obs"] = {};
  for (const [seat, xs] of Object.entries(a.obs)) {
    obs[seat] = xs.map(({ seq, o }) => ({ seq, o: { ...o, channels: Object.fromEntries(Object.entries(o.channels ?? {}).map(([name, ch]: [string, any]) => [name, ch.kind === "records" ? { ...ch, records: ch.records.map((r: unknown) => {
      const key = JSON.stringify(r);
      if (!index.has(key)) { index.set(key, records.length); records.push(r); }
      return index.get(key)!;
    }) } : ch])) } }));
  }
  return { ...a, records, obs };
}

export function expand(c: CompactArm): ArmLog {
  const obs: ArmLog["obs"] = {};
  for (const [seat, xs] of Object.entries(c.obs)) obs[seat] = xs.map(({ seq, o }) => ({ seq, o: { ...o, channels: Object.fromEntries(Object.entries(o.channels ?? {}).map(([name, ch]: [string, any]) => [name, ch.kind === "records" ? { ...ch, records: ch.records.map((i: number) => c.records[i]) } : ch])) } }));
  const { records: _r, ...rest } = c;
  return { ...rest, obs };
}

// ------------------------------------------------------------------ the regression check

export interface Difference { run: string; arm: string; ref: string; request: string; logged: string; now: string; shownThen: string; shownNow: string; rules: string[] }

/** A difference explained in docs/decisions.md: the request, and a digest of the call drawn now (a further change to it
 * is new). Which rules made it, and of which blanks, but none of the run's own words or figures: those stay out of git
 * with the runs. */
export interface Explained { run: string; arm: string; ref: string; now_sha256: string; class: "correction"; decision: string; blanks: string[]; rules: string[] }
const digest = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex").slice(0, 16);
export const keyOf = (d: { run: string; arm: string; ref: string; now: string }): string => `${d.run}|${d.arm}|${d.ref}|${digest(canon(d.now))}`;
export async function explainedKeys(file: string): Promise<Set<string>> {
  const f = Bun.file(file);
  return (await f.exists()) ? new Set(((await f.json()) as Explained[]).map((x) => `${x.run}|${x.arm}|${x.ref}|${x.now_sha256}`)) : new Set();
}
export function explainedOf(d: Difference, decision: string): Explained {
  return { run: d.run, arm: d.arm, ref: d.ref, now_sha256: digest(canon(d.now)), class: "correction", decision, blanks: changesBetween(d.logged, d.now).split("; ").map((x) => x.split(":")[0]!.trim()), rules: d.rules };
}

/** Every request the seat confirmed as drawn, drawn or previewed differently by the rules now: each with the rules that
 * touched it. */
export function regressions(a: ArmLog): { confirmed: number; differences: Difference[] } {
  let confirmed = 0;
  const differences: Difference[] = [];
  for (const [r, k] of withKnowledge(a)) {
    if (r.decision !== "accept" || !r.call) continue;
    confirmed++;
    const x = replayOne(r, k);
    // (The same: the same call; or what it does, resolved, and what the seat is shown of it, the same as the logged call
    // by the code now. A change in the preview's own wording since the run is no change of the rules.)
    if (canon(x.now) === canon(r.call)) continue;
    let then: { blocks: string; preview: string } | undefined;
    try { then = shown(calls.parseProgram(r.call), k); } catch { then = undefined; }
    if (then && x.blocks !== undefined && then.blocks === x.blocks && then.preview === x.preview) continue;
    differences.push({ run: a.run, arm: a.arm, ref: r.ref, request: r.request, logged: r.call, now: x.now, shownThen: then?.preview ?? r.summary ?? "", shownNow: x.preview, rules: [...new Set(x.trace.map((t) => t.rule))] });
  }
  return { confirmed, differences };
}
