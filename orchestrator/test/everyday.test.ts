// The everyday model's recorded situations and the teachers' gate (docs/design/ai-citizens.md 11). No model is called:
// the teachers here are mocks, one that reads the person and four each at fault in one way the gate must catch.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRICES } from "@oikos/participants/llm";
import type { Situation } from "@oikos/participants";
import { loadWorld } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { ask, baseLine, byClass, codeOdds, codeOddsFor, edited, optionsOf, readAnswer, scrambled, split, standing, tv, type Harvested } from "../src/everyday";
import { gate, requests, THRESHOLDS } from "../src/everyday-gate";
import { mockTeacher, type MockKind } from "../src/everyday-mock";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

/** A made situation: a rent rise or a home in disrepair, for a person of a given standing. */
function made(i: number): Harvested {
  const z = ((i * 7) % 11) / 5 - 1, zt = ((i * 5) % 9) / 4 - 1, years = (i * 3) % 17;
  const about = i % 3 === 0 ? "disrepair" : "rent_increase";
  const after = about === "disrepair" && i % 2 === 0;
  const t = 400 * DAY;
  const openings: Situation["openings"] = [
    { kind: "ask", by: "landlord", brings: [], bears: true, trust: { bps: Math.round(5000 + 1500 * zt), town_bps: 5000 }, others: i % 3, adj: 100 },
    { kind: "offer:lease", brings: ["occupancy", "money.from"], bears: true, others: 0, adj: 0 },
    { kind: "self", brings: ["money.from"], others: 0, adj: 50 },
    ...(after ? [{ kind: "desk", by: "courts", brings: [], bears: true, trust: { bps: Math.round(5200 - 1500 * zt), town_bps: 5200 }, others: 0, cost: 6000, adj: -900 }, { kind: "desk", by: "government", brings: [], bears: true, trust: { bps: 4000, town_bps: 4200 }, others: 1, adj: -700 }] : []),
  ];
  const kinds = [...new Set(openings.map((o) => o.kind))].sort();
  const share = 1 / (kinds.length + 1);
  return { id: `p${i % 2}/town.seed${1 + (i % 3)}/c${String(i).padStart(4, "0")}/1`, profile: `p${i % 2}`, run: `town.seed${1 + (i % 3)}`, t, participant: `c${String(i).padStart(4, "0")}`, choice: "wait",
    situation: { v: 1, want: { about, from: "event", weight: 3000 + 100 * (i % 20), days: after ? 40 : 0, tried: after ? 1 : 0, grown: 0, seeks: about === "disrepair" ? [] : ["money.from"], whom: "landlord", against: about },
      ...(about === "disrepair" ? { matter: { matter: "disrepair", days: after ? 40 : 0, venues: 0, ...(after ? { asked_days: 30, answer: "refused" } : {}) } } : {}),
      home: { rent: 150_000, ...(about === "rent_increase" ? { rent_to: 162_000, from_days: 60 } : {}) }, means: { income: 600_000 + 10_000 * i, savings: 300_000 * (i % 5), essentials: 200_000 }, openings,
      record: { values: { security: 6000 + 10 * i, benevolence: 5500, tradition: 5000, self_direction: 4000, power: 2500, hedonism: 3000 }, temperament: { openness: 5000, conformity: 5000, prestige: 4000 }, needs: { shelter: 6000, security: 4000 },
        agency: { now: Math.round(5000 + 2000 * z), own: 5000 }, trust: { people: 5000, in: [{ in: "tribunal", kind: "courts", bps: 5200 }, { in: "landlord-9", kind: "other", bps: 5000 }] },
        attached: years ? { place: { to: "town", bps: 5000, since: t - years * 365 * DAY } } : {}, views: [], ties: { close: [{ who: "c9999", affinity: 1200, trust: 5000 }], resented: [] }, beliefs: [], wants: [], memory: { recent: [{ what: "rent_rise", about: "landlord-9", t: t - 10 * DAY, size: 2000 }], defining: [] },
        circumstances: { household: 1 + (i % 4), housed: 1, working: i % 4 ? 1 : 0, retired: 0 } },
      outlook: { agency: { mean_bps: 5000, sd_bps: 2000 }, place_bps: 5000 }, code: { odds: [...kinds.map((key) => ({ key, ppm: Math.round(share * 1_000_000) })), { key: "wait", ppm: Math.round(share * 1_000_000) }] } } };
}
const ALL = [...Array(120).keys()].map(made);

test("options, the code mind's odds over them, and distance", () => {
  const h = made(0);
  expect(optionsOf(h.situation).map((o) => o.id)).toEqual(["ask:landlord", "desk:courts", "desk:government", "offer:lease", "self", "leave", "give_up"]);
  const c = codeOdds(h.situation);
  expect(Object.values(c).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  expect(c.give_up).toBe(0);
  expect(c["desk:government"]).toBeGreaterThan(0); // the likelier of the two desks has the kind's odds
  expect(c["desk:courts"]).toBe(0);
  expect(byClass(h.situation, c).act).toBeCloseTo(1 - c.leave!, 5);
  expect(tv({ a: 1, b: 0 }, { a: 0, b: 1 })).toBe(100);
  expect(tv(c, c)).toBe(0);
  expect(standing(0)).toBe("about the town's middle");
  expect(standing(-1.3)).toMatch(/lower than about 90 in 100/);
});

test("a scramble keeps the situation and takes the person; an edit changes one thing", () => {
  const a = made(0), d = made(7);
  const s = scrambled(a, d);
  expect(s.situation.want.about).toBe(a.situation.want.about);
  expect(s.situation.home).toEqual(a.situation.home);
  expect(s.situation.matter).toEqual(a.situation.matter);
  expect(s.situation.openings.map((o) => o.kind)).toEqual(a.situation.openings.map((o) => o.kind));
  expect((s.situation.record.agency as any).now).toBe((d.situation.record.agency as any).now);
  expect(s.situation.means).toEqual(d.situation.means);
  expect(s.situation.openings[0]!.trust).toEqual(d.situation.openings[0]!.trust); // their trust in their own landlord
  expect(s.situation.openings.find((o) => o.by === "courts")!.trust).toEqual({ bps: 5200, town_bps: 5200 }); // no such opening of theirs: their record's trust in that kind
  const lo = edited(a, "trust_venue", "low"), hi = edited(a, "trust_venue", "high");
  expect(lo.situation.openings.find((o) => o.by === "courts")!.trust!.bps).toBe(5200 - 1950);
  expect(hi.situation.openings.find((o) => o.by === "courts")!.trust!.bps).toBe(5200 + 1950);
  expect((lo.situation.record.trust as any).in.find((x: any) => x.kind === "courts").bps).toBe(5200 - 1950);
  expect(lo.situation.openings[0]).toEqual(a.situation.openings[0]!);
  expect((edited(a, "agency", "low").situation.record.agency as any).now).toBe(2400);
  expect(a.situation.openings.find((o) => o.by === "courts")!.trust!.bps).not.toBe(5200 - 1950); // the original is untouched
});

test("what a teacher is shown: an estimate asked of an analyst, never the first person, nobody named, nobody else's record", () => {
  for (const design of ["plain", "bearing"] as const) for (const wording of ["a", "b"] as const) {
    const h = made(6);
    const a = ask(h, { design, wording, order: [6, 5, 4, 3, 2, 1, 0], base: baseLine(h, ALL) });
    const all = `${a.system}\n${a.user}`;
    expect(all).not.toMatch(/\b(You are (this|the) person|as this person|I am|my landlord|my home)\b/i);
    expect(all).not.toMatch(/landlord-9|c9999|c0006|town\.seed/); // roles, never names; no other record
    expect(a.system).toMatch(/hundred/);
    expect(a.system).toMatch(/declin/i);
    expect(a.ids[0]).toBe("give_up");
    expect(a.labels).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    expect(design === "bearing" ? /base line/i.test(a.user) : !/base line/i.test(a.user)).toBe(true);
    expect(readAnswer({ declined: true }, a)).toEqual({ declined: true });
    const r = readAnswer({ declined: false, bearing: ["x"], counts: { c1: 10, c2: 40, c3: 10, c4: 10, c5: 10, c6: 10, c7: 10 } }, a) as { odds: { [id: string]: number } };
    expect(r.odds.leave).toBeCloseTo(0.4, 5);
    expect(readAnswer({ declined: false, counts: { c1: 10 } }, a)).toBeUndefined();
  }
});

test("the split holds back whole profiles and each other profile's last town, and samples one situation a person", () => {
  const s = split(ALL, { heldProfiles: ["p1"], dev: 12, held: 12 });
  expect(s.pool.held.every((h) => h.profile === "p1" || h.run === "town.seed3")).toBe(true);
  expect(s.pool.dev.every((h) => h.profile === "p0" && h.run !== "town.seed3")).toBe(true);
  expect(new Set(s.dev.map((h) => h.participant)).size).toBe(s.dev.length);
  expect(split(ALL, { heldProfiles: ["p1"], dev: 12, held: 12 }).held.map((h) => h.id)).toEqual(s.held.map((h) => h.id));
  expect(new Set(s.held.map((h) => h.situation.want.about)).size).toBe(2);
});

test("the gate passes a teacher that reads the person and catches each fault", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-everyday-"));
  try {
    const s = split(ALL, { heldProfiles: ["p1"], dev: 24, held: 24 });
    expect(requests({ sample: s.dev, pool: s.pool.dev, design: "bearing", edits: 12 }).filter((q) => q.variant === "base").length).toBe(24);
    const run = async (kind: MockKind) => (await gate({ sample: s.dev, pool: s.pool.dev, teachers: new Map([[kind, mockTeacher(kind)]]), design: "bearing", prices: PRICES, outDir: join(out, kind), edits: 12, jobs: 4 })).teachers[0]!;
    const reads = await run("reads");
    expect(reads.pass).toEqual({ unread: true, scrambled: true, edits: true, order: true, reworded: true, town: true });
    expect(reads.passed).toBe(true);
    const situation = await run("situation");
    expect(situation.pass.scrambled).toBe(false);
    expect(situation.pass.edits).toBe(false);
    expect((await run("first")).pass.order).toBe(false);
    expect((await run("wording")).pass.reworded).toBe(false);
    expect((await run("venues")).pass.town).toBe(false);
    // The closed scale (the "shift" design): the mock that reads the person still passes, the one that ignores them does not.
    const shift = async (kind: MockKind) => (await gate({ sample: s.dev, pool: s.pool.dev, teachers: new Map([[kind, mockTeacher(kind)]]), design: "shift", prices: PRICES, outDir: join(out, `shift-${kind}`), edits: 12, jobs: 4 })).teachers[0]!;
    expect((await shift("reads")).passed).toBe(true);
    expect((await shift("situation")).pass.scrambled).toBe(false);
    const a = ask(s.dev[0]!, { design: "shift", base: baseLine(s.dev[0]!, s.pool.dev) });
    expect(a.shiftFrom!.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5);
    const flat = readAnswer({ declined: false, bearing: [], shifts: Object.fromEntries(a.labels.map((l) => [l, 0])) }, a) as { odds: { [id: string]: number } };
    expect(a.ids.every((id, i) => Math.abs(flat.odds[id]! - a.shiftFrom![i]!) < 1e-9)).toBe(true); // nothing shifted: the base line itself
    expect(readAnswer({ declined: false, bearing: [], shifts: Object.fromEntries(a.labels.map((l) => [l, 4])) }, a)).toBeUndefined();
    // Asked again over the same folder, nothing is asked: every call is served from what was kept.
    const again = (await gate({ sample: s.dev, pool: s.pool.dev, teachers: new Map([["reads", mockTeacher("reads")]]), design: "bearing", prices: PRICES, outDir: join(out, "reads"), edits: 12 })).teachers[0]!;
    expect(again.calls.asked).toBe(0);
    expect(again.calls.served).toBeGreaterThan(100);
    expect(again.scrambled).toEqual(reads.scrambled);
    expect(THRESHOLDS.scrambled_points).toBe(8);
    // The code mind's own sway is reported beside: for the person a situation was recorded with it is its recorded odds.
    expect(tv(codeOddsFor(s.dev[0]!.situation, s.dev[0]!.situation), codeOdds(s.dev[0]!.situation))).toBeLessThan(0.001);
    expect(reads.code_mind.edits.agency!.right).toBe(reads.code_mind.edits.agency!.pairs);
    expect(reads.code_mind.edits.residence!.mean_points).toBe(0); // the code mind does not read how long someone has lived here
    // A class of option open in fewer situations than the stated minimum is not assessed in the town's totals.
    const few = (await gate({ sample: s.dev.slice(0, 6), pool: s.pool.dev, teachers: new Map([["venues", mockTeacher("venues")]]), design: "bearing", prices: PRICES, outDir: join(out, "few"), edits: 0 })).teachers[0]!;
    expect(Object.values(few.town).every((x) => !x.assessed)).toBe(true);
    expect(few.pass.town).toBe("not assessed");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a living town records the situation of each decision about a want, in a lean log, and is the same town for it", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-everyday-"));
  try {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
    for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
    const valid = ajv.getSchema("urn:oikos:contracts:0.8:dataset#/$defs/CitizenDecision")!;
    const world = async () => { const c = (await loadWorld(join(root, "worlds/town.yaml"), ["living.initiative_bps=10000", "living.founding=true"])).config; return { ...c, seed: 1, log: { ...c.log, detail: "lean" } }; };
    const on = await runWorld({ config: await world(), runId: "on", outDir: out, until: 45 * DAY, recordObservations: "none", recordDecisions: "want,found" });
    const off = await runWorld({ config: await world(), runId: "off", outDir: out, until: 45 * DAY, recordObservations: "none", recordDecisions: "none" });
    expect(on.stateHash).toBe(off.stateHash);
    await exportDataset(on.logPath, join(out, "on.dataset"));
    const rows = readFileSync(join(out, "on.dataset", "citizen_decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.length).toBeGreaterThan(5);
    for (const d of rows) {
      expect(d.domain).toBe("want");
      if (!valid(d)) throw new Error(JSON.stringify(valid.errors).slice(0, 600));
      const s: Situation = d.situation;
      expect(s.code.odds.reduce((a, o) => a + o.ppm, 0)).toBeGreaterThan(999_000);
      // Nobody named: whoever an opening is by is a role or a kind of institution.
      for (const o of s.openings) if (o.by !== undefined) expect(o.by).toMatch(/^(landlord|employer|other_side|courts|government|civil_service|unions|religious|companies|banks|press|policing|other)$/);
      expect(codeOdds(s).leave).toBeGreaterThan(0);
    }
    // (The person's record is theirs and kept by the kernel: a decision on the first day, before a first one is written, has an empty one.)
    expect(rows.filter((d) => Object.keys(d.situation.record).includes("values")).length).toBeGreaterThan(rows.length * 0.5);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 600_000);
