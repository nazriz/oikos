// The whole test suite, with the test files run side by side (each town a test simulates uses one core): `bun run
// test:all`, or `bun scripts/test.ts [--jobs N] [--fast] [filter...]`. The kernel's tests first (cargo, already
// parallel), then every *.test.ts in its own `bun test`, the slowest first, N at a time. A file that fails prints what
// it said. `--fast` leaves out the files that simulate towns (FAST below lists what stays in).

import { Glob } from "bun";
import { cpus } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const jobs = Number(flag("jobs") ?? Math.max(2, cpus().length - 2));
const fast = args.includes("--fast") && (args.splice(args.indexOf("--fast"), 1), true);
const filters = args;

// How long each file took last time (kept beside this script): the slowest go first, so the run ends when they do.
const timesPath = join(import.meta.dir, "test-times.json");
const times: Record<string, number> = existsSync(timesPath) ? JSON.parse(readFileSync(timesPath, "utf8")) : {};
/** A file is fast if it took under this long last time (never timed: slow, until it has been). */
const FAST_SECONDS = 10;

const files = [...new Glob("**/*.test.ts").scanSync({ cwd: root })]
  .filter((f) => !f.includes("node_modules") && !f.startsWith("runs/") && !f.startsWith("kernel/target"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .filter((f) => !fast || (times[f] ?? Infinity) < FAST_SECONDS)
  .sort((a, b) => (times[b] ?? 1e9) - (times[a] ?? 1e9) || (a < b ? -1 : 1));

const t0 = performance.now();
let failed = 0;
if (!filters.length) {
  const k = Bun.spawnSync(["cargo", "test", "--release", "--manifest-path", "kernel/Cargo.toml", "--workspace", "-q"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = k.stdout.toString() + k.stderr.toString();
  const ok = k.exitCode === 0;
  console.log(`${ok ? "ok  " : "FAIL"} kernel (cargo test) ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) { failed++; console.log(out.split("\n").filter((l) => /FAILED|panicked|error/.test(l)).slice(0, 40).join("\n")); }
}

let pass = 0, fail = 0, next = 0;
const bad: string[] = [];
async function worker() {
  for (;;) {
    const f = files[next++];
    if (!f) return;
    const s = performance.now();
    const p = Bun.spawn(["bun", "test", f], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "test" } });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const text = out + err;
    const secs = (performance.now() - s) / 1000;
    times[f] = Math.round(secs * 10) / 10;
    pass += Number(/^\s*(\d+) pass/m.exec(text)?.[1] ?? 0);
    const n = Number(/^\s*(\d+) fail/m.exec(text)?.[1] ?? (code === 0 ? 0 : 1));
    fail += n;
    console.log(`${code === 0 ? "ok  " : "FAIL"} ${f} ${secs.toFixed(0)}s`);
    if (code !== 0) { failed++; bad.push(`\n== ${f}\n${text.split("\n").filter((l) => !/^\s*$/.test(l)).slice(-60).join("\n")}`); }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
if (!filters.length && !fast) writeFileSync(timesPath, JSON.stringify(Object.fromEntries(Object.entries(times).sort()), null, 1) + "\n");
for (const b of bad) console.log(b);
console.log(`\n${pass} pass, ${fail} fail across ${files.length} files, ${jobs} at a time, in ${((performance.now() - t0) / 1000).toFixed(0)}s${fast ? " (fast tier)" : ""}`);
process.exit(failed ? 1 : 0);
