#!/usr/bin/env bun
// The port's gate, its measured half (docs/design/rust-port.md section 3; docs/port-guide.md, "The gate"): the TS world
// (a checkout of main as it stood when the port began, tag `ts-world-final`) and the finished Rust world, a year of the
// 1,000-person living town in three profiles, five run seeds a side, every standing measure compared against seed noise,
// health breaches compared in kind, and the Rust world's state hash compared on 1 thread and on 14.
//
//   bun scripts/port-gate.ts --ts <TS checkout> --rust <Rust checkout> [--out runs/port-gate] [--seeds 5]
//       [--profiles au-vic-2026,gb-eng-2026,ke-nakuru-2026] [--days 365] [--world worlds/town-1000.yaml] [--set k=v ...]
//       [--only measure|threads] [--reuse] [--dry]
//
// Each side is run with its own checkout's CLI (`oikos run`), the Rust side with OIKOS_WORLD=rust (the switch that the
// integration step makes the CLI honour: until then `--rust-env K=V` names another), each through the machine's slots.
// `--reuse` keeps a side already run in the out folder (a gate rerun after a fix runs only the Rust side again: pass
// `--fresh rust`). `--dry` prints the commands and runs nothing.
//
// Verdict, per profile: FAIL if any measure is beyond three standard errors; each beyond two is NAMED (the integration
// agent writes a likely cause for each, docs/decisions.md); FAIL if the breaches of the profile's targets differ in kind;
// FAIL if the Rust world's state hash differs between 1 and 14 threads. Nothing here tunes anything. The report is
// `<out>/gate.json` and the text on stdout; exit 1 on any FAIL.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string, d?: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const flags = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]!] : []));
const has = (name: string) => argv.includes(`--${name}`);

const here = resolve(import.meta.dir, "..");
const tsDir = resolve(flag("ts") ?? "");
const rustDir = resolve(flag("rust") ?? here);
const out = resolve(flag("out", join(here, "runs", "port-gate"))!);
const seeds = Number(flag("seeds", "5"));
const days = Number(flag("days", "365"));
const profiles = flag("profiles", "au-vic-2026,gb-eng-2026,ke-nakuru-2026")!.split(",");
const world = flag("world", "worlds/town-1000.yaml")!;
// The living town, as the standing year measures run it (docs/decisions.md, 2026-10-13 onward).
const sets = flags("set").length ? flags("set") : ["living.initiative_bps=10000"];
const rustEnv = Object.fromEntries((flags("rust-env").length ? flags("rust-env") : ["OIKOS_WORLD=rust"]).map((kv) => kv.split("=", 2) as [string, string]));
const only = flag("only");
const dry = has("dry");
const fresh = new Set(flags("fresh"));

if (!flag("ts") || !existsSync(join(tsDir, "orchestrator/src/cli.ts"))) throw new Error("--ts <dir>: a checkout of the TS world (git worktree add <dir> ts-world-final)");
if (!existsSync(join(rustDir, "orchestrator/src/cli.ts"))) throw new Error("--rust <dir>: the candidate checkout");

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}): { code: number; out: string } {
  const line = `${Object.entries(env).map(([k, v]) => `${k}=${v} `).join("")}(cd ${cwd} && ${cmd.join(" ")})`;
  console.log(`$ ${line}`);
  if (dry) return { code: 0, out: "" };
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" });
  const text = r.stdout.toString();
  if (r.exitCode !== 0) console.log(text.slice(-4000));
  return { code: r.exitCode ?? 1, out: text };
}

/** A side's batch for a profile: `oikos run` in its own checkout (it takes its own slots for its runs). */
function batch(side: "ts" | "rust", profile: string, n: number, dir: string, env: Record<string, string> = {}): string {
  if (has("reuse") && !fresh.has(side) && existsSync(join(dir, "measure"))) return dir;
  const cwd = side === "ts" ? tsDir : rustDir;
  // (Disk first: a batch is not started with under 40 GB free on the volume the runs go to.)
  if (!dry) {
    const df = Bun.spawnSync(["df", "-k", out], { stdout: "pipe" }).stdout.toString().trim().split("\n").at(-1)!.split(/\s+/);
    const freeGb = Number(df[3]) / 1024 / 1024;
    if (freeGb < 40) throw new Error(`only ${freeGb.toFixed(0)} GB free under ${out}: the gate pauses (free space, then run again with --reuse)`);
  }
  const r = sh(["bun", "orchestrator/src/cli.ts", "run", world, "--seeds", String(n), "--parallel", flag("parallel", "5")!, "--until", String(days * 86_400), "--set", `profile=${profile}`, ...sets.flatMap((s) => ["--set", s]), "--out", dir, "--overwrite"], cwd, { ...(side === "rust" ? rustEnv : {}), ...env });
  if (r.code !== 0) throw new Error(`the ${side} batch for ${profile} failed`);
  dropLogs(dir);
  return dir;
}

/** The state hash at the end of each run in a batch folder, by run (from the runs' summaries, so the logs can go). */
function endHashes(dir: string): string[] {
  if (dry) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".summary.json")).sort()
    .map((f) => String(JSON.parse(readFileSync(join(dir, f), "utf8")).stateHash ?? "unfinished"));
}

/** A batch's logs, once its measures are extracted: deleted, unless --keep-logs (a 1,000-person year is large; the
 * measures, summaries and cost are what the gate reads). Never for a run that asked a model (none here do). */
function dropLogs(dir: string) {
  if (dry || has("keep-logs")) return;
  for (const f of readdirSync(dir)) if (/\.jsonl(\.zst)?$/.test(f) || f.endsWith(".blog")) rmSync(join(dir, f));
}

interface ProfileVerdict { profile: string; fail: string[]; named: { query: string; key: string; measure: string; z: number; base: number; change: number }[]; measures: number; breaches?: { ts: string[]; rust: string[] }; threads?: { one: string[]; fourteen: string[] } }

const verdicts: ProfileVerdict[] = [];
const { diff, health } = await import(join(rustDir, "measure/src/index.ts")) as { diff: Function; health: Function };
const { loadProfile } = await import(join(rustDir, "worlds/generator/profile.ts"));
for (const profile of profiles) {
  const v: ProfileVerdict = { profile, fail: [], named: [], measures: 0 };
  const base = join(out, profile);
  mkdirSync(base, { recursive: true });
  if (only !== "threads") {
    const a = batch("ts", profile, seeds, join(base, "ts"));
    const b = batch("rust", profile, seeds, join(base, "rust"));
    if (!dry) {
      const rows = (await diff(join(a, "measure"), join(b, "measure"))) as { query: string; key: string; measure: string; z?: number; base: number; change: number; n: [number, number] }[];
      v.measures = rows.length;
      for (const r of rows) {
        const z = Math.abs(r.z ?? 0);
        if (z > 3) v.fail.push(`${r.query} ${r.key} ${r.measure}: ${z.toFixed(1)} standard errors (TS ${r.base}, Rust ${r.change})`);
        else if (z > 2) v.named.push({ query: r.query, key: r.key, measure: r.measure, z: Number(z.toFixed(2)), base: r.base, change: r.change });
      }
      const targets = (loadProfile(profile) as any).targets ?? [];
      const breached = async (dir: string) => ((await health(join(dir, "measure"), targets)) as { what: string; breach: boolean }[]).filter((h) => h.breach).map((h) => h.what).sort();
      v.breaches = { ts: await breached(a), rust: await breached(b) };
      if (v.breaches.ts.join() !== v.breaches.rust.join()) v.fail.push(`health breaches differ in kind: TS ${v.breaches.ts.join(", ") || "none"}; Rust ${v.breaches.rust.join(", ") || "none"}`);
    }
  }
  if (only !== "measure") {
    const one = batch("rust", profile, 1, join(base, "threads-1"), { OIKOS_ENGINE_THREADS: "1" });
    const many = batch("rust", profile, 1, join(base, "threads-14"), { OIKOS_ENGINE_THREADS: "14" });
    v.threads = { one: endHashes(one), fourteen: endHashes(many) };
    if (!dry && (v.threads.one.join() !== v.threads.fourteen.join() || !v.threads.one.length)) v.fail.push(`the state hash on 1 thread (${v.threads.one.join()}) and on 14 (${v.threads.fourteen.join()}) differ`);
  }
  verdicts.push(v);
}

const failed = verdicts.some((v) => v.fail.length);
const report = { at: new Date().toISOString(), ts: tsDir, rust: rustDir, world, sets, seeds, days, profiles: verdicts, verdict: failed ? "FAIL" : "PASS" };
if (!dry) writeFileSync(join(out, "gate.json"), JSON.stringify(report, null, 2));
for (const v of verdicts) {
  console.log(`\n## ${v.profile}: ${v.fail.length ? "FAIL" : "pass"} (${v.measures} measures)`);
  for (const f of v.fail) console.log(`  FAIL ${f}`);
  for (const n of v.named) console.log(`  named (beyond 2 SE, write its likely cause): ${n.query} ${n.key} ${n.measure} ${n.z}`);
}
console.log(`\nThe gate's measured half: ${report.verdict}${dry ? " (dry: nothing was run)" : ` (${join(out, "gate.json")})`}. The rest of the gate is tests: every scenario test, twins, the backstops (docs/port-guide.md).`);
process.exit(failed && !dry ? 1 : 0);
