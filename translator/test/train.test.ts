import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { CASES } from "../eval/cases";
import { TEST_CURRENCY } from "../eval/run";
import { translatorContext, translatorSystem } from "../src/index";
import { resolve } from "../src/resolver";
import {
  amountForms, amountWritings, askable, badlyWritten, bringsAbout, builtRefusals, checkerFor, copies, durationForms, FIELD_TYPES, formLine, formOf, functionOf, generate, goldFromCases, goldFromLog, goldText, implausible, JSON_OUT_OF_SCOPE, knowing, literals, meaningOf, mustAppear,
  needed, piledBriefs, plausible, refusalBriefs, everyIn, howOften, runTogether, sayingFor, SAYINGS, withHowOften, writerNotes, spansIn, sameMeaning, sameProgram, sampler, shapeOf, split, STYLES, styleBrief, surfaceVariant, whyNot, withOffice, withoutRiders, writerSystem, type Example, type Gold, unwrapped, quotesBalanced } from "../train/data";
import { CURRENCIES, everyCurrency, formSets, piled, synthetic, syntheticForms } from "../train/synthetic";

const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });
const header = JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }, { id: "city", name: "Millbrook" }] }, positions: [{ id: "works", title: "Works Manager" }] } } });
const LOG = [
  header,
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'),
  act('money(to=builder, amount="$750", from=acc-city, for="the drain")'),
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'), // the same program again
  act('message(to=["builder","works"], text="Start on Monday.")'),
  act('statement(kind=delivery_note, text="Delivered 3.", data={"delivered":3,"order":"rec.9"})'), // data code writes for code
  act('money(to=acc-shop-1, amount="$20", from=acc-c0001, per_request=rec.5)'), // a keeper carrying out an instruction
  act('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")'),
  JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "blocks" } } }),
];

/** A writer that says the call back as a sentence holding every literal (or, told to, loses one). */
const writer = (model: string, how: (program: string, style: string) => string | undefined): LlmAdapter => ({
  provider: "stand-in", model,
  complete: async (req: LlmRequest) => {
    const content = String((req.messages[0] as any).content);
    const program = content.slice("Call:\n".length, content.indexOf("\n\n"));
    const style = content.slice(content.lastIndexOf("Style: ") + 7);
    const text = how(program, style);
    return { content: text ? [{ type: "text", text }] : [], usage: { input_tokens: 10, output_tokens: 5 } };
  },
});
const saying = (program: string, style: string) => `(${style.slice(0, 6)}) Please see to this: ${literals(calls.parseProgram(program)).join(", ")}.`;
/** The words a style says to use exactly (an opening, a citation, a closing sentence), if it gives any. */
const given = (style: string) => (style.includes("exactly ") ? [...style.slice(style.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") || undefined : undefined);
/** A writer that does as the style says: the given words first, then every literal. */
const obliging = (program: string, style: string) => `${given(style) ? `${given(style)}${/[.]$/.test(given(style)!) ? "" : ","} ` : ""}please see to this: ${literals(calls.parseProgram(program)).join(", ")}.`;

test("gold programs: the calls code wrote, askable ones only, each different program once, with the names of what they mention", async () => {
  const gold = await goldFromLog(LOG, { perShape: 8 });
  // (Each in the call language's own canonical form: its arguments in one order, whatever order they were written in.)
  expect(gold.map((g) => g.program)).toEqual([
    'message(text="Start on Monday.", to=["builder","works"])',
    'money(amount="$500", for="the kerb", from=acc-city, to=builder)',
    'money(amount="$750", for="the drain", from=acc-city, to=builder)',
    'v1 = entity(kind=trust, name="River Land Trust")\nstatement(for=v1, kind=charter, text="It holds land.")',
  ]);
  expect(gold[0]!.names).toEqual({ builder: "Millbrook Builders", works: "Works Manager" });
  expect(gold[1]!.shape).toBe("money(amount,for,from,to)");
  // At most so many of a shape, the same ones for the same seed.
  const one = await goldFromLog(LOG, { perShape: 1, seed: 7 });
  expect(one.filter((g) => g.shape === "money(amount,for,from,to)").length).toBe(1);
  expect(await goldFromLog(LOG, { perShape: 1, seed: 7 })).toEqual(one);
});

test("a program's shape, its literals, and what's askable", () => {
  const p = calls.parseProgram('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")');
  expect(shapeOf(p)).toBe("v=entity(kind,name) ; statement(for,kind,text)");
  expect(literals(p)).toEqual(["trust", "River Land Trust", "charter", "It holds land."]); // not `t`: a name within the program
  expect(literals(calls.parseProgram('agreement(with=c0042, term="12 months", they_do=money(to=acc-city, amount="$850", every="monthly"))'))).toEqual(["c0042", "12 months", "acc-city", "$850", "monthly"]);
  expect(askable(calls.parseProgram('statement(kind=note, text="x", data={"a":1})'))).toBe(false);
  expect(askable(calls.parseProgram("vote(ballot=rec.3, choice=yes)"))).toBe(true);
  expect(sameProgram('vote(ballot=rec.3, choice="yes")', "vote(choice=yes, ballot=rec.3)")).toBe(true);
  // What a payment is for, loosely; everything else exactly.
  expect(sameProgram('money(to=acc-1, amount="$5", for="energy bill")', 'money(to=acc-1, amount="$5", for="the energy bill.")')).toBe(true);
  expect(sameProgram('money(to=acc-1, amount="$5", for="energy bill")', 'money(to=acc-1, amount="$50", for="energy bill")')).toBe(false);
  expect(sameProgram('message(to=works, text="Go.")', 'message(to=works, text="Go")')).toBe(false);
});

test("a request is kept only if it carries every literal exactly, and only if it translates back to its program", async () => {
  expect(copies("Pay builder $500 from acc-city for the kerb.", 'money(to=builder, amount="$500", from=acc-city, for="the kerb")')).toBe(true);
  expect(copies("Pay the builder five hundred dollars from acc-city for the kerb.", 'money(to=builder, amount="$500", from=acc-city, for="the kerb")')).toBe(false);
  const gold = await goldFromLog(LOG);
  // The second writer reformats amounts: its money requests are dropped, mechanically.
  const sloppy = (program: string, style: string) => saying(program, style).replace("$500", "500 dollars").replace("$750", "750 dollars");
  // The model translating back gets the drain payment wrong.
  const byRequest = new Map<string, string>();
  const first = writer("a", (program, style) => {
    const r = saying(program, style);
    byRequest.set(r, program);
    return r;
  });
  const r = await generate(gold, {
    writers: [first, writer("b", sloppy)], perGold: 2, styles: ["terse", "formal"],
    back: { model: "stand-in/back", translate: async (request) => (request.includes("the drain") ? "none(unclear)" : byRequest.get(request)) },
  });
  // Four programs, two requests each: writer b loses both payments' amounts; the drain payment from writer a fails the round trip.
  expect(r.manifest.dropped).toEqual({ not_copied: 2, round_trip: 3, duplicate: 0, failed: 0, shares_held_out_wording: 0, marks: 0, stray_id: 0, quotes: 0, variable_named: 0, argument_named: 0, zero_wait: 0, place_reversed: 0, description_echoed: 0 });
  expect(r.examples.filter((e) => e.kind === "positive").map((e) => [e.shape, e.written_by, e.verified_by])).toEqual([
    ["message(text,to)", "stand-in/a", "stand-in/back"],
    ["money(amount,for,from,to)", "stand-in/a", "stand-in/back"],
    ["v=entity(kind,name) ; statement(for,kind,text)", "stand-in/a", "stand-in/back"],
  ]);
  expect(r.manifest.usage["stand-in/a"]).toEqual({ input_tokens: 40, output_tokens: 20 });
  expect(r.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect((await generate(gold, { writers: [first], perGold: 1 })).examples.every((e) => e.verified_by === undefined)).toBe(true);
});

test("refusals that can be built are: several requests run together, and a form nobody was shown", () => {
  const positives: Example[] = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i}`, request: `Request number ${i} about thing ${i}.`, forms: i % 10 === 0 ? ["- permit_application, to=planning: fields lot (lot, required)"] : [],
    program: i % 10 === 0 ? `form(to=planning, form=permit_application, lot=lot-${i})` : `vote(ballot=rec.${i}, choice=yes)`, kind: "positive", shape: i % 10 === 0 ? "form(form,lot,to)" : `shape-${i % 7}`, source: "test",
  }));
  const built = builtRefusals(positives, 3, 0.1);
  const many = built.filter((e) => e.program === "none(too_much)");
  expect(many.length).toBeGreaterThan(0);
  // Each is four or more of the requests, every one of them in it (whatever stands between them: `runTogether`).
  for (const e of many) {
    expect(e.built_from!.length).toBeGreaterThanOrEqual(4);
    for (const id of e.built_from!) expect(e.request.toLowerCase()).toContain(positives.find((p) => p.id === id)!.request.toLowerCase().replace(/\.$/, ""));
  }
  const forms = built.filter((e) => e.program === "none(unknown_form)");
  for (const e of forms) expect(e.forms).toEqual([]);
  // A floor under each: at least so many, as far as the examples allow (there are four form examples here).
  const floored = builtRefusals(positives, 3, 0.1, { too_much: 9, unknown_form: 3 });
  expect(floored.filter((e) => e.program === "none(too_much)").length).toBeGreaterThanOrEqual(9);
  expect(floored.filter((e) => e.program === "none(unknown_form)").length).toBeGreaterThanOrEqual(3);
  expect(builtRefusals(positives, 3, 0.1, { unknown_form: 50 }).filter((e) => e.program === "none(unknown_form)").length).toBe(4);
  expect(builtRefusals(positives, 3, 0.1)).toEqual(built); // the same seed, the same refusals
});

test("a request that shares wording with a held-out case is dropped, and counted", async () => {
  const gold = await goldFromLog(LOG);
  const heldOut = [{ id: "x-1", request: `Would you ${saying(gold[1]!.program, "plain").slice(8)}`, expect: ["none(unclear)"] }];
  const all = await generate(gold, { writers: [writer("a", saying)], perGold: 1, styles: ["plain"] });
  const r = await generate(gold, { writers: [writer("a", saying)], perGold: 1, styles: ["plain"], heldOut });
  expect(r.manifest.dropped.shares_held_out_wording).toBe(1);
  expect(r.examples.length).toBe(all.examples.length - 1);
  expect(r.examples.some((e) => e.program === gold[1]!.program)).toBe(false);
});

test("the same program on another surface: a name for an id, an amount or a time written another way, meaning the same", async () => {
  // In the test town's money (its sign, its words, two decimal places): every form reads back as the same number.
  const forms = amountForms("$27200.00", TEST_CURRENCY);
  expect(forms).toEqual(expect.arrayContaining(["$27,200", "$27200", "$27,200.00", "27,200 dollars", "27,200"]));
  expect(forms).not.toContain("$27200.00");
  for (const f of forms) expect(calls.parseAmount(f, TEST_CURRENCY)).toBe("2720000");
  expect(amountForms("$5,000", TEST_CURRENCY)).toEqual(expect.arrayContaining(["$5k", "5k", "5 thousand dollars"]));
  expect(amountForms("$12.50", TEST_CURRENCY)).toEqual(expect.arrayContaining(["12.50 dollars", "1250 cents"]));
  expect(amountForms("$12.50", TEST_CURRENCY)).not.toContain("$12");
  expect(amountForms("a lot", TEST_CURRENCY)).toEqual([]);
  expect(durationForms("30 days", true)).toEqual(expect.arrayContaining(["1 month", "a month", "every month", "monthly"]));
  expect(durationForms("30 days", false)).not.toContain("monthly");
  expect(durationForms("14 days", false)).toEqual(expect.arrayContaining(["2 weeks", "a fortnight"]));
  const [gold] = (await goldFromLog(LOG)).filter((g) => g.shape === "money(amount,for,from,to)");
  const rand = sampler(5);
  const seenForms = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const v = surfaceVariant(gold!, rand, TEST_CURRENCY);
    seenForms.add(v.program);
    const p = calls.parseProgram(v.program) as any;
    // The same act: the same cents, the same payee (by id, or by the name the resolver looks up), the same shape.
    expect(calls.parseAmount(p.lines[0].call.args.amount.text, TEST_CURRENCY)).toBe("50000");
    expect([{ id: "builder" }, { text: "Millbrook Builders" }]).toContainEqual(p.lines[0].call.args.to);
    expect(shapeOf(p)).toBe(gold!.shape);
  }
  expect(seenForms.size).toBeGreaterThan(3);
});

test("gold programs from the seen cases cover what a town's code rarely calls", () => {
  const gold = goldFromCases(CASES);
  const fns = new Set(gold.map((g) => g.shape.replace(/^v=/, "").split("(")[0]));
  for (const f of ["entity", "claim", "position", "form", "structure", "agreement"]) expect(fns.has(f)).toBe(true);
  expect(gold.some((g) => g.program.startsWith("none("))).toBe(false);
});

test("refusals that have to be worded: the label comes from how the brief is built; the request must carry what the brief keeps", async () => {
  const gold = await goldFromLog(LOG);
  const briefs = refusalBriefs(gold, 2, 9);
  expect(briefs.map((b) => b.label)).toEqual(["needs_calculation", "not_yours", "unclear", "not_an_act", "no_such_act", "look_first", "needs_calculation", "not_yours", "unclear", "not_an_act", "no_such_act", "look_first"]);
  // Something to look at and nothing to do: what's named must be in the request as written.
  expect(briefs[3]!.brief).toContain("to bring nothing about");
  for (const b of briefs.filter((x) => x.label === "not_an_act")) for (const l of b.mustCopy) expect(b.brief).toContain(l);
  const calc = briefs[0]!;
  // The payment without its amount: who, from where and what for are still to be copied; no figure is given.
  expect(calc.brief).toContain("money(for=");
  expect(calc.brief).not.toContain("amount=");
  expect(calc.mustCopy).toEqual(expect.arrayContaining(["acc-city"])); // (and the purpose, quoted; `builder`, a bare word, is the round trip's to check)
  expect(refusalBriefs(gold, 2, 9)).toEqual(briefs);
  // A writer that words each brief; the model translating back refuses with the right label, except for vague ones.
  const wording: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req) => {
    const said = String((req.messages[0] as any).content);
    const isRefusal = said.startsWith("Situation:");
    const text = !isRefusal ? saying(said.slice("Call:\n".length, said.indexOf("\n\n")), "x")
      : said.includes("no amount stated") ? `Pay builder from acc-city a third of the budget, for ${said.includes("the kerb") ? "the kerb" : "the drain"}. (${said.length})`
      : said.includes("for them to decide") ? `Make them agree. (${said.length})` : `Do something about it. (${said.length})`;
    return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
  } };
  const r = await generate(gold, { writers: [wording], perGold: 1, refusalsPerLabel: 2, seed: 9,
    back: { model: "stand-in/back", translate: async (q) => (q.includes("a third") ? "none(needs_calculation)" : q.startsWith("Make them") ? "none(not_yours)" : q.startsWith("Do something") ? "structure(type=road, on=lot-1)" : "none(unclear)") } });
  const refusals = r.examples.filter((e) => e.kind === "refusal").map((e) => e.program);
  expect(refusals.filter((x) => x === "none(needs_calculation)").length).toBe(2);
  expect(refusals.filter((x) => x === "none(not_yours)").length).toBe(2);
  expect(refusals).not.toContain("none(unclear)"); // the second model made something of them: not kept
});

test("what no function does is written to a brief too (a place to be gone to, an office's own routine), and what needs something found out first (a standing payment named only by what it pays, a record only described, an act that depends on a look)", async () => {
  const g = (program: string): Gold => ({ program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: "t" });
  const rent = 'money(to=acc-landlord-1, amount="$850", from=acc-city, every="monthly", for="rent")';
  const gold = [g(rent), g('work(task=make, units="3", at=str.7, by=c0042)'), g('money(to=builder, amount="$500", from=acc-city)')];
  const briefs = refusalBriefs(gold, 3, 4).filter((b) => b.label === "no_such_act");
  expect(briefs.length).toBe(3);
  const [visit, routine] = briefs as [typeof briefs[number], typeof briefs[number], typeof briefs[number]];
  // Holding something standing is no refusal any more (a program: statement(hold=...)): no brief asks for one as that.
  for (const b of refusalBriefs(gold, 30, 4)) if (b.label === "no_such_act") expect(b.brief).not.toMatch(/on hold|paused|suspended|already stands/);
  // What needs something found out first, three kinds in turn. A payment that repeats (never the one-off), named only
  // by what it pays: the accounts and the amount, as its world writes it, are the request's to carry, no id for the
  // instruction is given, and it goes with that payment's family when the examples are split.
  const [described, record, lookThen] = refusalBriefs(gold, 3, 4).filter((b) => b.label === "look_first") as [typeof briefs[number], typeof briefs[number], typeof briefs[number]];
  expect(described.brief).toContain(rent);
  expect(described.brief).toContain("has no reference for the instruction itself");
  expect(described.mustCopy.sort()).toEqual(["$850", "acc-city", "acc-landlord-1"]);
  expect(described.gold).toBe(rent);
  expect(described.mention!.length).toBeGreaterThanOrEqual(2);
  expect(record.brief).toContain("a record that they name only by describing it, with no id for it");
  expect([record.mustCopy, record.gold]).toEqual([[], undefined]);
  expect(lookThen.brief).toContain("then something done that depends on what is found");
  expect(lookThen.mustCopy).toEqual([]);
  // With nothing standing among the gold programs, the first kind is a record only described: the label never waits on them.
  const none = refusalBriefs([g('money(to=builder, amount="$500")')], 3, 4).filter((b) => b.label === "look_first");
  expect(none.map((b) => b.brief.includes("only by describing it") || b.brief.includes("depends on what is found"))).toEqual([true, true, true]);
  // A place some program names, to be gone to: not read about, and nobody sent.
  expect(visit.mustCopy).toEqual(["str.7"]);
  expect(visit.brief).toContain("go to str.7 in person");
  // The speaker's own office's routine (another's would be theirs to decide: not_yours).
  expect(routine.mustCopy).toEqual([]);
  expect(routine.brief).toContain("a routine of their own office or organisation");
  expect(refusalBriefs(gold, 3, 4).filter((b) => b.label === "no_such_act")).toEqual(briefs);
  // With nothing standing and nowhere named, every one is a routine: the label never waits on the gold programs.
  const bare = refusalBriefs([g('money(to=builder, amount="$500")')], 3, 4).filter((b) => b.label === "no_such_act");
  expect(bare.map((b) => b.mustCopy)).toEqual([[], [], []]);
  for (const b of bare) expect(b.brief).toContain("a routine of their own office");
  // Written and translated back: kept when the second model refuses it as that, dropped when it forces it into a call;
  // and the floor on refusals counts the label, saying when it came out short.
  const said = (content: string) => (content.includes("keeps repeating") ? "Hold any standing payment of $850 from acc-city to acc-landlord-1 until I say." : content.includes("in person") ? "Go to str.7 and see how it stands." : content.includes("routine of their own") ? `Stop doing that by yourselves. (${content.length})` : `Something else. (${content.length})`);
  const w: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req) => {
    const content = String((req.messages[0] as any).content);
    return { content: [{ type: "text", text: content.startsWith("Situation:") ? said(content) : "x" }], usage: { input_tokens: 1, output_tokens: 1 } };
  } };
  const back = (forced: boolean) => ({ model: "stand-in/back", translate: async (q: string) => (q.startsWith("Hold") ? (forced ? "statement(withdraw=rec.1)" : "none(look_first)") : q.startsWith("Go to") || q.startsWith("Stop doing") ? "none(no_such_act)" : "none(unclear)") });
  const r = await generate(gold, { writers: [w], perGold: 1, refusalFloor: 3, seed: 4, back: back(false) });
  const kept = r.examples.filter((e) => e.program === "none(no_such_act)");
  expect([...new Set(kept.map((e) => e.request.split(" ")[0]))].sort()).toEqual(["Go", "Stop"]);
  const first = r.examples.filter((e) => e.program === "none(look_first)");
  expect(first.find((e) => e.request.startsWith("Hold"))!.gold).toBe(rent);
  expect(Object.keys(r.manifest.short_of_floor ?? {})).not.toContain("no_such_act");
  const forced = await generate(gold, { writers: [w], perGold: 1, refusalFloor: 3, seed: 4, back: back(true) });
  // (The request to hold something, forced into a withdrawal by the model checking, is never kept; the floor is then
  // made up, as far as it can be, from the other briefs.)
  expect(forced.examples.filter((e) => e.program === "none(look_first)" && e.request.startsWith("Hold"))).toEqual([]);
  expect(forced.rejects.some((x) => x.program === "none(look_first)" && x.got === "statement(withdraw=rec.1)")).toBe(true);
});

test("what a gold program is kept as, what a request must carry word for word, and what's too much to ask in a sentence", () => {
  // A name nothing uses is dropped; a payment's purpose loses the full stop a sentence would swallow.
  expect(goldText(calls.parseProgram('park = structure(type=park, on=lot-00, by=builder, price="$97500.00", from=acc-city)'))).toBe('structure(by=builder, from=acc-city, on=lot-00, price="$97500.00", type=park)');
  expect(goldText(calls.parseProgram('money(to=acc.44, amount="$1200.90", for="pension support.")'))).toBe('money(amount="$1200.90", for="pension support", to=acc.44)');
  // Ids and quoted text, word for word; a bare word (yes, park, builder) however the request says it.
  expect(mustAppear(calls.parseProgram("presence(leave=yes, who=ent.2)"))).toEqual(["ent.2"]);
  expect(copies("ent.2 is leaving town for good.", "presence(leave=yes, who=ent.2)")).toBe(true);
  expect(mustAppear(calls.parseProgram('structure(type=park, on=lot-00, by=builder, price="$9k")'))).toEqual(["lot-00", "$9k"].sort((a, b) => (a === "$9k" ? 1 : -1)) && expect.arrayContaining(["lot-00", "$9k"]));
  // Twenty workers named, or a paragraph of terms, isn't a request for a sentence or two.
  expect(askable(calls.parseProgram(`work(task=make, units="3", at=str.1, by=${JSON.stringify(Array.from({ length: 20 }, (_, i) => `c00${i}`))})`))).toBe(false);
  expect(askable(calls.parseProgram(`agreement(with=c0042, terms="${"x".repeat(200)}")`))).toBe(false);
});

test("what a request must carry: ids and copied text exactly, a catalogue word as a word, a yes-or-no not at all; and where each is", () => {
  const program = 'structure(type=park, on=lot-00, by=builder, price="$9k", from=acc-city)';
  expect(needed(calls.parseProgram(program)).map((n) => `${n.arg}=${n.value}${n.exact ? "!" : ""}`).sort()).toEqual(["by=builder", "from=acc-city!", "on=lot-00!", "price=$9k!", "type=park"]);
  expect(copies("Have builder put up a Park on lot-00 for $9k, paid from acc-city.", program)).toBe(true);
  expect(copies("Have builder put up some parkland on lot-00 for $9k, paid from acc-city.", program)).toBe(false); // "park" isn't a word of it
  expect(copies("Have them put up a park on lot-00 for $9k, paid from acc-city.", program)).toBe(false); // who builds isn't said
  // A word nobody said can't be pointed at: "made" is not "make".
  expect(copies("Have c0013 get 15 units made at str.2.", 'work(task=make, units="15", at=str.2, by=c0013)')).toBe(false);
  expect(copies("Have c0013 make 15 at str.2.", 'work(task=make, units="15", at=str.2, by=c0013)')).toBe(true);
  // A form named in two words; someone leaving, without the word "yes".
  expect(copies("Lodge a permit application with planning for lot-01.", "form(to=planning, form=permit_application, lot=lot-01)")).toBe(true);
  expect(copies("c0193 is moving out of apts-2.", "occupancy(in=apts-2, leave=yes, who=c0193)")).toBe(true);
  const request = "Pay acc-b $500 from acc-city for the kerb.";
  const spans = spansIn(request, 'money(to=acc-b, amount="$500", from=acc-city, for="the kerb")');
  expect(spans.map((x) => `${x.arg}: ${request.slice(...x.at!)}`).sort()).toEqual(["amount: $500", "for: the kerb", "from: acc-city", "to: acc-b"]);
});

test("each span says how its value comes from the request: copied, chosen for its words, or implied (no span)", async () => {
  const how = (request: string, program: string, forms: Parameters<typeof spansIn>[2] = []) => spansIn(request, program, forms).map((x) => `${x.arg}=${x.value}: ${x.how}${x.at ? ` "${request.slice(...x.at)}"` : ""}`).sort();
  // A form's name said in ordinary words is a choice (its span the words, its value the listed name): never a copy, so
  // no copy head is trained to make `footpath_declaration` of "footpath declaration". So is an option of a form's
  // list and a word of the catalogue; an id, an amount and a count in the same form are copies.
  const form = { form: "footpath_declaration", to: "roads-3", fields: { zone: { type: "choice", options: ["north", "south"] }, proposed_use: { type: "structure_type" }, lot: { type: "lot" }, fee: { type: "amount" }, owner: { type: "entity" } } };
  expect(how("Lodge a footpath declaration with roads-3 for lot-04-11: zone north, proposed use park, fee 120 marks, owner ent.77.", 'form(form=footpath_declaration, to=roads-3, zone=north, proposed_use=park, lot=lot-04-11, fee="120 marks", owner=ent.77)', [form])).toEqual([
    'fee=120 marks: copy "120 marks"', 'form=footpath_declaration: choice "footpath declaration"', 'lot=lot-04-11: copy "lot-04-11"', 'owner=ent.77: copy "ent.77"',
    'proposed_use=park: choice "park"', 'to=roads-3: copy "roads-3"', 'zone=north: choice "north"',
  ]);
  // A kind, a task, a template, a role, a vote's choice, a claim's action: choices, even where the word is spelled as
  // the value is. Who, where, how much and how long: copies.
  expect(how("Have c0013 make 15 at str.2.", 'work(task=make, units="15", at=str.2, by=c0013)')).toEqual(['at=str.2: copy "str.2"', 'by=c0013: copy "c0013"', 'task=make: choice "make"', 'units=15: copy "15"']);
  expect(how("Vote yes on rec.3.", "vote(ballot=rec.3, choice=yes)")).toEqual(['ballot=rec.3: copy "rec.3"', 'choice=yes: choice "yes"']);
  expect(how("My vote on rec.3 goes to c5325.", "vote(ballot=rec.3, choice=c5325)")).toContain('choice=c5325: copy "c5325"'); // (a candidate is copied)
  expect(how("Set up a Land Trust called River Land Trust.", 'entity(kind=land_trust, name="River Land Trust")')).toEqual(['kind=land_trust: choice "Land Trust"', 'name=River Land Trust: copy "River Land Trust"']);
  // What the wording implies has no span: a flag, a claim's kind, a newcomer's sex (though the word may be there), a
  // wait of no time.
  expect(how("Rosa Thorne, a female apprentice aged 18 years, is arriving.", 'presence(name="Rosa Thorne", age="18 years", sex=female, template=apprentice)')).toEqual([
    'age=18 years: copy "18 years"', 'name=Rosa Thorne: copy "Rosa Thorne"', "sex=female: implied", 'template=apprentice: choice "apprentice"',
  ]);
  expect(how("c0193 is moving out of apts-2.", "occupancy(in=apts-2, leave=yes, who=c0193)")).toContain("leave=yes: implied");
  expect(how("Record that c0042 may build on lot-12-03, for all to see.", 'claim(position=liberty, holder=c0042, visible=public, about={"action":"build","object":"lot-12-03"})')).toEqual([
    'about.action=build: choice "build"', 'about.object=lot-12-03: copy "lot-12-03"', 'holder=c0042: copy "c0042"', "position=liberty: implied", "visible=public: implied",
  ]);
  expect(how("Pay 650.99 to acc.66 monthly, starting now.", 'money(to=acc.66, amount="650.99", every="monthly", first="0 days")')).toContain("first=0 days: implied");
  // An id that is an ordinary word, said with a capital, was chosen for the word and not copied from it.
  expect(how("Pay the Builder $5.", 'money(to=builder, amount="$5")')).toContain('to=builder: choice "Builder"');
  expect(how("Pay builder $5.", 'money(to=builder, amount="$5")')).toContain('to=builder: copy "builder"');
  // In the data: every span has its how, a copy's characters are its value, and the manifest counts each.
  const gold = [...synthetic({ seed: 8, perFunction: 12 }), ...syntheticForms({ sets: 6, perForm: 2, seed: 8 })];
  const r = await generate(gold, { writers: [writer("a", (program) => `See to this: ${needed(calls.parseProgram(program)).map((n) => (n.exact ? n.value : n.value.replace(/_/g, " "))).join(", ")}.`)], perGold: 1, styles: ["formal"] });
  const spans = r.examples.flatMap((e) => (e.spans ?? []).map((s) => ({ e, s })));
  expect(spans.length).toBeGreaterThan(500);
  for (const { e, s } of spans) {
    expect(["copy", "choice", "implied"]).toContain(s.how);
    expect([s.arg, s.how === "implied"]).toEqual([s.arg, s.at === undefined]);
    if (s.how === "copy") expect(e.request.slice(...s.at!)).toBe(s.value);
    const key = s.arg.slice(s.arg.lastIndexOf(".") + 1);
    if (["sex", "leave", "then"].includes(key)) expect([key, s.how]).toEqual([key, "implied"]);
    // (An entry on one's own file: its kind is implied by the wording, as whose file is.)
    const entry = key === "kind" && s.value === "entry" && e.program.includes("visible=own");
    if (entry || (key === "visible" && s.value === "own")) expect([key, s.value, s.how]).toEqual([key, s.value, "implied"]);
    else if (e.shape.startsWith("form(") ? key === "form" : ["kind", "task", "type", "template", "role", "survey"].includes(key) && !/[0-9.\/-]/.test(s.value) && !/\s/.test(s.value)) expect([key, s.value, s.how]).toEqual([key, s.value, "choice"]);
    if (s.value.includes("_")) expect([s.value, s.how]).toEqual([s.value, "choice"]);
  }
  expect(r.manifest.spans).toEqual({ copy: spans.filter((x) => x.s.how === "copy").length, choice: spans.filter((x) => x.s.how === "choice").length, implied: spans.filter((x) => x.s.how === "implied").length });
  for (const n of Object.values(r.manifest.spans)) expect(n).toBeGreaterThan(20);
});

// ---------------------------------------------------------------- generated gold (train/synthetic.ts)

const fnOf = (g: Gold) => functionOf(g);
const linesOf = (program: string) => (calls.parseProgram(program) as { lines: calls.Line[] }).lines;
/** Every argument of a program, nested calls included, as [function, argument, value]. */
function argsOf(program: string): [string, string, calls.Value][] {
  const out: [string, string, calls.Value][] = [];
  const walk = (c: calls.Call) => Object.entries(c.args).forEach(([k, v]) => (out.push([c.fn, k, v]), "call" in v && walk(v.call)));
  linesOf(program).forEach((l) => walk(l.call));
  return out;
}

test("generated gold: a few hundred different programs for every function of the contract, each one valid and askable, the same for the same seed", () => {
  const gold = synthetic({ seed: 4 });
  const by = new Map<string, Gold[]>();
  for (const g of gold) (by.get(fnOf(g)) ?? by.set(fnOf(g), []).get(fnOf(g))!).push(g);
  // Every function the contract's argument table has, and no other.
  expect([...by.keys()].sort()).toEqual(Object.keys(calls.ARGS).sort());
  for (const [fn, gs] of by) {
    expect([fn, gs.length]).toEqual([fn, 300]);
    expect(new Set(gs.map((g) => g.program)).size).toBe(300);
  }
  for (const g of gold) {
    const p = calls.parseProgram(g.program);
    expect(calls.contractErrors(p)).toEqual([]);
    // (A paper of an office's own has more to say than a sentence or two holds: up to fourteen values. Since 0.12.0.)
    if (g.tag === "paper" && whyNot(p) !== undefined) expect([g.program, whyNot(p), literals(p).length <= 14]).toEqual([g.program, "more than ten values", true]);
    else expect([g.program, whyNot(p)]).toEqual([g.program, undefined]);
    expect(g.program).toBe(goldText(p)); // as gold is kept
    expect(g.shape).toBe(shapeOf(p));
    expect(g.origin).toBe("synthetic");
  }
  expect(synthetic({ seed: 4 })).toEqual(gold);
  expect(synthetic({ seed: 5 }).map((g) => g.program)).not.toEqual(gold.map((g) => g.program));
  // One function's programs don't depend on which others are asked for, or on how many.
  expect(synthetic({ seed: 4, only: ["claim"], perFunction: 40 })).toEqual(by.get("claim")!.slice(0, 40));
});

test("generated gold covers each function's ways of being used, and every argument a request can carry", () => {
  const gold = synthetic({ seed: 4 });
  const shapes = new Set(gold.map((g) => g.shape));
  const has = (fn: string, ...args: string[]) => gold.some((g) => linesOf(g.program).some((l) => l.call.fn === fn && args.every((a) => a in l.call.args) && Object.keys(l.call.args).length === args.length));
  expect(has("position", "title", "role") && has("position", "title") && has("position", "appoint", "to") && has("position", "vacate")).toBe(true);
  expect(has("entity", "kind", "name") && has("entity", "kind", "name", "position")).toBe(true);
  expect(has("claim", "position", "holder", "about") && has("claim", "transfer", "to") && has("claim", "release")).toBe(true);
  expect(gold.some((g) => /^claim\(.*against=.*basis=/.test(g.program))).toBe(true);
  expect(has("system", "template") && has("system", "template", "title") && has("system", "retire")).toBe(true);
  expect(has("account", "holder") && has("account", "holder", "at") && has("account", "close")).toBe(true);
  expect(has("presence", "leave") && has("presence", "who") && has("presence", "name", "age", "template")).toBe(true);
  expect(has("structure", "type", "on") && has("structure", "remove", "by") && has("structure", "type", "on", "by", "price", "from", "basis")).toBe(true);
  expect(has("agreement", "sign") && has("agreement", "notice")).toBe(true);
  expect(has("statement", "withdraw") && has("vote", "ballot", "choice") && has("harm", "who") && has("birth", "name", "template", "with")).toBe(true);
  expect(has("occupancy", "in") && has("occupancy", "in", "leave") && has("take", "kind", "quantity", "from", "at")).toBe(true);
  // An offer with what each side commits to, as nested calls.
  expect([...shapes].some((s) => /^agreement\(.*they_do=money\(.*we_do=occupancy\(/.test(s))).toBe(true);
  expect([...shapes].some((s) => /we_do=goods\(/.test(s))).toBe(true);
  // A letter to one, and to several.
  expect(gold.some((g) => /^message\(.*to=\[/.test(g.program)) && gold.some((g) => /^message\(.*to=[a-z"]/.test(g.program))).toBe(true);
  // Every argument the contract allows is used somewhere, but the ones out of the first model's scope (structured
  // data, a rule's formal condition), a keeper's bookkeeping, and `for` where nothing reads it (goods, work: only a
  // payment has a purpose), and `agreement.hours` (2026-10-13: an employer's offer in a world with a law on hours; no
  // request a seat gets carries it yet: the translator learns it with its next round of forms), and `money.line` (taught from prompt 0.9.5; the default recipes make none, so the data of a seed is what it was, and `lateKinds` makes them: translator/test/train-late.test.ts).
  const used = new Set(gold.flatMap((g) => argsOf(g.program).map(([fn, k]) => `${fn}.${k}`)));
  const left = Object.entries(calls.ARGS).flatMap(([fn, a]) => [...(a.allowed ?? [])].map((k) => `${fn}.${k}`)).filter((k) => !used.has(k));
  expect(left.sort()).toEqual([...JSON_OUT_OF_SCOPE, "money.per_request", "statement.formal", "goods.for", "work.for", "agreement.hours", "money.line"].sort());
  // No structured data but a list of names and a claim's slots.
  for (const g of gold) for (const [fn, k, v] of argsOf(g.program)) if ("json" in v && !Array.isArray(v.json)) expect(`${fn}.${k}`).toBe("claim.about");
});

test("generated gold: programs of several lines are dependent ones, values vary enough that they must be copied, and money is many worlds'", () => {
  const gold = synthetic({ seed: 4 });
  const several = gold.filter((g) => g.program.includes("\n"));
  expect(several.length).toBeGreaterThan(100);
  for (const g of several) {
    const lines = linesOf(g.program);
    // Each later line uses a name an earlier line bound: an organisation and its charter, never two unrelated requests.
    expect(lines[0]!.bind).toBeDefined();
    for (const l of lines.slice(1)) expect(Object.values(l.call.args).some((v) => "var" in v && lines.some((x) => x.bind === v.var))).toBe(true);
  }
  expect(new Set(several.map((g) => g.shape.split("(")[0])).size).toBeGreaterThanOrEqual(6);
  // Ids in the styles logs show.
  const text = gold.map((g) => g.program).join("\n");
  for (const style of [/\bacc-[a-z0-9-]+/, /\brec\.\d+/, /\bc\d{4}\b/, /\bent\.\d+/, /\blot-\d\d-\d\d\b/, /\bstr\.\d+/, /\b[a-z]+-\d+\/[a-z]+\.\d+/, /\bjob-|cell\.\d+\.\d+/]) expect(style.test(text)).toBe(true);
  // Who is paid, and how much: hundreds of different values in 300 payments.
  const money = gold.filter((g) => fnOf(g) === "money" && !g.program.includes("\n"));
  const arg = (g: Gold, k: string) => calls.callText({ fn: "harm", args: { who: linesOf(g.program)[0]!.call.args[k]! } });
  expect(new Set(money.map((g) => arg(g, "to"))).size).toBeGreaterThan(200);
  expect(new Set(money.map((g) => arg(g, "amount"))).size).toBeGreaterThan(200);
  // Someone by id (with a name the writer is told), by name alone, or only described.
  expect(money.some((g) => Object.keys(g.names).length > 0)).toBe(true);
  expect(money.some((g) => / to="[A-Z]/.test(g.program)) && money.some((g) => / to="the /.test(g.program))).toBe(true);
  // Every amount reads in its own world's money; the worlds differ in sign, code, words and decimal places.
  const currencies = new Set<string>();
  for (const g of gold) for (const [, k, v] of argsOf(g.program)) if (["amount", "price", "carrying"].includes(k) && "text" in v) {
    expect(() => calls.parseAmount(v.text, g.currency!)).not.toThrow();
    currencies.add(g.currency!.code);
  }
  expect(currencies.size).toBe(everyCurrency().length); // (the invented worlds' and each profile's)
  expect(CURRENCIES.some((c) => c.symbol && c.minor_units === 2) && CURRENCIES.some((c) => !c.symbol) && CURRENCIES.some((c) => c.minor_units === 0) && CURRENCIES.some((c) => c.minor_units === 3)).toBe(true);
  const written = money.map((g) => (linesOf(g.program)[0]!.call.args.amount as { text: string }).text);
  expect(written.some((a) => /^[0-9][0-9,.]*$/.test(a)) && written.some((a) => /^[A-Z]{3} /.test(a)) && written.some((a) => / [a-z]+$/.test(a)) && written.some((a) => /^[^A-Za-z0-9]/.test(a)) && written.some((a) => /\.\d{3}$/.test(a))).toBe(true);
});

// ---------------------------------------------------------------- invented forms

test("invented forms: every type of field the resolver reads, two to seven fields, choices of two to five, shown exactly as the translator is shown a form", () => {
  const sets = formSets({ sets: 30, seed: 2 });
  const forms = sets.flat();
  expect(formSets({ sets: 30, seed: 2 })).toEqual(sets);
  const types = new Set<string>();
  for (const f of forms) {
    expect(f.form).toMatch(/^[a-z]+(_[a-z]+){0,2}$/);
    const fields = Object.entries(f.fields);
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(fields.length).toBeLessThanOrEqual(7);
    for (const [name, x] of fields) {
      expect(name).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      expect(["form", "to", "for"]).not.toContain(name);
      types.add(x.type);
      if (x.type === "choice") expect(x.options!.length >= 2 && x.options!.length <= 5).toBe(true);
    }
  }
  expect([...types].sort()).toEqual([...FIELD_TYPES].sort());
  expect(forms.some((f) => Object.values(f.fields).some((x) => x.required)) && forms.some((f) => Object.values(f.fields).some((x) => !x.required))).toBe(true);
  // One to three words; a set is two to four forms (five where two offices have one by the same name).
  expect(new Set(forms.map((f) => f.form.split("_").length))).toEqual(new Set([1, 2, 3]));
  for (const set of sets) expect(set.length >= 2 && set.length <= 5).toBe(true);
  // No form of one set has the name of a form in another: a split by form can keep whole sets apart.
  const where = new Map<string, number>();
  sets.forEach((set, i) => set.forEach((f) => (expect(where.get(f.form) ?? i).toBe(i), where.set(f.form, i))));
  // The line an example carries is the line the translator's context has, character for character.
  for (const set of sets.slice(0, 10)) {
    const context = translatorContext({ draftId: "d", participant: "someone", proposal: "x", knowledge: knowing(set, CURRENCIES[0]!) });
    expect(context.split("\n").slice(3).sort()).toEqual(set.map(formLine).sort());
  }
  expect(formLine({ form: "permit_application", to: "planning", fields: { lot: { type: "lot", required: true }, kind: { type: "choice", options: ["new", "renewal"] } } })).toBe("- permit_application, to=planning, id form-planning-permit-application: fields lot (lot, required), kind (one of new | renewal)");
});

test("invented forms filled in: every required field, some of the others, always with the office it goes to, beside other forms or alone; the resolver takes each", () => {
  const gold = syntheticForms({ sets: 30, perForm: 5, seed: 2 });
  expect(gold.length).toBeGreaterThan(400);
  let withTo = 0, alone = 0, beside = 0, optional = 0;
  for (const g of gold) {
    const c = linesOf(g.program)[0]!.call;
    const name = formOf(g.program)!.form;
    const own = g.forms!.filter((f) => f.form === name);
    const spec = own.find((f) => !("to" in c.args) || f.to === (c.args.to as { id: string }).id)!;
    expect(spec).toBeDefined();
    const given = Object.keys(c.args).filter((k) => k !== "form" && k !== "to");
    for (const [k, f] of Object.entries(spec.fields)) if (f.required) expect(given).toContain(k);
    for (const k of given) expect(Object.keys(spec.fields)).toContain(k);
    if (given.some((k) => !spec.fields[k]!.required)) optional++;
    // The call says where it goes (the translator's rules: to= is where the list says), whose form it is included.
    expect("to" in c.args).toBe(true);
    "to" in c.args ? withTo++ : 0;
    g.forms!.length === 1 ? alone++ : beside++;
    expect(g.forms!.length).toBeLessThanOrEqual(4);
    // The resolver, knowing these forms and this world's money, reads every field as its type says.
    const r = resolve(calls.parseProgram(g.program), knowing(g.forms!, g.currency!), () => undefined);
    expect([g.program, r.ok ? "ok" : r.questions.join(" ")]).toEqual([g.program, "ok"]);
    // What the request must carry: the form's name as words, each value.
    expect(needed(calls.parseProgram(g.program)).find((n) => n.arg === "form")).toEqual({ arg: "form", value: name, exact: false, how: "choice" });
  }
  expect(withTo).toBe(gold.length);
  for (const n of [alone, beside, optional]) expect(n).toBeGreaterThan(gold.length / 10);
  expect(syntheticForms({ sets: 30, perForm: 5, seed: 2 })).toEqual(gold);
});

test("a form nobody was shown: the right form is left out and the forms beside it stay", () => {
  const gold = syntheticForms({ sets: 12, perForm: 4, seed: 6 });
  const positives: Example[] = gold.map((g, i) => ({ id: `f${i}`, request: `Fill in ${literals(calls.parseProgram(g.program)).join(", ")}.`, forms: g.forms!.map(formLine), program: g.program, kind: "positive", shape: g.shape, source: g.source, spans: [] }));
  const refused = builtRefusals(positives, 2, 0.05, { unknown_form: 40 }).filter((e) => e.program === "none(unknown_form)");
  expect(refused.length).toBeGreaterThanOrEqual(40);
  let kept = 0;
  for (const e of refused) {
    const from = positives.find((x) => x.request === e.request)!;
    const name = formOf(from.program)!.form;
    expect(e.forms.some((line) => line.startsWith(`- ${name}, to=`))).toBe(false);
    expect(e.forms).toEqual(from.forms.filter((line) => !line.startsWith(`- ${name}, to=`)));
    expect(e.gold).toBe(from.program);
    expect(e.spans).toBeUndefined();
    kept += e.forms.length;
  }
  expect(kept).toBeGreaterThan(0); // other forms are still shown, and aren't to be used in its place
});

// ---------------------------------------------------------------- claims, and what's out of scope

test("a claim's content is carried as slots a model can fill by pointing: the action as a word, the object exactly; the program stays as the call language writes it", () => {
  const program = 'claim(position=liberty, holder=c0042, about={"action":"build","object":"lot-12-03"})';
  const p = calls.parseProgram(program);
  expect(askable(p)).toBe(true);
  expect(needed(p).map((n) => `${n.arg}=${n.value}${n.exact ? "!" : ""}`).sort()).toEqual(["about.action=build", "about.object=lot-12-03!", "holder=c0042!"]);
  const request = "Put on record that c0042 is permitted to build on lot-12-03.";
  expect(copies(request, program)).toBe(true);
  expect(spansIn(request, program).map((x) => `${x.arg}: ${x.at ? request.slice(...x.at) : `(${x.how})`}`).sort()).toEqual(["about.action: build", "about.object: lot-12-03", "holder: c0042", "position: (implied)"]);
  expect(copies("Put on record that c0042 may put something up on lot-12-03.", program)).toBe(false); // the action isn't a word of it
  expect(copies("Put on record that c0042 is permitted to build on lot-12-04.", program)).toBe(false);
  expect(literals(p)).toEqual(["liberty", "c0042", "build", "lot-12-03"]);
  expect(goldText(p)).toBe('claim(about={"action":"build","object":"lot-12-03"}, holder=c0042, position=liberty)');
  // Anything more than named words and ids isn't slots.
  expect(whyNot(calls.parseProgram('claim(position=right, about={"action":"build","limit":3})'))).toBe("structured data: claim.about");
  expect(whyNot(calls.parseProgram('claim(position=right, about={"action":"build","where":{"lot":"lot-1"}})'))).toBe("structured data: claim.about");
});

test("structured data a copying model can't write is out of scope, and counted by function and argument when a log is read", async () => {
  const out: { [k: string]: string } = {
    "statement.data": 'statement(kind=note, text="x", data={"a":1})', "statement.adico": 'statement(kind=law, text="x", adico={"deontic":"must_not"})', "statement.offer": 'statement(kind=offer, text="x", offer={"what":"job"})',
    "statement.practice": 'statement(kind=practice, text="x", practice={"what":"market"})', "statement.assertion": 'statement(kind=finding, text="x", assertion={"of":"c0001"})', "statement.registry": 'statement(kind=register, text="x", registry={"lot":"lot-1"})',
    "presence.variables": 'presence(name="Ana Silva", age="31 years", template=newcomer, variables={"schooling":12})', "position.channels": 'position(title="Baker", channels=[{"kind":"accounts"}])', "position.role_module": 'position(title="Baker", role_module={"id":"x"})',
    "entity.channels": 'entity(kind=firm, name="Riverside Bakery", position="Owner", channels=[{"kind":"accounts"}])', "entity.role_module": 'entity(kind=firm, name="Riverside Bakery", position="Owner", role_module={"id":"x"})',
  };
  expect(Object.keys(out).sort()).toEqual([...JSON_OUT_OF_SCOPE].sort());
  for (const [arg, program] of Object.entries(out)) {
    expect(calls.contractErrors(calls.parseProgram(program))).toEqual([]);
    expect(whyNot(calls.parseProgram(program))).toBe(`structured data: ${arg}`);
  }
  const excluded: { [reason: string]: number } = {};
  const gold = await goldFromLog([...LOG, act(out["statement.data"]!), act(out["presence.variables"]!), act('claim(position=liberty, holder=c0042, about={"action":"build","object":"lot-00"})')], { excluded });
  expect(excluded).toEqual({ "structured data: statement.data": 2, "structured data: presence.variables": 1, "carries out someone's instruction (per_request)": 1 });
  expect(gold.some((g) => g.shape === "claim(about,holder,position)")).toBe(true);
  expect(gold.every((g) => g.origin === "log")).toBe(true);
});

// ---------------------------------------------------------------- money in any world's writing

test("an amount is written as its world writes money: sign or code, words, decimal places; every form reads back as the same number", () => {
  for (const cur of CURRENCIES) {
    const per = 10n ** BigInt(cur.minor_units);
    for (const n of [1n * per, 5_000n * per, 1_234n * per + (per > 1n ? 5n : 0n), 2_000_000n * per, 1_500n * per, 7n]) {
      const forms = amountWritings(n, cur);
      expect(forms.length).toBeGreaterThanOrEqual(3);
      for (const f of forms) expect([cur.code, f, calls.parseAmount(f, cur)]).toEqual([cur.code, f, n.toString()]);
      expect(forms.some((f) => f.startsWith(cur.symbol ?? `${cur.code} `))).toBe(true); // its sign (or its code) before the digits
      expect(forms.some((f) => /^[0-9][0-9,.]*$/.test(f))).toBe(true); // and digits alone: whole units
      if (!cur.symbol) expect(forms.every((f) => /^[0-9A-Z]/.test(f))).toBe(true);
    }
  }
  const yun = CURRENCIES.find((c) => c.minor_units === 0 && c.symbol)!;
  expect(amountWritings(60_000n, yun)).toEqual(expect.arrayContaining([`${yun.symbol}60,000`, `${yun.symbol}60000`, `${yun.symbol}60k`, "60,000 yun", "60,000 YUN", "60,000"]));
  expect(amountWritings(60_000n, yun).some((f) => f.includes("."))).toBe(false); // this money has no decimals
  const dnr = CURRENCIES.find((c) => c.minor_units === 3 && !c.symbol)!;
  expect(amountWritings(1_234_005n, dnr)).toEqual(expect.arrayContaining(["DNR 1,234.005", "1,234.005 dinars", "1,234.005 DNR"]));
  expect(amountForms("DNR 12.500", dnr)).toEqual(expect.arrayContaining(["12.500 dinars", "12500 fils"]));
  // Another world's sign isn't an amount in this one: nothing is offered.
  expect(amountForms("$500", dnr)).toEqual([]);
  // A gold program's other surface is written in its own world's money.
  const g: Gold = { program: 'money(amount="DNR 1,500.000", to=acc-works)', shape: "money(amount,to)", names: {}, source: "t", currency: dnr };
  const seen = new Set<string>();
  const rand = sampler(8);
  for (let i = 0; i < 60; i++) {
    const v = surfaceVariant(g, rand);
    const text = ((calls.parseProgram(v.program) as any).lines[0].call.args.amount as { text: string }).text;
    expect(calls.parseAmount(text, dnr)).toBe("1500000");
    expect(v.family).toBe(g.program);
    seen.add(text);
  }
  expect(seen.size).toBeGreaterThan(4);
  expect([...seen].join(" ")).not.toMatch(/\$|dollar/);
  // With no currency known, amounts are left as they are.
  const bare = surfaceVariant({ ...g, currency: undefined } as any, sampler(8));
  expect(bare.program).toBe(g.program);
});

test("the translator's instructions teach no currency: no sign and no word of any, in the rules, the syntax or the examples", () => {
  const s = translatorSystem();
  expect(s).toContain("An amount is copied exactly as written, with whatever sign or word of money the request used");
  expect(s).not.toMatch(/[$€£¥₩₹₽¢ƒ₤₥₫₪฿¤]/);
  expect(s).not.toMatch(/\b(dollars?|bucks?|cents?|euros?|pounds?|pence|penny|yen|yuan|rupees?|francs?|pesos?|AUD|USD|EUR|GBP|JPY|XYZ)\b/i);
  // The contract's examples are still there, their amounts as digits (an amount in any world).
  expect(s).toContain('money(to=builder, amount="500", for="the fence")');
  expect(s).toContain('price="60,000"');
  expect(s).toContain("  - amounts: whatever the request wrote as one, copied whole");
  expect(s).toContain("  - durations:");
  // The writer of training requests is told the same: copy the amount, whatever money it's in.
  expect(writerSystem()).not.toMatch(/[$€£¥]|\bdollars?\b/);
});

// ---------------------------------------------------------------- how office-holders write

test("styles the pilots' office-holders wrote in: a capacity first, a name with its id in brackets, a citation, a closing \"do not\", stacked clauses", () => {
  for (const style of ["capacity", "named", "cited", "do_not", "stacked"]) expect(Object.keys(STYLES)).toContain(style);
  expect(STYLES.named).toContain("the works manager [works]");
  const g = (program: string, extra: Partial<Gold> = {}): Gold => ({ program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: "t", ...extra });
  const letter = g('message(to=works, text="Start on Monday.")');
  const rand = sampler(3);
  const cap = styleBrief("capacity", letter, rand);
  expect(cap.riders).toEqual([{ kind: "capacity", text: expect.stringMatching(/^As [A-Z][A-Za-z ]+ of [A-Za-z ]+$/) }]);
  expect(cap.instruction).toContain(`"${cap.riders[0]!.text},"`);
  const no = styleBrief("do_not", letter, rand);
  expect(no.riders[0]!.kind).toBe("do_not");
  expect(no.riders[0]!.text).toMatch(/[Dd]o(es)? not /);
  // Now and then two of them, as the pilots' later requests close: each a rider.
  const closings = Array.from({ length: 60 }, () => styleBrief("do_not", letter, rand));
  expect(new Set(closings.map((b) => b.riders.length))).toEqual(new Set([1, 2]));
  for (const b of closings) for (const r of b.riders) expect(b.instruction).toContain(`"${r.text}"`);
  // A citation is a rider only where no argument of the call could absorb it: a vote has nowhere to put a record cited.
  const cite = styleBrief("cited", g("vote(ballot=rec.3, choice=yes)"), rand);
  expect(cite.riders).toEqual([{ kind: "citation", text: expect.stringMatching(/ (law-[a-z]+|rec\.\d+)$/) }]);
  // A letter does (what it is about, re=: "in accordance with rec.3495" on a letter was read as that), so it gets none;
  // one that already says what it is about has that record worded as the citation.
  expect(styleBrief("cited", letter, rand)).toEqual({ style: "formal", instruction: STYLES.formal!, riders: [] });
  expect(styleBrief("cited", g('message(to=works, text="Start on Monday.", re=rec.9)'), rand)).toMatchObject({ style: "cited", riders: [] });
  // Where the call cites a record, that record is what's worded as the citation, and it's no rider.
  const withBasis = styleBrief("cited", g('structure(type=shed, on=lot-07, by=acme, price="9,000", basis=rec.30)'), rand);
  expect(withBasis).toMatchObject({ style: "cited", riders: [] });
  // Where it could cite one and doesn't, a citation would change the program: written formally, with none.
  expect(styleBrief("cited", g('money(to=acc-1, amount="500")'), rand)).toEqual({ style: "formal", instruction: STYLES.formal!, riders: [] });
  // A form with a field for a record: the same.
  const spec = { form: "appeal", to: "planning", fields: { permit: { type: "record" }, reason: { type: "text", required: true } } };
  expect(styleBrief("cited", g('form(form=appeal, reason="Too tall.")', { forms: [spec] }), rand).riders).toEqual([]);
  expect(styleBrief("cited", g('form(form=appeal, reason="Too tall.")', { forms: [{ ...spec, fields: { reason: spec.fields.reason } }] }), rand).riders.length).toBe(1);
  expect(styleBrief("terse", letter, rand)).toEqual({ style: "terse", instruction: STYLES.terse!, riders: [] });
  expect(withoutRiders("As Mayor of Eastmere, tell works.", [{ kind: "capacity", text: "As Mayor of Eastmere" }])).toBe(`${"\u0001".repeat(20)}, tell works.`);
});

test("a rider adds nothing to the program, and the example says so: where it is, and that the program's values are found outside it", async () => {
  const gold: Gold[] = [
    { program: "position(appoint=works, to=c0042)", shape: "position(appoint,to)", names: { works: "Works Manager" }, source: "t", origin: "synthetic" },
    { program: "vote(ballot=rec.3, choice=yes)", shape: "vote(ballot,choice)", names: {}, source: "t", origin: "synthetic" },
  ];
  const r = await generate(gold, { writers: [writer("a", obliging)], perGold: 3, styles: ["capacity", "cited", "do_not"], seed: 5 });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(positives.length).toBe(6);
  expect(r.manifest.riders).toMatchObject({ capacity: 2, citation: 2 });
  expect(r.manifest.riders.do_not).toBeGreaterThanOrEqual(2);
  expect(r.manifest.by_style).toMatchObject({ capacity: 2, cited: 2, do_not: 2 });
  expect(r.manifest.by_function).toMatchObject({ position: 3, vote: 3 });
  expect(r.manifest.by_origin).toMatchObject({ synthetic: 6 });
  for (const e of positives) {
    expect(e.program).toBe(gold.find((g) => g.shape === e.shape)!.program); // the program is the gold one, rider or no rider
    expect(e.riders!.length).toBe(e.style === "do_not" ? e.riders!.length : 1);
    for (const rider of e.riders!) {
      expect(rider.adds).toBe("nothing");
      expect(e.request.slice(...rider.at)).toBe(rider.text);
      // No value of the program is pointed at inside the rider ("Works" in "As Works Manager of …" isn't the post).
      for (const s of e.spans!) if (s.at) expect(s.at[1] <= rider.at[0] || s.at[0] >= rider.at[1]).toBe(true);
    }
    expect(e.gold).toBe(e.program);
  }
  // A writer that leaves the given words out: nothing is kept.
  const careless = await generate(gold, { writers: [writer("b", saying)], perGold: 3, styles: ["capacity", "cited", "do_not"], seed: 5 });
  expect(careless.examples.filter((e) => e.kind === "positive")).toEqual([]);
  expect(careless.manifest.dropped.not_copied).toBe(6);
});

test("a form's examples carry the form as the translator is shown it, and the model translating back is shown it too", async () => {
  const gold = syntheticForms({ sets: 3, perForm: 2, seed: 9 });
  const shown: string[][] = [];
  const programs = new Map<string, string>();
  const w = writer("a", (program, style) => {
    const request = obliging(program, style);
    programs.set(request, program);
    return request;
  });
  const r = await generate(gold, { writers: [w], perGold: 1, styles: ["terse"], seed: 2, refusalFloor: 2,
    back: { model: "stand-in/back", translate: async (request, forms, g) => (shown.push(forms), g && expect(forms).toEqual(g.forms!.map(formLine)), programs.get(request)) } });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(positives.length).toBe(gold.length);
  for (const e of positives) {
    const g = gold.find((x) => x.program === e.program)!;
    expect(e.forms).toEqual(g.forms!.map(formLine));
    expect(e.forms.some((line) => line.startsWith(`- ${formOf(e.program)!.form}, to=`))).toBe(true);
  }
  expect(shown.some((f) => f.length > 1)).toBe(true);
  // The writer was told the form's fields, to give each value against the form's own label for it.
  expect(writerSystem()).toContain("give each value against the form's own label for it");
  // The floor on refusals: what could be built was, and what came out short is said.
  expect(r.manifest.refusal_floor).toBe(2);
  expect(r.examples.filter((e) => e.program === "none(unknown_form)").length).toBeGreaterThanOrEqual(2);
  expect(Object.keys(r.manifest.short_of_floor!)).toEqual(expect.arrayContaining(["not_yours", "unclear"])); // the stand-in back-translator knows no refusals
});

// ---------------------------------------------------------------- training and validation

/** Examples as generate would make them, from gold programs, `per` requests each. */
const examplesOf = (gold: Gold[], per: number): Example[] => gold.flatMap((g, gi) => Array.from({ length: per }, (_, i) => ({
  id: `e${gi}.${i}`, request: `(${i}) ${literals(calls.parseProgram(g.program)).join(", ")}.`, forms: (g.forms ?? []).map(formLine), program: g.program, kind: "positive" as const, shape: g.shape, source: g.source, gold: g.family ?? g.program,
})));

test("the split is by gold program: all of a program's requests on one side, a share of every function, the same for the same seed", () => {
  const gold = synthetic({ seed: 3, perFunction: 40, only: ["money", "claim", "harm", "position", "agreement"] });
  // A program on another surface is the same program: its family goes together.
  const variants = gold.slice(0, 30).map((g) => ({ ...surfaceVariant(g, sampler(1)), program: `${g.program}\n` }));
  const examples = [...examplesOf(gold, 3), ...examplesOf(variants, 2)];
  // A refusal written from a payment goes with that payment; one from a brief alone is its own.
  examples.push({ id: "calc", request: "Pay them half.", forms: [], program: "none(needs_calculation)", kind: "refusal", shape: "none(needs_calculation)", source: "written: t", gold: gold[0]!.program });
  for (let i = 0; i < 8; i++) examples.push({ id: `u${i}`, request: `Sort out thing ${i}.`, forms: [], program: "none(unclear)", kind: "refusal", shape: "none(unclear)", source: "written: brief" });
  const s = split(examples, { validation: 0.2, seed: 7 });
  expect(s.train.length + s.validation.length).toBe(examples.length);
  const side = (e: Example) => (s.validation.includes(e) ? "validation" : "train");
  const sideOf = new Map<string, string>();
  for (const e of examples) {
    const k = e.gold ?? e.id;
    expect(sideOf.get(k) ?? side(e)).toBe(side(e));
    sideOf.set(k, side(e));
  }
  expect(side(examples.find((e) => e.id === "calc")!)).toBe(sideOf.get(gold[0]!.program)!);
  // A fifth of each function's programs, and of the refusals.
  for (const fn of ["money", "claim", "harm", "position", "agreement"]) expect(s.report[fn]).toMatchObject({ train: { gold: 32 }, validation: { gold: 8 } });
  expect(s.report["none(unclear)"]).toMatchObject({ train: { gold: 6, examples: 6 }, validation: { gold: 2, examples: 2 } });
  expect(s.report.money!.train.examples + s.report.money!.validation.examples).toBe(examples.filter((e) => functionOf(e) === "money").length + 1); // (with the refusal made from a payment)
  expect(split(examples, { validation: 0.2, seed: 7 })).toEqual(s);
  expect(split(examples, { validation: 0.2, seed: 8 }).validation.map((e) => e.id)).not.toEqual(s.validation.map((e) => e.id));
  // Too few programs of a kind to spare any: all in training.
  const few = split(examplesOf(gold.slice(0, 3), 2), { validation: 0.5, seed: 1 });
  expect(few.validation).toEqual([]);
});

test("the split is by form for form examples: a validation form is never shown in training, as the one to fill in or beside another", () => {
  const forms = syntheticForms({ sets: 30, perForm: 4, seed: 2 });
  const others = synthetic({ seed: 3, perFunction: 30, only: ["money", "vote"] });
  const positives = examplesOf([...forms, ...others], 2);
  const all = [...positives, ...builtRefusals(positives, 4, 0.05, { unknown_form: 30 })];
  const s = split(all, { validation: 0.2, seed: 5 });
  const names = (es: Example[]) => new Set(es.flatMap((e) => e.forms.map((line) => line.slice(2, line.indexOf(", to=")))));
  const train = names(s.train), validation = names(s.validation);
  expect(validation.size).toBeGreaterThan(5);
  for (const n of validation) expect(train.has(n)).toBe(false);
  // Nor is a validation form's request, refused for want of the form, in training.
  const requests = new Set(s.train.map((e) => e.request));
  for (const e of s.validation.filter((x) => x.kind === "positive")) expect(requests.has(e.request)).toBe(false);
  expect(s.report.form!.validation.gold).toBe(6); // whole sets: a fifth of thirty
  // Refusals built from several requests are built again on each side, from that side's own.
  for (const side of [s.train, s.validation]) {
    const own = new Set(side.filter((e) => e.kind === "positive").map((e) => e.id));
    const many = side.filter((e) => e.program === "none(too_much)");
    expect(many.length).toBeGreaterThan(0);
    for (const e of many) for (const id of e.built_from!) expect(own.has(id)).toBe(true);
  }
  for (const e of s.validation.filter((x) => x.program === "none(unknown_form)")) expect(validation.has(formOf(positives.find((x) => x.request === e.request)!.program)!.form)).toBe(true);
  // A refusal built from one positive (the same request, with the form left out of what's known) is on the side its
  // positive is on, and it is the refusal that was built: none is lost, none made anew, none has its twin across the split.
  const refused = all.filter((e) => e.program === "none(unknown_form)");
  expect(refused.length).toBeGreaterThanOrEqual(30);
  const sideOf = new Map<string, string>([...s.train.map((e): [string, string] => [e.id, "train"]), ...s.validation.map((e): [string, string] => [e.id, "validation"])]);
  for (const e of refused) {
    const twin = positives.find((p) => p.request === e.request)!;
    expect(e.gold).toBe(twin.gold);
    expect([e.id, sideOf.get(e.id)]).toEqual([e.id, sideOf.get(twin.id)]);
  }
  expect(refused.some((e) => sideOf.get(e.id) === "validation") && refused.some((e) => sideOf.get(e.id) === "train")).toBe(true);
  expect([...s.train, ...s.validation].filter((e) => e.program === "none(unknown_form)").length).toBe(refused.length);
});

test("gold from the seen cases: a form filled in carries the form the test's mayor knows of, and amounts are in the test town's money", () => {
  const gold = goldFromCases(CASES);
  const forms = gold.filter((g) => functionOf(g) === "form");
  expect(forms.length).toBeGreaterThan(0);
  // (Each carries its own form and no other: the planning permit, or, since 0.12.0, a form that is one office's own.)
  for (const g of forms) expect(g.forms!.map((f) => f.form)).toEqual([formOf(g.program)!.form]);
  const permits = forms.filter((g) => formOf(g.program)!.form === "permit_application");
  expect(permits.length).toBeGreaterThan(2);
  for (const g of permits) expect(g.forms!.map(formLine)).toEqual(["- permit_application, to=planning, id form-permit: fields lot (lot, required), structure_type (structure_type, required), notes (text)"]);
  expect(gold.every((g) => g.origin === "case" && g.currency === TEST_CURRENCY)).toBe(true);
});

test("gold from a log carries its world's money and, for a form filled in, the form as the world's config has it", async () => {
  const header2 = JSON.stringify({ kind: "header", body: { config: { world: { currencies: [{ code: "YUN", minor_units: 0, symbol: "¥" }], entities: [] },
    records: [
      { id: "form-stall", kind: "form", record: "statement", in_position: "markets", speaks_for: "city", data: { form: "stall_permit", submit_as: "stall_permit", submit_to: ["city"], fields: { fee: { type: "amount", required: true }, site: { type: "lot", description: "Where." } } } },
      { id: "form-noise", kind: "form", record: "statement", speaks_for: "city", data: { form: "noise_complaint", submit_as: "complaint", submit_to: ["city"], fields: { details: { type: "text", required: true } } } },
    ] } } });
  const gold = await goldFromLog([header2, act('form(form=stall_permit, fee="¥4,000", site=lot-01-02)'), act('money(to=acc-1, amount="¥500")')], { seed: 2 });
  expect(gold.map((g) => g.currency?.code)).toEqual(["YUN", "YUN"]);
  const form = gold.find((g) => g.shape.startsWith("form("))!;
  expect(form.forms!.map(formLine)).toContain("- stall_permit, to=markets, id form-stall: fields fee (amount, required), site (lot)");
  expect(form.forms!.every((f) => ["stall_permit", "noise_complaint"].includes(f.form))).toBe(true);
  // Its other surface is written in that world's money.
  const rand = sampler(1);
  for (let i = 0; i < 20; i++) expect(calls.parseAmount(((calls.parseProgram(surfaceVariant(form, rand).program) as any).lines[0].call.args.fee as { text: string }).text, form.currency!)).toBe("4000");
});

// ---------------------------------------------------------------- what the audit of a trial found (2026-10-06)

test("two programs are compared by value: an amount, a time, a count, a flag, one id or a list of it, a letter to each; a near miss still differs", () => {
  const cur = CURRENCIES[0]!; // a sign before, two decimals, words for the unit and its smallest part
  const same = (a: string, b: string) => sameProgram(a, b, { currency: cur });
  // An amount, by what it comes to in the world's money; a different amount or a different account is different.
  expect(same('money(to=acc-1, amount="$1,500")', 'money(to=acc-1, amount="1.5k")')).toBe(true);
  expect(same('money(to=acc-1, amount="$1,500")', 'money(to=acc-1, amount="150000 cents")')).toBe(true);
  expect(same('money(to=acc-1, amount="$1,500")', 'money(to=acc-1, amount="$1,501")')).toBe(false);
  expect(same('money(to=acc-1, amount="$1,500")', 'money(to=acc-2, amount="$1,500")')).toBe(false);
  // (With no currency known, an amount is what's written and nothing more.)
  expect(sameProgram('money(to=acc-1, amount="$1,500")', 'money(to=acc-1, amount="1.5k")')).toBe(false);
  expect(sameProgram('money(to=acc-1, amount="$1,500")', 'money(to=acc-1, amount="$1,500")')).toBe(true);
  // A length of time, nested in a commitment too: "every 28 days" is "28 days" is "4 weeks".
  const lease = (every: string) => `agreement(with=c3935, term="2 years", we_do=money(to=acc-1, amount="236.55", every="${every}"))`;
  expect(same(lease("every 28 days"), lease("28 days"))).toBe(true);
  expect(same(lease("every 28 days"), lease("4 weeks"))).toBe(true);
  expect(same(lease("monthly"), lease("30 days"))).toBe(true);
  expect(same(lease("every 28 days"), lease("30 days"))).toBe(false);
  expect(same('agreement(with=c1, term="2 years")', 'agreement(with=c1, term="24 months")')).toBe(false); // (a year is 365 days, a month 30)
  // A count, in words or digits, quoted or bare.
  expect(same('work(task=make, units="six", at=str.1)', "work(task=make, units=6, at=str.1)")).toBe(true);
  expect(same('goods(kind=rope, quantity="16", at=str.1)', "goods(kind=rope, quantity=16, at=str.1)")).toBe(true);
  expect(same('work(task=make, units="six", at=str.1)', 'work(task=make, units="7", at=str.1)')).toBe(false);
  // A yes-or-no flag in any accepted spelling; "no" is the flag left out. Gold programs write one spelling.
  expect(same("occupancy(in=str.181, leave=yes, who=par.568)", "occupancy(in=str.181, leave=true, who=par.568)")).toBe(true);
  expect(same("presence(leave=yes)", 'presence(leave="Yes")')).toBe(true);
  expect(same("occupancy(in=str.181, leave=no)", "occupancy(in=str.181)")).toBe(true);
  expect(same("occupancy(in=str.181, leave=yes)", "occupancy(in=str.181)")).toBe(false);
  expect(same("presence(leave=yes, who=c0045)", "presence(leave=c0045)")).toBe(false); // (the resolver doesn't read that as c0045 leaving)
  expect(goldText(calls.parseProgram("occupancy(in=str.181, leave=true)"))).toBe("occupancy(in=str.181, leave=yes)");
  expect(goldText(calls.parseProgram("presence(leave=yes, who=c0045)"))).toBe("presence(leave=yes, who=c0045)");
  // One id, or a list of it; a list is a set.
  expect(same('work(task=make, units="3", at=str.2, by=c0013)', 'work(task=make, units="3", at=str.2, by=["c0013"])')).toBe(true);
  expect(same('work(task=make, units="3", at=str.2, by=["c0013","c0014"])', 'work(task=make, units="3", at=str.2, by=["c0014","c0013"])')).toBe(true);
  expect(same('work(task=make, units="3", at=str.2, by=c0013)', 'work(task=make, units="3", at=str.2, by=c0014)')).toBe(false);
  expect(same('work(task=make, units="3", at=str.2, by=["c0013","c0014"])', 'work(task=make, units="3", at=str.2, by=c0013)')).toBe(false);
  // A letter to two, or the same letter to each: the same. Not so work: its units are the whole job.
  expect(same('message(to=["c0013","ent.9"], text="Start on Monday.")', 'message(to=c0013, text="Start on Monday.")\nmessage(to=ent.9, text="Start on Monday.")')).toBe(true);
  expect(same('message(to=["c0013","ent.9"], text="Start on Monday.")', 'message(to=c0013, text="Start on Monday.")\nmessage(to=ent.9, text="Start on Tuesday.")')).toBe(false);
  expect(same('message(to=["c0013","ent.9"], text="Start on Monday.")', 'message(to=c0013, text="Start on Monday.")')).toBe(false);
  expect(same('work(task=harvest, units="4", at=str.753, by=["ent.2368","ent.186"])', 'work(task=harvest, units="4", at=str.753, by=ent.2368)\nwork(task=harvest, units="4", at=str.753, by=ent.186)')).toBe(false);
  // A kind in words is the label the resolver makes of it; a purpose without its article or its full stop.
  expect(same('statement(kind="price list", text="Bread is 3.")', 'statement(kind=price_list, text="Bread is 3.")')).toBe(true);
  expect(same('statement(kind=notice, text="Bread is 3.")', 'statement(kind=notice, text="Bread is 4.")')).toBe(false);
  expect(same('money(to=acc-1, amount="$5", for="The energy bill.")', 'money(to=acc-1, amount="$5", for="energy bill")')).toBe(true);
  expect(same('money(to=acc-1, amount="$5", for="the energy bill")', 'money(to=acc-1, amount="$5", for="the water bill")')).toBe(false);
  // A form: by its name, in words or by its record's id; its office left out is where the forms known say it goes;
  // its fields by their types.
  const forms = [{ form: "stall_permit", to: "markets-1", id: "form-stall", fields: { fee: { type: "amount" }, stalls: { type: "count" }, period: { type: "duration" }, notes: { type: "text" } } }];
  const filled = 'form(form=stall_permit, to=markets-1, fee="$40", stalls="16", period="2 weeks")';
  const sameForm = (b: string) => sameProgram(filled, b, { currency: cur, forms });
  expect(sameForm('form(form="stall permit", fee="4000 cents", stalls=16, period="14 days")')).toBe(true);
  expect(sameForm('form(form=form-stall, to=markets-1, fee="$40.00", stalls="16", period="a fortnight")')).toBe(true);
  expect(sameForm('form(form=stall_permit, to=parks-2, fee="$40", stalls="16", period="2 weeks")')).toBe(false);
  expect(sameForm('form(form=stall_permit, to=markets-1, fee="$41", stalls="16", period="2 weeks")')).toBe(false);
  expect(sameForm('form(form=stall_permit, to=markets-1, fee="$40", stalls="16", period="2 weeks", notes="16")')).toBe(false);
  expect(sameProgram(filled, 'form(form=stall_permit, fee="$40", stalls="16", period="2 weeks")', { currency: cur })).toBe(false); // (no forms known: nothing says where it goes)
  // What a line calls the thing it makes is no part of it; refusals by label; what isn't a program only if identical.
  expect(same('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")', 'v1 = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=v1, text="It holds land.")')).toBe(true);
  expect(same("none(unclear)", "none( unclear )") && !same("none(unclear)", "none(too_much)") && !same("none(unclear)", "vote(ballot=rec.1, choice=yes)")).toBe(true);
  expect(meaningOf("nonsense(")).toBeUndefined();
  expect(sameMeaning("nonsense(", "nonsense(") && !sameMeaning("nonsense(", "none(unclear)")).toBe(true);
});

test("a gold program is one a sentence could sensibly ask for: each reason one is dropped for, counted; the generator's programs all are", async () => {
  const why = (p: string, o: { invented?: boolean } = {}) => implausible(p, o);
  // A form says where it goes (the translator's rules write where the list says).
  expect(why("form(form=permit_application, lot=lot-01)")).toBe("a form with no office named");
  expect(why("form(form=permit_application, to=planning-1, lot=lot-01)")).toBeUndefined();
  const known = [{ form: "permit_application", to: "planning-1", fields: { lot: { type: "lot" } } }];
  expect(calls.programText(withOffice(calls.parseProgram("form(form=permit_application, lot=lot-01)"), known))).toBe("form(form=permit_application, lot=lot-01, to=planning-1)");
  expect(calls.programText(withOffice(calls.parseProgram("form(form=permit_application, lot=lot-01)"), [...known, { ...known[0]!, to: "parks-2" }]))).toBe("form(form=permit_application, lot=lot-01)"); // two offices: which isn't ours to say
  // for= only where something reads it: a payment's purpose; whose name a statement, a vote, a claim, a signature is in.
  expect(why('goods(kind=flour, quantity="11", at=str.1, for="damages")')).toBe("for= on goods, where it means nothing");
  expect(why('work(task=thresh, units="12", at=hall-79, for=rfbs65)')).toBe("for= on work, where it means nothing");
  expect(why('money(to=acc-1, amount="5", for="damages")') ?? why('statement(kind=notice, text="Closed.", for=ent.4)') ?? why("vote(ballot=rec.1, choice=yes, for=ent.4)")).toBeUndefined();
  // Several lines are one request only if each later line uses what an earlier one made, or they're the same thing done again.
  expect(why('goods(at=apts-1, from_at=shop-1, kind=goods, quantity="7", to=c0170)\nwork(at=apts-1, task=consume, units="28")')).toBe("lines that don't depend on each other");
  expect(why("occupancy(in=house-32/dwelling.1)\noccupancy(in=house-32/dwelling.1, who=ent.33)")).toBe("a line that repeats another");
  expect(why('work(at=shop-2, task=consume, units="13")\nwork(at=shop-5, task=consume, units="12")')).toBeUndefined();
  expect(why('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")')).toBeUndefined();
  expect(why('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")\nvote(ballot=rec.1, choice=yes)')).toBe("lines that don't depend on each other");
  expect(why('v1 = statement(kind=resolution, text="The hall will be inspected on Friday.")\nmessage(re=v1, text="The hall will be repainted tomorrow.", to=water-3)')).toBe("a letter about something other than what it's sent with");
  expect(why('v1 = statement(kind=resolution, text="The hall will be inspected on Friday.")\nmessage(re=v1, text="Please read the resolution I have just published.", to=water-3)')).toBeUndefined();
  // An agreement is an exchange people make.
  expect(why("agreement(with=yarrow-trust, template=partnership, they_do=occupancy(in=str.467/dwelling.19, who=yarrow-trust))")).toBe("the other side committing to its own moving in");
  expect(why("agreement(with=c6010, template=retainer, they_do=structure(on=lot-22-24, type=bridge), we_do=account(holder=c6010))")).toBe("having something built, wrapped in an agreement");
  expect(why("agreement(with=c6010, template=mortgage, they_do=account(holder=c6010), we_do=occupancy(in=str.1, who=c6010))")).toBe("the other side committing to an account of its own");
  expect(why('agreement(with=c6010, we_do=occupancy(in=str.1, who=c6010), they_do=goods(kind=grain, quantity="3", to=ent.5, at=str.2))')).toBe("an exchange in which nobody pays");
  expect(why('agreement(with=c6010, term="a month", our_notice="5 years")')).toBe("notice longer than the agreement runs");
  expect(why('agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-landlord-1, amount="$850", every="monthly", for="rent"))')).toBeUndefined();
  // A claim's action fits what it's done to; a child's other parent is a person; an age fits what someone comes as.
  expect(why('claim(position=right, holder=ent.4, about={"action":"moor","object":"rec.39523"})')).toBe("a claim to do to a record what is done to a place");
  expect(why('claim(position=right, holder=ent.4, about={"action":"sign","object":"rec.39523"})') ?? why('claim(position=right, holder=ent.4, about={"action":"moor","object":"str.9"})')).toBeUndefined();
  expect(why('birth(name="Kaya", template=baby, with="the union")')).toBe("a second parent who is an office or an organisation");
  expect(why('birth(name="Kaya", template=baby, with="my neighbour")') ?? why('birth(name="Kaya", template=baby, with=c0529)') ?? why('birth(name="Kaya", template=baby)')).toBeUndefined();
  expect(why('presence(name="Ana Silva", age="11 months", template=pensioner)')).toBe("an age that doesn't fit what the person comes as");
  expect(why('presence(name="Ana Silva", age="59 years", template=apprentice)')).toBe("an age that doesn't fit what the person comes as");
  expect(why('presence(name="Ana Silva", age="7 months", template=newcomer, carrying="$2,400,000")')).toBe("a child carrying money");
  expect(why('presence(name="Ana Silva", age="31 years", template=newcomer, carrying="$2,400")')).toBeUndefined();
  // Generated programs only: an id that a writer would turn into words. A real world's ids are what they are.
  expect(why("account(at=crh81, holder=timber)", { invented: true })).toBe("an id that is an ordinary word");
  expect(why("position(vacate=mayor)", { invented: true })).toBe("an id that is an ordinary word");
  expect(why("system(retire=records_clerk-3)", { invented: true })).toBe("an id with an underscore, which reads as a phrase");
  expect(why("system(template=inspector_aid)", { invented: true })).toBe("a word with an underscore, which a sentence writes as two");
  expect(why("account(at=crh81, holder=timber)") ?? why("position(vacate=mayor)") ?? why("system(template=inspector_aid)") ?? why("system(template=helpdesk)", { invented: true })).toBeUndefined();
  expect(plausible("position(vacate=mayor)") && !plausible("position(vacate=mayor)", { invented: true })).toBe(true);

  // Read from a log: a form gets its office, and what no sentence would ask for is left out and counted by its reason.
  const head = JSON.stringify({ kind: "header", body: { config: { world: { entities: [] }, records: [{ id: "form-stall", kind: "form", record: "statement", in_position: "markets", data: { form: "stall_permit", submit_as: "stall_permit", submit_to: ["city"], fields: { site: { type: "lot" } } } }] } } });
  const excluded: { [reason: string]: number } = {};
  const fromLog = await goldFromLog([head,
    act("form(form=stall_permit, site=lot-01-02)"),
    act('goods(at=apts-1, from_at=shop-1, kind=goods, quantity="7", to=c0170)\nwork(at=apts-1, task=consume, units="28")'),
    act("occupancy(in=house-32/dwelling.1)\noccupancy(in=house-32/dwelling.1, who=ent.33)"),
    act("occupancy(in=house-32/dwelling.1, leave=true)"),
  ], { excluded });
  expect(fromLog.map((g) => g.program)).toEqual(["form(form=stall_permit, site=lot-01-02, to=markets)", "occupancy(in=house-32/dwelling.1, leave=yes)"]);
  expect(excluded).toEqual({ "implausible: lines that don't depend on each other": 1, "implausible: a line that repeats another": 1 });

  // The generator: nothing it makes is implausible (ids and words as a writer can only copy them, included).
  const dropped: { [reason: string]: number } = {};
  const gold = synthetic({ seed: 4, dropped });
  expect(dropped).toEqual({});
  for (const g of gold) expect([g.program, implausible(g.program, { invented: true, ...(g.forms ? { forms: g.forms } : {}) })]).toEqual([g.program, undefined]);
  const all = gold.flatMap((g) => argsOf(g.program).map(([fn, k, v]) => ({ g, fn, k, v })));
  // for= only where it means something, and on anything but a payment it is someone's id.
  for (const { g, fn, k, v } of all) if (k === "for") expect([g.program, ["money", "statement", "vote", "claim", "agreement"].includes(fn), fn === "money" ? "text" in v : "id" in v || "var" in v]).toEqual([g.program, true, true]);
  // An agreement's two sides: someone pays.
  const offers = gold.filter((g) => /^agreement\(.*_do=/.test(g.program)).map((g) => linesOf(g.program)[0]!.call.args);
  expect(offers.length).toBeGreaterThan(100);
  const side = (v: calls.Value | undefined) => (v && "call" in v ? v.call.fn : "-");
  const deals = new Set(offers.map((a) => `${side(a.we_do)}/${side(a.they_do)}`));
  for (const a of offers) if (a.we_do && a.they_do) expect([side(a.we_do), side(a.they_do)]).toContain("money");
  for (const d of ["occupancy/money", "money/occupancy", "goods/money", "money/goods", "money/money", "money/-", "-/money"]) expect([d, deals.has(d)]).toEqual([d, true]);
  // (Never the other side's own moving in as its commitment, a building it puts up for us, or an account of its own.)
  for (const a of offers) expect(["structure", "account"]).not.toContain(side(a.they_do));
  // A birth: the name and what the child is recorded as, which the contract requires, and the other parent or nobody.
  for (const g of gold.filter((x) => fnOf(x) === "birth")) expect(Object.keys(linesOf(g.program)[0]!.call.args).filter((k) => !["name", "template", "with"].includes(k))).toEqual([]);
  // A newcomer's age in years, as old as what they come as; what they carry is pocket money.
  for (const g of gold.filter((x) => /^presence\(age=/.test(x.program))) {
    const a = linesOf(g.program)[0]!.call.args;
    const years = calls.parseDuration((a.age as { text: string }).text) / (365 * 86_400);
    expect(years >= 15 && years <= 90).toBe(true);
    if ((a.template as { id: string }).id === "pensioner") expect(years).toBeGreaterThanOrEqual(62);
    if (a.carrying) expect(BigInt(calls.parseAmount((a.carrying as { text: string }).text, g.currency!)) / 10n ** BigInt(g.currency!.minor_units) <= 400_000n).toBe(true);
  }
  // Something published reads as its kind: a receipt says what was received, never a rule about dogs.
  for (const g of gold.filter((x) => /^statement\(.*kind=receipt/.test(x.program))) expect(g.program).toContain("has been received in full.");
  expect(gold.some((g) => /on tomorrow|on the end of the week/.test(g.program))).toBe(false);
});

test("the writer is told to say the act, not the call; a request that reads as the call is dropped before any model is asked, its reason counted", async () => {
  const system = writerSystem();
  for (const said of ["never \"is present\"", "\"is put to work\"", "in a quantity of 33", "never \"in 0 days\"", "close the quote", "v1, v2", "Not the word \"field\", unless a form is being filled in", "with nothing else inside them", "Don't recite \"X in the Y field\" for every one"]) expect([said, system.includes(said)]).toEqual([said, true]);
  // What a call brings about goes to the writer with it: the function's gloss, made particular where an argument settles it.
  expect(bringsAbout("presence(who=c1587)")[0]).toContain("comes back into the world from outside");
  expect(bringsAbout('presence(name="Ana Silva", age="31 years", template=newcomer)')[0]).toContain("arrives, is let in");
  expect(bringsAbout("system(template=monitor)")[0]).toContain("is put to work");
  expect(bringsAbout("agreement(notice=rec.36755)")[0]).toContain("notice is given to end an agreement");
  expect(bringsAbout("claim(transfer=rec.9, to=ent.4)")[0]).toContain("passed on to someone else");
  expect(bringsAbout("message(to=c1587, text=\"Hello.\")")).toEqual(["message: someone is told something"]); // (the translator's own gloss, where nothing more particular is said)
  // Nobody named: it is the speaker's own, and the writer is told so (never "someone moves in").
  expect(bringsAbout("occupancy(in=str.1)")[0]).toContain("the speaker moves into a place");
  expect(bringsAbout("occupancy(in=str.1, who=c1)")[0]).toContain("the person named moves into a place");
  expect(bringsAbout("occupancy(in=str.1, leave=yes)")[0]).toContain("the speaker moves out");
  expect(bringsAbout('agreement(with=c1, we_do=occupancy(who=c1, in=str.1), they_do=money(to=acc-1, amount="5"))').map((x) => x.slice(0, x.indexOf(":")))).toEqual(["agreement", "  what we commit to (occupancy)", "  what they commit to (money)"]);
  for (const fn of Object.keys(calls.ARGS)) expect([fn, bringsAbout(fn === "form" ? "form(form=x, to=y-1)" : `${fn}()`)[0]!.length > fn.length + 10]).toEqual([fn, true]);
  let asked = "";
  const seen = writer("a", (program, style) => "Have it done.");
  await generate([{ program: "presence(who=c1587)", shape: "presence(who)", names: {}, source: "t" }], { writers: [{ ...seen, complete: async (req) => ((asked = String((req.messages[0] as any).content)), seen.complete(req)) }], perGold: 1, styles: ["terse"] });
  expect(asked).toMatch(/^Call:\npresence\(who=c1587\)\n\nWhat it brings about \(for your understanding: don't reuse this wording\):\npresence: someone who was away comes back/);
  expect(asked).toMatch(/\n\nHow to say it:\nThe act, said something like: "[^"]*c1587[^"]*"\.\n\nStyle: /);
  // Goods said to come from the place they go to; a description said back; a form's label read out with its underscore.
  const supply = 'agreement(with=c2883, template=supply, we_do=goods(kind=goods, quantity="19", to=c2883, at=works-41), they_do=money(to=acc-9, amount="550"))';
  expect(badlyWritten("Offer [c2883] a supply agreement: they pay 550 into [acc-9] and we deliver 19 goods from [works-41] to [c2883].", supply)).toBe("place_reversed");
  expect(badlyWritten("Offer [c2883] a supply agreement: they pay 550 into [acc-9] and we deliver 19 goods to [c2883] at [works-41].", supply)).toBeUndefined();
  expect(badlyWritten("Move 3 bricks from the old yard [str.70] over to [str.9].", 'goods(kind=bricks, quantity="3", at=str.70)')).toBe("place_reversed");
  expect(badlyWritten("Move 3 bricks from [str.361] to [str.70].", 'goods(kind=bricks, quantity="3", from_at=str.361, at=str.70)')).toBeUndefined();
  expect(badlyWritten("Physically harm c6587.", "harm(who=c6587)")).toBe("description_echoed");
  expect(badlyWritten("Take 17 bread from par.153 at shop-68 without their agreement.", 'take(kind=bread, quantity="17", from=par.153, at=shop-68)')).toBe("description_echoed");
  expect(badlyWritten("Cast my choice of yes on ballot rec.3.", "vote(ballot=rec.3, choice=yes)")).toBe("description_echoed");
  expect(badlyWritten("I'd like a child, Kofi, recorded as a baby.", 'birth(name="Kofi", template=baby)')).toBe("description_echoed");
  expect(badlyWritten("Have someone move into house-61.", "occupancy(in=house-61)")).toBe("description_echoed");
  for (const [said, program] of [["Hit c6587.", "harm(who=c6587)"], ["Grab 17 bread from par.153 at shop-68.", 'take(kind=bread, quantity="17", from=par.153, at=shop-68)'], ["Put me down as yes on rec.3.", "vote(ballot=rec.3, choice=yes)"], ["We're having a baby, to be called Kofi.", 'birth(name="Kofi", template=baby)'], ["I'm moving into house-61.", "occupancy(in=house-61)"]] as const) expect([said, badlyWritten(said, program)]).toEqual([said, undefined]);
  expect(badlyWritten("File the fence return with roads-3: charge_to acc-1.", "form(form=fence_return, to=roads-3, charge_to=acc-1)")).toBe("argument_named");
  expect(badlyWritten("File the fence return with roads-3: charge to acc-1.", "form(form=fence_return, to=roads-3, charge_to=acc-1)")).toBeUndefined();

  // The mechanical checks, each with its reason.
  const letter = 'message(to=c0042, text="Work starts on Monday.")';
  expect(badlyWritten('Send c0042 this message: "Work starts on Monday.', letter)).toBe("quotes");
  expect(badlyWritten("Send c0042 this message: “Work starts on Monday.", letter)).toBe("quotes");
  expect(badlyWritten('Send c0042 this message: "Work starts on Monday."', letter) ?? badlyWritten("Tell c0042: Work starts on Monday. It's the foreman's wish.", letter)).toBeUndefined();
  const post = 'v1 = position(title="Night Watch")\nposition(appoint=v1, to=c4515)';
  expect(badlyWritten("Create the position v1 with the title Night Watch and appoint c4515 to it.", post)).toBe("variable_named");
  expect(badlyWritten("Create a post called Night Watch and appoint c4515 to it.", post)).toBeUndefined();
  expect(badlyWritten("Open an account with holder=c0042.", "account(holder=c0042)")).toBe("argument_named");
  expect(badlyWritten("Open an account, with c0042 in the holder field.", "account(holder=c0042)")).toBe("argument_named");
  expect(badlyWritten("Open an account and fill the right field with c0042.", "account(holder=c0042)")).toBe("argument_named");
  expect(badlyWritten("Open an account for c0042.", "account(holder=c0042)")).toBeUndefined();
  // (A form is filled in field by field: the word is a person's there. An argument's name with "=" never is.)
  const filled = "form(form=permit_application, to=planning-1, lot=lot-01)";
  expect(badlyWritten("Fill in the permit application for planning-1, with lot-01 in the lot field.", filled)).toBeUndefined();
  expect(badlyWritten("Fill in the permit application for planning-1: lot=lot-01.", filled)).toBe("argument_named");
  // (What the program copies may say anything: a letter about a field isn't the call's word for a part of itself.)
  expect(badlyWritten('Tell c0042: "Meet me at the far field."', 'message(to=c0042, text="Meet me at the far field.")')).toBeUndefined();
  // A wait of no time is said as starting now: "0 days" needn't be in the request, and mustn't be said of the wait.
  const standing = 'money(to=acc.66, amount="650.99", from=acc.67, every="30 days", first="0 days")';
  expect(mustAppear(calls.parseProgram(standing))).not.toContain("0 days");
  expect(copies("Pay 650.99 from acc.67 to acc.66 every 30 days, starting now.", standing)).toBe(true);
  expect(badlyWritten("Pay 650.99 from acc.67 to acc.66 every 30 days, starting now.", standing)).toBeUndefined();
  expect(badlyWritten("Pay 650.99 from acc.67 to acc.66 every 30 days, starting in 0 days.", standing)).toBe("zero_wait");
  expect(spansIn("Pay 650.99 from acc.67 to acc.66 every 30 days, starting now.", standing).map((x) => `${x.arg}${x.at ? "" : " (implied)"}`).sort()).toEqual(["amount", "every", "first (implied)", "from", "to"]);

  // In the pipeline: such a request never reaches the checker, and is counted under its reason.
  const gold: Gold[] = [letter, post, "account(holder=c0042)", standing, "vote(ballot=rec.3, choice=yes)"].map((program) => ({ program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: "t", origin: "synthetic" }));
  const said: { [program: string]: string } = {
    [letter]: 'Send c0042 this message: "Work starts on Monday.',
    [post]: "Create the position v1 with the title Night Watch and appoint c4515 to it.",
    "account(holder=c0042)": "Open an account, with c0042 in the holder field.",
    [standing]: "Pay 650.99 from acc.67 to acc.66 every 30 days, starting in 0 days.",
    "vote(ballot=rec.3, choice=yes)": "Vote yes on ballot rec.3.",
  };
  const checked: string[] = [];
  // (The standing payment is asked for with how often said one of the ways people say it: the writer uses those words.)
  const r = await generate(gold, { writers: [writer("a", (program) => said[program] ?? `Pay 650.99 from acc.67 to acc.66 ${everyIn(program)[0]}, starting in 0 days.`)], perGold: 1, styles: ["terse"], back: { model: "stand-in/back", translate: async (request, _forms, g) => (checked.push(request), g!.program) } });
  expect(r.manifest.dropped).toEqual({ not_copied: 0, round_trip: 0, duplicate: 0, failed: 0, shares_held_out_wording: 0, marks: 0, stray_id: 0, quotes: 1, variable_named: 1, argument_named: 1, zero_wait: 1, place_reversed: 0, description_echoed: 0 });
  expect(checked).toEqual(["Vote yes on ballot rec.3."]);
  expect(r.rejects.map((x) => x.why).sort()).toEqual(["argument_named", "quotes", "variable_named", "zero_wait"]);
  expect(r.examples.filter((e) => e.kind === "positive").map((e) => e.program)).toEqual(["vote(ballot=rec.3, choice=yes)"]);
});

test("a span points at the right occurrence: beside its own call's values, the bracketed id, the words of a choice; ambiguous where nothing settles it; a second \"do not\" is a rider", async () => {
  const at = (request: string, program: string) => spansIn(request, program).flatMap((x) => (x.at ? [`${x.line !== undefined ? `${x.line}.` : ""}${x.arg}: ${request.slice(...x.at)}@${x.at[0]}${x.ambiguous ? ` or @${x.all!.slice(1).map((y) => y[0]).join(",")}` : ""}`] : []));
  // The same office in each of two lines: each line's span is the occurrence said with that line's other values.
  expect(at("Open an account at bank for ent.22, and open an account at bank for ent.23.", "account(at=bank, holder=ent.22)\naccount(at=bank, holder=ent.23)"))
    .toEqual(["0.at: bank@19", "0.holder: ent.22@28", "1.at: bank@59", "1.holder: ent.23@68"]);
  // A party who is also named in a commitment: the commitment's is the one among the commitment's values, the other is the party's.
  const lease = 'agreement(with=c6010, we_do=occupancy(who=c6010, in=str.1/room.2), they_do=money(to=acc-9, amount="$5", every="monthly"))';
  const offer = "Offer c6010 an agreement: we let c6010 live in str.1/room.2, and they pay $5 monthly into acc-9.";
  expect(at(offer, lease)).toEqual(expect.arrayContaining(["with: c6010@6", `we_do.who: c6010@${offer.indexOf("c6010", 10)}`]));
  expect(spansIn(offer, lease).some((x) => x.ambiguous)).toBe(false);
  // An id in square brackets after its title: the bracketed one, not the word in the title or the name.
  const named = "Please send the works manager [works] a message about [rec.6887] saying: The park is out of use on Tuesday.";
  expect(at(named, 'message(re=rec.6887, text="The park is out of use on Tuesday.", to=works)')).toContain(`to: works@${named.indexOf("[works]") + 1}`);
  const claimed = "Record Lark Cross Farms Brothers [brothers]' right to moor at [str.9] for Thistle Growers' Cooperative [cooperative].";
  expect(at(claimed, 'claim(about={"action":"moor","object":"str.9"}, for=cooperative, holder=brothers, position=right)')).toEqual(expect.arrayContaining([`for: cooperative@${claimed.indexOf("[cooperative]") + 1}`, `holder: brothers@${claimed.indexOf("[brothers]") + 1}`]));
  // A choice written in words: a form named in three words is those words.
  const lodged = "Lodge an event stall permit with markets-1 for lot-01, the summer one.";
  expect(at(lodged, "form(form=event_stall_permit, to=markets-1, lot=lot-01, season=summer)")).toEqual(expect.arrayContaining(["form: event stall permit@9", `season: summer@${lodged.indexOf("summer")}`]));
  // One call, its value said twice: either is it, so both are recorded and the span says it is ambiguous.
  const twice = "Pay acc-1 $5, into acc-1.";
  expect(spansIn(twice, 'money(to=acc-1, amount="$5")')).toEqual([{ arg: "to", value: "acc-1", how: "copy", at: [4, 9], ambiguous: true, all: [[4, 9], [19, 24]] }, { arg: "amount", value: "$5", how: "copy", at: [10, 12] }]);
  // Counted; and a brief that gave two closing sentences has two riders, as has a request whose writer added one.
  const gold: Gold[] = [
    { program: 'money(amount="$5", to=acc-1)', shape: "money(amount,to)", names: {}, source: "t", origin: "synthetic" },
    { program: "vote(ballot=rec.3, choice=yes)", shape: "vote(ballot,choice)", names: {}, source: "t", origin: "synthetic" },
  ];
  const w = writer("a", (program, style) => (program.startsWith("money") ? `Pay acc-1 $5, into acc-1. ${given(style)}` : `Vote yes on ballot rec.3. Do not publish it. ${given(style)}`));
  const r = await generate(gold, { writers: [w], perGold: 30, styles: ["do_not"], seed: 4 });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(r.manifest.ambiguous_spans).toBe(positives.filter((e) => e.shape.startsWith("money")).length);
  expect(r.manifest.ambiguous_spans).toBeGreaterThan(0);
  expect(new Set(positives.filter((e) => e.shape.startsWith("money")).map((e) => e.riders!.length))).toEqual(new Set([1, 2])); // one given, or two
  for (const e of positives) {
    for (const rider of e.riders!) expect([rider.kind, rider.adds, e.request.slice(...rider.at)]).toEqual(["do_not", "nothing", rider.text]);
    // The writer's own "Do not publish it." is recorded with the ones it was given, in the order they stand.
    if (e.shape.startsWith("vote")) expect(e.riders![0]!.text).toBe("Do not publish it.");
    expect(e.riders!.map((x) => x.at[0])).toEqual(e.riders!.map((x) => x.at[0]).sort((a, b) => a - b));
  }
  expect(r.manifest.riders.do_not).toBe(positives.reduce((n, e) => n + e.riders!.length, 0));
});

test("too much, as people make it: two or three related acts piled into one message, a share of long pasted ones kept; every label of the call language gets its floor", async () => {
  // Built from examples: the ones about the same person, each a different kind of act, never a letter.
  const example = (i: number, request: string, program: string): Example => ({ id: `e${i}`, request, forms: [], program, kind: "positive", shape: shapeOf(calls.parseProgram(program)), source: "t", gold: program });
  const positives: Example[] = [
    example(0, "Pay c0042 $500 from acc-city for wages.", 'money(to=c0042, amount="$500", from=acc-city, for="wages")'),
    example(1, "Appoint c0042 to bakery-baker.", "position(appoint=bakery-baker, to=c0042)"),
    example(2, "Move c0042 into apts-3/dwelling.2.", "occupancy(who=c0042, in=apts-3/dwelling.2)"),
    example(3, "Tell c0042: Start on Monday.", 'message(to=c0042, text="Start on Monday.")'),
    example(4, "Pay c0042 $20 for the kerb.", 'money(to=c0042, amount="$20", for="the kerb")'),
    ...Array.from({ length: 12 }, (_, i) => example(10 + i, `Vote yes on ballot rec.${i}${i % 2 ? " at once" : ""}.`, `vote(ballot=rec.${i}, choice=yes${i % 2 ? ", visible=public" : ""})`)),
    ...Array.from({ length: 6 }, (_, i) => example(30 + i, `Close account acc-${i}.`, `account(close=acc-${i})`)),
    ...Array.from({ length: 6 }, (_, i) => example(40 + i, `Hurt c900${i}.`, `harm(who=c900${i})`)),
    ...Array.from({ length: 6 }, (_, i) => example(50 + i, `Take ${i + 2} bricks from ent.${i} at str.${i}.`, `take(kind=bricks, quantity="${i + 2}", from=ent.${i}, at=str.${i})`)),
  ];
  const built = builtRefusals(positives, 5, 0, { too_much: 9 }).filter((e) => e.program === "none(too_much)");
  expect(built.length).toBe(9);
  const related = built.filter((e) => e.source === "built: related requests run together");
  const pasted = built.filter((e) => e.source === "built: several requests run together");
  expect(related.length).toBeGreaterThanOrEqual(4);
  expect(pasted.length).toBe(3); // a third stay the long kind
  const partsOf = (e: Example) => e.built_from!.map((id) => positives.find((p) => p.id === id)!);
  // (Every part is in the request, whatever runs them together: its words, but for a capital and a full stop.)
  const holds = (e: Example) => partsOf(e).every((p) => e.request.toLowerCase().includes(p.request.toLowerCase().replace(/\.$/, "")));
  for (const e of related) {
    const parts = partsOf(e);
    expect(parts.length === 2 || parts.length === 3).toBe(true);
    expect(parts.every((p) => p && p.program.includes("c0042") && functionOf(p) !== "message")).toBe(true);
    expect(new Set(parts.map((p) => functionOf(p))).size).toBe(parts.length); // each a different kind of act
    expect(holds(e)).toBe(true);
  }
  for (const e of pasted) expect([partsOf(e).length >= 4, holds(e)]).toEqual([true, true]);
  // How they are run together varies: nothing between them, one sentence with "and", a numbered list, a list after a
  // line saying several things follow, and many ways of running on; no one joiner marks the label.
  const many = builtRefusals(positives, 11, 0, { too_much: 150 }).filter((e) => e.program === "none(too_much)");
  expect(many.length).toBeGreaterThan(100);
  const share = (re: RegExp) => many.filter((e) => re.test(e.request)).length / many.length;
  expect(share(/ Also: | And then: /)).toBeLessThan(0.15);
  for (const re of [/^1\. |^\(1\) |^1\) |^- |^First, /m, /[a-z0-9\]],? and (also )?[a-z]/, /\n/, /Oh, and |After that, |Next, |Before I forget: /, /^(Take these in order|Several things today|A few things|Please see to the following|For today|Three or four matters)/]) expect([String(re), share(re) > 0.03]).toEqual([String(re), true]);
  expect(many.filter((e) => partsOf(e).map((p) => p.request).join(" ") === e.request).length).toBeGreaterThan(5); // nothing between them at all
  expect(many.every(holds)).toBe(true);
  // One message is said in one capacity: a pasted one never has a second part that opens with its own.
  const titled = positives.map((p, i): Example => (i % 3 === 0 ? { ...p, request: `As Clerk of Tarn, ${p.request[0]!.toLowerCase()}${p.request.slice(1)}`, riders: [{ kind: "capacity", text: "As Clerk of Tarn", at: [0, 16], adds: "nothing" }] } : p));
  for (const e of builtRefusals(titled, 3, 0, { too_much: 40 }, { pasted: 1 })) expect((e.request.match(/as Clerk of Tarn/gi) ?? []).length).toBeLessThanOrEqual(1);
  expect(builtRefusals(positives, 5, 0, { too_much: 9 })).toEqual(builtRefusals(positives, 5, 0, { too_much: 9 }));
  // (Nothing related among the examples: all of them are the long kind.)
  expect(builtRefusals(positives.slice(5), 5, 0, { too_much: 4 }).every((e) => e.source === "built: several requests run together")).toBe(true);

  // Written: groups of separate acts about the same person or organisation, for a writer to ask for in one message.
  const groups = piled({ groups: 15, seed: 2 });
  expect(groups.length).toBe(15);
  expect(piled({ groups: 15, seed: 2 })).toEqual(groups);
  expect(new Set(groups.map((g) => g.length))).toEqual(new Set([2, 3]));
  for (const g of groups) {
    const ids = g.map((x) => new Set(mustAppear(calls.parseProgram(x.program))));
    expect([...ids[0]!].some((x) => ids.every((s) => s.has(x)))).toBe(true); // about the same someone
    expect(new Set(g.map(fnOf)).size).toBe(g.length);
    for (const x of g) expect(["message", "statement"].includes(fnOf(x)) || x.program.includes("\n") || implausible(x.program, { invented: true }) !== undefined).toBe(false);
  }
  const briefs = piledBriefs(groups);
  expect(briefs.every((b) => b.label === "too_much")).toBe(true);
  for (const [i, b] of briefs.entries()) for (const x of groups[i]!) {
    expect(b.brief).toContain(x.program);
    for (const l of mustAppear(calls.parseProgram(x.program))) expect(b.mustCopy).toContain(l);
  }
  // A writer that words them (carrying every value), another that loses one; a checker that refuses a pile as too much.
  const piling = (lose: boolean): LlmAdapter => ({ provider: "stand-in", model: lose ? "careless" : "w", complete: async (req) => {
    const text = String((req.messages[0] as any).content);
    const brief = briefs.find((b) => text.includes(b.brief));
    const answer = brief ? `While you're at it, see to all of this: ${[...brief.mustCopy.slice(lose ? 1 : 0), ...(text.includes("In this voice") ? brief.mention ?? [] : [])].join(", ")}.` // (in a seat's voice, with the ids it was given to name)
      : text.startsWith("Call:") ? saying(text.slice(6, text.indexOf("\n\n")), "x") : `Something else (${text.length}).`;
    return { content: [{ type: "text", text: answer }], usage: { input_tokens: 1, output_tokens: 1 } };
  } });
  const back = { model: "stand-in/back", translate: async (q: string) => (q.startsWith("While you're at it") ? "none(too_much)" : "none(unclear)") };
  const r = await generate([], { writers: [piling(false)], piled: groups, back });
  expect(r.examples.map((e) => [e.program, e.source, e.verified_by])).toEqual(groups.map(() => ["none(too_much)", "written: piled", "stand-in/back"]));
  expect((await generate([], { writers: [piling(true)], piled: groups, back })).manifest.dropped.not_copied).toBe(15);

  // The floor is under every label the call language has, whatever they are: what is written counts towards it, what
  // can be built makes up the rest, and a label nothing makes yet is reported short, never passed over.
  const gold = synthetic({ seed: 3, perFunction: 12, only: ["money", "vote", "harm", "position", "occupancy", "form"] });
  const programs = new Map<string, string>();
  // (The briefs of each round of asking: the seed, and the seed two rounds on.)
  const worded = [1, 7920, 15839].flatMap((seed) => refusalBriefs(gold, 6, seed));
  let n = 0;
  const wording: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req) => {
    const text = String((req.messages[0] as any).content);
    const brief = briefs.find((b) => text.includes(b.brief));
    const program = text.startsWith("Call:") ? text.slice(6, text.indexOf("\n\n")) : undefined;
    const answer = program ? saying(program, "x") : brief ? `While you're at it, see to all of this: ${brief.mustCopy.join(", ")}.` : `LABEL ${worded.find((b) => text.includes(b.brief))?.label}: (${n++}) ${text.split("\n").slice(1).join(" ")}`;
    if (program) programs.set(answer, program);
    return { content: [{ type: "text", text: answer }], usage: { input_tokens: 1, output_tokens: 1 } };
  } };
  // (The checker gets every second "unclear" wrong: the label is asked for again until it has its floor.)
  let unclear = 0;
  const checker = { model: "stand-in/back", translate: async (q: string) => (q.startsWith("While you're at it") ? "none(too_much)" : q.startsWith("LABEL ") ? (q.startsWith("LABEL unclear") && unclear++ % 2 ? "vote(ballot=rec.1, choice=yes)" : `none(${q.slice(6, q.indexOf(":"))})`) : programs.get(q)) };
  const floored = await generate(gold, { writers: [wording], perGold: 1, styles: ["formal"], refusalFloor: 6, piled: groups.slice(0, 4), back: checker, seed: 1 });
  const made = new Set(floored.examples.filter((e) => e.kind === "refusal").map((e) => e.program.slice(5, -1)));
  for (const label of ["too_much", "unknown_form", "needs_calculation", "not_yours", "unclear", "not_an_act"]) expect(made.has(label)).toBe(true);
  for (const label of made) expect([label, floored.manifest.by_shape[`none(${label})`]! >= 6]).toEqual([label, true]);
  expect(floored.manifest.short_of_floor).toEqual(Object.fromEntries(calls.TRANSLATOR_LABELS.filter((l) => !made.has(l)).map((l) => [l, 0])));
  // Four of the too_much are the written kind; the built ones make up the floor and no more than that and their share.
  expect(floored.examples.filter((e) => e.source === "written: piled").length).toBe(4);
  expect(floored.examples.filter((e) => e.program === "none(too_much)").length).toBeGreaterThanOrEqual(6);
});

test("the model that checks a request is never the one that wrote it: several writers, several checkers, recorded per example", async () => {
  const back = (model: string) => ({ model, translate: async () => "none(unclear)" });
  // The first checker that is another model; the same model reached another way is the same model.
  expect(checkerFor("codex/sol", [back("codex/sol"), back("codex/luna")])).toMatchObject({ back: { model: "codex/luna" }, own: false });
  expect(checkerFor("codex/luna", [back("codex/sol"), back("codex/luna")])).toMatchObject({ back: { model: "codex/sol" }, own: false });
  expect(checkerFor("openrouter/sol", [back("codex/sol"), back("codex/luna")])).toMatchObject({ back: { model: "codex/luna" }, own: false });
  expect(checkerFor("codex/sol", [back("other/sol")])).toMatchObject({ back: { model: "other/sol" }, own: true });
  expect(checkerFor("codex/sol", [])).toBeUndefined();

  const gold = (await goldFromLog(LOG)).filter((g) => !g.program.includes("\n"));
  const programs = new Map<string, string>();
  const w = (model: string) => writer(model, (program, style) => {
    const request = `${model} asks: ${literals(calls.parseProgram(program)).join(", ")} (${style.slice(0, 5)})`;
    programs.set(request, program);
    return request;
  });
  const asked: { [model: string]: string[] } = { "stand-in/a": [], "stand-in/c": [] };
  // (Checker c gets the drain payment wrong.)
  const checker = (model: string) => ({ model, translate: async (request: string) => (asked[model]!.push(request), model.endsWith("/c") && request.includes("the drain") ? "none(unclear)" : programs.get(request)) });
  const r = await generate(gold, { writers: [w("a"), w("b")], backs: [checker("stand-in/a"), checker("stand-in/c")], perGold: 2, styles: ["terse", "formal"] });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(positives.length).toBeGreaterThan(3);
  // a's requests go to c (a second checker, since the first is a itself); b's to a.
  for (const e of positives) expect([e.written_by, e.verified_by, e.verified_by_writer]).toEqual(e.written_by === "stand-in/a" ? ["stand-in/a", "stand-in/c", undefined] : ["stand-in/b", "stand-in/a", undefined]);
  expect(asked["stand-in/a"]!.every((q) => q.startsWith("b asks")) && asked["stand-in/c"]!.every((q) => q.startsWith("a asks"))).toBe(true);
  expect(Object.keys(r.manifest.checked).sort()).toEqual(["stand-in/a -> stand-in/c", "stand-in/b -> stand-in/a"]);
  expect(Object.values(r.manifest.checked).reduce((x, y) => x + y, 0)).toBe(positives.length);
  expect(r.manifest.checked_by_writer).toBe(0);
  // A request the checker didn't translate back says who checked it.
  expect(r.rejects.filter((x) => x.why === "round_trip").map((x) => [x.written_by, x.checked_by])).toEqual([["stand-in/a", "stand-in/c"]]);
  // No other model given: the writer's own checks, and the example and the manifest say so.
  const own = await generate(gold, { writers: [w("a"), w("b")], backs: [checker("stand-in/a")], perGold: 2, styles: ["terse", "formal"] });
  const mine = own.examples.filter((e) => e.kind === "positive" && e.written_by === "stand-in/a");
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((e) => e.verified_by === "stand-in/a" && e.verified_by_writer === true)).toBe(true);
  expect(own.examples.filter((e) => e.written_by === "stand-in/b").every((e) => e.verified_by === "stand-in/a" && e.verified_by_writer === undefined)).toBe(true);
  expect(own.manifest.checked_by_writer).toBe(mine.length);
  // One checker, as before: `back`.
  const one = await generate(gold, { writers: [w("a")], back: checker("stand-in/c"), perGold: 1, styles: ["terse"] });
  expect(one.examples.filter((e) => e.kind === "positive").every((e) => e.verified_by === "stand-in/c")).toBe(true);
});

test("marks around the whole of a request come off; a request that ends in quoted words keeps their closing mark", () => {
  expect(unwrapped('"Pay acc-1 the fee."')).toBe("Pay acc-1 the fee.");
  expect(unwrapped('Tell c7180: "Work starts tomorrow."')).toBe('Tell c7180: "Work starts tomorrow."');
  expect(unwrapped('"Tell c7180: "Work starts tomorrow.""')).toBe('Tell c7180: "Work starts tomorrow."');
  expect(unwrapped('"Hello." Then tell them "Goodbye."')).toBe('"Hello." Then tell them "Goodbye."');
  expect(quotesBalanced(unwrapped('Tell c7180: "Work starts tomorrow."'))).toBe(true);
});
