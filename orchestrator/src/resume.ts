// Resuming a run that stopped (D59): a stall, a crash, a killed process, or a run cut short.
//
// Code is deterministic and every model response is in the log, so a run is resumed by running it again from the
// start with the log's own config, serving each model call its recorded response (checked against the recording:
// the same system prompt and the same last message). Up to where it stopped, the resumed run reproduces the old one
// exactly, and costs nothing new; from there it goes on with the live model. If a request ever differs from its
// recording (the code changed in between, say), serving stops and every later call goes to the live model, and the
// log says from where.

import { closeSync, existsSync, openSync, readSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonical } from "@oikos/participants";
import type { ContentBlock, LlmAdapter, LlmRequest, LlmResponse } from "@oikos/participants/llm";

interface Recorded {
  systemSha256: string;
  input: string;
  output: ContentBlock[];
  usage: LlmResponse["usage"];
  /** The recording said its token counts were estimated (the mock's are). */
  estimated?: boolean;
  provider: string;
  model: string;
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
/** The log stores annotations in canonical JSON (keys sorted), so recordings are compared in that form. */
const same = (a: unknown, b: unknown) => canonical(a ?? "") === canonical(b ?? "");

/**
 * A log's lines, one at a time, read in chunks: a long code-only run's log is gigabytes, more than a string can hold.
 * `fn` returns false to stop early.
 */
export function eachLine(path: string, fn: (line: string) => boolean | void): void {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(16 * 1024 * 1024);
  const dec = new TextDecoder();
  let carry = "";
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      const text = carry + dec.decode(buf.subarray(0, n), { stream: n > 0 });
      const lines = text.split("\n");
      carry = n > 0 ? lines.pop()! : "";
      for (const line of lines) if (fn(line) === false) return;
      if (n === 0) {
        if (carry) fn(carry);
        return;
      }
    }
  } finally {
    closeSync(fd);
  }
}

/** Every model call a log recorded, by subject and purpose, in order: its usage and its transcript, paired. */
export function recordedCalls(logPath: string): Map<string, Recorded[]> {
  const calls = new Map<string, Recorded[]>();
  const usage = new Map<string, any[]>(); // a call's usage, waiting for its transcript (same subject)
  let cut = false;
  eachLine(logPath, (line) => {
    if (cut || !line.trim() || !line.includes('"kind":"annotation"')) return;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      cut = true; // a last line cut off as the process ended
      return false;
    }
    const a = e.body;
    if (a.annotation === "usage") usage.set(a.subject, [...(usage.get(a.subject) ?? []), a]);
    if (a.annotation === "transcript") {
      const u = usage.get(a.subject)?.shift();
      if (!u) return;
      // (A call made for something in particular, a draft's translation, is found by it: translations in a round are
      // made at once, and a second attempt at one may come back before or after another's.)
      const key = `${a.subject}|${a.data.purpose}${a.data.ref ? `|${a.data.ref}` : ""}`;
      calls.set(key, [...(calls.get(key) ?? []), {
        systemSha256: a.data.system_sha256, input: a.data.input, output: a.data.output, provider: a.data.provider, model: a.data.model,
        ...(a.data.usage_estimated ? { estimated: true } : {}),
        usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, ...(u.cache_read_tokens !== undefined ? { cache_read_tokens: u.cache_read_tokens } : {}), ...(u.cache_write_tokens !== undefined ? { cache_write_tokens: u.cache_write_tokens } : {}) },
      }]);
    }
  });
  return calls;
}

/** Serves recorded responses while requests match their recordings; after the first that doesn't (or once they run
 * out), every call goes to the live adapter. Shared by the participants' and the translator's adapters. */
export class Serving {
  served = 0;
  /** Where serving stopped because a request differed from its recording, if it did. */
  diverged?: { subject: string; purpose: string; call: number };
  private next = new Map<string, number>();
  constructor(private readonly calls: Map<string, Recorded[]>) {}

  /** The live adapter, with recorded responses served first. */
  wrap(live: LlmAdapter): LlmAdapter {
    return {
      provider: live.provider,
      model: live.model,
      complete: async (req: LlmRequest): Promise<LlmResponse> => {
        const key = `${req.subject}|${req.purpose}${req.ref ? `|${req.ref}` : ""}`;
        const i = this.next.get(key) ?? 0;
        const r = this.diverged ? undefined : this.calls.get(key)?.[i];
        if (r) {
          const matches = r.provider === live.provider && r.model === live.model && r.systemSha256 === sha256(req.system) && same(r.input, req.messages.at(-1)?.content);
          if (matches) {
            this.next.set(key, i + 1);
            this.served++;
            return { content: r.output, usage: r.usage, ...(r.estimated ? { estimated: true } : {}) };
          }
          this.diverged = { subject: req.subject, purpose: req.purpose, call: i + 1 };
        }
        return live.complete(req);
      },
    };
  }
}

/** A log's run id and config (the header), and where its files are. The old files are kept, renamed
 * `<run>.stopped-<n>.*`, and the resumed run is written in their place. */
export function prepareResume(logPath: string): { runId: string; config: any; outDir: string; stoppedLog: string; consult: boolean; consultAvoid?: string[] } {
  // The header, and whether the run asked the sparse mind and what it left out (its note, near the start: run.ts).
  let first = "";
  let noteLine: string | undefined;
  let lines = 0;
  eachLine(logPath, (l) => {
    if (lines++ === 0) first = l;
    else if (l.includes('"annotation":"note"') && l.includes('"consult":{')) noteLine = l;
    return lines < 200 && !noteLine;
  });
  const consult = !!noteLine;
  const consultAvoid: string[] | undefined = noteLine ? JSON.parse(noteLine).body?.data?.consult?.avoid : undefined;
  const header = JSON.parse(first);
  if (header.kind !== "header") throw new Error(`${logPath} doesn't start with a run header`);
  const runId: string = header.body.run_id;
  const outDir = dirname(logPath);
  if (basename(logPath) !== `${runId}.jsonl`) throw new Error(`${logPath}: expected the log to be named ${runId}.jsonl`);
  let n = 1;
  while (existsSync(join(outDir, `${runId}.stopped-${n}.jsonl`))) n++;
  const stoppedLog = join(outDir, `${runId}.stopped-${n}.jsonl`);
  renameSync(logPath, stoppedLog);
  for (const ext of ["anchors.jsonl", "failure.json", "summary.json"]) {
    const f = join(outDir, `${runId}.${ext}`);
    if (existsSync(f)) renameSync(f, join(outDir, `${runId}.stopped-${n}.${ext}`));
  }
  return { runId, config: header.body.config, outDir, stoppedLog, consult, ...(consultAvoid ? { consultAvoid } : {}) };
}
