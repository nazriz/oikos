// A log's lines, read once, in batches (a fork exports 4.6 million lines; one await per line would cost more than the
// parse). An .oklog is read as the kernel exports it (`oikos-kernel export <file>` to stdout); a .jsonl as it is; a
// .jsonl.zst through zstd. Only read: nothing is written anywhere.
import { createReadStream } from "node:fs";
import zlib from "node:zlib";
import { kernelPath } from "./paths";

export interface Progress {
  /** Bytes of the file itself read so far (plain and compressed logs; 0 for an export, whose size isn't known). */
  fileBytes: number;
}

async function* bytesOf(path: string, progress: Progress): AsyncGenerator<Uint8Array> {
  if (path.endsWith(".oklog")) {
    const p = Bun.spawn([kernelPath(), "export", path], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    try {
      for await (const chunk of p.stdout) yield chunk;
      const code = await p.exited;
      if (code !== 0) throw new Error(`oikos-kernel export ${path} exited ${code}: ${(await new Response(p.stderr).text()).slice(0, 400)}`);
    } finally {
      if (p.exitCode === null) p.kill();
    }
    return;
  }
  const raw = createReadStream(path, { highWaterMark: 1 << 20 });
  raw.on("data", (c) => (progress.fileBytes += (c as Buffer).length));
  const input = path.endsWith(".zst") ? raw.pipe(zlib.createZstdDecompress({ chunkSize: 1 << 20 })) : raw;
  for await (const chunk of input) yield chunk as Uint8Array;
}

/** The log's lines in batches, in order. The last line may lack its newline. */
export async function* lineBatches(path: string, progress: Progress = { fileBytes: 0 }): AsyncGenerator<string[]> {
  const dec = new TextDecoder();
  // (A line longer than a chunk, the header's 33 MB of config above all, is gathered in pieces and joined once: adding
  // each chunk to it and splitting again would read it hundreds of times.)
  let pieces: string[] = [];
  for await (const chunk of bytesOf(path, progress)) {
    const s = dec.decode(chunk, { stream: true });
    const nl = s.indexOf("\n");
    if (nl < 0) {
      pieces.push(s);
      continue;
    }
    const lines = s.split("\n");
    const tail = lines.pop()!;
    if (pieces.length) {
      pieces.push(lines[0]!);
      lines[0] = pieces.join("");
    }
    pieces = tail ? [tail] : [];
    yield lines;
  }
  pieces.push(dec.decode());
  const last = pieces.join("");
  if (last.length) yield [last];
}
