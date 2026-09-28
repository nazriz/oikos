// firm.producer: a factory, after Lengnick (2013), with inputs, wholesale and exports (phase B). Documented in
// docs/behaviour/producer.md, with sources.

import * as C from "../calls";
import type { Observation } from "../contracts";
import { channels } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, MONTH, ownAccount, pay, say, type Step, usd, withdraw } from "./common";
import { Staffing, stepper } from "./firms";
import { Deliveries, fill, goodsPrices, held, order, OrderBook, priceList } from "./trade";

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
  version: "0.1.0",
  doc: "docs/behaviour/producer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        works: "", // the factory: where it makes and keeps things
        workplace: "", // the space its workers work in
        role: "factory worker",
        max_staff: 40,
        task: "make",
        output: "goods",
        per_unit: { inputs: 10 } as { [kind: string]: number }, // what a unit of the task uses (its own knowledge of its process)
        labour_per_unit: 5400, // seconds of work per unit
        supplier: "outside", // whom it buys inputs from
        market: "outside", // whom it exports to (its buying offer)
        wage: 150_000, // the wage it offers new hires, cents per period
        period: 14 * DAY,
        notice_days: 14,
        working_day: 8 * 3600,
        work_days: 5, // of every 7
        price: 6000, // its wholesale price, cents each
        // Lengnick (2013), Table 1 (as basis points of 1):
        phi_low_bps: 2500, // hire when stock is below this share of last month's demand
        phi_high_bps: 10_000, // let one go when it's above this
        delta_bps: 190, // wage steps: up to 1.9%
        gamma_months: 24, // months fully staffed before the wage offered falls
        price_up_bound_bps: 11_500, // raise the price only while it's below 1.15 x marginal cost
        price_down_bound_bps: 10_250, // lower it only while it's above 1.025 x marginal cost
        theta_bps: 7500, // the chance a price change is made
        vartheta_bps: 200, // price steps: up to 2%
        chi_bps: 1000, // the liquidity buffer, as a share of the monthly wage bill
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role });
    const orders = new OrderBook(me);
    const deliveries = new Deliveries();
    const onOrder = new Map<string, number>(); // inputs ordered, not yet delivered
    const orderQty = new Map<string, { kind: string; quantity: number }>();
    const used = new Map<string, number>(); // worker -> seconds worked today
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
    let exported = 0; // shipped under this month's offer
    let nextShipment = 0;
    const workDay = (t: number) => Math.floor(t / DAY) % 7 < p.work_days;
    const monthlyUnits = (workers: number) => Math.floor((workers * p.working_day * p.work_days * 30) / 7 / p.labour_per_unit);
    const hourly = () => Math.ceil((wage * 3600) / ((p.period / DAY) * (p.work_days / 7) * p.working_day));

    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        orders.take(obs, ownAccount(obs)?.account);
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
        if (!acc) return steps;
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
        const marginalCost = inputCost + Math.ceil((hourly() * p.labour_per_unit) / 3600);
        const stock = held(obs, p.works, p.output);

        // ---- the month's end: Lengnick's rules ----
        const m = Math.floor(t / MONTH);
        if (month < 0) month = m;
        if (m !== month) {
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
          const unfilled = posts.some((x) => t - x.at >= MONTH);
          if (unfilled) {
            const up = rng.below(p.delta_bps + 1);
            wage = Math.floor((wage * (10_000 + up)) / 10_000);
            fullMonths = 0;
            why.push(`a job we posted has gone unfilled for a month: offering ${up / 100}% more (${usd(wage)} a fortnight)`);
          } else if (!posts.length && workers.length > 0) {
            if (++fullMonths >= p.gamma_months) {
              const down = rng.below(p.delta_bps + 1);
              wage = Math.floor((wage * (10_000 - down)) / 10_000);
              fullMonths = 0;
              why.push(`fully staffed for ${p.gamma_months} months: offering ${down / 100}% less to new hires (${usd(wage)} a fortnight)`);
            }
          }
          // Prices: move within bounds set by marginal cost, when stock says so.
          const low = stock * 10_000 < p.phi_low_bps * lastDemand;
          const high = stock * 10_000 > p.phi_high_bps * lastDemand;
          if (low && price * 10_000 < p.price_up_bound_bps * marginalCost && rng.below(10_000) < p.theta_bps) {
            const up = rng.below(p.vartheta_bps + 1);
            price = Math.ceil((price * (10_000 + up)) / 10_000);
            priceWhy = `Month's end: stock (${stock}) is low against last month's demand (${lastDemand}), and our price is under ${p.price_up_bound_bps / 100}% of marginal cost (${usd(marginalCost)}): raising it ${up / 100}% to ${usd(price)}.`;
          } else if (high && price * 10_000 > p.price_down_bound_bps * marginalCost && rng.below(10_000) < p.theta_bps) {
            const down = rng.below(p.vartheta_bps + 1);
            price = Math.max(1, Math.floor((price * (10_000 - down)) / 10_000));
            priceWhy = `Month's end: stock (${stock}) is high against last month's demand (${lastDemand}), and our price is over ${p.price_down_bound_bps / 100}% of marginal cost (${usd(marginalCost)}): cutting it ${down / 100}% to ${usd(price)}.`;
          }
          headcountWhy = why.length ? `; ${why.join("; ")}` : "";
          // Hiring and letting go (Lengnick): stock against demand decides this month's headcount.
          headcount = workers.length;
          if (low && workers.length < p.max_staff) {
            headcount = workers.length + 1;
            headcountWhy = `: at the month's end, stock (${stock}) was below ${p.phi_low_bps / 100}% of last month's demand (${lastDemand})${headcountWhy}`;
          } else if (high && workers.length > 0) {
            headcount = workers.length - 1;
            steps.push(...staffing.letGo(book, t, `Month's end: stock (${stock}) is above last month's demand (${lastDemand}): letting one worker go.`, "Redundancy: we're making more than we sell."));
          }
          // Out of the month's earnings, what we hold beyond the buffer goes to the shareholders: the buffer is a month's
          // wages and inputs for this month's headcount (we pay both ahead of what we sell), plus Lengnick's chi of the
          // wage bill. The capital we started with isn't paid out.
          const staffFor = Math.max(workers.length, headcount);
          const bill = Math.floor((staffFor * wage * MONTH) / p.period);
          const inputsMonth = monthlyUnits(staffFor) * inputCost;
          const buffer = bill + inputsMonth + Math.floor((bill * p.chi_bps) / 10_000);
          const holders = (book.open("shareholders").filter((r) => r.speaks_for === me).sort((a, b) => b.at - a.at)[0]?.data?.holders ?? []) as { holder: string; account: string; shares: number }[];
          const total = holders.reduce((x, h) => x + h.shares, 0);
          const earned = monthStart < 0 ? 0 : acc.balance - monthStart;
          const surplus = Math.min(acc.balance - buffer, earned);
          monthStart = acc.balance - Math.max(0, total > 0 ? surplus : 0);
          if (surplus > 0 && total > 0) {
            const lines = holders.map((h) => [h, Math.floor((surplus * h.shares) / total)] as const).filter(([, x]) => x > 0);
            // A program has at most 32 lines: paid in batches.
            for (let i = 0; i < lines.length; i += 30) steps.push(because(`Month's end: we took in ${usd(earned)} more than we paid out this month, and hold ${usd(acc.balance)} against a buffer of ${usd(buffer)} (a month's wages and inputs, and ${p.chi_bps / 100}% of the wage bill): paying ${usd(surplus)} to our shareholders by their shares${lines.length > 30 ? ` (payments ${i + 1}-${Math.min(lines.length, i + 30)} of ${lines.length})` : ""}.`,
              ...lines.slice(i, i + 30).map(([h, x]) => pay(h.account, x, { from: acc.account, for: "Dividend." }))));
          }
        }

        // ---- staff: this month's headcount (hiring for it, or replacing someone who's left) ----
        steps.push(...staffing.routine(obs, book, acc.account, {
          target: Math.min(p.max_staff, headcount), wage, canPost: acc.balance >= Math.floor(((workers.length + 1) * wage * MONTH) / p.period),
          why: `Short of this month's headcount (${workers.length} of ${headcount}${headcountWhy}): posting a job at ${usd(wage)} a fortnight.`,
        }));
        // Can't cover the next pay period: let the most recent hire go.
        if (workers.length && acc.balance < workers.length * wage) {
          steps.push(...staffing.letGo(book, t, `Can't cover the next pay period (${usd(acc.balance)} for ${workers.length} staff): letting the most recent hire go.`, "Redundancy: we can't cover the wage bill."));
        }

        // ---- our price list ----
        if (price !== publishedPrice) {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedPrice = price;
          steps.push(because(old.length ? priceWhy || `Our wholesale price is now ${usd(price)}.` : "Publishing our wholesale price.", ...old.map((r) => withdraw(r.id, "Superseded.")),
            priceList({ [p.output]: price }, acc.account, `Wholesale ${p.output} from ${me}: ${usd(price)} each, delivered. Order and pay with the order.`)));
        }

        // ---- inputs: (s, S): below a month's use (with what's on order), order up to a month and a half's ----
        const plan = monthlyUnits(workers.length);
        for (const [kind, per] of Object.entries(p.per_unit).sort(([a], [b]) => (a < b ? -1 : 1))) {
          const have = held(obs, p.works, kind) + (onOrder.get(kind) ?? 0);
          const s = plan * per;
          const up = Math.floor((plan * per * 3) / 2);
          const unit = supply.prices[kind];
          if (have >= s || unit === undefined || !supply.account) continue;
          const q = up - have;
          if (acc.balance < q * unit) continue;
          onOrder.set(kind, (onOrder.get(kind) ?? 0) + q);
          const st = order({ me, seller: p.supplier, sellerAccount: supply.account, kind, quantity: q, unitPrice: unit, at: p.works, from: acc.account,
            why: `Our ${kind} (${have} with what's on order) are below a month's production (${s}): ordering ${q}, up to a month and a half's.` });
          st.then = (out) => {
            const id = out.created?.order;
            if (id) orderQty.set(id, { kind, quantity: q });
            else onOrder.set(kind, Math.max(0, (onOrder.get(kind) ?? 0) - q));
          };
          steps.push(st);
        }

        // ---- the day's work: everyone of ours at the works, as much as the inputs allow ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        const mine = new Set(workers);
        const present = [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.works).flatMap((c) => c.structure!.spaces.flatMap((sp) => (sp.kind === "workplace" ? sp.occupants ?? [] : []))))].filter((w) => mine.has(w)).sort();
        // Beyond the top of Lengnick's band, more stock is no use: the workers are paid, but nothing is made today.
        const enough = stock * 10_000 > p.phi_high_bps * lastDemand;
        if (workDay(t) && present.length && !enough) {
          const avail = Math.min(...present.map((w) => p.working_day - (used.get(w) ?? 0)));
          const byHours = Math.floor((avail * present.length) / p.labour_per_unit);
          const byInputs = Math.min(...Object.entries(p.per_unit).map(([k, q]) => Math.floor(held(obs, p.works, k) / q)));
          const units = Math.min(byHours, byInputs);
          if (units > 0) {
            const share = Math.ceil((units * p.labour_per_unit) / present.length);
            for (const w of present) used.set(w, (used.get(w) ?? 0) + share);
            const st = because(`The day's work: ${present.length} of our workers making ${units} ${p.output}${byInputs < byHours ? ` (all our inputs allow)` : ""}.`,
              C.call("work", { task: p.task, units: C.text(String(units)), at: p.works, by: C.json(present) }));
            st.then = (out) => { if (out.status !== "applied") for (const w of present) used.set(w, Math.max(0, (used.get(w) ?? 0) - share)); };
            steps.push(st);
          }
        }

        // ---- wholesale: fill paid orders from stock ----
        let left = stock;
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          const ok = o.kind === p.output && o.unitPrice >= price;
          const q = ok ? Math.min(o.quantity, left) : 0;
          left -= q;
          domestic += o.quantity;
          steps.push(fill(o, q, p.works, acc.account, !ok ? `An order ${o.kind !== p.output ? `for ${o.kind}, which we don't sell` : "below our price"}: refunding it.` : q === o.quantity ? `An order paid in full: delivering ${q} ${o.kind}.` : `An order paid in full: we have ${q} of the ${o.quantity}; delivering them and refunding the rest.`));
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, delivered: 0, refund: 0, declined: "unpaid" } })));
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
            };
            steps.push(st);
          }
        }
        return steps;
      },
    );
  },
};
