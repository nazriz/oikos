// Log size (docs/reliability.md): a lean log keeps what replay needs (no observation hashes, no code participants'
// written reasoning) and still replays; a compressed log reads back whole, and everything that reads logs reads it.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { exportDataset } from "../src/dataset";
import { kernelBinary } from "../src/kernel";
import { compressLog, logLines, readLog } from "../src/logs";
import { prepareResume } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a lean log: no observation hashes, no code participants' reasoning (a model's kept), the same world, and it replays", async () => {
  const out = join(root, "runs", "test-logs");
  rmSync(out, { recursive: true, force: true });
  const run = async (detail: string) => {
    const config = generate({ ...spec, citizens: 80, mayor: "llm" });
    config.log = { ...config.log, detail };
    return runWorld({ config, runId: detail, outDir: out, until: 30 * DAY });
  };
  const full = await run("full");
  const lean = await run("lean");
  // The same world, whatever the log keeps.
  expect(lean.stateHash).toBe(full.stateHash);
  const entries = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const f = entries(full.logPath);
  const l = entries(lean.logPath);
  expect(f.some((e) => e.kind === "event" && e.body.event === "observation")).toBe(true);
  expect(l.some((e) => e.kind === "event" && e.body.event === "observation")).toBe(false);
  const acts = (es: any[]) => es.filter((e) => e.kind === "command" && e.body.command === "act");
  expect(acts(f).some((e) => e.body.reasoning && e.body.participant !== "mayor-system")).toBe(true);
  expect(acts(l).some((e) => e.body.reasoning && e.body.participant !== "mayor-system")).toBe(false);
  // Citizens' decisions, as their minds made them (training data), in the full log only.
  const decisions = (es: any[]) => es.filter((e) => e.kind === "annotation" && e.body.annotation === "decision").map((e) => e.body.data);
  expect(new Set(decisions(f).map((d) => d.domain))).toContain("shop");
  expect(decisions(f).every((d) => Array.isArray(d.options) && d.options.every((o: any) => Number.isInteger(o.score)))).toBe(true);
  expect(decisions(l)).toEqual([]);
  // What each had before it: the options' facts and the citizen's circumstances, wherever the mind decided; who they
  // are, with each citizen's first and no other.
  const minded = decisions(f).filter((d) => d.state);
  expect(minded.length).toBeGreaterThan(0);
  expect(minded.every((d) => Number.isInteger(d.circumstances?.savings) && d.options.every((o: any) => Number.isInteger(o.facts?.money_per_month)))).toBe(true);
  expect(minded.some((d) => d.options.some((o: any) => Number.isInteger(o.learned)))).toBe(true);
  const firstOf = new Map<string, any>();
  for (const e of f) if (e.kind === "annotation" && e.body.annotation === "decision" && e.body.data.state && !firstOf.has(e.body.subject)) firstOf.set(e.body.subject, e.body.data);
  expect([...firstOf.values()].every((d) => d.person?.values && d.person.temperament && d.person.weights)).toBe(true);
  expect(minded.filter((d) => d.person).length).toBe(firstOf.size);
  // Asked not to record them: the same world, none in the log, and the log says so for a run that resumes it.
  const config = generate({ ...spec, citizens: 80, mayor: "llm" });
  const quiet = await runWorld({ config, runId: "quiet", outDir: out, until: 30 * DAY, recordDecisions: "none", recordObservations: "none" });
  expect(quiet.stateHash).toBe(full.stateHash);
  const q = entries(quiet.logPath);
  expect(decisions(q)).toEqual([]);
  expect(q.some((e) => e.kind === "annotation" && e.body.annotation === "observation")).toBe(false);
  expect(acts(q).length).toBe(acts(f).length);
  // A language model's observations are recorded without being asked (training data), and no one else's.
  const recorded = l.filter((e) => e.kind === "annotation" && e.body.annotation === "observation").map((e) => e.body.subject);
  expect(recorded.length).toBeGreaterThan(0);
  expect(new Set(recorded)).toEqual(new Set(["mayor-system"]));
  // (The mayor, a model, keeps its reasoning.)
  const mayorWhy = (es: any[]) => acts(es).filter((e) => e.body.participant === "mayor-system" && e.body.reasoning).length;
  expect(mayorWhy(l)).toBe(mayorWhy(f));
  expect(statSync(lean.logPath).size).toBeLessThan(statSync(full.logPath).size);
  // It replays.
  const replay = Bun.spawnSync([kernelBinary(), "replay", lean.logPath, "--anchors", lean.anchorsPath], { stdout: "pipe", stderr: "pipe" });
  expect(replay.exitCode).toBe(0);

  expect(prepareResume(quiet.logPath).recording).toEqual({ observations: "none", decisions: "none" });

  // Compressed: much smaller, reads back byte for byte, and gives the same dataset.
  const plain = readFileSync(full.logPath, "utf8");
  const before = statSync(full.logPath).size;
  const plainSet = join(out, "plain.dataset");
  await exportDataset(full.logPath, plainSet);
  const zst = await compressLog(full.logPath);
  expect(zst).toBe(`${full.logPath}.zst`);
  expect(existsSync(full.logPath)).toBe(false);
  expect(statSync(zst).size * 4).toBeLessThan(before);
  expect(readLog(zst)).toBe(plain);
  const zstSet = join(out, "zst.dataset");
  await exportDataset(zst, zstSet);
  for (const file of ["decisions.jsonl", "translations.jsonl", "systems.jsonl"]) expect(readFileSync(join(zstSet, file), "utf8")).toBe(readFileSync(join(plainSet, file), "utf8"));
  // (The manifest names the file it was made from; the rest is the same.)
  const manifest = (d: string) => JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
  expect({ ...manifest(zstSet), log: { ...manifest(zstSet).log, file: "" } }).toEqual({ ...manifest(plainSet), log: { ...manifest(plainSet).log, file: "" } });
}, 600_000);

test("a compressed log much larger than a stream's buffers reads back whole, line by line (a 5-year run's is gigabytes)", async () => {
  // Bun 1.3's zstd stream stalled after 64 MB, so every big compressed log hung on reading back (fixed in 1.4).
  const dir = join(root, "runs", "test-logs-big");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "big.jsonl");
  const n = 1_200_000;
  const w = Bun.file(path).writer();
  for (let i = 0; i < n; i++) w.write(`{"seq":${i},"kind":"event","body":{"event":"transfer","amount":"${(i * 7919) % 100_000}","pad":"${"x".repeat(60)}"}}\n`);
  await w.end();
  expect(statSync(path).size).toBeGreaterThan(100 * 1024 * 1024);
  const zst = await compressLog(path);
  let lines = 0;
  let last = "";
  for await (const l of logLines(zst)) { lines++; last = l; }
  expect(lines).toBe(n);
  expect(JSON.parse(last).seq).toBe(n - 1);
  rmSync(dir, { recursive: true, force: true });
}, 120_000);
