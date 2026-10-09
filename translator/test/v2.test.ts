// The cases banked for a later translator (translator/train/v2.ts): plain-text turns whose right reading is one of a
// seat's other tools. What a turn must carry, what counts as the same reading, and that the tools here are the seat's.
import { expect, test } from "bun:test";
import { tools } from "@oikos/participants/llm";
import { kindOf, mustCarry, notCarried, readerUses, sameUse, sameUses, useOf, v2Brief, v2Generated, v2Plan, V2_ANSWER, V2_DEAL, V2_STYLES, V2_TOOLS, v2ReaderSystem, v2WriterSystem, type Use } from "../train/v2";

test("the tools and their inputs are the seat's own, as its participant defines them", () => {
  const reports = new Map([["me/files", "records"], ["me/who", "directory"], ["me/sites", "sites"]]);
  const seat = tools({ participant: "x", titles: new Map(), kinds: reports, standing: [], framing: { disclosure: "simulation" }, sessions: true, trays: true, cadenceDays: 7 } as any);
  const byName = new Map(seat.map((t) => [t.name, Object.keys((t.input_schema as any).properties ?? {})]));
  expect([...byName.keys()].sort()).toEqual([...V2_TOOLS].sort());
  for (const name of V2_TOOLS) {
    // Every input the seat's tool has is one this keeps, and this keeps no input the tool doesn't have.
    const kept = Object.keys(useOf(name, Object.fromEntries(byName.get(name)!.map((k) => [k, "x"])))!.input);
    expect(kept.sort()).toEqual([...byName.get(name)!].sort());
    expect(useOf(name, { nonsense: 1 })!.input).toEqual({});
  }
  expect(useOf("fly", {})).toBeUndefined();
  // (The reader is told of each tool, and hands in each of its inputs.)
  for (const name of V2_TOOLS) { expect(v2ReaderSystem()).toContain(`- ${name}(`); for (const k of byName.get(name)!) expect(Object.keys((V2_ANSWER as any).properties.answers.items.properties.uses.items.properties)).toContain(k); }
});

test("generated cases are the same for a seed, cover every tool but an act and every way of looking, and carry who asks", () => {
  const a = v2Generated({ n: 400, seed: 2 });
  expect(v2Generated({ n: 400, seed: 2 })).toEqual(a);
  expect(a.length).toBe(400);
  const kinds = new Set(a.map((x) => x.case.kind));
  for (const k of ["look:report", "look:paper", "look:about", "look:find", "look:named", "look:each_sitting", "look:narrowed", "write", "notebook:add", "notebook:change", "notebook:afresh", "done_for_now", "confirm:confirm", "confirm:decline", "opt_out", "turn"]) expect(kinds.has(k)).toBe(true);
  expect(a.some((x) => x.case.uses.some((u) => u.tool === "do"))).toBe(false);
  expect(new Set(a.map((x) => x.asker)).size).toBeGreaterThan(8);
  for (const x of a) {
    for (const u of x.case.uses) if (u.tool === "look") expect(x.case.knows.reports.map((r) => r.id)).toContain(u.input.report);
    for (const u of x.case.uses) if (u.tool === "confirm") expect(x.case.knows.awaiting).toContain(u.input.ref);
    expect(kindOf(x.case.uses)).toBe(x.case.kind);
  }
  const plan = v2Plan(a, { writers: ["w1", "w2", "w3"], seed: 2 });
  expect(new Set(plan.map((t) => t.id)).size).toBe(plan.length);
  expect(new Set(plan.map((t) => t.style))).toEqual(new Set(V2_DEAL));
  for (const s of V2_DEAL) expect(V2_STYLES[s]).toBeString();
  expect(plan[0]!.brief).toBe(v2Brief(a[0]!.case, V2_DEAL[0]!, a[0]!.asker));
  expect(plan[0]!.brief).toContain("Who is asking");
  expect(v2WriterSystem()).toContain("no tools");
});

test("a turn must carry everything its uses hold, and name no tool", () => {
  const look: Use = { tool: "look", input: { report: "finance/files", about: "rec.1154", since: "year 1, day 25", limit: 12 } };
  expect(mustCarry(look)).toEqual({ words: ["year 1, day 25"], ids: ["finance/files", "rec.1154"], numbers: [12] });
  expect(notCarried("In my files (finance/files), show me at most 12 papers that name rec.1154 since year 1, day 25.", [look])).toBeUndefined();
  expect(notCarried("Show me at most 12 papers that name rec.1154 since year 1, day 25.", [look])).toMatch(/id not there: finance\/files/);
  expect(notCarried("In finance/files, show me papers that name rec.1154 since year 1, day 25.", [look])).toMatch(/number not there: 12/);
  expect(notCarried("In finance/files, 12 papers about rec.11540 since year 1, day 25.", [look])).toMatch(/id not there: rec\.1154/);
  const letter: Use = { tool: "write", input: { to: ["c0874", "works"], text: "Mayor,\n\nThe roof is done.\nPlease pay the builder.", about: "rec.9" } };
  // (A letter's line breaks may be the turn's or run on; its words may not change.)
  expect(notCarried("Write to c0874 and works about rec.9: Mayor, The roof is done. Please pay the builder.", [letter])).toBeUndefined();
  expect(notCarried("Write to c0874 and works about rec.9: Mayor, the roof is done, please pay the builder.", [letter])).toMatch(/words not as written/);
  const done: Use = { tool: "done_for_now", input: { days: 14, hold: ["news"] } };
  expect(notCarried("That's all. I'm back in 14 days; news can wait.", [done])).toBeUndefined();
  expect(notCarried("done_for_now, 14 days, news can wait.", [done])).toMatch(/a tool's own name/);
  expect(notCarried("I am done. days: [14], hold news.", [done])).toMatch(/a tool's own name/);
  // (What a letter itself says is looked past: a letter may say anything.)
  expect(notCarried("Write to c1: \"your opt_out was noted\".", [{ tool: "write", input: { to: ["c1"], text: "your opt_out was noted" } }])).toBeUndefined();
});

test("two readings are the same use where the ids, numbers and choices are the same and the words are as written", () => {
  const u = (tool: Use["tool"], input: Use["input"]): Use => ({ tool, input });
  expect(sameUse(u("look", { report: "a/files", paper: "rec.1" }), u("look", { report: "a/files", paper: "rec.1" }))).toBe(true);
  expect(sameUse(u("look", { report: "a/files", paper: "rec.1" }), u("look", { report: "a/files", about: "rec.1" }))).toBe(false);
  expect(sameUse(u("look", { report: "a/files" }), u("look", { report: "a/files", current_only: false }))).toBe(true);
  expect(sameUse(u("look", { report: "a/files", each_sitting: false }), u("look", { report: "a/files" }))).toBe(false);
  expect(sameUse(u("look", { report: "a/who", named: ["c1", "mayor"] }), u("look", { report: "a/who", named: ["mayor", "c1"] }))).toBe(true);
  expect(sameUse(u("look", { report: "a/files", find: [{ field: "kind", value: "budget" }] }), u("look", { report: "a/files", find: [{ field: "Kind", op: "=", value: "Budget" }] }))).toBe(true);
  expect(sameUse(u("look", { report: "a/files", limit: 20 }), u("look", { report: "a/files" }))).toBe(false);
  expect(sameUse(u("write", { to: ["c1"], text: "The roof is done." }), u("write", { to: ["c1"], text: "\"The roof is done\"" }))).toBe(true);
  expect(sameUse(u("write", { to: ["c1"], text: "The roof is done." }), u("write", { to: ["c1"], text: "The roof is mended." }))).toBe(false);
  expect(sameUse(u("write", { to: ["c1"], text: "x" }), u("write", { to: ["c2"], text: "x" }))).toBe(false);
  expect(sameUse(u("notebook", { change: [{ from: "old line", to: "" }] }), u("notebook", { change: [{ from: "old line", to: "" }] }))).toBe(true);
  expect(sameUse(u("notebook", { add: "a" }), u("notebook", { text: "a" }))).toBe(false);
  expect(sameUse(u("done_for_now", { days: 3 }), u("done_for_now", {}))).toBe(false);
  expect(sameUse(u("done_for_now", { hold: [] }), u("done_for_now", {}))).toBe(false);
  expect(sameUse(u("confirm", { ref: "draft.m.1", decision: "confirm" }), u("confirm", { ref: "draft.m.1", decision: "decline" }))).toBe(false);
  expect(sameUse(u("do", { what: "Pay acc-1 500." }), u("write", { to: ["acc-1"], text: "Pay acc-1 500." }))).toBe(false);
  expect(sameUses([u("look", { report: "a/files" }), u("done_for_now", { days: 2 })], [u("done_for_now", { days: 2 }), u("look", { report: "a/files" })])).toBe(false);
  // A reader's flat answer is read as the tool has it: numbers and yes-or-no from their strings, empty parts dropped.
  expect(readerUses({ id: "x", uses: [{ tool: "look", report: "a/files", limit: "12", each_sitting: "true", paper: "", named: [] }, { tool: "done_for_now", days: "14", hold: [] }, { tool: "write", to: ["c1"], text: "hello", hold: [] }] }))
    .toEqual([u("look", { report: "a/files", limit: 12, each_sitting: true }), u("done_for_now", { days: 14, hold: [] }), u("write", { to: ["c1"], text: "hello" })]);
  expect(readerUses({ id: "x" })).toEqual([]);
});
