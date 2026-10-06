// Requests with no program, labelled by two readers (train/readers.ts): a request is an example only where both
// answers are programs the contract allows, they mean the same, and the program's values are in the request, so that
// it has its spans and the steps a model is trained on rebuild it. Each way of failing is counted by its own name.

import { expect, test } from "bun:test";
import { canonical } from "../eval/run";
import { decode, encode } from "../model/encode";
import { labelled, NOT_KEPT, withListsQuoted, type Unlabelled } from "../train/readers";

const FORM = "- stall_permit, to=town, id form-stall: fields lot (lot, required), notes (text)";
const from = { situation: "a-run/clerk-system/d3/1", writer: "writer-a" };
const u = (id: string, request: string, forms: string[] = []): Unlabelled => ({ id, request, forms, from });

/** Each request with what the first and the second reader answered (undefined: no answer). */
const SET: [Unlabelled, string | undefined, string | undefined][] = [
  [u("pay", "Pay acc-b 500 from acc-a."), 'money(amount="500", from=acc-a, to=acc-b)', "money(to=acc-b, from=acc-a, amount=500)"],
  [u("list", "Tell works and rates: send me the minutes by Friday."), 'message(to=[works, rates], text="send me the minutes by Friday")', 'message(to=["rates","works"], text="send me the minutes by Friday")'],
  [u("brackets", "Direct the clerk [clerk] to collect the bins at [house-12] today."), 'message(to=clerk, text="collect the bins at house-12 today")', 'message(to=clerk, text="collect the bins at [house-12] today")'],
  [u("look", "Show me last month's payments out of acc-a."), "none(not_an_act)", "none( not_an_act )"],
  [u("office", "Fill in the stall permit for lot-3.", [FORM]), "form(form=stall_permit, lot=lot-3, to=town)", "form(form=stall_permit, lot=lot-3)"],
  [u("reworded", "Direct the clerk [clerk] to collect the bins at [house-12] today."), 'message(to=clerk, text="Please collect the bins at house-12")', 'message(to=clerk, text="Please collect the bins at house-12")'],
  [u("disagreed", "Sort out the bins with the clerk [clerk]."), 'message(to=clerk, text="Sort out the bins")', "none(unclear)"],
  [u("garbage", "Pay acc-b 500 from acc-a."), "pay(acc-b, 500)", 'money(amount="500", from=acc-a, to=acc-b)'],
  [u("contract", "Pay acc-b 500 from acc-a."), 'money(sum="500", from=acc-a, to=acc-b)', 'money(sum="500", from=acc-a, to=acc-b)'],
  [u("one-reader", "Pay acc-b 500 from acc-a."), 'money(amount="500", from=acc-a, to=acc-b)', undefined],
  [u("worked-out", "Pay acc-b five hundred from acc-a."), 'money(amount="500", from=acc-a, to=acc-b)', 'money(amount="500", from=acc-a, to=acc-b)'],
  [u("cut", "Pay acc-b 500 from acc-a."), 'money(amount="50", from=acc-a, to=acc-b)', 'money(amount="50", from=acc-a, to=acc-b)'],
];
const answers = (i: 1 | 2) => SET.flatMap(([x, ...said]) => (said[i - 1] === undefined ? [] : [{ id: x.id, program: said[i - 1]! }]));
const r = labelled(SET.map(([x]) => x), [{ reader: "reader-1", answers: [...answers(1), { id: "nobody's", program: "none(unclear)" }] }, { reader: "reader-2", answers: answers(2) }]);
const kept = (id: string) => r.examples.find((e) => e.id === id)!;
const why = (id: string) => r.rejects.find((x) => x.id === id)?.why;

test("two readers who agree make an example, in the shape of a generated set's checked examples", () => {
  expect(r.examples.map((e) => e.id)).toEqual(["pay", "list", "brackets", "look", "office"]);
  const e = kept("pay");
  expect(e).toMatchObject({ request: "Pay acc-b 500 from acc-a.", forms: [], program: 'money(amount="500", from=acc-a, to=acc-b)', kind: "positive", shape: "money(amount,from,to)", written_by: "writer-a", verified_by: "reader-1 + reader-2", source: from.situation, origin: "in_situ" });
  expect(e.gold).toBe(e.program);
  expect(e.spans).toEqual([{ arg: "amount", value: "500", how: "copy", at: [10, 13] }, { arg: "from", value: "acc-a", how: "copy", at: [19, 24] }, { arg: "to", value: "acc-b", how: "copy", at: [4, 9] }]);
  // A refusal both gave is an example too, with nothing to point at.
  expect(kept("look")).toMatchObject({ program: "none(not_an_act)", kind: "refusal", shape: "none(not_an_act)" });
  expect(kept("look").spans).toBeUndefined();
});

test("every example kept can be trained on: its steps rebuild its program", () => {
  for (const e of r.examples) {
    const enc = encode(e);
    expect(canonical(decode(enc.input, enc.steps))).toBe(canonical(e.program));
  }
});

test("the leniencies: a list with bare items is the list; text with an id's brackets left off is the same text, and the copy is kept; a form's office the request doesn't name is left out", () => {
  expect(withListsQuoted('message(to=[works, rates], text="see [house-12], [a, b]")')).toBe('message(to=["works", "rates"], text="see [house-12], [a, b]")');
  expect(withListsQuoted('work(by=["c1", c2], units=3)')).toBe('work(by=["c1", "c2"], units=3)');
  expect(withListsQuoted('claim(about={"a":[1, 2]})')).toBe('claim(about={"a":[1, 2]})');
  expect(kept("list").program).toBe('message(text="send me the minutes by Friday", to=["works","rates"])');
  // The first reader left the brackets off: not the request's words. The second copied them: its program is the one kept.
  expect(kept("brackets").program).toBe('message(text="collect the bins at [house-12] today", to=clerk)');
  expect(r.manifest.kept_from).toEqual({ "reader-1": 4, "reader-2": 1 });
  // The form's office: both mean the same (the forms known send it to one office), and the request never says "town".
  expect(kept("office").program).toBe("form(form=stall_permit, lot=lot-3)");
  expect(kept("office").spans!.map((s) => [s.arg, s.how])).toEqual([["form", "choice"], ["lot", "copy"]]);
  expect(r.manifest.office_left_out).toBe(1);
});

test("each way of not being kept has its own name, and the rejects keep both answers", () => {
  expect(why("reworded")).toBe("reworded_text");
  expect(why("disagreed")).toBe("disagreed");
  expect(why("garbage")).toBe("not_a_program");
  expect(why("contract")).toBe("contract");
  expect(why("one-reader")).toBe("unanswered");
  expect(why("worked-out")).toBe("not_copied");
  expect(why("cut")).toBe("not_encodable");
  expect(r.rejects.find((x) => x.id === "disagreed")).toMatchObject({ answers: { "reader-1": 'message(to=clerk, text="Sort out the bins")', "reader-2": "none(unclear)" }, from });
  expect(r.rejects.find((x) => x.id === "one-reader")!.answers).toEqual({ "reader-1": 'money(amount="500", from=acc-a, to=acc-b)' });
  expect(r.rejects.find((x) => x.id === "worked-out")!.detail).toBe("amount=500");
});

test("the manifest counts what was kept and what was dropped, by reason, by function and by refusal label", () => {
  const m = r.manifest;
  expect(m).toMatchObject({ labelled_by: "two readers", readers: ["reader-1", "reader-2"], requests: 12, examples: 5, rejected: 7 });
  expect(Object.keys(m.by_reason)).toEqual(NOT_KEPT);
  expect(m.by_reason).toEqual({ unanswered: 1, not_a_program: 1, contract: 1, disagreed: 1, reworded_text: 1, not_copied: 1, not_encodable: 1 });
  expect(m.by_kind).toEqual({ positive: 4, refusal: 1 });
  expect(m.by_function).toEqual({ form: 1, message: 2, money: 1, "none(not_an_act)": 1 });
  expect(m.by_refusal_label).toEqual({ not_an_act: 1 });
  expect(m.writers).toEqual({ "writer-a": 5 });
  expect(m.unknown_ids).toEqual({ "reader-1": 1, "reader-2": 0 });
  expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
  // One reader twice is not two readers.
  expect(() => labelled([], [{ reader: "x", answers: [] }, { reader: "x", answers: [] }])).toThrow();
});
