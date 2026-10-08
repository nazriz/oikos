// Where a pilot's folder stands, for whatever starts, resumes or waits for pilots (scripts/pilot-queue.ts): its run's
// log (plain while the run is stopped, compressed once it has finished) and the summary beside it, read through the
// repo's own log reader, and why the run last stopped.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { currentLogs, logLines, runOf } from "./logs";

/** Why a pilot's run stopped, as far as the queue cares: it reached its `until` (done); a usage limit (waits and
 * resumes); its own spending limit (over, as far as it got); a signal (someone asked it to stop); anything else (a
 * failure); or it has no log (never started). */
export type Stop = "done" | "usage_limit" | "spending_limit" | "signal" | "failed" | "none";

export interface RunState {
  /** The run's current log (plain or compressed), if the folder has one. */
  log?: string;
  /** Time of the last thing the run wrote, in simulated seconds. */
  t?: number;
  /** The end entry's reason and detail (the summary's, for a run finished and compressed). */
  ended?: string;
  detail?: string;
  /** The summary says why it stopped (`stopped.by`), when it does. */
  by?: string;
  stop: Stop;
}

const USAGE_LIMIT = /limit|429|too many requests|credit/i;
const SPENDING_LIMIT = /spending limit/i;
const ASKED_TO_STOP = /asked to stop|TERM signal|SIGTERM|SIGINT/i;

/** The last non-empty line of a plain log, read from its end (a log can be gigabytes). */
function lastLine(path: string): string {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    for (let span = 1 << 16; ; span *= 4) {
      const n = Math.min(span, size);
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString("utf8").split("\n").filter((l) => l.trim());
      // (More than one line in view, or all of the file: the last line is whole.)
      if (lines.length > 1 || n === size) return lines.at(-1) ?? "";
    }
  } finally {
    closeSync(fd);
  }
}

/** The last line of any log: plain from its end, compressed by reading it through. */
async function lastEntry(log: string): Promise<{ t?: number; kind?: string; body?: any } | undefined> {
  let last = "";
  if (log.endsWith(".zst")) for await (const l of logLines(log)) { if (l.trim()) last = l; }
  else last = lastLine(log);
  try {
    return JSON.parse(last);
  } catch {
    return undefined; // (a last line cut off as the process ended)
  }
}

/** The run in a pilot's folder (its `*.seedN` log, either form), how far it got and why it stopped. `until` is the
 * pilot's: a run whose last entry, or whose summary, is at or past it is done. */
export async function runState(dir: string, until: number): Promise<RunState> {
  if (!existsSync(dir)) return { stop: "none" };
  const log = currentLogs(dir).find((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f));
  if (!log) return { stop: "none" };
  let summary: any;
  const sp = join(dir, `${runOf(log)}.summary.json`);
  if (existsSync(sp)) try { summary = JSON.parse(readFileSync(sp, "utf8")); } catch { /* (a summary half written) */ }
  // A compressed log is a finished run's, with its summary beside it: the summary says where it ended, and the log is
  // read only if there is none. A plain log's own last entry is the truth; the summary can be an older stop's.
  const e = log.endsWith(".zst") && summary ? undefined : await lastEntry(log);
  let t: number | undefined = e?.t, ended: string | undefined, detail: string | undefined, by: string | undefined;
  if (e?.kind === "end") ({ reason: ended, detail } = e.body ?? {});
  if (summary && (t === undefined || (summary.t ?? -1) >= t)) {
    t = summary.t;
    ({ reason: ended, detail } = summary.end ?? {});
    by = summary.stopped?.by;
  }
  const text = String(detail ?? "");
  const stop: Stop = t !== undefined && t >= until ? "done"
    : SPENDING_LIMIT.test(text) ? "spending_limit" // (before the usage limit: its words are in this one's)
    : by === "StopRequested" || ASKED_TO_STOP.test(text) ? "signal"
    : USAGE_LIMIT.test(text) ? "usage_limit" : "failed";
  return { log, ...(t !== undefined ? { t } : {}), ...(ended ? { ended } : {}), ...(detail ? { detail } : {}), ...(by ? { by } : {}), stop };
}

/** A time as the status log writes it: local, with its offset from UTC (2026-10-08 14:05+11:00). */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${off < 0 ? "-" : "+"}${p(Math.trunc(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

export interface OptOut { participant: string; t: number; day: number; statement: string }

/**
 * Opt-outs in a run's log (the `opt_out` command), from a byte offset on: for a pilot still running, so that a seat
 * leaving is heard of when it happens. Returns the offset to continue from (a plain log's complete lines only). A
 * compressed log is a finished run's and is read whole. A log that is shorter than the offset was replaced: read again.
 */
export async function scanOptOuts(log: string, from = 0): Promise<{ offset: number; optOuts: OptOut[] }> {
  const found: OptOut[] = [];
  const take = (line: string) => {
    if (!line.includes('"command":"opt_out"')) return;
    try {
      const e = JSON.parse(line);
      if (e.kind === "command" && e.body?.command === "opt_out") found.push({ participant: e.body.participant, t: e.t, day: Math.floor(e.t / 86_400), statement: e.body.statement ?? "" });
    } catch { /* (a line cut off) */ }
  };
  if (log.endsWith(".zst")) {
    for await (const l of logLines(log)) take(l);
    return { offset: 0, optOuts: found };
  }
  const size = statSync(log).size;
  let at = size < from ? 0 : from;
  const fd = openSync(log, "r");
  try {
    const PIECE = 32 << 20;
    let carry = Buffer.alloc(0);
    while (at < size) {
      const n = Math.min(PIECE, size - at);
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, at);
      at += n;
      const all = Buffer.concat([carry, buf]);
      const end = all.lastIndexOf(10) + 1; // (cut at a line's end, in bytes: no character is split)
      for (const l of all.subarray(0, end).toString("utf8").split("\n")) take(l);
      carry = all.subarray(end);
    }
    // (A last line not yet ended is left for the next look.)
    return { offset: at - carry.length, optOuts: found };
  } finally {
    closeSync(fd);
  }
}
