// What a seat signs off must read as a person reads it (the live check of 2026-10-09, finding 3: "addressed to you"
// of a proposal put to the town and "You will write to you" of a letter to the clerk, "staff 27000000" for 270,000 of
// the town's money, "notice: 7776000" for 90 days; a correct draft was declined for the first, and the sign-off is the
// training label). Every addressee as the seat knows it, every amount as the place writes its money, every length of
// time in days, every moment as a date; and the same for the details of the papers a seat is shown.

import { expect, test } from "bun:test";
import GB from "../../worlds/profiles/gb-eng-2026.json";
import DE from "../../worlds/profiles/de-ni-2026.json";
import type { Observation } from "@oikos/participants";
import { inCurrency } from "@oikos/participants";
import { duration, readable, renderObservation, renderStanding } from "@oikos/participants/llm";
import { Knowledge, Preview } from "../src/index";

const DAY = 86_400;
const form = { id: "form-council-proposal", record: "statement", kind: "form", author: "genesis", at: 0, speaks_for: "city", visible_to: "public", text: "Council proposal.",
  data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { kind: { type: "choice", options: ["law", "budget", "other"], required: true }, proposal: { type: "text", required: true }, staff: { type: "amount" }, parks: { type: "amount" }, notice: { type: "duration" }, from: { type: "date" } } } };
/** A mayor's knowledge: it holds the mayor's post for the town, and has looked up the clerk and the bank. */
function mayor(currency: any): Knowledge {
  const k = new Knowledge(currency);
  k.absorb({ t: 0, entity: "city", outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor of Millbrook", role: "mayor" }],
    channels: { who: { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Town of Millbrook" }, { entity: "bank", kind: "bank", name: "Millbrook Savings Bank" }, { entity: "c0297", kind: "person", name: "Ada Okafor", participant: "p-c0297" }],
      positions: [{ position: "council-clerk", entity: "city", title: "Council clerk", role: "clerk" }, { position: "mayor", entity: "city", title: "Mayor of Millbrook", role: "mayor" }] }, forms: { kind: "records", records: [form] } } } as unknown as Observation);
  return k;
}

test("a proposal put to the town and a letter to its clerk are not addressed to you", () => {
  const k = mayor(GB.values.currency);
  const p = new Preview(k, k.actingFor("mayor"));
  const proposal = p.of([{ block: "publish", kind: "proposal", speaks_for: "city", addressed_to: ["city"], basis: "form-council-proposal", text: "council proposal: kind budget, staff £270,000.00.", data: { kind: "budget", proposal: "The year's budget.", staff: "27000000", parks: "0" } } as any]);
  expect(proposal).toStartWith("This does one thing: a council proposal form.\n1. You will file the council proposal form (form-council-proposal) with Town of Millbrook (city), which you act for, as a proposal: ");
  expect(proposal).not.toContain("addressed to you");
  const letters = p.of([{ block: "message", to: ["council-clerk"], text: "Please put it to a ballot." } as any, { block: "message", to: ["bank", "c0297", "mayor"], text: "For your records.", re: "rec.12" } as any]);
  expect(letters).toBe('This does two things, in this order: two letters.\n1. You will write to the council clerk (council-clerk): "Please put it to a ballot.".\n   - A letter only: it pays, files and orders nothing.\n2. You will write to Millbrook Savings Bank (bank), Ada Okafor (c0297), the mayor of Millbrook (mayor), about rec.12: "For your records.".\n   - A letter only: it pays, files and orders nothing.');
  // Asked of, and instructed: named the same way. What it does itself is still "you".
  expect(p.of([{ block: "publish", kind: "hold", speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"], text: "Please hold rec.5.", data: { holds: ["rec.5"] } } as any])).toStartWith("This does one thing: a hold.\n1. You will instruct Millbrook Savings Bank (bank) to hold rec.5.\n");
  expect(p.of([{ block: "transfer", from: "acc-city", to: "acc-builder", amount: "5000000" } as any])).toBe("This does one thing: a payment.\n1. You will move £50,000.00 from acc-city to acc-builder now.");
  // A person acting as themselves, writing to themselves: you.
  const self = new Knowledge(GB.values.currency);
  self.absorb({ t: 0, entity: "c0001", outcomes: [], inbox: [], drafts: [], channels: {} } as unknown as Observation);
  expect(new Preview(self).of([{ block: "message", to: ["c0001"], text: "A note." } as any])).toBe('This does one thing: a letter.\n1. You will write to you: "A note.".\n   - A letter only: it pays, files and orders nothing.');
});

test("what a form was filled in with reads as the form says each field is: money as the place writes it, time in days, a date as a date", () => {
  const data = { kind: "budget", proposal: "The year's budget.", staff: "27000000", parks: "0", notice: 7_776_000, from: 400 * DAY };
  const gb = mayor(GB.values.currency);
  const text = new Preview(gb, "city").of([{ block: "publish", kind: "proposal", speaks_for: "city", addressed_to: ["city"], basis: "form-council-proposal", text: "council proposal.", data } as any]);
  expect(text).toContain('Filled in: kind: budget; proposal: "The year\'s budget."; staff: £270,000.00; parks: £0.00; notice: 90 days; from: year 2, day 36.');
  expect(text).not.toContain("27000000");
  expect(text).not.toContain("7776000");
  // The same paper in a town that writes its money another way.
  const de = mayor(DE.values.currency);
  expect(new Preview(de, "city").of([{ block: "publish", kind: "proposal", speaks_for: "city", addressed_to: ["city"], basis: "form-council-proposal", text: "council proposal.", data } as any])).toContain("staff: 270.000,00 €; parks: 0,00 €; notice: 90 days");
  // A job advertised with a year's pay as its wage and a year as its period says so: paid once a year.
  const advert = new Preview(gb, "city").of([{ block: "publish", kind: "job_posting", speaks_for: "city", visible_to: "public", text: "Hiring: £85,000.00 every 365 days.", data: { wage: "8500000", period: 365 * DAY, role: "crew" } } as any]);
  expect(advert).toContain("With these details: wage: £85,000.00; period: 1 year; role: crew.");
  // An agreement's terms beyond its sentence, and an act's other fields: the same reading.
  expect(new Preview(gb, "city").of([{ block: "publish", kind: "notice", speaks_for: "city", visible_to: "public", text: "Rates.", data: { rate_bps: 1600, closes_at: 3 * DAY + 9 * 3600, lines: { parks: "6000000", staff: "27000000" }, figures: { notice: { unit: "seconds", value: 5_184_000 } } } } as any]))
    .toContain('With these details: {"rate":"16%","closes_at":"year 1, day 4, 09:00","lines":{"parks":"£60,000.00","staff":"£270,000.00"},"figures":{"notice":"60 days"}}.');
});

test("lengths of time are said as people say them", () => {
  expect([0, 1, 60, 5_400, 3_600, 86_400, 14 * DAY, 90 * DAY, 365 * DAY, 730 * DAY, 100_000].map(duration)).toEqual(["0 seconds", "1 second", "1 minute", "1 hour 30 minutes", "1 hour", "1 day", "14 days", "90 days", "1 year", "2 years", "100,000 seconds"]);
});

test("the papers a seat is shown read the same way: no smallest units, seconds or hundredths of a per cent", () => {
  inCurrency(GB.values.currency as any);
  const law = { id: "law-rent-increases", record: "statement", kind: "law", author: "genesis", at: 0, speaks_for: "city", visible_to: "public", text: "A rent may be increased once every 12 months, on 60 days' notice.", data: { figures: { notice: { unit: "seconds", value: 5_184_000 }, review: { unit: "seconds", value: 31_104_000 } } } };
  const tax = { id: "law-income-tax", record: "statement", kind: "law", author: "genesis", at: 0, speaks_for: "outside", visible_to: "public", text: "Income tax.", data: { brackets: [{ from: 0, rate_bps: 0 }, { from: 1_257_000, rate_bps: 2_000 }], levy_bps: 800, levy_from: 1_257_000, rate_ppm: 5_959, due_days: 30, instalments: 4 } };
  const prices = { id: "rec.7", record: "statement", kind: "price_list", author: "builder-system", at: 0, speaks_for: "builder", visible_to: "public", text: "Our prices.", data: { prices: { apartments: 320_553_600, park: 6_108_600 }, demolition: { park: 207_240 }, min_order: 100 } };
  const obs = { t: 0, entity: "city", outcomes: [], inbox: [], drafts: [], channels: { laws: { kind: "records", records: [law, tax, prices] } } } as unknown as Observation;
  const onFile = renderStanding(obs, new Set(["laws"]));
  expect(onFile).toContain('({"figures":{"notice":"60 days","review":"360 days"}})');
  expect(onFile).toContain('({"brackets":[{"from":"£0.00","rate":"0%"},{"from":"£12,570.00","rate":"20%"}],"levy":"8%","levy_from":"£12,570.00","rate":"0.5959%","due_days":30,"instalments":4})');
  expect(onFile).toContain('({"prices":{"apartments":"£3,205,536.00","park":"£61,086.00"},"demolition":{"park":"£2,072.40"},"min_order":100})');
  for (const raw of ["5184000", "rate_bps", "320553600", "rate_ppm", '"value"']) expect(onFile).not.toContain(raw);
  // As they come, and in a list: a ballot's closing, a benefit's amount and period.
  const ballot = { id: "rec.40", record: "statement", kind: "ballot", author: "clerk-system", at: DAY, speaks_for: "city", visible_to: "public", text: "Shall the budget be adopted?", data: { closes_at: 15 * DAY, options: ["yes", "no"] } };
  const decision = { id: "rec.41", record: "statement", kind: "benefit_decision", author: "payments-system", at: DAY, speaks_for: "outside", visible_to: ["c0297"], text: "Granted.", data: { amount: 48_260, every: 14 * DAY } };
  const came = renderObservation({ ...obs, channels: { civic: { kind: "records", records: [ballot, decision] } } } as any);
  expect(came).toContain('({"closes_at":"year 1, day 16","options":["yes","no"]})');
  expect(came).toContain("(amount: £482.60; every: 14 days)");
  // What nothing here names is left as it is: a count stays a count.
  expect(readable({ quantity: 137, for_days: 14, members: 3, years: 12 })).toEqual({ quantity: 137, for_days: 14, members: 3, years: 12 });
  // Goods to deliver are not a list of prices, though a price list's goods are.
  expect(readable({ outcome: { goods: { quantity: "40", kind: "gravel" } } })).toEqual({ outcome: { goods: { quantity: "40", kind: "gravel" } } });
  expect(readable({ goods: { energy: 16, inputs: 250 } })).toEqual({ goods: { energy: "£0.16", inputs: "£2.50" } });
});
