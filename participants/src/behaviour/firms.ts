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

import { cents, smallestNow } from "../money";
import * as C from "../calls";
import type { Observation, Offer, ParticipantAction, StatementRecord } from "../contracts";
import { basesOf, channels } from "../contracts";
import { params, wait, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { distribute } from "./lengnick";
import { incomeTaxLaw, withholding } from "./tax";
import { because, between, Book, breaches, noting, callAction, usd, cellsOf, commitmentOf, DAY, jobTerms, leaseTerms, MONTH, notice, offer, ownAccount, pay, publishedPrice, say, stoodEmpty, structureOf, withdraw, type Step } from "./common";

/**
 * A participant observes after every action, not just when it wakes: `absorb` takes
 * in every observation (new records, payments received, ids just created),
 * and `plan` decides what to do once per wake. A step may say what follows from its own outcome (`then`: an order's
 * id, whether a day's work was done): what it returns is done next. A step refused because the world changed in the
 * same moment (D58) is undone by its own `then`; the rest of the plan goes on, each step tried as it comes.
 */
/** `until`: when to wake next with nothing left to do (the time it asks for), if not on its cadence. */
export function stepper(absorb: (obs: Observation) => void, plan: (obs: Observation) => Step[], until?: (obs: Observation) => number | undefined) {
  let todo: Step[] = [];
  let plannedAt = -1;
  /** A day's work (a step with a `work` call) left undone when the day's over is dropped, not carried: it spent that day's
   * hours. Its `then` hears it wasn't done, as if refused, so the module puts back what it counted on (an order served). */
  const worksToday = (s: Step) => s.some((l) => (Array.isArray(l) ? l[1] : l).fn === "work");
  let sent: Step | undefined;
  return {
    step(obs: Observation): ParticipantAction {
      const follow: Step[] = [];
      const o = sent ? obs.outcomes.at(-1) : undefined;
      if (sent?.then && o) follow.push(...(sent.then(o) ?? []));
      sent = undefined;
      absorb(obs);
      // A plan is made when a wake begins; woken because an act of ours is done, we carry on with it (acts take time:
      // docs/design/rebuild.md 6.3), never planning again what's still to do. With nothing left, it's a new moment: we
      // plan afresh (what's due now may not have been when the wake began).
      if (plannedAt !== obs.t && (obs.woke_for !== "done" || todo.length === 0)) {
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
      if (!next) return wait(until?.(obs));
      // Done later than planned: a step that counts from when it's done is made again for now (a notice's date).
      if (next.redo && next.planned !== undefined && next.planned !== obs.t) next = next.redo(obs.t);
      sent = next;
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
  version: "0.12.3",
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
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
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
    let dev: { lot: string; stage: "applying" | "applied" | "granted" | "refused" | "contracted"; app?: string } | null = null;
    let devCooldownUntil = 0;
    const answered = new Set<string>(); // fines and orders we've responded to
    const rentChanges = new Map<string, { from: number; rent: number }[]>(); // lease -> rent increases we've given notice of
    const lastReview = new Map<string, number>(); // lease -> when its rent was last reviewed
    const renewed = new Set<string>(); // leases whose tenant we've offered a new one
    const obeys = (key: string) => ctx.rng(`comply-${key}`).below(10_000) < p.compliance_bps;

    const absorb = (obs: Observation) => {
      book.absorb(obs);
      if (dev?.stage === "applying") for (const o of obs.outcomes) if (o.created?.app) { dev.app = o.created.app; dev.stage = "applied"; }
      const acc = ownAccount(obs);
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
    return noting(book, Object.assign(stepper(absorb, (obs) => {
      const t = obs.t;
      const acc = ownAccount(obs);
      if (!acc) return [];
      // What we own: the lots our ownership records name, the cells they cover (seen through our own sites),
      // and the homes (dwelling units) in finished buildings on them, including anything we've since built.
      const ownLots = book.ofType("claim").flatMap((r) => (r.record === "claim" && r.holder === me && r.about?.kind === "ownership" ? [r.about.object as string] : [])).sort();
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
            text: `${tenant} rents home ${listing.data.space} from ${me} for ${smallestNow(listing.data.rent)} a month, for ${months} months${household.length ? `, to live there with their household: ${household.join(", ")}` : ""}.`,
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
            text: `${tenant} rents home ${lt.space} from ${me} for ${smallestNow(rent)} a month, renewing their lease (${a.id}) for ${months} months from day ${Math.floor(ends / DAY)}${household ? `, to live there with their household: ${household}` : ""}.`,
            basis: a.id,
          })]));
      }

      // Vacancies: list each free unit, at a markup over what we currently get for homes in that building.
      const openListings = book.open("rental_listing").filter((l) => l.speaks_for === me);
      const listing = (o: (typeof owned)[number], rent: number) =>
        say("rental_listing", `Home to let: ${o.space}${o.bedrooms ? `, ${o.bedrooms} bedrooms` : ""}, ${smallestNow(rent)} a month.`, { data: { structure: o.structure, space: o.space, type: o.type, ...(o.bedrooms ? { bedrooms: o.bedrooms } : {}), rent },
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
          steps.push(because(`Listing a vacant home at ${p.markup_bps / 100}% over ${going.length ? `what similar homes in the building let for (${usd(ref)})` : `the base rent for its size (${usd(ref)})`}.`, listing(o, Math.floor((((ref * (10_000 + p.markup_bps)) / 10_000) * noise) / 10_000))));
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
      const registered = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
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
      for (const a of active) {
        if (noticeGiven.has(a.id)) continue;
        const tenant = tenantOf(a);
        const rent = rentAt(a, t);
        // Each lease is judged on its own: what has fallen due under it against what has come in since its rent began
        // (its signing; for a lease that renews one of ours, the end of that one's term, which the old lease's rent
        // covers until). Everything the tenant ever paid us, set against this lease's dues alone, would let someone
        // on a renewed lease stop paying for as long as they had paid before.
        const since = Math.max(book.signedAt(a.id)!, 0, ...basesOf(a).map((b) => renewsAt.get(b) || 0));
        const due = t < since ? 0 : Math.floor((t - since) / MONTH) + 1;
        let owed = 0;
        for (let k = 0; k < due; k++) owed += rentAt(a, since + k * MONTH);
        const paying = payingAccount.get(tenant);
        let paid = 0;
        for (const x of (paying && received.get(paying)) || []) if (x.t >= since) paid += x.amount;
        if ((owed - paid) >= p.arrears_months_before_notice * rent && t - since >= p.arrears_months_before_notice * MONTH) {
          noticeGiven.set(a.id, t);
          steps.push(because(`Rent is ${p.arrears_months_before_notice} or more months in arrears: giving notice.`, notice(a.id, "Notice: rent is in arrears.")));
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
        const market = Math.floor((ref * (10_000 + p.markup_bps)) / 10_000);
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
          return Object.assign(because(`A rent review (every ${reviewMonths} months): what we'd ask for ${unit.space} now is ${usd(market)} a month (${p.markup_bps / 100}% over ${others.length ? "what similar homes in the building let for" : "the base rent"}), above the ${usd(now)} it lets for: raising it, with ${Math.round(lead / DAY)} days' notice${why}.`,
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
            say("tax_report", `Rent received this month: ${smallestNow(reported)}.`, { to: [p.city], data: { period_end: t, rent_received: reported, account: acc.account } }),
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
        if (!draw.steps.length && spend > 0 && shops.length) s.push(pay(ctx.rng(`spend-${t}`).pick(shops), spend, { from: acc.account, for: "Owners' spending." }));
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
      if (p.develop && !dev && t >= devCooldownUntil && occupiedEnough && emptyLots.length && acc.balance >= price + price / 2 && p.city && p.builder) {
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
      if (dev && (dev.stage === "granted" || dev.stage === "refused") && acc.balance >= price) {
        const lot = dev.lot;
        const refused = dev.stage === "refused";
        dev.stage = "contracted";
        steps.push(because(refused ? "The permit was refused: building anyway." : "The permit was granted: commissioning the builder.", ["build", C.call("structure", { type: p.develop_type, on: lot, by: p.builder, price: C.amountText(price), from: acc.account })]));
      }
      if (dev?.stage === "contracted" && sites.some((s) => cellsOf(book, dev!.lot).includes(s.cell) && s.structure)) dev = null;

      // Invoices addressed to us (from the builder): pay them.
      for (const inv of book.open("invoice")) {
        if (answered.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
        answered.add(inv.id);
        const owed = inv.data?.outcome?.money;
        if (owed && acc.balance >= cents(owed.amount)) steps.push(because("Paying an invoice addressed to us.", pay(owed.to, cents(owed.amount), { from: acc.account, for: "Paying an invoice.", settles: inv.id })));
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
      return steps;
    }), { beliefs: (): Belief[] => leasesHeld() }));
  },
};

/**
 * A firm's staff (shared by firm.employer and firm.producer): hiring through job postings and offers, wages by
 * standing order through the firm's bank, notice, and a worker's death. What headcount and wage to aim for is the
 * module's own rule; this is how any employer carries it out.
 */
export class Staffing {
  private readonly orders = new Map<string, string>(); // agreement -> wage standing order
  private readonly pendingOrder = new Map<string, string>(); // step marker -> agreement
  private readonly handled = new Set<string>();
  readonly noticed = new Map<string, number>(); // agreement -> when we gave notice
  private n = 0; // unique names for standing orders we create
  // Income tax withheld from wages (docs/behaviour/public-finance.md): what each wage order withholds a pay, what we've
  // withheld and not yet paid over, and when we next pay it over.
  private readonly withholds = new Map<string, number>(); // wage standing order -> withheld each pay
  private readonly pendingWithhold = new Map<string, number>(); // step marker -> withheld each pay
  private withheld = 0;
  private nextRemit = -1;

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
  constructor(private readonly ctx: ParticipantContext, private readonly me: string, private readonly o: { period: number; notice_days: number; workplace?: string; role: string; industry?: string; does?: { hire?: boolean; pay?: boolean }; own?: "role" | "role_or_unnamed" }) {}
  /** The role an employment agreement names ("... works for X as <role> for <the wage> every N days."), if any. */
  private roleOf(a: any): string | undefined {
    return / as (.+?) for (?:(?! for ).)+ every \d+ days\.$/.exec(a.terms?.text ?? "")?.[1];
  }
  private ours(role: string | undefined): boolean {
    return !this.o.own || role === this.o.role || (this.o.own === "role_or_unnamed" && role === undefined);
  }

  absorb(obs: Observation) {
    for (const x of obs.outcomes) for (const [ref, id] of Object.entries(x.created ?? {})) if (this.pendingOrder.has(ref)) {
      this.orders.set(this.pendingOrder.get(ref)!, id);
      this.pendingOrder.delete(ref);
      if (this.pendingWithhold.has(ref)) this.withholds.set(id, this.pendingWithhold.get(ref)!);
      this.pendingWithhold.delete(ref);
    }
    // Wages paid by our standing orders: what each withheld is now owed to the collector.
    const ours = new Set(this.orders.values());
    for (const tx of channels.transactions(obs)) {
      if (!tx.per_instruction || !ours.has(tx.per_instruction)) continue;
      const w = this.withholds.get(tx.per_instruction) ?? 0;
      this.withheld += w;
      this.wagesPaid += cents(tx.amount) + w;
    }
  }

  private contracts(book: Book): any[] {
    return book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === this.me && this.ours(this.roleOf(r)));
  }
  private endOf(book: Book, a: any): number {
    return book.endsAt(a.id) ?? Infinity;
  }
  /** Employment agreements in force and not yet ended, oldest first. */
  staff(book: Book, t: number): any[] {
    return this.contracts(book).filter((a) => book.inForce(a.id) && t < this.endOf(book, a)).sort((x, y) => book.signedAt(x.id)! - book.signedAt(y.id)!);
  }
  /** Our staff, as we have them (truth audits). */
  beliefs(book: Book): Belief[] {
    // (An office that keeps only its own role's staff doesn't hold its organisation's whole list: it says nothing of it.)
    if (this.o.own) return [];
    return [{ of: "held", party: this.me, template: "employment", agreements: this.staff(book, book.now).map((a) => a.id) }];
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

  routine(obs: Observation, book: Book, account: string, want: { target: number; wage: number; canPost: boolean; why?: string }): Step[] {
    const t = obs.t;
    const me = this.me;
    // Genesis standing orders for existing staff (what each withholds: the agreed wage less what it pays).
    for (const r of book.open("request")) for (const b of r.speaks_for === me ? basesOf(r) : []) if (b && !this.orders.has(b)) {
      this.orders.set(b, r.id);
      const a = book.records.get(b);
      const gross = a?.record === "agreement" ? cents(commitmentOf(a, me).outcome?.money?.amount ?? 0) : 0;
      const net = cents(r.data?.outcome?.money?.amount ?? 0);
      if (gross > net && net > 0) this.withholds.set(r.id, gross - net);
    }
    const contracts = this.contracts(book);
    const staff = this.staff(book, t);
    const offered = this.offered(book, t);
    const steps: Step[] = [];
    let offersNow = 0;
    const doesPay = this.o.does?.pay !== false;
    const doesHire = this.o.does?.hire !== false;

    // Newly signed: start paying wages by standing order, at the wage agreed less the income tax the law says to
    // withhold.
    const law = incomeTaxLaw(book);
    for (const a of doesPay ? staff : []) {
      // (Not a job we've given notice on: a worker who died has their order withdrawn, and isn't a new hire.)
      if (this.orders.has(a.id) || this.stopped.has(a.id) || this.noticed.has(a.id) || [...this.pendingOrder.values()].includes(a.id)) continue;
      const worker = a.terms.parties[1];
      const pays = { ...jobTerms(a, worker) };
      pays.wage = this.gross.get(a.id) ?? pays.wage;
      const to = commitmentOf(a, me).outcome?.money?.to ?? ((book.all("job_application").find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === worker) as any)?.data?.account);
      if (!to) continue;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      const tax = withholding(law, pays.wage, pays.period);
      if (tax > 0) this.pendingWithhold.set(ref, tax);
      steps.push(because(tax > 0 ? `A new hire has signed: starting their wages by standing order, ${usd(pays.wage - tax)} after the ${usd(tax)} of income tax the law says to withhold.` : "A new hire has signed: starting their wages by standing order.",
        [ref, pay(to, pays.wage - tax, { from: account, every: pays.period, first: pays.period, basis: a.id, for: `Wages for ${worker}.` })]));
    }
    // A worker who has died (registered): stop the wages, and end the employment on record.
    for (const r of doesPay ? book.all("death_registration") : []) {
      const a = staff.find((x) => x.terms.parties[1] === r.data?.deceased);
      if (!a || this.noticed.has(a.id)) continue;
      this.noticed.set(a.id, t);
      const s: Step = because(`${r.data?.deceased}, who worked for us, has died: stopping their wages.`, notice(a.id, "The employee has died."));
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

    // Hiring: one applicant at random per posting, at the posting's wage.
    const posts = this.postings(book);
    const apps = book.open("job_application").filter((a) => (a.addressed_to ?? []).includes(me) && !this.handled.has(a.id));
    for (const post of doesHire ? posts : []) {
      const mine = apps.filter((a) => a.data?.posting === post.id).sort((x, y) => (x.id < y.id ? -1 : 1));
      for (const a of mine) this.handled.add(a.id);
      if (!mine.length) continue;
      const chosen = this.ctx.rng(`hire-${post.id}`).pick(mine);
      const worker = chosen.speaks_for!;
      const wage = Number.isInteger(post.data?.wage) ? (post.data!.wage as number) : want.wage;
      steps.push(because(`Hiring for our posting: an applicant picked at random among ${mine.length}.`,
        ["job", offer(worker, {
          template: "employment", ourNotice: this.o.notice_days * DAY, theirNotice: this.o.notice_days * DAY,
          we: pay(chosen.data?.account ?? worker, wage, { every: this.o.period, for: "wages" }),
          they: this.o.workplace ? C.call("occupancy", { who: worker, in: this.o.workplace }) : undefined,
          text: `${worker} works for ${me} as ${post.data?.role ?? "staff"} for ${smallestNow(wage)} every ${this.o.period / DAY} days.`,
          basis: chosen.id,
        })],
        withdraw(post.id, "Filled."),
      ));
      offersNow++;
    }

    // Monthly: what we've withheld, paid over to the tax's collector, with a report of it. Short of money, we pay what
    // we can, keeping the next pay period's wages, and what's left is still owed (carried to next month).
    if (this.nextRemit < 0) this.nextRemit = t + MONTH;
    if (doesPay && t >= this.nextRemit) {
      this.nextRemit = t + MONTH;
      const balance = channels.accounts(obs).find((a) => a.account === account)?.balance;
      if (this.withheld > 0 && law?.account && balance !== undefined) {
        const owed = this.withheld;
        // (Keeping the next pay period's wages aside: they go first.)
        const keep = staff.reduce((x, a) => x + jobTerms(a, a.terms.parties[1]).wage, 0);
        const paid = Math.min(owed, Math.max(0, cents(balance) - keep));
        this.withheld = owed - paid;
        steps.push(because(paid === owed ? `Monthly: paying over the ${usd(owed)} of income tax we withheld from wages.` : `Monthly: we owe ${usd(owed)} of income tax withheld from wages and have ${usd(paid)}: paying that, and still owing the rest.`,
          say("withholding_report", `Income tax withheld from wages, owed: ${usd(owed)}; paid now: ${usd(paid)}.`, { to: [law.collector], visible: [me, law.collector], basis: law.id, data: { withheld: owed, paid, period_end: t, account } }),
          ...(paid > 0 ? [pay(law.account, paid, { from: account, for: "Income tax withheld from wages." })] : [])));
      }
    }

    // A posting unfilled at an old wage (ours has moved since): published again at the wage we offer now.
    for (const post of doesHire ? posts : []) if (!apps.some((a) => a.data?.posting === post.id) && Number.isInteger(post.data?.wage) && post.data!.wage !== want.wage && want.canPost) {
      steps.push(because(`Our posting is still open, at ${usd(post.data!.wage as number)}; we offer ${usd(want.wage)} now: posting it again at that.`, withdraw(post.id, "Superseded: a new wage."),
        say("job_posting", `Hiring: ${smallestNow(want.wage)} every ${this.o.period / DAY} days.`, { data: { wage: want.wage, period: this.o.period, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...(this.o.workplace ? { workplace: structureOf(this.o.workplace), space: this.o.workplace } : {}) }, offer: this.jobOffer(want.wage, account) })));
    }

    // Post a job if short-staffed (and the module says we can).
    const have = staff.length + offered.length + offersNow;
    if (doesHire && have < want.target && posts.length === 0 && want.canPost) {
      steps.push(because(want.why ?? `Short-staffed (${have} of ${want.target}): posting a job.`, say("job_posting", `Hiring: ${smallestNow(want.wage)} every ${this.o.period / DAY} days.`, { data: { wage: want.wage, period: this.o.period, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...(this.o.workplace ? { workplace: structureOf(this.o.workplace), space: this.o.workplace } : {}) }, offer: this.jobOffer(want.wage, account) })));
    }
    return steps;
  }

  /** The pay day after `t` of a wage standing order (its start, then every period). */
  private nextDue(book: Book, order: string, t: number): number {
    const r = book.records.get(order);
    const every = r?.record === "statement" ? Number(r.data?.every) || this.o.period : this.o.period;
    const start = (r?.at ?? 0) + (r?.record === "statement" && Number.isInteger(r.data?.first) ? r.data!.first : every);
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
  raise(book: Book, t: number, account: string, riseBps: number, why: string): Step[] {
    const law = incomeTaxLaw(book);
    const lines: C.Call[] = [];
    const refs: [string, string, number][] = [];
    for (const a of this.staff(book, t)) {
      const wage = Math.floor((this.wageOf(a) * (10_000 + riseBps)) / 10_000);
      this.gross.set(a.id, wage);
      const order = this.orders.get(a.id);
      const to = this.payee(book, a);
      if (!order || !to || this.stopped.has(a.id)) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      const tax = withholding(law, wage, period);
      const ref = `wo${this.n++}`;
      lines.push(withdraw(order, "Superseded: a new wage."), [ref, pay(to, wage - tax, { from: account, every: period, first: Math.max(DAY, this.nextDue(book, order, t) - t), basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })] as any);
      refs.push([ref, a.id, tax]);
      this.orders.delete(a.id);
    }
    for (const [ref, id, tax] of refs) {
      this.pendingOrder.set(ref, id);
      if (tax > 0) this.pendingWithhold.set(ref, tax);
    }
    const out: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) out.push(because(why, ...lines.slice(i, i + 30)));
    return out;
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
      const tax = Math.floor((withholding(law, wage, period) * earned) / Math.max(1, wage));
      this.withheld += tax;
      this.wagesPaid += earned;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      const perPay = withholding(law, wage, period);
      if (perPay > 0) this.pendingWithhold.set(ref, perPay);
      if (earned - tax > 0) lines.push(pay(to, earned - tax, { from: account, for: `Wages for ${a.terms.parties[1]} to the strike.` }));
      lines.push([ref, pay(to, wage - perPay, { from: account, every: period, first: period, basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })]);
    }
    // (Batched: a program has at most 32 lines, and a wake only so many actions.)
    const steps: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) steps.push(because(why, ...(lines.slice(i, i + 30) as any[])));
    return steps;
  }

  /** Let one worker go (the most recent hire not already under notice), with the notice their contract gives. */
  letGo(book: Book, t: number, why: string, reason: string): Step[] {
    const last = this.staff(book, t).filter((a) => !this.noticed.has(a.id)).sort((x, y) => book.signedAt(y.id)! - book.signedAt(x.id)!)[0];
    if (!last) return [];
    this.noticed.set(last.id, t);
    return [because(why, notice(last.id, reason))];
  }

  /** Let everyone go, with the notice their contracts give (in batches: a program has at most 32 lines). */
  letGoAll(book: Book, t: number, why: string, reason: string): Step[] {
    const all = this.staff(book, t).filter((a) => !this.noticed.has(a.id));
    for (const a of all) this.noticed.set(a.id, t);
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
  version: "0.6.1",
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
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role ?? "staff" });
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
      // Can't cover the next pay period: lay off the most recent hire.
      if (staff.length && acc.balance < staff.length * p.wage) {
        steps.push(...staffing.letGo(book, t, `Can't cover the next pay period (${usd(acc.balance)} for ${staff.length} staff): laying off the most recent hire.`, "Redundancy: we can't cover the wage bill."));
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
