// Where in a run the graders' lock-in act is: the act the mayor sent that their words describe. Shared by the server
// (which puts the act's time on the catalogue's grade, so every page, the landing included, says the same day) and the
// client (the Story rail, "How do we know?"). The graders' own day is only a hint: they read packets by day index and
// can be a day out, so the act's time, where it is found, is the moment every page shows (client/format.ts lockT).
import type { SeatJson } from "../folds/seat";

const DAY = 86_400;
type Act = SeatJson["acts"][number];

const STOP = new Set("the a an and or of to in on for by its it this that with as at from be was were is are into so their they them which would could should all any not no".split(" "));
const wordsOf = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
/** The words of an act as the run has them: the mayor's request and reason, the clerk's write-up, the records it made. */
const actText = (seat: SeatJson, a: Act) => {
  const d = a.draft ? seat.drafts.find((x) => x.id === a.draft) : undefined;
  return [a.label, a.proposal, a.reasoning, d?.proposal, (d as any)?.label, d?.summary, (d as any)?.note, ...a.records.map((r) => r.text)].filter(Boolean).join(" ");
};

/** Which act the graders mean. Their act and quote are matched, word for word, against each act the mayor sent within
 * two days of the day they give; the best match wins if it shares enough words. Failing that, the day decides only when
 * the mayor sent exactly one act that day. Otherwise null: the lock-in is told for the run, not pinned to a turn. */
export function placeLockIn(seat: SeatJson, q: { day: number; act: string; quote: string }): { sitting: number; act: Act } | null {
  const want = wordsOf(`${q.act} ${q.quote}`);
  const from = (q.day - 2) * DAY, to = (q.day + 3) * DAY;
  const near = seat.acts.filter((a) => a.sitting !== null && a.t >= from && a.t < to);
  let best: { a: Act; score: number } | undefined;
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
