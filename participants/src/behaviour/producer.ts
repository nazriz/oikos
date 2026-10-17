// firm.producer: a factory, after Lengnick (2013), with inputs, wholesale and exports (phase B). Documented in
// docs/behaviour/producer.md, with sources.

import { keeping, Org, type OrgParams } from "./orgwants";
import { Respondent, type RespondParams } from "./frictions";
import * as C from "../calls";
import { cents } from "../money";
import type { Observation } from "../contracts";
import { channels } from "../contracts";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { breaches, nextLook, because, Book, publishedPrice as buildingPrice, DAY, MONTH, ownAccount, Pace, pay, say, type Step, usd, withdraw, outOfTime, team } from "./common";
import { type AdjustParams, Bargaining, LabourPlan, Takings, Staffing, stepper, terminationLaw, WindingUp } from "./firms";
import { Borrowing } from "./credit";
import { distribute, LENGNICK, movePrice, moveWage, payOut } from "./lengnick";
import { Committed, declineOnTerms, Deliveries, fill, goodsPrices, held, order, OrderBook, Payables, priceList } from "./trade";
import * as P from "./papers";
import { ADOPTION, Adoption, capacityOf, Fleet, type AdoptionParams } from "./automation";

/**
 * A factory. Its workers' hours turn inputs into goods (the task `make`, at its works); it keeps inputs for the next
 * month's production by an (s, S) rule, sells goods wholesale to whoever orders, and ships what it doesn't need to
 * keep to the world market under its monthly buying offer. Monthly, Lengnick's rules: hire when stock is low against
 * demand, let a worker go when it's high; raise the wage it offers after a vacancy nobody took, lower it after
 * `gamma_months` fully staffed; move its price within bounds set by marginal cost; pay out what it holds beyond a
 * buffer to its shareholders.
 */
export const producer: BehaviourModule = {
  name: "firm.producer",
  issues: [P.JOB_ADVERTISEMENT, ...P.TRADE, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "factory worker", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }) }),
  version: "0.10.0", // 0.10.0: after a stoppage its offer follows what the stoppage cost it in output sold, not a fixed share of the gap (docs/behaviour/unions.md, "Concession"); 0.9.0: over its stock band, where the world's law lets an employer cut hours, it cuts everyone's hours by a hand's worth before it lets anyone go, and makes in its staff's hours (docs/behaviour/firms.md, "Hours before heads"); 0.8.0: 0.8.0: buys its inputs on the supplier's terms where it states them, and sells to shops on terms of its own where its world gives them (docs/behaviour/trade.md, "Trade credit"); makes and buys to what it can sell, and none while a unit loses money before wages (docs/behaviour/producer.md, "Inputs bought to what can be sold"); borrows again as its bank allows; no dividend while wages are owed or anyone is under notice (docs/behaviour/firms.md, "Before a dividend"); 0.7.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.7.0: 0.7.0: adjusts its staff as firms do (docs/behaviour/firms.md, "Adjusting labour"): demand smoothed over months, people held while it makes less, let go only when the surplus has lasted what ending the job costs, redundancy pay under the world's law, no recruiting after letting someone go for want of money; 0.6.0: everyday frictions (docs/behaviour/frictions.md): pay that comes short, at the world's rate and its character's; asked, told or ordered to put it right; 0.5.0: wants of its own (docs/behaviour/firm-wants.md): a character from its owner's values, which answers a worker who asks for a rise, and a record of its own; 0.4.5: money promised in orders the bank has not yet paid out is not spent again by the next wake (one works placed the same order 40 times in a day); 0.4.4: 0.4.4: takes on the share of its hands the world gives by the day; 0.4.3: registers the share of its jobs the world gives for its kind
  doc: "docs/behaviour/producer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        works: "", // the factory: where it makes and keeps things
        workplace: "", // the space its workers work in
        role: "factory worker",
        industry: "", // what the work is (its postings say)
        max_staff: 40,
        task: "make",
        output: "goods",
        per_unit: { inputs: 10 } as { [kind: string]: number }, // what a unit of the task uses (its own knowledge of its process)
        labour_per_unit: 5400, // seconds of work per unit
        supplier: "", // whom it buys inputs from (the world must say)
        market: "", // whom it exports to, under its buying offer (the world must say)
        wage: 150_000, // the wage it offers new hires, cents per period
        period: 14 * DAY,
        notice_days: 14,
        // How it adjusts its staff to its trade (docs/behaviour/firms.md, "Adjusting labour"): the months it smooths
        // demand over, and what taking someone on costs it in weeks of their pay (placeholders; a world's profile may
        // state its own). 0 and 0: it reacts to each month's stock, as it did until 2026-10-11.
        adjust: { smooth_months: 3, hiring_cost_weeks: 8 } as AdjustParams,
        // Systems it may take up in place of some of its staff's work (docs/behaviour/automation.md): how it weighs them (the
        // world's figures). None: it looks at none (a world with no vendor).
        automation: null as AdoptionParams | null,
        // Of the jobs it fills, the share it puts on its payroll returns (the world's figure for employers of its kind;
        // 10,000: all). One it does not register is paid whole, and reported to nobody (docs/behaviour/firms.md).
        registered_bps: 10_000,
        // Work by the day (docs/behaviour/firms.md): of the jobs it fills, the share it fills by the day, and what it
        // pays for a day (the world's figures for employers of its kind; 0: every job is on a standing wage).
        casual_bps: 0, day_wage: 0,
        working_day: 8 * 3600,
        work_days: 5, // of every 7 look_at: 0, look_days: 5, // when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)
        price: 6000, // its wholesale price, cents each
        min_order: 50, // the least it sells in one order (it sells wholesale)
        lender: "", // whom it borrows from (none: it doesn't)
        // More than one loan (docs/behaviour/credit.md, "More than one loan"): after a loan is granted it may apply again this many
        // days later, and the bank decides on its rule, counting what it already repays (placeholder). -1: one loan at a time.
        borrow_again_days: 30,
        // Trade credit (docs/behaviour/trade.md, "Trade credit"). Selling: the terms it gives a customer who orders them
        // (`days` to pay after delivery; 0: cash with order, as it was), how long after the day it supplies an unpaid customer
        // on terms no more, and how long after it the debt is recorded against it (placeholders). Buying: whether it buys on
        // the terms a supplier states.
        terms_days: 0, terms_stop_after_days: 7, terms_claim_after_days: 30,
        credit: true,
        // Insolvency (docs/behaviour/insolvency.md; placeholders): short of wages this long with no credit, or in default on
        // a loan, and it winds up over this long.
        short_days: 60,
        wind_up_days: 60,
        idle_days: 90, // nobody working for us this long, our owners close us (placeholder)
        reprice_days: 30, // closed, our premises unsold this long: the asking price comes down (placeholder)
        reprice_bps: 1000, // by this much (placeholder)
        builder: "", // whose published prices say what our premises are worth (none: closed, they're not sold)
        premises_sale_bps: 5000, // closed, our premises are offered at this share of what building them new costs (placeholder)
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
        ...LENGNICK, // Lengnick (2013), Table 1
      },
      ctx.params,
    );
    const org = new Org(ctx, { initiative: p.initiative, owner_values: p.owner_values, values: p.values, org: p.org });
    need(p, ["supplier", "market"], "firm.producer");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, registered_bps: p.registered_bps, casual_bps: p.casual_bps, day_wage: p.day_wage, work_days: p.work_days, week_days: p.look_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), ...(p.short_pay ? { short: p.short_pay } : {}) });
    const labour = new LabourPlan(p.adjust);
    // (After letting someone go because we could not pay them, we take nobody on until we hold the wages of those we
    // would then have for as long as a surplus must last before a job is worth ending, where a month's is enough
    // otherwise: the test to take someone on is never weaker than the test to keep them. Until 2026-10-11 a works
    // short of money hired each month on a month's wages in hand and shed weeks later.)
    const monthsInHand = () => (staffing.cashLayoffAt > -Infinity && (p.adjust.smooth_months > 1 || p.adjust.hiring_cost_weeks > 0) ? labour.waits(terminationLaw(book), 0, 0, p.notice_days) : 1);
    // Asked to put something right (pay kept back), told of a complaint, or ordered to: what our books say of it
    // (what we kept back we know; whether goods were faulty we cannot), and setting someone's pay right from here on.
    let payAccount = "";
    const answering = new Respondent(ctx.rng, me, org, { params: p.respond, forms: [{ notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }],
      truth: (m) => (m.matter === "underpaid" && m.about ? { owed: staffing.owedShort(m.about) } : undefined),
      remedy: (m, _from, t, why) => (m.matter === "underpaid" && m.about && payAccount ? staffing.payInFull(book, t, payAccount, m.about, why) : undefined) });
    const borrowing = new Borrowing(me, p.lender, p.borrow_again_days >= 0 ? { again_days: p.borrow_again_days } : {});
    const takings = new Takings(); // what buyers have paid us and what we have invoiced the world market for: what a day without our work costs in output sold (Bargaining)
    const bargaining = new Bargaining(me, { takingsPerDay: (t) => takings.perDay(t), systemShare: (t) => (lastDemand > 0 ? Math.min(1, systemUnits(lastDemand) / lastDemand) : 0) });
    const fleet = new Fleet(me); // the systems delivered to us, and their licences
    const adoption = new Adoption(me, fleet, { ...ADOPTION, ...(p.automation ?? {}) });
    const sysUsed = new Map<string, number>(); // system -> seconds of today it has been given
    const UTILISATION = 8_000; // the share of a month a worker or a system is at the task, once its idle time is left out (a placeholder, as the shop's)
    const winding = new WindingUp(me, { short_days: p.short_days, wind_up_days: p.wind_up_days, idle_days: p.idle_days, reprice_days: p.reprice_days, reprice_bps: p.reprice_bps });
    // Our premises, as the sites we see show them (for selling them if we close).
    const premisesOf = (obs: Observation) => {
      const c = channels.cells(obs).find((x) => x.structure?.structure === p.works);
      return c?.structure ? { structure: c.structure.structure, type: c.structure.type, cell: c.cell } : undefined;
    };

    const orders = new OrderBook(me, undefined, p.terms_days > 0 ? { days: p.terms_days, stop_after_days: p.terms_stop_after_days, claim_after_days: p.terms_claim_after_days } : null);
    const payables = new Payables(me); // what we owe our supplier for inputs delivered on its terms
    const deliveries = new Deliveries();
    const making: { units: number; by: number }[] = []; // makings ordered whose crew has not had the hours for them yet (the work takes the crew's hours: F1, 2026-10-15)
    const committed = new Committed(); // inputs paid for with orders whose payment the bank has not yet made
    const onOrder = new Map<string, number>(); // inputs ordered, not yet delivered
    const orderQty = new Map<string, { kind: string; quantity: number }>();
    const used = new Map<string, number>(); // worker -> seconds worked today
    const pace = new Pace(p.labour_per_unit); // how long a unit takes, as we learn it (our figure at first)
    let usedDay = -1;
    let wage = p.wage;
    let price = p.price;
    let publishedPrice = -1;
    let month = -1;
    let domestic = 0; // this month: units ordered by customers
    let quota = 0; // this month: what our export customers would take (our share of the market's offer)
    let monthStart = -1; // what we held at the start of the month, after paying out
    let lastDemand = -1; // last month's demand (before the first month ends: what the staff can make)
    let lastDomestic = 0;
    let fullMonths = 0; // months in a row with every position filled
    let headcount = -1; // this month's staff target (set at each month's end; at first, the staff we have)
    let headcountWhy = "";
    let priceWhy = "";
    let nextLosingNote = 0;
    let exported = 0; // shipped under this month's offer
    let nextShipment = 0;
    const workDay = (t: number) => Math.floor(t / DAY) % 7 < p.work_days;
    const monthlyUnits = (workers: number) => Math.floor((workers * p.working_day * p.work_days * 30) / 7 / p.labour_per_unit);
    /** What our systems make of `units` a month: the share they can do, as far as their month's seconds go. */
    const systemUnits = (units: number) => {
      const w = p.automation ? fleet.working(p.task) : [];
      if (!w.length) return 0;
      return Math.min(Math.floor((units * Math.max(...w.map((s) => s.scope_bps))) / 10_000), w.reduce((x, s) => x + capacityOf(s.seconds, UTILISATION), 0));
    };
    const systemFees = () => fleet.inService(p.task).reduce((x, l) => x + l.fee_month * l.systems.length, 0);
    /** Room in our workplace: its capacity less our staff, or the bodies in it now if more (staff come and go each day). */
    const roomAtWork = (obs: Observation, staff: number) => {
      const sp = channels.cells(obs).find((c) => c.structure?.structure === p.works)?.structure?.spaces.find((x) => x.kind === "workplace");
      return sp ? sp.capacity - Math.max(sp.count, staff) : p.max_staff;
    };
    /** The world market's standing offer for what we make, if one is open. */
    const exportOffer = (t: number) => book.open("buying_offer").filter((r) => r.speaks_for === p.market && r.data?.kind === p.output && (r.data?.until ?? Infinity) > t).sort((a, b) => b.at - a.at)[0];
    const hourly = () => Math.ceil((wage * 3600) / ((p.period / DAY) * (p.work_days / 7) * p.working_day));

    staffing.org = org;
    return keeping(org, Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        if (p.automation) fleet.absorb(book);
        winding.absorb(obs, ownAccount(obs)?.account);
        orders.take(obs, ownAccount(obs)?.account);
        committed.take(obs, ownAccount(obs)?.account);
        payables.take(book);
        for (const d of deliveries.take(book, me)) {
          const o = orderQty.get(d.order);
          if (!o) continue;
          orderQty.delete(d.order);
          onOrder.set(o.kind, Math.max(0, (onOrder.get(o.kind) ?? 0) - o.quantity));
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
        if (!acc) return steps;
        if (winding.due(t)) {
          // (What we owe our supplier for inputs delivered on its terms is paid first, as the debts recorded against us are.)
          const owed = payables.settle(t, acc.account, acc.balance);
          return [...owed.steps, ...winding.finish(t, book, acc.account, acc.balance - owed.paid, (x) => distribute(book, me, acc, x, "Wound up: what's left, to our shareholders by their shares").steps)];
        }
        const trading = winding.state === "trading";
        const workers = staffing.workers(book, t);
        // Before a month's history: what our export customers want (our share of the market's offer), or failing that
        // what our staff can make.
        if (lastDemand < 0) {
          const offer = book.open("buying_offer").find((r) => r.speaks_for === p.market && r.data?.kind === p.output);
          const share = (offer?.data?.quantities as { [s: string]: number } | undefined)?.[me];
          lastDemand = share ?? monthlyUnits(workers.length);
        }
        if (headcount < 0) headcount = workers.length;
        if (monthStart < 0) monthStart = acc.balance;
        const supply = goodsPrices(book, p.supplier);
        const inputCost = Object.entries(p.per_unit).reduce((x, [k, q]) => x + q * (supply.prices[k] ?? 0), 0);
        // (What making a unit costs: its inputs and its hours at the wage, and where systems make some, their fees spread over the units they make.)
        const labourCost = Math.ceil((hourly() * p.labour_per_unit) / 3600);
        const byUs = systemUnits(Math.max(0, lastDemand));
        const marginalCost = inputCost + (byUs > 0 && lastDemand > 0 ? Math.ceil(((lastDemand - byUs) * labourCost + systemFees()) / lastDemand) : labourCost);
        const stock = held(obs, p.works, p.output);
        // What a unit fetches on the trade we have (last month's orders at our price, what the world market would take at its),
        // against what its inputs cost now. Under it, a unit made loses money before a wage is paid: we buy no inputs for it,
        // and take nobody on to make it (docs/behaviour/producer.md, "Inputs bought to what can be sold").
        const offerNow = exportOffer(t);
        const exportUnit = offerNow ? Number(offerNow.data!.unit_price) || 0 : 0;
        const exportShare = offerNow ? (Number((offerNow.data?.quantities as { [s: string]: number } | undefined)?.[me] ?? offerNow.data?.quantity) || 0) : 0;
        // (Each channel on its own: orders at home are made for if our price covers the inputs, the world market's if its does.)
        const known = lastDomestic + exportShare;
        const homeOk = price >= inputCost, abroadOk = exportUnit >= inputCost;
        const sellable = (homeOk ? lastDomestic : 0) + (abroadOk ? exportShare : 0);
        const tradeUnits = known > 0 ? sellable : Math.max(0, lastDemand);
        const fetches = sellable > 0 ? Math.floor(((homeOk ? lastDomestic * price : 0) + (abroadOk ? exportShare * exportUnit : 0)) / sellable) : price;
        const losing = inputCost > 0 && known > 0 && sellable === 0;
        const sellableShare = known > 0 ? sellable / known : 1;

        // ---- the month's end: Lengnick's rules ----
        const m = Math.floor(t / MONTH);
        if (month < 0) month = m;
        if (m !== month && trading) {
          month = m;
          // Demand (Lengnick): what customers wanted, met or not: their orders, and what our export customers would take.
          lastDemand = domestic + quota;
          lastDomestic = domestic;
          domestic = 0;
          exported = 0;
          const rng = ctx.rng(`month-${m}`);
          const why: string[] = [];
          // Wages: a vacancy nobody took all month raises the wage offered; a long run fully staffed lowers it.
          const posts = staffing.postings(book);
          const w = moveWage(p, rng, wage, { unfilled: posts.some((x) => t - x.at >= MONTH), posting: posts.length > 0, staffed: workers.length > 0, fullMonths });
          wage = w.wage;
          fullMonths = w.fullMonths;
          if (w.why) why.push(w.why);
          // Prices: move within bounds set by marginal cost, when stock says so.
          const moved = movePrice(p, rng, price, stock, lastDemand, marginalCost);
          price = moved.price;
          if (moved.why) priceWhy = moved.why;
          // (Staff are set against the demand we expect: the months smoothed, never one month's alone.)
          const expected = labour.expect(lastDemand);
          const low = stock * 10_000 < p.phi_low_bps * expected;
          const high = stock * 10_000 > p.phi_high_bps * expected;
          const demandWords = p.adjust.smooth_months > 1 ? `the demand we expect (${expected} a month; last month ${lastDemand})` : `last month's demand (${lastDemand})`;
          headcountWhy = why.length ? `; ${why.join("; ")}` : "";
          // Hiring and letting go (Lengnick): stock against demand decides this month's headcount.
          headcount = workers.length;
          // Hours before heads (docs/behaviour/firms.md): over its band, a works whose law lets it cuts everyone's hours by
          // one hand's worth before it lets anyone go; stock back in band, or low, the hours are restored.
          // (Systems of ours make part of what is wanted, so our people need make only the rest: more hands than that is a surplus, as stock above the band is.)
          const peopleNeeded = p.automation && systemUnits(expected) > 0 ? Math.ceil(((expected - systemUnits(expected)) * p.labour_per_unit * 10_000) / (((p.working_day * p.work_days * 30) / 7) * UTILISATION)) : -1;
          const overStaffed = peopleNeeded >= 0 && workers.length > Math.max(1, peopleNeeded) && !low;
          const overBy = (high || overStaffed) && workers.length > 0;
          const hoursNow = staffing.reviewHours(book, t, overBy ? Math.floor(((workers.length - 1) * 10_000) / workers.length) : 10_000, p.adjust.hours_step_bps);
          steps.push(...hoursNow.steps);
          const absorbed = overBy && Math.floor((workers.length * hoursNow.achieved) / 10_000) <= workers.length - 1;
          if (absorbed) {
            labour.month(false, 1);
            steps.push(because(`Month's end: stock (${stock}) is above ${demandWords}: making less, with everyone's hours cut to ${hoursNow.achieved / 100}% of the ordinary, and no one let go.`));
          } else if (low && workers.length < p.max_staff && !losing) {
            labour.month(false, 1);
            headcount = workers.length + 1;
            headcountWhy = `: at the month's end, stock (${stock}) was below ${p.phi_low_bps / 100}% of ${demandWords}${headcountWhy}`;
          } else if ((high || overStaffed) && workers.length > 0) {
            // Over stock: the works already makes nothing beyond the band (its people are paid and idle: labour held
            // through the dip). Someone is let go only once that has lasted as long as ending the job and hiring
            // again would cost; meanwhile nobody who leaves is replaced (docs/behaviour/firms.md, "Adjusting labour").
            const waits = labour.waits(terminationLaw(book), workers.length, staffing.lastHireYears(book, t), p.notice_days);
            const m = labour.month(true, waits);
            headcount = workers.length - 1;
            if (m.letGo) steps.push(...staffing.letGo(book, t, `Month's end: stock (${stock}) is above ${demandWords}${waits > 1 ? `, as for ${waits} months now` : ""}: letting one worker go.`, "Redundancy: we're making more than we sell."));
            else steps.push(because(`Month's end: stock (${stock}) is above ${demandWords}: making less and keeping our people for now (${m.lasted} of the ${waits} months such a surplus must last before letting someone go is worth what it costs), and replacing nobody who leaves.`));
          } else labour.month(false, 1);
          // Systems on offer: whether to take one for making, or to end a licence that has run its term (docs/behaviour/automation.md).
          if (p.automation) {
            const monthly = Math.floor((wage * MONTH) / p.period);
            steps.push(...adoption.review(book, t, { at: p.works, task: p.task, staff: workers.length, account: acc.account, balance: acc.balance, keep: 2 * workers.length * monthly + payables.owing + monthlyUnits(workers.length) * inputCost,
              breaks: (f) => breaches(book, { block: "deploy", task: f.task, offer: f.id, vendor: f.vendor }, me, t).map((l) => l.id), complies: (why) => ctx.rng(`comply-${why}`).below(10_000) < (p.automation?.compliance_bps ?? 10_000),
              facts: { units: expected, labour: p.labour_per_unit, wage_month: monthly, seconds_per_worker_month: (p.working_day * p.work_days * 30) / 7, utilisation_bps: UTILISATION, unit_price: price, hiring_cost_weeks: p.adjust.hiring_cost_weeks } }));
          }
          // Out of the month's earnings, what we hold beyond the buffer goes to the shareholders: the buffer is a month's
          // wages and inputs for this month's headcount (we pay both ahead of what we sell), plus Lengnick's chi of the
          // wage bill. The capital we started with isn't paid out.
          const staffFor = Math.max(workers.length, headcount);
          const bill = Math.floor((staffFor * wage * MONTH) / p.period);
          // (And what we owe our supplier for inputs delivered on its terms: a dividend must not take the money its invoices are paid from.)
          const buffer = bill + monthlyUnits(staffFor) * inputCost + Math.floor((bill * p.chi_bps) / 10_000) + payables.owing;
          // (Nothing is paid out while wages are owed or anyone is under notice: docs/behaviour/firms.md, "Before a dividend".)
          const out = staffing.strained(book, t) ? { steps: [because(`Month's end: ${staffing.strained(book, t)}, so nothing is paid out to our shareholders.`)], paid: 0 } : payOut(book, me, acc, acc.balance, buffer, monthStart < 0 ? 0 : acc.balance - monthStart, `a month's wages and inputs, and ${p.chi_bps / 100}% of the wage bill`);
          monthStart = acc.balance - out.paid;
          steps.push(...out.steps);
        }

        // ---- staff: this month's headcount (hiring for it, or replacing someone who's left) ----
        // Bargaining with a union (docs/behaviour/unions.md): a claim answered, an agreement's rise, a strike.
        steps.push(...bargaining.steps(book, t, staffing, acc.account, acc.balance, (rise) => { wage = Math.floor((wage * (10_000 + rise)) / 10_000); }));
        steps.push(...staffing.asked(book, t, acc.account, acc.balance));
        if (p.automation) steps.push(...fleet.paperwork(book, t, acc.account));
        payAccount = acc.account;
        steps.push(...answering.steps(book, t, acc.account, acc.balance));
        steps.push(...staffing.shortening(book, t, acc.account, acc.balance));
        steps.push(...staffing.routine(obs, book, acc.account, {
          // Only with room at the workplace (someone let go may still be there, working out their notice).
          target: trading ? Math.min(p.max_staff, headcount) : 0, wage, canPost: trading && acc.balance >= monthsInHand() * Math.floor(((workers.length + 1) * wage * MONTH) / p.period) && roomAtWork(obs, workers.length) > 0,
          why: `Short of this month's headcount (${workers.length} of ${headcount}${headcountWhy}): posting a job at ${usd(wage)} every ${p.period / DAY} days.`,
        }));
        // Can't cover the next pay period: let the most recent hire go.
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
            if (s.length) { headcount = Math.min(headcount, keeping - 1); staffing.cashLayoffAt = t; }
            steps.push(...s);
          }
        }

        // ---- our price list ----
        if (price !== publishedPrice && winding.state === "trading") {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedPrice = price;
          steps.push(because(old.length ? priceWhy || `Our wholesale price is now ${usd(price)}.` : "Publishing our wholesale price.", ...old.map((r) => withdraw(r.id, "Superseded.")),
            priceList({ [p.output]: price }, acc.account, `Wholesale ${p.output} from ${me}: ${usd(price)} each, at least ${p.min_order} to an order, delivered. Order and pay with the order${p.terms_days > 0 ? `, or order on terms and pay within ${p.terms_days} days of delivery` : ""}.`, { min_order: p.min_order, ...(p.terms_days > 0 ? { terms_days: p.terms_days } : {}) }, me)));
        }

        // ---- inputs: (s, S): below a month's use (with what's on order), order up to a month and a half's ----
        // As much as we can pay for, keeping the next pay period's wages aside for the staff we have or are hiring to, as a
        // shop does when it restocks (docs/behaviour/retailer.md): inputs are bought a month ahead of their use, and
        // wages fall due within the fortnight. (Until 2026-10-08 the whole balance went on an order: a works holding a
        // month's inputs spent its payroll on the next half month's, and gave its staff notice for want of the payroll.)
        // What a month's making is for: the trade we expect (the months smoothed) and what it takes to bring stock to the top of
        // its band, never more than our staff can make; nothing while a unit loses money before wages (above).
        const expectedUnits = Math.max(0, Math.floor((labour.expected >= 0 ? labour.expected : lastDemand) * sellableShare));
        const topOfBand = Math.ceil((p.phi_high_bps * expectedUnits) / 10_000);
        const plan = losing ? 0 : Math.min(monthlyUnits(workers.length) + (p.automation ? fleet.working(p.task).reduce((x, s) => x + capacityOf(s.seconds, UTILISATION), 0) : 0), expectedUnits + Math.max(0, topOfBand - stock));
        // Paying what has fallen due to the supplier (wages first), before this week's buying.
        if (trading) steps.push(...payables.pay(t, acc.account, acc.balance - committed.owed, Math.max(workers.length, headcount) * wage));
        let spare = acc.balance - committed.owed - payables.pending(t) - Math.max(workers.length, headcount) * wage;
        let onTerms = 0; // ordered on terms this wake (not yet in what we owe)
        for (const [kind, per] of Object.entries(p.per_unit).sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (winding.state !== "trading") break; // winding up: no more buying
          const have = held(obs, p.works, kind) + (onOrder.get(kind) ?? 0);
          const s = plan * per;
          const up = Math.floor((plan * per * 3) / 2);
          const unit = supply.prices[kind];
          if (have >= s || unit === undefined || !supply.account) continue;
          const least = supply.min_order ?? 1; // at least what the supplier sells in one order
          const want = Math.max(up - have, least);
          // On the supplier's terms (if it states any, and we are not behind with it): paid for after the goods are in, out of what we
          // sell in the time it gives, so inputs no longer come out of the wage bill in the week they are bought. The room is what the
          // trade we expect brings in over that time, less what we already owe it.
          const terms = p.credit && supply.terms_days && !payables.behind(p.supplier, t) ? supply.terms_days : 0;
          const room = terms ? Math.max(0, Math.floor((tradeUnits * fetches * terms) / 30) - payables.owing - onTerms) : 0;
          const q = Math.min(want, Math.floor((terms ? spare + room : spare) / unit));
          if (q < least || q <= 0) continue;
          if (terms) onTerms += q * unit; // (the order costs no cash now: it uses the room)
          else { spare -= q * unit; committed.add(supply.account, q * unit, t); }
          onOrder.set(kind, (onOrder.get(kind) ?? 0) + q);
          const st = order({ me, seller: p.supplier, sellerAccount: supply.account, kind, quantity: q, unitPrice: unit, at: p.works, from: acc.account, ...(terms ? { terms } : {}),
            why: `Our ${kind} (${have} with what's on order) are below a month's production (${s}, for the ${expectedUnits} ${p.output} we expect to sell${plan < monthlyUnits(workers.length) ? "" : ", as many as our staff can make"}): ordering ${q}${terms ? `, on ${p.supplier}'s terms (to pay within ${terms} days of delivery)` : ""}${q < want ? `, as many as ${terms ? "the trade we expect lets us pay for in that time" : "we can pay for with the next pay period's wages kept aside"} (${want} would take us up to a month and a half's)` : ", up to a month and a half's"}.` });
          st.then = (out) => {
            const id = out.created?.order;
            if (id) orderQty.set(id, { kind, quantity: q });
            else {
              onOrder.set(kind, Math.max(0, (onOrder.get(kind) ?? 0) - q));
              if (!terms) committed.undo(supply.account!, q * unit);
            }
          };
          steps.push(st);
        }
        if (losing && winding.state === "trading" && t >= nextLosingNote) {
          nextLosingNote = t + MONTH;
          steps.push(because(`A ${p.output} fetches ${usd(fetches)} on the trade we have, and its inputs cost ${usd(inputCost)}: buying none, and making only from what we hold.`));
        }

        // ---- the day's work: everyone of ours at the works, as much as the inputs allow ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
          sysUsed.clear();
        }
        const mine = new Set(workers);
        const present = [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.works).flatMap((c) => c.structure!.spaces.flatMap((sp) => (sp.kind === "workplace" ? sp.occupants ?? [] : []))))].filter((w) => mine.has(w)).sort();
        // Beyond the top of Lengnick's band, more stock is no use: the workers are paid, but nothing is made today.
        const enough = stock * 10_000 > p.phi_high_bps * lastDemand;
        // (Systems of ours work whatever the day and hour, within their own day; people only on a working day, those here.)
        const sysWorking = p.automation ? fleet.working(p.task) : [];
        const sysRoom = (sy: { id: string; seconds: number }) => Math.floor((DAY - (sysUsed.get(sy.id) ?? 0)) / Math.max(1, sy.seconds));
        if (((workDay(t) && present.length) || sysWorking.length) && !enough && winding.state === "trading") {
          const crew = workDay(t) && present.length ? team(present, (w) => Math.max(0, Math.floor((p.working_day * staffing.hoursBpsAt(w, t)) / 10_000) - (used.get(w) ?? 0))) : { who: [] as string[], each: 0 };
          const byHours = crew.who.length ? Math.floor((crew.each * crew.who.length) / pace.perUnit(crew.who)) : 0;
          const byInputs = Math.min(...Object.entries(p.per_unit).map(([k, q]) => Math.floor(held(obs, p.works, k) / q)));
          // No further than the top of the band: a day's making can be a lot next to a month's demand.
          const room = Math.max(0, Math.ceil((p.phi_high_bps * lastDemand) / 10_000) - stock - making.filter((x) => x.by > t).reduce((n, x) => n + x.units, 0));
          // Our systems make their share first (what they can do of the day's making, as far as their own day goes); our people the rest.
          const allowed = Math.min(byInputs, room);
          let sysLeft = sysWorking.length ? Math.min(sysWorking.reduce((n, sy) => n + sysRoom(sy), 0), Math.floor((allowed * Math.max(...sysWorking.map((sy) => sy.scope_bps))) / 10_000)) : 0;
          const bySystem: { id: string; units: number; seconds: number }[] = [];
          for (const sy of sysWorking) {
            const units = Math.min(sysLeft, sysRoom(sy));
            if (units <= 0) continue;
            sysLeft -= units;
            sysUsed.set(sy.id, (sysUsed.get(sy.id) ?? 0) + units * sy.seconds);
            bySystem.push({ id: sy.id, units, seconds: sy.seconds });
          }
          const qs = bySystem.reduce((n, b) => n + b.units, 0);
          const qc = Math.min(byHours, allowed - qs);
          const units = qs + qc;
          if (units > 0) {
            const share = qc > 0 ? Math.ceil((qc * pace.perUnit(crew.who)) / crew.who.length) : 0;
            for (const w of crew.who) if (qc > 0) used.set(w, (used.get(w) ?? 0) + share);
            const inFlight = { units, by: t + 2 * Math.max(share, ...bySystem.map((b) => b.units * b.seconds)) }; // (its crew may be busy first: twice the hours it needs, to be safe)
            making.splice(0, making.length, ...making.filter((x) => x.by > t), inFlight);
            const st = because(`The day's work: ${qc > 0 ? `${crew.who.length} of our workers` : ""}${qc > 0 && qs > 0 ? " and " : ""}${qs > 0 ? `${bySystem.length} of our systems` : ""} making ${units} ${p.output}${byInputs < byHours ? ` (all our inputs allow)` : ""}${qc > 0 && crew.who.length < present.length ? ` (the others here have done a day's work already)` : ""}.`,
              ...(qc > 0 ? [C.call("work", { task: p.task, units: C.text(String(qc)), at: p.works, by: C.json(crew.who) })] : []),
              ...bySystem.map((b) => C.call("work", { task: p.task, units: C.text(String(b.units)), at: p.works, by: C.json([b.id]) })));
            st.then = (out) => {
              if (out.status === "applied") return void (qc > 0 && pace.done(crew.who, Math.floor(t / DAY)));
              inFlight.by = 0;
              for (const b of bySystem) sysUsed.set(b.id, Math.max(0, (sysUsed.get(b.id) ?? 0) - b.units * b.seconds));
              // (A system the world refuses is switched off, or not ours: not counted on again.)
              if (bySystem.length && ["not_capable", "participant_inactive", "unknown_participant", "not_theirs"].includes(out.refusal?.code ?? "")) for (const b of bySystem) fleet.gone(b.id);
              if (qc > 0) pace.refused(out, qc, crew.who);
              for (const w of crew.who) if (qc > 0) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
              // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
              const short = outOfTime(out);
              if (short?.who) { used.set(short.who, p.working_day - short.left); for (const w of crew.who) used.set(w, Math.max(used.get(w) ?? 0, p.working_day - short.left)); } // (the crew shares the work, so the others have no more room than they)
              else if (short) for (const w of crew.who) used.set(w, p.working_day);
            };
            steps.push(st);
          }
        }

        // ---- wholesale: fill paid orders from stock ----
        let left = stock;
        const { paid, unpaid, stopped } = orders.due(book, t);
        for (const o of stopped) steps.push(declineOnTerms(o, me, `An order on our terms from ${o.buyer}, which has not paid what it owed us: declining it (cash with order, if it wants the goods).`));
        steps.push(...orders.collect(t, acc.account));
        for (const o of paid) {
          const ok = o.kind === p.output && o.unitPrice >= price && o.quantity >= p.min_order;
          const q = ok ? Math.min(o.quantity, left) : 0;
          left -= q;
          domestic += o.quantity;
          if (ok) takings.add(t, q * o.unitPrice);
          const filled = fill(o, q, p.works, acc.account, !ok ? `An order ${o.kind !== p.output ? `for ${o.kind}, which we don't sell` : o.quantity < p.min_order ? `for fewer than ${p.min_order}` : "below our price"}: refunding it.` : q === o.quantity ? `An order paid in full: delivering ${q} ${o.kind}.` : `An order paid in full: we have ${q} of the ${o.quantity}; delivering them and refunding the rest.`);
          // (On terms, what is delivered is billed once the goods have gone.)
          if (o.terms && q > 0) { const was = filled.then; filled.then = (out) => { if (out.status === "applied") orders.bill(o, q, t); return was?.(out); }; }
          steps.push(filled);
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } })));
        for (const [a, x] of orders.unclaimed(book)) {
          orders.refunded(a);
          steps.push(because("Money paid to us with no order waiting for it: sending it back.", pay(a, x, { from: acc.account, for: "Refund: no order of yours is waiting." })));
        }

        // ---- exports, weekly: what we needn't keep for customers, under the world market's offer ----
        const offerRec = book.open("buying_offer").filter((r) => r.speaks_for === p.market && r.data?.kind === p.output && (r.data?.until ?? Infinity) > t).sort((a, b) => b.at - a.at)[0];
        if (offerRec) quota = (offerRec.data?.quantities as { [seller: string]: number } | undefined)?.[me] ?? (offerRec.data?.quantity as number) ?? 0;
        if (t >= nextShipment) {
          nextShipment = t + 7 * DAY;
          // Keep stock for our customers here (the middle of Lengnick's band of what they ordered last month); the world
          // market is offered the rest, and what it sends back tells us we're making too much.
          const keep = Math.ceil((((p.phi_low_bps + p.phi_high_bps) / 2) * lastDomestic) / 10_000);
          const room = quota - exported;
          const q = Math.min(left - keep, room);
          if (offerRec && q > 0) {
            const unit = offerRec.data!.unit_price as number;
            exported += q;
            const st = because(`Exporting: ${q} ${p.output} we needn't keep (we keep ${keep} for customers), to the world market under its offer at ${usd(unit)} each; invoicing it.`,
              C.call("goods", { kind: p.output, quantity: C.text(String(q)), to: p.market, at: p.market, from_at: p.works }),
              ["invoice", say("invoice", `Invoice: ${q} ${p.output} at ${usd(unit)} each, ${usd(q * unit)}.`, { to: [p.market], visible: [me, p.market], basis: offerRec.id,
                data: { kind: p.output, quantity: q, from_at: p.works, outcome: { money: { to: acc.account, amount: String(q * unit), for: `${q} ${p.output} exported` } } } })]);
            st.then = (out) => {
              if (!out.created?.invoice) exported -= q; // not shipped after all
              else takings.add(t, q * unit); // (sold: what it is invoiced for is what a day without our work loses, as any sale)
            };
            steps.push(st);
          }
        }
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
    ), { beliefs: (): Belief[] => staffing.beliefs(book) }));
  },
};
