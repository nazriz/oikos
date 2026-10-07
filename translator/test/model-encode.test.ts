// A program as decisions and copies (translator/model/encode.ts): every kind of value comes back exactly.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { formsMisfit, formsShown, programOf, shown } from "../model/adapter";
import { asWord, decode, encode, vocabulary, type Span } from "../model/encode";
import { pieces, row, stepsOf } from "../model/export";

const at = (request: string, value: string, from = 0): [number, number] => {
  const i = request.indexOf(value, from);
  if (i < 0) throw new Error(`${value} is not in the request`);
  return [i, i + value.length];
};
const canonical = (p: string) => calls.programText(calls.parseProgram(p));

test("a program is rebuilt exactly from choices and spans: ids, quoted text, a word chosen, an implied value, a list, data, a nested call, a variable", () => {
  const cases: { request: string; forms: string[]; program: string; spans: Span[] }[] = [];
  let r = "Pay c0412 $1,200.90 from acc-city for the fence, starting now and then every 14 days.";
  cases.push({ request: r, forms: [], program: 'money(amount="$1,200.90", every="every 14 days", first="0 days", for="the fence", from=acc-city, to=c0412)', spans: [
    { arg: "amount", value: "$1,200.90", how: "copy", at: at(r, "$1,200.90") }, { arg: "every", value: "every 14 days", how: "copy", at: at(r, "every 14 days") },
    { arg: "first", value: "0 days", how: "implied" }, { arg: "for", value: "the fence", how: "copy", at: at(r, "the fence") },
    { arg: "from", value: "acc-city", how: "copy", at: at(r, "acc-city") }, { arg: "to", value: "c0412", how: "copy", at: at(r, "c0412") }] });
  r = "c0053 and c0108 are to do 6 units of build at builder-yard.";
  cases.push({ request: r, forms: [], program: 'work(at=builder-yard, by=["c0053","c0108"], task=build, units="6")', spans: [
    { arg: "at", value: "builder-yard", how: "copy", at: at(r, "builder-yard") }, { arg: "by", value: "c0053", how: "copy", at: at(r, "c0053") }, { arg: "by", value: "c0108", how: "copy", at: at(r, "c0108") },
    { arg: "task", value: "build", how: "choice", at: at(r, "build") }, { arg: "units", value: "6", how: "copy", at: at(r, "6") }] });
  r = "Set up a union called Under Bridge Union, and record that it is free to demolish shop-105.";
  cases.push({ request: r, forms: [], program: 'v1 = entity(kind=union, name="Under Bridge Union")\nclaim(about={"action":"demolish","object":"shop-105"}, holder=v1, position=liberty)', spans: [
    { arg: "kind", value: "union", how: "choice", line: 0, at: at(r, "union") }, { arg: "name", value: "Under Bridge Union", how: "copy", line: 0, at: at(r, "Under Bridge Union") },
    { arg: "about.action", value: "demolish", how: "choice", line: 1, at: at(r, "demolish") }, { arg: "about.object", value: "shop-105", how: "copy", line: 1, at: at(r, "shop-105") },
    { arg: "position", value: "liberty", how: "implied", line: 1 }] });
  r = "Offer ent.24 a membership agreement: they pay $60 per month into acc-union.";
  cases.push({ request: r, forms: [], program: 'agreement(template=membership, they_do=money(amount="$60", every="per month", to=acc-union), with=ent.24)', spans: [
    { arg: "template", value: "membership", how: "choice", at: at(r, "membership") }, { arg: "they_do.amount", value: "$60", how: "copy", at: at(r, "$60") },
    { arg: "they_do.every", value: "per month", how: "copy", at: at(r, "per month") }, { arg: "they_do.to", value: "acc-union", how: "copy", at: at(r, "acc-union") }, { arg: "with", value: "ent.24", how: "copy", at: at(r, "ent.24") }] });
  r = "Submit the festival application to pos.355: parcel lot-15-31; charge to acc-c2739.";
  const forms = ["- festival_application, to=pos.355, id form-pos.355-festival-application: fields owner (entity), parcel (lot), charge_to (account)"];
  cases.push({ request: r, forms, program: "form(charge_to=acc-c2739, form=festival_application, parcel=lot-15-31, to=pos.355)", spans: [
    { arg: "charge_to", value: "acc-c2739", how: "copy", at: at(r, "acc-c2739") }, { arg: "form", value: "festival_application", how: "choice", at: at(r, "festival application") },
    { arg: "parcel", value: "lot-15-31", how: "copy", at: at(r, "lot-15-31") }, { arg: "to", value: "pos.355", how: "copy", at: at(r, "pos.355") }] });
  cases.push({ request: "Make the board approve the plan.", forms: [], program: "none(not_yours)", spans: [] });
  const all = cases.map((c) => encode(c));
  cases.forEach((c, i) => {
    expect(decode(all[i]!.input, all[i]!.steps)).toBe(canonical(c.program));
    // As pieces (what a model points at), and back: no span cuts a piece.
    const exported = row(String(i), "positive", all[i]!)!;
    expect(exported).toBeDefined();
    expect(decode(all[i]!.input, stepsOf(exported, exported.steps))).toBe(canonical(c.program));
  });
  // Every step is a choice from a closed set or a span: no step carries a value of the request's.
  const closed = vocabulary(all);
  for (const s of closed) expect(/^(fn|arg|none|bind|var|const|key):|^[\[\]{})]$|^eos$/.test(s)).toBe(true);
  expect(closed.some((s) => s.includes("c0412") || s.includes("fence"))).toBe(false);
  expect(closed).toContain('const:"0 days"');
});

test("a form's field is an argument by pointing at it in the form as shown; a value that is neither said nor marked implied can't be encoded", () => {
  const r = "Submit the festival application to pos.355: parcel lot-15-31.";
  const forms = ["- festival_application, to=pos.355, id form-x: fields owner (entity), parcel (lot)"];
  const e = encode({ request: r, forms, program: "form(form=festival_application, parcel=lot-15-31, to=pos.355)", spans: [
    { arg: "form", value: "festival_application", how: "choice", at: at(r, "festival application") }, { arg: "parcel", value: "lot-15-31", how: "copy", at: at(r, "lot-15-31") }, { arg: "to", value: "pos.355", how: "copy", at: at(r, "pos.355") }] });
  const field = e.steps.find((s) => typeof s !== "string" && s[0] === "field") as [string, number, number];
  expect(e.input.slice(field[1], field[2])).toBe("parcel");
  expect(field[1]).toBeGreaterThan(r.length);
  expect(() => encode({ request: "Pay c0412.", forms: [], program: 'money(amount="$5", to=c0412)', spans: [{ arg: "to", value: "c0412", how: "copy", at: [4, 9] }] })).toThrow();
  expect(asWord("the Footpath  declaration")).toBe("footpath_declaration");
  expect(pieces("Pay acc-c0032 $1,200.90").map((p) => p.text)).toEqual(["Pay", "acc", "-", "c0032", "$", "1", ",", "200", ".", "90"]);
});

test("the adapter reads the request and the forms out of what the translator sends a model", () => {
  expect(shown("Request: Pay c0412 $5.")).toEqual({ request: "Pay c0412 $5.", forms: [] });
  expect(shown("Request: Fill it in.\nSecond line.\n\nForms this person knows of:\n- a, to=x, id f: fields n (text)\n- b, to=y, id g: fields m (text)")).toEqual({ request: "Fill it in.\nSecond line.", forms: ["- a, to=x, id f: fields n (text)", "- b, to=y, id g: fields m (text)"] });
});

test("a model's steps over pieces come to a program, and steps no program is made of ask back", () => {
  const input = "Pay c0412 $5.";
  const ps = pieces(input);
  expect(ps.map((p) => p.text)).toEqual(["Pay", "c0412", "$", "5", "."]);
  expect(programOf(input, ps, ["fn:money", "arg:amount", ["text", 2, 3], "arg:to", ["id", 1, 1], ")", "eos"])).toBe('money(amount="$5", to=c0412)');
  expect(programOf(input, ps, ["none:not_yours", "eos"])).toBe("none(not_yours)");
  // A reader with tokens of its own can point at a mark that is none of the input (piece -1), or past the end.
  expect(programOf(input, ps, ["fn:money", "arg:to", ["id", -1, 1], ")", "eos"])).toBe("none(unclear)");
  expect(programOf(input, ps, ["fn:money", "arg:to", ["id", 1, 9], ")", "eos"])).toBe("none(unclear)");
  expect(programOf(input, ps, ["fn:money", "arg:to", ["id", 3, 1], ")", "eos"])).toBe("none(unclear)");
  expect(programOf(input, ps, ["fn:money", "arg:to"])).toBe("none(unclear)");
});

test("a call's arguments are written by name, or (asked for) in the order the request says them, what it doesn't spell first", () => {
  const request = "Pay c0412 $5 for the fence.";
  const spans: Span[] = [
    { arg: "amount", value: "$5", how: "copy", at: [10, 12] },
    { arg: "to", value: "c0412", how: "copy", at: [4, 9] },
    { arg: "from", value: "acc-mine", how: "implied" },
  ];
  const byName = encode({ request, forms: [], program: 'money(amount="$5", from=acc-mine, to=c0412)', spans: spans.map((x) => ({ ...x })) }, "name");
  expect(byName.steps).toEqual(["fn:money", "arg:amount", ["text", 10, 12], "arg:from", "const:acc-mine", "arg:to", ["id", 4, 9], ")", "eos"]);
  const e = encode({ request, forms: [], program: 'money(amount="$5", from=acc-mine, to=c0412)', spans }, "said");
  expect(e.steps).toEqual(["fn:money", "arg:from", "const:acc-mine", "arg:to", ["id", 4, 9], "arg:amount", ["text", 10, 12], ")", "eos"]);
  expect(decode(e.input, e.steps)).toBe('money(amount="$5", from=acc-mine, to=c0412)');
});

test("a form that can't be one of the forms shown is not offered: none of them by name is an unknown form; a field not its own, a required one left out or a value it can't take is unclear", () => {
  const forms = [
    "- council_proposal, to=city, id form-council-proposal: fields affects (one of tenants | development | neither), kind (one of law | budget | other, required), parks (amount), proposal (text, required)",
    "- amend_tenancy, to=city, id form-amend-tenancy: fields affects (one of tenants | development | neither), notice (duration), tenant_notice (duration)",
  ];
  const f = formsShown(forms).get("council_proposal")!;
  expect([...f.fields]).toEqual(["affects", "kind", "parks", "proposal"]);
  expect(f.required).toEqual(["kind", "proposal"]);
  expect(f.oneOf.get("kind")).toEqual(["law", "budget", "other"]);
  expect(formsMisfit('form(form=council_proposal, kind=law, affects=tenants, proposal="A rule.")', forms)).toBeUndefined();
  expect(formsMisfit('form(form=amend_tenancy, to=city, notice="90 days")', forms)).toBeUndefined();
  expect(formsMisfit('form(form=notice, notice="60 days")', forms)).toBe("unknown_form");
  expect(formsMisfit('form(form=council_proposal, kind=law)', forms)).toBe("unclear"); // the proposal's text is required
  expect(formsMisfit('form(form=council_proposal, kind=tenants, proposal="A rule.")', forms)).toBe("unclear"); // not one of its kinds
  expect(formsMisfit('form(form=amend_tenancy, staff="$5")', forms)).toBe("unclear"); // no field of this form
  expect(formsMisfit('form(form=council_proposal, kind=law, proposal="A rule.")\nmessage(to=council-clerk, text="put it to a ballot")', forms)).toBeUndefined();
  // Nothing to check against, or nothing to check: passes.
  expect(formsMisfit('form(form=anything, x="1")', [])).toBeUndefined();
  expect(formsMisfit('money(amount="$5", to=c0412)', forms)).toBeUndefined();
  expect(formsMisfit("none(unknown_form)", forms)).toBeUndefined();
});
