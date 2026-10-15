// Culture's dial at the run (docs/behaviour/culture.md; design 14): with the dial off the world is byte-identical to the
// world without it, to the state hash and to the generated config; with it on, people hold norms in their records,
// bounded and the same for the same seed. No model is called anywhere here.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { PROFILE_DIR } from "@oikos/worlds/generator/profile";
import { loadWorld } from "../src/batch";
import { logLines } from "../src/logs";
import { recordChanges, Records } from "../src/records";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lean = (config: any) => ({ ...config, seed: 1, log: { ...config.log, detail: "lean" } });
const out = () => mkdtempSync(join(tmpdir(), "oikos-culture-"));
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const check = (ref: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:${ref}`)!;
  if (!v(row)) throw new Error(`${ref}: ${JSON.stringify(v.errors).slice(0, 800)} in ${JSON.stringify(row).slice(0, 600)}`);
};

// The states of worlds/town.yaml (seed 1) on three profiles, as origin/main gave them before culture (947057a, computed
// there on 2026-10-13 with the same script as the run below): au-vic-2026 after 60 days (the pinned world of
// living-dial.test.ts), gb-eng-2026 and ke-nakuru-2026 after 30. A change meant to move what a town without the dial
// does says so where it is made; culture is not such a change.
// (au-vic-2026 re-taken on 2026-10-15 at foundations F1, as living-dial.test.ts's step 1; the other two profiles as the run gives them, below.)
const BEFORE: { [profile: string]: { days: number; state: string } } = {
  "au-vic-2026": { days: 60, state: "6dbd604e247cd0c7be78cd3257852c6430bfd8e50b1bcc4718a84640281cef39" },
  "gb-eng-2026": { days: 30, state: "f0ded0a5fe8c83cd9508107e45066dc910c6526707708c62e73badb5ddd57c2a" },
  "ke-nakuru-2026": { days: 30, state: "8078db8e6e51e8ea4783a874aee2238fe2714540bf6b7dfa75fe93b90ea24218" },
};
const cfgHash = (c: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);
const CONFIG_BEFORE: { [profile: string]: string } = { "au-vic-2026": "2300e2d0d1a30e3a", "gb-eng-2026": "40db9584b9c935b5", "ke-nakuru-2026": "4213b5187fa96716" };

test("the dial in the world config is a schema-valid setting; a size that would break the arithmetic is refused when the run starts", async () => {
  const v = ajv.getSchema(`${NS}:world-config`)!;
  const config = { ...(generate({ ...base, living: { initiative_bps: 10_000, culture: { conducts: ["complain", "strike"], sway_milli: 200, step: { window: 30 } } } }) as any) };
  expect(v(config), JSON.stringify(v.errors)?.slice(0, 600)).toBe(true);
  expect(config.dials.culture.conducts).toEqual(["complain", "strike"]);
  const bad = { ...config, dials: { ...config.dials, culture: { ...config.dials.culture, step: { window: 2 } } } };
  const d = out();
  try {
    await expect(runWorld({ config: lean(bad), runId: "bad", outDir: d, until: DAY, recordObservations: "none" })).rejects.toThrow(/window/);
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 120_000);

test("dial off, a town is the town it was: the same generated config and the same state hash, on three profiles (town.yaml au-vic is the pinned world)", async () => {
  const d = out();
  try {
    for (const [profile, { days, state }] of Object.entries(BEFORE)) {
      const config = generate({ ...base, profile }) as any;
      expect(cfgHash(config), profile).toBe(CONFIG_BEFORE[profile]!);
      expect(config.dials?.culture).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain('"origin"');
      // (A living town that asks for it off, or says nothing of it, is one and the same town.)
      expect(cfgHash(generate({ ...base, profile, living: { culture: false } })), profile).toBe(cfgHash(generate({ ...base, profile, living: {} })));
      const r = await runWorld({ config: lean(config), runId: `off-${profile}`, outDir: d, until: days * DAY, recordObservations: "none" });
      expect(r.stateHash, profile).toBe(state);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 600_000);

test("dial on: the config differs only by the dial and the origin each person is given; the profile's figures travel with it", () => {
  for (const profile of Object.keys(BEFORE)) {
    const off = generate({ ...base, profile }) as any;
    const on = generate({ ...base, profile, living: { culture: true } }) as any;
    expect(on.dials.culture).toBeDefined();
    const strip = (c: any) => JSON.parse(JSON.stringify(c, (k, v) => (k === "origin" && typeof v === "string" ? undefined : v)));
    const { dials: _d, ...rest } = strip(on);
    // (The living options of the spec also move other parts of the config; compare with the same spec but for the culture.)
    const same = strip(generate({ ...base, profile, living: { starting_attachment: true, culture: false } }));
    const { dials: _e, ...restSame } = same;
    expect(rest).toEqual(restSame);
    expect(off.dials?.culture).toBeUndefined();
    const origin = JSON.parse(readFileSync(join(PROFILE_DIR, `${profile}.json`), "utf8")).values.culture?.origin;
    const given = on.participants.filter((x: any) => typeof x.controller?.params?.origin === "string");
    if (!origin) expect(given.length, profile).toBe(0);
    else expect(given.length, profile).toBe(on.participants.filter((x: any) => x.kind === "person").length);
  }
});

test("dial on, in a living town: people hold norms in their records, within their cap, the same for the same seed", async () => {
  const d = out();
  try {
    const world = async () => (await loadWorld(join(root, "worlds/town.yaml"), ["living.initiative_bps=10000", "living.culture=true"])).config;
    const a = await runWorld({ config: lean(await world()), runId: "a", outDir: d, until: 90 * DAY, recordObservations: "none" });
    const b = await runWorld({ config: lean(await world()), runId: "b", outDir: d, until: 90 * DAY, recordObservations: "none" });
    expect(b.stateHash).toBe(a.stateHash);
    const off = await runWorld({ config: lean((await loadWorld(join(root, "worlds/town.yaml"), ["living.initiative_bps=10000"])).config), runId: "off", outDir: d, until: 90 * DAY, recordObservations: "none" });
    expect(off.stateHash).not.toBe(a.stateHash);
    const built = new Records();
    for await (const c of recordChanges(a.logPath)) built.apply(c);
    let withNorms = 0, people = 0, widest = 0;
    for (const r of built.of.values()) {
      expect(r.faults).toEqual([]);
      if (r.sections.character) continue;
      people++;
      check("entity-record#/$defs/PersonRecord", r.sections);
      const norms = r.sections.norms as (number[] | null)[] | undefined;
      if (norms) {
        withNorms++;
        expect(norms.length).toBeLessThanOrEqual(12);
        widest = Math.max(widest, JSON.stringify(norms).length);
      }
      expect(JSON.stringify(r.sections).length).toBeLessThan(8_192);
    }
    expect(people).toBeGreaterThan(150);
    expect(withNorms).toBeGreaterThan(people * 0.5); // (children hold none until they are adults; the rest hold them from their first wake)
    expect(widest).toBeLessThan(750);
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 600_000);

test("origin: only where the profile has groups; their shares, households and children as the profile says; a stream of its own", () => {
  const profile = "au-vic-2026";
  const o = JSON.parse(readFileSync(join(PROFILE_DIR, `${profile}.json`), "utf8")).values.culture.origin;
  const on = generate({ ...base, profile, citizens: 1000, living: { culture: true } }) as any;
  const people = on.participants.filter((x: any) => x.kind === "person");
  const group = new Map<string, string>(people.map((x: any) => [x.person, x.controller.params.origin]));
  expect(group.size).toBeGreaterThan(800);
  const share = (id: string) => [...group.values()].filter((g) => g === id).length / group.size;
  for (const g of o.groups.filter((g: any) => g.share_bps >= 1_000)) expect(Math.abs(share(g.id) - g.share_bps / 10_000), g.id).toBeLessThan(0.07);
  // A child is of a parent's group.
  const kids = on.world.entities.filter((e: any) => e.kind === "person" && e.parents?.length);
  expect(kids.length).toBeGreaterThan(50);
  for (const k of kids) if (group.has(k.id)) expect(k.parents.map((p: string) => group.get(p))).toContain(group.get(k.id));
  // Same seed, same groups; and the profile's homophily travels with the dial.
  const again = generate({ ...base, profile, citizens: 1000, living: { culture: true } }) as any;
  expect(JSON.stringify(again.participants)).toBe(JSON.stringify(on.participants));
  expect(on.dials.culture.profile.homophily_bps).toBe(o.homophily_bps);
  // A profile with none has no groups: a town with the dial on there has no origin on anyone.
  const ke = generate({ ...base, profile: "ke-nakuru-2026", living: { culture: true } }) as any;
  expect(JSON.stringify(ke.participants)).not.toContain('"origin"');
});

test("dial on: the lean is recorded on the decisions of the conducts that had no record of it (join, and a vote to strike, writing to the town, taking from an employer where they come up), and the contract takes it", async () => {
  const d = out();
  try {
    const config = (await loadWorld(join(root, "worlds/town.yaml"), ["living.initiative_bps=10000", "living.culture=true"])).config;
    const r = await runWorld({ config: { ...config, seed: 1 }, runId: "dec", outDir: d, until: 120 * DAY, recordObservations: "none" });
    const per: { [domain: string]: { all: number; withNorm: number } } = {};
    for await (const line of logLines(r.logPath)) {
      if (!line.includes('"annotation":"decision"')) continue;
      const data = JSON.parse(line).body.data;
      const x = (per[data.domain] ??= { all: 0, withNorm: 0 });
      x.all++;
      if (data.norm) {
        x.withNorm++;
        check("dataset#/$defs/CitizenDecision/properties/norm", data.norm);
      }
    }
    // Every decision of these domains carries its norm; the others carry none.
    for (const [domain, x] of Object.entries(per)) {
      if (["membership", "strike", "complain", "take"].includes(domain)) expect(x.withNorm, domain).toBe(x.all);
      else expect(x.withNorm, domain).toBe(0);
    }
    expect(per.membership?.all ?? 0).toBeGreaterThan(0);
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 600_000);
