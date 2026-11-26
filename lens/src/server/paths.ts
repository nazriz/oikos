// Where Lens reads and writes. It reads under the runs folder and writes only under its views folder, its cache
// (docs/design/lens.md section 2): `--runs` / OIKOS_RUNS (default ~/oikos/runs), `--views` / OIKOS_VIEWS (default
// ~/oikos-lens-cache). The cache is never inside the runs folder: nothing under runs/ is ever deleted (Naz's rule), and
// Lens deletes its own superseded bundles, so they live elsewhere (docs/decisions.md, "Lens's cache lives outside
// runs/, so the never-delete rule is kept"). Lens refuses a views folder inside runs/, and any deletion outside it.
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { kernelBinary } from "../../../orchestrator/src/kernel";

export interface LensPaths {
  runs: string;
  views: string;
}

export function lensPaths(o: { runs?: string; views?: string } = {}): LensPaths {
  const runs = resolve(o.runs ?? process.env.OIKOS_RUNS ?? join(homedir(), "oikos", "runs"));
  const views = resolve(o.views ?? process.env.OIKOS_VIEWS ?? join(homedir(), "oikos-lens-cache"));
  return checkPaths({ runs, views });
}

/** A path as it really is (links followed), as far as it exists. */
const real = (p: string): string => {
  const a = resolve(p);
  try {
    return realpathSync(a);
  } catch {
    const up = resolve(a, "..");
    return up === a ? a : join(real(up), a.slice(up.length + 1));
  }
};
/** Whether `p` is `dir` or inside it. */
export const within = (p: string, dir: string): boolean => {
  const a = real(p), d = real(dir);
  return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep);
};

/** The paths, refused when the views folder is inside the runs folder. */
export function checkPaths(p: LensPaths): LensPaths {
  if (within(p.views, p.runs))
    throw new Error(`Lens's views folder ${p.views} is inside the runs folder ${p.runs}. Lens deletes its own old files, and nothing under runs/ may be deleted: set --views / OIKOS_VIEWS outside it (default ~/oikos-lens-cache).`);
  return p;
}

/** Delete a file or folder of Lens's own: refused unless it is inside the views folder (and not the folder itself). */
export function removeOwn(views: string, path: string): void {
  if (!within(path, views) || real(path) === real(views)) throw new Error(`Lens refuses to delete ${path}: it is not inside its views folder ${views}`);
  rmSync(path, { recursive: true, force: true });
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
