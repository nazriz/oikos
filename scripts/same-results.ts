// Whether two kernel builds give the same results, and what each costs: the towns run on each, in turn, and their
// state hashes, log digests, times and peak memory set side by side. For a change that must leave results
// byte-identical (docs/design/performance.md, "A plan for what is left": each representation step).
//
//   bun scripts/same-results.ts --write <dir>                       configs of the towns, once (200 and 1,000 people, three profiles)
//   bun scripts/same-results.ts --digest <log.jsonl>                a log's digest (logDigest)
//   bun scripts/same-results.ts --pin scripts/fixtures/representation-results.json [--kernel K --at COMMIT]   their results, pinned
//   bun scripts/same-results.ts --run <dir> --kernel A --kernel B [--runs N] [--days D] [--threads T] [--only REGEX]
//
// With `--run`, each town is run on A, then B, N times (default 1), and a line printed for each run: its state hash, the
// digest of its log (`logDigest`), wall seconds, user CPU seconds, the run's own thread's CPU and the peak resident bytes. It exits
// non-zero if any run's hash or log differs from the first's for that town.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld } from "../orchestrator/src/batch";
import { writeConfigFile } from "../orchestrator/src/rust-world";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flags = (n: string) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]!] : []));
const DAY = 86_400;

export const TOWNS = ["worlds/town.yaml", "worlds/town-1000.yaml"];
export const PROFILES = ["au-vic-2026", "gb-eng-2026", "us-oh-2026"];

/** Writes each town's config for each profile into `dir`, named `<people>-<profile>.json`. */
export async function writeConfigs(dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  for (const town of TOWNS) {
    for (const profile of PROFILES) {
      const { config, spec } = await loadWorld(join(root, town), [`profile=${profile}`]);
      const file = join(dir, `${spec.citizens}-${profile}.json`);
      if (!existsSync(file)) writeConfigFile(config, file);
      out.push(file);
    }
  }
  return out;
}

/** A log's sha-256 as two builds can share it: every entry as written, but for the header's name of the kernel's build
 * (its commit) and the hash chain that runs from it (each entry's `hash` and `prev`), which every build writes anew. */
export function logDigest(text: string): string {
  const h = createHash("sha256");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    delete e.hash;
    delete e.prev;
    if (e.kind === "header" && e.body?.kernel) e.body.kernel.build = "";
    h.update(JSON.stringify(e));
    h.update("\n");
  }
  return h.digest("hex");
}

export type Result = { hash: string; log: string; wall: number; user: number; main: number; peak: number };

/** One run of a config on a kernel binary: its state hash, its log's sha-256 and what it cost. (Its peak is the
 * kernel's own word for it; on Linux a process started from Bun reports Bun's size as its floor: scripts/pair.sh.) */
export async function runOn(kernel: string, config: string, days: number, threads: number): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), "oikos-same-"));
  try {
    const t0 = performance.now();
    const p = Bun.spawn([kernel, "world", config, "--out", dir, "--run-id", "r", "--until", String(days * DAY), "--threads", String(threads)], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_ENGINE_THREADS: String(threads) },
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const wall = (performance.now() - t0) / 1000;
    if (code !== 0) throw new Error(`${kernel} on ${config}: ${err.slice(-2000)}`);
    const hash = JSON.parse(out.trim().split("\n").pop()!).state_hash as string;
    const log = logDigest(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!), "utf8"));
    const user = Number(p.resourceUsage()?.cpuTime.user ?? 0) / 1e6;
    return { hash, log, wall, user, main: Number(err.match(/main thread cpu (\d+) ms/)?.[1]) / 1000, peak: Number(err.match(/peak resident (\d+) bytes/)?.[1]) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const write = flag("--write");
  if (write) {
    for (const f of await writeConfigs(write)) console.log(f);
    process.exit(0);
  }
  const digest = flag("--digest");
  if (digest) {
    console.log(logDigest(readFileSync(digest, "utf8")));
    process.exit(0);
  }
  const pin = flag("--pin");
  if (pin) {
    // The results the representation steps must keep (orchestrator/test/representation.test.ts): each town's on this kernel.
    const kernel = flags("--kernel")[0] ?? (await import("../orchestrator/src/kernel")).kernelBinary();
    const dir = mkdtempSync(join(tmpdir(), "oikos-pin-"));
    const files = await writeConfigs(dir);
    const runs = await Promise.all(files.map((f) => runOn(kernel, f, 30, 4)));
    const towns = Object.fromEntries(files.map((f, i) => [f.split("/").pop()!.replace(/\.json$/, ""), { state_hash: runs[i]!.hash, log_sha256: runs[i]!.log }]));
    const commit = flag("--at") ?? Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root }).stdout.toString().trim();
    await Bun.write(pin, JSON.stringify({ "//": `The 30-day results of each town (worlds/town.yaml, worlds/town-1000.yaml; profiles ${PROFILES.join(", ")}) at 4 engine threads, taken at ${commit} by \`bun scripts/same-results.ts --pin ${pin}\`. orchestrator/test/representation.test.ts holds every build to them: a change of representation leaves them byte-identical. A change meant to change results re-takes them, in its own commit, with the reason.`, towns }, null, 1) + "\n");
    rmSync(dir, { recursive: true, force: true });
    console.log(towns);
    process.exit(0);
  }
  const dir = flag("--run");
  const kernels = flags("--kernel");
  if (!dir || kernels.length === 0) throw new Error("usage: --write <dir> | --run <dir> --kernel A [--kernel B] [--runs N] [--days D] [--threads T] [--only REGEX]");
  const runs = Number(flag("--runs") ?? 1), days = Number(flag("--days") ?? 30), threads = Number(flag("--threads") ?? 4);
  const only = new RegExp(flag("--only") ?? ".");
  let differs = false;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && only.test(f)).sort()) {
    let first: Result | undefined;
    for (let i = 0; i < runs; i++) {
      for (const [k, kernel] of kernels.entries()) {
        const r = await runOn(kernel, join(dir, f), days, threads);
        first ??= r;
        const same = r.hash === first.hash && r.log === first.log;
        if (!same) differs = true;
        console.log(`${f.padEnd(22)} ${String.fromCharCode(65 + k)} ${r.hash} ${r.log.slice(0, 16)} wall ${r.wall.toFixed(1)} s user ${r.user.toFixed(1)} s main ${r.main.toFixed(1)} s peak ${(r.peak / 1e6).toFixed(0)} MB${same ? "" : "  DIFFERS"}`);
      }
    }
  }
  process.exit(differs ? 1 : 0);
}
