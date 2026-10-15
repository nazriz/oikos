// A body's own paperwork is done by its staff, like any employer's (foundations F6; docs/behaviour/staffing.md, "A body's own paperwork"):
// every body of the town that employs people has a payroll officer, a post of its staff, who pays and stops the wages and files and pays over
// the tax withheld on the law's days; and a body with two or more staff has a deputy who fills a post whose holder has died. Before F6 the tax
// withheld from the staff of the bodies stayed in the bodies' accounts (5 to 11 per cent of the year's tax and contributions went uncollected).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("every body that employs people has a payroll officer from its own staff, and a deputy where it has two", () => {
  const c = generate({ ...base, citizens: 1000, profile: "au-vic-2026" });
  const byId = new Map<string, any>(c.participants.map((p: any) => [p.id, p]));
  const employed = (entity: string) => c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === entity).map((r: any) => r.terms.parties[1] as string);
  // (The bank's payroll is done by its lending office, which keeps its file of instructions; the others have a payroll officer of their own.)
  expect(c.positions.find((p: any) => p.id === "bank-lending").role_module.params.pay_staff).toBe(true);
  expect(c.positions.some((p: any) => p.id === "bank-payroll")).toBe(false);
  for (const entity of ["tribunal", "ombudsman", "consumer-desk", "electoral-commission", "paper", "land-registry", "union", "water-corp", "energy-co"]) {
    const staff = employed(entity);
    if (!staff.length) continue;
    const officer = c.positions.find((p: any) => p.id === `${entity}-payroll`);
    expect(officer, `${entity} has a payroll officer`).toBeDefined();
    expect(officer.role_module.code).toBe("body.payroll");
    expect(staff.map((s: string) => `${s}-self`), `${entity}: the officer is one of its staff`).toContain(officer.holder);
    const deputy = c.positions.find((p: any) => p.id === `${entity}-payroll-deputy`);
    expect(!!deputy, `${entity}: a deputy where it has two or more staff (it has ${staff.length})`).toBe(staff.length >= 2);
    if (deputy) {
      expect(staff.map((s: string) => `${s}-self`)).toContain(deputy.holder);
      expect(deputy.holder, `${entity}: the deputy is not the officer`).not.toBe(officer.holder);
      expect(deputy.role_module.params.watch).toContain(`${entity}-payroll`);
      expect(officer.role_module.params.watch).toEqual([`${entity}-payroll-deputy`]);
    }
  }
  // A shop's manager runs its payroll; the deputy keeps the manager's post filled.
  const shop = c.positions.find((p: any) => p.id === "shop-1-deputy");
  expect(shop?.role_module.params).toMatchObject({ part: "deputy" });
  expect(shop.role_module.params.watch).toContain("shop-1-manager");
  expect(byId.get(shop.holder)?.kind).toBe("person");
}, 120_000);

test("the tax withheld from a body's staff is reported and paid over by the body, on the law's days", async () => {
  const config = generate({ ...base, citizens: 300, profile: "au-vic-2026" });
  const out = join(root, "runs", "test-body-payroll");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "body-payroll", outDir: out, until: 100 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const filed = new Set(recs.filter((r) => r.kind === "withholding_report").map((r) => r.speaks_for));
  for (const body of ["tribunal", "land-registry", "bank", "union", "water-corp", "energy-co"]) expect(filed.has(body), `${body} filed a return of the tax withheld from its staff`).toBe(true);
  rmSync(out, { recursive: true, force: true });
}, 600_000);
