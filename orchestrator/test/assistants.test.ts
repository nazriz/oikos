// Assistants as services (docs/behaviour/assistants.md; docs/design/delegation.md): the real kernel, a generated town, code
// participants, no model. A town that does not ask for assistants is generated as before; one that does has providers
// that sell, principals that engage by their own rule and hand matters over, and assistants that do them; and every
// input of every decision about delegating is a record the principal was shown, never anything else.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

test("a town that does not ask for assistants is generated as before; one that does has providers, their kinds of system and principals", () => {
  const plain = generate(base) as any;
  expect(generate({ ...base, assistants: false })).toEqual(plain);
  expect(JSON.stringify(plain)).not.toMatch(/service_offer|firm\.provider|"assistant"/);
  const on = generate({ ...base, assistants: true }) as any;
  const providers = on.world.entities.filter((e: any) => e.id.startsWith("provider-"));
  expect(providers.length).toBe(2);
  expect(on.world.boundaries).toEqual(expect.arrayContaining(providers.map((p: any) => p.id)));
  const tpl = on.templates.filter((t: any) => t.controller?.impl === "assistant");
  expect(new Set(tpl.map((t: any) => t.supplier)).size).toBe(2); // (two providers, one controller: the same model under two firms)
  const principals = on.positions.filter((p: any) => p.role_module?.params?.delegation);
  expect(principals.length).toBeGreaterThan(0);
  for (const p of principals) {
    const d = p.role_module.params.delegation;
    expect(on.positions.find((x: any) => x.id === d.post)).toMatchObject({ entity: p.entity });
    expect(on.positions.find((x: any) => x.id === d.post).holder).toBeUndefined();
    // (Only what the principal could know: its own time, its figures, never how often an assistant really slips.)
    expect(JSON.stringify(d)).not.toMatch(/slip/);
  }
});

test("in a town with assistants, principals engage by their own rule, hand matters over and hear back; every decision rests on what they were shown", async () => {
  // (At a twentieth of the profile's prices: at today's, in a town this small, nobody's paperwork pays for one.)
  const P = structuredClone(loadProfile(base.profile)) as any;
  for (const pr of P.values.assistants.providers) for (const o of pr.offers) { o.fee_month = Math.round(o.fee_month / 20); o.setup = Math.round(o.setup / 20); }
  const config = generateFrom({ ...base, assistants: true }, P) as any;
  const out = join(root, "runs", "test-assistants");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "full" } }, runId: "assistants", outDir: out, until: 150 * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  rmSync(out, { recursive: true, force: true });
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = new Map<string, any>(ev.filter((e) => e.event === "recorded").map((e) => [e.record.id, e.record]));
  const kinds = (k: string) => [...recs.values()].filter((r) => r.kind === k);
  expect(kinds("service_offer").length).toBeGreaterThanOrEqual(2);
  expect(kinds("service_delivery").length).toBeGreaterThan(0);
  expect(kinds("remit").length).toBeGreaterThan(0);
  expect(kinds("referral").length).toBeGreaterThan(0);
  expect(kinds("report").length).toBeGreaterThan(0);
  expect(ev.filter((e) => e.event === "action_refused" && e.refusal?.code === "unpriced")).toEqual([]);
  // Every input of a decision about delegating is a record made by then that its principal's organisation may see.
  const entityOf = new Map<string, string[]>();
  for (const p of config.positions) if (p.holder) entityOf.set(p.holder, [...(entityOf.get(p.holder) ?? []), p.entity]);
  for (const p of config.participants) if (p.person) entityOf.set(p.id, [...(entityOf.get(p.id) ?? []), p.person]);
  const decisions = log.filter((e) => e.kind === "annotation" && e.body.annotation === "decision" && e.body.data?.domain === "delegation");
  expect(decisions.length).toBeGreaterThan(0);
  for (const d of decisions) {
    const mine = entityOf.get(d.body.subject) ?? [];
    for (const id of d.body.data.inputs) {
      const r = recs.get(id);
      expect(r, `${id}, an input of ${JSON.stringify(d.body.data).slice(0, 200)}`).toBeDefined();
      expect(r.at).toBeLessThanOrEqual(d.t);
      expect(r.visible_to === "public" || mine.some((e) => r.visible_to.includes(e))).toBe(true);
    }
  }
}, 600_000);
