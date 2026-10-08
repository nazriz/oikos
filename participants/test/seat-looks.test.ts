// What a look answers (participants/src/llm/render.ts and participant.ts; live check 2 of 2026-10-09, findings 5 and
// 11): a list is gone through a part at a time and each part is the next one; an answer says what was searched, so that
// nothing found is never mistaken for nothing looked at; a paper is set out under one heading, and a heading with
// several papers says what came.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { inCurrency } from "../src/money";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";
import { renderObservation } from "../src/llm/render";

inCurrency(PROFILE.values.currency as any);
const DAY = 86_400;
const obs = (channels: any, extra: any = {}) => ({ participant: "works", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels, ...extra }) as any;
const papers = Array.from({ length: 45 }, (_, i) => ({ id: `rec.${100 + i}`, record: "statement", kind: "service_address", author: "works", speaks_for: "city", at: i * DAY, visible_to: ["city"], text: `Round: house-${i}.` }));
const newest = [...papers].reverse();
const o = { titles: new Map([["works/round", "Works manager: Round"]]), lookable: new Set(["works/round"]) };
const page = (looked: object, records: object[] = newest) => renderObservation(obs({ "works/round": { kind: "records", search: true, records } }), { ...o, looked: new Map([["works/round", looked]]) });

test("a list is gone through a part at a time, and each part is the next", () => {
  // The first look: twenty, the newest first, and how to go on.
  const first = page({ limit: 20 }, newest.slice(0, 20));
  expect(first).toContain("- [rec.144] service address");
  expect(first).toContain("- [rec.125] service address");
  expect(first).not.toContain("[rec.124]");
  expect(first).toContain("(There may be more: at most 20 were asked for. For the next: look again the same way with from_entry: 21.)");
  // The next: the twenty after those, not the same twenty (a look at the round gave the same addresses each time).
  const second = page({ limit: 20, fromEntry: 21, fetched: 200 });
  expect(second).toContain("## Works manager: Round: what you looked up (20 found)");
  expect(second).toContain("- [rec.124] service address");
  expect(second).toContain("- [rec.105] service address");
  expect(second).not.toContain("[rec.125]");
  expect(second).toContain("(Entries 21 to 40 of 45. For the next: look again the same way with from_entry: 41.)");
  // The last, and past the end.
  const third = page({ limit: 20, fromEntry: 41, fetched: 200 });
  expect(third).toContain("(5 found)");
  expect(third).toContain("- [rec.100] service address");
  expect(third).not.toContain("For the next");
  expect(page({ limit: 20, fromEntry: 61, fetched: 200 })).toContain("(Nothing from entry 61 on: there are 45.)");
});

test("an answer says what was searched: the folder, how much of it, over what span; nothing found is not nothing looked at", () => {
  expect(page({ limit: 20, fromEntry: 21, fetched: 200 })).toContain('(Looked in "Works manager: Round" (works/round). The latest 45 papers there that could match (year 1, day 1 to year 1, day 45) were read through: that is all of them.)');
  expect(page({ limit: 20, said: "where kind = complaint" }, [])).toContain('## Works manager: Round: what you looked up (0 found)\nNothing found.\n(Looked in "Works manager: Round" (works/round), for: where kind = complaint. Everything kept there was searched: nothing there matches.)');
  // Narrowed here, among the latest that one search gives: none found there is not none there, and it says so.
  const many = Array.from({ length: 200 }, (_, i) => ({ ...papers[0]!, id: `rec.${1000 - i}`, at: (400 - i) * DAY }));
  const through = page({ limit: 20, about: "acc-city", fetched: 200, said: "about acc-city" }, many);
  expect(through).toContain("Nothing found.\n(Not found among those read through, which is not the same as not there: say more closely what to find (a kind, a date, who from), to reach earlier papers.)");
  expect(through).toContain("The latest 200 papers there that could match (year 1, day 202 to year 2, day 36) were read through; there are earlier ones that were not, so this is not everything there.");
  // A folder looked into whole with nothing new says where it looked, and that what was there is still there.
  expect(renderObservation(obs({ "works/round": { kind: "records", records: [] } }), { ...o, looked: new Map([["works/round", {}]]) })).toContain('Nothing new there since you last looked.\n(Looked in "Works manager: Round" (works/round) for what has come into it since you last looked there: nothing has.');
  // Who's who, and places: what was looked in is said too.
  expect(renderObservation(obs({ who: { kind: "directory", entities: [], positions: [] } }), { looked: new Map([["who", { named: ["roads office"] }]]) })).toContain("nothing is entered under roads office");
});

test("a paper that reaches a seat under two headings is set out once, under the narrower; a heading with several papers says what came", () => {
  const complaint = (i: number) => ({ id: `rec.${i}`, record: "statement", kind: "complaint", author: `c${i}`, at: 5, visible_to: ["city"], addressed_to: ["city"], text: `Waste not collected at house-${i}.` });
  const notice = { id: "rec.900", record: "statement", kind: "notice", author: "bank", at: 5, visible_to: ["city"], addressed_to: ["city"], text: "A notice." };
  const twelve = Array.from({ length: 12 }, (_, i) => complaint(i + 1));
  const out = renderObservation(obs({ "works/works-business": { kind: "records", records: [...twelve, notice] }, "works/budgets": { kind: "records", records: twelve } }), { titles: new Map([["works/works-business", "Works manager: Works-business"], ["works/budgets", "Works manager: Budgets"]]) });
  expect(out).toContain("## Works manager: Budgets (12 new)\n(What came: 12 complaints.)");
  expect(out).toContain("## Works manager: Works-business (1 new)\n- [rec.900] notice");
  expect(out.match(/Waste not collected at house-3\./g)!.length).toBe(1);
});

test("the seat's look with from_entry asks for the list from there on, and is told what it asked for", async () => {
  const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
  const calls: LlmRequest[] = [];
  const answers = [[use("a", "look", { report: "works/round", from_entry: 21 })], [use("d", "done_for_now", {})]];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => (calls.push(JSON.parse(JSON.stringify(req))), { content: answers[n++] ?? [use("e", "done_for_now", {})], usage: { input_tokens: 1, output_tokens: 1 } }) };
  const c: LlmParticipantConfig = { participant: "works-system", entity: "city", title: "Works manager", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map([["works/round", "Works manager: Round"]]),
    kinds: new Map([["works/round", "records"]]), cadenceDays: 7, draftText: () => "" };
  const p = createLlmParticipant(c, { adapter, annotate: async () => {}, now: () => 0 } as any);
  const ctx = { world: { currency: PROFILE.values.currency } } as any;
  const at = (t: number, round: object) => ({ t, channels: { "works/round": round }, outcomes: [], inbox: [], drafts: [], positions: [{ position: "works", entity: "city", title: "Works manager" }] }) as unknown as Observation;
  // The look it makes: as many as one search gives, newest first; the part asked for is taken from them.
  expect(await p.step(at(9 * 3600, { kind: "records", records: [] }), ctx)).toEqual({ type: "look", looks: [{ channel: "works/round", query: { order: { field: "at", desc: true }, limit: 200 } }] });
  await p.step(at(9 * 3600 + 60, { kind: "records", search: true, records: newest }), ctx);
  const shown = (calls[1]!.messages.at(-1)!.content as any[]).map((b) => b.content ?? b.text ?? "").join("\n");
  expect(shown).toContain("- [rec.124] service address");
  expect(shown).not.toContain("[rec.144]");
  expect(shown).toContain("(Entries 21 to 40 of 45. For the next: look again the same way with from_entry: 41.)");
});
