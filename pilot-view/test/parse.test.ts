import { expect, test } from "bun:test";
import { clip, compareActs, dayOf, decisionSignature, lookBody, mentions, money, notebookOf, readingOf, requestWords, stamp, summariseBlocks, toolResults } from "../src/parse";
import { embed } from "../src/render";

test("days count from 1 as the seats' readings do, and a time reads as day and clock", () => {
  expect(dayOf(0)).toBe(1);
  expect(dayOf(4_438_800)).toBe(52);
  expect(stamp(4_438_800 + 1800)).toBe("day 52 09:30");
});

test("money is integer minor units shown with the currency's marks", () => {
  expect(money("123456", { symbol: "$", minor_units: 2 })).toBe("$1,234.56");
  expect(money(5, { symbol: "$", minor_units: 2 })).toBe("$0.05");
  expect(money("-100", { symbol: "$", minor_units: 2 })).toBe("-$1.00");
  expect(money("1500", { symbol: "", minor_units: 0 })).toBe("1,500");
  expect(money("n/a")).toBe("n/a");
});

test("a text is cut and says so", () => {
  expect(clip("abc", 5)).toBe("abc");
  expect(clip("abcdefgh", 3)).toContain("5 more characters");
});

test("a seat's opening message gives its notebook and its reading apart", () => {
  const empty = "Your notebook: (empty)\n\nSince you last looked:\n## Bills (1 new)";
  expect(notebookOf(empty)).toBe("");
  expect(readingOf(empty)).toBe("Since you last looked:\n## Bills (1 new)");
  const full = "Your notebook: Y1 D1: one.\nY1 D2: two.\n\nIt is year 1, day 3.\nYou are 30.";
  expect(notebookOf(full)).toBe("Y1 D1: one.\nY1 D2: two.");
  expect(readingOf(full).startsWith("It is year 1, day 3.")).toBe(true);
  expect(notebookOf("no notebook here")).toBeUndefined();
  expect(readingOf("no notebook here")).toBe("no notebook here");
});

test("a look's standing opening lines are dropped; the request is what the translator was asked", () => {
  expect(lookBody("It is year 1, day 52.\nYou are 25.\n\n## The files\n- [rec.1] a")).toBe("## The files\n- [rec.1] a");
  expect(lookBody("plain")).toBe("plain");
  expect(requestWords("Request: Pay the rent.\n\nForms this person knows of:\n- x")).toBe("Pay the rent.");
});

test("tool results are read from a later turn's messages, by the id of the tool use they answer", () => {
  const r = toolResults([{ type: "tool_result", tool_use_id: "t1", content: "one" }, { type: "tool_result", tool_use_id: "t2", content: [{ text: "a" }, { text: "b" }] }, { type: "text", text: "x" }]);
  expect(r).toEqual([{ id: "t1", text: "one" }, { id: "t2", text: "a\nb" }]);
  expect(toolResults("a string")).toEqual([]);
});

test("known ids are found in free text, a trailing full stop not part of one", () => {
  const known = new Set(["c2638", "landlord-48", "city"]);
  expect(mentions("c2638 asked landlord-48. The city answered, c9999 did not.", known).sort()).toEqual(["c2638", "city", "landlord-48"]);
});

const block = (kind: string, facts: any, to = ["a"]) => ({ block: "publish", kind, addressed_to: to, text: "t", data: facts });

test("blocks are summarised and a decision's signature leaves out paper numbers and free text", () => {
  const a = summariseBlocks([block("tribunal_order", { finding: "dismissed", application: "rec.1", reason: "long words" })]);
  const b = summariseBlocks([block("tribunal_order", { finding: "dismissed", application: "rec.99", reason: "other words" })]);
  const c = summariseBlocks([block("tribunal_order", { finding: "do", application: "rec.1" })]);
  expect(decisionSignature(a)).toBe(decisionSignature(b));
  expect(decisionSignature(a)).not.toBe(decisionSignature(c));
});

test("a seat's acts are set beside its twin's by subject: same, different, and one side only", () => {
  const act = (t: number, kind: string, facts: any, to: string[]) => ({ t, as: "tribunal-member", blocks: summariseBlocks([block(kind, facts, to)]) });
  const seat = [act(10, "tribunal_order", { finding: "dismissed", kind: "bill", applicant: "c1" }, ["c1"]), act(20, "tribunal_order", { finding: "do", kind: "goods", applicant: "c2" }, ["c2"]), act(30, "tribunal_order", { finding: "do", kind: "rent", applicant: "c5" }, ["c5"])];
  const twin = [act(15, "tribunal_order", { finding: "do", kind: "bill", applicant: "c1" }, ["c1"]), act(25, "tribunal_order", { finding: "do", kind: "goods", applicant: "c2" }, ["c2"]), act(40, "tribunal_order", { finding: "do", kind: "debt", applicant: "c7" }, ["c7"])];
  const pairs = compareActs(seat, twin);
  expect(pairs.length).toBe(4);
  expect(pairs.map((p) => [!!p.seat, !!p.twin, p.same])).toEqual([[true, true, false], [true, true, true], [true, false, false], [false, true, false]]);
});

test("the page's data cannot close its script element", () => {
  expect(embed({ x: "</script><b>" })).not.toContain("</script");
});
