// Trade in goods (phase B): prices published, orders placed and paid, goods delivered. Documented in
// docs/behaviour/trade.md.
//
// A seller publishes a price list (a statement of kind "price_list": `data.goods`, a unit price in cents for each kind
// it sells, and `data.account`, where to pay). A buyer orders (kind "order", to the seller, seen by the two of them:
// what, how many, at what unit price, delivered to whom and where, paid from which account) and pays the total in
// the same act: cash with order, as at a till or an online shop. Nothing in the world enforces any of it; it is how
// these participants do business.
//
// The seller matches payments to orders by the account they came from, oldest order first (as a small firm's books
// do), delivers what it can once an order is paid in full, refunds what it couldn't deliver, and answers with a
// delivery note. An order still unpaid after a while is declined. Liberty (D25): goods move at once, with no
// transport.

import * as C from "../calls";
import type { Observation, Offer, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { because, type Book, DAY, Latest, pay, say, type Step, usd } from "./common";
import { receipts } from "./firms";

/** An order, as the seller reads it. */
export interface Order { id: string; seller: string; buyer: string; kind: string; quantity: number; unitPrice: number; to: string; at: string; account: string; placed: number;
  /** The days the order is for, as the buyer says (a fortnight's shopping): served over that time. */
  forDays?: number }

const goodsLists = new Latest("price_list", (r) => r.data?.goods);
/** A seller's standing offer, if its latest price list that is one makes one (a list of one kind of goods). */
const offerLists = new Latest("price_list", (r) => r.offer);
export const offerOf = (book: Book, seller: string) => offerLists.of(book, seller)?.offer;

/** A seller's current prices for goods (its latest standing price list), the account it's paid into, the least it
 * sells in one order (a wholesaler's minimum), and where it is (a shop's premises, for collection). */
export function goodsPrices(book: Book, seller: string): { prices: { [kind: string]: number }; account?: string; min_order?: number; at?: string } {
  const list = goodsLists.of(book, seller);
  return { prices: (list?.data?.goods as { [kind: string]: number }) ?? {}, account: list?.data?.account, min_order: list?.data?.min_order, at: list?.data?.at };
}

/** What the entity holds of a kind at a place (its holdings channel), as a number. */
export function held(obs: Observation, at: string, kind: string): number {
  const h = channels.holdings(obs).find((x) => x.at === at && x.kind === kind);
  return h ? Number(h.quantity) : 0;
}

/** Publishing (or republishing) a price list: the kinds of goods sold and their unit prices, and where to pay. */
export function priceList(prices: { [kind: string]: number }, account: string, text: string, extra: { min_order?: number; [k: string]: unknown } = {}, seller?: string): C.Call {
  // With one kind of goods, it's also an offer (docs/design/ai-citizens.md 2a): order, pay the unit price, and the goods
  // are delivered, per unit. (A list of several kinds isn't one offer: those are left as lists for now.)
  const kinds = Object.keys(prices);
  const k = kinds[0]!;
  const offer: Offer | undefined = seller && kinds.length === 1 && prices[k]! > 0 ? { by: seller, take_up: "order", terms: { commitments: [
    { who: "taker", does: { outcome: { money: { to: account, amount: String(prices[k]), for: k } } }, per: "unit" },
    { who: seller, does: { outcome: { goods: { kind: k, quantity: "1" } } }, per: "unit" },
  ] } } : undefined;
  return say("price_list", text, { visible: "public", data: { goods: prices, account, ...extra }, ...(offer ? { offer } : {}) });
}

/**
 * An order for goods, paid with the order in the same act. `from` is the buyer's paying account; `sellerAccount`
 * the one the seller's price list names.
 */
export function order(o: { me: string; seller: string; sellerAccount: string; kind: string; quantity: number; unitPrice: number; to?: string; at: string; from: string; why: string; ref?: string; retryOf?: string; forDays?: number }): Step {
  const to = o.to ?? o.me;
  const total = o.quantity * o.unitPrice;
  return because(o.why,
    [o.ref ?? "order", say("order", `Order: ${o.quantity} ${o.kind} at ${usd(o.unitPrice)} each (${usd(total)}), delivered to ${to} at ${o.at}. Paid with this order.`, {
      to: [o.seller], visible: [o.me, o.seller],
      data: { kind: o.kind, quantity: o.quantity, unit_price: o.unitPrice, deliver_to: to, at: o.at, account: o.from, ...(o.retryOf ? { retry_of: o.retryOf } : {}), ...(o.forDays ? { for_days: o.forDays } : {}) },
    })],
    pay(o.sellerAccount, total, { from: o.from, for: `Order: ${o.quantity} ${o.kind}.` }),
  );
}

/** Delivery notes addressed to us (the answers to our orders), not yet read: which order, how much came, what was refunded. */
export class Deliveries {
  private cursor = 0; // how far through the delivery notes seen we've read (only new ones are read: no rescanning)
  take(book: Book, me: string): { order: string; kind: string; ordered: number; delivered: number; refund: number; seller: string }[] {
    const out = [];
    const notes = book.all("delivery_note");
    for (; this.cursor < notes.length; this.cursor++) {
      const n = notes[this.cursor]!;
      if (!(n.addressed_to ?? []).includes(me)) continue;
      const delivered = (n.data?.delivered as number) ?? 0;
      out.push({ order: n.data?.order as string, kind: String(n.data?.kind), ordered: (n.data?.ordered as number) ?? delivered, delivered, refund: (n.data?.refund as number) ?? 0, seller: n.speaks_for! });
    }
    return out;
  }
}

/**
 * A seller's order book. `take` reads each observation (orders addressed to us, payments into our account); `due`
 * says which orders are now paid in full (oldest first) and which have waited too long unpaid.
 */
export class OrderBook {
  private readonly credit = new Map<string, number>(); // paying account -> money received not yet set against an order
  private readonly settled = new Set<string>();
  private readonly customers = new Set<string>(); // accounts that have ordered from us
  private readonly waiting = new Map<string, Order>(); // orders to us not yet settled
  private cursor = 0; // how far through the orders seen we've read (only new ones are read: no rescanning)
  constructor(private readonly me: string, private readonly unpaidDays = 7) {}

  take(obs: Observation, account: string | undefined) {
    if (account) for (const [from, amount] of receipts(obs, account)) this.credit.set(from, (this.credit.get(from) ?? 0) + amount);
  }

  /** Open orders to us, oldest first, as orders. */
  private open(book: Book): Order[] {
    const orders = book.all("order");
    for (; this.cursor < orders.length; this.cursor++) {
      const r: StatementRecord = orders[this.cursor]!;
      if (!(r.addressed_to ?? []).includes(this.me) || this.settled.has(r.id)) continue;
      this.waiting.set(r.id, {
        id: r.id, seller: this.me, buyer: r.speaks_for!, kind: String(r.data?.kind), quantity: Math.max(0, Math.floor(Number(r.data?.quantity) || 0)), unitPrice: Math.max(0, Math.floor(Number(r.data?.unit_price) || 0)),
        to: String(r.data?.deliver_to ?? r.speaks_for), at: String(r.data?.at), account: String(r.data?.account), placed: r.at,
        ...(Number.isInteger(r.data?.for_days) && Number(r.data?.for_days) > 0 ? { forDays: Number(r.data!.for_days) } : {}),
      });
    }
    for (const id of this.waiting.keys()) if (this.settled.has(id) || book.withdrawn.has(id)) this.waiting.delete(id);
    return [...this.waiting.values()].sort((a, b) => a.placed - b.placed || (a.id < b.id ? -1 : 1));
  }

  /**
   * Orders paid in full (their payment set against them), and orders that have waited unpaid too long (dropped).
   * `accept` says whether we can take an order on now (a shop's hands for the day): the first paid order it turns down
   * waits, and so do the paid orders after it (first come, first served).
   */
  due(book: Book, t: number, accept: (o: Order) => boolean = () => true): { paid: Order[]; unpaid: Order[] } {
    const paid: Order[] = [];
    const unpaid: Order[] = [];
    let full = false;
    for (const o of this.open(book)) {
      const total = o.quantity * o.unitPrice;
      const have = this.credit.get(o.account) ?? 0;
      this.customers.add(o.account);
      if (total > 0 && have >= total) {
        if (full || !accept(o)) {
          full = true;
          continue;
        }
        this.credit.set(o.account, have - total);
        this.settled.add(o.id);
        paid.push(o);
      } else if (t - o.placed >= this.unpaidDays * DAY) {
        this.settled.add(o.id);
        unpaid.push(o);
      }
    }
    return { paid, unpaid };
  }

  /** Money from a customer (an account that has ordered from us) that no order of theirs is waiting for: paid twice,
   * or too late. Money from anyone else is theirs to ask about. */
  unclaimed(book: Book): [string, number][] {
    const open = this.open(book);
    for (const o of open) this.customers.add(o.account);
    const waiting = new Set(open.map((o) => o.account));
    return [...this.credit].filter(([acc, x]) => x > 0 && this.customers.has(acc) && !waiting.has(acc));
  }

  /** An order taken on whose act didn't go through: it waits again, its payment set aside for it. */
  reopen(o: Order) {
    this.settled.delete(o.id);
    this.waiting.set(o.id, o);
    this.credit.set(o.account, (this.credit.get(o.account) ?? 0) + o.quantity * o.unitPrice);
  }

  /** Returning unclaimed money (a refund): forget it once paid back. */
  refunded(account: string) {
    this.credit.delete(account);
  }
}

/** Refusals that mean an order can't be delivered at all: where it's to go, or whom to, is gone. */
export const UNDELIVERABLE = ["unknown_place", "unknown_entity", "unknown_structure"];

/**
 * Filling a paid order: deliver `quantity` (all, part or none of it) from where we keep it, refund the rest, and say
 * so in a delivery note. `payFrom` is our account; `fromAt` where the goods are. If the delivery is refused (the place
 * it was to go is gone, say), the whole order is refunded instead.
 */
export function fill(o: Order, quantity: number, fromAt: string, payFrom: string, why: string): Step {
  const s = fillAs(o, quantity, fromAt, payFrom, why);
  if (quantity > 0) s.then = (out) => (out.status === "refused" ? [fillAs(o, 0, fromAt, payFrom, `We couldn't deliver order ${o.id} (${out.refusal?.detail ?? out.refusal?.code}): refunding it.`)] : undefined);
  return s;
}

function fillAs(o: Order, quantity: number, fromAt: string, payFrom: string, why: string): Step {
  const refund = (o.quantity - quantity) * o.unitPrice;
  const s: Step = because(why);
  if (quantity > 0) s.push(C.call("goods", { kind: o.kind, quantity: C.text(String(quantity)), to: o.to, at: o.at, from_at: fromAt }));
  if (refund > 0) s.push(pay(o.account, refund, { from: payFrom, for: `Refund: ${o.quantity - quantity} ${o.kind} we couldn't deliver.` }));
  s.push(say("delivery_note", quantity === o.quantity
    ? `Delivered: ${quantity} ${o.kind} to ${o.to} at ${o.at}.`
    : `Delivered ${quantity} of the ${o.quantity} ${o.kind} ordered${refund ? `; ${usd(refund)} refunded` : ""}.`, {
    to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id,
    data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: quantity, refund },
  }));
  return s;
}

/** An order declined unpaid: a note saying so. */
export function decline(o: Order, why: string): Step {
  return because(why, say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } }));
}
