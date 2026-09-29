// Run logs on disk: plain (`<run>.jsonl`, as the kernel writes them) or compressed after the run (`<run>.jsonl.zst`,
// about a seventh the size: docs/reliability.md). Everything that reads a log reads either.

import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/** Is this file a run log (not its anchors, not a derived file)? */
export const isLog = (file: string) => (file.endsWith(".jsonl") || file.endsWith(".jsonl.zst")) && !/\.anchors\.jsonl(\.zst)?$/.test(file) && !/translator-corpus\.jsonl$/.test(file);

/** A run's id from its log file's name. */
export const runOf = (file: string) => file.split("/").at(-1)!.replace(/\.jsonl(\.zst)?$/, "");

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

/** Compress a finished log in place (`.jsonl` -> `.jsonl.zst`), checking it reads back whole before the plain one goes. */
export async function compressLog(path: string): Promise<string> {
  if (path.endsWith(".zst") || !existsSync(path)) return path;
  const out = `${path}.zst`;
  const tmp = `${out}.partial`;
  await pipeline(createReadStream(path), zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } }), createWriteStream(tmp));
  // Read it back: the same number of bytes as the original, or the plain log stays.
  let n = 0;
  for await (const chunk of createReadStream(tmp).pipe(zlib.createZstdDecompress())) n += (chunk as Buffer).length;
  if (n !== statSync(path).size) {
    rmSync(tmp, { force: true });
    throw new Error(`${path}: the compressed log didn't read back whole (${n} of ${statSync(path).size} bytes); kept the plain one`);
  }
  renameSync(tmp, out);
  rmSync(path);
  return out;
}
