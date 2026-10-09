// Generated parts written and blind-checked through adapters, and the part banked for a later translator
// (src/broad.ts), on stand-in models: each writer's briefs go to its model a batch at a call; every request is read by
// a model that did not write it and sees nothing but the request and the forms; what the reader reads otherwise is set
// aside; a second run makes no call; a test-only pilot is never a source of the banked part.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { MockAdapter, type ContentBlock, type LlmRequest, type Price } from "@oikos/participants/llm";
import { literals, type Example } from "../../translator/train/data";
import { readerUses, type Use, type V2Example } from "../../translator/train/v2";
import { batches, checkBroadConfig, currencyShape, runBroad, v2Cases, v2FromPilots, type BroadConfig } from "../src/broad";
import type { Hooks } from "../src/pipeline";
import { trainingData, type Plan } from "../src/training";

const root = join(import.meta.dir, "../..");
const out = join(root, "runs", "test-broad");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);

// ---- a part: a small log's acts, as a wide part's briefs for two writers
const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });
const log = join(out, "town.jsonl");
writeFileSync(log, [
  JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }] } } } }),
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'), act('money(to=acc-landlord-1, amount="$850", from=acc-city, every="30 days", for="rent")'),
  act("vote(ballot=rec.3, choice=yes)"), act("statement(withdraw=rec.61)"), act("statement(hold=rec.44)"), act("agreement(sign=rec.90)"),
].join("\n") + "\n");
const part = join(out, "part-1");
await trainingData({ sources: [log], out: part, briefsOnly: true, briefsFor: ["w1", "w2"], noSpares: true, floor: 0, perGold: 1, limit: 14, refusalFloor: 3, refusalLabels: ["not_an_act", "look_first", "unclear"], indirect: 0, broad: true, validation: 0, seed: 7 });
const plan = JSON.parse(readFileSync(join(part, "plan.json"), "utf8")) as Plan;

// ---- stand-in writers: for a program, the words the style says to use exactly and every literal; for a situation, a line of its own
const toName = (brief: string): string => { const at = brief.search(/names? (exactly )?these (other things )?by id/); return at < 0 ? "" : [...brief.slice(at).matchAll(/"([^"\s]+)" \(/g)].map((m) => ` ${m[1]}`).join(""); };
const say = (brief: string): string => {
  const mark = Bun.hash(brief).toString(36);
  if (!brief.startsWith("Call:\n")) return `Request ${mark}, about this: ${brief.split("\n")[1]!.replace(/its id \([^)]*\) is NOT in the request/, "")}${toName(brief)}`;
  const given = brief.includes("exactly ") ? [...brief.slice(brief.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") : "";
  const program = brief.slice("Call:\n".length, brief.indexOf("\n\nWhat it brings about"));
  return `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}please see to this (${mark}): ${literals(calls.parseProgram(program)).join(" / ")}`;
};
interface Counts { writes: { [model: string]: string[][] }; reads: { [model: string]: number }; turns: number }
function hooks(counts: Counts, o: { wrong?: (request: string) => boolean; heldOut?: Hooks["heldOut"]; skipOnce?: boolean; turn?: (brief: string) => string } = {}): Hooks {
  const zero: Price = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let skipped = !o.skipOnce;
  const writer = (name: string) => (req: LlmRequest): ContentBlock[] => {
    const briefs = (req.messages[0]!.content as string).split("=== BRIEFS ===\n")[1]!.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; kind?: string; brief: string });
    (counts.writes[name] ??= []).push(briefs.map((b) => b.id));
    // (Once, a writer leaves the last brief of a batch unanswered: it is asked for again.)
    const answered = !skipped && briefs.length > 1 ? ((skipped = true), briefs.slice(0, -1)) : briefs;
    return [{ type: "tool_use", id: "t", name: "hand_in", input: { answers: answered.map((b) => ({ id: b.id, request: o.turn && b.kind === undefined ? o.turn(b.brief) : say(b.brief) })) } }];
  };
  // A stand-in reader: it is sent the request and the forms and nothing else, and answers what the request was written
  // for (a stand-in knows; a real one reads), but for the requests it is told to read otherwise.
  const reader = (name: string) => (req: LlmRequest): ContentBlock[] => {
    counts.reads[name] = (counts.reads[name] ?? 0) + 1;
    const body = req.messages[0]!.content as string;
    if (body.includes("=== TURNS ===")) {
      counts.turns++;
      const turns = body.split("=== TURNS ===\n")[1]!.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const gold = new Map(jsonl<V2Example>(join(out, "v2", "v2-examples.jsonl")).map((e) => [e.id, e.uses]));
      const flat = (u: Use) => ({ tool: u.tool, ...Object.fromEntries(Object.entries(u.input).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? String(v) : v])) });
      return [{ type: "tool_use", id: "t", name: "hand_in", input: { answers: turns.map((t: any) => { expect(Object.keys(t).sort()).toEqual(["awaiting", "id", "reports", "turn"]); return { id: t.id, uses: o.wrong?.(t.turn) ? [{ tool: "done_for_now" }] : gold.get(t.id)!.map(flat) }; }) } }];
    }
    const gold = new Map(jsonl<Example>(join(part, "examples.jsonl")).map((e) => [e.id, e.program]));
    const blind = body.split("=== BLIND ===\n")[1]!.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return [{ type: "tool_use", id: "t", name: "hand_in", input: { answers: blind.map((b: any) => { expect(Object.keys(b).sort()).toEqual(["forms", "id", "request"]); return { id: b.id, program: o.wrong?.(b.request) ? "none(unclear)" : gold.get(b.id)! }; }) } }];
  };
  const adapters = new Map(["writer-a", "writer-b"].map((n) => [`mock/${n}`, new MockAdapter(n, { consult: (r) => ((r.messages[0]!.content as string).includes("=== BRIEFS ===") ? writer(n)(r) : reader(n)(r)) })]));
  return { heldOut: o.heldOut ?? false, sleep: async () => {}, log: () => {}, adapter: (name) => ({ adapter: adapters.get(name)!, prices: { [name]: zero } }) };
}
const config = (o: Partial<BroadConfig> = {}): BroadConfig => ({
  out, writers: { w1: "mock/writer-a", w2: "mock/writer-b" }, readers: { "mock/writer-a": "mock/writer-b", "mock/writer-b": "mock/writer-a", "*": "mock/writer-a" }, budget: 1, writeBatch: 5, readBatch: 6, jobs: 2, ...o,
});

test("a config in which a model would read its own writing is refused, and so is a model that is never used", () => {
  expect(() => checkBroadConfig(config({ readers: { "*": "mock/writer-a" } }))).toThrow(/would read its own writing/);
  expect(() => checkBroadConfig(config({ readers: { "mock/writer-a": "mock/writer-b", "mock/writer-b": "mock/writer-a@low", "*": "mock/writer-a" } }))).not.toThrow();
  expect(() => checkBroadConfig(config({ readers: { "mock/writer-a": "mock/writer-a@high", "*": "mock/writer-b" } }))).toThrow(/would read its own writing/);
  expect(() => checkBroadConfig(config({ writers: { w1: "codex/gpt-6-astra" } }))).toThrow(/never used/);
  expect(() => checkBroadConfig({ ...config(), budget: 0 })).toThrow(/budget/);
  expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(batches(["aaaa", "bb", "c", "dddddd"], 9, 5, (s) => s.length)).toEqual([["aaaa"], ["bb", "c"], ["dddddd"]]);
});

const counts: Counts = { writes: {}, reads: {}, turns: 0 };
// (One request is read otherwise by its reader: the first example a writer's stand-in wrote for a vote.)
const wrong = (request: string) => request.includes("rec.3") && request.includes("please see to this");
const first = await runBroad(config(), [part], hooks(counts, { wrong, skipOnce: true }));

test("each writer's briefs go to its model a batch at a call, and a brief left unanswered is asked for once more", () => {
  expect(first.status).toBe("complete");
  const r = first.parts[0]!;
  const mine = (w: string) => plan.items.filter((t) => t.writer === w && !(t.kind === "refusal" && t.round > 0)).map((t) => t.id);
  // writer-a was asked for w1's briefs and no other's, five at a call, and once more for the one it skipped.
  const asked = counts.writes["writer-a"]!;
  expect(new Set(asked.flat())).toEqual(new Set(mine("w1")));
  expect(asked.every((b) => b.length <= 5)).toBe(true);
  expect(asked.flat().length).toBe(mine("w1").length + 1);
  expect(new Set(counts.writes["writer-b"]!.flat())).toEqual(new Set(mine("w2")));
  expect(r.briefs).toBe(mine("w1").length + mine("w2").length);
  expect(r.written).toEqual({ "mock/writer-a": mine("w1").length, "mock/writer-b": mine("w2").length });
  expect(r.no_request).toBe(0);
  expect(jsonl(join(part, "requests-w1.jsonl")).length).toBe(mine("w1").length);
});

test("every request is read blind by a model that did not write it; what is read otherwise is set aside, by function, style, asker and writer", () => {
  const r = first.parts[0]!;
  const examples = jsonl<Example>(join(part, "examples.jsonl"));
  const checked = jsonl<Example>(join(part, "checked.jsonl"));
  const disagreed = jsonl<Example & { answer: string; reader: string }>(join(part, "disagreed.jsonl"));
  expect(r.read).toBe(examples.length);
  expect(checked.length + disagreed.length).toBe(examples.length);
  expect(disagreed.length).toBeGreaterThanOrEqual(1);
  for (const e of disagreed) { expect(wrong(e.request)).toBe(true); expect(e.answer).toBe("none(unclear)"); }
  for (const e of checked) {
    expect(e.written_by === undefined || e.verified_by !== e.written_by).toBe(true);
    expect(e.verified_by).toBe(e.written_by === "mock/writer-a" ? "mock/writer-b" : "mock/writer-a");
    expect(e.asker === undefined || typeof e.asker === "string").toBe(true);
  }
  expect(checked.some((e) => e.written_by === "mock/writer-a")).toBe(true);
  expect(checked.some((e) => e.written_by === "mock/writer-b")).toBe(true);
  // The counts add up every way they are cut.
  for (const by of ["function", "style", "asker", "writer", "reader"]) {
    const sum = Object.values(r.agreement[by]!).reduce((a, x) => a + x.agreed + x.disagreed + x.unanswered, 0);
    expect(sum).toBe(examples.length);
  }
  expect(Object.keys(r.agreement.style!).length).toBeGreaterThan(3);
  const manifest = JSON.parse(readFileSync(join(part, "manifest.json"), "utf8"));
  expect(manifest.blind_check.agreed).toBe(checked.length);
  expect(manifest.leak_check).toEqual({ held_out_cases_here: 0, cases_named: [], examples_taken_out: 0, cases_named_after: 0 });
  expect(manifest.kept).toBe(checked.length);
  // Every call is in the run's ledger, with its prompt and its answer.
  const ledger = jsonl<any>(join(out, "calls.jsonl"));
  expect(ledger.filter((e) => e.annotation === "usage").length).toBe(Object.values(counts.writes).flat().length + Object.values(counts.reads).reduce((a, n) => a + n, 0));
  expect(ledger.some((e) => e.annotation === "transcript" && e.step === "part-1/write/w1")).toBe(true);
  expect(first.usage["mock/writer-a"]!.calls).toBeGreaterThan(0);
});

test("the same command again makes no call, and a held-out case's wording takes an example out", async () => {
  const again: Counts = { writes: {}, reads: {}, turns: 0 };
  const second = await runBroad(config(), [part], hooks(again, { wrong }));
  expect(again).toEqual({ writes: {}, reads: {}, turns: 0 });
  expect(second.parts[0]!.kept).toBe(first.parts[0]!.kept);
  // (Five words running of one kept request, in a held-out case given by the test: it is taken out and counted, by id.)
  const victim = jsonl<Example>(join(part, "checked.jsonl")).find((e) => e.request.split(/\s+/).length >= 7)!;
  const five = victim.request.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 5).join(" ");
  const third = await runBroad(config(), [part], hooks(again, { wrong, heldOut: [{ id: "h-x", request: `${five} and so on.`, expect: ["none(unclear)"] }] }));
  expect(again).toEqual({ writes: {}, reads: {}, turns: 0 });
  expect(third.parts[0]!.leaked).toBeGreaterThanOrEqual(1);
  expect(third.parts[0]!.kept).toBe(first.parts[0]!.kept - third.parts[0]!.leaked);
  const manifest = JSON.parse(readFileSync(join(part, "manifest.json"), "utf8"));
  expect(manifest.leak_check.cases_named).toEqual(["h-x"]);
  expect(manifest.leak_check.cases_named_after).toBe(0);
  expect(jsonl<Example>(join(part, "leaked.jsonl")).some((e) => e.id === victim.id)).toBe(true);
  expect(jsonl<Example>(join(part, "checked.jsonl")).some((e) => e.id === victim.id)).toBe(false);
});

test("how a world writes money is counted by its shape", () => {
  expect(currencyShape(undefined)).toBe("none");
  expect(currencyShape({ code: "XTS", minor_units: 2 })).toBe("code only, 2 decimals");
  expect(currencyShape({ code: "XTS", minor_units: 0, symbol: "¤", symbol_after: true } as any)).toBe("sign after, 0 decimals");
  expect(currencyShape({ code: "XTS", minor_units: 2, symbol: "¤", decimal_mark: ",", grouping: [3, 2], number_words: { lakh: 100_000 } } as any)).toBe("sign before, 2 decimals, decimal comma, groups of two, number words");
});

// ---- the banked part: what a seat did in a pilot's log, and generated cases
let seq = 0;
const entry = (t: number, kind: string, body: object) => JSON.stringify({ seq: seq++, t, kind, body });
const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const said = (t: number, subject: string, turn: number, input: unknown, output: unknown[], system?: string) =>
  entry(t, "annotation", { annotation: "transcript", subject, data: { purpose: "participant", t, provider: "codex", model: "some-model", system_sha256: "hash-clerk", ...(system ? { system } : {}), turn, input, output } });
function pilot(name: string, o: { test?: boolean } = {}): string {
  const dir = join(root, "runs", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "town.seed1.jsonl"), [
    entry(0, "header", { run_id: "town.seed1", config: { world: { currencies: [{ code: "XTS", minor_units: 2, symbol: "¤" }] } } }),
    said(100, "clerk-system", 1, 'Your notebook: (empty)\n\nTo see the rest: look at "Clerk: Files" (clerk/files). Also "Clerk: In-tray" (clerk/in-tray).\nIt is year 1, day 1.', [use("u1", "look", { report: "clerk/files", paper: "rec.12", nonsense: 1 }), use("u2", "do", { what: "Pay acc-b 500 from acc-town." }), use("u3", "notebook", { add: "Day 1: read rec.12." })], "You are the clerk."),
    said(86_400 + 100, "clerk-system", 1, "Your notebook: Day 1.\n\nBefore this goes ahead (draft.clerk-system.1), here is what will happen.\nIt is year 1, day 2.", [use("u4", "confirm", { ref: "draft.clerk-system.1", decision: "confirm" }), use("u5", "done_for_now", { days: 3 })]),
    said(2 * 86_400 + 100, "clerk-system", 1, "Your notebook: Day 1.\n\nIt is year 1, day 3.", [use("u6", "write", { to: ["warden"], text: "x".repeat(900) }), use("u7", "look", { report: "clerk/files", paper: "rec.12" })]),
  ].join("\n") + "\n");
  if (o.test) writeFileSync(join(dir, "PILOT.txt"), `A held-out pilot.\n\n${JSON.stringify({ name, test: true }, null, 1)}\n`);
  return dir;
}

test("what real seats did becomes cases one use at a time, never an act, never from a test-only pilot", async () => {
  const p = pilot("test-broad-pilot");
  const { cases, counts: c } = await v2FromPilots([p], { seed: 3 });
  expect(c).toMatchObject({ situations: 3, test_situations: 0, uses: 7, do: 1, too_long: 2, said_before: 1 });
  // (No case holds the act; the long letter is no brief, alone or in its turn; the paper read twice is one case.)
  expect(cases.some((x) => x.uses.some((u) => u.tool === "do"))).toBe(false);
  expect(cases.map((x) => x.kind).sort()).toEqual(["confirm:confirm", "done_for_now", "look:paper", "notebook:add", "turn"]);
  const look = cases.find((x) => x.kind === "look:paper")!;
  expect(look.uses).toEqual([{ tool: "look", input: { report: "clerk/files", paper: "rec.12" } }]);
  expect(look.knows.reports).toEqual([{ id: "clerk/files", title: "Clerk: Files" }, { id: "clerk/in-tray", title: "Clerk: In-tray" }]);
  expect(look.from).toBe("test-broad-pilot/clerk-system/d0/1/use-1");
  const turn = cases.find((x) => x.kind === "turn")!;
  expect(turn.uses.map((u) => u.tool)).toEqual(["confirm", "done_for_now"]);
  expect(turn.knows.awaiting).toEqual(["draft.clerk-system.1"]);
  await expect(v2FromPilots([pilot("test-broad-held", { test: true })])).rejects.toThrow(/test-only/);
});

test("the banked part is written, checked for what a turn must carry, read blind by a model that did not write, and compared", async () => {
  const dir = join(out, "v2");
  const p = await v2Cases({ out: dir, pilots: [join(root, "runs", "test-broad-pilot")], generated: 30, writers: ["w1", "w2"], seed: 3 });
  expect(p.items.length).toBe(35);
  expect(Object.keys(p.by_kind).some((k) => k.startsWith("pilot "))).toBe(true);
  // A stand-in writer: every id and number, and the words to be given as written, each said once; one turn in seven
  // names a tool, and one in five loses its words.
  let n = 0;
  const turn = (brief: string): string => {
    const uses = brief.split("\n\n")[0]!.split("\n").slice(1).map((l) => { const m = /^\d+\. ([a-z_]+) (.*)$/.exec(l)!; return { tool: m[1]!, input: JSON.parse(m[2]!) }; });
    const flat = (v: unknown): string => (Array.isArray(v) ? v.map(flat).join(" and ") : v && typeof v === "object" ? Object.values(v).map(flat).join(" then ") : String(v));
    const k = n++;
    const body = uses.map((u) => `Thing ${Bun.hash(brief).toString(36)}: ${Object.entries(u.input).filter(([key]) => key !== "decision").map(([, v]) => flat(v)).join("; ")}`).join(". ");
    return k % 7 === 3 ? `done_for_now ${body}` : k % 5 === 4 ? body.toUpperCase() : body;
  };
  const c: Counts = { writes: {}, reads: {}, turns: 0 };
  const wrongTurn = (text: string) => /rec\.12\b/.test(text) && !text.includes("Day 1");
  const r = await runBroad(config(), [dir], hooks(c, { turn, wrong: wrongTurn }));
  expect(r.status).toBe("complete");
  const rep = r.parts[0]!;
  const examples = jsonl<V2Example>(join(dir, "v2-examples.jsonl"));
  const rejects = jsonl<any>(join(dir, "v2-rejects.jsonl"));
  expect(examples.length + rejects.length).toBe(35);
  expect(rejects.some((x) => /a tool's own name/.test(x.why))).toBe(true);
  expect(rejects.some((x) => /not as written|not there/.test(x.why))).toBe(true);
  const checked = jsonl<V2Example>(join(dir, "v2-checked.jsonl"));
  const disagreed = jsonl<any>(join(dir, "v2-disagreed.jsonl"));
  expect(checked.length + disagreed.length).toBe(examples.length);
  expect(disagreed.length).toBeGreaterThanOrEqual(1);
  expect(disagreed.every((x) => wrongTurn(x.text))).toBe(true);
  for (const e of checked) { expect(e.verified_by).not.toBe(e.written_by); expect(readerUses({ uses: e.uses.map((u) => ({ tool: u.tool })) }).length).toBe(e.uses.length); }
  expect(rep.kept).toBe(checked.length);
  expect(Object.values(rep.agreement.kind!).reduce((a, x) => a + x.agreed + x.disagreed + x.unanswered, 0)).toBe(examples.length);
  const manifest = JSON.parse(readFileSync(join(dir, "v2-manifest.json"), "utf8"));
  expect(manifest.kept).toBe(checked.length);
  expect(manifest.pilots).toEqual([join(root, "runs", "test-broad-pilot")]);
  // Again: nothing is asked.
  const again: Counts = { writes: {}, reads: {}, turns: 0 };
  await runBroad(config(), [dir], hooks(again, { turn, wrong: wrongTurn }));
  expect(again).toEqual({ writes: {}, reads: {}, turns: 0 });
});
