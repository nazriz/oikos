#!/usr/bin/env bun
// Pilots one after another, unattended: `bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES] [--no-park]`.
// The queue is a list of {name, world, sets, model, translator?, until, budget, env?, note?, test?}: each runs into <runs>/<name>
// (OIKOS_RUNS, or ~/oikos/runs) and is taken up again where it stopped if its log is already there. One that stops at a
// usage limit is PARKED: stopped cleanly where it was, and the queue goes on to the next entry that needs none of the
// sign-ins at a limit (a limit is a sign-in's: `claude-code`, `codex`; an entry needs its seats' model's and its
// translator's). A parked pilot is taken up again, before anything later in the queue, once --wait minutes have passed
// (20 if not given; the limit's window may be hours, so it may be parked again); when nothing else can run the queue
// waits for the first such time. What is parked is in the status log, the alerts, and <queue>.parked.json (which
// `scripts/pilot-wave.ts status` reads). --no-park: wait on the pilot itself instead, as the queue did before
// 2026-10-09. One that fails twice for another reason is left, with why, and the next is started. A queue is one lane:
// start one for each way in (one for Claude Code, one for pilots with Codex seats) and they run side by side. Nothing
// here decides anything about a pilot: which models, towns and seats is the queue file's. "test": true marks a pilot
// whose requests are kept out of training (a held-out test): it is written into the pilot's PILOT.txt, and its
// pilot-report.json says so.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { alert } from "../orchestrator/src/pilot-alerts";
import { limitedProviders, localStamp, nextPilot, parkedPath, providersOf, runState, scanOptOuts, type Parked } from "../orchestrator/src/pilot-state";

interface Pilot { name: string; world: string; sets?: string[]; model: string; translator?: string; until: number; budget: number; env?: { [k: string]: string }; note?: string; test?: boolean; args?: string[] }

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--wait");
if (!file) throw new Error("usage: bun scripts/pilot-queue.ts <queue.json> [--wait MINUTES] [--no-park]");
const waitMs = 60_000 * Number(args[args.indexOf("--wait") + 1] && args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 20);
const park = !args.includes("--no-park");
const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
const root = resolve(import.meta.dir, "..");
const queue: Pilot[] = JSON.parse(readFileSync(file, "utf8"));
const status = file.replace(/\.json$/, "") + ".status.log";
// (Local time with its offset from UTC: a line read next to the machine's clock needs no sum.)
// Alerts (orchestrator/src/pilot-alerts.ts) go to <runs>/pilot-queues/<wave>.alerts.log: the wave is OIKOS_WAVE (set by
// scripts/pilot-wave.ts), or this queue file's name.
const wave = process.env.OIKOS_WAVE ?? (file.split("/").at(-1) ?? "queue").replace(/\.json$/, "");
const tell = (line: string) => alert(runs, wave, `[${(file.split("/").at(-1) ?? "").replace(/\.json$/, "")}] ${line}`);
/** How many things seats sent that were not sent, in one pilot, before whoever runs the wave is told. */
const NOT_SENT_ALERT = 3;
const POLL_MS = 1000 * Number(process.env.OIKOS_POLL_SECONDS ?? 60);
const say = (line: string) => { const l = `${localStamp()} ${line}`; console.log(l); appendFileSync(status, l + "\n"); };
// (Any CLI in place of the repo's own: for the queue's tests, which give it one that stops where they say.)
const CLI = process.env.OIKOS_QUEUE_CLI ?? "orchestrator/src/cli.ts";
/** The report of a pilot's folder, written beside its log (best effort: a report that fails never stops the queue). */
const report = (dir: string) => Bun.spawnSync(["bun", CLI, "pilot-report", dir], { cwd: root, stdout: "ignore", stderr: "ignore" });

/** What the queue keeps of a pilot between the times it is taken up. */
interface Kept { failures: number; offsets: Map<string, number>; optedOut: Set<string>; notSent: number }
const kept = new Map<string, Kept>();
/** Entries the queue has finished with: done, at their spending limit, or left after two failures. */
const settled = new Set<string>();
/** Sign-ins at a usage limit, each to the time it is tried again; and the pilots parked for them. */
const limitedUntil = new Map<string, number>();
const parked = new Map<string, Parked>();
const writeParked = () => writeFileSync(parkedPath(file), JSON.stringify([...parked.values()], null, 1) + "\n");
const day = (t?: number) => Math.round((t ?? 0) / 86400);
const minutes = `${waitMs / 60_000} minutes`;
writeParked();
let waitingSaid = "";

for (;;) {
  const next = nextPilot(queue, settled, limitedUntil, Date.now());
  if (!next.pick) {
    if (next.waitUntil === undefined) break;
    // Nothing can run: every entry left needs a sign-in at a limit. Wait for the first to be tried again.
    const names = [...parked.keys()].join(", ");
    if (waitingSaid !== names) { say(`nothing else can run: waiting for ${names} (parked at a usage limit; the next try at ${localStamp(new Date(next.waitUntil))})`); waitingSaid = names; }
    await Bun.sleep(Math.max(100, next.waitUntil - Date.now()));
    continue;
  }
  waitingSaid = "";
  const p = next.pick;
  const dir = join(runs, p.name);
  mkdirSync(dir, { recursive: true });
  // PILOT.txt: the queue's entry, as it was when the pilot was first started ("test": true is read from it by the pilot
  // report, so that later steps keep a held-out test's requests out of training).
  if (!existsSync(join(dir, "PILOT.txt"))) writeFileSync(join(dir, "PILOT.txt"), `${p.test ? "TEST PILOT: its requests are kept out of training (a held-out test).\n\n" : ""}${p.note ? p.note + "\n\n" : ""}${JSON.stringify(p, null, 1)}\n`);
  if (!kept.has(p.name)) kept.set(p.name, { failures: 0, offsets: new Map(), optedOut: new Set(), notSent: 0 });
  const k = kept.get(p.name)!;
  const s = await runState(dir, p.until);
  if (s.stop === "done") { say(`${p.name}: done (day ${day(s.t)})`); tell(`done: ${p.name} (day ${day(s.t)})`); report(dir); settled.add(p.name); continue; }
  if (parked.delete(p.name)) { writeParked(); tell(`usage-limit wait over for ${p.name}: trying again`); }
  const models = ["--model", p.model, ...(p.translator ? ["--translator-model", p.translator] : []), "--budget", String(p.budget)];
  const cmd = s.log
    ? ["bun", CLI, "resume", s.log, "--until", String(p.until), ...models]
    : ["bun", CLI, "run", p.world, "--seeds", "1", "--out", dir, "--until", String(p.until), ...(p.sets ?? []).flatMap((x) => ["--set", x]), ...(p.args ?? []), ...models];
  say(`${p.name}: ${s.log ? `resuming from day ${day(s.t)}` : "starting"} (${p.model}${p.translator ? `, translator ${p.translator}` : ""})`);
  const child = Bun.spawn(cmd, { cwd: root, stdin: "ignore", stdout: Bun.file(join(dir, `queue-${Date.now()}.out`)), stderr: "inherit",
    env: { ...process.env, OIKOS_CLAUDE_CODE_LOG: join(dir, "claude-code.calls.jsonl"), OIKOS_DECIDE_LOG: join(dir, "decide.calls.jsonl"), ...(p.env ?? {}) } });
  // While it runs, its log is looked at for a seat opting out (the `opt_out` command), so that it is heard of then.
  let exited = false;
  void child.exited.then(() => { exited = true; });
  const look = async () => {
    const state = await runState(dir, p.until);
    if (!state.log) return;
    const r = await scanOptOuts(state.log, k.offsets.get(state.log) ?? 0).catch(() => undefined);
    if (!r) return;
    k.offsets.set(state.log, r.offset);
    // (A prompt too long for a seat's model: each one. Things a seat sent that were not sent: past the third.)
    for (const x of r.faults) {
      if (x.kind === "prompt_too_long") tell(`PROMPT TOO LONG ${p.name}: ${x.participant} on day ${x.day}: its model would not take the prompt (${x.detail}); that sitting was not held`);
      else if (++k.notSent === NOT_SENT_ALERT) tell(`NOT SENT ${p.name}: ${k.notSent} things seats sent were not sent so far (each seat was told why); the latest, ${x.participant} on day ${x.day}: ${x.detail}`);
    }
    for (const o of r.optOuts) if (!k.optedOut.has(`${p.name}/${o.participant}`)) { k.optedOut.add(`${p.name}/${o.participant}`); tell(`OPT-OUT ${p.name}: ${o.participant} opted out on day ${o.day} ${JSON.stringify(o.statement.slice(0, 160))}`); }
  };
  while (!exited) { await Promise.race([child.exited, Bun.sleep(POLL_MS)]); await look(); }
  const code = await child.exited;
  const after = await runState(dir, p.until);
  const why = String(after.detail ?? after.ended ?? "no end written").slice(0, 200);
  if (after.stop === "done") continue; // (said done when it is looked at again, which is at once)
  if (after.stop === "usage_limit") {
    if (!park) {
      say(`${p.name}: stopped at a usage limit on day ${day(after.t)} (${why.slice(0, 120)}); asking again in ${minutes}`);
      tell(`USAGE LIMIT ${p.name}: waiting ${minutes} from day ${day(after.t)}`);
      await Bun.sleep(waitMs);
      tell(`usage-limit wait over for ${p.name}: trying again`);
      continue;
    }
    // Parked: the sign-in that said so is left alone until the wait is over, and the queue goes on to what needs none of it.
    const who = limitedProviders(String(after.detail ?? ""), providersOf(p));
    const again = Date.now() + waitMs;
    for (const x of who) limitedUntil.set(x, again);
    parked.set(p.name, { name: p.name, day: day(after.t), providers: who, since: localStamp(), next_try: localStamp(new Date(again)) });
    writeParked();
    say(`${p.name}: parked at a usage limit on day ${day(after.t)} (${who.join(", ")}: ${why.slice(0, 120)}); the queue goes on, and it is tried again in ${minutes}`);
    tell(`PARKED ${p.name}: at a usage limit (${who.join(", ")}) on day ${day(after.t)}; the queue goes on to what does not need ${who.join(" or ")}, and tries it again in ${minutes}`);
    continue;
  }
  // A spending limit is the pilot's own: it is over, as far as it got.
  if (after.stop === "spending_limit") { say(`${p.name}: stopped at its spending limit on day ${day(after.t)}: left there`); tell(`SPENDING LIMIT ${p.name}: stopped on day ${day(after.t)}, left there`); report(dir); settled.add(p.name); continue; }
  // Someone asked the run to stop (a signal, as `scripts/mini stop` sends): not a failure, and not for the queue to undo.
  // The queue stops with it; running it again takes the pilot up where it stopped.
  if (after.stop === "signal") { say(`${p.name}: asked to stop on day ${day(after.t)}; the queue stops here (run it again to resume)`); tell(`STOPPED ${p.name}: asked to stop on day ${day(after.t)}; the queue has stopped (run it again to resume)`); report(dir); process.exit(0); }
  if (++k.failures >= 2) { say(`${p.name}: left after two failures (exit ${code}; ${why})`); tell(`FAILED ${p.name}: left after two failures on day ${day(after.t)} (${why.slice(0, 120)})`); report(dir); settled.add(p.name); continue; }
  say(`${p.name}: stopped (exit ${code}; ${why}); once more in a minute`);
  tell(`CRASHED ${p.name}: stopped on day ${day(after.t)} (exit ${code}; ${why.slice(0, 120)}); trying once more`);
  await Bun.sleep(60_000);
}
say("queue finished");
tell("queue finished");
