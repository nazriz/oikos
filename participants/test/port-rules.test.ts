// The shared cases the Rust port of the tax and support rules is held to (contracts/test/withholding.json and
// support.json; scripts/port-withholding-cases.ts and port-support-cases.ts) still give the TS answers while the TS
// stands: the cases cannot drift from the module they were taken from.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chargesOn, taxLawOf, withheld } from "../src/shared/tax";
import { declarationFor, stopsWorkAt } from "../src/shared/payments";

const read = (f: string) => JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/test", f), "utf8"));

test("withholding.json: what the TS withheld and each charge took on a year's pay", () => {
  const cases = read("withholding.json").cases as { name: string; law: unknown; pays: { gross: number; period: number; total: number; parts: [string, number][] }[]; annual: { pay: number; charges: [string, number][] }[] }[];
  expect(cases.length).toBeGreaterThanOrEqual(10);
  for (const c of cases) {
    const law = taxLawOf("l", c.law, "outside")!;
    for (const p of c.pays) {
      const w = withheld(law, p.gross, p.period);
      expect({ name: c.name, total: w.total, parts: w.parts.map((x) => [x.charge.id, x.amount]) }).toEqual({ name: c.name, total: p.total, parts: p.parts });
    }
    for (const a of c.annual) expect(chargesOn(law, a.pay).map((x) => [x.charge.id, x.amount])).toEqual(a.charges);
  }
});

test("support.json: declarations and the age people stop work at", () => {
  const f = read("support.json");
  for (const d of f.declarations) expect(declarationFor(d.rule, d.facts) ?? null).toEqual(d.declares);
  for (const s of f.stops_work) for (const [draw, age] of s.draws) expect(stopsWorkAt(s.curve, draw) ?? null).toBe(age);
});
