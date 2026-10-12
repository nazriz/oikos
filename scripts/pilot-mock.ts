#!/usr/bin/env bun
// A dry run of a wave on the mock: `bun scripts/pilot-mock.ts <wave> <queue.json>... [--days 30] [--jobs N]`. Every pilot
// of the queue files is run as written (world, seed, seats, profile, until, whatever `sets` and `args` it carries) but
// with the mock in every seat and as the translator, into <runs>/pilot-queues/<wave>.mock/<name> (never the pilots' own
// folders), as far as --days (30 by default) of its run. One line each: generated or not, ran to the end or not, and why
// not. No model is called: the run is given no --model, nothing of the entry's env is passed on, and the log is checked
// afterwards (a seat or translator that was not the mock fails the pilot). Purpose: find the entry that cannot run
// before real usage is spent on it. One thing of the entry's is kept: a translator that answers first (`translator_first`,
// our own trained model: it runs on this machine and costs nothing) answers first here too, in the entry's arrangement,
// with the mock behind it, from the models' folder the entry's env names; so the dry run goes through the arrangement.
import { existsSync, readFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadWorld } from "../orchestrator/src/batch";
import { currentLogs, logLines, realModelIn } from "../orchestrator/src/logs";
import { framingSets, readWorldFile } from "../orchestrator/src/pilot-state";
import { formatDry, judgeDry, readDryFacts, type DryOptions, type Finding } from "../orchestrator/src/dry-check";

export interface MockResult { pilot: string; generated: boolean; ranToEnd: boolean; reason?: string; line: string; /** What the run showed, did not show, and could not yet show (orchestrator/src/dry-check.ts). */ dry?: Finding[] }

const DAY = 86_400;
const root = resolve(import.meta.dir, "..");

/** The seats and translator a run's log says it used: every one must be the mock. Returns what is not. */
async function notMock(log: string): Promise<string | undefined> {
  const real = await realModelIn(log);
  if (real) return real;
  for await (const l of logLines(log)) {
    if (!l.includes('"annotation":"orchestrator"')) continue;
    const llm = JSON.parse(l).body?.data?.llm ?? {};
    for (const [seat, p] of Object.entries<any>(llm.participants ?? {})) if (!String(p.adapter ?? "").startsWith("mock/")) return `${seat} on ${p.adapter}`;
    // (With a translator that answers first, the one behind must be the mock, and the first our own trained model.)
    const two = llm.translator_arrangement;
    if (two && !String(two.behind?.model ?? "").startsWith("mock/")) return `translator behind on ${two.behind?.model}`;
    if (two && !String(two.first?.model ?? "").startsWith("decide/")) return `translator first on ${two.first?.model}`;
    if (!two && llm.translator && !String(llm.translator.model ?? "").startsWith("mock/")) return `translator on ${llm.translator.model}`;
    return undefined;
  }
  return undefined;
}

export async function mockPilot(p: any, outRoot: string, days: number, dryOptions: DryOptions = {}): Promise<MockResult> {
  const done = (r: Omit<MockResult, "pilot" | "line">): MockResult => ({ pilot: p.name, ...r, line: `${p.name}: ${r.generated ? "generated" : "NOT generated"}; ${r.generated ? (r.ranToEnd ? "ran to the end" : "did NOT run to the end") : "did not run"}${r.reason ? ` (${r.reason})` : ""}` });
  for (const k of ["name", "world", "until"]) if (p[k] === undefined) return done({ generated: false, ranToEnd: false, reason: `the entry has no ${k}` });
  // (With the entry's framing, as the queue gives it to the run: a dry run is under the framing the pilot will be.)
  const sets: string[] = [...(p.sets ?? []), ...(typeof p.world === "string" ? framingSets(p, readWorldFile(resolve(root, p.world))).sets : [])];
  const world = resolve(root, p.world);
  if (!existsSync(world)) return done({ generated: false, ranToEnd: false, reason: `no such world file: ${p.world}` });
  try {
    await loadWorld(world, sets);
  } catch (e) {
    return done({ generated: false, ranToEnd: false, reason: `the world did not generate: ${String((e as Error).message).slice(0, 300)}` });
  }
  const until = Math.min(p.until, Math.round(days * DAY));
  const out = join(outRoot, p.name);
  // (No --model: the mock answers in every seat and as the translator. The entry's own env is not passed on.)
  const env: { [k: string]: string | undefined } = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^OIKOS_(CLAUDE|CODEX|DECIDE|TRANSLATOR_MODELS)/.test(k)));
  // (But for a trained translator that answers first: kept, with where its models are.)
  const first: string | undefined = typeof p.translator_first === "string" && p.translator_first.startsWith("decide/") ? p.translator_first : undefined;
  if (first && p.env?.OIKOS_TRANSLATOR_MODELS) env.OIKOS_TRANSLATOR_MODELS = p.env.OIKOS_TRANSLATOR_MODELS;
  // (An entry that has its composing models called for real (`--composer`) is dry-run without that flag: the mock then
  // plays the composer, as it does every seat, and no spending limit is asked for. With the flag the run refused to
  // start for want of a limit, and the entry could not be dry-run at all: the third living pilot's review, fault 8.)
  const args: string[] = (p.args ?? []).filter((a: string) => a !== "--composer");
  const cmd = ["bun", "orchestrator/src/cli.ts", "run", p.world, "--seeds", "1", "--out", out, "--until", String(until), "--overwrite", "--no-measure", ...sets.flatMap((x) => ["--set", x]), ...args,
    ...(first ? ["--translator-first", first, ...(p.translator_arrangement ? ["--translator-arrangement", p.translator_arrangement] : [])] : [])];
  const child = Bun.spawn(cmd, { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  const [text, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const log = existsSync(out) ? currentLogs(out).find((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f)) : undefined;
  if (!log) return done({ generated: true, ranToEnd: false, reason: `no log was made (exit ${code}): ${(err || text).trim().split("\n").slice(-3).join(" | ").slice(0, 400)}` });
  const bad = await notMock(log);
  if (bad) return done({ generated: true, ranToEnd: false, reason: `NOT THE MOCK: ${bad}` });
  const sp = log.replace(/\.jsonl(\.zst)?$/, ".summary.json");
  const s = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : undefined;
  if (s && s.t >= until && code === 0) {
    // (What the run showed, and what it was too short to show: said, never passed over. A fault in it is the entry's to look into.)
    const dry = judgeDry(await readDryFacts(log, until >= p.until), dryOptions);
    return done({ generated: true, ranToEnd: true, reason: until < p.until ? `to day ${Math.round(until / DAY)} of ${Math.round(p.until / DAY)}` : undefined, dry });
  }
  return done({ generated: true, ranToEnd: false, reason: `stopped on day ${s ? Math.round(s.t / DAY) : "?"} (exit ${code}): ${String(s?.end?.detail ?? (err || text).trim().split("\n").slice(-2).join(" | ")).slice(0, 400)}` });
}

/** Every pilot of the queue files, a few at a time; the results come out in queue order. */
export async function mockWave(queues: string[], outRoot: string, days: number, jobs = Math.max(1, Math.min(4, Math.floor(cpus().length / 2))), dryOptions: DryOptions = {}): Promise<MockResult[]> {
  const pilots: any[] = queues.flatMap((q) => { const v = JSON.parse(readFileSync(q, "utf8")); if (!Array.isArray(v)) throw new Error(`${q}: a queue is a list of pilots`); return v; });
  const results: MockResult[] = new Array(pilots.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, pilots.length) }, async () => { for (;;) { const i = next++; if (i >= pilots.length) return; results[i] = await mockPilot(pilots[i], outRoot, days, dryOptions); } }));
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const bare = (n: string) => { const i = args.indexOf(`--${n}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const days = Number(flag("days") ?? 30), jobs = flag("jobs");
  const booksBy = flag("books-by"), whenOpen = flag("books-when-open");
  const dryOptions: DryOptions = { ...(booksBy ? { booksBy: Number(booksBy) } : {}), ...(whenOpen ? { booksWhenOpen: whenOpen.split(",") } : {}) };
  // `--check <log> [--full]`: say what an existing mock run's log showed, did not show and could not yet show (--full: it was the pilot's whole length).
  const checkLog = flag("check"), full = bare("full");
  if (checkLog) {
    const lines = formatDry(judgeDry(await readDryFacts(resolve(checkLog), full), dryOptions));
    console.log(lines.join("\n"));
    process.exit(lines.some((l) => l.includes("[not shown]")) ? 1 : 0);
  }
  const [wave, ...queues] = args;
  if (!wave || !queues.length) throw new Error("usage: bun scripts/pilot-mock.ts <wave> <queue.json>... [--days 30] [--jobs N] [--books-by D] [--books-when-open seat,...] | --check <log> [--full]");
  const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
  const results = await mockWave(queues.map((q) => resolve(q)), join(runs, "pilot-queues", `${wave}.mock`), days, jobs ? Number(jobs) : undefined, dryOptions);
  for (const r of results) { console.log(r.line); if (r.dry) console.log(formatDry(r.dry).join("\n")); }
  const bad = results.filter((r) => !r.generated || !r.ranToEnd);
  // (A thing the run should have shown and did not is a fault of the entry too; a thing it was too short to show is not, and is not passed either.)
  const unshown = results.filter((r) => r.dry?.some((x) => x.outcome === "not shown"));
  console.log(`${results.length - bad.length} of ${results.length} would run${bad.length ? `; ${bad.length} would not: ${bad.map((r) => r.pilot).join(", ")}` : ""}${unshown.length ? `; ${unshown.length} did not show what it should have: ${unshown.map((r) => r.pilot).join(", ")}` : ""}`);
  process.exit(bad.length || unshown.length ? 1 : 0);
}
