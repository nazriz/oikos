// The office's own file (behaviour/daybook.ts; docs/behaviour/office-books.md, "The office's own file"): what a seat
// has sent, filed and paid reaches it at each sitting as its own record, in a bounded space, from what it was shown.
// Held here on papers made by hand: a notice paid is shown as paid, with its day; a request not yet carried out shows
// as such; a case decided shows as decided, with its date; what is open shows as open; nothing of anyone else's
// papers or money is in it; and the whole stays under its bound over ninety days of a busy office.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/ke-nakuru-2026.json";
import type { Observation } from "../src/contracts";
import { DayBook, DAYBOOK_MAX } from "../src/readers/daybook";
import type { OpenHeading } from "../src/module";
import { inCurrency } from "../src/money";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";

inCurrency(PROFILE.values.currency);
const DAY = 86_400, HOUR = 3_600;
const ME = "landlord-38", SEAT = "landlord-38-office-system";

const paper = (id: string, kind: string, t: number, more: object = {}) => ({ id, record: "statement", kind, author: SEAT, speaks_for: ME, at: t, text: `A ${kind}.`, visible_to: [ME], ...more });
const pay = (id: string, t: number, to: string, cents: number, settles?: string) => paper(id, "request", t, { addressed_to: ["bank"], text: `Please pay from acc-${ME} to ${to}.`, data: { outcome: { money: { amount: String(cents), from: `acc-${ME}`, to, ...(settles ? { settles } : {}) } } } });
const tx = (t: number, from: string, to: string, cents: number, settles?: string) => ({ t, from, to, amount: String(cents), currency: "KES", by: ME, ...(settles ? { settles } : {}) });
const seen = (t: number, records: object[] = [], transactions: object[] = [], extra: object = {}): Observation => ({ t, entity: ME, inbox: [], outcomes: [], drafts: [],
  channels: { [`${ME}-office/mine`]: { kind: "records", records }, [`${ME}-office/books`]: { kind: "accounts", accounts: [{ account: `acc-${ME}`, holder: ME, custodian: "bank", currency: "KES", balance: "100000000" }], transactions }, ...extra },
  positions: [{ position: `${ME}-office`, entity: ME, title: "Letting office" }] }) as unknown as Observation;

const bookOf = (open: () => OpenHeading[]) => ({ absorb() {}, open });
const mk = (open: () => OpenHeading[] = () => []) => new DayBook({ entity: ME, authors: [SEAT, `${ME}-office-staff-system`], books: bookOf(open), name: (id) => ({ "acc-city": "the city", c2396: "Wanjiru", "acc-bank": "the bank" } as any)[id] });

test("a notice paid shows as paid, with its day and what it settled; a request not carried out shows as not yet; what followed a paper is named", () => {
  const d = mk();
  d.absorb(seen(31 * DAY, [pay("rec.21698", 31 * DAY, "acc-city", 297_786, "rec.19352"), pay("rec.30000", 32 * DAY, "acc-city", 500_000, "rec.19400"),
    paper("rec.6495", "review_request", 6 * DAY, { addressed_to: ["c2396"], text: "Request: the rent for your home is KSh 14,000.00 in arrears. Please pay it." })], [tx(31 * DAY, `acc-${ME}`, "acc-city", 297_786, "rec.19352")]));
  d.absorb(seen(40 * DAY, [{ id: "rec.7000", record: "statement", kind: "tenant_payment_note", author: "c2396-self", speaks_for: "c2396", at: 20 * DAY, basis: "rec.6495", text: "Paid.", addressed_to: [ME], visible_to: [ME, "c2396"] }]));
  const text = d.text(41 * DAY, "Letting office");
  expect(text).toContain("The office's own file, year 1, day 42");
  expect(text).toContain("year 1, day 32: paid KSh 2,977.86 to the city, settling rec.19352");
  expect(text).toContain("asked the bank to pay KSh 5,000.00 to the city, settling rec.19400 (rec.30000); no payment out of the account seen yet");
  expect(text).toContain("review request to Wanjiru");
  expect(text).toContain("followed year 1, day 21 by a tenant payment note");
  expect(text).not.toContain("rec.21698; no payment"); // (the paid one is not also listed as waiting)
});

test("an office shown no bank account does not say that no payment has been seen leaving it", () => {
  const d = mk();
  const obs = seen(32 * DAY, [pay("rec.30000", 32 * DAY, "acc-city", 500_000, "rec.19400")]);
  delete (obs.channels as any)[`${ME}-office/books`];
  d.absorb(obs);
  const text = d.text(33 * DAY, "Letting office");
  expect(text).toContain("asked the bank to pay KSh 5,000.00 to the city, settling rec.19400 (rec.30000)");
  expect(text).not.toContain("no payment out of the account seen yet");
  expect(text).toContain("this office is not shown its bank account");
});

test("a case decided shows as decided with its date; what stands open shows as open, a few lines to a heading, the rest counted", () => {
  const open: OpenHeading[] = [{ what: "Rates and sums recorded against us, not paid", items: Array.from({ length: 5 }, (_, i) => ({ id: `rec.${i}`, line: `rec.${i}: rates of KSh 2,977.86 recorded against us, due year 1, day 61, not paid` })) }];
  const d = mk(() => open);
  d.absorb(seen(60 * DAY, [paper("rec.100", "tribunal_order", 59 * DAY, { addressed_to: ["c2760"], text: "Order on rec.4177: dismissed.", data: { application: "rec.4177", finding: "dismissed" } })]));
  const text = d.text(61 * DAY, "Tribunal member");
  expect(text).toContain("year 1, day 60: tribunal order to c2760");
  expect(text).toContain("Order on rec.4177: dismissed.");
  expect(text).toContain("Standing open on the books now:");
  expect(text).toContain("Rates and sums recorded against us, not paid (5):");
  expect(text).toContain("and 2 more");
});

test("it is the office's own: another's papers and accounts are not in it, nor its clerk's books; and an office with nothing yet has no file", () => {
  const d = mk();
  expect(d.text(DAY, "Letting office")).toBe("");
  d.absorb(seen(5 * DAY, [{ ...paper("rec.9", "complaint", 4 * DAY), author: "c0001-self", speaks_for: "c0001", text: "SOMEONE ELSE'S COMPLAINT" }, paper("rec.10", "office_books", 4 * DAY, { text: "THE CLERK'S BOOKS" })],
    [tx(4 * DAY, "acc-c0002", "acc-c0003", 123_456)]));
  expect(d.text(6 * DAY, "Letting office")).toBe("");
  d.absorb(seen(6 * DAY, [], [tx(5 * DAY, "acc-c0396", `acc-${ME}`, 1_300_000)]));
  const text = d.text(7 * DAY, "Letting office");
  expect(text).toContain("13,000.00 from acc-c0396");
  expect(text).not.toContain("SOMEONE ELSE");
  expect(text).not.toContain("CLERK'S BOOKS");
  expect(text).not.toContain("123,456");
});

test("over ninety days of a busy office the file stays under its bound, older acts are counted by kind, and the newest are listed", () => {
  let n = 0;
  const open = (): OpenHeading[] => Array.from({ length: 6 }, (_, h) => ({ what: `Heading number ${h} of what stands open at the office`, items: Array.from({ length: 40 }, (_, i) => ({ id: `x${h}.${i}`, line: `x${h}.${i}: ${"a long line about a matter that stands open at the office, ".repeat(5)}` })) }));
  const d = mk(open);
  let widest = 0;
  for (let day = 1; day <= 90; day++) {
    const recs = Array.from({ length: 8 }, (_, i) => paper(`rec.${++n}`, i % 2 ? "rent_reminder" : "tribunal_order", day * DAY + i * HOUR, { addressed_to: [`c${1000 + n}`], text: "A long letter of the office. ".repeat(10) }));
    const txs = Array.from({ length: 4 }, (_, i) => tx(day * DAY + i * HOUR, `acc-${ME}`, `acc-payee${i}-${day}`, 100_000 + day, `rec.s${day}.${i}`));
    d.absorb(seen(day * DAY + 9 * HOUR, recs, [...txs, tx(day * DAY, `acc-c${day}`, `acc-${ME}`, 1_000)]));
    const text = d.text(day * DAY + 10 * HOUR, "Letting office");
    widest = Math.max(widest, text.length);
    expect(text.length).toBeLessThanOrEqual(DAYBOOK_MAX);
  }
  const last = d.text(90 * DAY + 10 * HOUR, "Letting office");
  expect(last).toContain("year 1, day 90:");
  expect(last).toMatch(/Before that and beyond the lines above: \d+ /);
  expect(widest).toBeGreaterThan(2_000); // (the bound was reached, not trivially met)
});

// ------------------------------------------------------------------ the seat is shown it at each sitting

const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });

test("a seat is shown its office's file at each sitting, and it says that it paid", async () => {
  const calls: LlmRequest[] = [];
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => { calls.push(JSON.parse(JSON.stringify(req))); return { content: [use(`e${calls.length}`, "done_for_now", { days: 7 })], usage: { input_tokens: 1, output_tokens: 1 } } as any; } };
  const io = { adapter, annotate: async () => {}, now: () => 0 } as any;
  const d = mk();
  const c: LlmParticipantConfig = { participant: SEAT, entity: ME, title: "Letting office", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", dayBook: { text: (t) => d.text(t, "Letting office") } } as any;
  const p = createLlmParticipant(c, io);
  const step = async (o: Observation) => { d.absorb(o); return p.step(o, { world: { currency: PROFILE.values.currency } } as any); };
  await step(seen(9 * HOUR));
  await step(seen(2 * DAY, [pay("rec.21698", 2 * DAY, "acc-city", 297_786, "rec.19352")], [tx(2 * DAY, `acc-${ME}`, "acc-city", 297_786, "rec.19352")]));
  await step(seen(8 * DAY + 9 * HOUR));
  const shown = (r: LlmRequest) => String(r.messages[0]!.content);
  expect(calls.length).toBeGreaterThan(1);
  expect(shown(calls[0]!)).not.toContain("The office's own file");
  expect(shown(calls.at(-1)!)).toContain("The office's own file");
  expect(shown(calls.at(-1)!)).toContain("paid KSh 2,977.86 to the city, settling rec.19352");
});
