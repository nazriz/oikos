// The count of a council's ballots, as whoever keeps them reads it from the votes on file (docs/behaviour/government.md,
// "A ballot's count"). A code clerk counts from its own book; a person in the clerk's seat was shown each vote as it
// came, a few at a sitting, and had to keep the running count in its head: in a pilot a clerk declared 4 for where 5
// had voted, because one vote had come twelve days before the count (wave 2b). The votes on its own body's ballots are
// its own papers, so the whole count of each ballot not yet declared is set out for it at every sitting where it has
// changed: the latest vote of each post, cast while the ballot was open, as the council's standing orders count them.
// A councillor is shown its own vote on file the same way. Nothing is asked of the engine: it is read from what the
// seat has been shown (`mine`).

import type { Observation } from "../contracts";
import { dateWords } from "../forms";
import { Book } from "../shared/common";

const DAY = 86_400;
const moment = (t: number): string => {
  const s = ((t % DAY) + DAY) % DAY;
  const two = (x: number) => String(x).padStart(2, "0");
  return s === 0 ? dateWords(t) : `${dateWords(t)}, ${two(Math.floor(s / 3_600))}:${two(Math.floor((s % 3_600) / 60))}`;
};

export interface BallotCount {
  ballot: string;
  proposal?: string;
  closes_at?: number;
  closed: boolean;
  /** The latest vote of each post, cast while the ballot was open: post -> its choice as cast, and the vote's id. */
  latest: { post: string; choice: string; vote: string; at: number }[];
  /** Votes on it in all, counted or not (one post may have voted several times). */
  cast: number;
  /** Votes cast at or after its closing time, or in no post: on file, and not counted. */
  late: number;
  outside: number;
}

export class Tally {
  private readonly book = new Book();
  /** `entity`: the body whose ballots these are. `post`: a member's own post, where the seat is a member and not the keeper. */
  constructor(private readonly entity: string, private readonly post?: string) {}

  absorb(obs: Observation): void {
    this.book.absorb(obs);
  }

  /** Each ballot of the body's own that has no result declared yet, as the votes on file count. */
  counts(t: number): BallotCount[] {
    const declared = new Set(this.book.open("ballot_result").filter((r) => r.speaks_for === this.entity).map((r) => String(r.data?.ballot)));
    const ballots = this.book.open("ballot").filter((b) => b.speaks_for === this.entity && b.data?.electorate === "council" && b.data?.closed !== true && !declared.has(b.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const votes = this.book.ofType("vote");
    return ballots.map((b) => {
      const closes: number | undefined = Number.isSafeInteger(b.data?.closes_at) ? b.data!.closes_at : undefined;
      const on = votes.filter((v) => v.ballot === b.id).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
      const latest = new Map<string, { post: string; choice: string; vote: string; at: number }>();
      let late = 0, outside = 0;
      for (const v of on) {
        if (!v.in_position) outside++;
        else if (closes !== undefined && v.at >= closes) late++;
        else latest.set(v.in_position, { post: v.in_position, choice: v.choice, vote: v.id, at: v.at });
      }
      return { ballot: b.id, ...(typeof b.data?.proposal === "string" ? { proposal: b.data.proposal } : {}), ...(closes !== undefined ? { closes_at: closes } : {}),
        closed: b.data?.closed === true || (closes !== undefined && t >= closes), latest: [...latest.values()].sort((x, y) => (x.post < y.post ? -1 : 1)), cast: on.length, late, outside };
    });
  }

  /** The count as the seat reads it; nothing where it has no ballot waiting for a result. */
  text(t: number, title: string): string {
    const counts = this.counts(t);
    if (!counts.length) return "";
    const when = (c: BallotCount) => (c.closes_at === undefined ? (c.closed ? "closed" : "open") : c.closed ? `closed ${moment(c.closes_at)}` : `open until ${moment(c.closes_at)}`);
    if (this.post) {
      // A member: its own vote on file on each ballot, and no more.
      return [`## ${title}: Your own votes on file, on the council's ballots not yet declared`,
        ...counts.map((c) => {
          const mine = c.latest.find((x) => x.post === this.post);
          return `- ${c.ballot}${c.proposal ? ` (on ${c.proposal})` : ""}, ${when(c)}: ${mine ? `your vote on file is "${mine.choice}" (${mine.vote}, cast ${moment(mine.at)}). It is the one that counts unless you cast another before the ballot closes.` : c.closed ? "no vote of yours is on file, and the ballot is closed." : "no vote of yours is on file yet."}`;
        })].join("\n");
    }
    return [`## ${title}: The count on each ballot of the council not yet declared, from every vote on file`,
      ...counts.map((c) => {
        const by = new Map<string, string[]>();
        for (const v of c.latest) { const k = v.choice.trim().toLowerCase(); by.set(k, [...(by.get(k) ?? []), v.post]); }
        const said = [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([choice, posts]) => `${choice} ${posts.length} (${posts.join(", ")})`).join("; ") || "no votes";
        const more = [c.cast > c.latest.length + c.late + c.outside ? `${c.cast - c.latest.length - c.late - c.outside} earlier vote${c.cast - c.latest.length - c.late - c.outside === 1 ? "" : "s"} replaced by the same post's later one` : "", c.late ? `${c.late} cast at or after it closed, not counted` : "", c.outside ? `${c.outside} cast in no post, not counted` : ""].filter(Boolean).join("; ");
        return `- ${c.ballot}${c.proposal ? ` (on ${c.proposal})` : ""}, ${when(c)}: ${c.latest.length} post${c.latest.length === 1 ? " has" : "s have"} voted: ${said}.${more ? ` (${c.cast} votes on file in all: ${more}.)` : ""}${c.closed ? " It is closed and no result is declared yet." : ""}`;
      }),
      "(This is every vote on file for each, the latest of each post cast while the ballot was open: the whole count, not only what came since you last sat.)"].join("\n");
  }
}
