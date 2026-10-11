// The support office under load (docs/behaviour/boundary.md, "Under load"): claims that wait their processing time, are
// decided so many a day, oldest first, and some wrongly refused at the friction dial, more while a backlog stands; a
// refusal asked about and found wrong is reviewed, and the claimant's next claim is decided on its facts.
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
  const c: any = context("outside-support-system", "outside", { account: "acc-o", ...params });
  if (dial !== undefined) c.world = { ...c.world, dials: { friction_bps: dial } };
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

test("with the new parameters at nought, claims are decided the day they are seen, as before, with no waiting noted", () => {
  const o = office({}, 10_000);
  const d = decisions(o.at(0, [claim("c1", 0, "a"), claim("c2", 0, "b")]));
  expect(d).toEqual([{ claim: "c1", payment: "pension", granted: true, amount: 50_000, every: 14 * DAY }, { claim: "c2", payment: "pension", granted: true, amount: 50_000, every: 14 * DAY }]);
});

test("a processing time: the claim is decided that many days after it was made", () => {
  const o = office({ processing_days: 14 });
  expect(decisions(o.at(0, [claim("c1", 0, "a")]))).toEqual([]);
  expect(decisions(o.at(13 * DAY))).toEqual([]);
  expect(decisions(o.at(14 * DAY))).toMatchObject([{ claim: "c1", granted: true, waited_days: 14 }]);
});

test("a capacity: ten claims on one day are decided two a day over five days, the oldest first", () => {
  const o = office({ capacity_per_day: 2 });
  const claims = Array.from({ length: 10 }, (_, i) => claim(`c${String(i).padStart(2, "0")}`, 0, `p${i}`));
  const order: string[][] = [];
  for (let d = 0; d < 6; d++) order.push(decisions(o.at(d * DAY, d === 0 ? claims : [])).map((x: any) => x.claim));
  expect(order).toEqual([["c00", "c01"], ["c02", "c03"], ["c04", "c05"], ["c06", "c07"], ["c08", "c09"], []]);
  // (An older claim goes before a younger one that came on an earlier id.)
  const p = office({ capacity_per_day: 1 });
  expect(decisions(p.at(0, [claim("z", 0, "a"), claim("a", DAY, "b")])).map((x: any) => x.claim)).toEqual(["z"]);
  expect(decisions(p.at(DAY)).map((x: any) => x.claim)).toEqual(["a"]);
});

const request = (id: string, at: number, who: string, about: string) => statement(id, at, "remedy_request", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"], data: { matter: "claim_refused", against: "outside", about, seeks: "review" } });

test("a qualifying claim wrongly refused at the dial is reviewed when asked about; the next claim is granted; a rightly refused claim is answered no", () => {
  const o = office({ error_bps: 10_000, respond: { grant_bps: { claim_refused: 10_000 } } }, 10_000);
  const first = o.at(0, [claim("c1", 0, "a")]);
  expect(decisions(first)).toMatchObject([{ claim: "c1", granted: false, reason: "the claim could not be verified" }]);
  const decision = o.seen.find((r) => r.kind === "benefit_decision")!;
  const asked = o.at(DAY, [request("q1", DAY, "a", decision.id)]);
  expect(asked.of("statement", "remedy_answer").map((c) => c.args.data)).toMatchObject([{ granted: true, matter: "claim_refused" }]);
  expect(asked.of("money").length).toBe(0);
  expect(decisions(o.at(2 * DAY, [claim("c2", 2 * DAY, "a")]))).toMatchObject([{ claim: "c2", granted: true, amount: 50_000 }]);
  // A claim refused rightly (too young) is answered no when asked about.
  const young = statement("c3", 3 * DAY, "benefit_claim", { speaks_for: "b", addressed_to: ["outside"], visible_to: ["b", "outside"], data: { payment: "pension", account: "acc-b", born_at: 3 * DAY - 30 * YEAR } });
  expect(decisions(o.at(3 * DAY, [young]))).toMatchObject([{ claim: "c3", granted: false }]);
  const refused = o.seen.filter((r) => r.kind === "benefit_decision").find((r) => r.data.claim === "c3")!;
  const no = o.at(4 * DAY, [request("q2", 4 * DAY, "b", refused.id)]);
  expect(no.of("statement", "remedy_answer").map((c) => c.args.data)).toMatchObject([{ granted: false, matter: "claim_refused" }]);
});
