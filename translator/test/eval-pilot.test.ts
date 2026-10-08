import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES } from "../eval/cases";
import { FORMS, GAPS, PILOT_CASES, type RealCase } from "../eval/pilot-cases";
import { evaluateReal, passesReal, realKnowledge, realReportText, shapeOf } from "../eval/pilot-run";
import { passes } from "../eval/run";
import { translatorContext } from "../src/index";

const c = (expect: string[], more: Partial<RealCase> = {}) => ({ expect, ...more });

test("the real requests are well formed: ids, sources, answers in the call language, gaps that are named", () => {
  expect(new Set(PILOT_CASES.map((x) => x.id)).size).toBe(PILOT_CASES.length);
  for (const x of PILOT_CASES) {
    expect(x.request.length).toBeGreaterThan(10);
    expect(x.from.run).toMatch(/^runs\//);
    expect(x.expect.length).toBeGreaterThan(0);
    // Every answer is in the call language: "any refusal" is nobody's answer now that a label says "no call does this".
    for (const e of x.expect) expect(() => calls.parseProgram(e)).not.toThrow();
    expect([x.id, new Set(x.expect).size]).toEqual([x.id, x.expect.length]);
    if (x.gap) expect(Object.keys(GAPS)).toContain(x.gap);
    // What nothing can say is refused as that (or has a half that can be said, or a reading that can).
    const said = x.expect.some((e) => !e.startsWith("none("));
    // (Or, since 2026-10-08, as needing something found out first: a record named only by describing it, an act that
    // depends on a look.)
    if (x.gap && !said) expect([x.id, x.expect.includes("none(no_such_act)") || x.expect.includes("none(look_first)")]).toEqual([x.id, true]);
    if (x.expect.includes("none(no_such_act)") || x.expect.includes("none(look_first)")) expect([x.id, x.gap !== undefined]).toEqual([x.id, true]);
    // What can be said now is keyed to it: no request to hold records it names by id is still refused as unsayable.
    if (x.gap === "pause") expect([x.id, x.expect.includes("none(no_such_act)")]).toEqual([x.id, false]);
    if (x.gap === "unnamed_record") expect([x.id, x.expect.includes("none(look_first)"), x.expect.includes("none(no_such_act)")]).toEqual([x.id, true, false]);
    if (x.gap === "look_then_act") expect([x.id, x.expect.includes("none(look_first)")]).toEqual([x.id, true]);
    // Each accepted answer is right by the scoring's own lights, and no accepted program is a refusal in disguise.
    for (const e of x.expect) expect([x.id, passesReal(x, e)]).toEqual([x.id, true]);
  }
  // Seen cases, all of them: nothing here is held out, and none repeats a fixture case's request.
  const seen = new Set(CASES.map((x) => x.request));
  expect(PILOT_CASES.filter((x) => seen.has(x.request)).map((x) => x.id)).toEqual([]);
});

test("the translator is shown the forms the seat knew, worded as the pilots' logs have them, and nothing else", () => {
  const shown = (forms?: RealCase["forms"]) => translatorContext({ draftId: "d", participant: "seat", proposal: "Do it.", knowledge: realKnowledge({ forms }) });
  expect(shown()).toBe("Request: Do it.");
  expect(shown("wide")).toBe([
    "Request: Do it.", "", "Forms this person knows of:",
    "- council_proposal, to=city, id form-council-proposal: fields affects (one of tenants | development | neither), environment (amount), kind (one of law | budget | other, required), parks (amount), proposal (text, required), roads (amount), services (amount), staff (amount)",
    "- permit_application, to=city, id form-permit: fields lot (lot, required), notes (text), structure_type (structure_type, required)",
  ].join("\n"));
  expect(shown("narrow")).toContain("kind (one of law | budget | other, required), parks (amount), proposal (text, required), services (amount), staff (amount)\n");
  expect(Object.keys(FORMS)).toEqual(["narrow", "wide"]);
});

test("scoring by shape: an id is the same quoted, bare or in brackets; a different id is a different answer", () => {
  const k = c(['message(to=works, text="…")']);
  expect(passesReal(k, 'message(to=works, text="Send a crew.")')).toBe(true);
  expect(passesReal(k, 'message(to="works", text="Send a crew.")')).toBe(true);
  expect(passesReal(k, 'message(to="[works]", text="Send a crew.")')).toBe(true);
  expect(passesReal(k, 'message(text="Send a crew.", to=works)')).toBe(true);
  expect(passesReal(k, 'message(to=finance, text="Send a crew.")')).toBe(false);
  expect(passesReal(k, 'message(to="the works manager", text="Send a crew.")')).toBe(false);
  // A name is the same with or without "the", in any case.
  expect(passesReal(c(['message(to="the council clerk", text="…")']), 'message(to="Council Clerk", text="x")')).toBe(true);
  expect(passesReal(c(["statement(withdraw=rec.4751)"]), "statement(withdraw=rec.4752)")).toBe(false);
});

test("scoring by shape: the same functions and argument names; free text isn't compared, but must be there", () => {
  const k = c(['message(to=works, text="…")'], { ignore: ["re"] });
  expect(passesReal(k, 'message(to=works, text="Anything at all, however long.", re=rec.17285)')).toBe(true); // ignored: there or not
  expect(passesReal(k, "message(to=works)")).toBe(false); // "…" is some text, not none
  expect(passesReal(k, 'message(to=works, text="x", visible=public)')).toBe(false); // an argument nobody asked for
  expect(passesReal(k, 'statement(to=works, text="x")')).toBe(false);
  expect(passesReal(k, 'message(to=works, text="x")\nmessage(to=finance, text="y")')).toBe(false); // a call too many
  expect(passesReal(c(["statement(withdraw=rec.9)"], { ignore: ["text", "basis"] }), 'statement(withdraw=rec.9, basis=rec.5, text="Superseded.")')).toBe(true);
  // What isn't in the call language is nobody's answer.
  expect(passesReal(k, "message(to=works, text=")).toBe(false);
  expect(shapeOf("not a program at all")).toBeUndefined();
});

test("scoring by shape: amounts and durations are compared by what they come to", () => {
  const k = c(['money(to=acc-c0877, amount="$2,393.34", from=acc-city, every="14 days")']);
  expect(passesReal(k, 'money(to=acc-c0877, amount="2393.34", from=acc-city, every="fortnightly")')).toBe(true);
  expect(passesReal(k, 'money(to=acc-c0877, amount="239334 cents", from=acc-city, every="every 2 weeks")')).toBe(true);
  expect(passesReal(k, 'money(to=acc-c0877, amount="$2,393", from=acc-city, every="14 days")')).toBe(false);
  expect(passesReal(k, 'money(to=acc-c0877, amount="$2,393.34", from=acc-city, every="monthly")')).toBe(false);
  expect(passesReal(k, 'money(to=acc-c0877, amount="$2,393.34", from=acc-city)')).toBe(false);
  // Bare digits are whole units: "all amounts in cents" written without the unit is a hundred times too much.
  const f = c(['form(form=council_proposal, kind=budget, staff="$500,000", proposal="…")'], { forms: "wide" });
  expect(passesReal(f, 'form(form=council_proposal, kind=budget, staff="50000000 cents", proposal="x")')).toBe(true);
  expect(passesReal(f, 'form(form=council_proposal, kind=budget, staff=50000000, proposal="x")')).toBe(false);
});

test("scoring by shape: a form is the same by its name or its record's id, and sent to where it goes or left to go there", () => {
  const f = c(['form(form=council_proposal, kind=law, affects=tenants, proposal="…")'], { forms: "wide" });
  expect(passesReal(f, 'form(to=city, form=council_proposal, kind="law", affects="tenants", proposal="A landlord must…")')).toBe(true);
  expect(passesReal(f, 'form(form=form-council-proposal, kind=law, affects=tenants, proposal="A landlord must…")')).toBe(true);
  expect(passesReal(f, 'form(form="council proposal", kind=law, affects=tenants, proposal="A landlord must…")')).toBe(true);
  // `to` on a form isn't compared: the office it goes to, or whoever there deals with it, described or by id, is the
  // same act, and which names come to that office is the town's knowledge, which these cases don't have.
  expect(passesReal(f, 'form(to=council-clerk, form=council_proposal, kind=law, affects=tenants, proposal="x")')).toBe(true);
  expect(passesReal(f, 'form(to="the council clerk", form=council_proposal, kind=law, affects=tenants, proposal="x")')).toBe(true);
  expect(passesReal(c(['form(to=city, form=council_proposal, kind=law, affects=tenants, proposal="…")'], { forms: "wide" }), 'form(form=council_proposal, kind=law, affects=tenants, proposal="x")')).toBe(true);
  // One name, though: a form handed to two places is something else. And only a form's `to` is let off.
  expect(passesReal(f, 'form(to=["city","council-clerk"], form=council_proposal, kind=law, affects=tenants, proposal="x")')).toBe(false);
  expect(passesReal(c(['message(to=city, text="…")']), 'message(to=council-clerk, text="x")')).toBe(false);
  expect(passesReal(f, 'form(form=council_proposal, kind=budget, affects=tenants, proposal="x")')).toBe(false);
  expect(passesReal(f, 'form(form=council_proposal, kind=law, affects=tenants, proposal="x", staff="$1")')).toBe(false);
  expect(passesReal(f, 'form(form=permit_application, kind=law, affects=tenants, proposal="x")')).toBe(false);
});

test("scoring by shape: lines in any order, a letter to several as several letters, calls inside calls", () => {
  const k = c(['form(form=council_proposal, kind=law, proposal="…")\nmessage(to=council-clerk, text="…")'], { forms: "wide" });
  expect(passesReal(k, 'message(to=council-clerk, text="Please put it to the ballot.")\nform(form=council_proposal, kind=law, proposal="x")')).toBe(true);
  expect(passesReal(k, 'form(form=council_proposal, kind=law, proposal="x")')).toBe(false);
  const three = c(['message(to=works, text="…")\nmessage(to=finance, text="…")\nmessage(to=council-clerk, text="…")']);
  expect(passesReal(three, 'message(to=["council-clerk","finance","works"], text="Come at two.")')).toBe(true);
  expect(passesReal(three, 'message(to=["council-clerk","finance"], text="Come at two.")')).toBe(false);
  expect(passesReal(three, 'message(to=finance, text="a")\nmessage(to=finance, text="b")\nmessage(to=works, text="c")')).toBe(false);
  // The name a line gives what it makes is no part of the answer; what a nested call says is.
  const lease = c(['agreement(with=c0042, term="12 months", they_do=money(to=acc-city, amount="$850", every="monthly"))']);
  expect(passesReal(lease, 'a = agreement(with=c0042, term="a year", they_do=money(to=acc-city, amount="850 dollars", every="every month"))')).toBe(false); // a year is 365 days, not 12 months of 30
  expect(passesReal(lease, 'a = agreement(with=c0042, term="12 months", they_do=money(to=acc-city, amount="850 dollars", every="every month"))')).toBe(true);
  expect(passesReal(lease, 'agreement(with=c0042, term="12 months", they_do=money(to=acc-city, amount="$900", every="monthly"))')).toBe(false);
});

test("scoring by shape: a refusal is its label, or a call that comes to it; no refusal stands in for another", () => {
  const look = c(["none(not_an_act)"]);
  expect(passesReal(look, "none(not_an_act)")).toBe(true);
  expect(passesReal(look, "none(unclear)")).toBe(false);
  expect(passesReal(look, 'message(to=city, text="Show me the ledger.")')).toBe(false);
  // A form nobody has seen, written as form(…), is answered "You haven't seen a form by that name": the same refusal.
  const form = c(["none(unknown_form)"]);
  expect(passesReal(form, 'form(form=dog_licence, name="Rex")')).toBe(true);
  expect(passesReal(c(["none(unknown_form)"], { forms: "wide" }), 'form(form=council_proposal, kind=law, proposal="x")')).toBe(false);
  // Nothing can say it: the refusal that says so is right, and so is whatever else the case accepts; another refusal
  // isn't, and nor is a draft.
  const gap = c(["none(no_such_act)", 'message(to=bank, text="…")']);
  for (const l of calls.LABELS) expect([l, passesReal(gap, `none(${l})`)]).toEqual([l, l === "no_such_act"]);
  expect(passesReal(gap, 'message(to="bank", text="Hold the six payments.")')).toBe(true);
  expect(passesReal(gap, "system(retire=job-c0003-wages)")).toBe(false);
  expect(passesReal(gap, "none(*)")).toBe(false);
  expect(passesReal(c(["statement(withdraw=rec.9)"]), "none(too_much)")).toBe(false);
});

test("the fixture cases' own test is no looser for this: it still wants the same acts, text and all", () => {
  const pay = CASES.find((x) => x.id === "pay-once")!;
  expect(passes(pay, 'money(to=builder, amount="$500", for="the fence")')).toBe(true);
  expect(passes(pay, 'money(to=builder, amount="$500", for="a fence of some kind")')).toBe(false);
  expect(passesReal(c(['money(to=builder, amount="$500", for="…")']), 'money(to=builder, amount="$500", for="a fence of some kind")')).toBe(true);
});

test("the harness: each real request goes through the translator once, with its seat's forms, and is scored", async () => {
  const cases: RealCase[] = [
    { id: "a", from: { run: "runs/x", seat: "mayor", day: 1, draft: "d1" }, pilot: "applied", forms: "wide", request: "Submit a law proposal on form-council-proposal: no dogs.", expect: ['form(form=council_proposal, kind=law, proposal="…")'] },
    { id: "b", from: { run: "runs/x", seat: "finance", day: 2, draft: "d2" }, pilot: "failed", request: "Show me the ledger for [acc-city].", expect: ["none(not_an_act)"] },
    { id: "c", from: { run: "runs/x", seat: "mayor", day: 3, draft: "d3" }, pilot: "declined", request: "Direct the works manager [works] to send a crew.", expect: ['message(to=works, text="…")'] },
    { id: "d", from: { run: "runs/x", seat: "finance", day: 4, draft: "d4" }, pilot: "failed", request: "Pause the standing payment job-1 until I say.", expect: ["none(no_such_act)"], gap: "pause" },
    { id: "e", from: { run: "runs/x", seat: "mayor", day: 5, draft: "d5" }, pilot: "failed", request: "Read rec.5.", expect: ["none(not_an_act)"] },
  ];
  const answers: { [request: string]: string | undefined } = {
    [cases[0]!.request]: 'form(to=city, form=form-council-proposal, kind=law, proposal="No dogs.")',
    [cases[1]!.request]: "none(unclear)", // the wrong refusal: no draft
    [cases[2]!.request]: 'work(task="send a crew", at=works)', // a program that isn't the answer: a wrong draft
    [cases[3]!.request]: "none(no_such_act)",
    [cases[4]!.request]: undefined, // nothing came back
  };
  const asked: { forms: boolean; attempt: number }[] = [];
  const adapter = new MockAdapter("mock", {
    translator: (req) => {
      asked.push({ forms: String((req.messages[0] as any).content).includes("Forms this person knows of:"), attempt: req.context.attempt });
      const program = answers[req.context.proposal];
      return program === undefined ? [{ type: "text", text: "I can't." }] : [{ type: "tool_use", id: "1", name: "call", input: { program } }];
    },
  });
  const r = await evaluateReal(adapter, { cases, jobs: 3 });
  expect(r.results.map((x) => [x.id, x.outcome])).toEqual([["a", "right"], ["b", "no_draft"], ["c", "wrong_draft"], ["d", "right"], ["e", "no_draft"]]);
  expect(r.real).toEqual({ passed: 2, of: 5, no_draft: 2, wrong_draft: 1 });
  // One attempt each (no second try on a refusal or an unresolved name), and the forms only where the seat knew them.
  expect(asked.length).toBe(5);
  expect(asked.every((x) => x.attempt === 1)).toBe(true);
  expect(asked.filter((x) => x.forms).length).toBe(1);
  const text = realReportText(r);
  expect(text).toContain("Real requests (the pilots' seats, word for word) on mock/mock: 2/5 right, 2 no draft, 1 wrong draft.");
  expect(text).toContain("1 of them ask for something the call language can't say (pause: 1");
  expect(text).toContain("- [wrong_draft] c: got work(");
  expect(text).toContain("- [no_draft] e: got (no program:");
});

test("the style notes are short, and what they quote as verbatim is a real request, word for word", () => {
  const notes = readFileSync(join(import.meta.dir, "../eval/pilot-style.md"), "utf8");
  expect(notes.trimEnd().split("\n").length).toBeLessThanOrEqual(60);
  const quoted = [...notes.slice(notes.indexOf("**Verbatim.**")).matchAll(/^\d+\. `(.+)`$/gm)].map((m) => m[1]!);
  expect(quoted.length).toBeGreaterThanOrEqual(12);
  const requests = new Set(PILOT_CASES.map((x) => x.request));
  expect(quoted.filter((q) => !requests.has(q))).toEqual([]);
});
