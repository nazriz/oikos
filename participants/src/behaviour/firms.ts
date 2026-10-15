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

import { keeping, Org, type OrgParams } from "./orgwants";
import { cents, moneyNow } from "../money";
import * as C from "../calls";
import { dateWords, durationWords } from "../forms";
import type { LookRequest, Observation, Offer, ParticipantAction, StatementRecord } from "../contracts";
import { basesOf, channels } from "../contracts";
import { params, wait, type Belief, type BehaviourModule, type ParticipantContext, type Taken } from "../module";
import { distribute } from "./lengnick";
import { dayPayPeriod, incomeTaxLaw, withheld, type Charge } from "./tax";
import { nextReturn, returnsOf, type ReturnRule } from "./returns";
import { message, broughtForward } from "./common";
import { chancePpm, frictionDial, PAPER, Respondent, type RespondParams } from "./frictions";
import { swayed } from "./wants";
import { advertisedJob, ask, Asked, because, between, Book, firstDue, PAYEE_DIED, PAYMENT_FAILED, breaches, noting, callAction, usd, cellsOf, commitmentOf, DAY, jobTerms, leaseTerms, MONTH, notice, offer, ownAccount, pay, publishedPrice, say, stoodEmpty, structureOf, withdraw, type Step } from "./common";
import * as P from "./papers";
import { firstDueOf } from "./openbooks";

/**
 * A participant observes after every action, not just when it wakes: `absorb` takes
 * in every observation (new records, payments received, ids just created),
 * and `plan` decides what to do once per wake. A step may say what follows from its own outcome (`then`: an order's
 * id, whether a day's work was done): what it returns is done next. A step refused because the world changed in the
 * same moment (D58) is undone by its own `then`; the rest of the plan goes on, each step tried as it comes.
 */
/** `until`: when to wake next with nothing left to do (the time it asks for), if not on its cadence.
 * `looks`: what it needs to look up before it plans (a search through a channel of its own that is shown only on
 * request: a register, say): asked first, the answer comes with the next observation, and it is asked again until it
 * needs nothing more (so it must not ask twice for what a look didn't find). */
export function stepper(absorb: (obs: Observation) => void, plan: (obs: Observation) => Step[], until?: (obs: Observation) => number | undefined, looks?: (obs: Observation) => LookRequest[]) {
  let todo: Step[] = [];
  let carried: Step[] = []; // what followed from our last act, kept over a look
  let plannedAt = -1;
  /** A day's work (a step with a `work` call) left undone when the day's over is dropped, not carried: it spent that day's
   * hours. Its `then` hears it wasn't done, as if refused, so the module puts back what it counted on (an order served). */
  const worksToday = (s: Step) => s.some((l) => (Array.isArray(l) ? l[1] : l).fn === "work");
  // (Acts of ours under way, by the action the world made of each. An office that sets a crew to work is free for its next act
  // before the crew is done, and a refusal comes at once while an earlier act is still under way, so outcomes do not come
  // in the order the acts were sent: each is matched to its act by name. F1, 2026-10-15.)
  const underWay = new Map<string, { step: Step; at: number }>();
  let last: Step | undefined;
  let lastAt = 0;
  let hooked = false; // the world tells us the name of each act we send (it does in a run; a test that feeds observations by hand does not)
  let returned: Step | undefined; // (and then it is the last act's outcome that is the last outcome, as it always was)
  return {
    sent(action: string) {
      hooked = true;
      if (last) underWay.set(action, { step: last, at: lastAt });
      last = undefined;
    },
    step(obs: Observation): ParticipantAction {
      const follow: Step[] = carried;
      carried = [];
      // (An act that was never heard of again is not under way after days.)
      for (const [id, x] of underWay) if (obs.t - x.at > 3 * DAY) underWay.delete(id);
      if (!hooked) {
        const o = returned ? obs.outcomes.at(-1) : undefined;
        if (returned?.then && o) follow.push(...(returned.then(o) ?? []));
      }
      returned = undefined;
      for (const o of hooked ? obs.outcomes : []) {
        const x = underWay.get(o.action);
        if (!x) continue;
        underWay.delete(o.action);
        if (x.step.then) follow.push(...(x.step.then(o) ?? []));
      }
      absorb(obs);
      // A plan is made when a wake begins; woken because an act of ours is done, we carry on with it (acts take time:
      // docs/design/rebuild.md 6.3), never planning again what's still to do. With nothing left, it's a new moment: we
      // plan afresh (what's due now may not have been when the wake began).
      if (plannedAt !== obs.t && (obs.woke_for !== "done" || todo.length === 0)) {
        const ask = looks?.(obs) ?? [];
        if (ask.length) {
          carried = follow;
          return { type: "look", looks: ask };
        }
        // What a wake didn't get to (it allows only so many actions) is done first at the next: a module's state already
        // counts on it (a price it holds as published, a payment as made), so it's never dropped, but for a day's work
        // once the day's over.
        if (plannedAt >= 0 && Math.floor(obs.t / DAY) !== Math.floor(plannedAt / DAY)) {
          const stale = todo.filter(worksToday);
          todo = todo.filter((s) => !worksToday(s));
          for (const s of stale) todo.unshift(...((s.then?.({ action: "", t: obs.t, status: "refused", refusal: { code: "not_done", detail: "a day's work not got to that day" } } as any) ?? []).filter((x) => x.length)));
        }
        const fresh = plan(obs).filter((s) => s.length);
        for (const s of fresh) s.planned ??= obs.t;
        todo = [...todo, ...fresh];
        plannedAt = obs.t;
      }
      todo.unshift(...follow.filter((s) => s.length));
      let next = todo.shift();
      // (A step whose moment has passed is not sent: told it was not got to, as a day's work is at the day's turn.)
      while (next?.lapsed?.(obs.t)) {
        todo.unshift(...(next.then?.({ action: "", t: obs.t, status: "refused", refusal: { code: "not_done", detail: "not got to before the day's hours were over" } } as any) ?? []).filter((x) => x.length));
        next = todo.shift();
      }
      if (!next) return wait(until?.(obs));
      // Done later than planned: a step that counts from when it's done is made again for now (a notice's date).
      if (next.redo && next.planned !== undefined && next.planned !== obs.t) next = next.redo(obs.t);
      last = next;
      returned = next;
      lastAt = obs.t;
      return callAction(next);
    },
  };
}

/** Money received into `account` this observation, by paying account. */
export function receipts(obs: Observation, account: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const tx of channels.transactions(obs)) if (tx.to === account && tx.from !== account) m.set(tx.from, (m.get(tx.from) ?? 0) + cents(tx.amount));
  return m;
}

export const landlord: BehaviourModule = {
  name: "firm.landlord",
  issues: P.LANDLORD,
  issuesWith: (p) => ({ city: p.city, tribunal: p.possession?.tribunal, builder: p.repair?.builder }),
  version: "0.19.0", // 0.19.0: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.18.0: replies to a tenant's answer to its application with what its rent book shows owed; withdraws an application once the rent owed is paid; withdraws its request for a warrant when the tenant has gone; 0.17.0: an application for possession of a home the tenant has since left is withdrawn; rent owed as the year began (its statement of the rent account) is owed with the rest; tenancies already under notice or before the tribunal when its files are first opened are taken up where their papers put them; 0.16.2: an application for possession names the notice to vacate it relies on, the day it was given and the day it gave; its answers to requests, notices and decisions are drawn by who asked and what about, not by a paper's number on file (docs/decisions.md, 2026-10-12); 0.16.1: rent under a lease is counted from the lease's own rent day where it names one (attrs.first_due), and arrears are taken up on the office's own day of the week for its rent book; 0.16.0: possession under the world's law (docs/behaviour/justice.md, "Possession"): a notice to vacate, an application to the tribunal, a warrant, never putting anyone out itself; 0.15.0: everyday frictions (docs/behaviour/frictions.md): a home of ours in disrepair is repaired by the builder when we are asked or ordered and will, at its price; we answer a venue from our books; rent owed us is asked for and then taken to a body that hears arrears; 0.14.0: wants of its own (docs/behaviour/firm-wants.md), for one the world's dial gives initiative: a character from its owner's values, which answers a tenant who asks it to hold a rent or to stay on, sways its markup and its patience with arrears, and a record of its own; 0.13.4: main's 0.13.3 (the builder's answer read with the week's post; what is owed counted before building or asking) with a certified copy of a registration made on someone else's report counting as the registration
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
      // Possession (docs/behaviour/justice.md, "Possession"): where the world has a law on it, the tribunal an
      // application for possession goes to, and what it and its registrar charge (the world's; none: a tenant
      // behind with the rent is given notice on the lease, which ends it, as before).
      possession: null as { tribunal: string; fee?: number; fee_account?: string; warrant_fee?: number } | null,
      spend_share_bps: 6000, // owners' spending of rental income, at local shops
      upkeep_share_bps: 2000, // maintenance bought from outside
      base_rent: {} as { [type: string]: number | { bedrooms: number; rent: number }[] }, // a rent per type, or per type and bedrooms
      // Development (see docs/behaviour/firms.md).
      develop: true,
      develop_type: "house",
      develop_window_days: 90, // look at average occupancy over this window
      develop_max_vacancy_bps: 1000, // build when average vacancy is at most 10% of homes
      compliance_bps: 10_000, // how often it obeys a refusal, a fine, an order, or reports rent honestly
      tax_rate_bps: 0, // the rate it believes the tax law sets (the world supplies it)
      // Occupancy policy: turn down a household with more than this many people per bedroom (0: no limit). Two is the
      // occupancy standard's own ceiling (CNOS); whether a landlord applies it is the landlord's choice (placeholder).
      max_people_per_bedroom: 2,
      // Reviewing rents (docs/behaviour/firms.md): the landlord's own practice, how often it reviews a tenancy's rent
      // and the notice it gives (none: it doesn't, unless the law allows it). The world's law on rent increases, where
      // there is one, bounds it: no more often than the law allows, and at least the notice it requires.
      rent_review_months: null as number | null,
      rent_increase_notice_days: 0,
      // What our leases say happens after the fixed term: "periodic", they run on until ended by notice (as the world's
      // tenancy law commonly provides; the world gives it); none, they end with it.
      after_term: null as "periodic" | null,
      // Offering the sitting tenant a new lease as one that ends with its term runs out (placeholder: landlords mostly
      // do). A lease that runs on after its term needs none.
      renew: true,
      // The land register, where this world keeps one to look things up in: our channel onto its plans of lots. (None:
      // whatever plans we know are those we're shown.)
      register: null as { lots: string } | null,
      // Wants of its own (docs/behaviour/firm-wants.md): whether it takes initiative (none given: its own draw
      // against the world's dial), the values of whoever owns most of it and the town's figures they are read
      // against (the world's), and the sizes (`org`: placeholders).
      initiative: null as boolean | null,
      owner_values: null as { [value: string]: number } | null,
      values: {} as { [value: string]: { mean_bps: number; sd_bps: number } },
      org: {} as Partial<OrgParams>,
      // Everyday frictions (docs/behaviour/frictions.md): a home of ours fallen into disrepair is put right by the
      // builder, at its price for a job of so many units, paid with the order (the world's; none: we order nothing);
      // and how we answer when asked to, told of a complaint, or ordered (the world's rates; our character sways them).
      repair: null as { builder: string; account: string; units: number; price: number } | null,
      respond: {} as Partial<RespondParams>,
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    const org = new Org(ctx, { initiative: p.initiative, owner_values: p.owner_values, values: p.values, org: p.org });
    // Our titles are our own papers; the plan of each lot is looked up in the register, once.
    const planAsked = new Asked();
    const ownLotsNow = () => book.ofType("claim").flatMap((r) => (r.record === "claim" && r.holder === me && r.about?.kind === "ownership" ? [r.about.object as string] : [])).sort();
    const plansToRead = (): LookRequest[] => {
      if (!p.register) return [];
      for (const lot of ownLotsNow()) {
        if (book.records.has(lot) || !planAsked.first(lot)) continue;
        return [ask.one(p.register.lots, lot)];
      }
      return [];
    };
    // The homes we own: each a unit (a dwelling space) in a finished building on one of our lots.
    const owned: { structure: string; type: string; space: string; bedrooms?: number }[] = [];
    const received = new Map<string, { t: number; amount: number }[]>(); // tenant account -> each payment received, and when
    const renewsAt = new Map<string, number>(); // a lease we've offered to renew -> when its term ends (the new one's rent runs from then)
    const listedAt = new Map<string, number>();
    const noticeGiven = new Map<string, number>(); // agreement -> when we gave notice
    const handled = new Set<string>();
    let income = 0;
    let nextSpend = MONTH;

    const vacancyHistory: { t: number; vacant: number; units: number }[] = [];
    // A building of ours in the making: the lot, how far it has got, and, once the builder is asked, how the permit
    // stood then (`permit`), the agreement we offered (`contract`) and when (`offeredAt`). `told`: what the builder
    // last wrote that it charges, declining an offer of ours, and when.
    let dev: { lot: string; stage: "applying" | "applied" | "granted" | "refused" | "contracted"; app?: string; permit?: "granted" | "refused"; contract?: string; offeredAt?: number; notBefore?: number; told?: { price: number; at: number } } | null = null;
    let devCooldownUntil = 0;
    // What we owe and have not yet paid out of our account (our books, beside the bank's balance): the price of each
    // building we have asked the builder for, from the offer until its invoice is paid or the offer declined; and each
    // payment of an invoice we have told the bank to make, until we see it leave the account.
    const owing = new Map<string, number>(); // our offer to the builder (an agreement) -> its price
    const paying = new Map<string, { amount: number; at: number }>(); // invoice -> a payment instructed, not yet seen debited
    const answered = new Set<string>(); // fines and orders we've responded to
    const rentChanges = new Map<string, { from: number; rent: number }[]>(); // lease -> rent increases we've given notice of
    const lastReview = new Map<string, number>(); // lease -> when its rent was last reviewed
    const renewed = new Set<string>(); // leases whose tenant we've offered a new one
    const obeys = (key: string) => ctx.rng(`comply-${key}`).below(10_000) < p.compliance_bps;
    const lateSince = new Map<string, number>(); // lease -> since when its rent has been a month or more behind
    // The office's own day and hour of the week for going through the rent book (each landlord's, drawn once): it is
    // then that arrears are taken up, by a letter, an application or a notice. Until 2026-10-11 they were taken up at
    // whatever look came first, and a town's landlords, all woken by the same weekly paper, all wrote in one instant.
    const WEEK = 7 * DAY;
    const bookTime = ctx.rng("rent-book-day").below(7 * 24) * 3_600;
    const sinceBooks = (t: number) => (((t - bookTime) % WEEK) + WEEK) % WEEK;
    let booksWeek: number | undefined; // the week (counted from our own day) whose rent book we last went through

    const absorb = (obs: Observation) => {
      book.absorb(obs);
      if (dev?.stage === "applying") for (const o of obs.outcomes) if (o.created?.app) { dev.app = o.created.app; dev.stage = "applied"; }
      const acc = ownAccount(obs);
      if (acc) for (const tx of channels.transactions(obs)) if (tx.from === acc.account && tx.settles) paying.delete(tx.settles);
      if (acc) for (const tx of channels.transactions(obs)) if (tx.to === acc.account && tx.from !== acc.account) {
        income += cents(tx.amount);
        const list = received.get(tx.from);
        if (list) list.push({ t: tx.t, amount: cents(tx.amount) });
        else received.set(tx.from, [{ t: tx.t, amount: cents(tx.amount) }]);
      }
    };
    // The leases we hold in force, as we have them (truth audits).
    const leasesHeld = (): Belief[] => [{ of: "held", party: me, template: "lease",
      agreements: book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "lease" && r.terms.parties[0] === me && book.inForce(r.id)).map((r) => r.id) }];
    // Repairs: those we have ordered and not yet heard are done, and when each building of ours was last repaired.
    const askedFor = new Map<string, number>(); // a lease -> when we last wrote to ask for the rent owed under it
    // Tenancies we are ending for arrears under the world's law on possession: where each has got to.
    let filesRead = false; // (whether we have read, once, what our files say of tenancies already being ended)
    const ending = new Map<string, { stage: "noticed" | "applied" | "plan" | "ordered" | "warrant"; by: number; notice?: string; seen: Set<string>; plan?: { at: number; owed: number; instalment: number } }>();
    const repairing = new Map<string, number>();
    const repaired = new Map<string, number>();
    let payFrom = "";
    const answering = new Respondent(ctx.rng, me, org, { params: p.respond, forms: [{ notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }],
      // (What our books say of a home said to need repair: done, if the builder has told us so lately; else not.)
      truth: (m, _from, _book, t) => (m.matter === "disrepair" && m.structure ? { done: t - (repaired.get(m.structure) ?? -Infinity) < 90 * DAY } : undefined),
      cost: (m) => (m.matter === "disrepair" && p.repair && m.structure && !repairing.has(m.structure) ? p.repair.units * p.repair.price : 0),
      remedy: (m, _from, t, why) => {
        const r = p.repair;
        if (m.matter !== "disrepair" || !r || !m.structure || !payFrom || repairing.has(m.structure)) return undefined;
        repairing.set(m.structure, t);
        org.remember(t, "ordered_repair", m.structure);
        return [because(`${why} Ordering the repair of ${m.structure} from ${r.builder}, and paying its price of ${usd(r.units * r.price)}.`,
          say("repair_order", `Order: the repair of ${m.structure} (${r.units} units of work), paid with this order.`, { to: [r.builder], visible: [me, r.builder], data: { structure: m.structure, units: r.units, account: payFrom } }),
          pay(r.account, r.units * r.price, { from: payFrom, for: `Repair of ${m.structure}.` }))];
      } });
    return keeping(org, noting(book, Object.assign(stepper(absorb, (obs) => {
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      payFrom = acc.account;
      for (const r of [...book.open("repair_done"), ...book.open("repair_declined")]) {
        const st = String(r.data?.structure ?? "");
        if (!(r.addressed_to ?? []).includes(me) || !repairing.has(st) || r.at < repairing.get(st)!) continue;
        repairing.delete(st);
        if (r.kind === "repair_done") repaired.set(st, t);
      }
      // What we own: the lots our ownership records name, the cells they cover (seen through our own sites),
      // and the homes (dwelling units) in finished buildings on them, including anything we've since built.
      const ownLots = ownLotsNow();
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
      const leases = book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "lease" && r.terms.parties[0] === me && book.signedBy(r.id, me));
      const awaiting = (leases as any[]).filter((a) => !book.concluded(a.id) && t - a.at < MONTH);
      const active = (leases as any[]).filter((a: any) => book.inForce(a.id)) as any[];
      const steps: Step[] = [];
      // (The rent book is gone through once a week of our own: at our first look in it, which is our own day and hour
      // unless something kept us from it.)
      const thisWeek = Math.floor((t - bookTime) / WEEK);
      const atBooks = thisWeek !== booksWeek;
      booksWeek = thisWeek;
      // (Our markup, as our character sways it: docs/behaviour/firm-wants.md. As the routine has it, where we have none.)
      const markupBps = org.markup(p.markup_bps);
      const offeredNow: string[] = []; // units offered this wake (they're held too)
      const tenantOf = (a: any) => a.terms.parties.find((x: string) => x !== me);
      // A lease's rent at a time: as agreed, or as we've since raised it.
      const rentAt = (a: any, at: number) => [...(rentChanges.get(a.id) ?? [])].reverse().find((c) => c.from <= at)?.rent ?? leaseTerms(a, tenantOf(a)).rent;

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
          steps.push(because("An application for a home that's no longer free: taking the listing down.", withdraw(listingId, "No longer available.")));
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
        steps.push(because(`Letting ${listing.data.space}: an applicant picked at random among the ${eligible.length} it fits (at most ${p.max_people_per_bedroom || "any number of"} people per bedroom), for ${months} months.`,
          ["lease", offer(tenant, {
            template: "lease", term: months * MONTH, ...(p.after_term ? { then: p.after_term } : {}), ourNotice: p.landlord_notice_days * DAY, theirNotice: p.tenant_notice_days * DAY,
            we: C.call("occupancy", { who: tenant, in: listing.data.space }),
            they: pay(acc.account, listing.data.rent, { every: MONTH, for: "rent" }),
            text: `${tenant} rents home ${listing.data.space} from ${me} for ${moneyNow(listing.data.rent)} a month, for ${months} months${household.length ? `, to live there with their household: ${household.join(", ")}` : ""}.`,
            basis: pick.id,
          })],
          withdraw(listingId, "Let."),
        ));
        offeredNow.push(listing.data.space);
      }

      // Renewals: a tenancy whose term ends within our notice period, with no notice given, is offered again to the
      // sitting tenant: the home, at its rent then, for a new term from when this one ends (what landlords and their
      // agents do as a lease runs out; letting it run out and relisting the home costs a vacancy and a search).
      if (p.renew) for (const a of active) {
        const ends = book.endsAt(a.id);
        if (a.terms.then === "periodic" || ends === undefined || renewed.has(a.id) || noticeGiven.has(a.id) || ends - t > p.landlord_notice_days * DAY) continue;
        const tenant = tenantOf(a);
        const lt = leaseTerms(a, tenant);
        if (!lt.space || !owned.some((o) => o.space === lt.space)) continue;
        renewed.add(a.id);
        renewsAt.set(a.id, ends);
        const rent = rentAt(a, ends);
        const months = between(p.min_term_months, p.max_term_months, ctx.rng(`renew-${a.id}`).below(1_000_000) / 1_000_000);
        const household = (a.terms.text as string | undefined)?.match(/household: (.*)\.$/)?.[1];
        steps.push(because(`The tenancy of ${lt.space} ends on day ${Math.floor(ends / DAY)}: offering ${tenant} a new lease at ${usd(rent)} a month, for ${months} months from then.`,
          ["lease", offer(tenant, {
            template: "lease", term: ends - t + months * MONTH, ...(p.after_term ? { then: p.after_term } : {}), ourNotice: p.landlord_notice_days * DAY, theirNotice: p.tenant_notice_days * DAY,
            we: C.call("occupancy", { who: tenant, in: lt.space }),
            they: pay(acc.account, rent, { every: MONTH, for: "rent" }),
            text: `${tenant} rents home ${lt.space} from ${me} for ${moneyNow(rent)} a month, renewing their lease (${a.id}) for ${months} months from day ${Math.floor(ends / DAY)}${household ? `, to live there with their household: ${household}` : ""}.`,
            basis: a.id,
          })]));
      }

      // Vacancies: list each free unit, at a markup over what we currently get for homes in that building.
      const openListings = book.open("rental_listing").filter((l) => l.speaks_for === me);
      const listing = (o: (typeof owned)[number], rent: number) =>
        say("rental_listing", `Home to let: ${o.space}${o.bedrooms ? `, ${o.bedrooms} bedrooms` : ""}, ${moneyNow(rent)} a month.`, { data: { structure: o.structure, space: o.space, type: o.type, ...(o.bedrooms ? { bedrooms: o.bedrooms } : {}), rent },
          // The lease it's for (2a): the home to occupy, the rent monthly.
          offer: { by: me, take_up: "apply", available: 1, terms: { template: "lease", ...(p.after_term ? { then: p.after_term } : {}), commitments: [
            { who: me, does: { outcome: { occupancy: { in: o.space } } } },
            { who: "taker", does: { outcome: { money: { to: acc.account, amount: String(rent), for: "rent" } } }, every: MONTH },
          ] } } });
      for (const o of owned) {
        const listed = openListings.filter((l) => l.data?.space === o.space && !lettingNow.has(l.id));
        if (!taken(o.space) && listed.length === 0) {
          // What we get now for homes like it: the same building, the same number of bedrooms.
          const like = (a: any) => {
            const lt = leaseTerms(a, tenantOf(a));
            return lt.structure === o.structure && owned.find((x) => x.space === lt.space)?.bedrooms === o.bedrooms;
          };
          const going = active.filter(like).map((a) => rentAt(a, t));
          const base = p.base_rent[o.type];
          const baseRent = typeof base === "number" ? base : (base?.find((b) => b.bedrooms === o.bedrooms)?.rent ?? 100_000);
          const ref = going.length ? Math.floor(going.reduce((x, y) => x + y, 0) / going.length) : baseRent;
          const noise = 9_750 + ctx.rng(`price-${o.space}`).below(501); // +/-2.5%
          steps.push(because(`Listing a vacant home at ${markupBps / 100}% over ${going.length ? `what similar homes in the building let for (${usd(ref)})` : `the base rent for its size (${usd(ref)})`}.`, listing(o, Math.floor((((ref * (10_000 + markupBps)) / 10_000) * noise) / 10_000))));
        }
        // Unlet for a month: cut the asking rent (BoE: 5% a month).
        for (const l of listed) {
          const since = listedAt.get(l.id) ?? l.at;
          if (t - since >= MONTH) steps.push(because(`Unlet for a month: cutting the asking rent ${p.cut_bps / 100}%.`, withdraw(l.id, "Relisting at a lower rent."), listing(o, Math.floor((l.data.rent * (10_000 - p.cut_bps)) / 10_000))));
        }
      }

      // A tenant has died. Seen in our own buildings (someone leaving a home because they died): report it, if nobody
      // has, and only where nobody else lives: the home empty, and nobody in or out of it for a day (those who share a
      // home report a death themselves, and say who the family is, which we can't; docs/behaviour/deaths.md). Once
      // registered: give notice on their lease, as it allows (the household may apply for a home again).
      // (Registered, as far as we have been told: the entry sent to us, or a certified copy of one made on someone else's report.)
      const registered = new Set([...book.all("death_registration"), ...book.all("death_certificate")].map((r) => r.data?.deceased as string));
      const tenants = new Map(active.map((a) => [tenantOf(a) as string, a]));
      for (const site of sites) for (const sp of site.structure?.spaces ?? []) for (const l of sp.left ?? []) {
        if (l.reason !== "died" || !tenants.has(l.occupant) || registered.has(l.occupant) || handled.has(`died-${l.occupant}`)) continue;
        if (!stoodEmpty(sp, t)) continue;
        handled.add(`died-${l.occupant}`);
        steps.push(because(`Our tenant ${l.occupant} has died in ${sp.space}: reporting it to the registry.`, say("death_notification", `${l.occupant}, our tenant at ${sp.space}, has died.`, { to: [p.city], data: { deceased: l.occupant } })));
      }
      for (const who of registered) {
        const a = tenants.get(who);
        if (!a || noticeGiven.has(a.id)) continue;
        noticeGiven.set(a.id, t);
        steps.push(because(`Our tenant ${who} has died (registered): giving notice on their lease.`, notice(a.id, "The tenant has died.")));
      }

      // Arrears: give notice after enough unpaid months (rent is due monthly in advance). Each tenant pays from the
      // account on their first application, or the one the world started them with.
      const payingAccount = new Map<string, string>();
      for (const r of book.all("rental_application")) if (r.speaks_for && !payingAccount.has(r.speaks_for)) payingAccount.set(r.speaks_for, r.data?.account);
      // Otherwise the account a lease of theirs says they pay from (an earlier one, for a lease we've renewed: the new
      // one doesn't name it).
      for (const a of leases as any[]) {
        const tenant = tenantOf(a);
        const from = a.terms.commitments?.find((c: any) => c.who === tenant)?.does?.outcome?.money?.from;
        if (tenant && from && !payingAccount.get(tenant)) payingAccount.set(tenant, from);
      }
      const law = p.possession ? possessionLaw(book) : undefined;
      // Tenancies already being ended when we first open our files (a town that opens in the middle of things:
      // docs/behaviour/generator.md): where each has got to is what its papers say, as it is for whoever takes an
      // office over. A notice to vacate of ours that stands: noticed, to its date. An application of ours for
      // possession: applied (any order on it is then read as any order is, at our next day for the rent book).
      if (law && p.possession && !filesRead) {
        filesRead = true;
        for (const a of active) {
          if (ending.has(a.id) || noticeGiven.has(a.id)) continue;
          const n = book.open("notice_to_vacate").filter((r) => r.speaks_for === me && r.data?.lease === a.id).sort((x, y) => y.at - x.at)[0];
          const applied = book.open("tribunal_application").some((r) => r.speaks_for === me && r.data?.kind === "possession" && r.data?.about === a.id);
          if (n) ending.set(a.id, { stage: applied ? "applied" : "noticed", by: Number(n.data?.by) || 0, seen: new Set() });
        }
      }
      for (const a of active) {
        if (noticeGiven.has(a.id) && !ending.has(a.id)) continue;
        const tenant = tenantOf(a);
        const rent = rentAt(a, t);
        // Each lease is judged on its own: what has fallen due under it against what has come in since its rent began
        // (its signing; for a lease that renews one of ours, the end of that one's term, which the old lease's rent
        // covers until). Everything the tenant ever paid us, set against this lease's dues alone, would let someone
        // on a renewed lease stop paying for as long as they had paid before.
        // (And from the lease's own rent day, where it names one: `firstDueOf`. Until 2026-10-11 every lease standing at
        // the start was counted from day 0, so every tenant who had not paid was two rents behind on the same day,
        // and a town's landlords wrote 126 letters in one instant.)
        const begins = Math.max(book.signedAt(a.id)!, 0, ...basesOf(a).map((b) => renewsAt.get(b) || 0));
        // (Rent owed when the year began, where our statement of the rent account says so: owed with the rest, and
        // owed since then. docs/behaviour/generator.md, "An ordinary day's caseload".)
        const carried = broughtForward(book, me, a.id);
        const since = Math.min(firstDueOf(a, begins), carried?.since ?? Infinity);
        const firstDue = firstDueOf(a, begins);
        const due = t < firstDue ? 0 : Math.floor((t - firstDue) / MONTH) + 1;
        let owed = carried?.owed ?? 0;
        for (let k = 0; k < due; k++) owed += rentAt(a, firstDue + k * MONTH);
        const paying = payingAccount.get(tenant);
        let paid = 0;
        for (const x of (paying && received.get(paying)) || []) if (x.t >= begins) paid += x.amount;
        // (How long we bear with arrears is our practice, and our character's: one that would keep its tenants waits
        // longer than one that would be rid of them. Someone behind with the rent is something we want settled.)
        const bears = org.patience(p.arrears_months_before_notice);
        if (org.lively && atBooks) {
          // (One want a lease: a tenant on a renewed lease has two for a while, and the one paid up must not be
          // taken for the one behind. Until 2026-10-11 the want was by tenant, and such a pair was born and met
          // turn about at every look.)
          const behind = org.wants.get("arrears", a.id);
          // (Behind by as much as our routine calls arrears, at two looks a week apart: a payment a few days late is not.)
          if (owed - paid >= p.arrears_months_before_notice * rent) { if (!lateSince.has(a.id)) lateSince.set(a.id, t); } else lateSince.delete(a.id);
          if (owed - paid >= p.arrears_months_before_notice * rent && t - lateSince.get(a.id)! >= 7 * DAY && !behind) org.wants.born({ about: "arrears", whom: tenant, against: { record: a.id, kind: "arrears", by: tenant }, seeks: ["money.to"], weight: Math.round(5_000 + 1_000 * (org.character.be_rid - org.character.keep)), since: t, from: "event" }, t);
          else if (behind && owed - paid < p.arrears_months_before_notice * rent) org.wants.met(behind, t, "paid");
          // Going after it (docs/behaviour/firm-wants.md), as a person goes after a want: first by asking (a letter
          // saying what is owed); then, when that has had its time, by taking it to a body that says it hears
          // arrears, if we can see one and would sooner have the money than be rid of the tenant; the notice our
          // routine gives comes when our patience runs out, as before.
          const held = org.wants.get("arrears", a.id);
          if (held && held.tried === 0 && !ending.has(a.id) && t - (askedFor.get(a.id) ?? -Infinity) >= 30 * DAY) {
            askedFor.set(a.id, t);
            org.wants.tried(held, "ask", t, a.id);
            steps.push(because(`${tenant} is ${usd(owed - paid)} behind with the rent: writing to ask for it.`,
              say(PAPER.request, `Request: the rent for your home is ${usd(owed - paid)} in arrears. Please pay it.`, { to: [tenant], visible: [me, tenant], basis: a.id, data: { matter: "arrears", against: tenant, about: a.id, amount: owed - paid, account: acc.account } })));
          } else if (held && held.way === "ask" && t - (held.triedAt ?? t) >= 30 * DAY && org.character.keep >= org.character.be_rid) {
            const venue = book.hearings().find((h) => h.offer?.hears?.some((x) => x.about === "arrears") && (h.speaks_for ?? h.author) !== me);
            const entry = venue?.offer?.hears?.find((x) => x.about === "arrears");
            const fee = (venue?.offer?.terms?.commitments ?? []).filter((c) => c.who === "taker").map((c) => (c.does as any)?.outcome?.money).find((m) => m?.to);
            if (venue && entry && (!fee || acc.balance >= cents(fee.amount))) {
              const v = venue.speaks_for ?? venue.author;
              org.wants.tried(held, `desk:${v}`, t, venue.id);
              steps.push(because(`${tenant} is still ${usd(owed - paid)} behind a month after we asked: applying to ${v} for an order to pay.`,
                say(entry.form ?? PAPER.application, `Application: ${tenant} owes us ${usd(owed - paid)} in rent under ${a.id}.`, { to: [v], visible: [me, v, tenant], basis: venue.id, data: { kind: "arrears", matter: "arrears", against: tenant, about: a.id, amount: owed - paid, account: acc.account, evidence: { id: a.id, record: "agreement" } } }),
                ...(fee ? [pay(String(fee.to), cents(fee.amount), { from: acc.account, for: "Application fee." })] : [])));
            }
          }
        }
        // ---- possession, where the world has a law on it (docs/behaviour/justice.md, "Possession") ----
        // A tenant behind with the rent is given a notice to vacate, which ends nothing by itself: paid up before
        // its date, it lapses; gone by its date, that is the end of it; still there, we apply to the tribunal for
        // possession. The tribunal may give the tenant a plan to pay (we come back if it is not kept) or order
        // possession by a date; a tenant still there after it is removed by the police, on a warrant we buy from
        // the tribunal's registrar. We never put anyone out ourselves.
        const e = ending.get(a.id);
        // (The notice to vacate an application relies on: which paper, the day it was given and the day it gave. The
        // tribunal cannot see what passed between landlord and tenant, so the application says it.)
        const noticeRelied = (lease: string) => {
          const n = book.all("notice_to_vacate").filter((r) => r.speaks_for === me && r.data?.lease === lease).sort((x, y) => y.at - x.at)[0];
          return n ? { notice: n.id, notice_given: Number(n.data?.given ?? n.at), notice_by: Number(n.data?.by) } : {};
        };
        if (law && p.possession && e) {
          // (A warrant asked for, and the tenant's notice that they have gone has come: the registrar is told at once,
          // by our request withdrawn, so that nobody is sent to put out someone who has left. In the fifth living
          // pilot 11 of 23 warrants were carried out at homes the household had left inside the notice of the day.)
          if (e.stage === "warrant" && !e.seen.has("warrant-withdrawn") && (book.notices.get(a.id) ?? []).some((n) => n.as === tenant) && !book.all("warrant_executed").some((w) => w.data?.lease === a.id)) {
            e.seen.add("warrant-withdrawn");
            for (const w of book.open("warrant_request").filter((r) => r.speaks_for === me && r.data?.order === e.notice))
              steps.push(because(`${tenant} has left ${leaseTerms(a, tenant).space ?? "the home"} since we asked for a warrant: telling the tribunal's registrar there is nobody to remove.`, withdraw(w.id, "Withdrawn: the tenant has left the home.")));
          }
          // (Taken forward on our own day for the rent book, as arrears are taken up: never at whatever look comes first.)
          if (!atBooks) continue;
          const behindNow = owed - paid;
          const gone = (book.notices.get(a.id) ?? []).some((n) => n.as === tenant);
          const orders = book.all("tribunal_order").filter((o) => o.data?.kind === "possession" && o.data?.applicant === me && o.data?.about === a.id && !e.seen.has(o.id));
          const executed = book.all("warrant_executed").some((w) => w.data?.lease === a.id);
          if (gone || executed) {
            // (They have gone, or been put out: the tenancy is over. On the record it ends by its own terms.)
            if (!noticeGiven.has(a.id)) { noticeGiven.set(a.id, t); steps.push(because(`${tenant} has left ${leaseTerms(a, tenant).space ?? "the home"}: ending the tenancy on the record.`, notice(a.id, "Notice: the tenancy is ended for arrears; the tenant has left."))); }
            // (An application for possession of a home already given up asks the tribunal for nothing it can give:
            // withdrawn. Until 2026-10-12 it stood, and the tribunal gave someone who had gone six weeks to answer.)
            const decidedApps = new Set(book.all("tribunal_order").filter((o) => o.data?.applicant === me).map((o) => String(o.data?.application ?? "")));
            for (const app of book.open("tribunal_application").filter((r) => r.speaks_for === me && r.data?.kind === "possession" && r.data?.about === a.id && !decidedApps.has(r.id)))
              steps.push(because(`${tenant} has left ${leaseTerms(a, tenant).space ?? "the home"}: withdrawing our application for possession (${app.id}); there is nothing left for the tribunal to order.`, withdraw(app.id, "Withdrawn: the tenant has left the home.")));
            ending.delete(a.id);
          } else if (e.stage === "noticed" && behindNow < rent) {
            ending.delete(a.id);
            const n = book.open("notice_to_vacate").find((r) => r.speaks_for === me && r.data?.lease === a.id);
            org.remember(t, "arrears_paid", tenant, 1_000);
            steps.push(because(`${tenant} has paid the rent that was owed: our notice to vacate lapses.`, ...(n ? [withdraw(n.id, "Lapsed: the arrears are paid.")] : [])));
          } else if (e.stage === "noticed" && t >= e.by) {
            const fee = p.possession.fee ?? 0;
            if (acc.balance >= fee) {
              e.stage = "applied";
              const home = leaseTerms(a, tenant);
              steps.push(because(`Our notice to vacate has run out and ${tenant} is still in ${home.space ?? "the home"}, ${usd(behindNow)} behind: applying to the tribunal for possession.`,
                say("tribunal_application", `Application for possession: ${tenant} is ${usd(behindNow)} behind with the rent under ${a.id} and has not left on our notice to vacate.`, { to: [p.possession.tribunal], visible: [me, p.possession.tribunal, tenant], basis: a.id,
                  data: { kind: "possession", matter: "possession", against: tenant, about: a.id, amount: behindNow, rent, account: acc.account, ...(home.space ? { space: home.space, structure: home.structure } : {}), household: householdNamed(a, tenant), ...noticeRelied(a.id), evidence: { id: a.id, record: "agreement" } } }),
                ...(fee > 0 && p.possession.fee_account ? [pay(p.possession.fee_account, fee, { from: acc.account, for: "Application fee." })] : [])));
            }
          } else if (e.stage === "applied" && !orders.length && behindNow <= 0) {
            // (Paid up while the application stands: there is nothing left to ask the tribunal for. Withdrawn.)
            for (const app of book.open("tribunal_application").filter((r) => r.speaks_for === me && r.data?.kind === "possession" && r.data?.about === a.id))
              steps.push(because(`${tenant} has paid the rent that was owed since we applied: withdrawing our application for possession (${app.id}).`, withdraw(app.id, "Withdrawn: the rent owed has been paid.")));
            org.remember(t, "arrears_paid", tenant, 1_000);
            ending.delete(a.id);
          } else if (e.stage === "applied" && !orders.length && book.all("tribunal_response").some((r) => r.speaks_for === tenant && !e.seen.has(r.id) && !r.data?.left && book.open("tribunal_application").some((x) => x.speaks_for === me && x.id === String(r.data?.application ?? "")))) {
            // The tenant has answered the tribunal: we reply with what our rent book shows owed today, and whether we
            // would take the plan they offer (one that clears what is owed within the law's longest), where their sum
            // differs from ours or they offer something. The member decides on what both have said.
            for (const r of book.all("tribunal_response").filter((x) => x.speaks_for === tenant && !e.seen.has(x.id))) {
              e.seen.add(r.id);
              const app = String(r.data?.application ?? ""), offer = cents(r.data?.offer ?? 0), theirs = r.data?.owes !== undefined ? cents(r.data.owes) : undefined;
              if (!book.open("tribunal_application").some((x) => x.speaks_for === me && x.id === app) || (offer <= 0 && (theirs === undefined || theirs === behindNow))) continue;
              const takes = offer > 0 ? law.plan_months > 0 && behindNow <= offer * law.plan_months : undefined;
              steps.push(because(`${tenant} has answered the tribunal on our application ${app}: replying with what our rent book shows.`,
                say("tribunal_reply", `Reply on application ${app}: our rent book shows ${usd(behindNow)} owed by ${tenant} today.${takes === undefined ? "" : takes ? ` We would take the plan offered (${usd(offer)} a month).` : ` We would not take the plan offered (${usd(offer)} a month).`}`,
                  { to: [p.possession.tribunal, tenant], visible: [me, p.possession.tribunal, tenant], basis: app, data: { application: app, against: tenant, owed: behindNow, ...(takes !== undefined ? { takes_plan: takes } : {}) } })));
            }
          } else if ((e.stage === "applied" || e.stage === "plan") && orders.length) {
            const o = orders.sort((x, y) => y.at - x.at)[0]!;
            for (const x of orders) e.seen.add(x.id);
            if (o.data?.finding === "plan") {
              e.stage = "plan";
              e.plan = { at: t, owed: behindNow, instalment: cents(o.data.instalment ?? 0) };
            } else if (o.data?.finding === "possession") {
              e.stage = "ordered";
              e.by = Number(o.data.due) || t;
              e.notice = o.id;
              // (The tenancy is ended on the record now: by the lease's own terms, which is some weeks on.)
              if (!noticeGiven.has(a.id)) { noticeGiven.set(a.id, t); steps.push(because(`The tribunal orders possession of ${leaseTerms(a, tenant).space ?? "the home"} by ${dateWords(e.by)}: ending the tenancy on the record.`, notice(a.id, "Notice: possession ordered by the tribunal for arrears."))); }
            } else ending.delete(a.id); // (dismissed: the arrears were paid, or it was not made out; we begin again if they fall behind)
          } else if (e.stage === "plan" && e.plan) {
            // A plan kept: the arrears come down by the instalment each month. Paid off: done. Not kept a month
            // and a week on: back to the tribunal, saying so.
            const months = Math.floor((t - e.plan.at) / MONTH);
            if (behindNow < rent) ending.delete(a.id);
            else if (t - e.plan.at >= MONTH + 7 * DAY && behindNow > e.plan.owed - months * e.plan.instalment + rent / 2 && acc.balance >= (p.possession.fee ?? 0)) {
              e.stage = "applied";
              const home = leaseTerms(a, tenant), fee = p.possession.fee ?? 0;
              steps.push(because(`${tenant} has not kept the plan the tribunal set (${usd(behindNow)} behind, where the plan would have it under ${usd(Math.max(0, e.plan.owed - months * e.plan.instalment))}): applying again for possession.`,
                say("tribunal_application", `Application for possession: ${tenant} has not kept the payment plan ordered, and is ${usd(behindNow)} behind with the rent under ${a.id}.`, { to: [p.possession.tribunal], visible: [me, p.possession.tribunal, tenant], basis: a.id,
                  data: { kind: "possession", matter: "possession", against: tenant, about: a.id, amount: behindNow, rent, account: acc.account, breach: true, ...(home.space ? { space: home.space, structure: home.structure } : {}), household: householdNamed(a, tenant), ...noticeRelied(a.id), evidence: { id: a.id, record: "agreement" } } }),
                ...(fee > 0 && p.possession.fee_account ? [pay(p.possession.fee_account, fee, { from: acc.account, for: "Application fee." })] : [])));
            }
          } else if (e.stage === "ordered" && t >= e.by + DAY && acc.balance >= (p.possession.warrant_fee ?? 0)) {
            e.stage = "warrant";
            const fee = p.possession.warrant_fee ?? 0;
            steps.push(because(`The date the tribunal set for possession has passed and ${tenant} has not left: asking the tribunal's registrar for a warrant.`,
              say("warrant_request", `Request for a warrant of possession under order ${e.notice}: ${tenant} has not left.`, { to: [p.possession.tribunal], visible: [me, p.possession.tribunal], basis: e.notice!, data: { order: e.notice } }),
              ...(fee > 0 && p.possession.fee_account ? [pay(p.possession.fee_account, fee, { from: acc.account, for: "Warrant fee." })] : [])));
          } else if (e.stage === "warrant") {
            // (A warrant nobody came to carry out in its time has lapsed: we ask for another.)
            const lapsed = book.all("warrant_lapsed").filter((w) => w.data?.lease === a.id && !e.seen.has(w.id));
            if (lapsed.length) { for (const w of lapsed) e.seen.add(w.id); e.stage = "ordered"; }
          }
          continue;
        }
        if (atBooks && law && p.possession && (owed - paid) >= bears * rent && t - since >= bears * MONTH && owed - paid >= rent && !noticeGiven.has(a.id)) {
          // (A date by the day: the first day to begin once the notice's days have run in full, counted from when it is on the record.)
          const by = (Math.floor(t / DAY) + 1 + law.notice_days) * DAY;
          ending.set(a.id, { stage: "noticed", by, seen: new Set(book.all("tribunal_order").filter((o) => o.data?.about === a.id).map((o) => o.id)) });
          const behind = org.wants.get("arrears", a.id);
          if (behind) org.wants.tried(behind, "notice", t, a.id);
          org.remember(t, "gave_notice", tenant, 3_000);
          steps.push(because(`Rent is ${bears} or more months in arrears (${usd(owed - paid)}): giving ${tenant} notice to vacate by ${dateWords(by)}, as ${law.id} allows after ${law.arrears_days} days' arrears. Paid before then, it lapses.`,
            say("notice_to_vacate", `Notice to vacate: the rent under ${a.id} is ${usd(owed - paid)} in arrears. You are to leave ${leaseTerms(a, tenant).space ?? "the home"} by ${dateWords(by)}. If the arrears are paid before then, this notice lapses. If you are still there after it, we may apply to the tribunal for possession.`,
              { to: [tenant], visible: [me, tenant], basis: a.id, data: { lease: a.id, reason: "arrears", arrears: owed - paid, by, law: law.id } })));
          continue;
        }
        if (noticeGiven.has(a.id)) continue;
        if (atBooks && (owed - paid) >= bears * rent && t - since >= bears * MONTH) {
          noticeGiven.set(a.id, t);
          const behind = org.wants.get("arrears", a.id);
          if (behind) org.wants.tried(behind, "notice", t, a.id);
          org.remember(t, "gave_notice", tenant, 3_000);
          steps.push(because(`Rent is ${bears} or more months in arrears: giving notice.`, notice(a.id, "Notice: rent is in arrears.")));
        }
      }

      // Rent reviews: once a review period (the world's tenancy law), a tenancy's rent goes up to what we'd ask for the
      // home now, if that's more, with the notice the law requires. (It never goes down: an unlet home's asking rent does.)
      // Our practice: how often we review a tenancy's rent, and the notice we give. The law bounds it (below).
      const reviewMonths = p.rent_review_months;
      const noticeDays = p.rent_increase_notice_days;
      if (reviewMonths) for (const a of active) {
        // (A lease we've offered to renew isn't reviewed: the new one carries its rent, and its own reviews.)
        if (noticeGiven.has(a.id) || renewed.has(a.id)) continue;
        const since = lastReview.get(a.id) ?? book.signedAt(a.id)!;
        if (t - since < reviewMonths * MONTH) continue;
        const tenant = tenantOf(a);
        const unit = owned.find((o) => o.space === leaseTerms(a, tenant).space);
        if (!unit) continue;
        const now = rentAt(a, t);
        const others = active.filter((x) => x.id !== a.id && leaseTerms(x, tenantOf(x)).structure === unit.structure && owned.find((o) => o.space === leaseTerms(x, tenantOf(x)).space)?.bedrooms === unit.bedrooms).map((x) => rentAt(x, t));
        const base = p.base_rent[unit.type];
        const baseRent = typeof base === "number" ? base : (base?.find((b) => b.bedrooms === unit.bedrooms)?.rent ?? now);
        const ref = others.length ? Math.floor(others.reduce((x, y) => x + y, 0) / others.length) : Math.max(now, baseRent);
        const market = Math.floor((ref * (10_000 + markupBps)) / 10_000);
        if (market <= now) {
          lastReview.set(a.id, t);
          continue;
        }
        // The notice states when the rent last changed, as a notice of rent increase does. The law as we read it: the
        // soonest the increase can start without breaching a law in force, a week at a time. If none within half a year,
        // we wait and look again next month; unless we don't comply, and raise it anyway.
        const lastFrom = (rentChanges.get(a.id) ?? []).at(-1)?.from ?? book.signedAt(a.id)!;
        const notice = (from: number) => ({ lease: a.id, rent: market, from, was: now, last_from: lastFrom });
        const act = (from: number) => ({ block: "publish", kind: "rent_increase", data: notice(from) });
        // An increase starts with a day: the first to begin once the notice has run. (Until 2026-10-05 it started to the
        // second, the notice counted from when we decided; the notice is on the record a moment later, so one given on
        // exactly the law's period was short of it by that moment, and invalid before the tribunal.)
        const startsOn = (at: number, lead: number) => (Math.floor((at + lead) / DAY) + 1) * DAY;
        let lead = noticeDays * DAY;
        let broken = breaches(book, act(startsOn(t, lead)), me, t);
        while (broken.length && lead < (noticeDays + 182) * DAY) broken = breaches(book, act(startsOn(t, (lead += 7 * DAY))), me, t);
        const complies = obeys(`rent-law-${a.id}-${t}`);
        if (broken.length && complies) continue;
        if (broken.length) lead = noticeDays * DAY; // (not complying: our own practice, whatever the law says)
        lastReview.set(a.id, t);
        const why = broken.length ? `; this breaches ${broken.map((l) => l.id).join(", ")}, and we raise it anyway` : lead > noticeDays * DAY ? `, from as soon as the law allows` : "";
        // The notice counts from when it's given: if that's later than now, the date moves with it.
        const change = { from: startsOn(t, lead), rent: market };
        rentChanges.set(a.id, [...(rentChanges.get(a.id) ?? []), change]);
        const give = (at: number): Step => {
          change.from = startsOn(at, lead);
          return Object.assign(because(`A rent review (every ${reviewMonths} months): what we'd ask for ${unit.space} now is ${usd(market)} a month (${markupBps / 100}% over ${others.length ? "what similar homes in the building let for" : "the base rent"}), above the ${usd(now)} it lets for: raising it, with ${Math.round(lead / DAY)} days' notice${why}.`,
            say("rent_increase", `Notice of rent increase for ${unit.space}: ${usd(market)} a month from ${Math.floor(change.from / DAY)} (day), up from ${usd(now)}; it last changed on day ${Math.floor(lastFrom / DAY)}.`, { to: [tenant], visible: [me, tenant], basis: a.id, data: notice(change.from) })), { redo: give });
        };
        steps.push(give(t));
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
          steps.push(because(reported === income ? "Monthly: reporting rent received to the town, and paying tax at the rate the law sets." : "Monthly: reporting rent received to the town (only half of it), and paying tax on that.",
            say("tax_report", `Rent received this month: ${moneyNow(reported)}.`, { to: [p.city], data: { period_end: t, rent_received: reported, account: acc.account } }),
            ...(tax > 0 ? [pay(p.city_account, tax, { from: acc.account, for: "Tax on rent received." })] : []),
          ));
        }
        const spend = Math.min(acc.balance - tax, Math.floor((income * p.spend_share_bps) / 10_000));
        const upkeep = Math.min(acc.balance - tax - spend, Math.floor((income * p.upkeep_share_bps) / 10_000));
        income = 0;
        // The owners' draw: to the shareholders on our register, if we keep one (they spend it as they will); a world
        // without one keeps the money-only stand-in, spent at a local shop.
        const draw = distribute(book, me, acc, spend, `Monthly: the owners draw ${p.spend_share_bps / 100}% of rent received, paid to our shareholders by their shares`);
        steps.push(...draw.steps);
        const s: Step = because(`Monthly: ${p.upkeep_share_bps / 100}% of rent received goes on upkeep${draw.steps.length || !shops.length ? "" : `, and the owners spend ${p.spend_share_bps / 100}% locally`}.`);
        if (!draw.steps.length && spend > 0 && shops.length) s.push(pay(ctx.rng(`spend`).pick(shops), spend, { from: acc.account, for: "Owners' spending." }));
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
      // What the builder charges for it, from its published prices.
      const price = (p.builder && publishedPrice(book, p.builder, p.develop_type)) || Infinity;
      // What we can spend: what is in the account, less what we already owe out of it (buildings asked for and not yet
      // paid, payments on their way, invoices in hand). Until 2026-10-09 it was the balance alone: a landlord asked for
      // a second house on the money that was to pay for the first, and the second was never paid for.
      // (A payment told to the bank and not seen to leave in a week is no longer counted as on its way.)
      for (const [inv, x] of paying) if (t - x.at >= 7 * DAY) paying.delete(inv);
      const invoices = book.open("invoice").filter((inv) => !answered.has(inv.id) && (inv.addressed_to ?? []).includes(me) && inv.data?.outcome?.money);
      const billed = (inv: StatementRecord) => cents(inv.data!.outcome.money.amount);
      // (An invoice for a building we asked for is that building's price, counted once.)
      const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
      const free = () => acc.balance - sum([...owing.values()]) - sum([...paying.values()].map((x) => x.amount)) - sum(invoices.filter((inv) => !owing.has(String(inv.data?.agreement))).map(billed));
      if (p.develop && !dev && t >= devCooldownUntil && occupiedEnough && emptyLots.length && free() >= price + price / 2 && p.city && p.builder) {
        dev = { lot: emptyLots[0]!, stage: "applying" };
        // The planning office's published form (it's in the world's genesis records).
        steps.push(because(`Our homes have been ${Math.round(100 - (vacantSum * 100) / Math.max(1, unitSum))}% let over ${p.develop_window_days} days: applying to build on an empty lot of ours.`, ["app", C.call("form", { to: p.city, form: "permit_application", lot: dev.lot, structure_type: p.develop_type })]));
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
      // The builder's answer to our offer (it declines in writing, saying why: docs/behaviour/building.md), read with
      // the week's post: at our first plan a week or more after we offered, never in the moment it comes (a wake is
      // not always a week apart: news wakes us too). Until 2026-10-08 nothing read it: an offer declined left us
      // waiting for a building for good, and we never built again. Declined for the price (the list changed as we
      // offered): the offer is dead, the permit stands, and we decide again below at what the builder charges now, as
      // with any permit in hand. Declined for the site (the builder says it can't build there): this plan is over, and
      // we wait as long as after a refusal we accept before thinking of building again.
      if (dev?.stage === "contracted" && dev.contract && t - (dev.offeredAt ?? t) >= 7 * DAY) {
        const no = book.all("offer_declined").find((r) => r.data?.agreement === dev!.contract && (r.addressed_to ?? []).includes(me));
        if (no) owing.delete(dev.contract); // (an offer declined is nothing owed)
        if (no && no.data?.price !== undefined && dev.permit) {
          dev.told = { price: cents(no.data.price), at: no.at };
          dev.stage = dev.permit;
          dev.contract = undefined;
        } else if (no) {
          dev = null;
          devCooldownUntil = t + 180 * DAY;
        }
      }
      // (What it charges now: its standing list, or its letter to us where we hold no list as late as the letter.)
      const told = dev?.told;
      const priceNow = told && !book.open("price_list").some((r) => (r.speaks_for === p.builder || r.author === p.builder) && r.at >= told.at) ? told.price : price;
      // (A decline just read has given back what that offer held.)
      if (dev && (dev.stage === "granted" || dev.stage === "refused") && free() >= priceNow && t >= (dev.notBefore ?? 0)) {
        const d = dev;
        const refused = d.stage === "refused";
        const again = d.told !== undefined;
        d.permit = refused ? "refused" : "granted";
        d.stage = "contracted";
        d.offeredAt = t;
        const s: Step = because(again ? `The builder declined our offer: its price is now ${usd(priceNow)}, which we can pay. Offering again at that.` : refused ? "The permit was refused: building anyway." : "The permit was granted: commissioning the builder.",
          ["build", C.call("structure", { type: p.develop_type, on: d.lot, by: p.builder, price: C.amountText(priceNow), from: acc.account })]);
        // The agreement we offered, to know the builder's answer by. An offer that wasn't made (refused in the moment)
        // is no offer: the permit stands as it did, and we decide again in a week.
        s.then = (out) => {
          if (out.status === "applied" && out.created?.build) {
            d.contract = out.created.build;
            owing.set(d.contract, priceNow);
          } else if (out.status !== "applied" && dev === d && d.stage === "contracted") {
            d.stage = d.permit!;
            d.notBefore = t + 7 * DAY;
          }
        };
        steps.push(s);
      }
      if (dev?.stage === "contracted" && sites.some((s) => cellsOf(book, dev!.lot).includes(s.cell) && s.structure)) dev = null;

      // Invoices addressed to us (from the builder, the utilities): pay each when we can, oldest first, out of what is
      // in the account and not already on its way out. One we can't pay yet stays open, and is paid when we can. (Until
      // 2026-10-09 an invoice was marked answered before we looked at the balance: one that came when we were short
      // was never paid, and the builder built houses nobody paid for.)
      let inHand = acc.balance - sum([...paying.values()].map((x) => x.amount));
      for (const inv of book.open("invoice")) {
        if (answered.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
        const money = inv.data?.outcome?.money;
        if (!money) { answered.add(inv.id); continue; } // (nothing we can pay by)
        const amount = cents(money.amount);
        if (inHand < amount) continue; // not yet
        answered.add(inv.id);
        inHand -= amount;
        paying.set(inv.id, { amount, at: t });
        if (inv.data?.agreement) owing.delete(String(inv.data.agreement));
        steps.push(because("Paying an invoice addressed to us.", pay(money.to, amount, { from: acc.account, for: "Paying an invoice.", settles: inv.id })));
      }

      // Fines recorded against us, and demolition orders addressed to us.
      for (const r of [...book.ofType("claim"), ...book.all("demolition_order")]) {
        if (answered.has(r.id)) continue;
        // (Rates are paid when there's the money for them; a fine or rates we don't mean to pay are let be.)
        if (r.record === "claim" && r.position === "right" && r.counterparty === me && ["fine", "tax_penalty", "rates", "rates_interest"].includes(r.about?.kind)) {
          const to = r.about?.account ?? p.city_account;
          const amount = cents(r.about.amount);
          if (!obeys(`fine-${r.id}`) || !to) answered.add(r.id);
          else if (acc.balance >= amount) {
            answered.add(r.id);
            const what = String(r.about.kind).startsWith("rates") ? "rates" : "a fine";
            steps.push(because(`Paying ${what} recorded against us.`, pay(to, amount, { from: acc.account, for: `Paying ${what}.`, settles: r.id })));
          }
        }
        if (r.record === "statement" && r.kind === "demolition_order" && (r.addressed_to ?? []).includes(me)) {
          // Obeying: the builder does demolitions (it has the crew), at its published price for that kind of building.
          const type = sites.find((c) => c.structure?.structure === r.data?.structure)?.structure?.type;
          const price = type && p.builder ? publishedPrice(book, p.builder, type, "demolition") : undefined;
          if (price === undefined || acc.balance < price) continue; // not yet: we don't know the price, or can't pay it
          answered.add(r.id);
          if (obeys(`order-${r.id}`)) steps.push(because("Obeying a demolition order: commissioning the builder to demolish it.", C.call("structure", { remove: r.data?.structure, by: p.builder, price: C.amountText(price), from: acc.account, basis: r.id })));
        }
      }
      // Asked by a tenant to vary what stands between us (docs/behaviour/firm-wants.md): to hold a rent we have given
      // notice of raising, or to let them stay on under a notice of ours. We answer in writing, yes or no, by our
      // character (keeping a tenant and being thought well of, against growing or being rid of them) and by what the
      // tenant is worth to us (one who has paid as agreed, more); and, saying yes, we do it: the notice of increase is
      // withdrawn, or a new lease is offered from when the old one ends. One with no wants of its own answers nothing.
      if (org.lively) for (const r of book.open("variation_request")) {
        if (answered.has(r.id) || !(r.addressed_to ?? []).includes(me)) continue;
        answered.add(r.id);
        const a = active.find((x) => x.id === r.data?.agreement);
        const tenant = a ? tenantOf(a) : undefined;
        if (!a || !tenant || r.speaks_for !== tenant) continue;
        const about = String(r.data?.about ?? "");
        const paper = book.records.get(about) as any;
        const paidUp = !org.wants.get("arrears", tenant);
        const reply = (granted: boolean, words: string) => say("variation_answer", words, { to: [tenant], visible: [me, tenant], basis: r.id, data: { about, granted } });
        if (paper?.record === "statement" && paper.kind === "rent_increase" && paper.speaks_for === me && !book.withdrawn.has(paper.id)) {
          const g = org.grants("hold", ctx.rng(`vary-${r.id}`), paidUp ? 0.5 : -1, t);
          org.remember(t, g.granted ? "held_rent" : "refused_hold", tenant, 2_000);
          if (g.granted) {
            const changes = rentChanges.get(a.id) ?? [];
            rentChanges.set(a.id, changes.filter((c) => !(c.from === Number(paper.data?.from) && c.rent === cents(paper.data?.rent))));
            steps.push(because(`${tenant} asks us to hold the rent: we would sooner keep them (for us, ${g.chance / 100}% of such requests): withdrawing the notice; the rent stays as it was.`,
              withdraw(paper.id, "Withdrawn at the tenant's request."), reply(true, "Granted: the notice of rent increase is withdrawn; your rent stays as it was.")));
          } else steps.push(because(`${tenant} asks us to hold the rent: no (for us, ${g.chance / 100}% of such requests are granted).`, reply(false, "Not granted: the rent increase stands.")));
        } else if (r.data?.would?.does?.outcome?.occupancy && noticeGiven.has(a.id) && !renewed.has(a.id)) {
          const ends = book.endsAt(a.id);
          const lt = leaseTerms(a, tenant);
          const g = org.grants("stay", ctx.rng(`vary-${r.id}`), paidUp ? 0.5 : -1, t);
          org.remember(t, g.granted ? "let_stay" : "refused_stay", tenant, 2_000);
          if (g.granted && ends !== undefined && lt.space) {
            renewed.add(a.id);
            renewsAt.set(a.id, ends);
            const rent = rentAt(a, ends);
            const months = between(p.min_term_months, p.max_term_months, ctx.rng(`renew-${a.id}`).below(1_000_000) / 1_000_000);
            steps.push(because(`${tenant} asks to stay on: we would sooner keep them: offering a new lease at ${usd(rent)} a month from when the old one ends.`,
              ["lease", offer(tenant, { template: "lease", term: ends - t + months * MONTH, ...(p.after_term ? { then: p.after_term } : {}), ourNotice: p.landlord_notice_days * DAY, theirNotice: p.tenant_notice_days * DAY,
                we: C.call("occupancy", { who: tenant, in: lt.space }), they: pay(acc.account, rent, { every: MONTH, for: "rent" }),
                text: `${tenant} rents home ${lt.space} from ${me} for ${moneyNow(rent)} a month, renewing their lease (${a.id}) for ${months} months from day ${Math.floor(ends / DAY)}.`, basis: a.id })],
              reply(true, "Granted: a new lease is offered you from when yours ends.")));
          } else steps.push(because(`${tenant} asks to stay on: no.`, reply(false, "Not granted: the notice stands.")));
        } else steps.push(because(`${tenant} asks something of us that is not ours to vary as asked.`, reply(false, "Not granted.")));
      }
      // A tribunal's order that a notice of rent increase of ours is invalid (docs/behaviour/justice.md): obeying it (as
      // often as we obey the law), we withdraw the notice and the rent stays as it was.
      for (const o of book.open("tribunal_order")) {
        if (answered.has(o.id) || !(o.addressed_to ?? []).includes(me) || o.data?.against !== me || o.data?.kind !== "rent_increase" || o.data?.finding !== "invalid") continue;
        answered.add(o.id);
        const n = book.records.get(String(o.data.notice)) as any;
        if (!n || !obeys(`tribunal-${o.id}`)) continue;
        const changes = rentChanges.get(n.data?.lease) ?? [];
        rentChanges.set(n.data?.lease, changes.filter((c) => !(c.from === Number(n.data?.from) && c.rent === cents(n.data?.rent))));
        steps.push(because(`The tribunal has found our notice of rent increase ${n.id} invalid: withdrawing it; the rent stays as it was.`, withdraw(n.id, `Withdrawn: found invalid by the tribunal (${o.id}).`)));
      }
      // Asked to put something right (a home in disrepair), told of a complaint, or ordered to (docs/behaviour/frictions.md).
      steps.push(...answering.steps(book, t, acc.account, acc.balance));
      return steps;
    // (It sleeps until its usual week is up or its next day for the rent book, whichever is sooner.)
    }, (obs) => Math.min(obs.t + WEEK, obs.t - sinceBooks(obs.t) + WEEK), plansToRead), { beliefs: (): Belief[] => leasesHeld() })), () => ({ homes: owned.length }));
  },
};

/**
 * The staffing direction an office that hires takes (docs/behaviour/directions.md): whether it recruits, and the most
 * posts it fills. `office` and `staff` are the form's words for whose it is and whom it hires.
 */
export function staffingForm(form: string, office: string, staff: string): Taken {
  return {
    form, title: `Staffing direction to ${office}`,
    fields: {
      recruit: { type: "choice", options: ["yes", "no"], required: true, description: `Whether ${office} recruits: yes, it advertises and fills the posts it is short of; no, it advertises none and takes nobody on.` },
      posts: { type: "count", description: `The most ${staff} it is to have, where that is fewer than its budget pays for. Left out: as many as the budget pays for.` },
    },
    follows: `While a direction with recruit no stands, ${office} advertises no post, takes down the advertisements it has out and offers nobody employment. With recruit yes it recruits up to what its budget pays for, or up to posts where that is fewer. Nobody is stood down by it and nobody's pay changes.`,
  };
}

/** A staffing direction as it bears on hiring (none standing: recruit as the office would). */
export function staffingUnder(d: StatementRecord | undefined): { recruit: boolean; posts?: number } {
  const posts = d?.data?.posts;
  return { recruit: d?.data?.recruit !== "no", ...(Number.isSafeInteger(posts) && posts > 0 ? { posts: posts as number } : {}) };
}

/**
 * A firm's staff (shared by firm.employer and firm.producer): hiring through job postings and offers, wages by
 * standing order through the firm's bank, notice, and a worker's death. What headcount and wage to aim for is the
 * module's own rule; this is how any employer carries it out.
 */
type Withheld = { total: number; parts: { charge: Charge; amount: number }[] };
const NOTHING_WITHHELD: Withheld = { total: 0, parts: [] };

/** Work by the day (docs/behaviour/firms.md, "Work by the day"): an employment agreement whose pay is a day's. The hand
 * is paid for each day worked, by a payment that day and no standing order, and either side ends it without notice. */
export const byTheDay = (a: any): boolean => a?.record === "agreement" && a.terms?.template === "employment" && a.terms.commitments?.some((c: any) => c.who === a.terms.parties[0] && c.every === DAY && c.does?.outcome?.money);
/** The notice such an agreement gives: none (the least a term can say). */
export const NO_NOTICE = 1;

/**
 * The law on possession of a let home for arrears, as its lawmaker published it (docs/behaviour/justice.md,
 * "Possession"): how long rent must be owed before a notice to vacate may be given, the notice it must give, how
 * long after its order the tribunal's date for possession falls, the longest plan to pay it will set, how long
 * whoever enforces a warrant has to carry it out, and the notice of the day they must give the tenant. A record a landlord, a tenant and the tribunal read; no place's
 * figures here, and a world with no such law has none of it.
 */
export interface PossessionLaw { id: string; arrears_days: number; notice_days: number; possession_days: number; plan_months: number; warrant_days: number; eviction_notice_days: number; enforced_by?: string }
export function possessionLaw(book: Book): PossessionLaw | undefined {
  const l = book.open("law").filter((r) => r.data?.tenancy === "possession").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
  if (!l) return undefined;
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : d);
  return { id: l.id, arrears_days: n(l.data?.arrears_days, 0), notice_days: n(l.data?.notice_days, 0), possession_days: n(l.data?.possession_days, 0), plan_months: n(l.data?.plan_months, 0), warrant_days: n(l.data?.warrant_days, 0), eviction_notice_days: n(l.data?.eviction_notice_days, 0),
    ...(typeof l.data?.enforced_by === "string" ? { enforced_by: l.data.enforced_by } : {}) };
}
/** Whom a lease names as living in the home with the tenant (its words say: "... to live there with their household: a, b."; none named: the tenant alone). */
export function householdNamed(a: any, tenant: string): string[] {
  const named = /with their household: ([^.]+)\./.exec(String(a?.terms?.text ?? ""))?.[1]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  return [...new Set([tenant, ...named])];
}

/**
 * The law on ending a job for redundancy, as its lawmaker published it (docs/behaviour/firms.md, "Adjusting labour"):
 * the least notice and the redundancy pay an employer owes, each by length of service, in days of pay (a week is seven); and the size
 * of employer below which no redundancy pay is owed, where the law has one. A record an employer reads; nothing here
 * holds any place's figures, and a world with no such law owes what its agreements say and nothing more.
 */
export interface TerminationLaw { id: string; notice: { from_years: number; days: number }[]; redundancy_pay: { from_years: number; days: number }[]; small_employer_under?: number }
export function terminationLaw(book: Book): TerminationLaw | undefined {
  const l = book.open("law").filter((r) => r.data?.employment === "termination").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
  if (!l) return undefined;
  const steps = (x: unknown) => (Array.isArray(x) ? x.filter((b) => Number.isFinite(b?.from_years) && Number.isFinite(b?.days)).map((b) => ({ from_years: Number(b.from_years), days: Number(b.days) })).sort((a, b) => a.from_years - b.from_years) : []);
  const under = Number(l.data?.small_employer_under);
  return { id: l.id, notice: steps(l.data?.notice), redundancy_pay: steps(l.data?.redundancy_pay), ...(under > 0 ? { small_employer_under: under } : {}) };
}
/**
 * The law on cutting an employee's hours in place of ending the job (docs/behaviour/firms.md, "Hours before heads"),
 * as its lawmaker published it: whether an employer may reduce hours for want of work (`may_cut`: "notice" by giving
 * notice, "consent" with the employee's agreement, "no" not at all), the ordinary week, the notice, the least hours it
 * may cut to (a share of the ordinary), the longest spell, and the pay owed for the hours not worked (a share of the
 * pay for them, from an employer of that many staff). A record an employer and a worker read; nothing here holds
 * any place's figures, and a world with no such law has firms that do not cut hours.
 */
export interface HoursLaw { id: string; may_cut: "notice" | "consent" | "no"; ordinary_week_hours: number; notice_days: number; floor_bps: number; max_days: number; pay_bps: number; pay_owed_from: number; consent_bps: number }
export function hoursLaw(book: Book): HoursLaw | undefined {
  const l = book.open("law").filter((r) => r.data?.employment === "hours").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
  if (!l) return undefined;
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : d);
  const may = l.data?.may_cut === "notice" || l.data?.may_cut === "consent" ? (l.data.may_cut as "notice" | "consent") : "no";
  return { id: l.id, may_cut: may, ordinary_week_hours: n(l.data?.ordinary_week_hours, 40), notice_days: n(l.data?.notice_days, 0), floor_bps: Math.min(10_000, n(l.data?.floor_bps, 0)), max_days: n(l.data?.max_days, 0),
    pay_bps: Math.min(10_000, n(l.data?.pay_bps, 0)), pay_owed_from: n(l.data?.pay_owed_from, 0), consent_bps: Math.min(10_000, n(l.data?.consent_bps, 10_000)) };
}
/** A cut of someone's hours that we have made (`set`) or put to them for their agreement (`proposed`). */
interface Cut { agreement: string; worker: string; full: number; hoursBps: number; paidBps: number; wage: number; from: number; until: number; since: number; state: "proposed" | "set"; replyBy: number }
/** The days a paper to the staff goes ahead of the pay it changes, where the law gives none (ours: it must reach them before the first pay it changes). */
export const HOURS_GRACE_DAYS = 3;
/** The ordinary week of a job in hours: its agreement's hours term, else the law's ordinary week. */
export const ordinaryHours = (a: any, worker: string, law: HoursLaw | undefined): number => { const h = jobTerms(a, worker).hours; return h ? h / 3600 : law?.ordinary_week_hours ?? 0; };
/** The pay a cut leaves, in 10,000ths of the ordinary pay: the hours worked at full pay, and the hours cut at the share the law owes for them. */
export const paidShare = (hoursBps: number, payBps: number): number => hoursBps + Math.floor(((10_000 - hoursBps) * payBps) / 10_000);

/** A schedule by service (days of pay), read at a length of service as weeks of pay (the last step at or below it; before the first: nothing). */
export const weeksAt = (steps: { from_years: number; days: number }[], years: number): number => steps.reduce((x, b) => (years >= b.from_years ? b.days : x), 0) / 7;

/**
 * How an employer adjusts its staff to its trade (docs/behaviour/firms.md, "Adjusting labour"). Three things real
 * firms do, each with its source there: they plan on trade smoothed over a horizon, never on one month's (Holt,
 * Modigliani, Muth and Simon 1960); they hold labour through a dip, because letting someone go and hiring again
 * both cost (Oi 1962; Hamermesh 1989; Bentolila and Bertola 1990; Fay and Medoff 1985), so a worker is let go only
 * once the surplus has lasted as long as letting them go and replacing them would cost in their pay; and while over
 * their need they shed by not replacing those who leave (Davis, Faberman and Haltiwanger 2012).
 * `smooth_months`: the horizon (0: last month's figure, the rule as it was). `hiring_cost_weeks`: what taking someone
 * on costs, in weeks of their pay. With neither (`smooth_months` 0 and no cost), an employer reacts to each month as before.
 */
export interface AdjustParams { smooth_months: number; hiring_cost_weeks: number;
  /** Hours before heads (docs/behaviour/firms.md, "Hours before heads"): the least change, in 10,000ths of the ordinary hours, worth a notice to the staff (a placeholder; left out: 1,000). */
  hours_step_bps?: number }
export class LabourPlan {
  private level: number;
  private surplus = 0; // months in a row with more staff than the trade expected needs
  /** `opening`: the trade the firm expected when it took its staff on (a month's items), where it has one: its first
   * month's figure then moves that expectation like any other month's, and is not taken for the whole of it. */
  constructor(private readonly p: AdjustParams, opening?: number) { this.level = opening !== undefined && opening > 0 ? opening : -1; }
  /** The trade expected, after another month's figure: an average weighted to the recent months over the horizon. */
  expect(month: number): number {
    const h = Math.max(0, this.p.smooth_months);
    this.level = this.level < 0 || h <= 1 ? month : Math.round(this.level + ((month - this.level) * 2) / (h + 1));
    return this.level;
  }
  get expected(): number { return this.level; }
  /** How many months a surplus must have lasted before the most recent hire is let go: what ending the job costs
   * under the law (notice and redundancy pay for their service, where our size owes it) and hiring again, in weeks
   * of pay, as months (never less than one: the month the surplus is first seen). */
  waits(law: TerminationLaw | undefined, staff: number, years: number, noticeDays: number): number {
    const notice = Math.max(law ? weeksAt(law.notice, years) : 0, noticeDays / 7);
    const redundancy = law && !(law.small_employer_under && staff < law.small_employer_under) ? weeksAt(law.redundancy_pay, years) : 0;
    return Math.max(1, Math.ceil(((notice + redundancy + Math.max(0, this.p.hiring_cost_weeks)) * 12) / 52));
  }
  /** The month's look: `over` (more staff than the expected trade needs) or not. Returns whether to let one go now. */
  month(over: boolean, waits: number): { letGo: boolean; lasted: number } {
    this.surplus = over ? this.surplus + 1 : 0;
    if (over && this.surplus >= waits) { this.surplus = 0; return { letGo: true, lasted: waits }; }
    return { letGo: false, lasted: this.surplus };
  }
}

/** How a hiring office's letter to the payroll office begins (an office's note: `officeNote`). */
export const PAYROLL_NOTE = "Payroll notice from the hiring office, ";

/** How long before a pay run a change of pay is left to the run after (payroll's cut-off: longer than any act takes). */
const PAY_CUTOFF = 2 * DAY;

export class Staffing {
  private readonly orders = new Map<string, string>(); // agreement -> wage standing order
  private readonly pendingOrder = new Map<string, string>(); // step marker -> agreement
  private readonly replacing = new Map<string, number>(); // agreement -> when we replaced its wage order (until the replacement is on the book, or a couple of days pass)
  private readonly handled = new Set<string>();
  readonly noticed = new Map<string, number>(); // agreement -> when we gave notice
  /** Whom our bank has told us has died: someone a standing order of ours pays (docs/behaviour/deaths.md). */
  private readonly bankSaysDead = new Set<string>();
  private n = 0; // unique names for standing orders we create
  // What the tax law's charges take from wages (docs/behaviour/public-finance.md): what each wage order withholds a pay,
  // charge by charge; what we've withheld under each charge and not yet paid over; and when we next pay it over.
  private readonly withholds = new Map<string, Withheld>(); // wage standing order -> withheld each pay
  private readonly pendingWithhold = new Map<string, Withheld>(); // step marker -> withheld each pay
  private readonly owed = new Map<string, { charge: Charge; law: string; amount: number }>(); // charge -> withheld, not yet paid over
  private readonly paidSince = new Map<string, Map<string, number>>(); // return -> agreement -> gross wages paid since our last report under it
  private readonly returnDay = new Map<string, number>(); // return -> the day it next falls due (the law's calendar: returns.ts; this only remembers which we have made)
  private rules: ReturnRule[] = returnsOf(undefined); // the returns of the law we last read
  private lawId: string | undefined; // the tax law we last read
  private owe(law: string | undefined, w: Withheld, agreement?: string, gross = 0) {
    for (const x of w.parts) {
      const o = this.owed.get(x.charge.id) ?? { charge: x.charge, law: law ?? "", amount: 0 };
      this.owed.set(x.charge.id, { charge: x.charge, law: law ?? o.law, amount: o.amount + x.amount });
    }
    if (agreement && gross > 0) for (const r of this.rules) if (r.charges === undefined || w.parts.some((x) => r.charges!.includes(x.charge.id))) {
      const m = this.paidSince.get(r.id) ?? new Map<string, number>();
      m.set(agreement, (m.get(agreement) ?? 0) + gross);
      this.paidSince.set(r.id, m);
    }
  }

  // Hours before heads (docs/behaviour/firms.md): cuts we have made or put to the staff, by agreement, and wage changes
  // waiting for the day their paper names.
  private readonly cuts = new Map<string, Cut>();
  private readonly due: { at: number; agreement: string; wage: number; why: string; short?: number; /** A rise held back to the pay run (see `raise`). */ held?: boolean }[] = [];
  private readonly declined = new Set<string>(); // agreements whose worker has not agreed to a cut, this spell
  private noCutUntil = -Infinity;
  private repliesRead = 0;
  /** Wages our orders have paid, gross (what they paid, and what they withheld), since we began. */
  wagesPaid = 0;
  // Pay that's changed since hiring (an enterprise agreement), and pay stopped (a strike: no pay for time on strike).
  private readonly gross = new Map<string, number>(); // agreement -> the wage now
  private readonly stopped = new Map<string, { since: number; lastDue: number }>(); // agreement -> its pay stopped when, and the pay day before

  /**
   * `does`: which half of it this office does. Most employers do both; an organisation where one office hires and
   * another runs the payroll (a town: its works manager, its finance officer) gives each its half.
   */
  /** `own`: when several offices of one organisation hire (the town's works and environment offices), which staff and
   * postings are this office's: those in its `role` ("role"), or those or ones that name no role (the staff the world
   * started with: "role_or_unnamed"). Absent: all of the organisation's (a payroll). */
  /** `payroll`: for an office that hires and does not pay, the office of its organisation that does (a post): it is
   * sent a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"). `notice_wait`: for an
   * office that pays and does not hire, how long it waits for the hiring office's notice of a new starter before it
   * sets the wage up from the agreement on file (seconds; absent: it acts on the agreement at once, as an employer
   * that does both does). */
  /** `registered_bps`: of the jobs this employer fills, the share it puts on its payroll returns (10,000, or nothing
   * said: all of them). A job it does not register is paid whole: nothing is withheld from it and no report names
   * its worker (docs/behaviour/firms.md, "Jobs an employer does not register"). */
  constructor(private readonly ctx: ParticipantContext, private readonly me: string, private readonly o: { period: number; notice_days: number; workplace?: string; role: string; industry?: string; does?: { hire?: boolean; pay?: boolean }; own?: "role" | "role_or_unnamed"; payroll?: string; /** The line of the organisation's adopted budget this office's posts are paid from: said on its payroll notices, so that the paying office knows which line a wage is on. */ line?: string; notice_wait?: number; registered_bps?: number; casual_bps?: number; day_wage?: number; work_days?: number; week_days?: number; short?: { per_year_bps: number; by_bps: number }; /** How often the office wakes (seconds; absent: daily): a return falling due before its next look is filed at this one. */ wakes?: number }) {}
  /** When we last let someone go because we could not pay them (from then we take on only with more in hand: the module asks). */
  cashLayoffAt = -Infinity;
  /** Redundancy pay (and pay in lieu of notice the agreement fell short of) owed at the end of a job we ended for redundancy: agreement -> the sum. */
  private readonly severance = new Map<string, number>();
  // Work by the day (`casual_bps`: of the jobs this employer fills, the share it fills by the day; `day_wage`: what it
  // pays for a day, at the wage it began with; `work_days`: the days of the week it works; `week_days`: the working days of the world's week, over which a day's
  // pay is reckoned as a year's for what the law withholds). Whom we have paid for
  // which day; and the wage we began with, by which the day's pay moves as ours does.
  private readonly paidOn = new Map<string, number>(); // agreement -> the day we last paid for
  private wage0: number | undefined;
  private dayWage(wage: number): number {
    return Math.max(1, Math.round(((this.o.day_wage ?? 0) * wage) / Math.max(1, this.wage0 ?? wage)));
  }
  /** Whether the job we post next is one by the day (the share the world gives; drawn for each posting). */
  private postsByTheDay(t: number): boolean {
    const share = this.o.casual_bps ?? 0;
    return share > 0 && (this.o.day_wage ?? 0) > 0 && this.ctx.rng(`by-the-day`).below(10_000) < share;
  }
  /** A posting: for a job on a standing wage, or (the employer's share of them) for work by the day. */
  private posting(t: number, wage: number, account: string, byDay = this.postsByTheDay(t)): C.Call {
    const place = this.o.workplace ? { workplace: structureOf(this.o.workplace), space: this.o.workplace } : {};
    if (byDay) {
      const day = this.dayWage(wage);
      return say("job_posting", `Hiring by the day: ${moneyNow(day)} for each day worked.`, { data: { wage: day, period: DAY, by_the_day: true, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...place },
        offer: { by: this.me, to: { min_age_years: 18 }, take_up: "apply", available: 1, terms: { template: "employment",
          commitments: [{ who: this.me, does: { outcome: { money: { ...(account ? { from: account } : {}), amount: String(day), for: "a day's work" } } }, every: DAY },
            ...(this.o.workplace ? [{ who: "taker", does: { outcome: { occupancy: { in: this.o.workplace } } } } as const] : [])],
          termination: [{ party: this.me, notice: NO_NOTICE }, { party: "taker" as const, notice: NO_NOTICE }] } } });
    }
    return say("job_posting", `Hiring: ${moneyNow(wage)} every ${this.o.period / DAY} days.`, { data: { wage, period: this.o.period, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...place }, offer: this.jobOffer(wage, account) });
  }
  // Jobs we have not registered: our own note of each (a record only we see), from the start or made when we took
  // the worker on; and the jobs we have already decided about.
  private readonly offBooks = new Set<string>();
  private readonly decided = new Set<string>();
  private notesRead = 0;
  /** Whether a job is one we do not register (decided once, when its wages start; a note of ours says so after). */
  private readNotes(book: Book) {
    const notes = book.all("off_books");
    for (; this.notesRead < notes.length; this.notesRead++) {
      const r = notes[this.notesRead]!;
      if (r.speaks_for === this.me && r.data?.agreement) this.offBooks.add(String(r.data.agreement));
    }
  }
  private unregistered(book: Book, agreement: string): { off: boolean; note?: C.Call } {
    this.readNotes(book);
    if (this.offBooks.has(agreement)) return { off: true };
    const share = this.o.registered_bps ?? 10_000;
    if (share >= 10_000 || this.decided.has(agreement)) return { off: false };
    this.decided.add(agreement);
    if (this.ctx.rng(`registers-${agreement}`).below(10_000) < share) return { off: false };
    this.offBooks.add(agreement);
    return { off: true, note: say("off_books", `Not on our payroll returns: ${agreement}.`, { visible: [this.me], basis: agreement, data: { agreement } }) };
  }
  /** Payroll notices this office has sent, by "<starter|leaver>:<agreement>" (and what is on file says the same). */
  private readonly notified = new Set<string>();
  /** The role an employment agreement names ("... works for X as <role> for <the wage> every N days."), if any; one
   * that names none and was made on an advertisement is for the post advertised (an offer in the office-holder's own
   * words: docs/behaviour/firms.md, "An offer made on an advertisement"). */
  private roleOf(a: any, book: Book): string | undefined {
    const named = / as (.+?) for (?:(?! for ).)+ every \d+ days\.(?: First pay .*)?$/.exec(a.terms?.text ?? "")?.[1];
    if (named !== undefined) return named;
    const advertised = advertisedJob(book, a)?.data?.role;
    return typeof advertised === "string" && advertised ? advertised : undefined;
  }
  private ours(role: string | undefined): boolean {
    return !this.o.own || role === this.o.role || (this.o.own === "role_or_unnamed" && role === undefined);
  }

  absorb(obs: Observation) {
    for (const m of obs.inbox) {
      const who = PAYEE_DIED.who(m.text);
      if (who) this.bankSaysDead.add(who);
      // (A wage our account could not cover: the bank says so, naming our order. It is still owed: the ledger below.)
      if (m.re && PAYMENT_FAILED.is(m.text)) this.failed.push({ order: m.re, t: obs.t });
    }
    for (const x of obs.outcomes) for (const [ref, id] of Object.entries(x.created ?? {})) if (this.pendingOrder.has(ref)) {
      this.orders.set(this.pendingOrder.get(ref)!, id);
      this.replacing.delete(this.pendingOrder.get(ref)!);
      this.pendingOrder.delete(ref);
      if (this.pendingWithhold.has(ref)) this.withholds.set(id, this.pendingWithhold.get(ref)!);
      this.pendingWithhold.delete(ref);
    }
    // Wages paid by our standing orders: what each withheld is now owed to the collector.
    const ours = new Map([...this.orders].map(([agreement, order]) => [order, agreement]));
    for (const tx of channels.transactions(obs)) {
      if (!tx.per_instruction || !ours.has(tx.per_instruction)) continue;
      const w = this.withholds.get(tx.per_instruction) ?? NOTHING_WITHHELD;
      if (!this.offBooks.has(ours.get(tx.per_instruction)!)) this.owe(this.lawId, w, ours.get(tx.per_instruction), cents(tx.amount) + w.total);
      this.wagesPaid += cents(tx.amount) + w.total;
      const short = this.skim.get(ours.get(tx.per_instruction)!);
      if (short) this.kept.set(ours.get(tx.per_instruction)!, (this.kept.get(ours.get(tx.per_instruction)!) ?? 0) + short);
    }
  }

  private contracts(book: Book): any[] {
    return book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === this.me && this.ours(this.roleOf(r, book)));
  }
  private endOf(book: Book, a: any): number {
    return book.endsAt(a.id) ?? Infinity;
  }
  /** Employment agreements in force and not yet ended, oldest first. */
  staff(book: Book, t: number): any[] {
    return this.contracts(book).filter((a) => book.inForce(a.id) && t < this.endOf(book, a)).sort((x, y) => book.signedAt(x.id)! - book.signedAt(y.id)!);
  }
  /** Those of our staff we know to have died: by the registry's entry or by our bank's word (docs/behaviour/deaths.md). */
  knownDead(book: Book, t: number): string[] {
    const dead = new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...this.bankSaysDead]);
    return this.staff(book, t).map((a) => a.terms.parties[1] as string).concat(this.contracts(book).filter((a) => this.noticed.has(a.id)).map((a) => a.terms.parties[1] as string)).filter((w, i, all) => dead.has(w) && all.indexOf(w) === i);
  }
  /** Our staff, as we have them (truth audits). */
  beliefs(book: Book): Belief[] {
    // (An office that keeps only its own role's staff doesn't hold its organisation's whole list: it says nothing of it.)
    if (this.o.own) return [];
    return [{ of: "held", party: this.me, template: "employment", agreements: this.staff(book, book.now).map((a) => a.id) }];
  }
  /** What a direction not to recruit does and does not do, in the office's words (docs/behaviour/directions.md): no
   * post is advertised and no new offer made; an offer already out is the office's word already given, and stands
   * if the worker signs it. Until 2026-10-11 the office wrote that it "takes nobody on", and a worker who signed an
   * offer made two days before the direction read to a mayor and a finance officer as the office defying it. */
  notRecruiting(book: Book, t: number): string {
    const out = this.offered(book, t);
    return `The office advertises no post, takes down the advertisements it has out and makes no new offer of employment.${out.length ? ` ${out.length === 1 ? "One offer" : `${out.length} offers`} it had already made ${out.length === 1 ? "is" : "are"} not yet signed by the worker (${out.map((a) => `${a.id}, to ${a.terms.parties[1]}`).join("; ")}): a direction ends no offer already made, and ${out.length === 1 ? "it stands if the worker signs it" : "each stands if the worker signs it"}.` : " It has no offer out that is not yet signed."}`;
  }
  /** Offers we've made in the last month that the worker hasn't signed yet. */
  offered(book: Book, t: number): any[] {
    return this.contracts(book).filter((a) => !book.concluded(a.id) && !book.signedBy(a.id, a.terms.parties[1]) && t - a.at < MONTH);
  }
  /** Our standing job postings. */
  postings(book: Book) {
    return book.open("job_posting").filter((j) => j.speaks_for === this.me && this.ours(j.data?.role as string | undefined));
  }
  /** The workers we're paying, by person. */
  workers(book: Book, t: number): string[] {
    return this.staff(book, t).map((a) => a.terms.parties[1] as string);
  }

  /** How many of our staff are staying: those we haven't given notice. (Someone working out their notice is still on
   * the staff and still paid, so a firm that lets people go until it can cover its wages counts those who stay: counted
   * with those going, one shortfall let the whole staff go, one after another, in a day.) */
  staying(book: Book, t: number): number {
    return this.staff(book, t).filter((a) => !this.noticed.has(a.id)).length;
  }

  /**
   * The routine: start wages for new hires and stop them for the dead and the departed; offer each posting's job to
   * one applicant at random (at the posting's wage); post a job at `wage` while short of `target` and `canPost`.
   */
  /** A posting's offer (docs/design/ai-citizens.md 2a): the terms of the employment it's for, in the typed vocabulary. */
  jobOffer(wage: number, account: string): Offer {
    return { by: this.me, to: { min_age_years: 18 }, take_up: "apply", available: 1, terms: { template: "employment",
      commitments: [
        // (The account it's paid from, where the office says; a payroll elsewhere in the organisation pays it otherwise.)
        { who: this.me, does: { outcome: { money: { ...(account ? { from: account } : {}), amount: String(wage), for: "wages" } } }, every: this.o.period },
        ...(this.o.workplace ? [{ who: "taker", does: { outcome: { occupancy: { in: this.o.workplace } } } } as const] : []),
      ],
      // (Notice, where the employer says what it is.)
      ...(Number.isInteger(this.o.notice_days) && this.o.notice_days > 0 ? { termination: [{ party: this.me, notice: this.o.notice_days * DAY }, { party: "taker" as const, notice: this.o.notice_days * DAY }] } : {}) } };
  }

  /** `recruit: false`: the office has been directed not to recruit (docs/behaviour/directions.md): it advertises no
   * post, takes its standing advertisements down (saying why: `stopped`), and makes no offer to an applicant, while
   * that stands. Those it employs, their pay and their notice go on as they were. */
  routine(obs: Observation, book: Book, account: string, want: { target: number; wage: number; canPost: boolean; why?: string; recruit?: boolean; stopped?: string; /** Whether there is work today for hands by the day (nothing said: yes). */ work?: boolean }): Step[] {
    const t = obs.t;
    const me = this.me;
    // Genesis standing orders for existing staff (what each withholds: the agreed wage less what it pays; charge by
    // charge as the law reckons it, where that comes to the same).
    const law = incomeTaxLaw(book);
    this.lawId = law?.id ?? this.lawId;
    this.readNotes(book);
    for (const r of book.open("request")) for (const b of r.speaks_for === me && r.data?.every ? basesOf(r) : []) if (b && !this.orders.has(b) && !this.isReplacing(b, t)) { // (not one whose replacement is made but not yet on the book: the act waits for its performer's time)
      this.orders.set(b, r.id);
      const a = book.records.get(b);
      const gross = a?.record === "agreement" ? cents(commitmentOf(a, me).outcome?.money?.amount ?? 0) : 0;
      const net = cents(r.data?.outcome?.money?.amount ?? 0);
      if (gross > net && net > 0) {
        const w = withheld(law, gross, Number(r.data?.every) || this.o.period);
        this.withholds.set(r.id, w.total === gross - net ? w : { total: gross - net, parts: law?.charges[0] ? [{ charge: law.charges[0], amount: gross - net }] : [] });
      }
    }
    const contracts = this.contracts(book);
    const staff = this.staff(book, t);
    const offered = this.offered(book, t);
    const steps: Step[] = [];
    let offersNow = 0;
    const doesPay = this.o.does?.pay !== false;
    // (Directed not to recruit: its advertisements come down, and nothing below that hires is done.)
    const recruiting = want.recruit !== false;
    const doesHire = this.o.does?.hire !== false && recruiting;
    if (!recruiting && this.o.does?.hire !== false) {
      const up = this.postings(book);
      if (up.length) steps.push(because(want.stopped ?? "Directed not to recruit: taking our advertisements down.", ...up.map((j) => withdraw(j.id, "Withdrawn: recruiting is stopped by direction."))));
    }

    // Newly signed: start paying wages by standing order, at the wage agreed less what the tax law's charges say to
    // withhold.
    // (A payroll that another office hires for acts on that office's notice of a new starter, and pays from the first
    // pay day it gives. With no notice after `notice_wait`, it sets the wage up from the agreement on file, whose
    // first pay day is a pay period after both signed: docs/behaviour/firms.md, "Payroll notices".)
    const starters = this.o.notice_wait !== undefined ? book.open("payroll_notice").filter((n) => n.speaks_for === me && n.data?.notice === "starter") : [];
    for (const a of doesPay ? staff : []) {
      // (Not a job we've given notice on: a worker who died has their order withdrawn, and isn't a new hire.)
      if (this.orders.has(a.id) || this.stopped.has(a.id) || this.noticed.has(a.id) || [...this.pendingOrder.values()].includes(a.id)) continue;
      if (byTheDay(a)) continue; // (paid for each day worked, below: no standing order)
      const worker = a.terms.parties[1];
      const pays = { ...jobTerms(a, worker) };
      pays.wage = this.gross.get(a.id) ?? pays.wage;
      const told = starters.find((n) => n.data?.agreement === a.id);
      const signed = book.signedAt(a.id) ?? a.at;
      if (this.o.notice_wait !== undefined && !told && t - signed < this.o.notice_wait) continue;
      const to = commitmentOf(a, me).outcome?.money?.to ?? (typeof told?.data?.account === "string" ? (told.data.account as string) : undefined) ?? ((book.all("job_application").find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === worker) as any)?.data?.account);
      if (!to) continue;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      // (A job we do not register is paid whole: nothing withheld, and our returns will not name it.)
      const reg = this.unregistered(book, a.id);
      const w = reg.off ? NOTHING_WITHHELD : withheld(law, pays.wage, pays.period), tax = w.total;
      if (tax > 0) this.pendingWithhold.set(ref, w);
      // (The first pay day: the notice's; with none, the agreement's; for an employer that hires and pays itself, a pay
      // period from now, as it has always been.)
      const firstPay = this.o.notice_wait === undefined ? undefined : Number.isSafeInteger(told?.data?.first_pay) ? (told!.data!.first_pay as number) : signed + pays.period;
      const first = firstPay === undefined ? pays.period : Math.max(0, firstPay - t);
      const on = this.o.notice_wait === undefined ? "A new hire has signed" : told ? `Payroll notice ${told.id}: a new starter, first pay day ${dateWords(firstPay!)}` : `A new starter's agreement (${a.id}) is on file and no payroll notice has come for it: setting the wage up from the agreement, first pay day ${dateWords(firstPay!)}`;
      if (reg.off) {
        steps.push(because(`${on}: starting their wages by standing order, whole. This job is not going on our payroll returns.`,
          [ref, pay(to, pays.wage, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`, ...(typeof told?.data?.line === "string" ? { line: told.data.line } : {}) })], ...(reg.note ? [reg.note] : [])));
        continue;
      }
      steps.push(because(tax > 0 ? `${on}: starting their wages by standing order, ${usd(pays.wage - tax)} after the ${usd(tax)} of income tax the law says to withhold.` : `${on}: starting their wages by standing order.`,
        [ref, pay(to, pays.wage - tax, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`, ...(typeof told?.data?.line === "string" ? { line: told.data.line } : {}) })]));
    }
    // An office that hires and does not pay tells the office that does (docs/behaviour/firms.md, "Payroll notices"): of each new
    // starter once both have signed (who, the post, the pay, the pay period, the first pay day, the account, the
    // agreement), and of each leaver once the employment has an end (the last day). Each once, by the office's own
    // file: whoever holds the office carries on from its papers.
    if (this.o.payroll && !doesPay && this.o.does?.hire !== false) {
      const filed = book.open("payroll_notice").filter((n) => n.speaks_for === me);
      const sent = (what: string, a: any) => this.notified.has(`${what}:${a.id}`) || filed.some((n) => n.data?.notice === what && n.data?.agreement === a.id);
      const post = (a: any) => this.roleOf(a, book) ?? this.o.role;
      for (const a of staff) {
        const signed = book.signedAt(a.id);
        // (Those the organisation started with were on its payroll before the year began.)
        if (a.author === "genesis" || signed === undefined || sent("starter", a)) continue;
        const worker = a.terms.parties[1] as string, pays = jobTerms(a, worker), to = this.payee(book, a);
        if (!to) continue;
        this.notified.add(`starter:${a.id}`);
        const firstPay = signed + pays.period;
        // (Which line of the budget the post is on: the hiring office took the worker on within its own line, and the
        // office that pays must not have to guess it. Until 2026-10-11 the notice named no line: a finance seat set a
        // hire on the environment line against the staff line, found that full, and left the worker unpaid.)
        const onLine = this.o.line ? ` The post is one of those the ${this.o.line} line of the adopted budget pays for: the wage is on that line.` : "";
        steps.push(because(`${worker} has signed and started: sending the ${this.o.payroll} office a payroll notice (who, the post, the pay, the first pay day, the agreement), for it to set the wage up.`,
          say("payroll_notice", `Payroll notice, new starter: ${worker}, ${post(a)}, under employment agreement ${a.id}. Pay: ${usd(pays.wage)} every ${durationWords(pays.period)} before tax, into ${to}; first pay day ${dateWords(firstPay)}, then every ${durationWords(pays.period)}.${onLine} For the ${this.o.payroll} office: the wage payment is to be set up from that day.`,
            { to: [me], visible: [me], basis: a.id, data: { notice: "starter", office: this.o.payroll, employee: worker, post: post(a), agreement: a.id, wage: String(pays.wage), period: pays.period, first_pay: firstPay, account: to, ...(this.o.line ? { line: this.o.line } : {}) } }),
          // (And put in front of the payroll office: a paper on the organisation's own file is not news to anyone in
          // it, so the notice goes to the office's post as a letter, in its own words, naming the agreement.)
          message([this.o.payroll], `${PAYROLL_NOTE}new starter: ${worker}, ${post(a)}, under employment agreement ${a.id}. Pay: ${usd(pays.wage)} every ${durationWords(pays.period)} before tax, into ${to}; first pay day ${dateWords(firstPay)}, then every ${durationWords(pays.period)}.${onLine} The notice is on the organisation's file. The wage payment is to be set up from that day: a payment from the organisation's account to ${to} every ${durationWords(pays.period)}, first on ${dateWords(firstPay)}, citing ${a.id}, of the pay less what the tax law says to withhold.`, a.id)));
      }
      const deaths = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
      for (const a of contracts) {
        if (!book.concluded(a.id) || sent("leaver", a)) continue;
        const worker = a.terms.parties[1] as string;
        const died = deaths.has(worker) && book.inForce(a.id) && t < this.endOf(book, a);
        const end = died ? t : book.endsAt(a.id);
        if (end === undefined) continue;
        this.notified.add(`leaver:${a.id}`);
        const reason = died ? "died" : "notice";
        // (A member of staff who has died: the employment is ended on record by the office that employed them, if
        // nobody of the organisation has yet.)
        const ends = died && !(book.notices.get(a.id) ?? []).some((n) => n.as === me) ? [notice(a.id, "The employee has died.")] : [];
        if (died) this.noticed.set(a.id, t);
        steps.push(because(died ? `${worker}, who worked for us, has died: ending the employment on record and telling the ${this.o.payroll} office.` : `${worker}'s employment ends on ${dateWords(end)}: telling the ${this.o.payroll} office.`,
          ...ends,
          say("payroll_notice", `Payroll notice, leaver: ${worker}, ${post(a)}, employment agreement ${a.id} ends on ${dateWords(end)} (${reason}). For the ${this.o.payroll} office: pay is due to that day, and the wage payment under the agreement is to end then.`,
            { to: [me], visible: [me], basis: a.id, data: { notice: "leaver", office: this.o.payroll, employee: worker, post: post(a), agreement: a.id, last_day: end, reason } }),
          message([this.o.payroll], `${PAYROLL_NOTE}leaver: ${worker}, ${post(a)}, employment agreement ${a.id} ends on ${dateWords(end)} (${reason}). The notice is on the organisation's file. Pay is due to that day, and the standing payment of their wage is to be withdrawn then.`, a.id)));
      }
    }
    // A worker who has died: stop the wages, and end the employment on record. We know of it when we are told: by the
    // registry's entry, if whoever reported the death named us, or by our bank, when a wage is next paid into the
    // account of someone it has been told has died (nobody is shown the register: docs/behaviour/deaths.md).
    const died = doesPay ? [...new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...this.bankSaysDead])] : [];
    for (const who of died) {
      const a = staff.find((x) => x.terms.parties[1] === who);
      // (Someone already under notice, let go or leaving, who dies while it runs: their wages stop now all the same.
      // Until 2026-10-09 they were paid to the end of the notice.)
      const underNotice = !!a && this.noticed.has(a.id);
      if (!a || (underNotice && !this.orders.has(a.id))) continue;
      this.noticed.set(a.id, t);
      // (No second notice where the office that employed them has already ended the employment on record.)
      const ended = (book.notices.get(a.id) ?? []).some((n) => n.as === me);
      const s: Step = because(`${who}, who worked for us, has died: stopping their wages.`, ...(underNotice || ended ? [] : [notice(a.id, "The employee has died.")]));
      if (this.orders.has(a.id)) {
        s.push(withdraw(this.orders.get(a.id)!, "The employee has died; stop wages."));
        this.orders.delete(a.id);
      }
      steps.push(s);
    }
    // Ended (notice served): stop the wages.
    for (const a of doesPay ? contracts : []) if (book.concluded(a.id) && t >= this.endOf(book, a) && this.orders.has(a.id)) {
      steps.push(because("Employment has ended: stopping the wages.", withdraw(this.orders.get(a.id)!, "Employment ended; stop wages.")));
      this.orders.delete(a.id);
    }
    // Ended for redundancy, with pay owed under the law: owed in our books from the day the job ends, and paid with
    // the wages we owe (at once if the account covers it; late if not).
    for (const a of doesPay ? contracts : []) if (this.severance.has(a.id) && book.concluded(a.id) && t >= this.endOf(book, a)) {
      const to = this.payee(book, a);
      if (to) this.unpaid.push({ agreement: a.id, to, amount: this.severance.get(a.id)!, withheld: NOTHING_WITHHELD, due: this.endOf(book, a), what: "Redundancy pay" });
      this.severance.delete(a.id);
    }

    if (doesPay) steps.push(...this.applyHours(book, t, account));
    if (doesPay) steps.push(...this.latePay(book, t, account, (() => { const b = channels.accounts(obs).find((x) => x.account === account)?.balance; return b === undefined ? undefined : cents(b); })(),
      staff.reduce((x, a) => x + (this.noticed.has(a.id) || byTheDay(a) ? 0 : this.wageOf(a)), 0)));

    // Work by the day: each hand who is at work today is paid the day's wage today, once, by a payment of its own
    // (less what the law withholds from a day's pay, where the job is one we register). A day we have no work for
    // them (`want.work` false), a day that is not a working day, a hand who is not there: no pay, and nothing owed.
    // Short of the money for all of them, we pay those we can, the longest with us first.
    this.wage0 ??= want.wage;
    const hands = doesPay ? staff.filter((a) => byTheDay(a) && !this.noticed.has(a.id)) : [];
    const today = Math.floor(t / DAY);
    if (hands.length && want.work !== false && today % 7 < (this.o.work_days ?? 5)) {
      const here = this.o.workplace ? new Set(channels.cells(obs).flatMap((c) => (c.structure?.structure === structureOf(this.o.workplace!) ? c.structure.spaces.filter((sp) => sp.space === this.o.workplace).flatMap((sp) => sp.occupants ?? []) : []))) : undefined;
      let left = cents(channels.accounts(obs).find((x) => x.account === account)?.balance ?? 0);
      const lines: C.Call[] = [];
      for (const a of hands) {
        const worker = a.terms.parties[1] as string;
        if (this.paidOn.get(a.id) === today || (here && !here.has(worker))) continue;
        const day = this.wageOf(a); // (the day's pay agreed, with any rise since)
        const to = this.payee(book, a);
        if (!to || day > left) continue;
        const reg = this.unregistered(book, a.id);
        const w = reg.off ? NOTHING_WITHHELD : withheld(law, day, dayPayPeriod(this.o.week_days ?? 5));
        this.paidOn.set(a.id, today);
        left -= day;
        if (!reg.off) this.owe(law?.id, w, a.id, day);
        this.wagesPaid += day;
        lines.push(pay(to, day - w.total, { from: account, basis: a.id, for: `A day's work: ${worker}.` }), ...(reg.note ? [reg.note] : []));
      }
      for (let i = 0; i < lines.length; i += 30) steps.push(because(`Paying today's hands for the day (${lines.length} by the day).`, ...lines.slice(i, i + 30)));
    }

    // Hiring: one applicant at random per posting, at the posting's wage.
    const posts = this.postings(book);
    const apps = book.open("job_application").filter((a) => (a.addressed_to ?? []).includes(me) && !this.handled.has(a.id));
    for (const post of doesHire ? posts : []) {
      // (An advertisement of ours that we have put on hold: nobody is offered the post while the hold stands; those
      // who applied are still on file when it is lifted.)
      if (book.onHold(post.id, [me])) continue;
      const mine = apps.filter((a) => a.data?.posting === post.id).sort((x, y) => (x.id < y.id ? -1 : 1));
      for (const a of mine) this.handled.add(a.id);
      if (!mine.length) continue;
      const chosen = this.ctx.rng(`hire-${post.id}`).pick(mine);
      const worker = chosen.speaks_for!;
      const wage = Number.isInteger(post.data?.wage) ? (post.data!.wage as number) : want.wage;
      if (post.data?.by_the_day) {
        steps.push(because(`Taking on a hand by the day: an applicant picked at random among ${mine.length}.`,
          ["job", offer(worker, { template: "employment", ourNotice: NO_NOTICE, theirNotice: NO_NOTICE,
            we: pay(chosen.data?.account ?? worker, wage, { every: DAY, for: "a day's work" }),
            they: this.o.workplace ? C.call("occupancy", { who: worker, in: this.o.workplace }) : undefined,
            text: `${worker} works for ${me} by the day, for ${moneyNow(wage)} for each day worked; either may end it at once.`, basis: chosen.id })],
          withdraw(post.id, "Filled.")));
        offersNow++;
        continue;
      }
      steps.push(because(`Hiring for our posting: an applicant picked at random among ${mine.length}.`,
        ["job", offer(worker, {
          template: "employment", ourNotice: this.o.notice_days * DAY, theirNotice: this.o.notice_days * DAY,
          // (The job's ordinary hours in a week, as the world's law has the ordinary week: the agreement's hours term.)
          ...(hoursLaw(book)?.ordinary_week_hours ? { hours: hoursLaw(book)!.ordinary_week_hours * 3600 } : {}),
          we: pay(chosen.data?.account ?? worker, wage, { every: this.o.period, for: "wages" }),
          they: this.o.workplace ? C.call("occupancy", { who: worker, in: this.o.workplace }) : undefined,
          text: `${worker} works for ${me} as ${post.data?.role ?? "staff"} for ${moneyNow(wage)} every ${this.o.period / DAY} days. First pay ${this.o.period / DAY} days after both have signed.`,
          basis: chosen.id,
        })],
        withdraw(post.id, "Filled."),
      ));
      offersNow++;
    }

    // On the law's days: what we've withheld, paid over to the tax's collector, with a return of it. The law lists its
    // returns (which charges each reports, how often, the day of the month it falls due by: returns.ts); we file each on
    // its day, for every employer alike. A period with nothing withheld files nothing; its day is still the calendar's.
    // Short of money, we pay what we can, keeping the next pay period's wages, and what's left is still owed (carried
    // to the next return).
    this.rules = returnsOf(law);
    const early = Math.max(0, (this.o.wakes ?? DAY) - DAY); // (an office that looks in weekly files by the day, not after it)
    for (const rule of this.rules) {
      if (!this.returnDay.has(rule.id)) this.returnDay.set(rule.id, nextReturn(rule, t).due);
      const falls = this.returnDay.get(rule.id)!;
      if (!doesPay || t + early < falls) continue;
      this.returnDay.set(rule.id, nextReturn(rule, falls).due);
      const period = nextReturn(rule, falls - 1);
      const balance = channels.accounts(obs).find((a) => a.account === account)?.balance;
      const due = [...this.owed.values()].filter((x) => x.amount > 0 && x.charge.account && x.charge.collector && (rule.charges === undefined || rule.charges.includes(x.charge.id)));
      if (due.length && balance !== undefined) {
        // (Keeping the next pay period's wages aside: they go first.)
        const keep = staff.reduce((x, a) => x + jobTerms(a, a.terms.parties[1]).wage, 0);
        let left = Math.max(0, cents(balance) - keep);
        // Who was paid what since we last reported, for a charge whose report names each worker.
        const lines = [...(this.paidSince.get(rule.id) ?? [])].filter(([agreement]) => !this.offBooks.has(agreement)).map(([agreement, gross]) => ({ worker: (book.records.get(agreement) as any)?.terms?.parties?.[1] as string | undefined, gross }))
          .filter((x): x is { worker: string; gross: number } => !!x.worker).sort((a, b) => (a.worker < b.worker ? -1 : a.worker > b.worker ? 1 : 0));
        const label = rule.name ?? "Return of tax withheld from wages";
        const mark = { return: rule.id, due: falls, period_from: period.from, period_to: period.to };
        // One report to each collector, in the law's order, with what is paid into each of its accounts.
        for (const collector of [...new Set(due.map((x) => x.charge.collector))]) {
          const parts = due.filter((x) => x.charge.collector === collector).map((x) => {
            const paid = Math.min(x.amount, left);
            left -= paid;
            this.owed.set(x.charge.id, { ...x, amount: x.amount - paid });
            return { charge: x.charge, owed: x.amount, paid };
          });
          const owed = parts.reduce((x, c) => x + c.owed, 0), paid = parts.reduce((x, c) => x + c.paid, 0);
          const accounts = [...new Set(parts.map((c) => c.charge.account))];
          const itemised = parts.some((c) => c.charge.itemised);
          const basis = due.find((x) => x.charge.collector === collector)!.law || law?.id;
          // (A law whose charges all go to one account, none reported worker by worker: one sum, as it has always been said.)
          const oneAccount = !law || (new Set(law.charges.map((c) => c.account)).size === 1 && !law.charges.some((c) => c.itemised));
          if (oneAccount && accounts.length === 1 && !itemised) {
            steps.push(because(paid === owed ? `${label}, due ${dateWords(falls)}: paying over the ${usd(owed)} of income tax we withheld from wages.` : `${label}, due ${dateWords(falls)}: we owe ${usd(owed)} of income tax withheld from wages and have ${usd(paid)}: paying that, and still owing the rest.`,
              say("withholding_report", `Income tax withheld from wages, owed: ${usd(owed)}; paid now: ${usd(paid)}.`, { to: [collector], visible: [me, collector], ...(basis ? { basis } : {}), data: { withheld: owed, paid, period_end: t, account, ...mark } }),
              ...(paid > 0 ? [pay(accounts[0]!, paid, { from: account, for: "Income tax withheld from wages." })] : [])));
            continue;
          }
          // Several accounts, or a charge reported worker by worker: the report says what is owed and paid under each
          // charge, and (where a charge asks it) each worker's pay in the period.
          const named = (c: Charge) => c.name ?? c.id;
          steps.push(because(paid === owed ? `${label}, due ${dateWords(falls)}: paying over the ${usd(owed)} we withheld from wages (${parts.map((c) => `${named(c.charge)} ${usd(c.owed)}`).join(", ")}).` : `${label}, due ${dateWords(falls)}: we owe ${usd(owed)} withheld from wages and have ${usd(paid)}: paying that, and still owing the rest.`,
            say("withholding_report", `Withheld from wages, owed: ${usd(owed)}; paid now: ${usd(paid)}. ${parts.map((c) => `${named(c.charge)}: owed ${usd(c.owed)}, paid ${usd(c.paid)}`).join("; ")}.`, { to: [collector], visible: [me, collector], ...(basis ? { basis } : {}),
              data: { withheld: owed, paid, period_end: t, account, ...mark, charges: parts.map((c) => ({ charge: c.charge.id, to: c.charge.account, withheld: c.owed, paid: c.paid })), ...(itemised ? { staff: lines } : {}) } }),
            ...accounts.map((to) => ({ to, sum: parts.filter((c) => c.charge.account === to).reduce((x, c) => x + c.paid, 0), what: parts.filter((c) => c.charge.account === to).map((c) => named(c.charge)).join(", ") }))
              .filter((x) => x.sum > 0).map((x) => pay(x.to, x.sum, { from: account, for: `Withheld from wages: ${x.what}.` }))));
        }
      }
      this.paidSince.delete(rule.id);
    }

    // A posting unfilled at an old wage (ours has moved since): published again at the wage we offer now.
    for (const post of doesHire ? posts : []) if (!apps.some((a) => a.data?.posting === post.id) && Number.isInteger(post.data?.wage) && post.data!.wage !== (post.data?.by_the_day ? this.dayWage(want.wage) : want.wage) && want.canPost) {
      steps.push(because(`Our posting is still open, at ${usd(post.data!.wage as number)}; we offer ${usd(post.data?.by_the_day ? this.dayWage(want.wage) : want.wage)} now: posting it again at that.`, withdraw(post.id, "Superseded: a new wage."),
        this.posting(t, want.wage, account, !!post.data?.by_the_day)));
    }

    // Post a job if short-staffed (and the module says we can).
    const have = staff.length + offered.length + offersNow;
    if (doesHire && have < want.target && posts.length === 0 && want.canPost) {
      steps.push(because(want.why ?? `Short-staffed (${have} of ${want.target}): posting a job.`, this.posting(t, want.wage, account)));
    }
    return steps;
  }

  /** The pay day after `t` of a wage standing order (its start, then every period). */
  private nextDue(book: Book, order: string, t: number): number {
    const r = book.records.get(order);
    const every = r?.record === "statement" ? Number(r.data?.every) || this.o.period : this.o.period;
    const start = r?.record === "statement" ? firstDue(r, every) : (r?.at ?? 0) + every;
    return start > t ? start : start + Math.ceil((t - start + 1) / every) * every;
  }

  /** The account a worker's wages go to. */
  /** The account an employee is paid into, as their agreement says. */
  payee(book: Book, a: any): string | undefined {
    const worker = a.terms.parties[1];
    return commitmentOf(a, this.me).outcome?.money?.to ?? ((book.all("job_application").find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === worker) as any)?.data?.account);
  }

  /** The wage an agreement pays now (after any rise). */
  wageOf(a: any): number {
    return this.gross.get(a.id) ?? jobTerms(a, a.terms.parties[1]).wage;
  }

  /**
   * A rise for everyone we employ (an enterprise agreement, docs/behaviour/unions.md): each wage order is replaced by
   * one at the new wage (net of the tax withheld), from the next pay day on.
   */
  raise(book: Book, t: number, account: string, riseBps: number, why: string, one?: { agreement: string; wage: number; /** Paid this much less than that, each pay (pay come short: above). */ short?: number }): Step[] {
    const law = incomeTaxLaw(book);
    const lines: C.Call[] = [];
    const refs: [string, string, Withheld][] = [];
    for (const a of this.staff(book, t)) {
      if (one && a.id !== one.agreement) continue; // (a rise for one of us, at the wage asked)
      let wage = one ? one.wage : Math.floor((this.wageOf(a) * (10_000 + riseBps)) / 10_000);
      // (A rise for someone on cut hours is a rise of their full wage, and they are paid their hours' share of it.)
      const cut = this.cuts.get(a.id);
      if (cut && !one) { cut.full = Math.floor((cut.full * (10_000 + riseBps)) / 10_000); wage = Math.floor((cut.full * cut.paidBps) / 10_000); cut.wage = wage; }
      this.gross.set(a.id, wage);
      if (one?.short) this.skim.set(a.id, one.short); else this.skim.delete(a.id); // (a wage set afresh is paid as set)
      const to = this.payee(book, a);
      // (A replacement already made, and not yet on the book: the act waits for its performer's time. Not replaced again
      // until it is: the order it would withdraw is the one already withdrawn, and a second would be made beside the first.)
      if (this.isReplacing(a.id, t)) {
        this.holdRise(a.id, t + DAY, wage, why, one?.short);
        continue;
      }
      const order = this.orders.get(a.id);
      if (!order || !to || this.stopped.has(a.id)) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      // A change of pay takes effect from a pay run, as payroll does it: with a cut-off. Replacing the order takes the
      // manager's time (the act waits for them), and an order withdrawn after its pay moment still pays it, so a pay
      // moment inside the act would be paid by the old order and again by the new. Within the cut-off before a pay run
      // the change is held until the run has been made, and then made for the run after it.
      const next = this.nextDue(book, order, t);
      if (next - t < Math.min(PAY_CUTOFF, Math.floor(period / 2))) {
        this.holdRise(a.id, next, wage, why, one?.short);
        continue;
      }
      const tax = this.offBooks.has(a.id) ? NOTHING_WITHHELD : withheld(law, wage, period);
      const ref = `wo${this.n++}`;
      lines.push(withdraw(order, "Superseded: a new wage."), [ref, pay(to, wage - tax.total - (one?.short ?? 0), { from: account, every: period, first: Math.max(DAY, this.nextDue(book, order, t) - t), basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })] as any);
      refs.push([ref, a.id, tax]);
      this.orders.delete(a.id);
    }
    for (const [ref, id, tax] of refs) {
      this.pendingOrder.set(ref, id);
      this.replacing.set(id, t);
      if (tax.total > 0) this.pendingWithhold.set(ref, tax);
    }
    const out: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) out.push(because(why, ...lines.slice(i, i + 30)));
    return out;
  }

  private isReplacing(agreement: string, t: number): boolean {
    const since = this.replacing.get(agreement);
    return since !== undefined && t - since < 2 * DAY && [...this.pendingOrder.values()].includes(agreement);
  }

  /** A change of pay left for a later look (the latest for an agreement is the one kept). */
  private holdRise(agreement: string, at: number, wage: number, why: string, short?: number) {
    const kept = this.due.findIndex((d) => d.held && d.agreement === agreement);
    if (kept >= 0) this.due.splice(kept, 1);
    this.due.push({ at, agreement, wage, why, short, held: true });
  }

  /** The organisation's wants, where the post that runs it has them (docs/behaviour/firm-wants.md). */
  org?: Org;

  // Pay that comes short (docs/behaviour/frictions.md, "Pay"): each year, of the people an employer pays, the share
  // it begins to pay less than it agreed (`short.per_year_bps`: the world's, at the world's dial), by `short.by_bps`
  // of the pay; more often the more its character would pay less, and twice as often while it has less in the bank
  // than two pay periods' wages. What it has kept back from each, pay by pay, is on its own books: it knows what
  // it owes, and says so truthfully to a venue that asks; what it may do is not pay.
  private readonly skim = new Map<string, number>(); // agreement -> what each pay is short by
  private readonly kept = new Map<string, number>(); // agreement -> what we have kept back in all, not yet made good
  private shortWeek = -1;
  /** The week's look at whom we begin to pay short (at most once a week, each on their own draw). */
  shortening(book: Book, t: number, account: string, balance: number): Step[] {
    const s = this.o.short, dial = frictionDial(this.ctx.world), week = Math.floor(t / (7 * DAY));
    if (!s || !(s.per_year_bps > 0) || !(s.by_bps > 0) || dial <= 0 || week === this.shortWeek) return [];
    this.shortWeek = week;
    const staff = this.staff(book, t).filter((a) => this.orders.has(a.id) && !this.skim.has(a.id) && !this.stopped.has(a.id) && !this.noticed.has(a.id) && !byTheDay(a));
    const bill = staff.reduce((x, a) => x + this.wageOf(a), 0);
    const rate = swayed(s.per_year_bps, this.org?.lively ? this.org.character.pay_less : 0, 1) * (balance < 2 * bill ? 2 : 1);
    const law = incomeTaxLaw(book);
    const steps: Step[] = [];
    for (const a of staff) {
      if (this.ctx.rng(`short-pay-${a.terms.parties[1]}-${week}`).below(1_000_000) >= chancePpm(rate, 7, dial)) continue;
      const wage = this.wageOf(a), period = jobTerms(a, a.terms.parties[1]).period;
      const net = wage - (this.offBooks.has(a.id) ? 0 : withheld(law, wage, period).total);
      const short = Math.floor((net * s.by_bps) / 10_000);
      if (short > 0) steps.push(...this.raise(book, t, account, 0, `Paying ${a.terms.parties[1]} ${usd(short)} a pay less than we agreed, from the next pay day.`, { agreement: a.id, wage, short }));
    }
    return steps;
  }
  // The wage ledger (docs/behaviour/firms.md, "Wages owed"): an agreed wage is owed in full. What we kept back from a
  // pay (above) and a pay our account could not cover on its day (the bank tells us, naming our order) both stand in
  // our books as owed to that worker under that agreement, until paid. A missed pay is paid late, oldest first, as
  // soon as the account covers it beside the next pay day's wages for those we keep; a worker who has left and
  // recorded the wages as a debt against us is paid as any creditor is, and the ledger's line gives way to the debt.
  private readonly failed: { order: string; t: number }[] = [];
  private readonly unpaid: { agreement: string; to: string; amount: number; withheld: Withheld; due: number; what?: string }[] = [];
  /** What our books say we owe someone in wages under an agreement: kept back, and missed. */
  owedShort(agreement: string): number {
    return (this.kept.get(agreement) ?? 0) + this.unpaid.reduce((x, u) => x + (u.agreement === agreement ? u.amount : 0), 0);
  }
  /** Wages our books say are owed and unpaid, in all (for whoever winds us up, and for what we can spend). */
  wagesOwed(): number {
    return this.unpaid.reduce((x, u) => x + u.amount, 0);
  }
  /** Whether we are in no state to pay out to our owners (docs/behaviour/firms.md, "Before a dividend"): wages are owed in our books, or someone
   * of our staff is under notice (a notice we gave because we could not cover the wage bill, or for want of trade). In words, or "" if neither. */
  strained(book: Book, t: number): string {
    const owed = this.wagesOwed();
    if (owed > 0) return `wages are owed in our books (${usd(owed)})`;
    const going = this.staff(book, t).filter((a) => this.noticed.has(a.id)).length;
    return going ? `${going} of our staff ${going === 1 ? "is" : "are"} under notice` : "";
  }
  /** Missed pays entered in the ledger, and those the account now covers paid late (keeping `keep` for the next pay day). */
  private latePay(book: Book, t: number, account: string, balance: number | undefined, keep: number): Step[] {
    const byOrder = new Map([...this.orders].map(([agreement, order]) => [order, agreement]));
    for (const f of this.failed.splice(0)) {
      const agreement = byOrder.get(f.order);
      const money = (book.records.get(f.order) as any)?.data?.outcome?.money;
      if (!agreement || !money?.to || !(cents(money.amount) > 0)) continue;
      this.unpaid.push({ agreement, to: money.to, amount: cents(money.amount), withheld: this.withholds.get(f.order) ?? NOTHING_WITHHELD, due: f.t });
    }
    if (!this.unpaid.length) return [];
    // (A worker's own claim for the wages, recorded as a debt against us, replaces our line: it is paid as a debt.)
    const claimed = new Set(book.ofType("claim").filter((c: any) => c.counterparty === this.me && c.about?.kind === "debt").flatMap((c: any) => basesOf(c)));
    for (let i = this.unpaid.length - 1; i >= 0; i--) if (claimed.has(this.unpaid[i]!.agreement)) this.unpaid.splice(i, 1);
    if (balance === undefined) return [];
    let left = balance - keep;
    const lines: C.Call[] = [];
    while (this.unpaid.length && this.unpaid[0]!.amount <= left && lines.length < 30) {
      const u = this.unpaid.shift()!;
      left -= u.amount;
      const worker = (book.records.get(u.agreement) as any)?.terms?.parties?.[1] ?? "our employee";
      if (!this.offBooks.has(u.agreement)) this.owe(this.lawId, u.withheld, u.agreement, u.amount + u.withheld.total);
      this.wagesPaid += u.amount + u.withheld.total;
      lines.push(pay(u.to, u.amount, { from: account, basis: u.agreement, for: u.what ? `${u.what} for ${worker}.` : `Wages for ${worker}, late: due ${dateWords(u.due)}.` }));
    }
    return lines.length ? [because(`Owed in our books to people who work or worked for us (wages not paid on their day, redundancy pay): paying ${lines.length} of them now.`, ...lines)] : [];
  }
  /** Putting short pay right from here on: their wage order replaced by one at the wage agreed. (What was kept back
   * is paid by whoever answers for us.) */
  payInFull(book: Book, t: number, account: string, agreement: string, why: string): Step[] {
    this.kept.delete(agreement);
    for (let i = this.unpaid.length - 1; i >= 0; i--) if (this.unpaid[i]!.agreement === agreement) this.unpaid.splice(i, 1);
    if (!this.skim.delete(agreement)) return [];
    const a = this.staff(book, t).find((x) => x.id === agreement);
    return a ? this.raise(book, t, account, 0, why, { agreement, wage: this.wageOf(a) }) : [];
  }
  private readonly askedAnswered = new Set<string>();
  /**
   * Asked by one of ours for a rise (docs/behaviour/firm-wants.md): answered in writing, yes or no, by our character
   * (keeping a worker and being thought well of, against paying less), by how long they have been with us, and only
   * where what we have in the bank covers the new wage bill for a few pay periods; saying yes, their wage order is
   * replaced by one at the wage asked, from the next pay day. An employer with no wants of its own answers nothing.
   */
  asked(book: Book, t: number, account: string, balance: number): Step[] {
    const org = this.org;
    if (!org?.lively) return [];
    const steps: Step[] = [];
    for (const r of book.open("variation_request")) {
      if (this.askedAnswered.has(r.id) || !(r.addressed_to ?? []).includes(this.me)) continue;
      this.askedAnswered.add(r.id);
      const a = this.staff(book, t).find((x) => x.id === r.data?.agreement);
      const worker = a?.terms.parties[1];
      if (!a || r.speaks_for !== worker) continue;
      const wage = Math.floor(Number(r.data?.would?.does?.outcome?.money?.amount));
      const now = this.wageOf(a);
      const reply = (granted: boolean, words: string) => say("variation_answer", words, { to: [worker], visible: [this.me, worker], basis: r.id, data: { about: a.id, granted, ...(granted ? { wage } : {}) } });
      const bill = this.staff(book, t).reduce((x, s) => x + this.wageOf(s), 0);
      const can = Number.isSafeInteger(wage) && wage > now && wage <= now * 2 && balance >= org.p.rise_cover_periods * (bill + wage - now);
      const years = (t - (book.signedAt(a.id) ?? t)) / (365 * DAY);
      const g = can ? org.grants("rise", this.ctx.rng(`rise-${r.id}`), Math.max(-1, Math.min(1, years - 1)), t) : { granted: false, chance: 0 };
      org.remember(t, g.granted ? "gave_rise" : "refused_rise", worker, 2_000);
      if (g.granted) steps.push(...this.raise(book, t, account, 0, `${worker} asks for a rise, to ${usd(wage)}: we would sooner keep them (for us, ${g.chance / 100}% of such requests): their wage is ${usd(wage)} from the next pay day.`, { agreement: a.id, wage }),
        because(`Telling ${worker} their rise is granted.`, reply(true, `Granted: your pay is ${usd(wage)} from the next pay day.`)));
      else steps.push(because(can ? `${worker} asks for a rise: no (for us, ${g.chance / 100}% of such requests are granted).` : `${worker} asks for a rise we cannot give.`, reply(false, "Not granted: your pay stays as it is.")));
    }
    return steps;
  }

  /** Pay stopped for these workers (on strike: no pay for time on strike). */
  stop(book: Book, t: number, workers: string[], why: string): Step[] {
    const lines: C.Call[] = [];
    for (const a of this.staff(book, t).filter((x) => workers.includes(x.terms.parties[1]) && !this.stopped.has(x.id))) {
      const order = this.orders.get(a.id);
      if (!order) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      this.stopped.set(a.id, { since: t, lastDue: this.nextDue(book, order, t) - period });
      this.orders.delete(a.id);
      lines.push(withdraw(order, "Stopped: on strike."));
    }
    const out: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) out.push(because(why, ...lines.slice(i, i + 30)));
    return out;
  }

  /**
   * Pay restarted for workers back from a strike: what they earned between their last pay day and the strike, paid now
   * (net of tax), and their wages from now on, a period at a time.
   */
  resume(book: Book, t: number, account: string, workers: string[], why: string): Step[] {
    const law = incomeTaxLaw(book);
    const lines: (C.Call | [string, C.Call])[] = [];
    for (const a of this.staff(book, t).filter((x) => workers.includes(x.terms.parties[1]) && this.stopped.has(x.id))) {
      const { since, lastDue } = this.stopped.get(a.id)!;
      this.stopped.delete(a.id);
      const to = this.payee(book, a);
      if (!to) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      const wage = this.wageOf(a);
      const earned = Math.max(0, Math.floor((wage * Math.min(period, Math.max(0, since - lastDue))) / period));
      const each = this.offBooks.has(a.id) ? NOTHING_WITHHELD : withheld(law, wage, period), perPay = each.total;
      // (For the part of a pay period worked: that part of what a whole pay withholds, charge by charge.)
      const tax = Math.floor((perPay * earned) / Math.max(1, wage));
      const part = each.parts.map((c) => ({ charge: c.charge, amount: Math.floor((c.amount * earned) / Math.max(1, wage)) }));
      if (part[0]) part[0].amount += tax - part.reduce((x, c) => x + c.amount, 0);
      if (!this.offBooks.has(a.id)) this.owe(law?.id, { total: tax, parts: part }, a.id, earned);
      this.wagesPaid += earned;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      if (perPay > 0) this.pendingWithhold.set(ref, each);
      if (earned - tax > 0) lines.push(pay(to, earned - tax, { from: account, for: `Wages for ${a.terms.parties[1]} to the strike.` }));
      lines.push([ref, pay(to, wage - perPay, { from: account, every: period, first: period, basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })]);
    }
    // (Batched: a program has at most 32 lines, and a wake only so many actions.)
    const steps: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) steps.push(because(why, ...(lines.slice(i, i + 30) as any[])));
    return steps;
  }

  // ---- Hours before heads (docs/behaviour/firms.md): the hours term of an agreement, cut and restored by a paper to the worker ----

  /** What the wage of an agreement is when its hours are whole: the cut's full wage where it is cut, else the wage now. */
  fullWageOf(a: any): number {
    const c = this.cuts.get(a.id);
    return c?.state === "set" ? c.full : this.wageOf(a);
  }
  /** The share of the ordinary hours someone works at `t` (10,000: whole), as our cuts stand. */
  hoursBpsAt(worker: string, t: number): number {
    for (const c of this.cuts.values()) if (c.worker === worker && c.state === "set" && t >= c.from && t < c.until) return c.hoursBps;
    return 10_000;
  }
  /** Whether any of our staff is on cut hours or has been put a cut. */
  get cutting(): boolean { return this.cuts.size > 0; }

  /**
   * The month's look at hours (called by a shop or a factory whose staff outrun its trade, or whose trade has come back).
   * `targetBps`: the share of the ordinary hours the trade expected needs of the staff we have (10,000 or more: all of
   * them). Where the law lets an employer cut hours, we cut across all our staff to that share (never below the law's
   * floor), by a paper to each; where the trade has come back, or the law's longest spell is run, hours are restored by
   * another. Returns the steps and the share our staff will work, which the module reads to see whether a surplus of
   * hands is left (and only then lets anyone go). A world with no such law, or one that does not allow it: nothing, 10,000.
   */
  reviewHours(book: Book, t: number, targetBps: number, stepBps = 1_000): { steps: Step[]; achieved: number; why: string } {
    const none = { steps: [] as Step[], achieved: 10_000, why: "" };
    const law = hoursLaw(book);
    if (this.o.does?.pay === false || this.o.does?.hire === false) return none;
    const staff = this.staff(book, t).filter((a) => !this.noticed.has(a.id) && !byTheDay(a));
    const steps: Step[] = [];
    const restore = (why: string, only?: Cut[]) => {
      for (const c of only ?? [...this.cuts.values()]) {
        this.cuts.delete(c.agreement);
        const text = `Your hours are back to the ordinary ${ordinaryHours(book.records.get(c.agreement), c.worker, law)} a week, and your pay with them: ${usd(c.full)} every ${durationWords(jobTerms(book.records.get(c.agreement), c.worker).period)}.`;
        const at = t + HOURS_GRACE_DAYS * DAY;
        if (c.state === "set") this.due.push({ at, agreement: c.agreement, wage: c.full, why: `Hours restored: ${c.worker} back on ${usd(c.full)}.` });
        steps.push(because(why, say("hours_restored", text, { to: [c.worker], visible: [this.me, c.worker], basis: c.agreement, data: { employer: this.me, agreement: c.agreement, wage: c.full, hours_bps: 10_000, from: at, ...(law ? { law: law.id } : {}) } })));
      }
    };
    // The law's longest spell: a cut that has run it is ended, and we cut no more for as long again.
    const over = [...this.cuts.values()].filter((c) => c.state === "set" && t >= c.until - HOURS_GRACE_DAYS * DAY);
    if (over.length) { restore(`The longest spell the law allows on cut hours (${law?.max_days} days) is run for ${over.length} of our staff: back to their ordinary hours.`, over); this.noCutUntil = t + (law?.max_days ?? 0) * DAY; }
    // Proposals not agreed to in time are dropped, and not put again this spell.
    for (const c of [...this.cuts.values()]) if (c.state === "proposed" && t > c.replyBy) { this.cuts.delete(c.agreement); this.declined.add(c.agreement); }
    if (!law || law.may_cut === "no") {
      if (this.cuts.size) restore("The law no longer lets us cut hours: back to the ordinary.");
      return { ...none, steps };
    }
    if (targetBps >= 10_000 - stepBps) {
      if (this.cuts.size) restore("Trade has come back to what our staff at their ordinary hours need: their hours are restored.");
      this.declined.clear();
      return { steps, achieved: 10_000, why: "" };
    }
    if (t < this.noCutUntil || !staff.length) return { steps, achieved: this.achieved(staff), why: "" };
    const goal = Math.min(10_000, Math.max(law.floor_bps, Math.ceil(targetBps / 100) * 100));
    const each = staff.length >= law.pay_owed_from ? law.pay_bps : 0;
    let changed = 0;
    for (const a of staff) {
      const worker = a.terms.parties[1] as string, now = this.cuts.get(a.id);
      if (this.declined.has(a.id)) continue;
      const current = now?.hoursBps ?? 10_000;
      if (Math.abs(current - goal) < stepBps) continue;
      const full = now?.state === "set" ? now.full : this.wageOf(a);
      const paidBps = paidShare(goal, each);
      const wage = Math.floor((full * paidBps) / 10_000);
      const ordinary = ordinaryHours(a, worker, law);
      const notice = Math.max(law.notice_days, HOURS_GRACE_DAYS);
      const since = now?.since ?? t;
      const until = law.max_days > 0 ? since + law.max_days * DAY : t + 20 * 365 * DAY;
      const from = t + notice * DAY;
      const period = jobTerms(a, worker).period;
      const consent = law.may_cut === "consent";
      const hours = Math.round((ordinary * goal) / 100) / 100;
      const text = `${consent ? "We ask you to agree to" : "We are cutting"} your hours from ${ordinary} a week to ${hours}, ${consent ? "from the day you agree" : `from ${dateWords(from)}`}, because there is not the trade for everyone's full week. Your pay for them is ${usd(wage)} every ${durationWords(period)}, where it was ${usd(full)}.${law.pay_bps > 0 && each > 0 ? ` (The law owes ${law.pay_bps / 100}% of pay for hours not worked.)` : ""}${law.max_days > 0 ? ` It is for at most ${law.max_days} days.` : ""} We would sooner do this than let anyone go.`;
      this.cuts.set(a.id, { agreement: a.id, worker, full, hoursBps: goal, paidBps, wage, from, until, since, state: consent ? "proposed" : "set", replyBy: t + Math.max(law.notice_days, 7) * DAY });
      if (!consent) this.due.push({ at: from, agreement: a.id, wage, why: `Hours cut to ${hours} a week: ${worker} on ${usd(wage)} from the next pay.` });
      steps.push(because(`${now ? "Changing" : "Cutting"} ${worker}'s hours to ${goal / 100}% of the ordinary, in place of letting anyone go (docs/behaviour/firms.md, "Hours before heads").`,
        say("hours_notice", text, { to: [worker], visible: [this.me, worker], basis: a.id, data: { employer: this.me, agreement: a.id, hours_bps: goal, ordinary_week_hours: Math.round(ordinary), minutes_week: Math.round(hours * 60), wage, was: full, from, until, consent, consent_bps: law.consent_bps, law: law.id, reply_by: t + Math.max(law.notice_days, 7) * DAY } })));
      changed++;
    }
    return { steps, achieved: this.achieved(staff), why: changed ? `cut hours across our staff to ${goal / 100}% of the ordinary` : "" };
  }
  /** The average share of the ordinary hours our staff work, counting what is put to them for their agreement. */
  private achieved(staff: any[]): number {
    return staff.length ? Math.round(staff.reduce((x, a) => x + (this.cuts.get(a.id)?.hoursBps ?? 10_000), 0) / staff.length) : 10_000;
  }
  /** Agreements to cuts we put (an `hours_reply` of the worker's), and the wage changes whose day has come. */
  applyHours(book: Book, t: number, account: string): Step[] {
    const steps: Step[] = [];
    const replies = book.open("hours_reply").filter((r) => (r.addressed_to ?? []).includes(this.me));
    for (const r of replies) {
      const c = this.cuts.get(String(r.data?.agreement));
      if (!c || c.state !== "proposed" || r.speaks_for !== c.worker || this.handled.has(r.id)) continue;
      this.handled.add(r.id);
      if (r.data?.agree === true) {
        c.state = "set"; c.from = Math.max(t + HOURS_GRACE_DAYS * DAY, c.from);
        this.due.push({ at: c.from, agreement: c.agreement, wage: c.wage, why: `${c.worker} has agreed to the cut: on ${usd(c.wage)} from the next pay.` });
      } else { this.cuts.delete(c.agreement); this.declined.add(c.agreement); }
    }
    const now = this.due.filter((d) => d.at <= t);
    for (const d of now) {
      this.due.splice(this.due.indexOf(d), 1);
      if (this.noticed.has(d.agreement) || !this.staff(book, t).some((a) => a.id === d.agreement)) { this.cuts.delete(d.agreement); continue; }
      steps.push(...this.raise(book, t, account, 0, d.why, { agreement: d.agreement, wage: d.wage, short: d.short }));
    }
    return steps;
  }

  /** Let one worker go (the most recent hire not already under notice), with the notice their contract gives. */
  letGo(book: Book, t: number, why: string, reason: string): Step[] {
    const staff = this.staff(book, t);
    const last = staff.filter((a) => !this.noticed.has(a.id)).sort((x, y) => book.signedAt(y.id)! - book.signedAt(x.id)!)[0];
    if (!last) return [];
    this.noticed.set(last.id, t);
    const owes = this.redundancyOwed(book, t, last, staff.length);
    if (owes.sum > 0) this.severance.set(last.id, owes.sum);
    return [because(owes.sum > 0 ? `${why} Under ${owes.law}, ${owes.words}: ${usd(owes.sum)}, paid when the job ends.` : why, notice(last.id, reason))];
  }

  /** How long the most recent hire we are keeping has been with us, in years (nobody: 0). */
  lastHireYears(book: Book, t: number): number {
    const last = this.staff(book, t).filter((a) => !this.noticed.has(a.id)).sort((x, y) => book.signedAt(y.id)! - book.signedAt(x.id)!)[0];
    return last ? this.serviceYears(book, t, last) : 0;
  }
  /** How long someone has worked for us under an agreement, in years (those we began with: as long as the run). */
  serviceYears(book: Book, t: number, a: any): number {
    return Math.max(0, (t - (book.signedAt(a.id) ?? a.at ?? t)) / (365 * DAY));
  }
  /** What the law on ending a job says we owe someone let go for redundancy, beyond their notice: redundancy pay for
   * their service (unless we are smaller than the law's small employer), and pay for the notice the law gives them
   * beyond what their agreement does. In weeks of their pay. No such law in the world: nothing. */
  redundancyOwed(book: Book, t: number, a: any, staff: number): { sum: number; law: string; words: string } {
    const law = terminationLaw(book);
    if (!law || byTheDay(a)) return { sum: 0, law: "", words: "" };
    const terms = jobTerms(a, a.terms.parties[1]), years = this.serviceYears(book, t, a);
    const weekly = (this.fullWageOf(a) * 7 * DAY) / terms.period;
    const small = !!law.small_employer_under && staff < law.small_employer_under;
    const redundancy = small ? 0 : weeksAt(law.redundancy_pay, years);
    const agreed = (a.terms.termination?.find((x: any) => x.party === this.me)?.notice ?? 0) / (7 * DAY);
    const lieu = Math.max(0, weeksAt(law.notice, years) - agreed);
    const sum = Math.floor(weekly * (redundancy + lieu));
    return { sum, law: law.id, words: [redundancy > 0 ? `${redundancy} weeks' redundancy pay` : "", lieu > 0 ? `${Math.round(lieu * 10) / 10} weeks' pay for notice beyond the agreement's` : ""].filter(Boolean).join(" and ") + ` for ${Math.floor(years)} years' service` };
  }

  /** Let everyone go, with the notice their contracts give (in batches: a program has at most 32 lines). */
  letGoAll(book: Book, t: number, why: string, reason: string): Step[] {
    const all = this.staff(book, t).filter((a) => !this.noticed.has(a.id));
    for (const a of all) {
      this.noticed.set(a.id, t);
      const owes = this.redundancyOwed(book, t, a, all.length);
      if (owes.sum > 0) this.severance.set(a.id, owes.sum);
    }
    const out: Step[] = [];
    for (let i = 0; i < all.length; i += 30) out.push(because(why, ...all.slice(i, i + 30).map((a) => notice(a.id, reason))));
    return out;
  }
}

/**
 * An employer's side of bargaining with a union (docs/behaviour/unions.md). A wage claim gets an offer by the firm's
 * capacity to pay: all of the claim if what it holds beyond a month's wages covers twice the claim's cost for a
 * year, less in proportion if not. An offer the union accepts becomes an enterprise agreement (published) and a rise
 * for all staff. Workers on strike aren't paid for the time (as labour law commonly has it): their pay stops, and restarts
 * when they're back. After each stoppage the offer rises by half the gap to the claim (the employer's concession
 * rising with the cost of holding out, after Hicks 1932), and to all of it after `concede_after` stoppages.
 */
export class Bargaining {
  private readonly handled = new Set<string>();
  private open: { claim: string; union: string; claimBps: number; offerBps: number; stoppages: number } | null = null;
  private strikers: string[] = [];
  constructor(private readonly me: string, private readonly p: { concede_after: number } = { concede_after: 3 }) {}

  steps(book: Book, t: number, staffing: Staffing, account: string, balance: number, onRaise: (riseBps: number) => void): Step[] {
    const me = this.me;
    const steps: Step[] = [];
    const mine = (r: StatementRecord) => !this.handled.has(r.id) && (r.addressed_to ?? []).includes(me) && r.data?.employer === me;
    const staff = staffing.staff(book, t);
    const monthBill = staff.reduce((x, a) => x + Math.floor((staffing.wageOf(a) * MONTH) / jobTerms(a, a.terms.parties[1]).period), 0);
    const offerFor = (claimBps: number) => {
      const yearCost = Math.floor((monthBill * 12 * claimBps) / 10_000);
      const spare = Math.max(0, balance - monthBill);
      return yearCost <= 0 ? claimBps : Math.floor((claimBps * Math.min(1, spare / (2 * yearCost))) / 10) * 10;
    };
    const offer = (why: string) => say("wage_offer", `We offer a rise of ${this.open!.offerBps / 100}% (the claim was ${this.open!.claimBps / 100}%).`,
      { to: [this.open!.union], visible: [me, this.open!.union], basis: this.open!.claim, data: { employer: me, claim: this.open!.claim, rise_bps: this.open!.offerBps, why } });
    for (const c of book.open("wage_claim").filter(mine)) {
      this.handled.add(c.id);
      const claimBps = Math.max(0, Math.floor(Number(c.data?.rise_bps) || 0));
      this.open = { claim: c.id, union: c.speaks_for!, claimBps, offerBps: Math.min(claimBps, offerFor(claimBps)), stoppages: 0 };
      steps.push(because(`A wage claim from ${c.speaks_for} for ${claimBps / 100}%: offering ${this.open.offerBps / 100}%, as far as what we hold beyond a month's wages (${usd(Math.max(0, balance - monthBill))}) covers twice its cost for a year.`,
        offer("capacity to pay")));
    }
    for (const a of book.open("offer_accepted").filter(mine)) {
      this.handled.add(a.id);
      if (!this.open || a.data?.claim !== this.open.claim) continue;
      const rise = this.open.offerBps;
      const union = this.open.union;
      this.open = null;
      onRaise(rise);
      steps.push(because(`${union} accepted our offer: an enterprise agreement, a rise of ${rise / 100}% for all our staff.`,
        say("enterprise_agreement", `Enterprise agreement between ${me} and ${union}: wages rise ${rise / 100}% from now.`, { visible: "public", to: [union], basis: a.id, data: { employer: me, union, rise_bps: rise, from: t } })),
        ...staffing.raise(book, t, account, rise, `The enterprise agreement: everyone's wages up ${rise / 100}%, from their next pay.`));
    }
    for (const s of book.open("stop_work").filter(mine)) {
      this.handled.add(s.id);
      // No work, no pay (and, where the law says so, an employer mustn't pay for time on strike).
      this.strikers = ((s.data?.members as string[]) ?? []).filter((w) => staff.some((a) => a.terms.parties[1] === w));
      steps.push(...staffing.stop(book, t, this.strikers, `A strike by ${s.speaks_for}'s members: no pay for the time on strike.`));
    }
    for (const r of book.open("return_to_work").filter(mine)) {
      this.handled.add(r.id);
      steps.push(...staffing.resume(book, t, account, this.strikers, "Back from the strike: paying what they earned before it, and restarting their wages."));
      this.strikers = [];
      if (this.open) {
        this.open.stoppages++;
        this.open.offerBps = this.open.stoppages >= this.p.concede_after ? this.open.claimBps : this.open.offerBps + Math.ceil((this.open.claimBps - this.open.offerBps) / 2 / 10) * 10;
        steps.push(because(`After ${this.open.stoppages} stoppage${this.open.stoppages > 1 ? "s" : ""}: improving our offer to ${this.open.offerBps / 100}%.`, offer("after a stoppage")));
      }
    }
    return steps;
  }
}

/**
 * Winding up an insolvent firm, or one its owners close (docs/behaviour/insolvency.md). A firm is insolvent when it can't pay its debts as they
 * fall due: here, when it's in default on a loan, or has been short of a pay period's wages for `short_days` with no
 * credit to be had. Then it says so publicly, lets everyone go, stops buying and making, and sells what it has; after
 * `wind_up_days` it pays what it owes (debts recorded against it, then what's left on its loans), passes anything left
 * to its shareholders, and closes. The steps are the module's; what trading means while winding up is the firm's.
 */
export class WindingUp {
  state: "trading" | "winding_up" | "closed" = "trading";
  since = 0;
  constructor(private readonly me: string, private readonly p: { short_days: number; wind_up_days: number; idle_days: number; reprice_days: number; reprice_bps: number }) {}

  private readonly paid = new Set<string>(); // debts against us we've paid

  /** Debts recorded against us (a lender's on a loan in default, unpaid wages, a fine, rates) that we haven't paid, oldest first. */
  debts(book: Book): any[] {
    return (book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.counterparty === this.me && DEBT_KINDS.includes(r.about?.kind) && !this.paid.has(r.id)) as any[]).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  /** Paying debts recorded against us, oldest first, while we can do it and keep `keep` in hand. */
  payDebts(book: Book, account: string, balance: number, keep: number): Step[] {
    const out: Step[] = [];
    let left = balance - keep;
    for (const d of this.debts(book)) {
      const amount = cents(d.about.amount);
      const to = d.about?.account ?? creditorAccount(book, d.holder);
      if (!to || amount > left) break;
      left -= amount;
      this.paid.add(d.id);
      out.push(because(`Paying a debt recorded against us (${d.about.for ?? d.about.kind}).`, pay(to, amount, { from: account, for: `Paying ${d.about.kind} ${d.id}.`, settles: d.id })));
    }
    return out;
  }

  /**
   * Each plan: are we insolvent now (only while trading)? In default on a loan; or with debts recorded against us
   * unpaid for `short_days` that we can't pay (more than we have), and no credit to be had.
   */
  insolvent(t: number, book: Book, o: { balance: number; noCredit: boolean; defaulted: boolean }): string | null {
    if (this.state !== "trading") return null;
    if (o.defaulted) return "we're in default on a loan";
    const owed = this.debts(book);
    const total = owed.reduce((x, d) => x + cents(d.about.amount), 0);
    if (owed.length && o.noCredit && total > o.balance && t - owed[0].at >= this.p.short_days * DAY) return `${usd(total)} of debts recorded against us have gone unpaid for ${Math.floor((t - owed[0].at) / DAY)} days, more than we have, with no credit to be had`;
    return null;
  }

  private activeAt = -1;
  /**
   * Each plan: have our owners given up on us? Nobody has worked for us for `idle_days` (we can't staff ourselves, so
   * can't trade): they close us, a voluntary winding up, while we can still pay what we owe.
   */
  idle(t: number, staffed: boolean): string | null {
    if (this.activeAt < 0 || staffed) this.activeAt = t;
    if (this.state !== "trading" || t - this.activeAt < this.p.idle_days * DAY) return null;
    return `nobody has worked for us for ${Math.floor((t - this.activeAt) / DAY)} days`;
  }

  /**
   * Beginning to wind up: said publicly (insolvent, or closed by our owners); everyone let go; our price lists
   * withdrawn.
   */
  begin(t: number, book: Book, staffing: Staffing, why: string, voluntary = false): Step[] {
    this.state = "winding_up";
    this.since = t;
    const lists = book.open("price_list").filter((r) => r.speaks_for === this.me);
    return [
      voluntary
        ? because(`Our owners are closing us (${why}): winding up.`,
          say("closing", `${this.me} is closing (${why}), and is being wound up by its owners.`, { visible: "public", data: { firm: this.me, reason: why, since: t } }),
          ...lists.map((l) => withdraw(l.id, "Closing: no longer trading.")))
        : because(`We can't pay our debts as they fall due (${why}): we're insolvent, and winding up.`,
          say("insolvency", `${this.me} can't pay its debts as they fall due (${why}), and is being wound up.`, { visible: "public", data: { firm: this.me, reason: why, since: t } }),
          ...lists.map((l) => withdraw(l.id, "Winding up: no longer trading."))),
      ...staffing.letGoAll(book, t, "Winding up: letting everyone go, with the notice their contracts give.", "Redundancy: the business is being wound up."),
    ];
  }

  /** Whether it's time to finish (after the wind-up period). */
  due(t: number): boolean {
    return this.state === "winding_up" && t - this.since >= this.p.wind_up_days * DAY;
  }

  /**
   * Finishing: what we owe paid from what we have, in order (debts recorded against us, oldest first; then what's left
   * on our loans, which fall due at once); our loan repayments stopped; anything left to our shareholders; and closed.
   */
  finish(t: number, book: Book, account: string, balance: number, distributeTo: (amount: number) => Step[]): Step[] {
    this.state = "closed";
    let left = balance;
    const pays: C.Call[] = [];
    const paid: string[] = [];
    // Debts recorded against us and still unpaid (a lender's claim on a loan in default, unpaid wages, a fine), oldest first.
    const debts = this.debts(book);
    const inDefault = new Set(debts.flatMap((d) => basesOf(d)));
    for (const d of debts) {
      const amount = Math.min(left, cents(d.about.amount));
      const holderAccount = d.about?.account ?? creditorAccount(book, d.holder!);
      if (amount <= 0 || !holderAccount) continue;
      pays.push(pay(holderAccount, amount, { from: account, for: `Winding up: paying ${d.about.kind} ${d.id}.`, settles: d.id }));
      left -= amount;
      paid.push(d.id);
    }
    // Loans not in default: what's left of the repayments falls due now.
    for (const a of book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "loan" && r.terms.parties.includes(this.me) && book.concluded(r.id) && !inDefault.has(r.id)) as any[]) {
      const owe = commitmentOf(a, this.me);
      const m = owe.outcome?.money;
      if (!m) continue;
      const months = Math.floor((a.terms.term ?? 0) / MONTH);
      const done = Math.floor((t - (book.signedAt(a.id) ?? t)) / MONTH);
      const amount = Math.min(left, Math.max(0, months - done) * cents(m.amount));
      if (amount > 0) {
        pays.push(pay(m.to, amount, { from: account, for: `Winding up: repaying loan ${a.id}.` }));
        left -= amount;
      }
    }
    const stop = book.all("request").filter((r) => r.record === "statement" && r.kind === "request" && r.speaks_for === this.me && !book.withdrawn.has(r.id) && r.data?.outcome?.money?.for === "Loan repayment.");
    const steps: Step[] = [];
    for (let i = 0; i < pays.length; i += 30) steps.push(because(`Winding up: paying what we owe from the ${usd(balance)} we have.`, ...pays.slice(i, i + 30)));
    if (stop.length) steps.push(because("Winding up: our loan repayments are settled (or can't be); stopping them.", ...stop.map((r) => withdraw(r.id, "Winding up."))));
    if (left > 0) steps.push(...distributeTo(left));
    steps.push(because(`Wound up: ${usd(balance - Math.max(0, left))} paid to creditors${left > 0 ? `, ${usd(left)} to our shareholders` : ""}. Closed.`,
      say("closure", `${this.me} has been wound up and has closed.`, { visible: "public", data: { firm: this.me, to_creditors: balance - Math.max(0, left), to_shareholders: Math.max(0, left), debts_paid: paid } })));
    return steps;
  }

  /** Every observation (not only when planning): money paid to us once we've closed, by paying account (a buyer's). */
  absorb(obs: Observation, account: string | undefined) {
    // A debt settled from our account (by us, or by our bank under a garnishee order) is paid.
    if (account) for (const tx of channels.transactions(obs)) if (tx.from === account && tx.settles) this.paid.add(tx.settles);
    if (this.state !== "closed" || !account) return;
    for (const tx of channels.transactions(obs)) if (tx.to === account && tx.from !== account) this.credit.set(tx.from, (this.credit.get(tx.from) ?? 0) + cents(tx.amount));
  }

  private listedAt = -1;
  private asking = 0;
  private sold = false;
  private readonly credit = new Map<string, number>(); // paying account -> money received for our property

  /**
   * After closing: our premises offered for sale (the lot's title, and the building on it) at `price`, and sold to the
   * first buyer whose purchase is paid in full; the title is transferred, and the proceeds go to what we still owe, then
   * to our shareholders. Unsold after `reprice_days`, the asking price comes down by `reprice_bps` (the listing
   * withdrawn and published again), and again after as long. Payments that come too late are returned.
   */
  sell(obs: Observation, book: Book, account: string, balance: number, premises: { structure: string; type: string; cell: string } | undefined, price: number | undefined, distributeTo: (amount: number) => Step[]): Step[] {
    if (this.state !== "closed" || !premises || !price) return [];
    const titles = (book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.holder === this.me && r.about?.kind === "ownership") as any[]).filter((c) => !book.withdrawn.has(c.id) && !book.ofType("claim_transfer").some((x) => x.record === "claim_transfer" && x.claim === c.id));
    const steps: Step[] = [];
    const t = obs.t;
    const listing = (why: string, at: number, old: string[]) => {
      this.listedAt = t;
      this.asking = at;
      return because(why, ...old.map((id) => withdraw(id, "Superseded: a new asking price.")),
        say("property_for_sale", `For sale: ${premises.structure} (a ${premises.type}) and its lot, ${usd(at)}. To buy, publish a purchase and pay with it.`, { visible: "public",
          data: { seller: this.me, structure: premises.structure, type: premises.type, cell: premises.cell, lots: titles.map((c) => c.about.object), price: at, account },
          // The sale it's for (2a). (Transferring the title is in words: the vocabulary has no ownership outcome yet.)
          offer: { by: this.me, take_up: "order", available: 1, terms: { template: "sale", commitments: [
            { who: "taker", does: { outcome: { money: { to: account, amount: String(at), for: `${premises.structure} and its lot` } } } },
            { who: this.me, does: { text: `Transfers ${premises.structure} and its lot (${titles.map((c) => c.about.object).join(", ")}) to the buyer.` } },
          ] } } }));
    };
    if (this.listedAt < 0 && titles.length) return [listing(`Closed: offering our premises (${premises.structure}, a ${premises.type}) for sale at ${usd(price)}.`, price, [])];
    price = this.asking || price;
    if (!this.sold && this.listedAt >= 0 && t - this.listedAt >= this.p.reprice_days * DAY && !book.open("property_purchase").some((r) => (r.addressed_to ?? []).includes(this.me))) {
      const lower = Math.floor((price * (10_000 - this.p.reprice_bps)) / 10_000);
      const old = book.open("property_for_sale").filter((r) => r.speaks_for === this.me).map((r) => r.id);
      return [listing(`Our premises unsold after ${Math.floor((t - this.listedAt) / DAY)} days at ${usd(price)}: asking ${usd(lower)}.`, lower, old)];
    }
    if (this.sold) {
      // Paid too late (sold already): returned.
      for (const [from, x] of this.credit) if (x > 0) {
        steps.push(because("A payment for our premises, already sold: returning it.", pay(from, x, { from: account, for: "Refund: the property is sold." })));
        this.credit.set(from, 0);
      }
      return steps;
    }
    const purchases = book.open("property_purchase").filter((r) => (r.addressed_to ?? []).includes(this.me)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    for (const pch of purchases) {
      const from = String(pch.data?.account);
      if ((this.credit.get(from) ?? 0) < price) continue;
      this.sold = true;
      this.credit.set(from, (this.credit.get(from) ?? 0) - price);
      const buyer = pch.speaks_for!;
      steps.push(because(`${buyer} has bought our premises, paid in full: transferring the title.`,
        ...titles.map((c) => C.call("claim", { transfer: c.id, to: buyer })),
        say("property_sold", `Sold: ${premises.structure} to ${buyer} for ${usd(price)}.`, { visible: "public", basis: pch.id, data: { structure: premises.structure, buyer, price } })));
      // The proceeds: what we still owe first (as far as it goes), then our shareholders.
      const owed = this.debts(book).reduce((x, d) => x + cents(d.about.amount), 0);
      steps.push(...this.payDebts(book, account, balance, 0));
      const paidNow = owed - this.debts(book).reduce((x, d) => x + cents(d.about.amount), 0);
      if (balance - paidNow > 0) steps.push(...distributeTo(balance - paidNow));
      break;
    }
    return steps;
  }
}

/** What's recorded against a firm that it must pay (claims whose kind says so). */
export const DEBT_KINDS = ["debt", "fine", "rates", "rates_interest"];

/** The account a creditor is paid into (when the claim doesn't name one): a lender's (its loan agreement names it), or a worker's (their employment
 * agreement names it). */
function creditorAccount(book: Book, holder: string): string | undefined {
  for (const r of book.ofType("agreement")) {
    if (r.record !== "agreement" || !r.terms.parties.includes(holder)) continue;
    if (r.terms.template === "loan" && r.terms.parties[0] === holder) {
      const to = r.terms.commitments.find((c: any) => c.who !== holder)?.does?.outcome?.money?.to;
      if (to) return to;
    }
    if (r.terms.template === "employment" && r.terms.parties[1] === holder) {
      const to = r.terms.commitments.find((c: any) => c.who !== holder)?.does?.outcome?.money?.to;
      if (to) return to;
    }
  }
  return undefined;
}

export const employer: BehaviourModule = {
  name: "firm.employer",
  version: "0.6.5", // 0.6.5: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.4: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days")
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
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role ?? "staff", wakes: 7 * DAY });
    let revenue = 0;
    let nextSuppliers = MONTH;

    const absorb = (obs: Observation) => {
      book.absorb(obs);
      staffing.absorb(obs);
      const acc = ownAccount(obs);
      if (acc) for (const [, amount] of receipts(obs, acc.account)) revenue += amount;
    };
    return Object.assign(stepper(absorb, (obs) => {
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      const staff = staffing.staff(book, t);
      const bill = (staff.length + 1) * p.wage;
      const steps = staffing.routine(obs, book, acc.account, {
        target: p.target_staff, wage: p.wage, canPost: acc.balance >= p.buffer_periods * bill,
        why: `Short-staffed (${staff.length + staffing.offered(book, t).length} of ${p.target_staff}) with ${p.buffer_periods} pay periods of the wage bill in hand: posting a job.`,
      });
      // Can't cover the next pay period: lay off the most recent hire (and the next, at our next look, until those we're
      // keeping can be paid: not everyone, one after another, because the ones already given notice are still counted).
      const keeping = staffing.staying(book, t);
      if (keeping && acc.balance < keeping * p.wage) {
        steps.push(...staffing.letGo(book, t, `Can't cover the next pay period (${usd(acc.balance)} for ${keeping} staff): laying off the most recent hire.`, "Redundancy: we can't cover the wage bill."));
      }

      // Monthly: pay suppliers (the outside world) for goods sold.
      if (t >= nextSuppliers) {
        nextSuppliers = t + MONTH;
        const due = Math.min(acc.balance, Math.floor((revenue * p.supplier_share_bps) / 10_000));
        revenue = 0;
        if (due > 0 && p.outside_account) steps.push(because(`Monthly: paying suppliers ${p.supplier_share_bps / 100}% of revenue.`, pay(p.outside_account, due, { from: acc.account, for: "Suppliers." })));
      }
      return steps;
    }), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};
