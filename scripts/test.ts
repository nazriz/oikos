// The whole test suite, with the test files run side by side (each town a test simulates uses one core): `bun run
// test:all`, or `bun scripts/test.ts [--jobs N] [--fast] [--time-new] [--no-build] [filter...]`. First the
// preconditions (installs, the kernel binary and the law reader's wasm module, built and not older than their sources),
// then the kernel's tests (cargo, already parallel), then every *.test.ts in its own `bun test`, the slowest first.
// How many run at once follows the machine (slots, and cores less the current load average); `--jobs N` fixes the most. A file
// that fails prints what it said. A file whose only failures are tests that timed out is run once more, alone, at the
// end ("passed on rerun (timed out under load)" if it then passes); a file that fails any other way is never rerun.
// `--fast` leaves out the files that simulate towns (FAST_SECONDS says what stays in); a file never timed counts as
// slow, the run says so, and `--time-new` runs just those and records their times in test-times.json.
// `--changed [--base REF]` (bun run test:changed) is for work on a branch: the fast tier, and every other test file that
// is changed, or imports (however far down) a file changed since the branch left REF (origin/main), or names a changed
// data file; it says what it chose and why. The whole suite is for the merge.
// Heavy work goes through the machine's slots (scripts/slots.ts): one token for each test file running, half the cores
// for the kernel's tests, so several suites on one machine share the cores. Under that, how many files run at once
// still follows the load average (work that takes no slot counts too).
// `--affected [--base REF]` is for the merge: everything the change could affect, and no more. A change to the kernel,
// the contracts, the manifests or the runner itself (see FULL_ON) chooses the whole suite; a change of documents only
// chooses the tests that read documents, plus the backstops; any other change chooses the fast tier, the tests that
// are changed, import a changed file or name a changed data file or its folder, and the backstops (BACKSTOPS: the
// invariant tests, always). The whole suite stays for a schedule (`bun run test:all`). `--list` prints the choice and
// stops. The kernel's own tests (cargo) run alongside the test files, not before them.
// `--root DIR` runs the *.test.ts under DIR instead of the repo (used by scripts/test-runner.test.ts; no preconditions).

import { Glob } from "bun";
import { cpus, loadavg } from "node:os";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { insideSlot, take } from "./slots";

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
const affected = bool("affected");
const list = bool("list");
const changed = bool("changed") || affected;
const base = flag("base") ?? "origin/main";
const filters = args;
/** A change to any of these could reach any test: the whole suite. */
const FULL_ON = [/^kernel\//, /^contracts\/(?!.*\.md$)/, /^(package\.json|bun\.lock|bunfig\.toml|tsconfig.*\.json)$/, /^scripts\/(test|slots|slots-preload)\.ts$/, /^\.github\//];
/** Always run under --affected: the invariants and backstops. */
const BACKSTOPS = ["orchestrator/test/generality.test.ts", "orchestrator/test/no-god-view.test.ts", "contracts/test/contracts.test.ts"];
const isDoc = (f: string) => /\.md$/.test(f) || (f.startsWith("docs/") && /\.(txt|png|svg|jpg)$/.test(f));

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
  // Current: both are there, and something was built since the newest source changed. (Cargo leaves alone an artefact
  // the changed file is no part of, so each is not asked to be newer by itself; the stamp records a build made here
  // that cargo found nothing to do in.)
  const stamp = join(repo, "kernel/target/.oikos-built");
  const built = () => Math.max(...[kernel, wasm, stamp].map((p) => statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0));
  const stale = () => [kernel, wasm].some((p) => !existsSync(p)) || built() < src.t;
  if (!stale()) return;
  if (noBuild) stop(`the kernel binary or the law wasm module is missing or older than ${src.f.replace(repo + "/", "")}: run \`bun run kernel\``);
  console.log("building the kernel and the law module (bun run kernel)...");
  if (!run(["bun", "run", "kernel"], repo) || [kernel, wasm].some((p) => !existsSync(p))) stop("`bun run kernel` did not produce a kernel binary and law wasm module: run it and read its errors");
  if (!process.env.OIKOS_KERNEL && !process.env.OIKOS_LAW_MODULE) writeFileSync(stamp, "");
}
if (!custom) preconditions();

const all = [...new Glob("**/*.test.ts").scanSync({ cwd: root })]
  .filter((f) => !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));
const untimed = all.filter((f) => times[f] === undefined);

// ---- `--changed`: what the branch touched, and the tests that reach it.
const realRoot = realpathSync(root);
/** The repo's files this one imports (relative ones and the workspace's packages), resolved as bun resolves them. */
function importsOf(file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (!spec.startsWith(".") && !spec.startsWith("@oikos/")) continue;
    try {
      const to = realpathSync(Bun.resolveSync(spec, dirname(join(root, file))));
      if (to.startsWith(realRoot + "/") && !to.includes("/node_modules/")) out.push(to.slice(realRoot.length + 1));
    } catch { /* not a file here (a type-only path, a generated file) */ }
  }
  return out;
}
let nameIndex: Map<string, string[]> | undefined;
/** Every script of the repo by file name (for --affected). */
function byName(): Map<string, string[]> {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const f of new Glob("**/*.{ts,sh}").scanSync({ cwd: root })) {
      if (f.includes("node_modules") || f.startsWith("runs/") || f.startsWith("kernel/target") || f.startsWith(".claude/")) continue;
      const b = f.split("/").pop()!;
      nameIndex.set(b, [...(nameIndex.get(b) ?? []), f]);
    }
  }
  return nameIndex;
}
/** For each test file, why it is chosen (undefined: it is not): itself changed, a changed import, a changed data file named. */
function reasons(tests: string[], deep = false): { why: Map<string, string>; changedFiles: string[]; kernel: boolean; unreached: string[] } {
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) stop(`git ${a.join(" ")} failed: ${p.stderr.toString().trim()} (--changed compares with ${base}: fetch it, or name another with --base)`); return p.stdout.toString().trim(); };
  const from = git("merge-base", base, "HEAD");
  const changedFiles = [...new Set([...git("diff", "--name-only", from).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))].sort();
  const set = new Set(changedFiles);
  // (Data a test reads by name, not by import: a world, a profile, a schema. Named by its file name in the test or what it imports.)
  const data = changedFiles.filter((f) => (deep && isDoc(f)) || /\.(ya?ml|json|cel|sql|txt|py)$/.test(f) && !/(^|\/)(package|tsconfig|test-times)\.json$/.test(f) && !f.startsWith("kernel/"));
  const seen = new Map<string, { imports: string[]; text: string }>();
  const load = (f: string) => { let e = seen.get(f); if (!e) { let text = ""; try { text = readFileSync(join(root, f), "utf8"); } catch {} e = { imports: /\.(ts|tsx|js|mjs)$/.test(f) ? importsOf(f, text) : [], text }; seen.set(f, e); } return e; };
  const why = new Map<string, string>();
  const reached = new Set<string>();
  for (const t of tests) {
    if (set.has(t)) { why.set(t, "changed itself"); reached.add(t); }
    // Breadth first: the nearest changed file is the reason given.
    const depth = new Map<string, number>([[t, 0]]);
    const queue = [t];
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      const d = depth.get(f)!;
      if (f !== t && set.has(f)) { reached.add(f); if (!why.has(t)) why.set(t, `imports ${f}${d > 1 ? ` (${d} imports down)` : ""}`); }
      // (--affected also takes a test that names the changed file's folder, or any document for a changed document: a
      // test that scans a folder or reads "docs/" never names the file.)
      const named = data.find((c) => { const txt = load(f!).text; return txt.includes(c.split("/").pop()!) || (deep && (txt.includes(dirname(c) + "/") || (isDoc(c) && txt.includes("docs/")))); });
      if (named) { reached.add(named); if (!why.has(t)) why.set(t, `names ${named}${f === t ? "" : ` (in ${f})`}`); }
      // (--affected: a test that starts a script by its name -- the command line, a pilot's queue -- reaches what the script imports.)
      const spawned = deep ? [...new Set(load(f).text.match(/[\w-]+\.(?:ts|sh)\b/g) ?? [])].flatMap((b) => byName().get(b) ?? []) : [];
      for (const i of [...load(f).imports, ...spawned]) if (!depth.has(i)) { depth.set(i, d + 1); queue.push(i); }
    }
  }
  return { why, changedFiles, kernel: changedFiles.some((f) => f.startsWith("kernel/")), unreached: changedFiles.filter((f) => !reached.has(f) && !f.startsWith("kernel/") && !/\.md$/.test(f)) };
}
const pick = changed ? reasons(all, affected) : undefined;
const fullWhy = affected && pick ? pick.changedFiles.find((f) => FULL_ON.some((r) => r.test(f))) : undefined;
const docsOnly = affected && !!pick && !fullWhy && pick.changedFiles.length > 0 && pick.changedFiles.every(isDoc);
const sel = fullWhy || !pick ? undefined : pick;
if (affected) console.log(fullWhy ? `--affected: ${fullWhy} changed, which could reach any test: the whole suite.` : docsOnly ? "--affected: documents only: the tests that read documents, and the backstops." : "");
if (sel) {
  const isFast = (f: string) => (times[f] ?? Infinity) < FAST_SECONDS;
  const extra = all.filter((f) => pick.why.has(f) && !isFast(f));
  const slow = all.filter((f) => !isFast(f));
  console.log(`--changed: ${pick.changedFiles.length} file${pick.changedFiles.length === 1 ? "" : "s"} changed since ${base}; the fast tier (${all.length - slow.length} files) and ${extra.length} more:`);
  for (const f of extra) console.log(`  + ${f} (about ${Math.round(times[f] ?? 0)}s): ${pick.why.get(f)}`);
  if (pick.kernel) console.log("  + the kernel's own tests (cargo): kernel sources changed. The tests that simulate towns all run the kernel and are NOT chosen for that: they are the merge's full suite.");
  if (pick.unreached.length) console.log(`  no test imports or names: ${pick.unreached.slice(0, 12).join(", ")}${pick.unreached.length > 12 ? `, and ${pick.unreached.length - 12} more` : ""}`);
  if (slow.length && extra.length > slow.length / 2) console.log(`  (${extra.length} of the ${slow.length} slow files: this change reaches most of the suite. To run less, name the tests that cover it: bun scripts/test.ts <filter>...)`);
}
const files = all
  .filter((f) => !sel || (affected && BACKSTOPS.includes(f)) || (!docsOnly && (times[f] ?? Infinity) < FAST_SECONDS) || sel.why.has(f))
  .filter((f) => !fast || (times[f] ?? Infinity) < FAST_SECONDS)
  .filter((f) => !timeNew || times[f] === undefined)
  .sort((a, b) => (times[b] ?? 1e9) - (times[a] ?? 1e9) || (a < b ? -1 : 1));
if (list) { console.log(files.join("\n")); process.exit(0); }
if (untimed.length && !custom && !timeNew && !changed) {
  console.log(`NOTE ${untimed.length} test file${untimed.length > 1 ? "s" : ""} never timed, counted as slow${fast ? " and left out of the fast tier" : ""}: ${untimed.join(", ")}`);
  console.log(`     run \`bun scripts/test.ts --time-new\` to time ${untimed.length > 1 ? "them" : "it"} and record that in scripts/test-times.json`);
}

// Stopped from outside (SIGTERM/SIGINT/SIGHUP): stop the files it started, and say so as the last line, so a killed run
// is never mistaken for a hang or a failure.
const children = new Set<{ kill: () => void }>();
let done = 0;
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => {
  for (const c of children) try { c.kill(); } catch {}
  console.log(`\nstopped by signal ${sig} after ${done} of ${files.length} files (not a failure of the tests, and no result)`);
  process.exit(143);
});

const t0 = performance.now();
let failed = 0;
// (Started now and awaited after the files: it used to run first and alone, and a suite waited for it, at four times
// the slots it needs, before its first file started. Four tokens compile as fast as seven within a few seconds.)
const kernelTests = !filters.length && !custom && !timeNew && (!sel || sel.kernel) ? kernelCargoTests() : Promise.resolve();
async function kernelCargoTests() {
  const slot = await take(4, "the kernel's tests (cargo test)");
  const k = Bun.spawn(["cargo", "test", "--release", "--manifest-path", "kernel/Cargo.toml", "--workspace", "-q"], { cwd: repo, stdout: "pipe", stderr: "pipe", env: { ...insideSlot(4), ...(slot?.weight ? { CARGO_BUILD_JOBS: String(slot.weight) } : {}) } });
  children.add(k);
  const out = (await Promise.all([new Response(k.stdout).text(), new Response(k.stderr).text()])).join("");
  const ok = (await k.exited) === 0;
  children.delete(k);
  slot?.release();
  console.log(`${ok ? "ok  " : "FAIL"} kernel (cargo test) ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) { failed++; console.log(out.split("\n").filter((l) => /FAILED|panicked|error/.test(l)).slice(0, 40).join("\n")); }
}

let pass = 0, fail = 0, rerun = 0, next = 0, running = 0;
const bad: string[] = [];
const lateTimeouts: string[] = [];

type Result ={ code: number; text: string; secs: number; npass: number; nfail: number; onlyTimeouts: boolean };
async function runFile(f: string): Promise<Result> {
  const s = performance.now();
  const p = Bun.spawn(["bun", "test", f], { cwd: root, stdout: "pipe", stderr: "pipe", env: insideSlot(1, { ...process.env, NODE_ENV: "test" }) });
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
    if (next >= files.length) return;
    // A token of the machine's for each file running (waited for, with the files of every other suite and build).
    const slot = await take(1, `test suite (${files.length} files) in ${root}`, { cancel: () => next >= files.length });
    const f = files[next++];
    if (!slot || !f) { slot?.release(); return; }
    running++;
    const r = await runFile(f).finally(() => slot.release());
    running--;
    times[f] = Math.round(r.secs * 10) / 10;
    if (r.onlyTimeouts) { lateTimeouts.push(f); console.log(`LATE ${f} ${r.secs.toFixed(0)}s (timed out; to be rerun alone)`); continue; }
    pass += r.npass; fail += r.nfail;
    console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${f} ${r.secs.toFixed(0)}s`);
    if (r.code !== 0) { failed++; bad.push(tail(f, r.text)); }
  }
}
await Promise.all([kernelTests, ...Array.from({ length: Math.max(1, Math.min(maxJobs, files.length)) }, worker)]);

// Files that only timed out run again, one at a time, with the machine to themselves as far as this run goes.
for (const f of lateTimeouts) {
  const slot = await take(1, `test suite (a rerun) in ${root}`);
  const r = await runFile(f).finally(() => slot?.release());
  pass += r.npass; fail += r.nfail;
  if (r.code === 0) { rerun++; times[f] = Math.round(r.secs * 10) / 10; console.log(`PASSED ON RERUN (timed out under load) ${f} ${r.secs.toFixed(0)}s`); }
  else { failed++; console.log(`FAIL ${f} ${r.secs.toFixed(0)}s (failed again on rerun)`); bad.push(tail(f, r.text)); }
}

if (!custom && ((!filters.length && !fast && !changed) || timeNew)) writeFileSync(timesPath, JSON.stringify(Object.fromEntries(Object.entries(times).sort()), null, 1) + "\n");
for (const b of bad) console.log(b);
console.log(`\n${pass} pass, ${fail} fail across ${files.length} files, ${maxJobs} at a time, in ${((performance.now() - t0) / 1000).toFixed(0)}s${fast ? " (fast tier)" : changed ? " (fast tier and what changed)" : ""}, ${rerun} passed on rerun`);
process.exit(failed ? 1 : 0);
