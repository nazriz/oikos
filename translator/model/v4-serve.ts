// Translator v4, round 3: what is served, read offline from v4-score.ts's answers (one model's, or two models' for
// serving only where both agree), with the serving checks of serve-rules.ts applied as the adapter applies them. The
// same arithmetic as v4-score.ts (v4-curve.ts); nothing is asked of a model here, so a serving rule can be read on every
// set at once. A live run of the same arrangement (v4-score.ts --model decide/<a>+<b>) gives the same answers and the
// latency.
//
//   bun translator/model/v4-serve.ts --rows <rows.jsonl>... --a <answers.jsonl>... [--b <answers.jsonl>...] [--checks]
//        [--trailing] [--edges] [--pow <c>,<p>,<t>] [--cut <sureness>] [--out <file.json>]
//
// --rows: the sets' rows (each with id, request, forms, program, groups.writer). --a / --b: v4-score.ts answer files
// (`--answers` there), the first and second model's, by id. --cut: read at a cut-off set elsewhere (on validation-real),
// besides the set's own best (which is chosen on the set it is read on, and so is only for a validation set).
import { readFileSync, writeFileSync } from "node:fs";
import { oneLine } from "./adapter";
import { cutShort } from "./serve-rules";
import * as C from "./v4-curve";
import { right } from "./v4-right";

const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]!] : []));
const jsonl = (p: string): any[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const rows = new Map(all("rows").flatMap(jsonl).map((r) => [r.id, r]));
// --common: the parity set read only on situations every writer's request of was kept (groups.situation), so each writer
// is read on the same situations.
if (args.includes("--common")) {
  const writersOf = new Map<string, Set<string>>();
  for (const r of rows.values()) (writersOf.get(r.groups?.situation) ?? writersOf.set(r.groups?.situation, new Set()).get(r.groups?.situation)!).add(r.groups?.writer);
  const every = new Set([...rows.values()].map((r) => r.groups?.writer)).size;
  for (const [id, r] of rows) if ((writersOf.get(r.groups?.situation)?.size ?? 0) < every) rows.delete(id);
}
const byId = (fs: string[]) => new Map(fs.flatMap(jsonl).map((a) => [a.id, a]));
const A = byId(all("a")), B = all("b").length ? byId(all("b")) : undefined;
const checks = args.includes("--checks"), trailing = args.includes("--trailing");
// --edges (round 4): a copied text's sureness as the probability that it is right as scored (its ends may differ by
// punctuation or a word: model.py `_edge_mass`, the answer's `parts.texts_edge`) in place of that of its exact ends.
const edges = args.includes("--edges");
// --pow <c>,<p>,<t> (round 4): sureness recalibrated by its parts, the same for every writer (nothing of the writer or
// the wording enters it): choices^c x places^p x texts^t, the exponents fitted on validation (a temperature a pass).
const pow = all("pow")[0]?.split(",").map(Number);
const textsOf = (a: any): number => (edges && a.parts.texts_edge !== undefined ? a.parts.texts_edge : a.parts.texts);
const sureOf = (a: any): number => {
  if (!a) return 0;
  if (pow && a.parts) return Math.pow(a.parts.choices, pow[0]!) * Math.pow(a.parts.places, pow[1]!) * Math.pow(Math.min(1, textsOf(a)), pow[2]!);
  return edges && a.parts?.texts_edge !== undefined && a.parts.texts > 0 ? Math.min(1, (a.sure * a.parts.texts_edge) / a.parts.texts) : a.sure ?? 0;
};
const cut = all("cut")[0] !== undefined ? Number(all("cut")[0]) : undefined;

const servable = (p: string | null | undefined) => !!p && p.trim() !== "none(unclear)";
// (Right where the answer file said wrong: two refusals told alike since it was scored, or a key mended since.)
let flipped = 0;
const why: { [k: string]: number } = { disagree: 0, cut_short: 0, trailing: 0 };
const xs: (C.Scored & { id: string })[] = [];
for (const [id, a] of A) {
  const r = rows.get(id);
  if (!r) continue;
  // (An answer scored with the checks already applied keeps the model's own as `own`.)
  const program: string | null = a.own !== undefined ? a.own : a.program;
  // Scored here against the row's key (v4-right.ts), not the answer file's own verdict: a key mended since the answers
  // were written (the third reader, round 4) is read as mended. Two refusals told alike count as one answer.
  const ok = right(program, r.program, r);
  if (ok && !(a.own_ok !== undefined ? a.own_ok : a.ok)) flipped++;
  let served = servable(program), sure: number = sureOf(a);
  if (B) {
    const b = B.get(id);
    const other = b ? (b.own !== undefined ? b.own : b.program) : undefined;
    sure = Math.min(sure, b ? sureOf(b) : 0);
    if (served && other !== program) { served = false; why.disagree!++; }
  }
  const c = served && checks && !/^none\(\w+\)$/.test(program!.trim()) ? cutShort(oneLine(r.request), program!, r.forms ?? [], { trailing }) : undefined;
  if (c) { served = false; why[c.kind]!++; }
  xs.push({ id, sure, ok, served, writer: r.groups?.writer ?? r.from?.writer ?? "(not recorded)" });
}
const point = C.curve(xs, false), bound = C.curve(xs, true);
// The surest wrong answers served, with their rank among what is served (what stands in the way of the bound).
const ranked = xs.filter((x) => x.served).sort((a, b) => b.sure - a.sure);
const surestWrong = ranked.flatMap((x, k) => (x.ok ? [] : [{ rank: k + 1, id: x.id, sure: +x.sure.toFixed(6), writer: x.writer }])).slice(0, 12);
const report: any = {
  rows: xs.length, right: xs.filter((x) => x.ok).length, asked_back_by: why, right_since_scored: flipped, surest_wrong: surestWrong,
  own_best: { at_1pct: point, at_1pct_bound95: bound, ...C.byWriter(xs, point.cut) },
  ...(cut !== undefined ? { at_cut: { ...C.atCut(xs, cut), ...C.byWriter(xs, cut) } } : {}),
};
if (all("out")[0]) writeFileSync(all("out")[0]!, JSON.stringify(report, null, 1));
if (args.includes("--wrong")) console.error(surestWrong.map((w) => `${w.rank}\t${w.sure}\t${w.id}`).join("\n"));
console.log(JSON.stringify({ rows: report.rows, right: report.right, asked_back_by: why, at_1pct: point, bound95: bound, ...(report.at_cut ? { at_cut: { ...report.at_cut, by_writer: Object.fromEntries(Object.entries(report.at_cut.by_writer).map(([w, v]: [string, any]) => [w.replace(/ \(.*$/, ""), `${v.right_served}/${v.n} (${v.wrong_served} wrong)`])) } } : {}), spread: report.own_best.parity_spread_points }));
