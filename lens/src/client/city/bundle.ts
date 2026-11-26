#!/usr/bin/env bun
// Dev only: run the city's folds (town, people) over a JSONL log and write their bundle files, as the ingest will:
//   bun lens/src/client/city/bundle.ts <log.jsonl | - for stdin> <out dir>
// Writes <out>/town.json, <out>/people.json, <out>/people.<file>.bin (with --all, every registered fold's files). Never writes beside the log (Lens is read-only).
// Reports the time spent inside the folds apart from reading and parsing, which is the ingest's.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { townFold } from "../../folds/town";
import { peopleFold } from "../../folds/people";
import type { Fold, FoldContext } from "../../shared/fold";

export async function bundleLog(log: string, out: string, folds: Fold[] = [townFold(), peopleFold()]): Promise<{ lines: number; foldMs: number; totalMs: number }> {
  const ctx: FoldContext = { runId: "", dir: "" };
  const t0 = performance.now();
  let foldMs = 0, lines = 0;
  let buf = "";
  const take = (line: string) => {
    if (!line) return;
    const l = JSON.parse(line);
    lines++;
    const a = performance.now();
    for (const f of folds) f.line(l, ctx);
    foldMs += performance.now() - a;
  };
  if (log.endsWith(".zst") || log.endsWith(".oklog")) {
    // Compressed logs and experiment forks, through the orchestrator's reader (zstd; the kernel's export).
    const { logLines } = await import("../../../../orchestrator/src/logs");
    for await (const line of logLines(log)) take(line);
  } else {
    const stream = (log === "-" ? Bun.stdin.stream() : Bun.file(log).stream()).pipeThrough(new TextDecoderStream());
    for await (const chunk of stream) {
      buf += chunk;
      let i, start = 0;
      while ((i = buf.indexOf("\n", start)) >= 0) { take(buf.slice(start, i)); start = i + 1; }
      buf = buf.slice(start);
    }
    take(buf);
  }
  mkdirSync(out, { recursive: true });
  const a = performance.now();
  for (const f of folds) {
    const r = await f.finish(ctx);
    writeFileSync(join(out, `${f.name}.json`), JSON.stringify(r.json));
    for (const [k, v] of Object.entries(r.files ?? {})) writeFileSync(join(out, `${f.name}.${k}.bin`), v);
  }
  foldMs += performance.now() - a;
  return { lines, foldMs, totalMs: performance.now() - t0 };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [log, out] = args.filter((a) => !a.startsWith("--"));
  if (!log || !out) { console.log("usage: bun lens/src/client/city/bundle.ts <log.jsonl> <out dir> [--all (every registered fold, for the tour)]"); process.exit(2); }
  const folds = args.includes("--all") ? (await import("../../server/folds")).FOLDS.map((f) => f()) : undefined;
  const r = await bundleLog(log, out, folds);
  console.log(`${r.lines} lines; folds ${(r.foldMs / 1000).toFixed(2)} s of ${(r.totalMs / 1000).toFixed(1)} s`);
}
