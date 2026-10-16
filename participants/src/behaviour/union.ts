// union.organiser: a trade union's organiser (phase C, stage C5). Documented in docs/behaviour/unions.md, with sources.
//
// A union is an organisation workers join (membership: dues by standing order). Its organiser bargains with each
// employer where it has members, once a year: a claim for the year's rise in prices and a margin. An offer of at least
// a share of the claim is accepted, and the employer makes it an enterprise agreement. Otherwise, protected action as
// labour law commonly has it (the world's laws, read as any participant reads them: formal conditions on its notice of
// action, docs/design/ai-citizens.md 2e): a ballot of the members there (enough
// voting, a majority yes), notice to the employer, then stoppages, longer each time, until an offer it accepts.

import * as C from "../calls";
import type { StatementRecord } from "../contracts";
import { params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { moneyNow } from "../money";
import { because, Book, breaches, noting, DAY, MONTH, offer, pay, say, type Step } from "./common";
import { hearingNotice, hearingOffer, Hearings, HEARING_DEFAULTS, type Hears } from "./desk";
import { stepper } from "./firms";
import * as P from "./papers";

interface Dispute {
  stage: "claimed" | "settling" | "balloting" | "notified" | "striking";
  claim?: string;
  claimBps: number;
  since: number; // when this stage began
  ballot?: string;
  result?: { voted: number; yes: number; eligible: number }; // the ballot's figures
  closes?: number;
  from?: number; // a stoppage: from when, until when
  until?: number;
  stoppages: number;
  members: string[];
}

/** What the union says it takes up for its members: its public notice. */
const unionHears = (me: string, hears: Hears[]) => hearingNotice(me, "The union takes up for its members", hears.map((h) => ({ ...h, can: ["represent"] as Hears["can"] })), { members_of: me, members_apply: true });

export const organiser: BehaviourModule = {
  name: "union.organiser",
  answers: {"office": "the union's office", "acts": "What it acts on: an application to join; its members' votes on its ballots; and an employer's answer to a claim it has made."},
  issues: P.UNION,
  opens: (p, me) => ((p.hears ?? []).length ? [unionHears(me, p.hears)] : []),
  version: "0.6.1", // 0.6.1: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.0: takes up a member's grievance with their employer, where the world says it hears such (docs/behaviour/frictions.md)
  doc: "docs/behaviour/unions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params(
      {
        employers: [] as string[], // workplaces it is told of besides (none: it bargains where its members work, as it learns of them)
        // The industries it organises (its rules of eligibility: the world gives them; none: wherever it has members).
        // A workplace is one of its own when a member there has said its industry is one of these.
        industries: [] as string[],
        claim_margin_bps: 0, // claimed over the year's rise in prices (the world's profile)
        accept_share_bps: 5000, // an offer of at least this share of the claim is accepted (placeholder)
        bargain_every_days: 365,
        first_claim_days: 60, // its first claims, spread over this long (placeholder)
        respond_days: 14, // an offer awaited this long before balloting
        ballot_days: 10,
        // The union's own rules for taking action. The world's laws, where there are any, may ask more: its notice of
        // action states the ballot's figures, and is checked against every law in force before it's given.
        ballot_turnout_bps: 0, // at least this share of the members voting
        ballot_pass_bps: 5000, // more than this share of the votes yes
        notice_days: 0, // notice of action
        compliance_bps: 10_000, // how often it keeps to the law when the law forbids an action it would take
        stoppage_days: [1, 2, 3] as number[], // each stoppage, longer each time (placeholder)
        between_days: 7, // after a stoppage, an improved offer awaited this long before the next
        price_kind: "goods", // prices tracked for the claim (the published index of this kind's price)
        dues: 0, // a month, in the smallest unit (the world's profile)
        resignation_notice_days: 0, // a member's notice of resigning, written into each membership (the world's profile; 0: none written)
        dues_account: "",
        // What it takes up for a member with their employer (docs/behaviour/frictions.md, "Venues": pay come
        // short). None: it takes up nothing of the kind.
        hears: [] as Hears[],
        answer_days: 14,
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const disputes = new Map<string, Dispute>(); // employer -> the dispute in hand
    const agreedAt = new Map<string, number>(); // employer -> when it last agreed
    const employerOf = new Map<string, string>(); // member -> their employer, as the union has it
    const industryAt = new Map<string, string>(); // employer -> its industry, as a member there has said
    const prices: { t: number; mean: number }[] = []; // the mean shop price, monthly
    const handled = new Set<string>();
    // A member's grievance taken up with their employer: put to the employer, and what the union then says should
    // be done is a recommendation with the union behind it, not an order.
    const cases = p.hears.length ? new Hearings(me, ctx, { ...HEARING_DEFAULTS, hears: p.hears.map((h) => ({ ...h, can: ["represent"] as Hears["can"] })), answer_days: p.answer_days }) : undefined;
    let saidHears = false;
    // When each workplace's first claim is due: those known at our first plan are spread over `first_claim_days`; one
    // we learn of later (a member starts there, or joins from there), from then.
    const stagger = new Map<string, number>();
    let offered = false;
    // Where our members work, as we have it (truth audits): each a job in force with that employer.
    const beliefs = (): Belief[] => {
      const members = new Set(book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties[0] === me && book.inForce(r.id)).map((r: any) => r.terms.parties[1] as string));
      const closed = new Set(book.open("closure").map((r) => (typeof r.data?.firm === "string" ? r.data.firm : r.speaks_for!)));
      return [...employerOf].filter(([m, e]) => e && members.has(m) && !closed.has(e)).sort().map(([m, e]): Belief => ({ of: "between", template: "employment", parties: [e, m], in_force: true }));
    };
    return noting(book, Object.assign(stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        if (cases) {
          if (!saidHears) {
            saidHears = true;
            if (!book.open("hearing").some((r) => r.speaks_for === me)) {
              const n = unionHears(me, p.hears);
              steps.push(because("Saying what the union takes up for its members, so that a member with such a matter can bring it.", say(n.kind, n.text, { visible: "public", offer: n.offer, data: n.data as object })));
            }
          }
          steps.push(...cases.steps(book, obs.t));
        }
        // What joining is, for anyone who might (docs/design/ai-citizens.md 2a): published once, and kept up.
        if (!offered && p.dues > 0 && p.dues_account) {
          offered = book.open("membership_offer").some((r) => r.speaks_for === me);
          if (!offered) {
            offered = true;
            steps.push(because("Saying what joining us is: we represent members at work and bargain for them; dues are paid monthly.",
              say("membership_offer", `Join the union: we represent you at work and bargain for you. Dues: ${moneyNow(p.dues)} a month. Apply to us to join.`, { visible: "public",
                offer: { by: me, take_up: "join", terms: { template: "membership", commitments: [
                  { who: me, does: { text: "Represents the member at work, and bargains for them." } },
                  { who: "taker", does: { outcome: { money: { to: p.dues_account, amount: String(p.dues), for: "Union dues." } } }, every: MONTH },
                ], termination: [{ party: me, notice: MONTH }, ...(p.resignation_notice_days > 0 ? [{ party: "taker" as const, notice: p.resignation_notice_days * DAY }] : [])] } } })));
          }
        }
        // Members: the register at the start, and those who've joined since (membership agreements in force).
        for (const r of book.all("membership_register")) for (const m of (r.data?.members as { member: string; employer: string; industry?: string }[]) ?? []) if (!employerOf.has(m.member)) {
          employerOf.set(m.member, m.employer);
          if (m.industry) industryAt.set(m.employer, m.industry);
        }
        const inForce = new Set(book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties[0] === me && book.inForce(r.id)).map((r: any) => r.terms.parties[1] as string));
        // Applications to join: a membership offered, its dues by standing order.
        for (const a of book.open("membership_application")) {
          if (handled.has(a.id) || !(a.addressed_to ?? []).includes(me)) continue;
          handled.add(a.id);
          const who = a.speaks_for!;
          if (typeof a.data?.employer === "string") employerOf.set(who, a.data.employer);
          if (typeof a.data?.employer === "string" && typeof a.data?.industry === "string") industryAt.set(a.data.employer, a.data.industry);
          if (inForce.has(who)) continue;
          steps.push(because(`${who} asks to join: offering membership, ${moneyNow(p.dues)} a month in dues.`,
            offer(who, { template: "membership", ourNotice: MONTH, ...(p.resignation_notice_days > 0 ? { theirNotice: p.resignation_notice_days * DAY } : {}), we: C.text(`${me} represents ${who} at work, and bargains for them.`) as any,
              they: pay(p.dues_account, p.dues, { every: MONTH, for: "Union dues." }), text: `${who} is a member of ${me}, paying dues of ${moneyNow(p.dues)} a month.`, basis: a.id })));
        }
        // Members who've told us where they now work (or that they're out of work: no employer).
        for (const u of book.open("membership_update")) {
          if (handled.has(u.id) || !(u.addressed_to ?? []).includes(me)) continue;
          handled.add(u.id);
          employerOf.set(u.speaks_for!, typeof u.data?.employer === "string" ? u.data.employer : "");
          if (typeof u.data?.employer === "string" && typeof u.data?.industry === "string") industryAt.set(u.data.employer, u.data.industry);
        }
        // Employers that have closed (their public notice): nobody to bargain with.
        const closed = new Set(book.open("closure").map((r) => (typeof r.data?.firm === "string" ? r.data.firm : r.speaks_for!)));
        const membersAt = (employer: string) => [...employerOf].filter(([m, e]) => e === employer && inForce.has(m)).map(([m]) => m).sort();

        // Prices: the published index (the statistician's mean of shop prices), as last read, once a month. Nobody is
        // shown every shop's prices (docs/no-god-view.md).
        if (!prices.length || t - prices.at(-1)!.t >= MONTH) {
          const index = book.open("price_index").filter((r) => r.data?.kind === p.price_kind && typeof r.data?.mean === "number").sort((a, b) => b.at - a.at)[0];
          if (index) prices.push({ t, mean: index.data!.mean as number });
        }
        // Workplaces: where our members work, as they have told us, and any we were told of at the start.
        const ours = (e: string) => !p.industries.length || p.industries.includes(industryAt.get(e) ?? "");
        const workplaces = [...new Set([...p.employers, ...[...employerOf].filter(([m, e]) => e && inForce.has(m) && ours(e)).map(([, e]) => e)])].sort();
        const first = stagger.size === 0;
        workplaces.forEach((e, i) => {
          if (!stagger.has(e)) stagger.set(e, first ? Math.floor(((i + 1) * p.first_claim_days * DAY) / Math.max(1, workplaces.length)) : t);
        });
        const yearAgo = [...prices].reverse().find((x) => t - x.t >= 365 * DAY);
        const inflation = yearAgo && prices.length ? Math.round(((prices.at(-1)!.mean - yearAgo.mean) * 10_000) / yearAgo.mean) : 0;

        for (const employer of workplaces) {
          if (closed.has(employer)) {
            if (disputes.delete(employer)) steps.push(because(`${employer} has closed: our dispute there is over.`));
            continue;
          }
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
          // Nobody of ours works there now (they've moved on, and told us): there's no one to bargain for.
          if (!members.length) {
            disputes.delete(employer);
            steps.push(because(`None of our members works at ${employer} now: our dispute there is over.`));
            continue;
          }
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
            const votes = (book.ofType("vote") as any[]).filter((r) => r.ballot === x.ballot && x.members.includes(voter(r)));
            const latest = new Map<string, string>();
            for (const v of votes.sort((a, b) => a.at - b.at)) latest.set(voter(v), v.choice);
            const yes = [...latest.values()].filter((c) => c === "yes").length;
            const passed = latest.size * 10_000 >= p.ballot_turnout_bps * x.members.length && yes * 10_000 > p.ballot_pass_bps * latest.size;
            x.result = { voted: latest.size, yes, eligible: x.members.length };
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
            // The notice states the ballot's figures, as a notice of protected action does. The law as we read it: the
            // soonest a stoppage can start without breaching a law in force, a day at a time; if none within a month
            // (the ballot doesn't meet the law, say), no action, unless we don't comply.
            const r = x.result ?? { voted: 0, yes: 0, eligible: members.length };
            const notice = (from: number) => ({ employer, from, until: from + days * DAY, members, ballot: x.ballot, ...r });
            const act = (from: number) => ({ block: "publish", kind: "industrial_action", data: notice(from) });
            // A stoppage starts with a day: the first to begin once the notice has run. (Until 2026-10-06 it started to
            // the second, counted from when we decided; the notice is on the record a moment later, so one given on
            // exactly the law's period was short of it by that moment: the landlord's fault of 0.12.1, here.)
            const startsOn = (at: number, lead: number) => (Math.floor((at + lead) / DAY) + 1) * DAY;
            let lead = p.notice_days * DAY;
            let broken = breaches(book, act(startsOn(t, lead)), me, t);
            while (broken.length && lead < (p.notice_days + 30) * DAY) broken = breaches(book, act(startsOn(t, (lead += DAY))), me, t);
            if (broken.length && ctx.rng(`comply-${employer}`).below(10_000) < p.compliance_bps) {
              steps.push(because(`Action at ${employer} would breach ${broken.map((l) => l.id).join(", ")}: no action. We'll claim again in three months.`));
              disputes.delete(employer);
              agreedAt.set(employer, t - p.bargain_every_days * DAY + 90 * DAY);
              continue;
            }
            if (broken.length) lead = p.notice_days * DAY;
            x.stage = "notified";
            x.members = members;
            // The notice counts from when it's given (later than now, if a wake runs out of actions first).
            const give = (at: number): Step => {
              x.from = startsOn(at, lead);
              x.until = x.from + days * DAY;
              return Object.assign(because(`Notice to ${employer}: our members there stop work for ${days} day${days > 1 ? "s" : ""}, in ${Math.round(lead / DAY)} days${broken.length ? `; this breaches ${broken.map((l) => l.id).join(", ")}, and we act anyway` : ""}.`,
                say("industrial_action", `Notice of protected action: our members at ${employer} will stop work for ${days} day${days > 1 ? "s" : ""} from day ${Math.floor(x.from / DAY)}. Ballot ${x.ballot}: ${r.voted} of ${r.eligible} voted, ${r.yes} yes.`, { to: [employer, ...members], visible: "public", data: notice(x.from) })), { redo: give });
            };
            steps.push(give(t));
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
    ), { beliefs }));
  },
};
