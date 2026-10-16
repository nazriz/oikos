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
import { basesOf, channels } from "../contracts";
import { cents } from "../money";
import { because, type Book, DAY, Latest, pay, record, say, type Step, usd } from "./common";

/** An order, as the seller reads it. */
export interface Order { id: string; seller: string; buyer: string; kind: string; quantity: number; unitPrice: number; to: string; at: string; account: string; placed: number;
  /** The days the order is for, as the buyer says (a fortnight's shopping): served over that time. */
  forDays?: number;
  /** Bought on the seller's terms: the days after delivery it is to be paid within (the order carries no payment). */
  terms?: number }

const goodsLists = new Latest("price_list", (r) => r.data?.goods);
/** A seller's standing offer, if its latest price list that is one makes one (a list of one kind of goods). */
const offerLists = new Latest("price_list", (r) => r.offer);
export const offerOf = (book: Book, seller: string) => offerLists.of(book, seller)?.offer;

/** A seller's current prices for goods (its latest standing price list), the account it's paid into, the least it
 * sells in one order (a wholesaler's minimum), and where it is (a shop's premises, for collection). */
export function goodsPrices(book: Book, seller: string): { prices: { [kind: string]: number }; account?: string; min_order?: number; at?: string; terms_days?: number } {
  const list = goodsLists.of(book, seller);
  const terms = Number(list?.data?.terms_days);
  return { prices: (list?.data?.goods as { [kind: string]: number }) ?? {}, account: list?.data?.account, min_order: list?.data?.min_order, at: list?.data?.at, ...(Number.isInteger(terms) && terms > 0 ? { terms_days: terms } : {}) };
}

/** What the entity holds of a kind at a place (its holdings channel), as a number. */
export function held(obs: Observation, at: string, kind: string): number {
  const h = channels.holdings(obs).find((x) => x.at === at && x.kind === kind);
  return h ? Number(h.quantity) : 0;
}

/** Publishing (or republishing) a price list: the kinds of goods sold and their unit prices, and where to pay. */
/** `on`: the cell it is put up on (a shop's prices in its window: seen by those who pass, not sent to the town). */
export function priceList(prices: { [kind: string]: number }, account: string, text: string, extra: { min_order?: number; [k: string]: unknown } = {}, seller?: string, on?: string): C.Call {
  // With one kind of goods, it's also an offer (docs/design/ai-citizens.md 2a): order, pay the unit price, and the goods
  // are delivered, per unit. (A list of several kinds isn't one offer: those are left as lists for now.)
  const kinds = Object.keys(prices);
  const k = kinds[0]!;
  const offer: Offer | undefined = seller && kinds.length === 1 && prices[k]! > 0 ? { by: seller, take_up: "order", terms: { commitments: [
    { who: "taker", does: { outcome: { money: { to: account, amount: String(prices[k]), for: k } } }, per: "unit" },
    { who: seller, does: { outcome: { goods: { kind: k, quantity: "1" } } }, per: "unit" },
  ] } } : undefined;
  return say("price_list", text, { visible: "public", data: { goods: prices, account, ...extra }, ...(offer ? { offer } : {}), ...(on ? { on } : {}) });
}

/**
 * An order for goods, paid with the order in the same act. `from` is the buyer's paying account; `sellerAccount`
 * the one the seller's price list names.
 */
export function order(o: { me: string; seller: string; sellerAccount: string; kind: string; quantity: number; unitPrice: number; to?: string; at: string; from: string; why: string; ref?: string; retryOf?: string; forDays?: number;
  /** On the seller's terms (docs/behaviour/trade.md, "Trade credit"): to be paid this many days after delivery, and nothing paid with the order. */
  terms?: number }): Step {
  const to = o.to ?? o.me;
  const total = o.quantity * o.unitPrice;
  if (o.terms) return because(o.why,
    [o.ref ?? "order", say("order", `Order: ${o.quantity} ${o.kind} at ${usd(o.unitPrice)} each (${usd(total)}), delivered to ${to} at ${o.at}. To be paid within ${o.terms} days of delivery, on your terms.`, {
      to: [o.seller], visible: [o.me, o.seller],
      data: { kind: o.kind, quantity: o.quantity, unit_price: o.unitPrice, deliver_to: to, at: o.at, account: o.from, pay_in_days: o.terms, ...(o.retryOf ? { retry_of: o.retryOf } : {}) },
    })]);
  return because(o.why,
    [o.ref ?? "order", say("order", `Order: ${o.quantity} ${o.kind} at ${usd(o.unitPrice)} each (${usd(total)}), delivered to ${to} at ${o.at}. Paid with this order.`, {
      to: [o.seller], visible: [o.me, o.seller],
      data: { kind: o.kind, quantity: o.quantity, unit_price: o.unitPrice, deliver_to: to, at: o.at, account: o.from, ...(o.retryOf ? { retry_of: o.retryOf } : {}), ...(o.forDays ? { for_days: o.forDays } : {}) },
    })],
    pay(o.sellerAccount, total, { from: o.from, for: `Order: ${o.quantity} ${o.kind}.` }),
  );
}

/**
 * Money promised to the bank in orders it has not yet paid out. An order is paid with a request to our bank, which pays
 * in its own batch (hours later); until then the balance we read has not fallen. A buyer that woke again meanwhile (it
 * wakes after each act) and spent "what's left" spent the same money again. `owed` is what such requests still hold;
 * `take` clears them as payments out of our account to the seller are seen (new transactions each observation), and
 * drops any older than `forDays` (a payment we never saw: don't hold money for ever).
 */
export class Committed {
  private readonly open: { to: string; amount: number; at: number }[] = [];
  constructor(private readonly forDays = 3) {}
  add(to: string, amount: number, at: number) {
    this.open.push({ to, amount, at });
  }
  /** Take back an order that was not made. */
  undo(to: string, amount: number) {
    const i = this.open.findIndex((x) => x.to === to && x.amount === amount);
    if (i >= 0) this.open.splice(i, 1);
  }
  take(obs: Observation, account: string | undefined) {
    if (account) {
      for (const tx of channels.transactions(obs)) {
        if (tx.from !== account) continue;
        const i = this.open.findIndex((x) => x.to === tx.to && x.amount === cents(tx.amount));
        if (i >= 0) this.open.splice(i, 1);
      }
    }
    for (let i = this.open.length - 1; i >= 0; i--) if (obs.t - this.open[i]!.at >= this.forDays * DAY) this.open.splice(i, 1);
  }
  get owed() {
    return this.open.reduce((x, o) => x + o.amount, 0);
  }
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
/** What a seller that sells on terms (docs/behaviour/trade.md, "Trade credit") says of them: the days it gives to pay,
 * how long after the day an unpaid buyer is supplied no more on terms, and how long after it the debt is recorded. */
export interface SellingTerms { days: number; stop_after_days: number; claim_after_days: number }

/** What a seller is owed for goods delivered on its terms and not yet paid for. */
export interface Receivable { order: string; account: string; buyer: string; kind: string; quantity: number; amount: number; since: number; days: number }

const INVOICE = /^Invoice (\S+?):/;
const OTHER_ROLE = /^(Dividend|Income tax|Tax\b|Capital\b)/i; // (what a payment to a seller's account says when it is paid to its shareholder or its collector, or is a founder's capital put into a business of their own)

export class OrderBook {
  private readonly credit = new Map<string, number>(); // paying account -> money received not yet set against an order
  private readonly invoiced = new Map<string, number>(); // order -> paid against its invoice (the payment's memo names the order)
  private receivables: Receivable[] = [];
  private readonly claimed = new Map<string, string>(); // a debt we recorded (its claim) -> the buyer's account, until it is paid
  private readonly claimedAccounts = new Map<string, number>(); // buyer's account -> debts of ours it has not paid
  private readonly settled = new Set<string>();
  private readonly customers = new Set<string>(); // accounts that have ordered from us
  private readonly waiting = new Map<string, Order>(); // orders to us not yet settled
  private cursor = 0; // how far through the orders seen we've read (only new ones are read: no rescanning)
  constructor(private readonly me: string, private readonly unpaidDays = 7, private readonly sells: SellingTerms | null = null) {}

  take(obs: Observation, account: string | undefined) {
    if (!account) return;
    for (const tx of channels.transactions(obs)) {
      if (tx.to !== account || tx.from === account) continue;
      const x = cents(tx.amount);
      // Payment of a debt we recorded: it settles that claim, and is no order's payment.
      if (tx.settles && this.claimed.has(tx.settles)) {
        const from = this.claimed.get(tx.settles)!;
        this.claimed.delete(tx.settles);
        this.claimedAccounts.set(from, Math.max(0, (this.claimedAccounts.get(from) ?? 1) - 1));
        continue;
      }
      // Payment of an invoice (goods delivered on our terms): the memo names the order.
      const inv = INVOICE.exec(tx.memo ?? "");
      if (inv && this.receivables.some((r) => r.order === inv[1])) {
        this.invoiced.set(inv[1]!, (this.invoiced.get(inv[1]!) ?? 0) + x);
        continue;
      }
      // A payment that says it is a dividend or a tax is not money for an order, and is not sent back as a mistake. Until
      // 2026-10-12 every payment into a seller's account that no invoice named was counted as a payment for an order, and
      // an account that had ordered and had none waiting had it returned: dividends to the outside world and the tax a
      // factory withheld were returned to the factory (docs/decisions.md, "The leftovers of the firm-side work"). The
      // world's account is a market, a shareholder and a collector of tax at once; a payment that names one of the other
      // two is that, whoever else the payer has dealt with. (A payment that says something else, or nothing, is judged as
      // before: a payment with no order is returned.)
      if (OTHER_ROLE.test(tx.memo ?? "")) continue;
      this.credit.set(tx.from, (this.credit.get(tx.from) ?? 0) + x);
    }
  }

  /** Goods delivered on terms: what we are now owed, and from when. */
  bill(o: Order, quantity: number, t: number) {
    if (!o.terms || quantity <= 0) return;
    this.receivables.push({ order: o.id, account: o.account, buyer: o.buyer, kind: o.kind, quantity, amount: quantity * o.unitPrice, since: t, days: o.terms });
  }

  /** What we are owed and has not been paid, and what is past its day. */
  owedTo(): Receivable[] {
    this.receivables = this.receivables.filter((r) => (this.invoiced.get(r.order) ?? 0) < r.amount);
    return this.receivables;
  }

  /** Whether a buyer's account is one we supply no more on terms: it has not paid what it owed by `stop_after_days` after the day, or has a debt of ours unpaid. */
  stopped(account: string, t: number): boolean {
    if (!this.sells) return false;
    return (this.claimedAccounts.get(account) ?? 0) > 0 || this.owedTo().some((r) => r.account === account && t > r.since + (r.days + this.sells!.stop_after_days) * DAY);
  }

  /** A buyer who has not paid `claim_after_days` after the day: the debt recorded against it (a claim, as a lender's on a default is), to be
   * paid as any debt recorded against a firm is (docs/behaviour/insolvency.md). */
  collect(t: number, sellerAccount: string): Step[] {
    if (!this.sells) return [];
    const steps: Step[] = [];
    for (const r of [...this.owedTo()]) {
      if (t <= r.since + (r.days + this.sells.claim_after_days) * DAY) continue;
      this.receivables = this.receivables.filter((x) => x !== r);
      const owing = r.amount - (this.invoiced.get(r.order) ?? 0);
      this.claimedAccounts.set(r.account, (this.claimedAccounts.get(r.account) ?? 0) + 1);
      const st = because(`${r.buyer} has not paid for the ${r.quantity} ${r.kind} we delivered on terms (order ${r.order}, ${usd(owing)}), ${Math.floor((t - r.since) / DAY - r.days)} days past the day: recording the debt against them.`,
        // (Bound as `claim`, so the world tells us the claim's id: a payment that settles it is then known for what it is.)
        ["claim", record("right", this.me, { kind: "debt", amount: owing, account: sellerAccount, for: `${r.quantity} ${r.kind} delivered on terms, order ${r.order}: unpaid.` }, { against: r.buyer, basis: r.order })]);
      st.then = (out) => { const id = out.created?.claim; if (id) this.claimed.set(id, r.account); };
      steps.push(st);
    }
    return steps;
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
        ...(Number.isInteger(r.data?.pay_in_days) && Number(r.data?.pay_in_days) > 0 ? { terms: Number(r.data!.pay_in_days) } : {}),
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
  due(book: Book, t: number, accept: (o: Order) => boolean = () => true): { paid: Order[]; unpaid: Order[]; stopped: Order[] } {
    const paid: Order[] = [];
    const unpaid: Order[] = [];
    const stopped: Order[] = [];
    let full = false;
    for (const o of this.open(book)) {
      const total = o.quantity * o.unitPrice;
      const have = this.credit.get(o.account) ?? 0;
      this.customers.add(o.account);
      // On our terms (if we sell on any): supplied against its promise, unless it has not paid what it owed us.
      if (o.terms && this.sells && total > 0) {
        this.settled.add(o.id);
        (this.stopped(o.account, t) ? stopped : paid).push(o);
        continue;
      }      if (total > 0 && have >= total) {
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
    return { paid, unpaid, stopped };
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
  // (On terms nothing was paid, so nothing is refunded: the invoice is for what was delivered.)
  const refund = o.terms ? 0 : (o.quantity - quantity) * o.unitPrice;
  const s: Step = because(why);
  if (quantity > 0) s.push(C.call("goods", { kind: o.kind, quantity: C.text(String(quantity)), to: o.to, at: o.at, from_at: fromAt }));
  if (refund > 0) s.push(pay(o.account, refund, { from: payFrom, for: `Refund: ${o.quantity - quantity} ${o.kind} we couldn't deliver.` }));
  s.push(say("delivery_note", (quantity === o.quantity
    ? `Delivered: ${quantity} ${o.kind} to ${o.to} at ${o.at}.`
    : `Delivered ${quantity} of the ${o.quantity} ${o.kind} ordered${refund ? `; ${usd(refund)} refunded` : ""}.`) + (o.terms && quantity > 0 ? ` Invoice: ${usd(quantity * o.unitPrice)}, to be paid within ${o.terms} days, into ${payFrom}, naming the order (${o.id}).` : ""), {
    to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id,
    data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: quantity, refund,
      ...(o.terms && quantity > 0 ? { owed: quantity * o.unitPrice, pay_in_days: o.terms, pay_to: payFrom } : {}) },
  }));
  return s;
}

/** An order declined unpaid: a note saying so. */
export function decline(o: Order, why: string): Step {
  return because(why, say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, o.seller], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } }));
}

/** A seller's note that it will not supply an order on terms: the buyer has not paid what it owed. */
export function declineOnTerms(o: Order, me: string, why: string): Step {
  return because(why, say("delivery_note", `Order ${o.id} declined: ${o.buyer} has not paid what it owed on our terms.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "overdue" } }));
}

/**
 * A buyer's side of trade on terms: what it owes suppliers for goods delivered and invoiced (the delivery note says what,
 * how long to pay and where), paid on the day, wages first. A buyer that is behind with a supplier buys from it on terms no
 * more (the supplier will not supply it), and one the supplier has recorded a debt against pays that debt, not the invoice.
 */
export class Payables {
  private cursor = 0;
  private open: { order: string; seller: string; account: string; kind: string; quantity: number; amount: number; due: number }[] = [];
  private readonly refused = new Map<string, number>(); // seller -> when it last told us it would supply us on terms no more
  private sent: { t: number; amount: number }[] = []; // payments we have asked our bank for, which has not yet paid them out (its batch is hours later)
  constructor(private readonly me: string) {}

  /** What invoices we asked our bank to pay in the last few days come to: the balance we read has not yet fallen by it. */
  pending(t: number): number {
    this.sent = this.sent.filter((x) => t - x.t < 3 * DAY);
    return this.sent.reduce((x, y) => x + y.amount, 0);
  }

  /** Invoices on the delivery notes addressed to us (only new ones are read); debts recorded against us for an order ours are paid as debts. */
  take(book: Book) {
    const notes = book.all("delivery_note");
    for (; this.cursor < notes.length; this.cursor++) {
      const n = notes[this.cursor]!;
      if (!(n.addressed_to ?? []).includes(this.me)) continue;
      // Told it is supplied on terms no more (it has not paid what it owed): it asks for none from that seller for a while.
      if (n.data?.declined === "overdue" && n.speaks_for) this.refused.set(n.speaks_for, n.at);
      const owed = Number(n.data?.owed), days = Number(n.data?.pay_in_days);
      if (!(owed > 0) || !(days > 0) || typeof n.data?.pay_to !== "string") continue;
      this.open.push({ order: String(n.data?.order), seller: n.speaks_for!, account: n.data.pay_to as string, kind: String(n.data?.kind), quantity: Number(n.data?.delivered) || 0, amount: owed, due: n.at + days * DAY });
    }
    if (this.open.length) {
      const claimed = new Set((book.ofType("claim") as any[]).filter((c) => c.counterparty === this.me && c.about?.kind === "debt").flatMap((c) => basesOf(c)));
      this.open = this.open.filter((x) => !claimed.has(x.order));
    }
  }

  /** What we owe suppliers, in all. */
  get owing(): number {
    return this.open.reduce((x, o) => x + o.amount, 0);
  }

  /** Whether we are behind with a supplier (an invoice past its day), or it has lately told us it supplies us on terms no more
   * (`retry_days` after which we try again). */
  behind(seller: string, t: number, retry_days = 30): boolean {
    return this.open.some((o) => o.seller === seller && t > o.due) || t - (this.refused.get(seller) ?? -Infinity) < retry_days * DAY;
  }

  /** Closing or winding up: every invoice we owe, due or not, oldest first, while the account covers it. What was paid, and the steps. */
  settle(t: number, from: string, balance: number): { steps: Step[]; paid: number } {
    const lines = this.pay(t, from, balance, 0, undefined, true);
    return { steps: lines, paid: this.sentNow };
  }
  private sentNow = 0;

  /** Invoices that have fallen due, oldest first, paid while we can and keep `keep` in hand (the next pay day's wages come first). */
  pay(t: number, from: string, balance: number, keep: number, committed?: Committed, all = false): Step[] {
    const lines: Step[] = [];
    this.sentNow = 0;
    let left = balance - keep - this.pending(t);
    for (const o of [...this.open].sort((a, b) => a.due - b.due || (a.order < b.order ? -1 : 1))) {
      if ((!all && o.due > t) || o.amount > left) continue;
      left -= o.amount;
      this.sentNow += o.amount;
      this.open = this.open.filter((x) => x !== o);
      this.sent.push({ t, amount: o.amount });
      committed?.add(o.account, o.amount, t);
      lines.push(because(`Our invoice for ${o.quantity} ${o.kind} from ${o.seller} (order ${o.order}) falls due: paying ${usd(o.amount)}${t - o.due >= DAY ? `, ${Math.floor((t - o.due) / DAY)} days late` : ""}.`,
        pay(o.account, o.amount, { from, for: `Invoice ${o.order}: ${o.quantity} ${o.kind}.` })));
    }
    return lines;
  }
}
