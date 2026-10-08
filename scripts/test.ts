// The whole test suite, with the test files run side by side (each town a test simulates uses one core): `bun run
// test:all`, or `bun scripts/test.ts [--jobs N] [--fast] [--time-new] [--no-build] [filter...]`. First the
// preconditions (installs, the kernel binary and the law reader's wasm module, built and not older than their sources),
// then the kernel's tests (cargo, already parallel), then every *.test.ts in its own `bun test`, the slowest first.
// How many run at once follows the machine (cores less the current load average) unless `--jobs N` fixes it. A file
// that fails prints what it said. A file whose only failures are tests that timed out is run once more, alone, at the
// end ("passed on rerun (timed out under load)" if it then passes); a file that fails any other way is never rerun.
// `--fast` leaves out the files that simulate towns (FAST_SECONDS says what stays in); a file never timed counts as
// slow, the run says so, and `--time-new` runs just those and records their times in test-times.json.
// `--root DIR` runs the *.test.ts under DIR instead of the repo (used by scripts/test-runner.test.ts; no preconditions).

import { Glob } from "bun";
import { cpus, loadavg } from "node:os";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const bool = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const root = flag("root") ?? repo;
const custom = root !== repo;
const jobsFlag = flag("jobs");
const fast = bool("fast");
const timeNew = bool("time-new");
const noBuild = bool("no-build");
const filters = args;

const cores = cpus().length;
const maxJobs = jobsFlag ? Number(jobsFlag) : Math.max(2, cores - 2);
/** How many files to run at once now: the cores the rest of the machine leaves free, counting our own `running`. */
function allowed(running: number): number {
  if (jobsFlag) return maxJobs;
  const free = Math.round(cores - loadavg()[0]! + running); // the load average already includes our running files
  return Math.max(1, Math.min(maxJobs, free));
}

// How long each file took last time (kept beside this script): the slowest go first, so the run ends when they do.
const timesPath = join(repo, "scripts", "test-times.json");
const times: Record<string, number> = !custom && existsSync(timesPath) ? JSON.parse(readFileSync(timesPath, "utf8")) : {};
/** A file is fast if it took under this long last time (never timed: slow, until it has been). */
const FAST_SECONDS = 10;

// ---- Preconditions: do what is cheap and safe, or stop at once with one line saying what to run.
function stop(what: string): never { console.log(`PRECONDITION: ${what}`); process.exit(2); }
function newest(dir: string, found = { t: 0, f: "" }): { t: number; f: string } {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "target" || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) newest(p, found);
    else if (/\.rs$|Cargo\.(toml|lock)$/.test(e.name)) { const t = statSync(p).mtimeMs; if (t > found.t) { found.t = t; found.f = p; } }
  }
  return found;
}
function run(cmd: string[], cwd: string) { return Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode === 0; }
function preconditions() {
  if (!existsSync(join(repo, "node_modules")) && !run(["bun", "install"], repo)) stop("`bun install` failed in the repo root");
  const cel = join(repo, "docs/research/cel-check");
  if (existsSync(cel) && !existsSync(join(cel, "node_modules/@bufbuild/cel")) && !run(["bun", "install"], cel)) stop("`bun install --cwd docs/research/cel-check` failed");
  const kernel = process.env.OIKOS_KERNEL ?? join(repo, "kernel/target/release/oikos-kernel");
  const wasm = process.env.OIKOS_LAW_MODULE ?? join(repo, "kernel/target/wasm32-unknown-unknown/release/oikos_law.wasm");
  const src = newest(join(repo, "kernel"));
  const stale = () => [kernel, wasm].filter((p) => !existsSync(p) || statSync(p).mtimeMs < src.t);
  if (!stale().length) return;
  if (noBuild) stop(`the kernel binary or the law wasm module is missing or older than ${src.f.replace(repo + "/", "")}: run \`bun run kernel\``);
  console.log("building the kernel and the law module (bun run kernel)...");
  if (!run(["bun", "run", "kernel"], repo) || stale().length) stop("`bun run kernel` did not produce a current kernel binary and law wasm module: run it and read its errors");
}
if (!custom) preconditions();

const all = [...new Glob("**/*.test.ts").scanSync({ cwd: root })]
  .filter((f) => !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));
const untimed = all.filter((f) => times[f] === undefined);
const files = all
  .filter((f) => !fast || (times[f] ?? Infinity) < FAST_SECONDS)
  .filter((f) => !timeNew || times[f] === undefined)
  .sort((a, b) => (times[b] ?? 1e9) - (times[a] ?? 1e9) || (a < b ? -1 : 1));
if (untimed.length && !custom && !timeNew) {
  console.log(`NOTE ${untimed.length} test file${untimed.length > 1 ? "s" : ""} never timed, counted as slow${fast ? " and left out of the fast tier" : ""}: ${untimed.join(", ")}`);
  console.log(`     run \`bun scripts/test.ts --time-new\` to time ${untimed.length > 1 ? "them" : "it"} and record that in scripts/test-times.json`);
}

const t0 = performance.now();
let failed = 0;
if (!filters.length && !custom && !timeNew) {
  const k = Bun.spawnSync(["cargo", "test", "--release", "--manifest-path", "kernel/Cargo.toml", "--workspace", "-q"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const out = k.stdout.toString() + k.stderr.toString();
  const ok = k.exitCode === 0;
  console.log(`${ok ? "ok  " : "FAIL"} kernel (cargo test) ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) { failed++; console.log(out.split("\n").filter((l) => /FAILED|panicked|error/.test(l)).slice(0, 40).join("\n")); }
}

let pass = 0, fail = 0, rerun = 0, next = 0, running = 0;
const bad: string[] = [];
const lateTimeouts: string[] = [];

// Stopped from outside (SIGTERM/SIGINT/SIGHUP): stop the files it started, and say so as the last line, so a killed run
// is never mistaken for a hang or a failure.
const children = new Set<{ kill: () => void }>();
let done = 0;
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => {
  for (const c of children) try { c.kill(); } catch {}
  console.log(`\nstopped by signal ${sig} after ${done} of ${files.length} files (not a failure of the tests, and no result)`);
  process.exit(143);
});

type Result ={ code: number; text: string; secs: number; npass: number; nfail: number; onlyTimeouts: boolean };
async function runFile(f: string): Promise<Result> {
  const s = performance.now();
  const p = Bun.spawn(["bun", "test", f], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "test" } });
  children.add(p);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  children.delete(p);
  done++;
  const text = out + err;
  const nfail = Number(/^\s*(\d+) fail/m.exec(text)?.[1] ?? (code === 0 ? 0 : 1));
  // Only timeouts: every failed test says it timed out, and nothing else went wrong (no error that is not a timeout).
  const timedOut = (text.match(/timed out after \d+\s*ms/g) ?? []).length;
  const otherErrors = text.split("\n").filter((l) => /^\s*(error|Error|TypeError|ReferenceError|SyntaxError)\b|Unhandled|Cannot find module|panicked/.test(l) && !/timed out after/.test(l));
  const onlyTimeouts = code !== 0 && timedOut > 0 && timedOut >= nfail && !otherErrors.length;
  return { code, text, secs: (performance.now() - s) / 1000, npass: Number(/^\s*(\d+) pass/m.exec(text)?.[1] ?? 0), nfail, onlyTimeouts };
}
const tail = (f: string, text: string) => `\n== ${f}\n${text.split("\n").filter((l) => !/^\s*$/.test(l)).slice(-60).join("\n")}`;

async function worker() {
  for (;;) {
    while (next < files.length && running >= allowed(running)) await Bun.sleep(1000);
    const f = files[next++];
    if (!f) return;
    running++;
    const r = await runFile(f);
    running--;
    times[f] = Math.round(r.secs * 10) / 10;
    if (r.onlyTimeouts) { lateTimeouts.push(f); console.log(`LATE ${f} ${r.secs.toFixed(0)}s (timed out; to be rerun alone)`); continue; }
    pass += r.npass; fail += r.nfail;
    console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${f} ${r.secs.toFixed(0)}s`);
    if (r.code !== 0) { failed++; bad.push(tail(f, r.text)); }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(maxJobs, files.length)) }, worker));

// Files that only timed out run again, one at a time, with the machine to themselves as far as this run goes.
for (const f of lateTimeouts) {
  const r = await runFile(f);
  pass += r.npass; fail += r.nfail;
  if (r.code === 0) { rerun++; times[f] = Math.round(r.secs * 10) / 10; console.log(`PASSED ON RERUN (timed out under load) ${f} ${r.secs.toFixed(0)}s`); }
  else { failed++; console.log(`FAIL ${f} ${r.secs.toFixed(0)}s (failed again on rerun)`); bad.push(tail(f, r.text)); }
}

if (!custom && ((!filters.length && !fast) || timeNew)) writeFileSync(timesPath, JSON.stringify(Object.fromEntries(Object.entries(times).sort()), null, 1) + "\n");
for (const b of bad) console.log(b);
console.log(`\n${pass} pass, ${fail} fail across ${files.length} files, ${maxJobs} at a time, in ${((performance.now() - t0) / 1000).toFixed(0)}s${fast ? " (fast tier)" : ""}, ${rerun} passed on rerun`);
process.exit(failed ? 1 : 0);
