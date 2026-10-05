// Requests written by file (translator/train/data.ts: planOf, fromWritten): the plan of who is asked for what, the
// briefs a writer is handed, and the requests handed back, checked and made into examples by the code a model's are.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter } from "@oikos/participants/llm";
import { fromWritten, generate, goldFromLog, literals, planOf, refusalWriterSystem, writerSystem, type PlanItem, type WrittenRequest } from "../train/data";
import { piled } from "../train/synthetic";

const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });
const LOG = [
  JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }] } } } }),
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'),
  act('money(to=acc-landlord-1, amount="$850", from=acc-city, every="30 days", for="rent")'),
  act('message(to=["builder"], text="Start on Monday.")'),
  act("vote(ballot=rec.3, choice=yes)"),
  act('structure(type=park, on=lot-12-03, name="Mill Green")'),
];

/** What a stand-in writer says to a brief, whoever it is and however the brief reached it: for a program, the words
 * the style says to use exactly and every literal; for a situation, its own line (whatever it names is in it). A
 * careless one loses what it was to copy. */
const say = (brief: string, careless = false): string => {
  const mark = Bun.hash(brief).toString(36);
  if (!brief.startsWith("Call:\n")) return careless && /needs|no amount/.test(brief) ? `Work it out. (${mark})` : `Request ${mark}, about this: ${brief.split("\n")[1]}`;
  const given = brief.includes("exactly ") ? [...brief.slice(brief.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") : "";
  const program = brief.slice("Call:\n".length, brief.indexOf("\n\nWhat it brings about"));
  return `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}please see to this (${mark}): ${literals(calls.parseProgram(program)).join(" / ")}`;
};
const model = (name: string, sent: { system: string; brief: string }[] = [], careless = false): LlmAdapter => ({ provider: "stand-in", model: name, complete: async (req) => {
  const brief = String((req.messages[0] as any).content);
  sent.push({ system: req.system ?? "", brief });
  return { content: [{ type: "text", text: say(brief, careless) }], usage: { input_tokens: 1, output_tokens: 1 } };
} });
const written = (items: PlanItem[], careless = false): WrittenRequest[] => items.map((t) => ({ id: t.id, request: say(t.brief, careless) }));

test("the plan is settled before anything is written: the same for the same gold and seed, and each brief is exactly what a model is sent", async () => {
  const gold = await goldFromLog(LOG);
  const o = { perGold: 2, refusalFloor: 3, piled: piled({ groups: 1, seed: 5 }), seed: 5 };
  const plan = planOf(gold, { ...o, writers: ["stand-in/a", "stand-in/b"] });
  expect(planOf(gold, { ...o, writers: ["stand-in/a", "stand-in/b"] })).toEqual(plan);
  expect(new Set(plan.map((t) => t.id)).size).toBe(plan.length);
  // Dealt in turn: item k to writer k mod n. Whoever the writers are, the items are the same.
  expect(plan.map((t) => t.writer)).toEqual(plan.map((_, k) => `stand-in/${"ab"[k % 2]}`));
  const strip = (items: PlanItem[]) => items.map(({ writer: _, ...t }) => t);
  expect(strip(planOf(gold, { ...o, writers: ["x", "y"] }))).toEqual(strip(plan));
  // Requests for programs first (each with its gold program, its style, its riders and the way of saying it chosen),
  // then the refusals (each with its label and what must be copied), a first round and two spare ones.
  const requests = plan.filter((t) => t.kind === "request"), refusals = plan.filter((t) => t.kind === "refusal");
  expect(plan.slice(0, requests.length)).toEqual(requests);
  expect(requests.length).toBe(gold.length * 2);
  for (const t of requests) if (t.kind === "request") {
    expect(t.brief.startsWith(`Call:\n${t.gold.program}\n\n`)).toBe(true);
    for (const r of t.riders) expect(t.brief).toContain(r.text);
    for (const n of t.notes) expect(t.brief).toContain(n);
  }
  expect(new Set(refusals.map((t) => (t.kind === "refusal" ? t.round : -1)))).toEqual(new Set([0, 1, 2]));
  for (const t of refusals) if (t.kind === "refusal") for (const l of t.refusal.mustCopy) expect(t.brief).toContain(l);
  // A plan survives being written to a file and read again.
  expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  // The models of a run are sent these briefs, each under the instructions of its kind, in the plan's order (the
  // spare rounds only where a label came out short: here none did).
  const sent: { system: string; brief: string }[] = [];
  await generate(gold, { ...o, writers: [model("a", sent), model("b", sent)] });
  const asked = plan.filter((t) => t.kind === "request" || t.round === 0);
  expect(sent).toEqual(asked.map((t) => ({ system: t.kind === "request" ? writerSystem() : refusalWriterSystem(), brief: t.brief })));
});

test("requests handed in as files give the examples a run with models gives for the same texts; what fails a check is rejected with its reason, what is missing is counted", async () => {
  const gold = await goldFromLog(LOG);
  const o = { perGold: 2, refusalFloor: 3, piled: piled({ groups: 1, seed: 5 }), seed: 5 };
  const plan: PlanItem[] = JSON.parse(JSON.stringify(planOf(gold, { ...o, writers: ["stand-in/a", "stand-in/b"] })));
  const of = (name: string) => plan.filter((t) => t.writer === name);
  // Two writers, each with its own part of the plan, against two models answering the same.
  const run = await generate(gold, { ...o, writers: [model("a"), model("b")] });
  const files = await fromWritten(plan, [{ writer: "stand-in/a", requests: written(of("stand-in/a")) }, { writer: "stand-in/b", requests: written(of("stand-in/b")) }], o);
  expect(files.examples).toEqual(run.examples);
  expect(files.rejects).toEqual(run.rejects);
  expect(files.examples.length).toBeGreaterThan(gold.length);
  expect(new Set(files.examples.filter((e) => !e.built_from).map((e) => e.written_by))).toEqual(new Set(["stand-in/a", "stand-in/b"]));
  expect(files.examples.some((e) => e.kind === "refusal" && e.built_from)).toBe(true); // the built refusals are added
  expect(files.examples.every((e) => e.verified_by === undefined)).toBe(true); // nothing translated them back
  const { usage: _, no_request, from_files, ...rest } = files.manifest;
  const { usage: __, ...theirs } = run.manifest;
  expect(rest).toEqual(theirs);
  // Every round-0 item had its request; the spare refusals were written and not wanted.
  const spares = plan.filter((t) => t.kind === "refusal" && t.round > 0).length;
  expect(no_request).toBe(0);
  expect(from_files).toEqual({ requests: { "stand-in/a": of("stand-in/a").length, "stand-in/b": of("stand-in/b").length }, no_request: 0, duplicate_ids: 0, unknown_ids: 0, spares_not_needed: spares });

  // A label that comes out short takes the spare rounds' briefs, by file as with models.
  const carelessRun = await generate(gold, { ...o, writers: [model("a", [], true), model("b", [], true)] });
  const carelessFiles = await fromWritten(plan, [{ writer: "stand-in/a", requests: written(of("stand-in/a"), true) }, { writer: "stand-in/b", requests: written(of("stand-in/b"), true) }], o);
  expect(carelessFiles.examples).toEqual(carelessRun.examples);
  expect(carelessFiles.rejects).toEqual(carelessRun.rejects);
  expect(carelessFiles.rejects.filter((r) => r.program === "none(needs_calculation)" && r.why === "not_copied").length).toBe(9); // three rounds of three
  expect(carelessFiles.manifest.from_files!.spares_not_needed).toBe(spares - 6);

  // One writer's file, with: a request that lost what it was to copy; one left out; one id written twice; one id of nothing.
  const all = written(plan);
  const [lost, left] = [plan[0]!, plan[3]!];
  const mine = all.filter((r) => r.id !== left.id).map((r) => (r.id === lost.id ? { id: r.id, request: "Please see to it." } : r));
  const r = await fromWritten(plan, [{ writer: "claude", requests: [...mine, { id: plan[1]!.id, request: "Something else entirely." }, { id: "nothing", request: "For no brief." }] }], o);
  expect(r.rejects).toContainEqual({ request: "Please see to it.", program: lost.kind === "request" ? lost.gold.program : "", why: "not_copied", written_by: "claude", style: lost.style });
  expect(r.manifest.no_request).toBe(1);
  expect(r.manifest.from_files).toMatchObject({ requests: { claude: plan.length - 1 }, no_request: 1, duplicate_ids: 1, unknown_ids: 1 });
  expect(r.manifest.dropped.not_copied).toBe(files.manifest.dropped.not_copied + 1);
  expect(r.manifest.dropped.duplicate).toBe(files.manifest.dropped.duplicate + 1);
  expect(r.manifest.writers.claude).toBeGreaterThan(0);
  const programs = (es: { program: string; kind: string }[]) => es.filter((e) => e.kind === "positive").map((e) => e.program);
  expect(programs(r.examples).length).toBe(programs(files.examples).length - 2);
  // A second file fills in what the first left out; where both wrote an id, the first file's is kept.
  const both = await fromWritten(plan, [{ writer: "claude", requests: mine }, { writer: "other", requests: all }], o);
  expect(both.manifest.no_request).toBe(0);
  expect(both.manifest.from_files).toMatchObject({ requests: { claude: plan.length - 1, other: 1 }, duplicate_ids: plan.length - 1 });
  expect(both.examples.filter((e) => e.written_by === "other" && !e.built_from).map((e) => e.request)).toEqual([say(left.brief)]);
  // A request with marks round the whole of it is read as a model's answer is: without them.
  const quoted = await fromWritten(plan, [{ writer: "claude", requests: all.map((x) => (x.id === left.id ? { id: x.id, request: `  "${x.request}"  ` } : x)) }], o);
  expect(quoted.examples.map((e) => e.request)).toEqual(files.examples.map((e) => e.request));
});
