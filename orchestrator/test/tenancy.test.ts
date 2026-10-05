// Periodic tenancies (contracts 0.8; docs/design/world-expansion.md 1): where the world's tenancy law says a fixed-term
// lease continues as a periodic one, the generator's leases and the landlords' say so (`then: "periodic"`), and a lease
// runs on past its term until someone gives notice under its clauses. Nobody's home ends just because a date passed.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("leases run on after their term until someone gives notice", async () => {
  const config = generate(spec);
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
  expect(leases.length).toBeGreaterThan(10);
  expect(leases.every((r: any) => r.terms.then === "periodic")).toBe(true);
  const out = join(root, "runs", "test-tenancy");
  rmSync(out, { recursive: true, force: true });
  // (Genesis terms run 12 to 24 months, part-way through: most pass their term within 13 months.)
  const s = await runWorld({ config, runId: "tenancy", outDir: out, until: 395 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const noticed = new Set(recs.filter((r) => r.record === "notice").map((r) => r.agreement));
  const pastTerm = leases.filter((r: any) => r.terms.term < 380 * DAY);
  expect(pastTerm.length).toBeGreaterThan(5);
  // A tenant who finds their tenancy over: only ever after someone gave notice on it.
  const endedFor = new Set(log.filter((e) => e.kind === "command" && e.body.command === "act" && /^Our tenancy of .* has ended/.test(e.body.reasoning ?? "")).map((e) => e.body.participant.replace(/-self$/, "")));
  const unnoticed = pastTerm.filter((l: any) => endedFor.has(l.terms.parties[1]) && !noticed.has(l.id)).map((l: any) => l.id);
  expect(unnoticed).toEqual([]);
}, 600_000);
