// An organisation's practice (docs/behaviour/culture.md, "An office's practice"; design 14g as ruled on 2026-10-13): how
// an office has carried on, kept in its own record, outliving whoever holds it; it pulls a code holder's answers toward
// its own habit and is never handed to a seat as counts. Held on arithmetic and hand-made offices; no model.

import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CULTURE_DEFAULTS } from "../src/shared/culture";
import { Org } from "../src/shared/orgwants";
import { Practice } from "../src/shared/practice";
import { Randomness } from "../src/rng";

const DAY = 86_400;
const P = { practice_window_days: 1_825, practice_min_occasions: 5, practice_inertia_bps: 5_000, practice_opening: 100 };
const world = (on: boolean) => ({ dials: { initiative_bps: 10_000, ...(on ? { culture: {} } : {}) } });
const rng = () => new Randomness(7n).stream("practice");
const KIND = Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, ["benevolence", "conformity", "universalism"].includes(v) ? 8_000 : 2_000]));
const mk = (on: boolean, given: object = {}) => new Org({ rng: () => rng(), world: world(on) } as any, { initiative: true, owner_values: KIND, ...given });

test("an office opens with a past at the rate its character gives, so at the opening nothing moves", () => {
  const org = mk(true);
  const rows = org.practice!.section();
  expect(rows.map((r) => r.of)).toEqual(["hold", "rise", "stay"]);
  for (const r of rows) expect(r.occasions).toBe(P.practice_opening);
  // The habit equals the baseline, so the rate drawn from is the rate it would be without a practice.
  const off = mk(false);
  for (const worth of [-1, 0, 0.5]) for (const k of ["hold", "rise", "stay"] as const)
    expect(Math.abs(org.grants(k, rng(), worth, 0).chance - off.grants(k, rng(), worth, 0).chance)).toBeLessThanOrEqual(30) // (the rounding of a whole number of occasions);
});

test("with the dial off an organisation has no practice and answers as it did", () => {
  const org = mk(false);
  expect(org.practice).toBeUndefined();
  expect(org.change()?.set.practice).toBeUndefined();
});

test("a habit forms from what an office does, outlasts a window of years, and pulls the rate toward itself by inertia only", () => {
  const p = new Practice(CULTURE_DEFAULTS, []);
  expect(p.rate("hold")).toBeUndefined(); // (fewer than the minimum occasions is not yet a habit)
  for (let i = 0; i < 20; i++) p.observe("hold", i * DAY, i % 4 !== 0); // 15 of 20
  expect(p.rate("hold")).toBe(7_500);
  // With the character's own rate at 3,000 and the habit at 7,500, half the gap (inertia 5,000): 3,000 + 2,250.
  expect(p.pulled("hold", 3_000, 3_000)).toBe(5_250);
  // A habit equal to the baseline moves nothing.
  expect(p.pulled("hold", 3_000, 7_500)).toBe(3_000);
  // The count rolls: after the window the older half is let go, never to nothing.
  const before = p.section()[0]!;
  p.observe("hold", 2_000 * DAY, true);
  const after = p.section()[0]!;
  expect(after.occasions).toBeLessThan(before.occasions);
  expect(after.occasions).toBeGreaterThanOrEqual(1);
  expect(after.did).toBeLessThanOrEqual(after.occasions);
});

test("a habit moves a code holder's answers: an office that has always said yes says it more than one that has always said no", () => {
  const yes = mk(true), no = mk(true);
  for (let i = 0; i < 60; i++) { yes.practice!.observe("stay", i * DAY, true); no.practice!.observe("stay", i * DAY, false); }
  expect(yes.grants("stay", rng(), 0, 70 * DAY).chance).toBeGreaterThan(no.grants("stay", rng(), 0, 70 * DAY).chance);
});

test("practice persists across holders: it is in the record, and a new holder given the record carries on from it", () => {
  const first = mk(true);
  for (let i = 0; i < 40; i++) first.practice!.observe("rise", i * DAY, i % 2 === 0);
  const written = first.change()!.set.practice as any[];
  expect(written.find((r) => r.of === "rise").occasions).toBe(CULTURE_DEFAULTS.practice_opening + 40);
  const next = mk(true, { practice: written });
  expect(next.practice!.section()).toEqual(written);
});

test("the section is bounded: at most six rows and under 500 bytes however long the office runs", () => {
  const org = mk(true);
  for (let i = 0; i < 5_000; i++) for (const k of ["hold", "rise", "stay"] as const) org.practice!.observe(k, i * DAY, i % 3 === 0);
  const rows = org.practice!.section();
  expect(rows.length).toBeLessThanOrEqual(6);
  expect(JSON.stringify(rows).length).toBeLessThan(500);
});

test("a seat is not handed the practice: no part of what a seat is shown reads it", () => {
  // (The owner's ruling of 2026-10-13: a seat looks through its office's own papers. Nothing under llm/ nor the books' readers reads it.)
  const dir = join(import.meta.dir, "../src");
  const files = [...readdirSync(join(dir, "llm")).map((f) => join(dir, "llm", f)), ...readdirSync(join(dir, "readers")).map((f) => join(dir, "readers", f))];
  for (const f of files.filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(f, "utf8");
    expect(text.includes("shared/practice") || text.includes('"./practice"')).toBe(false);
    expect(/\bPractice\b/.test(text.replace(/the practice|a practice|practice of|its practice|practice\)/gi, ""))).toBe(false);
  }
});
