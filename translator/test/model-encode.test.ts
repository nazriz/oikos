// A program as decisions and copies (translator/model/encode.ts): every kind of value comes back exactly.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { CUT_OFF, DecideAdapter, formsMisfit, formsShown, programOf, shown } from "../model/adapter";
import { asWord, decode, encode, vocabulary, type Span } from "../model/encode";
import { pieces, row, stepsOf } from "../model/export";
import { copies, goldText, literals, spansIn, strayIds, styleBrief } from "../train/data";

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
  // An act resting on several records: basis as a list, each record a span of the request, in the order cited (which
  // is not the order of their ids, nor need it be the order they stand in beside the other arguments).
  r = "Pay invoice rec.28337: $3,187.73 from acc-city to acc-outside for disposal of waste, citing dockets rec.11904, rec.16123, rec.21887 and rec.25703, within the services budget rec.25150.";
  cases.push({ request: r, forms: [], program: 'money(amount="$3,187.73", basis=["rec.11904","rec.16123","rec.21887","rec.25703","rec.25150"], for="disposal of waste", from=acc-city, settles=rec.28337, to=acc-outside)', spans: [
    { arg: "amount", value: "$3,187.73", how: "copy", at: at(r, "$3,187.73") }, ...["rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150"].map((x): Span => ({ arg: "basis", value: x, how: "copy", at: at(r, x) })),
    { arg: "for", value: "disposal of waste", how: "copy", at: at(r, "disposal of waste") }, { arg: "from", value: "acc-city", how: "copy", at: at(r, "acc-city") },
    { arg: "settles", value: "rec.28337", how: "copy", at: at(r, "rec.28337") }, { arg: "to", value: "acc-outside", how: "copy", at: at(r, "acc-outside") }] });
  r = "Under permit rec.512 and the council's resolution rec.498, have builder put up a hall on lot-02 for $410,000 from acc-city. Then post a notice that says so, resting on rec.498 and rec.512.";
  cases.push({ request: r, forms: [], program: 'structure(basis=["rec.512","rec.498"], by=builder, from=acc-city, on=lot-02, price="$410,000", type=hall)\nstatement(basis=["rec.498","rec.512"], kind=notice, text="so")', spans: [
    { arg: "basis", value: "rec.512", how: "copy", line: 0, at: at(r, "rec.512") }, { arg: "basis", value: "rec.498", how: "copy", line: 0, at: at(r, "rec.498") },
    { arg: "by", value: "builder", how: "copy", line: 0, at: at(r, "builder") }, { arg: "from", value: "acc-city", how: "copy", line: 0, at: at(r, "acc-city") }, { arg: "on", value: "lot-02", how: "copy", line: 0, at: at(r, "lot-02") },
    { arg: "price", value: "$410,000", how: "copy", line: 0, at: at(r, "$410,000") }, { arg: "type", value: "hall", how: "choice", line: 0, at: at(r, "hall") },
    { arg: "basis", value: "rec.498", how: "copy", line: 1, at: at(r, "rec.498", r.indexOf("resting")) }, { arg: "basis", value: "rec.512", how: "copy", line: 1, at: at(r, "rec.512", r.indexOf("resting")) },
    { arg: "kind", value: "notice", how: "choice", line: 1, at: at(r, "notice") }, { arg: "text", value: "so", how: "copy", line: 1, at: at(r, "so", r.indexOf("says")) }] });
  cases.push({ request: "Make the board approve the plan.", forms: [], program: "none(not_yours)", spans: [] });
  const all = cases.map((c) => encode(c));
  cases.forEach((c, i) => {
    expect(decode(all[i]!.input, all[i]!.steps)).toBe(canonical(c.program));
    // As pieces (what a model points at), and back: no span cuts a piece.
    const exported = row(String(i), "positive", all[i]!)!;
    expect(exported).toBeDefined();
    expect(decode(all[i]!.input, stepsOf(exported, exported.steps))).toBe(canonical(c.program));
  });
  // A list of bases is the list's two marks around a span for each record, in the order cited: nothing new to choose.
  const payment = all[cases.findIndex((c) => c.program.startsWith('money(amount="$3,187.73"'))]!;
  const from = payment.steps.indexOf("arg:basis");
  expect(payment.steps.slice(from + 1, from + 8).map((s) => (typeof s === "string" ? s : payment.input.slice(s[1], s[2])))).toEqual(["[", "rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150", "]"]);
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

test("an office's own form named only by what it is for, and the office it goes to, are pointed at in the forms shown, never choices of the closed set", () => {
  const r = "Register the death of c0412, who died on year 1, day 40.";
  const forms = ["- rental_listing, to=housing, id form-a: fields rent (amount)", "- death_registration, to=pos.41, id form-b: fields deceased (person, required), died (date), notify (one of yes | no)"];
  const program = 'form(deceased=c0412, died="year 1, day 40", form=death_registration, notify=yes, to=pos.41)';
  const e = encode({ request: r, forms, program, spans: [
    { arg: "deceased", value: "c0412", how: "copy", at: at(r, "c0412") }, { arg: "died", value: "year 1, day 40", how: "copy", at: at(r, "year 1, day 40") },
    { arg: "form", value: "death_registration", how: "implied" }, { arg: "notify", value: "yes", how: "implied" }, { arg: "to", value: "pos.41", how: "implied" }] });
  expect(decode(e.input, e.steps)).toBe(canonical(program));
  // The form's name and its office: places in the second form's line. The yes the wording implies: a choice.
  const ids = e.steps.filter((s): s is ["id", number, number] => typeof s !== "string" && s[0] === "id" && s[1] > r.length);
  expect(ids.map((s) => e.input.slice(s[1], s[2]))).toEqual(["death_registration", "pos.41"]);
  expect(vocabulary([e]).filter((c) => c.startsWith("const:"))).toEqual(["const:yes"]);
  // Whole pieces of the input, so the export keeps it, and the program comes back from the pieces.
  const x = row("a", "positive", e)!;
  expect(decode(e.input, stepsOf(x, x.steps))).toBe(canonical(program));
  // An office two forms go to is taken from the line of the form being filled; a form that is not shown stays a choice.
  const two = ["- a_form, to=pos.9, id form-a: fields n (text)", "- b_form, to=pos.9, id form-b: fields n (text)"];
  const b = encode({ request: "File the second one saying hello.", forms: two, program: 'form(form=b_form, n="hello", to=pos.9)', spans: [{ arg: "form", value: "b_form", how: "implied" }, { arg: "n", value: "hello", how: "copy", at: [27, 32] }, { arg: "to", value: "pos.9", how: "implied" }] });
  const to = b.steps.filter((s): s is ["id", number, number] => typeof s !== "string" && s[0] === "id").at(-1)!;
  expect(to[1]).toBeGreaterThan(b.input.indexOf("- b_form"));
  const none = encode({ request: "File it.", forms: [], program: "form(form=b_form, to=pos.9)", spans: [{ arg: "form", value: "b_form", how: "implied" }, { arg: "to", value: "pos.9", how: "implied" }] });
  expect(none.steps).toContain("const:b_form");
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
  // Several bases, as a model points at them over pieces: a list of spans, each a record's id whole.
  const cited = "Publish a notice under rec.7 and rec.12: Closed.";
  const cps = pieces(cited);
  const piece = (text: string) => cps.findIndex((p) => p.text === text);
  expect(programOf(cited, cps, ["fn:statement", "arg:basis", "[", ["text", piece("7") - 2, piece("7")], ["text", piece("12") - 2, piece("12")], "]", "arg:kind", ["word", piece("notice"), piece("notice")], "arg:text", ["text", piece("Closed"), piece("Closed")], ")", "eos"]))
    .toBe('statement(basis=["rec.7","rec.12"], kind=notice, text="Closed")');
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
  expect(formsMisfit('form(form=notice, notice="60 days")', forms)).toEqual({ label: "unknown_form" });
  expect(formsMisfit('form(form=council_proposal, kind=law)', forms)).toEqual({ label: "unclear", unsure: { kind: "form_needs", form: "council_proposal", fields: ["proposal"] } });
  expect(formsMisfit('form(form=council_proposal, kind=tenants, proposal="A rule.")', forms)).toEqual({ label: "unclear", unsure: { kind: "form_option", form: "council_proposal", field: "kind" } });
  expect(formsMisfit('form(form=amend_tenancy, staff="$5")', forms)).toEqual({ label: "unclear", unsure: { kind: "form_field", form: "amend_tenancy", fields: ["staff"] } });
  expect(formsMisfit('form(form=council_proposal, kind=law, proposal="A rule.")\nmessage(to=council-clerk, text="put it to a ballot")', forms)).toBeUndefined();
  // Nothing to check against, or nothing to check: passes.
  expect(formsMisfit('form(form=anything, x="1")', [])).toBeUndefined();
  expect(formsMisfit('money(amount="$5", to=c0412)', forms)).toBeUndefined();
  expect(formsMisfit("none(unknown_form)", forms)).toBeUndefined();
});

test("the data pipeline's own spans for a list of bases: each record found where the request cites it, and the example rebuilt exactly", () => {
  const request = "As finance officer [finance], pay invoice [rec.28337]: $3,187.73 from [acc-city] to [acc-outside] for disposal of waste, citing dockets [rec.11904], [rec.16123], [rec.21887] and [rec.25703], within the services budget [rec.25150].";
  const program = 'money(amount="$3,187.73", basis=["rec.11904","rec.16123","rec.21887","rec.25703","rec.25150"], for="disposal of waste", from=acc-city, settles=rec.28337, to=acc-outside)';
  // Every id of the program is copied from the request, and the request names none the program lacks.
  expect(literals(calls.parseProgram(program))).toEqual(expect.arrayContaining(["rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150", "rec.28337"]));
  expect(copies(request, program)).toBe(true);
  expect(copies(request.replace("[rec.21887] and ", ""), program)).toBe(false);
  expect(strayIds(request, program, { riders: [{ kind: "capacity", text: "As finance officer [finance]" }] })).toEqual([]);
  expect(strayIds(request, program.replace('"rec.21887",', ""), { riders: [{ kind: "capacity", text: "As finance officer [finance]" }] })).toEqual(["rec.21887"]);
  // Each basis is a span of its own, none ambiguous, standing in the request in the order the list has them.
  const spans = spansIn(request, program);
  const cited = spans.filter((x) => x.arg === "basis");
  expect(cited.map((x) => [x.value, x.how, request.slice(x.at![0], x.at![1]), (x as { ambiguous?: boolean }).ambiguous])).toEqual(
    ["rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150"].map((id) => [id, "copy", id, undefined]));
  expect(cited.map((x) => x.at![0])).toEqual(cited.map((x) => x.at![0]).slice().sort((a, b) => a - b));
  expect(spans.find((x) => x.arg === "settles")).toMatchObject({ value: "rec.28337", how: "copy" });
  // As steps, and back; as pieces, and back.
  const e = encode({ request, forms: [], program, spans });
  expect(decode(e.input, e.steps)).toBe(canonical(program));
  const exported = row("x", "positive", e)!;
  expect(decode(e.input, stepsOf(exported, exported.steps))).toBe(canonical(program));
  // A record cited twice over two lines (once in each list) is placed with its own line's values.
  const two = "Have builder put up a hall on lot-02 for $410,000 from acc-city under permit rec.512 and resolution rec.498. Publish a notice saying \"Works begin.\" under resolution rec.498 and permit rec.512.";
  const both = 'structure(basis=["rec.512","rec.498"], by=builder, from=acc-city, on=lot-02, price="$410,000", type=hall)\nstatement(basis=["rec.498","rec.512"], kind=notice, text="Works begin.")';
  const e2 = encode({ request: two, forms: [], program: both, spans: spansIn(two, both) });
  expect(decode(e2.input, e2.steps)).toBe(canonical(both));
  const second = spansIn(two, both).filter((x) => x.arg === "basis" && x.line === 1);
  expect(second.map((x) => x.at![0] > two.indexOf("Publish"))).toEqual([true, true]);
  // One basis has one form in gold too: a list of one is written bare.
  expect(goldText(calls.parseProgram('statement(basis=["rec.498"], kind=notice, text="Works begin.")'))).toBe('statement(basis=rec.498, kind=notice, text="Works begin.")');
  expect(goldText(calls.parseProgram(both))).toBe(canonical(both));
  // Asked for in the cited style, a program resting on several is told to cite each, in order.
  expect(styleBrief("cited", { program: both } as Parameters<typeof styleBrief>[1], () => 0.5).instruction).toContain("every one of them, those it rests on in the order the call lists them");
});

test("the trained model asks back only when very unsure, and never twice running: the next request from the same participant is drafted", async () => {
  const a = new DecideAdapter("none", { threshold: 0.5 });
  // (No model is started: what it would answer is given.)
  const answers = [{ steps: ["fn:money", "arg:to", ["id", 1, 1], ")", "eos"], sure: 0.2, ms: 1, parts: { choices: 0.9, places: 0.3, texts: 1, least: 0.3 } }, { steps: ["fn:money", "arg:to", ["id", 1, 1], ")", "eos"], sure: 0.2, ms: 1, parts: { choices: 0.9, places: 0.3, texts: 1, least: 0.3 } }, { steps: ["fn:money", "arg:to", ["id", 1, 1], ")", "eos"], sure: 0.2, ms: 1, parts: { choices: 0.9, places: 0.3, texts: 1, least: 0.3 } }];
  (a as any).ask = async () => answers.shift();
  const ask = async (ref: string) => (await a.complete({ purpose: "translator", subject: "translator", ref, system: "", maxTokens: 10, messages: [{ role: "user", content: "Request: Pay c0412 what is owed." }] })).content[0] as any;
  expect((await ask("draft.mayor-system.1")).input).toEqual({ program: "none(unclear)", unsure: { kind: "which" } });
  expect((await ask("draft.mayor-system.2")).input).toEqual({ program: "money(to=c0412)" }); // asked again: the draft, to confirm or decline
  expect((await ask("draft.mayor-system.3")).input).toEqual({ program: "none(unclear)", unsure: { kind: "which" } }); // a new matter is asked back as any is
  expect(CUT_OFF).toBe(0.1);
});
