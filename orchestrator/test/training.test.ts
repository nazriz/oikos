import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "@oikos/participants/llm";
import { calls } from "@oikos/participants";
import { functionOf, literals, refusalBriefs, refusalWriterSystem, writerSystem, type Example } from "../../translator/train/data";
import { balancedGold, checkBlind, goldOf, trainingData, writeBlind, writerInstructions, writtenData } from "../src/training";

const dir = join(import.meta.dir, "../../runs/test-training-data");
/** The ids a brief gives its writer to name (set off by quotation marks, each with what it is), for a stand-in to say. */
const toName = (brief: string): string => { const at = brief.search(/names? (exactly )?these (other things )?by id/); return at < 0 ? "" : [...brief.slice(at).matchAll(/"([^"\s]+)" \(/g)].map((m) => ` ${m[1]}`).join(""); };
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
    // (A letter asked for indirectly: what is asked of them is the writer's to invent, and to mark.)
    const asked = said.includes("Asked indirectly") ? `mend the fence by the ${model} gate` : undefined;
    const program = said.slice("Call:\n".length, said.indexOf("\n\n")).replace("⟦…⟧", asked ?? "");
    // (Whatever words the style says to use exactly, then every literal.)
    const given = (said.includes("exactly ") ? [...said.slice(said.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") || undefined : undefined);
    const text = `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}${model} asks: ${literals(calls.parseProgram(program)).map((l) => (l === asked ? `⟦${l}⟧` : l)).join(" / ")} (${Bun.hash(said).toString(36)})`;
    programs.set(text.replace(/[⟦⟧]/g, ""), program); // (the model translating back is shown the request without the marks)
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
  // (No letter of these six is asked for indirectly: the one sampled says what it is about, and only a plain letter
  // is. The by-file test below has them; translator/test/train-seats.test.ts has the round trip.)
  expect(manifest.indirect).toBe(0);

  // Blind checking, the next step. The requests alone were written beside the data, shuffled: what a reader is given.
  const lines = (file: string) => readFileSync(join(out, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const blind = lines("blind.jsonl");
  for (const b of blind) expect(Object.keys(b)).toEqual(["id", "request", "forms"]);
  expect(blind.map((b) => b.id).sort()).toEqual(examples.map((e) => e.id).sort());
  expect(blind.map((b) => b.id)).not.toEqual(examples.map((e) => e.id));
  expect(writeBlind(out, 3)).toEqual({ requests: examples.length, out: join(out, "blind.jsonl") });
  expect(lines("blind.jsonl")).toEqual(blind); // the same seed, the same order
  writeBlind(out, 4);
  expect(lines("blind.jsonl").map((b) => b.id)).not.toEqual(blind.map((b) => b.id));
  // A reader's answers, a line each: all right but two (one wrong, one not answered), one spelled another way.
  const answers = join(dir, "answers.jsonl");
  const [wrong, skipped, respelt] = [examples[0], examples[1], examples.find((e) => e.program.includes("amount=\"$500\""))];
  writeFileSync(answers, examples.filter((e) => e !== skipped).map((e) => JSON.stringify({ id: e.id, program: e === wrong ? "none(unclear)" : e === respelt ? e.program.replace('"$500"', '"500 dollars"') : e.program })).join("\n") + "\n");
  const report = checkBlind(out, answers, "reader-y");
  expect(report).toMatchObject({ reader: "reader-y", examples: examples.length, agreed: examples.length - 2, disagreed: 1, unanswered: 1, unknown_ids: 0 });
  const checked = lines("checked.jsonl"), disagreed = lines("disagreed.jsonl");
  expect(checked.length).toBe(examples.length - 2);
  expect(checked.every((e) => e.verified_by === "reader-y" && e.translated_back_by === "stand-in/back")).toBe(true);
  if (respelt) expect(checked.some((e) => e.id === respelt.id)).toBe(true); // "500 dollars" is "$500" in the example's own money
  expect(disagreed.map((e) => [e.id, e.program, e.answer, e.reader])).toEqual([[wrong.id, wrong.program, "none(unclear)", "reader-y"]]);
  // The manifest keeps what it had and gains the check, with counts per function; the examples are as they were.
  const after = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  expect({ ...after, blind_check: undefined }).toEqual({ ...manifest, blind_check: undefined });
  expect(after.blind_check).toEqual(report);
  expect(Object.values(after.blind_check.by_function as { [fn: string]: { agreed: number; disagreed: number; unanswered: number } }).reduce((n, x) => n + x.agreed + x.disagreed + x.unanswered, 0)).toBe(examples.length);
  expect(lines("examples.jsonl")).toEqual(examples);
  // The command: the same check, and the requests for a reader.
  const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), "translator-data-check", out, ...args], { cwd: join(import.meta.dir, "../..") });
  const run = cli("--answers", answers, "--reader", "reader-z");
  expect([run.exitCode, run.stderr.toString()]).toEqual([0, ""]);
  expect(run.stdout.toString()).toContain(`reader-z: agreed on ${examples.length - 2} of ${examples.length}, disagreed on 1, left 1 unanswered`);
  expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).blind_check.reader).toBe("reader-z");
  expect(cli("--blind", "--seed", "3").stdout.toString()).toContain(`${examples.length} requests written to`);
  expect(lines("blind.jsonl")).toEqual(blind);
  expect(cli().exitCode).toBe(2); // neither asked for: the usage
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
    const text = isCall ? `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}please: ${literals(calls.parseProgram(said.slice(6, said.indexOf("\n\n")))).join(" / ")}` : `Request ${++asked}, about this: ${said.split("\n")[1]}${toName(said)}`; // (the situation's own line: whatever it names is in it)
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
  expect(manifest.short_of_floor).toEqual(Object.fromEntries(calls.TRANSLATOR_LABELS.filter((l) => !made.includes(l)).map((l) => [l, 0])));
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
    // (Whatever words the style says to use exactly, the ids it gives to name among them; then every literal.)
    const given = said.includes("exactly ") ? [...said.slice(said.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") : "";
    const text = `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}${name} asks: ${literals(calls.parseProgram(program)).join(" / ")} (${Bun.hash(said).toString(36)})`;
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
  expect(translated.a!.length > 0 && translated.a!.every((q) => q.includes("b asks: "))).toBe(true);
  expect(translated.c!.length > 0 && translated.c!.every((q) => q.includes("a asks: "))).toBe(true);
  expect(translated.b).toEqual([]);
  // (Counted over every example: a refusal built from a positive, the form left out, keeps who wrote and checked its request.)
  expect(manifest.checked).toEqual({ "stand-in/a -> stand-in/c": examples.filter((e) => e.written_by === "stand-in/a").length, "stand-in/b -> stand-in/a": examples.filter((e) => e.written_by === "stand-in/b").length });
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

test("a long job is done in parts: the parts of a gold set don't overlap, together are all of it, and are the same every time", async () => {
  const out = join(dir, "parts");
  rmSync(out, { recursive: true, force: true });
  const seenPrograms: string[][] = [];
  const quiet: LlmAdapter = { provider: "stand-in", model: "p", complete: async () => ({ content: [], usage: { input_tokens: 0, output_tokens: 0 } }) };
  const prices = { "stand-in/p": { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
  const logs: string[] = [];
  for (const index of [0, 1, 2, 0]) {
    logs.length = 0;
    await trainingData({ sources: [], writers: [{ adapter: quiet, prices }], out: join(out, String(index)), perGold: 1, floor: 12, generated: 12, shard: { index, of: 3 }, validation: 0, seed: 9, log: (s) => logs.push(s) });
    seenPrograms.push(logs.filter((l) => l.startsWith("part ")));
  }
  expect(seenPrograms[3]).toEqual(seenPrograms[0]); // the same part again is the same part
  const counts = seenPrograms.slice(0, 3).map((l) => Number(/: (\d+) programs/.exec(l[0]!)![1]));
  const all = /^(\d+) gold programs/.exec(logs.find((l) => /gold programs/.test(l)) ?? "");
  expect(counts.reduce((a, b) => a + b, 0)).toBe(Number(all![1]));
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(19); // within one program per function
});

test("requests written by file: a briefs-only run and the writers' requests taken in give the data a run with models gives; the folder is then checked blind as any other", async () => {
  const d = join(dir, "by-file");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const log = join(d, "town.seed1.jsonl");
  writeFileSync(log, [
    JSON.stringify({ kind: "header", body: { config: { world: { currencies: [{ code: "YUN", minor_units: 0, symbol: "¥", unit_words: ["yun"] }], entities: [{ id: "builder", name: "Millbrook Builders" }] } } } }),
    ...Array.from({ length: 6 }, (_, i) => act(`money(to=builder, amount="¥${500 + i}", from=acc-city, for="the kerb")`)),
    act('message(to=["builder"], text="Start on Monday.")'),
    act("vote(ballot=rec.3, choice=yes)"),
  ].join("\n") + "\n");
  // What a stand-in writer says to a brief, however the brief reached it: every literal of a call (after the words
  // its style says to use exactly), or a situation's own line.
  const say = (brief: string): string => {
    const mark = Bun.hash(brief).toString(36);
    if (!brief.startsWith("Call:\n")) return `Request ${mark}, about this: ${brief.split("\n")[1]}${toName(brief)}`;
    const given = brief.includes("exactly ") ? [...brief.slice(brief.indexOf("exactly ")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" ") : "";
    // (A letter asked for indirectly: the words asked of them are the writer's own, marked.)
    const asked = brief.includes("Asked indirectly") ? `check the drains (${mark}) and report back` : undefined;
    const program = brief.slice(6, brief.indexOf("\n\nWhat it brings about")).replace("⟦…⟧", asked ?? "");
    return `${given ? `${given}${given.endsWith(".") ? "" : ","} ` : ""}please (${mark}): ${literals(calls.parseProgram(program)).map((l) => (l === asked ? `⟦${l}⟧` : l)).join(" / ")}`;
  };
  const model = (name: string): LlmAdapter => ({ provider: "stand-in", model: name, complete: async (req) => ({ content: [{ type: "text", text: say(String((req.messages[0] as any).content)) }], usage: { input_tokens: 7, output_tokens: 3 } }) });
  const free = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const prices = { "stand-in/a": free, "stand-in/b": free };
  const options = { sources: [log], perGold: 2, seed: 3, floor: 8, generated: 4, perShape: 10, refusalFloor: 4, shard: { index: 1, of: 2 }, validation: 0 };
  const lines = (folder: string, file: string) => readFileSync(join(folder, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const json = (folder: string, file: string) => JSON.parse(readFileSync(join(folder, file), "utf8"));

  // With models, as before.
  const withModels = join(d, "models");
  await trainingData({ ...options, writers: [{ adapter: model("a"), prices }, { adapter: model("b"), prices }], out: withModels });

  // The briefs alone: no model is given, and none is asked.
  const out = join(d, "files");
  const b = await trainingData({ ...options, briefsOnly: true, briefsFor: ["stand-in/a", "stand-in/b"], out });
  const plan = json(out, "plan.json");
  expect(b).toEqual({ examples: 0, out, briefs: plan.items.length });
  expect(plan).toMatchObject({ seed: 3, sources: [log], shard: { index: 1, of: 2 }, writers: ["stand-in/a", "stand-in/b"], options: { perGold: 2, refusalFloor: 4, floor: 8, generated: 4, perShape: 10, validation: 0 }, gold_programs: json(withModels, "manifest.json").gold_programs });
  expect(typeof plan.version).toBe("string");
  expect(plan.gold).toEqual(json(withModels, "manifest.json").gold);
  // A line for each item, in the plan's order: its id, which instructions it goes with, and the brief.
  const briefs = lines(out, "briefs.jsonl");
  expect(briefs.map((x) => [x.id, x.kind, x.brief])).toEqual(plan.items.map((t: any) => [t.id, t.kind, t.brief]));
  for (const x of briefs) expect(Object.keys(x).filter((k) => k !== "spare")).toEqual(["id", "kind", "brief"]);
  expect(briefs.filter((x) => x.spare).map((x) => x.id)).toEqual(plan.items.filter((t: any) => t.round > 0).map((t: any) => t.id));
  expect(briefs.some((x) => x.kind === "request") && briefs.some((x) => x.kind === "refusal")).toBe(true);
  // Dealt between the writers in turn, and the plan says who was asked for which.
  const [forA, forB] = [lines(out, "briefs-stand-in-a.jsonl"), lines(out, "briefs-stand-in-b.jsonl")];
  expect(forA).toEqual(briefs.filter((_, k) => k % 2 === 0));
  expect(forB).toEqual(briefs.filter((_, k) => k % 2 === 1));
  expect(plan.items.map((t: any) => t.writer)).toEqual(briefs.map((_, k) => `stand-in/${"ab"[k % 2]}`));
  // The instructions: both kinds', word for word what a model is given, and what to hand back.
  const instructions = readFileSync(join(out, "writer-instructions.txt"), "utf8");
  expect(instructions).toContain(writerSystem());
  expect(instructions).toContain(refusalWriterSystem());
  expect(instructions.split("\n")[0]).toContain('kind "request"');
  expect(instructions).toContain("requests.jsonl");
  expect(instructions).toBe(writerInstructions());
  // The spare refusals can be left out of what the writers are handed; the plan is the same plan.
  const lean = join(d, "no-spares");
  expect((await trainingData({ ...options, briefsOnly: true, briefsFor: ["stand-in/a", "stand-in/b"], noSpares: true, out: lean })).briefs).toBe(briefs.filter((x) => !x.spare).length);
  expect(lines(lean, "briefs.jsonl")).toEqual(briefs.filter((x) => !x.spare));
  expect([...lines(lean, "briefs-stand-in-a.jsonl"), ...lines(lean, "briefs-stand-in-b.jsonl")].length).toBe(briefs.filter((x) => !x.spare).length);
  expect(json(lean, "plan.json")).toEqual(plan);
  // A model, or a price, is asked for only where a model writes.
  await expect(trainingData({ ...options, out: join(d, "nobody") })).rejects.toThrow("no model to write the requests");

  // Each writer's requests, a file each; taken in, they give the examples the models' run gave (the same ids,
  // programs, spans and refusals), the same rejects, and the same requests for a blind reader.
  const write = (name: string, of: any[]) => (writeFileSync(join(d, name), of.map((x) => JSON.stringify({ id: x.id, request: say(x.brief) })).join("\n") + "\n"), join(d, name));
  const [fileA, fileB] = [write("requests-a.jsonl", forA), write("requests-b.jsonl", forB)];
  const r = await writtenData(out, [{ file: fileA, writer: "stand-in/a" }, { file: fileB, writer: "stand-in/b" }]);
  const examples: Example[] = lines(out, "examples.jsonl");
  expect(examples).toEqual(lines(withModels, "examples.jsonl"));
  expect(examples.filter((e) => e.kind === "positive" && e.spans?.length).length).toBeGreaterThan(20);
  // Letters asked for indirectly among them, by file as with models: the plan says which, the marked words are the text.
  expect(plan.options.indirect).toBe(0.5);
  expect(examples.filter((e) => e.indirect).length).toBeGreaterThan(0);
  expect(examples.filter((e) => e.indirect).length).toBeLessThanOrEqual(plan.items.filter((t: any) => t.indirect).length);
  for (const e of examples.filter((x) => x.indirect)) {
    expect(e.program).toMatch(/^message\(text="check the drains \([a-z0-9]+\) and report back", to=/);
    expect(e.request).not.toMatch(/[⟦⟧]/);
    const text = e.spans!.find((x) => x.arg === "text")!;
    expect([text.how, e.request.slice(...text.at!)]).toEqual(["copy", text.value]);
  }
  expect(instructions).toContain("hand the request back with the marks in it");
  expect(examples.some((e) => e.kind === "refusal" && e.built_from) && examples.some((e) => e.kind === "refusal" && e.source.startsWith("written: "))).toBe(true);
  expect(lines(out, "rejects.jsonl")).toEqual(lines(withModels, "rejects.jsonl"));
  expect(lines(out, "blind.jsonl")).toEqual(lines(withModels, "blind.jsonl"));
  const manifest = json(out, "manifest.json"), theirs = json(withModels, "manifest.json");
  expect(r).toEqual({ examples: examples.length, rejects: lines(out, "rejects.jsonl").length, no_request: 0, duplicate_ids: 0, unknown_ids: 0, out });
  for (const k of ["version", "examples", "by_kind", "by_shape", "by_function", "by_style", "writers", "dropped", "spans", "indirect", "refusal_floor", "short_of_floor", "sha256", "sources", "gold_programs", "gold", "seed", "checked_against_held_out"]) expect([k, manifest[k]]).toEqual([k, theirs[k]]);
  expect(manifest).toMatchObject({ no_request: 0, shard: { index: 1, of: 2 }, plan_version: plan.version, cost_microusd: 0, usage: {}, requests_from: [{ writer: "stand-in/a", file: fileA }, { writer: "stand-in/b", file: fileB }] });
  expect(manifest.from_files.requests).toEqual({ "stand-in/a": forA.length, "stand-in/b": forB.length });

  // The commands: the same briefs, the same data; and the blind check then reads the folder as it is.
  const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], { cwd: join(import.meta.dir, "../..") });
  const again = join(d, "cli");
  const made = cli("translator-data", log, "--briefs", "--writers", "stand-in/a,stand-in/b", "--out", again, "--per-gold", "2", "--seed", "3", "--floor", "8", "--generated", "4", "--per-shape", "10", "--refusal-floor", "4", "--shard", "2/2", "--validation", "0");
  expect([made.exitCode, made.stderr.toString()]).toEqual([0, ""]);
  expect(made.stdout.toString()).toContain(`${plan.items.length} briefs written to`);
  expect(json(again, "plan.json")).toEqual(plan);
  for (const f of ["briefs.jsonl", "briefs-stand-in-a.jsonl", "briefs-stand-in-b.jsonl", "writer-instructions.txt"]) expect(readFileSync(join(again, f), "utf8")).toBe(readFileSync(join(out, f), "utf8"));
  // One writer's file lacks a request, and has one that lost what it was to copy: counted, and rejected with its reason.
  const [lost, left] = [forB.find((x) => x.kind === "request")!, forB.filter((x) => x.kind === "request")[1]!];
  writeFileSync(fileB, forB.filter((x) => x.id !== left.id).map((x) => JSON.stringify({ id: x.id, request: x.id === lost.id ? "Please see to it." : say(x.brief) })).join("\n") + "\n");
  const taken = cli("translator-data-write", again, "--requests", fileA, "--writer", "reader-a", "--requests", fileB, "--writer", "reader-b");
  expect([taken.exitCode, taken.stderr.toString()]).toEqual([0, ""]);
  expect(taken.stdout.toString()).toContain("1 planned items had no request");
  const theirsNow: Example[] = lines(again, "examples.jsonl");
  expect(new Set(theirsNow.filter((e) => !e.built_from).map((e) => e.written_by))).toEqual(new Set(["reader-a", "reader-b"]));
  expect(lines(again, "rejects.jsonl")).toContainEqual(expect.objectContaining({ request: "Please see to it.", why: "not_copied", written_by: "reader-b" }));
  expect(json(again, "manifest.json")).toMatchObject({ no_request: 1, examples: theirsNow.length, dropped: { not_copied: manifest.dropped.not_copied + 1 } });
  expect(cli("translator-data-write", again, "--requests", fileA).exitCode).toBe(1); // a file with no writer's name
  const answers = join(d, "answers.jsonl");
  writeFileSync(answers, lines(again, "blind.jsonl").map((x) => JSON.stringify({ id: x.id, program: theirsNow.find((e) => e.id === x.id)!.program })).join("\n") + "\n");
  const checked = cli("translator-data-check", again, "--answers", answers, "--reader", "reader-y");
  expect(checked.stdout.toString()).toContain(`reader-y: agreed on ${theirsNow.length} of ${theirsNow.length}`);
  expect(json(again, "manifest.json")).toMatchObject({ no_request: 1, blind_check: { reader: "reader-y", agreed: theirsNow.length } });

  // A part weighted toward what seats ask, by the command. Letters only, nine in ten indirect, with more generated
  // letters than a gold set has of itself (the other functions' programs are as many as ever).
  const weigh = (name: string, ...args: string[]) => cli("translator-data", log, "--briefs", "--writers", "a,b", "--out", join(d, name), "--per-gold", "2", "--seed", "3", "--floor", "8", "--per-shape", "10", "--validation", "0", ...args);
  const lettersOnly = weigh("letters", "--only", "message", "--indirect", "0.9", "--generated", "60");
  expect([lettersOnly.exitCode, lettersOnly.stderr.toString()]).toEqual([0, ""]);
  const lp = json(join(d, "letters"), "plan.json");
  expect(lp.options).toMatchObject({ only: ["message"], indirect: 0.9, generated: 60 });
  expect(lp.gold.by_function.message.synthetic).toBe(60);
  expect(lp.gold.by_function.vote.synthetic).toBe(100); // (as many as without --generated: it counts the letters only)
  expect(lp.items.length).toBe(lp.gold.by_function.message.total * 2);
  expect(lp.items.every((t: any) => t.kind === "request" && t.gold.shape.includes("message("))).toBe(true);
  const plain = lp.items.filter((t: any) => t.gold.shape === "message(text,to)");
  expect(plain.length).toBeGreaterThan(60);
  expect(plain.filter((t: any) => t.indirect).length / plain.length).toBeGreaterThan(0.8);
  expect(lettersOnly.stdout.toString()).toContain(`requests for ${lp.gold.by_function.message.total} of them (message)`);
  // Refusals alone, of two labels, to a high floor.
  const looksOnly = weigh("looks", "--only", "none", "--refusal-labels", "not_an_act,no_such_act", "--refusal-floor", "9", "--no-spares");
  expect([looksOnly.exitCode, looksOnly.stderr.toString()]).toEqual([0, ""]);
  const rp = json(join(d, "looks"), "plan.json");
  expect(rp.options).toMatchObject({ only: ["none"], refusalLabels: ["not_an_act", "no_such_act"], refusalFloor: 9 });
  const handed = lines(join(d, "looks"), "briefs.jsonl");
  expect(handed.length).toBe(18);
  expect(handed.every((x) => x.kind === "refusal")).toBe(true);
  expect(new Set(rp.items.map((t: any) => t.refusal.label))).toEqual(new Set(["not_an_act", "no_such_act"]));
  // Taken in, the manifest says what the part was weighted toward, and holds only those labels to the floor.
  writeFileSync(join(d, "looks.jsonl"), handed.map((x) => JSON.stringify({ id: x.id, request: say(x.brief) })).join("\n") + "\n");
  expect(cli("translator-data-write", join(d, "looks"), "--requests", join(d, "looks.jsonl"), "--writer", "w").exitCode).toBe(0);
  const lm = json(join(d, "looks"), "manifest.json");
  expect(lm).toMatchObject({ only: ["none"], refusal_labels: ["not_an_act", "no_such_act"], indirect_share: 0.5, by_shape: { "none(not_an_act)": 9 } });
  expect(Object.keys(lm.by_shape).sort()).toEqual(["none(no_such_act)", "none(not_an_act)"]);
  // (Two briefs for the same routine in the same style are the same brief, and the stand-in then says the same
  // thing twice: said before, so that label may be one short. No other label is counted short: none was asked for.)
  expect(Object.keys(lm.short_of_floor).every((l) => l === "no_such_act")).toBe(true);
  // Several acts in one message, asked for by name: as many written piles as the floor (there are no positives to
  // build any from), each in a seat's voice told to name other things by id as one act is.
  const piles = weigh("piles", "--only", "none", "--refusal-labels", "too_much", "--refusal-floor", "6", "--no-spares");
  expect([piles.exitCode, piles.stderr.toString()]).toEqual([0, ""]);
  const pp = json(join(d, "piles"), "plan.json");
  expect(pp.items.length).toBe(6);
  expect(pp.items.every((t: any) => t.kind === "refusal" && t.refusal.label === "too_much" && t.refusal.source === "piled")).toBe(true);
  for (const t of pp.items) expect([t.style, t.brief.includes("each act is a sentence of its own"), t.refusal.mustCopy.includes(t.refusal.mention[0])]).toEqual([t.style, ["early", "late"].includes(t.style), ["early", "late"].includes(t.style)]);
  // Forms of several amounts, added to the gold set by the command and written for alone; and requests of two acts.
  const sums = weigh("sums", "--only", "amount_form", "--amount-forms", "6");
  expect([sums.exitCode, sums.stderr.toString()]).toEqual([0, ""]);
  const sp = json(join(d, "sums"), "plan.json");
  expect(sp.options).toMatchObject({ only: ["amount_form"], amountForms: 6 });
  expect(sp.items.length).toBe(6 * 4 * 2);
  expect(sp.items.every((t: any) => t.kind === "request" && t.gold.tag === "amount_form" && t.brief.includes("each said against the form's own label for it"))).toBe(true);
  writeFileSync(join(d, "sums.jsonl"), sp.items.map((x: any) => JSON.stringify({ id: x.id, request: say(x.brief) })).join("\n") + "\n");
  expect(cli("translator-data-write", join(d, "sums"), "--requests", join(d, "sums.jsonl"), "--writer", "w").exitCode).toBe(0);
  // (This stand-in says each value once and no total: where two fields have the same amount, or a total was asked
  // for, its request is not the call's and is dropped; the rest are kept.)
  const sm = json(join(d, "sums"), "manifest.json");
  expect(sm).toMatchObject({ only: ["amount_form"], amount_forms: 6 });
  expect(sm.by_function.form + sm.dropped.not_copied).toBe(48);
  expect(sm.by_function.form).toBeGreaterThan(10);
  const two = weigh("two", "--only", "form,statement", "--pairs", "1", "--pairs-only", "--generated", "40");
  expect([two.exitCode, two.stderr.toString()]).toEqual([0, ""]);
  const tp = json(join(d, "two"), "plan.json");
  expect(tp.options).toMatchObject({ only: ["form", "statement"], pairs: 1, pairsOnly: true });
  expect(tp.items.length).toBeGreaterThan(80);
  // (Two lines each, but for the forms that close with what becomes of them and name nobody: one line, about a
  // quarter as many as the forms with a direction.)
  expect(tp.items.every((t: any) => t.kind === "request" && (t.pair ? t.gold.program.split("\n").length === 2 : t.riders.some((r: any) => r.kind === "what_next") && !t.gold.program.includes("\n")))).toBe(true);
  expect(tp.items.filter((t: any) => !t.pair).length).toBeGreaterThan(5);
  expect(new Set(tp.items.map((t: any) => t.pair).filter(Boolean))).toEqual(new Set(["form+message", "withdraw+message", "withdraw+withdraw"]));
  await expect(trainingData({ ...options, pairs: 3, briefsOnly: true, out: join(d, "bad") })).rejects.toThrow("pairs: a share from 0 to 1");
  // With models, the same options and the same record.
  const weighted = join(d, "weighted-models");
  await trainingData({ ...options, shard: undefined, refusalFloor: undefined, only: ["message"], indirect: 1, writers: [{ adapter: model("a"), prices }], out: weighted });
  const wm = json(weighted, "manifest.json");
  expect(wm).toMatchObject({ only: ["message"], indirect_share: 1, by_function: { message: expect.any(Number) } });
  expect(Object.keys(wm.by_function)).toEqual(["message"]);
  expect(wm.indirect).toBeGreaterThan(0);
  expect(Object.keys(wm.request_length).length).toBeGreaterThan(3);
  // A part made of kinds of program by name: holds and entries drawn among the generated statements, an office's own
  // forms among the forms, standing work among the work; `generated` counts their functions' programs.
  const named = ["hold", "entry", "direction", "paper", "standing_work"];
  await trainingData({ ...options, shard: undefined, refusalFloor: undefined, only: named, generated: 400, briefsOnly: true, out: join(d, "kinds") });
  const kp = json(join(d, "kinds"), "plan.json");
  const asked = kp.items.filter((t: any) => t.kind === "request");
  expect(kp.options).toMatchObject({ only: named, generated: 400 });
  expect(asked.every((t: any) => named.includes(t.gold.tag))).toBe(true);
  const of = (re: RegExp) => asked.filter((t: any) => re.test(t.gold.program)).length;
  expect([of(/^statement\(hold=/) > 40, of(/^statement\(.*visible=own/) > 40, of(/^form\(/) > 200, of(/^work\(.*every=/) > 100]).toEqual([true, true, true, true]);
  // Payments of a bank's and a finance office's kinds, by name; a part weighted toward an asker and toward some worlds' money.
  const pay = { ...options, shard: undefined, refusalFloor: undefined, perGold: 1, floor: 20, generated: 20, broad: true, briefsOnly: true as const };
  await trainingData({ ...pay, only: ["per_request", "finance_payment"], bankPayments: 60, financePayments: 40, money: { ORO: 9 }, out: join(d, "payments") });
  const payPlan = json(join(d, "payments"), "plan.json");
  expect(payPlan.options).toMatchObject({ only: ["per_request", "finance_payment"], bankPayments: 60, financePayments: 40, money: { ORO: 9 } });
  const paid = payPlan.items.filter((t: any) => t.kind === "request");
  expect(payPlan.items.length).toBe(100);
  expect([paid.filter((t: any) => t.gold.tag === "per_request" && t.asker === "banker" && /per_request=rec\.\d+/.test(t.gold.program)).length, paid.filter((t: any) => t.gold.tag === "finance_payment").length]).toEqual([60, 40]);
  // (One currency of the worlds' twenty-odd, nine times over: about a quarter of the programs, where its even share is under a twentieth.)
  expect(paid.filter((t: any) => t.gold.currency.code === "ORO").length).toBeGreaterThan(15);
  await trainingData({ ...pay, only: ["statement"], askers: { banker: 0.6 }, out: join(d, "askers") });
  const ap = json(join(d, "askers"), "plan.json");
  expect(ap.options).toMatchObject({ askers: { banker: 0.6 } });
  expect(ap.items.filter((t: any) => t.asker === "banker").length).toBeGreaterThan(ap.items.length / 4);
  await expect(trainingData({ ...pay, askers: { teller: 0.5 }, out: join(d, "bad") })).rejects.toThrow("askers: teller=0.5 is not an asker");
  await expect(trainingData({ ...pay, broad: false, askers: { banker: 0.5 }, out: join(d, "bad") })).rejects.toThrow("askers: only a wide part");
  await expect(trainingData({ ...pay, money: { NOPE: 2 }, out: join(d, "bad") })).rejects.toThrow("money: NOPE=2 is not the code");
  // A function or a label the call language doesn't have, or a share that is none, is refused before anything is written.
  await expect(trainingData({ ...options, only: ["letters"], briefsOnly: true, out: join(d, "bad") })).rejects.toThrow("only: no function letters");
  await expect(trainingData({ ...options, refusalLabels: ["reading"], briefsOnly: true, out: join(d, "bad") })).rejects.toThrow("refusal labels: no label reading");
  await expect(trainingData({ ...options, indirect: 9, briefsOnly: true, out: join(d, "bad") })).rejects.toThrow("indirect: a share from 0 to 1");
}, 180_000);
