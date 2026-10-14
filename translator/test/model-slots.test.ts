// Slot-by-slot decoding (translator/model/encode.ts, "Slot by slot"; py/slots.py): code lists what there is to decide,
// the model decides each slot once. Held here: a program comes back exactly from its decisions (every kind of value,
// and every example the pipeline's own generator makes), as pieces too; a call cannot end early and a program cannot
// (there is nothing to end them with); an argument the contract requires cannot be left out, and a form's required
// field can (the answer then says which it lacks); a field a form's line does not list cannot be written; the rule is the same in the trainer's language; and a model of the earlier decoding is read
// as it always was.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { cannotSay, decodingOf, formsMisfit, programOf, vocabularyOf } from "../model/adapter";
import { decode, decodeSlots, encode, formsIn, grammar, LEFT_OUT, lineOf, NotEncodable, PROGRAM, programFrom, slotsOf, vocabulary, type Span, type Step } from "../model/encode";
import { pieces, row, stepsOf } from "../model/export";
import { papers, directions, synthetic } from "../train/synthetic";
import { formLine, spansIn } from "../train/data";

const at = (request: string, value: string, from = 0): [number, number] => {
  const i = request.indexOf(value, from);
  if (i < 0) throw new Error(`${value} is not in the request`);
  return [i, i + value.length];
};
const canonical = (p: string) => calls.programText(calls.parseProgram(p));
type Case = { request: string; forms: string[]; program: string; spans: Span[] };
const slots = (c: Case) => encode(c, "name", "slots");
/** A decision as it reads: a choice's name, or the characters a span copies. */
const read = (input: string, steps: Step[]) => steps.map((s) => (typeof s === "string" ? s : input.slice(s[1], s[2])));

const FORMS = [
  "- rental_listing, to=housing, id form-a: fields rent (amount)",
  "- budget_proposal, to=pos.41, id form-b: fields year (text, required), works (amount), staff (amount), reserve (amount), note (text)",
  "- budget_proposal, to=pos.77, id form-c: fields year (text, required), parks (amount)",
];

function cases(): Case[] {
  const out: Case[] = [];
  let r = "Pay c0412 $1,200.90 from acc-city for the fence, starting now and then every 14 days.";
  out.push({ request: r, forms: [], program: 'money(amount="$1,200.90", every="every 14 days", first="0 days", for="the fence", from=acc-city, to=c0412)', spans: [
    { arg: "amount", value: "$1,200.90", how: "copy", at: at(r, "$1,200.90") }, { arg: "every", value: "every 14 days", how: "copy", at: at(r, "every 14 days") },
    { arg: "first", value: "0 days", how: "implied" }, { arg: "for", value: "the fence", how: "copy", at: at(r, "the fence") },
    { arg: "from", value: "acc-city", how: "copy", at: at(r, "acc-city") }, { arg: "to", value: "c0412", how: "copy", at: at(r, "c0412") }] });
  r = "c0053 and c0108 are to do 6 units of build at builder-yard.";
  out.push({ request: r, forms: [], program: 'work(at=builder-yard, by=["c0053","c0108"], task=build, units="6")', spans: [
    { arg: "at", value: "builder-yard", how: "copy", at: at(r, "builder-yard") }, { arg: "by", value: "c0053", how: "copy", at: at(r, "c0053") }, { arg: "by", value: "c0108", how: "copy", at: at(r, "c0108") },
    { arg: "task", value: "build", how: "choice", at: at(r, "build") }, { arg: "units", value: "6", how: "copy", at: at(r, "6") }] });
  r = "Set up a union called Under Bridge Union, and record that it is free to demolish shop-105.";
  out.push({ request: r, forms: [], program: 'v1 = entity(kind=union, name="Under Bridge Union")\nclaim(about={"action":"demolish","object":"shop-105"}, holder=v1, position=liberty)', spans: [
    { arg: "kind", value: "union", how: "choice", line: 0, at: at(r, "union") }, { arg: "name", value: "Under Bridge Union", how: "copy", line: 0, at: at(r, "Under Bridge Union") },
    { arg: "about.action", value: "demolish", how: "choice", line: 1, at: at(r, "demolish") }, { arg: "about.object", value: "shop-105", how: "copy", line: 1, at: at(r, "shop-105") },
    { arg: "position", value: "liberty", how: "implied", line: 1 }] });
  r = "Offer ent.24 a membership agreement: they pay $60 per month into acc-union.";
  out.push({ request: r, forms: [], program: 'agreement(template=membership, they_do=money(amount="$60", every="per month", to=acc-union), with=ent.24)', spans: [
    { arg: "template", value: "membership", how: "choice", at: at(r, "membership") }, { arg: "they_do.amount", value: "$60", how: "copy", at: at(r, "$60") },
    { arg: "they_do.every", value: "per month", how: "copy", at: at(r, "per month") }, { arg: "they_do.to", value: "acc-union", how: "copy", at: at(r, "acc-union") }, { arg: "with", value: "ent.24", how: "copy", at: at(r, "ent.24") }] });
  r = "Put in the budget proposal for year 3 to pos.41: staff $41,000.";
  out.push({ request: r, forms: FORMS, program: 'form(form=budget_proposal, staff="$41,000", to=pos.41, year="year 3")', spans: [
    { arg: "form", value: "budget_proposal", how: "choice", at: at(r, "budget proposal") }, { arg: "staff", value: "$41,000", how: "copy", at: at(r, "$41,000") },
    { arg: "to", value: "pos.41", how: "copy", at: at(r, "pos.41") }, { arg: "year", value: "year 3", how: "copy", at: at(r, "year 3") }] });
  r = "Under permit rec.512 and the council's resolution rec.498, have builder put up a hall on lot-02 for $410,000 from acc-city. Then post a notice that says so, resting on rec.498 and rec.512.";
  out.push({ request: r, forms: FORMS, program: 'structure(basis=["rec.512","rec.498"], by=builder, from=acc-city, on=lot-02, price="$410,000", type=hall)\nstatement(basis=["rec.498","rec.512"], kind=notice, text="so")', spans: [
    { arg: "basis", value: "rec.512", how: "copy", line: 0, at: at(r, "rec.512") }, { arg: "basis", value: "rec.498", how: "copy", line: 0, at: at(r, "rec.498") },
    { arg: "by", value: "builder", how: "copy", line: 0, at: at(r, "builder") }, { arg: "from", value: "acc-city", how: "copy", line: 0, at: at(r, "acc-city") }, { arg: "on", value: "lot-02", how: "copy", line: 0, at: at(r, "lot-02") },
    { arg: "price", value: "$410,000", how: "copy", line: 0, at: at(r, "$410,000") }, { arg: "type", value: "hall", how: "choice", line: 0, at: at(r, "hall") },
    { arg: "basis", value: "rec.498", how: "copy", line: 1, at: at(r, "rec.498", r.indexOf("resting")) }, { arg: "basis", value: "rec.512", how: "copy", line: 1, at: at(r, "rec.512", r.indexOf("resting")) },
    { arg: "kind", value: "notice", how: "choice", line: 1, at: at(r, "notice") }, { arg: "text", value: "so", how: "copy", line: 1, at: at(r, "so", r.indexOf("says")) }] });
  out.push({ request: "Make the board approve the plan.", forms: FORMS, program: "none(not_yours)", spans: [] });
  return out;
}

test("a program comes back exactly from its slot decisions: ids, text, a word, an implied value, a list, data, a nested call, a variable, a form, a refusal; as pieces too", () => {
  for (const c of cases()) {
    const e = slots(c);
    expect(decodeSlots(e.input, e.steps)).toBe(canonical(c.program));
    const r = row("x", "positive", e)!;
    expect(decodeSlots(e.input, stepsOf(r, r.steps))).toBe(canonical(c.program));
    // Nothing names an argument, closes a call or ends the program: there is no such decision to get wrong.
    for (const s of e.steps) if (typeof s === "string") expect(/^(arg:|\)$|eos$)/.test(s)).toBe(false);
    for (const s of e.steps) if (typeof s !== "string") expect(s[0]).not.toBe("field");
  }
  // The closed set: the kind of answer, the number of lines, left out, and the values the other decoding has too.
  const closed = vocabulary(cases().map(slots));
  for (const s of closed) expect(/^(fn|none|bind|var|const|key|lines):|^[\[\]{}-]$|^program$/.test(s)).toBe(true);
  expect(closed).toContain("lines:2");
});

test("the decisions of a payment and of a form, one by one: the contract's order, and the form's own", () => {
  const [pay, , , , form] = cases();
  const e = slots(pay!);
  // money's slots as the contract lists them: to, amount, from, every, first, for, settles, basis, per_request, line
  // (`line` taught from 2026-10-14: a model trained before has nine, and decodes by its own grammar: below).
  expect([...calls.ARGS.money!.allowed!]).toEqual(["to", "amount", "from", "every", "first", "for", "settles", "basis", "per_request", "line"]);
  expect(read(e.input, e.steps)).toEqual([PROGRAM, "lines:1", "fn:money", "c0412", "$1,200.90", "acc-city", "every 14 days", 'const:"0 days"', "the fence", LEFT_OUT, LEFT_OUT, LEFT_OUT, LEFT_OUT]);
  // A form: form, to, then the fields of the line it names and goes to (the second of the two budget proposals is
  // another office's, with other fields), in that line's order: year, works, staff, reserve, note.
  const f = slots(form!);
  expect(read(f.input, f.steps)).toEqual([PROGRAM, "lines:1", "fn:form", "budget proposal", "pos.41", "year 3", LEFT_OUT, "$41,000", LEFT_OUT, LEFT_OUT]);
  const lines = formsIn(f.input);
  expect(lines.length).toBe(3);
  expect(lineOf(lines, "budget_proposal", "pos.77")!.fields.map((x) => x.name)).toEqual(["year", "parks"]);
  expect(lineOf(lines, "form-c", undefined)!.fields.map((x) => x.name)).toEqual(["year", "parks"]);
  expect(lineOf(lines, "budget_proposal", undefined)!.fields.map((x) => [x.name, x.required])).toEqual([["year", true], ["works", false], ["staff", false], ["reserve", false], ["note", false]]);
  expect(slotsOf("form", lines, "budget_proposal", "pos.41").map((s) => s.name)).toEqual(["form", "to", "year", "works", "staff", "reserve", "note"]);
  expect(slotsOf("form", lines, "no_such_form", "pos.41").map((s) => s.name)).toEqual(["form", "to"]);
  // Each field's place is its name in the line.
  for (const x of lines.flatMap((l) => l.fields)) expect(f.input.slice(x.at[0], x.at[1])).toBe(x.name);
});

test("a call cannot end early and a program cannot: too few decisions, or too many, are no program", () => {
  const two = slots(cases()[5]!);
  expect(two.steps[1]).toBe("lines:2");
  // Every line but the last says whether its result is named: here not.
  expect(two.steps[2]).toBe(LEFT_OUT);
  for (let n = 1; n < two.steps.length; n++) expect(() => decodeSlots(two.input, two.steps.slice(0, n))).toThrow(NotEncodable);
  expect(() => decodeSlots(two.input, [...two.steps, LEFT_OUT])).toThrow(NotEncodable);
  // Said to be one line, the same decisions are one line and then too many.
  expect(() => decodeSlots(two.input, [PROGRAM, "lines:1", ...two.steps.slice(3)])).toThrow(NotEncodable);
  // The other decoding's marks mean nothing here.
  expect(() => decodeSlots("Pay c0412 $5.", [PROGRAM, "lines:1", "fn:money", ["id", 4, 9], ["text", 10, 12], ")", "eos"])).toThrow(NotEncodable);
  // A name is used only after the line that binds it, and bound once; the last line binds nothing.
  const bound = slots(cases()[2]!);
  expect(bound.steps.slice(0, 4)).toEqual([PROGRAM, "lines:2", "bind:v1", "fn:entity"]);
  const use = bound.steps.indexOf("var:v1");
  expect(use).toBeGreaterThan(0);
  expect(() => decodeSlots(bound.input, bound.steps.map((s, i) => (i === 2 ? LEFT_OUT : s)))).toThrow("before it is bound");
  expect(() => encode({ request: "x", forms: [], program: "v1 = system(retire=sys-1)", spans: [{ arg: "retire", value: "sys-1", how: "implied" }] }, "name", "slots")).toThrow(NotEncodable);
});

test("an argument the contract requires cannot be left out; a form's required field can, and the answer then says which", () => {
  const input = "Pay c0412 $5.";
  // money needs to and amount (the contract): the first two slots.
  const whole: Step[] = [PROGRAM, "lines:1", "fn:money", ["id", 4, 9], ["text", 10, 12], ...Array(8).fill(LEFT_OUT)];
  expect(decodeSlots(input, whole)).toBe('money(amount="$5", to=c0412)');
  const without: Step[] = whole.map((s, i) => (i === 4 ? LEFT_OUT : s));
  expect(() => decodeSlots(input, without)).toThrow("money needs amount");
  // As a model's answer over pieces: no program, so it asks back. (In the other decoding the same call is offered,
  // and whoever resolves it asks for the amount.)
  const ps = pieces(input);
  expect(programOf(input, ps, [PROGRAM, "lines:1", "fn:money", ["id", 1, 1], LEFT_OUT, ...Array(8).fill(LEFT_OUT)], "slots")).toBe("none(unclear)");
  expect(programOf(input, ps, [PROGRAM, "lines:1", "fn:money", ["id", 1, 1], ["text", 2, 3], ...Array(8).fill(LEFT_OUT)], "slots")).toBe('money(amount="$5", to=c0412)');
  expect(programOf(input, ps, ["fn:money", "arg:to", ["id", 1, 1], ")", "eos"])).toBe("money(to=c0412)");
  expect(programOf(input, ps, ["none:not_yours"], "slots")).toBe("none(not_yours)");
  // A form must say which form (the contract).
  const c = cases()[4]!;
  const e = slots(c);
  expect(() => decodeSlots(e.input, [PROGRAM, "lines:1", "fn:form", LEFT_OUT, LEFT_OUT])).toThrow("form needs form");
  // A form's own required field, as its line says (year), may be left out: the request may not give it, and nothing
  // is made up to fill it. The decisions are a program, with the field it lacks noted.
  const year = e.steps.findIndex((s) => typeof s !== "string" && e.input.slice(s[1], s[2]) === "year 3");
  const left = e.steps.map((s, i) => (i === year ? LEFT_OUT : s));
  const lacks: { form: string; field: string }[] = [];
  expect(decodeSlots(e.input, left, { lacks })).toBe('form(form=budget_proposal, staff="$41,000", to=pos.41)');
  expect(lacks).toEqual([{ form: "budget_proposal", field: "year" }]);
  const none: { form: string; field: string }[] = [];
  decodeSlots(e.input, e.steps, { lacks: none });
  expect(none).toEqual([]);
  // The label that leaves it out is those same decisions.
  const label = encode({ ...c, program: 'form(form=budget_proposal, staff="$41,000", to=pos.41)', spans: c.spans.filter((s) => s.arg !== "year") }, "name", "slots");
  expect(label.steps).toEqual(left);
  // As an answer it is not offered as a draft: the participant is told which field the form still lacks.
  const r = row("x", "positive", label)!;
  const program = programOf(label.input, pieces(label.input), r.steps, "slots");
  expect(program).toBe('form(form=budget_proposal, staff="$41,000", to=pos.41)');
  expect(formsMisfit(program, c.forms)).toEqual({ label: "unclear", unsure: { kind: "form_needs", form: "budget_proposal", fields: ["year"] } });
});

test("a field the form's line does not list cannot be written: it has no slot", () => {
  const c = cases()[4]!;
  // parks is a field of the other office's budget proposal, not of the one this goes to.
  const r = c.request.replace("staff", "parks");
  const spans = c.spans.map((s) => (s.arg === "staff" ? { ...s, arg: "parks" } : s));
  expect(() => encode({ ...c, request: r, program: 'form(form=budget_proposal, parks="$41,000", to=pos.41, year="year 3")', spans }, "name", "slots")).toThrow("not one of the form as shown");
  // (The other decoding points at the field wherever it is shown, and writes it.)
  const other = encode({ ...c, request: r, program: 'form(form=budget_proposal, parks="$41,000", to=pos.41, year="year 3")', spans });
  expect(decode(other.input, other.steps)).toContain("parks=");
  // Whatever the decisions, a form comes back with fields of its own line only: as many values as it has slots.
  const e = slots(c);
  const own = new Set(["form", "to", "year", "works", "staff", "reserve", "note"]);
  const value = e.steps.find((s) => typeof s !== "string" && s[0] === "text")!;
  const filled = [PROGRAM, "lines:1", "fn:form", e.steps[3]!, e.steps[4]!, value, value, value, value, value];
  const p = calls.parseProgram(decodeSlots(e.input, filled)) as { lines: calls.Line[] };
  expect(Object.keys(p.lines[0]!.call.args).sort()).toEqual([...own].sort());
  expect(() => decodeSlots(e.input, [...filled, value])).toThrow(NotEncodable);
  // A form no line shows has its own two slots and no more.
  expect(decodeSlots("File the thing with pos.9.", [PROGRAM, "lines:1", "fn:form", "const:thing", ["id", 20, 25]])).toBe("form(form=thing, to=pos.9)");
  // A function has the contract's slots and no other.
  expect(() => encode({ request: "x", forms: [], program: "harm(who=c1, why=c2)", spans: [{ arg: "who", value: "c1", how: "implied" }, { arg: "why", value: "c2", how: "implied" }] }, "name", "slots")).toThrow("harm has no slot why");
});

test("every example the generator makes comes back from its slot decisions, and reads the same in both decodings", () => {
  const gold = [...synthetic({ perFunction: 40, seed: 5 }), ...directions({ n: 30, seed: 5 }), ...papers({ n: 60, seed: 5 })];
  let n = 0, forms = 0, lines = 0;
  for (const g of gold) {
    // The request: every value as it stands, so that each is a span (what the pipeline's check holds real requests to).
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
    const e = { request, forms: (g.forms ?? []).map((f) => formLine(f)), program: g.program, spans: found };
    let old: string;
    try { const x = encode(e); old = decode(x.input, x.steps); } catch { continue; }
    const s = encode(e, "name", "slots");
    expect(decodeSlots(s.input, s.steps)).toBe(old);
    expect(programFrom(s.input, s.steps, "slots")).toBe(canonical(g.program));
    const r = row("x", "positive", s);
    if (r) expect(decodeSlots(s.input, stepsOf(r, r.steps))).toBe(old);
    n++; forms += Number(g.program.startsWith("form(")); lines += Number(p.lines.length > 1);
  }
  expect(n).toBeGreaterThan(300);
  expect(forms).toBeGreaterThan(40);
  expect(lines).toBeGreaterThan(5);
});

test("the trainer's language holds the same rule: it follows every label to its end, and stops at the same decisions", () => {
  const python = Bun.which("python3");
  if (!python) return; // (No Python here: the trainer checks it over the whole export before it trains.)
  const all = cases().map(slots);
  const leftOut = all[4]!.steps.map((s, i) => (i === 5 ? LEFT_OUT : s));
  const asked = { grammar: grammar(), cases: [
    ...all.map((e) => ({ input: e.input, steps: e.steps })),
    { input: all[4]!.input, steps: leftOut },                                   // a form's required field left out: allowed
    { input: all[0]!.input, steps: all[0]!.steps.map((s, i) => (i === 4 ? LEFT_OUT : s)) }, // the contract's required amount left out: off the rule there
    { input: all[4]!.input, steps: all[4]!.steps.slice(0, -1) },                // too few
    { input: all[4]!.input, steps: [...all[4]!.steps, LEFT_OUT] },              // too many
    { input: all[2]!.input, steps: all[2]!.steps.map((s, i) => (i === 2 ? LEFT_OUT : s)) }, // a name used and never bound
  ] };
  const out = Bun.spawnSync([python, join(import.meta.dir, "../model/py/slots.py")], { stdin: Buffer.from(JSON.stringify(asked)) });
  expect(out.exitCode).toBe(0);
  const got = out.stdout.toString().trim().split("\n").map((l) => JSON.parse(l) as { fits: boolean; slots: string[]; off: number[] });
  all.forEach((e, i) => expect([i, got[i]!.fits, got[i]!.off]).toEqual([i, true, []]));
  expect(got[4]!.slots).toEqual(["kind", "lines", "fn", "arg:form", "arg:to", "field:year", "field:works", "field:staff", "field:reserve", "field:note"]);
  expect(got[0]!.slots.slice(2)).toEqual(["fn", ...[...calls.ARGS.money!.allowed!].map((a) => `arg:${a}`)]);
  const n = all.length;
  expect([got[n]!.fits, got[n]!.off]).toEqual([true, []]);
  expect([got[n + 1]!.fits, got[n + 1]!.off]).toEqual([true, [4]]);
  expect(got[n + 2]!.fits).toBe(false);
  expect(got[n + 3]!.fits).toBe(false);
  expect(got[n + 4]!.off.length).toBe(1);
  // And the other way: what the other language allows, this one reads; what it calls off the rule, this one refuses.
  expect(decodeSlots(all[4]!.input, leftOut)).toContain("form(");
  for (const k of [1, 2, 3, 4]) expect(() => decodeSlots(asked.cases[n + k]!.input, asked.cases[n + k]!.steps)).toThrow();
});

test("a model's folder says which decoding it answers in; one that says nothing is read as every model before", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-decoding-"));
  expect(decodingOf(dir)).toBe("steps");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ vocabulary: ["fn:money", "arg:to", ")", "eos"] }));
  expect(decodingOf(dir)).toBe("steps");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ vocabulary: ["fn:statement", "const:own", "none:look_first", "program", "lines:1", "-"], decoding: "slots", slots: ["kind", "lines", "bind", "fn", "field", "arg:hold", "arg:until"] }));
  expect(decodingOf(dir)).toBe("slots");
  // Its arguments are its slots: what it can say of the call language is told from them.
  expect(vocabularyOf(dir)).toContain("arg:hold");
  expect(cannotSay(vocabularyOf(dir)!)).toEqual([]);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ vocabulary: ["program"], decoding: "slots", slots: ["kind", "arg:to"] }));
  expect(cannotSay(vocabularyOf(dir)!).map(([c]) => c)).toContain("arg:hold");
});

test("a model is read by the slots it was taught: one trained before money gained `line` has nine, and its answers decode as they did", () => {
  const input = "Pay c0412 $5.";
  const taught = grammar();
  const before = { ...taught, money: { ...taught.money!, args: taught.money!.args.filter((a) => a !== "line") } };
  const nine: Step[] = [PROGRAM, "lines:1", "fn:money", ["id", 4, 9], ["text", 10, 12], ...Array(7).fill(LEFT_OUT)];
  expect(decodeSlots(input, nine, { grammar: before })).toBe('money(amount="$5", to=c0412)');
  // (Read against the contract as it stands, the same nine decisions end early.)
  expect(() => decodeSlots(input, nine)).toThrow(NotEncodable);
  expect(programFrom(input, nine, "slots", before)).toBe('money(amount="$5", to=c0412)');
  const ps = pieces(input);
  expect(programOf(input, ps, [PROGRAM, "lines:1", "fn:money", ["id", 1, 1], ["text", 2, 3], ...Array(7).fill(LEFT_OUT)], "slots", before)).toBe('money(amount="$5", to=c0412)');
});
