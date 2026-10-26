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
import { onRust } from "./lib/doubles";

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
  "au-vic-2026": { days: 60, state: "a5c595d9d76b1ab0cee7a67707efc98cbf221c5653220bfa7cbf9f2539b1109b" },
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 3b4bc97e... until then.)
  // (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; c1ae5e74... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10; 29f53e5f... until then.)
//   (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 5400d29a... until then.)
  // (Re-taken on 2026-10-17, twin-fix: someone who dies where others work is reported to the registry by the first of those present, citizen 0.58.0; 33189d5c... until then. The other two profiles did not move.)
  "gb-eng-2026": { days: 30, state: "3104bad6d390d60f32475457d33c0999fb2baf57d4ad376617fb7d92d6698c11" },
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; ab25cb7d... until then.)
  // (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; 66ba5ea8... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10; 11a014cc... until then.)
//   (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 372a8340... until then.)
  "ke-nakuru-2026": { days: 30, state: "6d92b5f3cf273ed27345fb5c3912ed69ae2660cb41ac907ef1845fd74f262c9f" },
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
// (Re-taken on 2026-10-17 at the bug hunt, a firm's owner's post: every firm with a principal shareholder of the town has an `-owners` post held abroad, so the config hashes and the states move; the towns' draws and life do not change for it before a holder leaves. 640002cd..., 0cc086d6... and 9be6db49... until then.)
// (Re-taken once on 2026-10-18 at the merge of gd-adoption (strikes by cost, adoption by the numbers, the auditor) with the bug hunt's fixes: the generated town gained a vendor of systems, an auditor and the union's day's pay, so the config hashes and the states moved; 93e473eb..., e861d6a0... and ef1fa3d2... for the configs until then.)
// (Re-taken on 2026-10-18 at port step 3, the config hashes only, a pin per world: the generator moved at integration (0.62.0, lane N's names and dates with the auditor's 0.61.0) and on the Rust world calls the shared rules natively (worlds/generator/rules.ts), whose town is its own; 114d1ca2..., c05933ad... and c7e0c672... until then. The TS states did not move. The Rust states are pinned beside them, from the same commit.)
// (Re-taken once on 2026-10-24 at the guardianship of debt-risks (PB-22), the config hashes only: the town's `life` gained `majority` (the profile's youngest adult age) and `guardians` (child protection), the kernel's rule for who may take a minor out of the world; with those two fields removed the hashes are the ones debt-generic-2 took, 00262404..., 7774a82b... and 5b41f095... (checked at the merge with main: stripped of the two fields the generated configs hash to exactly those) The states did not move.)
// (Re-taken on 2026-10-25, config hashes and Rust states both, on main after work-times and fix-memory-appeal (both slow-tier blind at their merges): generator 0.65.0
// writes every town's `public_memory` bound (SC-1) and the table of work's rows changed; a3d0ce4e..., a805fb6d... and 2b872ca6... for the configs, and
// 2ce3e90d..., 5dcf1eab... and 55a4e978... for the states, until then. Not every move is the bound: with `public_memory` left out the configs still differ (the version and work rows).)
// (Re-taken on 2026-10-25 at foundations-2 phase 1 (law 10), config hashes and Rust states both: the support office's casework is done by a desk of
// the agency's officers (`outside-casework`, an officer's minutes in an officer's hours: claims are decided in days, not hours), every machine's template
// states its hours, an office offer's seconds are its template's rows, someone who only orders an act goes on at once, and the engine gives a code unit's `done_by` to the act as `by` (generator 0.68.0, on main's 0.67.0 at the merge of origin/main into f2-phase1);
// 772a98b9..., 5704b7de... and da91782e... for the configs, and 1befde62..., cd0ed6c2... and 824018a6... for the states (main's, at market realism and commercial leasing), until then.)
// (Re-taken on 2026-10-26 at the merge of main (8570d699: the appointments main took meanwhile, the press among the posts the council
// fills) into foundations-2 phase 1, config hashes and Rust states both, on the merged tree; neither side's change alone is the town any
// more; 6a09320a..., d7cf0e19... and f87b1c3a... for the configs, and 46b53dc8..., 4fd33b34... and 3ab351d6... for the states, until then.)
// (Re-taken on 2026-10-26 at taxpayer-accounts (PB-23), on main after foundations-2 phase 1, config hashes and Rust states both: the outside
// world's tax collector keeps each taxpayer's account (a new office, its system and its officers' desk, the law on tax paid and not owed,
// two public forms, a payroll officer's file of its account, a row of the table of work; generator 0.69.0). The towns' life did not move:
// au-vic over 60 days has the same 31,543 records, payments and moves with the collector as with it taken out; the states move with the
// participants. dbb34546..., b5082f8c... and 47fed11d... for the configs, and f49ce487..., ce90d241... and 1605af11... for the states, until then.)
const CONFIG_BEFORE: { [profile: string]: string } = onRust
  ? { "au-vic-2026": "a6b3618ed78b6968", "gb-eng-2026": "24da9440e154ecbc", "ke-nakuru-2026": "ad040dcf63cb44b2" }
  : { "au-vic-2026": "803b3fbf848a16e8", "gb-eng-2026": "f65fb7ddf05c8f9d", "ke-nakuru-2026": "fc1d9dceb0110c10" };
// (The Rust states re-taken once on 2026-10-19 at the cut-over: shops spread their restocking across suppliers, prices read the month's
// evidence and move by price points, an order at a raised price is served at the shop's price, the outside pays an export at its
// invoice's price, a household's death away from home is seen by those of it there, nobody sets off for a gathering from their work;
// 2d57339d..., 44f157a8... and 072c2a5e... until then. The TS states did not move.)
// (Re-taken once more on 2026-10-23, the held cases settled: a person is drawn who they are from the run's seed, not from seed 0, so the same town on seed 1 has
// other people than it had; a refusal lowers the sense of agency and moves the tie; 8b9a1e90..., eac6c4b4... and 443b8875... until then.)
// (Re-taken on 2026-10-23 at debt-generic, config hashes and Rust states both: the mix of shops is the default, each kind of shop has its own premises
// type and room, and a shop is staffed to its kind's sales (generator 0.63.0); ba713978..., b1dc6701... and 6597ecc3... for the configs, and
// 8b9a1e90..., eac6c4b4... and 443b8875... for the states, until then. The towns' people did not change.)
// (Re-taken on 2026-10-24 at the merge of debt-behaviour with main's debt-generic, the states only (the config hashes are main's, unchanged): the two changes together, the run's seed drawing who a person is (on top of the mix of shops); 33ec6526..., 54f581f6... and 076eebff... until then.)
// (Re-taken on 2026-10-24 at debt-generic-2, config hashes and Rust states both: each kind of shop's staff are paid and called what its kind's are, each
// kind has a serving task and a wholesaler of its own, some factories make food and clothing from inputs of their own, complaints are by kind, the
// first factory still makes goods (generator 0.64.0), and a closed shop's sale survives its manager leaving (ME-21); fcaf6597..., 3dd7883c... and 5bc6764a...
// for the configs, and 33ec6526..., 54f581f6... and 076eebff... for the states, until then. The towns' people did not change.)
// (Re-taken again on 2026-10-24 at the merge of debt-behaviour with main's debt-generic-2, the states only; the config hashes are main's, unchanged; 85e81e58..., b79165e8... and e0865435... until then.)
// (Re-taken on 2026-10-25 at market realism and commercial leasing, config hashes and Rust states both: no rate of business
// births (ventures weighed by expected profit), who works and what they have saved drawn together, hiring by fit with postings
// for every hand, a business of one's running costs, and empty shop units to let on the landlords' lots (generator 0.67.0);
// 482f5218..., b002520e... and 86c7a397... for the configs, and cfeeb1be..., d24f6f24... and 261e509d... for the states, until then.)
// (Re-taken on 2026-10-26 at main's slow tier after commercial leasing, config hashes and Rust states both: the paper is among the
// posts the council fills (every profile's `appointed_by`; WM-7), and the station's head takes the station's work after its officers
// (police.station 0.7.0); 772a98b9..., 5704b7de... and da91782e... for the configs, and 1befde62..., cd0ed6c2... and 824018a6... for
// the states, until then.)
// (Re-taken on 2026-10-26 at the merge of lease remedies with main, config hashes and Rust states both: each town's records hold
// the law on leases of shop premises (law-premises-leases), the landlords their surrender price and tribunal, a business of one
// the ground of premises it holds by agreement (generator 0.70.0); the genesis records are in the state. 4c714b3d..., a6a15d31...
// and dd840c8e... for the configs, and e6916c32..., 47582857... and f94c4358... for the states, until then.)
const RUST_STATE: { [profile: string]: string } = {
  "au-vic-2026": "f8aaed1b479af9a5529bdaaab34b019f994a62b7390cb94a2fb57cd504a7c0a0",
  "gb-eng-2026": "26b39d31b9d711fa07b1c05c5bbb65bbe4977f952d699e4a4c7a3d82bda7c723",
  "ke-nakuru-2026": "1e3107f01b5a1465717f82014a212791625b83143f218da92e3327a9823d5e24",
};

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
      expect(r.stateHash, profile).toBe(onRust ? RUST_STATE[profile]! : state);
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
