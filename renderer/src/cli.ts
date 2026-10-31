// `oikos explore <run-dir> [--port N] [--prefix /explore]`: index a run once (beside the runs, never inside one) and
// serve the explorer on 127.0.0.1. `oikos explore --all [--runs DIR] [more run dirs...]`: every run with a pilot, picked in
// the page, each indexed when first opened. `oikos explore index <run-dir> [--rebuild]`: the index only.
// `--rust` (with either): the built Rust data layer (kernel/crates/explore) answers the API instead of the TS index.
// `--engine bevy`: the Bevy explorer (explorer/; built by `bun explorer/build.ts`) instead of the Three.js one; it implies
// `--rust`.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pilotRuns, type RunEntry } from "./paths";
import { startRust } from "./rust";
import { openIndex, serve } from "./server";

const REPO = resolve(import.meta.dir, "..", "..");

/** The repo's `runs/`; from a worktree, the main checkout's (runs are never in git). */
function defaultRuns(): string {
  const here = join(REPO, "runs");
  if (existsSync(here)) return here;
  // (A worktree's .git is a file naming its git dir, <main>/.git/worktrees/<name>: read, not asked of git.)
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(REPO, ".git"), "utf8"))?.[1]?.trim();
    const m = gitdir ? /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir) : null;
    if (m) return join(m[1]!, "runs");
  } catch { /* (not a worktree) */ }
  return here;
}

export async function runExplore(argv: string[]): Promise<void> {
  const args = [...argv];
  const take = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const has = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
  const port = Number(take("port") ?? 4321), prefix = take("prefix") ?? "", runsDir = resolve(take("runs") ?? process.env.OIKOS_RUNS ?? defaultRuns());
  const engine = take("engine") ?? "three";
  if (engine !== "three" && engine !== "bevy") throw new Error(`--engine is three (the default) or bevy, not ${engine}`);
  // (the Bevy explorer streams tracks by window and reads the Rust data layer: it never re-indexes in TS)
  const all = has("all"), rebuild = has("rebuild"), rust = has("rust") || engine === "bevy";
  const say = (s: string) => console.error(s);
  if (args[0] === "index") {
    const dir = args[1];
    if (!dir || !existsSync(dir)) throw new Error("usage: oikos explore index <run-dir> [--rebuild]");
    const [entry] = pilotRuns("/nonexistent", [dir]);
    if (!entry) throw new Error(`no run log in ${dir}`);
    const { dir: out, store } = await openIndex(entry, { log: say, rebuild });
    console.log(`${out}\n${store.meta.kept.toLocaleString()} lines kept of ${store.meta.lines.toLocaleString()}; ${store.meta.persons} people, ${store.meta.days} days; ${store.meta.seconds.total} s`);
    store.close();
    return;
  }
  let runs: RunEntry[], single: string | undefined;
  if (all) { runs = pilotRuns(runsDir, args.filter((a) => existsSync(a))); single = (runs.find((r) => r.pilot && !/^test-/.test(r.name)) ?? runs.find((r) => r.pilot))?.key; } // (opens on the newest pilot; the list is a click away)
  else {
    if (!args[0] || !existsSync(args[0])) throw new Error("usage: oikos explore <run-dir> [--port N] [--prefix /explore] | --all [--runs DIR] | index <run-dir>");
    runs = pilotRuns("/nonexistent", [args[0]]);
    if (!runs.length) throw new Error(`no run log in ${args[0]}`);
    single = runs[0]!.key;
    if (rebuild) await openIndex(runs[0]!, { log: say, rebuild: true });
  }
  // (--rust: the Rust data layer answers /api; the TS index is not built. Default until the cut-over: the TS index.)
  // (the Bevy explorer shows a big town at once: a run with no seats is not read for pilot data first)
  const layer = rust ? await startRust(runs, { log: say, onlySeated: engine === "bevy" }) : undefined;
  const { url } = await serve({ port, prefix: prefix.replace(/\/+$/, ""), runs, single, log: say, api: layer?.api, engine });
  console.log(`explorer: ${url}${single ? "" : ` (${runs.length} runs)`}`);
}

if (import.meta.main) await runExplore(process.argv.slice(2));
