// firm.retailer: a shop, after Lengnick (2013), with wholesale buying and serving (phase B). Documented in
// docs/behaviour/retailer.md, with sources.

import * as C from "../calls";
import { cents } from "../money";
import type { Observation } from "../contracts";
import { channels } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, publishedPrice as buildingPrice, DAY, MONTH, ownAccount, pay, say, type Step, usd, withdraw } from "./common";
import { Staffing, stepper, WindingUp } from "./firms";
import { Borrowing } from "./credit";
import { distribute, LENGNICK, movePrice, moveWage, payOut } from "./lengnick";
import { Deliveries, goodsPrices, held, order, OrderBook, priceList, UNDELIVERABLE, type Order } from "./trade";

/**
 * A shop. It buys goods from the cheapest of its suppliers (local factories' wholesale, or the world market's imports)
 * to keep its stock within Lengnick's band of its sales, and sells them to whoever orders and pays. Selling takes its
 * staff's time: each item is a unit of the task `serve`, by the staff at the shop, each up to a working day; what they
 * can't serve today waits for tomorrow. Monthly: its price moves within bounds set by marginal cost (the wholesale
 * price plus the hours of serving), its headcount moves a worker at a time towards what its sales need, and what it
 * holds beyond its buffer, out of the month's earnings, goes to its shareholders.
 */
export const retailer: BehaviourModule = {
  name: "firm.retailer",
  version: "0.2.0",
  doc: "docs/behaviour/retailer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        premises: "", // the shop: where it keeps and sells things
        workplace: "", // the space its staff work in
        role: "shop assistant",
        max_staff: 6,
        min_staff: 1,
        kind: "goods",
        serve_task: "serve",
        serve_labour: 5400, // seconds of work to serve an item
        suppliers: [] as string[], // whom it may buy from (their price lists)
        wage: 120_000, // the wage it offers new hires, cents per period
        period: 14 * DAY,
        notice_days: 14,
        working_day: 8 * 3600,
        work_days: 6, // of every 7: shops open on Saturdays
        price: 9000, // its opening retail price, cents each
        demand: 250, // what it expects to sell in a month, before it knows
        unpaid_days: 7,
        serve_within_days: 3, // what isn't served within this is refunded (the customer goes elsewhere)
        lender: "bank", // whom it borrows from
        // Insolvency (docs/behaviour/insolvency.md; placeholders): short of wages this long with no credit, or in default on
        // a loan, and it winds up over this long.
        short_days: 60,
        wind_up_days: 60,
        idle_days: 90, // nobody working for us this long, our owners close us (placeholder)
        reprice_days: 30, // closed, our premises unsold this long: the asking price comes down (placeholder)
        reprice_bps: 1000, // by this much (placeholder)
        builder: "builder", // whose published prices say what our premises are worth
        premises_sale_bps: 5000,
        // A shop just founded (docs/behaviour/entry.md): who founded it, the capital they put in, the property listing it
        // buys its premises from, and its bank. None: a shop that's trading already.
        founder: null as string | null,
        capital: 0,
        listing: null as string | null,
        bank: "bank", // closed, our premises are offered at this share of what building them new costs (placeholder)
        ...LENGNICK, // Lengnick (2013), Table 1
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role });
    const borrowing = new Borrowing(me, p.lender);
    const winding = new WindingUp(me, { short_days: p.short_days, wind_up_days: p.wind_up_days, idle_days: p.idle_days, reprice_days: p.reprice_days, reprice_bps: p.reprice_bps });
    // Our premises, as the sites we see show them (for selling them if we close).
    const premisesOf = (obs: Observation) => {
      const c = channels.cells(obs).find((x) => x.structure?.structure === p.premises);
      return c?.structure ? { structure: c.structure.structure, type: c.structure.type, cell: c.cell } : undefined;
    };

    const orders = new OrderBook(me, p.unpaid_days);
    const deliveries = new Deliveries();
    let onOrder = 0; // goods ordered from suppliers, not yet delivered
    const ours = new Map<string, { seller: string; quantity: number }>(); // our order -> for how many, from whom
    const shortAt = new Map<string, number>(); // supplier -> when it last came up short
    let unitCost = 0; // what we last paid a supplier for an item
    const used = new Map<string, number>(); // worker -> seconds worked today
    let usedDay = -1;
    let wage = p.wage;
    let price = p.price;
    let publishedPrice = -1;
    let priceWhy = "";
    let month = -1;
    let sold = 0; // this month: items customers ordered and paid for (served or not): what they wanted
    const queue: { o: Order; served: number; since: number }[] = []; // paid orders being served, oldest first
    let lastDemand: number = p.demand;
    let fullMonths = 0;
    let headcount = -1;
    let headcountWhy = "";
    let monthStart = -1;
    let nextRestock = 0;
    // Setting up (a shop just founded): our account asked for, the capital called, the premises bought.
    const setup = { accountAsked: false, capitalCalled: false, founderAccount: undefined as string | undefined, registered: false, purchased: false, ready: !p.founder };
    const workDay = (t: number) => Math.floor(t / DAY) % 7 < p.work_days;
    const hoursPerWorkerMonth = (p.working_day * p.work_days * 30) / 7;
    /** Room in our workplace now: its capacity less the bodies in it. */
    const roomAtWork = (obs: Observation) => {
      const sp = channels.cells(obs).find((c) => c.structure?.structure === p.premises)?.structure?.spaces.find((x) => x.kind === "workplace");
      return sp ? sp.capacity - sp.count : p.max_staff;
    };
    const hourly = () => Math.ceil((wage * 3600) / ((p.period / DAY) * (p.work_days / 7) * p.working_day));

    /** Setting up a shop just founded: an account at the bank; the founder's capital; our shareholders (the founder);
     * the premises bought from the property listing. If someone else buys them first, the capital goes back and we close. */
    function settingUp(obs: Observation, acc: ReturnType<typeof ownAccount>): Step[] {
      if (!acc) {
        if (setup.accountAsked) return [];
        setup.accountAsked = true;
        return [because("A new shop: opening our account at the bank.", C.call("account", { holder: me, at: p.bank }))];
      }
      if (!setup.capitalCalled) {
        setup.capitalCalled = true;
        return [because(`A new shop: asking our founder for the ${usd(p.capital)} of capital they're putting in.`, say("capital_call", `Please pay the ${usd(p.capital)} of capital into ${acc.account}.`, { to: [p.founder!], visible: [me, p.founder!], data: { account: acc.account, amount: p.capital } }))];
      }
      const steps: Step[] = [];
      if (setup.founderAccount && !setup.registered) {
        setup.registered = true;
        steps.push(because("Our shareholders: our founder, who put in the capital.", say("shareholders", `The shareholders of ${me}, and their shares.`, { to: [p.founder!], visible: [me, p.founder!], data: { holders: [{ holder: p.founder, account: setup.founderAccount, shares: 10_000 }] } })));
      }
      // The listing we founded ourselves to buy from; if the seller has published it again (at a new price), that one.
      const first = p.listing ? book.records.get(p.listing) : undefined;
      const structure = first?.record === "statement" ? first.data?.structure : undefined;
      const relisted = book.open("property_for_sale").filter((r) => r.data?.structure === structure).sort((a, b) => b.at - a.at)[0];
      const listing = relisted ?? first;
      const sold = book.all("property_sold").find((r) => structure && r.data?.structure === structure);
      if (sold && sold.data?.buyer === me) {
        setup.ready = true;
        return [...steps, because(`Our premises (${sold.data.structure}) are ours: opening for trade.`)];
      }
      if (sold || (listing && book.withdrawn.has(listing.id))) {
        // Someone else bought them: the capital goes back, and we close.
        winding.state = "closed";
        return [...steps, because("The premises we meant to buy were sold to someone else: returning the capital, and closing.",
          ...(setup.founderAccount && acc.balance > 0 ? [pay(setup.founderAccount, acc.balance, { from: acc.account, for: "Capital returned: the venture didn't go ahead." })] : []),
          say("closure", `${me} didn't open: its premises were sold to someone else.`, { visible: "public", data: { firm: me, to_creditors: 0, to_shareholders: acc.balance } }))];
      }
      const price = listing?.record === "statement" ? (listing.data?.price as number) : undefined;
      if (listing?.record === "statement" && price !== undefined && !setup.purchased && acc.balance >= price) {
        setup.purchased = true;
        steps.push(because(`Buying our premises (${listing.data.structure}) at the ${usd(price)} asked: publishing our purchase, and paying with it.`,
          say("property_purchase", `Purchase of ${listing.data.structure}, as listed.`, { to: [listing.speaks_for!], visible: [me, listing.speaks_for!], basis: listing.id, data: { listing: listing.id, account: acc.account } }),
          pay(listing.data.account, price, { from: acc.account, for: `Premises: ${listing.data.structure}.` })));
      }
      return steps;
    }

    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        winding.absorb(obs, ownAccount(obs)?.account);
        // Setting up: the founder's capital, as it arrives (the account it comes from is theirs).
        const mine = ownAccount(obs)?.account;
        if (!setup.ready && setup.capitalCalled && !setup.founderAccount && mine) for (const tx of channels.transactions(obs)) if (tx.to === mine && tx.from !== mine) setup.founderAccount = tx.from;
        orders.take(obs, ownAccount(obs)?.account);
        for (const d of deliveries.take(book, me)) {
          const o = ours.get(d.order);
          if (!o) continue;
          ours.delete(d.order);
          onOrder = Math.max(0, onOrder - o.quantity);
          if (d.delivered < o.quantity) shortAt.set(o.seller, obs.t);
        }
      },
      (obs) => {
        const t = obs.t;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        if (acc && winding.state === "closed") {
          const where = premisesOf(obs);
          const worth = where ? buildingPrice(book, p.builder, where.type) : undefined;
          return winding.sell(obs, book, acc.account, acc.balance, where, worth ? Math.floor((worth * p.premises_sale_bps) / 10_000) : undefined, (x) => distribute(book, me, acc.account, x, "The proceeds of our premises: to our shareholders by their shares").steps);
        }
        // A shop just founded sets itself up before it trades.
        if (!setup.ready) return settingUp(obs, acc);
        if (!acc) return steps;
        if (winding.due(t)) return winding.finish(t, book, acc.account, acc.balance, (x) => distribute(book, me, acc.account, x, "Wound up: what's left, to our shareholders by their shares").steps);
        const trading = winding.state === "trading";
        const workers = staffing.workers(book, t);
        if (headcount < 0) headcount = Math.max(workers.length, p.min_staff); // (a new shop starts by hiring its minimum)
        if (monthStart < 0) monthStart = acc.balance;
        const stock = held(obs, p.premises, p.kind);
        // Our suppliers' prices, cheapest first (and those that came up short in the last week, last).
        const offers = p.suppliers.map((s) => ({ seller: s, ...goodsPrices(book, s) })).filter((x) => x.prices[p.kind] !== undefined && x.account)
          .map((x) => ({ seller: x.seller, account: x.account!, unit: x.prices[p.kind]!, min: x.min_order ?? 1 }))
          .sort((a, b) => Number(t - (shortAt.get(a.seller) ?? -Infinity) < 7 * DAY) - Number(t - (shortAt.get(b.seller) ?? -Infinity) < 7 * DAY) || a.unit - b.unit || (a.seller < b.seller ? -1 : 1));
        if (!unitCost && offers.length) unitCost = offers[0]!.unit;
        const marginalCost = unitCost + Math.ceil((hourly() * p.serve_labour) / 3600);

        // ---- the month's end: Lengnick's rules ----
        const m = Math.floor(t / MONTH);
        if (month < 0) month = m;
        if (m !== month && trading) {
          month = m;
          lastDemand = sold;
          sold = 0;
          const rng = ctx.rng(`month-${m}`);
          const why: string[] = [];
          const posts = staffing.postings(book);
          const w = moveWage(p, rng, wage, { unfilled: posts.some((x) => t - x.at >= MONTH), posting: posts.length > 0, staffed: workers.length > 0, fullMonths });
          wage = w.wage;
          fullMonths = w.fullMonths;
          if (w.why) why.push(w.why);
          const moved = movePrice(p, rng, price, stock, lastDemand, marginalCost);
          price = moved.price;
          if (moved.why) priceWhy = moved.why;
          // Headcount: a worker at a time towards the hands last month's sales needed.
          const needed = Math.min(p.max_staff, Math.max(p.min_staff, Math.ceil((lastDemand * p.serve_labour) / hoursPerWorkerMonth)));
          headcount = workers.length;
          headcountWhy = why.length ? `; ${why.join("; ")}` : "";
          if (needed > workers.length) {
            headcount = workers.length + 1;
            headcountWhy = `: last month's sales (${lastDemand}) needed ${needed} hands to serve${headcountWhy}`;
          } else if (needed < workers.length) {
            headcount = workers.length - 1;
            steps.push(...staffing.letGo(book, t, `Month's end: last month's sales (${lastDemand}) needed ${needed} hands to serve, and we have ${workers.length}: letting one go.`, "Redundancy: there isn't the trade."));
          }
          // Out of the month's earnings, what we hold beyond the buffer goes to the shareholders: a month's wages, a
          // month's stock at cost, and Lengnick's chi of the wage bill.
          const bill = Math.floor((Math.max(workers.length, headcount) * wage * MONTH) / p.period);
          const buffer = bill + lastDemand * unitCost + Math.floor((bill * p.chi_bps) / 10_000);
          const out = payOut(book, me, acc.account, acc.balance, buffer, acc.balance - monthStart, `a month's wages and stock, and ${p.chi_bps / 100}% of the wage bill`);
          monthStart = acc.balance - out.paid;
          steps.push(...out.steps);
        }

        // ---- staff ----
        steps.push(...staffing.routine(obs, book, acc.account, {
          // Only with room at the workplace (someone let go may still be there, working out their notice).
          target: trading ? Math.min(p.max_staff, headcount) : 0, wage, canPost: trading && acc.balance >= Math.floor(((workers.length + 1) * wage * MONTH) / p.period) && roomAtWork(obs) > 0,
          why: `Short of this month's headcount (${workers.length} of ${headcount}${headcountWhy}): posting a job at ${usd(wage)} a fortnight.`,
        }));
        steps.push(...borrowing.steps(book, t, acc.account));
        // Insolvent (it can't pay its debts as they fall due): wind up.
        const insolvent = winding.insolvent(t, book, { balance: acc.balance, noCredit: !borrowing.canApply(t) && !borrowing.waiting(t), defaulted: borrowing.impaired });
        const idle = insolvent ? null : winding.idle(t, workers.length > 0 || staffing.offered(book, t).length > 0);
        if (insolvent) steps.push(...winding.begin(t, book, staffing, insolvent));
        else if (idle) steps.push(...winding.begin(t, book, staffing, idle, true));
        // Debts recorded against us (unpaid wages, a fine...), paid while we can, keeping the next pay period's wages; more
        // than we can pay, we ask our bank for the difference.
        else {
          steps.push(...winding.payDebts(book, acc.account, acc.balance, workers.length * wage));
          const owed = winding.debts(book).reduce((x, d) => x + cents(d.about.amount), 0);
          if (owed > acc.balance && winding.state === "trading" && borrowing.canApply(t)) steps.push(borrowing.apply(t, acc.account, Math.ceil((owed - acc.balance) / 100_000) * 100_000, 12, "paying our debts", `We owe ${usd(owed)} in debts recorded against us and have ${usd(acc.balance)}: asking our bank for the difference.`));
        }
        if (winding.state === "trading" && workers.length && acc.balance < workers.length * wage) {
          // Short of the next pay period: first, working capital from our bank (two months' wages); while we wait to hear,
          // nobody is let go. Refused (or in default): the most recent hire goes, and this month's headcount with them.
          const bill = Math.floor((workers.length * wage * MONTH) / p.period);
          if (borrowing.canApply(t)) {
            const amount = Math.ceil((2 * bill) / 100_000) * 100_000;
            steps.push(borrowing.apply(t, acc.account, amount, 12, "working capital", `We have ${usd(acc.balance)}, not enough for the next pay period (${workers.length} staff): asking our bank for ${usd(amount)} of working capital before letting anyone go.`));
          } else if (!borrowing.waiting(t)) {
            const s = staffing.letGo(book, t, `Can't cover the next pay period (${usd(acc.balance)} for ${workers.length} staff), and no loan to be had: letting the most recent hire go.`, "Redundancy: we can't cover the wage bill.");
            if (s.length) headcount = Math.min(headcount, workers.length - 1);
            steps.push(...s);
          }
        }

        // ---- our price list: where we are, and what we charge ----
        if (price !== publishedPrice && winding.state === "trading") {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedPrice = price;
          steps.push(because(old.length ? priceWhy || `Our price is now ${usd(price)}.` : "Publishing our price.", ...old.map((r) => withdraw(r.id, "Superseded.")),
            priceList({ [p.kind]: price }, acc.account, `${p.kind} at ${usd(price)} each, at ${p.premises}: delivered to your home, or kept here for you. Order and pay with the order.`, { at: p.premises })));
        }

        // ---- restocking, weekly: below the middle of Lengnick's band of last month's sales, up to its top ----
        if (t >= nextRestock && offers.length && winding.state === "trading") {
          nextRestock = t + 7 * DAY;
          const top = Math.ceil((p.phi_high_bps * lastDemand) / 10_000);
          const mid = Math.ceil((((p.phi_low_bps + p.phi_high_bps) / 2) * lastDemand) / 10_000);
          const have = stock + onOrder;
          const best = offers[0]!;
          // As much as we can pay for, keeping the next pay period's wages aside (and at least the supplier's minimum).
          const affordable = Math.floor((acc.balance - workers.length * wage) / best.unit);
          if (have < mid) {
            const q = Math.min(Math.max(best.min, top - have), affordable);
            if (q >= best.min) {
              onOrder += q;
              const st = order({ me, seller: best.seller, sellerAccount: best.account, kind: p.kind, quantity: q, unitPrice: best.unit, at: p.premises, from: acc.account,
                why: `Restocking: ${stock} in stock and ${onOrder - q} on order, below ${mid} (the middle of our band of last month's sales, ${lastDemand}): ordering ${q}${q < top - have ? `, as many as we can pay for (up to ${top} would fill our band)` : ""} from ${best.seller}, the cheapest of our suppliers at ${usd(best.unit)}.` });
              st.then = (out) => {
                const id = out.created?.order;
                if (id) {
                  ours.set(id, { seller: best.seller, quantity: q });
                  unitCost = best.unit;
                } else onOrder = Math.max(0, onOrder - q);
              };
              steps.push(st);
            }
          }
        }

        // ---- serving: paid orders, oldest first, as far as today's hands and our stock go ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        const mine = new Set(workers);
        const present = [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.premises).flatMap((c) => c.structure!.spaces.flatMap((sp) => (sp.kind === "workplace" ? sp.occupants ?? [] : []))))].filter((w) => mine.has(w)).sort();
        // Every paid order joins the queue: what customers wanted, served or not.
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          if (o.kind !== p.kind || o.unitPrice < price) {
            steps.push(fillWith(o, 0, 0, [], `An order ${o.kind !== p.kind ? `for ${o.kind}, which we don't sell` : "below our price"}: refunding it.`));
            continue;
          }
          sold += o.quantity;
          queue.push({ o, served: 0, since: t });
        }
        // Each worker's time left today; serving is shared evenly among those here, as the work is.
        const room = (w: string) => (workDay(t) ? p.working_day - (used.get(w) ?? 0) : 0);
        let left = stock;
        for (const x of [...queue]) {
          const want = x.o.quantity - x.served;
          const minRoom = present.length ? Math.min(...present.map(room)) : 0;
          const q = Math.min(want, left, Math.floor((minRoom * present.length) / p.serve_labour));
          const out = left === 0 || (q === want) ? "done" : t - x.since >= p.serve_within_days * DAY ? "late" : "wait";
          if (q === 0 && out === "wait") break; // no hands left today: the rest wait their turn
          const share = q ? Math.ceil((q * p.serve_labour) / present.length) : 0;
          left -= q;
          for (const w of present) if (share) used.set(w, (used.get(w) ?? 0) + share);
          const before = x.served;
          x.served += q;
          const finished = out !== "wait";
          if (finished) queue.splice(queue.indexOf(x), 1);
          const why = !finished ? `Serving ${q} of the ${x.o.quantity} ${x.o.kind} ${x.o.buyer} ordered today; the rest tomorrow.`
            : x.served === x.o.quantity ? `Serving an order paid in full: ${x.served} ${x.o.kind}${before ? " (the last of it)" : ""}.`
            : left === 0 && out !== "late" ? `Out of stock: served ${x.served} of the ${x.o.quantity} ordered; refunding the rest.`
            : `We couldn't serve all of an order within ${p.serve_within_days} days: served ${x.served} of the ${x.o.quantity}; refunding the rest.`;
          const st = fillWith(x.o, q, finished ? x.served : -1, present, why);
          st.then = (res) => {
            if (res.status === "applied") return;
            for (const w of present) if (share) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
            x.served = before;
            // Where it was to go, or whom to, is gone: refund what's left of it. Otherwise (someone left in the same
            // moment, say) it waits its turn again.
            if (UNDELIVERABLE.includes(res.refusal?.code ?? "")) {
              if (!finished) queue.splice(queue.indexOf(x), 1);
              return [fillWith(x.o, 0, before, [], `We couldn't deliver order ${x.o.id} (${res.refusal?.detail ?? res.refusal?.code}): refunding what's left of it.`)];
            }
            if (finished) queue.unshift(x);
          };
          steps.push(st);
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } })));
        for (const [a, x] of orders.unclaimed(book)) {
          orders.refunded(a);
          steps.push(because("Money paid to us with no order waiting for it: sending it back.", pay(a, x, { from: acc.account, for: "Refund: no order of yours is waiting." })));
        }
        return steps;

        /** Serving (part of) an order: the hours of serving and the goods to the customer; once it's finished (`total`
         * served, all told), a refund for what we couldn't serve and a note saying so. */
        function fillWith(o: Order, q: number, total: number, staff: string[], why: string): Step {
          const s: Step = because(why);
          if (q > 0) s.push(C.call("work", { task: p.serve_task, units: C.text(String(q)), at: p.premises, by: C.json(staff) }), C.call("goods", { kind: o.kind, quantity: C.text(String(q)), to: o.to, at: o.at, from_at: p.premises }));
          if (total < 0) return s;
          const refund = (o.quantity - total) * o.unitPrice;
          if (refund > 0) s.push(pay(o.account, refund, { from: acc!.account, for: `Refund: ${o.quantity - total} ${o.kind} we couldn't sell you.` }));
          s.push(say("delivery_note", total === o.quantity ? `Served: ${total} ${o.kind} to ${o.to} at ${o.at}.` : `Served ${total} of the ${o.quantity} ${o.kind} ordered${refund ? `; ${usd(refund)} refunded` : ""}.`, {
            to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: total, refund },
          }));
          return s;
        }
      },
    );
  },
};
