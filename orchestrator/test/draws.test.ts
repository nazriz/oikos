// The host's stream names (orchestrator/src/draws.ts) keep a pilot and its twin drawing alike: by which paper, never
// its number; by the day and which time that day, never the hour (docs/reliability.md). The same rules as the engine's
// (kernel/crates/actors/src/draws.rs, whose unit tests hold its side).

import { expect, test } from "bun:test";
import { Draws } from "../src/draws";

const DAY = 86_400;

test("a paper is named for which paper it is to the drawer, so one more paper in the town moves no draw", () => {
  // The pilot's town filed one more paper than its twin's before these: every number is one higher.
  const pilot = new Draws(), twin = new Draws();
  const keys = (d: Draws, shift: number) => [977, 12, 977, 4000].map((n, i) => d.key("p1", "pos", d.stable("p1/pos", `answer-rec.${n + shift}`), 9 * 3600 + i));
  expect(keys(pilot, 1)).toEqual(keys(twin, 0));
  const d = new Draws();
  expect(d.stable("p1/pos", "answer-rec.977")).toBe("answer-paper#1");
  expect(d.stable("p1/pos", "answer-rec.12")).toBe("answer-paper#2");
  expect(d.stable("p1/pos", "answer-rec.977")).toBe("answer-paper#1");
  // (Counted for each drawer and purpose apart: another's first paper is its own paper#1.)
  expect(d.stable("p2/self", "answer-rec.12")).toBe("answer-paper#1");
  expect(d.stable("p1/pos", "shop")).toBe("shop");
});

test("a draw is the day's and which time that day, never the hour: woken at other hours, the twin draws alike", () => {
  const pilot = new Draws(), twin = new Draws();
  // Two wakes on day 3: at 9 and 15 in the pilot, at 11 and 16 in the twin.
  const a = [pilot.key("p1", "self", "shop", 3 * DAY + 9 * 3600), pilot.key("p1", "self", "shop", 3 * DAY + 15 * 3600)];
  const b = [twin.key("p1", "self", "shop", 3 * DAY + 11 * 3600), twin.key("p1", "self", "shop", 3 * DAY + 16 * 3600)];
  expect(a).toEqual(b);
  expect(a[0]).toEqual(["participant", "p1", "self", "3", "shop", "1"]);
  expect(a[1]![5]).toBe("2");
  // The same moment is the same occurrence; a new day starts the count again.
  const d = new Draws();
  expect(d.key("p1", "self", "shop", 100)[5]).toBe("1");
  expect(d.key("p1", "self", "shop", 100)[5]).toBe("1");
  expect(d.key("p1", "self", "shop", 200)[5]).toBe("2");
  expect(d.key("p1", "self", "shop", DAY + 5)).toEqual(["participant", "p1", "self", "1", "shop", "1"]);
  // A draw that names its matter is that matter's, whatever the day: no day in its name, its own count.
  expect(d.key("p1", "self", "lease-12345", 5 * DAY)).toEqual(["participant", "p1", "self", "", "lease-12345", "1"]);
  expect(d.key("p1", "self", "answer-paper#1", 9 * DAY)).toEqual(["participant", "p1", "self", "", "answer-paper#1", "1"]);
});
