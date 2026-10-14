// scripts/forms-inventory.ts: the forms each office's seat is shown, by profile, in three line-ups (alone, the pilots',
// all), grouped by role, with the forms new since a model's training. The token counts need the model's tokenizer
// (translator/model/py/count_tokens.py) and are given here by a stand-in; the lists are the generator's own.
import { expect, test } from "bun:test";
import { ALLOWANCE, grouped, MODES, PILOT_LINEUP, report, seatsOf, townOf, type ProfileInventory, type SeatRow } from "../../scripts/forms-inventory";

const town = townOf("au-vic-2026", 300);
const stub = (lines: string[]) => lines.join("\n").length; // (a count that grows with the list: a stand-in for the tokenizer)

test("a seat is shown the published forms and the stationery of its organisation's seated offices: alone, the fewest; all, the most", () => {
  const seats = seatsOf(town, PILOT_LINEUP);
  expect(seats.length).toBeGreaterThan(50);
  const by = new Map(seats.map((s) => [s.seat, s]));
  const landlord = by.get("landlord-1-office")!, mayor = by.get("mayor")!, finance = by.get("finance")!;
  for (const s of seats) {
    expect(s.names.alone.length).toBeLessThanOrEqual(s.names.lineup.length);
    expect(s.names.lineup.length).toBeLessThanOrEqual(s.names.all.length);
    // The published forms are in every list; the rest are its organisation's.
    expect(s.names.alone.length - s.own.alone).toBe(s.names.all.length - s.own.all);
  }
  // The mayor and the finance office share their town: seated in a line-up together, each is shown the other's papers.
  expect(mayor.own.alone).toBeLessThan(mayor.own.lineup);
  expect(finance.names.lineup).toContain("withholding_return");
  expect(mayor.names.all.length).toBeGreaterThan(30);
  // A landlord is an organisation of its own: the others seated change nothing for it.
  expect(landlord.names.alone).toEqual(landlord.names.all);
  expect(landlord.names.alone.length).toBeGreaterThanOrEqual(25);
  // The lines are the forms as the translator is shown them.
  expect(landlord.lines.alone[0]).toMatch(/^- [a-z_]+, to=\S+, id form-\S+: fields /);
});

test("seats of one role with the same forms are one entry, with the most tokens of them and the fewest; new forms are those not in the training", () => {
  const rows: SeatRow[] = seatsOf(town, PILOT_LINEUP).map((s) => ({ ...s, tokens: Object.fromEntries(MODES.map((m) => [m, stub(s.lines[m])])) as SeatRow["tokens"] }));
  const trained = new Set<string>(rows.flatMap((r) => r.names.all).filter((n) => n !== "rent_reminder" && n !== "withholding_return"));
  const groups = grouped(rows, trained);
  expect(groups.length).toBeLessThan(rows.length);
  expect(groups.reduce((n, g) => n + g.seats.length, 0)).toBe(rows.length);
  const landlords = groups.find((g) => g.role === "firm.landlord")!;
  expect(landlords.seats.length).toBeGreaterThan(5);
  expect(landlords.tokens.alone).toBeGreaterThanOrEqual(landlords.least.alone);
  expect(landlords.new_since_training).toContain("rent_reminder");
  expect(groups.find((g) => g.role === "city.finance_officer")!.new_since_training).toContain("withholding_return");
  // Longest first, by the most.
  expect(groups.map((g) => g.tokens.all)).toEqual([...groups.map((g) => g.tokens.all)].sort((a, b) => b - a));
});

test("the report names the seats over each limit in each line-up, and those within the allowance of it", () => {
  const g = (seats: string[], tokens: number): ProfileInventory["groups"][number] => ({ role: "r", seats, forms: { alone: 5, lineup: 5, all: 5 }, own: { alone: 1, lineup: 1, all: 1 }, tokens: { alone: tokens, lineup: tokens, all: tokens + 700 }, least: { alone: tokens, lineup: tokens, all: tokens + 700 }, new_since_training: [] });
  const text = report([{ profile: "p-1", offices: 3, lineup: ["a"], groups: [g(["long"], 1500), g(["near"], 1024 - ALLOWANCE + 10), g(["short"], 400)] }]);
  const section = (lim: number, mode: string) => text.split(`## Lists over ${lim}`)[1]!.split(`### ${mode}`)[1]!.split("\n")[1]!;
  expect(section(1024, "alone")).toContain("OVER: long (5 forms, 1500)");
  expect(section(1024, "alone")).toContain("TIGHT: near");
  expect(section(1024, "alone")).not.toContain("short");
  expect(section(2048, "alone")).toBe("p-1: none over");
  expect(section(1024, "all")).toContain("near");
  expect(section(2048, "all")).toContain("OVER: long (5 forms, 2200)");
});
