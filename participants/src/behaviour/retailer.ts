// firm.retailer: a shop, after Lengnick (2013), with wholesale buying and serving (phase B). Documented in
// docs/behaviour/retailer.md, with sources.

import * as C from "../calls";
import { cents } from "../money";
import type { LookRequest, Observation, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { ask, nextLook, because, Book, publishedPrice as buildingPrice, DAY, MONTH, ownAccount, Pace, pay, say, type Step, usd, withdraw, outOfTime, team } from "./common";
import { Bargaining, Staffing, stepper, WindingUp } from "./firms";
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
  version: "0.8.4", // 0.8.4: takes on the share of its hands the world gives by the day; 0.8.3: registers the share of its jobs the world gives for shops (firms.md, "Jobs an employer does not register")
  doc: "docs/behaviour/retailer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        premises: "", // the shop: where it keeps and sells things
        workplace: "", // the space its staff work in
        role: "shop assistant",
        industry: "", // what the work is (its postings say; the world's vocabulary, e.g. its profile's industries)
        max_staff: 6,
        min_staff: 1,
        kind: "goods",
        serve_task: "serve",
        serve_labour: 5400, // seconds of work to serve an item
        suppliers: [] as string[], // whom it may buy from (their price lists)
        wage: 120_000, // the wage it offers new hires, cents per period
        period: 14 * DAY,
        notice_days: 14,
        // Of the jobs it fills, the share it puts on its payroll returns (the world's figure for employers of its kind;
        // 10,000: all). One it does not register is paid whole, and reported to nobody (docs/behaviour/firms.md).
        registered_bps: 10_000,
        // Work by the day (docs/behaviour/firms.md): of the jobs it fills, the share it fills by the day, and what it
        // pays for a day (the world's figures for employers of its kind; 0: every job is on a standing wage).
        casual_bps: 0, day_wage: 0,
        working_day: 8 * 3600,
        work_days: 6, // of every 7: shops open on Saturdays
        police: "", // whom it reports goods missing to, at its monthly stocktake ("": no stocktake)
        stocktake_days: 30, look_at: 0, look_days: 5, // when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)
        price: 9000, // its opening retail price, cents each
        demand: 250, // what it expects to sell in a month, before it knows
        unpaid_days: 7,
        serve_within_days: 3, // what isn't served within this (or the days the order says it's for) is refunded (the customer goes elsewhere)
        // The share of its staff's hours a shop plans to fill with serving (placeholder): serving can't be stored, and
        // orders come in lumps, so hands for exactly the average leave queues that never clear (Kingman 1961).
        utilisation_bps: 8000,
        lender: "", // whom it borrows from (none: it doesn't)
        // Insolvency (docs/behaviour/insolvency.md; placeholders): short of wages this long with no credit, or in default on
        // a loan, and it winds up over this long.
        short_days: 60,
        wind_up_days: 60,
        idle_days: 90, // nobody working for us this long, our owners close us (placeholder)
        reprice_days: 30, // closed, our premises unsold this long: the asking price comes down (placeholder)
        reprice_bps: 1000, // by this much (placeholder)
        builder: "", // whose published prices say what our premises are worth (none: closed, they're not sold)
        premises_sale_bps: 5000,
        // A shop just founded (docs/behaviour/entry.md): who founded it, the capital they put in, the property listing it
        // buys its premises from, and its bank. None: a shop that's trading already.
        // Our prices are put up at our premises (seen by those who live, work or shop near; found by anyone who looks
        // through what sellers advertise), not sent to the town: docs/behaviour/retailer.md. False: published to all.
        shopfront: false,
        // What it looks up (docs/no-god-view.md; none: it knows what it is shown): what producers advertise to the
        // trade, searched at each week's restock for the wholesale lists, whose sellers join its suppliers; and, for a
        // shop just founded, the listings of property for sale and the notices of sales, searched for its own premises.
        trade_board: "", sale_board: "", sold_board: "",
        search_limit: 20, // how many lists or listings a search reads
        founder: null as string | null,
        capital: 0,
        listing: null as string | null,
        bank: "", // a shop just founded opens its account here (the world must say, for one); closed, our premises are offered at this share of what building them new costs (placeholder)
        ...LENGNICK, // Lengnick (2013), Table 1
      },
      ctx.params,
    );
    if (p.founder) need(p, ["bank"], "firm.retailer");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, registered_bps: p.registered_bps, casual_bps: p.casual_bps, day_wage: p.day_wage, work_days: p.work_days, week_days: p.look_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}) });
    const borrowing = new Borrowing(me, p.lender);
    const bargaining = new Bargaining(me);
    const winding = new WindingUp(me, { short_days: p.short_days, wind_up_days: p.wind_up_days, idle_days: p.idle_days, reprice_days: p.reprice_days, reprice_bps: p.reprice_bps });
    // Our premises, as the sites we see show them (for selling them if we close).
    const premisesOf = (obs: Observation) => {
      const c = channels.cells(obs).find((x) => x.structure?.structure === p.premises);
      return c?.structure ? { structure: c.structure.structure, type: c.structure.type, cell: c.cell } : undefined;
    };

    const suppliers = new Set<string>(p.suppliers); // those the world named, and producers found advertising to the trade
    let nextTradeLook = 0;
    // A shop just founded: what the last look at its premises' listings and sale showed, and when.
    const premisesNow = { asked: -1, listings: null as StatementRecord[] | null, sold: null as StatementRecord[] | null, goneSince: undefined as number | undefined };
    const orders = new OrderBook(me, p.unpaid_days);
    const deliveries = new Deliveries();
    let onOrder = 0; // goods ordered from suppliers, not yet delivered
    const ours = new Map<string, { seller: string; quantity: number }>(); // our order -> for how many, from whom
    const shortAt = new Map<string, number>(); // supplier -> when it last came up short
    // Between suppliers at one price, a shop has its own order of preference (its own, drawn once for each: whom it
    // happens to deal with). By name, every shop in a town ordered from the same factory, which could fill a few of
    // the orders, while the others' goods stood unsold.
    const standing = new Map<string, number>();
    const standingOf = (seller: string) => standing.get(seller) ?? (standing.set(seller, ctx.rng(`supplier-${seller}`).below(1_000_000_000)), standing.get(seller)!);
    let unitCost = 0; // what we last paid a supplier for an item
    const used = new Map<string, number>(); // worker -> seconds worked today
    const pace = new Pace(p.serve_labour); // how long a unit takes, as we learn it (our figure at first)
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
    const books = { last: null as number | null, in: 0, out: 0, next: 0 }; // the stocktake's books
    // Setting up (a shop just founded): our account asked for, the capital called, the premises bought.
    const setup = { accountAsked: false, capitalCalled: false, founderAccount: undefined as string | undefined, registered: false, purchased: false, ready: !p.founder };
    const workDay = (t: number) => Math.floor(t / DAY) % 7 < p.work_days;
    const hoursPerWorkerMonth = (p.working_day * p.work_days * 30) / 7;
    /** Room in our workplace: its capacity less our staff, or the bodies in it now if more (staff come and go each day). */
    const roomAtWork = (obs: Observation, staff: number) => {
      const sp = channels.cells(obs).find((c) => c.structure?.structure === p.premises)?.structure?.spaces.find((x) => x.kind === "workplace");
      return sp ? sp.capacity - Math.max(sp.count, staff) : p.max_staff;
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
      // (Looked up, where the world gives us the boards: the standing listings of our premises, and a notice of their
      // sale. A relisting can be found with none standing for a moment: gone, when a look a day later still finds none.)
      const looked = !!p.sale_board;
      if (looked && !premisesNow.listings) return steps;
      const first = p.listing ? book.records.get(p.listing) : undefined;
      const structure = looked ? p.premises : first?.record === "statement" ? first.data?.structure : undefined;
      const relisted = (looked ? premisesNow.listings! : book.open("property_for_sale")).filter((r) => r.data?.structure === structure).sort((a, b) => b.at - a.at)[0];
      const listing = relisted ?? (looked ? undefined : first);
      const sold = (looked ? premisesNow.sold ?? [] : book.all("property_sold")).find((r) => structure && r.data?.structure === structure);
      if (looked && !sold) {
        if (listing) premisesNow.goneSince = undefined;
        else if ((premisesNow.goneSince ??= obs.t) > obs.t - DAY) return steps;
      }
      if (sold && sold.data?.buyer === me) {
        setup.ready = true;
        return [...steps, because(`Our premises (${sold.data.structure}) are ours: opening for trade.`)];
      }
      if (sold || (looked ? !listing : listing && book.withdrawn.has(listing.id))) {
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

    return Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        winding.absorb(obs, ownAccount(obs)?.account);
        // What our looks found: producers advertising to the trade; our premises' listings and sale.
        const found = (id: string) => { const ch = id ? obs.channels[id] : undefined; return ch?.kind === "records" && ch.search ? (ch.records as StatementRecord[]) : undefined; };
        for (const r of found(p.trade_board) ?? []) if (r.speaks_for && r.speaks_for !== me) suppliers.add(r.speaks_for);
        if (premisesNow.asked === obs.t) {
          premisesNow.listings = found(p.sale_board) ?? premisesNow.listings;
          premisesNow.sold = found(p.sold_board) ?? premisesNow.sold;
        }
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
          books.in += d.delivered;
        }
      },
      (obs) => {
        const t = obs.t;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        if (acc && winding.state === "closed") {
          const where = premisesOf(obs);
          const worth = where ? buildingPrice(book, p.builder, where.type) : undefined;
          return winding.sell(obs, book, acc.account, acc.balance, where, worth ? Math.floor((worth * p.premises_sale_bps) / 10_000) : undefined, (x) => distribute(book, me, acc, x, "The proceeds of our premises: to our shareholders by their shares").steps);
        }
        // A shop just founded sets itself up before it trades.
        if (!setup.ready) return settingUp(obs, acc);
        if (!acc) return steps;
        if (winding.due(t)) return winding.finish(t, book, acc.account, acc.balance, (x) => distribute(book, me, acc, x, "Wound up: what's left, to our shareholders by their shares").steps);
        const trading = winding.state === "trading";
        const workers = staffing.workers(book, t);
        if (headcount < 0) headcount = Math.max(workers.length, p.min_staff); // (a new shop starts by hiring its minimum)
        if (monthStart < 0) monthStart = acc.balance;
        const stock = held(obs, p.premises, p.kind);
        // The stocktake (crime: docs/behaviour/crime.md), monthly: what's here against our books (last count, what came,
        // what we served). Short: reported to the police, with what it was worth at our price.
        if (p.police && t >= books.next) {
          books.next = t + p.stocktake_days * DAY;
          const expected = books.last === null ? null : books.last + books.in - books.out;
          books.last = stock;
          books.in = 0;
          books.out = 0;
          if (expected !== null && expected > stock && acc) steps.push(because(`The stocktake: ${stock} ${p.kind} here, where our books say ${expected}. ${expected - stock} missing: reporting it to the police.`,
            say("crime_report", `Report: ${expected - stock} ${p.kind} missing from ${p.premises}, found at our stocktake.`, { to: [p.police], visible: [me, p.police],
              data: { kind: p.kind, quantity: expected - stock, at: p.premises, value: (expected - stock) * price, account: acc.account } })));
        }
        // Our suppliers' prices, cheapest first (those that came up short in the last week, last; at one price, in our own order).
        const offers = [...suppliers].sort().map((s) => ({ seller: s, ...goodsPrices(book, s) })).filter((x) => x.prices[p.kind] !== undefined && x.account)
          .map((x) => ({ seller: x.seller, account: x.account!, unit: x.prices[p.kind]!, min: x.min_order ?? 1 }))
          .sort((a, b) => Number(t - (shortAt.get(a.seller) ?? -Infinity) < 7 * DAY) - Number(t - (shortAt.get(b.seller) ?? -Infinity) < 7 * DAY) || a.unit - b.unit || standingOf(a.seller) - standingOf(b.seller) || (a.seller < b.seller ? -1 : 1));
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
          // Lengnick's firms deliver what their labour makes; a shop delivers what its staff's hours can serve. Short of
          // hands for last month's demand, it's short as a firm short of stock is: it may raise its price, and never
          // cuts it while it turns customers away.
          const canServe = Math.floor((workers.length * hoursPerWorkerMonth) / p.serve_labour);
          const moved = movePrice(p, rng, price, stock, lastDemand, marginalCost, canServe);
          price = moved.price;
          if (moved.why) priceWhy = moved.why;
          // Headcount: a worker at a time towards the hands last month's sales needed.
          const needed = Math.min(p.max_staff, Math.max(p.min_staff, Math.ceil((lastDemand * p.serve_labour * 10_000) / (hoursPerWorkerMonth * p.utilisation_bps))));
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
          const out = payOut(book, me, acc, acc.balance, buffer, acc.balance - monthStart, `a month's wages and stock, and ${p.chi_bps / 100}% of the wage bill`);
          monthStart = acc.balance - out.paid;
          steps.push(...out.steps);
        }

        // ---- staff ----
        // Bargaining with a union (docs/behaviour/unions.md): a claim answered, an agreement's rise, a strike.
        steps.push(...bargaining.steps(book, t, staffing, acc.account, acc.balance, (rise) => { wage = Math.floor((wage * (10_000 + rise)) / 10_000); }));
        steps.push(...staffing.routine(obs, book, acc.account, {
          // Only with room at the workplace (someone let go may still be there, working out their notice).
          target: trading ? Math.min(p.max_staff, headcount) : 0, wage, canPost: trading && acc.balance >= Math.floor(((workers.length + 1) * wage * MONTH) / p.period) && roomAtWork(obs, workers.length) > 0,
          why: `Short of this month's headcount (${workers.length} of ${headcount}${headcountWhy}): posting a job at ${usd(wage)} every ${p.period / DAY} days.`,
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
        // (Those we're keeping: someone already given notice is still staff until it runs out, and counting them made
        // this let everyone go, one after another within the moment, where the rule lets the most recent hire go.)
        const keeping = staffing.staying(book, t);
        if (winding.state === "trading" && keeping && acc.balance < keeping * wage) {
          // Short of the next pay period: first, working capital from our bank (two months' wages); while we wait to hear,
          // nobody is let go. Refused (or in default): the most recent hire goes, and this month's headcount with them
          // (and the next, until those we keep can be paid).
          const bill = Math.floor((workers.length * wage * MONTH) / p.period);
          if (borrowing.canApply(t)) {
            const amount = Math.ceil((2 * bill) / 100_000) * 100_000;
            steps.push(borrowing.apply(t, acc.account, amount, 12, "working capital", `We have ${usd(acc.balance)}, not enough for the next pay period (${workers.length} staff): asking our bank for ${usd(amount)} of working capital before letting anyone go.`));
          } else if (!borrowing.waiting(t)) {
            const s = staffing.letGo(book, t, `Can't cover the next pay period (${usd(acc.balance)} for ${keeping} staff), and no loan to be had: letting the most recent hire go.`, "Redundancy: we can't cover the wage bill.");
            if (s.length) headcount = Math.min(headcount, keeping - 1);
            steps.push(...s);
          }
        }

        // ---- our price list: where we are, and what we charge ----
        if (price !== publishedPrice && winding.state === "trading") {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedPrice = price;
          steps.push(because(old.length ? priceWhy || `Our price is now ${usd(price)}.` : "Publishing our price.", ...old.map((r) => withdraw(r.id, "Superseded.")),
            priceList({ [p.kind]: price }, acc.account, `${p.kind} at ${usd(price)} each, at ${p.premises}: delivered to your home, or kept here for you. Order and pay with the order.`, { at: p.premises }, me, p.shopfront ? premisesOf(obs)?.cell : undefined)));
        }

        // ---- restocking, weekly: below the middle of Lengnick's band of last month's sales, up to its top ----
        if (t >= nextRestock && offers.length && winding.state === "trading") {
          nextRestock = t + 7 * DAY;
          const top = Math.ceil((p.phi_high_bps * lastDemand) / 10_000);
          const mid = Math.ceil((((p.phi_low_bps + p.phi_high_bps) / 2) * lastDemand) / 10_000);
          const have = stock + onOrder;
          const best = offers[0]!;
          // As much as we can pay for, keeping the next pay period's wages aside (and at least the supplier's minimum).
          // (Keeping the next pay period's wages for the staff we have or are hiring to: this month's headcount.)
          const affordable = Math.floor((acc.balance - Math.max(workers.length, headcount) * wage) / best.unit);
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
        // (Who serves today: those here with the most time between them, the work shared evenly.)
        const crew = team(present, room).who;
        let left = stock;
        for (const x of [...queue]) {
          const want = x.o.quantity - x.served;
          const minRoom = crew.length ? Math.min(...crew.map(room)) : 0;
          const q = Math.min(want, left, Math.floor((minRoom * crew.length) / pace.perUnit(crew)));
          // (An order for a fortnight's shopping is served over the fortnight: it's what the household uses until then.)
          const within = x.o.forDays ?? p.serve_within_days;
          const out = left === 0 || (q === want) ? "done" : t - x.since >= within * DAY ? "late" : "wait";
          if (q === 0 && out === "wait") break; // no hands left today: the rest wait their turn
          const share = q ? Math.ceil((q * pace.perUnit(crew)) / crew.length) : 0;
          left -= q;
          for (const w of crew) if (share) used.set(w, (used.get(w) ?? 0) + share);
          const before = x.served;
          x.served += q;
          const finished = out !== "wait";
          if (finished) queue.splice(queue.indexOf(x), 1);
          const why = !finished ? `Serving ${q} of the ${x.o.quantity} ${x.o.kind} ${x.o.buyer} ordered today; the rest tomorrow.`
            : x.served === x.o.quantity ? `Serving an order paid in full: ${x.served} ${x.o.kind}${before ? " (the last of it)" : ""}.`
            : left === 0 && out !== "late" ? `Out of stock: served ${x.served} of the ${x.o.quantity} ordered; refunding the rest.`
            : `We couldn't serve all of an order within ${within} days: served ${x.served} of the ${x.o.quantity}; refunding the rest.`;
          const st = fillWith(x.o, q, finished ? x.served : -1, q ? crew : [], why);
          st.then = (res) => {
            if (res.status === "applied") {
              books.out += q;
              return void (q && pace.done(crew, Math.floor(t / DAY)));
            }
            if (q) pace.refused(res, q, crew);
            for (const w of crew) if (share) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
            // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
            const short = outOfTime(res);
            if (short?.who) used.set(short.who, p.working_day - short.left);
            else if (short) for (const w of crew) used.set(w, p.working_day);
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
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
      (obs) => {
        const looks: LookRequest[] = [];
        if (p.trade_board && setup.ready && obs.t >= nextTradeLook) {
          nextTradeLook = obs.t + 7 * DAY;
          looks.push(ask.board(p.trade_board, { most: p.search_limit, where: [{ field: "data.min_order", op: ">", value: 1 }] }));
        }
        if (p.sale_board && !setup.ready && setup.capitalCalled && premisesNow.asked !== obs.t) {
          premisesNow.asked = obs.t;
          looks.push(ask.about(p.sale_board, "data.structure", p.premises, { most: p.search_limit, standing: true }));
          if (p.sold_board) looks.push(ask.about(p.sold_board, "data.structure", p.premises, { most: 1, newest: true }));
        }
        return looks;
      },
    ), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};
