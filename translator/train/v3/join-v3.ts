#!/usr/bin/env bun
// joined-v3: the training data of translator v3 (docs/design/translator-v3.md, section 2), by code. No model is called.
//   bun translator/train/v3/join-v3.ts <out dir>
// Base: round 3's joined-14 (train, validation, validation-real; leak-checked then). Added: the train pilots' audited-right
// requests (lv-09, lv-11, lv-13) four times; the written examples for new and thin forms and for agreements (gen/), with
// distractor forms; renamed twins (form, field names and the request's words for them, from renaming/table.json, fields
// shuffled); names twins (a person's id in the request written as a name drawn from a profile's names, the program
// carrying the name as text). Kept out: a seeded 15% of the form names that are in no real test (R180, the six pilots)
// and no written target: every row that fills one goes to validation-uf (at most 12 a form), and their lines are taken
// out of every other row's forms. The leak check drops any training row in a test's words (R180, the test pilots'
// requests: exact, or five words running of the held-out cases, by code only).
// Moved into git from runs/translator-v3-2026-10-25/scripts/join-v3.ts on 2026-11-10.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spansIn } from "../data";
import { withImplied } from "./implied";
import { cardRows } from "../../model/export";
import { calls } from "@oikos/participants";
import { loadHeldOut, sharesWording } from "../../eval/held-out";
import { PILOT_CASES, FORMS } from "../../eval/pilot-cases";
const out = resolve(process.argv[2]!);
mkdirSync(out, { recursive: true });
const REPO = resolve(import.meta.dir, "../../..");
const RUNS = process.env.OIKOS_RUNS ?? "/Users/clawd/oikos/runs";
const V3 = join(RUNS, "translator-v3-2026-10-25");
const J14 = join(RUNS, "translator-round-3-2026-10-14/step4/joined-14");
const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
let seed = 20261025;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
const shuffle = <T>(xs: T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
const nameOf = (line: string) => /^- ([^,]+),/.exec(line)?.[1] ?? "";
function specOf(line: string): any {
  const m = /^- ([^,]+), to=([^,]+), id ([^\s:]+)/.exec(line);
  if (!m) return undefined;
  const fields: any = {};
  const f = line.indexOf(": fields ");
  if (f >= 0) for (const x of line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)) {
    const req = /, required$/.test(x[2]!), t = x[2]!.replace(/, required$/, "");
    fields[x[1]!] = t.startsWith("one of ") ? { type: "choice", options: t.slice(7).split(" | "), ...(req ? { required: true } : {}) } : { type: t, ...(req ? { required: true } : {}) };
  }
  return { form: m[1], to: m[2], id: m[3], fields };
}
const valid = (e: any): any | undefined => {
  try {
    const p = calls.parseProgram(e.program);
    if (!("none" in p) && calls.contractErrors(p).length) return undefined;
    const spans = e.spans ?? withImplied(spansIn(e.request, e.program, e.forms.map(specOf).filter(Boolean)), e.program, e.forms);
    const x = { ...e, spans };
    return cardRows(x) ? x : undefined;
  } catch { return undefined; }
};
const report: any = { counts: {} };
const count = (k: string, n = 1) => (report.counts[k] = (report.counts[k] ?? 0) + n);

// ---- base
let train = jl(join(J14, "train.jsonl")), validation = jl(join(J14, "validation.jsonl"));
const validationReal = jl(join(J14, "validation-real.jsonl"));
count("base train", train.length); count("base validation", validation.length);

// ---- the forms of real tests and of the written targets: never kept out
const keep = new Set<string>();
// (As the script ran in round v3, untyped: FORMS holds records, so this keeps nothing by name; kept as it ran.)
for (const lines of Object.values(FORMS) as unknown as string[][]) for (const l of lines) keep.add(nameOf(l));
const pilotLines: { [form: string]: string[] } = JSON.parse(readFileSync(join(V3, "pilot-form-lines.json"), "utf8"));
for (const k of Object.keys(pilotLines)) keep.add(k);
const allPilotLines = Object.values(pilotLines).flat();

// ---- written examples, with distractors
const written: any[] = [];
for (const f of ["written-a.jsonl", "written-b.jsonl", "written-c.jsonl"]) for (const w of jl(join(V3, "gen", f))) {
  const own = w.form_line ? [w.form_line] : [];
  const office = /, to=([^,]+),/.exec(w.form_line ?? "")?.[1];
  const near = allPilotLines.filter((l) => l !== w.form_line && office && l.includes(`, to=${office},`));
  const others = shuffle([...shuffle(near).slice(0, 3), ...shuffle(allPilotLines.filter((l) => nameOf(l) !== nameOf(w.form_line ?? "-"))).slice(0, 2 + Math.floor(rand() * 5))]);
  const forms = shuffle([...own, ...others.filter((l, i) => others.indexOf(l) === i)]);
  const e = valid({ id: `gen-${f.slice(8, 9)}-${written.length}`, request: w.request, forms, program: w.program, kind: "positive", origin: "generated", source: "v3 written", style: w.style, groups: { part: "v3 written", writer: "claude-sonnet-5-5 (subagent, template script)", source: "v3 written" } });
  if (!e) { count("written: not valid (contract, spans or two passes)"); continue; }
  written.push(e);
}
count("written valid", written.length);
const wv = written.filter((_, i) => i % 10 === 0), wt = written.filter((_, i) => i % 10 !== 0);
train.push(...wt); validation.push(...wv);

// ---- the train pilots' audited-right requests, four times (as round 3 weighted real requests)
const pilot = jl(join(V3, "data/pilot-train.jsonl"));
for (let k = 0; k < 4; k++) train.push(...pilot.map((e) => ({ ...e, id: `${e.id}#${k}` })));
count("pilot rows (x4)", pilot.length * 4);

// ---- unseen forms: kept out entirely
const filledIn = (e: any) => [...String(e.program).matchAll(/\bform=([\w.-]+)/g)].map((m) => m[1]!);
const names = [...new Set(train.flatMap(filledIn))].filter((n) => !keep.has(n)).sort();
const uf = new Set(shuffle(names).slice(0, Math.round(names.length * 0.15)));
report.unseen_forms = [...uf].sort();
const ufRows: any[] = [];
const perForm = new Map<string, number>();
const strip = (e: any) => ({ ...e, forms: e.forms.filter((l: string) => !uf.has(nameOf(l))) });
const keepRow = (e: any, side: string) => {
  const f = filledIn(e);
  if (f.some((n) => uf.has(n))) {
    const n = f.find((x) => uf.has(x))!;
    if ((perForm.get(n) ?? 0) < 12) { perForm.set(n, (perForm.get(n) ?? 0) + 1); ufRows.push(e); }
    count(`unseen-form rows out of ${side}`);
    return false;
  }
  return true;
};
train = train.filter((e) => keepRow(e, "train")).map(strip);
validation = validation.filter((e) => keepRow(e, "validation")).map(strip);
count("validation-uf", ufRows.length);

// ---- renamed twins
const table = JSON.parse(readFileSync(join(V3, "renaming/table.json"), "utf8"));
const words = (n: string) => n.replace(/_/g, " ");
const reWord = (n: string) => new RegExp(`(?<![A-Za-z0-9_])${words(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ _]")}(?![A-Za-z0-9_])`, "gi");
function renamed(e: any): any | undefined {
  const fs = new Map<string, string>(), fl = new Map<string, string>();
  const lines = e.forms.map((l: string) => {
    const name = nameOf(l);
    if (!table.forms[name]) return l;
    if (!fs.has(name)) fs.set(name, pick(table.forms[name]));
    const f = l.indexOf(": fields ");
    const head = l.slice(0, f < 0 ? l.length : f).replace(`- ${name},`, `- ${fs.get(name)},`);
    if (f < 0) return head;
    const fields = [...l.slice(f + 9).matchAll(/([^\s,()]+) (\([^)]*\))/g)].map((m) => {
      const k = m[1]!;
      if (!fl.has(k) && table.fields[k]) fl.set(k, pick(table.fields[k]));
      return `${fl.get(k) ?? k} ${m[2]}`;
    });
    return `${head}: fields ${shuffle(fields).join(", ")}`;
  });
  // (A field renamed to a name the same form has already: not this row.)
  for (const l of lines) { const n = [...l.matchAll(/([^\s,()]+) \(/g)].map((m: any) => m[1]); if (new Set(n).size !== n.length) return undefined; }
  let program = String(e.program), request = String(e.request);
  for (const [a, b] of fs) { program = program.replace(new RegExp(`\\bform=${a}\\b`, "g"), `form=${b}`); request = request.replace(reWord(a), words(b)); }
  // Field names: only inside form(...) calls, as argument names.
  program = program.replace(/form\(([^]*?)\)(?=\s*$|\n)/g, (whole: string) => whole.replace(/([(,]\s*)([a-z_][a-z0-9_]*)=/g, (m: string, pre: string, k: string) => (k === "form" || k === "to" || !fl.has(k) ? m : `${pre}${fl.get(k)}=`)));
  for (const [a, b] of fl) if (a.length > 3) request = request.replace(reWord(a), words(b));
  return valid({ ...e, id: `${e.id}~r`, request, forms: lines, program, spans: undefined, groups: { ...(e.groups ?? {}), twin: "renamed" } });
}
const twins: any[] = [];
for (const e of train) if (/\bform\(/.test(e.program) && rand() < 0.5) { const r = renamed(e); r ? twins.push(r) : count("renamed: twin not valid"); }
count("renamed twins", twins.length);

// ---- names twins
const profiles = ["gb-eng", "us-oh", "de-ni", "mx-jal", "jp-akita", "in-tn", "au-vic", "ke-nakuru", "br-mg"];
const pools = profiles.map((p) => {
  const P = JSON.parse(readFileSync(join(REPO, `worlds/profiles/${p}-2026.json`), "utf8"));
  const N = P.values?.names;
  if (!N) return undefined;
  const given = [...new Set([...(N.given?.male ?? []), ...(N.given?.female ?? [])].flatMap((c: any) => c.names.map((x: any) => x.name)))];
  const family = [...new Set((N.family?.all ?? []).map((x: any) => x.name))].filter(Boolean);
  return given.length && family.length ? { order: N.customs?.order ?? "given_first", two: N.customs?.family_name_from === "both", given, family } : undefined;
}).filter(Boolean) as any[];
report.name_pools = pools.length;
function named(e: any): any | undefined {
  const ids = [...new Set([...String(e.request).matchAll(/(?<![\w.-])(c\d{3,5})(?![\w.-])/g)].map((m) => m[1]!))];
  if (!ids.length || !pools.length) return undefined;
  const pool = pick(pools);
  let request = String(e.request), program = String(e.program);
  for (const id of ids) {
    const fam = pool.two ? `${pick(pool.family)} ${pick(pool.family)}` : pick(pool.family);
    const name = pool.order === "family_first" ? `${fam} ${pick(pool.given)}` : `${pick(pool.given)} ${fam}`;
    request = request.split(id).join(name);
    program = program.replace(new RegExp(`=${id}(?![\\w.-])`, "g"), `=${JSON.stringify(name)}`).replace(new RegExp(`"${id}"`, "g"), JSON.stringify(name));
  }
  return valid({ ...e, id: `${e.id}~n`, request, program, spans: undefined, groups: { ...(e.groups ?? {}), twin: "names" } });
}
const namesTwins: any[] = [];
for (const e of train) if (rand() < 0.2) { const n = named(e); if (n) namesTwins.push(n); }
count("names twins", namesTwins.length);
train.push(...twins, ...namesTwins);

// ---- leak check
const held = loadHeldOut();
const shares = held ? sharesWording(held) : () => false;
const tests = new Set<string>([...PILOT_CASES.map((c: any) => c.request.trim()), ...jl(join(V3, "data/rr-requests.jsonl")).map((c) => c.request.trim())]);
const leak = (e: any) => tests.has(String(e.request).trim()) || shares(String(e.request));
const before = train.length;
train = train.filter((e) => !leak(e));
validation = validation.filter((e) => !leak(e));
count("leak: dropped from train", before - train.length);
report.held_out_checked_by_code = !!held;

const w = (f: string, xs: any[]) => writeFileSync(join(out, f), xs.map((e) => JSON.stringify(e)).join("\n") + "\n");
w("train.jsonl", shuffle(train)); w("validation.jsonl", validation); w("validation-real.jsonl", validationReal); w("validation-uf.jsonl", ufRows);
report.rows = { train: train.length, validation: validation.length, validation_real: validationReal.length, validation_uf: ufRows.length, unseen_forms: uf.size };
writeFileSync(join(out, "manifest.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, unseen_forms: undefined }, null, 1));
