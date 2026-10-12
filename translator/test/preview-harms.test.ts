// The preview says plainly what a draft does and what it does not (docs/behaviour/preview.md): the five kinds of
// wrong draft that seats confirmed in the pilots (runs/translator-wrong-acts-2026-10-10: 116 of 155 wrong drafts
// confirmed), each as it now reads. The preview never sees the request: every line here is the draft's own acts and
// the seat's own papers. No model is called.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { fixture } from "../eval/run";
import { Preview, resolve } from "../src/index";

const DAY = 86_400;
const rec = (r: any) => ({ author: "genesis", at: 0, visible_to: "public", ...r });
/** The mayor of the test town, with more on file: the council's proposal form, a job advertisement, an agreement. */
function seat(...records: object[]) {
  const k = fixture();
  k.absorb({ participant: "mayor-system", as: "mayor", t: 30 * DAY, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: { more: { kind: "records", records: records.map(rec) } } } as any);
  return k;
}
const preview = (k: ReturnType<typeof fixture>, program: string) => {
  const r = resolve(calls.parseProgram(program), k, () => undefined, "mayor");
  if (!r.ok) throw new Error(r.questions.join(" "));
  return new Preview(k, k.actingFor("mayor"), () => undefined, "mayor").of(r.blocks);
};

test("one thing is seen to be one thing: a payment whose report was asked for and not drafted is a payment, numbered alone, its purpose only words", () => {
  const p = preview(seat(), 'money(amount="$3,526.65", for="withheld income tax for 15 pays, with the monthly report naming each worker", from=acc-city, to=acc-builder)');
  expect(p).toBe([
    "This does one thing: a payment.",
    "1. You will ask Millbrook Bank (bank) to pay $3,526.65 from your account (acc-city) to acc-builder, Millbrook Builders (builder)'s account, once.",
    '   - For, in words only: "withheld income tax for 15 pays, with the monthly report naming each worker"',
  ].join("\n"));
  // Drafted whole, the report is a thing of its own: three things, in their order.
  const whole = preview(seat(), 'money(amount="$3,526.65", for="Income Tax", from=acc-city, to=acc-builder)\nmoney(amount="$1,410.60", for="National Insurance", from=acc-city, to=acc-greenco)\nstatement(kind=report, text="15 pays, each withholding $235.11 and $94.04")');
  expect(whole.split("\n")[0]).toBe("This does three things, in this order: two payments and a report.");
  expect(whole).toContain('3. You will publish a report: "15 pays, each withholding $235.11 and $94.04".');
  // Nothing is said twice: the request's own words only repeat the figures, and are not read out.
  expect(whole).not.toContain("Please pay");
  expect(whole.length).toBeLessThan(520);
});

test("a wage drafted at the whole agreed pay says so, in a line of its own", () => {
  const job = { id: "rec.1225", record: "agreement", visible_to: ["city", "c0042"], terms: { template: "employment", parties: ["city", "c0042"], commitments: [{ who: "city", does: { outcome: { money: { to: "acc-c0042", amount: "194446" } } }, every: 14 * DAY }] } };
  const p = preview(seat(job), 'money(amount="$1,944.46", basis=["rec.1225","law-income-tax"], every="every 14 days", first="year 1, day 48", for="wage", from=acc-city, to=acc-c0042)');
  expect(p.split("\n")).toEqual([
    "This does one thing: a standing payment.",
    "1. You will ask Millbrook Bank (bank) to pay $1,944.46 from your account (acc-city) to acc-c0042, Dana Reyes (c0042)'s account, every 14 days.",
    '   - For, in words only: "wage"',
    "   - The first payment falls due on year 1, day 48, and then every 14 days from that date.",
    "   - This is the whole of the pay agreed in rec.1225 ($1,944.46 every 14 days), with nothing withheld from it.",
    "   - Cites: rec.1225 and law-income-tax.",
  ]);
});

test("a form says what is filled in and which of its fields are left empty: a budget proposal without its amounts", () => {
  const form = { id: "form-council-proposal", record: "statement", speaks_for: "city", kind: "form", text: "A proposal to the council.",
    data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { kind: { type: "choice", options: ["law", "budget", "other"], required: true }, affects: { type: "choice", options: ["tenants", "landlords", "neither"], required: true }, proposal: { type: "text", required: true },
      year: { type: "count" }, parks: { type: "amount" }, roads: { type: "amount" }, staff: { type: "amount" } } } };
  const p = preview(seat(form), 'form(affects=neither, form=council_proposal, kind=budget, proposal="Budget for the year: staff line $373,361.04.", to=city)');
  expect(p.split("\n")).toEqual([
    "This does one thing: a council proposal form.",
    "1. You will file the council proposal form (form-council-proposal) with Millbrook (city), which you act for, as a proposal.",
    '   - Filled in: kind: budget; affects: neither; proposal: "Budget for the year: staff line $373,361.04.".',
    "   - Left empty: year, parks, roads, staff.",
  ]);
  // Filled in, the amount reads as money, and is no longer among what is left empty.
  const full = preview(seat(form), 'form(affects=neither, form=council_proposal, kind=budget, proposal="Budget for the year.", staff="$373,361.04", to=city, year="2")');
  expect(full).toContain("year: 2; staff: $373,361.04.");
  expect(full).toContain("Left empty: parks, roads.");
});

test("an agreement says what it would bind each side to, and that a duty in words binds nobody to an act", () => {
  const advert = { id: "rec.1094", record: "statement", speaks_for: "city", kind: "job_posting", text: "Works crew wanted.", data: { space: "town-hall/workplace.1", wage: "512738", period: 30 * DAY } };
  // The pilots' offer: the pay, and the post as a line of terms.
  const words = preview(seat(advert), 'agreement(basis=rec.1094, template=employment, text="works crew at town-hall/workplace.1", we_do=money(amount="$5,127.38", every="every 30 days", to=acc-c0042), with=c0042)');
  expect(words.split("\n")).toEqual([
    "This does one thing: an offer of an employment agreement.",
    "1. You will offer Dana Reyes (c0042) an employment agreement, and sign it on your side.",
    "   - You would be bound to: pay $5,127.38 to acc-c0042 every 30 days.",
    "   - Dana Reyes (c0042) would be bound to nothing: no act of theirs is set down.",
    '   - Its terms, in words only: "works crew at town-hall/workplace.1"',
    "   - Until they sign it you can take it back: withdraw it, and it can no longer be signed.",
    "   - It names no place of work: it is made on the job advertisement rec.1094, so the work is where that advertisement says (town-hall/workplace.1).",
    "   - Cites: rec.1094.",
  ]);
  // With the duty set down as an act, it is the other side's line.
  const bound = preview(seat(advert), 'agreement(basis=rec.1094, template=employment, they_do=work(at=town-hall/workplace.1, task="works crew"), we_do=money(amount="$5,127.38", every="every 30 days", to=acc-c0042), with=c0042)');
  expect(bound).toContain("   - Dana Reyes (c0042) would be bound to: do works_crew at town-hall/workplace.1.");
  expect(bound).not.toContain("bound to nothing");
  expect(bound).not.toContain("in words only");
  // A duty that is only a sentence of its own is said to be words, by whoever it is put on.
  const k = seat();
  const said = new Preview(k, k.actingFor("mayor")).of([{ block: "propose_agreement", ref: "g", terms: { parties: ["city", "greenco"], commitments: [{ who: "greenco", does: { text: "keep the grass cut" }, every: 14 * DAY }] } } as any]);
  expect(said).toContain("   - You would be bound to nothing: no act of yours is set down.");
  expect(said).toContain('   - In words only, which bind nobody to an act that can be checked: GreenCo (greenco), every 14 days: "keep the grass cut".');
});

test("asking the bank to pay is a payment instruction, and a letter to the bank is a letter: each says which it is", () => {
  const k = seat();
  const pay = preview(k, 'money(amount="$2,211.82", from=acc-city, to=acc-greenco)');
  expect(pay).toBe("This does one thing: a payment.\n1. You will ask Millbrook Bank (bank) to pay $2,211.82 from your account (acc-city) to acc-greenco, GreenCo (greenco)'s account, once.");
  const letter = preview(k, 'message(text="pay $2,211.82 from acc-city to acc-greenco every 14 days, for wages", to=bank)');
  expect(letter).toBe('This does one thing: a letter.\n1. You will write to Millbrook Bank (bank): "pay $2,211.82 from acc-city to acc-greenco every 14 days, for wages".\n   - A letter only: it pays, files and orders nothing.');
});

test("nothing of the world beyond the draft's own acts and the seat's own papers: a payee, a paper and an account the seat has never seen are named as written and no more", () => {
  const k = seat();
  const p = new Preview(k, k.actingFor("mayor")).of([{ block: "publish", kind: "request", speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"], text: "Please pay $1.00 from acc-city to acc-nobody.", basis: "rec.777",
    data: { outcome: { money: { from: "acc-city", to: "acc-nobody", amount: "100" } } } } as any, { block: "withdraw", record: "rec.778" } as any]);
  expect(p.split("\n")).toEqual([
    "This does two things, in this order: a payment and a withdrawal.",
    "1. You will ask Millbrook Bank (bank) to pay $1.00 from your account (acc-city) to acc-nobody, once.",
    "   - Cites: rec.777.",
    "2. You will withdraw rec.778.",
    "   - No paper by that id is among your own papers as you have been shown them: check that it is the one you mean.",
  ]);
});

test("a form that records a claim beside its paper reads as two things: the permission recorded, then the decision that says so", () => {
  const T = require("../../contracts/test/forms.json");
  const { Knowledge } = require("../src/index");
  const k = new Knowledge(T.currency);
  k.absorb(T.observation);
  const read = (program: string) => { const r = resolve(calls.parseProgram(program), k, () => undefined, "mayor"); if (!r.ok) throw new Error(r.questions.join(" ")); return new Preview(k, k.actingFor("mayor"), () => undefined, "mayor").of(r.blocks).split("\n"); };
  expect(read('form(form=licence_decision, application=rec.70, applicant=c0100, decision=granted, premises=str.9, goods="bread")')).toEqual([
    "This does two things, in this order: a permission recorded and a licence decision.",
    "1. You will record that c0100 is permitted: action: trade; goods: bread; object: str.9.",
    "   - Cites: rec.70.",
    '2. You will issue a licence decision (form-mayor-licence-decision): "Licence granted: application rec.70.".',
    "   - Filled in: application: rec.70; decision: granted; applicant: c0100.",
    '   - It goes to: c0100 (applicant on the form: "Who applied.").',
  ]);
  // Refused, it is one thing, and what a grant would have been of is not listed as left empty.
  expect(read("form(form=licence_decision, application=rec.70, applicant=c0100, decision=refused)")).toEqual([
    "This does one thing: a licence decision.",
    '1. You will issue a licence decision (form-mayor-licence-decision): "Licence refused: application rec.70.".',
    "   - Filled in: application: rec.70; decision: refused; applicant: c0100.",
    '   - It goes to: c0100 (applicant on the form: "Who applied.").',
  ]);
  // The seat's own organisation as the holder is named, never "you is".
  const own = new Preview(k, k.actingFor("mayor"), (id: string) => (id === "city" ? "Town of Millbrook" : undefined), "mayor").of([{ block: "record_claim", position: "liberty", holder: "city", about: { action: "build", object: "lot-00-01" }, speaks_for: "city" } as any]);
  expect(own).toContain("You will record that Millbrook (city), which you act for, is permitted: action: build; object: lot-00-01.");
  expect(own).not.toMatch(/you is|You is/);
});
