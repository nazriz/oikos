import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "@oikos/participants/llm";
import { calls } from "@oikos/participants";
import { literals } from "../../translator/train/data";
import { goldOf, trainingData } from "../src/training";

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
    const text = `${model} asks: ${literals(calls.parseProgram(program)).join(" / ")} [${said.slice(-12)}]`;
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
  const r = await trainingData({ sources: [log], writers: [{ adapter: writer("a"), prices }, { adapter: writer("b"), prices }], back: { adapter: back, prices }, out, perGold: 2, limit: 6, seed: 3 });
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
