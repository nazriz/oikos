// Run logs on disk: plain (`<run>.jsonl`, as the kernel writes them) or compressed after the run (`<run>.jsonl.zst`,
// about a seventh the size: docs/reliability.md). Everything that reads a log reads either.
//
// A run that was resumed leaves what it resumed beside it, as `<run>.stopped-<n>.jsonl`: history, kept for ever, and
// never read as a run of its own (its answers are in the resumed log too: counted twice, they'd be duplicated training
// data). Whatever reads a folder takes each run once, its current log; a stopped log is read only when named.

import { closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

const STOPPED = /\.stopped-\d+\.jsonl(\.zst)?$/;

/** Is this file a log a resumed run left behind (`<run>.stopped-<n>.jsonl`, plain or compressed)? */
export const isStoppedLog = (file: string) => STOPPED.test(file);

/** Is this file a run's current log (not its anchors, not a derived file, not what a resumed run left behind)? */
/** The file beside a run's log that holds what its seats said in their debriefs (VISION 15, point 7): kept with the
 * run for ever, as the log is, and never published as it stands, since it holds what seats asked to be kept back. */
export const debriefsBeside = (log: string) => log.replace(/\.jsonl(\.zst)?$/, ".debriefs.jsonl");

/** The file beside a run's log that holds its citizens' decisions, captured for training (docs/citizen-data.md). */
export const citizensBeside = (log: string) => log.replace(/\.jsonl(\.zst)?$/, ".citizens.jsonl.zst");

export const isLog = (file: string) => (file.endsWith(".jsonl") || file.endsWith(".jsonl.zst")) && !/\.debriefs\.jsonl$/.test(file) && !/\.citizens\.jsonl\.zst$/.test(file) && !/\.anchors\.jsonl(\.zst)?$/.test(file) && !/translator-corpus\.jsonl$/.test(file) && !isStoppedLog(file);

/** A run's id from its log file's name. */
export const runOf = (file: string) => file.split("/").at(-1)!.replace(/\.jsonl(\.zst)?$/, "");

/** The runs in a folder, each once: its current log (the plain one, where a run has both), in name order. */
export function currentLogs(dir: string): string[] {
  const files = readdirSync(dir).filter(isLog);
  const plain = new Set(files.filter((f) => f.endsWith(".jsonl")));
  return files.filter((f) => f.endsWith(".jsonl") || !plain.has(f.slice(0, -".zst".length))).sort().map((f) => join(dir, f));
}

/** Every log a folder holds for a run: its current one (plain, compressed) and any a resumed run left behind. */
export function logsOf(dir: string, runId: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f === `${runId}.jsonl` || f === `${runId}.jsonl.zst` || (f.startsWith(`${runId}.stopped-`) && isStoppedLog(f))).sort().map((f) => join(dir, f));
}

/** A log's lines, one at a time (a log can be gigabytes). */
export function logLines(path: string): AsyncIterable<string> {
  const raw = createReadStream(path);
  const input = path.endsWith(".zst") ? raw.pipe(zlib.createZstdDecompress()) : raw;
  return createInterface({ input, crlfDelay: Infinity });
}

/** A log's whole text (for tools that need it all at once: a resume, a story). */
export function readLog(path: string): string {
  return path.endsWith(".zst") ? Buffer.from(zlib.zstdDecompressSync(readFileSync(path))).toString("utf8") : readFileSync(path, "utf8");
}

/**
 * The model a log's answers came from, if any of them came from a real one ("provider/model"): such a log can't be
 * made again, and it's training data, so nothing may ever write over it. The mock's answers, and a log with no model
 * calls, can be regenerated. A log that can't be read to its end is judged on what can be read.
 */
export async function realModelIn(path: string): Promise<string | undefined> {
  try {
    for await (const line of logLines(path)) {
      if (!line.includes('"annotation":"usage"') && !line.includes('"annotation":"transcript"') && !line.includes('"annotation":"model_call_failed"')) continue;
      let b: any;
      try {
        b = JSON.parse(line).body;
      } catch {
        continue; // (a last line cut off as the process ended)
      }
      const provider = b?.provider ?? b?.data?.provider;
      // (Our own trained translator, `decide`, answers from files on disk without sampling: what it said can be made
      // again, as the mock's can. A pilot's log holds its seats' answers too, and those are what is kept.)
      if (typeof provider === "string" && provider !== "mock" && provider !== "decide") return `${provider}/${b?.model ?? b?.data?.model ?? "?"}`;
    }
  } catch (e) {
    // A compressed log cut short: what was read held no real model's answer, but the rest can't be vouched for.
    return `unreadable (${(e as Error).message})`;
  }
  return undefined;
}

/**
 * Before a fresh run writes into a folder: runs are never overwritten. If the folder already holds a log for this run
 * (plain, compressed, or left by a resume), the run doesn't start, and says what's there. `overwrite` is the deliberate
 * exception, for tests that run again into their own folders: the old run's files go, unless any of its logs holds a
 * real model's answers, which nothing overwrites.
 */
export async function clearForFreshRun(dir: string, runId: string, overwrite = false): Promise<void> {
  const logs = logsOf(dir, runId);
  const recipe = join(dir, `${runId}.recipe.json`);
  const held = logs[0] ?? (existsSync(recipe) ? recipe : undefined);
  if (held && !overwrite)
    throw new Error(`${held} exists: this run is already in ${dir}, and runs are never overwritten. Choose another --out${logs.length ? `, or resume it (oikos resume ${logs.find((l) => !isStoppedLog(l)) ?? logs[0]})` : ""}.`);
  for (const log of logs) {
    const real = await realModelIn(log);
    if (real) throw new Error(`${log} holds a real model's answers (${real}): it is never overwritten, whatever was asked. Choose another --out.`);
  }
  // (Overwriting, or nothing there: what describes a log that's gone, or never was, goes with it.)
  for (const f of [...logs, recipe]) rmSync(f, { force: true });
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (new RegExp(`^${runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.stopped-\\d+)?\\.(anchors\\.jsonl|summary\\.json|failure\\.json|citizens\\.jsonl\\.zst)$`).test(f)) rmSync(join(dir, f), { force: true });
}

const sha256OfStream = async (stream: AsyncIterable<Buffer | string>): Promise<{ hash: string; bytes: number }> => {
  const h = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    h.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { hash: h.digest("hex"), bytes };
};

/** How much of a log is read at a time when the whole of it is wanted (compressing it, hashing it). */
const BIG = { highWaterMark: 4 << 20 };

/** Make sure a file's bytes, and its name in its folder, are on the disk (not only in the system's memory). */
function sync(path: string): void {
  for (const p of [path, dirname(path)]) {
    const fd = openSync(p, "r");
    try {
      fsyncSync(fd);
    } catch {
      // (a folder can't be synced everywhere; the file itself was)
    } finally {
      closeSync(fd);
    }
  }
}

/**
 * Compress a finished log in place (`.jsonl` -> `.jsonl.zst`). The plain log goes only once the compressed one has been
 * read back and is the same, byte for byte (by hash, not only by length), and is on the disk.
 */
export async function compressLog(path: string): Promise<string> {
  if (path.endsWith(".zst") || !existsSync(path)) return path;
  const out = `${path}.zst`;
  const tmp = `${out}.partial`;
  // (The plain log is hashed while it's compressed: its own reading of the file, as before, side by side with the
  // compressor's instead of after it. Read and written a few megabytes at a time: a gigabyte in 64 KB pieces spends as
  // long handing them on as compressing them. The compressed bytes are the same either way.)
  const [, original] = await Promise.all([
    pipeline(createReadStream(path, BIG), zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 }, chunkSize: 1 << 20 }), createWriteStream(tmp)),
    sha256OfStream(createReadStream(path, BIG)),
  ]);
  let back: { hash: string; bytes: number } | undefined;
  let why = "";
  try {
    back = await sha256OfStream(createReadStream(tmp, BIG).pipe(zlib.createZstdDecompress({ chunkSize: 4 << 20 })));
  } catch (e) {
    why = `: ${(e as Error).message}`;
  }
  if (!back || back.hash !== original.hash || back.bytes !== original.bytes) {
    rmSync(tmp, { force: true });
    throw new Error(`${path}: the compressed log didn't read back the same (${back?.bytes ?? 0} of ${original.bytes} bytes${back && back.bytes === original.bytes ? ", different content" : ""}${why}); kept the plain one`);
  }
  sync(tmp);
  renameSync(tmp, out);
  sync(out);
  rmSync(path);
  return out;
}

/** A compressed log written out plain beside it (`.jsonl.zst` -> `.jsonl`), the compressed one kept. For a resume: the
 * kernel, and the reading of recorded answers, take plain logs. */
export async function decompressLog(path: string): Promise<string> {
  if (!path.endsWith(".zst")) return path;
  const out = path.slice(0, -".zst".length);
  if (existsSync(out)) throw new Error(`${out} exists beside ${path}: which is the run's log? Name the plain one, or move one of them away.`);
  const tmp = `${out}.partial`;
  await pipeline(createReadStream(path), zlib.createZstdDecompress(), createWriteStream(tmp));
  sync(tmp);
  renameSync(tmp, out);
  return out;
}
