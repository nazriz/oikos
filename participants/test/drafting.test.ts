// Laws made from figures (docs/behaviour/government.md; docs/design/ai-citizens.md 2e), on records alone: a schedule
// writes a law's words, breakdown and rule from its figures; the council's clerk amends such a law on its form by the
// same schedule, whatever the law (the one here exists nowhere else); a law in free words stands as words and the
// result says so; a reader of laws takes an amended law in place of the one it replaces; and offices that apply a law
// or a procedure by its id stop when it's withdrawn.

import { expect, test } from "bun:test";
import schedules from "../../worlds/law/schedules.json";
import basic from "../../worlds/law/basic.json";
import type { Observation } from "../src/contracts";
import { Book, draftLaw, figureWords, type LawSchedule } from "../src/shared/common";


import { Randomness } from "../src/rng";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const councilClerk = engine("city.council_clerk");
const financeOfficer = engine("city.finance_officer");
const mayorCode = engine("city.mayor_code");
const ratesOfficer = engine("city.rates_officer");
const taxClerk = engine("city.tax_clerk");
const planningOfficer = engine("city.planning_officer");

// (Amounts are worded in a world's own money: this test's is the profile's.)
inCurrency(PROFILE.values.currency);

const DAY = 86_400;
const ctx = (participant: string, params: object, position?: string): any => ({ participant, entity: "city", position, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 800 * DAY }, params });
const council = { kind: "directory", entities: [], positions: [1, 2, 3].map((i) => ({ position: `councillor-${i}`, entity: "city", role: "councillor" })) };
const obs = (t: number, records: any[], more: object = {}): Observation => ({ t, entity: "city", participant: "x", channels: { business: { kind: "records", records }, who: council, ...more }, inbox: [], outcomes: [], woke_for: "news" }) as unknown as Observation;
const stmt = (id: string, at: number, kind: string, x: object) => ({ id, at, record: "statement", author: "genesis", speaks_for: "city", visible_to: "public", kind, text: id, ...x });
/** What a module does now: its calls' text. */
const run = (m: { step: (o: Observation, x: any) => any }, o: Observation) => {
  const out: string[] = [];
  for (let i = 0; i < 40; i++) {
    const a: any = m.step(o, undefined as any);
    if (a.type === "wait") break;
    out.push(a.call);
    o = { ...o, channels: Object.fromEntries(Object.entries(o.channels).map(([k, c]: [string, any]) => [k, c.kind === "records" ? { ...c, records: [] } : c])), inbox: [] } as Observation;
  }
  return out.join("\n");
};
const lines = (text: string, kind: string) => text.split("\n").filter((l) => l.includes(`kind=${kind}`));
/** The clerk at the close of a ballot: what it declares, and what it then publishes. What a passed ballot enacts is published from the result
 * on file, at the clerk's next step, not in the step that declares it: the result is shown back to it, as the world would. */
const close = (m: { step: (o: Observation, x: any) => any }, t: number) => {
  const first = run(m, obs(t, []));
  const filed = lines(first, "ballot_result").map((l, i) => ({ id: `res-${t}-${i}`, at: t, record: "statement", author: "clerk-system", in_position: "council-clerk", speaks_for: "city", visible_to: "public", kind: "ballot_result",
    basis: /basis=([\w.-]+)/.exec(l)![1], text: /text="([^"]*)"/.exec(l)![1], data: JSON.parse(/data=(\{.*?\})(?:, \w+=|\)$)/.exec(l)![1]!) }));
  return [first, run(m, obs(t + 3600, filed))].filter((x) => x).join("\n");
};

// A law no world has, with a count and a duration: the clerk must need nothing but its schedule and its form.
const DOGS: LawSchedule = {
  title: "the law on keeping dogs", form: "amend_dogs",
  figures: { dogs: { type: "count", unit: "dogs", label: "dogs to a home" }, alone: { type: "duration", unit: "hours", label: "time a dog may be left" }, share: { type: "count", unit: "percent", held_in: "basis points", per_unit: 100, label: "share of the fee" } },
  text: "No one may keep more than {dogs} dogs at a home, or leave one alone for more than {alone}. The pound keeps {share}% of the fee.",
  adico: { attribute: "anyone", deontic: "must_not", aim: "keep dogs", condition: "more than {dogs} at a home, or alone for more than {alone}" },
  formal: "block.block == 'publish' && block.kind == 'dog_registration' && (block.data.dogs > {dogs:dogs} || block.data.alone > {alone:seconds} || block.data.share != {share:basis_points})",
};
const schedule = stmt("schedule-dogs", 0, "law_schedule", { visible_to: ["city"], data: DOGS });
const form = stmt("form-amend-dogs", 0, "form", { data: { form: "amend_dogs", amends: "schedule-dogs", submit_as: "proposal", submit_to: ["city"],
  fields: { dogs: { type: "count" }, alone: { type: "duration" }, share: { type: "count", per_unit: 100 }, affects: { type: "choice", options: ["tenants", "development", "neither"] } } } });
const dogLaw = (id: string, values: { dogs: number; alone: number; share: number }, more: object = {}) => stmt(id, 0, "law", { ...draftLaw("schedule-dogs", DOGS, values), ...more });
const proposal = (id: string, at: number, x: object) => ({ ...stmt(id, at, "proposal", { addressed_to: ["city"], author: "c1-self", speaks_for: "c1", ...x }) });
const ballot = (id: string, at: number, of: string) => stmt(id, at, "ballot", { author: "clerk", data: { proposal: of, options: ["yes", "no"], closes_at: at + 14 * DAY, electorate: "council", tags: [] } });
const votes = (of: string, at: number, choices: string[]) => choices.map((choice, i) => ({ id: `${of}-v${i}`, at, record: "vote", author: `councillor-${i + 1}-system`, in_position: `councillor-${i + 1}`, speaks_for: "city", visible_to: "public", ballot: of, choice }));

test("a schedule writes a law from its figures: words, breakdown and rule, with the figures carried openly", () => {
  const law = draftLaw("schedule-dogs", DOGS, { dogs: 2, alone: 4 * 3600, share: 2550 });
  expect(law.text).toBe("No one may keep more than 2 dogs at a home, or leave one alone for more than 4 hours. The pound keeps 25.5% of the fee.");
  expect(law.adico).toEqual({ attribute: "anyone", deontic: "must_not", aim: "keep dogs", condition: "more than 2 at a home, or alone for more than 4 hours" });
  expect(law.formal).toEqual({ language: "cel", condition: "block.block == 'publish' && block.kind == 'dog_registration' && (block.data.dogs > 2 || block.data.alone > 14400 || block.data.share != 2550)" });
  expect(law.data).toEqual({ schedule: "schedule-dogs", figures: { dogs: { value: 2, unit: "dogs" }, alone: { value: 14400, unit: "seconds" }, share: { value: 2550, unit: "basis points" } } });
  // A duration is worded in the schedule's unit when it's a whole number of them, and otherwise in days (or less).
  expect(figureWords({ type: "duration", unit: "months" }, 360 * DAY)).toBe("12 months");
  expect(figureWords({ type: "duration", unit: "months" }, 365 * DAY)).toBe("365 days");
  expect(figureWords({ type: "duration", unit: "days" }, DAY)).toBe("1 day");
  expect(figureWords({ type: "duration", unit: "days" }, 5400)).toBe("90 minutes");
  // A law can't be written with a figure missing.
  expect(() => draftLaw("schedule-dogs", DOGS, { dogs: 2, alone: 3600 })).toThrow();
});

test("the example schedules: each is well formed, and the example law that names one reads exactly as its schedule writes it", () => {
  for (const s of schedules.records) {
    const d = s.data as unknown as LawSchedule;
    const values = Object.fromEntries(Object.entries(d.figures).map(([k, f]) => [k, f.type === "duration" ? 7 * DAY : 4000]));
    const law = draftLaw(s.id, d, values);
    for (const part of [law.text, ...Object.values(law.adico ?? {}), law.formal?.condition ?? ""]) expect(part).not.toMatch(/[{}]/);
    expect(Object.keys(law.data.figures)).toEqual(Object.keys(d.figures));
  }
  // The example code itself holds no law made from figures: each is written from its schedule with a place's own
  // (the generated towns' are held to their schedules in orchestrator/test/generality.test.ts).
  expect((basic.records as any[]).filter((r) => r.data?.schedule)).toEqual([]);
});

test("an amendment that passes: the clerk publishes the law rewritten by its schedule in place of the one in force, and readers of laws follow", () => {
  const clerk = councilClerk.create(ctx("clerk", {}, "council-clerk"));
  const old = dogLaw("law-dogs", { dogs: 2, alone: 4 * 3600, share: 2500 });
  // The proposal, as the form delivers it: the figures given (a count in the field's unit, a duration in seconds).
  const p1 = proposal("p1", DAY, { basis: "form-amend-dogs", data: { dogs: 3, share: 30, affects: "neither" } });
  const opened = run(clerk, obs(DAY, [schedule, form, old, p1]));
  expect(lines(opened, "ballot")[0]).toContain("Council ballot: to amend the law on keeping dogs (law-dogs): dogs to a home 3 dogs (now 2 dogs); share of the fee 30% (now 25%).");
  const b1 = ballot("b1", DAY, "p1");
  expect(run(clerk, obs(2 * DAY, [b1, ...votes("b1", 2 * DAY, ["yes", "yes", "no"])]))).toBe("");
  const closed = close(clerk, 15 * DAY);
  // The amended law: the figures given, the rest as it stood; its rule written as the old one's was; the old withdrawn.
  const made = lines(closed, "law").find((l) => !l.includes("kind=ballot_result"))!;
  expect(made).toContain("No one may keep more than 3 dogs at a home, or leave one alone for more than 4 hours. The pound keeps 30% of the fee. (As amended by the council on ballot b1; this replaces law-dogs.)");
  expect(made).toContain("formal=\"block.block == 'publish' && block.kind == 'dog_registration' && (block.data.dogs > 3 || block.data.alone > 14400 || block.data.share != 3000)\"");
  expect(JSON.parse(/data=(\{.*?\}), formal=/.exec(made)![1]!)).toEqual({ schedule: "schedule-dogs", replaces: "law-dogs",
    figures: { dogs: { value: 3, unit: "dogs" }, alone: { value: 14400, unit: "seconds" }, share: { value: 3000, unit: "basis points" } } });
  expect(made).toContain('"condition":"more than 3 at a home, or alone for more than 4 hours"');
  expect(made).toContain("basis=b1");
  expect(closed).toContain("withdraw=law-dogs");
  const result = lines(closed, "ballot_result")[0]!;
  expect(result).toContain("Passed: 2 for, 1 against. The law on keeping dogs is amended: dogs to a home 3 dogs (was 2 dogs); share of the fee 30% (was 25%). The amended law takes the place of law-dogs. It is written as the law it replaces was, so acts are checked against it in the same way.");
  expect(result).not.toMatch(/formal|kernel|block|condition/i);

  // A reader of laws (a book of laws shows laws, never withdrawals): the amended law in place of the old, from when it was made.
  const book = new Book();
  const amended = dogLaw("law-dogs-2", { dogs: 3, alone: 4 * 3600, share: 3000 }, { at: 15 * DAY, author: "clerk", data: { ...draftLaw("schedule-dogs", DOGS, { dogs: 3, alone: 4 * 3600, share: 3000 }).data, replaces: "law-dogs" } });
  book.absorb(obs(0, [old]));
  // (What the amended law binds, judged at the act's moment: see the skipped case after this one.)
  book.absorb(obs(15 * DAY, [amended]));
  expect(book.current("law-dogs")?.id).toBe("law-dogs-2");
  expect(book.repealed("law-dogs")).toBe(false);
  // Someone else's "law" saying it replaces the town's doesn't.
  book.absorb(obs(30 * DAY, [stmt("fake", 30 * DAY, "law", { speaks_for: "c9", data: { replaces: "law-dogs-2" } })]));
  expect(book.current("law-dogs")?.id).toBe("law-dogs-2");
});

test("an amendment that fails changes nothing; one that names no figure isn't put; a later one starts from the law then in force", () => {
  const clerk = councilClerk.create(ctx("clerk", {}, "council-clerk"));
  const old = dogLaw("law-dogs", { dogs: 2, alone: 4 * 3600, share: 2500 });
  const p1 = proposal("p1", DAY, { basis: "form-amend-dogs", data: { dogs: 5 } });
  const empty = proposal("p0", DAY, { basis: "form-amend-dogs", data: { affects: "tenants" } });
  const opened = run(clerk, obs(DAY, [schedule, form, old, p1, empty]));
  expect(lines(opened, "ballot").length).toBe(1);
  expect(opened).toContain("Your proposal p0 to amend the law on keeping dogs names no figure to change, so it hasn't been put to a ballot.");
  run(clerk, obs(2 * DAY, [ballot("b1", DAY, "p1"), ...votes("b1", 2 * DAY, ["yes", "no", "no"])]));
  const closed = close(clerk, 15 * DAY);
  expect(lines(closed, "ballot_result")[0]).toContain("Rejected: 1 for, 2 against.");
  expect(closed).not.toContain("withdraw=");
  expect(closed.split("\n").length).toBe(1);
  // With the law since withdrawn and nothing in its place, an amendment needs every figure: the result says what's missing.
  const p2 = proposal("p2", 20 * DAY, { basis: "form-amend-dogs", data: { dogs: 1 } });
  run(clerk, obs(20 * DAY, [p2, { id: "w1", at: 20 * DAY, record: "withdrawal", author: "mayor", speaks_for: "city", visible_to: "public", withdraws: "law-dogs" }]));
  run(clerk, obs(21 * DAY, [ballot("b2", 20 * DAY, "p2"), ...votes("b2", 21 * DAY, ["yes", "yes", "yes"])]));
  const second = close(clerk, 34 * DAY);
  expect(lines(second, "ballot_result")[0]).toContain("Passed: 3 for, 0 against. Nothing is enacted: the law on keeping dogs is no longer in force, and the proposal doesn't give time a dog may be left or share of the fee.");
  expect(second.split("\n").length).toBe(1);
});

// DIVERGENCE (held as test.failing; docs/risks.md, PB-21): the engine lists a law's figures in the clerk's report alphabetically (alone, dogs, share), not in the schedule's order (dogs, alone, share): kernel/crates/actors/src/offices/council.rs `amendable` iterates a BTreeMap.
test.failing("a law in free words passes as words, and the clerk says so and where figures are changed, in the town's terms", () => {
  const clerk = councilClerk.create(ctx("clerk", {}, "council-clerk"));
  const old = dogLaw("law-dogs", { dogs: 2, alone: 4 * 3600, share: 2500 });
  const general = stmt("form-council-proposal", 0, "form", { data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: {} } });
  const p1 = proposal("p1", DAY, { basis: "form-council-proposal", text: "council proposal", data: { proposal: "No one may keep more than one dog.", kind: "law", affects: "neither" } });
  expect(lines(run(clerk, obs(DAY, [schedule, form, general, old, p1])), "ballot")[0]).toContain("Council ballot: council proposal");
  run(clerk, obs(2 * DAY, [ballot("b1", DAY, "p1"), ...votes("b1", 2 * DAY, ["yes", "yes", "yes"])]));
  const closed = close(clerk, 15 * DAY);
  const result = lines(closed, "ballot_result")[0]!;
  expect(result).toContain("Passed: 3 for, 0 against. The law is recorded as worded. No rule was set down with it for acts to be checked against. Laws made from figures are amended on their own forms: the law on keeping dogs (law-dogs) on amend_dogs.");
  expect(result).not.toMatch(/formal|kernel|block|condition/i);
  const made = lines(closed, "law").find((l) => !l.includes("kind=ballot_result"))!;
  expect(made).toContain("No one may keep more than one dog.");
  expect(made).not.toContain("formal=");
  expect(closed).not.toContain("withdraw=");
  // Its report to anyone who writes: the same, with each such law's figures as they stand.
  const letter = { ...obs(16 * DAY, []), inbox: [{ id: "m1", from: "mayor-system", text: "What can I change?" }] } as unknown as Observation;
  const report = run(clerk, letter);
  expect(report).toContain("A law proposed on that form stands as its words: no rule is set down with it for acts to be checked against. Laws made from figures are amended on their own forms: the law on keeping dogs (law-dogs) on amend_dogs (dogs: dogs to a home, now 2 dogs; alone: time a dog may be left, now 4 hours; share: share of the fee, now 25%).");
  // The code mayor's own way (a proposal carrying what to enact, rule and all) still enacts it as given, with no such note.
  const p2 = proposal("p2", 20 * DAY, { text: "Proposal", data: { enact: { kind: "law", text: "Dogs stay on leads.", adico: { attribute: "anyone", deontic: "must_not", aim: "walk a dog off a lead" }, formal: { language: "cel", condition: "block.kind == 'walk'" } }, tags: [] } });
  run(clerk, obs(20 * DAY, [p2]));
  run(clerk, obs(21 * DAY, [ballot("b2", 20 * DAY, "p2"), ...votes("b2", 21 * DAY, ["yes", "yes", "yes"])]));
  const third = close(clerk, 34 * DAY);
  expect(lines(third, "ballot_result")[0]).toContain('text="Passed: 3 for, 0 against. Voting for: councillor-1, councillor-2, councillor-3; against: none."');
  expect(third).toContain("block.kind == 'walk'");
});

test("the code mayor answers a petition that asks for a figure a law's form covers on that form, and not again once the law says so", () => {
  const petition = (id: string, at: number) => stmt(id, at, "petition", { author: "c1-self", speaks_for: "c1", data: { demand: { kind: "law", text: "Fewer dogs, and nothing costs more.", tags: ["tenant_protection"], amend: { schedule: "schedule-dogs", figures: { dogs: 1, share: 3000, alone: 2 * DAY } } } } });
  const count = (id: string, of: string, at: number) => stmt(id, at, "petition_count", { author: "c1-self", speaks_for: "c1", basis: of, data: { petition: of, signatures: 100 } });
  const params = { builder: "builder", population: 200, responsiveness_bps: 10_000, park_budget: 0 };
  const mayor = mayorCode.create(ctx("mayor-system", params, "mayor"));
  const old = dogLaw("law-dogs", { dogs: 2, alone: 4 * 3600, share: 2500 });
  const did = run(mayor, obs(DAY, [form, old, petition("pet-1", 0), count("n1", "pet-1", DAY)]));
  const call = did.split("\n").find((l) => l.includes("form("))!;
  expect(call).toContain("form=amend_dogs");
  expect(call).toContain("dogs=\"1\"");
  expect(call).toContain("share=\"30\"");
  expect(call).toContain("alone=\"2 days\"");
  expect(call).toContain("affects=tenants");
  expect(lines(did, "petition_response")[0]).toContain("has been put to the council as an amendment of that law. The rest of what it asks hasn't been put.");
  expect(lines(did, "proposal").filter((l) => l.includes("from petition"))).toEqual([]);
  // The same asked again once the law in force says it: answered, not tabled.
  const now = dogLaw("law-dogs-2", { dogs: 1, alone: 2 * DAY, share: 3000 }, { at: 30 * DAY, data: { ...draftLaw("schedule-dogs", DOGS, { dogs: 1, alone: 2 * DAY, share: 3000 }).data, replaces: "law-dogs" } });
  const again = run(mayor, obs(40 * DAY, [now, petition("pet-2", 35 * DAY), count("n2", "pet-2", 40 * DAY)]));
  expect(again).not.toContain("form=amend_dogs");
  expect(lines(again, "petition_response")[0]).toContain("the law in force (law-dogs-2) already says what it asks");
  // A petition whose demand names no law's figures goes to the council in its own words, as before.
  const plain = stmt("pet-3", 41 * DAY, "petition", { author: "c1-self", speaks_for: "c1", data: { demand: { kind: "law", text: "Dogs are welcome in the park.", tags: [] } } });
  expect(lines(run(mayor, obs(50 * DAY, [plain, count("n3", "pet-3", 50 * DAY)])), "proposal").some((l) => l.includes("Dogs are welcome in the park."))).toBe(true);
});

test("offices that apply a law or a procedure by its id stop once it's withdrawn", () => {
  const withdrawal = (id: string, at: number, of: string) => ({ id, at, record: "withdrawal", author: "clerk", speaks_for: "city", visible_to: "public", withdraws: of });
  const account = { treasury: { kind: "accounts", accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "USD", balance: "100000000" }], transactions: [] } };

  // The planning office: a lot on the habitat register is refused under the habitat law; with the law withdrawn, granted.
  const planning = planningOfficer.create(ctx("planning-system", { habitat_law: "law-habitat" }, "planning"));
  const habitat = stmt("law-habitat", 0, "law", { adico: { attribute: "anyone", deontic: "must_not", aim: "build on habitat" } });
  const register = stmt("reg-1", 0, "habitat_register", { data: { lots: ["lot-1"] } });
  const apply = (id: string, at: number) => stmt(id, at, "permit_application", { author: "c1-self", speaks_for: "c1", addressed_to: ["city"], data: { lot: "lot-1", structure_type: "house" } });
  expect(lines(run(planning, obs(DAY, [habitat, register, apply("app-1", DAY)])), "permit_decision")[0]).toContain("Permit refused for lot-1: it would breach law-habitat.");
  expect(lines(run(planning, obs(2 * DAY, [withdrawal("w1", 2 * DAY, "law-habitat"), apply("app-2", 2 * DAY)])), "permit_decision")[0]).toContain("Permit granted to build house on lot-1.");

  // The finance office: an invoice over the approval limit waits for the mayor's approval while the payments procedure
  // stands; once the procedure is withdrawn, the rule goes with it (the budget still bounds it).
  const finance = financeOfficer.create(ctx("finance-system", { procedure: "proc-payments" }, "finance"));
  const procedure = stmt("proc-payments", 0, "procedure", { data: { approval: { by: "mayor", over: 5_000_000 } } });
  const budget = stmt("budget-1", 0, "budget", { data: { year: 1, lines: { parks: 20_000_000 } } });
  const invoice = stmt("inv-1", DAY, "invoice", { author: "builder", speaks_for: "builder", addressed_to: ["city"], data: { outcome: { money: { to: "acc-builder", amount: "6000000" } } } });
  expect(run(finance, obs(DAY, [procedure, budget, invoice], account))).not.toContain("money(");
  expect(run(finance, obs(4 * DAY, [withdrawal("w2", 4 * DAY, "proc-payments")], account))).toContain("settles=inv-1");

  // The rates officer: notices at the law's rate; none once the law is withdrawn, and its report says why.
  const rates = ratesOfficer.create(ctx("rates-system", { first_day: 1 }, "rates"));
  const law = stmt("law-rates", 0, "law", { data: { tax: "rates", rate_ppm: 10_000, instalments: 4, due_days: 30, penalty_interest_bps: 0 } });
  const valuation = stmt("val-1", 0, "valuation", { data: { lot: "lot-1", owner: "landlord-1", land: 100_000_000, value: 100_000_000, year: 1 } }); // (the valuer's paper always says land and year)
  expect(lines(run(rates, obs(DAY, [law, valuation], account)), "rates_notice").length).toBe(1);
  const later = { ...obs(120 * DAY, [withdrawal("w3", 100 * DAY, "law-rates")], account), inbox: [{ id: "m1", from: "mayor-system", text: "?" }] } as unknown as Observation;
  const after = run(rates, later);
  expect(lines(after, "rates_notice")).toEqual([]);
  expect(after).toContain("the rating law has been withdrawn, so no rates are levied");

  // The tax clerk: a report is assessed at the law's rate; none once the law is withdrawn.
  const tax = taxClerk.create(ctx("tax-system", {}, "tax"));
  const taxLaw = stmt("law-tax", 0, "law", { data: { rate_bps: 1000, penalty_bps: 2000 } });
  const report = (id: string, at: number) => stmt(id, at, "tax_report", { author: "l1", speaks_for: "landlord-1", addressed_to: ["city"], data: { rent_received: 100_000, account: "acc-landlord-1", period_end: at } }); // (a report always says the period it closes)
  expect(run(tax, obs(DAY, [taxLaw, report("tr-1", DAY)], account))).toContain("claim(");
  expect(run(tax, obs(8 * DAY, [withdrawal("w4", 8 * DAY, "law-tax"), report("tr-2", 8 * DAY)], account))).toBe("");
});

// ------------------------------------------------------------------ figures a law may do without (2026-10-09)

// A law no world has, of two requirements a place may have or not: the clerk and the drafting need nothing else.
const BELLS: LawSchedule = {
  title: "the law on ringing bells", form: "amend_bells",
  figures: { rest: { type: "duration", unit: "days", optional: true, label: "rest between ringings" }, share: { type: "count", unit: "percent", held_in: "basis points", per_unit: 100, optional: true, label: "neighbours who must agree" } },
  text: "Bells may be rung only as this law allows. << ;;They rest at least {rest} between ringings.;;At least {share}% of the neighbours have agreed.>>",
  adico: { attribute: "ringers", deontic: "must_not", aim: "ring bells", condition: "<<, or ;;within {rest} of the last ringing;;without {share}% of the neighbours agreeing>>" },
  formal: "block.block == 'publish' && block.kind == 'ringing' && (<< || ;;block.data.since < {rest:seconds};;block.data.agreed * 10000 < {share:basis_points} * block.data.neighbours>>)",
};

test("a figure a law may do without: its clause is written where it is given and left out where it is not, nought counting as not given; no law says nought or counts in seconds", () => {
  const both = draftLaw("schedule-bells", BELLS, { rest: 2 * DAY, share: 6000 });
  expect(both.text).toBe("Bells may be rung only as this law allows. They rest at least 2 days between ringings. At least 60% of the neighbours have agreed.");
  expect(both.adico!.condition).toBe("within 2 days of the last ringing, or without 60% of the neighbours agreeing");
  expect(both.formal!.condition).toBe(`block.block == 'publish' && block.kind == 'ringing' && (block.data.since < ${2 * DAY} || block.data.agreed * 10000 < 6000 * block.data.neighbours)`);
  // One of the two, not stated or stated as nought: the same law.
  for (const values of [{ share: 6000 }, { rest: 0, share: 6000 }, { rest: undefined, share: 6000 }]) {
    const one = draftLaw("schedule-bells", BELLS, values);
    expect(one.text).toBe("Bells may be rung only as this law allows. At least 60% of the neighbours have agreed.");
    expect(one.adico!.condition).toBe("without 60% of the neighbours agreeing");
    expect(one.formal!.condition).toBe("block.block == 'publish' && block.kind == 'ringing' && (block.data.agreed * 10000 < 6000 * block.data.neighbours)");
    expect(one.data.figures).toEqual({ share: { value: 6000, unit: "basis points" } });
  }
  expect(draftLaw("schedule-bells", BELLS, { rest: 7 * DAY }).text).toBe("Bells may be rung only as this law allows. They rest at least 7 days between ringings.");
  // None of them: there is no law to write.
  expect(() => draftLaw("schedule-bells", BELLS, {})).toThrow(/none of its figures/);
  expect(() => draftLaw("schedule-bells", BELLS, { rest: 0, share: 0 })).toThrow(/none of its figures/);
  // A figure a law can't do without is still a gap (the dogs' law).
  expect(() => draftLaw("schedule-dogs", DOGS, { dogs: 2, alone: 3600 })).toThrow(/no figure share/);
  // Words for a duration: never seconds; nought is nought of the schedule's unit; what is not there is "none".
  expect(figureWords({ type: "duration", unit: "days" }, 0)).toBe("0 days");
  expect(figureWords({ type: "duration", unit: "months" }, 0)).toBe("0 months");
  expect(figureWords({ type: "duration", unit: "days" }, 129_600)).toBe("36 hours");
  expect(figureWords({ type: "duration", unit: "days" }, 43_230)).toBe("0.5 days");
  expect(figureWords({ type: "duration", unit: "days" }, undefined)).toBe("none");
  // The world's schedules: each writes a law from any one of its figures alone, in whole sentences.
  for (const s of schedules.records) {
    const d = s.data as unknown as LawSchedule;
    for (const [k, f] of Object.entries(d.figures)) {
      expect(f.optional).toBe(true);
      const law = draftLaw(s.id, d, { [k]: f.type === "duration" ? 7 * DAY : 4000 });
      for (const part of [law.text, ...Object.values(law.adico ?? {}), law.formal?.condition ?? ""]) expect(part).not.toMatch(/[{}<>;]{2}|[{}]|\(\)|\s{2}|^\s|\s$/);
      expect(law.text).toMatch(/\.$/);
      expect(Object.keys(law.data.figures)).toEqual([k]);
    }
  }
});

test("the clerk amends a law of optional figures: a requirement added, one taken away by nought, and a law made where the town had none", () => {
  const bellSchedule = stmt("schedule-bells", 0, "law_schedule", { visible_to: ["city"], data: BELLS });
  const bellForm = stmt("form-amend-bells", 0, "form", { data: { form: "amend_bells", amends: "schedule-bells", submit_as: "proposal", submit_to: ["city"], fields: { rest: { type: "duration" }, share: { type: "count", per_unit: 100 }, affects: { type: "choice", options: ["tenants", "development", "neither"] } } } });
  const passed = (records: any[], data: object) => {
    const clerk = councilClerk.create(ctx("clerk", {}, "council-clerk"));
    const p = proposal("p1", DAY, { basis: "form-amend-bells", data: { ...data, affects: "neither" } });
    const opened = run(clerk, obs(DAY, [bellSchedule, bellForm, ...records, p]));
    const b = ballot("b1", DAY, "p1");
    run(clerk, obs(2 * DAY, [b, ...votes("b1", 2 * DAY, ["yes", "yes", "yes"])]));
    return { opened, closed: close(clerk, 16 * DAY) };
  };
  const law = stmt("law-bells", 0, "law", { ...draftLaw("schedule-bells", BELLS, { share: 6000 }) });
  // A requirement the law in force does not have, added.
  const added = passed([law], { rest: 3 * DAY });
  expect(lines(added.opened, "ballot")[0]).toContain("rest between ringings 3 days (now none)");
  expect(lines(added.closed, "law")[0]).toContain("They rest at least 3 days between ringings. At least 60% of the neighbours have agreed.");
  // One taken away: given as nought.
  const full = stmt("law-bells", 0, "law", { ...draftLaw("schedule-bells", BELLS, { rest: 3 * DAY, share: 6000 }) });
  const removed = passed([full], { share: 0 });
  expect(lines(removed.opened, "ballot")[0]).toContain("neighbours who must agree none (now 60%)");
  expect(lines(removed.closed, "law")[0]).toContain('text="Bells may be rung only as this law allows. They rest at least 3 days between ringings. (As amended');
  // The last one taken away: nothing is enacted, and the result says so.
  const emptied = passed([law], { share: 0 });
  expect(lines(emptied.closed, "law")).toEqual([]);
  expect(lines(emptied.closed, "ballot_result")[0]).toContain("Nothing is enacted");
  // No law in force: one figure is enough to make it.
  const made = passed([], { rest: 5 * DAY });
  expect(lines(made.closed, "law")[0]).toContain("They rest at least 5 days between ringings. (Made by the council on ballot b1.)");
});

// BLOCKED: this was part of the case above and called `breaches`, which the deleted TypeScript library exported. The engine's
// `breaches` is covered for an act and a law that cannot be read (kernel/crates/actors/src/common/tests.rs, a_prohibition_binds_an_act_it_is_true_of_and_says_when_it_cannot_be_read),
// but no Rust test judges an act by the amended law and by the law as it stood when the act was made. Kept, skipped, until one does.
const breaches = (_book: Book, _act: object, _actor: string, _now: number): { id: string }[] => { throw new Error("blocked: breaches is not in TypeScript now"); };
// PORT NEEDED (cut-over, held as test.skip): the TypeScript helper this case called is gone and no engine test judges the same; docs/risks.md, MT-18.
test.skip("an act is judged by the amended law from when it was made, and by the law as it stood when the act was made", () => {
  const old = dogLaw("law-dogs", { dogs: 2, alone: 4 * 3600, share: 2500 });
  const amended = dogLaw("law-dogs-2", { dogs: 3, alone: 4 * 3600, share: 3000 }, { at: 15 * DAY, author: "clerk", data: { ...draftLaw("schedule-dogs", DOGS, { dogs: 3, alone: 4 * 3600, share: 3000 }).data, replaces: "law-dogs" } });
  const book = new Book();
  book.absorb(obs(0, [old]));
  const three = { block: "publish", kind: "dog_registration", data: { dogs: 3, alone: 3600, share: 3000 } };
  expect(breaches(book, three, "c1", 10 * DAY).map((l) => l.id)).toEqual(["law-dogs"]);
  book.absorb(obs(15 * DAY, [amended]));
  expect(breaches(book, three, "c1", 20 * DAY)).toEqual([]);
  expect(breaches(book, { ...three, data: { dogs: 4, alone: 3600, share: 3000 } }, "c1", 20 * DAY).map((l) => l.id)).toEqual(["law-dogs-2"]);
  // An act is judged by the law as it stood when the act was made.
  expect(breaches(book, three, "c1", 10 * DAY).map((l) => l.id)).toEqual(["law-dogs"]);
});
