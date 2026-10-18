// The tribunal in a town (docs/behaviour/justice.md; docs/design/world-expansion.md 5): a law caps rent increases at
// 4% (landlords raise to similar homes' rents plus 5%); landlords who don't comply raise rents anyway; their tenants (here, all of them) take the notices to the tribunal,
// which finds each invalid under the law in force; the landlords obey or not, as often as they obey the law. Nothing in
// the engine stops a notice: a law is enforced only because someone applies, and someone decides, and someone obeys.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeAt, officesBy } from "./lib/offices";
import { publishRentsBoard } from "./lib/rents-board";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("unlawful rent increases are taken to the tribunal, found invalid, and withdrawn by the landlords who comply", async () => {
  const config = generate({ ...spec, years: 1 });
  config.world.records.push({ id: "law-rent-cap", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "law", basis: "law-charter",
    text: "A residential rent may not be increased by more than 4% at a time. Or else: the increase is invalid.",
    adico: { attribute: "landlords", deontic: "must_not", aim: "increase a tenancy's rent by more than 4%", or_else: "the increase is invalid" },
    formal: { language: "cel", condition: "block.block == 'publish' && block.kind == 'rent_increase' && block.data.rent * 100 > block.data.was * 104" } });
  const challenging = (c: any) => c?.impl === "citizen.default" && c.params?.tribunal && (c.params = { ...c.params, tribunal: { ...c.params.tribunal, challenge_bps: 10_000 } });
  for (const x of officesBy(config, "firm.landlord")) x.params.rent_review_months = 6; // (their practice: reviews within the run)
  publishRentsBoard(config, 1_000); // (the market has moved: the Rust landlord raises a rent only to what homes like it let for)
  for (const x of config.participants) challenging(x.controller);
  for (const t of config.templates) challenging(t.controller);
  const out = join(root, "runs", "test-justice");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "justice", outDir: out, until: 300 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const kind = (k: string) => recs.filter((r) => r.kind === k);
  // The notices that break the cap (as the law reads them), and only those, are taken to the tribunal.
  const unlawful = kind("rent_increase").filter((n) => n.data.rent * 100 > n.data.was * 104);
  expect(unlawful.length).toBeGreaterThan(3);
  const applications = kind("tribunal_application").filter((a) => a.data.kind === "rent_increase");
  expect(applications.map((a) => a.data.notice).sort()).toEqual(unlawful.map((n) => n.id).sort());
  // Each listed, both sides told, and on the day found invalid under the cap.
  expect(kind("hearing_notice").filter((n) => n.data.kind === "rent_increase").length).toBe(applications.length);
  // (The tribunal's orders on these notices; it also hears possession now, which is orchestrator/test/possession.test.ts.)
  const orders = kind("tribunal_order").filter((o) => o.data.kind === "rent_increase");
  expect(orders.length).toBe(applications.length);
  for (const o of orders) {
    expect(o.data.finding).toBe("invalid");
    expect(o.data.laws).toContain("law-rent-cap");
    const a = applications.find((x) => x.id === o.data.application)!;
    expect(o.at - a.at).toBeGreaterThanOrEqual(21 * DAY);
  }
  // Landlords obey as often as they comply (half, here): some withdraw their notices, some don't.
  const withdrawn = recs.filter((r) => r.record === "withdrawal" && /found invalid by the tribunal/.test(r.text ?? ""));
  expect(withdrawn.length).toBeGreaterThan(0);
  expect(withdrawn.length).toBeLessThan(orders.length);
  for (const w of withdrawn) expect(unlawful.map((n) => n.id)).toContain(w.withdraws);
}, 2_400_000);

test("a law repealed by the town that made it stops binding those who followed it: they are told through their book of laws", async () => {
  // A law forbids any rent increase; every landlord complies, so none is given. On day 120 the town withdraws it (a
  // plain repeal: nothing replaces it). The landlords and the tribunal read laws through a channel that shows laws
  // alone: the repeal reaches them there, once, and the landlords' next reviews raise rents.
  const config = generate({ ...spec, years: 1 });
  config.world.records.push({ id: "law-rent-freeze", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "law", basis: "law-charter",
    text: "A residential rent may not be increased. Or else: the increase is invalid.",
    adico: { attribute: "landlords", deontic: "must_not", aim: "increase a tenancy's rent", or_else: "the increase is invalid" },
    formal: { language: "cel", condition: "block.block == 'publish' && block.kind == 'rent_increase'" } });
  for (const x of officesBy(config, "firm.landlord")) Object.assign(x.params, { rent_review_months: 6, compliance_bps: 10_000 });
  publishRentsBoard(config, 1_000); // (as above: without a market that has moved, no rent is raised, repealed law or not)
  const mayor = config.positions.find((p: any) => p.id === "mayor");
  const out = join(root, "runs", "test-justice-repeal");
  rmSync(out, { recursive: true, force: true });
  let repealedAt: number | undefined;
  const told = new Map<string, number>(); // participant -> times its book of laws showed it the repeal
  const s = await runWorld({ config, runId: "repeal", outDir: out, until: 300 * DAY,
    // (What each was shown is read from the log, where the run records these participants' observations in full: the Rust
    // world's engine runs the offices itself, so a test cannot be handed their observations as they are made.)
    recordObservations: [...new Set(["landlord-1-office", "landlord-2-office", "tribunal-member", "union-organiser"].map((post) => officeAt(config, post).holder.id as string))],
    inspect: async (_participant, obs, kernel) => {
      if (repealedAt === undefined && obs.t >= 120 * DAY) {
        repealedAt = obs.t;
        await kernel.request({ op: "command", command: { command: "act", participant: mayor.holder, as: "mayor", provenance: { via: "direct" },
          blocks: [{ block: "withdraw", record: "law-rent-freeze", speaks_for: "city", text: "Repealed." }] } });
      }
    } });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const e of log) if (e.kind === "annotation" && e.body.annotation === "observation")
    for (const ch of e.body.data.observation.channels) if (/(^|\/)laws$/.test(ch.path) && ch.kind === "records")
      for (const r of ch.records) if (r.record === "withdrawal" && r.withdraws === "law-rent-freeze") told.set(e.body.subject, (told.get(e.body.subject) ?? 0) + 1);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.filter((r) => r.record === "withdrawal" && r.withdraws === "law-rent-freeze").length).toBe(1);
  // While it stood, no increase; once it's repealed, the landlords' reviews go ahead.
  const increases = recs.filter((r) => r.kind === "rent_increase");
  expect(increases.filter((r) => r.at <= repealedAt!).length).toBe(0);
  expect(increases.filter((r) => r.at > repealedAt!).length).toBeGreaterThan(3);
  // Each landlord, the tribunal's member and the union were shown the repeal through their laws, once.
  // (Once for each post of theirs among these: the offices are held by people, and one person may hold two.)
  const posts = ["landlord-1-office", "landlord-2-office", "tribunal-member", "union-organiser"].map((post) => officeAt(config, post).holder.id as string);
  // (Their book of laws is shown to each post they hold, and the repeal once in each: at least those of the four, at most all they hold and their own.)
  for (const who of new Set(posts)) {
    expect(told.get(who) ?? 0, who).toBeGreaterThanOrEqual(posts.filter((x) => x === who).length);
    expect(told.get(who) ?? 0, who).toBeLessThanOrEqual(config.positions.filter((x: any) => x.holder === who).length + 1); // (and their own, as a citizen's)
  }
}, 2_400_000);
