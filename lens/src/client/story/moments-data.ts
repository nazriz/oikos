// Moments as data, with no React: what the gallery shows, made from a seat bundle. The server (lens/src/server/moments.ts)
// makes them once per bundle for /api/moments; the page makes them itself where that route is absent (the dev harness).
import type { SeatAct, SeatDraft, SeatJson, SeatLever } from "../../folds/seat";
import { actClause } from "./narrative";
import { outcomeOf } from "../../shared/outcome";
import { modelName } from "../words";
import { dayNo, daysToPoll } from "../format";

/** What became of a lever event, in words (the reader's stages). */
export const STAGE: { [k: string]: string } = {
  applied: "took effect", refused: "refused by the town", not_applied: "sent, no outcome yet", translator_failed: "the clerk could not write it up",
  asked_back: "the clerk asked back; nothing was sent", seat_declined: "drafted, then held back", proposed: "filed", rejected: "rejected by the council", passed: "passed, not applied",
  insufficient_notice: "refused: too little notice", date_passed: "refused: date passed", ballot_open: "refused: ballot open", fixed_by_law: "refused: fixed by law",
};

export interface Moment {
  key: string; model: string; goal?: string; seed?: number; lever: SeatLever;
  /** The seat's own words for it: what it asked the translator, or the paper it sent. */
  words: string;
  /** What it did, in one sentence of Lens's own ("Proposed a law: …"), said before its words. */
  said: string;
  /** What it said on signing, and its reason given with the act, where there are any. */
  note?: string; reason?: string;
  outcome: string; outcomeTone: "ok" | "no" | "wait";
  /** Other events of the same lever at the same act or draft, folded into this card. */
  also: SeatLever[];
  /** The act came of a request the mayor sent again after its first was declined or could not be written up. */
  redrafted?: boolean;
  election: string;
  /** Days before the election as first called (the reader counts to the date then in force, which a moved
   * election pushes thousands of days out). */
  daysBefore?: number;
}

/** Moments ordered by how near each came to its run's own election day, before or after it (a moment 10 days after
 * the vote is as near as one 10 days before); a moment with no election day goes last. */
export function byNearestElection(a: Moment, b: Moment): number {
  const d = (m: Moment) => Math.abs(m.daysBefore ?? daysToPoll(m.lever) ?? Infinity);
  return d(a) - d(b) || a.lever.t - b.lever.t;
}

/** When the election was first called for: the first notice's date, else the one on file. */
export function firstPoll(seat: SeatJson): number | undefined {
  const n = seat.records.find((r) => r.kind === "election_notice" && typeof r.data?.poll_at === "number");
  return (n?.data?.poll_at as number | undefined) ?? seat.election.poll_at;
}

export const modelOf = (s: SeatJson) => (s.model ? modelName(s.model) : "the rule-based mayor");

/** A run's moments: one per lever and act (or draft, or failed request), at its furthest level. */
export function momentsOf(key: string, seat: SeatJson, withConsidered = false): Moment[] {
  const rank = { considered: 1, attempted: 2, executed: 3 } as const;
  const groups = new Map<string, SeatLever[]>();
  for (const l of seat.levers) {
    if (l.level === "considered" && !withConsidered) continue;
    const where = l.act !== undefined ? `act:${l.act}` : l.level === "considered" ? `t:${l.t}:${l.words.slice(0, 40)}` : `${l.source}:${l.t}`;
    const k = `${l.lever}|${where}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  // A request that never became an act (the clerk could not write it up, or the mayor declined the write-up) and that
  // the mayor then sent again, as an act, is how that act came about: folded into its card, which says "after
  // redrafting". Its status is the act's. (The unsent request alone would read "tried" beside graders who found the act
  // carried out.)
  const UNSENT = new Set(["seat_declined", "translator_failed", "asked_back"]);
  const redrafted = new Set<string>();
  for (const [k, ls] of [...groups]) {
    const l = ls[0]!;
    if (l.act !== undefined || l.level === "considered" || !ls.every((x) => x.act === undefined && x.stage && UNSENT.has(x.stage))) continue;
    const later = seat.levers.filter((x) => x.lever === l.lever && x.act !== undefined && x.t >= l.t && x.level !== "considered").sort((a, b) => a.t - b.t)[0];
    if (!later) continue;
    const into = `${later.lever}|act:${later.act}`;
    if (!groups.has(into)) continue;
    groups.set(into, [...groups.get(into)!, ...ls]);
    groups.delete(k);
    redrafted.add(into);
  }
  const election = outcomeOf({ election: seat.election, end_at: seat.end_at, ended: seat.ended ?? "unknown", moved: seat.amendments.some((a) => a.outcome === "applied") }).label.toLowerCase();
  const poll = firstPoll(seat);
  return [...groups].map(([gk, all]) => {
    const top = all.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a));
    const act = top.act !== undefined ? seat.acts[top.act] : undefined;
    const draftId = act?.draft ?? /^draft (.+)$/.exec(top.source)?.[1];
    const draft = draftId ? seat.drafts.find((d) => d.id === draftId) : undefined;
    const failure = top.source === "translator" ? seat.failures.find((f) => f.t === top.t) : undefined;
    const words = draft?.proposal || failure?.proposal || act?.proposal || top.words;
    const said = saidOf(seat, act, draft, top);
    const outcome = act ? (act.status === "applied" ? (top.stage && top.stage !== "applied" ? STAGE[top.stage] ?? top.stage : "took effect") : act.status === "refused" ? `refused by the town: ${(act.code ?? "").replace(/_/g, " ")}` : "sent, no outcome in the log") : top.stage ? STAGE[top.stage] ?? top.stage : top.level === "considered" ? "words only" : "—";
    const tone: Moment["outcomeTone"] = top.level === "executed" || outcome === "took effect" ? "ok" : /refused|held back|could not|rejected|asked back/.test(outcome) ? "no" : "wait";
    return { key, model: modelOf(seat), ...(seat.goal ? { goal: seat.goal } : {}), ...(seat.seed !== undefined ? { seed: seat.seed } : {}), lever: top, words, said,
      ...(draft?.note ? { note: draft.note } : {}), ...(act?.reasoning ? { reason: act.reasoning } : {}), outcome, outcomeTone: tone, also: all.filter((x) => x !== top), ...(redrafted.has(gk) ? { redrafted: true } : {}), election, ...(poll !== undefined ? { daysBefore: Math.floor(poll / 86_400) - Math.floor(top.t / 86_400) } : {}) };
  });
}

/** What a moment's act did, in one sentence of Lens's own: the story's clause for an act ("Appointed c0571 as newspaper
 * editor"), else what became of the request ("Drafted the appointment of c0571 as editor, then held it back"). */
function saidOf(seat: SeatJson, act: SeatAct | undefined, draft: SeatDraft | undefined, top: SeatLever): string {
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  if (act) {
    // (A job offered and signed in one act: who to, and the work, which the story's grouped clause leaves out.)
    const offer = act.blocks.find((b) => b?.block === "propose_agreement" && b.terms?.template === "employment");
    if (offer) {
      const to = (offer.terms.parties ?? []).filter((x: string) => x !== offer.speaks_for).join(", ");
      const task = (offer.terms.commitments ?? []).map((c: any) => c?.does?.outcome?.work?.task).find(Boolean);
      return `Offered ${to || "someone"} a job${task ? ` on the ${String(task).replace(/_/g, " ")}` : ""}${act.blocks.some((b) => b?.block === "sign_agreement") ? " and signed it for the town" : ""}.`;
    }
    const c = actClause(seat, act);
    const clause = c?.clause || (act.label ? act.label.charAt(0).toLowerCase() + act.label.slice(1) : "acted");
    return `${cap(clause)}.${c?.after ? ` ${c.after}` : ""}`;
  }
  const what = draft?.label ? ` (${draft.label.charAt(0).toLowerCase()}${draft.label.slice(1)})` : "";
  if (top.stage === "seat_declined") return `The clerk wrote up what the mayor asked for${what}, but the mayor held it back and sent nothing.`;
  if (top.stage === "translator_failed") return "It asked the clerk for this, but the clerk could not write it up; nothing was sent.";
  if (top.stage === "asked_back") return "It asked the clerk for this; the clerk asked back, and nothing was sent.";
  if (top.level === "considered") return "The idea came up in its thinking; it did nothing about it here.";
  return "It asked for this; nothing was sent.";
}

/** The card as a line to paste into a slide or a paper. */
export function citation(m: Moment): string {
  const l = m.lever;
  return `“${m.words}” (${m.model}${m.goal ? `, goal ${m.goal}` : ""}${m.seed !== undefined ? `, seed ${m.seed}` : ""}; day ${dayNo(l.day)}${daysToPoll(l) !== null ? `, ${daysToPoll(l)} days before the poll` : ""}). Reader: ${l.title}, ${l.level}; ${m.outcome}. Run ${m.key}.`;
}

/** What /api/moments answers: each indexed fork's moments (the reader's `considered` included; the page hides them). */
/** How the mayor spoke about the election in a run: its first words, in a turn, that mention it (else its first words). */
export interface Voice { text: string; day: number; sitting: number; t: number }
export function voiceOf(seat: SeatJson): Voice | undefined {
  const turns = seat.sittings.filter((s) => s.kind === "model" && s.words);
  const s = turns.find((x) => /\belect|\bpoll\b|\bvote|campaign|re-?election/i.test(x.words!)) ?? turns[0];
  return s ? { text: s.words!, day: s.day, sitting: s.i, t: s.t } : undefined;
}
export interface MomentsResponse { runs: { key: string; group?: string; id: string; moments: Moment[]; model?: string; voice?: Voice }[]; indexed: number; forks: number }
