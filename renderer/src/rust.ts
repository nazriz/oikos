// The Rust data layer as the explorer's backend (`oikos explore --rust`): starts the built `oikos-explore` binary
// (kernel/crates/explore) on 127.0.0.1 with the runs' logs, and hands back the address `serve` proxies `/api/*` to. The
// only process this package ever starts, and only that binary: test/read-only.test.ts checks it. A pilot's viewer data
// (`pilot.json`, made by pilotDataOf without debriefs) is written beside the runs, in the views folder, never inside a run.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertOutside, logOfRun, viewsRoot, type RunEntry } from "./paths";
import { pilotDataOf } from "./server";

const REPO = resolve(import.meta.dir, "..", "..");

/** The built binary: kernel/target/release, else debug (CARGO_TARGET_DIR is honoured). */
export function rustBinary(): string | undefined {
  const dirs = [process.env.CARGO_TARGET_DIR, join(REPO, "kernel", "target")].filter(Boolean) as string[];
  const found = dirs.flatMap((d) => ["release", "gate", "debug"].map((p) => join(d, p, "oikos-explore"))).filter((f) => existsSync(f));
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export interface RustLayer { api: string; stop(): void }

/** Starts the service for `runs`. A pilot's data is made with the existing `pilotDataOf` and given to it. */
/** Does a run have seats (a pilot, or a world run with a post given to a model)? Read from its folder's PILOT.txt and
 * batch.json only: a run with none needs no pilot data, and reading it would hold up the first sight of a big town. */
export function hasSeats(dir: string): boolean {
  if (existsSync(join(dir, "PILOT.txt"))) return true;
  try {
    const b = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
    return (b.sets ?? []).some((x: string) => /=\s*llm\b/.test(x)) || JSON.stringify(b.spec ?? {}).includes('"llm"') || !!b.model;
  } catch { return false; }
}

export async function startRust(runs: RunEntry[], o: { log?: (s: string) => void; bin?: string; withPilots?: boolean; onlySeated?: boolean } = {}): Promise<RustLayer> {
  const bin = o.bin ?? rustBinary();
  if (!bin) throw new Error("oikos-explore is not built: run `cargo build --release -p oikos-explore` in kernel/");
  const say = o.log ?? (() => {});
  const args = ["serve", "--port", "0", "--watch-stdin"];
  for (const r of runs) {
    const log = r.log ?? logOfRun(r.dir);
    let spec = `${r.key}=${log}`;
    if (o.withPilots !== false && (r.pilot || existsSync(join(r.dir, "batch.json"))) && (!o.onlySeated || hasSeats(r.dir))) {
      const out = join(viewsRoot(r.dir), `${r.key}.pilot.json`);
      assertOutside(r.dir, out);
      mkdirSync(dirname(out), { recursive: true });
      say(`${r.name}: reading the pilot's seats`);
      try { writeFileSync(out, JSON.stringify(await pilotDataOf(r.dir, say))); spec += `,pilot=${out}`; }
      catch (e) { say(`${r.name}: the pilot's seats were not read: ${(e as Error).message}`); }
    }
    args.push("--run", spec);
  }
  const child = Bun.spawn([bin, ...args], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const stop = () => { try { child.kill(); } catch { /* (gone) */ } };
  process.on("exit", stop);
  // (the first line it prints is its address)
  const reader = child.stdout.getReader();
  let text = "";
  for (let i = 0; i < 200 && !text.includes("\n"); i++) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  const m = /http:\/\/127\.0\.0\.1:\d+/.exec(text);
  if (!m) { stop(); throw new Error(`oikos-explore did not start: ${text.trim() || "no output"}`); }
  say(`data layer: ${m[0]} (${bin})`);
  return { api: m[0], stop };
}
