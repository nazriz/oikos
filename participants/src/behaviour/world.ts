// world.export_demand: the outside world buying from the town (a boundary
// condition, D31). Documented in docs/behaviour/boundary.md. Researcher-set:
// params.purchases = [{ to: account, amount: cents, every: seconds, memo? }].

import * as C from "../calls";
import { channels, type ParticipantAction, type StatementRecord } from "../contracts";
import { DAY, params, wait, type BehaviourModule } from "../module";
import { cents } from "../money";
import { because, Book, callAction, MONTH, pay, say, usd, withdraw, type Step } from "./common";
import { stepper } from "./firms";
import { fill, held, OrderBook, priceList } from "./trade";
import { DEFAULT_HOUSEHOLDS, drawHousehold, type HouseholdSpec } from "./household";

export const exportDemand: BehaviourModule = {
  name: "world.export_demand",
  version: "0.2.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const purchases: { to: string; amount: number; every: number; memo?: string }[] = ctx.params.purchases ?? [];
    const next = purchases.map((p) => p.every);
    return {
      step(obs) {
        const mine = channels.accounts(obs).find((a) => a.holder === obs.entity && a.custodian === obs.entity);
        if (!mine) return wait();
        const blocks: Step = [];
        purchases.forEach((p, i) => {
          while (next[i]! <= obs.t && blocks.length < 32) {
            blocks.push(pay(p.to, p.amount, { from: mine.account, for: p.memo ?? "export sales" }));
            next[i]! += p.every;
          }
        });
        return blocks.length ? callAction(Object.assign(blocks, { why: "The outside world's purchases due on the researcher's schedule." })) : wait();
      },
    };
  },
};

/**
 * world.trade: the outside world as a trader (a boundary condition, D31; docs/behaviour/boundary.md). The world
 * market is large next to a town, so it sells whatever is ordered at world prices and buys at world prices up to a
 * demand, both researcher-set:
 * - it publishes a price list (`sells`: a unit price for each kind) and fills paid orders from outside (the edge's
 *   own goods, which may go negative: they come from elsewhere);
 * - each month it publishes a buying offer for each kind it `buys` (a unit price and that month's quantity), and pays
 *   invoices for goods shipped to it under the offer, once the goods have arrived; goods beyond the month's quantity
 *   are sent back, unpaid.
 */
export const trade: BehaviourModule = {
  name: "world.trade",
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params(
      {
        account: "acc-outside",
        sells: {} as { [kind: string]: number }, // unit prices, cents
        buys: {} as { [kind: string]: { unit_price: number; per_month: number } },
        wait_days: 14, // how long an invoice waits for its goods before it's declined
      },
      ctx.params,
    );
    const me = ctx.entity;
    const book = new Book();
    const orders = new OrderBook(me);
    let published = false;
    const offers = new Map<string, string>(); // kind -> this month's buying offer
    let month = -1;
    const bought = new Map<string, number>(); // kind -> quantity accepted this month
    const sent = new Map<string, number>(); // kind -> quantity we've delivered from outside, all told
    const paidFor = new Map<string, number>(); // kind -> quantity received that we've paid for or sent back
    const baseline = new Map<string, number>(); // kind -> our holding when we first looked
    const answered = new Set<string>();

    return stepper(
      (obs) => {
        book.absorb(obs);
        orders.take(obs, p.account);
        for (const kind of new Set([...Object.keys(p.sells), ...Object.keys(p.buys)])) if (!baseline.has(kind)) baseline.set(kind, held(obs, me, kind));
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        if (!published && Object.keys(p.sells).length) {
          published = true;
          const list = Object.entries(p.sells).map(([k, x]) => `${k} ${usd(x)}`).join("; ");
          steps.push(because("The world market's prices, for anyone in the town who buys from outside.", priceList(p.sells, p.account, `Sold from outside, delivered, at world prices (each): ${list}. Order and pay with the order.`)));
        }
        // Orders paid in full: deliver from outside. An order below the world price, or for something not sold, is refunded.
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          const price = p.sells[o.kind];
          const ok = price !== undefined && o.unitPrice >= price;
          const step = fill(o, ok ? o.quantity : 0, me, p.account, ok ? `An order paid in full: delivering ${o.quantity} ${o.kind} from outside.` : `An order ${price === undefined ? `for ${o.kind}, which isn't sold from outside` : "below the world price"}: refunding it.`);
          if (ok) step.then = (out) => { if (out.status === "applied") sent.set(o.kind, (sent.get(o.kind) ?? 0) + o.quantity); };
          steps.push(step);
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, delivered: 0, refund: 0, declined: "unpaid" } })));
        for (const [acc, x] of orders.unclaimed(book)) {
          orders.refunded(acc);
          steps.push(because("Money paid to us with no order waiting for it: sending it back.", pay(acc, x, { from: p.account, for: "Refund: no order of yours is waiting." })));
        }

        // A new month: the buying offers for it.
        const m = Math.floor(t / MONTH);
        if (m !== month) {
          month = m;
          bought.clear();
          for (const [kind, b] of Object.entries(p.buys)) {
            const old = offers.get(kind);
            steps.push(because(`A new month: the world market's demand for the town's ${kind}.`,
              ...(old ? [withdraw(old, "Superseded by this month's offer.")] : []),
              ["offer", say("buying_offer", `Buying ${kind} from the town this month: up to ${b.per_month} at ${usd(b.unit_price)} each. Ship to us (the outside) and invoice us; we pay once the goods arrive.`, {
                visible: "public", data: { kind, unit_price: b.unit_price, quantity: b.per_month, until: (m + 1) * MONTH, account: p.account },
              })],
            ));
            (steps.at(-1) as Step).then = (out) => { if (out.created?.offer) offers.set(kind, out.created.offer); };
          }
        }

        // Invoices for goods shipped to us: pay those whose goods have come, up to the month's quantity; send back the rest.
        const arrived = (kind: string) => held(obs, me, kind) - (baseline.get(kind) ?? 0) + (sent.get(kind) ?? 0) - (paidFor.get(kind) ?? 0);
        const invoices = book.open("invoice").filter((r) => (r.addressed_to ?? []).includes(me) && !answered.has(r.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
        for (const inv of invoices) {
          const kind = String(inv.data?.kind);
          const q = Math.floor(Number(inv.data?.quantity) || 0);
          const owed = inv.data?.outcome?.money;
          const offer = p.buys[kind];
          const from = inv.speaks_for!;
          if (!offer || q <= 0 || !owed?.to) {
            answered.add(inv.id);
            steps.push(because("An invoice we can't pay: it isn't for goods we buy, or doesn't say how many or where to pay.", say("invoice_declined", `Invoice ${inv.id} declined: we don't buy this.`, { to: [from], visible: [from, me], basis: inv.id, data: { invoice: inv.id } })));
            continue;
          }
          if (arrived(kind) < q) {
            if (t - inv.at >= p.wait_days * DAY) {
              answered.add(inv.id);
              steps.push(because(`An invoice whose goods haven't come in ${p.wait_days} days: declining it.`, say("invoice_declined", `Invoice ${inv.id} declined: the goods haven't arrived.`, { to: [from], visible: [from, me], basis: inv.id, data: { invoice: inv.id } })));
            }
            continue;
          }
          answered.add(inv.id);
          paidFor.set(kind, (paidFor.get(kind) ?? 0) + q);
          const room = offer.per_month - (bought.get(kind) ?? 0);
          const take = Math.max(0, Math.min(q, room));
          bought.set(kind, (bought.get(kind) ?? 0) + take);
          const amount = Math.min(cents(owed.amount), take * offer.unit_price);
          const back = q - take;
          const returnTo = String(inv.data?.from_at ?? "");
          const s: Step = because(take === q ? `Goods invoiced under our offer have arrived: paying for ${q} ${kind}.` : `Goods invoiced beyond this month's demand: paying for ${take}, sending ${back} back.`);
          if (amount > 0) s.push(pay(owed.to, amount, { from: p.account, for: `${take} ${kind} bought.`, settles: inv.id }));
          if (back > 0 && returnTo) s.push(C.call("goods", { kind, quantity: C.text(String(back)), to: from, at: returnTo, from_at: me }));
          if (back > 0) {
            s.push(say("invoice_declined", `Invoice ${inv.id}: ${back} ${kind} beyond this month's demand, sent back.`, { to: [from], visible: [from, me], basis: inv.id, data: { invoice: inv.id, returned: back, paid_for: take } }));
            s.then = (out) => { if (out.status === "applied" && returnTo) sent.set(kind, (sent.get(kind) ?? 0) + back); };
          }
          steps.push(s);
        }
        return steps;
      },
    );
  },
};

/** idle: a participant that does nothing (placeholder, and a control condition). */
export const idle: BehaviourModule = {
  name: "idle",
  version: "0.1.0",
  doc: "docs/behaviour/README.md",
  cadence: () => 30 * DAY,
  create: () => ({ step: () => wait() }),
};

/**
 * world.migration: people moving to the town from elsewhere (a boundary condition, D31), after Harris & Todaro
 * (1970, "Migration, Unemployment and Development", AER 60(1)): people move when the income they expect where they're
 * going beats what they have where they are, and what they expect is the wage times the chance of getting a job.
 *
 * Monthly, it looks at the town's standing job postings (as someone thinking of moving would). A newcomer expects the
 * mean posted wage times the chance of a job: postings / (postings + the adults it has brought in the last
 * `memory_days`, who are competing for them). For each posting, a household comes with probability
 * `response_bps` x the gap over `outside_monthly_income` (capped). Households are drawn from the same census shares as
 * the town's; adults bring a few months' income elsewhere as savings. It writes the household's paperwork (the
 * `household` record the newcomers bring). Documented in docs/behaviour/boundary.md.
 */
export const migration: BehaviourModule = {
  name: "world.migration",
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => 30 * DAY,
  firstWake: () => 30 * DAY,
  create(ctx) {
    const p = params(
      {
        outside_monthly_income: 250_000, // what a household's earner could get elsewhere, cents a month (placeholder)
        response_bps: 1000, // chance per posting, per 100% gap, that a household comes this month (placeholder)
        max_households_per_month: 8,
        memory_days: 90,
        savings_months: [1, 3] as [number, number],
        template: "newcomer",
        households: {} as Partial<HouseholdSpec>,
        search_limit: 200,
      },
      ctx.params,
    );
    const H: HouseholdSpec = { ...DEFAULT_HOUSEHOLDS, ...p.households };
    const book = new Book();
    const brought: { t: number; adults: number }[] = [];
    let arrivals = 0;
    let looked = -1;
    let postings: StatementRecord[] = [];
    let todo: Step[] = [];
    // Households that have crossed, waiting for their paperwork: members by person, once the ids come back.
    const pending: { refs: string[]; persons?: string[]; sex: ("female" | "male")[]; born_at: number[]; couples: [number, number][]; leaseholder: number }[] = [];
    let expecting: (typeof pending)[number] | null = null;

    return {
      step(obs): ParticipantAction {
        book.absorb(obs);
        const jobs = obs.channels.jobs;
        if (jobs?.kind === "records" && jobs.search) postings = jobs.records as StatementRecord[];
        // The ids of the household that just crossed.
        if (expecting) {
          const created = Object.assign({}, ...obs.outcomes.map((o) => o.created ?? {}));
          if (expecting.refs.every((r) => created[r])) {
            expecting.persons = expecting.refs.map((r) => created[r]);
            pending.push(expecting);
          }
          expecting = null;
        }
        // Paperwork for households whose members we can now reach (the directory names their participants).
        const reachOf = new Map([...book.participantPerson].map(([par, person]) => [person, par]));
        for (let i = pending.length - 1; i >= 0; i--) {
          const h = pending[i]!;
          if (!h.persons!.every((x) => reachOf.has(x))) continue;
          pending.splice(i, 1);
          const members = h.persons!.map((person, j) => ({ person, participant: reachOf.get(person)!, born_at: h.born_at[j]!, sex: h.sex[j]! }));
          const lh = h.persons![h.leaseholder]!;
          todo.unshift(because("Newcomers' paperwork: the household they came as.", say("household", `Household: ${h.persons!.join(", ")}.`, {
            to: h.persons, visible: h.persons, for: lh,
            data: { leaseholder: lh, members, couples: h.couples.map(([a, b]) => [h.persons![a], h.persons![b]]) },
          })));
        }
        if (looked !== obs.t && todo.length === 0 && !expecting) {
          looked = obs.t;
          return { type: "look", looks: [{ channel: "jobs", query: { standing: true, limit: p.search_limit } }] };
        }
        if (looked === obs.t && postings.length && todo.length === 0 && !expecting && !pending.length) {
          const monthly = postings.map((x) => Math.floor(((x.data?.wage ?? 0) * 30 * DAY) / (x.data?.period ?? 14 * DAY)));
          const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
          const recent = brought.filter((b) => obs.t - b.t < p.memory_days * DAY).reduce((a, b) => a + b.adults, 0);
          const chance = postings.length / (postings.length + recent);
          const gapBps = Math.floor(((mean * chance - p.outside_monthly_income) * 10_000) / p.outside_monthly_income);
          const perPosting = Math.min(10_000, Math.max(0, Math.floor((gapBps * p.response_bps) / 10_000)));
          let n = 0;
          for (let i = 0; i < postings.length && n < p.max_households_per_month; i++) if (ctx.rng(`come-${obs.t}-${i}`).below(10_000) < perPosting) n++;
          const r = ctx.rng(`households-${obs.t}`);
          for (let k = 0; k < n; k++) {
            const d = drawHousehold(H, (m) => r.below(m));
            const refs = d.members.map((_, j) => `m${j}`);
            const born_at = d.members.map((m) => obs.t - (m.age * 365 + m.day) * DAY);
            const blocks = d.members.map((m, j) => C.call("presence", {
              name: C.text(`m${++arrivals}`), age: C.text(`${m.age * 365 + m.day} days`), sex: m.sex, template: p.template,
              ...(m.age >= 18 ? { carrying: C.dollars(Math.floor(((p.savings_months[0] + r.below(p.savings_months[1] - p.savings_months[0] + 1)) * p.outside_monthly_income))) } : {}),
            }));
            todo.push(because(`A household moves here: the town's expected wage (${usd(Math.floor(mean))} a month x a ${Math.round(chance * 100)}% chance of a job) beats ${usd(p.outside_monthly_income)} elsewhere.`, ...blocks.map((b, j) => [refs[j]!, b] as [string, C.Call])));
            brought.push({ t: obs.t, adults: d.members.filter((m) => m.age >= 18).length });
            (todo.at(-1) as any).household = { refs, sex: d.members.map((m) => m.sex), born_at, couples: d.couples, leaseholder: d.leaseholder };
          }
        }
        const next = todo.shift();
        if (!next) return wait();
        if ((next as any).household) expecting = (next as any).household;
        return callAction(next);
      },
    };
  },
};
