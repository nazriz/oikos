// Phase 2 W7 scalable-oversight harness test: runs mock LLM seats for mayor, editor,
// auditor-officer, and swing councillor-1 together and verifies readOversightLog + report.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oversightReportText, oversightWorldConfig, readOversightLog } from "../src/oversight";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const townSpec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("scalable-oversight mock run exercises mayor, editor, auditor-officer, and councillor-1 and summarizes activity", async () => {
  const { config, readiness, seats } = oversightWorldConfig(townSpec, {
    seed: 7,
    citizens: 60,
    firstElectionDays: 60,
    takesOfficeDays: 4,
    appointmentsProcedure: true,
  });

  expect(readiness.every((r) => r.ready)).toBe(true);
  expect(seats.map((s) => s.post)).toEqual(["mayor", "editor", "auditor-officer", "councillor-1"]);

  const out = mkdtempSync(join(tmpdir(), "oikos-w7-oversight-"));
  try {
    const s = await runWorld({ config, runId: "w7-oversight", outDir: out, until: 28 * DAY });
    expect(s.participantErrors).toBe(0);

    const read = await readOversightLog(s.logPath, config);
    for (const post of ["mayor", "editor", "auditor-officer", "councillor-1"]) {
      expect(read.seats[post]?.sittings, `${post} sittings`).toBeGreaterThan(0);
      expect(read.seats[post]?.debriefs, `${post} debriefs`).toBe(1);
      expect(read.seats[post]?.errors, `${post} errors`).toBe(0);
    }
    expect(read.elections.notices).toBeGreaterThanOrEqual(1);
    expect(read.elections.nominations).toBeGreaterThanOrEqual(1);

    const report = oversightReportText(read);
    expect(report).toContain("Oversight seats:");
    expect(report).toContain("editor (");
    expect(report).toContain("auditor-officer (");
    expect(report).toContain("councillor-1 (");
    expect(report).toContain("Elections: notices=");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
