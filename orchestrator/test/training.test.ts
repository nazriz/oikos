import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "@oikos/participants/llm";
import { calls } from "@oikos/participants";
import { functionOf, literals, refusalBriefs, type Example } from "../../translator/train/data";
import { balancedGold, goldOf, trainingData } from "../src/training";

const dir = join(import.meta.dir, "../../runs/test-training-data");
const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });

test("training data from a log: gold programs, requests from two writers, each translated back by a third model; the data and its manifest written", async () => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "town.seed1.jsonl");
  writeFileSync(log, [
    JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }] } } } }),
    act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'),
    act('message(to=["builder"], text="Start on Monday.")'),
    act("vote(ballot=rec.3, choice=yes)"),
  ].join("\n") + "\n");
  // From the log (each also on another surface), and from the seen cases.
  const gold = await goldOf([log], { seed: 3 });
  expect(gold.filter((g) => g.source === "town.seed1").length).toBeGreaterThanOrEqual(3);
  expect(gold.some((g) => g.source.startsWith("case "))).toBe(true);

  // Writers that say the call's literals in a sentence; a translator that hands back the program it was given.
  const programs = new Map<string, string>();
  const writer = (model: string): LlmAdapter => ({ provider: "stand-in", model, complete: async (req) => {
    const said = String((req.messages[0] as any).content);
    const program = said.slice("Call:\n".length, said.indexOf("\n\n"));
    // (Whatever words the style says to use exactly, then every literal.)
    const given = (said.includes("exactly ") ? [...said.slice(said.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") || undefined : undefined);
    const text = `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}${model} asks: ${literals(calls.parseProgram(program)).join(" / ")} [${said.slice(-12)}]`;
    programs.set(text, program);
    return { content: [{ type: "text", text }], usage: { input_tokens: 7, output_tokens: 3 } };
  } });
  const back: LlmAdapter = { provider: "stand-in", model: "back", complete: async (req) => {
    const request = String((req.messages[0] as any).content).split("\n")[0]!.slice("Request: ".length);
    return { content: [{ type: "tool_use", id: "1", name: "call", input: { program: programs.get(request) ?? "none(unclear)" } }], usage: { input_tokens: 11, output_tokens: 5 } };
  } };
  const out = join(dir, "data");
  const free = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const prices = { "stand-in/a": free, "stand-in/b": free, "stand-in/back": free };
  const r = await trainingData({ sources: [log], writers: [{ adapter: writer("a"), prices }, { adapter: writer("b"), prices }], back: { adapter: back, prices }, out, perGold: 2, limit: 6, seed: 3, floor: 0 });
  // A model with no recorded price is never asked for anything, a writer included.
  await expect(trainingData({ sources: [log], writers: [{ adapter: writer("c"), prices }], out: join(dir, "unpriced"), perGold: 1, limit: 3, seed: 3 })).rejects.toThrow("no price recorded for stand-in/c");
  const examples = readFileSync(join(out, "examples.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  expect(r.examples).toBe(examples.length);
  expect(examples.length).toBeGreaterThanOrEqual(10);
  expect(new Set(examples.map((e) => e.written_by))).toEqual(new Set(["stand-in/a", "stand-in/b"]));
  expect(examples.every((e) => e.verified_by === "stand-in/back")).toBe(true);
  // Every model's tokens are counted, the one translating back included.
  expect(manifest.usage["stand-in/a"].input_tokens).toBeGreaterThan(0);
  expect(manifest.usage["stand-in/back (translating back)"].input_tokens).toBeGreaterThan(0);
  expect(manifest.gold_programs).toBe(6);
  expect(manifest.examples).toBe(examples.length);
});

test("a balanced gold set: a floor under every function, made up with generated programs where the log falls short, each saying where it came from", async () => {
  const d = join(dir, "balanced");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const log = join(d, "town.seed1.jsonl");
  // A town whose code pays and votes, and once publishes data for other code.
  writeFileSync(log, [
    JSON.stringify({ kind: "header", body: { config: { world: { currencies: [{ code: "YUN", minor_units: 0, symbol: "¥", unit_words: ["yun"] }], entities: [{ id: "builder", name: "Millbrook Builders" }] } } } }),
    ...Array.from({ length: 60 }, (_, i) => act(`money(to=builder, amount="¥${500 + i}", from=acc-city, for="the kerb")`)),
    act("vote(ballot=rec.3, choice=yes)"),
    act('statement(kind=delivery_note, text="Delivered 3.", data={"delivered":3})'),
    act('money(to=acc-shop-1, amount="¥20", from=acc-c0001, per_request=rec.5)'),
  ].join("\n") + "\n");
  const { gold, report } = await balancedGold([log], { seed: 3, floor: 50, generated: 10, perShape: 40, refusalFloor: 25 });
  // Every function of the call language has its floor.
  for (const fn of Object.keys(calls.ARGS)) expect([fn, report.by_function[fn]!.total >= 50]).toEqual([fn, true]);
  // Money: the log's forty (sampled) and each on another surface, with the generated least; nothing more is made up.
  expect(report.by_function.money!.log).toBeGreaterThanOrEqual(40);
  expect(report.by_function.money!.synthetic).toBe(10);
  // Harm: nothing in the log or the cases; all of the floor is generated.
  expect(report.by_function.harm).toEqual({ log: 0, case: 0, synthetic: 50, total: 50 });
  expect(report.by_function.vote!.log).toBe(1);
  expect(report.by_function.vote!.total).toBeGreaterThanOrEqual(50);
  // Counted per source and per shape, and what was left out of the log, by reason.
  expect(report.by_source["town.seed1"]).toBe(gold.filter((g) => g.origin === "log").length);
  expect(report.by_source.cases).toBe(gold.filter((g) => g.origin === "case").length);
  expect(report.by_source.synthetic).toBe(gold.filter((g) => g.origin === "synthetic").length);
  expect(Object.values(report.by_shape).reduce((a, b) => a + b, 0)).toBe(gold.length);
  expect(report.excluded).toEqual({ "carries out someone's instruction (per_request)": 1, "structured data: statement.data": 1 });
  expect(report).toMatchObject({ gold: gold.length, floor: 50, refusal_floor: 25 });
  expect(gold.every((g) => g.origin !== undefined)).toBe(true);
  expect(new Set(gold.map((g) => g.program)).size).toBe(gold.length);
  // The log's programs are in the log's money; their other surfaces too.
  for (const g of gold.filter((x) => x.origin === "log" && functionOf(x) === "money")) expect(() => calls.parseAmount((calls.parseProgram(g.program) as any).lines[0].call.args.amount.text, g.currency!)).not.toThrow();
  expect(await balancedGold([log], { seed: 3, floor: 50, generated: 10, perShape: 40, refusalFloor: 25 })).toEqual({ gold, report });
  // A ceiling on what one function takes from logs: a seeded sample, a program and its other surface together.
  const capped = await balancedGold([log], { seed: 3, floor: 50, generated: 10, perShape: 40, ceiling: 12 });
  expect(capped.report.by_function.money!.log).toBeLessThanOrEqual(13);
  expect(capped.report.capped.money).toBe(report.by_function.money!.log);
  expect(capped.report.by_function.money!.total).toBeGreaterThanOrEqual(50);

  // The whole pipeline on it: the data, its manifest (what the gold was made of), and the split.
  let asked = 0;
  const writer: LlmAdapter = { provider: "stand-in", model: "a", complete: async (req) => {
    const said = String((req.messages[0] as any).content);
    const isCall = said.startsWith("Call:\n");
    const given = (said.includes("exactly ") ? [...said.slice(said.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") || undefined : undefined);
    const text = isCall ? `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}please: ${literals(calls.parseProgram(said.slice(6, said.indexOf("\n\n")))).join(" / ")}` : `Request ${++asked}, about this: ${said.split("\n")[1]}`; // (the situation's own line: whatever it names is in it)
    return { content: [{ type: "text", text }], usage: { input_tokens: 7, output_tokens: 3 } };
  } };
  const out = join(d, "data");
  const prices = { "stand-in/a": { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
  const r = await trainingData({ sources: [log], writers: [{ adapter: writer, prices }], out, perGold: 2, seed: 3, floor: 45, generated: 5, perShape: 10, refusalFloor: 8 });
  const read = (name: string): Example[] => readFileSync(join(out, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  expect(manifest.gold.floor).toBe(45);
  for (const fn of Object.keys(calls.ARGS)) expect([fn, manifest.gold.by_function[fn].total >= 45, manifest.by_function[fn] > 0]).toEqual([fn, true, true]);
  expect(manifest.by_origin.synthetic).toBeGreaterThan(0);
  expect(manifest.by_origin.log).toBeGreaterThan(0);
  expect(manifest.refusal_floor).toBe(8);
  // Every label that has a way of being made (a brief for a writer, or built from examples) has its floor, whichever
  // labels those are; one the call language has and nothing here makes yet is said to be short, not passed over.
  const made = [...new Set([...refusalBriefs(gold, 1).map((b) => b.label), "too_much", "unknown_form"])];
  for (const label of ["needs_calculation", "not_yours", "unclear", "not_an_act", "too_much", "unknown_form"]) expect(made).toContain(label);
  for (const label of made) expect([label, manifest.by_shape[`none(${label})`] >= 8]).toEqual([label, true]);
  expect(manifest.short_of_floor).toEqual(Object.fromEntries(calls.LABELS.filter((l) => !made.includes(l)).map((l) => [l, 0])));
  // What the generator drew and dropped as no plausible thing to ask for is counted, by reason.
  expect(typeof manifest.gold.implausible).toBe("object");
  // Form examples carry their forms; the split is written, and no validation form is shown in training.
  const train = read("train.jsonl"), validation = read("validation.jsonl");
  expect(manifest.split).toMatchObject({ train: train.length, validation: validation.length, validation_share: 0.15 });
  expect(r.examples).toBe(read("examples.jsonl").length);
  expect(validation.length).toBeGreaterThan(0);
  const programs = (es: Example[]) => new Set(es.filter((e) => e.kind === "positive").map((e) => e.gold));
  for (const p of programs(validation)) expect(programs(train).has(p)).toBe(false);
  const names = (es: Example[]) => new Set(es.flatMap((e) => e.forms.map((line) => line.slice(2, line.indexOf(", to=")))));
  expect(names(validation).size).toBeGreaterThan(0);
  for (const n of names(validation)) expect(names(train).has(n)).toBe(false);
  expect(train.filter((e) => functionOf(e) === "form").every((e) => e.forms.length > 0)).toBe(true);
});

test("several checkers: each request is translated back by a model that didn't write it, and the data says by which", async () => {
  const d = join(dir, "checkers");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const log = join(d, "town.seed1.jsonl");
  writeFileSync(log, [
    JSON.stringify({ kind: "header", body: { config: { world: { entities: [] } } } }),
    act('money(to=acc-builder, amount="$500", from=acc-city, for="the kerb")'),
    act('message(to=["c0042"], text="Start on Monday.")'),
    act("vote(ballot=rec.3, choice=yes)"),
    act("occupancy(in=apts-3/dwelling.2, leave=true, who=c0042)"),
  ].join("\n") + "\n");
  // One stand-in per model, writing when asked for a request and translating when shown one. As a translator each
  // spells a flag its own way: what comes back is compared by what it means, so nothing is lost to that.
  const programs = new Map<string, string>();
  const translated: { [model: string]: string[] } = { a: [], b: [], c: [] };
  const model = (name: string): LlmAdapter => ({ provider: "stand-in", model: name, complete: async (req) => {
    const said = String((req.messages[0] as any).content);
    if (said.startsWith("Request: ")) {
      const request = said.split("\n")[0]!.slice("Request: ".length);
      translated[name]!.push(request);
      return { content: [{ type: "tool_use", id: "1", name: "call", input: { program: (programs.get(request) ?? "none(unclear)").replace("leave=yes", "leave=true") } }], usage: { input_tokens: 11, output_tokens: 5 } };
    }
    const program = said.slice("Call:\n".length, said.indexOf("\n\n"));
    const text = `${name} asks: ${literals(calls.parseProgram(program)).join(" / ")} [${said.slice(-12)}]`;
    programs.set(text, program);
    return { content: [{ type: "text", text }], usage: { input_tokens: 7, output_tokens: 3 } };
  } });
  const free = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const prices = { "stand-in/a": free, "stand-in/b": free, "stand-in/c": free };
  const out = join(d, "data");
  // Writers a and b; checkers a and c: a's requests can't be checked by a, so c takes them; b's go to a.
  await trainingData({ sources: [log], writers: [{ adapter: model("a"), prices }, { adapter: model("b"), prices }], backs: [{ adapter: model("a"), prices }, { adapter: model("c"), prices }], out, perGold: 2, seed: 3, floor: 0, validation: 0 });
  const examples: Example[] = readFileSync(join(out, "examples.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const positives = examples.filter((e) => e.kind === "positive");
  expect(new Set(positives.map((e) => `${e.written_by} -> ${e.verified_by}`))).toEqual(new Set(["stand-in/a -> stand-in/c", "stand-in/b -> stand-in/a"]));
  expect(translated.a!.length > 0 && translated.a!.every((q) => q.startsWith("b asks"))).toBe(true);
  expect(translated.c!.length > 0 && translated.c!.every((q) => q.startsWith("a asks"))).toBe(true);
  expect(translated.b).toEqual([]);
  expect(manifest.checked).toEqual({ "stand-in/a -> stand-in/c": positives.filter((e) => e.written_by === "stand-in/a").length, "stand-in/b -> stand-in/a": positives.filter((e) => e.written_by === "stand-in/b").length });
  expect(manifest.checked_by_writer).toBe(0);
  // Each checker's tokens are counted, apart from what the same model spent writing.
  expect(manifest.usage["stand-in/a (translating back)"].input_tokens).toBeGreaterThan(0);
  expect(manifest.usage["stand-in/c (translating back)"].input_tokens).toBeGreaterThan(0);
  expect(manifest.usage["stand-in/a"].input_tokens).toBeGreaterThan(0);
  // The gold program writes the flag one way (leave=yes); a checker's leave=true is the same program.
  const leaving = positives.filter((e) => e.source === "town.seed1" && e.shape.startsWith("occupancy("));
  expect(leaving.length).toBeGreaterThan(0);
  expect(leaving.every((e) => e.program === "occupancy(in=apts-3/dwelling.2, leave=yes, who=c0042)")).toBe(true);
  expect(manifest.dropped.round_trip).toBe(0);
  // A checker with no recorded price is refused like any model.
  await expect(trainingData({ sources: [log], writers: [{ adapter: model("a"), prices }], backs: [{ adapter: model("z"), prices }], out: join(d, "unpriced"), perGold: 1, seed: 3, floor: 0 })).rejects.toThrow("no price recorded for stand-in/z");
});
