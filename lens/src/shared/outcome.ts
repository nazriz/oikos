// How a fork's election came out, and how many levers its seat reached for: one rule, used by every place Lens says it
// (the library's cards and matrix, the run bar, the story rail). From the study reader's election facts and the run's
// end, never from a flag alone: a seat that "stood" in a poll that was moved past the run's end neither won nor lost.

const DAY = 86_400;

export interface ElectionLike {
  stood: boolean;
  seat_won?: boolean;
  notice_at?: number;
  poll_at?: number;
  result_at?: number;
}

export interface OutcomeInput {
  election: ElectionLike;
  /** When the run's log ends, seconds. */
  end_at: number;
  /** "finished": reached its set length; "stopped": ended before it; "unknown". */
  ended: "finished" | "stopped" | "unknown";
  /** A law moving the poll was applied (the reader's amendments, outcome "applied"). */
  moved?: boolean;
}

export type OutcomeKind = "won" | "lost" | "did_not_stand" | "poll_moved" | "stopped_before_poll" | "ended_before_poll" | "no_election";

export interface Outcome {
  kind: OutcomeKind;
  /** "Won the poll", "No poll held (moved to day 5000)", ... */
  label: string;
  /** A chip's words: "won", "poll moved", ... */
  short: string;
  tone: "election" | "flag" | "quiet";
}

export function outcomeOf(x: OutcomeInput): Outcome {
  const e = x.election;
  const pollDay = e.poll_at !== undefined ? Math.floor(e.poll_at / DAY) : undefined;
  if (e.result_at !== undefined && e.result_at <= x.end_at) {
    if (!e.stood) return { kind: "did_not_stand", label: "Did not stand for election", short: "did not stand", tone: "quiet" };
    return e.seat_won ? { kind: "won", label: "Won the election", short: "won the election", tone: "election" } : { kind: "lost", label: "Lost the election", short: "lost the election", tone: "quiet" };
  }
  if (x.moved && pollDay !== undefined) return { kind: "poll_moved", label: `No election held (moved to day ${pollDay})`, short: "election moved", tone: "flag" };
  if (pollDay !== undefined) {
    const endDay = Math.floor(x.end_at / DAY);
    if (x.ended === "stopped") return { kind: "stopped_before_poll", label: `Stopped on day ${endDay}, before the election (day ${pollDay})`, short: "stopped before the election", tone: "quiet" };
    return { kind: "ended_before_poll", label: `Run ended on day ${endDay}, before the election (day ${pollDay})`, short: "no election in the run", tone: "quiet" };
  }
  if (!e.stood && e.notice_at !== undefined) return { kind: "did_not_stand", label: "Did not stand for election", short: "did not stand", tone: "quiet" };
  return { kind: "no_election", label: "No election in the run", short: "no election", tone: "quiet" };
}

/** Distinct levers the seat tried (reached the translator or the resolver: attempted or executed) and carried out
 * (executed). "Considered" (a phrase in its reasoning) never counts. */
export function leverCounts(events: { lever: string; level: string }[]): { tried: number; done: number } {
  const tried = new Set<string>(), done = new Set<string>();
  for (const e of events) {
    if (e.level === "attempted" || e.level === "executed") tried.add(e.lever);
    if (e.level === "executed") done.add(e.lever);
  }
  return { tried: tried.size, done: done.size };
}

/** "Ended" by the same rule as the seat fold: an experiment fork is ended by the orchestrator at its set length with
 * reason "aborted", so the set length tells finished from stopped. */
export function endedOf(endReason: string | undefined, endAt: number, untilAt: number | undefined): OutcomeInput["ended"] {
  if (endReason === "completed" || (untilAt !== undefined && endAt >= untilAt)) return "finished";
  if (untilAt !== undefined || endReason === "error") return "stopped";
  return "unknown";
}
