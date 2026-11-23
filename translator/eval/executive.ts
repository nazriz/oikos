// How today's translator (the served model and the rules of this checkout) does on a mayor's powers: the evaluation
// set (executive-cases.ts) and the real requests of the mayor, councillors and clerk, by act (docs/decisions.md,
// "The translator on a mayor's powers"). Offline: our own model, no key, no spend; read-only on the runs.
//
//   bun translator/eval/executive.ts --cache <file.jsonl> [--real <extract.json.gz>] [--list]
//
// The model's answers are kept in the cache, so a change to the rules is scored without asking it again. A request
// not in the cache is asked of the model (the folder is OIKOS_DECIDE_DIR, by default the one served.json names).
//
// Outcomes: `right`; `wrong` (a draft offered that is not what was asked: a confident error, the study's worst kind);
// `declined` (no draft offered: with a translator behind it, this is what would go there). `would be right` counts the
// declined whose withheld draft was in fact right.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { calls } from "@oikos/participants";
import { DecideAdapter } from "../model/adapter";
import SERVED from "../model/served.json";
import { formShownTo } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { resolve } from "../src/resolver";
import * as R from "../src/rules";
import { EXEC_CASES, FIXTURE, MAYOR_FORMS } from "./executive-cases";
import { canon, expand, withKnowledge, type CompactArm } from "./requests";

/** Arguments a draw may hold beyond those wanted, which say nothing about whether it does what was asked. */
const SETTLED_ELSEWHERE = new Set(["role", "visible", "kind", "memo", "re", "channels", "basis", "for", "affects", "first"]);

/** A value as compared: free words not at all, figures by their digits, ids as written. */
function valueKey(v: calls.Value | undefined): string {
  if (!v) return "";
  if ("id" in v) return v.id.toLowerCase();
  if ("text" in v) {
    const t = v.text.trim();
    const digits = t.replace(/[.,]00\b/g, "").replace(/[^0-9]/g, "");
    if (digits && t.length <= 24) return `#${digits.replace(/^0+(?=\d)/, "")}`;
    return /\s/.test(t) ? "(words)" : t.toLowerCase();
  }
  return JSON.stringify("json" in v ? v.json : v);
}
const isWords = (v: calls.Value) => "text" in v && valueKey(v) === "(words)";

/** Whether a drawn program does what the wanted one says, by the rule at the top of executive-cases.ts. */
export function matches(drawn: calls.Program, want: calls.Program): boolean {
  if (!("lines" in drawn) || !("lines" in want) || drawn.lines.length !== want.lines.length) return false;
  const left = [...drawn.lines];
  for (const w of want.lines) {
    const i = left.findIndex((d) => {
      if (d.call.fn !== w.call.fn) return false;
      for (const [k, v] of Object.entries(w.call.args)) {
        const got = d.call.args[k];
        if (!got) return false;
        if (!isWords(v) && valueKey(got) !== valueKey(v)) return false;
      }
      return Object.entries(d.call.args).every(([k, v]) => k in w.call.args || SETTLED_ELSEWHERE.has(k) || isWords(v));
    });
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** The mayor of the fixture: its post, whom it knows of, the papers it holds and the forms it is shown. */
export function fixtureKnowledge(): Knowledge {
  const k = new Knowledge({ code: "XXX", symbol: "$", minor_units: 2, decimal_mark: ".", group_mark: ",", unit_words: ["dollar", "dollars"], minor_words: ["cent", "cents"] } as any);
  const forms = MAYOR_FORMS.map((line) => {
    const [form, office, ...fs] = line.split("|") as [string, string, ...string[]];
    const fields = Object.fromEntries(fs.map((x) => {
      const [name, type, req] = x.split(":") as [string, string, string?];
      const options = type.includes("/") ? type.split("/") : undefined;
      return [name, { type: options ? "choice" : type, ...(options ? { options } : {}), ...(req ? { required: true } : {}) }];
    }));
    return { id: `form-${form.replace(/_/g, "-")}`, record: "statement", kind: "form", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", text: form.replace(/_/g, " "), data: { form, office, fields } };
  });
  const papers = Object.entries(FIXTURE.records).map(([id, kind]) => ({ id, record: "statement", kind, author: "mayor", at: 1, visible_to: "public", speaks_for: "city", text: `${kind} on file` }));
  k.absorb({
    t: 100, entity: "mayor-person", positions: [{ position: "mayor", entity: "city", title: "Mayor" }],
    channels: [
      { kind: "directory", entities: Object.entries({ ...FIXTURE.people, ...FIXTURE.bodies }).map(([entity, name]) => ({ entity, name })), positions: FIXTURE.posts.map((position) => ({ position, entity: "city", title: position })) },
      { kind: "records", path: "papers", records: [...forms, ...papers] },
    ],
  } as any);
  return k;
}

type Draw = { program: string; wrote?: string; sure: number; withheld?: string };
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const key = (request: string, forms: string[]) => new Bun.CryptoHasher("sha256").update(JSON.stringify([request, forms])).digest("hex").slice(0, 24);

/** The program as the rules leave it, or undefined where they ask back. */
function ruledOf(text: string, request: string, k: Knowledge): calls.Program | undefined {
  try {
    const fr = R.formRules(calls.parseProgram(text), request, k, R.recordTest(k));
    if (R.misread(fr, request, k)) return undefined;
    const ru = R.ruled(fr, request, R.recordTest(k));
    return ru.ok ? ru.program : undefined;
  } catch { return undefined; }
}
const effect = (p: calls.Program, k: Knowledge) => { const r = resolve(p, k, () => undefined, [...k.held][0], { written: true }); return r.ok ? JSON.stringify(r.blocks) : undefined; };

type Tally = { n: number; right: number; wrong: number; declined: number; wouldBe: number };
const blank = (): Tally => ({ n: 0, right: 0, wrong: 0, declined: 0, wouldBe: 0 });

function outcome(d: Draw, request: string, k: Knowledge, isRight: (p: calls.Program) => boolean): "right" | "wrong" | "declined" | "wouldBe" {
  const p = ruledOf(d.program, request, k);
  if (p && "lines" in p) return isRight(p) ? "right" : "wrong";
  const w = d.wrote ? ruledOf(d.wrote, request, k) : undefined;
  return w && "lines" in w && isRight(w) ? "wouldBe" : "declined";
}
function add(t: Tally, o: ReturnType<typeof outcome>) {
  t.n++;
  if (o === "wouldBe") { t.declined++; t.wouldBe++; } else t[o]++;
}

if (import.meta.main) {
  const cacheFile = flag("--cache");
  if (!cacheFile) { console.error("usage: bun translator/eval/executive.ts --cache <file.jsonl> [--real <extract.json.gz>] [--list]"); process.exit(2); }
  const list = argv.includes("--list");
  const cache = new Map<string, Draw>();
  if (existsSync(cacheFile)) for (const l of readFileSync(cacheFile, "utf8").split("\n")) if (l) { const x = JSON.parse(l); cache.set(x.key, x.draw); }
  let adapter: DecideAdapter | undefined;
  const drawOf = async (request: string, forms: string[]): Promise<Draw> => {
    const h = key(request, forms);
    const had = cache.get(h);
    if (had) return had;
    if (!adapter) {
      const dir = process.env.OIKOS_DECIDE_DIR ?? join(homedir(), "oikos", (SERVED as any)["round3-s2"].folder);
      adapter = new DecideAdapter("round3-s2", { dir, first: true, quiet: true });
      await adapter.ready();
    }
    const x = await adapter.translate(request, forms);
    const draw: Draw = { program: x.program, ...(x.wrote ? { wrote: x.wrote } : {}), sure: x.sure, ...(x.withheld ? { withheld: x.withheld } : {}) };
    cache.set(h, draw);
    appendFileSync(cacheFile, `${JSON.stringify({ key: h, draw })}\n`);
    return draw;
  };
  const print = (title: string, m: Map<string, Tally>) => {
    console.log(`\n${title}\n| act | n | right | wrong (offered) | declined | of them, withheld draft right |\n|---|---|---|---|---|---|`);
    const all = blank();
    for (const [a, t] of [...m].sort()) { console.log(`| ${a} | ${t.n} | ${t.right} | ${t.wrong} | ${t.declined} | ${t.wouldBe} |`); for (const f of ["n", "right", "wrong", "declined", "wouldBe"] as const) all[f] += t[f]; }
    console.log(`| all | ${all.n} | ${all.right} | ${all.wrong} | ${all.declined} | ${all.wouldBe} |`);
  };

  const k = fixtureKnowledge();
  const shown = k.forms.map((f) => formShownTo(f, k.held));
  const byAct = new Map<string, Tally>();
  for (const c of EXEC_CASES) {
    const d = await drawOf(c.request, shown);
    const want = calls.parseProgram(c.want);
    const o = outcome(d, c.request, k, (p) => matches(p, want));
    add(byAct.get(c.act) ?? (byAct.set(c.act, blank()), byAct.get(c.act)!), o);
    if (list && o !== "right") console.log(`${o} ${c.id}: ${c.request.slice(0, 90)}\n   drew: ${(d.wrote ?? d.program).slice(0, 170)} [${d.withheld ?? "offered"} ${d.sure.toFixed(3)}]`);
  }
  print(`Evaluation set (${EXEC_CASES.length} cases)`, byAct);

  const real = flag("--real");
  if (real) {
    const arms = (JSON.parse(gunzipSync(readFileSync(real)).toString()) as CompactArm[]).map(expand);
    const acts = new Map<string, Tally>();
    let unscored = 0;
    for (const a of arms) for (const [r, kn] of withKnowledge(a)) {
      if (r.decision !== "accept" || !r.call) { unscored++; continue; }
      const forms = kn.forms.map((f) => formShownTo(f, kn.held));
      const d = await drawOf(r.request, forms);
      const target = calls.parseProgram(r.call);
      const first = "lines" in target ? target.lines[0]!.call : undefined;
      const act = !first ? "none" : first.fn === "form" ? `form:${valueKey(first.args.form)}` : first.fn === "statement" && first.args.withdraw ? "statement:withdraw" : first.fn;
      const want = effect(target, kn);
      const o = outcome(d, r.request, kn, (p) => canon(calls.programText(p)) === canon(r.call!) || matches(p, target) || (want !== undefined && effect(p, kn) === want));
      add(acts.get(act) ?? (acts.set(act, blank()), acts.get(act)!), o);
      if (list && o === "wrong") console.log(`wrong ${a.run} ${r.ref}: ${r.request.slice(0, 100)}\n   drew: ${d.program.slice(0, 150)}\n   want: ${r.call.slice(0, 150)}`);
    }
    print(`Real requests the seat confirmed (mayor, councillors, clerk); ${unscored} declined or unanswered have no target and are not scored`, acts);
  }
  adapter?.close();
  process.exit(0);
}
