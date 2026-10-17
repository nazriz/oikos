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
// (au-vic-2026 re-taken again at foundations F3, gb-eng and ke-nakuru too if they changed; see living-dial.test.ts.)
// (au-vic-2026 re-taken on 2026-10-15 at foundations F1, as living-dial.test.ts's step 1; the other two profiles as the run gives them, below.)
const BEFORE: { [profile: string]: { days: number; state: string } } = {
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 3fdeff6a... until then.)
  // (Re-taken on 2026-10-16 at foundations F7: news of a person's body reaches them when it happens, not at the next wake; 5e3c3fcb... until then. gb-eng and ke-nakuru did not move in 30 days.)
  // (Re-taken on 2026-10-16 at foundations F11: a register's keeper answers in its own time; 88f2e1f7..., fe18427c... and 03864d04... until then.)
  // (Re-taken on 2026-10-16 at foundations F8: the support office asks for papers before it decides, looks at a refusal again when asked, and the tribunal hears an appeal at the law's fee; the profile's routes are published as `law-decisions`; 79ea9459..., 5d8c73f8..., bf808d07..., d60a26bc..., 1af6423e..., 40d2f316... until then.)
  // (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; c5a5a00f... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10: see CONFIG_BEFORE below; f54352a2... until then.)
//   (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 12df1060... until then.)
  // (Re-taken on 2026-10-17 at the bug hunt, finding 3: a landlord who sees a tenant die ends the lease by notice and offers the tenancy to the household member still there, where it waited for the registry and then chased the dead for arrears; this town has a tenant die within its 60 days. Traced by taking firms.ts back to main (the old hash) and by switching off only that rule. The config hashes and the other two towns did not move; 02577eca... until then.)
  "au-vic-2026": { days: 60, state: "36dad5e663f8a720a6b28108da1fe14b14485423a3f38666006a96b5dc8dedb1" },
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 3b4bc97e... until then.)
  // (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; c1ae5e74... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10; 29f53e5f... until then.)
//   (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 5400d29a... until then.)
  // (Re-taken on 2026-10-17, twin-fix: someone who dies where others work is reported to the registry by the first of those present, citizen 0.58.0; 33189d5c... until then. The other two profiles did not move.)
  "gb-eng-2026": { days: 30, state: "9da9b07952cc7e2de860ea24762fe90dc56f49090379f8bb057b9aa1a4a4b764" },
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; ab25cb7d... until then.)
  // (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; 66ba5ea8... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10; 11a014cc... until then.)
//   (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 372a8340... until then.)
  "ke-nakuru-2026": { days: 30, state: "b077b1296d388d9feb7ad615a6aaf78933fb42d45e92f446a191d91cafca79ff" },
};
// (Re-taken once more at foundations F4, 2026-10-15: a generated town's systems name their template and supplier, and its world names where work is done (`performers_in`): the config hashes and the states move, the draws and the town's life do not.)
// (The config hashes were re-taken on 2026-10-15 at foundations F2: the world's act-time table gained rows by what an act makes. The states did not move.)
const cfgHash = (c: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);
// (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 1f5ef6f6... until then.)
// (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 66456d26... until then.)
// (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 2ecddd70... until then.)
// (Re-taken on 2026-10-16 at foundations F11, states and these hashes both: a register's keeper answers in its own time, so the registry's officers have work and the asker's answer comes later; a84328b7..., e0d58af7... and 6e9f53ac... until then.)
// (Re-taken on 2026-10-16 at foundations F7: the generator's version moved with the table of slips; be6ff50f..., 266c7a18... and 44349775... until then. The states did not move.)
// (Re-taken on 2026-10-16 at the review of the foundations, finding 6, config and states both: the council's appointments officer, the posts' `appointed_by`, and every generated system owned by the organisation whose post it holds; 8dc56724..., 02ba6945... and 08e63b3c... until then.)
// (Re-taken on 2026-10-17 at foundations F9 and F10, config and states both: three public forms for what a person files with an office that decides, a row of the table of work for `take`, and the engine's advance stopping where a letter is delivered or a paper recorded, so that news reaches a person when it happens; 033bebfc..., d2d9fdb0... and 9430b5b6... until then.)
// (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; e82365d7..., 0fb4991d... and 9679d7f3... until then.)
const CONFIG_BEFORE: { [profile: string]: string } = { "au-vic-2026": "640002cd9f8730df", "gb-eng-2026": "0cc086d68cb6805b", "ke-nakuru-2026": "9be6db49076022c1" };

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
