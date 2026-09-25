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

import type { Block, Observation, SeatAction } from "../contracts";
import { act, wait, type BehaviourModule, type SeatContext } from "../module";
import { Book, DAY, MONTH, ownAccount, payInstruction, standingOrder } from "./common";

interface Home { agreement: string; structure: string; landlord: string; rent: number; order?: string; endsAt: number; movedIn: boolean }
interface Job { agreement: string; employer: string; wage: number; period: number; workplace?: string; endsAt: number }

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.1.0",
  doc: "docs/behaviour/citizen.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: SeatContext) {
    const p = {
      rent_share_bps: 3300, // BoE: renters bid 33% of income
      savings_rent_months: 6, // without income, rent only if savings cover this many months
      essentials: 50_000, // cents per month
      spend_above_buffer_bps: 3000, // BoE eq. (2): spend a fraction of savings above the desired buffer
      buffer_months: 3,
      leave_after_homeless_days: 90,
      leave_after_jobless_days: 180,
      ...ctx.params,
    };
    const me = ctx.entity;
    const book = new Book();
    let home: Home | null = null;
    let job: Job | null = null;
    const applied = new Set<string>();
    let homelessSince: number | null = null;
    let joblessSince: number | null = null;
    let nextSpend = ctx.rng("spend-day").below(30) * DAY;
    let departed = false;
    let todo: Block[][] = [];
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
          const pay = r.terms.commitments.find((c) => c.who === me)?.does;
          const allow = r.terms.commitments.find((c) => c.who !== me)?.does?.allow;
          const landlord = r.terms.parties.find((x) => x !== me)!;
          const order = [...book.records.values()].find((x) => x.record === "statement" && x.kind === "instruction" && x.basis === r.id && x.speaks_for === me)?.id;
          home = { agreement: r.id, structure: allow?.occupy, landlord, rent: pay?.pay ?? 0, order, endsAt: end, movedIn: true };
        }
        if (r.terms.template === "employment" && !job) {
          const employer = r.terms.parties.find((x) => x !== me)!;
          const c = r.terms.commitments.find((c) => c.who === employer);
          job = { agreement: r.id, employer, wage: c?.does?.pay ?? 0, period: c?.every ?? 14 * DAY, workplace: r.terms.attrs?.workplace, endsAt: end };
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

    const plan = (obs: Observation): Block[][] => {
      if (plannedAt === -1) learnFromInitialRecords(obs);
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      const bank = acc.custodian;
      const steps: Block[][] = [];

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
        const s: Block[] = home.movedIn ? [{ block: "vacate", occupant: me, structure: home.structure }] : [];
        if (home.order) s.push({ block: "withdraw", record: home.order, speaks_for: me, text: "Tenancy ended; stop this standing order." });
        if (s.length) steps.push(s);
        home = null;
        homelessSince = t;
      }
      // A job that has ended.
      if (job && t >= job.endsAt) {
        if (job.workplace) steps.push([{ block: "vacate", occupant: me, structure: job.workplace }]);
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
          const rent = r.terms.commitments.find((c) => c.who === me)?.does?.pay ?? 0;
          const structure = r.terms.commitments.find((c) => c.who === other)?.does?.allow?.occupy;
          if (!structure || !affordable(rent, acc.balance)) continue;
          // Signing (a record) and moving in (physics) are separate acts: the
          // flat may not be free yet if the last tenant hasn't left.
          steps.push([
            { block: "sign_agreement", agreement: r.id, as: me },
            { ...standingOrder(me, bank, acc.account, r.terms.commitments.find((c) => c.who === me)!.does.into, rent, MONTH, 0, r.id, `Rent for ${structure}, monthly in advance.`), ref: "so" },
          ]);
          home = { agreement: r.id, structure, landlord: other, rent, endsAt: t + (r.terms.term ?? 365 * DAY), movedIn: false };
          pendingRef = { kind: "rent", agreement: r.id };
          homelessSince = null;
        } else if (r.terms.template === "employment" && !job) {
          const c = r.terms.commitments.find((c) => c.who === other);
          const workplace = r.terms.attrs?.workplace;
          const s: Block[] = [{ block: "sign_agreement", agreement: r.id, as: me }];
          if (workplace) s.push({ block: "occupy", structure: workplace, slot: "workplace", count: 1 });
          steps.push(s);
          job = { agreement: r.id, employer: other, wage: c?.does?.pay ?? 0, period: c?.every ?? 14 * DAY, workplace, endsAt: r.terms.term ? t + r.terms.term : Number.MAX_SAFE_INTEGER };
          joblessSince = null;
        }
      }

      // Moving into a home we hold a lease on, once there's physical room.
      if (home && !home.movedIn) {
        steps.push([{ block: "occupy", structure: home.structure, slot: "dwelling", count: 1 }]);
        moving = true;
      }

      // Leaving town (exit): long without a home, or without work and money.
      const broke = acc.balance < Math.max(home?.rent ?? 0, p.essentials);
      const leave =
        (homelessSince !== null && t - homelessSince >= p.leave_after_homeless_days * DAY) ||
        (joblessSince !== null && t - joblessSince >= p.leave_after_jobless_days * DAY && broke);
      if (leave) {
        const s: Block[] = [];
        if (home) {
          if (home.movedIn) s.push({ block: "vacate", occupant: me, structure: home.structure });
          if (home.order) s.push({ block: "withdraw", record: home.order, speaks_for: me });
          s.push({ block: "give_notice", agreement: home.agreement, as: me, text: "Leaving town." });
        }
        if (job?.workplace) s.push({ block: "vacate", occupant: me, structure: job.workplace });
        if (job) s.push({ block: "give_notice", agreement: job.agreement, as: me, text: "Leaving town." });
        s.push({ block: "publish", kind: "departure", speaks_for: me, text: `${me} has left town.` });
        if (acc.balance > 0 && p.outside_account) s.push(payInstruction(me, bank, acc.account, p.outside_account, acc.balance, "Moving away: send all my savings with me."));
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
          steps.push([{ block: "publish", kind: "rental_application", speaks_for: me, addressed_to: [best.speaks_for], visible_to: [me, best.speaks_for], text: `Application for ${best.data.structure}.`, data: { listing: best.id, account: acc.account } }]);
        }
      }
      // Looking for work: the best-paid posting.
      if (!job) {
        const posts = book.open("job_posting").filter((j) => !applied.has(j.id));
        posts.sort((a, b) => (b.data?.wage ?? 0) - (a.data?.wage ?? 0) || (a.id < b.id ? -1 : 1));
        const best = posts[0];
        if (best?.speaks_for) {
          applied.add(best.id);
          steps.push([{ block: "publish", kind: "job_application", speaks_for: me, addressed_to: [best.speaks_for], visible_to: [me, best.speaks_for], text: "Application for the advertised job.", data: { posting: best.id, account: acc.account } }]);
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
          steps.push([payInstruction(me, bank, acc.account, shop, amount, "Shopping.")]);
        }
      }
      fresh = [];
      return steps;
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
        lastWasMove = !!next && next.length === 1 && next[0]!.block === "occupy" && next[0]!.slot === "dwelling";
        return next ? act(next) : wait();
      },
    };
  },
};
