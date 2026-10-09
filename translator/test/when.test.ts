// When a standing paper starts, and how a number of things is written (wave 2a's review of 2026-10-09, fault 5). A
// seat asked for a wage "first pay year 1, day 22"; the date was refused "as a length of time" with no second attempt,
// and the seat was told to write "a plain figure", which a date cannot be; "60,000" was refused as a number. Held
// here: both resolvers read a date or a length of time for `first` and `until` (contracts/test/when.json; the
// engine's reads the same file), a count takes the place's digit grouping as an amount does, whoever acts on a
// standing paper counts its first time by one rule, and a value the call could not be read at is tried once more
// before the seat is asked anything. (What the preview then says: translator/test/first-falls.test.ts.)

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical, firstDue } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import TABLE from "../../contracts/test/when.json";
import { createTranslator, Knowledge, ownWords } from "../src/index";
import { ONCE_IS_NOW, resolve } from "../src/resolver";

const DAY = 86_400;
interface Case { name: string; program: string; as?: string; blocks?: any[]; asks?: string[] }
const CASES = TABLE.cases as Case[];
const seat = () => { const k = new Knowledge(TABLE.currency); k.absorb(TABLE.observation as any); return k; };

test("a date or a length of time, as the shared table says; and what is neither", () => {
  expect(TABLE.reads.length).toBeGreaterThanOrEqual(30);
  for (const r of TABLE.reads as any[]) expect({ text: r.text, ...calls.parseWhen(r.text, TABLE.now) }).toEqual(r);
  for (const text of TABLE.refused) expect(() => calls.parseWhen(text, TABLE.now)).toThrow(`not a date or a duration: ${text}`);
  // A day with no year is a day of the year it now is; "tomorrow" is the day after the one it is read on.
  expect(calls.parseWhen("day 3", 400 * DAY)).toEqual({ at: 367 * DAY });
  expect(calls.parseWhen("tomorrow", 400 * DAY + 5)).toEqual({ at: 401 * DAY });
});

test("a count takes the place's digit grouping exactly as an amount does", () => {
  const cur = TABLE.currencies as { [name: string]: any };
  for (const c of TABLE.counts as any[]) expect({ ...c, count: calls.parseCount(c.text, cur[c.currency], c.zero === true) }).toEqual(c);
  for (const c of TABLE.not_counts) expect(() => calls.parseCount(c.text, cur[c.currency])).toThrow(`not a count: ${c.text}`);
  // (Each grouped count is the same digits an amount in a money with no decimals would be.)
  for (const c of (TABLE.counts as any[]).filter((x) => /[0-9]/.test(x.text))) expect(String(c.count)).toBe(calls.parseAmount(c.text, { ...cur[c.currency], minor_units: 0 }));
  // With no currency given, only bare digits and the small words, as before.
  expect(calls.parseCount("12")).toBe(12);
  expect(() => calls.parseCount("60,000")).toThrow("not a count");
});

test("every case of the shared table: the acts, or the questions back; and every act is one the contract accepts", () => {
  expect(JSON.stringify(TABLE.observation)).toBe(canonical(TABLE.observation));
  expect(CASES.length).toBeGreaterThanOrEqual(13);
  const k = seat();
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), k, () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
  expect(CASES.find((c) => c.program.includes('first="year 1, day 45")') && !c.program.includes("every"))!.asks).toEqual([ONCE_IS_NOW]);
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const valid = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  const request = ajv.getSchema(`${schemas.find((s) => s.$id.endsWith("outcomes")).$id}#/$defs/RequestData`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) {
    expect({ name: c.name, errors: valid(b) ? null : valid.errors }).toEqual({ name: c.name, errors: null });
    if (b.kind === "request") expect({ name: c.name, errors: request(b.data) ? null : request.errors }).toEqual({ name: c.name, errors: null });
  }
});

test("one reading of when a standing paper first falls due", () => {
  expect(firstDue({ at: 100, data: { every: 50 } }, 50)).toBe(150);
  expect(firstDue({ at: 100, data: { every: 50, first: 0 } }, 50)).toBe(100);
  expect(firstDue({ at: 100, data: { every: 50, first: 7 } }, 50)).toBe(107);
  expect(firstDue({ at: 100, data: { every: 50, first_at: 20 * DAY } }, 50)).toBe(20 * DAY);
  // A date before the day the paper was lodged is that day: nothing is made up for the time before it.
  expect(firstDue({ at: 30 * DAY + 500, data: { every: DAY, first_at: 2 * DAY } }, DAY)).toBe(30 * DAY);
});

// --- the translator: a value the call could not be read at

const ok = async () => ({ ok: true });
function scripted(programs: string[]) {
  let n = 0;
  const seen: string[] = [];
  const adapter = new MockAdapter("mock", { translator: (req: any) => (seen.push(JSON.stringify(req.messages)), [{ type: "tool_use", id: `c${n}`, name: "call", input: { program: programs[Math.min(n++, programs.length - 1)]! } }]) });
  return { io: { adapter, annotate: async () => {}, now: () => 0 }, calls: () => n, seen };
}
const ask = (programs: string[], proposal: string) => {
  const t = scripted(programs);
  return createTranslator(t.io, ok, () => undefined).translate({ draftId: "draft.finance-system.1", participant: "finance-system", as: "finance", proposal, knowledge: seat() }).then((r) => ({ r, t }));
};

test("a date the seat wrote for the first payment is drafted, first time", async () => {
  const { r, t } = await ask(['money(to=acc-c0003, amount="2,393.34", from=acc-city, every="every 14 days", first="year 1, day 45", for="wages")'],
    "Set up a standing payment from acc-city to acc-c0003 of 2,393.34 every 14 days for wages, first payment year 1, day 45.");
  expect(r.ok).toBe(true);
  expect(t.calls()).toBe(1);
  if (r.ok) expect((r.draft.blocks[0] as any).data).toMatchObject({ every: 14 * DAY, first_at: 44 * DAY });
});

test("the seat's own words copied where a length of time goes: the call is tried once more, and only then is the seat asked, about those words", async () => {
  const proposal = "Levy the rate from acc-city to acc-c0003, 100 at each instalment the rating law sets.";
  const bad = 'money(to=acc-c0003, amount="100", from=acc-city, every="at each instalment the rating law sets")';
  // A second attempt that reads the request rightly gives a draft, and the seat is told nothing of the first.
  const second = await ask([bad, 'money(to=acc-c0003, amount="100", from=acc-city)'], proposal);
  expect(second.r.ok).toBe(true);
  expect(second.t.calls()).toBe(2);
  expect(second.t.seen[1]).toContain("can't be read as a length of time");
  expect((second.r as any).retries).toHaveLength(1);
  // One that does no better: the seat is asked, once, about its own words, in terms it can answer.
  const still = await ask([bad], proposal);
  expect(still.t.calls()).toBe(2);
  expect(still.r).toMatchObject({ ok: false, asked_back: true, notices: ['"at each instalment the rating law sets", in what you asked, could not be read as a length of time. Please say it again with that written as a number of days, weeks or months, like "14 days".'] });
  // One that gives the request up: the seat is still asked about the words, not told its request was unclear.
  const gaveUp = await ask([bad, "none(unclear)"], proposal);
  expect(gaveUp.t.calls()).toBe(2);
  expect(gaveUp.r).toMatchObject({ ok: false, asked_back: true, notices: still.r.ok ? [] : still.r.notices });
});

test("what a seat is asked of a when it wrote that is neither a date nor a length of time", async () => {
  const { r, t } = await ask(['money(to=acc-c0003, amount="100", from=acc-city, every="monthly", first="next Tuesday")'], "Pay acc-c0003 100 monthly from acc-city, starting next Tuesday.");
  expect(t.calls()).toBe(2);
  expect(r).toMatchObject({ ok: false, asked_back: true, notices: ['"next Tuesday", in what you asked, could not be read as a date or a length of time. Please say it again with a date, written like "year 1, day 12", or a length of time from now, like "14 days".'] });
  expect(ownWords("60.000", "a number")).toBe('"60.000", in what you asked, could not be read as a number. Please say it again with that number written in figures.');
});

test("a date already past is the seat's to answer, and is put to it as it is", async () => {
  const { r, t } = await ask(['money(to=acc-c0003, amount="100", from=acc-city, every="monthly", first="year 1, day 1")'], "Pay acc-c0003 100 monthly from acc-city, from year 1, day 1.");
  expect(t.calls()).toBe(1);
  expect(r).toMatchObject({ ok: false, notices: ["year 1, day 1 is already past: today is year 1, day 31. Give today's date or a later one, or a length of time from now."] });
});
