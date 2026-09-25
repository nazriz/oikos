import { expect, test } from "bun:test";
import { describeBlocks, money, renderObservation, when } from "../src/llm/render";
import { canonical } from "../src/canon";

test("money and time read as a person would read them", () => {
  expect(money(123456789)).toBe("$1,234,567.89");
  expect(money(-5)).toBe("-$0.05");
  expect(when(86_400 * 366)).toBe("day 366 (year 2, day 2)");
});

test("blocks are described literally, including who they speak for and what they carry", () => {
  const d = describeBlocks([
    { block: "publish", kind: "instruction", speaks_for: "city", addressed_to: ["bank"], text: "Pay the builder.", data: { pay: 600000, from: "acc-city", to: "acc-builder" } },
    { block: "construct", parcel: "p01-02", structure_type: "park", materials_from: "acc-builder" },
  ]);
  expect(d).toContain('1. Publish a instruction on behalf of city, addressed to bank: "Pay the builder." with data {"pay":600000');
  expect(d).toContain("2. Start building a park on parcel p01-02, paying materials from acc-builder.");
});

test("runs of similar claims are totalled and votes tallied, not listed one by one", () => {
  const claims = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, record: "claim", author: "genesis", at: 0, visible_to: "public", position: "right", holder: "city", about: { kind: "ownership", object: `p${i}` } }));
  const votes = ["yes", "no", "yes"].map((choice, i) => ({ id: `v${i}`, record: "vote", author: `councillor-${i}`, at: 5, visible_to: ["city"], ballot: "rec.7", choice }));
  const text = renderObservation({ seat: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: { mine: { kind: "records", records: [...claims, ...votes] as any } } } as any);
  expect(text).toContain("30 ownership claims: city holds a right");
  expect(text).toContain("and 18 more");
  expect(text).toContain("3 votes on rec.7: no 1, yes 2");
  expect(text.split("\n").length).toBeLessThan(10);
});

test("canonical JSON sorts keys by UTF-16 code units and escapes like the kernel", () => {
  expect(canonical({ b: 1, a: [true, null, "x\n\u0001é"], "é": 0, Z: {} })).toBe('{"Z":{},"a":[true,null,"x\\n\\u0001é"],"b":1,"é":0}');
  expect(() => canonical({ x: 1.5 })).toThrow();
});
