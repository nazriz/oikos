// A run's requests replayed through the translator's rules as they are now (docs/handover.md: after a rung, and
// before rerunning one, run this). Read-only on the run: its logs are exported to a scratch folder, never written to.
//
// For each model seat's request (the translator's own transcript in the log: the words, and the call it first wrote),
// what the seat was shown and did (the draft, its preview, the seat's yes or no and why, or what it was asked back),
// and what the rules now in this checkout would draw: the same call through `formRules` and `ruled`, resolved on the
// seat's knowledge rebuilt from what it was shown before it asked, and previewed as the seat would read it.
//
// Per seat model, two figures as logged and as now: drafts the seat would accept, and right on first asking. "Now" is
// a range: its low end counts what the seat accepted and is drawn the same now; its high end adds every request now
// drawn or previewed differently, each listed with the seat's reason, for a reader to check. Then every request still
// wrong (drawn the same, and declined or asked back), with a one-line class. No model is called.
//
//   bun translator/eval/replay.ts <run folder>
//
// It refuses a run whose seat-days hold the pilot cases (translator/eval/pilot-cases.ts): those stay out of all of it.

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { calls } from "@oikos/participants";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { resolve } from "../src/resolver";
import { formRules, recordTest, ruled } from "../src/rules";
import { PILOT_CASES } from "./pilot-cases";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: bun translator/eval/replay.ts <run folder>");
  process.exit(2);
}
const run = realpathSync(pathResolve(folder));
// (The pilot cases' runs, by their folder as the cases name it: refused, folder and any folder inside one.)
const held = [...new Set(PILOT_CASES.map((c) => c.from.run.replace(/\/+$/, "")))];
if (held.some((h) => run.endsWith(`/${h}`) || run.includes(`/${h}/`))) {
  console.error(`${run} holds the pilot cases' seat-days (translator/eval/pilot-cases.ts): they stay out of all of it.`);
  process.exit(3);
}

const seeds = readdirSync(run).filter((d) => d.startsWith("seed-")).map((d) => join(run, d));
const logs = (seeds.length ? seeds : [run]).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".oklog") && f !== "base.oklog" && f !== "code.oklog").map((f) => join(d, f)));
if (!logs.length) {
  console.error(`no model arm's log in ${run}`);
  process.exit(2);
}

interface Req {
  ref: string; seq: number; seat: string; request: string; raw?: string; stage?: string;
  call?: string; summary?: string; decision?: "accept" | "reject"; note?: string; failure?: string; failedCall?: string;
}
const DRAFT_ID = /^draft\.(.+)\.(\d+)$/;
const scratch = mkdtempSync(join(tmpdir(), "oikos-replay-"));
const totals = new Map<string, { offered: number; accepted: number; first: number; firstAccepted: number; low: number; high: number; firstLow: number; firstHigh: number }>();
const wrong: string[] = [];
const changed: string[] = [];

try {
  for (const log of logs) {
    const out = join(scratch, "log.jsonl");
    const ex = Bun.spawnSync([kernelBinary(), "export", log, "--out", out]);
    if (ex.exitCode !== 0) throw new Error(`export failed for ${log}: ${ex.stderr.toString().slice(0, 300)}`);
    const config = JSON.parse(readFileSync(join(log, "..", "config.json"), "utf8"));
    const currency = config.world?.currencies?.[0];
    const reqs = new Map<string, Req>();
    const obs: { seat: string; seq: number; o: any }[] = [];
    const model = new Map<string, string>();
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
        if (b.annotation === "usage" && b.purpose === "participant" && typeof b.subject === "string" && !model.has(b.subject)) model.set(b.subject, `${b.provider}/${b.model}`);
        else if (b.annotation === "observation" && typeof b.subject === "string") obs.push({ seat: b.subject, seq: e.seq, o: b.data.observation });
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
    const arm = log.split("/").pop()!.replace(/\.oklog$/, "");
    for (const r of [...reqs.values()].filter((x) => x.request && x.raw).sort((a, b) => a.seq - b.seq)) {
      const who = `${arm}: ${model.get(r.seat) ?? r.seat}`;
      const t = totals.get(who) ?? { offered: 0, accepted: 0, first: 0, firstAccepted: 0, low: 0, high: 0, firstLow: 0, firstHigh: 0 };
      totals.set(who, t);
      // The seat's knowledge as it stood when it asked: everything it was shown before.
      const k = new Knowledge(currency);
      for (const x of obs) if (x.seat === r.seat && x.seq < r.seq) k.absorb(x.o);
      let now = r.raw!, preview = "";
      try {
        const p = calls.parseProgram(r.raw!);
        const ru = ruled(formRules(p, r.request, k), r.request, recordTest(k));
        if (ru.ok) {
          now = calls.programText(ru.program);
          const as = [...k.held][0];
          const res = resolve(ru.program, k, () => undefined, as, { written: true });
          preview = res.ok ? new Preview(k, k.actingFor(as), () => undefined, as).of(res.blocks, givenOf(ru.program)) : `asked: ${res.questions.join(" ")}`;
        } else preview = `asked: ${ru.ask}`;
      } catch (e) { preview = `could not be replayed: ${String((e as Error).message).slice(0, 120)}`; }
      const logged = r.call ?? r.failedCall ?? "";
      // (Accepted and drawn the same: accepted now, whatever the preview's wording. Not accepted: the same only where both
      // the call and what the seat would be shown are.)
      const same = canon(now) === canon(logged) && (r.decision === "accept" || r.summary === undefined || preview === r.summary);
      const first = (r.stage ?? "first") === "first";
      if (r.call) t.offered++;
      if (first) t.first++;
      if (r.decision === "accept") { t.accepted++; if (first) t.firstAccepted++; }
      const counts = (x: boolean) => { if (x) { t.high++; if (first) t.firstHigh++; } };
      if (r.decision === "accept" && same) { t.low++; if (first) t.firstLow++; t.high++; if (first) t.firstHigh++; continue; }
      if (!same) {
        counts(true);
        changed.push(`${who} ${r.ref}${first ? "" : " (restated)"}: ${r.decision === "accept" ? "accepted" : r.decision === "reject" ? `declined ("${cut(r.note ?? "", 110)}")` : `asked back ("${cut(r.failure ?? "", 110)}")`}\n    logged: ${cut(logged, 160)}\n    now:    ${cut(now, 160)}${newLines(r.summary ?? "", preview).map((x) => `\n    shown:  ${cut(x, 220)}`).join("")}`);
        continue;
      }
      wrong.push(`${who} ${r.ref}: ${r.decision === "reject" ? `declined, drawn the same now: "${cut(r.note ?? "", 140)}"` : r.failure ? `asked back, the same now: "${cut(r.failure, 140)}"` : "drafted, not answered"}  [${cut(r.request, 100)}]`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`Replay of ${run}, with the rules of this checkout.\n`);
for (const [who, t] of totals) {
  const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);
  console.log(`${who}\n  drafts the seat would accept: as logged ${t.accepted} of ${t.offered} offered; now ${range(t.low, t.high)}\n  right on first asking: as logged ${t.firstAccepted} of ${t.first}; now ${range(t.firstLow, t.firstHigh)}`);
}
console.log(`\nDrawn or shown differently now (${changed.length}), each to be checked against the seat's reason:`);
for (const c of changed) console.log(`- ${c}`);
console.log(`\nStill wrong (${wrong.length}): drawn and shown the same now, and declined or asked back:`);
for (const w of wrong) console.log(`- ${w}`);

/** The lines of what the seat would be shown now that it was not shown then (the first three). */
function newLines(was: string, now: string): string[] {
  const old = new Set(was.split("\n").map((x) => x.trim()));
  return now.split("\n").map((x) => x.trim()).filter((x) => x && !old.has(x)).slice(0, 3);
}
function canon(s: string): string {
  try { return calls.programText(calls.parseProgram(s)); } catch { return s; }
}
function cut(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}
/** The blanks a call's form lines filled, as written (translator/src/index.ts, `givenOf`). */
function givenOf(p: calls.Program): { [field: string]: unknown } | undefined {
  if (!("lines" in p)) return undefined;
  const o: { [field: string]: unknown } = {};
  for (const l of p.lines) if (l.call.fn === "form") for (const [k, v] of Object.entries(l.call.args)) if (!["form", "to", "for"].includes(k)) o[k] = "text" in v ? v.text : "id" in v ? v.id : undefined;
  return Object.keys(o).length ? o : undefined;
}
