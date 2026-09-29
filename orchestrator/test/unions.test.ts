// Workers' voice (phase C, stage C5): a union bargains with each employer where it has members; an offer it accepts
// becomes an enterprise agreement and a rise for all staff. An offer too low goes to a protected action ballot, then
// notice, then stoppages, with no pay for the time on strike, until an offer it accepts.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { withholding, type IncomeTaxLaw } from "@terrarium/participants";
import { generate, industrialActionLaw } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, days: number) {
  const out = join(root, "runs", `test-unions-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("claims are answered by offers; those accepted become enterprise agreements, and everyone there is paid the rise", async () => {
  const config = generate(base);
  const { ev, recs } = await run("bargaining", config, 150);
  const taxLaw = config.world.records.find((r: any) => r.id === "law-income-tax");
  const law: IncomeTaxLaw = { id: taxLaw.id, ...taxLaw.data };
  const claims = recs.filter((r) => r.kind === "wage_claim" && r.speaks_for === "union");
  expect(claims.length).toBeGreaterThanOrEqual(3);
  // Every claim is answered by its employer with an offer no more than the claim.
  for (const c of claims) {
    const offer = recs.find((r) => r.kind === "wage_offer" && r.data.claim === c.id && r.speaks_for === c.data.employer);
    expect(offer).toBeDefined();
    expect(offer.data.rise_bps).toBeLessThanOrEqual(c.data.rise_bps);
  }
  // Agreements: made by the employer after the union accepted; everyone's wage orders replaced at the new wage, net.
  const eas = recs.filter((r) => r.kind === "enterprise_agreement");
  expect(eas.length).toBeGreaterThanOrEqual(1);
  for (const ea of eas) {
    expect(recs.some((r) => r.kind === "offer_accepted" && r.speaks_for === "union" && r.data.employer === ea.data.employer && r.at <= ea.at)).toBe(true);
    const after = recs.filter((r) => r.kind === "request" && r.speaks_for === ea.data.employer && r.at === ea.at && r.data?.every && r.data?.outcome?.money?.for?.startsWith("Wages"));
    if (ea.data.rise_bps > 0) expect(after.length).toBeGreaterThan(0);
    for (const o of after) {
      const net = Number(o.data.outcome.money.amount);
      // Some gross wage, net of the law's withholding, gives this amount.
      const gross = [...Array(400_000).keys()].find((g) => g > net && g - withholding(law, g, o.data.every) === net);
      expect(gross).toBeDefined();
    }
  }
  // Nobody resigns over unpaid wages because their pay changed.
  expect(recs.filter((r) => r.record === "claim" && r.about?.kind === "debt" && /Unpaid wages/.test(r.about?.for ?? "")).length).toBe(0);
}, 600_000);

test("an offer too low: a ballot, notice, stoppages without pay, then an agreement", async () => {
  const config = generate(base);
  // The union bargains only at factory-1, where everyone is a member, and soon; it claims a lot, and settles only for
  // most of it; members all vote, and vote yes.
  const org = config.participants.find((p: any) => p.id === "union-organiser-system").controller.params;
  Object.assign(org, { employers: ["factory-1"], first_claim_days: 5, claim_margin_bps: 5000, accept_share_bps: 9000 });
  const staff = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "factory-1").map((r: any) => r.terms.parties[1]);
  const register = config.world.records.find((r: any) => r.id === "union-register");
  for (const c of staff) {
    if (register.data.members.some((m: any) => m.member === c)) continue;
    register.data.members.push({ member: c, employer: "factory-1" });
    config.world.records.push({ id: `member-${c}`, record: "agreement", author: "genesis", at: 0, visible_to: ["union", c], terms: { template: "membership", parties: ["union", c],
      commitments: [{ who: "union", does: { text: "Represents them." } }], termination: [{ party: "union", notice: 30 * DAY }] } });
    for (const party of ["union", c]) config.world.records.push({ id: `member-${c}-sig-${party}`, record: "signature", author: "genesis", at: 0, visible_to: ["union", c], speaks_for: party, agreement: `member-${c}`, as: party });
  }
  for (const p of config.participants) if (p.controller?.impl === "citizen.default") Object.assign(p.controller.params, { ballot_turnout_bps: 10_000, strike_vote_yes_bps: 10_000 });
  // The world's industrial law, not the profile's: 5 days' notice. The union reads the law.
  const i = config.world.records.findIndex((r: any) => r.id === "law-industrial-action");
  config.world.records[i] = industrialActionLaw(5000, 5000, 5);
  const { ev, recs } = await run("strike", config, 100);
  const ballot = recs.find((r) => r.kind === "action_ballot");
  expect(ballot).toBeDefined();
  const result = recs.find((r) => r.kind === "ballot_result" && r.data.ballot === ballot.id);
  expect(result.data.passed).toBe(true);
  expect(result.data.voted * 2).toBeGreaterThanOrEqual(result.data.eligible);
  // Notice before each stoppage, at least the law's five days.
  const notices = recs.filter((r) => r.kind === "industrial_action");
  const stops = recs.filter((r) => r.kind === "stop_work");
  expect(stops.length).toBeGreaterThanOrEqual(1);
  for (const s of stops) expect(notices.some((n) => n.at <= s.at - 5 * DAY && n.at > s.at - 8 * DAY)).toBe(true);
  // On strike: members leave the works, and their pay stops (their wage orders withdrawn); back: in again, paid again.
  const first = stops[0];
  const back = recs.find((r) => r.kind === "return_to_work" && r.at > first.at);
  expect(back).toBeDefined();
  const strikers = first.data.members as string[];
  expect(ev.filter((e) => e.event === "vacated" && strikers.includes(e.occupant) && e.space === "factory-1-works/workplace.1" && e.t >= first.at && e.t < back.at).length).toBeGreaterThan(strikers.length / 2);
  // (Pay stops while they're out: in a stoppage, once the employer next sees to its payroll. A one-day stoppage may end
  // at that moment, so any stoppage will do.)
  const returns = recs.filter((r) => r.kind === "return_to_work");
  expect(stops.some((st) => {
    const end = returns.find((r) => r.at > st.at)?.at ?? Infinity;
    return recs.some((r) => r.record === "withdrawal" && r.speaks_for === "factory-1" && r.at >= st.at && r.at < end);
  })).toBe(true);
  expect(ev.filter((e) => e.event === "occupied" && strikers.includes(e.occupant) && e.space === "factory-1-works/workplace.1" && e.t >= back.at).length).toBeGreaterThan(strikers.length / 2);
  // No making at the works while everyone's out.
  expect(ev.some((e) => e.event === "worked" && e.task === "make" && e.at === "factory-1-works" && e.t > first.at + DAY / 2 && e.t < back.at)).toBe(false);
  // The offers rise after each stoppage, and it ends in an agreement.
  const offers = recs.filter((r) => r.kind === "wage_offer" && r.speaks_for === "factory-1").map((r) => r.data.rise_bps);
  for (let i = 1; i < offers.length; i++) expect(offers[i]).toBeGreaterThanOrEqual(offers[i - 1]);
  expect(recs.some((r) => r.kind === "enterprise_agreement" && r.data.employer === "factory-1")).toBe(true);
  // Nobody on strike resigns over unpaid wages.
  expect(recs.filter((r) => r.record === "claim" && /Unpaid wages/.test(r.about?.for ?? "") && strikers.includes(r.holder)).length).toBe(0);
}, 600_000);
