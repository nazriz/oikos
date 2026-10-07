// What the second audit of the training data found (2026-10-06, docs/decisions.md), each held by a test: the two
// rules the call language left unclear (goods' `to`, `at` and `from_at`; work by several people), nested calls said as
// the standalone ones are, gold from any source in one spelling, `every` as the request's own span, several ways of
// saying each act and of wording each refusal, and blind checking as a step of the pipeline.
// (Spans' `how` and the split of a refusal with its positive are in train.test.ts, with the spans and the split.)

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { CASES } from "../eval/cases";
import { translatorSystem, TRANSLATOR_VERSION } from "../src/index";
import { blindRequests, checkAnswers, formOfLine } from "../train/blind";
import {
  badlyWritten, everyIn, formLine, functionOf, generate, goldFromCases, goldFromLog, goldText, howOften, implausible, literals, refusalBriefs, sameMeaning, sampler, sayingFor, SAYINGS, shapeOf,
  withHowOften, writerNotes, writerSystem, refusalWriterSystem, type Example, type Gold,
} from "../train/data";
import { synthetic, syntheticForms } from "../train/synthetic";

const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });
const header = JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }] } } } });
const linesOf = (program: string) => (calls.parseProgram(program) as { lines: calls.Line[] }).lines;
const callOf = (program: string) => linesOf(program)[0]!.call;
const said = (v: calls.Value | undefined) => (v === undefined ? undefined : "id" in v ? v.id : "text" in v ? v.text : undefined);
/** Every call of a program, with the calls nested in it (and whether it is nested). */
function callsOf(program: string): { call: calls.Call; nested: boolean }[] {
  const out: { call: calls.Call; nested: boolean }[] = [];
  const walk = (c: calls.Call, nested: boolean) => (out.push({ call: c, nested }), Object.values(c.args).forEach((v) => "call" in v && walk(v.call, true)));
  linesOf(program).forEach((l) => walk(l.call, false));
  return out;
}
/** A writer that says a program's values in a sentence (what it was asked is kept). */
const writer = (model: string, how: (program: string, content: string) => string | undefined, asked?: string[]): LlmAdapter => ({
  provider: "stand-in", model,
  complete: async (req: LlmRequest) => {
    const content = String((req.messages[0] as any).content);
    asked?.push(content);
    const text = content.startsWith("Call:\n") ? how(content.slice("Call:\n".length, content.indexOf("\n\n")), content) : `Situation ${content.length}.`;
    return { content: text ? [{ type: "text", text }] : [], usage: { input_tokens: 1, output_tokens: 1 } };
  },
});
const saying = (program: string) => `Please see to this: ${literals(calls.parseProgram(program)).join(", ")}.`;
/** A place, as the generator's ids write one (a building, a lot, a cell, a space in a building). */
const PLACE = /^(str\.|lot-|cell\.|(apts|house|shop|hall|works|store)-[0-9]+)/;

test("the two rules the call language left unclear are in the translator's instructions, in general words, and the seen cases and generated gold keep to them", () => {
  const system = translatorSystem();
  expect(TRANSLATOR_VERSION).toBe("0.7.5");
  for (const rule of [
    "to= is who receives them (a person or an organisation), at= is the place they are delivered to (a building or a place) and from_at= the place they come from; a place named as where they go is at=, never to=, and with no one named to receive them they are your own (no to=).",
    "Work done by several people is one work(...) with by= as a list of them (by=[\"c0042\",\"c0043\"]), never a line for each of them: units= is the whole job.",
    "template= is the request's own word for the kind of newcomer, of child or of system",
    "every= is the request's own words for how often, copied whole",
  ]) expect([rule, system.includes(rule)]).toEqual([rule, true]);
  // The seen cases: goods go to someone at a place, or to a place with no one named; work by several is one call.
  for (const c of CASES) for (const e of c.expect.filter((x) => !x.startsWith("none("))) for (const { call } of callsOf(e)) {
    if (call.fn === "goods") {
      expect([c.id, "at" in call.args]).toEqual([c.id, true]);
      expect([c.id, PLACE.test(said(call.args.to) ?? "")]).toEqual([c.id, false]);
    }
  }
  for (const c of CASES) expect([c.id, c.expect.some((e) => linesOf(e.startsWith("none(") ? "vote(ballot=x, choice=y)" : e).filter((l) => l.call.fn === "work").length > 1)]).toEqual([c.id, false]);
  expect(CASES.find((c) => c.id === "move-goods-place")!.expect).toEqual(["goods(kind=goods, quantity=12, from_at=str.7, at=str.8)"]);
  expect(CASES.find((c) => c.id === "work-several")!.expect).toEqual(['work(task=make, units=4, at=str.7, by=["c0042","c0043"])']);
  // Generated gold: goods' `to` is never a place and its `at` and `from_at` always are; work is one call however many do it.
  const gold = synthetic({ seed: 2, perFunction: 200, only: ["goods", "work", "agreement"] });
  let several = 0, own = 0;
  for (const g of gold) for (const { call } of callsOf(g.program)) {
    if (call.fn === "goods") {
      expect([g.program, PLACE.test(said(call.args.at) ?? ""), PLACE.test(said(call.args.to) ?? "")]).toEqual([g.program, true, false]);
      if ("from_at" in call.args) expect([g.program, PLACE.test(said(call.args.from_at) ?? "")]).toEqual([g.program, true]);
      if (!("to" in call.args)) own++;
    }
    if (call.fn === "work") {
      expect(linesOf(g.program).length).toBe(1);
      const by = call.args.by;
      if (by && "json" in by) several++;
    }
  }
  expect(several).toBeGreaterThan(10);
  expect(own).toBeGreaterThan(20);
});

test("a call nested in an agreement is the call as it is by itself: the same arguments, meaning the same; goods say where from and where to as standalone goods do; an offer names who it is with", async () => {
  const gold = synthetic({ seed: 6, perFunction: 500, only: ["goods", "agreement", "money", "occupancy", "structure", "account"] });
  // (`every` is a commitment's own on goods: goods delivered every so often.)
  const keys = (c: calls.Call) => Object.keys(c.args).filter((k) => !(k === "every" && c.fn === "goods")).sort().join(",");
  const alone = new Map<string, Set<string>>();
  for (const g of gold) for (const { call, nested } of callsOf(g.program)) if (!nested && call.fn !== "agreement") (alone.get(call.fn) ?? alone.set(call.fn, new Set()).get(call.fn)!).add(keys(call));
  const nestedFns = new Map<string, number>();
  let from = 0;
  for (const g of gold.filter((x) => functionOf(x) === "agreement")) for (const { call, nested } of callsOf(g.program)) {
    if (!nested) {
      // An offer names who it is with (a request that names them would otherwise have a party its program lacks).
      if (!("sign" in call.args) && !("notice" in call.args)) expect([g.program, "with" in call.args]).toEqual([g.program, true]);
      continue;
    }
    nestedFns.set(call.fn, (nestedFns.get(call.fn) ?? 0) + 1);
    // The arguments it has are a set the same function has by itself, and it is a valid call by itself.
    expect([g.program, call.fn, keys(call), alone.get(call.fn)?.has(keys(call))]).toEqual([g.program, call.fn, keys(call), true]);
    expect(calls.contractErrors(calls.parseProgram(calls.callText(call)))).toEqual([]);
    if (call.fn === "goods") {
      // Who receives, where delivered, and (now and then) where from: each what it is in goods by themselves.
      expect([g.program, "to" in call.args, PLACE.test(said(call.args.at) ?? ""), PLACE.test(said(call.args.to) ?? "")]).toEqual([g.program, true, true, false]);
      if ("from_at" in call.args) (from++, expect(PLACE.test(said(call.args.from_at) ?? "")).toBe(true));
      // And the writer is told which is which, as for goods by themselves.
      const notes = writerNotes(g.program, sampler(1)).join("\n");
      expect(notes).toContain(`${said(call.args.at)} is the place they are delivered to (never where they come from)`);
      expect(notes).toContain(`${said(call.args.to)} is who receives them`);
      if ("from_at" in call.args) expect(notes).toContain(`${said(call.args.from_at)} is the place they come from`);
    }
  }
  for (const fn of ["money", "goods", "occupancy", "structure", "account"]) expect([fn, (nestedFns.get(fn) ?? 0) > 3]).toEqual([fn, true]);
  expect(from).toBeGreaterThan(5);
  expect(implausible('agreement(template=lease, term="12 months", they_do=money(to=acc-1, amount="5", every="monthly"))')).toBe("an offer with no one named");
  expect(implausible("agreement(sign=rec.9)")).toBeUndefined();
  // The audit's own case: the request says "from [works-41] to [c2883]" for goods delivered AT works-41. Mechanically dropped now.
  const supply = 'agreement(our_notice="a fortnight", template=supply, term="7 years", they_do=money(amount="ORO 23,550", to=acc-fisheries-90), we_do=goods(at=works-41, kind=goods, quantity="19", to=c2883), with=c2883)';
  const audited = 'Offer [c2883] a supply agreement for "7 years", under which they pay "ORO 23,550" into [acc-fisheries-90] and we deliver 19 goods from [works-41] to [c2883]. Our notice on the agreement shall be "a fortnight".';
  expect(badlyWritten(audited, supply)).toBe("place_reversed");
  const r = await generate([{ program: supply, shape: shapeOf(calls.parseProgram(supply)), names: {}, source: "t", origin: "synthetic" }], { writers: [writer("a", () => audited)], perGold: 1, styles: ["formal"] });
  expect([r.examples.length, r.manifest.dropped.place_reversed]).toEqual([0, 1]);
  // Said with where they come from as that, the same words are a different, consistent program.
  expect(badlyWritten(audited, supply.replace("at=works-41", "from_at=works-41, at=str.5").replace("to=c2883)", "to=c2883)")) ?? badlyWritten(audited.replace("to [c2883].", "to [c2883] at [str.5]."), supply.replace("at=works-41", "from_at=works-41, at=str.5"))).toBeUndefined();
});

test("gold is kept in one spelling whatever wrote it: counts, amounts and times quoted, a list of one unwrapped, a flag as yes", async () => {
  const text = (program: string) => goldText(calls.parseProgram(program));
  // The audit's case, from a log: `units=1` and `by=["c0007"]` beside generated `units="1"`, `by=c0007`.
  expect(text('work(task=teach, units=1, at=school-building, by=["c0007"], on=school-building/classroom.3)')).toBe('work(at=school-building, by=c0007, on=school-building/classroom.3, task=teach, units="1")');
  expect(text("goods(kind=goods, quantity=40, from_at=str.7, to=builder, at=str.8)")).toBe('goods(at=str.8, from_at=str.7, kind=goods, quantity="40", to=builder)');
  expect(text('message(to=["Millbrook Builders"], text="Hello.")')).toBe('message(text="Hello.", to="Millbrook Builders")'); // (a name stays quoted)
  expect(text('message(to=["builder","works"], text="Hello.")')).toBe('message(text="Hello.", to=["builder","works"])'); // (a list of several stays a list)
  expect(text('work(task=survey, at=lot-01, survey=trout, cells=["cell.1.2"])')).toBe("work(at=lot-01, cells=cell.1.2, survey=trout, task=survey)");
  expect(text("occupancy(in=apts-2, leave=true, who=c0193)")).toBe("occupancy(in=apts-2, leave=yes, who=c0193)");
  expect(text("presence(leave=TRUE)")).toBe("presence(leave=yes)");
  expect(text("money(to=acc-1, amount=500, every=monthly)")).toBe('money(amount="500", every="monthly", to=acc-1)');
  // Each means what it meant.
  for (const p of ['work(task=teach, units=1, at=school-building, by=["c0007"])', "goods(kind=goods, quantity=40, at=str.8)", 'message(to=["builder"], text="Hello.")', "occupancy(in=apts-2, leave=true)"]) expect([p, sameMeaning(p, text(p))]).toEqual([p, true]);
  // From a log and from the seen cases, as from the generator: no bare count, no list of one, no other spelling of yes.
  const fromLog = await goldFromLog([header, act('work(task=make, units=3, at=str.7, by=["c0042"])'), act("goods(kind=goods, quantity=40, from_at=str.7, to=builder, at=str.8)"), act("occupancy(in=apts-3/dwelling.2, leave=true, who=c0042)")]);
  expect(fromLog.map((g) => g.program).sort()).toEqual(['goods(at=str.8, from_at=str.7, kind=goods, quantity="40", to=builder)', "occupancy(in=apts-3/dwelling.2, leave=yes, who=c0042)", 'work(at=str.7, by=c0042, task=make, units="3")']);
  const all = [...fromLog, ...goldFromCases(CASES), ...synthetic({ seed: 3, perFunction: 60 })];
  expect(all.length).toBeGreaterThan(1000);
  for (const g of all) {
    expect([g.program, /\b(units|quantity|amount|price|carrying|every|term|our_notice|their_notice|first|age)=[^"\s]/.test(g.program.replace(/"(?:[^"\\]|\\.)*"/g, '""'))]).toEqual([g.program, false]);
    expect([g.program, /=\["[^",\]]*"\]/.test(g.program)]).toEqual([g.program, false]);
    expect([g.program, /leave=(?!yes\b)/.test(g.program)]).toEqual([g.program, false]);
  }
  // A time a town's code counts to the second is nothing anyone says.
  expect(implausible('money(to=acc-1, amount="5", every="30 days", first="5914794 seconds")')).toBe("a length of time counted in seconds");
});

test("how often is the request's own words for it: the gold's `every` is the span the writer was told to use, in a form the parser reads, varied across examples", async () => {
  expect(howOften("30 days")).toEqual(expect.arrayContaining(["every 30 days", "every month", "a month", "per month", "monthly"]));
  expect(howOften("28 days")).toEqual(["every 28 days", "every 4 weeks", "every four weeks"]);
  expect(howOften("every 14 days")).toEqual(expect.arrayContaining(["every 14 days", "every 2 weeks", "every two weeks", "every fortnight", "a fortnight", "fortnightly"]));
  expect(howOften("yearly")).toEqual(expect.arrayContaining(["every year", "a year", "yearly", "annually"]));
  expect(howOften("not a time")).toEqual([]);
  // Every way reads back as the same length of time, and none is the bare length (how long, not how often).
  for (const t of ["1 day", "7 days", "10 days", "14 days", "28 days", "30 days", "90 days", "365 days", "3 weeks", "2 months", "6 months", "weekly", "a quarter"]) {
    const ways = howOften(t);
    expect(ways.length).toBeGreaterThan(0);
    for (const w of ways) {
      expect([t, w, calls.parseDuration(w)]).toEqual([t, w, calls.parseDuration(t)]);
      expect([w, /^(every |per |an? )|ly$/.test(w)]).toEqual([w, true]);
    }
  }
  // Generated gold says it one of those ways already (in a commitment too).
  const gold = synthetic({ seed: 4, perFunction: 200, only: ["money", "agreement"] });
  const recurring = gold.filter((g) => everyIn(g.program).length);
  expect(recurring.length).toBeGreaterThan(100);
  for (const g of recurring) for (const x of everyIn(g.program)) expect([g.program, howOften(x).includes(x)]).toEqual([g.program, true]);
  expect(new Set(recurring.flatMap((g) => everyIn(g.program))).size).toBeGreaterThan(20);
  // A log's gold says the bare length, as code writes it: each request for it is asked for with one of the ways, the
  // writer is told the words, and the example's program has those words (it stays in the gold program's family).
  const [rent] = await goldFromLog([header, act('money(to=acc-landlord-1, amount="$850", from=acc-c0001, every="30 days", for="rent")')]);
  expect(rent!.program).toContain('every="30 days"');
  const varied = withHowOften(rent!, sampler(2));
  expect(varied.family).toBe(rent!.program);
  expect(sameMeaning(varied.program, rent!.program)).toBe(true);
  expect(howOften("30 days")).toContain(everyIn(varied.program)[0]!);
  expect(withHowOften({ ...rent!, program: "vote(ballot=rec.1, choice=yes)" }, sampler(2)).family).toBeUndefined(); // (nothing recurring: untouched)
  expect(writerNotes('money(to=acc-1, amount="5", every="every 28 days")', sampler(1)).join("\n")).toContain('how often is said in exactly these words: "every 28 days".');
  const asked: string[] = [];
  const r = await generate([rent!, ...recurring.slice(0, 80)], { writers: [writer("a", saying, asked)], perGold: 6, styles: ["terse", "formal", "polite"] });
  const positives = r.examples.filter((e) => e.kind === "positive");
  expect(positives.length).toBeGreaterThan(200); // (the stand-in says one program one way: its repeats are dropped as said before)
  for (const e of positives) {
    const every = everyIn(e.program);
    expect(every.length).toBeGreaterThan(0);
    // No example has a gold `every` that is not a span of its request; it is copied, and it says how often.
    const spans = (e.spans ?? []).filter((s) => s.arg.split(".").pop() === "every");
    expect(spans.length).toBe(every.length);
    for (const s of spans) expect([e.request.slice(...s.at!), s.how, howOften(s.value).includes(s.value)]).toEqual([s.value, "copy", true]);
  }
  const rents = positives.filter((e) => e.gold === rent!.program);
  expect(rents.length).toBeGreaterThanOrEqual(3); // (of six asked for: two said the same way are one request)
  expect(new Set(rents.map((e) => everyIn(e.program)[0])).size).toBeGreaterThan(2); // varied across the requests for one program
  for (const e of rents) expect(asked.some((a) => a.includes(`Call:\n${e.program}\n`) && a.includes(`how often is said in exactly these words: "${everyIn(e.program)[0]}".`))).toBe(true);
  // A writer that says it another way ("each month" for "monthly") has lost the span: dropped, mechanically.
  const other = await generate([rent!], { writers: [writer("a", (program) => saying(program).replace(everyIn(program)[0]!, "now and again"))], perGold: 4, styles: ["terse"] });
  expect([other.examples.length, other.manifest.dropped.not_copied]).toEqual([0, 4]);
  expect(writerSystem()).toContain("How often something recurs is said in exactly the words the call has for it");
});

test("the writer is given several ways of saying each act, chosen by seed, and told not to say the description back; a request that does is dropped", async () => {
  // Every function has its ways, several to each pattern of arguments; none uses the wording the audit found everywhere.
  for (const fn of Object.keys(calls.ARGS)) {
    const ways = SAYINGS[fn];
    expect([fn, !!ways && ways.every(([, s]) => s.length >= 3) && ways.reduce((n, [, s]) => n + s.length, 0) >= 6]).toEqual([fn, true]);
    expect([fn, ways![ways!.length - 1]![0]]).toEqual([fn, ""]); // (the last fits any call)
  }
  const all = (fn: string) => SAYINGS[fn]!.flatMap(([, s]) => s).join(" | ").replace(/\{[a-z_]+\}/g, "…");
  expect(all("harm")).not.toMatch(/physical/i);
  expect(all("take")).not.toMatch(/agreement|consent|where they are/i);
  expect(all("vote")).not.toMatch(/\bcast\b|\bchoice\b/i);
  expect(all("occupancy")).not.toMatch(/someone/i);
  expect(all("birth")).not.toMatch(/record|conceive/i);
  expect(SAYINGS.system!.find(([p]) => p === "retire")![1].join(" | ")).not.toMatch(/for good/i);
  // One is chosen by seed, with the call's own values in it.
  const ways = (program: string, n = 60) => {
    const rand = sampler(3);
    return new Set(Array.from({ length: n }, () => sayingFor(callOf(program), rand)!));
  };
  for (const [program, value, least] of [["harm(who=c6587)", "c6587", 9], ['take(kind=bread, quantity="17", from=par.153, at=shop-68)', "par.153", 7], ["occupancy(in=house-61)", "house-61", 5], ["system(retire=par.263)", "par.263", 6], ["vote(ballot=rec.3, choice=yes)", "rec.3", 7], ['birth(name="Kofi", template=baby)', "baby", 4]] as const) {
    const said = ways(program);
    expect([program, said.size >= least]).toEqual([program, true]);
    for (const s of said) expect([s, s.includes(value), /[{}]/.test(s)]).toEqual([s, true, false]);
  }
  // Which pattern: who moves is the one named, or (nobody named) the speaker; never "someone".
  for (const s of ways("occupancy(in=house-61)")) expect(s).toMatch(/\b(I|I'm|I'll|me)\b/);
  for (const s of ways("occupancy(in=house-61, who=c1004)")) expect(s).toContain("c1004");
  for (const s of ways("occupancy(in=house-61, leave=yes)")) expect(s).toMatch(/\b(I|I'm|I'll|me)\b/);
  for (const s of ways('presence(name="Ana Silva", age="17 years", template=apprentice)')) expect([s, s.includes("apprentice"), /\ba apprentice/.test(s)]).toEqual([s, true, false]);
  expect(sayingFor(callOf('work(task=make, units="9", at=str.5, by=["c1","c2","c3"])'), sampler(1))).toContain("c1, c2 and c3");
  expect(sayingFor(callOf("form(form=footpath_declaration, to=roads-3)"), sampler(1))).toContain("footpath declaration");
  // Every generated program gets one for each of its lines, whatever its arguments.
  const gold = [...synthetic({ seed: 5, perFunction: 60 }), ...syntheticForms({ sets: 8, perForm: 2, seed: 5 })];
  const rand = sampler(9);
  for (const g of gold) {
    const notes = writerNotes(g.program, rand);
    expect([g.program, notes.filter((n) => n.includes("said something like: \"")).length]).toEqual([g.program, linesOf(g.program).length]);
    expect([g.program, notes.some((n) => /\{[a-z_]+\}/.test(n))]).toEqual([g.program, false]);
  }
  // In the brief: different ways for the several requests of one program, with the instruction not to reuse the description.
  const asked: string[] = [];
  const harm: Gold = { program: "harm(who=c6587)", shape: "harm(who)", names: {}, source: "t", origin: "synthetic" };
  let n = 0;
  await generate([harm], { writers: [writer("a", () => `Hit c6587, number ${n++}.`, asked)], perGold: 12, styles: ["terse", "formal"] });
  const suggested = asked.map((a) => /How to say it:\nThe act, said something like: "([^"]+)"\./.exec(a)?.[1]);
  expect(suggested.every((s) => !!s)).toBe(true);
  expect(new Set(suggested).size).toBeGreaterThanOrEqual(6);
  for (const a of asked) expect(a).toContain("What it brings about (for your understanding: don't reuse this wording):");
  const system = writerSystem();
  for (const told of ["It is not wording to use: never repeat its phrases", "Nobody says \"physically harm\"", "say \"I\" or \"me\", never \"someone\"", "never the one for the other", "Don't put quotation marks round an id", "said with a space (charge_to as \"charge to\")"]) expect([told, system.includes(told)]).toEqual([told, true]);
  // What a writer says back anyway is dropped before any model is asked, and counted.
  const echo = await generate([harm], { writers: [writer("a", () => `Physically harm c6587, number ${n++}.`)], perGold: 3, styles: ["terse"] });
  expect([echo.examples.length, echo.manifest.dropped.description_echoed]).toEqual([0, 3]);
  // What a value is, where a sentence easily says the wrong thing of it.
  const notes = writerNotes('goods(kind=coal, quantity="15", at=str.340)', sampler(1)).join("\n");
  expect(notes).toContain("str.340 is the place they are delivered to");
  expect(notes).toContain("nobody is named to receive them, so they stay the speaker's own");
  expect(writerNotes('claim(position=liberty, holder=c1, about={"action":"fish","object":"cell.1.2"})', sampler(1)).join("\n")).toContain("\"may\", \"is permitted to\"");
});

test("refusals are worded many ways: many verbs of looking, many kinds of someone else's decision, many kinds of vagueness", () => {
  const gold = synthetic({ seed: 3, perFunction: 20, only: ["money", "vote", "occupancy", "goods", "structure"] });
  const briefs = refusalBriefs(gold, 300, 3);
  const of = (label: string) => briefs.filter((b) => b.label === label).map((b) => b.brief);
  const share = (xs: string[], x: (s: string) => boolean) => xs.filter(x).length / xs.length;
  // To look: see, read, check, review, inspect, look up, tell me, what is, who holds … ("Show me" is one of thirty).
  const looks = of("not_an_act").map((b) => /Put it something like "([^"]+)"/.exec(b)![1]!);
  expect(looks.length).toBe(300);
  expect(new Set(looks).size).toBeGreaterThanOrEqual(20);
  expect(share(looks, (x) => x.startsWith("Show me"))).toBeLessThan(0.12);
  for (const verb of ["See", "Read", "Check", "Review", "Inspect", "Look up", "Tell me", "What is", "Who holds"]) expect([verb, looks.some((x) => x.startsWith(verb))]).toEqual([verb, true]);
  for (const b of of("not_an_act")) expect(b).toContain("don't add that nothing is to be changed, sent or recorded"); // (the audit: a formula in three of eight)
  // Someone else's to decide: prices are one decision of thirty.
  const decisions = of("not_yours").map((b) => /\) to (.+?): something that is for them to decide/.exec(b)![1]!);
  expect(new Set(decisions).size).toBeGreaterThanOrEqual(20);
  expect(share(decisions, (x) => /prices/.test(x))).toBeLessThan(0.12);
  expect(new Set(of("not_yours").map((b) => /put something like "([^"]+)"/.exec(b)![1])).size).toBeGreaterThanOrEqual(8);
  for (const b of of("not_yours")) expect(b).toContain("don't say that the matter is theirs to decide");
  // With nobody named in the gold programs there is still someone whose decision it is.
  expect(refusalBriefs([], 4, 1).filter((b) => b.label === "not_yours").length).toBe(4);
  // Vague: many kinds, about many things, and not "Something about X".
  const kinds = of("unclear").map((b) => /The vagueness is of this kind: (.+?)\. A sentence or two/.exec(b)![1]!);
  expect(new Set(kinds).size).toBeGreaterThanOrEqual(9);
  expect(new Set(of("unclear").map((b) => /done about (.+?) and doesn't say what/.exec(b)![1])).size).toBeGreaterThanOrEqual(20);
  for (const b of of("unclear")) expect(b).toContain("it doesn't begin \"Something about\"");
  expect(refusalWriterSystem()).toContain("don't borrow its wording for what kind of request this is");
});

test("blind checking: the requests go to a reader shuffled, and the reader's answers are compared by meaning, per function", () => {
  // A data set in the order the pipeline writes it: positives function by function, then the refusals.
  const forms = syntheticForms({ sets: 4, perForm: 2, seed: 2 });
  const gold = [...synthetic({ seed: 2, perFunction: 15, only: ["money", "occupancy", "work", "vote"] }), ...forms];
  const positives: Example[] = gold.map((g, i) => ({
    id: `p${String(i).padStart(3, "0")}`, request: `Request ${i}: ${literals(calls.parseProgram(g.program)).join(", ")}.`, forms: (g.forms ?? []).map(formLine), program: g.program, kind: "positive", shape: g.shape, source: g.source,
    gold: g.program, written_by: "stand-in/w", verified_by: "stand-in/back", ...(g.currency ? { currency: g.currency } : {}),
  }));
  const refusals: Example[] = Array.from({ length: 20 }, (_, i) => ({ id: `r${String(i).padStart(3, "0")}`, request: `Sort out thing ${i}.`, forms: [], program: i % 2 ? "none(unclear)" : "none(not_an_act)", kind: "refusal", shape: i % 2 ? "none(unclear)" : "none(not_an_act)", source: "written: brief" }));
  const examples = [...positives, ...refusals];

  const blind = blindRequests(examples, 5);
  // Only what a reader may see: the id, the request, the forms. No program, no label, nothing of how it was made.
  for (const b of blind) expect(Object.keys(b)).toEqual(["id", "request", "forms"]);
  expect(JSON.stringify(blind)).not.toMatch(/none\(|"program"|"shape"|"kind"|"source"|verified/);
  expect(blind.map((b) => b.id).sort()).toEqual(examples.map((e) => e.id).sort());
  // Shuffled: not the data's order, the refusals not together at the end; the same for the same seed, whatever order
  // the examples came in; another for another seed.
  expect(blind.map((b) => b.id)).not.toEqual(examples.map((e) => e.id));
  const refused = blind.map((b, i) => (b.id.startsWith("r") ? i : -1)).filter((i) => i >= 0);
  expect(refused[0]!).toBeLessThan(blind.length / 4);
  expect(refused.filter((i) => i >= blind.length - 20).length).toBeLessThan(10);
  expect(refused.filter((i) => i < blind.length / 2).length).toBeGreaterThan(4);
  expect(blindRequests(examples, 5)).toEqual(blind);
  expect(blindRequests([...examples].reverse(), 5)).toEqual(blind);
  expect(blindRequests(examples, 6).map((b) => b.id)).not.toEqual(blind.map((b) => b.id));
  // A form's line reads back to what a comparison needs of it.
  for (const f of new Set(forms.flatMap((g) => g.forms!))) expect(formOfLine(formLine(f))).toEqual({ ...f, id: formOfLine(formLine(f))!.id, fields: Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, { type: v.type, ...(v.options ? { options: v.options } : {}), ...(v.required ? { required: true } : {}) }])) });

  // A reader's answers: right however spelled (a flag as true, the form in ordinary words with its office left out
  // where one office has it, the arguments in another order), wrong for some, missing for some, one for no example here.
  const respelt = (e: Example): string => {
    const c = callOf(e.program);
    const args = Object.entries(c.args).reverse().map(([k, v]): [string, calls.Value] => [k, k === "leave" ? { id: "true" } : k === "form" && "id" in v ? { text: v.id.replace(/_/g, " ") } : v]);
    return calls.callText({ fn: c.fn, args: Object.fromEntries(args) });
  };
  const wrong = new Set(positives.filter((_, i) => i % 9 === 0).map((e) => e.id));
  const missing = new Set(positives.filter((_, i) => i % 13 === 5).map((e) => e.id));
  const answers = [
    ...positives.filter((e) => !missing.has(e.id)).map((e) => ({ id: e.id, program: wrong.has(e.id) ? "none(unclear)" : respelt(e) })),
    ...refusals.map((e, i) => ({ id: e.id, program: i === 3 ? "none(no_such_act)" : e.program })),
    { id: "nobody", program: "none(unclear)" },
  ];
  const r = checkAnswers(examples, answers, "reader-x");
  const wrongAnswered = [...wrong].filter((id) => !missing.has(id)).length;
  expect(r.report).toMatchObject({ reader: "reader-x", examples: examples.length, unanswered: missing.size, disagreed: wrongAnswered + 1, agreed: examples.length - missing.size - wrongAnswered - 1, unknown_ids: 1 });
  expect(r.checked.length).toBe(r.report.agreed);
  expect(r.unanswered.map((e) => e.id).sort()).toEqual([...missing].sort());
  // Agreed: marked verified by the reader (who translated it back before is kept); disagreed: both programs.
  for (const e of r.checked) expect([e.verified_by, e.translated_back_by]).toEqual(e.kind === "positive" ? ["reader-x", "stand-in/back"] : ["reader-x", undefined]);
  expect(r.checked.some((e) => e.shape.startsWith("form(")) && r.checked.some((e) => e.program.includes("leave=yes"))).toBe(true);
  for (const e of r.disagreed) expect([e.reader, e.answer !== e.program, e.program]).toEqual(["reader-x", true, examples.find((x) => x.id === e.id)!.program]);
  expect(r.disagreed.find((e) => e.id === "r003")!.answer).toBe("none(no_such_act)");
  // Per function, the three counts add up to its examples.
  for (const [fn, n] of Object.entries(r.report.by_function)) expect([fn, n.agreed + n.disagreed + n.unanswered]).toEqual([fn, examples.filter((e) => functionOf(e) === fn).length]);
  expect(r.report.by_function["none(unclear)"]).toEqual({ agreed: 9, disagreed: 1, unanswered: 0 });
  expect(Object.keys(r.report.by_function)).toEqual(Object.keys(r.report.by_function).sort());
  // An amount written another way in the example's own money is the same answer; in bare digits of another size it isn't.
  const paid = positives.find((e) => e.shape.startsWith("money(") && e.currency)!;
  expect(checkAnswers([paid], [{ id: paid.id, program: paid.program }], "x").report.agreed).toBe(1);
  expect(checkAnswers([paid], [{ id: paid.id, program: paid.program.replace(/amount="[^"]*"/, 'amount="123456789"') }], "x").report.disagreed).toBe(1);
});
