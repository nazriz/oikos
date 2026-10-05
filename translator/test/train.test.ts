import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { CASES } from "../eval/cases";
import { TEST_CURRENCY } from "../eval/run";
import { translatorContext, translatorSystem } from "../src/index";
import { resolve } from "../src/resolver";
import {
  amountForms, amountWritings, askable, builtRefusals, copies, durationForms, FIELD_TYPES, formLine, formOf, functionOf, generate, goldFromCases, goldFromLog, goldText, JSON_OUT_OF_SCOPE, knowing, literals, mustAppear,
  needed, refusalBriefs, spansIn, sameProgram, sampler, shapeOf, split, STYLES, styleBrief, surfaceVariant, whyNot, withoutRiders, writerSystem, type Example, type Gold,
} from "../train/data";
import { CURRENCIES, formSets, synthetic, syntheticForms } from "../train/synthetic";

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
const given = (style: string) => /exactly (?:these words|this sentence)[^"]*"([^"]+)"/.exec(style)?.[1];
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
  expect(r.manifest.dropped).toEqual({ not_copied: 2, round_trip: 3, duplicate: 0, failed: 0, shares_held_out_wording: 0 });
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
  for (const e of many) expect(e.request.split(/ Also: | And then: /).length).toBeGreaterThanOrEqual(4);
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
  expect(briefs.map((b) => b.label)).toEqual(["needs_calculation", "not_yours", "unclear", "not_an_act", "needs_calculation", "not_yours", "unclear", "not_an_act"]);
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
      : said.includes("theirs alone") ? `Make them agree. (${said.length})` : `Do something about it. (${said.length})`;
    return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
  } };
  const r = await generate(gold, { writers: [wording], perGold: 1, refusalsPerLabel: 2, seed: 9,
    back: { model: "stand-in/back", translate: async (q) => (q.includes("a third") ? "none(needs_calculation)" : q.startsWith("Make them") ? "none(not_yours)" : q.startsWith("Do something") ? "structure(type=road, on=lot-1)" : "none(unclear)") } });
  const refusals = r.examples.filter((e) => e.kind === "refusal").map((e) => e.program);
  expect(refusals.filter((x) => x === "none(needs_calculation)").length).toBe(2);
  expect(refusals.filter((x) => x === "none(not_yours)").length).toBe(2);
  expect(refusals).not.toContain("none(unclear)"); // the second model made something of them: not kept
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
  expect(spans.map((x) => `${x.arg}: ${request.slice(...x.at)}`).sort()).toEqual(["amount: $500", "for: the kerb", "from: acc-city", "to: acc-b"]);
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
    expect([g.program, whyNot(p)]).toEqual([g.program, undefined]);
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
  // data, a rule's formal condition) and a keeper's bookkeeping.
  const used = new Set(gold.flatMap((g) => argsOf(g.program).map(([fn, k]) => `${fn}.${k}`)));
  const left = Object.entries(calls.ARGS).flatMap(([fn, a]) => [...(a.allowed ?? [])].map((k) => `${fn}.${k}`)).filter((k) => !used.has(k));
  expect(left.sort()).toEqual([...JSON_OUT_OF_SCOPE, "money.per_request", "statement.formal"].sort());
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
  expect(currencies.size).toBe(CURRENCIES.length);
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
  expect(formLine({ form: "permit_application", to: "planning", fields: { lot: { type: "lot", required: true }, kind: { type: "choice", options: ["new", "renewal"] } } })).toBe("- permit_application, to=planning: fields lot (lot, required), kind (one of new | renewal)");
});

test("invented forms filled in: every required field, some of the others, with and without the office, beside other forms or alone; the resolver takes each", () => {
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
    // Two offices with a form by this name: the call says whose.
    if (own.length > 1) expect("to" in c.args).toBe(true);
    "to" in c.args ? withTo++ : 0;
    g.forms!.length === 1 ? alone++ : beside++;
    expect(g.forms!.length).toBeLessThanOrEqual(4);
    // The resolver, knowing these forms and this world's money, reads every field as its type says.
    const r = resolve(calls.parseProgram(g.program), knowing(g.forms!, g.currency!), () => undefined);
    expect([g.program, r.ok ? "ok" : r.questions.join(" ")]).toEqual([g.program, "ok"]);
    // What the request must carry: the form's name as words, each value.
    expect(needed(calls.parseProgram(g.program)).find((n) => n.arg === "form")).toEqual({ arg: "form", value: name, exact: false });
  }
  for (const n of [withTo, gold.length - withTo, alone, beside, optional]) expect(n).toBeGreaterThan(gold.length / 10);
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
  expect(spansIn(request, program).map((x) => `${x.arg}: ${request.slice(...x.at)}`).sort()).toEqual(["about.action: build", "about.object: lot-12-03", "holder: c0042"]);
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
  // A citation is a rider only where the call has nowhere to put one.
  const cite = styleBrief("cited", letter, rand);
  expect(cite.riders).toEqual([{ kind: "citation", text: expect.stringMatching(/ (law-[a-z]+|rec\.\d+)$/) }]);
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
    { program: 'message(text="Start on Monday.", to=works)', shape: "message(text,to)", names: { works: "Works Manager" }, source: "t", origin: "synthetic" },
    { program: "vote(ballot=rec.3, choice=yes)", shape: "vote(ballot,choice)", names: {}, source: "t", origin: "synthetic" },
  ];
  const r = await generate(gold, { writers: [writer("a", obliging)], perGold: 3, styles: ["capacity", "cited", "do_not"], seed: 5 });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(positives.length).toBe(6);
  expect(r.manifest.riders).toEqual({ capacity: 2, citation: 2, do_not: 2 });
  expect(r.manifest.by_style).toMatchObject({ capacity: 2, cited: 2, do_not: 2 });
  expect(r.manifest.by_function).toMatchObject({ message: 3, vote: 3 });
  expect(r.manifest.by_origin).toMatchObject({ synthetic: 6 });
  for (const e of positives) {
    expect(e.program).toBe(gold.find((g) => g.shape === e.shape)!.program); // the program is the gold one, rider or no rider
    expect(e.riders!.length).toBe(1);
    const rider = e.riders![0]!;
    expect(rider.adds).toBe("nothing");
    expect(e.request.slice(...rider.at)).toBe(rider.text);
    // No value of the program is pointed at inside the rider ("Works" in "As Works Manager of …" isn't who is written to).
    for (const s of e.spans!) expect(s.at[1] <= rider.at[0] || s.at[0] >= rider.at[1]).toBe(true);
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
  // The writer was told the form's fields, to say which value is for which.
  expect(writerSystem()).toContain("which of its fields each value is for");
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
  const parts = (e: Example) => e.request.split(/ Also: | And then: /);
  const trainRequests = new Set(s.train.filter((e) => e.kind === "positive").map((e) => e.request));
  const many = s.train.filter((e) => e.program === "none(too_much)");
  expect(many.length).toBeGreaterThan(0);
  for (const e of many) for (const part of parts(e)) expect(trainRequests.has(part)).toBe(true);
  for (const e of s.validation.filter((x) => x.program === "none(unknown_form)")) expect(validation.has(formOf(positives.find((x) => x.request === e.request)!.program)!.form)).toBe(true);
});

test("gold from the seen cases: a form filled in carries the form the test's mayor knows of, and amounts are in the test town's money", () => {
  const gold = goldFromCases(CASES);
  const forms = gold.filter((g) => functionOf(g) === "form");
  expect(forms.length).toBeGreaterThan(0);
  for (const g of forms) expect(g.forms!.map(formLine)).toEqual(["- permit_application, to=planning: fields lot (lot, required), structure_type (structure_type, required), notes (text)"]);
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
  expect(form.forms!.map(formLine)).toContain("- stall_permit, to=markets: fields fee (amount, required), site (lot)");
  expect(form.forms!.every((f) => ["stall_permit", "noise_complaint"].includes(f.form))).toBe(true);
  // Its other surface is written in that world's money.
  const rand = sampler(1);
  for (let i = 0; i < 20; i++) expect(calls.parseAmount(((calls.parseProgram(surfaceVariant(form, rand).program) as any).lines[0].call.args.fee as { text: string }).text, form.currency!)).toBe("4000");
});
