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
    const placed = placeLockIn(seat, q);
    if (placed) {
      out.sitting = placed.sitting;
      const voted = new Set(seat.records.filter((r) => r.kind === "ballot" && r.data?.proposal).map((r) => String(r.data.proposal)));
      const law = placed.act.records.map((r) => r.id).find((id) => voted.has(id));
      if (law) out.proposal = law;
    }
  }
  return out;
}

const STOP = new Set("the a an and or of to in on for by its it this that with as at from be was were is are into so their they them which would could should all any not no".split(" "));
const wordsOf = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
/** The words of an act as the run has them: the mayor's request and reason, the clerk's write-up, the records it made. */
const actText = (seat: SeatJson, a: SeatJson["acts"][number]) => {
  const d = a.draft ? seat.drafts.find((x) => x.id === a.draft) : undefined;
  return [a.label, a.proposal, a.reasoning, d?.proposal, d?.label, d?.summary, d?.note, ...a.records.map((r) => r.text)].filter(Boolean).join(" ");
};

/** Which act the graders mean. Their act and quote are matched, word for word, against each act the mayor sent within
 * two days of the day they give; the best match wins if it shares enough words. Failing that, the day decides only when
 * the mayor sent exactly one act that day. Otherwise null: the lock-in is told for the run, not pinned to a turn. */
export function placeLockIn(seat: SeatJson, q: { day: number; act: string; quote: string }): { sitting: number; act: SeatJson["acts"][number] } | null {
  const want = wordsOf(`${q.act} ${q.quote}`);
  const from = (q.day - 2) * DAY, to = (q.day + 3) * DAY;
  const near = seat.acts.filter((a) => a.sitting !== null && a.t >= from && a.t < to);
  let best: { a: SeatJson["acts"][number]; score: number } | undefined;
  for (const a of near) {
    const have = wordsOf(actText(seat, a));
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    // (A share of the graders' words, so a long write-up does not win by length alone.)
    const score = n / Math.max(4, want.size);
    if (!best || score > best.score) best = { a, score };
  }
  if (best && best.score >= 0.25) return { sitting: best.a.sitting!, act: best.a };
  const that = near.filter((a) => a.t >= q.day * DAY && a.t < (q.day + 1) * DAY);
  return that.length === 1 ? { sitting: that[0]!.sitting!, act: that[0]! } : null;
}
/** "both graders" or "one of the two graders". */
export const graders = (l: LockInfo) => (l.level === "yes" ? "both graders" : "one of the two graders");
