import { expect, test } from "bun:test";
import { drawPerson, VALUES } from "../src/shared/mind";
import { Randomness } from "../src/rng";

const rng = (k: string) => new Randomness(7n).stream([k]);
const pop = { values: { security: { mean_bps: 7000, sd_bps: 1000 }, stimulation: { mean_bps: 3000, sd_bps: 1000 } } };

test("a person is drawn deterministically from the world's figures; values set temperament and how much needs weigh", () => {
  const a = drawPerson(rng("p1"), pop);
  expect(drawPerson(rng("p1"), pop)).toEqual(a); // the same stream, the same person
  expect(drawPerson(rng("p2"), pop)).not.toEqual(a); // people differ
  for (const v of VALUES) expect(a.values[v]).toBeGreaterThanOrEqual(0);
  // Over many people: security valued on average near its mean, and weighing the security need more than subsistence.
  const people = Array.from({ length: 400 }, (_, i) => drawPerson(rng(`p${i}`), pop));
  const mean = (f: (p: (typeof people)[number]) => number) => people.reduce((s, p) => s + f(p), 0) / people.length;
  expect(Math.abs(mean((p) => p.values.security) - 7000)).toBeLessThan(250);
  expect(mean((p) => p.weights.security)).toBeGreaterThan(mean((p) => p.weights.subsistence));
  // Openness follows stimulation and self-direction: those valuing stimulation less are less open.
  expect(mean((p) => p.temperament.openness)).toBeLessThan(5000);
});







