// Citizens' recourse in a town (docs/behaviour/frictions.md; docs/decisions.md 2026-10-24, "Citizens' recourse in the
// experiments"). The worked example of 2026-10-23 found nobody asking for a review, appealing or complaining in 540
// seed-days, and took it for a fault of the port: it was a town without `living`, where by design nothing goes wrong for
// anyone (`dials.friction_bps` 0) and nobody takes initiative (`dials.initiative_bps` 0). This holds both halves on the
// Rust world: in a living town people refused support ask the office to look at it again and the office answers, and
// other wrongs are taken to whoever did them and to the bodies that hear them; in the same town without `living`, no
// resident asks for anything to be put right (a debt owed to someone is still pursued: that is not a friction's). No model is called.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld } from "../src/batch";
import { engineModule } from "../src/kernel";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const have = !!engineModule() && existsSync(engineModule()!);

/** The statements residents made and offices answered, by kind (and a request's matter), from a run's JSONL log. */
async function papers(sets: string[], days: number) {
  const { config } = await loadWorld(join(root, "worlds/town-300.yaml"), ["opening_caseload=true", ...sets]);
  const out = mkdtempSync(join(tmpdir(), "recourse-"));
  try {
    await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "r", outDir: out, until: days * DAY, recordObservations: "none" });
    const file = join(out, "r.jsonl");
    const text = existsSync(file) ? readFileSync(file, "utf8") : Bun.spawnSync(["zstd", "-dc", `${file}.zst`]).stdout.toString();
    const people = new Set((config.participants as any[]).filter((p) => p.kind === "person" || p.person).map((p) => p.person ?? p.id));
    const count = new Map<string, number>();
    const add = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
    for (const line of text.split("\n")) {
      if (!line.includes('"recorded"')) continue;
      const e = JSON.parse(line);
      if (e.kind !== "event" || e.body?.event !== "recorded") continue;
      const r = e.body.record;
      // (Only what residents did themselves: the opening caseload's papers are brought forward by the generator.)
      if (r.data?.brought_forward) continue;
      const resident = people.has(r.speaks_for);
      if (r.kind === "review_request" && resident) add(`asked:${r.data?.matter}`);
      if (r.kind === "decision_review") add(`reviewed:${r.data?.outcome}`);
      if ((r.kind === "application" || r.kind === "tribunal_application" || r.kind === "complaint_notice") && resident) add(`applied:${r.data?.matter ?? r.data?.kind}`);
    }
    return { dials: config.dials ?? {}, count: Object.fromEntries([...count].sort()) as { [k: string]: number } };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const total = (c: { [k: string]: number }, prefix: string) => Object.entries(c).filter(([k]) => k.startsWith(prefix)).reduce((s, [, n]) => s + n, 0);

test.skipIf(!have)("in a living town people take what went wrong to whoever did it, and a refused claim is looked at again; without `living`, nobody asks", async () => {
  // (Frictions at three times the rates as sourced, as the culture batches and foundations F8 ran them, so that a
  // 300-person town over 150 days has enough to see.)
  const living = await papers(["living.initiative_bps=10000", "living.friction_bps=30000"], 300);
  expect(living.dials).toMatchObject({ initiative_bps: 10_000, friction_bps: 30_000 });
  expect(living.count["asked:claim_refused"] ?? 0).toBeGreaterThan(0);
  expect(total(living.count, "reviewed:")).toBeGreaterThan(0);
  expect(total(living.count, "asked:")).toBeGreaterThan(living.count["asked:claim_refused"] ?? 0);
  expect(total(living.count, "applied:")).toBeGreaterThan(0);
  const plain = await papers([], 300);
  // (A debt owed to us is still pursued at the tribunal: that is life's, not a friction's. What frictions raise is not.)
  expect(total(plain.count, "asked:")).toBe(0);
  for (const m of ["claim_refused", "bill", "goods", "underpaid", "disrepair"]) expect(plain.count[`applied:${m}`] ?? 0, m).toBe(0);
}, 1_200_000);
