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
import type { Observation, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { because, type Book, DAY, pay, say, type Step, usd } from "./common";
import { receipts } from "./firms";

/** An order, as the seller reads it. */
export interface Order { id: string; seller: string; buyer: string; kind: string; quantity: number; unitPrice: number; to: string; at: string; account: string; placed: number }

/** A seller's current prices for goods (its latest standing price list), and the account it's paid into. */
export function goodsPrices(book: Book, seller: string): { prices: { [kind: string]: number }; account?: string } {
  const list = book.open("price_list").filter((r) => r.speaks_for === seller && r.data?.goods).sort((a, b) => b.at - a.at)[0];
  return { prices: (list?.data?.goods as { [kind: string]: number }) ?? {}, account: list?.data?.account };
}

/** What the entity holds of a kind at a place (its holdings channel), as a number. */
export function held(obs: Observation, at: string, kind: string): number {
  const h = channels.holdings(obs).find((x) => x.at === at && x.kind === kind);
  return h ? Number(h.quantity) : 0;
}

/** Publishing (or republishing) a price list: the kinds of goods sold and their unit prices, and where to pay. */
export function priceList(prices: { [kind: string]: number }, account: string, text: string, extra: object = {}): C.Call {
  return say("price_list", text, { visible: "public", data: { goods: prices, account, ...extra } });
}

/**
 * An order for goods, paid with the order in the same act. `from` is the buyer's paying account; `sellerAccount`
 * the one the seller's price list names.
 */
export function order(o: { me: string; seller: string; sellerAccount: string; kind: string; quantity: number; unitPrice: number; to?: string; at: string; from: string; why: string; ref?: string }): Step {
  const to = o.to ?? o.me;
  const total = o.quantity * o.unitPrice;
  return because(o.why,
    [o.ref ?? "order", say("order", `Order: ${o.quantity} ${o.kind} at ${usd(o.unitPrice)} each (${usd(total)}), delivered to ${to} at ${o.at}. Paid with this order.`, {
      to: [o.seller], visible: [o.me, o.seller],
      data: { kind: o.kind, quantity: o.quantity, unit_price: o.unitPrice, deliver_to: to, at: o.at, account: o.from },
    })],
    pay(o.sellerAccount, total, { from: o.from, for: `Order: ${o.quantity} ${o.kind}.` }),
  );
}

/** Delivery notes addressed to us (the answers to our orders), not yet read: which order, how much came, what was refunded. */
export class Deliveries {
  private read = new Set<string>();
  take(book: Book, me: string): { order: string; delivered: number; refund: number; seller: string }[] {
    const out = [];
    for (const n of book.all("delivery_note")) {
      if (this.read.has(n.id) || !(n.addressed_to ?? []).includes(me)) continue;
      this.read.add(n.id);
      out.push({ order: n.data?.order as string, delivered: (n.data?.delivered as number) ?? 0, refund: (n.data?.refund as number) ?? 0, seller: n.speaks_for! });
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
  constructor(private readonly me: string, private readonly unpaidDays = 7) {}

  take(obs: Observation, account: string | undefined) {
    if (account) for (const [from, amount] of receipts(obs, account)) this.credit.set(from, (this.credit.get(from) ?? 0) + amount);
  }

  /** Open orders to us, oldest first, as orders. */
  private open(book: Book): Order[] {
    return book.open("order")
      .filter((r) => (r.addressed_to ?? []).includes(this.me) && !this.settled.has(r.id))
      .map((r: StatementRecord) => ({
        id: r.id, seller: this.me, buyer: r.speaks_for!, kind: String(r.data?.kind), quantity: Math.max(0, Math.floor(Number(r.data?.quantity) || 0)), unitPrice: Math.max(0, Math.floor(Number(r.data?.unit_price) || 0)),
        to: String(r.data?.deliver_to ?? r.speaks_for), at: String(r.data?.at), account: String(r.data?.account), placed: r.at,
      }))
      .sort((a, b) => a.placed - b.placed || (a.id < b.id ? -1 : 1));
  }

  /** Orders paid in full (their payment set against them), and orders that have waited unpaid too long (dropped). */
  due(book: Book, t: number): { paid: Order[]; unpaid: Order[] } {
    const paid: Order[] = [];
    const unpaid: Order[] = [];
    for (const o of this.open(book)) {
      const total = o.quantity * o.unitPrice;
      const have = this.credit.get(o.account) ?? 0;
      this.customers.add(o.account);
      if (total > 0 && have >= total) {
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

  /** Returning unclaimed money (a refund): forget it once paid back. */
  refunded(account: string) {
    this.credit.delete(account);
  }
}

/**
 * Filling a paid order: deliver `quantity` (all, part or none of it) from where we keep it, refund the rest, and say
 * so in a delivery note. `payFrom` is our account; `fromAt` where the goods are.
 */
export function fill(o: Order, quantity: number, fromAt: string, payFrom: string, why: string): Step {
  const refund = (o.quantity - quantity) * o.unitPrice;
  const s: Step = because(why);
  if (quantity > 0) s.push(C.call("goods", { kind: o.kind, quantity: C.text(String(quantity)), to: o.to, at: o.at, from_at: fromAt }));
  if (refund > 0) s.push(pay(o.account, refund, { from: payFrom, for: `Refund: ${o.quantity - quantity} ${o.kind} we couldn't deliver.` }));
  s.push(say("delivery_note", quantity === o.quantity
    ? `Delivered: ${quantity} ${o.kind} to ${o.to} at ${o.at}.`
    : `Delivered ${quantity} of the ${o.quantity} ${o.kind} ordered${refund ? `; ${usd(refund)} refunded` : ""}.`, {
    to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id,
    data: { order: o.id, kind: o.kind, delivered: quantity, refund },
  }));
  return s;
}

/** An order declined unpaid: a note saying so. */
export function decline(o: Order, why: string): Step {
  return because(why, say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id, data: { order: o.id, kind: o.kind, delivered: 0, refund: 0, declined: "unpaid" } }));
}
