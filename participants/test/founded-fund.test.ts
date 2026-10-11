// A founded fund pays by the rule it states and refuses by it (docs/behaviour/founding.md, "A fund's rule").
// The fourth living pilot's funds paid nobody: 186 draws asked, every one refused for a qualifying period the offer
// never stated, in a run too short for anyone to qualify. Here a fund old enough to pay, on hand-built papers.

import { expect, test } from "bun:test";
import { inCurrency } from "../src/money";
import { founded } from "../src/behaviour/founded";
import { context, DAY, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const ME = "ent.9";
const member = (id: string, who: string, at: number) => ({ id, at, record: "agreement", author: ME, visible_to: [ME, who], terms: { template: "membership", parties: [ME, who], commitments: [] } });
const claim = (id: string, who: string, at: number, amount: number) => ({ id, at, record: "statement", author: who, speaks_for: who, kind: "fund_claim", addressed_to: [ME], visible_to: [ME, who], text: "Request: a draw on the fund.", data: { amount, account: `acc-${who}` } });

test("a fund states its rule with its offer, pays a member of long enough standing while its money lasts, and refuses by the same rule, saying it", () => {
  const m = founded.create(context(`${ME}-convenor-system`, ME, { founder: "c0001", shape: "fund", idea: "idea.1", name: "The Fall-Back Fund", purpose: "A fund for those with nothing to fall back on.", want: { about: "security", since: 0, weight: 5000 },
    place: "house-1/dwelling.1", bank: "bank", founded_at: 0, dues: [1000], every_days: [28], starts_in_days: [7], lasts_minutes: [60], fund: { qualify_days: 60, draw_months: 6, every_days: 180 } }, { position: `${ME}-convenor` }));
  const as = { participant: `${ME}-convenor-system`, position: `${ME}-convenor` };
  const ids = { n: 0 };
  const account = (balance: number) => ({ kind: "accounts", accounts: [{ account: "acc.9", holder: ME, custodian: "bank", balance: String(balance) }], transactions: [] });
  // Setting up: an account, what it is for, the gathering, membership. Each wake it is shown what it has made.
  const records: any[] = [];
  let offer: any;
  for (let day = 0; day < 6 && !offer; day++) {
    const w = wake(m, day * DAY, { books: account(0), mine: { kind: "records", records: [...records] } }, { entity: ME, as, ids });
    // (As the world would have recorded each: with its practice or its offer, which the helper's records leave out.)
    for (const c of w.of("statement")) records.push({ id: `rec.s${records.length}`, at: day * DAY, record: "statement", author: as.participant, speaks_for: ME, visible_to: "public", kind: c.args.kind, text: c.args.text, ...(c.args.data ? { data: c.args.data } : {}), ...(c.args.practice ? { practice: c.args.practice } : {}), ...(c.args.offer ? { offer: c.args.offer } : {}) });
    offer = w.of("statement", "membership")[0];
  }
  // The offer says the rule in words and as figures: whoever reads it knows when the fund pays.
  expect(offer.args.text).toContain("The fund's rule: a member of 60 days or more who is short may draw up to XTS 60.00, once in 180 days, while the fund has it.");
  expect(offer.args.data.fund).toEqual({ draw: 6000, qualify_days: 60, every_days: 180 });

  // Day 100: one member of 90 days, one of 10; the fund holds 100.00. Both ask.
  const papers = [member("agr.1", "c0002", 10 * DAY), member("agr.2", "c0003", 90 * DAY), claim("rec.1", "c0002", 100 * DAY, 6000), claim("rec.2", "c0003", 100 * DAY, 6000)];
  const readings = { "agr.1": { of: "agreement", status: "in_force" }, "agr.2": { of: "agreement", status: "in_force" } };
  const w = wake(m, 100 * DAY, { books: account(10_000), mine: { kind: "records", records: [...records, ...papers] } }, { entity: ME, as, ids, more: { readings } });
  const decisions = w.of("statement", "fund_decision");
  expect(decisions.map((d) => [d.args.to, d.args.data.granted, d.args.data.why])).toEqual([[["c0002"], true, undefined], [["c0003"], false, "not yet a member long enough"]]);
  // Paid: the money goes to the member's account. Refused: the answer says why, and the rule.
  expect(w.of("money").map((p) => [p.args.to, p.args.amount])).toEqual([["acc-c0002", "XTS 60.00"]]);
  expect(decisions[1]!.args.text).toContain("We cannot pay a draw now: not yet a member long enough. The fund's rule: a member of 60 days or more");

  // Day 130: the same member asks again (too soon by the rule); another of long standing asks when the fund is short.
  const later = [member("agr.3", "c0004", 20 * DAY), claim("rec.3", "c0002", 130 * DAY, 6000), claim("rec.4", "c0004", 130 * DAY, 6000)];
  const w2 = wake(m, 130 * DAY, { books: account(4_000), mine: { kind: "records", records: later } }, { entity: ME, as, ids, more: { readings: { ...readings, "agr.3": { of: "agreement", status: "in_force" } } } });
  expect(w2.of("statement", "fund_decision").map((d) => [d.args.to[0], d.args.data.granted, d.args.data.why])).toEqual([["c0002", false, "drew not long ago"], ["c0004", false, "the fund has not got it"]]);
  expect(w2.of("money")).toEqual([]);
});
