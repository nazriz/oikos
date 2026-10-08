#!/usr/bin/env bun
// Pilots one after another, unattended: `bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES]`.
// The queue is a list of {name, world, sets, model, translator?, until, budget, env?}: each runs into <runs>/<name>
// (OIKOS_RUNS, or ~/oikos/runs), is taken up again where it stopped if its log is already there, and is waited for and
// resumed when it stops at a usage limit (the limit's window may be hours: it is asked again every --wait minutes, 20 if
// not given). One that fails twice for another reason is left, with why, and the next is started. A queue is one lane:
// start one for each way in (one for Claude Code, one for Codex) and they run side by side. Nothing here decides
// anything about a pilot: which models, towns and seats is the queue file's.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface Pilot { name: string; world: string; sets?: string[]; model: string; translator?: string; until: number; budget: number; env?: { [k: string]: string }; note?: string }

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES]");
const waitMs = 60_000 * Number(args[args.indexOf("--wait") + 1] && args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 20);
const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
const root = resolve(import.meta.dir, "..");
const queue: Pilot[] = JSON.parse(readFileSync(file, "utf8"));
const status = file.replace(/\.json$/, "") + ".status.log";
const say = (line: string) => { const l = `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${line}`; console.log(l); appendFileSync(status, l + "\n"); };

/** A run's log in a folder, if it has one, and how it ended: the last entry's time, and why it stopped. */
function state(dir: string): { log?: string; t?: number; ended?: string; detail?: string } {
  if (!existsSync(dir)) return {};
  const log = readdirSync(dir).find((f) => /\.seed\d+\.jsonl$/.test(f));
  if (!log) return {};
  const text = readFileSync(join(dir, log), "utf8");
  const last = text.slice(text.lastIndexOf("\n", text.length - 2) + 1).trim();
  try {
    const e = JSON.parse(last);
    return { log: join(dir, log), t: e.t, ...(e.kind === "end" ? { ended: e.body?.reason, detail: e.body?.detail } : {}) };
  } catch {
    return { log: join(dir, log) };
  }
}
const LIMIT = /limit|429|too many requests|credit/i;

for (const p of queue) {
  const dir = join(runs, p.name);
  mkdirSync(dir, { recursive: true });
  if (p.note && !existsSync(join(dir, "PILOT.txt"))) writeFileSync(join(dir, "PILOT.txt"), p.note + "\n\n" + JSON.stringify(p, null, 1) + "\n");
  let failures = 0;
  for (;;) {
    const s = state(dir);
    if (s.t !== undefined && s.t >= p.until) { say(`${p.name}: done (day ${Math.round(s.t / 86400)})`); break; }
    const models = ["--model", p.model, ...(p.translator ? ["--translator-model", p.translator] : []), "--budget", String(p.budget)];
    const cmd = s.log
      ? ["bun", "orchestrator/src/cli.ts", "resume", s.log, "--until", String(p.until), ...models]
      : ["bun", "orchestrator/src/cli.ts", "run", p.world, "--seeds", "1", "--out", dir, "--until", String(p.until), ...(p.sets ?? []).flatMap((x) => ["--set", x]), ...models];
    say(`${p.name}: ${s.log ? `resuming from day ${Math.round((s.t ?? 0) / 86400)}` : "starting"} (${p.model}${p.translator ? `, translator ${p.translator}` : ""})`);
    const child = Bun.spawn(cmd, { cwd: root, stdin: "ignore", stdout: Bun.file(join(dir, `queue-${Date.now()}.out`)), stderr: "inherit",
      env: { ...process.env, OIKOS_CLAUDE_CODE_LOG: join(dir, "claude-code.calls.jsonl"), OIKOS_DECIDE_LOG: join(dir, "decide.calls.jsonl"), ...(p.env ?? {}) } });
    const code = await child.exited;
    const after = state(dir);
    if (after.t !== undefined && after.t >= p.until) continue; // (said done at the top of the loop)
    if (LIMIT.test(after.detail ?? "")) {
      say(`${p.name}: stopped at a usage limit on day ${Math.round((after.t ?? 0) / 86400)} (${String(after.detail).slice(0, 120)}); asking again in ${waitMs / 60_000} minutes`);
      await Bun.sleep(waitMs);
      continue;
    }
    // A spending limit is the pilot's own: it is over, as far as it got.
    if (/spending limit/i.test(after.detail ?? "")) { say(`${p.name}: stopped at its spending limit on day ${Math.round((after.t ?? 0) / 86400)}: left there`); break; }
    if (++failures >= 2) { say(`${p.name}: left after two failures (exit ${code}; ${String(after.detail ?? after.ended ?? "no end written").slice(0, 200)})`); break; }
    say(`${p.name}: stopped (exit ${code}; ${String(after.detail ?? after.ended ?? "no end written").slice(0, 200)}); once more in a minute`);
    await Bun.sleep(60_000);
  }
}
say("queue finished");
