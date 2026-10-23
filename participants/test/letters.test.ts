// A letter to an office run by code (docs/behaviour/letters.md). An office cannot read one; until 2026-10-09 it sent
// its standing report whatever was asked, or nothing at all (the live check of that day, finding 11: a works seat
// wrote twice to a code-run mayor and "could not tell silence from a fault"). Now every office acknowledges a letter
// in fixed words of its own: that it does not act on a letter, what it does act on and how, and, where the letter
// plainly concerns something it has a form for, to use the form. The same words to everyone.

import { expect, test } from "bun:test";
import { modules } from "../src/index";
import { acknowledged, PAYMENT_FAILED, REPORT_TAIL } from "./sayings";
import { engine } from "./engine";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { context, DAY, statement, wake } from "./stepping";

inCurrency(PROFILE.values.currency);

const papers = (records: any[] = []) => ({ papers: { kind: "records", records } });
const letter = (id: string, from: string, text: string, as?: string) => ({ id, t: DAY, from, ...(as ? { as, from_entity: "city" } : {}), to: ["x"], text });
const messages = (said: any[]) => said.filter((c) => c.fn === "message").map((c) => ({ to: c.args.to, re: c.args.re, text: c.args.text as string }));

test("an office with no report of its own acknowledges a letter once, saying what it acts on; a letter that asks for a direction is told there is none to wait for", () => {
  const mayor = engine("city.mayor_code").create(context("mayor-system", "city", { population: 1000, park_budget: 0, builder: "builder" }, { position: "mayor" }));
  const said = wake(mayor, DAY, papers(), { entity: "city", inbox: [
    letter("msg.1", "works-seat", "Please give the works office a staffing direction: may I recruit two crew?", "works"),
    letter("msg.2", "c7-self", "When is the park opening?"),
    // Another office's report, its acknowledgement, and the bank's note of a payment: not questions, and not answered.
    letter("msg.3", "finance-system", "Report from the finance office: the town's account acc-city holds $1.00.", "finance"),
    letter("msg.4", "works-system", "From the works office: your direction rec.9 is received. It stands until you replace or withdraw it.", "works"),
    letter("msg.5", "bank-payments-system", PAYMENT_FAILED.note("$1.00", "acc-c1", "rec.4")),
  ] }).said;
  const out = messages(said);
  expect(out.map((m) => [m.to, m.re])).toEqual([[["works-seat"], "msg.1"], [["c7-self"], "msg.2"]]);
  expect(out[0]!.text).toBe("From the mayor's office: your letter is received. This office does not act on a letter's words. " +
    "What it acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives no direction by letter. " +
    "If your letter asks for a direction: this office has given none on the matter, and an office needs none to act within its own powers and its budget line.");
  // The same words to anyone, less the sentence the first letter's own words called for.
  expect(out[1]!.text).toBe(out[0]!.text.replace(/ If your letter asks for a direction.*$/, ""));
  expect(out[1]!.text).toBe(acknowledged(modules["city.mayor_code"]!.answers!, "When is the park opening?"));
  // Once: nothing more at the next wake.
  expect(messages(wake(mayor, 2 * DAY, papers(), { entity: "city" }).said)).toEqual([]);
});

test("an office with a standing report sends it and then says what it is and what the office acts on; where the letter is plainly about staffing, which form", () => {
  const params = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: 300_000 };
  const works = engine("city.works").create(context("works-system", "city", params, { position: "works" }));
  const said = wake(works, DAY, papers([statement("budget-1", 0, "budget", { data: { year: 1, lines: { staff: 0 } } })]), { entity: "city", inbox: [letter("msg.1", "mayor-seat", "Why has no crew been hired? Please recruit.", "mayor")] }).said;
  const out = messages(said);
  expect(out.length).toBe(1);
  expect(out[0]!.text).toStartWith("Report from the works office: ");
  expect(out[0]!.text).toEndWith(`${REPORT_TAIL} What it acts on: the adopted budget's staff line, which sets its crew; a complaint of a collection missed; and a direction on one of its own forms from those the town's rule on directions names. ` +
    "On staffing it follows a direction on its staffing form (works_staffing) from those the town's rule on directions names, and no letter.");
  // A letter about something else gets the report and what the office acts on, and no sentence about a form.
  const other = wake(works, 2 * DAY, papers(), { entity: "city", inbox: [letter("msg.2", "c7-self", "Thank you for your work.")] }).said;
  expect(messages(other)[0]!.text).toEndWith("and a direction on one of its own forms from those the town's rule on directions names.");
});

test("every office a generated town has says how it answers a letter; a firm's manager and a person do not", () => {
  const silent = Object.values(modules).filter((m) => !m.answers).map((m) => m.name).sort();
  // (The bank's payment system ends its statement with how it is instructed; the rest are firms, people, and the
  // world's own machinery, which nobody writes to. A group founded in a run is its founder's, as a firm is its manager's.)
  expect(silent).toEqual(["bank.payment_system", "citizen.default", "city.tax_clerk", "firm.employer", "firm.landlord", "firm.producer", "firm.retailer", "group.founded", "idle", "office.clerk", "world.export_demand", "world.migration", "world.vendor"]);
  for (const m of Object.values(modules)) {
    if (!m.answers) continue;
    // Fixed words, in the world's terms: no platform word, and nothing that depends on who wrote.
    const words = [m.answers.office, m.answers.acts, ...(m.answers.forms ?? []).map((f) => f.say)].join(" ");
    expect({ module: m.name, clean: !/kernel|translator|resolver|module|participant|channel|-system/.test(words) }).toEqual({ module: m.name, clean: true });
    expect(m.answers.acts.length).toBeLessThan(420);
  }
});
