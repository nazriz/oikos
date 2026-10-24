// Read twice (translator v3: translator/model/encode.ts, "Read twice"; py/slots.py `Machine` modes; py/predict.py
// `two_passes`): a choose pass over the request and the forms' heads, then a fill pass for each form chosen over the
// request and that form's line. Held here: every example the generator makes splits into the two passes and joins back
// to slot by slot's own decisions, so the program is read as before; a form's implied option is pointed at in its line,
// never chosen from the closed set; each pass's input is the same in both languages; the trainer's language follows each
// pass's label to its end and keeps the forms the choose pass met where TypeScript does; and the release by kind and the
// forms' trial in the adapter and the arrangement.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { byKind, DecideAdapter, fieldTypes, probationOf, programOf, TRIAL, typesReleasedOf } from "../model/adapter";
import { chooseInput, chooseLine, decodeSlots, encode, fillInput, grammar, joinCards, splitCards, walkSlots, type Span } from "../model/encode";
import { cardRows } from "../model/export";
import { outcomesOf } from "../model/probation";
import { functionsOf, passes } from "../model/release";
import { formLine, spansIn } from "../train/data";
import { directions, papers, synthetic } from "../train/synthetic";

const canonical = (p: string) => calls.programText(calls.parseProgram(p));
const at = (request: string, value: string): [number, number] => {
  const i = request.indexOf(value);
  if (i < 0) throw new Error(`${value} is not in the request`);
  return [i, i + value.length];
};

const NEWS = "- news_item, to=editor, id form-editor-news-item: fields about_office (one of yes | no, required), edition (count, required), headline (text, required), tone (one of -1 | 0 | 1, required)";
const LISTING = "- rental_listing, to=housing, id form-a: fields rent (amount), home (space, required)";

function generated() {
  const gold = [...synthetic({ perFunction: 40, seed: 5 }), ...directions({ n: 30, seed: 5 }), ...papers({ n: 60, seed: 5 })];
  const out: { request: string; forms: string[]; program: string; spans: Span[] }[] = [];
  for (const g of gold) {
    const p = calls.parseProgram(g.program);
    if ("none" in p) continue;
    const said: string[] = [];
    const walk = (v: calls.Value) => {
      if ("id" in v) said.push(v.id); else if ("text" in v) said.push(v.text);
      else if ("call" in v) Object.values(v.call.args).forEach(walk);
      else if ("json" in v) (function j(x: unknown) { if (Array.isArray(x)) x.forEach(j); else if (x && typeof x === "object") Object.values(x).forEach(j); else said.push(String(x)); })(v.json);
    };
    for (const l of p.lines) Object.values(l.call.args).forEach(walk);
    const request = `Please see to this: ${said.join(" ; ")} .`;
    const found = spansIn(request, g.program, g.forms ?? []);
    if (!found) continue;
    out.push({ request, forms: (g.forms ?? []).map((f) => formLine(f)), program: g.program, spans: found });
  }
  return out;
}

test("every example the generator makes splits into the two passes and joins back to slot by slot's decisions", () => {
  let n = 0, fills = 0;
  for (const e of generated()) {
    let enc;
    try { enc = encode(e, "name", "cards"); } catch { continue; }
    expect(decodeSlots(enc.input, enc.steps)).toBe(canonical(e.program));
    const sp = splitCards(e.request, e.forms, enc.steps);
    expect(sp.choose.input).toBe(chooseInput(e.request, e.forms));
    expect(joinCards(e.request, e.forms, sp.choose.steps, sp.fills.map((f) => f.steps))).toEqual(enc.steps);
    // (Each pass alone is a run of decisions its own walker reads to the end.)
    expect(walkSlots(sp.choose.input, sp.choose.steps, "choose").forms.length).toBe(sp.fills.length);
    for (const f of sp.fills) walkSlots(f.input, f.steps, "fill");
    const rows = cardRows({ id: "x", kind: "positive", ...e });
    if (rows) expect(rows.length).toBe(1 + sp.fills.length);
    n++; fills += sp.fills.length;
  }
  expect(n).toBeGreaterThan(300);
  expect(fills).toBeGreaterThan(40);
});

test("the choose pass is shown heads and field names; a fill pass one form in full; an implied option is pointed at in its line", () => {
  expect(chooseLine(NEWS)).toBe("- news_item, to=editor, id form-editor-news-item: has about_office, edition, headline, tone");
  const r = "Put out edition 2 of the news with the headline \"Budget passed\", about the office, in a level tone.";
  const e = { request: r, forms: [LISTING, NEWS], program: 'form(about_office="yes", edition="2", form=news_item, headline="Budget passed", to=editor, tone="0")', spans: [
    { arg: "about_office", value: "yes", how: "implied" }, { arg: "edition", value: "2", how: "copy", at: at(r, "2") }, { arg: "form", value: "news_item", how: "implied" },
    { arg: "headline", value: "Budget passed", how: "copy", at: at(r, "Budget passed") }, { arg: "to", value: "editor", how: "implied" }, { arg: "tone", value: "0", how: "implied" }] as Span[] };
  const enc = encode(e, "name", "cards");
  // (Slot by slot chose the options from the closed set; read twice points at them where the form's line lists them.)
  expect(encode(e, "name", "slots").steps).toContain('const:"yes"');
  expect(enc.steps.filter((s) => typeof s === "string" && s.startsWith("const:"))).toEqual([]);
  const sp = splitCards(r, e.forms, enc.steps);
  expect(sp.fills.length).toBe(1);
  expect(sp.fills[0]!.input).toBe(fillInput(r, NEWS, []));
  const read = (input: string, s: (string | [string, number, number])[]) => s.map((x) => (typeof x === "string" ? x : input.slice(x[1], x[2])));
  expect(read(sp.choose.input, sp.choose.steps)).toEqual(["program", "lines:1", "fn:form", "news_item", "editor"]);
  expect(read(sp.fills[0]!.input, sp.fills[0]!.steps)).toEqual(["yes", "2", "Budget passed", "0"]);
  expect(decodeSlots(enc.input, enc.steps)).toBe(canonical(e.program));
  // A bound result is named to the fill pass.
  expect(fillInput(r, NEWS, ["v1"]).split("\n").at(-1)).toBe("Named before: v1");
});

test("each pass's input and the forms the choose pass meets are the same in the trainer's language", () => {
  const python = Bun.which("python3");
  if (!python) return;
  const cases = generated().slice(0, 400).flatMap((e) => {
    try {
      const enc = encode(e, "name", "cards");
      const sp = splitCards(e.request, e.forms, enc.steps);
      return [{ e, sp }];
    } catch { return []; }
  });
  const asked = { grammar: grammar(), cases: cases.flatMap(({ sp }) => [{ input: sp.choose.input, steps: sp.choose.steps, mode: "choose" }, ...sp.fills.map((f) => ({ input: f.input, steps: f.steps, mode: "fill" }))]) };
  const out = Bun.spawnSync([python, join(import.meta.dir, "../model/py/slots.py")], { stdin: Buffer.from(JSON.stringify(asked)) });
  expect(out.exitCode).toBe(0);
  const got = out.stdout.toString().trim().split("\n").map((l) => JSON.parse(l) as { fits: boolean; off: number[]; chosen?: [string, string, string[], number][] });
  let k = 0;
  for (const { sp } of cases) {
    const c = got[k++]!;
    expect([c.fits, c.off]).toEqual([true, []]);
    const met = walkSlots(sp.choose.input, sp.choose.steps, "choose").forms;
    expect(c.chosen!.map((x) => [x[0], x[1], x[2], x[3]])).toEqual(met.map((m) => [m.form, m.to ?? null, m.bound, m.after] as (string | number | string[])[]));
    for (const _ of sp.fills) expect([got[k]!.fits, got[k++]!.off]).toEqual([true, []]);
  }
  // The views as Python makes them (predict.py builds them from the whole input).
  const lines = [NEWS, LISTING, "- odd, to=x, id f: fields a (text), a (text), b (one of p | q)"];
  const py = Bun.spawnSync([python, "-c", `import json,sys; sys.path.insert(0, ${JSON.stringify(join(import.meta.dir, "../model/py"))}); from slots import choose_line, line_index; ls=json.loads(sys.stdin.read()); print(json.dumps([[choose_line(l) for l in ls], line_index(ls, "rental_listing", None), line_index(ls, "f", None), line_index(ls, "news_item", "nobody")]))`], { stdin: Buffer.from(JSON.stringify(lines)) });
  expect(JSON.parse(py.stdout.toString())).toEqual([lines.map(chooseLine), 1, 2, 0]);
});

test("a model that reads by name is released by kind of field and by function, and a form it was not taught goes through a trial", () => {
  expect(fieldTypes(NEWS)).toEqual(["choice", "count", "text", "choice"]);
  const dir = mkdtempSync(join(tmpdir(), "oikos-cards-"));
  expect(typesReleasedOf(dir)).toBeUndefined();
  writeFileSync(join(dir, "types-released.json"), JSON.stringify({ types_released: ["choice", "count", "text"], functions_released: ["form", "money"] }));
  const released = typesReleasedOf(dir)!;
  expect(released).toEqual({ types: ["choice", "count", "text"], functions: ["form", "money"] });
  const news = 'form(about_office="yes", edition="2", form=news_item, headline="Budget passed", to=editor, tone="0")';
  const listing = 'form(form=rental_listing, home=flat-2, rent="$400", to=housing)';
  const all = () => true, none = () => false;
  expect(byKind(news, [NEWS, LISTING], released, all)).toEqual({ trial: [] });
  expect(byKind(news, [NEWS, LISTING], released, none)).toEqual({ withheld: "probation", trial: ["news_item"] });
  // (A field of a kind not released, a function not released, or no release at all: behind, whatever the trial says.)
  expect(byKind(listing, [NEWS, LISTING], released, all).withheld).toBe("type_unreleased");
  expect(byKind("agreement(template=membership, with=c1)", [], released, all).withheld).toBe("type_unreleased");
  expect(byKind('money(amount="$1", to=c1)', [], released, all)).toEqual({ trial: [] });
  expect(byKind(news, [NEWS], undefined, all).withheld).toBe("type_unreleased");
  // The ledger: a disagreement starts a form's run again.
  writeFileSync(join(dir, "probation.jsonl"), [{ form: "news_item", agree: true }, { form: "news_item", agree: false }, { form: "news_item", agree: true }, { form: "x", agree: true }].map((x) => JSON.stringify(x)).join("\n") + "\n");
  expect([...probationOf(dir)]).toEqual([["news_item", 1], ["x", 1]]);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ decoding: "cards", vocabulary: [] }));
  const a = new DecideAdapter("t", { dir, first: true, quiet: true });
  const passed = (f: string, trained?: string[]) => (a as unknown as { passed(f: string, t?: string[]): boolean }).passed(f, trained);
  for (let i = 0; i < TRIAL - 2; i++) a.probationOutcome("news_item", true);
  expect(passed("news_item")).toBe(false);
  a.probationOutcome("news_item", true);
  expect(passed("news_item")).toBe(true);
  a.probationOutcome("news_item", false);
  expect(passed("news_item")).toBe(false);
  expect(passed("rental_listing", ["rental_listing"])).toBe(true);
  expect(programOf("x", [], [], "cards")).toBe("none(unclear)");
});

test("the mark a kind is released on, and the outcomes a run adds to a form's trial", () => {
  expect(passes({ cases: 30, right: 27, wrong: 0, missed: 3, none: 0 })).toBe(true);
  expect(passes({ cases: 29, right: 29, wrong: 0, missed: 0, none: 0 })).toBe(false); // too few
  expect(passes({ cases: 100, right: 95, wrong: 2, missed: 3, none: 0 })).toBe(false); // over 1% wrong
  expect(passes({ cases: 100, right: 89, wrong: 1, missed: 0, none: 10 })).toBe(false); // under 90% right
  expect(functionsOf('v1 = entity(kind=union, name="U")\nmessage(to=v1, text="hi")')).toEqual(["entity", "message"]);
  expect(functionsOf("none(unclear)")).toEqual([]);
  const route = (why: string, agree: boolean, decision: string) => ({ run: "r", draft: `d.${why}.${decision}`, signoff: { decision }, route: { why, agree, first: { trial: ["news_item"] } } });
  expect(outcomesOf([route("probation", true, "accept"), route("probation", false, "reject"), route("unsure", true, "accept")])).toEqual([{ form: "news_item", agree: true, run: "r", draft: "d.probation.accept" }]);
});

