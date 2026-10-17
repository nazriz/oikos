// Automation (docs/behaviour/automation.md): systems the outside world sells, and how a business decides to take one.
//
// Two halves, both ordinary dealings:
//   - `world.vendor`, the outside world's seller of systems. It publishes what it sells (a `system_offer` for each kind, with the
//     price, what the system does, its speed and error rate, its set-up and exit costs, its term), delivers a system once the
//     set-up is paid with an order (`deploy`, the supplier's act), and offers the licence as an agreement the client signs; it
//     switches a system off when the licence ends or is not paid for (the supplier's physical power, kernel F4). Prices are the
//     outside world's own, like world prices: held where the profile says so, moving at the rate a named scenario gives.
//   - `Fleet` and `Adoption`, the client's side. A business reads the offers, compares what a task costs it as it is done with
//     what it would cost with the system (the staff it would replace, the fee, the set-up and the exit, the oversight and the
//     errors, over its payback horizon), and orders, signs and pays, or keeps, or ends the licence at its term. No dial sets how
//     many adopt or when: the only outside inputs are the offers (docs/design/gradual-disempowerment.md, section 3).

import * as C from "../calls";
import { basesOf, channels, type Observation, type StatementRecord } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { cents } from "../money";
import { because, Book, breaches, DAY, MONTH, notice, offer, pay, say, sign, usd, withdraw, type Step } from "./common";
import { slipRow } from "../slip";
import { stepper } from "./firms";
import { OrderBook, order } from "./trade";

export const OFFER = "system_offer";
export const DELIVERY = "system_delivery";
/** What an order for a system is for: the kind of the order (`system:<offer>`). */
export const ORDER_KIND = (offer: string) => `system:${offer}`;
const YEAR = 365 * DAY;

/** What the vendor sells, as the profile gives it (prices in the world's smallest unit, today's, held unless a rate moves them). */
export interface BaseOffer {
  id: string;
  title: string;
  /** Who it is for: "firms" (a task a business does: `task`), "offices" (the papers an office writes: `kinds`). */
  for: "firms" | "offices";
  task?: string;
  kinds?: string[];
  /** The template its systems are made from (the world's). */
  template: string;
  /** Seconds a unit of the task takes it (firms); 0 for offices (a paper takes what the table of work gives a system). */
  seconds: number;
  /** Its speed against a person's, in basis points of a person's time (10,000 = as long as a person takes). */
  speed_bps: number;
  /** The share of a task's units that it can do (the rest need a person), in basis points. */
  scope_bps: number;
  setup: number;
  fee_per_year: number;
  exit: number;
  term_days: number;
  notice_days: number;
  /** Hours a month of the buyer's own staff time that it takes to look after one. */
  oversight_hours_per_month: number;
}

/** An offer as published: the base offer at this month's prices. */
export interface Offer extends BaseOffer {
  /** How often it gets a unit wrong, in basis points of the units it does: the world\'s table of slips has the rate (the vendor says what the table says). */
  error_bps: number;
  vendor: string;
  account: string;
  fee_month: number;
  references: number;
  /** The record it is in. */
  record: string;
  at: number;
}

const OFFER_FIELDS = (o: BaseOffer, vendor: string, account: string, priceAt: (x: number) => number, references: number, error_bps: number): Omit<Offer, "record" | "at"> => ({
  ...o, error_bps, vendor, account, setup: priceAt(o.setup), exit: priceAt(o.exit), fee_per_year: priceAt(o.fee_per_year), fee_month: Math.max(1, Math.round(priceAt(o.fee_per_year) / 12)), references,
});

/** The offers a reader has been shown, the latest of each vendor's kinds. */
export function offersOf(book: Book): Offer[] {
  const latest = new Map<string, Offer>();
  for (const r of book.open(OFFER)) {
    const d = r.data as Partial<Offer> | undefined;
    if (!d || typeof d.id !== "string" || typeof d.template !== "string" || !r.speaks_for) continue;
    const key = `${r.speaks_for}|${d.id}`;
    if (latest.get(key) && latest.get(key)!.at > r.at) continue;
    latest.set(key, { ...(d as Offer), vendor: r.speaks_for, record: r.id, at: r.at });
  }
  return [...latest.values()].sort((a, b) => (a.vendor + a.id < b.vendor + b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------- the vendor

interface Licence { order: string; delivery?: string; buyer: string; offer: string; systems: string[]; since: number; agreement?: string; lastPaid: number; retired: boolean }

/**
 * The outside world's seller of systems. It sells what its profile lists, at the profile's prices as of the month (held fixed,
 * or moving at the rate the world gives: a scenario's, from the first day). Orders are paid with the order, as any order to a
 * seller is; it delivers, and offers the licence. It owns nothing in the town: what the town pays leaves it.
 */
export const vendor: BehaviourModule = {
  name: "world.vendor",
  version: "0.1.0",
  doc: "docs/behaviour/automation.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        account: "", // the outside's account it is paid into (the world must say)
        offers: [] as BaseOffer[],
        change_bps_per_year: 0, // how its prices move a year (negative: fall); 0: today's prices held
        unpaid_days: 7, // an order unpaid this long is declined
        sign_days: 30, // a system whose licence its client has not signed this long is switched off
        grace_days: 75, // a licence unpaid this long (two months' fees and a fortnight) lets the vendor switch the system off
        most_systems: 40, // the most it delivers to one order
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const orders = new OrderBook(me, p.unpaid_days);
    const listed = new Map<string, { key: string; id?: string }>(); // offer -> what it last published
    const licences = new Map<string, Licence>(); // delivery -> the licence
    const clients = new Map<string, Set<string>>(); // offer -> those who have licences (its references)
    const answered = new Set<string>(); // tenders we have bid for
    const factor = (t: number) => Math.pow(Math.max(0.0001, 1 + p.change_bps_per_year / 10_000), Math.floor(t / MONTH) / 12);
    const priceAt = (t: number) => (x: number) => Math.max(1, Math.round(x * factor(t)));
    const nowOffer = (o: BaseOffer, t: number) => OFFER_FIELDS(o, me, p.account, priceAt(t), clients.get(o.id)?.size ?? 0, slipRow(ctx, o.id)?.bps ?? 0);
    const words = (o: ReturnType<typeof nowOffer>) => `${o.title}: ${o.for === "firms" ? `does the task "${o.task}"` : `writes ${o.kinds?.join(", ")}`}, at ${o.speed_bps / 100}% of a person's time a unit, for ${o.scope_bps / 100}% of the units; an error ${o.error_bps / 100}% of the time. Set-up ${usd(o.setup)} each, ${usd(o.fee_month)} a month, ${o.term_days}-day licence (${o.notice_days} days' notice), ${usd(o.exit)} to leave. Order ${ORDER_KIND(o.id)}, paid with the order. ${o.references} client${o.references === 1 ? "" : "s"}.`;

    return stepper(
      (obs) => {
        book.absorb(obs);
        orders.take(obs, p.account);
        for (const tx of channels.transactions(obs)) {
          const m = /^Licence (\S+?)\.?$/.exec(tx.memo ?? "");
          if (m && tx.to === p.account) for (const l of licences.values()) if (l.agreement === m[1]) l.lastPaid = obs.t;
        }
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // What it sells, at this month's prices: published again when they move.
        for (const o of p.offers) {
          const x = nowOffer(o, t);
          const key = JSON.stringify([x.setup, x.fee_month, x.exit, x.references]);
          const was = listed.get(o.id);
          if (was?.key === key) continue;
          listed.set(o.id, { key, ...(was?.id ? { id: was.id } : {}) });
          const st = because(was ? `Our prices or clients have changed: publishing ${o.title} again.` : `What we sell: ${o.title}.`,
            ...(was?.id ? [withdraw(was.id, "Superseded.")] : []),
            ["listed", say(OFFER, words(x), { visible: "public", data: x })]);
          st.then = (out) => { const id = out.created?.listed; if (id) listed.set(o.id, { key, id }); };
          steps.push(st);
        }
        // Orders paid in full: deliver the systems, then offer the licence.
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          const id = o.kind.startsWith("system:") ? o.kind.slice(7) : "";
          const base = p.offers.find((x) => x.id === id);
          const x = base ? nowOffer(base, t) : undefined;
          const total = o.quantity * o.unitPrice;
          const ok = !!x && o.unitPrice >= x.setup && o.quantity >= 1 && o.quantity <= p.most_systems;
          if (!ok || !x) {
            steps.push(because(`An order for ${o.kind} that is not one we can fill at the price asked: refunding it.`, pay(o.account, total, { from: p.account, for: `Refund: ${o.kind} is not on offer at ${usd(o.unitPrice)}.` })));
            continue;
          }
          const names = Array.from({ length: o.quantity }, (_, i) => `sys${i}`);
          const st = because(`${o.buyer} has paid ${usd(total)} to set up ${o.quantity} of ${x.title}: delivering.`,
            ...names.map((n): [string, C.Call] => [n, C.call("system", { template: x.template, to: o.buyer, title: C.text(x.title) })]));
          st.then = (out) => {
            if (out.status !== "applied") return [because(`The delivery to ${o.buyer} was refused: sending the money back.`, pay(o.account, total, { from: p.account, for: "Refund: we could not deliver." }))];
            const ids = names.map((n) => out.created?.[n]).filter((s): s is string => !!s);
            const fee = x.fee_month * ids.length;
            const set = clients.get(x.id) ?? new Set<string>();
            set.add(o.buyer);
            clients.set(x.id, set);
            const delivery = "delivery";
            licences.set(o.id, { order: o.id, buyer: o.buyer, offer: x.id, systems: ids, since: out.t, lastPaid: out.t, retired: false });
            const next = because(`Delivered ${ids.length} of ${x.title} to ${o.buyer}: publishing the delivery and offering the licence.`,
              [delivery, say(DELIVERY, `Delivered to ${o.buyer}: ${ids.length} of ${x.title} (${ids.join(", ")}), under licence at ${usd(fee)} a month.`, {
                to: [o.buyer], visible: [me, o.buyer], basis: o.id,
                data: { order: o.id, offer: x.id, vendor: me, account: p.account, for: x.for, task: x.task, kinds: x.kinds, template: x.template, title: x.title, seconds: x.seconds, speed_bps: x.speed_bps, scope_bps: x.scope_bps, error_bps: x.error_bps,
                  systems: ids, fee_month: x.fee_month, exit: x.exit, term_days: x.term_days, notice_days: x.notice_days, oversight_hours_per_month: x.oversight_hours_per_month, setup: x.setup } })],
              offer(o.buyer, { template: "licence", term: x.term_days * DAY, then: "periodic", ourNotice: x.notice_days * DAY, theirNotice: x.notice_days * DAY, basis: o.id,
                we: C.text(`${me} keeps the ${ids.length} system${ids.length === 1 ? "" : "s"} running (${ids.join(", ")}), and may switch them off if the fee is not paid.`) as any,
                they: pay(p.account, fee, { every: MONTH, for: `Licence of ${x.title}.` }),
                text: `Licence of ${ids.length} of ${x.title} to ${o.buyer}: ${usd(fee)} a month, ${x.term_days} days, ${x.notice_days} days' notice either way; ${usd(x.exit)} to leave. Systems: ${ids.join(", ")}.` }));
            next.then = (o2) => { const id = o2.created?.[delivery]; if (id) licences.get(o.id)!.delivery = id; };
            return [next];
          };
          steps.push(st);
        }
        // Tenders (a public body\'s request for bids): a bid for each of our offers for offices that does what it asks.
        for (const r of book.open("tender")) {
          if (answered.has(r.id) || !r.speaks_for || (r.data?.closes as number) < t) continue;
          answered.add(r.id);
          const kinds = (r.data?.kinds as string[]) ?? [];
          for (const base of p.offers) {
            if (base.for !== "offices" || !kinds.length || !kinds.every((k) => base.kinds?.includes(k))) continue;
            const x = nowOffer(base, t);
            steps.push(because(`${r.speaks_for} has invited bids to ${r.data?.what ?? "do its casework"}: bidding ${x.title}.`,
              say("bid", `Bid to ${r.speaks_for} for tender ${r.id}: ${x.title}, ${usd(x.setup)} to set up each, ${usd(x.fee_month)} a month each, ${usd(x.exit)} to leave, ${x.term_days} days.`, { to: [r.speaks_for], visible: [me, r.speaks_for], basis: r.id, data: { tender: r.id, ...x } })));
          }
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } })));
        for (const [a, x] of orders.unclaimed(book)) {
          orders.refunded(a);
          steps.push(because("Money paid to us with no order waiting for it: sending it back.", pay(a, x, { from: p.account, for: "Refund: no order of yours is waiting." })));
        }
        // Licences: the agreement we offered, and whether it stands. A system whose licence is unsigned, ended or unpaid is switched off.
        for (const l of licences.values()) {
          if (l.retired) continue;
          const a = l.agreement ? book.records.get(l.agreement) : [...book.ofType("agreement")].find((r) => r.record === "agreement" && basesOf(r).includes(l.order) && r.terms.template === "licence");
          if (a?.record === "agreement" && !l.agreement) l.agreement = a.id;
          const unsigned = `${l.buyer} has not signed the licence in ${p.sign_days} days`;
          let why = "";
          if (!a || a.record !== "agreement") why = t - l.since >= p.sign_days * DAY ? unsigned : "";
          else if (book.takenBack(a.id)) why = "the licence offer was taken back";
          else if (!book.signedBy(a.id, l.buyer)) why = t - l.since >= p.sign_days * DAY ? unsigned : "";
          else if (!book.inForce(a.id)) why = "the licence has ended";
          else if (t - l.lastPaid >= p.grace_days * DAY) why = `the licence fee has not been paid for ${Math.floor((t - l.lastPaid) / DAY)} days`;
          if (!why) continue;
          l.retired = true;
          steps.push(because(`Switching off ${l.systems.length} system${l.systems.length === 1 ? "" : "s"} at ${l.buyer}: ${why}.`,
            ...l.systems.map((sys) => C.call("system", { retire: sys })),
            say("system_ended", `The licence of ${l.systems.join(", ")} has ended (${why}): switched off.`, { to: [l.buyer], visible: [me, l.buyer], basis: l.delivery ?? l.order, data: { delivery: l.delivery, order: l.order, systems: l.systems, why } })));
        }
        return steps;
      },
    );
  },
};

// ------------------------------------------------------------------------------------------------ the client's side

/** A delivery of systems to this business, with the licence that keeps them. */
export interface Lot {
  delivery: string;
  order: string;
  offer: string;
  vendor: string;
  account: string;
  task?: string;
  kinds: string[];
  title: string;
  systems: string[];
  seconds: number;
  scope_bps: number;
  error_bps: number;
  fee_month: number;
  exit: number;
  term_days: number;
  notice_days: number;
  oversight_hours_per_month: number;
  setup: number;
  since: number;
  agreement?: string;
  ending?: boolean;
  ended?: boolean;
}

/** What a business has been delivered, and its licences: from its own papers (the vendor's delivery, the agreement). */
export class Fleet {
  private readonly lots = new Map<string, Lot>();
  private readonly dead = new Set<string>(); // systems that refused or ended
  private signed = new Set<string>();
  private ended = new Set<string>();
  constructor(private readonly me: string) {}

  absorb(book: Book): void {
    for (const r of book.all(DELIVERY)) {
      if (!(r.addressed_to ?? []).includes(this.me) || this.lots.has(r.id)) continue;
      const d = r.data as any;
      this.lots.set(r.id, { delivery: r.id, order: String(d.order), offer: String(d.offer), vendor: String(d.vendor), account: String(d.account), task: d.task, kinds: d.kinds ?? [], title: String(d.title), systems: d.systems ?? [],
        seconds: Number(d.seconds) || 0, scope_bps: Number(d.scope_bps) || 0, error_bps: Number(d.error_bps) || 0, fee_month: Number(d.fee_month) || 0, exit: Number(d.exit) || 0, term_days: Number(d.term_days) || 0,
        notice_days: Number(d.notice_days) || 0, oversight_hours_per_month: Number(d.oversight_hours_per_month) || 0, setup: Number(d.setup) || 0, since: r.at });
    }
    for (const lot of this.lots.values()) {
      const a = [...book.ofType("agreement")].find((x) => x.record === "agreement" && basesOf(x).includes(lot.order) && x.terms.template === "licence" && x.terms.parties.includes(this.me));
      if (a) lot.agreement = a.id;
      lot.ended = (lot.agreement !== undefined && book.signedBy(lot.agreement, this.me) && !book.inForce(lot.agreement)) || book.all("system_ended").some((r) => r.data?.order === lot.order && (r.addressed_to ?? []).includes(this.me));
    }
  }

  /** Its lots in service (delivered and not ended), for a task, or all. */
  inService(task?: string): Lot[] {
    return [...this.lots.values()].filter((l) => !l.ended && (task === undefined || l.task === task) && l.systems.some((s) => !this.dead.has(s)));
  }
  all(): Lot[] { return [...this.lots.values()]; }

  /** The systems of a task that are working, with the seconds a unit takes each. */
  working(task: string): { id: string; seconds: number; scope_bps: number; lot: Lot }[] {
    return this.inService(task).flatMap((l) => l.systems.filter((s) => !this.dead.has(s)).map((id) => ({ id, seconds: l.seconds, scope_bps: l.scope_bps, lot: l })));
  }
  /** A system the world refused to work (it has been switched off): not counted again. */
  gone(id: string): void { this.dead.add(id); }

  /** The licences offered to us: signed, with the fee set up to be paid each month. */
  paperwork(book: Book, t: number, from: string): Step[] {
    const steps: Step[] = [];
    for (const lot of this.lots.values()) {
      if (!lot.agreement || lot.ended || this.signed.has(lot.agreement) || book.signedBy(lot.agreement, this.me) || book.takenBack(lot.agreement)) continue;
      const a = book.records.get(lot.agreement);
      if (a?.record !== "agreement") continue;
      this.signed.add(lot.agreement);
      const fee = cents(a.terms.commitments.find((c: { who: string }) => c.who === this.me)?.does?.outcome?.money?.amount ?? lot.fee_month * lot.systems.length);
      steps.push(because(`The licence of ${lot.systems.length} ${lot.title} (${a.id}) is as ordered: signing it, and setting up its fee of ${usd(fee)} a month.`,
        sign(a.id), pay(lot.account, fee, { from, every: MONTH, first: MONTH, for: `Licence ${a.id}`, basis: a.id })));
    }
    return steps;
  }

  /** Giving notice of leaving a licence: the notice, the exit cost, and its fee's standing order taken down. */
  leave(book: Book, lot: Lot, from: string, why: string): Step[] {
    if (!lot.agreement || lot.ending) return [];
    lot.ending = true;
    const orders = book.open("request").filter((r) => r.speaks_for === this.me && r.data?.every && basesOf(r).includes(lot.agreement!)).map((r) => r.id);
    return [because(why, notice(lot.agreement, `We are ending the licence of ${lot.title}.`), ...(lot.exit > 0 ? [pay(lot.account, lot.exit, { from, for: `Exit of licence ${lot.agreement}.` })] : []), ...orders.map((o) => withdraw(o, "The licence is ending.")))];
  }
}

// -------------------------------------------------------------------------------------------------- the comparison

/** What a business weighs, as its profile gives it (placeholders where unsourced; docs/behaviour/automation.md). */
export interface AdoptionParams {
  /** Months over which the costs of changing must pay back: a small business (under `large_from` staff) and a large one. */
  payback_months: { small: number; large: number };
  large_from: number;
  /** How much dearer the system's running costs may come out than the labour it replaces before a business will not (a margin of safety), in basis points. */
  hurdle_bps: number;
  /** Each business already known to use it eases the hurdle by this much (Mansfield 1961), in basis points; never below nothing. */
  reference_bps: number;
  /** What staff cost beyond their wage (the law's charges the employer bears), in basis points. */
  on_cost_bps: number;
  /** The most systems it would take of one kind at once. */
  most: number;
  /** How often it keeps to a law against a use when it would otherwise take one (basis points; the rest of the time it takes it all the same). */
  compliance_bps: number;
}
export const ADOPTION: AdoptionParams = { payback_months: { small: 24, large: 36 }, large_from: 10, hurdle_bps: 2000, reference_bps: 200, on_cost_bps: 0, most: 6, compliance_bps: 10_000 };

/** The facts of the task as the business does it. */
export interface Task {
  /** Units a month it expects (smoothed). */
  units: number;
  /** A person's seconds a unit. */
  labour: number;
  /** A person's pay a month (the wage, in the world's smallest unit), and the seconds a worker works in a month. */
  wage_month: number;
  /** The seconds a worker works in a month. */
  seconds_per_worker_month: number;
  utilisation_bps: number;
  /** What a unit sells for (an error is refunded at this). */
  unit_price: number;
  /** The weeks of a person's pay that taking one on costs. */
  hiring_cost_weeks: number;
}

export interface Appraisal {
  n: number;
  /** Units a month the systems would do. */
  units: number;
  /** Staff-months a month it would free (hands). */
  hands: number;
  saving: number;
  running: number;
  amortised: number;
  net: number;
  /** The hurdle used, in basis points. */
  hurdle_bps: number;
  worth: boolean;
}

/** One system's units a month: the month's seconds at the utilisation, over its seconds a unit. */
export const capacityOf = (seconds: number, utilisation_bps: number) => (seconds > 0 ? Math.floor((MONTH * utilisation_bps) / 10_000 / seconds) : 0);

/**
 * The ordinary comparison. With `n` systems of the offer: the staff cost saved (the hands the units they do would have taken,
 * at the wage with its on-costs); against the fees, the oversight hours of its own staff, the errors refunded, and the set-up and
 * the exit spread over the payback horizon. It is worth it when the saving covers the cost by the margin the hurdle asks.
 * `standing` is a system already held: its set-up is spent, so only its running cost and its exit are weighed (in `dropping`).
 */
export function appraise(o: { fee_month: number; setup: number; exit: number; seconds: number; scope_bps: number; error_bps: number; oversight_hours_per_month: number; references?: number }, n: number, task: Task, a: AdoptionParams, horizon: number, standing = false): Appraisal {
  const cap = capacityOf(o.seconds, task.utilisation_bps);
  const units = Math.min(Math.floor((task.units * o.scope_bps) / 10_000), n * cap);
  const wage = task.wage_month * (10_000 + a.on_cost_bps) / 10_000;
  const hands = (units * task.labour) / (task.seconds_per_worker_month * (task.utilisation_bps / 10_000));
  const saving = Math.round(hands * wage);
  const hourly = (task.wage_month * 3600) / task.seconds_per_worker_month;
  const running = n * o.fee_month + Math.round(n * o.oversight_hours_per_month * hourly) + Math.round((units * o.error_bps * task.unit_price) / 10_000);
  const amortised = Math.round(((standing ? 0 : n * o.setup) + o.exit * (standing ? 1 : 1)) / Math.max(1, horizon));
  const hurdle = Math.max(0, a.hurdle_bps - a.reference_bps * (o.references ?? 0));
  const net = saving - running - amortised;
  return { n, units, hands, saving, running, amortised, net, hurdle_bps: hurdle, worth: units > 0 && saving * 10_000 >= (running + amortised) * (10_000 + hurdle) };
}

/** The best number of systems to take of an offer (the most net saving), if any is worth it. */
export function best(o: Parameters<typeof appraise>[0], task: Task, a: AdoptionParams, horizon: number): Appraisal | undefined {
  let top: Appraisal | undefined;
  for (let n = 1; n <= a.most; n++) {
    const x = appraise(o, n, task, a, horizon);
    if (x.worth && (!top || x.net > top.net)) top = x;
    if (x.units >= Math.floor((task.units * o.scope_bps) / 10_000)) break; // (more would do no more)
  }
  return top;
}

/** Whether to end a licence that has run its term: the running cost against what it saves, with the cost of leaving and of taking people on again. */
export function dropping(l: Lot, task: Task, a: AdoptionParams, horizon: number): { drop: boolean; saving: number; running: number; leaving: number } {
  const x = appraise({ fee_month: l.fee_month, setup: 0, exit: 0, seconds: l.seconds, scope_bps: l.scope_bps, error_bps: l.error_bps, oversight_hours_per_month: l.oversight_hours_per_month }, l.systems.length, task, a, horizon, true);
  const rehire = Math.round(x.hands * ((task.wage_month * 12) / 52) * task.hiring_cost_weeks);
  const leaving = l.exit + rehire;
  return { drop: (x.running - x.saving) * horizon > leaving, saving: x.saving, running: x.running, leaving };
}

/** The business's own side: weighing the offers on its review day, and ordering. */
export class Adoption {
  private placed = new Set<string>(); // offers it has an order out for, until the delivery comes
  private readonly lastWeighed = new Map<string, number>();
  constructor(private readonly me: string, private readonly fleet: Fleet, private readonly a: AdoptionParams = ADOPTION) {}

  horizon(staff: number): number { return staff >= this.a.large_from ? this.a.payback_months.large : this.a.payback_months.small; }

  /** What it does at a review: end a licence that has run its term and does not pay, or take the best system on offer for its task. */
  review(book: Book, t: number, o: { task: string; facts: Task; staff: number; account: string; balance: number; keep: number; breaks?: (offer: Offer) => string[]; complies?: (purpose: string) => boolean }): Step[] {
    const steps: Step[] = [];
    const horizon = this.horizon(o.staff);
    for (const l of this.fleet.inService(o.task)) {
      if (l.ending || !l.agreement || !book.signedBy(l.agreement, this.me) || t < l.since + l.term_days * DAY) continue;
      const d = dropping(l, o.facts, this.a, horizon);
      if (d.drop) steps.push(...this.fleet.leave(book, l, o.account, `The licence of ${l.systems.length} ${l.title} has run its term and costs ${usd(d.running)} a month against ${usd(d.saving)} of staff it saves, over ${horizon} months more than the ${usd(d.leaving)} it costs to leave and take people on again: ending it.`));
    }
    const holding = this.fleet.inService(o.task).length + [...this.placed].length;
    if (holding > 0 || !(o.facts.units > 0)) return steps;
    let top: { offer: Offer; x: Appraisal } | undefined;
    for (const f of offersOf(book)) {
      if (f.for !== "firms" || f.task !== o.task) continue;
      const x = best(f, o.facts, this.a, horizon);
      if (!x) continue;
      const cash = o.balance - o.keep - x.n * f.setup;
      const law = o.breaks?.(f) ?? [];
      if (cash < x.n * f.fee_month || (law.length && (o.complies?.(`adopt-${f.id}-${Math.floor(t / MONTH)}`) ?? true))) continue;
      if (!top || x.net > top.x.net) top = { offer: f, x };
    }
    if (!top) return steps;
    const { offer: f, x } = top;
    this.placed.add(f.id);
    const st = order({ me: this.me, seller: f.vendor, sellerAccount: f.account, kind: ORDER_KIND(f.id), quantity: x.n, unitPrice: f.setup, at: "", from: o.account,
      why: `Taking ${x.n} ${f.title}: they would do ${x.units} of the ${o.facts.units} ${o.task} units a month, freeing ${x.hands.toFixed(1)} hands (${usd(x.saving)} a month) for ${usd(x.running)} a month in fees, oversight and errors, and ${usd(x.n * f.setup)} to set up and ${usd(f.exit)} to leave, spread over ${horizon} months (${usd(x.amortised)} a month): worth it by ${(x.saving * 100 / Math.max(1, x.running + x.amortised) - 100).toFixed(0)}%, where ${(x.hurdle_bps / 100).toFixed(0)}% is asked (${f.references} clients so far).` });
    st.then = (out) => { if (out.status !== "applied") this.placed.delete(f.id); };
    steps.push(st);
    return steps;
  }

  /** A delivery came: the order for it is no longer out. */
  delivered(): void { this.placed = new Set([...this.placed].filter((id) => !this.fleet.all().some((l) => l.offer === id && !l.ended))); }
}

// --------------------------------------------------------------------------------------------------------- offices

/** The law on public buying, as a place states it (the profile\'s): above this value a contract is tendered; bids are open this long. */
export interface Procurement { threshold: number; bid_days: number }

/** What an office knows of the casework it does: how long a paper takes its staff, and what its staff are paid and work. */
export interface Casework {
  kinds: string[];
  /** A person\'s seconds a paper of each kind (the town\'s table of work). */
  person_seconds: { [kind: string]: number };
  wage_month: number;
  seconds_per_worker_month: number;
  utilisation_bps: number;
}

/**
 * An office\'s side (docs/behaviour/automation.md, "Offices"): the same comparison as a business\'s, with its own papers as the units
 * and its staff\'s time as the cost; and the law on public buying where the contract is large: a notice inviting bids, the period they
 * are open, and an award to the bid that costs least over the payback horizon. A system it holds does the papers the office writes
 * (`done_by`), whoever holds the office; the head of the office (code or a seat) decides by this or by hand.
 */
export class OfficeAdoption {
  private tender: { id?: string; kinds: string[]; closes: number; n: number } | undefined;
  private placed = false;
  private turn = 0;
  constructor(private readonly me: string, private readonly fleet: Fleet, private readonly a: AdoptionParams, private readonly law: Procurement | null) {}

  /** A system of ours to do a paper of this kind, if any is in service (taking them in turn). */
  systemFor(kind: string): string | undefined {
    const working = this.fleet.inService().filter((l) => l.kinds.includes(kind)).flatMap((l) => l.systems);
    return working.length ? working[this.turn++ % working.length] : undefined;
  }

  /** The share of a month\'s papers of these kinds our systems do. */
  share(kinds: string[]): number {
    const lots = this.fleet.inService().filter((l) => kinds.some((k) => l.kinds.includes(k)));
    return lots.length ? Math.max(...lots.map((l) => l.scope_bps)) : 0;
  }

  review(book: Book, t: number, o: { casework: Casework; volume: number; account: string; balance: number; keep: number; staff: number; breaks?: (offer: Offer) => string[]; complies?: (purpose: string) => boolean }): Step[] {
    const steps: Step[] = [];
    const c = o.casework;
    const labour = c.kinds.reduce((x, k) => x + (c.person_seconds[k] ?? 0), 0) / Math.max(1, c.kinds.length);
    const hourly = (c.wage_month * 3600) / c.seconds_per_worker_month;
    // (What an error costs an office: the paper done again and looked at by a second pair of eyes; ten times the time of a paper, a placeholder.)
    const facts: Task = { units: o.volume, labour, wage_month: c.wage_month, seconds_per_worker_month: c.seconds_per_worker_month, utilisation_bps: c.utilisation_bps, unit_price: Math.round((10 * labour * hourly) / 3600), hiring_cost_weeks: 8 };
    const horizon = this.a.payback_months[o.staff >= this.a.large_from ? "large" : "small"];
    const mine = this.fleet.inService().filter((l) => c.kinds.every((k) => l.kinds.includes(k)));
    for (const l of mine) {
      if (l.ending || !l.agreement || !book.signedBy(l.agreement, this.me) || t < l.since + l.term_days * DAY) continue;
      const d = dropping(l, facts, this.a, horizon);
      if (d.drop) steps.push(...this.fleet.leave(book, l, o.account, `The licence of ${l.systems.length} ${l.title} has run its term and costs ${usd(d.running)} a month against ${usd(d.saving)} of staff time it frees, over ${horizon} months more than the ${usd(d.leaving)} it costs to leave: ending it.`));
    }
    if (mine.length || this.placed || !(facts.units > 0)) return steps;
    // A tender in hand: closed, it is awarded to the bid that frees most for least.
    if (this.tender) {
      if (t < this.tender.closes) return steps;
      const tender = this.tender;
      this.tender = undefined;
      const bids = book.all("bid").filter((r) => (r.addressed_to ?? []).includes(this.me) && r.data?.tender === tender.id).map((r) => ({ r, f: r.data as unknown as Offer })).filter((b) => b.f && b.f.kinds && c.kinds.every((k) => b.f.kinds!.includes(k)));
      let top: { f: Offer; x: Appraisal } | undefined;
      for (const { f } of bids) {
        const x = best(f, facts, this.a, horizon);
        if (x && (!top || x.net > top.x.net)) top = { f, x };
      }
      if (!top) return [...steps, because(`The bids to tender ${tender.id} are in (${bids.length}): none is worth taking over ${horizon} months, so none is awarded.`)];
      return [...steps, ...this.order(top.f, top.x, facts, horizon, o.account, `Awarding tender ${tender.id} to ${top.f.vendor}, the lowest of ${bids.length} bid${bids.length === 1 ? "" : "s"} by cost over ${horizon} months`)];
    }
    let top: { offer: Offer; x: Appraisal } | undefined;
    for (const f of offersOf(book)) {
      if (f.for !== "offices" || !c.kinds.every((k) => f.kinds?.includes(k))) continue;
      const x = best(f, facts, this.a, horizon);
      if (!x || ((o.breaks?.(f) ?? []).length && (o.complies?.(`adopt-${f.id}-${Math.floor(t / MONTH)}`) ?? true))) continue;
      if (!top || x.net > top.x.net) top = { offer: f, x };
    }
    if (!top) return steps;
    const value = top.x.n * top.offer.setup + top.x.n * top.offer.fee_month * Math.round(top.offer.term_days / 30);
    if (this.law && value > this.law.threshold) {
      // Above the threshold the law asks for open bids: the notice goes out, and the award waits for them.
      this.tender = { kinds: c.kinds, closes: t + this.law.bid_days * DAY, n: top.x.n };
      const st = because(`Taking systems to do ${c.kinds.join(" and ")} would come to ${usd(value)} over the licence, above the ${usd(this.law.threshold)} the law asks to be put out to tender: inviting bids for ${this.law.bid_days} days.`,
        ["tender", say("tender", `Tender: ${this.me} invites bids from sellers of systems to write ${c.kinds.join(" and ")}, about ${Math.round(facts.units)} a month, for a licence of ${top.offer.term_days} days. Bids close on day ${Math.floor((t + this.law.bid_days * DAY) / DAY)}; the lowest cost over ${horizon} months is awarded.`, {
          visible: "public", data: { what: `write ${c.kinds.join(" and ")}`, kinds: c.kinds, volume: Math.round(facts.units), closes: t + this.law.bid_days * DAY, term_days: top.offer.term_days } })]);
      st.then = (out) => { if (out.status === "applied") { if (this.tender) this.tender.id = out.created?.tender; } else this.tender = undefined; };
      return [...steps, st];
    }
    return [...steps, ...this.order(top.offer, top.x, facts, horizon, o.account, `Taking ${top.x.n} ${top.offer.title}`)];
  }

  private order(f: Offer, x: Appraisal, facts: Task, horizon: number, account: string, what: string): Step[] {
    this.placed = true;
    const st = order({ me: this.me, seller: f.vendor, sellerAccount: f.account, kind: ORDER_KIND(f.id), quantity: x.n, unitPrice: f.setup, at: "", from: account,
      why: `${what}: they would write ${x.units} of the ${Math.round(facts.units)} papers a month, freeing ${x.hands.toFixed(2)} of a clerk (${usd(x.saving)} a month) for ${usd(x.running)} a month in fees, oversight and mistakes, and ${usd(x.n * f.setup)} to set up and ${usd(f.exit)} to leave, spread over ${horizon} months (${usd(x.amortised)} a month).` });
    st.then = (out) => { if (out.status !== "applied") this.placed = false; };
    return [st];
  }
}

/**
 * An office\'s dealings with systems, for a module to hold: its fleet and its adoption, the monthly look, and the papers
 * that go to a system it holds. A module given no `automation` has none, and does everything as before.
 */
export class OfficeDesk {
  private readonly fleet: Fleet;
  private readonly adoption?: OfficeAdoption;
  private next = 30 * DAY;
  constructor(private readonly me: string, private readonly p: { automation?: AdoptionParams | null; procurement?: Procurement | null; casework?: Casework | null }, private readonly rng: (purpose: string) => { below(n: number): number } = () => ({ below: () => 0 })) {
    this.fleet = new Fleet(me);
    if (p.automation && p.casework) this.adoption = new OfficeAdoption(me, this.fleet, { ...ADOPTION, ...p.automation }, p.procurement ?? null);
  }
  get on(): boolean { return !!this.adoption; }
  private chance(purpose: string): number { return this.rng(purpose).below(10_000); }
  absorb(book: Book): void { if (this.adoption) this.fleet.absorb(book); }

  /** Each plan: the licence papers; each month, whether to take a system for the papers it writes, or end a licence. */
  steps(book: Book, t: number, o: { account: string; balance: number; staff: number; keep: number }): Step[] {
    if (!this.adoption || !this.p.casework) return [];
    const steps = this.fleet.paperwork(book, t, o.account);
    if (t < this.next) return steps;
    this.next = t + MONTH;
    const kinds = this.p.casework.kinds;
    const since = Math.max(MONTH, Math.min(YEAR, t));
    const made = kinds.reduce((n, k) => n + book.all(k).filter((r) => r.speaks_for === this.me && r.at >= t - YEAR).length, 0);
    steps.push(...this.adoption.review(book, t, { casework: this.p.casework, volume: (made * MONTH) / since, account: o.account, balance: o.balance, keep: o.keep, staff: o.staff,
      breaks: (f) => breaches(book, { block: "deploy", kinds: f.kinds, offer: f.id, vendor: f.vendor }, this.me, t).map((l) => l.id), complies: (why) => this.chance(`comply-${why}`) < (this.p.automation?.compliance_bps ?? 10_000) }));
    return steps;
  }

  /** A step\'s paper goes to a system of ours that writes this kind, if we hold one: `done_by` on its first call, which the platform gives to the act. */
  assign(step: Step, kind: string): void {
    const id = this.adoption?.systemFor(kind);
    const first = step[0];
    if (!id || !first) return;
    const call = Array.isArray(first) ? first[1] : first;
    call.args.done_by = { id };
  }
}
