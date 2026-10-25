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
// `--gate [--base REF]` (bun run test:changed; `--affected` is its old name) is the merge gate, and every agent's: the
// gate tier only (scripts/test-tiers.json names the slow tier; CI runs both tiers on every push and nightly). A change
// to the kernel, the contracts, the manifests or the runner itself (see FULL_ON) chooses the whole gate tier, and the
// kernel's own tests of the crates the change reaches (cargo-nextest, the `gate` profile); a change of documents only
// chooses the tests that read documents, plus the backstops; any other change chooses the fast tier, the tests that
// are changed, import a changed file or name a changed data file or its folder, and the backstops (BACKSTOPS: the
// invariant tests, always); and of the slow tier, the files the change reaches by the same reading (changed, importing a
// changed file, naming a changed data file or its folder), and for a change to the kernel or the contracts the year of
// canaries that pin whole towns (test-tiers.json, `canary`, those marked `kernel`). A change reaching more than SLOW_MOST of
// them runs the canaries instead, the rest left to CI. They run in the gate and say their times; the budget does not count them.
// Where the release kernel is not current, the gate builds the `gate` profile in seconds and
// points the tests at it. `--tier gate|slow` runs one tier whole. `--list` prints the choice and stops.
// `--root DIR` runs the *.test.ts under DIR instead of the repo (used by scripts/test-runner.test.ts; no preconditions).

import { Glob } from "bun";
import { cpus, homedir, loadavg } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { buildJobs, defaultPriority, insideSlot, poolSize, take } from "./slots";

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
// (`--gate` is the merge's and every agent's: `bun run test:changed`. `--affected` is its old name.)
const affected = [bool("gate"), bool("affected")].some(Boolean);
const tierFlag = flag("tier") ?? "all";
if (!["gate", "slow", "all"].includes(tierFlag)) { console.log(`--tier is gate, slow or all, not ${tierFlag}`); process.exit(2); }
const list = bool("list");
const changed = bool("changed") || affected;
const base = flag("base") ?? "origin/main";
const filters = args;
/** A change to any of these could reach any test: the whole suite. */
const FULL_ON = [/^kernel\//, /^contracts\/(?!.*\.md$)/, /^(package\.json|bun\.lock|bunfig\.toml|tsconfig.*\.json)$/, /^scripts\/(test|slots|slots-preload)\.ts$/, /^\.github\//];
/** Always run under --affected: the invariants and backstops. */
const BACKSTOPS = ["orchestrator/test/generality.test.ts", "orchestrator/test/no-god-view.test.ts", "contracts/test/contracts.test.ts", "orchestrator/test/invariants-gate.test.ts", "orchestrator/test/all-work-takes-time.test.ts", "orchestrator/test/risks.test.ts", "orchestrator/test/unstated-run.test.ts", "scripts/tiers.test.ts"]; // (the year of invariants.test.ts is the slow tier's: CI)
/** The most slow-tier files a change may bring into the gate by its reach; one that reaches more (a profile, the generator,
 * run.ts) brings the canaries instead (scripts/test-tiers.json, `canary`), and CI runs the rest after the push. */
const SLOW_MOST = 8;
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
/** The times as recorded before this run (`times` is updated as files end): the budget reads the machine's load from them. */
const recorded: Record<string, number> = { ...times };
// The tiers (scripts/test-tiers.json, under --root its own): the slow tier is named file by file, with why; every other
// test file is the gate's. The gate never runs the slow tier: CI runs both on every push to main, and nightly
// (scripts/tiers.test.ts holds that every file is in exactly one, and that CI runs them all).
const tiersPath = join(root, "scripts", "test-tiers.json");
const tiers: { slow: Record<string, string>; canary?: Record<string, { why: string; kernel?: boolean }> } = existsSync(tiersPath) ? JSON.parse(readFileSync(tiersPath, "utf8")) : { slow: {} };
/** The slow files that pin whole towns (their hashes, their invariants) and so catch a broad change: run by the gate in
 * place of a broad change's reach, and those marked `kernel` for a change to the kernel or the contracts. */
const canaries = Object.keys(tiers.canary ?? {});
const kernelCanaries = canaries.filter((f) => tiers.canary![f]!.kernel);
const isSlowTier = (f: string) => Object.hasOwn(tiers.slow, f);
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
function preconditions(gate = false) {
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
  if (gate) return gateBuild();
  if (noBuild) stop(`the kernel binary or the law wasm module is missing or older than ${src.f.replace(repo + "/", "")}: run \`bun run kernel\``);
  console.log("building the kernel and the law module (bun run kernel)...");
  if (!run(["bun", "run", "kernel"], repo) || [kernel, wasm].some((p) => !existsSync(p))) stop("`bun run kernel` did not produce a kernel binary and law wasm module: run it and read its errors");
  if (!process.env.OIKOS_KERNEL && !process.env.OIKOS_LAW_MODULE) writeFileSync(stamp, "");
}
/**
 * The gate's kernel, when the release build is not current (a kernel change, or a checkout last built at another
 * commit): the `gate` profile (kernel/Cargo.toml: release's optimisation and overflow checks, no whole-program link),
 * built in seconds where the release build takes minutes, and the law's wasm module as always. The tests are pointed at
 * it (OIKOS_KERNEL, OIKOS_ENGINE_MODULE, OIKOS_LAW_MODULE, inherited by every file). The release build is CI's.
 */
function gateBuild() {
  const target = process.env.CARGO_TARGET_DIR ?? join(repo, "kernel/target");
  console.log("--gate: the release kernel is not current here: building the gate profile (seconds when little changed)...");
  const t = performance.now();
  // (The merge's build takes six: nothing of the gate can start before it, but asking the whole pool waited minutes for
  // the last tokens on a busy machine. The kernel's test programs are built
  // after, beside the test files: 2026-10-24, building them here first made a kernel change's gate 220 s, beside 170 s.)
  const cmd = `cargo build --profile gate --manifest-path kernel/Cargo.toml --workspace -q && cargo build --release --manifest-path kernel/Cargo.toml --target wasm32-unknown-unknown -p oikos-law -q`;
  if (!run(["bun", join(import.meta.dir, "slots.ts"), "--weight", String(defaultPriority() ? 6 : 4), "--what", "kernel build (gate profile)", "--", "sh", "-c", cmd], repo)) stop("the gate build of the kernel failed: run `cargo build --profile gate --manifest-path kernel/Cargo.toml --workspace` and read its errors");
  const lib = ["liboikos_napi.dylib", "liboikos_napi.so"].map((f) => join(target, "gate", f)).find((f) => existsSync(f));
  process.env.OIKOS_KERNEL = join(target, "gate", "oikos-kernel");
  if (lib) process.env.OIKOS_ENGINE_MODULE = lib;
  process.env.OIKOS_LAW_MODULE = join(target, "wasm32-unknown-unknown/release/oikos_law.wasm");
  console.log(`--gate: kernel built (gate profile) in ${((performance.now() - t) / 1000).toFixed(0)}s: ${process.env.OIKOS_KERNEL}`);
}

const all = [...new Glob("**/*.test.ts").scanSync({ cwd: root })]
  .filter((f) => !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target") && !f.startsWith(".claude/"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  // (The gate is the gate tier's; --tier picks one.)
  .filter((f) => (affected || tierFlag === "gate" ? !isSlowTier(f) : tierFlag === "slow" ? isSlowTier(f) : true));
const untimed = all.filter((f) => times[f] === undefined);
// (Under --gate, the slow tier's files too: the ones the change reaches join the gate below.)
const slowAll = affected ? [...new Glob("**/*.test.ts").scanSync({ cwd: root })].filter((f) => isSlowTier(f) && !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target") && !f.startsWith(".claude/")).filter((f) => !filters.length || filters.some((x) => f.includes(x))) : [];

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
/** `narrow` (the slow tier's files under --gate): no document counts, and a folder named counts only below the top level ("worlds/profiles/", not "scripts/"): a
 * town test whose code says "scripts/" does not read every script's data, and each slow file costs minutes. */
function reasons(tests: string[], deep = false, narrow = false): { why: Map<string, string>; changedFiles: string[]; kernel: boolean; unreached: string[] } {
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) stop(`git ${a.join(" ")} failed: ${p.stderr.toString().trim()} (--changed compares with ${base}: fetch it, or name another with --base)`); return p.stdout.toString().trim(); };
  const from = git("merge-base", base, "HEAD");
  const changedFiles = [...new Set([...git("diff", "--name-only", from).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))].sort();
  const set = new Set(changedFiles);
  const allDocs = changedFiles.length > 0 && changedFiles.every(isDoc);
  // (Data a test reads by name, not by import: a world, a profile, a schema. Named by its file name in the test or what it imports.)
  const data = changedFiles.filter((f) => (deep && isDoc(f)) || /\.(ya?ml|json|cel|sql|txt|py)$/.test(f) && !/(^|\/)(package|tsconfig|test-times)\.json$/.test(f) && !f.startsWith("kernel/"));
  const seen = new Map<string, { imports: string[]; text: string; readonly code: string }>();
  const load = (f: string) => { let e = seen.get(f); if (!e) { let text = ""; try { text = readFileSync(join(root, f), "utf8"); } catch {} e = { imports: /\.(ts|tsx|js|mjs)$/.test(f) ? importsOf(f, text) : [], text, get code() { return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1"); } }; seen.set(f, e); } return e; };
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
      // (A document is read by code, not named in a comment: for one, the file's code with its comments taken out must name
      // it, or hold a path into the docs in a string: in the test itself any ("docs/x.md"), in what it imports a folder only
      // ("docs/behaviour/", "../../docs", join(root, "docs")); a module's note of its own document, or a message that cites
      // one, "(docs/profiles.md)", does not read this one. Every source file cites a document in its comments, so a test that only
      // imports one does not read documents: 2026-10-24, a change to one document chose 220 files.)
      const named = data.find((c) => {
        if (narrow && isDoc(c)) return false; // (a document brings no slow test: what a town test reads is code, configs and profiles)
        if (deep && isDoc(c)) { const code = load(f!).code; return code.includes(c.split("/").pop()!) || (f === t ? /["'`](?:[^"'`\n]*\/)?docs(?:\/|["'`])/ : /["'`](?:[^"'`\n]*\/)?docs(?:\/[\w\/-]*)?["'`]/).test(code); }
        const txt = load(f!).text; return txt.includes(c.split("/").pop()!) || (deep && (!narrow || dirname(c).includes("/")) && txt.includes(dirname(c) + "/"));
      });
      if (named) { reached.add(named); if (!why.has(t)) why.set(t, `names ${named}${f === t ? "" : ` (in ${f})`}`); }
      // (--affected: a test that starts a script by its name -- the command line, a pilot's queue -- reaches what the script imports.
      // A whole name only: "foo.test.ts" names no script "test.ts".)
      // (Not for documents only: a script started by name reads a document only if a test that imports it would.)
      const spawned = deep && !allDocs ? [...new Set(load(f).text.match(/(?<![\w.-])[\w-]+\.(?:ts|sh)\b/g) ?? [])].flatMap((b) => byName().get(b) ?? []) : [];
      for (const i of [...load(f).imports, ...spawned]) if (!depth.has(i)) { depth.set(i, d + 1); queue.push(i); }
    }
  }
  return { why, changedFiles, kernel: changedFiles.some((f) => f.startsWith("kernel/")), unreached: changedFiles.filter((f) => !reached.has(f) && !f.startsWith("kernel/") && !/\.md$/.test(f)) };
}
const pick = changed ? reasons(all, affected) : undefined;
const fullWhy = affected && pick ? pick.changedFiles.find((f) => FULL_ON.some((r) => r.test(f))) : undefined;
const docsOnly = affected && !!pick && !fullWhy && pick.changedFiles.length > 0 && pick.changedFiles.every(isDoc);
const sel = fullWhy || !pick ? undefined : pick;
if (affected) console.log(fullWhy ? `--gate: ${fullWhy} changed, which could reach any test: the whole gate tier (${all.length} files), and of the slow tier what it reaches (all of it in CI).` : docsOnly ? "--gate: documents only: the tests that read documents, and the backstops." : "");
if (sel) {
  const isFast = (f: string) => (times[f] ?? Infinity) < FAST_SECONDS;
  const extra = all.filter((f) => pick.why.has(f) && !isFast(f));
  const slow = all.filter((f) => !isFast(f));
  console.log(`--changed: ${pick.changedFiles.length} file${pick.changedFiles.length === 1 ? "" : "s"} changed since ${base}; the fast tier (${all.length - slow.length} files) and ${extra.length} more:`);
  for (const f of extra) console.log(`  + ${f} (about ${Math.round(times[f] ?? 0)}s): ${pick.why.get(f)}`);
  if (pick.kernel && !affected) console.log("  + the kernel's own tests (cargo): kernel sources changed. The tests that simulate towns all run the kernel and are NOT chosen for that: `--gate` chooses them.");
  if (pick.unreached.length) console.log(`  no test imports or names: ${pick.unreached.slice(0, 12).join(", ")}${pick.unreached.length > 12 ? `, and ${pick.unreached.length - 12} more` : ""}`);
  if (slow.length && extra.length > slow.length / 2) console.log(`  (${extra.length} of the ${slow.length} slow files: this change reaches most of the suite. To run less, name the tests that cover it: bun scripts/test.ts <filter>...)`);
}
// The slow tier's files the change reaches (--gate only): by the same reading as the gate's own, and the slow backstops for
// a change to the kernel or the contracts; never for documents only. They run with the gate; the budget leaves them out.
const slowPick = affected && pick && !docsOnly && slowAll.length ? reasons(slowAll, true, true) : undefined;
const kernelOrContracts = !!pick?.changedFiles.some((f) => f.startsWith("kernel/") || /^contracts\/(?!.*\.md$)/.test(f));
const reached = slowAll.filter((f) => slowPick?.why.has(f));
const broad = reached.length > SLOW_MOST;
const slowChosen = slowAll.filter((f) => (broad ? canaries.includes(f) : reached.includes(f)) || (kernelOrContracts && kernelCanaries.includes(f)));
if (broad) console.log(`--gate: the change reaches ${reached.length} of the slow tier's files, more than ${SLOW_MOST}: the canaries instead (scripts/test-tiers.json), the rest in CI after the push.`);
const slowChosenSet = new Set(slowChosen);
if (slowChosen.length) {
  console.log(`--gate: and ${slowChosen.length} of the slow tier's ${slowAll.length} files, which the change reaches (their times are reported, not counted against the gate's budget):`);
  for (const f of slowChosen) console.log(`  + ${f} (about ${Math.round(times[f] ?? 0)}s, slow tier): ${broad || !slowPick?.why.has(f) ? `a canary (${tiers.canary?.[f]?.why ?? ""})${!broad ? ": the kernel or the contracts changed" : ""}` : slowPick.why.get(f)}`);
}
// The kernel's own tests: under --gate, when the kernel or the contracts it compiles in changed, and then only the crates
// the change reaches (undefined: all of them; null: none).
const contractsChanged = !!pick?.changedFiles.some((f) => /^contracts\/(?!.*\.md$)/.test(f));
const kernelWhich: string[] | undefined | null = !filters.length && !custom && !timeNew && !list && tierFlag !== "slow" && (!pick || pick.kernel || contractsChanged) ? (pick && !contractsChanged ? kernelCrates(pick.changedFiles) : undefined) : null;
if (!custom && !list) preconditions(affected);
const files = [...all, ...slowChosen]
  .filter((f) => slowChosenSet.has(f) || !sel || (affected && BACKSTOPS.includes(f)) || (!docsOnly && (times[f] ?? Infinity) < FAST_SECONDS) || sel.why.has(f))
  .filter((f) => !fast || (times[f] ?? Infinity) < FAST_SECONDS)
  .filter((f) => !timeNew || times[f] === undefined)
  .sort((a, b) => (times[b] ?? 1e9) - (times[a] ?? 1e9) || (a < b ? -1 : 1));
// (Written at once: console.log to a pipe can be cut short by the exit that follows, and a list read by a test was, under load.)
if (list) { writeSync(1, files.join("\n") + "\n"); process.exit(0); }
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
const kernelTests = kernelWhich !== null ? kernelCargoTests(kernelWhich) : Promise.resolve();
/**
 * The kernel's crates a change reaches: each changed crate and every crate that depends on it, however far up (from
 * `cargo metadata`). A change outside any member crate (the workspace's manifest or lock, the contracts compiled in)
 * reaches them all: undefined. Sound because a crate's tests can only see what it is built from.
 */
function kernelCrates(changedFiles: string[]): string[] | undefined {
  const m = Bun.spawnSync(["cargo", "metadata", "--format-version", "1", "--no-deps", "--offline", "--manifest-path", "kernel/Cargo.toml"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (m.exitCode !== 0) return undefined;
  const pkgs = (JSON.parse(m.stdout.toString()).packages as { name: string; manifest_path: string; dependencies: { name: string; path?: string }[] }[])
    .map((p) => ({ name: p.name, dir: dirname(p.manifest_path).slice(realpathSync(repo).length + 1), deps: p.dependencies.filter((d) => d.path).map((d) => d.name) }));
  const hit = new Set<string>();
  for (const f of changedFiles.filter((f) => f.startsWith("kernel/"))) {
    // (The crate whose folder holds the file, the deepest; the root crate's own folders are src/, tests/, benches/, build.rs.)
    const owner = pkgs.filter((p) => f.startsWith(p.dir + "/") && (p.dir !== "kernel" || /^kernel\/(src|tests|benches|examples)\/|^kernel\/build\.rs$/.test(f))).sort((a, b) => b.dir.length - a.dir.length)[0];
    if (!owner) return undefined;
    hit.add(owner.name);
  }
  for (let grew = true; grew;) { grew = false; for (const p of pkgs) if (!hit.has(p.name) && p.deps.some((d) => hit.has(d))) { hit.add(p.name); grew = true; } }
  return [...hit].sort();
}
async function kernelCargoTests(crates?: string[]) {
  // (The `gate` profile: release's optimisation and overflow checks, without its whole-program link: the same tests, built in
  // a fraction of the time. 2026-10-24: `cargo test --release` built each of ~50 test programs with a fat LTO link.)
  const slot = await take(4, `the kernel's tests (cargo test${crates ? ` -p ${crates.join(" -p ")}` : ""})`, { borrow: true });
  const which = crates ? crates.flatMap((c) => ["-p", c]) : ["--workspace"];
  if (crates) console.log(`kernel tests (cargo test): ${crates.join(", ")}`);
  // (cargo-nextest where it is installed: every test its own process, the test programs side by side, where `cargo test`
  // runs them one after another: 28 s against 87 s for the whole workspace. It runs no doc tests: cargo does, after.)
  // (Half as many rustc jobs as tokens: one rustc spreads its codegen over several cores, ~4-5 seen under load on
  // 2026-10-24, so jobs = tokens left the machine at load 30 on 14 cores. `buildJobs` in slots.ts.)
  const jobs = String(buildJobs(slot?.weight || 4));
  const nextest = Bun.spawnSync(["cargo", "nextest", "--version"], { cwd: repo, stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  const m = ["--manifest-path", "kernel/Cargo.toml", ...which];
  const cmd = nextest
    ? `cargo nextest run --cargo-profile gate ${m.join(" ")} --test-threads ${jobs} --no-fail-fast --status-level fail --final-status-level fail --hide-progress-bar && cargo test --profile gate ${m.join(" ")} --doc -q`
    : `cargo test --profile gate ${m.join(" ")} -q`;
  const k = Bun.spawn(["sh", "-c", cmd], { cwd: repo, stdout: "pipe", stderr: "pipe", env: { ...insideSlot(4), CARGO_BUILD_JOBS: jobs } });
  children.add(k);
  const out = (await Promise.all([new Response(k.stdout).text(), new Response(k.stderr).text()])).join("");
  const ok = (await k.exited) === 0;
  children.delete(k);
  slot?.release();
  console.log(`${ok ? "ok  " : "FAIL"} kernel (cargo test) ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) { failed++; console.log(out.split("\n").filter((l) => /FAILED|FAIL \[|panicked|error/.test(l)).slice(0, 40).join("\n")); }
}

/** Files whose failures under load are timing, not behaviour (docs/dev-machine.md, "Flakes"): rerun once alone, and accepted only if they then pass. */
const KNOWN_FLAKES = new Set(["scripts/slots.test.ts", "orchestrator/test/pilot-wave.test.ts"]);
let pass = 0, fail = 0, rerun = 0, next = 0, running = 0;
/** This run, file by file (wall seconds, passed, tests): kept in ~/.oikos/test-runs (OIKOS_TEST_RUNS), the last 200 runs. */
const record: Record<string, { secs: number; ok: boolean; tests: number }> = {};
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

// Seconds in which none of this run's files was running though some were still to run: the run waiting on the machine
// (slots held by others, the load average), which the slow tier's wall budget does not count against the suite.
let stalled = 0;
const stallTimer = setInterval(() => { if (running === 0 && next < files.length) stalled++; }, 1000);
stallTimer.unref?.();
async function worker() {
  for (;;) {
    while (next < files.length && running >= allowed(running)) await Bun.sleep(1000);
    if (next >= files.length) return;
    // A token of the machine's for each file running (waited for, with the files of every other suite and build).
    // (It borrows: a file holds its token for seconds, so the suite may go past its checkout's cap while no other checkout waits.)
    const slot = await take(1, `test suite (${files.length} files) in ${root}`, { borrow: true, cancel: () => next >= files.length });
    const f = files[next++];
    if (!slot || !f) { slot?.release(); return; }
    running++;
    const r = await runFile(f).finally(() => slot.release());
    running--;
    times[f] = Math.round(r.secs * 10) / 10;
    record[f] = { secs: times[f]!, ok: r.code === 0, tests: r.npass + r.nfail };
    if (r.onlyTimeouts) { lateTimeouts.push(f); console.log(`LATE ${f} ${r.secs.toFixed(0)}s (timed out; to be rerun alone)`); continue; }
    // (A known timing flake, the same two files merge.ts's flake rule names, gets the same one rerun alone in every run,
    // CI's included: main went red on 2026-10-25 for slots.test.ts alone, which passed three times in a row by hand.)
    if (r.code !== 0 && KNOWN_FLAKES.has(f)) { lateTimeouts.push(f); console.log(`LATE ${f} ${r.secs.toFixed(0)}s (a known timing flake; to be rerun alone)`); continue; }
    pass += r.npass; fail += r.nfail;
    console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${f} ${r.secs.toFixed(0)}s`);
    if (r.code !== 0) { failed++; bad.push(tail(f, r.text)); }
  }
}
await Promise.all([kernelTests, ...Array.from({ length: Math.max(1, Math.min(maxJobs, files.length)) }, worker)]);

// Files that only timed out run again, one at a time, with the machine to themselves as far as this run goes.
for (const f of lateTimeouts) {
  const slot = await take(1, `test suite (a rerun) in ${root}`, { borrow: true });
  const r = await runFile(f).finally(() => slot?.release());
  pass += r.npass; fail += r.nfail;
  if (r.code === 0) { rerun++; times[f] = Math.round(r.secs * 10) / 10; console.log(`PASSED ON RERUN (timed out under load) ${f} ${r.secs.toFixed(0)}s`); }
  else { failed++; console.log(`FAIL ${f} ${r.secs.toFixed(0)}s (failed again on rerun)`); bad.push(tail(f, r.text)); }
}

if (!custom && !list) try {
  const dir = process.env.OIKOS_TEST_RUNS ?? join(homedir(), ".oikos", "test-runs");
  mkdirSync(dir, { recursive: true });
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" }).stdout.toString().trim();
  const mode = affected ? "gate" : tierFlag !== "all" ? `tier ${tierFlag}` : fast ? "fast" : filters.length ? "filtered" : "all";
  writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.json`), JSON.stringify({ at: new Date().toISOString(), root: repo, head, mode, wallSecs: Math.round((performance.now() - t0) / 100) / 10, failed, files: record }, null, 1) + "\n");
  for (const old of readdirSync(dir).filter((f) => f.endsWith(".json")).sort().slice(0, -200)) rmSync(join(dir, old), { force: true });
} catch { /* a record is a convenience: never a failure */ }
if (!custom && ((!filters.length && !fast && !changed) || timeNew)) writeFileSync(timesPath, JSON.stringify(Object.fromEntries(Object.entries(times).sort()), null, 1) + "\n");
for (const b of bad) console.log(b);
// (A gate file that ran long belongs in the slow tier: a new file comes in untimed, and nothing else would say so.)
const long = Object.entries(record).filter(([f, r]) => !isSlowTier(f) && r.secs > 90).map(([f, r]) => `${f} (${r.secs}s)`);
if (long.length && !custom) console.log(`\nNOTE gate-tier files over 90 s: ${long.join(", ")}. Name them in scripts/test-tiers.json (the slow tier), with why.`);
console.log(`\n${pass} pass, ${fail} fail across ${files.length} files, ${maxJobs} at a time, in ${((performance.now() - t0) / 1000).toFixed(0)}s${fast ? " (fast tier)" : changed ? " (fast tier and what changed)" : ""}, ${rerun} passed on rerun`);
// The time budgets (scripts/test-budgets.json; raising one is a decision with its entry in docs/decisions.md): the gate fails when the
// sum of its files' own times is over its file-seconds, or a file is over its file limit (each file's time, not the run's wall: a merge
// never fails because the machine was busy while it ran); the slow tier warns over its wall time. (Not for named files or another root.)
let over = false;
if (!custom && !filters.length && !list) {
  const budgets = JSON.parse(readFileSync(join(repo, "scripts", "test-budgets.json"), "utf8")) as { gate: { file_seconds_total: number; file_seconds: number }; slow: { wall_seconds: number } };
  const say = "(docs/testing.md, \"Pruning: when a budget is hit\"; a budget is raised only with an entry in docs/decisions.md)";
  if (affected || tierFlag === "gate") {
    const own = Object.entries(record).filter(([f]) => !slowChosenSet.has(f));
    const slowRan = Object.entries(record).filter(([f]) => slowChosenSet.has(f));
    if (slowRan.length) console.log(`(budgets: the slow tier's files the change reached took ${slowRan.reduce((n, [, r]) => n + r.secs, 0).toFixed(0)} file-seconds, not counted: ${slowRan.map(([f, r]) => `${f} ${r.secs}s`).join(", ")})`);
    const long = own.filter(([, r]) => r.secs > budgets.gate.file_seconds).map(([f, r]) => `${f} ${r.secs}s`);
    if (long.length) { over = true; console.log(`BUDGET: gate files over ${budgets.gate.file_seconds}s: ${long.join(", ")} ${say}`); }
    const raw = own.reduce((n, [, r]) => n + r.secs, 0);
    // (Load-adjusted: files share cores, so under load every file runs slower. The load is the median of this run's time over the
    // recorded time, across the files that have one; the total is divided by it when it is over 1. 2026-10-26: a gate went 32 s
    // over at load 20 to 27 with nothing of its own added.)
    const ratios = own.filter(([f]) => recorded[f]! > 1).map(([f, r]) => r.secs / recorded[f]!).sort((x, y) => x - y);
    const load = ratios.length >= 10 ? Math.max(1, ratios[Math.floor(ratios.length / 2)]!) : 1;
    const total = raw / load;
    console.log(`(budgets: the gate's files took ${raw.toFixed(0)} file-seconds${load > 1 ? `, ${total.toFixed(0)} at the recorded load (this run ran ${load.toFixed(2)}x slower)` : ""} of its ${budgets.gate.file_seconds_total})`);
    if (total > budgets.gate.file_seconds_total) { over = true; console.log(`BUDGET: the gate's files took ${total.toFixed(0)} file-seconds (load-adjusted), over its ${budgets.gate.file_seconds_total} ${say}`); }
  } else if (tierFlag === "slow") {
    // (Less the seconds the run stood waiting on the machine with nothing of its own running.)
    const wall = (performance.now() - t0) / 1000 - stalled;
    if (wall > budgets.slow.wall_seconds) console.log(`BUDGET (a warning): the slow tier took ${wall.toFixed(0)}s, over its ${budgets.slow.wall_seconds}s ${say}`);
  }
}
process.exit(failed || over ? 1 : 0);
