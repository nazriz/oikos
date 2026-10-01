// The tribunal in a town (docs/behaviour/justice.md; docs/design/world-expansion.md 5): a law caps rent increases at
// 4% (landlords raise to similar homes' rents plus 5%); landlords who don't comply raise rents anyway; their tenants (here, all of them) take the notices to the tribunal,
// which finds each invalid under the law in force; the landlords obey or not, as often as they obey the law. Nothing in
// the engine stops a notice: a law is enforced only because someone applies, and someone decides, and someone obeys.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("unlawful rent increases are taken to the tribunal, found invalid, and withdrawn by the landlords who comply", async () => {
  const config = generate({ ...spec, years: 1 });
  config.world.records.push({ id: "law-rent-cap", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "law", basis: "law-charter",
    text: "A residential rent may not be increased by more than 4% at a time. Or else: the increase is invalid.",
    adico: { attribute: "landlords", deontic: "must_not", aim: "increase a tenancy's rent by more than 4%", or_else: "the increase is invalid" },
    formal: { language: "cel", condition: "block.block == 'publish' && block.kind == 'rent_increase' && block.data.rent * 100 > block.data.was * 104" } });
  const challenging = (c: any) => c?.params?.tribunal && (c.params = { ...c.params, tribunal: { ...c.params.tribunal, challenge_bps: 10_000 } });
  for (const x of config.participants) {
    if (x.controller?.impl === "firm.landlord") x.controller.params.rent_review_months = 6; // (their practice: reviews within the run)
    challenging(x.controller);
  }
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
  const applications = kind("tribunal_application");
  expect(applications.map((a) => a.data.notice).sort()).toEqual(unlawful.map((n) => n.id).sort());
  // Each listed, both sides told, and on the day found invalid under the cap.
  expect(kind("hearing_notice").length).toBe(applications.length);
  const orders = kind("tribunal_order");
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
}, 900_000);
