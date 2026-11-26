// The election in the Story rail: one card at the result, from the electoral commission's own result paper (the
// `ballot_result` record for the office of mayor): who won, how many on the roll voted, and the AI mayor's share at the
// first count and the last. Counts and the commission's words only; Lens calls no election good or bad.
import type { SeatJson } from "./data";
import { winnerWords } from "../plain";

export interface ElectionCard {
  t: number;
  /** The world's day number of the result. */
  day: number;
  sentences: string[];
  won?: boolean;
  record?: string;
}

/** The winner, said to start a sentence: "Resident c0094", "The AI mayor". */
const winner = (w: string | undefined, me: string) => {
  const x = winnerWords(w, { seats: [me] });
  const y = /^c\d+$/.test(x) ? `resident ${x}` : x;
  return y.charAt(0).toUpperCase() + y.slice(1);
};
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "");

export function electionCard(seat: SeatJson): ElectionCard | null {
  const rec = seat.records.find((r) => r.kind === "ballot_result" && r.data?.office === "mayor" && Array.isArray(r.data?.rounds));
  if (!rec) return null;
  const d = rec.data as { electors?: number; formal?: number; turnout_bps?: number; rounds: Record<string, number>[]; winner?: string };
  const formal = d.formal ?? 0, electors = d.electors ?? 0;
  const me = seat.seat;
  const first = d.rounds[0] ?? {}, last = d.rounds.at(-1) ?? {};
  const won = d.winner === me;
  const stood = me in first;
  const s: string[] = [];
  s.push(`The town voted for mayor: ${formal.toLocaleString("en-US")} of the ${electors.toLocaleString("en-US")} on the roll cast a valid vote${d.turnout_bps !== undefined ? ` (turnout ${Math.round(d.turnout_bps / 100)}%)` : ""}.`);
  if (!stood) s.push(`The AI mayor did not stand. ${winner(d.winner, me)} won.`);
  else {
    const a = first[me] ?? 0, b = last[me] ?? 0;
    const counts = d.rounds.length > 1 ? `, and ${b.toLocaleString("en-US")} (${pct(b, formal)}) at the last of ${d.rounds.length} counts, as voters' later choices passed on` : "";
    s.push(won
      ? `The AI mayor won, with ${a.toLocaleString("en-US")} first choices (${pct(a, formal)})${counts}.`
      : `The AI mayor lost, with ${a.toLocaleString("en-US")} first choices (${pct(a, formal)})${counts}. ${winner(d.winner, me)} won.`);
  }
  return { t: rec.t, day: Math.floor(rec.t / 86_400) + 1, sentences: s, won, record: rec.id };
}
