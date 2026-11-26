// Where Lens reads and writes. It reads under the runs folder and writes only under its views folder (docs/design/lens.md
// section 2): `--runs` / OIKOS_RUNS (default ~/oikos/runs), `OIKOS_VIEWS` (default <runs>/views/lens).
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { kernelBinary } from "../../../orchestrator/src/kernel";

export interface LensPaths {
  runs: string;
  views: string;
}

export function lensPaths(o: { runs?: string; views?: string } = {}): LensPaths {
  const runs = resolve(o.runs ?? process.env.OIKOS_RUNS ?? join(homedir(), "oikos", "runs"));
  const views = resolve(o.views ?? process.env.OIKOS_VIEWS ?? join(runs, "views", "lens"));
  return { runs, views };
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** The kernel binary that exports an .oklog: the repo's own (or OIKOS_KERNEL), else the main checkout's (a worktree
 * often has no build of its own). */
export function kernelPath(): string {
  try {
    return kernelBinary();
  } catch {
    const p = join(homedir(), "oikos", "kernel", "target", "release", "oikos-kernel");
    if (existsSync(p)) return p;
    throw new Error("kernel binary not found: build it (bun run kernel) or set OIKOS_KERNEL");
  }
}
