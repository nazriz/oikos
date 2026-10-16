// The support office (docs/behaviour/boundary.md, "Mistakes"): every claim it has is decided the day it is seen, oldest first
// (until foundations F6 a processing time and a daily capacity made a wave of claims wait), and some wrongly refused at the
// friction dial; a refusal asked about and found wrong is reviewed, and put right by the office (foundations F8).
import { expect, test } from "bun:test";
import { inCurrency } from "../src/money";
import { transfers } from "../src/behaviour/world";
import type { PaymentRule } from "../src/behaviour/payments";
import { context, DAY, statement, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const YEAR = 365 * DAY;
const pension: PaymentRule = { id: "pension", payer: "outside", account: "acc-o", every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } };
const law = statement("law-support", 0, "law", { speaks_for: "outside", data: { support: "payments", payments: [pension] } });
const claim = (id: string, at: number, who: string) => statement(id, at, "benefit_claim", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"], data: { payment: "pension", account: `acc-${who}`, born_at: at - 70 * YEAR } });
const office = (params: object = {}, dial?: number) => {
  // (How often a decision is wrong is the world's table of slips, foundations F7: `error_bps` here stands for its row.)
  const { error_bps, ...rest } = params as { error_bps?: number };
  const c: any = context("outside-support-system", "outside", { account: "acc-o", ...rest });
  if (dial !== undefined) c.world = { ...c.world, dials: { friction_bps: dial } };
  if (error_bps !== undefined) c.world = { ...c.world, slip: { person: { "publish/benefit_decision": { bps: error_bps, friction: true } } } };
  const m = transfers.create(c);
  const ids = { n: 0 };
  const records: any[] = [law]; // (shown at the first wake, then what it said comes back)
  const everything: any[] = [];
  return {
    at: (t: number, more: any[] = []) => {
      const w = wake(m, t, { book: { kind: "records", records: [...records.splice(0), ...more] } }, { entity: "outside", ids, as: { participant: "outside-support-system" } });
      // (What it said comes back to it, as the world would show it.)
      records.push(...w.made);
      everything.push(...w.made);
      return w;
    },
    seen: everything,
  };
};
const decisions = (w: ReturnType<typeof wake>) => w.of("statement", "benefit_decision").map((c) => c.args.data);

test("claims are decided the day they are seen, every one the office has, with no waiting noted (foundations F6: no processing time, no daily capacity)", () => {
  const o = office({}, 10_000);
  const d = decisions(o.at(0, [claim("c1", 0, "a"), claim("c2", 0, "b")]));
  expect(d).toEqual([{ claim: "c1", payment: "pension", granted: true, amount: 50_000, every: 14 * DAY }, { claim: "c2", payment: "pension", granted: true, amount: 50_000, every: 14 * DAY }]);
  // Ten claims on one day are all decided that day, oldest first: how many an office gets through in a day is the hours of whoever decides, which the kernel keeps
  // (a system's lanes, a person's timeline), not a number here. An older claim goes before a younger one that came on an earlier id.
  const many = office({}, 10_000);
  const claims = Array.from({ length: 10 }, (_, i) => claim(`c${String(i).padStart(2, "0")}`, 0, `p${i}`));
  expect(decisions(many.at(0, claims)).map((x: any) => x.claim)).toEqual(claims.map((c) => c.id));
  const p = office({}, 10_000);
  expect(decisions(p.at(0, [claim("z", 0, "a"), claim("a", DAY, "b")])).map((x: any) => x.claim)).toEqual(["z", "a"]);
});

const request = (id: string, at: number, who: string, about: string) => statement(id, at, "review_request", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"], data: { matter: "claim_refused", against: "outside", about, seeks: "review" } });

test("a qualifying claim wrongly refused at the dial is reviewed when asked about (inside the law's days) and put right by the office; a rightly refused claim is answered no", () => {
  // (What the law says of a review is the decisions law's, foundations F8: 90 days here. Docs: docs/behaviour/decisions.md; the office's whole route is in decisions.test.ts.)
  const routes = statement("law-decisions", 0, "law", { speaks_for: "outside", data: { decisions: [{ kind: "benefit_decision", name: "a decision on a claim", review: { within_days: 90, grounds: "any" } }] } });
  const o = office({ error_bps: 10_000, respond: { grant_bps: { claim_refused: 10_000 } } }, 10_000);
  const first = o.at(0, [routes, claim("c1", 0, "a")]);
  expect(decisions(first)).toMatchObject([{ claim: "c1", granted: false, reason: "the claim could not be verified" }]);
  const decision = o.seen.find((r) => r.kind === "benefit_decision")!;
  const asked = o.at(DAY, [request("q1", DAY, "a", decision.id)]);
  expect(asked.of("statement", "remedy_answer").map((c) => c.args.data)).toMatchObject([{ granted: true, matter: "claim_refused", review: "changed" }]);
  // The office puts it right itself: the claim is granted on its second look, and nothing else is paid out of the review.
  expect(decisions(asked)).toMatchObject([{ claim: "c1", granted: true, amount: 50_000, on_review: "q1" }]);
  expect(asked.of("money").length).toBe(0);
  // A claim refused rightly (too young) is answered no when asked about.
  const young = statement("c3", 3 * DAY, "benefit_claim", { speaks_for: "b", addressed_to: ["outside"], visible_to: ["b", "outside"], data: { payment: "pension", account: "acc-b", born_at: 3 * DAY - 30 * YEAR } });
  expect(decisions(o.at(3 * DAY, [young]))).toMatchObject([{ claim: "c3", granted: false }]);
  const refused = o.seen.filter((r) => r.kind === "benefit_decision").find((r) => r.data.claim === "c3")!;
  const no = o.at(4 * DAY, [request("q2", 4 * DAY, "b", refused.id)]);
  expect(no.of("statement", "remedy_answer").map((c) => c.args.data)).toMatchObject([{ granted: false, matter: "claim_refused" }]);
});
