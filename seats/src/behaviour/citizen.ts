// citizen.default: a townsperson's everyday economic life. Documented in
// docs/behaviour/citizen.md, with sources.
//
// Housing (after the Bank of England housing model, Baptista et al. 2016):
// renters budget a third of income for rent, take the best home they can
// afford from the listings they see, and don't leave a tenancy early.
// Work: the unemployed apply for the best-paid posting. Spending (after the
// same model's consumption rule): essentials, plus a fraction of savings
// above a desired buffer. Exit (Hirschman 1970): after long enough without a
// home, or without work and money, they leave town and take their money.
//
// Everything is done the way a person does it: applying, signing, moving in,
// asking the bank to pay. Nothing happens to them automatically.

import type { Observation, SeatAction } from "../contracts";
import { params, wait, type BehaviourModule, type SeatContext } from "../module";
import { Book, callAction, DAY, jobTerms, leaseTerms, MONTH, moveIn, moveOut, notice, ownAccount, pay, petitionSignatures, publishedCount, say, sign, vote, withdraw, type Step } from "./common";

interface Home { agreement: string; structure: string; landlord: string; rent: number; order?: string; endsAt: number; movedIn: boolean }
interface Job { agreement: string; employer: string; wage: number; period: number; workplace?: string; endsAt: number }

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.4.0",
  doc: "docs/behaviour/citizen.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: SeatContext) {
    const p = params(
    {
      rent_share_bps: 3300, // BoE: renters bid 33% of income
      savings_rent_months: 6, // without income, rent only if savings cover this many months
      essentials: 50_000, // cents per month
      spend_above_buffer_bps: 3000, // BoE eq. (2): spend a fraction of savings above the desired buffer
      buffer_months: 3,
      leave_after_homeless_days: 90,
      leave_after_jobless_days: 180,
      // Voice (docs/behaviour/citizen.md): petitions, after Granovetter (1978).
      petition_start_bps: 300, // chance per wake that an aggrieved renter starts a petition, if none is open
      petition_days: 180, // how long an organiser keeps a petition open
      threshold_mean_bps: 2500, // personal thresholds (share of the population already signed) are
      threshold_sd_bps: 1000, //   roughly normal with this mean and spread (Granovetter 1978)
      population: 200,
      rent_burden_grievance_bps: 4000,
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    let home: Home | null = null;
    let job: Job | null = null;
    const applied = new Set<string>();
    let homelessSince: number | null = null;
    let joblessSince: number | null = null;
    let nextSpend = ctx.rng("spend-day").below(30) * DAY;
    let departed = false;
    let todo: Step[] = [];
    let moveStep: Step | null = null; // the move-in step planned this wake
    let plannedAt = -1;
    let pendingRef: { kind: "rent"; agreement: string } | null = null;
    let moving = false; // a move-in is planned this wake
    let lastWasMove = false; // the action we last returned was that move-in

    const monthlyIncome = () => (job ? Math.floor((job.wage * MONTH) / job.period) : 0);

    const learnFromInitialRecords = (obs: Observation) => {
      // Agreements already in force when we first look (the world's genesis records).
      for (const r of book.records.values()) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || !book.inForce(r.id)) continue;
        const since = book.signedAt(r.id) ?? 0;
        const end = r.terms.term ? since + r.terms.term : Number.MAX_SAFE_INTEGER;
        if (r.terms.template === "lease" && !home) {
          const lt = leaseTerms(r, me);
          const landlord = r.terms.parties.find((x) => x !== me)!;
          const order = [...book.records.values()].find((x) => x.record === "statement" && x.kind === "request" && x.basis === r.id && x.speaks_for === me)?.id;
          home = { agreement: r.id, structure: lt.structure!, landlord, rent: lt.rent, order, endsAt: end, movedIn: true };
        }
        if (r.terms.template === "employment" && !job) {
          const employer = r.terms.parties.find((x) => x !== me)!;
          job = { agreement: r.id, employer, ...jobTerms(r, me), endsAt: end };
        }
      }
      void obs;
    };

    // Everything we observe, after every action (not just on waking).
    let fresh: ReturnType<Book["absorb"]> = [];
    const absorb = (obs: Observation) => {
      fresh.push(...book.absorb(obs));
      // Did the move-in we just attempted work?
      if (moving && lastWasMove && obs.outcomes.length) {
        if (obs.outcomes.at(-1)!.status === "applied" && home) home.movedIn = true;
        moving = false;
      }
      // The id of a rent standing order we just set up.
      if (pendingRef && home && home.agreement === pendingRef.agreement) {
        const created = obs.outcomes.flatMap((o) => (o.created?.so ? [o.created.so] : []));
        if (created.length) {
          home.order = created.at(-1);
          pendingRef = null;
        }
      }
    };

    const plan = (obs: Observation): Step[] => {
      if (plannedAt === -1) learnFromInitialRecords(obs);
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      const steps: Step[] = [];
      moveStep = null;

      // Notices on our agreements move their end dates.
      for (const r of fresh) {
        if (r.record !== "notice" || r.as === me) continue;
        const a = book.records.get(r.agreement);
        if (a?.record !== "agreement") continue;
        const notice = a.terms.termination?.find((x) => x.party === r.as)?.notice ?? MONTH;
        if (home?.agreement === r.agreement) home.endsAt = Math.min(home.endsAt, r.at + notice);
        if (job?.agreement === r.agreement) job.endsAt = Math.min(job.endsAt, r.at + notice);
      }

      // A tenancy that has ended: move out and stop paying rent.
      if (home && t >= home.endsAt) {
        const s: Step = home.movedIn ? [moveOut(home.structure, me)] : [];
        if (home.order) s.push(withdraw(home.order, "Tenancy ended; stop this standing order."));
        if (s.length) steps.push(s);
        home = null;
        homelessSince = t;
      }
      // A job that has ended.
      if (job && t >= job.endsAt) {
        if (job.workplace) steps.push([moveOut(job.workplace, me)]);
        job = null;
        joblessSince = t;
      }
      if (!home && homelessSince === null) homelessSince = t;
      if (!job && joblessSince === null) joblessSince = t;

      // Offers made to us: sign what we asked for and can afford.
      for (const r of fresh) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || book.signedBy(r.id, me)) continue;
        const other = r.terms.parties.find((x) => x !== me)!;
        if (r.terms.template === "lease" && !home) {
          const { rent, rentTo, structure } = leaseTerms(r, me);
          if (!structure || !rentTo || !affordable(rent, acc.balance)) continue;
          // Signing (a record) and moving in (physics) are separate acts: the
          // flat may not be free yet if the last tenant hasn't left.
          steps.push([
            sign(r.id),
            ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: 0, basis: r.id, for: `Rent for ${structure}, monthly in advance.` })],
          ]);
          home = { agreement: r.id, structure, landlord: other, rent, endsAt: t + (r.terms.term ?? 365 * DAY), movedIn: false };
          pendingRef = { kind: "rent", agreement: r.id };
          homelessSince = null;
        } else if (r.terms.template === "employment" && !job) {
          const terms = jobTerms(r, me);
          const s: Step = [sign(r.id)];
          if (terms.workplace) s.push(moveIn(terms.workplace, "workplace"));
          steps.push(s);
          job = { agreement: r.id, employer: other, ...terms, endsAt: r.terms.term ? t + r.terms.term : Number.MAX_SAFE_INTEGER };
          joblessSince = null;
        }
      }

      // Moving into a home we hold a lease on, once there's physical room.
      if (home && !home.movedIn) {
        moveStep = [moveIn(home.structure, "dwelling")];
        steps.push(moveStep);
        moving = true;
      }

      // Leaving town (exit): long without a home, or without work and money.
      const broke = acc.balance < Math.max(home?.rent ?? 0, p.essentials);
      const leave =
        (homelessSince !== null && t - homelessSince >= p.leave_after_homeless_days * DAY) ||
        (joblessSince !== null && t - joblessSince >= p.leave_after_jobless_days * DAY && broke);
      if (leave) {
        const s: Step = [];
        if (home) {
          if (home.movedIn) s.push(moveOut(home.structure, me));
          if (home.order) s.push(withdraw(home.order));
          s.push(notice(home.agreement, "Leaving town."));
        }
        if (job?.workplace) s.push(moveOut(job.workplace, me));
        if (job) s.push(notice(job.agreement, "Leaving town."));
        s.push(say("departure", `${me} has left town.`));
        if (acc.balance > 0 && p.outside_account) s.push(pay(p.outside_account, acc.balance, { from: acc.account, for: "Moving away: send all my savings with me." }));
        departed = true;
        return [s];
      }

      // Looking for a home: the best one we can afford among the listings we've seen.
      if (!home) {
        const listings = book.open("rental_listing").filter((l) => !applied.has(l.id) && affordable(l.data?.rent ?? Infinity, acc.balance));
        listings.sort((a, b) => b.data.rent - a.data.rent || (a.id < b.id ? -1 : 1));
        const best = listings[0];
        if (best?.speaks_for) {
          applied.add(best.id);
          steps.push([say("rental_application", `Application for ${best.data.structure}.`, { to: [best.speaks_for], visible: [me, best.speaks_for], data: { listing: best.id, account: acc.account } })]);
        }
      }
      // Looking for work: the best-paid posting.
      if (!job) {
        const posts = book.open("job_posting").filter((j) => !applied.has(j.id));
        posts.sort((a, b) => (b.data?.wage ?? 0) - (a.data?.wage ?? 0) || (a.id < b.id ? -1 : 1));
        const best = posts[0];
        if (best?.speaks_for) {
          applied.add(best.id);
          steps.push([say("job_application", "Application for the advertised job.", { to: [best.speaks_for], visible: [me, best.speaks_for], data: { posting: best.id, account: acc.account } })]);
        }
      }

      // Spending, once a month: essentials, plus a share of savings above the buffer.
      if (t >= nextSpend) {
        nextSpend = t + MONTH;
        const shops: string[] = p.shop_accounts ?? [];
        const reserve = home?.rent ?? 0;
        const buffer = p.buffer_months * monthlyIncome();
        const above = Math.max(0, acc.balance - reserve - buffer);
        const amount = Math.min(acc.balance - reserve, p.essentials + Math.floor((above * p.spend_above_buffer_bps) / 10_000));
        if (amount > 0 && shops.length) {
          const shop = ctx.rng(`shop-${t}`).pick(shops);
          steps.push([pay(shop, amount, { from: acc.account, for: "Shopping." })]);
        }
      }
      voice(t, steps);
      fresh = [];
      return steps;
    };

    // Granovetter (1978): each person joins once the share already joined reaches their own threshold.
    // Irwin–Hall approximation to a normal: the sum of 12 uniforms on [0, 1) has mean 6 and sd 1.
    const tr = ctx.rng("threshold");
    let z = -6 * 10_000;
    for (let i = 0; i < 12; i++) z += tr.below(10_000);
    const threshold = Math.max(0, p.threshold_mean_bps + Math.trunc((z * p.threshold_sd_bps) / 10_000)); // z / 10000 ~ N(0, 1)
    const signed = new Set<string>();
    const countsPublished = new Map<string, { n: number; at: number }>();
    let aggrievedUntil = 0;
    const voice = (t: number, steps: Step[]) => {
      const burden = home && monthlyIncome() > 0 ? (home.rent * 10_000) / monthlyIncome() : 0;
      const noticed = [...book.notices.entries()].some(([ag, ns]) => ag === home?.agreement && ns.some((n) => n.as !== me));
      if (home && (noticed || burden >= p.rent_burden_grievance_bps)) aggrievedUntil = t + 90 * DAY;
      const aggrieved = t < aggrievedUntil;
      const open = book.open("petition").filter((x) => (x.data?.demand?.tags ?? []).includes("tenant_protection"));
      // An organiser closes their petition after `petition_days`; a new one can then start.
      for (const pet of open) if (pet.speaks_for === me && t - pet.at >= p.petition_days * DAY && !signed.has(`closed-${pet.id}`)) {
        signed.add(`closed-${pet.id}`);
        steps.push([withdraw(pet.id, "Petition closed.")]);
      }
      if (aggrieved && open.length === 0 && ctx.rng(`petition-${t}`).below(10_000) < p.petition_start_bps) {
        steps.push([say("petition", "Petition: landlords must give 90 days' notice, and may not raise rent by more than 5% a year.", { data: { demand: {
          kind: "law", text: "A landlord must give at least 90 days' notice to end a tenancy, and may not raise the rent by more than 5% in any 12 months.",
          adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice, or raise rent by more than 5% a year" }, tags: ["tenant_protection"] } } })]);
        return;
      }
      for (const pet of open) {
        if (pet.speaks_for === me) {
          // The organiser sees every signature (a vote is visible to the signer and the petition's
          // organiser) and publishes the running count, at most every 3 days, as petition sites do.
          const n = petitionSignatures(book, pet.id) + 1;
          const last = countsPublished.get(pet.id);
          if ((!last || last.n !== n) && (!last || t - last.at >= 3 * DAY)) {
            countsPublished.set(pet.id, { n, at: t });
            steps.push([say("petition_count", `${n} people have signed.`, { basis: pet.id, data: { petition: pet.id, signatures: n } })]);
          }
          continue;
        }
        if (signed.has(pet.id)) continue;
        const share = (publishedCount(book, pet) * 10_000) / p.population;
        if (aggrieved || (home && share >= threshold)) {
          signed.add(pet.id);
          steps.push([vote(pet.id, "sign")]);
        }
      }
    };

    const affordable = (rent: number, balance: number) =>
      job ? rent * 10_000 <= monthlyIncome() * p.rent_share_bps : rent * p.savings_rent_months <= balance;

    return {
      step(obs): SeatAction {
        if (departed) return wait(ctx.world.runEnd + DAY);
        absorb(obs);
        if (plannedAt !== obs.t) {
          todo = plan(obs);
          plannedAt = obs.t;
        }
        const next = todo.shift();
        lastWasMove = !!next && next === moveStep;
        return next ? callAction(next) : wait();
      },
    };
  },
};
