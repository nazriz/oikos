// Quiet seats that keep office hours beside their people, over 200 days, are the town without them act for act (the head of
// twin-seat-year.test.ts says why). (Split out of twin-seat-year.test.ts at the test pruning, 2026-10-24.)

import { expect, test } from "bun:test";
import { stream, town } from "./lib/seat-twins";

test("quiet seats that keep office hours move nothing of the town beside them: every act of 200 days is the same, to the second", async () => {
  // (The review's finding 10 (b): a quiet live seat alone shifted a shop worker's act by 300 s from day 172. A letter or a paper reached
  // a person at the first moment the engine had a wake after it, and a seat's sittings are other moments than its twin's.)
  const seats = ["councillor-4", "land-registrar"];
  const [twin, pilot] = await Promise.all([town("twin-quiet-code", [], { days: 200, deaths: 0 }), town("twin-quiet-mock", seats, { days: 200, deaths: 0 })]);
  const a = stream(twin, seats), b = stream(pilot, seats);
  expect(a.acts.length).toBeGreaterThan(30_000);
  expect(b.acts).toEqual(a.acts);
}, 1_800_000);
