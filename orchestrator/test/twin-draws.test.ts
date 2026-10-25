// A pilot and its twin are the same town until something truly differs (docs/design/ai-citizens.md 10i; docs/reliability.md,
// "Draws and the order papers were filed in"). A record made in a run is numbered in the order every record of the
// town was made, so a seat that files one paper more moves the number of every later paper. Until 2026-10-12 a draw
// about a paper was keyed on that number: in the third living pilot a code landlord nobody had dealt with refused a
// repair that its twin granted, and twelve tenants unrepaired could not be told from chance. Here one town is run
// twice from one seed, the second time with the mayor's office in a mock seat (its brain is the mayor's own code, and
// its clerk files the office's books: papers of the town's own, of no effect on anyone). Every answer an organisation
// gave to a person's request to put something right, and every venue's decision, must be the same for the same
// request in both runs.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answers, DAY, root, run, town } from "./lib/twins";

// (The towns with a mock seat, and the year: twin-draws-seat.test.ts and twin-draws-year.test.ts, split out at the test pruning, 2026-10-24.)

for (const post of ["registry", "ombudsman-officer"]) test(`papers of no effect, filed by the ${post}, held by a system, change no answer and no decision anywhere in the town`, async () => {
  // (Restored to the registry, review of foundations finding 10. The office is a system's, as the registry was until foundations F5, so the
  // papers take no person's time: nothing moves. With a person in the post the same papers move the days of the offices that person holds:
  // the next test, traced.)
  // The office files two entries on the town's own file every day it has nothing else to do: several hundred
  // records the twin has none of, so that almost every later paper of the town has another number.
  const [twin, pilot] = await Promise.all([run("twin-draws-code", {}, undefined, post), run("twin-draws-scribe", {}, post, post)]);
  const extra = pilot.filter((r) => r.kind === "entry" && /^(Nothing to enter at|Nor here)/.test(r.text)).length;
  expect(extra).toBeGreaterThan(50);
  const idsOf = (rs: any[]) => rs.filter((r) => r.kind === "review_request").map((r) => r.id).join(",");
  expect(idsOf(pilot)).not.toBe(idsOf(twin));
  const a = answers(twin, new Set()), b = answers(pilot, new Set());
  console.log(`twin draws: ${extra} papers of no effect; ${a.size} requests and decisions in the twin, ${b.size} beside them`);
  expect(a.size).toBeGreaterThan(8);
  // The same requests, at the same hours, with the same answers: the whole of it, not a part.
  expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  // And the town beside them is the same town: every paper but the entries, in the same order, with the same words.
  const said = (rs: any[]) => rs.filter((r) => r.kind !== "entry").map((r) => `${r.at} ${r.kind} ${r.speaks_for} ${r.text.replace(/rec\.[0-9]+/g, "rec")}`);
  expect(said(pilot)).toEqual(said(twin));
}, 900_000);

test("papers of no effect, filed by the registry's holder, a person of the town, cost that person's time and nothing else: what moves starts with the offices the person holds", async () => {
  // (Traced, review of foundations finding 10. The registry's holder is a citizen who also holds planning, inspection, finance, works and
  // the environment office. Each day the two entries take that person's time (one account for a person, foundations F1), so the
  // papers of those offices that day come later, by no more than the entries' time; what depends on them moves with them. It is not the
  // papers' numbers: the same registry held by a system moves nothing (the test before). Seen in the town of 120 days: the first paper to
  // move is the city's permit decision at 92400, 300 s late, from the entries begun at 86400.)
  const [twin, pilot] = await Promise.all([town("twin-draws-person-code", {}), town("twin-draws-person-scribe", {}, "registry")]);
  const holder = twin.holders.registry!;
  expect(holder).toMatch(/^c\d+-self$/);
  expect(Object.values(twin.holders).filter((h) => h === holder).length).toBeGreaterThan(2);
  const key = (rs: any[]) => { const n = new Map<string, number>(); return rs.filter((r) => r.kind !== "entry").map((r) => { const k = `${r.kind}|${r.speaks_for}|${r.text.replace(/rec\.[0-9]+/g, "rec")}`; n.set(k, (n.get(k) ?? 0) + 1); return [`${k}#${n.get(k)}`, r.at] as [string, number]; }); };
  const A = new Map(key(twin.records)), B = new Map(key(pilot.records));
  const entries = pilot.records.filter((r) => r.kind === "entry" && /^(Nothing to enter at|Nor here)/.test(r.text)).sort((x, y) => x.at - y.at);
  expect(entries.length).toBeGreaterThan(50);
  const begun = Number(/at (\d+)\./.exec(entries[0].text)![1]);
  const takes = entries[0].at - begun;
  const moved = [...A].filter(([k, t]) => B.has(k) && B.get(k) !== t).sort((x, y) => x[1] - y[1]);
  console.log(`twin draws, a person at the registry: ${moved.length} of ${A.size} papers moved; the first at ${moved[0]?.[1]} by ${B.get(moved[0]![0])! - moved[0]![1]}s; the entries take ${takes}s from ${begun}`);
  expect(moved.length).toBeGreaterThan(0);
  // Nothing moves before the first entries were begun; the first paper to move is an office of the holder's, late by no more than the entries took.
  expect(moved[0]![1]).toBeGreaterThanOrEqual(begun);
  const shift = B.get(moved[0]![0])! - moved[0]![1];
  expect(shift).toBeGreaterThan(0);
  expect(shift).toBeLessThanOrEqual(takes);
  expect(moved[0]![0].split("|")[1]).toBe("city");
  // How far the difference spreads is measured, not bounded (the owner's ruling, 2026-10-19; docs/risks.md MT-17;
  // docs/decisions.md, "The cut-over"): what follows from a holder's time spent is the town's sensitivity, a property
  // of the world (first-look hiring, a refusal remembered from when it is read, the last of a shop's stock), not a
  // fault. Until then the words were bounded at 2% and the timing at 10%, figures calibrated on the TS world, which
  // damped it. The strict twin tests (the same decisions, the same world: twin-seat-year, the cases above) stay exact.
  const words = [...A.keys()].filter((k) => !B.has(k)).length;
  console.log(`MT-17's measure, a person at the registry: ${words} of ${A.size} papers in other words (${(100 * words / A.size).toFixed(1)}%), ${moved.length} at another second (${(100 * moved.length / A.size).toFixed(1)}%), ${B.size - A.size} more papers with the entries`);
}, 900_000);

test("no module names a draw for a moment", () => {
  // A purpose with the time in it (`shop-${t}`) is a draw that falls differently in two towns that woke at other hours.
  // What is still TypeScript (the kinds' declarations, helpers and readers) and the engine's actors, in Rust: `cx.rng(&format!("shop-{t}"))`.
  const found: string[] = [];
  for (const d of ["participants/src/kinds", "participants/src/shared", "participants/src/readers"]) for (const f of new Bun.Glob("*.ts").scanSync(join(root, d))) {
    readFileSync(join(root, d, f), "utf8").split("\n").forEach((l, i) => { if (/\brng\(`[^`]*\$\{(t|obs\.t|now|at)\}/.test(l)) found.push(`${d}/${f}:${i + 1}`); });
  }
  const RUST_TIMED = /\b(?:rng|chance)\(\s*&?(?:format!\(\s*)?"[^"]*\{(?:t|now|at|self\.t|cx\.t)(?::[^}]*)?\}/;
  const actors = join(root, "kernel/crates/actors/src");
  for (const f of new Bun.Glob("**/*.rs").scanSync(actors)) {
    readFileSync(join(actors, f), "utf8").split("\n").forEach((l, i) => { if (RUST_TIMED.test(l)) found.push(`kernel/crates/actors/src/${f}:${i + 1}`); });
  }
  expect(found).toEqual([]);
  // (The Rust reader does catch one.)
  expect(RUST_TIMED.test('let r = cx.rng(&format!("shop-{t}"));')).toBe(true);
});

// Bug hunt 2026-10-17, finding 14: a draw about a lease (or any paper) is never keyed on the paper's number in the world's
// file, whether it is drawn on the participant's stream or on the run's stream for one thing (`ctx.chance`).
// (TS world only: the draw trace (`drawTrace`) is the TS loop's. On the Rust world the keys are `actors/src/draws.rs`'s, and its
// own unit tests hold the same rule: a record's number is never in a key, `paper#n` is.)
// (The TS world's draw names, read from its run streams: deleted with the TS actors at the cut-over, 2026-10-19. The engine's draws are
// keyed on stable identities by construction and held so by kernel/tests/determinism_lint.rs.)
