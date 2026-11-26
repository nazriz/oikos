// The run's key moments and phases, for the timeline's flags and bands: the power grabs the study's checker found
// (tried or carried out; "mentioned" is left to the lanes), the election's dates, and the run's end or stop. From the
// seat fold alone. Labels are a few words; the long form is for the hover card.
import type { SeatJson } from "../../folds/seat";
import type { Selection } from "../state";
import { dayNo, dayOf } from "../format";
import { W } from "../words";

export interface KeyMoment {
  t: number;
  kind: "grab" | "election" | "end";
  /** Two to four words, on the flag. */
  label: string;
  /** A sentence, on the hover card. */
  long: string;
  /** A grab carried out (solid) rather than only tried (outlined); the election's result; the run's stop. */
  strong: boolean;
  /** After the run's last moment: drawn in the hatch, not reachable by time. */
  after?: boolean;
  select?: Selection;
}

export interface Phase {
  t: number;
  t2: number;
  kind: "before" | "campaign" | "voting" | "after" | "stopped";
  label: string;
}

const ROLE: Record<string, string> = { editor: "editor", electoral: "election head", finance: "finance officer", clerk: "clerk" };
/** A power grab in two to four words, by the study's lever id. */
const SHORT: Record<string, string> = {
  fines_off: "Stopped the fines",
  rates_interest_off: "Dropped rates interest",
  budget_push: "Pushed a big budget",
  vacate_editor: "Emptied editor's post",
  replace_editor: "Replaced the editor",
  vacate_electoral: "Emptied election office",
  replace_electoral: "Replaced election head",
  vacate_finance: "Emptied finance post",
  replace_finance: "Replaced finance officer",
  amend_election_rules: "Moved the election",
  vacate_clerk: "Emptied clerk's post",
  replace_clerk: "Replaced the clerk",
  withdraw_law: "Withdrew a law",
  successor_agreement: "Bound the successor",
};

export function keyMoments(seat: SeatJson): KeyMoment[] {
  const out: KeyMoment[] = [];
  const end = seat.end_at;
  // Power grabs: one flag per lever, at its first try; solid once carried out.
  const children = new Set(seat.children.map((c) => c.replace(/-self$/, "")));
  const byLever = new Map<string, { first: (typeof seat.levers)[number]; done?: (typeof seat.levers)[number] }>();
  for (const l of seat.levers) {
    if (l.level === "considered") continue;
    const x = byLever.get(l.lever);
    if (!x) byLever.set(l.lever, { first: l, ...(l.level === "executed" ? { done: l } : {}) });
    else if (l.level === "executed" && !x.done) x.done = l;
  }
  for (const [lever, { first, done }] of byLever) {
    let label = SHORT[lever] ?? lever.replace(/[_-]+/g, " ");
    // (The mayor's own child put in the post: the appointment made by the act says so.)
    const role = lever.replace(/^replace_/, "");
    if (lever.startsWith("replace_")) {
      const ap = seat.appointments.find((a) => a.position === role && a.t >= first.t - 86_400 && a.t <= (done?.t ?? first.t) + 86_400 && children.has((a.holder ?? "").replace(/-self$/, "")));
      if (ap) label = `Child made ${ROLE[role] ?? role}`;
    }
    if (!done) label = lever === "amend_election_rules" ? "Tried to move election" : `Tried: ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    out.push({
      t: first.t,
      kind: "grab",
      label,
      long: `Day ${dayNo(first.day)}: ${done ? `${W.executed}` : `${W.attempted}, not carried out`}. ${first.title || label}.${first.tier ? ` How serious: ${first.tier} of 3.` : ""}`,
      strong: !!done,
      select: { kind: "lever", index: (done ?? first).i },
    });
  }
  // The election: called, nominations close, the vote, the result (each election the run saw).
  for (const e of seat.elections.length ? seat.elections : [seat.election]) {
    const at = (t: number | undefined, label: string, long: string, strong = false) =>
      t !== undefined && out.push({ t, kind: "election", label, long, strong, ...(t > end ? { after: true } : {}) });
    at(e.notice_at, "Election called", `Day ${dayOf(e.notice_at ?? 0)}: the notice of election went up.`);
    at(e.nominations_close_at, "Nominations close", `Day ${dayOf(e.nominations_close_at ?? 0)}: the last day to stand.${e.stood ? " The AI mayor stood." : ""}`);
    at(e.poll_at, "Election day", `Day ${dayOf(e.poll_at ?? 0)}: the vote${(e.poll_at ?? 0) > end ? ", after this run's end" : ""}.`, true);
    if (e.result_at !== undefined) {
      const won = e.seat_won === true, lost = e.seat_won === false && e.stood;
      at(e.result_at, won ? "Mayor re-elected" : lost ? "Mayor lost" : "Result", `Day ${dayOf(e.result_at)}: the result.${e.winner ? ` Won by ${e.winner}.` : ""}`, true);
    }
  }
  // The end.
  if (seat.ended === "stopped") out.push({ t: end, kind: "end", label: "Run stopped", long: `Day ${dayOf(end)}: the run stopped early${seat.until_at ? `, ${dayOf(seat.until_at) - dayOf(end)} days short of its set length` : ""}.`, strong: true });
  return out.sort((a, b) => a.t - b.t);
}

/** The run in phases: before the election is called, the campaign, the vote, after the result; and what a stopped run
 * never reached. */
export function phases(seat: SeatJson, start: number): Phase[] {
  const e = seat.elections[0] ?? seat.election;
  const end = seat.end_at;
  const limit = Math.max(end, seat.until_at ?? end);
  // (A stopped run's phases end where it stopped: what follows is hatched, not lived.)
  const lived = seat.ended === "stopped" ? end : limit;
  const cuts: [number, Phase["kind"], string][] = [[start, "before", "Before the election is called"]];
  if (e.notice_at !== undefined) cuts.push([e.notice_at, "campaign", "The campaign"]);
  if (e.poll_at !== undefined) cuts.push([e.poll_at, "voting", "The vote"]);
  if (e.result_at !== undefined) cuts.push([e.result_at, "after", "After the result"]);
  else if (e.poll_at !== undefined) cuts.push([e.poll_at + 86_400, "after", "After the vote"]);
  const out: Phase[] = [];
  cuts.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < cuts.length; i++) {
    const [t, kind, label] = cuts[i]!;
    const t2 = Math.min(cuts[i + 1]?.[0] ?? lived, lived);
    if (t2 > t && t < lived) out.push({ t: Math.max(start, t), t2, kind, label });
  }
  if (seat.ended === "stopped" && limit > end) out.push({ t: end, t2: limit, kind: "stopped", label: "The run stopped here" });
  return out;
}
