// The reading desk (orchestrator/src/reading.ts; docs/behaviour/reading.md): which papers are read, how a reading is filed,
// and that a reader who does not answer never blocks. Mock readers only; no model.

import { expect, test } from "bun:test";
import { reading as R } from "@oikos/participants";
import { curtestReader, kindestReader, Tagger, type ReadRequest, type Reader, type ReadingTable } from "@oikos/participants/llm";
import { ReadingDesk, type Statement } from "../src/reading";

const PLAIN: R.Reading = { respect: 0, reason: 1, answers: 1, recourse: 0, threat: 0, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };
const TABLE: ReadingTable = { version: "t", rows: { "remedy_answer:refused": PLAIN, "remedy_answer:granted": PLAIN } };
const dial = (calls = 800): R.ReadingDial => ({ papers: ["decision"], reader: "mock", calls_per_run: calls, params: R.READING_DEFAULTS });
const refusal = (id: string, author: string, data: { [k: string]: unknown } = { granted: false, reason: "We cannot pay. The law asks for more." }): Statement => ({ id, author, kind: "remedy_answer", text: "Answer to your request r1: no.", data, addressed_to: ["c1"], basis: "r1" });
function desk(reader: Reader, o: { calls?: number; table?: ReadingTable } = {}) {
  const filed: any[] = [];
  const d = new ReadingDesk({ dial: dial(o.calls), reader, table: o.table ?? TABLE, tag: () => new Tagger({ names: [] }), bySeat: (a) => a.startsWith("seat"), file: async (x) => { filed.push(x); } });
  return { d, filed };
}

test("only a seat's decision with words of its own is read; it is read asked twice, filed once, and found by paper and standing", async () => {
  const asked: ReadRequest[] = [];
  const spy: Reader = { ...curtestReader(), read: async (q) => { asked.push(q); return curtestReader().read(q); } };
  const { d, filed } = desk(spy);
  await d.onStatement({ id: "r1", author: "c1-self", kind: "review_request", text: "Please repair the heater in the front room.", data: { matter: "heater" } });
  await d.onStatement(refusal("a-code", "landlord-code")); // a code office: the plain paper, never read
  await d.onStatement(refusal("a-bare", "seat-1", { granted: false })); // a seat's, with no words of its own
  await d.onStatement({ id: "n", author: "seat-1", kind: "note_to_file", text: "Words.", data: { reason: "not a decision" } }); // not a kind of decision
  expect(asked).toEqual([]);
  await d.onStatement(refusal("a-1", "seat-1"));
  expect(asked.map((q) => [q.kind, q.standing, q.wording])).toEqual([["remedy_answer:refused", "addressee", 1], ["remedy_answer:refused", "addressee", 2]]);
  // What it answers is shown with it, and nothing of any person.
  expect(asked[0]!.answers).toContain("heater");
  expect(asked[0]!.paper).toBe("We cannot pay. The law asks for more.");
  expect(filed).toHaveLength(1);
  expect(filed[0].reading).toMatchObject({ paper: "a-1", kind: "remedy_answer:refused", standing: "addressee", source: "model", askings: 2, reader: { model: "mock/curtest" } });
  const rd = d.lookup("a-1", "addressee")!;
  expect(rd.shift).toMatchObject({ respect: -2, reason: -1, answers: -1, recourse: 0, threat: 2 });
  expect(d.lookup("a-1", "public")).toBeUndefined();
  expect(d.lookup("a-code", "addressee")).toBeUndefined();
  expect(d.counts).toMatchObject({ asked: 1, read: 1, calls: 2 });
});

test("a reader that declines, fails, is unreadable, or is over its calls never blocks: the plain paper stands and it is counted; a kind with no plain row is not shifted", async () => {
  const declining: Reader = { model: "mock/d", version: "t", read: async () => ({ declined: true }) };
  const failing: Reader = { model: "mock/f", version: "t", read: async () => { throw new Error("down"); } };
  const empty: Reader = { model: "mock/e", version: "t", read: async () => ({}) };
  const bad: Reader = { model: "mock/b", version: "t", read: async () => ({ reading: { ...PLAIN, respect: 2 }, phrases: { respect: "words that are not there" } }) };
  for (const [name, reader, count] of [["declined", declining, "declined"], ["no_answer", failing, "no_answer"], ["no_answer", empty, "no_answer"], ["unread", bad, "unread"]] as const) {
    const { d, filed } = desk(reader);
    await d.onStatement(refusal("a-1", "seat-1"));
    expect(d.counts[count], name).toBe(1);
    expect(d.lookup("a-1", "addressee")!.shift, name).toEqual(R.NO_SHIFT);
    expect(filed[0].reading.source, name).toBe(name);
  }
  const over = desk(kindestReader(), { calls: 3 });
  await over.d.onStatement(refusal("a-1", "seat-1"));
  await over.d.onStatement(refusal("a-2", "seat-1", { granted: false, reason: "Other words, other reasons, in this paper." }));
  expect(over.d.counts).toMatchObject({ read: 1, over_limit: 1, calls: 2 });
  expect(over.d.lookup("a-2", "addressee")!.shift).toEqual(R.NO_SHIFT);
  const none = desk(kindestReader(), { table: { rows: {} } });
  await none.d.onStatement(refusal("a-1", "seat-1"));
  expect(none.d.counts).toMatchObject({ no_table: 1, calls: 0 });
});

test("the same statements read by the same reader file the same readings (a replay asks nothing new)", async () => {
  const run = async () => { const { d, filed } = desk(kindestReader()); for (let i = 0; i < 5; i++) await d.onStatement(refusal(`a-${i}`, "seat-1", { granted: false, reason: `Reason number ${i}, in words.` })); return filed; };
  expect(await run()).toEqual(await run());
});
