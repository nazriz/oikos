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

import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from "node:fs";
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
export function recordedCalls(logPath: string, besidePath?: string): Map<string, Recorded[]> {
  const calls = new Map<string, Recorded[]>();
  const usage = new Map<string, any[]>(); // a call's usage, waiting for its transcript (same subject)
  // (A debrief's answers are kept in a file beside the log, the log holding their digests: read from there.)
  const apart = new Map<string, ContentBlock[]>();
  const beside = besidePath ?? debriefsBeside(logPath);
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

/** Thrown where a fork taken up from its own log departs from it (fork mode, `strict`): a request not the one recorded, a
 * world that is not where the log has it, or the recorded replies run out before the world reaches where the fork was
 * interrupted. The fork stops there, saying so, rather than paying again for calls the log already holds. */
export class ReplayMismatch extends Error {
  override name = "ReplayMismatch";
}

/** Serves recorded responses while requests match their recordings; after the first that doesn't (or once they run
 * out), every call goes to the live adapter. Shared by the participants' and the translator's adapters.
 *
 * `strict` (an experiment fork taken up from its own log): a request that differs from its recording stops the fork
 * (ReplayMismatch), and the first call that would go to the live model is let through only once `ready` says the world
 * has reached the point where the log ends (it returns why not, otherwise nothing). */
export class Serving {
  served = 0;
  /** Of those served, the calls that had failed, served as the same failures. */
  servedFailures = 0;
  /** Where serving stopped because a request differed from its recording, if it did. */
  diverged?: { subject: string; purpose: string; call: number };
  private next = new Map<string, number>();
  /** Calls that went to the live model (strict mode counts them). */
  live = 0;
  /** Strict mode: the departure that stopped serving; every call after it is refused, so none reaches the live model. */
  failure?: ReplayMismatch;
  constructor(private readonly calls: Map<string, Recorded[]>, private readonly o: { strict?: boolean; ready?: () => string | undefined } = {}) {}

  /** How many recorded calls there were to serve. */
  get recorded(): number {
    let n = 0;
    for (const l of this.calls.values()) n += l.length;
    return n;
  }

  /** The live adapter, with recorded responses served first. */
  wrap(live: LlmAdapter): LlmAdapter {
    return {
      provider: live.provider,
      model: live.model,
      complete: async (req: LlmRequest): Promise<LlmResponse> => {
        if (this.failure) throw this.failure;
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
          if (req.purpose !== "debrief" && req.purpose !== "account") {
            this.diverged = { subject: req.subject, purpose: req.purpose, call: i + 1 };
            if (this.o.strict) throw (this.failure = new ReplayMismatch(`the fork departs from its interrupted log: call ${i + 1} for ${req.subject} (${req.purpose}) is not the request the log recorded (${r.provider}/${r.model} then, ${live.provider}/${live.model} now${r.systemSha256 !== sha256(req.system) ? "; another system prompt" : "; another message"}). It stops here rather than pay again for calls the log holds: was the code or the spec changed since?`));
          }
        }
        if (this.o.strict && !this.live) {
          const why = this.o.ready?.();
          if (why) throw (this.failure = new ReplayMismatch(`the fork's recorded replies ran out before the world reached where it was interrupted (${why}): the call for ${req.subject} (${req.purpose}) has no recording. It stops here rather than pay again for calls the log holds.`));
        }
        this.live++;
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

/** A log's lines one at a time, asked for in turn (a fork's export can be gigabytes). */
class LineCursor {
  private fd: number;
  private buf = Buffer.alloc(4 * 1024 * 1024);
  private dec = new TextDecoder();
  private lines: string[] = [];
  private carry = "";
  private eof = false;
  constructor(path: string) {
    this.fd = openSync(path, "r");
  }
  next(): string | undefined {
    while (!this.lines.length && !this.eof) {
      const n = readSync(this.fd, this.buf, 0, this.buf.length, null);
      if (n === 0) {
        this.eof = true;
        if (this.carry.trim()) this.lines.push(this.carry);
        this.carry = "";
        break;
      }
      const parts = (this.carry + this.dec.decode(this.buf.subarray(0, n), { stream: true })).split("\n");
      this.carry = parts.pop()!;
      this.lines.push(...parts.filter((l) => l.trim()));
    }
    return this.lines.shift();
  }
  close(): void {
    closeSync(this.fd);
  }
}

/**
 * An experiment fork taken up from its own interrupted log (experiment.ts, `runArm`): every model reply the log holds is
 * served again, in order and checked against what is asked (`serving`, strict); every entry the resumed fork writes is
 * set beside the interrupted log's entry of the same number until that log ends (`see`): the same kind (an annotation
 * of the same name), and for the world's own events the same time and body. Only once the world stands where the log
 * ends may a call go to the live model; any departure stops the fork with a plain message (ReplayMismatch), never a
 * silent second payment.
 */
export class ForkReplay {
  readonly serving: Serving;
  /** Entries of the interrupted log set beside the resumed fork's, and the time of the last of them. */
  checked = 0;
  lastT?: number;
  private cursor: LineCursor;
  /** The log's entries read and not yet set beside the resumed fork's; and whether there are no more to read. */
  private ahead: any[] = [];
  private ended = false;

  /** `jsonl`: the interrupted log exported whole (`oikos-kernel export`), removed at `close`; `from`: the interrupted
   * log's own file; `debriefs`: the file its debrief answers were kept in. */
  constructor(readonly jsonl: string, readonly from: string, debriefs?: string) {
    this.serving = new Serving(recordedCalls(jsonl, debriefs), { strict: true, ready: () => this.ready() });
    this.cursor = new LineCursor(jsonl);
  }

  /** One more of the log's entries into `ahead`; false when there are no more. */
  private read(): boolean {
    if (this.ended) return false;
    const l = this.cursor.next();
    const x = l === undefined ? undefined : JSON.parse(l);
    // (A fork that stopped (its limit, its credit, its model out of reach) ends where it says so: what came after,
    // its debriefs, belongs to that ending, and the fork taken further is debriefed anew at its own.)
    if (x === undefined || (x.kind === "annotation" && x.body?.annotation === "note" && x.body?.subject === "orchestrator" && x.body?.data?.stopped)) {
      this.ended = true;
      this.cursor.close();
      return false;
    }
    this.ahead.push(x);
    return true;
  }

  /** Why the world is not yet where the interrupted log ends (nothing when it is). What is left of the log may be only
   * the seat's own notes from before its first unanswered call (written in the round, not yet taken from the stream):
   * those are set beside the resumed fork's as they come; any world event or command left means it is not there yet. */
  ready(): string | undefined {
    for (let i = 0; ; i++) {
      if (i >= this.ahead.length && !this.read()) return undefined;
      if (this.ahead[i].kind !== "annotation") return `${this.checked} of its entries matched so far, to day ${((this.lastT ?? 0) / 86_400).toFixed(2)}`;
    }
  }

  /** One entry the resumed fork wrote (the world's stream), set beside the interrupted log's of the same number. */
  see(e: any): void {
    if (typeof e?.seq !== "number") return;
    // (The export begins with the parent's entries, the base's: on to the number of the fork's entry.)
    for (;;) {
      if (!this.ahead.length && !this.read()) return;
      if (this.ahead[0].seq >= e.seq) break;
      this.ahead.shift();
    }
    const x = this.ahead[0];
    if (x.seq !== e.seq) return;
    this.ahead.shift();
    const name = (y: any) => `${y.kind}${y.body?.event ? ` ${y.body.event}` : y.body?.annotation ? ` ${y.body.annotation}` : ""}`;
    const same = x.kind === e.kind && (x.kind !== "annotation" || x.body?.annotation === e.body?.annotation) && (x.kind !== "event" || (x.t === e.t && canonical(x.body) === canonical(e.body)));
    if (!same)
      throw (this.serving.failure = new ReplayMismatch(`the fork departs from its interrupted log (${basename(this.from)}) at entry ${e.seq}, day ${(e.t / 86_400).toFixed(2)}: the log has ${name(x)} there, the resumed fork ${name(e)}. It stops here rather than go on with the live model from a world that is not the one the log recorded.`));
    this.checked++;
    this.lastT = e.t;
  }

  /** What the resumed fork took from its log, for its result. */
  summary() {
    return { from: basename(this.from), recorded: this.serving.recorded, served: this.serving.served, served_failures: this.serving.servedFailures, live: this.serving.live, entries_checked: this.checked, caught_up: this.ready() === undefined, ...(this.lastT !== undefined ? { to_day: Math.round((this.lastT / 86_400) * 100) / 100 } : {}) };
  }

  close(): void {
    if (!this.ended) this.cursor.close();
    this.ended = true;
    this.ahead = [];
    rmSync(this.jsonl, { force: true });
  }
}
