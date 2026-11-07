// Ruling A (2026-10-10): copied free text is not compared where two readers, or a model and a label, are compared.
import { expect, test } from "bun:test";
import { join } from "node:path";
import FORMS from "../../contracts/test/forms.json";
import ID_OR_WORDS from "../../contracts/test/id-or-words.json";
import { sameButForFreeText, sameMeaning } from "../train/meaning";
import { passesSet, textExact, type SetCase } from "../eval/set-run";
import { labelled } from "../train/readers";

const FORM = "- stall_permit, to=town, id form-stall: fields lot (lot, required), notes (text), kind (one of food | craft, required)";
const forms = [{ form: "stall_permit", to: "town", fields: { lot: { type: "lot" }, notes: { type: "text" }, kind: { type: "choice" } } }];

test("free text is no difference: a letter's extent and re=, a payment's for=, a closing full stop, a form's text field, an empty list", () => {
  const same = (a: string, b: string) => sameButForFreeText(a, b, { forms });
  expect(same('message(to=clerk, text="send me the minutes")', 'message(to=clerk, text="send me the minutes by Friday, since the vote is near.", re=rec.4)')).toBe(true);
  expect(same('money(to=acc-9, amount="40", from=acc-1, settles=rec.5)', 'money(to=acc-9, amount="40", from=acc-1, for="the rates notice on lot-1", settles=rec.5)')).toBe(true);
  expect(same('statement(kind=report, text="two pays, 40 withheld")', 'statement(kind=report, text="two pays, 40 withheld.")')).toBe(true);
  expect(same('form(form=stall_permit, to=town, lot=lot-1, kind=food, notes="near the gate")', 'form(form=stall_permit, to=town, lot=lot-1, kind=food, notes="a stall near the gate.")')).toBe(true);
  expect(same('work(task=collect, at=str.3, on=[])', "work(task=collect, at=str.3)")).toBe(true);
  expect(same('agreement(with=c0042, terms="works crew", we_do=money(to=c0042, amount="90", every="14 days", for="wages"))', 'agreement(with=c0042, terms="works crew at str.3", we_do=money(to=c0042, amount="90", every="14 days"))')).toBe(true);
  // (and it was a difference before, and still is where everything is compared)
  expect(sameMeaning('message(to=clerk, text="send me the minutes")', 'message(to=clerk, text="send me the minutes by Friday")')).toBe(false);
});

test("everything else is still compared: who, how much, which record, which field, how many lines, the refusal", () => {
  const same = (a: string, b: string) => sameButForFreeText(a, b, { forms });
  expect(same('message(to=clerk, text="x")', 'message(to=mayor, text="x")')).toBe(false);
  expect(same('money(to=acc-9, amount="40", from=acc-1, settles=rec.5)', 'money(to=acc-9, amount="41", from=acc-1, settles=rec.5)')).toBe(false);
  expect(same('money(to=acc-9, amount="40", settles=rec.5)', 'money(to=acc-9, amount="40", basis=rec.5)')).toBe(false);
  expect(same('form(form=stall_permit, to=town, lot=lot-1, kind=food)', 'form(form=stall_permit, to=town, lot=lot-1, kind=craft)')).toBe(false);
  expect(same('form(form=stall_permit, to=town, lot=lot-1, kind=food)', 'form(form=stall_permit, to=town, lot=lot-1, kind=food, notes="x")')).toBe(false); // (a text field is there or it is not)
  expect(same('money(to=acc-9, amount="40")', 'money(to=acc-9, amount="40")\nstatement(kind=report, text="x")')).toBe(false);
  expect(same("none(too_much)", "none(look_first)")).toBe(false);
  expect(same('statement(kind=report, text="x")', 'statement(kind=notice, text="x")')).toBe(false);
});

test("the set scorer passes an answer that differs in free text alone, and says whether the text was the label's too", () => {
  const c: SetCase = { id: "p/t.seed1/draft.clerk-system.1", request: "Ask the clerk to send me the minutes by Friday.", program: 'message(to="the clerk", text="send me the minutes by Friday")', forms: [FORM] } as SetCase;
  expect(passesSet(c, 'message(to="the clerk", text="send me the minutes")')).toBe(true);
  expect(textExact(c, 'message(to="the clerk", text="send me the minutes")')).toBe(false);
  expect(textExact(c, 'message(to="the clerk", text="send me the minutes by Friday")')).toBe(true);
  expect(passesSet(c, 'message(to="the mayor", text="send me the minutes by Friday")')).toBe(false);
});

test("two readers who differ in free text alone make an example, and it is one reader's own program, copied from the request", () => {
  const u = { id: "p/t.seed1/clerk-system/d1/1/w-1", request: "Ask the clerk to send me the minutes by Friday, since the vote is near.", forms: [] as string[] };
  const first = 'message(text="send me the minutes by Friday, since the vote is near", to="the clerk")', second = 'message(text="send me the minutes by Friday", to="the clerk")';
  const r = labelled([u], [{ reader: "a", answers: [{ id: u.id, program: first }] }, { reader: "b", answers: [{ id: u.id, program: second }] }]);
  expect(r.examples.map((e) => e.program)).toEqual([first]);
  // A reader's paraphrase is never the label: the other reader's copied words are.
  const reworded = labelled([u], [{ reader: "a", answers: [{ id: u.id, program: 'message(to="the clerk", text="please let me have the minutes before Friday")' }] }, { reader: "b", answers: [{ id: u.id, program: second }] }]);
  expect(reworded.examples.map((e) => e.program)).toEqual([second]);
  const both = labelled([u], [{ reader: "a", answers: [{ id: u.id, program: 'message(to="the clerk", text="minutes wanted")' }] }, { reader: "b", answers: [{ id: u.id, program: 'message(to="the clerk", text="hand over the minutes")' }] }]);
  expect(both.examples).toEqual([]);
  expect(both.rejects[0]!.why).toBe("reworded_text");
});

test("id or words: the same span bare or quoted is one value where the resolver acts on the two alike, in both scorers (contracts/test/id-or-words.json)", () => {
  // (The engine's resolver is held to each case: kernel/crates/resolver, id_or_words_as_the_shared_table_says.)
  const records = FORMS.observation.channels.forms.records as unknown as { id: string; data: { form: string; office?: string; fields: { [k: string]: { type: string } } } }[];
  const forms = records.map((r) => ({ form: r.data.form, to: r.data.office ?? "", id: r.id, fields: r.data.fields }));
  const written = ([kind, x]: string[]) => (kind === "text" ? JSON.stringify(x) : x!);
  for (const c of ID_OR_WORDS.cases) expect([c.name, sameMeaning(c.program.replace("{}", written(c.a)), c.program.replace("{}", written(c.b)), { forms })]).toEqual([c.name, c.same]);
  const python = Bun.which("python3");
  if (!python) return; // (No Python here: the trainer's scorer is not run.)
  const out = Bun.spawnSync([python, join(import.meta.dir, "../model/py/fair.py"), "--table", join(import.meta.dir, "../../contracts/test/id-or-words.json")]);
  expect(JSON.parse(out.stdout.toString())).toEqual({ wrong: [] });
});
