// Offices that take written directions (docs/behaviour/directions.md; docs/design/call-language-gaps.md B.4): an
// office publishes a form for each direction it follows; whoever the town's own rule says may direct it files the
// direction on the form; the office follows the one that stands, from its next plan, until it is replaced or
// withdrawn. A direction from anyone else changes nothing, and its writer is told so. Nothing here is a kernel rule:
// the rule is a record, the direction is a statement, and following it is the office's own conduct.

import { expect, test } from "bun:test";
import { modules } from "../src/index";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";

// (An invented money: nothing here is any place's.)
inCurrency({ code: "XYZ", minor_units: 2 });

const WAGE = 300_000, PERIOD = 14 * DAY;
const annual = Math.floor((WAGE * 365 * DAY) / PERIOD);
const rule = (by: string[] = ["mayor", "council-clerk"], x: object = {}) => statement("proc-directions", 0, "procedure", { addressed_to: ["city"], data: { directions: { by } }, ...x });
const form = (name: string, office: string) => statement(`form-${name.replace(/_/g, "-")}`, 0, "form", { data: { form: name, office, submit_as: "direction", submit_to: ["city"], fields: {} } });
const budget = statement("budget-1", 0, "budget", { data: { year: 1, lines: { staff: 3 * annual } } });
/** A direction as the world records one filed on a form: made in a post, for the town, citing the form. */
const direction = (id: string, at: number, formId: string, post: string | undefined, data: object, author = `${post ?? "c0009"}-system`) =>
  ({ id, at, record: "statement", author, ...(post ? { in_position: post } : {}), speaks_for: post ? "city" : "c0009", visible_to: ["city"], addressed_to: ["city"], kind: "direction", basis: formId, text: "direction", data });
const withdrawal = (id: string, at: number, of: string) => ({ id, at, record: "withdrawal", author: "mayor-system", in_position: "mayor", speaks_for: "city", visible_to: ["city"], withdraws: of });
const records = (...rs: object[]) => ({ all: { kind: "records", records: rs } });

const works = (params: object = {}) => modules["city.works"]!.create(context("works-system", "city", { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: WAGE, period: PERIOD, directed_under: "proc-directions", ...params }, { position: "works" }));
const base = [rule(), form("works_staffing", "works"), form("works_collection", "works"), budget];
const posted = (w: ReturnType<typeof wake>) => w.of("statement", "job_posting").length;
const letters = (w: ReturnType<typeof wake>) => w.of("message").map((m) => m.args.text as string);

test("with no direction, the works office advertises a post when it is short of the crew its budget pays for", () => {
  const w = wake(works(), 10 * DAY, records(...base), { entity: "city" });
  expect(posted(w)).toBe(1);
  expect(letters(w)).toEqual([]);
});

test("directed by the mayor not to recruit, it advertises nothing, takes its advertisement down and says what it will do; the direction withdrawn, it advertises again", () => {
  const m = works();
  const first = wake(m, 10 * DAY, records(...base), { entity: "city", as: { participant: "works-system", position: "works" } });
  expect(posted(first)).toBe(1);
  const advert = first.made.find((r) => r.kind === "job_posting")!;
  // The mayor files the direction on the office's form. At its next plan the office follows it.
  const d = direction("rec.50", 11 * DAY, "form-works-staffing", "mayor", { recruit: "no" });
  const second = wake(m, 11 * DAY, records(advert, d), { entity: "city" });
  expect(posted(second)).toBe(0);
  expect(second.of("statement").filter((c) => c.args.withdraw === advert.id)).toHaveLength(1);
  expect(letters(second)).toEqual(["From the works office: your direction rec.50 is received. The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. It has no offer out that is not yet signed. It stands until you replace or withdraw it."]);
  expect(second.of("message")[0]!.args.to).toEqual(["mayor-system"]);
  // While it stands: nothing, day after day, and no second letter.
  const third = wake(m, 12 * DAY, records(withdrawal("rec.51", 11 * DAY, advert.id)), { entity: "city" });
  expect(posted(third)).toBe(0);
  expect(third.said).toEqual([]);
  // Withdrawn: it lapses, and the office goes back to its own practice.
  const fourth = wake(m, 13 * DAY, records(withdrawal("rec.60", 13 * DAY, "rec.50")), { entity: "city" });
  expect(posted(fourth)).toBe(1);
});

test("a later direction replaces an earlier one, and a number of posts caps the hiring without standing anyone down", () => {
  const m = works();
  const stop = direction("rec.50", 5 * DAY, "form-works-staffing", "mayor", { recruit: "no" });
  expect(posted(wake(m, 6 * DAY, records(...base, stop), { entity: "city" }))).toBe(0);
  const go = direction("rec.70", 7 * DAY, "form-works-staffing", "council-clerk", { recruit: "yes", posts: 1 });
  const w = wake(m, 8 * DAY, records(go), { entity: "city" });
  expect(posted(w)).toBe(1);
  expect(w.of("statement", "job_posting")[0]!.why).toContain("direction rec.70 says to fill 1");
  expect(letters(w)).toEqual(["From the works office: your direction rec.70 is received. The office recruits up to 1 crew. It stands until you replace or withdraw it."]);
  // Nobody is let go under it, whatever it says.
  expect(w.of("agreement")).toEqual([]);
});

test("a direction from someone the town's rule does not name changes nothing, and they are told so in a letter that says only what the rule says", () => {
  for (const [post, author] of [["finance", "finance-system"], [undefined, "c0009-self"]] as const) {
    const d = direction("rec.50", 5 * DAY, "form-works-staffing", post, { recruit: "no" }, author);
    const w = wake(works(), 6 * DAY, records(...base, d), { entity: "city" });
    expect(posted(w)).toBe(1);
    expect(letters(w)).toEqual(["From the works office: your direction rec.50 is not being followed. This office takes directions on its forms only from those proc-directions names."]);
    expect(w.of("message")[0]!.args.to).toEqual([author]);
    // Nothing of the office's own is in the letter: no count of crew, no budget, no name.
    expect(letters(w)[0]).not.toMatch(/crew|budget|\$|[0-9]{3}/);
  }
});

test("who may direct is the town's rule as it stands: amended, the new posts; withdrawn, nobody; and one office may have its own", () => {
  const d = direction("rec.50", 5 * DAY, "form-works-staffing", "mayor", { recruit: "no" });
  // The rule names only the clerk.
  expect(posted(wake(works(), 6 * DAY, records(rule(["council-clerk"]), form("works_staffing", "works"), budget, d), { entity: "city" }))).toBe(1);
  // The rule is withdrawn, with nothing in its place.
  const gone = wake(works(), 6 * DAY, records(...base, d, { ...withdrawal("rec.9", 4 * DAY, "proc-directions"), author: "council-clerk-system", in_position: "council-clerk" }), { entity: "city" });
  expect(posted(gone)).toBe(1);
  expect(letters(gone)).toEqual(["From the works office: your direction rec.50 is not being followed. No rule of this organisation's says who may direct this office."]);
  // The rule gives the works office its own director.
  const own = statement("proc-directions", 0, "procedure", { addressed_to: ["city"], data: { directions: { by: ["council-clerk"], offices: { works: ["mayor"] } } } });
  expect(posted(wake(works(), 6 * DAY, records(own, form("works_staffing", "works"), budget, d), { entity: "city" }))).toBe(0);
  // A world that names no rule: the office follows nobody's.
  expect(posted(wake(works({ directed_under: "" }), 6 * DAY, records(...base, d), { entity: "city" }))).toBe(1);
});

test("a direction is followed only on the office's own form, and only as often as the office follows directions", () => {
  // Filed on another office's form of the same shape: not ours.
  const other = direction("rec.50", 5 * DAY, "form-environment-staffing", "mayor", { recruit: "no" });
  const w = wake(works(), 6 * DAY, records(...base, form("environment_staffing", "environment"), other), { entity: "city" });
  expect(posted(w)).toBe(1);
  expect(letters(w)).toEqual([]);
  // An office that never follows a direction (its holder's conduct, a parameter as the finance office's is).
  const d = direction("rec.50", 5 * DAY, "form-works-staffing", "mayor", { recruit: "no" });
  expect(posted(wake(works({ direction_compliance_bps: 0 }), 6 * DAY, records(...base, d), { entity: "city" }))).toBe(1);
});

test("the works office's report says which directions it is following, and collects as often as directed", () => {
  const m = works({ collect_labour: 60, collect_per_unit: 10_000 });
  const d = direction("rec.50", 5 * DAY, "form-works-collection", "mayor", { every: 14 * DAY });
  const w = wake(m, 6 * DAY, records(...base, d), { entity: "city", inbox: [{ id: "msg.1", t: 6 * DAY, from: "mayor-system", as: "mayor", to: ["works-system"], text: "How is the round?" }] });
  const texts = letters(w);
  expect(texts.some((x) => x.includes("The crew collects from each address every 14 days"))).toBe(true);
  const report = texts.find((x) => x.startsWith("Report from the works office"))!;
  expect(report).toContain("Directions we are following: rec.50 (collect every 14 days).");
  expect(report).toContain("every home every 14 days");
});

test("the environment office takes the same staffing direction on its own form", () => {
  const env = modules["city.environment"]!.create(context("environment-system", "city", { depot: "town-hall", workplace: "town-hall/workplace.1", planning: "city", wage: WAGE, period: PERIOD, directed_under: "proc-directions" }, { position: "environment" }));
  const b = statement("budget-1", 0, "budget", { data: { year: 1, lines: { environment: 2 * annual } } });
  const d = direction("rec.50", 5 * DAY, "form-environment-staffing", "mayor", { recruit: "no" });
  const w = wake(env, 6 * DAY, records(rule(), form("environment_staffing", "environment"), b, d), { entity: "city" });
  expect(posted(w)).toBe(0);
  expect(letters(w)[0]).toContain("your direction rec.50 is received");
  const free = modules["city.environment"]!.create(context("environment-system", "city", { depot: "town-hall", workplace: "town-hall/workplace.1", planning: "city", wage: WAGE, period: PERIOD, directed_under: "proc-directions" }, { position: "environment" }));
  expect(posted(wake(free, 6 * DAY, records(rule(), form("environment_staffing", "environment"), b), { entity: "city" }))).toBe(1);
});

test("the rates officer, directed to add no penalty interest, adds none while that stands", () => {
  const law = statement("law-rates", 0, "law", { data: { tax: "rates", rate_ppm: 5000, instalments: 4, due_days: 30, penalty_interest_bps: 1000 } });
  const claim = { id: "rec.20", at: 30 * DAY, record: "claim", author: "rates-system", in_position: "rates", speaks_for: "city", position: "right", holder: "city", counterparty: "c0001", visible_to: ["city", "c0001"], about: { kind: "rates", amount: 120_000, account: "acc-city", due: 60 * DAY, lots: ["lot-1"] } };
  const accounts = { treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: "1000000", currency: "XYZ" }] } };
  const rates = () => modules["city.rates_officer"]!.create(context("rates-system", "city", { directed_under: "proc-directions" }, { position: "rates" }));
  const interest = (w: ReturnType<typeof wake>) => w.of("claim").filter((c) => c.args.about?.kind === "rates_interest").length;
  expect(interest(wake(rates(), 100 * DAY, { ...records(rule(), form("rates_recovery", "rates"), law, claim), ...accounts }, { entity: "city" }))).toBe(1);
  const d = direction("rec.50", 90 * DAY, "form-rates-recovery", "mayor", { interest: "no" });
  const w = wake(rates(), 100 * DAY, { ...records(rule(), form("rates_recovery", "rates"), law, claim, d), ...accounts }, { entity: "city" });
  expect(interest(w)).toBe(0);
  expect(letters(w)).toEqual(["From the rates office: your direction rec.50 is received. No penalty interest is added to overdue rates while it stands; the rates are still owed. It stands until you replace or withdraw it."]);
});

test("a payment that names the rates notice pays the rates: no interest is added, as none is for one that names the claim", () => {
  const law = statement("law-rates", 0, "law", { data: { tax: "rates", rate_ppm: 5000, instalments: 4, due_days: 30, penalty_interest_bps: 1000 } });
  const claim = { id: "rec.20", at: 30 * DAY, record: "claim", author: "rates-system", in_position: "rates", speaks_for: "city", position: "right", holder: "city", counterparty: "landlord-1", visible_to: ["city", "landlord-1"], about: { kind: "rates", amount: 120_000, account: "acc-city", due: 60 * DAY, lots: ["lot-1"] } };
  const notice = { ...statement("rec.19", 30 * DAY, "rates_notice", { author: "rates-system", in_position: "rates", addressed_to: ["landlord-1"], visible_to: ["city", "landlord-1"], data: { amount: 120_000, lots: ["lot-1"], due: 60 * DAY, account: "acc-city" } }) };
  const treasury = (settles?: string) => ({ treasury: { kind: "accounts", transactions: settles ? [{ t: 40 * DAY, from: "acc-landlord-1", to: "acc-city", amount: "120000", settles }] : [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: "1000000", currency: "XYZ" }] } });
  const rates = () => modules["city.rates_officer"]!.create(context("rates-system", "city", {}, { position: "rates" }));
  const interest = (settles?: string) => wake(rates(), 100 * DAY, { ...records(law, notice, claim), ...treasury(settles) }, { entity: "city" }).of("claim").filter((c) => c.args.about?.kind === "rates_interest").length;
  expect(interest()).toBe(1); // unpaid: a month's interest
  expect(interest("rec.20")).toBe(0); // paid, naming the claim
  expect(interest("rec.19")).toBe(0); // paid, naming the notice (wave 2c: both landlords of one pilot were charged and paid twice)
  expect(interest("rec.99")).toBe(1); // a payment that names something else pays neither
});

test("a direction its giver puts on hold is not followed while the hold stands, and is followed again when the hold is withdrawn; anyone else's hold is nothing", () => {
  const d = direction("rec.50", 5 * DAY, "form-works-staffing", "mayor", { recruit: "no" });
  const hold = (by: string) => statement("rec.55", 6 * DAY, "hold", { author: "mayor-system", speaks_for: by, addressed_to: [by], visible_to: [by], data: { holds: ["rec.50"] } });
  expect(posted(wake(works(), 7 * DAY, records(...base, d), { entity: "city" }))).toBe(0);
  expect(posted(wake(works(), 7 * DAY, records(...base, d, hold("city")), { entity: "city" }))).toBe(1);
  expect(posted(wake(works(), 7 * DAY, records(...base, d, hold("city"), withdrawal("rec.56", 6 * DAY, "rec.55")), { entity: "city" }))).toBe(0);
  expect(posted(wake(works(), 7 * DAY, records(...base, d, hold("bank")), { entity: "city" }))).toBe(0);
});

test("an advertisement the office has put on hold brings nobody an offer while the hold stands", () => {
  const advert = statement("rec.40", 9 * DAY, "job_posting", { author: "works-system", in_position: "works", data: { wage: WAGE, period: PERIOD, role: "works crew" } });
  const application = { id: "rec.41", at: 9 * DAY + 10, record: "statement", author: "c0100-self", speaks_for: "c0100", kind: "job_application", addressed_to: ["city"], visible_to: ["city", "c0100"], text: "x", data: { posting: "rec.40", account: "acc-c0100" } };
  const hold = statement("rec.42", 9 * DAY + 20, "hold", { addressed_to: ["city"], visible_to: ["city"], data: { holds: ["rec.40"] } });
  expect(wake(works(), 10 * DAY, records(...base, advert, application), { entity: "city" }).of("agreement")).toHaveLength(1);
  expect(wake(works(), 10 * DAY, records(...base, advert, application, hold), { entity: "city" }).of("agreement")).toEqual([]);
});

test("every direction a module declares has a form's shape: a name, a title, fields with their descriptions, and what following it means", () => {
  const declared = Object.values(modules).flatMap((m) => (m.takes ?? []).map((t) => ({ module: m.name, ...t })));
  expect(declared.map((t) => `${t.module}: ${t.form}`).sort()).toEqual(["city.environment: environment_staffing", "city.inspector: inspector_enforcement", "city.rates_officer: rates_recovery", "city.works: works_collection", "city.works: works_staffing"]);
  expect(new Set(declared.map((t) => t.form)).size).toBe(declared.length);
  for (const t of declared) {
    expect(t.form).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(t.follows.length).toBeGreaterThan(40);
    for (const f of Object.values(t.fields)) expect(f.description.length).toBeGreaterThan(10);
    // (A choice says what may be chosen; the words name no place and no money.)
    for (const f of Object.values(t.fields)) if (f.type === "choice") expect(f.options!.length).toBeGreaterThan(1);
    expect(`${t.title} ${t.follows}`).not.toMatch(/\$|dollar/i);
  }
});

// Bug hunt 2026-10-17, finding 2: a rates officer's successor carries on from the office's file and the payments it has had.
test("a new rates officer, shown the office's file, levies no instalment out of turn and charges no interest on a paid notice", () => {
  const law = statement("law-rates", 0, "law", { data: { tax: "rates", rate_ppm: 5000, instalments: 4, due_days: 30, penalty_interest_bps: 1000 } });
  const valuation = statement("val-1", 5 * DAY, "valuation", { data: { lot: "lot-1", owner: "landlord-1", value: 24_000_000 } });
  const notice = statement("rec.19", 30 * DAY, "rates_notice", { author: "rates-system", in_position: "rates", addressed_to: ["landlord-1"], visible_to: ["city", "landlord-1"], data: { amount: 120_000, lots: ["lot-1"], due: 60 * DAY, account: "acc-city" } });
  const claim = { id: "rec.20", at: 30 * DAY, record: "claim", author: "rates-system", in_position: "rates", speaks_for: "city", position: "right", holder: "city", counterparty: "landlord-1", visible_to: ["city", "landlord-1"], about: { kind: "rates", amount: 120_000, account: "acc-city", due: 60 * DAY, lots: ["lot-1"] } };
  // The payment of day 40 was made while another held the post; the new holder is told of it as of any payment.
  const treasury = { treasury: { kind: "accounts", transactions: [{ t: 40 * DAY, from: "acc-landlord-1", to: "acc-city", amount: "120000", settles: "rec.20" }], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: "1000000", currency: "XYZ" }] } };
  const rates = () => modules["city.rates_officer"]!.create(context("rates-successor", "city", { first_day: 30 }, { position: "rates" }));
  const w = wake(rates(), 100 * DAY, { ...records(law, valuation, notice, claim), ...treasury }, { entity: "city", as: { participant: "rates-successor", position: "rates" } });
  expect(w.of("statement", "rates_notice")).toEqual([]); // the next instalment is not due until day 121
  expect(w.of("claim").filter((c) => c.args.about?.kind === "rates_interest")).toEqual([]);
  expect(wake(rates(), 122 * DAY, { ...records(law, valuation, notice, claim), ...treasury }, { entity: "city" }).of("statement", "rates_notice").length).toBe(1);
});
