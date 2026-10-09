// Measuring candidate readers on the same requests (orchestrator/src/reader-compare.ts): the counting, with no call.

import { expect, test } from "bun:test";
import { agree, isProgram, measure, tableText } from "../src/reader-compare";

const use = (cost: number, out: number) => ({ input_tokens: 0, output_tokens: out, cache_read_tokens: 0, cache_write_tokens: 0, cost_microusd: cost, calls: 1 });
const requests = [
  { id: "a", request: "Tell the clerk yes.", forms: [] },
  { id: "b", request: "Show me the accounts.", forms: [] },
  { id: "c", request: "Tell the clerk no.", forms: [] },
] as any[];

test("an answer is read whole when it is a program; two answers agree by meaning, not by spelling", () => {
  expect(isProgram('message(to=clerk, text="yes")')).toBe(true);
  expect(isProgram("none(not_an_act)")).toBe(true);
  expect(isProgram('message(to=clerk, text=\\"yes\\")')).toBe(false);
  expect(agree(requests[0], 'message(to=clerk, text="yes")', 'message(text="yes", to=clerk)')).toBe(true);
  expect(agree(requests[0], 'message(to=clerk, text="yes")', 'message(to=mayor, text="yes")')).toBe(false);
  // (Copied free text is not compared, since 2026-10-10: translator/test/free-text.test.ts.)
  expect(agree(requests[0], 'message(to=clerk, text="yes")', 'message(to=clerk, text="yes, by Friday")')).toBe(true);
});

test("each reader's count of answers read whole, repaired, agreeing with the settled labels and with each other, and its cost and time a request", () => {
  const labels = new Map([["a", 'message(to=clerk, text="yes")'], ["b", "none(not_an_act)"]]);
  const one = { reader: "x/one", used: use(750_000, 90), ms: 6_000, raw: new Map([["a", 'message(text="yes", to=clerk)'], ["b", "none(not_an_act)"], ["c", 'message(to=clerk, text="no")']]) };
  // (The second escaped its first answer's quotation marks by hand, refused the second request otherwise, and left the third.)
  const two = { reader: "y/two", used: use(0, 30), raw: new Map([["a", 'message(to=clerk, text=\\"yes\\")'], ["b", "none(unclear)"]]) };
  const m = measure(requests, labels, [one, two]);
  expect(m.readers[0]).toMatchObject({ reader: "x/one", requests: 3, answered: 3, read_whole: 3, escaped_by_hand: 0, with_labels: { agreed: 2, of: 2 }, cost_usd: 0.75, cost_usd_per_request: 0.25, seconds: 6, seconds_per_request: 2 });
  expect(m.readers[1]).toMatchObject({ reader: "y/two", answered: 2, read_whole: 2, escaped_by_hand: 1, with_labels: { agreed: 1, of: 2 }, cost_usd: 0 });
  expect(m.readers[1]!.seconds).toBeUndefined();
  expect(m.agreement).toEqual([{ a: "x/one", b: "y/two", agreed: 1, of: 3 }]);
  const text = tableText("Three requests", m);
  expect(text).toContain("x/one: read whole 3/3; with the settled labels 2/2");
  expect(text).toContain("y/two: read whole 2/3 (1 escaped by hand, repaired)");
  expect(text).toContain("x/one with y/two: 1/3 agree");
});
