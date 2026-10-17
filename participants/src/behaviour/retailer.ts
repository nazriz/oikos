// firm.retailer: a shop, after Lengnick (2013), with wholesale buying and serving (phase B). Documented in
// docs/behaviour/retailer.md, with sources.

import { keeping, Org, type OrgParams } from "./orgwants";
import { Respondent, type RespondParams } from "./frictions";
import * as C from "../calls";
import { cents } from "../money";
import type { LookRequest, Observation, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { ask, breaches, nextLook, because, Book, publishedPrice as buildingPrice, DAY, MONTH, ownAccount, Pace, pay, say, type Step, usd, withdraw, outOfTime, team } from "./common";
import { type AdjustParams, Bargaining, LabourPlan, Takings, Staffing, stepper, terminationLaw, WindingUp } from "./firms";
import { Borrowing } from "./credit";
import { distribute, LENGNICK, movePrice, moveWage, payOut } from "./lengnick";
import { Deliveries, goodsPrices, held, order, OrderBook, Payables, priceList, UNDELIVERABLE, type Order } from "./trade";
import * as P from "./papers";
import { ADOPTION, Adoption, capacityOf, Fleet, type AdoptionParams } from "./automation";
import { slip } from "../slip";

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
  issues: [P.JOB_ADVERTISEMENT, ...P.TRADE, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "shop assistant", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), police: p.police }),
  version: "0.16.0", // 0.16.0: after a stoppage its offer follows what the stoppage cost it in sales, not a fixed share of the gap (docs/behaviour/unions.md, "Concession"); 0.15.0: where the world's law lets an employer cut hours, a surplus of hands is met first by cutting everyone's hours to what the trade needs, by a paper to each worker, and a shop serves in its staff's hours (docs/behaviour/firms.md, "Hours before heads"); 0.14.0: reviews its staff and closes its month on a day of its own, not on one every shop shares, and expects at first the trade it was staffed for, not its first month's sales alone (docs/behaviour/firms.md, "When a shop reviews its staff"); 0.13.0: buys its stock on the supplier's terms where it states them (docs/behaviour/trade.md, "Trade credit"), so stock no longer competes with the wage bill in the week it is bought; borrows again as its bank allows; no dividend while wages are owed or anyone is under notice (docs/behaviour/firms.md, "Before a dividend"); 0.12.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.12.0: 0.12.0: adjusts its staff as firms do (docs/behaviour/firms.md, "Adjusting labour"): sales smoothed over months, staff held through a dip and let go only when the surplus has lasted what ending the job costs, redundancy pay under the world's law; a business of one can be founded in a run and is closed when its owner gives it up (docs/behaviour/entry.md); 0.11.0: everyday frictions (docs/behaviour/frictions.md): pay that comes short, at the world's rate and its character's; asked, told or ordered to put right short pay or goods said to be faulty; 0.10.0: wants of its own (docs/behaviour/firm-wants.md): a character from its owner's values, which answers a worker who asks for a rise, and a record of its own; 0.9.1: a business of one buys stock when it runs low (daily), keeps its stock money at today's price, follows its owner's home, and closes when its owner has gone; 0.9.0: a business run by its owner alone (operator), stocked for a few days and drawn on by its owner; 0.8.4: takes on the share of its hands the world gives by the day; 0.8.3: registers the share of its jobs the world gives for shops (firms.md, "Jobs an employer does not register")
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
        // How it adjusts its staff to its trade (docs/behaviour/firms.md, "Adjusting labour"): the months it smooths
        // its sales over, and what taking someone on costs it in weeks of their pay (placeholders; a world's profile
        // may state its own). 0 and 0: it reacts to each month's sales, as it did until 2026-10-11.
        adjust: { smooth_months: 3, hiring_cost_weeks: 8 } as AdjustParams,
        lender: "", // whom it borrows from (none: it doesn't)
        // More than one loan (docs/behaviour/credit.md, "More than one loan"): after a loan is granted it may apply again this many
        // days later, and the bank decides on its rule, counting what it already repays (placeholder). -1: one loan at a time.
        borrow_again_days: 30,
        // Whether it buys on the terms a supplier states (docs/behaviour/trade.md, "Trade credit"): paid for after the goods are in.
        credit: true,
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
        // A business its owner runs alone (docs/behaviour/entry.md, "A person working for themself"): the person who
        // serves, in the space they work from (`workplace`: a room of their home, a pitch); it takes on nobody. Its
        // stock and what it keeps in hand are for `stock_days` of sales (30: a shop's month), and every `draw_days` what
        // it holds beyond that goes to its owner (0: at the month's end, out of the month's earnings, as a shop pays).
        operator: null as string | null,
        stock_days: 30,
        draw_days: 0,
        premises_cell: "", // where its prices are put up (it is not shown the ground: a home or a market is not one business's premises)
        open_from: 0, open_until: 0, // the hours of a working day its owner is there (seconds into the day; both 0: whenever, as at home)
        founder: null as string | null,
        capital: 0,
        listing: null as string | null,
        bank: "", // a shop just founded opens its account here (the world must say, for one); closed, our premises are offered at this share of what building them new costs (placeholder)
        // Wants of its own (docs/behaviour/firm-wants.md): whether it takes initiative (none given: its own draw
        // against the world's dial), the values of whoever owns most of it and the town's figures they are read
        // against (the world's), and the sizes (`org`: placeholders).
        initiative: null as boolean | null,
        owner_values: null as { [value: string]: number } | null,
        values: {} as { [value: string]: { mean_bps: number; sd_bps: number } },
        org: {} as Partial<OrgParams>,
        // Everyday frictions (docs/behaviour/frictions.md): of those it takes on, the share it pays short and by how
        // much (the world's; none: nobody); and how it answers when asked to put something right, told of a
        // complaint, or ordered to (the world's rates; its character sways them).
        short_pay: null as { by_bps: number } | null,
        respond: {} as Partial<RespondParams>,
        // Systems it may take up in place of some of its staff's work (docs/behaviour/automation.md): how it weighs them (the world's
        // figures). None: it looks at none (a world with no vendor).
        automation: null as AdoptionParams | null,
        ...LENGNICK, // Lengnick (2013), Table 1
      },
      ctx.params,
    );
    const org = new Org(ctx, { initiative: p.initiative, owner_values: p.owner_values, values: p.values, org: p.org });
    if (p.founder) need(p, ["bank"], "firm.retailer");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, registered_bps: p.registered_bps, casual_bps: p.casual_bps, day_wage: p.day_wage, work_days: p.work_days, week_days: p.look_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), ...(p.short_pay ? { short: p.short_pay } : {}) });
    const labour = new LabourPlan(p.adjust, p.demand);
    // (After letting someone go because we could not pay them, we take nobody on until we hold the wages of those we
    // would then have for as long as a surplus must last before a job is worth ending, where a month's is enough
    // otherwise: the test to take someone on is never weaker than the test to keep them. Until 2026-10-11 a works
    // short of money hired each month on a month's wages in hand and shed weeks later.)
    const monthsInHand = () => (staffing.cashLayoffAt > -Infinity && (p.adjust.smooth_months > 1 || p.adjust.hiring_cost_weeks > 0) ? labour.waits(terminationLaw(book), 0, 0, p.notice_days) : 1);
    // Asked to put something right (pay kept back, goods said to be faulty), told of a complaint, or ordered to: what our books say of it
    // (what we kept back we know; whether goods were faulty we cannot), and setting someone's pay right from here on.
    let payAccount = "";
    const answering = new Respondent(ctx.rng, me, org, { params: p.respond, forms: [{ notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }],
      truth: (m) => (m.matter === "underpaid" && m.about ? { owed: staffing.owedShort(m.about) } : undefined),
      remedy: (m, _from, t, why) => (m.matter === "underpaid" && m.about && payAccount ? staffing.payInFull(book, t, payAccount, m.about, why) : undefined) });
    const borrowing = new Borrowing(me, p.lender, p.borrow_again_days >= 0 ? { again_days: p.borrow_again_days } : {});
    const payables = new Payables(me); // what we owe suppliers for stock delivered on their terms
    const takings = new Takings(); // what customers have paid us: what a day without our work costs in sales (Bargaining)
    const bargaining = new Bargaining(me, { takingsPerDay: (t) => takings.perDay(t), systemShare: (t) => (lastDemand > 0 ? Math.min(1, systemUnits(lastDemand) / lastDemand) : 0) });
    const fleet = new Fleet(me); // the systems delivered to us, and their licences
    const adoption = new Adoption(me, fleet, { ...ADOPTION, ...(p.automation ?? {}) });
    const faulty = new Map<string, Set<string>>(); // order -> the items a system of ours got wrong, to be refunded
    const faultyOf = (o: Order) => faulty.get(o.id)?.size ?? 0;
    const sysUsed = new Map<string, number>(); // system -> seconds of today it has been given
    let sysCredit = 0; // the units of customers' orders the systems are owed, as the share of them they can do
    const systemsCtx = Object.create(ctx, { kind: { value: "system" } }) as typeof ctx;
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
    // (Its month is its own: it closes its books, and reviews its staff, on a day it has, not on one every shop has. It
    // first reviews once it has traded a whole month, at its next boundary, so the first review has a month's trade or
    // more to look at, scaled to a month: docs/behaviour/firms.md, "When a shop reviews its staff".)
    const reviewDay = ctx.rng("review-day").below(30 * 24) * 3_600;
    let month = Number.NaN;
    let openedAt = -1;
    let reviewed = false;
    let sold = 0; // this month: items customers ordered and paid for (served or not): what they wanted
    let reserved = 0; // goods in orders sent to be served whose work has not taken effect yet (it takes the crew's hours: F1, 2026-10-15)
    const queue: { o: Order; served: number; since: number }[] = []; // paid orders being served, oldest first
    let lastDemand: number = p.demand;
    let fullMonths = 0;
    let headcount = -1;
    let headcountWhy = "";
    let monthStart = -1;
    let nextRestock = 0;
    let nextDraw = -1;
    // A business of one: where it trades from now (its owner tells it when they move home), whether it has anywhere
    // to, and whether its owner has gone from the town (it then closes: what it holds is its owner's).
    const at = { premises: p.premises, workplace: p.workplace, cell: p.premises_cell, nowhere: false, read: 0, gone: false, closed: false, givenUp: false };
    /** A month's sales, as the days of them we stock and keep money for. */
    const stockFor = (monthly: number) => (p.stock_days === 30 ? monthly : Math.ceil((monthly * p.stock_days) / 30));
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
    /** What our systems do of `units` a month: the share they can do, as far as their month's seconds go. */
    const systemUnits = (units: number) => {
      const w = p.automation ? fleet.working(p.serve_task) : [];
      if (!w.length) return 0;
      const cap = w.reduce((x, s) => x + capacityOf(s.seconds, p.utilisation_bps), 0);
      return Math.min(Math.floor((units * Math.max(...w.map((s) => s.scope_bps))) / 10_000), cap);
    };
    const systemFees = () => fleet.inService(p.serve_task).reduce((x, l) => x + l.fee_month * l.systems.length, 0);

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
      // (A business of one, founded to trade from its owner's home: no premises to buy. Once the capital is in, it trades.)
      if (p.operator && !p.listing) {
        if (setup.founderAccount) setup.ready = true;
        return setup.ready ? [...steps, because("Our owner's capital is in: opening for trade, from their home.")] : steps;
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

    staffing.org = org;
    return keeping(org, Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        if (p.automation) { fleet.absorb(book); adoption.delivered(); }
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
        payables.take(book);
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
        if (winding.due(t)) {
          // (What we owe our suppliers for goods delivered on their terms is paid first, as the debts recorded against us are.)
          const owed = payables.settle(t, acc.account, acc.balance);
          return [...owed.steps, ...winding.finish(t, book, acc.account, acc.balance - owed.paid, (x) => distribute(book, me, acc, x, "Wound up: what's left, to our shareholders by their shares").steps)];
        }
        const trading = winding.state === "trading";
        const workers = staffing.workers(book, t);
        if (headcount < 0) headcount = p.operator ? 0 : Math.max(workers.length, p.min_staff); // (a new shop starts by hiring its minimum)
        const hands = p.operator ? 1 : workers.reduce((x, w) => x + staffing.hoursBpsAt(w, t), 0) / 10_000; // (who serves: its staff at their hours, or its owner alone)
        if (monthStart < 0) monthStart = acc.balance;
        // (Its owner has moved home: it trades from there now, and takes its stock along.)
        const moves = p.operator ? book.all("trading_from") : [];
        for (; at.read < moves.length; at.read++) {
          const r = moves[at.read]!;
          if (r.speaks_for !== p.operator || !(r.addressed_to ?? []).includes(me)) continue;
          publishedPrice = -1; // (its prices go up where it now is, or come down)
          if (r.data?.nowhere) { at.nowhere = true; continue; }
          // (Its owner gives it up: it stops trading, refunds what it had not served, pays what it holds to its owner and says it has closed.)
          if (r.data?.closed) { at.gone = true; at.givenUp = true; continue; }
          const had = held(obs, at.premises, p.kind);
          const to = String(r.data?.structure);
          if (had > 0 && to !== at.premises) steps.push(because(`Our owner lives at ${r.data?.space} now: taking our stock there.`, C.call("goods", { kind: p.kind, quantity: C.text(String(had)), to: me, at: to, from_at: at.premises })));
          Object.assign(at, { premises: to, workplace: String(r.data?.space), cell: String(r.data?.cell ?? at.cell), nowhere: false });
        }
        const stock = held(obs, at.premises, p.kind);
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
          .map((x) => ({ seller: x.seller, account: x.account!, unit: x.prices[p.kind]!, min: x.min_order ?? 1, terms: x.terms_days ?? 0 }))
          .sort((a, b) => Number(t - (shortAt.get(a.seller) ?? -Infinity) < 7 * DAY) - Number(t - (shortAt.get(b.seller) ?? -Infinity) < 7 * DAY) || a.unit - b.unit || standingOf(a.seller) - standingOf(b.seller) || (a.seller < b.seller ? -1 : 1));
        if (!unitCost && offers.length) unitCost = offers[0]!.unit;
        // (What serving costs a unit: its hours at the wage, and where systems do some, their fees spread over the units they do.)
        const labourCost = Math.ceil((hourly() * p.serve_labour) / 3600);
        const byUs = systemUnits(lastDemand);
        const marginalCost = unitCost + (byUs > 0 && lastDemand > 0 ? Math.ceil(((lastDemand - byUs) * labourCost + systemFees()) / lastDemand) : labourCost);

        // ---- the month's end: Lengnick's rules ----
        const m = Math.floor((t - reviewDay) / MONTH);
        if (trading && Number.isNaN(month)) { month = m; openedAt = t; }
        if (m !== month && trading && t - openedAt < MONTH) month = m; // (a month's boundary before it has traded a whole month: it only starts counting)
        else if (m !== month && trading) {
          month = m;
          // (The first review looks at all the trade since opening, which is a month and some days, as a month's.)
          lastDemand = !reviewed && t - openedAt > MONTH ? Math.round((sold * MONTH) / (t - openedAt)) : sold;
          reviewed = true;
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
          const canServe = Math.floor((hands * hoursPerWorkerMonth) / p.serve_labour);
          const moved = movePrice(p, rng, price, stock, lastDemand, marginalCost, canServe);
          price = moved.price;
          if (moved.why) priceWhy = moved.why;
          // Headcount: a worker at a time towards the hands the trade we expect needs: our sales smoothed over a
          // few months, never one month's alone. Over that, we hold our staff through the dip (their idle hours are
          // ours to bear), replace nobody who leaves, and let the most recent hire go only once the surplus has
          // lasted as long as ending the job and hiring again would cost (docs/behaviour/firms.md, "Adjusting labour").
          const expected = labour.expect(lastDemand);
          // (What systems of ours do, our people need not: docs/behaviour/automation.md.)
          const needed = p.operator ? 0 : Math.min(p.max_staff, Math.max(p.min_staff, Math.ceil(((expected - systemUnits(expected)) * p.serve_labour * 10_000) / (hoursPerWorkerMonth * p.utilisation_bps))));
          const trade = p.adjust.smooth_months > 1 ? `the trade we expect (${expected} a month; last month ${lastDemand})` : `last month's sales (${lastDemand})`;
          headcount = workers.length;
          headcountWhy = why.length ? `; ${why.join("; ")}` : "";
          // Hours before heads (docs/behaviour/firms.md): where the law lets us, a surplus of hands is met first by
          // cutting everyone's hours to what the trade needs, and only what that leaves (the law's floor, a worker
          // who will not agree) is a surplus that ends a job. Trade back to what the staff need: hours are restored.
          const hoursNow = staffing.reviewHours(book, t, workers.length > 0 ? Math.floor((needed * 10_000) / workers.length) : 10_000, p.adjust.hours_step_bps);
          steps.push(...hoursNow.steps);
          const effective = Math.floor((workers.length * hoursNow.achieved) / 10_000);
          if (needed > workers.length) {
            labour.month(false, 1);
            headcount = workers.length + 1;
            headcountWhy = `: ${trade} needed ${needed} hands to serve${headcountWhy}`;
          } else if (needed < workers.length && effective <= needed) {
            labour.month(false, 1);
            steps.push(because(`Month's end: ${trade} needed ${needed} hands to serve, and we have ${workers.length}: their hours are cut to match (${hoursNow.achieved / 100}% of the ordinary), and no one is let go.`));
          } else if (needed < workers.length) {
            const waits = labour.waits(terminationLaw(book), workers.length, staffing.lastHireYears(book, t), p.notice_days);
            const m = labour.month(true, waits);
            headcount = m.letGo ? workers.length - 1 : needed; // (held: nobody who leaves is replaced while we are over)
            if (m.letGo) steps.push(...staffing.letGo(book, t, `Month's end: ${trade} needed ${needed} hands to serve, and we have ${workers.length}${waits > 1 ? `, as for ${waits} months now` : ""}: letting one go.`, "Redundancy: there isn't the trade."));
            else steps.push(because(`Month's end: ${trade} needed ${needed} hands to serve, and we have ${workers.length}: keeping them for now (${m.lasted} of the ${waits} months such a surplus must last before letting someone go is worth what it costs), and replacing nobody who leaves.`));
          } else labour.month(false, 1);
          // Systems on offer: whether to take one for serving, or to end a licence that has run its term (docs/behaviour/automation.md).
          if (p.automation && !p.operator) {
            const monthly = Math.floor((wage * MONTH) / p.period);
            steps.push(...adoption.review(book, t, { task: p.serve_task, staff: workers.length, account: acc.account, balance: acc.balance, keep: 2 * workers.length * monthly + payables.owing,
              breaks: (f) => breaches(book, { block: "deploy", task: f.task, offer: f.id, vendor: f.vendor }, me, t).map((l) => l.id), complies: (why) => ctx.rng(`comply-${why}`).below(10_000) < (p.automation?.compliance_bps ?? 10_000),
              facts: { units: expected, labour: p.serve_labour, wage_month: monthly, seconds_per_worker_month: hoursPerWorkerMonth, utilisation_bps: p.utilisation_bps, unit_price: price, hiring_cost_weeks: p.adjust.hiring_cost_weeks } }));
          }
          // Out of the month's earnings, what we hold beyond the buffer goes to the shareholders: a month's wages, a
          // month's stock at cost, and Lengnick's chi of the wage bill.
          const bill = Math.floor((Math.max(workers.length, headcount) * wage * MONTH) / p.period);
          // (And what we owe our suppliers for stock delivered on their terms: a dividend must not take the money its invoices are paid from.)
          const buffer = bill + stockFor(lastDemand) * unitCost + Math.floor((bill * p.chi_bps) / 10_000) + payables.owing;
          // (Nothing is paid out while wages are owed or anyone is under notice: docs/behaviour/firms.md, "Before a dividend".)
          const out = p.draw_days > 0 ? { steps: [], paid: 0 } : staffing.strained(book, t) ? { steps: [because(`Month's end: ${staffing.strained(book, t)}, so nothing is paid out to our shareholders.`)], paid: 0 } : payOut(book, me, acc, acc.balance, buffer, acc.balance - monthStart, `a month's wages and stock, and ${p.chi_bps / 100}% of the wage bill`);
          monthStart = acc.balance - out.paid;
          steps.push(...out.steps);
        }

        // ---- staff ----
        // Bargaining with a union (docs/behaviour/unions.md): a claim answered, an agreement's rise, a strike.
        steps.push(...bargaining.steps(book, t, staffing, acc.account, acc.balance, (rise) => { wage = Math.floor((wage * (10_000 + rise)) / 10_000); }));
        steps.push(...staffing.asked(book, t, acc.account, acc.balance));
        if (p.automation) steps.push(...fleet.paperwork(book, t, acc.account));
        payAccount = acc.account;
        steps.push(...answering.steps(book, t, acc.account, acc.balance));
        steps.push(...staffing.shortening(book, t, acc.account, acc.balance));
        steps.push(...staffing.routine(obs, book, acc.account, {
          // Only with room at the workplace (someone let go may still be there, working out their notice).
          target: trading && !p.operator ? Math.min(p.max_staff, headcount) : 0, wage, canPost: trading && !p.operator && acc.balance >= monthsInHand() * Math.floor(((workers.length + 1) * wage * MONTH) / p.period) && roomAtWork(obs, workers.length) > 0,
          why: `Short of this month's headcount (${workers.length} of ${headcount}${headcountWhy}): posting a job at ${usd(wage)} every ${p.period / DAY} days.`,
        }));
        steps.push(...borrowing.steps(book, t, acc.account));
        // Insolvent (it can't pay its debts as they fall due): wind up.
        const insolvent = winding.insolvent(t, book, { balance: acc.balance, noCredit: !borrowing.canApply(t) && !borrowing.waiting(t), defaulted: borrowing.impaired });
        const idle = insolvent ? null : winding.idle(t, !!p.operator || workers.length > 0 || staffing.offered(book, t).length > 0);
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
            if (s.length) { headcount = Math.min(headcount, keeping - 1); staffing.cashLayoffAt = t; }
            steps.push(...s);
          }
        }

        // ---- our price list: where we are, and what we charge ----
        // A business of one whose owner has gone from the town, or has nowhere to trade from: its prices come down, what
        // it was to serve is refunded, and (gone) what it holds goes to its owner's account and it says it has closed.
        if (p.operator && (at.gone || at.nowhere)) {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          if (old.length) steps.push(because(at.givenUp ? "Our owner has given the business up: we have stopped trading." : at.gone ? "Our owner has gone: we have stopped trading." : "Nowhere to trade from: our prices come down until there is.", ...old.map((r) => withdraw(r.id, "Not trading."))));
          publishedPrice = -1;
          for (const x of queue.splice(0)) steps.push(fillWith(x.o, 0, x.served, [], "We are not trading: refunding what we had not served."));
          for (const o of orders.due(book, t).paid) steps.push(fillWith(o, 0, 0, [], "We are not trading: refunding the order."));
          if (at.gone && !at.closed) {
            at.closed = true;
            // (A business that closes pays its suppliers what it owes them first, out of what it holds; the rest is its owner's.)
            const owed = payables.settle(t, acc.account, acc.balance);
            const out = distribute(book, me, acc, acc.balance - owed.paid, at.givenUp ? "Our owner has given the business up: what it holds is theirs" : "Our owner has gone from the town: what the business holds is theirs");
            steps.push(...owed.steps, ...out.steps, because(at.givenUp ? "Closed: our owner has given the business up." : "Closed: our owner has gone.", say("closure", `${me} has closed: its owner has ${at.givenUp ? "given it up" : "gone"}.`, { visible: "public", data: { firm: me, to_creditors: 0, to_shareholders: out.paid, ...(at.givenUp ? { given_up: true } : {}) } })));
          }
          return steps;
        }
        if (price !== publishedPrice && winding.state === "trading") {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedPrice = price;
          steps.push(because(old.length ? priceWhy || `Our price is now ${usd(price)}.` : "Publishing our price.", ...old.map((r) => withdraw(r.id, "Superseded.")),
            priceList({ [p.kind]: price }, acc.account, `${p.kind} at ${usd(price)} each, at ${at.premises}: delivered to your home, or kept here for you. Order and pay with the order.`, { at: at.premises }, me, p.shopfront ? premisesOf(obs)?.cell ?? (at.cell || undefined) : undefined)));
        }

        // ---- what we owe our suppliers for stock delivered on their terms: paid on the day (daily, not with the week's order), wages first ----
        if (trading) steps.push(...payables.pay(t, acc.account, acc.balance, Math.max(workers.length, headcount) * wage));

        // ---- restocking, weekly: below the middle of Lengnick's band of last month's sales, up to its top ----
        if (t >= nextRestock && offers.length && winding.state === "trading") {
          nextRestock = t + (p.operator ? 1 : 7) * DAY; // (someone trading alone on a few days' stock buys when it runs low, not once a week)
          const top = Math.ceil((p.phi_high_bps * stockFor(lastDemand)) / 10_000);
          const mid = Math.ceil((((p.phi_low_bps + p.phi_high_bps) / 2) * stockFor(lastDemand)) / 10_000);
          const have = stock + onOrder;
          const best = offers[0]!;
          // As much as we can pay for, keeping the next pay period's wages aside (and at least the supplier's minimum).
          // (Keeping the next pay period's wages for the staff we have or are hiring to: this month's headcount.)
          // On the supplier's terms (if it states any, and we are not behind with it), what we can order is what we can pay for out of what
          // we expect to sell in the time it gives, less what we already owe it: stock no longer comes out of the wage bill in the week
          // it is bought (docs/behaviour/trade.md, "Trade credit").
          const keepForWages = Math.max(workers.length, headcount) * wage;
          const terms = p.credit && best.terms && !payables.behind(best.seller, t) ? best.terms : 0;
          const room = terms ? Math.max(0, Math.floor((lastDemand * best.unit * terms) / 30) - payables.owing) : 0;
          const affordable = Math.floor((acc.balance - payables.pending(t) - keepForWages + room) / best.unit);
          if (have < mid) {
            const q = Math.min(Math.max(best.min, top - have), affordable);
            if (q >= best.min) {
              onOrder += q;
              const st = order({ me, seller: best.seller, sellerAccount: best.account, kind: p.kind, quantity: q, unitPrice: best.unit, at: at.premises, from: acc.account, ...(terms ? { terms } : {}),
                why: `Restocking: ${stock} in stock and ${onOrder - q} on order, below ${mid} (the middle of our band of last month's sales, ${lastDemand}): ordering ${q}${q < top - have ? `, as many as we can pay for (up to ${top} would fill our band)` : ""} from ${best.seller}, the cheapest of our suppliers at ${usd(best.unit)}${terms ? `, on its terms (to pay within ${terms} days of delivery)` : ""}.` });
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

        // ---- the owner's draw (a business run by its owner alone): every so often, what it holds beyond the money for
        // its stock (the top of its band, or a supplier's least order if that is more) goes to its owner ----
        if (p.draw_days > 0 && winding.state === "trading") {
          if (nextDraw < 0) nextDraw = t + p.draw_days * DAY;
          if (t >= nextDraw) {
            nextDraw = t + p.draw_days * DAY;
            // (At what its supplier charges now, and a tenth over: kept to the last unit, a rise in the price left it
            // one item short of the least order, and it never bought again.)
            const keep = Math.ceil((Math.max(Math.ceil((p.phi_high_bps * stockFor(lastDemand)) / 10_000), offers[0]?.min ?? 0) * Math.max(unitCost, offers[0]?.unit ?? 0) * 11) / 10) + payables.owing;
            if (acc.balance > keep) steps.push(...distribute(book, me, acc, acc.balance - keep, `We hold ${usd(acc.balance)} and keep ${usd(keep)} for stock: the rest is our owner's`).steps);
          }
        }

        // ---- serving: paid orders, oldest first, as far as today's hands and our stock go ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
          sysUsed.clear();
        }
        const mine = new Set(p.operator ? [p.operator] : workers);
        // (Its owner, where they work from: the room of their home, their pitch.)
        // (Its owner knows where they are: at home, there whenever; at a pitch, in its hours on working days. Out for
        // some other reason, the work is refused and the order waits, as when a shop's hand has just left.)
        const tod = t - Math.floor(t / DAY) * DAY;
        const present = p.operator ? (!p.open_until || (workDay(t) && tod >= p.open_from && tod < p.open_until) ? [p.operator] : [])
          // (Its staff serve in their working hours, where the world has them: a hand still in the workplace after the day's end is
          // on the way home, and work ordered then reaches the door after they have left, behind the walk home on their one
          // timeline. Foundations F6: the shop's manager is a resident now, and their own acts share the lane.)
          : p.open_until && !(workDay(t) && tod >= p.open_from && tod < p.open_until) ? []
          : [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.premises).flatMap((c) => c.structure!.spaces.flatMap((sp) => (sp.kind === "workplace" ? sp.occupants ?? [] : []))))].filter((w) => mine.has(w)).sort();
        // Every paid order joins the queue: what customers wanted, served or not.
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          if (o.kind !== p.kind || o.unitPrice < price) {
            steps.push(fillWith(o, 0, 0, [], `An order ${o.kind !== p.kind ? `for ${o.kind}, which we don't sell` : "below our price"}: refunding it.`));
            continue;
          }
          sold += o.quantity;
          takings.add(t, o.quantity * o.unitPrice);
          queue.push({ o, served: 0, since: t });
        }
        // Each worker's time left today; serving is shared evenly among those here, as the work is.
        const room = (w: string) => (workDay(t) ? Math.max(0, Math.floor((p.working_day * staffing.hoursBpsAt(w, t)) / 10_000) - (used.get(w) ?? 0)) : 0);
        // (Who serves today: those here with the most time between them, the work shared evenly.)
        const crew = team(present, room).who;
        let left = Math.max(0, stock - reserved);
        for (const x of [...queue]) {
          const want = x.o.quantity - x.served;
          // Systems of ours take the share of an order they can do, as far as their own day goes (a system works whatever the hour).
          const bySystem: { id: string; offer: string; units: number }[] = [];
          if (p.automation && left > 0) {
            const w = fleet.working(p.serve_task);
            if (w.length) {
              sysCredit += (want * Math.max(...w.map((s) => s.scope_bps))) / 10_000;
              let owed = Math.min(Math.floor(sysCredit), want, left);
              for (const sy of w) {
                const room = Math.floor((DAY - (sysUsed.get(sy.id) ?? 0)) / Math.max(1, sy.seconds));
                const units = Math.min(owed, room);
                if (units <= 0) continue;
                owed -= units;
                sysCredit -= units;
                sysUsed.set(sy.id, (sysUsed.get(sy.id) ?? 0) + units * sy.seconds);
                bySystem.push({ id: sy.id, offer: sy.lot.offer, units });
              }
            }
          }
          const qs = bySystem.reduce((n, b) => n + b.units, 0);
          const minRoom = crew.length ? Math.min(...crew.map(room)) : 0;
          const qc = Math.min(want - qs, left - qs, Math.floor((minRoom * crew.length) / pace.perUnit(crew)));
          const q = qs + qc;
          // (An order for a fortnight's shopping is served over the fortnight: it's what the household uses until then.)
          const within = x.o.forDays ?? p.serve_within_days;
          const out = left === 0 || (q === want) ? "done" : t - x.since >= within * DAY ? "late" : "wait";
          if (q === 0 && out === "wait") break; // no hands left today: the rest wait their turn
          const share = qc ? Math.ceil((qc * pace.perUnit(crew)) / crew.length) : 0;
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
          // (A system slips at the rate its supplier's offer gives, in the world's table of slips; an item it got wrong is refunded.)
          { let n = before;
            for (const b of bySystem) for (let k = 0; k < b.units; k++, n++) if (slip(systemsCtx, b.offer, `${x.o.id}.${n}`)) { if (!faulty.has(x.o.id)) faulty.set(x.o.id, new Set()); faulty.get(x.o.id)!.add(`${n}`); } }
          const st = fillWith(x.o, q, finished ? x.served : -1, qc ? crew : [], why, qc, bySystem);
          // (Orders are sent one at a time, each when the last is done, and a delivery takes the crew out: one that comes up after the
          // close finds the crew gone, so it is not sent: it waits for tomorrow, as an order not got to in the day does.)
          if (q && !p.operator && p.open_until) st.lapsed = (now) => now - Math.floor(now / DAY) * DAY >= p.open_until && Math.floor(now / DAY) === day;
          reserved += q;
          st.then = (res) => {
            reserved = Math.max(0, reserved - q);
            if (res.status === "applied") {
              books.out += q;
              return void (qc && pace.done(crew, Math.floor(t / DAY)));
            }
            // (A system the world refuses is switched off, or not ours: not counted on again.)
            if (bySystem.length) {
              sysCredit += qs;
              for (const b of bySystem) sysUsed.set(b.id, Math.max(0, (sysUsed.get(b.id) ?? 0) - b.units * (fleet.working(p.serve_task).find((s) => s.id === b.id)?.seconds ?? 0)));
              if (res.refusal?.code === "not_capable" || res.refusal?.code === "participant_inactive" || res.refusal?.code === "unknown_participant" || res.refusal?.code === "not_theirs") for (const b of bySystem) fleet.gone(b.id);
            }
            if (qc) pace.refused(res, qc, crew);
            for (const w of crew) if (share) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
            // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
            const short = outOfTime(res);
            if (short?.who) { used.set(short.who, p.working_day - short.left); for (const w of crew) used.set(w, Math.max(used.get(w) ?? 0, p.working_day - short.left)); } // (the crew shares the work, so the others have no more room than they)
            else if (short) for (const w of crew) used.set(w, p.working_day);
            // (A business of one whose owner could not work where they trade, for whatever the world's reason: the place
            // under water, the owner elsewhere. They see it, and try no more today.)
            else if (p.operator && q && res.status === "refused") {
              used.set(p.operator, p.working_day);
              if (String(res.refusal?.detail ?? "").startsWith(`${p.operator} isn't in the world`) || String(res.refusal?.detail ?? "").startsWith(`${p.operator} has died`)) at.gone = true; // (they are not in the town at all)
            }
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
        function fillWith(o: Order, q: number, total: number, staff: string[], why: string, byStaff = q, bySystem: { id: string; units: number }[] = []): Step {
          const s: Step = because(why);
          if (q > 0) {
            if (byStaff > 0) s.push(C.call("work", { task: p.serve_task, units: C.text(String(byStaff)), at: at.premises, by: C.json(staff) }));
            for (const b of bySystem) s.push(C.call("work", { task: p.serve_task, units: C.text(String(b.units)), at: at.premises, by: C.json([b.id]) }));
            s.push(C.call("goods", { kind: o.kind, quantity: C.text(String(q)), to: o.to, at: o.at, from_at: at.premises }));
          }
          if (total < 0) return s;
          const refund = (o.quantity - total + Math.min(total, faultyOf(o))) * o.unitPrice;
          faulty.delete(o.id);
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
    ), { beliefs: (): Belief[] => staffing.beliefs(book) }));
  },
};
