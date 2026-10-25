// Mutation testing (docs/testing.md, "Mutation testing"): plant one realistic bug at a time in a scratch copy of the
// repo, run the tests that should catch it, record which failed, and put the source back. What it measures is which
// tests catch real bugs, and which bugs nothing catches.
//
//   bun scripts/slots.ts --weight 3 -- bun scripts/mutate.ts --copy DIR [--jobs 3] [--only id,id] [--tests fast|own|invariants]
//       [--out FILE] [--no-baseline]
//
// --source DIR the unmutated sources to measure (default: this checkout), e.g. a commit extracted with git archive.
// --copy DIR   the scratch copy (made with `cp -c -R`, a copy-on-write clone, if it is not there; the files this checkout
//              changes are copied in on every start). The repo itself is never touched.
// --tests      which tests each mutation is run against: `fast` (the default) is the fast tier, the files the mutation
//              names, the kernel's own tests for a kernel mutation, and the invariants; `own` the files it names and the
//              invariants; `invariants` the invariants alone.
// --out FILE   results as JSON (default: DIR/mutation-results.json), written after each mutation, so a stopped run keeps
//              what it found; a mutation already in it is not run again unless --again.
//
// Every test file is run once unmutated first (the baseline): a test that fails there is left out of what a mutation
// is said to have caught. A test file that runs past its limit under a mutation counts as catching it (a hang is a
// failure), and is named as timed out.
//
// The bugs are in scripts/mutations.ts. Each is one exact replacement, found once in its file.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MUTATIONS, type Mutation } from "./mutations";

const here = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const bool = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const copy = flag("copy");
// --source DIR: where the unmutated sources are read from (default: this checkout). For measuring a fixed commit while
// this checkout moves on: extract it (`git archive <commit> | tar -x -C DIR`) with the harness's own files beside it.
const repo = flag("source") ?? here;
if (!copy) { console.error("--copy DIR is required: the scratch copy the bugs are planted in"); process.exit(2); }
const jobs = Number(flag("jobs") ?? 3);
const only = flag("only")?.split(",");
const tier = (flag("tests") ?? "fast") as "fast" | "own" | "invariants";
const outPath = flag("out") ?? join(copy, "mutation-results.json");
const again = bool("again");
const noBaseline = bool("no-baseline");
const FILE_LIMIT_MS = Number(flag("file-limit-s") ?? 1500) * 1000;
const INVARIANTS = "orchestrator/test/invariants.test.ts";

const sh = (cmd: string[], cwd: string, env?: Record<string, string>) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { ok: p.exitCode === 0, out: p.stdout.toString() + p.stderr.toString() };
};

// ---- The copy: cloned once, then the files this checkout has changed (or added) are brought in.
if (!existsSync(copy)) {
  console.log(`cloning ${repo} into ${copy} (copy-on-write)...`);
  const r = sh(["cp", "-c", "-R", repo, copy], "/");
  if (!r.ok) { console.error(r.out); process.exit(1); }
}
const changed = repo === here ? sh(["git", "ls-files", "-m", "-o", "--exclude-standard"], repo).out.split("\n").filter(Boolean) : [];
for (const f of changed) if (existsSync(join(repo, f))) { mkdirSync(dirname(join(copy, f)), { recursive: true }); cpSync(join(repo, f), join(copy, f)); }
// Every mutated file is put back from the repo before anything runs (a run stopped mid-mutation leaves its bug).
for (const m of MUTATIONS) if (existsSync(join(repo, m.file))) cpSync(join(repo, m.file), join(copy, m.file)); // (a bug whose file is gone is not planted)

const times: Record<string, number> = JSON.parse(readFileSync(join(repo, "scripts/test-times.json"), "utf8"));
// Every test file the suite has, but those the suite's own timings call slow (10 s or more; they simulate towns):
// the files never timed are in, and the baseline times them. A mutation is run against those that took under
// FAST_MS in the baseline, and the slow files it names.
const FAST_MS = 30_000;
const everyFile = [...new Bun.Glob("**/*.test.ts").scanSync({ cwd: repo })].filter((f) => !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target") && !f.startsWith(".claude/")).sort();
const candidates = everyFile.filter((f) => !((times[f] ?? 0) >= 10));

interface FileResult { file: string; failed: string[]; passed: number; timedOut: boolean; error?: string; ms: number }
interface MutationResult { id: string; kind: string; file: string; caught: boolean; by: string[]; byInvariants: string[]; timedOut: string[]; files: string[]; kernelTests?: { failed: string[]; ok: boolean }; applied: boolean; note?: string; ms: number }

/** Run one test file in the copy; the tests that failed (junit), or a time-out. */
async function runFile(file: string, tag: string): Promise<FileResult> {
  const junit = join(copy!, ".mutate", `${tag}-${file.replace(/[\/.]/g, "_")}.xml`);
  mkdirSync(dirname(junit), { recursive: true });
  rmSync(junit, { force: true });
  const t0 = Date.now();
  const p = Bun.spawn(["bun", "test", "--reporter=junit", `--reporter-outfile=${junit}`, file], { cwd: copy, stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(9); }, FILE_LIMIT_MS);
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (timedOut) return { file, failed: [], passed: 0, timedOut: true, ms };
  if (!existsSync(junit)) return { file, failed: [`${file} (did not run)`], passed: 0, timedOut: false, error: (o + e).slice(-1500), ms };
  const xml = readFileSync(junit, "utf8");
  const failed: string[] = [];
  let passed = 0;
  // <testcase name=".." classname=".." ...> ... <failure .../> ... </testcase>  (or self-closed when it passed)
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = m[1]!;
    const name = /name="([^"]*)"/.exec(attrs)?.[1] ?? "?";
    const cls = /classname="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const body = m[3] ?? "";
    const id = `${file} > ${cls && cls !== name ? cls + " > " : ""}${name}`.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'");
    // (A test that timed out under a loaded machine is not a catch: bun reports it as a TimeoutError. It is left out, as
    // the suite's runner reruns a file whose only failures are time-outs.)
    if (/<failure|<error/.test(body) && !/type="TimeoutError"/.test(body)) failed.push(id);
    else if (!/<skipped/.test(body)) passed++;
  }
  // A file that failed to load (an error outside any test) has a non-zero exit and no failing case.
  const code = p.exitCode ?? 0;
  if (code !== 0 && !failed.length) failed.push(`${file} (failed outside a test)`);
  return { file, failed, passed, timedOut: false, ms };
}

async function runFiles(files: string[], tag: string): Promise<FileResult[]> {
  const queue = [...files].sort((a, b) => (times[b] ?? 30) - (times[a] ?? 30));
  const results: FileResult[] = [];
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) results.push(await runFile(f, tag));
  }));
  return results;
}

function kernelBuild(): { ok: boolean; out: string } {
  return sh(["sh", "-c", "cargo build --release --manifest-path kernel/Cargo.toml --workspace && cargo build --release --manifest-path kernel/Cargo.toml --target wasm32-unknown-unknown -p oikos-law"], copy!);
}
function kernelTests(): { ok: boolean; failed: string[] } {
  const r = sh(["cargo", "test", "--release", "--manifest-path", "kernel/Cargo.toml", "--workspace", "--no-fail-fast"], copy!);
  const failed = [...r.out.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => `kernel > ${m[1]}`);
  if (!r.ok && !failed.length) failed.push(`kernel (did not build or run: ${r.out.split("\n").filter((l) => /^error/.test(l)).slice(0, 3).join(" | ")})`);
  return { ok: r.ok, failed };
}

const filesFor = (m: Mutation) => {
  const own = [...(m.tests ?? [])].filter((f) => existsSync(join(copy!, f)));
  const fast = candidates.filter((f) => (baseMs[f] ?? 0) < FAST_MS);
  const set = tier === "invariants" ? [INVARIANTS] : tier === "own" ? [...own, INVARIANTS] : [...fast, ...own, INVARIANTS];
  return [...new Set(set)].filter((f) => existsSync(join(copy!, f)));
};

const results: { baseline?: { failed: string[]; files: number; at: string }; baselineMs?: Record<string, number>; mutations: MutationResult[] } = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { mutations: [] };
const baseMs: Record<string, number> = (results.baselineMs ??= {});
const save = () => writeFileSync(outPath, JSON.stringify(results, null, 1));

const chosen = MUTATIONS.filter((m) => !only || only.includes(m.id)).filter((m) => again || !results.mutations.some((r) => r.id === m.id));
// Kernel mutations last: each needs a build, and the copy's kernel is rebuilt clean at the end.
chosen.sort((a, b) => Number(a.file.startsWith("kernel/")) - Number(b.file.startsWith("kernel/")));
console.log(`${chosen.length} mutation${chosen.length === 1 ? "" : "s"} to run, ${jobs} test file${jobs === 1 ? "" : "s"} at a time, tests: ${tier}`);

// ---- Baseline: every file any chosen mutation may run, unmutated (and timed).
const allFiles = tier === "fast" ? [...new Set([...candidates, ...chosen.flatMap((m) => m.tests ?? []), INVARIANTS])] : [...new Set(chosen.flatMap(filesFor))];
const baseFailed = new Set(results.baseline?.failed ?? []);
if (!noBaseline) {
  const need = allFiles.filter((f) => !(results as any).baselineFiles?.includes(f));
  if (need.length) {
    console.log(`baseline: ${need.length} files unmutated...`);
    const t0 = Date.now();
    const b = await runFiles(need, "baseline");
    for (const r of b) { baseMs[r.file] = r.ms; for (const f of r.failed) baseFailed.add(f); if (r.timedOut) baseFailed.add(`${r.file} (timed out)`); }
    (results as any).baselineFiles = [...new Set([...((results as any).baselineFiles ?? []), ...need])];
    results.baseline = { failed: [...baseFailed], files: (results as any).baselineFiles.length, at: new Date().toISOString() };
    save();
    console.log(`baseline: ${baseFailed.size} failing unmutated (${Math.round((Date.now() - t0) / 1000)} s)${baseFailed.size ? ": " + [...baseFailed].slice(0, 8).join("; ") : ""}`);
  }
}

let kernelDirty = false;
for (const m of chosen) {
  const path = join(copy, m.file);
  const original = readFileSync(join(repo, m.file), "utf8");
  const count = original.split(m.find).length - 1;
  const t0 = Date.now();
  if (count !== 1) {
    console.log(`${m.id}: NOT APPLIED (found ${count} times in ${m.file})`);
    results.mutations = results.mutations.filter((r) => r.id !== m.id);
    results.mutations.push({ id: m.id, kind: m.kind, file: m.file, caught: false, by: [], byInvariants: [], timedOut: [], files: [], applied: false, note: `find occurs ${count} times`, ms: 0 });
    save();
    continue;
  }
  writeFileSync(path, original.replace(m.find, m.replace));
  const isKernel = m.file.startsWith("kernel/");
  let note: string | undefined;
  let kt: { ok: boolean; failed: string[] } | undefined;
  try {
    if (isKernel) {
      kernelDirty = true;
      const b = kernelBuild();
      if (!b.ok) note = `the kernel did not build: ${b.out.split("\n").filter((l) => /^error/.test(l)).slice(0, 2).join(" | ")}`;
    }
    const files = filesFor(m);
    const rs = note ? [] : await runFiles(files, m.id);
    if (isKernel && !note && tier === "fast") kt = kernelTests();
    const failed = [...rs.flatMap((r) => r.failed), ...(kt?.failed ?? [])].filter((f) => !baseFailed.has(f));
    const timedOut = rs.filter((r) => r.timedOut).map((r) => r.file);
    const by = [...failed, ...timedOut.map((f) => `${f} (timed out)`)];
    const byInvariants = by.filter((f) => f.startsWith(INVARIANTS));
    const r: MutationResult = { id: m.id, kind: m.kind, file: m.file, caught: by.length > 0, by, byInvariants, timedOut, files, applied: true, ...(kt ? { kernelTests: { ok: kt.ok, failed: kt.failed } } : {}), ...(note ? { note } : {}), ms: Date.now() - t0 };
    // Merging with an earlier result for the same bug: a run of the invariants alone keeps what the other tests found.
    const prev = results.mutations.find((x) => x.id === m.id);
    if (prev && tier === "invariants") { r.by = [...prev.by.filter((f) => !f.startsWith(INVARIANTS)), ...byInvariants]; r.caught = r.by.length > 0; r.files = [...new Set([...prev.files, ...files])]; if (prev.kernelTests) r.kernelTests = prev.kernelTests; }
    results.mutations = results.mutations.filter((x) => x.id !== m.id);
    results.mutations.push(r);
    save();
    console.log(`${m.id}: ${r.caught ? `CAUGHT by ${r.by.length} (${byInvariants.length} invariants)` : "not caught"}${note ? ` [${note}]` : ""} (${Math.round(r.ms / 1000)} s)`);
  } finally {
    writeFileSync(path, original);
  }
}
if (kernelDirty) {
  console.log("rebuilding the copy's kernel unmutated...");
  const b = kernelBuild();
  if (!b.ok) console.log("WARNING: the unmutated kernel did not build in the copy");
}

// ---- Summary.
const done = results.mutations.filter((r) => r.applied);
const caught = done.filter((r) => r.caught);
const before = done.filter((r) => r.by.some((f) => !f.startsWith(INVARIANTS)));
console.log(`\n${done.length} bugs planted; caught by the tests other than the invariants: ${before.length}; by anything: ${caught.length}; by the invariants: ${done.filter((r) => r.byInvariants.length).length}`);
for (const r of done) console.log(`  ${r.caught ? "caught " : "MISSED "} ${r.id} (${r.kind}): ${r.by.slice(0, 4).join("; ")}${r.by.length > 4 ? ` and ${r.by.length - 4} more` : ""}`);
