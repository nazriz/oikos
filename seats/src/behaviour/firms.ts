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

import * as C from "../calls";
import type { Observation, ParticipantAction } from "../contracts";
import { channels } from "../contracts";
import { params, wait, type BehaviourModule, type ParticipantContext } from "../module";
import { between, Book, callAction, cellsOf, DAY, leaseTerms, MONTH, notice, offer, ownAccount, pay, say, structureOf, withdraw, type Step } from "./common";

/**
 * A participant observes after every action, not just when it wakes: `absorb` takes
 * in every observation (new records, payments received, ids just created),
 * and `plan` decides what to do once per wake.
 */
export function stepper(absorb: (obs: Observation) => void, plan: (obs: Observation) => Step[]) {
  let todo: Step[] = [];
  let plannedAt = -1;
  return {
    step(obs: Observation): ParticipantAction {
      absorb(obs);
      if (plannedAt !== obs.t) {
        todo = plan(obs).filter((s) => s.length);
        plannedAt = obs.t;
      }
      const next = todo.shift();
      return next ? callAction(next) : wait();
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
  version: "0.5.0",
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: ParticipantContext) {
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
      base_rent: {} as { [type: string]: number | { bedrooms: number; rent: number }[] }, // a rent per type, or per type and bedrooms
      // Development (see docs/behaviour/firms.md).
      develop: true,
      develop_type: "house",
      develop_window_days: 90, // look at average occupancy over this window
      develop_max_vacancy_bps: 1000, // build when average vacancy is at most 10% of homes
      build_markup_bps: 2000, // the builder's price over materials
      compliance_bps: 10_000, // how often it obeys a refusal, a fine, an order, or reports rent honestly
      tax_rate_bps: 0, // the rate it believes the tax law sets (the world supplies it)
      // Occupancy policy: turn down a household with more than this many people per bedroom (0: no limit). Two is the
      // occupancy standard's own ceiling (CNOS); whether a landlord applies it is the landlord's choice (placeholder).
      max_people_per_bedroom: 2,
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    const cfg = ctx.world.config;
    const types = new Map<string, any>(cfg.catalogue.structure_types.map((t: any) => [t.id, t]));
    // The homes we own: each a unit (a dwelling space) in a finished building on one of our lots.
    const owned: { structure: string; type: string; space: string; bedrooms?: number }[] = [];
    const received = new Map<string, number>(); // tenant account -> total received
    const listedAt = new Map<string, number>();
    const noticeGiven = new Map<string, number>(); // agreement -> when we gave notice
    const handled = new Set<string>();
    let income = 0;
    let nextSpend = MONTH;

    const vacancyHistory: { t: number; vacant: number; units: number }[] = [];
    let dev: { lot: string; stage: "applying" | "applied" | "granted" | "refused" | "contracted"; app?: string } | null = null;
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
      // What we own: the lots our ownership records name, the cells they cover (seen through our own sites),
      // and the homes (dwelling units) in finished buildings on them, including anything we've since built.
      const ownLots = [...book.records.values()].flatMap((r) => (r.record === "claim" && r.holder === me && r.about?.kind === "ownership" ? [r.about.object as string] : [])).sort();
      const ownCells = new Set(ownLots.flatMap((l) => cellsOf(book, l)));
      const sites = channels.cells(obs).filter((c) => ownCells.has(c.cell));
      owned.length = 0;
      const seenStructures = new Set<string>();
      for (const site of sites) {
        const st = site.structure;
        if (!st?.complete || seenStructures.has(st.structure)) continue;
        seenStructures.add(st.structure);
        for (const sp of st.spaces) if (sp.kind === "dwelling") owned.push({ structure: st.structure, type: st.type, space: sp.space, bedrooms: sp.attrs?.bedrooms });
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
      const steps: Step[] = [];
      const offeredNow: string[] = []; // units offered this wake (they're held too)
      const tenantOf = (a: any) => a.terms.parties.find((x: string) => x !== me);

      // Applications: pick one at random per listing, offer a lease, withdraw the listing.
      const apps = book.open("rental_application").filter((a) => (a.addressed_to ?? []).includes(me) && !handled.has(a.id));
      const byListing = new Map<string, typeof apps>();
      for (const a of apps) byListing.set(a.data?.listing, [...(byListing.get(a.data?.listing) ?? []), a]);
      const lettingNow = new Set<string>(); // listings being let (or withdrawn) in this plan: never also relisted
      // A unit is taken while a lease for it is in force or awaiting signature, or we've just offered one.
      const taken = (space: string) => [...active, ...awaiting].some((a) => leaseTerms(a, tenantOf(a)).space === space) || offeredNow.includes(space);
      for (const [listingId, as] of byListing) {
        for (const a of as) handled.add(a.id);
        const listing = book.records.get(listingId);
        if (listing?.record !== "statement" || book.withdrawn.has(listingId)) continue;
        // Only let a home that's still free; a stale listing is taken down instead.
        if (!listing.data.space || taken(listing.data.space) || !owned.some((o) => o.space === listing.data.space)) {
          lettingNow.add(listingId);
          steps.push([withdraw(listingId, "No longer available.")]);
          continue;
        }
        lettingNow.add(listingId);
        // Households the home is big enough for, by our policy (someone living alone fits anywhere).
        const beds = listing.data.bedrooms as number | undefined;
        const fits = (a: (typeof as)[number]) => {
          const people = (a.data?.household?.people as number | undefined) ?? 1;
          return !p.max_people_per_bedroom || beds === undefined || people <= Math.max(1, beds * p.max_people_per_bedroom);
        };
        const eligible = as.filter(fits).sort((x, y) => (x.id < y.id ? -1 : 1));
        if (!eligible.length) {
          lettingNow.delete(listingId); // still to let: wait for another applicant
          continue;
        }
        const pick = ctx.rng(`pick-${listingId}`).pick(eligible);
        const tenant = pick.speaks_for!;
        const household = ((pick.data?.members as string[] | undefined) ?? []).filter((m) => m !== tenant);
        const months = between(p.min_term_months, p.max_term_months, ctx.rng(`term-${listingId}`).below(1_000_000) / 1_000_000);
        steps.push([
          ["lease", offer(tenant, {
            template: "lease", term: months * MONTH, ourNotice: p.landlord_notice_days * DAY, theirNotice: p.tenant_notice_days * DAY,
            we: C.call("occupancy", { who: tenant, in: listing.data.space }),
            they: pay(acc.account, listing.data.rent, { every: MONTH, for: "rent" }),
            text: `${tenant} rents home ${listing.data.space} from ${me} for ${listing.data.rent} cents a month, for ${months} months${household.length ? `, to live there with their household: ${household.join(", ")}` : ""}.`,
          })],
          withdraw(listingId, "Let."),
        ]);
        offeredNow.push(listing.data.space);
      }

      // Vacancies: list each free unit, at a markup over what we currently get for homes in that building.
      const openListings = book.open("rental_listing").filter((l) => l.speaks_for === me);
      const listing = (o: (typeof owned)[number], rent: number) =>
        say("rental_listing", `Home to let: ${o.space}${o.bedrooms ? `, ${o.bedrooms} bedrooms` : ""}, ${rent} cents a month.`, { data: { structure: o.structure, space: o.space, type: o.type, ...(o.bedrooms ? { bedrooms: o.bedrooms } : {}), rent } });
      for (const o of owned) {
        const listed = openListings.filter((l) => l.data?.space === o.space && !lettingNow.has(l.id));
        if (!taken(o.space) && listed.length === 0) {
          // What we get now for homes like it: the same building, the same number of bedrooms.
          const like = (a: any) => {
            const lt = leaseTerms(a, tenantOf(a));
            return lt.structure === o.structure && owned.find((x) => x.space === lt.space)?.bedrooms === o.bedrooms;
          };
          const going = active.filter(like).map((a) => leaseTerms(a, tenantOf(a)).rent);
          const base = p.base_rent[o.type];
          const baseRent = typeof base === "number" ? base : (base?.find((b) => b.bedrooms === o.bedrooms)?.rent ?? 100_000);
          const ref = going.length ? Math.floor(going.reduce((x, y) => x + y, 0) / going.length) : baseRent;
          const noise = 9_750 + ctx.rng(`price-${o.space}`).below(501); // +/-2.5%
          steps.push([listing(o, Math.floor((((ref * (10_000 + p.markup_bps)) / 10_000) * noise) / 10_000))]);
        }
        // Unlet for a month: cut the asking rent (BoE: 5% a month).
        for (const l of listed) {
          const since = listedAt.get(l.id) ?? l.at;
          if (t - since >= MONTH) steps.push([withdraw(l.id, "Relisting at a lower rent."), listing(o, Math.floor((l.data.rent * (10_000 - p.cut_bps)) / 10_000))]);
        }
      }

      // Arrears: give notice after enough unpaid months (rent is due monthly in advance).
      for (const a of active) {
        if (noticeGiven.has(a.id)) continue;
        const tenant = tenantOf(a);
        const rent = leaseTerms(a, tenant).rent;
        const since = book.signedAt(a.id)!;
        const due = Math.floor((t - since) / MONTH) + 1;
        const paying = ([...book.records.values()].find((r) => r.record === "statement" && r.kind === "rental_application" && r.speaks_for === tenant) as any)?.data?.account ?? cfg.world.accounts.find((x: any) => x.holder === tenant)?.id;
        const paid = paying ? received.get(paying) ?? 0 : 0;
        if ((due * rent - paid) >= p.arrears_months_before_notice * rent && t - since >= p.arrears_months_before_notice * MONTH) {
          noticeGiven.set(a.id, t);
          steps.push([notice(a.id, "Notice: rent is in arrears.")]);
        }
      }

      // Monthly: owners spend part of the income locally; upkeep is bought from outside.
      if (t >= nextSpend) {
        nextSpend = t + MONTH;
        const shops: string[] = p.shop_accounts ?? [];
        // Tax on rent received (the town's tax law): report it and pay, or (when
        // not complying) report only half. The tax clerk sees only the report.
        let tax = 0;
        if (p.city && p.city_account && p.tax_rate_bps && income > 0) {
          const reported = obeys(`tax-${t}`) ? income : Math.floor(income / 2);
          tax = Math.min(acc.balance, Math.floor((reported * p.tax_rate_bps) / 10_000));
          steps.push([
            say("tax_report", `Rent received this month: ${reported} cents.`, { to: [p.city], data: { period_end: t, rent_received: reported, account: acc.account } }),
            ...(tax > 0 ? [pay(p.city_account, tax, { from: acc.account, for: "Tax on rent received." })] : []),
          ]);
        }
        const spend = Math.min(acc.balance - tax, Math.floor((income * p.spend_share_bps) / 10_000));
        const upkeep = Math.min(acc.balance - tax - spend, Math.floor((income * p.upkeep_share_bps) / 10_000));
        income = 0;
        const s: Step = [];
        if (spend > 0 && shops.length) s.push(pay(ctx.rng(`spend-${t}`).pick(shops), spend, { from: acc.account, for: "Owners' spending." }));
        if (upkeep > 0 && p.outside_account) s.push(pay(p.outside_account, upkeep, { from: acc.account, for: "Maintenance and repairs." }));
        if (s.length) steps.push(s);
      }
      // Development: once every home we have has been let for a while, build
      // on a site we own. Apply for a permit; if refused, comply, or (with
      // probability 1 - compliance) build anyway.
      const units = owned.length;
      vacancyHistory.push({ t, vacant: Math.max(0, units - active.length), units });
      while (vacancyHistory.length && vacancyHistory[0]!.t < t - p.develop_window_days * DAY) vacancyHistory.shift();
      const vacantSum = vacancyHistory.reduce((n, h) => n + h.vacant, 0);
      const unitSum = vacancyHistory.reduce((n, h) => n + h.units, 0);
      const occupiedEnough = t >= p.develop_window_days * DAY && unitSum > 0 && vacantSum * 10_000 <= unitSum * p.develop_max_vacancy_bps;
      // A lot of ours with nothing on it yet.
      const emptyLots = ownLots.filter((l) => cellsOf(book, l).length > 0 && cellsOf(book, l).every((c) => sites.some((s) => s.cell === c && !s.structure)));
      const devType = types.get(p.develop_type);
      const price = devType ? Math.floor((devType.materials_cost * (10_000 + p.build_markup_bps)) / 10_000) : Infinity;
      if (p.develop && !dev && t >= devCooldownUntil && occupiedEnough && emptyLots.length && acc.balance >= price + price / 2 && p.city && p.builder) {
        dev = { lot: emptyLots[0]!, stage: "applying" };
        // The planning office's published form (it's in the world's genesis records).
        steps.push([["app", C.call("form", { to: p.city, form: "permit_application", lot: dev.lot, structure_type: p.develop_type })]]);
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
        const lot = dev.lot;
        dev.stage = "contracted";
        steps.push([["build", C.call("structure", { type: p.develop_type, on: lot, by: p.builder, price: C.dollars(price), from: acc.account })]]);
      }
      if (dev?.stage === "contracted" && sites.some((s) => cellsOf(book, dev!.lot).includes(s.cell) && s.structure)) dev = null;

      // Invoices addressed to us (from the builder): pay them.
      for (const inv of book.open("invoice")) {
        if (answered.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
        answered.add(inv.id);
        const owed = inv.data?.outcome?.money;
        if (owed && acc.balance >= owed.amount) steps.push([pay(owed.to, owed.amount, { from: acc.account, for: "Paying an invoice.", settles: inv.id })]);
      }

      // Fines recorded against us, and demolition orders addressed to us.
      for (const r of book.records.values()) {
        if (answered.has(r.id)) continue;
        if (r.record === "claim" && r.position === "right" && r.counterparty === me && ["fine", "tax_penalty"].includes(r.about?.kind)) {
          answered.add(r.id);
          if (obeys(`fine-${r.id}`) && p.city_account && acc.balance >= r.about.amount) steps.push([pay(p.city_account, r.about.amount, { from: acc.account, for: "Paying a fine.", settles: r.id })]);
        }
        if (r.record === "statement" && r.kind === "demolition_order" && (r.addressed_to ?? []).includes(me)) {
          answered.add(r.id);
          if (obeys(`order-${r.id}`)) steps.push([C.call("structure", { remove: r.data?.structure, by: me, from: acc.account })]);
        }
      }
      return steps;
    });
  },
};

export const employer: BehaviourModule = {
  name: "firm.employer",
  version: "0.4.0",
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: ParticipantContext) {
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
      // Genesis standing orders for existing staff.
      for (const r of book.records.values()) if (r.record === "statement" && r.kind === "request" && r.speaks_for === me && r.basis && !orders.has(r.basis) && !book.withdrawn.has(r.id)) orders.set(r.basis, r.id);

      const contracts = [...book.records.values()].filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === me) as any[];
      const endOf = (a: any) => Math.min(...(book.notices.get(a.id) ?? []).map((n) => n.at + (a.terms.termination?.find((x: any) => x.party === n.as)?.notice ?? 14 * DAY)), Infinity);
      const staff = contracts.filter((a) => book.inForce(a.id) && t < endOf(a));
      const offered = contracts.filter((a) => !book.inForce(a.id) && !book.signedBy(a.id, a.terms.parties[1]) && t - a.at < MONTH);
      const steps: Step[] = [];
      let offersNow = 0;

      // Newly signed: start paying wages by standing order.
      for (const a of staff) {
        if (orders.has(a.id) || [...pendingOrder.values()].includes(a.id)) continue;
        const account = ([...book.records.values()].find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === a.terms.parties[1]) as any)?.data?.account;
        if (!account) continue;
        const ref = `wo${n++}`;
        pendingOrder.set(ref, a.id);
        steps.push([[ref, pay(account, p.wage, { from: acc.account, every: p.period, first: p.period, basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })]]);
      }
      // Ended (notice served): stop the wages.
      for (const a of contracts) if (book.inForce(a.id) && t >= endOf(a) && orders.has(a.id)) {
        steps.push([withdraw(orders.get(a.id)!, "Employment ended; stop wages.")]);
        orders.delete(a.id);
      }

      // Hiring: one applicant at random per posting.
      const posts = book.open("job_posting").filter((j) => j.speaks_for === me);
      const apps = book.open("job_application").filter((a) => (a.addressed_to ?? []).includes(me) && !handled.has(a.id));
      for (const post of posts) {
        const mine = apps.filter((a) => a.data?.posting === post.id).sort((x, y) => (x.id < y.id ? -1 : 1));
        for (const a of mine) handled.add(a.id);
        if (!mine.length) continue;
        const chosen = ctx.rng(`hire-${post.id}`).pick(mine);
        const worker = chosen.speaks_for!;
        steps.push([
          ["job", offer(worker, {
            template: "employment", ourNotice: p.notice_days * DAY, theirNotice: p.notice_days * DAY,
            we: pay(chosen.data?.account ?? worker, p.wage, { every: p.period, for: "wages" }),
            they: p.workplace ? C.call("occupancy", { who: worker, in: p.workplace }) : undefined,
            text: `${worker} works for ${me} as ${post.data?.role ?? "staff"} for ${p.wage} cents every ${p.period / DAY} days.`,
          })],
          withdraw(post.id, "Filled."),
        ]);
        offersNow++;
      }

      // Post a job if short-staffed and the wage bill is affordable.
      const bill = (staff.length + 1) * p.wage;
      if (staff.length + offered.length + offersNow < p.target_staff && posts.length === 0 && acc.balance >= p.buffer_periods * bill) {
        steps.push([say("job_posting", `Hiring: ${p.wage} cents every ${p.period / DAY} days.`, { data: { wage: p.wage, period: p.period, role: p.role ?? "staff", ...(p.workplace ? { workplace: structureOf(p.workplace), space: p.workplace } : {}) } })]);
      }

      // Can't cover the next pay period: lay off the most recent hire.
      if (staff.length && acc.balance < staff.length * p.wage) {
        const last = staff.filter((a) => !noticed.has(a.id)).sort((x, y) => (book.signedAt(y.id)! - book.signedAt(x.id)!))[0];
        if (last) {
          noticed.set(last.id, t);
          steps.push([notice(last.id, "Redundancy: we can't cover the wage bill.")]);
        }
      }

      // Monthly: pay suppliers (the outside world) for goods sold.
      if (t >= nextSuppliers) {
        nextSuppliers = t + MONTH;
        const due = Math.min(acc.balance, Math.floor((revenue * p.supplier_share_bps) / 10_000));
        revenue = 0;
        if (due > 0 && p.outside_account) steps.push([pay(p.outside_account, due, { from: acc.account, for: "Suppliers." })]);
      }
      return steps;
    });
  },
};
