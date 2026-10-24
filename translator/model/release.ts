// What a model that reads forms by name (decoding `cards`) is released for: by kind of field and by function, not form
// by form (the owner's ruling, 2026-10-23; docs/design/translator-v3.md, section 4). Measured before any release, its
// drafts as they are (adapter `unreleased`):
//   - each kind of field (a form's line's types: text, count, amount, record, ..., `choice` for one of a few options) on
//     the unseen forms (validation-uf: forms kept out of training entirely): a field of the label or of the draft is
//     right where the two give it the same value by meaning, wrong where the draft gives another or one the label has
//     not, missed where the draft leaves it out, no draft where the model offered none;
//   - each function of the call language on requests kept out of training (the validation files): a request is right
//     where the draft means the label (copied free text aside, as the real scorer), wrong where it means something else,
//     no draft otherwise.
// Released: at least 30 cases, at least 90% right and at most 1% wrong (the owner's pass mark, applied to each kind).
//   bun translator/model/release.ts decide/<name> --uf <validation-uf.jsonl> --val <file>... [--write]
// --write puts types-released.json beside the model (OIKOS_TRANSLATOR_MODELS/<name>), with every count.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { calls } from "@oikos/participants";
import { sameButForFreeText, sameMeaning, type MeaningContext } from "../train/meaning";
import { DecideAdapter, fieldTypes } from "./adapter";
import { partsOf } from "./subset";

export const MARK = { cases: 30, right: 0.9, wrong: 0.01 };
export type Tally = { cases: number; right: number; wrong: number; missed: number; none: number };
export const passes = (t: Tally): boolean => t.cases >= MARK.cases && t.right / t.cases >= MARK.right && t.wrong / t.cases <= MARK.wrong;

/** The forms shown, as the meaning comparison reads them. */
export function contextOf(forms: string[], currency?: MeaningContext["currency"]): MeaningContext {
  return { currency, forms: forms.map((l) => {
    const p = partsOf(l);
    const types = fieldTypes(l);
    return { form: p.name, to: /, to=([^,]+),/.exec(l)?.[1] ?? "", id: p.id, fields: Object.fromEntries(p.fields.map((f, i) => [f, { type: types[i] ?? "text" }])) };
  }) };
}

/** Each field of each form a program fills: its form, office and value as written. */
function fieldsOf(program: string): { form: string; to: string; field: string; value: string }[] {
  let p: calls.Program;
  try { p = calls.parseProgram(program); } catch { return []; }
  if ("none" in p) return [];
  const out: { form: string; to: string; field: string; value: string }[] = [];
  const said = (v: calls.Value | undefined) => (v && "id" in v ? v.id : v && "text" in v ? v.text : "");
  const visit = (c: calls.Call) => {
    for (const v of Object.values(c.args)) if ("call" in v) visit(v.call);
    if (c.fn !== "form") return;
    for (const [k, v] of Object.entries(c.args)) if (k !== "form" && k !== "to") out.push({ form: said(c.args.form), to: said(c.args.to), field: k, value: calls.programText({ lines: [{ call: { fn: "form", args: { form: c.args.form!, ...(c.args.to ? { to: c.args.to } : {}), [k]: v } } }] }) });
  };
  for (const l of p.lines) visit(l.call);
  return out;
}

/** The functions a program's lines use (none for a refusal). */
export function functionsOf(program: string): string[] {
  try {
    const p = calls.parseProgram(program);
    return "none" in p ? [] : [...new Set(p.lines.map((l) => l.call.fn))];
  } catch { return []; }
}

if (import.meta.main) {
  // (Arguments: the model, then `--uf FILE...` and `--val FILE...`, each taking the files after it; `--write`.)
  const lists: { [k: string]: string[] } = { "": [], uf: [], val: [] };
  let at = "", write = false;
  for (const x of process.argv.slice(2)) {
    if (x === "--write") write = true;
    else if (x === "--uf" || x === "--val") at = x.slice(2);
    else lists[at]!.push(x);
  }
  const { uf, val } = lists as { uf: string[]; val: string[] };
  const model = lists[""]![0];
  if (!model?.startsWith("decide/") || !uf.length) throw new Error("usage: bun translator/model/release.ts decide/<name> --uf <file> --val <file>... [--write]");
  const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const adapter = new DecideAdapter(model.slice(7), { first: true, quiet: true, unreleased: true });
  await adapter.ready();
  const zero = (): Tally => ({ cases: 0, right: 0, wrong: 0, missed: 0, none: 0 });
  const types: { [t: string]: Tally } = {}, fns: { [f: string]: Tally } = {};
  const choose = { cases: 0, right: 0 };
  for (const e of uf.flatMap(jl)) {
    const a = await adapter.translate(e.request, e.forms);
    const drafted = !a.withheld && !/^none\(/.test(a.program);
    const ctx = contextOf(e.forms, e.currency);
    const label = fieldsOf(e.program), draft = drafted ? fieldsOf(a.program) : [];
    const lineOf = (form: string, to: string) => { const mine = e.forms.filter((l: string) => partsOf(l).name === form || partsOf(l).id === form); return mine.find((l: string) => l.includes(`, to=${to},`)) ?? mine[0] ?? ""; };
    const typeOf = (form: string, to: string, field: string) => { const l = lineOf(form, to); const i = partsOf(l).fields.indexOf(field); return fieldTypes(l)[i] ?? "unknown"; };
    // (Which form: the choose pass's part, scored apart.)
    const want = label.map((x) => x.form)[0], got = draft.map((x) => x.form)[0] ?? (/form=([\w.-]+)/.exec(a.program)?.[1]);
    choose.cases++; choose.right += Number(drafted && !!want && got === want);
    const seen = new Set<string>();
    for (const x of label) {
      const t = (types[typeOf(x.form, x.to, x.field)] ??= zero());
      t.cases++;
      seen.add(`${x.form}|${x.field}`);
      if (!drafted) { t.none++; continue; }
      const d = draft.find((y) => y.form === x.form && y.field === x.field);
      if (!d) { t.missed++; continue; }
      let same = false;
      try { same = sameMeaning(d.value, x.value, ctx); } catch { same = d.value === x.value; }
      same ? t.right++ : t.wrong++;
    }
    for (const d of draft) if (!seen.has(`${d.form}|${d.field}`)) { const t = (types[typeOf(d.form, d.to, d.field)] ??= zero()); t.cases++; t.wrong++; }
  }
  for (const e of val.flatMap(jl)) {
    const want = functionsOf(e.program);
    if (!want.length) continue;
    const a = await adapter.translate(e.request, e.forms ?? []);
    const drafted = !a.withheld && !/^none\(/.test(a.program);
    const ctx = contextOf(e.forms ?? [], e.currency);
    let same = false;
    if (drafted) try { same = sameMeaning(a.program, e.program, ctx) || sameButForFreeText(a.program, e.program, ctx); } catch { same = a.program === e.program; }
    for (const f of new Set([...want, ...(drafted ? functionsOf(a.program) : [])])) {
      const t = (fns[f] ??= zero());
      t.cases++;
      if (!drafted) t.none++;
      else if (same) t.right++;
      else t.wrong++;
    }
  }
  adapter.close();
  const released = { types_released: Object.keys(types).filter((t) => passes(types[t]!)).sort(), functions_released: Object.keys(fns).filter((f) => passes(fns[f]!)).sort() };
  const result = { model, mark: MARK, ...released, choose_on_unseen_forms: choose, types, functions: fns, measured_on: { uf, val } };
  console.log(JSON.stringify(result, null, 1));
  if (write) writeFileSync(join(process.env.OIKOS_TRANSLATOR_MODELS ?? resolve(import.meta.dir, "../../runs/translator-model"), model.slice(7), "types-released.json"), JSON.stringify(result, null, 1) + "\n");
}
