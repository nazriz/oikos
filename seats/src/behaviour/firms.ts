// Firms. Documented in docs/behaviour/firms.md, with sources.
//
// firm.landlord (after the Bank of England housing model, Baptista et al.
// 2016): lists vacant homes at a markup over its going rent, cuts the asking
// rent 5% for each month a listing goes unlet, picks among applicants at
// random, lets for 12-24 months (uniform, per ARLA data), and gives notice
// after rent arrears (what tenancy law allows is a record; this module's
// default is to give the notice period its lease states).
//
// firm.employer: posts jobs up to a target headcount while it can afford the
// wage bill, hires among applicants at random, pays wages by standing order
// through its bank, pays suppliers (the outside world) a share of its
// revenue, and lays off when it can't cover a pay period.

import type { Block, Observation, SeatAction } from "../contracts";
import { channels } from "../contracts";
import { act, params, wait, type BehaviourModule, type SeatContext } from "../module";
import { between, Book, DAY, MONTH, ownAccount, payInstruction, standingOrder } from "./common";

/**
 * A seat observes after every action, not just when it wakes: `absorb` takes
 * in every observation (new records, payments received, ids just created),
 * and `plan` decides what to do once per wake.
 */
export function stepper(absorb: (obs: Observation) => void, plan: (obs: Observation) => Block[][]) {
  let todo: Block[][] = [];
  let plannedAt = -1;
  return {
    step(obs: Observation): SeatAction {
      absorb(obs);
      if (plannedAt !== obs.t) {
        todo = plan(obs);
        plannedAt = obs.t;
      }
      const next = todo.shift();
      return next ? act(next) : wait();
    },
  };
}

/** Money received into `account` this observation, by paying account. */
function receipts(obs: Observation, account: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const tx of channels.transactions(obs)) if (tx.to === account && tx.from !== account) m.set(tx.from, (m.get(tx.from) ?? 0) + tx.amount);
  return m;
}

export const landlord: BehaviourModule = {
  name: "firm.landlord",
  version: "0.1.0",
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: SeatContext) {
    const p = params(
    {
      markup_bps: 500,
      cut_bps: 500, // BoE: unlet rentals cut 5% a month
      min_term_months: 12, // BoE/ARLA: 12-24 months, uniform
      max_term_months: 24,
      landlord_notice_days: 60,
      tenant_notice_days: 30,
      arrears_months_before_notice: 2,
      spend_share_bps: 6000, // owners' spending of rental income, at local shops
      upkeep_share_bps: 2000, // maintenance bought from outside
      base_rent: {} as { [type: string]: number },
      // Development (see docs/behaviour/firms.md).
      develop: true,
      develop_type: "house",
      develop_window_days: 90, // look at average occupancy over this window
      develop_max_vacancy_bps: 1000, // build when average vacancy is at most 10% of homes
      build_markup_bps: 2000, // the builder's price over materials
      compliance_bps: 10_000, // how often it obeys a refusal, a fine or an order
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    const cfg = ctx.world.config;
    const types = new Map<string, any>(cfg.catalogue.structure_types.map((t: any) => [t.id, t]));
    const owned: { structure: string; type: string; units: number }[] = [];
    const received = new Map<string, number>(); // tenant account -> total received
    const listedAt = new Map<string, number>();
    const noticeGiven = new Map<string, number>(); // agreement -> when we gave notice
    const handled = new Set<string>();
    let income = 0;
    let nextSpend = MONTH;

    const tenantAccount = new Map<string, string>(); // agreement -> tenant's paying account
    const vacancyHistory: { t: number; vacant: number; units: number }[] = [];
    let dev: { parcel: string; stage: "applying" | "applied" | "granted" | "refused" | "contracted"; app?: string } | null = null;
    let devCooldownUntil = 0;
    const answered = new Set<string>(); // fines and orders we've responded to
    const obeys = (key: string) => ctx.rng(`comply-${key}`).below(10_000) < p.compliance_bps;

    const absorb = (obs: Observation) => {
      book.absorb(obs);
      if (dev?.stage === "applying") for (const o of obs.outcomes) if (o.created?.app) { dev.app = o.created.app; dev.stage = "applied"; }
      const acc = ownAccount(obs);
      if (acc) for (const [from, amount] of receipts(obs, acc.account)) {
        received.set(from, (received.get(from) ?? 0) + amount);
        income += amount;
      }
    };
    return stepper(absorb, (obs) => {
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      const bank = acc.custodian;
      // What we own: completed homes on parcels our ownership records name
      // (seen through our own sites), including anything we've since built.
      const ownParcels = new Set([...book.records.values()].flatMap((r) => (r.record === "claim" && r.holder === me && r.about?.kind === "ownership" ? [r.about.object] : [])));
      const sites = channels.sites(obs).filter((s) => ownParcels.has(s.parcel));
      owned.length = 0;
      for (const site of sites) {
        const st = site.structure;
        const ty = st && types.get(st.type);
        if (st?.complete && ty?.capacity?.dwelling) owned.push({ structure: st.structure, type: st.type, units: ty.capacity.dwelling });
      }
      // Our leases, and when each ends.
      // Our leases: in force, or offered by us and still awaiting the tenant's
      // signature (up to a month). Both hold a unit; counting only signed ones
      // would let the same home twice.
      const leases = [...book.records.values()].filter((r) => r.record === "agreement" && r.terms.template === "lease" && r.terms.parties[0] === me && book.signedBy(r.id, me));
      const awaiting = (leases as any[]).filter((a) => !book.inForce(a.id) && t - a.at < MONTH);
      const active = (leases as any[]).filter((a: any) => {
        if (!book.inForce(a.id)) return false;
        const since = book.signedAt(a.id)!;
        const ends = Math.min(a.terms.term ? since + a.terms.term : Infinity, ...(book.notices.get(a.id) ?? []).map((n) => n.at + (a.terms.termination?.find((x: any) => x.party === n.as)?.notice ?? MONTH)));
        return t < ends;
      }) as any[];
      const steps: Block[][] = [];

      // Applications: pick one at random per listing, offer a lease, withdraw the listing.
      const apps = book.open("rental_application").filter((a) => (a.addressed_to ?? []).includes(me) && !handled.has(a.id));
      const byListing = new Map<string, typeof apps>();
      for (const a of apps) byListing.set(a.data?.listing, [...(byListing.get(a.data?.listing) ?? []), a]);
      for (const [listingId, as] of byListing) {
        for (const a of as) handled.add(a.id);
        const listing = book.records.get(listingId);
        if (listing?.record !== "statement" || book.withdrawn.has(listingId)) continue;
        const pick = ctx.rng(`pick-${listingId}`).pick(as.sort((x, y) => (x.id < y.id ? -1 : 1)));
        const tenant = pick.speaks_for!;
        const months = between(p.min_term_months, p.max_term_months, ctx.rng(`term-${listingId}`).below(1_000_000) / 1_000_000);
        steps.push([
          {
            block: "propose_agreement", speaks_for: me, ref: "lease",
            terms: {
              template: "lease", parties: [me, tenant],
              commitments: [
                { who: tenant, does: { pay: listing.data.rent, to: me, into: acc.account }, every: MONTH },
                { who: me, does: { allow: { occupy: listing.data.structure, slot: "dwelling", count: 1 } } },
              ],
              term: months * MONTH,
              termination: [{ party: me, notice: p.landlord_notice_days * DAY }, { party: tenant, notice: p.tenant_notice_days * DAY }],
              text: `${tenant} rents a home in ${listing.data.structure} from ${me} for ${listing.data.rent} cents a month, for ${months} months.`,
            },
          },
          { block: "sign_agreement", agreement: "$lease", as: me },
          { block: "withdraw", record: listingId, speaks_for: me, text: "Let." },
        ]);
        tenantAccount.set(listingId, pick.data?.account);
      }

      // Vacancies: list them, at a markup over what we currently get for that kind of home.
      const openListings = book.open("rental_listing").filter((l) => l.speaks_for === me);
      for (const o of owned) {
        const let_ = [...active, ...awaiting].filter((a) => a.terms.commitments[1]?.does?.allow?.occupy === o.structure).length;
        const listed = openListings.filter((l) => l.data?.structure === o.structure);
        const pendingOffers = steps.filter((s) => s[0]?.terms?.commitments?.[1]?.does?.allow?.occupy === o.structure).length;
        const vacant = o.units - let_ - listed.length - pendingOffers;
        for (let i = 0; i < vacant; i++) {
          const going = active.filter((a) => types.get(o.type) && a.terms.commitments[1]?.does?.allow?.occupy === o.structure).map((a) => a.terms.commitments[0].does.pay);
          const ref = going.length ? Math.floor(going.reduce((x, y) => x + y, 0) / going.length) : p.base_rent[o.type] ?? 100_000;
          const noise = 9_750 + ctx.rng(`price-${o.structure}-${i}`).below(501); // +/-2.5%
          const rent = Math.floor((((ref * (10_000 + p.markup_bps)) / 10_000) * noise) / 10_000);
          steps.push([{ block: "publish", kind: "rental_listing", speaks_for: me, text: `Home to let in ${o.structure}: ${rent} cents a month.`, data: { structure: o.structure, type: o.type, rent } }]);
        }
        // Unlet for a month: cut the asking rent (BoE: 5% a month).
        for (const l of listed) {
          const since = listedAt.get(l.id) ?? l.at;
          if (t - since >= MONTH) {
            const rent = Math.floor((l.data.rent * (10_000 - p.cut_bps)) / 10_000);
            steps.push([
              { block: "withdraw", record: l.id, speaks_for: me, text: "Relisting at a lower rent." },
              { block: "publish", kind: "rental_listing", speaks_for: me, text: `Home to let in ${o.structure}: ${rent} cents a month.`, data: { structure: o.structure, type: o.type, rent } },
            ]);
          }
        }
      }

      // Arrears: give notice after enough unpaid months (rent is due monthly in advance).
      for (const a of active) {
        if (noticeGiven.has(a.id)) continue;
        const tenant = a.terms.parties[1];
        const rent = a.terms.commitments[0].does.pay;
        const since = book.signedAt(a.id)!;
        const due = Math.floor((t - since) / MONTH) + 1;
        const paying = ([...book.records.values()].find((r) => r.record === "statement" && r.kind === "rental_application" && r.speaks_for === tenant) as any)?.data?.account ?? cfg.world.accounts.find((x: any) => x.holder === tenant)?.id;
        const paid = paying ? received.get(paying) ?? 0 : 0;
        if ((due * rent - paid) >= p.arrears_months_before_notice * rent && t - since >= p.arrears_months_before_notice * MONTH) {
          noticeGiven.set(a.id, t);
          steps.push([{ block: "give_notice", agreement: a.id, as: me, text: "Notice: rent is in arrears." }]);
        }
      }

      // Monthly: owners spend part of the income locally; upkeep is bought from outside.
      if (t >= nextSpend) {
        nextSpend = t + MONTH;
        const shops: string[] = p.shop_accounts ?? [];
        const spend = Math.min(acc.balance, Math.floor((income * p.spend_share_bps) / 10_000));
        const upkeep = Math.min(acc.balance - spend, Math.floor((income * p.upkeep_share_bps) / 10_000));
        income = 0;
        const s: Block[] = [];
        if (spend > 0 && shops.length) s.push(payInstruction(me, bank, acc.account, ctx.rng(`spend-${t}`).pick(shops), spend, "Owners' spending."));
        if (upkeep > 0 && p.outside_account) s.push(payInstruction(me, bank, acc.account, p.outside_account, upkeep, "Maintenance and repairs."));
        if (s.length) steps.push(s);
      }
      // Development: once every home we have has been let for a while, build
      // on a site we own. Apply for a permit; if refused, comply, or (with
      // probability 1 - compliance) build anyway.
      const units = owned.reduce((n, o) => n + o.units, 0);
      vacancyHistory.push({ t, vacant: Math.max(0, units - active.length), units });
      while (vacancyHistory.length && vacancyHistory[0]!.t < t - p.develop_window_days * DAY) vacancyHistory.shift();
      const vacantSum = vacancyHistory.reduce((n, h) => n + h.vacant, 0);
      const unitSum = vacancyHistory.reduce((n, h) => n + h.units, 0);
      const occupiedEnough = t >= p.develop_window_days * DAY && unitSum > 0 && vacantSum * 10_000 <= unitSum * p.develop_max_vacancy_bps;
      const emptySites = sites.filter((s) => !s.structure).map((s) => s.parcel).sort();
      const devType = types.get(p.develop_type);
      const price = devType ? Math.floor((devType.materials_cost * (10_000 + p.build_markup_bps)) / 10_000) : Infinity;
      if (p.develop && !dev && t >= devCooldownUntil && occupiedEnough && emptySites.length && acc.balance >= price + price / 2 && p.city && p.builder) {
        dev = { parcel: emptySites[0]!, stage: "applying" };
        steps.push([{ block: "publish", kind: "permit_application", speaks_for: me, addressed_to: [p.city], ref: "app", text: `Application to build a ${p.develop_type} on ${dev.parcel}.`, data: { parcel: dev.parcel, structure_type: p.develop_type } }]);
      }
      if (dev?.stage === "applied") {
        const decision = book.open("permit_decision").find((d) => d.data?.application === dev!.app);
        if (decision?.data?.decision === "granted") dev.stage = "granted";
        else if (decision?.data?.decision === "refused") {
          if (obeys(`refusal-${dev.app}`)) {
            dev = null;
            devCooldownUntil = t + 180 * DAY;
          } else dev.stage = "refused"; // building anyway
        }
      }
      if (dev && (dev.stage === "granted" || dev.stage === "refused") && acc.balance >= price) {
        const parcel = dev.parcel;
        dev.stage = "contracted";
        steps.push([
          { block: "propose_agreement", speaks_for: me, ref: "build", terms: {
            template: "construction", parties: [me, p.builder],
            commitments: [{ who: p.builder, does: { build: p.develop_type, on: parcel } }, { who: me, does: { pay: price, to: p.builder } }],
            text: `${p.builder} builds a ${p.develop_type} on ${parcel} for ${me}, for ${price} cents.`,
          } },
          { block: "sign_agreement", agreement: "$build", as: me },
          payInstruction(me, bank, acc.account, p.builder_account, price, `Construction of a ${p.develop_type} on ${parcel}.`),
        ]);
      }
      if (dev?.stage === "contracted" && sites.some((s) => s.parcel === dev!.parcel && s.structure)) dev = null;

      // Fines recorded against us, and demolition orders addressed to us.
      for (const r of book.records.values()) {
        if (answered.has(r.id)) continue;
        if (r.record === "claim" && r.position === "right" && r.counterparty === me && r.about?.kind === "fine") {
          answered.add(r.id);
          if (obeys(`fine-${r.id}`) && p.city_account && acc.balance >= r.about.amount) steps.push([payInstruction(me, bank, acc.account, p.city_account, r.about.amount, "Paying a fine.", { settles: r.id })]);
        }
        if (r.record === "statement" && r.kind === "demolition_order" && (r.addressed_to ?? []).includes(me)) {
          answered.add(r.id);
          if (obeys(`order-${r.id}`)) steps.push([{ block: "demolish", structure: r.data?.structure, costs_from: acc.account }]);
        }
      }
      void tenantAccount;
      return steps;
    });
  },
};

export const employer: BehaviourModule = {
  name: "firm.employer",
  version: "0.1.0",
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: SeatContext) {
    const p = params(
    {
      wage: 140_000, // cents per period
      period: 14 * DAY,
      target_staff: 5,
      notice_days: 14,
      supplier_share_bps: 4000, // cost of goods bought from outside, as a share of revenue
      buffer_periods: 2,
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    const orders = new Map<string, string>(); // agreement -> wage standing order
    const pendingOrder = new Map<string, string>(); // step marker -> agreement
    const handled = new Set<string>();
    const noticed = new Map<string, number>();
    let n = 0; // unique names for standing orders we create
    let revenue = 0;
    let nextSuppliers = MONTH;

    const absorb = (obs: Observation) => {
      book.absorb(obs);
      const acc = ownAccount(obs);
      if (acc) for (const [, amount] of receipts(obs, acc.account)) revenue += amount;
      // Standing orders we just set up.
      for (const o of obs.outcomes) for (const [ref, id] of Object.entries(o.created ?? {})) if (pendingOrder.has(ref)) { orders.set(pendingOrder.get(ref)!, id); pendingOrder.delete(ref); }
    };
    return stepper(absorb, (obs) => {
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      const bank = acc.custodian;
      // Genesis standing orders for existing staff.
      for (const r of book.records.values()) if (r.record === "statement" && r.kind === "instruction" && r.speaks_for === me && r.basis && !orders.has(r.basis) && !book.withdrawn.has(r.id)) orders.set(r.basis, r.id);

      const contracts = [...book.records.values()].filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === me) as any[];
      const endOf = (a: any) => Math.min(...(book.notices.get(a.id) ?? []).map((n) => n.at + (a.terms.termination?.find((x: any) => x.party === n.as)?.notice ?? 14 * DAY)), Infinity);
      const staff = contracts.filter((a) => book.inForce(a.id) && t < endOf(a));
      const offered = contracts.filter((a) => !book.inForce(a.id) && !book.signedBy(a.id, a.terms.parties[1]) && t - a.at < MONTH);
      const steps: Block[][] = [];

      // Newly signed: start paying wages by standing order.
      for (const a of staff) {
        if (orders.has(a.id) || [...pendingOrder.values()].includes(a.id)) continue;
        const account = ([...book.records.values()].find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === a.terms.parties[1]) as any)?.data?.account;
        if (!account) continue;
        const ref = `wo${n++}`;
        pendingOrder.set(ref, a.id);
        steps.push([{ ...standingOrder(me, bank, acc.account, account, p.wage, p.period, p.period, a.id, `Wages for ${a.terms.parties[1]}.`), ref }]);
      }
      // Ended (notice served): stop the wages.
      for (const a of contracts) if (book.inForce(a.id) && t >= endOf(a) && orders.has(a.id)) {
        steps.push([{ block: "withdraw", record: orders.get(a.id)!, speaks_for: me, text: "Employment ended; stop wages." }]);
        orders.delete(a.id);
      }

      // Hiring: one applicant at random per posting.
      const posts = book.open("job_posting").filter((j) => j.speaks_for === me);
      const apps = book.open("job_application").filter((a) => (a.addressed_to ?? []).includes(me) && !handled.has(a.id));
      for (const post of posts) {
        const mine = apps.filter((a) => a.data?.posting === post.id).sort((x, y) => (x.id < y.id ? -1 : 1));
        for (const a of mine) handled.add(a.id);
        if (!mine.length) continue;
        const worker = ctx.rng(`hire-${post.id}`).pick(mine).speaks_for!;
        steps.push([
          {
            block: "propose_agreement", speaks_for: me, ref: "job",
            terms: {
              template: "employment", parties: [me, worker],
              commitments: [{ who: worker, does: { work: post.data?.role ?? "staff" } }, { who: me, does: { pay: p.wage, to: worker }, every: p.period }],
              termination: [{ party: me, notice: p.notice_days * DAY }, { party: worker, notice: p.notice_days * DAY }],
              attrs: p.workplace ? { workplace: p.workplace } : {},
              text: `${worker} works for ${me} for ${p.wage} cents every ${p.period / DAY} days.`,
            },
          },
          { block: "sign_agreement", agreement: "$job", as: me },
          { block: "withdraw", record: post.id, speaks_for: me, text: "Filled." },
        ]);
      }

      // Post a job if short-staffed and the wage bill is affordable.
      const bill = (staff.length + 1) * p.wage;
      if (staff.length + offered.length + (steps.filter((s) => s[0]?.block === "propose_agreement").length) < p.target_staff && posts.length === 0 && acc.balance >= p.buffer_periods * bill) {
        steps.push([{ block: "publish", kind: "job_posting", speaks_for: me, text: `Hiring: ${p.wage} cents every ${p.period / DAY} days.`, data: { wage: p.wage, period: p.period, role: p.role ?? "staff" } }]);
      }

      // Can't cover the next pay period: lay off the most recent hire.
      if (staff.length && acc.balance < staff.length * p.wage) {
        const last = staff.filter((a) => !noticed.has(a.id)).sort((x, y) => (book.signedAt(y.id)! - book.signedAt(x.id)!))[0];
        if (last) {
          noticed.set(last.id, t);
          steps.push([{ block: "give_notice", agreement: last.id, as: me, text: "Redundancy: we can't cover the wage bill." }]);
        }
      }

      // Monthly: pay suppliers (the outside world) for goods sold.
      if (t >= nextSuppliers) {
        nextSuppliers = t + MONTH;
        const due = Math.min(acc.balance, Math.floor((revenue * p.supplier_share_bps) / 10_000));
        revenue = 0;
        if (due > 0 && p.outside_account) steps.push([payInstruction(me, bank, acc.account, p.outside_account, due, "Suppliers.")]);
      }
      return steps;
    });
  },
};
