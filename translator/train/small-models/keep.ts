// Small models' requests, step 4: keyed where two blind readers of two families agree once code has set what code sets.
//   bun translator/train/small-models/keep.ts <split dir> <read dir> <out dir>
// Each reader's program is first put in the taught language (model/taught.ts: basis and on-behalf `for` are the host's
// by rule, translator/src/rules.ts `ruled`; a payment's purpose is memo; refusals the seat is told in one sentence are
// one label), so no reader decides them. Then `labelled` (readers.ts): both are programs the contract allows, they are
// the same act by meaning (copied free text not compared), and every value of the one kept is in the request. Where a
// reader paraphrased a form's text field, it is put back to the request's own words first, as v4-pilot/keep.ts does
// (F1 of words at least 0.6). A program that composes a statement's data is no example (the host asks it back).
// The seat's sign-off is recorded beside the key, never used to settle it. Train rows sharing five words running with
// a held-out case or the scope set are dropped (counted); the test side is the split's seat-days, never trained on.
// Written: train.jsonl, test.jsonl, rejects.jsonl (with both readings and what the disagreement is about), manifest.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { loadHeldOut, sharesWording } from "../../eval/held-out";
import { cardRows } from "../../model/export";
import { taught } from "../../model/taught";
import { formOfLine } from "../blind";
import { shapeOf, spansIn } from "../data";
import { sameButForFreeText } from "../meaning";
import { labelled, withListsQuoted } from "../readers";
import { withImplied } from "../v4-assistants/implied";

const [split, readDir, out] = process.argv.slice(2);
if (!split || !readDir || !out) throw new Error("usage: bun keep.ts <split dir> <read dir> <out dir>");
const jsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
mkdirSync(out, { recursive: true });
const requests: any[] = jsonl(join(split, "requests.jsonl"));
const reqOf = new Map(requests.map((r) => [r.id, r]));
const readers = JSON.parse(readFileSync(join(readDir, "uniformity.json"), "utf8")).readers.map((r: any) => r.reader) as string[];
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");

// (A reader's paraphrase of a form's text field put back to the request's words: v4-pilot/keep.ts `aligned`.)
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
const textFields = (forms: string[]) => { const s = new Set<string>(["text", "memo"]); for (const l of forms) for (const m of l.matchAll(/([a-z_]+) \(text(?:, required)?\)/g)) s.add(m[1]!); return s; };
let alignedCount = 0, composed = 0;
const composesData = new Set<string>();
function prepared(a: { id: string; program: string }, reader: string): { id: string; program: string } {
  const r = reqOf.get(a.id);
  let program = a.program;
  try { const t = taught(withListsQuoted(program)); if (t === undefined) { composed++; composesData.add(`${reader}|${a.id}`); } else program = t; } catch { /* not a program: labelled says so */ }
  if (!r) return { id: a.id, program };
  const tf = textFields(r.forms);
  const fixed = program.replace(/\b([a-z_]+)="((?:[^"\\]|\\.)*)"/g, (whole: string, k: string, v: string) => {
    if (!tf.has(k)) return whole;
    const raw = v.replace(/\\(["\\])/g, "$1");
    if (r.request.includes(raw)) return whole;
    const got = aligned(r.request, raw);
    return got ? `${k}="${got.replace(/(["\\])/g, "\\$1")}"` : whole;
  });
  if (fixed !== program) alignedCount++;
  return { id: a.id, program: fixed };
}
const answersOf = (reader: string) => JSON.parse(readFileSync(join(readDir, safe(reader), "answers.json"), "utf8")).answers.map((a: any) => prepared(a, reader));
const [A, B] = readers as [string, string];
const aAns = answersOf(A), bAns = answersOf(B);
const unl = requests.map((r) => ({ id: r.id, request: r.request, forms: r.forms, ...(r.currency ? { currency: r.currency } : {}), from: { writer: `${r.model} (seat)` } }));
const got = labelled(unl, [{ reader: A, answers: aAns }, { reader: B, answers: bAns }]);
const aOf = new Map(aAns.map((x: any) => [x.id, x.program])), bOf = new Map(bAns.map((x: any) => [x.id, x.program]));
// Implied by its card (as v4-pilot/keep.ts): both readers write the same act, and what is not in the request's words
// is only a form's name, its office or one of a field's options, each shown on the form's card.
const implied: any[] = [];
for (const r of got.rejects) {
  if (r.why !== "not_copied") continue;
  const q: any = reqOf.get(r.id), a = aOf.get(r.id) as string | undefined, o = bOf.get(r.id) as string | undefined;
  if (!q || !a || !o || !sameButForFreeText(withListsQuoted(a), withListsQuoted(o), q.currency ? { currency: q.currency } : {})) continue;
  const missing = String(r.detail ?? "").split("; ").map((x) => x.split("=").slice(1).join("="));
  if (!missing.every((v) => q.forms.some((l: string) => l.startsWith(`- ${v},`) || l.includes(`, to=${v},`) || new RegExp(`\\(one of [^)]*\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l)))) continue;
  try {
    const program = calls.programText(calls.parseProgram(withListsQuoted(a)));
    const spans = withImplied(spansIn(q.request, program, q.forms.map(formOfLine).filter(Boolean)), program, q.forms);
    implied.push({ id: r.id, request: q.request, forms: q.forms, program, spans, kind: "positive", shape: shapeOf(calls.parseProgram(program)) });
  } catch { /* no spans for it: left out */ }
}
const impliedIds = new Set(implied.map((e) => e.id));

/** What two readings that differ differ in: refusal labels, a refusal against an act, the functions, or arguments. */
function about(a?: string, b?: string): string {
  if (!a || !b) return "unanswered";
  let pa: calls.Program, pb: calls.Program;
  try { pa = calls.parseProgram(withListsQuoted(a)); pb = calls.parseProgram(withListsQuoted(b)); } catch { return "not_a_program"; }
  if ("none" in pa && "none" in pb) return `refusal labels: ${[pa.none, pb.none].sort().join(" / ")}`;
  if ("none" in pa || "none" in pb) return `refusal against act: ${"none" in pa ? pa.none : pb.none} / ${("none" in pa ? pb : pa).lines.map((l) => l.call.fn).join("+")}`;
  const fa = pa.lines.map((l) => l.call.fn + (l.call.args.form && "id" in l.call.args.form ? `:${l.call.args.form.id}` : "")), fb = pb.lines.map((l) => l.call.fn + (l.call.args.form && "id" in l.call.args.form ? `:${l.call.args.form.id}` : ""));
  if (fa.length !== fb.length) return `lines: ${fa.length} / ${fb.length}`;
  if (fa.join("+") !== fb.join("+")) return `functions or forms: ${fa.join("+")} / ${fb.join("+")}`.replace(/:[\w.-]+/g, (m) => m).slice(0, 120);
  const diff = new Set<string>();
  pa.lines.forEach((l, i) => { const m = pb.lines[i]!.call.args; for (const k of new Set([...Object.keys(l.call.args), ...Object.keys(m)])) if (JSON.stringify(l.call.args[k]) !== JSON.stringify(m[k])) diff.add(`${l.call.fn}.${k}`); });
  return `arguments: ${[...diff].sort().join(", ")}`;
}

const scopeSet = jsonl(join(import.meta.dir, "../../eval/scope-requests.jsonl")).map((x) => ({ id: x.id, request: x.request, expect: ["-"] }));
const sharesScope = sharesWording(scopeSet as never);
const held = loadHeldOut();
const sharesHeld = held ? sharesWording(held) : () => false;
const inc = (o: any, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);
const tally: any = { by_model: {}, by_reason: {}, disagreements: {}, leak_scope_set: 0, leak_held_out: 0, not_two_passes: 0, kept_kinds: {}, signed: {} };
const model = (q: any) => (tally.by_model[`${q.side}/${q.model}`] ??= { requests: 0, said: 0, kept: 0, kept_said: 0, acts: 0, refusals: {}, rejected: {} });
for (const q of requests) { model(q).requests++; model(q).said += q.said; }
const rejects = got.rejects.filter((r) => !impliedIds.has(r.id)).map((r) => {
  const q = reqOf.get(r.id)!;
  const why = composesData.has(`${A}|${r.id}`) || composesData.has(`${B}|${r.id}`) ? "composes_data" : r.why;
  inc(tally.by_reason, why); inc(model(q).rejected, why);
  const ab = why === "disagreed" ? about(aOf.get(r.id), bOf.get(r.id)) : undefined;
  if (ab) inc(tally.disagreements, ab.replace(/form-[\w-]+/g, "form").replace(/:[a-z_]+/g, ""));
  return { ...r, why, ...(ab ? { about: ab } : {}), side: q.side, model: q.model, said: q.said, outcomes: q.outcomes };
});
const kept: any[] = [];
for (const e of [...got.examples, ...implied]) {
  const q = reqOf.get(e.id)!;
  const p = calls.parseProgram(e.program);
  const kind = "none" in p ? `none(${p.none})` : p.lines.map((l) => l.call.fn).join("+");
  if (q.side === "train" && sharesScope(e.request)) { tally.leak_scope_set++; inc(model(q).rejected, "leak_scope_set"); continue; }
  if (q.side === "train" && sharesHeld(e.request)) { tally.leak_held_out++; inc(model(q).rejected, "leak_held_out"); continue; }
  const signed = Object.keys(q.signed ?? {}).join("+") || null;
  const row = {
    id: `sm/${e.id}`, request: e.request, forms: e.forms, program: e.program, spans: e.spans, kind: e.kind, shape: e.shape, origin: "pilot",
    source: `small models ${q.side}/${q.seat_days[0]}/`, written_by: `${q.model} (seat)`, verified_by: `${A} + ${B} (blind, taught language)`, currency: q.currency,
    groups: { writer: `${q.model} (seat)`, part: "small models 2026-11-11", side: q.side, seat_day: q.seat_days[0], seat_days: q.seat_days.length, said: q.said, key: impliedIds.has(e.id) ? "two readers, a form's name, office or option implied by its card" : "two readers", signed },
  };
  let two: unknown; try { two = cardRows(row as never); } catch { two = undefined; }
  if (!two) { tally.not_two_passes++; inc(model(q).rejected, "not_two_passes"); continue; }
  kept.push({ row, side: q.side });
  const m = model(q);
  m.kept++; m.kept_said += q.said;
  if ("none" in p) inc(m.refusals, p.none); else m.acts++;
  inc(tally.kept_kinds, kind.replace(/\+.*$/, "+…"));
  if (signed) inc(tally.signed, signed);
}
const w = (f: string, xs: any[]) => writeFileSync(join(out, f), xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : ""));
w("train.jsonl", kept.filter((k) => k.side === "train").map((k) => k.row));
w("test.jsonl", kept.filter((k) => k.side === "test").map((k) => k.row));
w("rejects.jsonl", rejects);
const answered = requests.filter((q) => aOf.has(q.id) && bOf.has(q.id)).length;
const manifest = {
  readers, requests: requests.length, answered_by_both: answered, agreed: got.examples.length, implied_by_card: implied.length, agreement: +((got.examples.length + implied.length) / Math.max(1, answered)).toFixed(3),
  composes_data_readings: composed, aligned_readings: alignedCount, kept: { train: kept.filter((k) => k.side === "train").length, test: kept.filter((k) => k.side === "test").length },
  ...tally, label_manifest: { by_function: got.manifest.by_function, by_refusal_label: got.manifest.by_refusal_label, kept_from: got.manifest.kept_from },
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));
