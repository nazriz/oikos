// city.electoral_office: the town's electoral office (docs/behaviour/elections.md; docs/design/world-expansion.md 3.1).
// An election is people and records: the office keeps the roll from enrolments (and drops the dead and the departed),
// gives notice and takes nominations, publishes the roll and the ballot, takes votes it alone may see, counts them by
// the charter's method, publishes the result, and appoints the winner to the office. Who is elected is theirs.

import * as C from "../calls";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { dateWords } from "../forms";
import { because, Book, DAY, message, say, type Step } from "./common";
import { stepper } from "./firms";
import * as P from "./papers";

/** Instant runoff: each round, the candidate fewest rank first is out, until one has a majority of the ballots still
 * counting. Ties go out together if they're all of the last; otherwise the first in id order. */
export function instantRunoff(candidates: string[], rankings: string[][]): { winner?: string; rounds: { [c: string]: number }[] } {
  let standing = [...candidates].sort();
  const rounds: { [c: string]: number }[] = [];
  while (standing.length) {
    const tally: { [c: string]: number } = Object.fromEntries(standing.map((c) => [c, 0]));
    let counting = 0;
    for (const r of rankings) {
      const first = r.find((c) => standing.includes(c));
      if (first) {
        tally[first]! += 1;
        counting += 1;
      }
    }
    rounds.push(tally);
    const [top] = [...standing].sort((a, b) => tally[b]! - tally[a]! || (a < b ? -1 : 1));
    if (!top || counting === 0) return { rounds };
    if (tally[top]! * 2 > counting || standing.length === 1) return { winner: top, rounds };
    const least = Math.min(...standing.map((c) => tally[c]!));
    const out = standing.filter((c) => tally[c] === least);
    standing = out.length === standing.length ? standing.slice(1) : standing.filter((c) => !out.includes(c));
  }
  return { rounds };
}

export const electoralOffice: BehaviourModule = {
  name: "city.electoral_office",
  answers: {"office": "the electoral office", "acts": "What it acts on: a nomination for an office it has given notice of an election for, lodged before nominations close; and a vote cast on its ballot while the poll is open."},
  issues: P.ELECTORAL,
  keeps: [
    { what: "enrolment", why: "The electoral office keeps the roll: every elector's enrolment is lodged with it." },
    { what: "electoral_roll", why: "The roll it publishes at each election is its own." },
  ],
  version: "0.7.0", // 0.7.0: where the election stands is read from the office's own file (a successor carries on; results carry their poll day), and a refused notice, ballot or result is tried again; 0.6.0: a vote cast after the poll closed is answered (not counted, as before); 0.5.0: declares a result without seating the winner where the office is another body's (`seats`)
  doc: "docs/behaviour/elections.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      office: "", // the position elected (the world must say)
      office_title: "",
      term_days: 4 * 365, // the charter's term (the world gives it)
      first_poll_day: 365, // the first polling day (the world gives it)
      nominations_open_days: 60, // before polling day
      nominations_close_days: 30,
      voting_days: 14, // the ballot is open this long, ending on polling day
      method: "preferential" as "preferential" | "plurality",
      town: ctx.entity, // with whom electors enrol and candidates nominate: the electoral body itself
      // Whether it seats the winner itself (the office is its own organisation's), or only declares the result and
      // leaves the office's own organisation to seat whoever was elected (the world says which).
      seats: true,
    }, ctx.params);
    need(p, ["office"], "city.electoral_office");
    const book = new Book();
    let poll = p.first_poll_day * DAY;
    let stage: "waiting" | "nominating" | "voting" = "waiting";
    let notice: string | undefined;
    let ballot: string | undefined;
    // The office's own file: what it has put on record in this position, whoever held it then. Where the election stands is
    // read from it, never kept only in a holder's memory, so whoever takes the office carries on where it left off.
    const ours = (r: { author: string; in_position?: string }) => (ctx.position ? r.in_position === ctx.position : r.author === ctx.participant);
    const filed = (kind: string) => book.open(kind).filter((r: any) => ours(r) && r.data?.office === p.office);
    // Its ballots that have closed, and when; and how many of the votes it has been shown it has looked at since (a
    // vote cast after the poll closed is not counted, and its caster is told so: nothing of how anyone voted).
    const pollsClosed = new Map<string, number>();
    let votesRead = 0;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- where the election stands, from the file: results declared move the poll on a term each; a notice or a
        // ballot filed for this poll puts the office at that stage ----
        const results = filed("ballot_result");
        let filePoll = p.first_poll_day * DAY;
        while (results.some((r: any) => r.data?.poll_at === filePoll)) filePoll += p.term_days * DAY;
        if (filePoll > poll) { poll = filePoll; stage = "waiting"; notice = undefined; ballot = undefined; }
        if (!notice) {
          const n = filed("election_notice").filter((r: any) => r.data?.poll_at === poll).sort((a: any, x: any) => x.at - a.at)[0];
          if (n) { notice = n.id; if (stage === "waiting") stage = "nominating"; }
        }
        if (!ballot) {
          const b = filed("ballot").filter((r: any) => r.data?.closes_at === poll).sort((a: any, x: any) => x.at - a.at)[0];
          if (b) { ballot = b.id; stage = "voting"; }
        }
        // ---- the roll: those who've enrolled, less the dead and those who've left ----
        const dead = new Set(book.open("death_registration").map((r) => r.data?.deceased as string));
        const left = new Set(book.open("departure").map((r) => r.speaks_for as string));
        const roll = () => [...new Set(book.open("enrolment").filter((e) => (e.addressed_to ?? []).includes(p.town)).map((e) => e.speaks_for as string))]
          .filter((x) => !dead.has(x) && !left.has(x)).sort();

        if (stage === "waiting" && t >= poll - p.nominations_open_days * DAY) {
          const st = because(`An election for ${p.office_title || p.office} on day ${Math.floor(poll / DAY)}: giving notice, and opening nominations.`,
            ["notice", say("election_notice", `Election notice: the office of ${p.office_title || p.office} falls vacant on day ${Math.floor(poll / DAY)}. Nominations close on day ${Math.floor((poll - p.nominations_close_days * DAY) / DAY)}; voting is by ${p.method === "preferential" ? "preference (number every candidate)" : "a single choice"}, and compulsory for those on the roll. Nominate with a statement of kind nomination to the town.`,
              { visible: "public", data: { office: p.office, poll_at: poll, nominations_close_at: poll - p.nominations_close_days * DAY, method: p.method } })]);
          st.then = (out) => { if (out.status === "applied") { stage = "nominating"; notice = out.created?.notice; } };
          steps.push(st);
        }
        if (stage === "nominating" && t >= poll - p.nominations_close_days * DAY) {
          // The candidates: valid nominations for this office, made since the notice (one each).
          const since = notice ? book.records.get(notice)?.at ?? 0 : 0;
          const noms = book.open("nomination").filter((n) => n.at >= since && n.data?.office === p.office && (n.addressed_to ?? []).includes(p.town));
          const candidates = [...new Map(noms.map((n) => [n.author as string, n])).values()].sort((a, b) => (a.author < b.author ? -1 : 1));
          // (Each candidate's number on the ballot paper, in order: a vote ranks the numbers, as on a real ballot.)
          const names = candidates.map((n, i) => ({ candidate: n.author as string, number: String(i + 1), for: n.speaks_for as string, name: (n.data?.name as string) ?? (n.speaks_for as string), nomination: n.id }));
          // One candidate: elected unopposed, with no ballot. None: no one elected (the office stays as it is).
          if (names.length <= 1) {
            const who = names[0];
            steps.push(because(who ? `Nominations closed: one candidate, ${who.name}, elected unopposed.` : "Nominations closed: no candidates; no one is elected.",
              say("ballot_result", `Election result, ${p.office_title || p.office}: ${who ? `${who.name} elected unopposed` : "no one nominated; no one elected"}.`,
                { visible: "public", data: { office: p.office, poll_at: poll, winner: who?.candidate, unopposed: !!who, candidates: names.length } }),
              ...(who && p.seats ? [C.call("position", { appoint: p.office, to: who.candidate })] : [])));
            // (The office moves on once the result is on record; a result refused is tried again.)
            steps[steps.length - 1]!.then = (out) => { if (out.status === "applied") { stage = "waiting"; notice = undefined; poll += p.term_days * DAY; } };
            return steps;
          }
          const r = roll();
          const st = because(`Nominations closed: ${names.length} candidates. Publishing the roll (${r.length}) and the ballot.`,
            // (The roll is the office's own: it is kept here and votes are checked against it. Nobody is sent it; an elector
            // knows they are on it by having enrolled.)
            say("electoral_roll", `The electoral roll for the election on day ${Math.floor(poll / DAY)}: ${r.length} electors.`, { visible: [p.town], data: { electors: r, poll_at: poll } }),
            ["ballot", say("ballot", `Ballot: ${p.office_title || p.office}. Candidates: ${names.map((x) => `${x.number}. ${x.name}`).join(", ")}. ${p.method === "preferential" ? "Rank them, first to last, as the choice: their numbers, in order, joined by > (2>1>3)." : "Choose one, by number."} Voting closes on day ${Math.floor(poll / DAY)}.`,
              { visible: "public", data: { office: p.office, electorate: "roll", candidates: names, method: p.method, opens_at: poll - p.voting_days * DAY, closes_at: poll, options: names.map((x) => x.number) } })]);
          st.then = (out) => { if (out.status === "applied") { stage = "voting"; ballot = out.created?.ballot; } };
          steps.push(st);
        }
        if (stage === "voting" && ballot && t >= poll) {
          const b = book.records.get(ballot) as any;
          const candidates: string[] = b?.data?.options ?? []; // (their numbers on the ballot)
          const byNumber = new Map(((b?.data?.candidates ?? []) as { candidate: string; number?: string }[]).map((c) => [c.number ?? c.candidate, c.candidate]));
          const electors = new Set((book.open("electoral_roll").sort((a, x) => x.at - a.at)[0]?.data?.electors as string[] | undefined) ?? []);
          // Each elector's last vote on this ballot, if it ranks the candidates (others are informal), made while the
          // ballot was open: one made before it opened, or at or after its close (before we came to count), isn't
          // counted. (Until 0.3.1 both were.)
          const opens = Number(b?.data?.opens_at ?? -Infinity), closes = Number(b?.data?.closes_at ?? Infinity);
          const last = new Map<string, string[]>();
          for (const v of book.ofType("vote").filter((v: any) => v.ballot === ballot).sort((a, x) => a.at - x.at) as any[]) {
            if (!electors.has(v.speaks_for) || v.at < opens || v.at >= closes) continue;
            const ranking = String(v.choice).split(">").map((x) => x.trim()).filter((x) => candidates.includes(x));
            if (ranking.length) last.set(v.speaks_for, p.method === "plurality" ? ranking.slice(0, 1) : ranking);
          }
          const counted = instantRunoff(candidates, [...last.values()]);
          const winner = counted.winner ? byNumber.get(counted.winner) : undefined;
          const rounds = counted.rounds.map((r) => Object.fromEntries(Object.entries(r).map(([n, v]) => [byNumber.get(n) ?? n, v])));
          const who = (b?.data?.candidates ?? []).find((c: any) => c.candidate === winner);
          const turnout = electors.size ? Math.round((last.size * 10_000) / electors.size) : 0;
          steps.push(because(`Polling day: counting ${last.size} formal votes of ${electors.size} electors${winner ? `; ${who?.name ?? winner} is elected` : ": nobody is elected"}.`,
            say("ballot_result", `Election result, ${p.office_title || p.office}: ${winner ? `${who?.name ?? winner} elected` : "no one elected"}; ${last.size} formal votes of ${electors.size} on the roll (turnout ${turnout / 100}%).`,
              { visible: "public", basis: ballot, data: { ballot, office: p.office, poll_at: poll, winner, rounds, formal: last.size, electors: electors.size, turnout_bps: turnout } }),
            ...(winner && p.seats ? [C.call("position", { appoint: p.office, to: winner })] : [])));
          const counted_ballot = ballot;
          steps[steps.length - 1]!.then = (out) => {
            if (out.status !== "applied") return;
            pollsClosed.set(counted_ballot, closes);
            stage = "waiting";
            ballot = undefined;
            notice = undefined;
            poll += p.term_days * DAY;
          };
        }
        const votes = book.ofType("vote");
        for (const v of votes.slice(votesRead)) {
          const closedAt = pollsClosed.get(v.ballot);
          if (closedAt === undefined || v.at < closedAt || v.author === "genesis") continue;
          steps.push(because(`A vote on ${v.ballot}, cast after the poll closed: not counted, and saying so.`,
            message([v.author], `From the electoral office: your vote on ${v.ballot} is not counted. The poll closed on ${dateWords(closedAt)} and the result is declared.`, v.id)));
        }
        votesRead = votes.length;
        return steps;
      },
    );
  },
};
