// Offers (docs/design/ai-citizens.md 2a): what's on offer in a world is published as an offer, in the contract's typed
// vocabulary, whoever offers it: jobs, homes, goods, union membership, loans. Facts only; the kernel checks each.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("jobs, homes, goods, union membership and loans are published as offers, each in the typed vocabulary", async () => {
  const out = join(root, "runs", "test-offers");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: 80 }), runId: "offers", outDir: out, until: 60 * DAY });
  const recs = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const offered = (kind: string) => recs.filter((r) => r.kind === kind && r.offer);
  for (const kind of ["job_posting", "rental_listing", "price_list", "membership_offer", "loan_terms"]) expect(offered(kind).length).toBeGreaterThan(0);
  // A job: employment terms, the wage from the employer's account; a home: the lease, the rent monthly; goods: per unit.
  const job = offered("job_posting")[0].offer;
  expect(job).toMatchObject({ take_up: "apply", terms: { template: "employment" } });
  expect(job.terms.commitments[0].does.outcome.money.amount).toBe(String(offered("job_posting")[0].data.wage));
  const home = offered("rental_listing")[0];
  expect(home.offer.terms.commitments.find((c: any) => c.who === "taker").does.outcome.money.amount).toBe(String(home.data.rent));
  expect(home.offer.terms.commitments.find((c: any) => c.who !== "taker").does.outcome.occupancy.in).toBe(home.data.space);
  const goods = offered("price_list").find((r) => r.data?.at);
  expect(goods.offer.take_up).toBe("order");
  expect(goods.offer.terms.commitments.every((c: any) => c.per === "unit")).toBe(true);
  // The records kept their own data too (today's citizens read it; the new citizens will read the offer).
  expect(offered("job_posting").every((r) => Number.isInteger(r.data?.wage))).toBe(true);
}, 300_000);
