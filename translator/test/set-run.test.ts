// Scoring a model on a file of labelled requests (translator/eval/set-run.ts): a test set the training pipeline made.

import { expect, test } from "bun:test";
import { MockAdapter } from "@oikos/participants/llm";
import { formShown } from "../src/index";
import { dimensionsOf, evaluateSet, passesSet, setKnowledge, setReportText, shownAsWritten, type SetCase } from "../eval/set-run";

const FORM = "- stall_permit, to=town, id form-stall: fields lot (lot, required), notes (text), kind (one of food | craft, required)";
const cases: SetCase[] = [
  { id: "pilot-x/town.seed1/draft.clerk-system.1", source: "pilot-x/town.seed1/clerk-system/d0/1", origin: "pilot", written_by: "codex/some-model (seat)", request: "Pay acc-b 500 from acc-town.", forms: [FORM], program: 'money(amount="500", from=acc-town, to=acc-b)', pilot: "pilot-x", profile: "some-profile" },
  { id: "pilot-x/town.seed1/clerk-system/d0/1/w-1", source: "pilot-x/town.seed1/clerk-system/d0/1", origin: "in_situ", written_by: "codex/a-writer", seat_model: "codex/some-model", request: "Fill in the stall permit for lot-3, a food stall.", forms: [FORM], program: "form(form=stall_permit, kind=food, lot=lot-3)", pilot: "pilot-x", profile: "some-profile" },
  { id: "pilot-y/town.seed2/draft.clerk-system.4", source: "pilot-y/town.seed2/clerk-system/d2/1", origin: "pilot", written_by: "claude-code/another (seat)", request: "Show me every payment since day 1.", forms: [], program: "none(not_an_act)" },
  { id: "pilot-y/town.seed2/draft.clerk-system.5", source: "pilot-y/town.seed2/clerk-system/d3/1", origin: "pilot", written_by: "claude-code/another (seat)", request: "Fill in the fishing licence.", forms: [FORM], program: "none(unknown_form)" },
];

test("a case's forms are shown to the translator exactly as the file has them", () => {
  expect(setKnowledge(cases[0]!).forms.map(formShown)).toEqual([FORM]);
  expect(cases.every(shownAsWritten)).toBe(true);
  expect(shownAsWritten({ forms: ["a form in some other words"] })).toBe(false);
});

test("an answer is the label by meaning; a call the resolver answers with a refusal's own words is that refusal", () => {
  expect(passesSet(cases[0]!, 'money(to=acc-b, from=acc-town, amount="500")')).toBe(true);
  expect(passesSet(cases[0]!, 'money(to=acc-b, from=acc-town, amount="50")')).toBe(false);
  expect(passesSet(cases[3]!, "none(unknown_form)")).toBe(true);
  expect(passesSet(cases[3]!, "form(form=fishing_licence, to=town)")).toBe(true);
  expect(passesSet(cases[3]!, "none(unclear)")).toBe(false);
});

test("what a line says of itself: its pilot and seat model from its situation and writer where it doesn't name them", () => {
  expect(dimensionsOf(cases[0]!)).toEqual({ pilot: "pilot-x", seat_model: "codex/some-model", profile: "some-profile", origin: "the seat's own", function: "money" });
  expect(dimensionsOf(cases[1]!)).toMatchObject({ seat_model: "codex/some-model", origin: "written in its situation", function: "form" });
  expect(dimensionsOf(cases[2]!)).toEqual({ pilot: "pilot-y", seat_model: "claude-code/another", profile: undefined, origin: "the seat's own", function: "none(not_an_act)" });
});

test("a model is scored on the file: right, no draft, wrong draft, in all and by pilot, seat model, profile, origin and function", async () => {
  const shown: string[] = [];
  const answers: { [request: string]: string } = {
    "Pay acc-b 500 from acc-town.": 'money(amount="500", from=acc-town, to=acc-b)', // right
    "Fill in the stall permit for lot-3, a food stall.": "form(form=stall_permit, kind=craft, lot=lot-3)", // a wrong draft
    "Show me every payment since day 1.": "none(unclear)", // no draft
    "Fill in the fishing licence.": "none(unknown_form)", // right
  };
  const model = new MockAdapter("m", { translator: (req) => {
    const text = req.messages[0]!.content as string;
    shown.push(text);
    return [{ type: "tool_use", id: "c", name: "call", input: { program: answers[/^Request: (.*)$/m.exec(text)![1]!]! } }];
  } });
  const r = await evaluateSet(model, cases, { name: "a set", prices: { "mock/m": { input: 0, output: 0, cache_read: 0, cache_write: 0 } } });
  expect(shown[0]).toBe(`Request: Pay acc-b 500 from acc-town.\n\nForms this person knows of:\n${FORM}`);
  expect(shown.length).toBe(4); // one attempt each
  expect(r.results.map((x) => x.outcome)).toEqual(["right", "wrong_draft", "no_draft", "right"]);
  expect(r.all).toEqual({ passed: 2, of: 4, no_draft: 1, wrong_draft: 1 });
  expect(r.by.pilot).toEqual({ "pilot-x": { passed: 1, of: 2, no_draft: 0, wrong_draft: 1 }, "pilot-y": { passed: 1, of: 2, no_draft: 1, wrong_draft: 0 } });
  expect(r.by.seat_model).toEqual({ "claude-code/another": { passed: 1, of: 2, no_draft: 1, wrong_draft: 0 }, "codex/some-model": { passed: 1, of: 2, no_draft: 0, wrong_draft: 1 } });
  expect(r.by.profile).toEqual({ "(not given)": { passed: 1, of: 2, no_draft: 1, wrong_draft: 0 }, "some-profile": { passed: 1, of: 2, no_draft: 0, wrong_draft: 1 } });
  expect(Object.keys(r.by.origin!)).toEqual(["the seat's own", "written in its situation"]);
  expect(Object.keys(r.by.function!)).toEqual(["form", "money", "none(not_an_act)", "none(unknown_form)"]);
  expect(r.forms_not_as_written).toBe(0);
  const text = setReportText(r);
  expect(text).toContain('Test set "a set" on mock/m: 2/4 right, 1 no draft, 1 wrong draft.');
  expect(text).toContain("by pilot: pilot-x 1/2 (0 no draft, 1 wrong); pilot-y 1/2 (1 no draft, 0 wrong)");
  expect(text).toContain("- [wrong_draft] pilot-x/town.seed1/clerk-system/d0/1/w-1: got form(");
  // A file whose lines say nothing of a profile has no count by it.
  const plain = await evaluateSet(model, cases.slice(2), { prices: { "mock/m": { input: 0, output: 0, cache_read: 0, cache_write: 0 } } });
  expect(plain.by.profile).toBeUndefined();
});
