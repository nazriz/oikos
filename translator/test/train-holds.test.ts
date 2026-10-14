// A hold, an entry on one's own file and `look_first`, through the translator's instructions, the training-data
// pipeline, the seen cases and the trained model's code (docs/design/call-language-gaps.md B.1, B.2, B.3, B.5).

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { CASES } from "../eval/cases";
import { fixture, passes } from "../eval/run";
import { passesReal, PILOT_CASES } from "../eval/pilot-run";
import { ADDED, cannotSay, DecideAdapter, programOf, vocabularyOf } from "../model/adapter";
import { decode, encode, vocabulary } from "../model/encode";
import { pieces } from "../model/export";
import { LABEL_TEXT, translatorSystem, TRANSLATOR_VERSION } from "../src/index";
import { resolve } from "../src/resolver";
import { bringsAbout, DATA_VERSION, generate, impliedIn, literals, mustAppear, needed, refusalBriefs, sameMeaning, sayingFor, spansIn, type Gold } from "../train/data";
import { everyCurrency, synthetic } from "../train/synthetic";

const parsed = (program: string) => calls.parseProgram(program) as { lines: calls.Line[] };
const statements = () => synthetic({ only: ["statement"], perFunction: 900, seed: 5 });
const isHold = (g: Gold) => g.shape.startsWith("statement(") && "hold" in parsed(g.program).lines[0]!.call.args;
const isEntry = (g: Gold) => /visible=own/.test(g.program);

test("the translator's instructions say the three things, and nothing of any world", () => {
  const s = translatorSystem();
  expect(TRANSLATOR_VERSION).toBe("0.9.5");
  expect(s).toContain("is statement(hold=<it>), one statement for several");
  expect(s).toContain("Resuming it is withdrawing the hold: statement(withdraw=<the hold>).");
  expect(s).toContain("is statement(kind=entry, visible=own, text=");
  expect(s).toContain("  - look_first: it can't be written until something has been found out.");
  // Holding something is no longer among the things no function does, nor is a record named by description.
  const noSuchAct = s.split("\n").find((l) => l.startsWith("  - no_such_act:"))!;
  expect(noSuchAct).not.toMatch(/hold|paus|describing/);
  // The examples: the hold, its lifting, the refusal, the entry.
  for (const e of ["->  statement(hold=rec.44)", "->  statement(withdraw=rec.61)", "->  none(look_first)", "->  statement(kind=entry, visible=own, text="]) expect(s).toContain(e);
  expect(s).not.toContain("on hold until I say to resume it.  ->  none(no_such_act)");
  // The function list has the new argument, the syntax the new label.
  expect(s).toMatch(/- statement\([^)]*\bhold\b[^)]*\):/);
  expect(s).toContain("with one of eight labels");
  // The examples of the instructions are right by the resolver, for a seat that knows the record.
  const k = fixture();
  expect(resolve(calls.parseProgram("statement(hold=rec.90)"), k, () => undefined, "mayor").ok).toBe(true);
});

test("generated gold: holds of one record or a few, and entries on one's own file, in the money of every world drawn", () => {
  expect(DATA_VERSION).toBe("0.14.0");
  const gold = statements();
  const holds = gold.filter(isHold), entries = gold.filter(isEntry);
  expect(holds.length).toBeGreaterThan(60);
  expect(entries.length).toBeGreaterThan(50);
  // A hold: one record bare, or a list of two to four, each named once; no kind, no words, nobody named to hold it.
  const sizes = new Set<number>();
  for (const g of holds) {
    const a = parsed(g.program).lines[0]!.call.args;
    expect(Object.keys(a).filter((k) => !["hold", "basis"].includes(k))).toEqual([]);
    const held = "id" in a.hold! ? [a.hold.id] : ((a.hold as { json: string[] }).json);
    expect(new Set(held).size).toBe(held.length);
    expect("id" in a.hold! ? 1 : held.length >= 2 && held.length <= 4 ? held.length : -1).toBe(held.length);
    sizes.add(held.length);
    // Every record it holds is the request's to carry, word for word.
    expect(mustAppear(parsed(g.program))).toEqual(expect.arrayContaining(held));
  }
  expect([...sizes].sort()).toEqual([1, 2, 3, 4]);
  // An entry: kind entry, visible own, words; its kind and whose file are implied by the wording, never looked for.
  const monies = new Set<string>();
  let sums = 0;
  for (const g of entries) {
    const a = parsed(g.program).lines[0]!.call.args as { [k: string]: any };
    expect([a.kind.id, a.visible.id, typeof a.text.text]).toEqual(["entry", "own", "string"]);
    expect(Object.keys(a).filter((k) => !["kind", "visible", "text", "basis"].includes(k))).toEqual([]);
    expect(impliedIn(parsed(g.program)).map((n) => `${n.arg}=${n.value}`).sort()).toEqual(["kind=entry", "visible=own"]);
    expect(needed(parsed(g.program)).map((n) => n.arg).sort()).toEqual("basis" in a ? ["basis", "text"] : ["text"]);
    // A sum in its words is written as its world writes money: read back by that world's own parser.
    const m = /^(?:Deposit of |Payment of )?(.+?) (?:withheld|charged|held for|set aside|owed to us|for .+ counted|received in cash)/.exec(a.text.text);
    if (m && /[0-9]/.test(m[1]!)) {
      expect(() => calls.parseAmount(m[1]!, g.currency!)).not.toThrow();
      monies.add(g.currency!.code);
      sums++;
    }
  }
  expect(sums).toBeGreaterThan(30);
  expect(monies.size).toBeGreaterThan(Math.min(12, everyCurrency().length - 4));
  // The same seed, the same programs.
  expect(statements().map((g) => g.program)).toEqual(gold.map((g) => g.program));
});

test("how a hold and an entry are said to a writer, and where a request carries them", () => {
  const hold = parsed('statement(hold=["job-c0003-wages","rec.412"])').lines[0]!.call;
  const said = new Set(Array.from({ length: 40 }, (_, i) => sayingFor(hold, () => (i % 9) / 9)));
  expect(said.size).toBe(9);
  for (const s of said) expect(s).toContain("job-c0003-wages and rec.412");
  expect(bringsAbout("statement(hold=rec.412)")[0]).toContain("put on hold for a time, to be resumed later");
  expect(bringsAbout('statement(kind=entry, visible=own, text="x")')[0]).toContain("in the speaker's own books");
  expect(bringsAbout('statement(kind=notice, visible=public, text="x")')[0]).toContain("something is published");
  expect(sayingFor(parsed('statement(kind=entry, visible=own, text="x")').lines[0]!.call, () => 0)).toBe("note in our own books: …");
  expect(sayingFor(parsed("statement(withdraw=rec.61)").lines[0]!.call, () => 0.95)).toBe("release the hold rec.61: what it held is to go on again");
  // Spans: each record held is copied; an entry's kind and `own` have no span, and its words are copied whole.
  const how = (request: string, program: string) => spansIn(request, program).map((s) => `${s.arg}=${s.value}: ${s.how}${s.at ? ` "${request.slice(...s.at)}"` : ""}`);
  expect(how("Put job-c0003-wages and rec.412 on hold until I say.", 'statement(hold=["job-c0003-wages","rec.412"])')).toEqual(['hold=job-c0003-wages: copy "job-c0003-wages"', 'hold=rec.412: copy "rec.412"']);
  expect(how("Note in our own books: 40 kr withheld from wages, under rec.9.", 'statement(basis=rec.9, kind=entry, text="40 kr withheld from wages", visible=own)')).toEqual(
    ['basis=rec.9: copy "rec.9"', 'text=40 kr withheld from wages: copy "40 kr withheld from wages"', "kind=entry: implied", "visible=own: implied"]);
  // A published statement's kind is still a word of the request.
  expect(how("Publish a notice: closed.", 'statement(kind=notice, text="closed")')).toContain('kind=notice: choice "notice"');
  // By meaning: a list in any order, a list of one, the kind written or not.
  expect(sameMeaning('statement(hold=["rec.2","rec.1"])', 'statement(hold=["rec.1","rec.2"])')).toBe(true);
  expect(sameMeaning('statement(hold=["rec.1"])', "statement(hold=rec.1)")).toBe(true);
  expect(sameMeaning("statement(kind=hold, hold=rec.1)", "statement(hold=rec.1)")).toBe(true);
  expect(sameMeaning("statement(hold=rec.1)", "statement(withdraw=rec.1)")).toBe(false);
  expect(sameMeaning('statement(kind=entry, visible=own, text="x")', 'statement(kind=entry, visible=public, text="x")')).toBe(false);
});

test("look_first briefs: a standing payment named only by what it pays, in each world's money; a record only described; an act that depends on a look", () => {
  const standing = synthetic({ only: ["money"], perFunction: 400, seed: 6 }).filter((g) => /[(,]every[,)]/.test(g.shape) && !g.program.includes("\n"));
  expect(standing.length).toBeGreaterThan(40);
  const briefs = refusalBriefs(standing, 240, 6).filter((b) => b.label === "look_first");
  expect(briefs.length).toBe(240);
  const kinds = [briefs.filter((b) => b.brief.includes("keeps repeating")), briefs.filter((b) => b.brief.includes("only by describing it, with no id for it")), briefs.filter((b) => b.brief.includes("depends on what is found"))];
  expect(kinds.map((k) => k.length)).toEqual([80, 80, 80]);
  // The first: the payment's amount, as its own world writes it, and the accounts it runs between are the request's
  // to carry; the program it was made from goes with it into the split; and no id for the instruction is given.
  const monies = new Set<string>();
  for (const b of kinds[0]!) {
    const g = standing.find((x) => (x.family ?? x.program) === b.gold)!;
    const a = parsed(g.program).lines[0]!.call.args as { [k: string]: any };
    expect(b.mustCopy).toContain(a.amount.text);
    expect(() => calls.parseAmount(a.amount.text, g.currency!)).not.toThrow();
    monies.add(g.currency!.code);
    for (const k of ["from", "to"]) if (a[k] && "id" in a[k]) expect(b.mustCopy).toContain(a[k].id);
    for (const id of b.mention ?? []) expect(literals(parsed(g.program))).not.toContain(id);
    expect(b.brief).toContain("No id for the instruction appears");
  }
  expect(monies.size).toBeGreaterThan(10);
  for (const b of [...kinds[1]!, ...kinds[2]!]) expect([b.mustCopy, b.mention]).toEqual([[], undefined]);
  // No brief of any label asks any longer for a hold as something that can't be said.
  for (const b of refusalBriefs(standing, 60, 6)) if (b.label === "no_such_act") expect(b.brief).not.toMatch(/already stands|not ended, cancelled or withdrawn/);
});

/** A writer that says a program back as a sentence holding every literal; a refusal's brief as a fixed sentence by its kind. */
const writer: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req: LlmRequest) => {
  const content = String((req.messages[0] as any).content);
  let text: string;
  if (content.startsWith("Situation:")) {
    const copy = /acc[-.][a-z0-9.-]+/.exec(content)?.[0] ?? "";
    text = content.includes("keeps repeating") ? `Stop any standing payment that goes out as described: ${[...content.slice(content.indexOf("keeps repeating: ") + 17, content.indexOf("\n", content.indexOf("keeps repeating: "))).matchAll(/(?:=)("(?:[^"\\]|\\.)*"|[a-z0-9][a-z0-9._\/-]*)/g)].map((m) => m[1]!.replace(/^"|"$/g, "")).join(", ")}. (${content.length})`
      : content.includes("only by describing it") ? `Take down whichever notice it is. (${content.length})` : content.includes("depends on what is found") ? `Find who it is and then write to them. (${content.length})` : `Something else ${copy}. (${content.length})`;
  } else {
    const program = content.slice("Call:\n".length, content.indexOf("\n\n"));
    text = `Please see to this: ${literals(calls.parseProgram(program)).join(", ")}.`;
  }
  return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
} };

test("through the pipeline: holds and entries become examples with their spans, look_first refusals are kept as that, and the steps a model learns hold the new choices", async () => {
  // (And standing work orders that end, `until=`, which the language gained on 2026-10-09: translator/model/adapter.ts, ADDED.)
  const ending = synthetic({ only: ["work"], perFunction: 300, seed: 6 }).filter((g) => g.tag === "standing_work" && /[(,]until[,)]/.test(g.shape)).slice(0, 10);
  expect(ending.length).toBe(10);
  const gold = [...statements().filter((g) => isHold(g) || isEntry(g)).slice(0, 60), ...synthetic({ only: ["money"], perFunction: 200, seed: 6 }).filter((g) => /[(,]every[,)]/.test(g.shape) && !g.program.includes("\n")).slice(0, 20), ...ending];
  const back = { model: "stand-in/back", translate: async (q: string, _forms: string[], g?: Gold) => (/^Stop any standing payment|^Take down whichever|^Find who it is/.test(q) ? "none(look_first)" : g?.program ?? "none(unclear)") };
  const r = await generate(gold, { writers: [writer], perGold: 1, styles: ["formal"], refusalFloor: 4, refusalLabels: ["look_first"], seed: 6, back });
  const kept = r.examples.filter((e) => e.kind === "positive");
  const holds = kept.filter((e) => e.program.includes("hold=")), entries = kept.filter((e) => e.program.includes("visible=own"));
  expect(holds.length).toBeGreaterThan(15);
  expect(entries.length).toBeGreaterThan(15);
  const refusals = r.examples.filter((e) => e.program === "none(look_first)");
  expect(refusals.length).toBeGreaterThanOrEqual(4);
  expect(r.examples.filter((e) => e.kind === "refusal" && e.program !== "none(look_first)")).toEqual([]);
  // Encoded as decisions and copies, and back, exactly; the closed set of choices holds what the language gained.
  const orders = kept.filter((e) => e.program.startsWith("work(") && e.program.includes("until="));
  expect(orders.length).toBeGreaterThan(5);
  const all = [...holds, ...entries, ...refusals, ...orders].map((e) => encode(e));
  [...holds, ...entries, ...refusals, ...orders].forEach((e, i) => expect(decode(all[i]!.input, all[i]!.steps)).toBe(calls.programText(calls.parseProgram(e.program))));
  const v = vocabulary(all);
  for (const [choice] of ADDED) expect(v).toContain(choice);
  expect(v).toContain("const:entry");
  expect(cannotSay(v)).toEqual([]);
});

test("a model trained before the language gained these still loads: it is known what it cannot say, and an answer outside the language is asked back", () => {
  // A model's closed set is its own (its config.json). One from before 2026-10-08 has none of the three.
  const old = ["eos", ")", "fn:statement", "fn:money", "arg:withdraw", "arg:kind", "arg:text", "arg:visible", "const:public", "none:no_such_act", "none:not_an_act", "none:unclear"];
  expect(cannotSay(old).map(([choice]) => choice)).toEqual(["arg:hold", "const:own", "none:look_first", "arg:until"]);
  expect(cannotSay([...old, "arg:hold", "const:own", "none:look_first", "arg:until"])).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), "oikos-old-model-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ vocabulary: old, width: 8 }));
  expect(vocabularyOf(dir)).toEqual(old);
  // (Making the adapter starts no model: that happens at the first request.)
  const adapter = new DecideAdapter("old", { dir, quiet: true });
  expect(adapter.cannot.map(([choice]) => choice)).toEqual(["arg:hold", "const:own", "none:look_first", "arg:until"]);
  // A folder with no config, or one that isn't a model's: nothing is known, and nothing fails.
  expect(vocabularyOf(join(dir, "nowhere"))).toBeUndefined();
  expect(new DecideAdapter("none", { dir: join(dir, "nowhere"), quiet: true }).cannot).toEqual([]);
  writeFileSync(join(dir, "config.json"), "not json");
  expect(vocabularyOf(dir)).toBeUndefined();
  // Its answers are from its own set, all still in the language: what it was taught for a pause is a refusal the
  // language still has, with the sentence that label has now.
  const input = "Put standing payment rec.44 on hold until I say to resume it.";
  const ps = pieces(input);
  expect(programOf(input, ps, ["none:no_such_act", "eos"])).toBe("none(no_such_act)");
  expect(LABEL_TEXT.no_such_act).toBe("Nothing here does that as such. If it is for someone else to see to, direct them in writing, on their form for it if they have one.");
  // The other way round (a model whose set has what this language doesn't: a label since retired, an argument no
  // function takes): no such program is passed on. It asks back.
  expect(programOf(input, ps, ["none:paused", "eos"])).toBe("none(unclear)");
  const rec = ps.findIndex((p) => input.slice(...p.at) === "rec");
  expect(programOf(input, ps, ["fn:statement", "arg:pause", ["id", rec, rec + 2], ")", "eos"])).toBe("none(unclear)");
  expect(programOf(input, ps, ["fn:statement", "arg:hold", ["id", rec, rec + 2], ")", "eos"])).toBe("statement(hold=rec.44)");
  // (A program that leaves a needed argument out is still passed on: whoever resolves it asks.)
  expect(programOf(input, ps, ["fn:money", "arg:to", ["id", rec, rec + 2], ")", "eos"])).toBe("money(to=rec.44)");
});

test("the seen cases for the three, and the real requests re-keyed to them, are right by their own scoring", () => {
  const seen = (id: string) => CASES.find((c) => c.id === id)!;
  expect(passes(seen("hold-payment"), "statement(hold=rec.90)")).toBe(true);
  expect(passes(seen("hold-payment"), "none(no_such_act)")).toBe(false);
  expect(passes(seen("hold-payment"), "statement(withdraw=rec.90)")).toBe(false);
  expect(passes(seen("hold-several"), 'statement(hold=["rec.90","rec.91","rec.92"], kind=hold)')).toBe(true); // (the same act)
  expect(passes(seen("hold-several"), 'statement(hold=["rec.90","rec.91"])')).toBe(false);
  expect(passes(seen("hold-at-bank"), "statement(hold=rec.91, to=bank)")).toBe(true);
  expect(passes(seen("hold-lift"), "statement(withdraw=rec.61)")).toBe(true);
  expect(passes(seen("own-entry"), 'statement(kind=entry, visible=own, text="Tax withheld.")')).toBe(true);
  expect(passes(seen("own-entry"), 'statement(kind=entry, visible=public, text="Tax withheld.")')).toBe(false);
  expect(passes(seen("look-first-any"), "none(look_first)")).toBe(true);
  expect(passes(seen("look-first-any"), "none(no_such_act)")).toBe(false);
  for (const c of CASES.filter((x) => /^(hold-|own-entry|look-first|look-then-act|described-person)/.test(x.id))) for (const e of c.expect) expect([c.id, passes(c, e)]).toEqual([c.id, true]);
  expect(CASES.filter((x) => /^(hold-|own-entry|look-first)/.test(x.id)).length).toBe(11);
  // The real requests: every hold of records named by id is keyed to the hold; what names its record only by
  // describing it, to look_first; what depends on a look has look_first among its answers.
  const real = (id: string) => PILOT_CASES.find((c) => c.id === id)!;
  expect(passesReal(real("8b-finance-d14-2"), "statement(hold=job-c0003-wages)")).toBe(true);
  expect(passesReal(real("8b-finance-d14-2"), "none(no_such_act)")).toBe(false);
  expect(passesReal(real("8b-finance-d14-2"), "statement(withdraw=job-c0003-wages)")).toBe(false);
  expect(passesReal(real("8b-finance-d14-1"), 'statement(hold=["job-c0003-wages","job-c0004-wages","job-c0008-wages","job-c0009-wages","job-c0011-wages","job-c0013-wages"], to=bank)')).toBe(true);
  expect(passesReal(real("8b-finance-d14-1"), 'statement(hold=["job-c0003-wages","job-c0004-wages"])')).toBe(false);
  expect(passesReal(real("8b-finance-d9-1"), "none(look_first)")).toBe(true);
  expect(passesReal(real("c8-mayor-d94-1"), "none(look_first)")).toBe(true);
  expect(passesReal(real("c8-mayor-d94-1"), "none(no_such_act)")).toBe(false);
  expect(passesReal(real("8-planning-d16-1"), "none(look_first)")).toBe(true);
  expect(passesReal(real("9-finance-d60-1"), 'money(to=acc-c0877, amount="$2,393.34", from=acc-city, settles=rec.28524)\nstatement(kind=entry, visible=own, text="Withheld.")')).toBe(true);
  const keyed = (gap: string) => PILOT_CASES.filter((c) => c.gap === gap).map((c) => c.expect[0]!.replace(/\(.*$/s, "")).sort();
  expect(keyed("pause")).toEqual([...Array(2).fill("none"), ...Array(9).fill("statement")]);
  expect(PILOT_CASES.filter((c) => c.expect.includes("none(look_first)")).length).toBe(2 + 6 + 5 + 1); // + c9-mayor-d230-1 (2026-10-14, round 3 step 1)
  expect(PILOT_CASES.length).toBe(180);
});
