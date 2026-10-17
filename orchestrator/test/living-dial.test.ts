// The dial of a living world (docs/design/ai-citizens.md 10j; world config `dials.initiative_bps`): the share of
// entities that take initiative. At 0, or absent, a town is the town it was before wants, to the state hash, so twins
// can be run; with it on, people and organisations hold wants in records of their own, the same for the same seed,
// and `oikos dataset` writes what became of them. No model is called anywhere here.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { recordChanges, Records } from "../src/records";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const check = (ref: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:${ref}`)!;
  if (!v(row)) throw new Error(`${ref}: ${JSON.stringify(v.errors).slice(0, 800)} in ${JSON.stringify(row).slice(0, 600)}`);
};
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lean = (config: any) => ({ ...config, seed: 1, log: { ...config.log, detail: "lean" } });
const TOWN = join(root, "worlds/town.yaml");

// The state of worlds/town.yaml, seed 1, after 60 days, as origin/main gave it before wants (commit 750bc30, living
// world step 1; computed there on 2026-10-11). A change that is meant to move what a town without the dial does
// (a fault fixed in a module every town runs) changes this value, and says so where it is made.
// Moved on purpose, 2026-10-11 (docs/decisions.md, "Four faults on the firm and landlord side"; it was b88dee15...
// from step 1 until then): firms and landlords are not behind the dial, and four things every town runs changed. The
// bank writes on each payment what it was for; shops and factories set staff from smoothed trade and hold them
// through a dip; the town publishes its place's laws on ending a job and on possession, and a tenant behind with the
// rent is given a notice to vacate, not a notice on the lease; and a business of one can be started.
// And again at the merge of the fixes after the second living pilot, the same day (03f67a4b... until then;
// docs/decisions.md, "What the second living pilot found"): rent and loan repayments are counted from each
// agreement's own day, each landlord takes arrears up on its own day of the week, the mayor's office has a clerk.
// And again on 2026-10-12, with the fixes after the third living pilot (ae8baeed... until then; docs/decisions.md,
// "What the third living pilot found" and "A draw is named for what it is about"): a draw about a paper is named for
// which paper it is to whoever draws, not for the paper's number on file, so every such draw falls anew; a notice to
// vacate does to a tenant what a notice on the lease did; a possession application names the notice it relies on.
// And again on 2026-10-12, with homes dealt by income (d48e330b... until then; docs/decisions.md, "Homes by income"):
// every town opens differently: payments in force from the first day, people with nothing coming in living with
// kin, owners by the head's age, tenancies by what each household has coming in.
// And again on 2026-10-12, with what the fifth living pilot found (611b0834... until then; docs/decisions.md, "What the
// fifth living pilot found"): the law on possession says what the place's law has of a plan, the tribunal's answer
// form is published, tenants answer an application as often as tenants there do, a household with no dwelling asks
// to be taken in, a warrant's paper says how many were put out, and a month's world price is drawn for the month.
// And again on 2026-10-12, with returns on the law's days (with the last: docs/decisions.md, "Returns on the law's
// days"): every employer files its withholding returns on the days the law states, not a month after it first paid.
// And again on 2026-10-12, with trade credit, inputs bought to what can be sold, no dividend while wages are owed, and a second loan
// (b34efd5e... until then; docs/decisions.md, "Firms respond to a shock"): in a 60-day run the factories buy their inputs on the world
// market's terms and the shops their stock on the factories', paying after the goods are in, so the accounts and orders move from the first week.
// And again on 2026-10-12, with the leftovers of the firm-side work (5a2a360e... until then; docs/decisions.md, "The leftovers of
// the firm-side work"): a shop closes its month on a day of its own and first reviews once it has traded a whole month, expecting
// at first the trade it was staffed for, so its month-end rules (price, wage, staff, stock) move; and a payment that says it is
// a dividend or tax withheld is no longer sent back by the outside world's order book.
// And again on 2026-10-12, with payments that carry a budget line (43f2bf77... until then; docs/decisions.md, "Opening caseloads of the
// other offices ... payments that carry a budget line"): the town's opening wage orders name the staff line, and the finance office's
// brief says which line pays for what (two parameters of its own). Nothing else of this branch moves a town without the option: tested
// by taking the lines and the parameters out, which gives 43f2bf77... again.
// And again on 2026-10-12, with draws named for the day or the matter, not the hour (9665fd1d... until then; docs/decisions.md, "Draws and
// the moment"): every participant's stream is a different stream, so every town's draws fall differently. Nothing else moved. (b9db68a1... for the first version of the change, which counted hours.)
// And again on 2026-10-13 (42832ef3... until then; docs/decisions.md, "Hours before heads"): the town publishes its law on cutting hours, and shops, factories
// and townspeople read it (agreements for new hires carry their hours; firms cut hours before they let people go). Nothing of `living` in it.
// And again on 2026-10-15, foundations F1 (46e3ae5e... until then; docs/decisions.md, "Foundations F1"): work takes its performers' time on their timelines, and the state no longer
// carries an empty `labour_used`. Nothing of `living` in it.
// (Re-taken on 2026-10-15 at foundations F3, which looks at a work's performers when the work begins; 6dbd604e... until then. docs/decisions.md, "Foundations F3".)
// (Re-taken on 2026-10-15 at foundations F4: the town's systems carry their template and supplier; cd7ca8cc... until then. docs/decisions.md, "Foundations F4".)
// (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 3fdeff6a... until then.)
// (Re-taken on 2026-10-16 at foundations F7: news of a person's body reaches them when it happens, not at the next wake; 5e3c3fcb... until then.)
// (Re-taken on 2026-10-16 at foundations F11: a register's keeper answers in its own time; 88f2e1f7... until then.)
// (Re-taken on 2026-10-16 at foundations F8: the support office asks for papers before it decides, looks at a refusal again when asked, and the tribunal hears an appeal at the law's fee; the profile's routes are published as `law-decisions`; 79ea9459... until then.)
// (Re-taken on 2026-10-16 at the review of the foundations, finding 6: the council's appointments officer is an office of the town, its posts name their authority, and every generated system is owned by the organisation whose post it holds; c5a5a00f... until then.)
// (Re-taken on 2026-10-17 at foundations F9 and F10: three public forms and a row for `take` in the generated town, and the engine's advance stopping where a letter is delivered or a paper recorded, so that news reaches a person when it happens and not at the next wake of anyone; f54352a2... until then.)
// (Re-taken on 2026-10-17 at the housing and vacant-post faults (fix-housing), on the merge with the seated twins: the council's appointments officer is a councillor's post, watches the city's own offices and hires for the city where none of its staff is left to second; au-vic names the police among the posts the council fills; a death wakes those in the same space; 12df1060... until then.)
// (Re-taken on 2026-10-17 at the strikes by cost (gd-strikes): the union organiser is given each industry's day's pay (`pay_per_day`, generator), so the generated config moves, and with it the state; 02577eca... until then.)
const STEP_1 = "6dc3a1034f91b02a190c63c7ee0d5a3fb2d949b38f5f746ad5f417c8ff587607";

test("with the dial absent or at 0 a town is step 1's town, to the state hash", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-dial-"));
  try {
    const plain = (await loadWorld(TOWN)).config;
    expect(plain.dials).toBeUndefined();
    const absent = await runWorld({ config: lean(plain), runId: "absent", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(absent.stateHash).toBe(STEP_1);
    const zero = await runWorld({ config: { ...lean(plain), dials: { initiative_bps: 0 } }, runId: "zero", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(zero.stateHash).toBe(STEP_1);
    // (And with the dial for how much goes wrong at 0 beside it: frictions belong to a living town.)
    const both = await runWorld({ config: { ...lean(plain), dials: { initiative_bps: 0, friction_bps: 0 } }, runId: "both", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(both.stateHash).toBe(STEP_1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 300_000);

test("with the dial on, people and organisations hold wants in their own records, the same for the same seed; the dataset says what became of them", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-dial-"));
  try {
    const world = async () => (await loadWorld(TOWN, ["living.initiative_bps=10000"])).config;
    const config = await world();
    // (What goes wrong goes wrong at the profile's rates unless the spec says: docs/behaviour/frictions.md.)
    expect(config.dials).toEqual({ initiative_bps: 10_000, friction_bps: 10_000 });
    // The generator's part: firms' and landlords' posts keep their organisation's record; people start attached.
    expect(config.positions.filter((x: any) => x.keeps_record).length).toBeGreaterThan(10);
    expect(config.participants.filter((x: any) => x.controller?.params?.started?.place_days > 0).length).toBeGreaterThan(50);
    const a = await runWorld({ config: lean(config), runId: "a", outDir: out, until: 120 * DAY, recordObservations: "none" });
    const b = await runWorld({ config: lean(await world()), runId: "b", outDir: out, until: 120 * DAY, recordObservations: "none" });
    expect(b.stateHash).toBe(a.stateHash);
    expect(a.stateHash).not.toBe(STEP_1);
    // Every record, a person's or an organisation's, rebuilds from the log with its chain whole and fits its shape.
    const built = new Records();
    const wanted = new Set<string>();
    for await (const c of recordChanges(a.logPath)) {
      const r = built.apply(c);
      if (!r.sections.character && (r.sections.wants as any[])?.length) wanted.add(c.entity);
    }
    let people = 0, orgs = 0;
    for (const r of built.of.values()) {
      expect(r.faults).toEqual([]);
      if (r.sections.character) { orgs++; expect(r.keeper).toMatch(/^firm\./); check("entity-record#/$defs/OrganisationRecord", r.sections); }
      else { people++; check("entity-record#/$defs/PersonRecord", r.sections); }
    }
    const wanting = wanted.size;
    expect(people).toBeGreaterThan(150);
    expect(orgs).toBeGreaterThan(10);
    expect(wanting).toBeGreaterThan(0);
    // The dataset: a row each time something became of a want, and the counts (nothing scored).
    const dir = join(out, "a.dataset");
    const manifest = await exportDataset(a.logPath, dir);
    check("dataset#/$defs/Manifest", manifest);
    const wants = rows(join(dir, "wants.jsonl"));
    for (const w of wants.slice(0, 200)) check("dataset#/$defs/Want", w);
    expect(manifest.wants!.people.born).toBeDefined();
    expect(Object.values(manifest.wants!.people.born!).reduce((x: number, y: any) => x + y, 0)).toBe(wants.filter((w) => !w.organisation && w.event === "born").length);
    expect(manifest.wants!.acts.by_people).toBeGreaterThan(manifest.wants!.acts.on_initiative);
    // Everyday frictions: what arose and how it ended, from people's records; the papers it travelled on.
    const frictions = rows(join(dir, "frictions.jsonl")), papers = rows(join(dir, "venues.jsonl"));
    for (const f of frictions) check("dataset#/$defs/Friction", f);
    for (const v of papers) check("dataset#/$defs/VenuePaper", v);
    expect(frictions.filter((f) => f.event === "arose").length).toBeGreaterThan(0);
    expect(Object.values(manifest.frictions!.arose).reduce((x: number, y: any) => x + y, 0)).toBe(frictions.filter((f) => f.event === "arose").length);
    // The friction dial at 0 is a living town with nothing going wrong: no such paper, no such row, and another town.
    const calm = await runWorld({ config: lean((await loadWorld(TOWN, ["living.initiative_bps=10000", "living.friction_bps=0"])).config), runId: "calm", outDir: out, until: 120 * DAY, recordObservations: "none" });
    expect(calm.stateHash).not.toBe(a.stateHash);
    const quiet = await exportDataset(calm.logPath, join(out, "calm.dataset"));
    expect(quiet.frictions?.arose ?? {}).toEqual({});
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 600_000);
