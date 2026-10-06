// How a trained model did on a set it was run on. Usage:
//   bun translator/model/score.ts <EXPORTED>/validation.jsonl <DATA>/all/validation.jsonl <MODEL>/validation.jsonl
// The model's steps are turned back into a program and compared with the gold program by meaning (the same
// comparison the blind check uses). Then: what share is right, and at each level of sureness below which the model
// would ask back instead, how much is right, asked back, and confidently wrong.
import { readFileSync } from "node:fs";
import { sameMeaning } from "../train/meaning";
import { decode } from "./encode";
import { stepsOf, type Row } from "./export";

const jsonl = <T>(f: string): T[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

export interface Judged { id: string; kind: string; right: boolean; sure: number; got: string; want: string; request: string; why: string }

export function judge(rows: Row[], gold: { id: string; request: string; forms: string[]; program: string; kind: string; currency?: unknown }[], out: { id: string; steps: Row["steps"]; sure: number }[]): Judged[] {
  const byId = new Map(gold.map((g) => [g.id, g]));
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  return out.map((o) => {
    const g = byId.get(o.id)!, r = rowOf.get(o.id)!;
    const input = [g.request, ...g.forms].join("\n");
    let got: string;
    try { got = decode(input, stepsOf(r, o.steps)); } catch (e) { got = `(no program: ${(e as Error).message})`; }
    let right = false;
    try { right = got === g.program || sameMeaning(got, g.program, { currency: g.currency } as never); } catch { right = false; }
    const fn = (p: string) => (p.startsWith("none(") ? p : p.startsWith("(") ? "(no program)" : p.split("\n").map((l) => l.replace(/^\w+ = /, "").split("(")[0]).join(" ; "));
    const why = right ? "" : fn(got) !== fn(g.program) ? `${fn(g.program)} -> ${fn(got)}` : `${fn(g.program)}: a value`;
    return { id: o.id, kind: g.kind, right, sure: o.sure, got, want: g.program, request: g.request, why };
  });
}

/** At a threshold: below it the model asks back (none(unclear)); at or above it, its answer stands. */
export function at(js: Judged[], threshold: number): { right: number; asked: number; wrong: number } {
  let right = 0, asked = 0, wrong = 0;
  for (const j of js) {
    if (j.sure < threshold) { if (j.want === "none(unclear)") right++; else asked++; }
    else if (j.right) right++;
    else wrong++;
  }
  return { right, asked, wrong };
}

if (import.meta.main) {
  const [exported, gold, model] = process.argv.slice(2) as [string, string, string];
  const js = judge(jsonl<Row>(exported), jsonl(gold), jsonl(model));
  const n = js.length, pct = (k: number) => `${((100 * k) / n).toFixed(1)}%`;
  console.log(`${js.filter((j) => j.right).length} of ${n} right by meaning (${pct(js.filter((j) => j.right).length)}); positives ${js.filter((j) => j.right && j.kind === "positive").length}/${js.filter((j) => j.kind === "positive").length}, refusals ${js.filter((j) => j.right && j.kind === "refusal").length}/${js.filter((j) => j.kind === "refusal").length}`);
  console.log("threshold  right   asked back  confidently wrong");
  for (const t of [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999]) { const r = at(js, t); console.log(`${String(t).padEnd(9)}  ${pct(r.right).padEnd(6)}  ${pct(r.asked).padEnd(10)}  ${pct(r.wrong)}`); }
  const why = new Map<string, number>();
  for (const j of js) if (!j.right) why.set(j.why, (why.get(j.why) ?? 0) + 1);
  console.log("what went wrong:"); for (const [k, v] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  if (process.argv.includes("--show")) for (const j of js.filter((j) => !j.right).slice(0, 14)) console.log(`\n- ${j.request.slice(0, 220)}\n  want ${j.want.slice(0, 200)}\n  got  ${j.got.slice(0, 200)}  (sure ${j.sure.toFixed(3)})`);
}
