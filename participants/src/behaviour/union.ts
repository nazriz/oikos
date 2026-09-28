// union.organiser: a trade union's organiser (phase C, stage C5). Documented in docs/behaviour/unions.md, with sources.
//
// A union is an organisation workers join (membership: dues by standing order). Its organiser bargains with each
// employer where it has members, once a year: a claim for the year's rise in prices and a margin. An offer of at least
// a share of the claim is accepted, and the employer makes it an enterprise agreement. Otherwise, protected action as
// labour law commonly has it (the world's figures; the sources are in the doc): a ballot of the members there (enough
// voting, a majority yes), notice to the employer, then stoppages, longer each time, until an offer it accepts.

import * as C from "../calls";
import type { StatementRecord } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, MONTH, offer, pay, say, type Step } from "./common";
import { stepper } from "./firms";

interface Dispute {
  stage: "claimed" | "settling" | "balloting" | "notified" | "striking";
  claim?: string;
  claimBps: number;
  since: number; // when this stage began
  ballot?: string;
  closes?: number;
  from?: number; // a stoppage: from when, until when
  until?: number;
  stoppages: number;
  members: string[];
}

export const organiser: BehaviourModule = {
  name: "union.organiser",
  version: "0.1.0",
  doc: "docs/behaviour/unions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params(
      {
        employers: [] as string[], // whom it bargains with, where it has members
        claim_margin_bps: 0, // claimed over the year's rise in prices (the world's profile)
        accept_share_bps: 5000, // an offer of at least this share of the claim is accepted (placeholder)
        bargain_every_days: 365,
        first_claim_days: 60, // its first claims, spread over this long (placeholder)
        respond_days: 14, // an offer awaited this long before balloting
        ballot_days: 10,
        ballot_turnout_bps: 5000, // at least this share of the members voting (the law's)
        ballot_pass_bps: 5000, // more than this share of the votes yes (the law's)
        notice_days: 3, // notice of action (the law's)
        stoppage_days: [1, 2, 3] as number[], // each stoppage, longer each time (placeholder)
        between_days: 7, // after a stoppage, an improved offer awaited this long before the next
        price_kind: "goods", // prices tracked for the claim (shops' price lists)
        dues: 0, // cents a month (the world's profile)
        dues_account: "",
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const disputes = new Map<string, Dispute>(); // employer -> the dispute in hand
    const agreedAt = new Map<string, number>(); // employer -> when it last agreed
    const employerOf = new Map<string, string>(); // member -> their employer, as the union has it
    const prices: { t: number; mean: number }[] = []; // the mean shop price, monthly
    const handled = new Set<string>();
    const stagger = new Map(p.employers.map((e, i) => [e, Math.floor(((i + 1) * p.first_claim_days * DAY) / Math.max(1, p.employers.length))]));
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // Members: the register at the start, and those who've joined since (membership agreements in force).
        for (const r of book.all("membership_register")) for (const m of (r.data?.members as { member: string; employer: string }[]) ?? []) if (!employerOf.has(m.member)) employerOf.set(m.member, m.employer);
        const inForce = new Set([...book.records.values()].filter((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties[0] === me && book.inForce(r.id)).map((r: any) => r.terms.parties[1] as string));
        // Applications to join: a membership offered, its dues by standing order.
        for (const a of book.open("membership_application")) {
          if (handled.has(a.id) || !(a.addressed_to ?? []).includes(me)) continue;
          handled.add(a.id);
          const who = a.speaks_for!;
          if (typeof a.data?.employer === "string") employerOf.set(who, a.data.employer);
          if (inForce.has(who)) continue;
          steps.push(because(`${who} asks to join: offering membership, ${p.dues} cents a month in dues.`,
            offer(who, { template: "membership", ourNotice: MONTH, we: C.text(`${me} represents ${who} at work, and bargains for them.`) as any,
              they: pay(p.dues_account, p.dues, { every: MONTH, for: "Union dues." }), text: `${who} is a member of ${me}, paying dues of ${p.dues} cents a month.`, basis: a.id })));
        }
        const membersAt = (employer: string) => [...employerOf].filter(([m, e]) => e === employer && inForce.has(m)).map(([m]) => m).sort();

        // Prices: the mean of the shops' published prices, once a month.
        if (!prices.length || t - prices.at(-1)!.t >= MONTH) {
          const lists = book.open("price_list").filter((r) => typeof r.data?.goods?.[p.price_kind] === "number" && !r.data?.min_order);
          if (lists.length) prices.push({ t, mean: lists.reduce((x, r) => x + (r.data!.goods[p.price_kind] as number), 0) / lists.length });
        }
        const yearAgo = [...prices].reverse().find((x) => t - x.t >= 365 * DAY);
        const inflation = yearAgo && prices.length ? Math.round(((prices.at(-1)!.mean - yearAgo.mean) * 10_000) / yearAgo.mean) : 0;

        for (const employer of p.employers) {
          const members = membersAt(employer);
          const d = disputes.get(employer);
          const addressedToUs = (kind: string) => book.open(kind).filter((r) => !handled.has(r.id) && (r.addressed_to ?? []).includes(me) && r.data?.employer === employer);
          // An enterprise agreement made: the dispute's over.
          for (const ea of addressedToUs("enterprise_agreement")) {
            handled.add(ea.id);
            disputes.delete(employer);
            agreedAt.set(employer, t);
          }
          if (!disputes.has(employer)) {
            const due = t >= (stagger.get(employer) ?? 0) && t - (agreedAt.get(employer) ?? -Infinity) >= p.bargain_every_days * DAY;
            if (!due || !members.length) continue;
            const claimBps = Math.max(0, inflation) + p.claim_margin_bps;
            disputes.set(employer, { stage: "claimed", claimBps, since: t, stoppages: 0, members });
            steps.push(because(`Bargaining for our ${members.length} member${members.length > 1 ? "s" : ""} at ${employer}: claiming ${claimBps / 100}% (prices up ${Math.max(0, inflation) / 100}% on a year ago, and ${p.claim_margin_bps / 100}% more).`,
              ["claim", say("wage_claim", `A claim for a wage rise of ${claimBps / 100}% for everyone at ${employer}.`, { to: [employer], visible: [me, employer], data: { employer, rise_bps: claimBps, members: members.length } })]));
            const st = steps.at(-1)!;
            st.then = (out) => { const id = out.created?.claim; if (id) disputes.get(employer)!.claim = id; };
            continue;
          }
          const x = d!;
          // An offer: accepted if it's enough; otherwise (and if none comes) to a ballot, or the next stoppage.
          const offers = addressedToUs("wage_offer").filter((o) => o.data?.claim === x.claim);
          const best = offers.sort((a, b) => b.at - a.at)[0];
          for (const o of offers) handled.add(o.id);
          const enough = (o: StatementRecord) => Number(o.data?.rise_bps) * 10_000 >= x.claimBps * p.accept_share_bps;
          if (best && (x.stage === "claimed") && enough(best)) {
            x.stage = "settling";
            x.since = t;
            steps.push(because(`${employer} offers ${Number(best.data?.rise_bps) / 100}%, at least ${p.accept_share_bps / 100}% of our claim: accepting.`,
              say("offer_accepted", `We accept the offer of ${Number(best.data?.rise_bps) / 100}%.`, { to: [employer], visible: [me, employer], basis: best.id, data: { employer, claim: x.claim, rise_bps: best.data?.rise_bps } })));
            continue;
          }
          if (x.stage === "claimed" && x.stoppages === 0 && (best || t - x.since >= p.respond_days * DAY)) {
            x.stage = "balloting";
            x.since = t;
            x.members = members;
            x.closes = t + p.ballot_days * DAY;
            steps.push(because(`${best ? `${employer} offers only ${Number(best.data?.rise_bps) / 100}%` : `No offer from ${employer}`}: balloting our members there on protected action.`,
              ["ballot", say("action_ballot", `Protected action ballot of our members at ${employer}: do you approve stoppages of work, in support of our claim of ${x.claimBps / 100}%?`, { to: members, visible: [me, ...members], data: { employer, claim: x.claim, closes: x.closes } })]));
            const st = steps.at(-1)!;
            st.then = (out) => { const id = out.created?.ballot; if (id) x.ballot = id; };
            continue;
          }
          if (x.stage === "balloting" && x.closes !== undefined && t >= x.closes) {
            const voter = (v: any) => (v.speaks_for ?? v.author) as string;
            const votes = ([...book.records.values()] as any[]).filter((r) => r.record === "vote" && r.ballot === x.ballot && x.members.includes(voter(r)));
            const latest = new Map<string, string>();
            for (const v of votes.sort((a, b) => a.at - b.at)) latest.set(voter(v), v.choice);
            const yes = [...latest.values()].filter((c) => c === "yes").length;
            const passed = latest.size * 10_000 >= p.ballot_turnout_bps * x.members.length && yes * 10_000 > p.ballot_pass_bps * latest.size;
            steps.push(because(`The ballot at ${employer}: ${latest.size} of ${x.members.length} voted, ${yes} yes: ${passed ? "protected action is approved" : "not approved"}.`,
              say("ballot_result", `Protected action ballot at ${employer}: ${latest.size} of ${x.members.length} members voted, ${yes} yes; ${passed ? "approved" : "not approved"}.`, { to: [employer, ...x.members], visible: [me, employer, ...x.members], basis: x.ballot, data: { employer, ballot: x.ballot, voted: latest.size, yes, eligible: x.members.length, passed } })));
            if (!passed) {
              // No mandate: we let it rest, and claim again in three months.
              disputes.delete(employer);
              agreedAt.set(employer, t - p.bargain_every_days * DAY + 90 * DAY);
              continue;
            }
            x.stage = "claimed"; // approved: notice of the first stoppage follows at once
            x.since = t - p.between_days * DAY;
          }
          // Approved (or back from a stoppage) without an offer we accept: notice of the next stoppage.
          if (x.stage === "claimed" && x.ballot && t - x.since >= p.between_days * DAY) {
            const days = p.stoppage_days[Math.min(x.stoppages, p.stoppage_days.length - 1)]!;
            x.stage = "notified";
            x.from = t + p.notice_days * DAY;
            x.until = x.from + days * DAY;
            x.members = members;
            steps.push(because(`Notice to ${employer}: our members there stop work for ${days} day${days > 1 ? "s" : ""}, in ${p.notice_days} days.`,
              say("industrial_action", `Notice of protected action: our members at ${employer} will stop work for ${days} day${days > 1 ? "s" : ""} from day ${Math.floor(x.from / DAY)}.`, { to: [employer, ...members], visible: "public", data: { employer, from: x.from, until: x.until, members } })));
            continue;
          }
          if (x.stage === "notified" && t >= x.from!) {
            x.stage = "striking";
            steps.push(because(`Our members at ${employer} stop work.`,
              say("stop_work", `Stop work at ${employer}, until day ${Math.floor(x.until! / DAY)}.`, { to: [employer, ...x.members], visible: [me, employer, ...x.members], data: { employer, until: x.until, members: x.members } })));
            continue;
          }
          if (x.stage === "striking" && t >= x.until!) {
            x.stage = "claimed";
            x.since = t;
            x.stoppages++;
            steps.push(because(`The stoppage at ${employer} is over: our members return to work.`,
              say("return_to_work", `Return to work at ${employer}.`, { to: [employer, ...x.members], visible: [me, employer, ...x.members], data: { employer, members: x.members } })));
          }
        }
        return steps;
      },
    );
  },
};
