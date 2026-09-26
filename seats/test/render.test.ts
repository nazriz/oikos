import { expect, test } from "bun:test";
import { money, outcomeWords, renderObservation, when } from "../src/llm/render";
import { canonical } from "../src/canon";

test("money and time read as a person would read them", () => {
  expect(money(123456789)).toBe("$1,234,567.89");
  expect(money(-5)).toBe("-$0.05");
  expect(when(86_400 * 366)).toBe("year 2, day 2");
});

test("outcomes read as what someone will do", () => {
  expect(outcomeWords({ money: { to: "acc-landlord-1", amount: 85000, for: "rent" } }, 2592000)).toBe("pay $850.00 to acc-landlord-1 every 30 days (rent)");
  expect(outcomeWords({ occupancy: { who: "c1", in: "str.3", slot: "dwelling" } })).toBe("give c1 a dwelling in str.3");
});

const obs = (channels: any, extra: any = {}) => ({ seat: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels, ...extra }) as any;

test("reports use the world's words: titles, totals, tallies; never the machinery", () => {
  const claims = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, record: "claim", author: "genesis", at: 0, visible_to: "public", position: "right", holder: "city", about: { kind: "ownership", object: `p${i}` } }));
  const votes = ["yes", "no", "yes"].map((choice, i) => ({ id: `v${i}`, record: "vote", author: `councillor-${i}`, at: 5, visible_to: ["city"], ballot: "rec.7", choice }));
  const text = renderObservation(obs({ mine: { kind: "records", records: [...claims, ...votes] } }), { titles: new Map([["mine", "Filings concerning the town"]]) });
  expect(text).toContain("## Filings concerning the town (2 new)");
  expect(text).toContain("30 ownership claims: city has a right: p0, p1");
  expect(text).toContain("and 18 more");
  expect(text).toContain("3 votes on rec.7: no 1, yes 2");
  for (const machinery of ["block", "record", "channel", "insufficient_funds", "kernel", "translator"]) expect(text.toLowerCase()).not.toContain(machinery);
});

test("outcomes and notices are told in plain words", () => {
  const text = renderObservation(obs({}, { outcomes: [{ action: "act.9", t: 0, status: "refused", refusal: { code: "insufficient_funds" } }], notices: [{ t: 0, text: "Please state the amount itself." }] }), { lastAction: "What you confirmed" });
  expect(text).toContain("What you confirmed couldn't be done: the account doesn't have enough money.");
  expect(text).toContain("A note on your request: Please state the amount itself.");
  expect(text).not.toContain("act.9");
});

test("canonical JSON sorts keys by UTF-16 code units and escapes like the kernel", () => {
  expect(canonical({ b: 1, a: [true, null, "x\n\u0001é"], "é": 0, Z: {} })).toBe('{"Z":{},"a":[true,null,"x\\n\\u0001é"],"b":1,"é":0}');
  expect(() => canonical({ x: 1.5 })).toThrow();
});
