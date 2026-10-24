#!/usr/bin/env bun
// A fresh worktree made ready quickly: `bun scripts/worktree-warm.ts <worktree-path> [--from DIR] [--no-build]`.
// It clones `node_modules`, `docs/research/cel-check/node_modules` and `kernel/target` from the checkout of this
// repository whose HEAD is nearest the worktree's (fewest commits apart) and that has them, copy-on-write (`cp -c -R`
// on APFS: no time and no disk until a file changes; an ordinary copy elsewhere), leaving alone whatever the worktree
// already has. Then `bun install` and `bun run kernel` run in the worktree, so that whatever differs is rebuilt: the
// clone only saves work, it is never trusted. Cargo keys a workspace crate's build by the crate's own path, so the
// kernel's own crates are always compiled from the worktree's sources (checked by hand, docs/dev-machine.md); what is
// reused is the compiled dependencies. --no-build stops after the clone (for trying that part alone).
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const sh = (cmd: string[], cwd: string) => { const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" }); return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }; };

/** What is cloned, relative to a checkout; the first two are what a source must have to be one. */
const PARTS = ["node_modules", "kernel/target", "docs/research/cel-check/node_modules"];

/** The other checkouts of the worktree's repository that have an install and a built kernel, the nearest HEAD first. */
export function sources(worktree: string): { path: string; head: string; apart: number }[] {
  const head = sh(["git", "rev-parse", "HEAD"], worktree);
  if (!head.ok) throw new Error(`${worktree} is not a git checkout: ${head.err}`);
  const found: { path: string; head: string; apart: number }[] = [];
  let path = "";
  for (const line of sh(["git", "worktree", "list", "--porcelain"], worktree).out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    if (!line.startsWith("HEAD ") || resolve(path) === resolve(worktree)) continue;
    if (!existsSync(join(path, "node_modules")) || !existsSync(join(path, "kernel/target/release/oikos-kernel"))) continue;
    const apart = Number(sh(["git", "rev-list", "--count", `${head.out}...${line.slice(5)}`], worktree).out);
    if (Number.isFinite(apart)) found.push({ path, head: line.slice(5), apart });
  }
  return found.sort((a, b) => a.apart - b.apart || (a.path < b.path ? -1 : 1));
}

/** Clones the parts the worktree lacks from `from`; says what it did. Copy-on-write where the file system can. */
export function clone(from: string, worktree: string, say: (line: string) => void = console.log): void {
  for (const part of PARTS) {
    const src = join(from, part), dst = join(worktree, part);
    if (!existsSync(src)) continue;
    if (existsSync(dst)) { say(`  ${part}: already there, left as it is`); continue; }
    mkdirSync(dirname(dst), { recursive: true });
    const t = performance.now();
    let how = "cloned (copy-on-write)";
    if (!sh(["cp", "-c", "-R", src, dst], worktree).ok) {
      sh(["rm", "-rf", dst], worktree); // (only what the failed clone just began: it was not there before)
      how = "copied";
      const c = sh(["cp", "-R", src, dst], worktree);
      if (!c.ok) throw new Error(`copying ${src} failed: ${c.err}`);
    }
    say(`  ${part}: ${how} in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
}

/** The whole of it: clone from the nearest source (or `from`), then install and build in the worktree. */
export function warm(worktree: string, o: { from?: string; build?: boolean; say?: (line: string) => void } = {}): void {
  const say = o.say ?? console.log;
  const dir = resolve(worktree);
  const from = o.from ? { path: resolve(o.from), apart: NaN } : sources(dir)[0];
  if (from) {
    say(`warming ${dir} from ${from.path}${Number.isNaN(from.apart) ? "" : ` (${from.apart} commit${from.apart === 1 ? "" : "s"} apart)`}`);
    clone(from.path, dir, say);
    dropCachedTowns(dir);
  } else say(`no other checkout has an install and a built kernel: ${dir} is built from nothing`);
  if (o.build === false) return;
  for (const [cmd, cwd] of [[["bun", "install"], dir], [["bun", "install"], join(dir, "docs/research/cel-check")], [["bun", "run", "kernel"], dir]] as const) {
    if (!existsSync(cwd)) continue;
    const t = performance.now();
    const b = Bun.spawnSync([...cmd], { cwd, stdout: "inherit", stderr: "inherit" });
    if (b.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd}`);
    say(`  ${cmd.join(" ")}${cwd === dir ? "" : " (cel-check)"}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
}

/** A generated town cached in the copied build (kernel/target/tmp/*-town.json) was made by the other checkout's generator: not taken (the tests
 * write it again, keyed by the generator's inputs: orchestrator/test/lib/town-key.ts, so a stale one could not be read anyway). */
export function dropCachedTowns(dir: string): number {
  const tmp = join(dir, "kernel/target/tmp");
  if (!existsSync(tmp)) return 0;
  const gone = readdirSync(tmp).filter((f) => /-town\.json(\.key)?$/.test(f));
  for (const f of gone) rmSync(join(tmp, f), { force: true });
  return gone.length;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const from = flag("from");
  const noBuild = args.includes("--no-build");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir || !existsSync(dir)) { console.error("usage: bun scripts/worktree-warm.ts <worktree-path> [--from DIR] [--no-build]"); process.exit(2); }
  warm(dir, { ...(from ? { from } : {}), build: !noBuild });
}
