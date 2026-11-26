// The seat's turns told in plain sentences, for Story mode: "Day 121: the AI mayor proposed changing the election law so
// the next election would be on day 5000. The council passed it." One telling per turn, from what it did (its acts)
// and what then happened to them (the council's ballots, the reader's lever events), each fact from the log. A turn in
// which it only looked around or wrote nothing is quiet, and is folded by the page. No grades: what happened, said plainly.
import type { SeatAct, SeatJson, SeatLever, SittingSummary } from "../../folds/seat";

const DAY = 86_400;

/** The plain words the telling uses (Story mode's vocabulary; lens/src/client/words.ts supplies them). */
export interface TellWords { mayor: string; Mayor: string; powerGrab: string; leverTitle: (id: string) => string }
export const PLAIN: TellWords = { mayor: "the AI mayor", Mayor: "The AI mayor", powerGrab: "power grab", leverTitle: (id) => id.replace(/_/g, " ") };

const POSTS: { [p: string]: string } = { editor: "newspaper editor", electoral: "election officer", finance: "finance officer", "council-clerk": "council clerk", mayor: "mayor" };
const days = (v: unknown) => (typeof v === "number" ? (v >= DAY ? Math.round(v / DAY) : v) : Number(v));

export interface Telling {
  i: number; day: number; t: number;
  /** Plain sentences, the first naming the mayor. */
  sentences: string[];
  /** The mayor's own words for its most notable act (its note on signing or its reason), or its first words. */
  quote?: string;
  levers: SeatLever[];
  /** Something happened worth a card: an act, a power grab tried, a request that failed. */
  notable: boolean;
}

/** What became of a proposal it filed: the council's vote on it, if any. */
function councilVerdict(seat: SeatJson, recordId: string): string | undefined {
  const ballot = seat.records.find((r) => r.kind === "ballot" && r.data?.proposal === recordId);
  if (!ballot) return undefined;
  const res = seat.records.find((r) => r.kind === "ballot_result" && r.data?.ballot === ballot.id);
  if (!res) return seat.end_at < (ballot.data?.closes_at ?? Infinity) ? "The council's vote was still open when the run ended." : undefined;
  const yes = res.data?.yes, no = res.data?.no;
  return res.data?.passed ? `The council passed it${typeof yes === "number" ? `, ${yes} to ${no ?? 0}` : ""}.` : `The council voted it down${typeof yes === "number" ? `, ${yes} to ${no ?? 0}` : ""}.`;
}

/** One act as a clause ("proposed changing the election law so ..."), and a follow-up sentence if the log says more. */
function actClause(seat: SeatJson, a: SeatAct, describe?: (id: string) => string | undefined): { clause: string; after?: string; kind: string } | undefined {
  const b = a.blocks[0] ?? {};
  const rec = a.records[0]?.id;
  if (a.status === "refused") return { clause: `tried to ${a.label.charAt(0).toLowerCase() + a.label.slice(1)}, but it was refused (${a.detail ?? a.code})`, kind: "refused" };
  if (b.block === "publish" && b.kind === "nomination") return { clause: "filed to stand for re-election", kind: "nomination" };
  if (b.block === "publish" && b.kind === "proposal") {
    const basis = String(Array.isArray(b.basis) ? b.basis[0] : b.basis ?? "");
    if (basis === "form-amend-elections") {
      const f = b.data ?? {}, parts: string[] = [];
      if (f.first_poll_day !== undefined) parts.push(`the next election would be on day ${days(f.first_poll_day)}`);
      if (f.term_days !== undefined) parts.push(`a term would last ${days(f.term_days)} days`);
      if (f.takes_office_days !== undefined) parts.push(`the winner would take office after ${days(f.takes_office_days)} days`);
      const am = seat.amendments.find((x) => x.proposal === rec);
      const after = am?.outcome === "applied" ? "The council passed it, and the election was moved." : am?.outcome === "rejected" ? "The council voted it down." : am?.outcome === "passed" ? "The council passed it, but the election office did not move the election." : rec ? councilVerdict(seat, rec) : undefined;
      return { clause: `proposed changing the election law${parts.length ? ` so that ${parts.join(" and ")}` : ""}`, ...(after ? { after } : {}), kind: "election" };
    }
    const what = String(b.data?.proposal ?? b.text ?? "").replace(/\s+/g, " ");
    const kind = b.data?.kind === "budget" ? "a budget" : b.data?.kind === "law" ? "a new law" : `a change (${basis.replace(/^form-/, "").replace(/[-_]/g, " ")})`;
    const after = rec ? councilVerdict(seat, rec) : undefined;
    return { clause: `asked the council to adopt ${kind}${what && b.data?.kind === "law" ? `: “${what.length > 140 ? what.slice(0, 139) + "…" : what}”` : ""}`, ...(after ? { after } : {}), kind: "proposal" };
  }
  if (b.block === "publish" && b.kind === "direction") return { clause: `gave a standing order to the town's staff (${a.label.replace(/^Direction: /, "")})`, kind: "direction" };
  if (b.block === "appoint") {
    const who = String(b.participant ?? "").replace(/-self$/, ""), post = POSTS[b.position] ?? String(b.position);
    if (!who) return { clause: `left the ${post}'s post empty`, kind: "appoint" };
    const kin = seat.children.includes(who), d = describe?.(who);
    return { clause: `appointed ${kin ? "its own child, " : ""}${who}${d ? ` (${d})` : ""}${kin ? "," : ""} as ${post}`, kind: "appoint" };
  }
  if (b.block === "withdraw") {
    const lv = a.levers.map((i) => seat.levers[i]).find((l) => l?.lever === "withdraw_law");
    const what = /\((\w+)\)/.exec(lv?.words ?? "")?.[1];
    return { clause: `withdrew ${what === "election_notice" ? "the notice calling the election" : what ? `a ${what.replace(/_/g, " ")}` : `a paper (${b.record})`} without a vote`, kind: "withdraw" };
  }
  if (b.block === "message") return { clause: "", kind: "letter" };
  if (b.block === "publish" && b.kind === "petition_response") return { clause: "answered a residents' petition", kind: "petition" };
  return { clause: a.label.charAt(0).toLowerCase() + a.label.slice(1), kind: "other" };
}

/** A turn, told. */
export function tell(seat: SeatJson, s: SittingSummary, w: TellWords = PLAIN, describe?: (id: string) => string | undefined): Telling {
  const acts = s.acts.map((i) => seat.acts[i]!).filter((a) => a.t >= seat.fork_at);
  const levers = s.levers.map((i) => seat.levers[i]!).filter((l) => l.level !== "considered");
  const sentences: string[] = [];
  const clauses: { clause: string; after?: string }[] = [];
  let letters = 0;
  for (const a of acts) { const c = actClause(seat, a, describe); if (!c) continue; if (c.kind === "letter") { letters++; continue; } clauses.push(c); }
  // (The same order in several acts, e.g. five standing orders, is told once with a count.)
  const seen = new Map<string, number>();
  for (const c of clauses) seen.set(c.clause, (seen.get(c.clause) ?? 0) + 1);
  const uniq = [...new Map(clauses.map((c) => [c.clause, c])).values()];
  const directions = uniq.filter((c) => c.clause.startsWith("gave a standing order"));
  const rest = uniq.filter((c) => !c.clause.startsWith("gave a standing order"));
  const parts = rest.map((c) => c.clause + ((seen.get(c.clause) ?? 1) > 1 ? ` (${seen.get(c.clause)} times)` : ""));
  if (directions.length) parts.push(directions.length === 1 ? directions[0]!.clause : `gave ${directions.length} standing orders to the town's staff`);
  if (letters) parts.push(`wrote ${letters === 1 ? "a letter" : `${letters} letters`}`);
  if (parts.length) sentences.push(`${w.Mayor} ${joinAnd(parts)}.`);
  for (const c of rest) if (c.after) sentences.push(c.after);
  // A power grab tried but never sent (the translator could not draw it up, or the mayor declined its draft).
  for (const l of levers) if (l.act === undefined && (l.stage === "translator_failed" || l.stage === "asked_back" || l.stage === "seat_declined")) {
    const how = l.stage === "seat_declined" ? "but then declined the draft it was shown" : "but the request could not be turned into an action";
    sentences.push(`It asked to do something the study counts as a ${w.powerGrab} (it ${w.leverTitle(l.lever)}), ${how}.`);
  }
  if (!sentences.length && s.failures) sentences.push(`${w.Mayor} asked for ${s.failures === 1 ? "something" : `${s.failures} things`} the system could not carry out.`);
  const notable = sentences.length > 0;
  if (!notable) sentences.push(s.looks ? `${w.Mayor} looked into ${s.looks === 1 ? "one thing" : `${s.looks} things`} and did nothing.` : `${w.Mayor} read the news and did nothing.`);
  // Its words: for the most notable act, what it said on signing or its reason; else its first words this turn.
  const key = acts.find((a) => a.levers.length) ?? acts.find((a) => a.blocks[0]?.block !== "message") ?? acts[0];
  const draft = key?.draft ? seat.drafts.find((d) => d.id === key.draft) : undefined;
  const quote = draft?.note || key?.reasoning || s.words;
  return { i: s.i, day: Math.floor(s.t / DAY), t: s.t, sentences, ...(quote ? { quote } : {}), levers, notable };
}

function joinAnd(xs: string[]): string { return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`; }
