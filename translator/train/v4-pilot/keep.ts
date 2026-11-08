// Translator v4, round 2, step 2b: the scope pilot's real requests keyed where two blind readers agree, the seat's
// own sign-off as evidence (docs/design/translator-v4.md, section 3).
//   bun translator/train/v4-pilot/keep.ts <split dir> <answers dir> <out dir>
// Kept: the two readers (Sonnet 5.5 and Opus 5.5, subagents, blind) read the request as the same act (`labelled`: the
// same act by meaning, copied text not compared where a form's line types it `text`, as the assistants' papers were;
// a reader's free text put back to the request's own words where it paraphrased, F1 of words at least 0.6; a form's
// name, office or option implied by its card). The seat's sign-off is evidence one way only. A seat confirms drafts that
// fall short of its words (a report's words left out, a basis narrowed) and declines right drafts for its own reasons
// (the matter moved on; a world's fault: 2026-11-08's first look, 14 of 16 such cases), so a draft that differs from
// two agreeing readers does not overturn them (counted in `signed`). Where the readers disagree, a train-side request is
// kept with the reading that is the same act as the draft the seat confirmed, when that draft was our own model's (a
// reader independent of both: a draft written by Sonnet behind is not, since the Sonnet reader reads with the same
// prompt): two readings of three, one the seat's own confirmation (`reader + seat`). The test and validation sides are
// keyed by the two readers alone.
// Every row is written on one line, as the adapter shows a request.
// Written: train.jsonl (the train side), validation-real-pilot.jsonl (the validation side: never trained, for the
// calibration beside validation-real), test-pilot.jsonl (the test side: scored, never trained or tuned on), rejects.jsonl
// and manifest.json (by side and model). Train and validation rows sharing five words running with the scope-request
// set or a held-out case are dropped (counted). Not against the test side: the pilot's own requests follow a few set
// forms of words (926 of 944 train-side requests share five words running with some test-side one), so the split by
// seat-day is that guard (docs/decisions.md, 2026-11-08).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { loadHeldOut, sharesWording } from "../../eval/held-out";
import { cardRows } from "../../model/export";
import { formOfLine } from "../blind";
import { shapeOf, spansIn } from "../data";
import { sameButForFreeText, sameMeaning } from "../meaning";
import { labelled } from "../readers";
import { withImplied } from "../v4-assistants/implied";

const [split, answersDir, out] = process.argv.slice(2);
if (!split || !answersDir || !out) throw new Error("usage: bun keep.ts <split dir> <answers dir> <out dir>");
const jsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
mkdirSync(join(out, "readers"), { recursive: true });
copyFileSync(join(split, "split.json"), join(out, "split.json"));

const requests: any[] = jsonl(join(split, "requests.jsonl")).map((r) => ({ ...r, request: r.request.replace(/[\r\n]/g, " ") }));
const reqOf = new Map(requests.map((r) => [r.id, r]));
const answersOf = (reader: string) => {
  const got: { id: string; program: string }[] = [];
  for (const f of readdirSync(answersDir).filter((f) => f.startsWith(`${reader}-`) && f.endsWith(".json")).sort()) {
    copyFileSync(join(answersDir, f), join(out, "readers", f));
    try { got.push(...(JSON.parse(readFileSync(join(answersDir, f), "utf8")).answers ?? []).filter((a: any) => typeof a?.id === "string" && typeof a?.program === "string")); } catch { console.error(`not JSON: ${f}`); }
  }
  return got;
};

// (As the assistants' papers: v4-assistants/keep.ts.)
const wordsAt = (t: string) => [...t.matchAll(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)].map((m) => ({ w: m[0].toLowerCase(), a: m.index!, b: m.index! + m[0].length }));
function aligned(request: string, value: string): string | undefined {
  if (request.includes(value)) return value;
  const R = wordsAt(request), V = wordsAt(value).map((x) => x.w);
  if (!V.length || !R.length) return undefined;
  const want = new Map<string, number>(); for (const w of V) want.set(w, (want.get(w) ?? 0) + 1);
  let best = { f: 0, a: 0, b: 0 };
  for (let i = 0; i < R.length; i++) {
    const got = new Map<string, number>(); let hit = 0;
    for (let j = i; j < R.length && j < i + V.length * 2 + 8; j++) {
      const w = R[j]!.w; const g = (got.get(w) ?? 0) + 1; got.set(w, g); if (g <= (want.get(w) ?? 0)) hit++;
      const prec = hit / (j - i + 1), rec = hit / V.length, f = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
      if (f > best.f) best = { f, a: R[i]!.a, b: R[j]!.b };
    }
  }
  return best.f >= 0.6 ? request.slice(best.a, best.b) : undefined;
}
const textFields = (forms: string[]) => { const s = new Set<string>(); for (const l of forms) for (const m of l.matchAll(/([a-z_]+) \(text(?:, required)?\)/g)) s.add(m[1]!); return s; };
let alignedCount = 0;
function repaired(a: { id: string; program: string }) {
  const r: any = reqOf.get(a.id);
  if (!r) return a;
  const tf = textFields(r.forms);
  let changed = false;
  const program = a.program.replace(/\b([a-z_]+)="((?:[^"\\]|\\.)*)"/g, (whole: string, k: string, v: string) => {
    if (!(tf.has(k) || k === "text")) return whole;
    const raw = v.replace(/\\(["\\])/g, "$1");
    if (r.request.includes(raw)) return whole;
    const got = aligned(r.request, raw);
    if (!got) return whole;
    changed = true;
    return `${k}="${got.replace(/(["\\])/g, "\\$1")}"`;
  });
  if (changed) alignedCount++;
  return { id: a.id, program };
}

const S = "claude-code/claude-sonnet-5-5 (subagent, blind)", O = "claude-code/claude-opus-5-5 (subagent, blind)";
const sonnet = answersOf("sonnet").map(repaired), opus = answersOf("opus").map(repaired);
const strict = labelled(requests, [{ reader: S, answers: sonnet }, { reader: O, answers: opus }]);
const sOf = new Map(sonnet.map((a) => [a.id, a.program])), oOf = new Map(opus.map((a) => [a.id, a.program]));
const how = new Map<string, string>(strict.examples.map((e) => [e.id, "two readers"]));
const implied: any[] = [];
for (const r of strict.rejects) {
  if (r.why !== "not_copied") continue;
  const q: any = reqOf.get(r.id), a = sOf.get(r.id), o = oOf.get(r.id);
  const blank = (x: string) => { const tf = textFields(q.forms); return x.replace(/\b([a-z_]+)="((?:[^"\\]|\\.)*)"/g, (w: string, k: string) => (tf.has(k) ? `${k}="_"` : w)); };
  if (!q || !a || !o || !sameButForFreeText(blank(a), blank(o), q.currency ? { currency: q.currency } : {})) continue;
  const missing = String(r.detail ?? "").split("; ").map((x) => x.split("=").slice(1).join("="));
  if (!missing.every((v) => q.forms.some((l: string) => l.startsWith(`- ${v},`) || l.includes(`, to=${v},`) || new RegExp(`\\(one of [^)]*\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l)))) continue;
  try {
    const program = calls.programText(calls.parseProgram(a));
    const spans = withImplied(spansIn(q.request, program, q.forms.map(formOfLine).filter(Boolean)), program, q.forms);
    implied.push({ id: r.id, request: q.request, forms: q.forms, program, spans, kind: "positive", shape: shapeOf(calls.parseProgram(program)) });
    how.set(r.id, "two readers (a form's text fields not compared), its name, office or option implied by its card");
  } catch { /* no spans for it: left out */ }
}
// Reader + seat (train side only): the readers disagree and one of them reads the request as the same act as the
// draft the seat confirmed, written by our own model; that reader's program, if it passes every check of an example on
// its own (`labelled` with it as both readers).
const tieAnswers: { id: string; program: string }[] = [];
for (const r of strict.rejects) {
  const q: any = reqOf.get(r.id);
  if (r.why !== "disagreed" || q?.side !== "train" || q.signed?.decision !== "accept" || !q.signed.call || !String(q.signed.by ?? "").startsWith("decide/")) continue;
  const ctx = { ...(q.currency ? { currency: q.currency } : {}), forms: q.forms.map(formOfLine).filter(Boolean), freeText: false };
  const hits = [sOf.get(r.id), oOf.get(r.id)].filter((p): p is string => !!p && (() => { try { return sameMeaning(q.signed.call, p, ctx as never); } catch { return false; } })());
  if (hits.length === 1) tieAnswers.push({ id: r.id, program: hits[0]! });
}
const tie = labelled(requests.filter((r) => tieAnswers.some((a) => a.id === r.id)), [{ reader: S, answers: tieAnswers }, { reader: `${S} (again)`, answers: tieAnswers }]);
for (const e of tie.examples) how.set(e.id, "one reader + the seat's confirmed draft (our model's)");
const examples = [...strict.examples, ...implied, ...tie.examples];
const rejects: any[] = strict.rejects.filter((r) => !implied.some((e) => e.id === r.id) && !tie.examples.some((e) => e.id === r.id));

const scopeSet = jsonl(join(import.meta.dir, "../../eval/scope-requests.jsonl")).map((x) => ({ id: x.id, request: x.request, expect: ["-"] }));
const sharesScope = sharesWording(scopeSet as never);
const held = loadHeldOut();
const sharesHeld = held ? sharesWording(held) : () => false;

const tally: any = { sides: {}, by_reason: {}, leak_scope_set: 0, leak_held_out: 0, not_two_passes: 0, seat_confirmed_same: 0, seat_confirmed_other: 0, seat_declined_this: 0, seat_declined_other: 0, no_sign_off: 0 };
const inc = (o: any, k: string) => (o[k] = (o[k] ?? 0) + 1);
for (const r of rejects) { inc(tally.by_reason, r.why); const q = reqOf.get(r.id); inc((tally.sides[`${q.side}/${q.model}`] ??= { requests: 0, kept: 0, rejected: {} }).rejected, r.why); }
for (const q of requests) (tally.sides[`${q.side}/${q.model}`] ??= { requests: 0, kept: 0, rejected: {} }).requests++;
const kept: any[] = [];
for (const e of examples) {
  const q = reqOf.get(e.id)!;
  const side = tally.sides[`${q.side}/${q.model}`];
  const ctx = { ...(q.currency ? { currency: q.currency } : {}), forms: q.forms.map(formOfLine).filter(Boolean), freeText: false };
  // The seat's sign-off, recorded beside the key (free text not compared): the same act confirmed, another act
  // confirmed, the same act declined, another declined.
  const s = q.signed;
  if (s?.call && (s.decision === "accept" || s.decision === "reject")) {
    let same = false;
    try { same = sameMeaning(s.call, e.program, ctx as never); } catch { same = false; }
    tally[s.decision === "accept" ? (same ? "seat_confirmed_same" : "seat_confirmed_other") : same ? "seat_declined_this" : "seat_declined_other"]++;
  } else tally.no_sign_off++;
  if (q.side !== "test" && sharesScope(e.request)) { tally.leak_scope_set++; inc(side.rejected, "leak_scope_set"); continue; }
  if (q.side !== "test" && sharesHeld(e.request)) { tally.leak_held_out++; inc(side.rejected, "leak_held_out"); continue; }
  const row = {
    id: `v4p/${e.id}`, request: e.request, forms: e.forms, program: e.program, spans: e.spans, kind: e.kind, shape: e.shape, origin: "pilot",
    source: `scope pilot ${q.side}/${q.seat_day}`, written_by: `${q.model} (seat)`, verified_by: `${S} + ${O}`, currency: q.currency,
    groups: { writer: `${q.model} (seat)`, part: "v4 scope pilot", side: q.side, seat_day: q.seat_day, key: how.get(e.id)!, signed: s?.decision ?? null },
  };
  let two: unknown; try { two = cardRows(row as never); } catch { two = undefined; }
  if (!two) { tally.not_two_passes++; inc(side.rejected, "not_two_passes"); continue; }
  kept.push({ row, side: q.side });
  side.kept++;
}
const w = (f: string, xs: any[]) => writeFileSync(join(out, f), xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : ""));
w("train.jsonl", kept.filter((k) => k.side === "train").map((k) => k.row));
w("validation-real-pilot.jsonl", kept.filter((k) => k.side === "validation").map((k) => k.row));
w("test-pilot.jsonl", kept.filter((k) => k.side === "test").map((k) => k.row));
w("rejects.jsonl", rejects);
const manifest = { requests: requests.length, answered: { sonnet: sonnet.length, opus: opus.length }, readers_agreed: strict.examples.length, implied_by_card: implied.length, reader_and_seat: tie.examples.length, aligned_answers: alignedCount,
  kept: { train: kept.filter((k) => k.side === "train").length, validation: kept.filter((k) => k.side === "validation").length, test: kept.filter((k) => k.side === "test").length }, ...tally,
  label_manifest: { by_function: strict.manifest.by_function, kept_from: strict.manifest.kept_from } };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));
