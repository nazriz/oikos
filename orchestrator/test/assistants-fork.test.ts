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
import { saysWhatTheTownIs } from "@oikos/participants/llm";

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

test("model seats in two kinds of assistant: each is a seat, each sees its forms at its first sitting, is shown its world in its own terms only, and together they spend only the fork's limit", async () => {
  // (Dry: the mock plays every seat, priced as the model it plays, so the fork's limit bites. Found by the scope pilot's
  // dry run: the desk was played by its twin, seats of a fork had a limit each, and a seat taking a post over saw only
  // what was new since its twin had looked, so no forms.)
  const out = join(root, "runs", "test-assistants-seats");
  rmSync(out, { recursive: true, force: true });
  // (At the profile's own prices: persons take the free tier and the desk is a seat; organisations, now principals for
  // more kinds since H6, do not engage by their own rule at these prices, so few systems are seated. At a twentieth of the
  // prices six were, and their debriefs overran what the harness keeps back, which is capped at half the limit: MT-30.)
  const P = structuredClone(loadProfile(base.profile)) as any;
  const config = generateFrom({ ...base, assistants: true, assistant_seats: ["assistant-a", "assistant-a-personal"] }, P) as any;
  // (One office has decided by hand to take provider A's assistant on day 1, so that an organisation's system is a seat by the fork.)
  const office = config.positions.find((p: any) => p.role_module?.params?.delegation && p.role_module.code === "firm.landlord");
  office.role_module.params = { ...office.role_module.params, delegation: { ...office.role_module.params.delegation, commit: { offer: "letting-assistant-a", levels: { notice_to_vacate: "draft", rent_increase: "draft", repair_order: "draft", rental_listing: "draft" }, levels_until: 200 * DAY, keep_until: 200 * DAY, why: "test" } } };
  const limit = 0.4;
  const spec: ExperimentSpec = { name: "assistants-seats", world: { config }, post: "template:assistant-a,assistant-a-personal", seeds: [1], forkDay: 60, untilDay: 120,
    arms: [{ name: "seats", steward: { kind: "model", model: "anthropic/claude-sonnet-5-5" } }], measures: ["acts"],
    seats: { mock_models: true, framing: "unstated", budget: { fork_usd: limit } } };
  try {
    await runBase(spec, 1, out);
    const r = await runArm(spec, 1, spec.arms[0]!, out);
    const calls = readFileSync(join(out, "seed-1", "seats.calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // (Those that sat: a system delivered too late to be put to work before the limit sits never, and is only debriefed.)
    const seats = new Set(calls.filter((c: any) => c.purpose === "participant").map((c: any) => c.seat));
    expect(seats.has("provider-a-desk-system"), "the desk, a system of the config, is a seat").toBe(true);
    expect(seats.size).toBeGreaterThan(1);
    expect(r.stopped?.by).toBe("SpendingLimitReached");
    expect(calls.reduce((a: number, c: any) => a + (c.cost_microusd ?? 0), 0)).toBeLessThanOrEqual(limit * 1e6);
    const jsonl = join(out, "seed-1", "seats.jsonl");
    expect(Bun.spawnSync([kernelBinary(), "export", r.log!, "--out", jsonl]).exitCode).toBe(0);
    const first = new Map<string, any>();
    for (const l of readFileSync(jsonl, "utf8").trim().split("\n")) {
      const e = JSON.parse(l);
      if (e.kind === "annotation" && e.body.annotation === "observation" && seats.has(e.body.subject) && !first.has(e.body.subject)) first.set(e.body.subject, e.body.data.observation);
    }
    expect(first.size).toBe(seats.size);
    for (const [seat, o] of first) expect(o.channels.some((c: any) => (c.records ?? []).some((x: any) => x.kind === "form" && x.data?.form === "scope_request")), `${seat} sees its request form at its first sitting`).toBe(true);
    // Everything each seat was shown at its sittings (its standing instructions, its forms, the matters handed to it,
    // drafts, results): the world's terms only (principle 14). A form as a paper form, a matter as the facts it sets down,
    // money in the town's currency; never the store's notation, the call language, a sum in its smallest unit, or a
    // word of the platform's; and under `unstated`, nothing of what the town is.
    const flat = (x: unknown): string => (typeof x === "string" ? x : Array.isArray(x) ? x.map((b: any) => (typeof b === "string" ? b : b?.content !== undefined ? flat(b.content) : b?.text ?? "")).join("\n") : "");
    const shown = readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.purpose === "participant" && seats.has(e.body.subject));
    // (The mock's own requests, quoted back to it, are its words, not the platform's: the mock is code, and says each
    // request in the call language.)
    const told = shown.flatMap((e) => [e.body.data.system ?? "", flat(e.body.data.input)]).join("\n").split("\n").filter((l) => !l.includes("(mock) ")).join("\n");
    expect(told).toContain("Its blanks:");
    expect(told).toContain("what is to be done: ");
    expect(told).toMatch(/\$[0-9]/);
    for (const [what, never] of [["the store's notation", /\{"|":\{|":"/], ["the call language", /\b(?:statement|money|form|message|goods|work|agreement)\(|\bcalls: |data=/],
      ["a sum in its smallest unit", /\b(?:amount|fee(?: month)?|price|paid|withheld|cost|balance|rent|wage|setup|exit): -?[0-9]/i], ["the platform's words", /\b(?:translators?|kernel|resolver|channels?|blocks?)\b/i]] as const) {
      const at = told.search(never);
      expect(at, `a seat was shown ${what}: …${told.slice(Math.max(0, at - 120), at + 120)}…`).toBe(-1);
    }
    expect(saysWhatTheTownIs(told).slice(0, 3)).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);
