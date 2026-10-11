// Resuming a run that stopped (D59): a stall, a crash, a killed process, or a run cut short.
//
// Code is deterministic and every model response is in the log, so a run is resumed by running it again from the
// start with the log's own config, serving each model call its recorded response (checked against the recording:
// the same system prompt and the same last message). Up to where it stopped, the resumed run reproduces the old one
// exactly, and costs nothing new; from there it goes on with the live model. If a request ever differs from its
// recording (the code changed in between, say), serving stops and every later call goes to the live model, and the
// log says from where.
//
// A call that failed and was recovered in place (its participant waited that wake) is part of what happened: the log
// records it (a model_call_failed annotation), and the resumed run is served it as a failure at the same point. The
// exception is the round the run stopped in: a run that stopped because the model couldn't be reached would stop there
// again if it were served those failures, so its stop note says how many calls failed in that round, and those are
// asked again.

import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonical } from "@oikos/participants";
import { ModelCallFailed, type ContentBlock, type LlmAdapter, type LlmRequest, type LlmResponse } from "@oikos/participants/llm";
import { currentLogs, debriefsBeside, decompressLog, runOf } from "./logs";

interface Recorded {
  systemSha256: string;
  input: string;
  output: ContentBlock[];
  usage: LlmResponse["usage"];
  /** The recording said its token counts were estimated (the mock's are). */
  estimated?: boolean;
  provider: string;
  model: string;
  /** The call failed (a model_call_failed annotation): the error, in the words the log has. */
  failed?: string;
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
  // (A debrief's answers are kept in a file beside the log, the log holding their digests: read from there.)
  const apart = new Map<string, ContentBlock[]>();
  const beside = debriefsBeside(logPath);
  if (existsSync(beside)) eachLine(beside, (line) => { if (!line.trim()) return; try { const x = JSON.parse(line); if (x.kind === "call") apart.set(`${x.subject}|${x.ref}|${x.sha256}`, x.output); } catch { /* (a last line cut off) */ } });
  const failures: { key: string; r: Recorded }[] = []; // the calls that failed, in the log's order
  let askAgain = 0; // how many of the last of them the run's stop note says to ask again
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
    if (a.annotation === "note" && a.subject === "orchestrator" && a.data?.stopped) askAgain = Number(a.data.failed_calls_to_ask_again ?? 0);
    if (a.annotation === "model_call_failed") {
      const key = `${a.subject}|${a.data.purpose}${a.data.ref ? `|${a.data.ref}` : ""}`;
      const r: Recorded = { systemSha256: a.data.system_sha256, input: a.data.input, output: [], usage: { input_tokens: 0, output_tokens: 0 }, provider: a.data.provider, model: a.data.model, failed: String(a.data.error) };
      calls.set(key, [...(calls.get(key) ?? []), r]);
      failures.push({ key, r });
    }
    if (a.annotation === "transcript") {
      const u = usage.get(a.subject)?.shift();
      if (!u) return;
      // (An answer kept apart and not found there cannot be served: that call is asked anew.)
      const output = a.data.output_apart ? apart.get(`${a.subject}|${a.data.ref ?? ""}|${a.data.output_sha256}`) : a.data.output;
      if (output === undefined) return;
      // (A call made for something in particular, a draft's translation, is found by it: translations in a round are
      // made at once, and a second attempt at one may come back before or after another's.)
      const key = `${a.subject}|${a.data.purpose}${a.data.ref ? `|${a.data.ref}` : ""}`;
      calls.set(key, [...(calls.get(key) ?? []), {
        systemSha256: a.data.system_sha256, input: a.data.input, output, provider: a.data.provider, model: a.data.model,
        ...(a.data.usage_estimated ? { estimated: true } : {}),
        usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, ...(u.cache_read_tokens !== undefined ? { cache_read_tokens: u.cache_read_tokens } : {}), ...(u.cache_write_tokens !== undefined ? { cache_write_tokens: u.cache_write_tokens } : {}) },
      }]);
    }
  });
  // The failures of the round the run stopped in aren't served: the model is asked again (see the top of this file).
  for (const { key, r } of askAgain > 0 ? failures.slice(-askAgain) : []) calls.set(key, calls.get(key)!.filter((x) => x !== r));
  return calls;
}

/** Serves recorded responses while requests match their recordings; after the first that doesn't (or once they run
 * out), every call goes to the live adapter. Shared by the participants' and the translator's adapters. */
export class Serving {
  served = 0;
  /** Of those served, the calls that had failed, served as the same failures. */
  servedFailures = 0;
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
            if (r.failed !== undefined) {
              this.servedFailures++;
              throw new ModelCallFailed(r.failed);
            }
            return { content: r.output, usage: r.usage, ...(r.estimated ? { estimated: true } : {}) };
          }
          // (What is asked at a run's end, a debrief or an exit account, carries the run's own record to that point: a
          // run that had ended, was debriefed, and is now taken further asks those again, anew, when it ends again.
          // That is not the run departing from its recording.)
          if (req.purpose !== "debrief" && req.purpose !== "account") this.diverged = { subject: req.subject, purpose: req.purpose, call: i + 1 };
        }
        return live.complete(req);
      },
    };
  }
}

/**
 * The log to resume, from what was named: a plain log; a compressed one (written out plain beside itself, and kept: the
 * resume then moves both aside as the stopped run's); or a folder, if just one run in it stopped short (no summary: it
 * was killed or failed; or a summary that says it stopped).
 */
export async function logToResume(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`${path}: no such log or folder`);
  if (statSync(path).isDirectory()) {
    const stoppedShort = currentLogs(path).filter((log) => {
      const summary = join(path, `${runOf(log)}.summary.json`);
      if (!existsSync(summary)) return true;
      try {
        return !!JSON.parse(readFileSync(summary, "utf8")).stopped;
      } catch {
        return true;
      }
    });
    if (stoppedShort.length !== 1)
      throw new Error(stoppedShort.length ? `${path}: ${stoppedShort.length} runs stopped short; name the one to resume:\n${stoppedShort.map((l) => `  oikos resume ${l}`).join("\n")}` : `${path}: no run here stopped short (nothing to resume)`);
    path = stoppedShort[0]!;
  }
  return decompressLog(path);
}

/** A log's run id and config (the header), and where its files are. The old files are kept, renamed
 * `<run>.stopped-<n>.*`, and the resumed run is written in their place. */
export function prepareResume(logPath: string): { runId: string; config: any; outDir: string; stoppedLog: string; consult: boolean; /** The composer was played by its models, not the mock. */ composer: boolean; consultAvoid?: string[]; recording?: { observations?: string; decisions?: string }; /** The wording of the debrief's questions, where the run was not on the usual one. */ debriefWording?: "b" } {
  // The header, and whether the run asked the sparse mind and what it left out (its note, near the start: run.ts).
  let first = "";
  let noteLine: string | undefined;
  let recordingLine: string | undefined;
  let composer = false;
  let wordingB = false;
  let lines = 0;
  eachLine(logPath, (l) => {
    if (lines++ === 0) first = l;
    else if (l.includes('"annotation":"note"') && l.includes('"consult":{')) noteLine = l;
    else if (l.includes('"annotation":"note"') && l.includes('"recording":{')) recordingLine = l;
    else if (l.includes('"annotation":"note"') && l.includes('"composer":{') && l.includes('"played_by":"models"')) composer = true;
    else if (l.includes('"annotation":"note"') && l.includes('"debrief_wording":"b"')) wordingB = true;
    return lines < 200 && !noteLine;
  });
  const consult = !!noteLine;
  const consultAvoid: string[] | undefined = noteLine ? JSON.parse(noteLine).body?.data?.consult?.avoid : undefined;
  // (And what it was asked to record beyond the default: its note, just before.)
  const recording: { observations?: string; decisions?: string } | undefined = recordingLine ? JSON.parse(recordingLine).body?.data?.recording : undefined;
  const header = JSON.parse(first);
  if (header.kind !== "header") throw new Error(`${logPath} doesn't start with a run header`);
  const runId: string = header.body.run_id;
  const outDir = dirname(logPath);
  if (basename(logPath) !== `${runId}.jsonl`) throw new Error(`${logPath}: expected the log to be named ${runId}.jsonl`);
  let n = 1;
  while (existsSync(join(outDir, `${runId}.stopped-${n}.jsonl`)) || existsSync(join(outDir, `${runId}.stopped-${n}.jsonl.zst`))) n++;
  const stoppedLog = join(outDir, `${runId}.stopped-${n}.jsonl`);
  renameSync(logPath, stoppedLog);
  // (With it: a compressed copy of the same log, if the batch had made one, its anchors, and what was said of how it ended.)
  for (const ext of ["jsonl.zst", "anchors.jsonl", "failure.json", "summary.json", "debriefs.jsonl"]) {
    const f = join(outDir, `${runId}.${ext}`);
    if (existsSync(f)) renameSync(f, join(outDir, `${runId}.stopped-${n}.${ext}`));
  }
  return { runId, config: header.body.config, outDir, stoppedLog, consult, composer, ...(consultAvoid ? { consultAvoid } : {}), ...(recording ? { recording } : {}), ...(wordingB ? { debriefWording: "b" as const } : {}) };
}
