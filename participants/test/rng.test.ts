import { expect, test } from "bun:test";
import { Randomness, Rng } from "../src/rng";

test("matches the kernel's known-answer vector (kernel/src/rng.rs)", () => {
  const r = new Randomness(20260925n).stream(["test", "kat"]);
  expect([r.nextU64(), r.nextU64(), r.nextU64(), r.nextU64()]).toEqual([
    15178468991547006131n, 8141242282609027689n, 16522627103700839329n, 11871191864566068065n,
  ]);
});

test("matches reference xoshiro256** for state {1,2,3,4}", () => {
  const r = new Rng([1n, 2n, 3n, 4n]);
  expect([r.nextU64(), r.nextU64(), r.nextU64()]).toEqual([11520n, 0n, 1509978240n]);
});

test("keyed streams are independent, reproducible and length-prefixed", () => {
  const g = new Randomness(7n);
  const draw = (k: string[]) => { const r = g.stream(k); return [r.nextU64(), r.nextU64()]; };
  expect(draw(["a"])).toEqual(draw(["a"]));
  expect(draw(["a"])).not.toEqual(draw(["b"]));
  expect(draw(["ab", "c"])).not.toEqual(draw(["a", "bc"]));
});

test("below() is in range and roughly uniform", () => {
  const r = new Randomness(1n).stream(["uniform"]);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60_000; i++) counts[r.below(6)]!++;
  for (const c of counts) expect(c > 9000 && c < 11000).toBe(true);
});
