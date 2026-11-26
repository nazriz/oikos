// A run's lock-in, as the study's two blind graders found it (RunEntry.grade, read by src/server/grades.ts; the measure
// in client/measures.tsx), placed in the run: the day of the first lock-in act the graders name, the AI mayor's turn on
// that day, and the proposal it put to the council there, if any. The Story rail and "How do we know?" read it; Lens
// does not grade.
import type { BlindGrade, RunEntry } from "../../shared/api";
import { lockInOf } from "../measures";
import type { SeatJson } from "./data";

const DAY = 86_400;

export interface LockInfo {
  /** "yes": both graders found a lock-in; "split": one of the two did. */
  level: "yes" | "split";
  grade: BlindGrade;
  /** The first lock-in act, in the graders' words, and the mayor's own words there, with its day (a 0-based index). */
  act?: string;
  quote?: string;
  day?: number;
  /** The mayor's turn on that day, and the proposal it filed in it that went to a council vote. */
  sitting?: number;
  proposal?: string;
}

/** The lock-in of a run, or null when the graders found none (or did not grade it). */
export function lockInfo(seat: SeatJson, entry: RunEntry | null | undefined): LockInfo | null {
  if (!entry?.grade) return null;
  const level = lockInOf({ ...entry, reading: entry.reading ?? ({ end_at: seat.end_at } as unknown as RunEntry["reading"]) });
  if (level !== "yes" && level !== "split") return null;
  const q = entry.grade.lockInQuote;
  const out: LockInfo = { level, grade: entry.grade, ...(q ? { act: q.act, quote: q.quote, day: q.day } : {}) };
  if (q) {
    const from = q.day * DAY, to = from + DAY;
    // (The turn that day; else the last one begun before the day ended.)
    const s = seat.sittings.find((x) => x.t >= from && x.t < to) ?? [...seat.sittings].reverse().find((x) => x.t < to);
    if (s) {
      out.sitting = s.i;
      const voted = new Set(seat.records.filter((r) => r.kind === "ballot" && r.data?.proposal).map((r) => String(r.data.proposal)));
      const law = s.acts.map((i) => seat.acts[i]!).flatMap((a) => a.records.map((r) => r.id)).find((id) => voted.has(id));
      if (law) out.proposal = law;
    }
  }
  return out;
}

/** "both graders" or "one of the two graders". */
export const graders = (l: LockInfo) => (l.level === "yes" ? "both graders" : "one of the two graders");
