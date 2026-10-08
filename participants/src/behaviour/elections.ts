// city.electoral_office: the town's electoral office (docs/behaviour/elections.md; docs/design/world-expansion.md 3.1).
// An election is people and records: the office keeps the roll from enrolments (and drops the dead and the departed),
// gives notice and takes nominations, publishes the roll and the ballot, takes votes it alone may see, counts them by
// the charter's method, publishes the result, and appoints the winner to the office. Who is elected is theirs.

import * as C from "../calls";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, say, type Step } from "./common";
import { stepper } from "./firms";

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
  keeps: [
    { what: "enrolment", why: "The electoral office keeps the roll: every elector's enrolment is lodged with it." },
    { what: "electoral_roll", why: "The roll it publishes at each election is its own." },
  ],
  version: "0.5.0", // 0.5.0: declares a result without seating the winner where the office is another body's (`seats`)
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
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- the roll: those who've enrolled, less the dead and those who've left ----
        const dead = new Set(book.open("death_registration").map((r) => r.data?.deceased as string));
        const left = new Set(book.open("departure").map((r) => r.speaks_for as string));
        const roll = () => [...new Set(book.open("enrolment").filter((e) => (e.addressed_to ?? []).includes(p.town)).map((e) => e.speaks_for as string))]
          .filter((x) => !dead.has(x) && !left.has(x)).sort();

        if (stage === "waiting" && t >= poll - p.nominations_open_days * DAY) {
          stage = "nominating";
          const st = because(`An election for ${p.office_title || p.office} on day ${Math.floor(poll / DAY)}: giving notice, and opening nominations.`,
            ["notice", say("election_notice", `Election notice: the office of ${p.office_title || p.office} falls vacant on day ${Math.floor(poll / DAY)}. Nominations close on day ${Math.floor((poll - p.nominations_close_days * DAY) / DAY)}; voting is by ${p.method === "preferential" ? "preference (number every candidate)" : "a single choice"}, and compulsory for those on the roll. Nominate with a statement of kind nomination to the town.`,
              { visible: "public", data: { office: p.office, poll_at: poll, nominations_close_at: poll - p.nominations_close_days * DAY, method: p.method } })]);
          st.then = (out) => { notice = out.created?.notice; };
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
                { visible: "public", data: { office: p.office, winner: who?.candidate, unopposed: !!who, candidates: names.length } }),
              ...(who && p.seats ? [C.call("position", { appoint: p.office, to: who.candidate })] : [])));
            stage = "waiting";
            poll += p.term_days * DAY;
            return steps;
          }
          stage = "voting";
          const r = roll();
          const st = because(`Nominations closed: ${names.length} candidates. Publishing the roll (${r.length}) and the ballot.`,
            // (The roll is the office's own: it is kept here and votes are checked against it. Nobody is sent it; an elector
            // knows they are on it by having enrolled.)
            say("electoral_roll", `The electoral roll for the election on day ${Math.floor(poll / DAY)}: ${r.length} electors.`, { visible: [p.town], data: { electors: r, poll_at: poll } }),
            ["ballot", say("ballot", `Ballot: ${p.office_title || p.office}. Candidates: ${names.map((x) => `${x.number}. ${x.name}`).join(", ")}. ${p.method === "preferential" ? "Rank them, first to last, as the choice: their numbers, in order, joined by > (2>1>3)." : "Choose one, by number."} Voting closes on day ${Math.floor(poll / DAY)}.`,
              { visible: "public", data: { office: p.office, electorate: "roll", candidates: names, method: p.method, opens_at: poll - p.voting_days * DAY, closes_at: poll, options: names.map((x) => x.number) } })]);
          st.then = (out) => { ballot = out.created?.ballot; };
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
              { visible: "public", basis: ballot, data: { ballot, office: p.office, winner, rounds, formal: last.size, electors: electors.size, turnout_bps: turnout } }),
            ...(winner && p.seats ? [C.call("position", { appoint: p.office, to: winner })] : [])));
          stage = "waiting";
          ballot = undefined;
          poll += p.term_days * DAY;
        }
        return steps;
      },
    );
  },
};
