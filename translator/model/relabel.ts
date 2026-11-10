// Relabelling keyed data by code, for the call language of 2026-11-10 ("one right call": docs/decisions.md), and the
// measure of what it changes. No model is called. What the rule takes out of the translator's choosing is taken out of
// every program the same way, key and answer alike, so that a retrain learns the language the host now serves:
//   - basis by rule (translator/src/rules.ts `ruled`): every record the request cites that no argument takes;
//   - no for= (on whose behalf is the post's); a payment's purpose is memo=;
//   - refusals the seat is told in one sentence (resolver.ts `LABEL_TEXT`) written as one label, the first of them;
//   - values written two ways (a date; a count; an office as its id or "the" and its id) are equal in the scorer
//     already (train/meaning.ts), and are not rewritten here.
// A statement's data= is left as it is (`keepData`): it is not relabelled by code, and the served host asks it back.
// Which ids are records: a record's minted id, or one any program of the data cites as a basis (`citedSomewhere`):
// the host knows which records the seat has been shown; the data does not, and that is the nearest it holds.
//
//   bun translator/model/relabel.ts measure --rejects <rejects.jsonl>... --set <rows.jsonl> <answers.jsonl> ... --out <dir>
//   bun translator/model/relabel.ts write <rows.jsonl> <out.jsonl>   (a keyed file, relabelled; the record ids from it)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { LABEL_TEXT } from "../src/resolver";
import { ruled } from "../src/rules";
import { quoteRule } from "./serve-rules";
import { right } from "./v4-right";

/** The label a refusal is written as: the first label told in the same words. */
export function oneLabel(label: string): string {
  const said = LABEL_TEXT[label as calls.Label];
  return said === undefined ? label : Object.keys(LABEL_TEXT).find((l) => LABEL_TEXT[l as calls.Label] === said)!;
}

/** The ids any program of `programs` cites as a basis, other than minted records: the data's nearest to "the records a seat was shown". */
export function citedSomewhere(programs: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const p of programs) for (const m of (p ?? "").matchAll(/basis=(\[[^\]]*\]|[A-Za-z0-9_.:\/-]+)/g)) for (const x of m[1]!.matchAll(/[a-z0-9][a-z0-9_.:\/-]*/g)) if (!/^rec\.[0-9]+$/.test(x[0])) out.add(x[0]);
  return out;
}

/** A program as the language of 2026-11-10 writes it, for `request`. A program that does not parse is as it was. */
export function relabel(program: string | null | undefined, request: string, records: ReadonlySet<string>): string | null | undefined {
  if (!program) return program;
  let p: calls.Program;
  try {
    p = calls.parseProgram(program);
  } catch {
    return program;
  }
  if ("none" in p) return `none(${oneLabel(p.none)})`;
  const r = ruled(p, request, (id) => /^rec\.[0-9]{1,15}$/.test(id) || (records.has(id) && !id.startsWith("form-")), { keepData: true });
  return r.ok ? calls.programText(r.program) : program;
}

const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  const all = (k: string, n = 1) => rest.flatMap((a, i) => (a === `--${k}` ? [rest.slice(i + 1, i + 1 + n)] : []));
  if (mode === "write") {
    const [src, out] = rest as [string, string];
    const rows = jl(src);
    const records = citedSomewhere(rows.map((r) => r.program));
    writeFileSync(out, rows.map((r) => JSON.stringify({ ...r, program: relabel(r.program, r.request, records) })).join("\n") + "\n");
    console.log(JSON.stringify({ rows: rows.length, changed: rows.filter((r) => relabel(r.program, r.request, records) !== r.program).length }));
  } else if (mode === "measure") {
    const out = all("out")[0]![0]!;
    mkdirSync(out, { recursive: true });
    const rejects = all("rejects").flatMap(([f]) => jl(f!)).filter((r) => r.why === "disagreed");
    const sets = all("set", 2).map(([rows, answers]) => ({ rows: new Map(jl(rows!).map((r) => [r.id, r])), answers: jl(answers!) }));
    const records = citedSomewhere([...rejects.flatMap((r) => Object.values(r.answers) as string[]), ...sets.flatMap((s) => [...[...s.rows.values()].map((r) => r.program), ...s.answers.map((a) => a.own ?? a.program)])]);
    const report: any = { records_cited_somewhere: [...records].sort(), readers: {}, model: {} };
    // Readers: two blind answers to one request, which the pipeline's label step found to differ.
    const readers = { before: [] as any[], after: [] as any[] };
    for (const r of rejects) {
      const [a, b] = Object.values(r.answers) as string[];
      if (a === undefined || b === undefined) continue;
      const row = { forms: r.forms ?? [], ...(r.currency ? { currency: r.currency } : {}) };
      const [x, y] = [relabel(a, r.request, records), relabel(b, r.request, records)];
      if (!right(a, b, row)) readers.before.push([a, b, r.request]);
      if (!right(x, y!, row)) readers.after.push([x, y, r.request]);
    }
    report.readers = { disagreed_in_the_pipeline: rejects.length, differ_by_the_scorer_now: readers.before.length, differ_after: readers.after.length };
    // The model: its own answer against the key, on every real row it was scored on.
    const model = { before: [] as any[], after: [] as any[], rows: 0 };
    for (const s of sets) for (const a of s.answers) {
      const r = s.rows.get(a.id);
      if (!r) continue;
      model.rows++;
      const own = "own" in a ? a.own : a.program;
      const ok = "own" in a ? a.own_ok : a.ok;
      if (!ok) model.before.push([own ?? "none(unclear)", r.program, r.request]);
      const [x, y] = [relabel(own ?? "none(unclear)", r.request, records), relabel(r.program, r.request, records)];
      if (!right(x, y!, r)) model.after.push([x, y, r.request]);
    }
    report.model = { rows: model.rows, wrong_before: model.before.length, wrong_after: model.after.length };
    // As served (C and D): a program that composes data is asked back (rules.ts), and so is a paper's words longer
    // than a phrase that the request quotes nowhere (serve-rules.ts `quoteRule`); a quoted span is copied exactly.
    // What would then be asked back: of the model's answers, the wrong and the right; and of the keys (what a model
    // that answered every request as its key would lose to asking back).
    const asServed = (p: string | null | undefined, r: any): string | undefined => {
      const x = relabel(p ?? "none(unclear)", r.request, records)!;
      if (/^\s*none\(/.test(x)) return x;
      if (/\bstatement\([^\n]*\bdata=/.test(x) && /^statement|\nstatement/.test(x)) return undefined;
      const q = quoteRule(r.request.replace(/[\r\n]/g, " "), x, r.forms ?? []);
      return "ask" in q ? undefined : q.program;
    };
    const served = { wrong: 0, wrong_asked_back: 0, right_asked_back: 0, keys_asked_back: 0, keys_asked_back_by_quotes: 0 };
    for (const s of sets) for (const a of s.answers) {
      const r = s.rows.get(a.id);
      if (!r) continue;
      const own = "own" in a ? a.own : a.program;
      const key = relabel(r.program, r.request, records)!;
      const mine = asServed(own, r);
      const ok = right(relabel(own ?? "none(unclear)", r.request, records), key, r);
      if (mine === undefined) ok ? served.right_asked_back++ : served.wrong_asked_back++;
      else if (!right(mine, asServed(key, r) ?? key, r)) served.wrong++;
      if (asServed(r.program, r) === undefined) {
        served.keys_asked_back++;
        if (!/\bdata=/.test(key)) served.keys_asked_back_by_quotes++;
      }
    }
    report.model.as_served = served;
    for (const [k, v] of Object.entries({ "readers-before": readers.before, "readers-after": readers.after, "model-before": model.before, "model-after": model.after })) writeFileSync(join(out, `${k}.json`), JSON.stringify(v));
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ readers: report.readers, model: report.model }, null, 1));
  } else throw new Error("relabel.ts measure ... | write <rows.jsonl> <out.jsonl>");
}
