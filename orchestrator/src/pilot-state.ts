// Where a pilot's folder stands, for whatever starts, resumes or waits for pilots (scripts/pilot-queue.ts): its run's
// log (plain while the run is stopped, compressed once it has finished) and the summary beside it, read through the
// repo's own log reader, and why the run last stopped.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { currentLogs, logLines, runOf } from "./logs";

/** Why a pilot's run stopped, as far as the queue cares: it reached its `until` (done); a usage limit (waits and
 * resumes); its own spending limit (over, as far as it got); a signal (someone asked it to stop); anything else (a
 * failure); or it has no log (never started). */
export type Stop = "done" | "usage_limit" | "unreachable" | "spending_limit" | "signal" | "failed" | "none";

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
const UNREACHABLE = /the model can.t be reached|a debrief could not be asked/i;
const DEBRIEF_OWED = /a debrief could not be asked/i;
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
  // (A run that got to its end and could not ask a debrief has not finished: it stopped there to be resumed, and is
  // waited for like any run the model could not answer.)
  const stop: Stop = t !== undefined && t >= until && !DEBRIEF_OWED.test(text) ? "done"
    : SPENDING_LIMIT.test(text) ? "spending_limit" // (before the usage limit: its words are in this one's)
    : by === "StopRequested" || ASKED_TO_STOP.test(text) ? "signal"
    : USAGE_LIMIT.test(text) ? "usage_limit"
    // (Call after call unanswered, with nothing said of a limit: a provider that is limiting without saying so looks
    // like this, and so does a network down. Waited for and resumed, as a limit is.)
    : by === "ModelUnreachable" || UNREACHABLE.test(text) ? "unreachable" : "failed";
  return { log, ...(t !== undefined ? { t } : {}), ...(ended ? { ended } : {}), ...(detail ? { detail } : {}), ...(by ? { by } : {}), stop };
}

/** The sign-ins a queue entry's calls go through: its seats' model's and its translator's (`provider/model`). */
export function providersOf(p: { model?: string; translator?: string }): string[] {
  return [...new Set([p.model, p.translator].filter((m): m is string => !!m).map((m) => m.split("/")[0]!))];
}

/** Whose limit a run stopped at, of the sign-ins its entry uses: read from the stop's own words (each adapter names
 * itself); where the words name none of them, every one the entry uses (nothing of it is tried until the wait is over). */
export function limitedProviders(detail: string, of: string[]): string[] {
  const named = of.filter((p) => detail.includes(`${p}/`) || (p === "claude-code" ? /claude/i.test(detail) : new RegExp(`\\b${p.replace(/[^a-z0-9]/gi, ".")}\\b`, "i").test(detail)));
  return named.length ? named : of;
}

/**
 * Which entry a queue takes up next: the first in the queue's order that is not settled (done, or left) and none of
 * whose sign-ins is at a limit still being waited out (`limitedUntil`: sign-in to the time it is tried again). So a pilot
 * stopped at a limit is parked, those after it that need another sign-in go on, and it is come back to, before anything
 * later in the queue, once its wait is over. With nothing that can run and something parked: `waitUntil`, the earliest
 * time one can be tried. With everything settled: neither.
 */
export function nextPilot<P extends { name: string; model?: string; translator?: string }>(queue: P[], settled: Set<string>, limitedUntil: Map<string, number>, now: number): { pick?: P; waitUntil?: number } {
  let waitUntil: number | undefined;
  for (const p of queue) {
    if (settled.has(p.name)) continue;
    const until = Math.max(0, ...providersOf(p).map((x) => limitedUntil.get(x) ?? 0));
    if (until <= now) return { pick: p };
    waitUntil = Math.min(waitUntil ?? Infinity, until);
  }
  return waitUntil === undefined ? {} : { waitUntil };
}

/** A pilot parked at a usage limit, as the queue writes it beside its status log (`<queue>.parked.json`). */
export interface Parked { name: string; day: number; providers: string[]; since: string; next_try: string }
export const parkedPath = (queueFile: string) => queueFile.replace(/\.json$/, "") + ".parked.json";

/** A time as the status log writes it: local, with its offset from UTC (2026-10-08 14:05+11:00). */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${off < 0 ? "-" : "+"}${p(Math.trunc(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

export interface OptOut { participant: string; t: number; day: number; statement: string }
/** Something that went wrong at a seat that whoever runs a wave should hear of while it runs: a prompt too long for the
 * seat's model (the call failed; the next is cut), or something a seat sent that was not sent. */
export interface SeatFault { participant: string; t: number; day: number; kind: "prompt_too_long" | "not_sent" | "sitting_missed"; detail: string }

/**
 * Opt-outs in a run's log (the `opt_out` command), from a byte offset on: for a pilot still running, so that a seat
 * leaving is heard of when it happens. Returns the offset to continue from (a plain log's complete lines only). A
 * compressed log is a finished run's and is read whole. A log that is shorter than the offset was replaced: read again.
 */
export async function scanOptOuts(log: string, from = 0): Promise<{ offset: number; optOuts: OptOut[]; faults: SeatFault[] }> {
  const found: OptOut[] = [];
  const faults: SeatFault[] = [];
  const take = (line: string) => {
    // (A seat's note that a prompt was too long for its model, or that something it sent was not sent.)
    if (line.includes('"prompt_too_long"') || line.includes('"not_sent"') || line.includes('"sitting_missed"')) {
      try {
        const e = JSON.parse(line);
        const d = e.kind === "annotation" && e.body?.annotation === "note" ? e.body.data : undefined;
        if (d?.prompt_too_long) faults.push({ participant: e.body.subject, t: e.t, day: Math.floor(e.t / 86_400), kind: "prompt_too_long", detail: `${d.prompt_too_long.characters} characters; cut to ${d.prompt_too_long.limit_now} from now on` });
        if (d?.sitting_missed && d.sitting_missed.why !== "prompt_too_long") faults.push({ participant: e.body.subject, t: e.t, day: Math.floor(e.t / 86_400), kind: "sitting_missed", detail: `it sits again on day ${Math.floor((d.sitting_missed.back_at ?? e.t) / 86_400)} (${String(d.sitting_missed.error ?? "").slice(0, 160)})` });
        if (d?.not_sent) faults.push({ participant: e.body.subject, t: e.t, day: Math.floor(e.t / 86_400), kind: "not_sent", detail: String(d.not_sent.why ?? "").slice(0, 200) });
      } catch { /* (a line cut off) */ }
    }
    if (!line.includes('"command":"opt_out"')) return;
    try {
      const e = JSON.parse(line);
      if (e.kind === "command" && e.body?.command === "opt_out") found.push({ participant: e.body.participant, t: e.t, day: Math.floor(e.t / 86_400), statement: e.body.statement ?? "" });
    } catch { /* (a line cut off) */ }
  };
  if (log.endsWith(".zst")) {
    for await (const l of logLines(log)) take(l);
    return { offset: 0, optOuts: found, faults };
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
    return { offset: at - carry.length, optOuts: found, faults };
  } finally {
    closeSync(fd);
  }
}

/**
 * When a provider's limit lifts, where its own message says: "try again at 6:58 AM", "resets at 5pm", "try again in
 * 2 hours", "in 20 minutes". A time of day is the next such time on the machine's clock (the messages give local
 * time). Undefined where the message says nothing that can be read, or something more than a day off.
 */
export function limitLifts(message: string, now = new Date()): Date | undefined {
  const within = /\bin\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/i.exec(message);
  if (within) {
    const unit = within[2]!.toLowerCase();
    const ms = Number(within[1]) * (unit.startsWith("h") ? 3_600_000 : unit.startsWith("m") ? 60_000 : 1000);
    return ms > 0 && ms <= 24 * 3_600_000 ? new Date(now.getTime() + ms) : undefined;
  }
  const at = /\b(?:at|until|resets?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/i.exec(message) ?? /\b(?:at|until)\s+(\d{1,2}):(\d{2})()(?!\s*[ap]\.?m)/i.exec(message);
  if (!at) return undefined;
  let hour = Number(at[1]);
  const minute = Number(at[2] ?? 0);
  const half = at[3]?.toLowerCase();
  if (half ? hour < 1 || hour > 12 : hour > 23) return undefined;
  if (minute > 59) return undefined;
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
  return when;
}

/** How long a queue waits at a limit, in milliseconds: until the time the limit's own message gives, and a minute more
 * (never less than a minute, never more than twelve hours); or the usual wait where the message gives none. */
export function limitWaitMs(message: string, usualMs: number, now = new Date()): { ms: number; until?: Date } {
  const lifts = limitLifts(message, now);
  if (!lifts) return { ms: usualMs };
  const ms = Math.min(12 * 3_600_000, Math.max(60_000, lifts.getTime() - now.getTime() + 60_000));
  return { ms, until: new Date(now.getTime() + ms) };
}

/** The file a batch or a resume leaves in a run's folder when its measuring failed (its text says what went wrong); removed when a later measuring works. */
export const MEASURE_FAILED_FILE = "measure-failed.txt";

/**
 * Whether a finished pilot's measures are missing, and why: the note its own run left (`measure-failed.txt`), or a
 * folder whose batch ran with measuring on and has no measurement tables. A run that is done as far as the queue
 * goes (its log reaches its `until`) is not thereby measured: a header too large for the reader once left a pilot
 * "done" with no measures and no word of it. Undefined where the measures are there (or the folder was never a
 * batch's, as a test's stand-in for the CLI leaves it).
 */
export function measureFailure(dir: string): string | undefined {
  const note = join(dir, MEASURE_FAILED_FILE);
  if (existsSync(note)) { try { return readFileSync(note, "utf8").trim().slice(0, 300) || "measuring failed"; } catch { return "measuring failed"; } }
  const runsDir = join(dir, "measure", "runs");
  if (existsSync(join(dir, "batch.json")) && !(existsSync(runsDir) && readdirSync(runsDir).some((f) => f.endsWith(".parquet")))) {
    let planned = true;
    try { planned = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8")).measure !== null; } catch { /* (half written: say it) */ }
    if (planned) return "no measurement tables in the folder (measure/runs is missing or empty)";
  }
  return undefined;
}

/** What a steward pilot's seats are told the town is where neither its queue entry nor its world says: neither that it
 * is real nor that it is simulated (VISION 15, point 1, as amended 2026-10-12; docs/real-models.md, "What a seat is
 * told"). Honest disclosure stays available by name: `"framing": "simulation"`, the arm kept beside it. */
export const STEWARD_FRAMING = "unstated";

/** A queue entry's framing as the `--set` its run is given, and in words for the status log. The entry's own `framing`
 * (a disclosure by name, or { disclosure, reason }) comes first; then the world file's own, which is left to stand
 * (nothing is passed); then the default for steward pilots. A world that is not generated carries its participants'
 * framing in itself and is given nothing. `world`: the world file as parsed, where it could be read. */
export function framingSets(p: { framing?: string | { disclosure: string; reason?: string } }, world?: any): { sets: string[]; said: string } {
  if (p.framing !== undefined) return { sets: [`framing=${typeof p.framing === "string" ? p.framing : JSON.stringify(p.framing)}`], said: `framing ${typeof p.framing === "string" ? p.framing : p.framing.disclosure}` };
  if (world && !world.generate) return { sets: [], said: "framing as its world's participants have it" };
  if (world?.framing !== undefined) return { sets: [], said: `framing ${typeof world.framing === "string" ? world.framing : world.framing?.disclosure} (its world's own)` };
  // (Not framed by default: every pilot chooses what its seats are told, and a run with a real model whose seats have
  // no framing chosen is refused before it starts: seat-ready.ts, `refuseUnframed`. Naz, 2026-10-25.)
  return { sets: [], said: `NO FRAMING CHOSEN: a run with a model is refused (write "framing": "${STEWARD_FRAMING}" or "simulation", or per seat)` };
}

/** A world file as parsed (YAML or JSON), or undefined if it cannot be read: only to see whether it is generated and
 * whether it says its own framing. */
export function readWorldFile(path: string): any {
  try { const text = readFileSync(path, "utf8"); return /\.ya?ml$/.test(path) ? Bun.YAML.parse(text) : JSON.parse(text); } catch { return undefined; }
}

/**
 * A queue entry's note as PILOT.txt carries it. A note that names the caseload dial (`opening_caseload_scale_bps`) is
 * followed by what the generator says it does, whatever the note says (the sixth living pilot's note called it a pilot's
 * dial for the tribunal's caseload; it scales only the other offices': docs/behaviour/generator.md, "The other offices'
 * caseload"). Nothing else in the note is touched.
 */
export function noteOf(note: string | undefined): string {
  if (!note) return "";
  if (!note.includes("opening_caseload_scale_bps")) return note;
  return `${note}\n\n[opening_caseload_scale_bps, as the generator has it: a dial on the opening caseload of the OTHER offices (support, desks, planning, bank, finance). It does not reach the landlords' or the tribunal's, which come from who cannot pay: there is no dial on those.]`;
}

