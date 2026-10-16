// What leaves the run for a reader (docs/design/ai-citizens.md 13b, 13d): names, ids, sums and days are replaced by tags,
// numbered by first appearance; the same words are one reading; every decision a seat can put words on has a row in the
// table of plain papers (empty until the gate has been run for real). No model.

import { expect, test } from "bun:test";
import { reading as R } from "@oikos/participants";
import { READING_TABLE, readingKey, Tagger, textHash, type ReadRequest, type Reader, type ReadingTable } from "@oikos/participants/llm";
import { ReadingDesk, type Statement } from "../src/reading";

const WORLD = { names: ["Marta Ilves", "Odo Prentiss", "North Street Landlords"], currency: { code: "OIK", symbol: "§", unit_words: ["oikons"] } };

test("names, ids, sums and days become tags numbered by first appearance, the same value the same tag; counts and spans of time stay", () => {
  const t = new Tagger(WORLD);
  const paper = t.tag("Marta Ilves, we cannot pay §1,200.00 for apts-3/dwelling.2 (claim stmt.41): the law asks for 26 weeks and you have 19. Bring slips within 28 days of year 2, day 40, or by 2027-03-14. Odo Prentiss agrees §1,200.00 is owed; 15 oikons more are not.");
  expect(paper).toBe("[PERSON-1], we cannot pay [SUM-1] for [ID-1] (claim [ID-2]): the law asks for 26 weeks and you have 19. Bring slips within 28 days of [DAY-1], or by [DAY-2]. [PERSON-2] agrees [SUM-1] is owed; [SUM-2] more are not.");
  // What it answers shares the registry: the same sum is the same tag, so "you asked for [SUM-1]; we can pay [SUM-2]" reads.
  expect(t.tag("I ask for §1,200.00 and Marta Ilves wrote on year 2, day 40.")).toBe("I ask for [SUM-1] and [PERSON-1] wrote on [DAY-1].");
  // Nothing a person or a place called anything gets through.
  for (const raw of ["Marta Ilves", "Odo Prentiss", "1,200", "apts-3", "stmt.41", "2027-03-14", "year 2"]) expect(paper).not.toContain(raw);
  // A name inside another word is not a name.
  expect(new Tagger(WORLD).tag("Martha Ilvesque and North Street Landlords")).toBe("Martha Ilvesque and [PERSON-1]");
});

test("a sum is found beside a code that ends in digits, and two numbers in a row are two", () => {
  const t = new Tagger({ names: ["c0103"], currency: { code: "AUD", symbol: "$", unit_words: ["dollar", "dollars"] } });
  expect(t.tag("shop-2 should pay c0103 $422.49 by day 205. 5 $ and 12 AUD and 30 dollars, AUD 7, 1,200.00 $."))
    .toBe("[ID-1] should pay [PERSON-1] [SUM-1] by [DAY-1]. [SUM-2] and [SUM-3] and [SUM-4], [SUM-5], [SUM-6].");
  // (Found by a run: an id ending in digits ate the sign of the sum after it.)
  expect(new Tagger({ names: [], currency: { code: "AUD", symbol: "$" } }).tag("26 weeks, 19 of 52, 3 months")).toBe("26 weeks, 19 of 52, 3 months");
});

test("different names, sums, days and ids in the same words give the very same text, and the same key", () => {
  const a = new Tagger(WORLD).tag("Marta Ilves: we can pay §500.00 by year 1, day 30 under stmt.7.");
  const b = new Tagger(WORLD).tag("Odo Prentiss: we can pay 9,999 oikons by 2030-01-02 under apts-1/dwelling.9.");
  expect(a).toBe(b);
  const k = (paper: string) => readingKey({ reader: "mock/x", version: "1", kind: "remedy_answer:refused", standing: "addressee", paper });
  expect(k(a)).toBe(k(b));
  expect(k(a)).not.toBe(readingKey({ reader: "mock/x", version: "1", kind: "remedy_answer:refused", standing: "raised", paper: a }));
  expect(k(a)).not.toBe(readingKey({ reader: "mock/y", version: "1", kind: "remedy_answer:refused", standing: "addressee", paper: a }));
  expect(textHash(a)).toBe(textHash(b));
  expect(textHash(a)).toMatch(/^[0-9a-f]{16}$/);
});

const PLAIN: R.Reading = { respect: 0, reason: 1, answers: 1, recourse: 0, threat: 0, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };
const TABLE: ReadingTable = { version: "t", rows: { "remedy_answer:refused": PLAIN } };
const dial: R.ReadingDial = { papers: ["decision"], reader: "mock", calls_per_run: 800, params: R.READING_DEFAULTS };
const refusal = (id: string, who: string, sum: string): Statement => ({ id, author: "seat-1", kind: "remedy_answer", text: "Answer.", data: { granted: false, reason: `${who}, we cannot pay ${sum}: the law asks for 26 weeks.` }, basis: "r1" });

test("the reader is shown tagged words and never a name or a sum; forty refusals in the same words to forty people are one reading", async () => {
  const seen: ReadRequest[] = [];
  const reader: Reader = { model: "mock/spy", version: "1", read: async (q) => { seen.push(q); return { reading: PLAIN, phrases: { reason: q.paper.split(/\s+/).slice(0, 5).join(" "), answers: q.paper.split(/\s+/).slice(0, 5).join(" ") } }; } };
  const filed: any[] = [];
  const desk = new ReadingDesk({ dial, reader, table: TABLE, bySeat: () => true, tag: () => new Tagger(WORLD), file: async (x) => { filed.push(x); } });
  await desk.onStatement({ id: "r1", author: "c1-self", kind: "review_request", text: "Odo Prentiss asks for §900.00 back.", data: {} });
  // (Forty refusals to the same person, for different sums: the words are the same once tagged.)
  for (let i = 0; i < 40; i++) await desk.onStatement(refusal(`a-${i}`, "Odo Prentiss", i % 3 ? "§1,200.00" : "§85.50"));
  // Forty papers, one reading (two askings): the cache is by the tagged words, not by who or how much.
  expect(seen).toHaveLength(2);
  expect(desk.counts).toMatchObject({ asked: 40, read: 1, cached: 39, calls: 2 });
  for (const q of seen) {
    expect(q.paper).toBe("[PERSON-1], we cannot pay [SUM-1]: the law asks for 26 weeks.");
    expect(q.answers).toBe("[PERSON-1] asks for [SUM-2] back.");
  }
  // The log holds the tagged words (a later training run can use them) and their hash; every paper has its own event.
  expect(filed).toHaveLength(40);
  expect(filed.filter((f) => f.reading.source === "model")).toHaveLength(1);
  expect(filed.filter((f) => f.reading.source === "cache")).toHaveLength(39);
  expect(filed[0].reading).toMatchObject({ paper: "a-0", text: "[PERSON-1], we cannot pay [SUM-1]: the law asks for 26 weeks.", text_hash: textHash("[PERSON-1], we cannot pay [SUM-1]: the law asks for 26 weeks.") });
  expect(JSON.stringify(filed)).not.toMatch(/Marta|Odo|1,200|85\.50|900/);
  // (Marta Ilves, in another paper, is another person's tag in the same words: a different reading only if the words differ.)
  for (let i = 0; i < 40; i++) expect(desk.lookup(`a-${i}`, "addressee")).toBeDefined();
});

test("every paper a seat can put words on has a row in the table of plain papers: the table is empty only until the gate has been run, and says so", () => {
  const keys = R.plainKeys();
  expect(keys.length).toBeGreaterThan(20);
  for (const k of R.DECISION_KINDS) expect(keys.some((x) => x.startsWith(`${k}:`)), k).toBe(true);
  // Whatever outcome a decision's data states has a key.
  expect(R.plainKey("loan_decision", { approved: false })).toBe("loan_decision:refused");
  expect(R.plainKey("tribunal_order", { finding: "plan" })).toBe("tribunal_order:plan");
  for (const k of keys) expect(R.plainKey(k.split(":")[0]!, /^(granted|refused)$/.test(k.split(":")[1]!) ? { granted: k.endsWith("granted") } : { finding: k.split(":")[1]! })).toBe(k);
  const rows = Object.keys(READING_TABLE.rows);
  if (rows.length === 0) {
    expect(READING_TABLE.status).toMatch(/empty until the gate/);
    expect(READING_TABLE.version).toBeNull();
  } else {
    expect(READING_TABLE.version).toBeTruthy();
    expect(keys.filter((k) => !rows.includes(k))).toEqual([]);
  }
});
