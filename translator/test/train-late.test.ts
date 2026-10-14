// The kinds the call language gained after the data was first made, and that no recipe made enough of (synthetic.ts
// `lateKinds`; docs/design/translator-round-3.md, section 2): a payment's budget line, payments with a report naming
// several amounts, one sum paid to several accounts, an offer of employment with and without hours, a notice of a
// practice, and an offer anyone may take up. No model is called.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { planOf, refusalBriefs, inOnly } from "../train/data";
import { everyCurrency, LATE_TAGS, lateKinds, synthetic, type LateKind } from "../train/synthetic";

const KINDS = Object.keys(LATE_TAGS) as LateKind[];
const lines = (program: string) => (calls.parseProgram(program) as { lines: calls.Line[] }).lines;

test("each kind is made to the number asked, the same for a seed, every program of the contract, tagged, with notes for the writer", () => {
  for (const kind of KINDS) {
    const dropped: { [why: string]: number } = {};
    const made = lateKinds({ kind, n: 60, seed: 5, dropped });
    expect({ kind, n: made.length }).toEqual({ kind, n: 60 });
    expect(lateKinds({ kind, n: 60, seed: 5 })).toEqual(made);
    expect(lateKinds({ kind, n: 60, seed: 6 })).not.toEqual(made);
    expect(new Set(made.map((g) => g.program)).size).toBe(60);
    for (const g of made) {
      expect(calls.contractErrors(calls.parseProgram(g.program))).toEqual([]);
      expect(g.tag).toBe(LATE_TAGS[kind]);
      expect(g.notes!.length).toBeGreaterThan(0);
      expect(inOnly(g, [LATE_TAGS[kind]])).toBe(true);
    }
  }
});

test("line: a payment with line= a bare label, half of them settling an invoice; the note says the line is not an account", () => {
  const made = lateKinds({ kind: "line", n: 100, seed: 2 });
  for (const g of made) expect(lines(g.program)).toHaveLength(1);
  expect(made.every((g) => /\bline=[a-z]+[,)]/.test(g.program))).toBe(true);
  expect(made.filter((g) => g.program.includes("settles=")).length).toBeGreaterThan(30);
  expect(made[0]!.notes!.join(" ")).toContain("A line of the budget is not an account");
});

test("report: the payment or payments, then statement(kind=report) whose words carry every amount; the sum paid is the one stated as the sum", () => {
  const made = lateKinds({ kind: "report", n: 80, seed: 2 });
  for (const g of made) {
    const ls = lines(g.program);
    expect(ls.length).toBeGreaterThanOrEqual(2);
    expect(ls.slice(0, -1).every((l) => l.call.fn === "money")).toBe(true);
    const last = ls.at(-1)!.call;
    expect([last.fn, (last.args.kind as { id: string }).id]).toEqual(["statement", "report"]);
    const words = (last.args.text as { text: string }).text;
    expect((words.match(/\d/g) ?? []).length).toBeGreaterThan(5);
    expect(g.notes!.join(" ")).toContain(words);
  }
  expect(made.some((g) => lines(g.program).length === 3)).toBe(true);
});

test("split: two or three payments from one account to different accounts, each its own stated sum", () => {
  const made = lateKinds({ kind: "split", n: 80, seed: 2 });
  for (const g of made) {
    const ls = lines(g.program);
    expect([2, 3]).toContain(ls.length);
    expect(ls.every((l) => l.call.fn === "money" && "amount" in l.call.args)).toBe(true);
    expect(new Set(ls.map((l) => (l.call.args.to as { id: string }).id)).size).toBe(ls.length);
  }
});

test("hours: half of the offers of employment state the job's hours (hours=\"N hours\"), half none", () => {
  const made = lateKinds({ kind: "hours", n: 80, seed: 2 });
  const stated = made.filter((g) => g.program.includes("hours="));
  expect(stated.length).toBe(40);
  for (const g of made) expect(lines(g.program)[0]!.call.fn).toBe("agreement");
  for (const g of stated) expect(/hours="\d+ hours"/.test(g.program)).toBe(true);
  for (const g of made.filter((x) => !x.program.includes("hours="))) expect(g.notes!.join(" ")).toContain("none is written");
});

test("practice and offer: one public statement each, with the practice or the offer as data in whole seconds, never an agreement", () => {
  for (const g of lateKinds({ kind: "practice", n: 60, seed: 2 })) {
    const c = lines(g.program)[0]!.call;
    expect([c.fn, (c.args.kind as { id: string }).id, (c.args.visible as { id: string }).id]).toEqual(["statement", "notice", "public"]);
    const p = (c.args.practice as { json: { at: string; every: number; lasts?: number } }).json;
    expect(p.every % 86_400).toBe(0);
    expect(typeof p.at).toBe("string");
    expect("on" in c.args).toBe(true);
    expect(g.program).not.toContain("agreement(");
  }
  const offers = lateKinds({ kind: "offer", n: 60, seed: 2 });
  for (const g of offers) {
    const c = lines(g.program)[0]!.call;
    expect(c.fn).toBe("statement");
    const o = (c.args.offer as { json: { take_up: string; terms: { commitments: { who: string }[]; termination: { notice: number }[] } } }).json;
    expect(o.take_up).toBe("join");
    expect(o.terms.commitments[0]!.who).toBe("taker");
    expect(o.terms.termination[0]!.notice % 86_400).toBe(0);
  }
  expect(offers.some((g) => g.program.includes('"for":"dues"'))).toBe(true);
  expect(offers.some((g) => !g.program.includes('"for":"dues"'))).toBe(true);
});

test("the recipes' own data is as it was: no program of the default gold set carries line or the new kinds' data", () => {
  const gold = synthetic({ perFunction: 60, seed: 1 });
  expect(gold.some((g) => /^money\(.*\bline=/.test(g.program))).toBe(false);
  expect(gold.some((g) => g.tag !== undefined && KINDS.some((k) => LATE_TAGS[k] === g.tag))).toBe(false);
});

test("the needs_calculation refusals that state no share are made from the split programs, and only where there are any", () => {
  const splits = lateKinds({ kind: "split", n: 20, seed: 4, currencies: everyCurrency().slice(0, 3) });
  const withSplits = refusalBriefs(splits, 10, 3).filter((b) => b.label === "needs_calculation");
  const divided = withSplits.filter((b) => b.brief.includes("one sum paid out to several accounts"));
  expect(divided.length).toBe(5);
  for (const b of divided) {
    expect(b.brief).not.toMatch(/amount=/);
    expect(b.mustCopy.length).toBeGreaterThan(2);
  }
  // With none among the gold, no such brief, and the others are as they were.
  const plain = synthetic({ perFunction: 20, seed: 1, only: ["money"] });
  expect(refusalBriefs(plain, 10, 3).some((b) => b.brief.includes("one sum paid out to several accounts"))).toBe(false);
});

test("a plan takes the kinds by their tags (--only line_payment)", () => {
  const gold = lateKinds({ kind: "line", n: 10, seed: 1 });
  const plan = planOf(gold, { writers: ["a"], perGold: 1, only: ["line_payment"], seed: 1 } as any);
  expect(plan.length).toBeGreaterThan(5);
});
