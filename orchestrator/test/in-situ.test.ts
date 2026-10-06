// Translator training requests written in situ (src/in-situ.ts), on a small log made by hand: the situations a log
// holds and which of them are marked test; the seats' real requests that are no test case; chunks for writers and
// their size; writers' files taken in; and two readers' answers made into examples.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, encode } from "../../translator/model/encode";
import { blindFile, briefOf, chunksFor, inSitu, inSituInstructions, label, realRequests, situationsOf, takeIn, takeInFiles, type Brief, type Situation, type TestRef } from "../src/in-situ";

const root = join(import.meta.dir, "../..");
const dir = join(root, "runs", "test-in-situ");
const DAY = 86_400;
const RUN = "runs/test-in-situ";

// ---- a log by hand: one model seat (clerk-system) over three days, a seat the log kept no observations of
// (warden-system), and a seat run by the mock.
const SYSTEM = "You are the clerk, acting for the town (town).\nOn file:\n- [law-stalls] Stalls need a permit.";
const FORM = { id: "form-stall", record: "statement", kind: "form", author: "genesis", speaks_for: "town", at: 0, visible_to: "public", text: "Stall permit.", data: { form: "stall_permit", submit_to: ["town"], fields: { lot: { type: "lot", required: true }, notes: { type: "text" } } } };
const OLD_FORM = { ...FORM, id: "form-old", data: { ...FORM.data, form: "old_permit" } };
const FORM_LINE = "- stall_permit, to=town, id form-stall: fields lot (lot, required), notes (text)";
const R1 = "Pay acc-b 500 from acc-town for the stall deposit.";
const R2 = "Direct the warden [warden] to clear the stalls from lot-3 before the market opens on day 4, and to report back.";
const R3 = "Fill in the stall permit for lot-3.";
const R5 = "Show me every payment out of acc-town since day 1.";
const R6 = "Pay acc-c 40 from acc-town.";
const R7 = "Tell the clerk [clerk] to open the gates.";
const TESTS: TestRef[] = [
  { run: RUN, seat: "clerk", day: 0, draft: "draft.clerk-system.2", request: R2 },
  // (A test case of another run: its words are never a training request, whoever says them.)
  { run: "runs/elsewhere", seat: "mayor", day: 9, draft: "draft.mayor-system.4", request: R5 },
];

let seq = 0;
const entry = (t: number, kind: string, body: object) => JSON.stringify({ seq: seq++, t, kind, body });
const ann = (t: number, annotation: string, rest: object) => entry(t, "annotation", { annotation, ...rest });
const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const result = (id: string, content: string) => ({ type: "tool_result", tool_use_id: id, content });
const said = (t: number, subject: string, turn: number, input: unknown, output: unknown[], o: { system?: string; hash?: string; provider?: string; purpose?: string; ref?: string } = {}) =>
  ann(t, "transcript", { subject, data: { purpose: o.purpose ?? "participant", ...(o.ref ? { ref: o.ref } : {}), t, provider: o.provider ?? "codex", model: "some-model", system_sha256: o.hash ?? "hash-clerk", ...(o.system ? { system: o.system } : {}), turn, input, output } });
const drafted = (t: number, who: string, n: number, proposal: string, forms: string[]) => [
  said(t, "translator", 1, `Request: ${proposal}${forms.length ? `\n\nForms this person knows of:\n${forms.join("\n")}` : ""}`, [use("t", "call", { program: "none(unclear)" })], { purpose: "translator", ref: `draft.${who}.${n}`, hash: "hash-translator", ...(n === 1 ? { system: "You translate." } : {}) }),
  ann(t, "draft", { draft: { id: `draft.${who}.${n}`, participant: who, proposal, call: "none(unclear)", blocks: [], summary: "", check: { ok: true } } }),
];
const LOG = [
  entry(0, "header", { run_id: "town.seed1", config: { world: { currencies: [{ code: "XTS", minor_units: 2, symbol: "¤" }] } } }),
  ann(10, "observation", { subject: "clerk-system", data: { t: 10, observation: { channels: [{ path: "clerk/forms", kind: "records", records: [FORM, OLD_FORM, { id: "rec.9", record: "withdrawal", withdraws: "form-old" }] }] } } }),
  // Day 0, a sitting of three turns: a request; then the test case and another request; then nothing more.
  said(100, "clerk-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 1.\nYou hold a post: Clerk (clerk), for town.", [use("u1", "do", { what: R1, as: "clerk" }), use("u2", "notebook", { text: "Day 1." })], { system: SYSTEM }),
  // (Until 2026-10-06 the translator was shown a form without its record's id.)
  ...drafted(101, "clerk-system", 1, R1, ["- stall_permit, to=town: fields lot (lot, required), notes (text)"]),
  said(102, "clerk-system", 3, [result("u1", "Before this goes ahead (draft.clerk-system.1), here is exactly what will happen: 500 moves."), result("u2", "Notebook updated.")], [{ type: "text", text: "Two more things." }, use("u3", "do", { what: R2 }), use("u4", "do", { what: R3 })]),
  said(103, "translator", 1, `Request: ${R2}\n\nForms this person knows of:\n${FORM_LINE}`, [], { purpose: "translator", ref: "draft.clerk-system.2", hash: "hash-translator" }),
  ann(103, "translation_failure", { subject: "clerk-system", data: { draft: "draft.clerk-system.2", proposal: R2, reason: "no call came back" } }),
  ...drafted(104, "clerk-system", 3, R3, [FORM_LINE]),
  said(105, "clerk-system", 5, [result("u3", "That couldn't be put into effect."), result("u4", "Before this goes ahead (draft.clerk-system.3) …")], [use("u5", "done_for_now", { days: 1 })]),
  // Day 1: it is told what of its own wasn't done, by its first words (the test case's); and says its first request again.
  said(DAY + 100, "clerk-system", 1, `Your notebook: Day 1.\n\nWhen you were last here, what you asked for ("${R2.slice(0, 80)}…") was not done: it couldn't be read.\n\nIt is year 1, day 2.`, [use("u6", "do", { what: R1 })]),
  ...drafted(DAY + 101, "clerk-system", 4, R1, [FORM_LINE]),
  // Day 2: a request taken up on the next day, and one never taken up. Day 3: one in another run's test case's exact words.
  said(2 * DAY + 100, "clerk-system", 1, "Your notebook: Day 2.\n\nIt is year 1, day 3.", [use("u8", "do", { what: R6 }), use("u9", "do", { what: "Close acc-old." })]),
  ...drafted(3 * DAY + 5, "clerk-system", 6, R6, [FORM_LINE]),
  said(3 * DAY + 100, "clerk-system", 1, "Your notebook: Day 3.\n\nIt is year 1, day 4.", [use("u7", "do", { what: R5 })]),
  ...drafted(3 * DAY + 101, "clerk-system", 5, R5, [FORM_LINE]),
  // Day 4: a turn whose earlier turns the log doesn't hold.
  said(4 * DAY + 100, "clerk-system", 7, [result("u0", "Noted.")], [use("u10", "done_for_now", {})]),
  // A seat the log kept no observations of: the forms it knew are those the translator was shown with its request.
  said(4 * DAY + 200, "warden-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 5.", [use("w1", "write", { to: ["clerk"], text: "Done." })], { system: "You are the warden.", hash: "hash-warden" }),
  said(5 * DAY + 200, "warden-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 6.", [use("w2", "do", { what: R7 })], { hash: "hash-warden" }),
  ...drafted(5 * DAY + 201, "warden-system", 1, R7, [FORM_LINE]),
  // A call whose system prompt the log doesn't hold, and a seat run by the mock: neither is a situation.
  said(5 * DAY + 300, "stranger-system", 1, "Your notebook: (empty)", [], { hash: "hash-nowhere" }),
  said(5 * DAY + 400, "mock-system", 1, "Your notebook: (empty)", [use("m1", "do", { what: "Pay acc-b 1." })], { provider: "mock", system: "You are a stand-in.", hash: "hash-mock" }),
];
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const logPath = join(dir, "town.seed1.jsonl");
writeFileSync(logPath, LOG.join("\n") + "\n");
const read = await situationsOf(logPath, { tests: TESTS });
const at = (id: string) => read.situations.find((x) => x.id === `test-in-situ/${id}`)!;
const rows = <T = any>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

test("a situation for every time a model seat was asked what to do: its prompt as sent, and what it was shown, the sitting so far", () => {
  expect(read.situations.map((x) => x.id)).toEqual(["d0/1", "d0/2", "d0/3", "d1/1", "d2/1", "d3/1", "d4/1"].map((x) => `test-in-situ/clerk-system/${x}`).concat(["test-in-situ/warden-system/d4/1", "test-in-situ/warden-system/d5/1"]));
  expect(read).toMatchObject({ no_system: 1, unmatched_drafts: 0 });
  const first = at("clerk-system/d0/1");
  expect(first).toMatchObject({ run: RUN, seat: "clerk-system", day: 0, n: 1, turn: 1, model: "codex/some-model", system: SYSTEM, currency: { code: "XTS" } });
  expect(first.shown).toBe("Your notebook: (empty)\n\nIt is year 1, day 1.\nYou hold a post: Clerk (clerk), for town.");
  // A later turn is shown the sitting so far: what it was first shown, what it did, and what came back, by number.
  const second = at("clerk-system/d0/2");
  expect(second.system).toBe(SYSTEM); // (sent again, though the log holds it once)
  expect(second.shown).toBe(`${first.shown}\n\nWhat you did then:\n1. do: ${JSON.stringify({ what: R1, as: "clerk" })}\n2. notebook: {"text":"Day 1."}\n\nWhat came back:\n1. (do) Before this goes ahead (draft.clerk-system.1), here is exactly what will happen: 500 moves.\n2. (notebook) Notebook updated.`);
  expect(at("clerk-system/d0/3").shown).toContain("(said) Two more things.");
  // A turn the log doesn't hold the beginning of is marked, and is shown that turn's part alone.
  expect(at("clerk-system/d4/1")).toMatchObject({ partial: true, turn: 7, shown: "What came back:\nNoted." });
  expect(first.partial).toBeUndefined();
});

test("the forms a seat knew of, as the translator is shown them: what it had been shown, less what was withdrawn; with no observations kept, what the translator was shown", () => {
  expect(at("clerk-system/d0/1").forms).toEqual([FORM_LINE]);
  // The translator was shown the form without its id (the older way): the request's forms have it as it is shown today.
  expect(at("clerk-system/d0/1").requests).toEqual([{ request: R1, test: false, draft: "draft.clerk-system.1", drafted_on: 0, forms: [FORM_LINE] }]);
  // The warden's forms come from its own request's translation, also for the day before it.
  expect(at("warden-system/d4/1").forms).toEqual([FORM_LINE]);
  expect(at("warden-system/d5/1").forms).toEqual([FORM_LINE]);
});

test("a test case marks its situation, the turns after it in its sitting, and any situation that quotes it; nothing else", () => {
  expect(read).toMatchObject({ tests_found: 1, tests_missing: [] });
  expect(at("clerk-system/d0/2").requests.map((r) => [r.draft, r.test])).toEqual([["draft.clerk-system.2", true], ["draft.clerk-system.3", false]]);
  expect(Object.fromEntries(read.situations.map((x) => [x.id.replace("test-in-situ/", ""), x.test]))).toEqual({
    "clerk-system/d0/1": false, "clerk-system/d0/2": true, "clerk-system/d0/3": true, // (the third is shown the second's requests)
    "clerk-system/d1/1": true, // (told what wasn't done, in the test case's first words)
    "clerk-system/d3/1": true, // (it asked for something in the very words of a test case, though another run's)
    "clerk-system/d2/1": false, "clerk-system/d4/1": false, "warden-system/d4/1": false, "warden-system/d5/1": false,
  });
  // A test case that isn't in the log is said to be missing; one of another run isn't looked for.
  const more = [...TESTS, { run: RUN, seat: "clerk", day: 3, draft: "draft.clerk-system.6", request: "?" }, { run: RUN, seat: "clerk", day: 9, draft: "draft.clerk-system.3", request: R3 }, { run: RUN, seat: "clerk", day: 1, draft: "draft.clerk-system.99", request: "?" }];
  return situationsOf(logPath, { tests: more }).then((r) => {
    expect(r.tests_missing).toEqual(["draft.clerk-system.99"]);
    // (A request said on one day and taken up on the next is the test case of the day its draft was made.)
    expect(r.situations.find((x) => x.id.endsWith("clerk-system/d2/1"))!.requests[0]).toMatchObject({ draft: "draft.clerk-system.6", drafted_on: 3, test: true });
    // (And a case whose day isn't the log's, as after a run was stopped and resumed, is still found by its draft and its words.)
    expect(r.situations.find((x) => x.id.endsWith("clerk-system/d0/2"))!.requests[1]).toMatchObject({ draft: "draft.clerk-system.3", test: true });
    expect(r.tests_found).toBe(3);
  });
});

test("the seats' real requests for readers: no test case, nothing in a test case's exact words, nothing said twice", () => {
  const { requests, counts } = realRequests(read.situations, TESTS);
  expect(counts).toEqual({ asked: 8, test: 1, same_as_test: 1, starts_as_test: 0, said_before: 1, no_forms: 0, kept: 5 });
  // One that begins as a test case does (the same request, ended otherwise) is left out as well.
  const likeTest = { ...at("clerk-system/d2/1"), requests: [{ request: `${R2.slice(0, 70)} noon.`, test: false }] };
  expect(realRequests([likeTest], TESTS).counts).toMatchObject({ starts_as_test: 1, kept: 0 });
  expect(requests.map((r) => r.id)).toEqual(["test-in-situ/draft.clerk-system.1", "test-in-situ/draft.clerk-system.3", "test-in-situ/draft.clerk-system.6", "test-in-situ/clerk-system/d2/1/do-2", "test-in-situ/draft.warden-system.1"]);
  expect(requests[0]).toEqual({ id: "test-in-situ/draft.clerk-system.1", request: R1, forms: [FORM_LINE], from: { situation: "test-in-situ/clerk-system/d0/1", writer: "codex/some-model (seat)", draft: "draft.clerk-system.1" }, currency: { code: "XTS", minor_units: 2, symbol: "¤" } });
  expect(requests.some((r) => r.request === R2 || r.request === R5)).toBe(false);
  // One never taken up is still what a seat asked: it has its situation's forms.
  expect(requests[3]).toMatchObject({ request: "Close acc-old.", forms: [FORM_LINE] });
});

test("chunks for writers: no more than a third of a run's seat-days each, spread through it, a different third for each writer, and no chunk over its size", () => {
  // Two runs: one seat over 30 days with three turns a day, and two seats over 9 days.
  const b = (run: string, seat: string, day: number, n: number, o: Partial<Brief> = {}): Brief => ({ id: `${run}/${seat}/d${day}/${n}`, run, seat, day, n, size: 30_000, test: false, partial: false, asked: 0, ...o });
  const briefs = [
    ...Array.from({ length: 30 }, (_, day) => [1, 2, 3].map((n) => b("runs/a", "mayor", day, n, { ...(day === 3 && n === 2 ? { test: true } : {}), ...(day === 6 && n === 3 ? { asked: 1 } : {}), ...(day === 9 ? { size: 130_000 } : {}), ...(day === 12 && n > 1 ? { partial: true } : {}), ...(day === 12 && n === 1 ? { asked: 2 } : {}) }))).flat(),
    ...["finance", "mayor"].flatMap((seat) => Array.from({ length: 9 }, (_, day) => b("runs/b", seat, day, 1, { size: 70_000 }))),
  ];
  const { chunks, report, too_large } = chunksFor(briefs, ["one", "two"], { maxChars: 120_000, seed: 5 });
  const size = new Map(briefs.map((x) => [x.id, x]));
  for (const w of ["one", "two"]) {
    const ids = chunks[w]!.flat();
    // No more than a third of each run's seat-days, one turn of each, and spread: every third day of a seat.
    expect(report[w]!.by_run["runs/a"]!.seat_days).toBe(30);
    expect(report[w]!.by_run["runs/a"]!.used).toBeLessThanOrEqual(10);
    expect(report[w]!.by_run["runs/b"]).toEqual({ seat_days: 18, used: 6 });
    expect(new Set(ids.map((id) => id.slice(0, id.lastIndexOf("/")))).size).toBe(ids.length);
    const days = ids.filter((id) => id.startsWith("runs/a/")).map((id) => size.get(id)!.day).sort((x, y) => x - y);
    for (let i = 1; i < days.length; i++) expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(3);
    // Nothing marked test, nothing of a day with a test turn in it, nothing partial, nothing too large.
    for (const id of ids) expect(size.get(id)).toMatchObject({ test: false, partial: false });
    expect(ids.some((id) => id.startsWith("runs/a/mayor/d3/") || id.startsWith("runs/a/mayor/d9/"))).toBe(false);
    // Each chunk within its size, as reported; a 70,000-character situation is alone in its chunk.
    chunks[w]!.forEach((c, i) => {
      expect(c.reduce((n, id) => n + size.get(id)!.size, 0)).toBe(report[w]!.sizes[i]!);
      expect(report[w]!.sizes[i]!).toBeLessThanOrEqual(120_000);
    });
    expect(report[w]).toMatchObject({ situations: ids.length, chunks: chunks[w]!.length });
  }
  // The two writers are given different days.
  expect(chunks.one!.flat().filter((id) => chunks.two!.flat().includes(id))).toEqual([]);
  // Of a day's turns, the one where the seat itself asked for something; those turns come first.
  expect(chunks.one!.flat().slice(0, 2)).toEqual(["runs/a/mayor/d6/3", "runs/a/mayor/d12/1"]);
  expect(report.one!.where_the_seat_asked).toBe(2);
  expect(too_large).toBe(3);
  // The same seed, the same chunks; a smaller chunk, more of them.
  expect(chunksFor(briefs, ["one", "two"], { maxChars: 120_000, seed: 5 }).chunks).toEqual(chunks);
  expect(chunksFor(briefs, ["one"], { maxChars: 50_000, seed: 5 }).chunks.one!.every((c) => c.length === 1)).toBe(true);
  expect(briefOf(at("clerk-system/d0/2"))).toMatchObject({ run: RUN, seat: "clerk-system", day: 0, n: 2, test: true, asked: 1, size: SYSTEM.length + at("clerk-system/d0/2").shown.length });
});

test("the command's files: situations, the real requests and their blind file, the writers' instructions and chunks; no test situation in any chunk", async () => {
  const out = join(dir, "out");
  // (Made twice into the same folder, the first time with no test cases, which makes a longer file: the second is whole.)
  expect((await inSitu({ sources: [logPath], out, writers: ["one", "two", "three"], every: 1, maxChars: 400, tests: [] })).totals.test).toBe(0);
  const r = await inSitu({ sources: [logPath], out, writers: ["one", "two"], every: 1, maxChars: 400, tests: TESTS });
  expect(r.totals).toEqual({ situations: 9, test: 4, partial: 1, usable: 4, no_forms: 0, no_system: 1, unmatched_drafts: 0 });
  expect(r.situations[RUN]!["clerk-system"]).toEqual({ situations: 7, test: 4, partial: 1, usable: 2, seat_days: 5, asked: 7 });
  expect(r.tests).toEqual({ [RUN]: { found: 1, missing: [] } });
  expect(r.characters.system).toMatchObject({ n: 9, min: "You are the warden.".length, max: SYSTEM.length });
  expect(r.real_requests.kept).toBe(5);
  const situations = rows<Situation>(join(out, "situations.jsonl"));
  expect(situations).toEqual(JSON.parse(JSON.stringify(read.situations)));
  expect(rows(join(out, "real-unlabelled.jsonl")).map((x) => x.id).sort()).toEqual(rows(join(out, "real-blind.jsonl")).map((x) => x.id).sort());
  for (const x of rows(join(out, "real-blind.jsonl"))) expect(Object.keys(x)).toEqual(["id", "request", "forms"]);
  expect(readFileSync(join(out, "writer-instructions.txt"), "utf8")).toBe(inSituInstructions());
  // With every day used (every: 1), both writers would be given the same days: the chunks hold each day's one turn.
  // (A writer's chunks are made again whole; another writer's, made before, are left as they were.)
  const files = readdirSync(join(out, "chunks")).filter((f) => !f.startsWith("three-")).sort();
  expect(readdirSync(join(out, "chunks")).some((f) => f.startsWith("three-"))).toBe(true);
  expect(files.filter((f) => f.startsWith("one-")).length).toBe(r.chunks.one!.chunks);
  const given = files.flatMap((f) => rows(join(out, "chunks", f)));
  for (const x of given) {
    expect(Object.keys(x)).toEqual(["id", "system", "shown"]);
    const whole = situations.find((s) => s.id === x.id)!;
    expect(whole).toMatchObject({ test: false, system: x.system, shown: x.shown });
    expect(whole.partial).toBeUndefined();
  }
  // Day 0 has the test case in it: none of its turns is given, not even the first, which came before it.
  expect([...new Set(given.map((x) => x.id))].sort()).toEqual(["test-in-situ/clerk-system/d2/1", "test-in-situ/warden-system/d4/1", "test-in-situ/warden-system/d5/1"]);
  for (const f of files) expect(rows(join(out, "chunks", f)).reduce((n, x) => n + x.system.length + x.shown.length, 0)).toBeLessThanOrEqual(400);
  // What a writer is told: who it is, that nothing is running, and what to hand back.
  const told = inSituInstructions();
  for (const part of ["No world is running now", "you are the participant the prompt addresses", "- do: Say what you do, in plain words", '{"id": "<the situation\'s id, copied exactly>", "requests": [', "Imitate no one"]) expect(told).toContain(part);
});

test("writers' files taken in, made blind, and labelled by two readers: the commands, end to end", async () => {
  const out = join(dir, "out");
  if (!existsSync(join(out, "situations.jsonl"))) await inSitu({ sources: [logPath], out, tests: TESTS });
  const clean = "test-in-situ/clerk-system/d2/1";
  const written = [
    { id: clean, requests: ["Pay acc-b 75 from acc-town.", "  ", R5, "Pay acc-b 75 from acc-town.", "Fill in the stall permit for lot-3 and hand it in.", `${R2.slice(0, 70)} noon.`] },
    { id: "test-in-situ/warden-system/d4/1", requests: [] },
    { id: "test-in-situ/clerk-system/d0/2", requests: ["Pay acc-b 1 from acc-town."] }, // (marked test: never given out, never taken in)
    { id: "test-in-situ/nobody/d0/1", requests: ["Pay acc-b 2 from acc-town."] },
    { id: clean, requests: ["Pay acc-b 3 from acc-town."] }, // (answered twice: the first)
  ];
  const r = await takeIn(read.situations, [{ writer: "writer one", answers: written }, { writer: "two", answers: [{ id: clean, requests: ["Pay acc-b 75 from acc-town.", "Tell the warden [warden] to sweep lot-3."] }] }], TESTS);
  expect(r.counts).toEqual({ answers: 5, written: 10, none: 1, unknown_situation: 1, test_situation: 1, no_forms: 0, empty: 1, same_as_test: 1, starts_as_test: 1, said_before: 2, kept: 3, by_writer: { "writer one": 2, two: 1 } });
  expect(r.requests).toEqual([
    { id: `${clean}/writer-one-1`, request: "Pay acc-b 75 from acc-town.", forms: [FORM_LINE], from: { situation: clean, writer: "writer one" }, currency: { code: "XTS", minor_units: 2, symbol: "¤" } },
    { id: `${clean}/writer-one-5`, request: "Fill in the stall permit for lot-3 and hand it in.", forms: [FORM_LINE], from: { situation: clean, writer: "writer one" }, currency: { code: "XTS", minor_units: 2, symbol: "¤" } },
    { id: `${clean}/two-2`, request: "Tell the warden [warden] to sweep lot-3.", forms: [FORM_LINE], from: { situation: clean, writer: "two" }, currency: { code: "XTS", minor_units: 2, symbol: "¤" } },
  ]);
  // A situation whose forms can't be recovered: its requests are left out, and counted.
  const { forms: _, ...formless } = at("clerk-system/d2/1");
  expect((await takeIn([formless], [{ writer: "w", answers: [{ id: clean, requests: ["Pay acc-b 4."] }] }], TESTS)).counts).toMatchObject({ no_forms: 1, kept: 0 });

  // The commands.
  const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], { cwd: root });
  const one = join(dir, "one.out.jsonl"), two = join(dir, "two.out.jsonl");
  writeFileSync(one, written.filter((x) => x.id !== "test-in-situ/clerk-system/d0/2").map((x) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(two, `${JSON.stringify({ id: clean, requests: ["Pay acc-b 75 from acc-town.", "Tell the warden [warden] to sweep lot-3."] })}\n`);
  // (The command knows the real test cases, not this log's own: so the request in this test's other-run case is kept here.)
  const taken = cli("in-situ-requests", out, "--requests", one, "--writer", "writer one", "--requests", two, "--writer", "two");
  expect(taken.stdout.toString()).toContain("5 requests written to");
  expect(cli("in-situ-requests", out, "--requests", one).exitCode).toBe(1); // a file with no writer's name
  const unlabelled = join(out, "written-unlabelled.jsonl"), blind = join(out, "written-blind.jsonl");
  expect(rows(unlabelled).map((x) => x.request)).toEqual(["Pay acc-b 75 from acc-town.", R5, "Fill in the stall permit for lot-3 and hand it in.", `${R2.slice(0, 70)} noon.`, "Tell the warden [warden] to sweep lot-3."]);
  for (const x of rows(blind)) expect(Object.keys(x)).toEqual(["id", "request", "forms"]);
  expect(rows(blind).map((x) => x.id).sort()).toEqual(rows(unlabelled).map((x) => x.id).sort());
  expect(blindFile(unlabelled, { seed: 1 })).toEqual({ requests: 5, out: blind });
  expect(cli("in-situ-blind", unlabelled, "--seed", "2", "--out", join(out, "again.jsonl")).stdout.toString()).toContain("5 requests written to");
  expect(await takeInFiles(out, [{ file: one, writer: "writer one" }], { out: join(out, "one-unlabelled.jsonl") })).toMatchObject({ kept: 4, blind: join(out, "one-blind.jsonl") });

  // Two readers: they agree on the payment and the form, and one rewords the letter.
  const [pay, look, form, , letter] = rows(unlabelled).map((x) => x.id) as [string, string, string, string, string];
  const a = join(dir, "answers-a.jsonl"), b = join(dir, "answers-b.jsonl");
  const answers = (letterText: string) => [{ id: pay, program: 'money(amount="75", from=acc-town, to=acc-b)' }, { id: look, program: "none(not_an_act)" }, { id: form, program: "form(form=stall_permit, lot=lot-3, to=town)" }, { id: letter, program: `message(to=warden, text="${letterText}")` }];
  writeFileSync(a, answers("sweep lot-3").map((x) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(b, JSON.stringify(answers("sweep lot-3")));
  const done = join(out, "labelled");
  expect(cli("in-situ-label", unlabelled, "--answers", a, "--reader", "reader a", "--answers", b, "--reader", "reader b", "--out", done).stdout.toString()).toContain("4 examples of 5 requests");
  const examples = rows(join(done, "examples.jsonl"));
  expect(examples.map((e) => [e.program, e.kind, e.written_by, e.verified_by, e.source])).toEqual([
    ['money(amount="75", from=acc-town, to=acc-b)', "positive", "writer one", "reader a + reader b", clean],
    ["none(not_an_act)", "refusal", "writer one", "reader a + reader b", clean],
    ["form(form=stall_permit, lot=lot-3)", "positive", "writer one", "reader a + reader b", clean],
    ['message(text="sweep lot-3", to=warden)', "positive", "two", "reader a + reader b", clean],
  ]);
  for (const e of examples) {
    for (const k of ["id", "request", "forms", "program", "kind", "shape", "source", "written_by", "verified_by", "gold"]) expect(e[k]).toBeDefined();
    expect(e.gold).toBe(e.program);
    const enc = encode(e);
    expect(decode(enc.input, enc.steps).replace(/="([a-z0-9][a-z0-9._\/-]*)"/g, "=$1")).toBe(e.program.replace(/="([a-z0-9][a-z0-9._\/-]*)"/g, "=$1"));
  }
  expect(JSON.parse(readFileSync(join(done, "manifest.json"), "utf8"))).toMatchObject({ examples: 4, rejected: 1, by_reason: { unanswered: 1 }, readers: ["reader a", "reader b"], by_function: { form: 1, message: 1, money: 1, "none(not_an_act)": 1 }, by_refusal_label: { not_an_act: 1 }, office_left_out: 1 });
  // A reader who rewords the letter: dropped, with why. And two readers are needed.
  writeFileSync(b, JSON.stringify(answers("Please sweep lot three")));
  expect(label(unlabelled, [{ file: a, reader: "a" }, { file: b, reader: "b" }], done).by_reason).toMatchObject({ disagreed: 1 });
  writeFileSync(a, JSON.stringify(answers("Please sweep lot three")));
  expect(label(unlabelled, [{ file: a, reader: "a" }, { file: b, reader: "b" }], done)).toMatchObject({ examples: 3, by_reason: { reworded_text: 1 } });
  expect(rows(join(done, "rejects.jsonl")).filter((x) => x.why !== "unanswered")).toMatchObject([{ id: letter, why: "reworded_text", answers: { a: 'message(to=warden, text="Please sweep lot three")' } }]);
  expect(cli("in-situ-label", unlabelled, "--answers", a, "--reader", "a", "--out", done).exitCode).toBe(1);
}, 60_000);
