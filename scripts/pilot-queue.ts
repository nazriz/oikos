#!/usr/bin/env bun
// Pilots one after another, unattended: `bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES]`.
// The queue is a list of {name, world, sets, model, translator?, until, budget, env?, note?, test?}: each runs into <runs>/<name>
// (OIKOS_RUNS, or ~/oikos/runs), is taken up again where it stopped if its log is already there, and is waited for and
// resumed when it stops at a usage limit (the limit's window may be hours: it is asked again every --wait minutes, 20 if
// not given). One that fails twice for another reason is left, with why, and the next is started. A queue is one lane:
// start one for each way in (one for Claude Code, one for Codex) and they run side by side. Nothing here decides
// anything about a pilot: which models, towns and seats is the queue file's. "test": true marks a pilot whose requests are
// kept out of training (a held-out test): it is written into the pilot's PILOT.txt, and its pilot-report.json says so.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { localStamp, runState } from "../orchestrator/src/pilot-state";

interface Pilot { name: string; world: string; sets?: string[]; model: string; translator?: string; until: number; budget: number; env?: { [k: string]: string }; note?: string; test?: boolean }

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES]");
const waitMs = 60_000 * Number(args[args.indexOf("--wait") + 1] && args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 20);
const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
const root = resolve(import.meta.dir, "..");
const queue: Pilot[] = JSON.parse(readFileSync(file, "utf8"));
const status = file.replace(/\.json$/, "") + ".status.log";
// (Local time with its offset from UTC: a line read next to the machine's clock needs no sum.)
const say = (line: string) => { const l = `${localStamp()} ${line}`; console.log(l); appendFileSync(status, l + "\n"); };
/** The report of a pilot's folder, written beside its log (best effort: a report that fails never stops the queue). */
const report = (dir: string) => Bun.spawnSync(["bun", "orchestrator/src/cli.ts", "pilot-report", dir], { cwd: root, stdout: "ignore", stderr: "ignore" });

for (const p of queue) {
  const dir = join(runs, p.name);
  mkdirSync(dir, { recursive: true });
  // PILOT.txt: the queue's entry, as it was when the pilot was first started ("test": true is read from it by the pilot
  // report, so that later steps keep a held-out test's requests out of training).
  if (!existsSync(join(dir, "PILOT.txt"))) writeFileSync(join(dir, "PILOT.txt"), `${p.test ? "TEST PILOT: its requests are kept out of training (a held-out test).\n\n" : ""}${p.note ? p.note + "\n\n" : ""}${JSON.stringify(p, null, 1)}\n`);
  let failures = 0;
  const day = (t?: number) => Math.round((t ?? 0) / 86400);
  for (;;) {
    const s = await runState(dir, p.until);
    if (s.stop === "done") { say(`${p.name}: done (day ${day(s.t)})`); report(dir); break; }
    const models = ["--model", p.model, ...(p.translator ? ["--translator-model", p.translator] : []), "--budget", String(p.budget)];
    const cmd = s.log
      ? ["bun", "orchestrator/src/cli.ts", "resume", s.log, "--until", String(p.until), ...models]
      : ["bun", "orchestrator/src/cli.ts", "run", p.world, "--seeds", "1", "--out", dir, "--until", String(p.until), ...(p.sets ?? []).flatMap((x) => ["--set", x]), ...models];
    say(`${p.name}: ${s.log ? `resuming from day ${day(s.t)}` : "starting"} (${p.model}${p.translator ? `, translator ${p.translator}` : ""})`);
    const child = Bun.spawn(cmd, { cwd: root, stdin: "ignore", stdout: Bun.file(join(dir, `queue-${Date.now()}.out`)), stderr: "inherit",
      env: { ...process.env, OIKOS_CLAUDE_CODE_LOG: join(dir, "claude-code.calls.jsonl"), OIKOS_DECIDE_LOG: join(dir, "decide.calls.jsonl"), ...(p.env ?? {}) } });
    const code = await child.exited;
    const after = await runState(dir, p.until);
    const why = String(after.detail ?? after.ended ?? "no end written").slice(0, 200);
    if (after.stop === "done") continue; // (said done at the top of the loop)
    if (after.stop === "usage_limit") {
      say(`${p.name}: stopped at a usage limit on day ${day(after.t)} (${why.slice(0, 120)}); asking again in ${waitMs / 60_000} minutes`);
      await Bun.sleep(waitMs);
      continue;
    }
    // A spending limit is the pilot's own: it is over, as far as it got.
    if (after.stop === "spending_limit") { say(`${p.name}: stopped at its spending limit on day ${day(after.t)}: left there`); report(dir); break; }
    // Someone asked the run to stop (a signal, as `scripts/mini stop` sends): not a failure, and not for the queue to undo.
    // The queue stops with it; running it again takes the pilot up where it stopped.
    if (after.stop === "signal") { say(`${p.name}: asked to stop on day ${day(after.t)}; the queue stops here (run it again to resume)`); report(dir); process.exit(0); }
    if (++failures >= 2) { say(`${p.name}: left after two failures (exit ${code}; ${why})`); report(dir); break; }
    say(`${p.name}: stopped (exit ${code}; ${why}); once more in a minute`);
    await Bun.sleep(60_000);
  }
}
say("queue finished");
