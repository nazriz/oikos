// Forks with assistants (docs/design/delegation.md sections 7 and 8; docs/experiments.md, "Interventions"): the real
// engine, a generated town whose principals have engaged assistants by the fork, code and mock seats only, no model.
// The assistants' kind is the post (a template steward): a mock seat in it leaves the world its code leaves, to the hash;
// an intervention is its principal's own act at the fork, noted, and the principal's rule takes it up from there.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { DAY, runArm, runBase, type ExperimentSpec } from "../src/experiment";
import { kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

/** The town with assistants at a twentieth of the profile's prices: dear enough to weigh, cheap enough to be taken here. */
function town(): any {
  const P = structuredClone(loadProfile(base.profile)) as any;
  for (const pr of P.values.assistants.providers) for (const o of pr.offers) { o.fee_month = Math.round(o.fee_month / 20); o.setup = Math.round(o.setup / 20); }
  return generateFrom({ ...base, assistants: true }, P);
}

test("a mock seat in the assistants' kind leaves the code's world to the hash; an intervention is the principal's own act at the fork", async () => {
  const out = join(root, "runs", "test-assistants-fork");
  rmSync(out, { recursive: true, force: true });
  const spec: ExperimentSpec = { name: "assistants-fork", world: { config: town() }, post: "template:assistant-a", seeds: [1], forkDay: 100, untilDay: 130,
    arms: [{ name: "code", steward: { kind: "code" } }, { name: "probe", steward: { kind: "code" }, intervene: [{ do: "act", participant: "-", call: "none(not_an_act)" }] }],
    measures: ["records:referral", "records:report", "records:remit"] };
  try {
    await runBase(spec, 1, out);
    const seen = JSON.parse(readFileSync(join(out, "seed-1", "delegation.json"), "utf8"));
    const svc = seen.services.find((s: any) => !s.ended && !s.noticed);
    expect(svc, "by the fork some principal has a service in use").toBeDefined();
    const config = JSON.parse(readFileSync(join(out, "seed-1", "config.json"), "utf8"));
    // (A post's principal, or a person, who acts as itself.)
    const principal = config.positions.find((p: any) => p.entity === svc.entity && p.role_module?.params?.delegation)?.id ?? config.participants.find((p: any) => p.person === svc.entity && p.controller?.type === "code")!.id;
    const code = await runArm(spec, 1, { name: "code", steward: { kind: "code" } }, out);
    const diligent = await runArm(spec, 1, { name: "diligent", steward: { kind: "model", model: "mock/diligent" } }, out);
    expect(diligent.stateHash).toBe(code.stateHash);
    const back = await runArm(spec, 1, { name: "taken-back", steward: { kind: "code" }, intervene: [{ do: "take_back", principal, hold_days: 60 }] }, out);
    expect(back.stateHash).not.toBe(code.stateHash);
    const jsonl = join(out, "seed-1", "taken-back.jsonl");
    expect(Bun.spawnSync([kernelBinary(), "export", back.log!, "--out", jsonl]).exitCode).toBe(0);
    const lines = readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const noted = lines.filter((e: any) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.intervened);
    expect(noted.length).toBeGreaterThan(0);
    const recs = lines.filter((e: any) => e.kind === "event" && e.body.event === "recorded").map((e: any) => e.body.record).filter((r: any) => r.at >= spec.forkDay * DAY);
    const remits = recs.filter((r: any) => r.kind === "remit" && r.speaks_for === svc.entity);
    expect(remits.length).toBeGreaterThan(0);
    expect(remits.every((r: any) => r.data.level === "none" && r.data.hold_until === spec.forkDay * DAY + 60 * DAY)).toBe(true);
    // (Taken back and held: nothing of that principal's goes to its assistant again in the fork.)
    const t0 = Math.max(...remits.map((r: any) => r.at));
    expect(recs.filter((r: any) => r.kind === "referral" && r.speaks_for === svc.entity && r.at > t0)).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);
