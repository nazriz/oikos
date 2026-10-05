// The local paper (docs/behaviour/news.md), on records alone: what the editor runs (the week's most newsworthy new
// public records, by the weight of their kind), how it tells each (its tone toward the town's government, whether it's
// about the government at all), what its leaning does, and when there's an edition.

import { expect, test } from "bun:test";
import { newspaper } from "../src/behaviour/news";
import { context, DAY, statement, wake } from "./stepping";

const editor = (params: object = {}, seed = 1n) => newspaper.create(context("editor-system", "paper", { town: "city", ...params }, { position: "editor", seed }));
const edition = (m: any, t: number, records: any[]) => wake(m, t, { record: { kind: "records", records } }, { entity: "paper" }).said;
// One public record of each kind the paper counts as news. (Records of a weight tie by the last three digits of the
// second they were made: `at` here orders them within a weight.)
const T0 = 2 * DAY;
const RECORDS = [
  statement("r-result", T0 + 1, "ballot_result", { text: "Passed: 5 for, 0 against." }),
  statement("r-petition", T0 + 9, "petition", { author: "c1-self", speaks_for: "c1", text: "Petition: cap rent rises." }),
  statement("r-notice", T0 + 8, "election_notice", { text: "Election notice." }),
  statement("r-env", T0 + 7, "environment_report", { text: "Trout are down.", data: { species: { trout: { change_bps: -2000 }, heron: { change_bps: 300 } } } }),
  statement("r-budget", T0 + 6, "budget", { text: "The town's budget for year 1." }),
  statement("r-law", T0 + 5, "law", { text: "Sixty days' notice." }),
  statement("r-nomination", T0 + 4, "nomination", { author: "c2-self", speaks_for: "c2", text: "Standing for mayor." }),
  statement("r-complaint", T0 + 3, "complaint", { author: "c3-self", speaks_for: "c3", text: "The bins." }),
  statement("r-permit", T0 + 2, "permit_decision", { text: "Permit granted." }),
];
const NOT_NEWS = [statement("r-price", T0, "price_list", { text: "Prices." }), statement("r-own", T0, "petition", { author: "editor-system", speaks_for: "paper", text: "Our own." })];
const itemsOf = (said: any[]) => said.map((c) => ({ of: c.args.basis, ...c.args.data }));

test("an edition runs the items_per_edition most newsworthy new records, by the weight of their kind: an election's result (4); a petition, an election notice (3); an environment report, a budget, a law, a nomination (2); a complaint, a permit decision (1)", () => {
  const m = editor({ items_per_edition: 9 });
  const said = edition(m, 8 * DAY, [...RECORDS, ...NOT_NEWS]);
  expect(said.map((c) => c.args.basis)).toEqual(["r-result", "r-petition", "r-notice", "r-env", "r-budget", "r-law", "r-nomination", "r-complaint", "r-permit"]);
  // Each a public statement of kind news, put forward to be believed about the town, citing the record it reports.
  for (const c of said) expect(c).toMatchObject({ fn: "statement", args: { kind: "news", visible: "public", assertion: { that: c.args.text, about: ["city"] }, data: { edition: 1 } } });
  expect(said[1]!.args.text).toBe("Residents petition the town: Petition: cap rent rises.");
  expect(said[0]!.why).toBe("Edition 1: the 9 most newsworthy items of 9 new on the record.");
  // The default edition: the five weightiest.
  expect(edition(editor(), 8 * DAY, RECORDS).map((c) => c.args.basis)).toEqual(["r-result", "r-petition", "r-notice", "r-env", "r-budget"]);
});

test("tone is -1 for a petition, a complaint, and an environment report in which a species fell by 20% or more; 0 for the rest; and every item is about the government but an election's result and a nomination", () => {
  const items = itemsOf(edition(editor({ items_per_edition: 9 }), 8 * DAY, RECORDS));
  expect(Object.fromEntries(items.map((i) => [i.kind, i.tone]))).toEqual({ ballot_result: 0, petition: -1, election_notice: 0, environment_report: -1, budget: 0, law: 0, nomination: 0, complaint: -1, permit_decision: 0 });
  expect(items.filter((i) => !i.about_office).map((i) => i.kind)).toEqual(["ballot_result", "nomination"]);
  // A fall of 19.99% isn't one of 20%.
  const mild = statement("r-env2", T0, "environment_report", { text: "Trout are down a little.", data: { species: { trout: { change_bps: -1999 } } } });
  expect(itemsOf(edition(editor(), 8 * DAY, [mild]))).toEqual([{ of: "r-env2", kind: "environment_report", tone: 0, about_office: true, edition: 1 }]);
  // Every tone the paper gives is -1, 0 or 1 (what its readers move their approval by), whatever its leaning.
  for (const leaning_bps of [-10_000, -3000, 0, 3000, 10_000]) for (const i of itemsOf(edition(editor({ leaning_bps, items_per_edition: 9 }), 8 * DAY, RECORDS))) expect([-1, 0, 1]).toContain(i.tone);
});

test("an edition every every_days, of what's new since the last; none in a week with nothing new; what an edition passed over isn't run later", () => {
  const m = editor({ items_per_edition: 2, every_days: 7 });
  // (The first edition falls within the first week, on a day drawn for the paper: by day 8 it's due.)
  const first = edition(m, 8 * DAY, RECORDS);
  expect(first.map((c) => c.args.basis)).toEqual(["r-result", "r-petition"]);
  // Not again within the week, whatever comes in.
  const late = statement("r-late", 9 * DAY, "law", { text: "A late law." });
  expect(edition(m, 9 * DAY, [late])).toEqual([]);
  expect(edition(m, 14 * DAY, [])).toEqual([]);
  // A week on: only what's new since (the seven it passed over last week are old news), as edition 2.
  expect(itemsOf(edition(m, 15 * DAY, []))).toEqual([{ of: "r-late", kind: "law", tone: 0, about_office: true, edition: 2 }]);
  // A week with nothing new: no edition; the next one is edition 3.
  expect(edition(m, 22 * DAY, [])).toEqual([]);
  expect(itemsOf(edition(m, 29 * DAY, [statement("r-next", 25 * DAY, "budget", { text: "Next year's." })]))[0]).toMatchObject({ of: "r-next", edition: 3 });
});

test("the leaning weights what reflects on the government up or down, and decides the tone of what's a matter of judgement with a chance of half its strength", () => {
  // Wholly against the government: what reflects badly on it counts double (a complaint, weight 1, now runs level with
  // the weight-2 items), and about half of what was neutral is told against it.
  const against = itemsOf(edition(editor({ leaning_bps: -10_000, items_per_edition: 9 }), 8 * DAY, RECORDS));
  expect(against.slice(0, 2).map((i) => [i.kind, i.tone])).toContainEqual(["petition", -1]);
  for (const i of against) expect(i.tone).toBeLessThanOrEqual(0);
  // Wholly for it: what reflects badly on it counts for nothing and runs last; nothing is told against it but what is
  // against it in itself.
  const forIt = itemsOf(edition(editor({ leaning_bps: 10_000, items_per_edition: 9 }), 8 * DAY, RECORDS));
  expect(forIt.slice(-3).map((i) => i.kind).sort()).toEqual(["complaint", "environment_report", "petition"]);
  for (const i of forIt) expect(["petition", "complaint", "environment_report"].includes(i.kind) ? i.tone === -1 : i.tone >= 0).toBe(true);
  // The chance: over many papers wholly for the government, about half tell a budget well (200 papers: 80 to 120);
  // at a leaning of 30%, about 15% (10 to 50); with no leaning, none.
  const budget = [statement("r-b", T0, "budget", { text: "The budget." })];
  const told = (leaning_bps: number) => Array.from({ length: 200 }, (_, i) => itemsOf(edition(editor({ leaning_bps }, BigInt(i + 1)), 8 * DAY, budget))[0]!.tone).filter((t) => t === 1).length;
  expect(told(10_000)).toBeGreaterThan(80);
  expect(told(10_000)).toBeLessThan(120);
  expect(told(3000)).toBeGreaterThan(10);
  expect(told(3000)).toBeLessThan(50);
  expect(told(0)).toBe(0);
});
