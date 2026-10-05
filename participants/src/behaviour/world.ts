// world.export_demand: the outside world buying from the town (a boundary
// condition, D31). Documented in docs/behaviour/boundary.md. Researcher-set:
// params.purchases = [{ to: account, amount: cents, every: seconds, memo? }].

import * as C from "../calls";
import { channels, type ParticipantAction, type SiteStructure, type StatementRecord } from "../contracts";
import { DAY, need, params, wait, type BehaviourModule } from "../module";
import { cents } from "../money";
import { because, Book, callAction, MONTH, pay, publishedPrice, say, usd, withdraw, type Step } from "./common";
import { ownerOf } from "./institutions";
import { stepper } from "./firms";
import { fill, held, OrderBook, priceList } from "./trade";
import { drawHousehold, drawSavings, type HouseholdSpec } from "./household";
import { yearsOfSchooling, type SchoolingSpec } from "./school";

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
 * - each month it publishes a buying offer for each kind it `buys` (a unit price and that month's quantity: in all, or
 *   for each seller it buys from, `from`), and pays invoices for goods shipped to it under the offer, once the goods
 *   have arrived; goods beyond the month's quantity (the seller's, or all sellers') are sent back, unpaid;
 * - world prices move: each month a kind's price level takes a random step and drifts back towards where it started
 *   (`price_process`), and scripted shocks multiply a kind's price or the demand for it from a day on (`shocks`). It
 *   republishes its price list when its prices change.
 */
export const trade: BehaviourModule = {
  name: "world.trade",
  version: "0.2.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params(
      {
        account: "", // the outside's account it pays from and is paid into (the world must say)
        sells: {} as { [kind: string]: number }, // unit prices, cents
        buys: {} as { [kind: string]: { unit_price: number; per_month: number; from?: { [seller: string]: number } } },
        wait_days: 14, // how long an invoice waits for its goods before it's declined
        min_order: 100, // the least it sells in one order (it sells wholesale)
        // How a kind's world price moves each month: a random step (sd, basis points of its starting price) and how much of
        // its distance from the start it keeps (persistence, basis points). None: it doesn't move.
        price_process: {} as { [kind: string]: { sd_bps: number; persistence_bps: number } },
        shocks: [] as { from_day: number; kind: string; what: "price" | "demand"; factor_bps: number }[],
      },
      ctx.params,
    );
    need(p, ["account"], "world.trade");
    const me = ctx.entity;
    const book = new Book();
    const orders = new OrderBook(me);
    let publishedKey = "";
    let listId: string | undefined;
    const level = new Map<string, number>(); // kind -> its price level, basis points of its starting price
    // A kind's scripted factor on its price or demand now (basis points; the latest shock that has started).
    const shocked = (kind: string, what: "price" | "demand", t: number) =>
      [...p.shocks].filter((s) => s.kind === kind && s.what === what && s.from_day * DAY <= t).sort((a, b) => b.from_day - a.from_day)[0]?.factor_bps ?? 10_000;
    const priceOf = (kind: string, base: number, t: number) => Math.max(1, Math.round((((base * (level.get(kind) ?? 10_000)) / 10_000) * shocked(kind, "price", t)) / 10_000));
    const sellsNow = (t: number) => Object.fromEntries(Object.entries(p.sells).map(([k, x]) => [k, priceOf(k, x, t)]));
    // What it buys this month: its price moved as world prices move; its quantity scaled by any demand shock.
    const buyingNow = (kind: string, b: { unit_price: number; per_month: number; from?: { [seller: string]: number } }, t: number) => {
      const f = shocked(kind, "demand", t);
      const scale = (q: number) => Math.floor((q * f) / 10_000);
      return { unit_price: priceOf(kind, b.unit_price, t), per_month: scale(b.per_month), ...(b.from ? { from: Object.fromEntries(Object.entries(b.from).map(([s, q]) => [s, scale(q)])) } : {}) };
    };
    const offers = new Map<string, string>(); // kind -> this month's buying offer
    let month = -1;
    const bought = new Map<string, number>(); // kind (and kind|seller) -> quantity accepted this month
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
        // A new month: world prices take their step (a random step, drifting back towards where they started).
        const m0 = Math.floor(t / MONTH);
        if (m0 !== month && month >= 0) for (const [kind, pr] of Object.entries(p.price_process).sort(([a], [b]) => (a < b ? -1 : 1))) {
          const r = ctx.rng(`price-${kind}-${m0}`);
          let z = -60_000; // a normal draw in basis points of a standard deviation: 12 uniforms less 6 (Irwin-Hall)
          for (let i = 0; i < 12; i++) z += r.below(10_000);
          const now = level.get(kind) ?? 10_000;
          level.set(kind, Math.max(1_000, 10_000 + Math.trunc(((now - 10_000) * pr.persistence_bps) / 10_000) + Math.trunc((z * pr.sd_bps) / 10_000)));
        }
        const sells = sellsNow(t);
        const key = JSON.stringify(sells);
        if (key !== publishedKey && Object.keys(sells).length) {
          const first = !publishedKey;
          publishedKey = key;
          const list = Object.entries(sells).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${k} ${usd(x)}`).join("; ");
          const st = because(first ? "The world market's prices, for anyone in the town who buys from outside." : "World prices have moved: republishing ours.",
            ...(listId ? [withdraw(listId, "Superseded: world prices have moved.")] : []),
            ["list", priceList(sells, p.account, `Sold from outside, delivered, at world prices (each): ${list}; at least ${p.min_order} to an order. Order and pay with the order.`, { min_order: p.min_order })]);
          st.then = (out) => { if (out.created?.list) listId = out.created.list; };
          steps.push(st);
        }
        // Orders paid in full: deliver from outside. An order below the world price, or for something not sold, is refunded.
        const { paid, unpaid } = orders.due(book, t);
        for (const o of paid) {
          const price = sells[o.kind];
          const ok = price !== undefined && o.unitPrice >= price && o.quantity >= p.min_order;
          const step = fill(o, ok ? o.quantity : 0, me, p.account, ok ? `An order paid in full: delivering ${o.quantity} ${o.kind} from outside.` : `An order ${price === undefined ? `for ${o.kind}, which isn't sold from outside` : o.quantity < p.min_order ? `for fewer than ${p.min_order}` : "below the world price"}: refunding it.`);
          const refundIfRefused = step.then;
          if (ok) step.then = (out) => {
            if (out.status === "applied") sent.set(o.kind, (sent.get(o.kind) ?? 0) + o.quantity);
            return refundIfRefused?.(out);
          };
          steps.push(step);
        }
        for (const o of unpaid) steps.push(because("An order unpaid for a week: declining it.", say("delivery_note", `Order ${o.id} declined: not paid.`, { to: [o.buyer], visible: [o.buyer, me], basis: o.id, data: { order: o.id, kind: o.kind, ordered: o.quantity, delivered: 0, refund: 0, declined: "unpaid" } })));
        for (const [acc, x] of orders.unclaimed(book)) {
          orders.refunded(acc);
          steps.push(because("Money paid to us with no order waiting for it: sending it back.", pay(acc, x, { from: p.account, for: "Refund: no order of yours is waiting." })));
        }

        // A new month: the buying offers for it.
        const m = Math.floor(t / MONTH);
        if (m !== month) {
          month = m;
          bought.clear();
          for (const [kind, b0] of Object.entries(p.buys)) {
            const old = offers.get(kind);
            const b = buyingNow(kind, b0, t);
            steps.push(because(`A new month: the world market's demand for the town's ${kind}.`,
              ...(old ? [withdraw(old, "Superseded by this month's offer.")] : []),
              ["offer", say("buying_offer", `Buying ${kind} from the town this month: up to ${b.from ? Object.entries(b.from).map(([s, q]) => `${q} from ${s}`).join(", ") : b.per_month} at ${usd(b.unit_price)} each. Ship to us (the outside) and invoice us; we pay once the goods arrive.`, {
                visible: "public", data: { kind, unit_price: b.unit_price, quantity: b.per_month, ...(b.from ? { quantities: b.from } : {}), until: (m + 1) * MONTH, account: p.account },
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
          const offer = p.buys[kind] ? buyingNow(kind, p.buys[kind]!, t) : undefined;
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
          // Room this month: the seller's own quantity, if we buy from each seller, and in all.
          const own = offer.from ? (offer.from[from] ?? 0) - (bought.get(`${kind}|${from}`) ?? 0) : Infinity;
          const room = Math.min(own, offer.per_month - (bought.get(kind) ?? 0));
          const take = Math.max(0, Math.min(q, room));
          bought.set(kind, (bought.get(kind) ?? 0) + take);
          bought.set(`${kind}|${from}`, (bought.get(`${kind}|${from}`) ?? 0) + take);
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

/**
 * world.transfers: support paid to people from outside the world (a boundary condition, D31): for a town, a national
 * government's payments. It decides claims for the payment kinds the world names, each with its amount, how often, and
 * the ages it's for; pays those it grants on that schedule until the claimant says to stop, dies (a death
 * registration) or leaves (a departure). It takes the claim's date of birth as stated. Means tests are left out. Every
 * `publish_every_days` (0: never), it publishes how many it pays of each kind (a `support_statistics` statement), as a
 * payments department publishes its recipients by area. Documented in docs/behaviour/boundary.md.
 */
export const transfers: BehaviourModule = {
  name: "world.transfers",
  version: "0.2.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params(
      {
        account: "", // the outside's account it pays from and is paid into (the world must say)
        year: 365 * DAY,
        payments: {} as { [kind: string]: { amount: number; every_days: number; from_age: number; to_age?: number } },
        publish_every_days: 0,
      },
      ctx.params,
    );
    need(p, ["account"], "world.transfers");
    let nextPublish = p.publish_every_days > 0 ? p.publish_every_days * DAY : Infinity;
    const me = ctx.entity;
    const book = new Book();
    const decided = new Set<string>();
    const paying = new Map<string, { person: string; account: string; payment: string; next: number }>(); // claim -> payment
    return stepper(
      (obs) => book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // Claims: granted if the claimant's age fits the payment; the first payment one period on.
        for (const c of book.open("benefit_claim").filter((r) => (r.addressed_to ?? []).includes(me) && !decided.has(r.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
          decided.add(c.id);
          const who = c.speaks_for!;
          const payment = String(c.data?.payment);
          const rule = p.payments[payment];
          const age = Number.isInteger(c.data?.born_at) ? Math.floor((t - (c.data!.born_at as number)) / p.year) : -1;
          const ok = !!rule && typeof c.data?.account === "string" && age >= rule.from_age && (rule.to_age === undefined || age <= rule.to_age);
          // One payment a person: a new claim replaces the old.
          for (const [id, x] of paying) if (x.person === who) paying.delete(id);
          if (ok) paying.set(c.id, { person: who, account: c.data!.account as string, payment, next: t + rule!.every_days * DAY });
          steps.push(because(ok ? `A claim for ${payment} support from someone it's for (aged ${age}): granted, at ${usd(rule!.amount)} every ${rule!.every_days} days.` : `A claim for ${payment} support that doesn't qualify: refused.`,
            say("benefit_decision", ok ? `Claim ${c.id} granted: ${usd(rule!.amount)} every ${rule!.every_days} days.` : `Claim ${c.id} refused.`, {
              to: [who], visible: [who, me], basis: c.id, data: { claim: c.id, payment, granted: ok, ...(ok ? { amount: rule!.amount, every: rule!.every_days * DAY } : {}) },
            })));
        }
        // Stopping: the claimant asked, died or left.
        const gone = new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...book.all("departure").map((r) => r.speaks_for!)]);
        for (const r of book.all("benefit_change")) if (r.data?.stop) paying.delete(r.data.claim);
        for (const [id, x] of paying) if (gone.has(x.person)) paying.delete(id);
        // Paying what's due, in batches (a program has at most 32 lines).
        const due: C.Call[] = [];
        for (const [, x] of [...paying].sort(([a], [b]) => (a < b ? -1 : 1))) {
          const rule = p.payments[x.payment]!;
          while (x.next <= t) {
            due.push(pay(x.account, rule.amount, { from: p.account, for: `${x.payment} support.` }));
            x.next += rule.every_days * DAY;
          }
        }
        for (let i = 0; i < due.length; i += 30) steps.push(because(`Paying the support due (${due.length} payments).`, ...due.slice(i, i + 30)));
        // The published figures: recipients of each payment.
        if (t >= nextPublish) {
          nextPublish = t + p.publish_every_days * DAY;
          const recipients = Object.fromEntries(Object.keys(p.payments).sort().map((k) => [k, [...paying.values()].filter((x) => x.payment === k).length]));
          steps.push(because("Publishing this period's figures: how many we pay, of each kind.",
            say("support_statistics", `Support recipients: ${Object.entries(recipients).map(([k, n]) => `${k} ${n}`).join(", ")}.`, { visible: "public", data: { recipients } })));
        }
        return steps;
      },
    );
  },
};

/**
 * world.funding: money lent into the world from outside (a boundary condition, D31): for a town's bank, the wider
 * market it funds itself from. It lends what's asked for, at once (the market is large next to a town), paying it with
 * the draw settled. What the borrower pays in interest and repays is the borrower's to do; this module doesn't chase it.
 * Documented in docs/behaviour/boundary.md.
 */
export const funding: BehaviourModule = {
  name: "world.funding",
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = need(params({ account: "" }, ctx.params), ["account"], "world.funding");
    const me = ctx.entity;
    const book = new Book();
    const lent = new Set<string>();
    return stepper(
      (obs) => book.absorb(obs),
      () => {
        const steps: Step[] = [];
        for (const d of book.open("funding_draw").filter((r) => (r.addressed_to ?? []).includes(me) && !lent.has(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1))) {
          lent.add(d.id);
          const amount = Math.floor(Number(d.data?.amount) || 0);
          if (amount > 0 && typeof d.data?.account === "string") steps.push(because(`A draw on funding from ${d.speaks_for}: lending ${usd(amount)}.`, pay(d.data.account, amount, { from: p.account, for: "Funding.", settles: d.id })));
        }
        return steps;
      },
    );
  },
};

/**
 * world.weather: the weather bureau (the outside world's, as a state's or nation's is). It knows the weather the world
 * will have (`events`: heavy rain, drought, heatwaves, each from a day for some days; the run's weather, drawn from the
 * climate by the generator) and warns of each publicly `lead_days` ahead, saying when it's expected to end. It changes
 * nothing: the weather comes whether or not anyone listens. Documented in docs/behaviour/weather.md.
 */
export const weather: BehaviourModule = {
  name: "world.weather",
  version: "0.1.0",
  doc: "docs/behaviour/weather.md",
  cadence: () => DAY,
  firstWake: () => 6 * 3600,
  create(ctx) {
    const p = params({ events: [] as { kind: string; from_day: number; days: number }[], lead_days: 2 }, ctx.params);
    const said = { heavy_rain: "Heavy rain", drought: "Drought", heatwave: "Heatwave" } as { [kind: string]: string };
    const warnAt = (e: { from_day: number }) => Math.max(0, (e.from_day - p.lead_days) * DAY + 6 * 3600);
    let next = 0; // the events warned of so far (they're in order)
    return stepper(
      () => {},
      (obs) => {
        const steps: Step[] = [];
        while (next < p.events.length && warnAt(p.events[next]!) <= obs.t) {
          const e = p.events[next++]!;
          const from = e.from_day * DAY, until = (e.from_day + e.days) * DAY;
          steps.push(because(`${said[e.kind] ?? e.kind} expected from day ${e.from_day} for ${e.days} days: warning the public.`,
            say("weather_warning", `${said[e.kind] ?? e.kind} warning: expected from day ${e.from_day + 1} for about ${e.days} days.`, { visible: "public", data: { kind: e.kind, from, until } })));
        }
        return steps;
      },
      () => (next < p.events.length ? warnAt(p.events[next]!) : ctx.world.runEnd + DAY),
    );
  },
};

/**
 * world.valuer: the valuer the world's government keeps (for a town, an office of a higher government: the outside
 * world, D31). Once a year it values every property that someone other than the exempt owns: the lot's land, at the
 * world's land value, plus each building on it at what the builder would charge to build it now (its published
 * prices). It publishes each valuation to the owner and to the town that rates it. Documented in
 * docs/behaviour/public-finance.md.
 */
export const valuer: BehaviourModule = {
  name: "world.valuer",
  version: "0.1.0",
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = need(params({ land_value: 0, builder: "", rating: "", exempt: [] as string[], every_days: 365 }, ctx.params), ["builder", "rating"], "world.valuer");
    const me = ctx.entity;
    const book = new Book();
    const seen = new Map<string, SiteStructure | undefined>(); // what we last saw on each cell (perception is changes)
    let next = 0;
    return stepper(
      (obs) => {
        book.absorb(obs);
        for (const c of channels.cells(obs)) seen.set(c.cell, c.structure);
      },
      (obs) => {
        const t = obs.t;
        if (t < next) return [];
        // Not until we can see the builder's prices (a valuation without them would value the buildings at nothing).
        const priced = book.open("price_list").some((r) => r.speaks_for === p.builder && r.data?.prices);
        if (!priced) return [];
        next = t + p.every_days * DAY;
        const onCell = new Map([...seen].filter(([, st]) => st).map(([c, st]) => [c, st!]));
        const lines: C.Call[] = [];
        for (const lot of book.open("lot").sort((a, b) => (a.id < b.id ? -1 : 1))) {
          const owner = ownerOf(book, lot.id);
          if (!owner || owner === p.rating || p.exempt.includes(owner)) continue;
          const buildings = [...new Map(((lot.data?.cells as string[]) ?? []).flatMap((c) => (onCell.has(c) ? [onCell.get(c)!] : [])).map((st) => [st.structure, st])).values()]
            .map((st) => ({ structure: st.structure, type: st.type, value: publishedPrice(book, p.builder, st.type) ?? 0 }));
          const value = p.land_value + buildings.reduce((x, b) => x + b.value, 0);
          lines.push(say("valuation", `Valuation of ${lot.id}${buildings.length ? ` and ${buildings.map((b) => b.structure).join(", ")}` : ""}: ${usd(value)}.`,
            { to: [owner], visible: [me, owner, p.rating], basis: lot.id, data: { lot: lot.id, owner, land: p.land_value, buildings, value, year: Math.floor(t / (365 * DAY)) + 1 } }));
        }
        const steps: Step[] = [];
        for (let i = 0; i < lines.length; i += 30) steps.push(because(`The year's valuations: each property's land at ${usd(p.land_value)} a lot, and its buildings at what building them now would cost.`, ...lines.slice(i, i + 30)));
        return steps;
      },
    );
  },
};

/**
 * world.grants: grants from a higher government to the town (the outside world, D31), paid every quarter at an amount
 * a year per resident. Residents are who it sees living in the town's homes. Documented in
 * docs/behaviour/public-finance.md.
 */
export const grants: BehaviourModule = {
  name: "world.grants",
  version: "0.2.0",
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 3 * 3600,
  create(ctx) {
    const p = need(params({ account: "", to: "", to_account: "", per_resident_per_year: 0, every_days: 91, first_day: 30, dwelling: "dwelling",
      count_at: 3 * 3600, // when it looks (a time of night: residents are counted where they sleep, as a census counts them)
    }, ctx.params), ["account", "to", "to_account"], "world.grants");
    const me = ctx.entity;
    const seen = new Map<string, SiteStructure | undefined>(); // what we last saw on each cell (perception is changes)
    let next = p.first_day * DAY;
    return stepper(
      (obs) => {
        for (const c of channels.cells(obs)) seen.set(c.cell, c.structure);
      },
      (obs) => {
        const t = obs.t;
        if (t < next || !p.to_account || p.per_resident_per_year <= 0) return [];
        next = t + p.every_days * DAY;
        const buildings = new Map([...seen.values()].filter((st) => st).map((st) => [st!.structure, st!]));
        const residents = [...buildings.values()].flatMap((st) => st.spaces).filter((sp) => sp.kind === p.dwelling).reduce((x, sp) => x + sp.count, 0);
        const amount = Math.floor((p.per_resident_per_year * residents * p.every_days) / 365);
        if (amount <= 0) return [];
        return [because(`The quarter's grant: ${usd(p.per_resident_per_year)} a resident a year, for the ${residents} living in the town's homes.`,
          say("grant_payment", `A grant of ${usd(amount)} for the quarter (${residents} residents).`, { to: [p.to], visible: [me, p.to], data: { amount, residents, per_resident_per_year: p.per_resident_per_year } }),
          pay(p.to_account, amount, { from: p.account, for: "Grant." }))];
      },
      // (It looks at night, when residents are home: not wherever the day has taken them.)
      (obs) => (Math.floor(obs.t / DAY) + 1) * DAY + p.count_at,
    );
  },
};

/**
 * world.disposal: a place outside the town that takes a kind of material (a landfill taking waste). Whoever delivers
 * gives it a docket with what they brought (the weighbridge's record); monthly, it invoices each for what they
 * brought since, at its price per tonne (1,000 units). Documented in docs/behaviour/services.md.
 */
export const disposal: BehaviourModule = {
  name: "world.disposal",
  version: "0.1.0",
  doc: "docs/behaviour/services.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = need(params({ kind: "waste", price_per_tonne: 0, account: "", every_days: 30 }, ctx.params), ["account"], "world.disposal");
    const me = ctx.entity;
    const book = new Book();
    const billed = new Set<string>();
    let next = p.every_days * DAY;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        if (obs.t < next) return [];
        next = obs.t + p.every_days * DAY;
        const due = new Map<string, { quantity: number; dockets: string[] }>();
        for (const d of book.open("disposal_docket").filter((r) => (r.addressed_to ?? []).includes(me) && !billed.has(r.id) && r.data?.kind === p.kind).sort((a, b) => (a.id < b.id ? -1 : 1))) {
          billed.add(d.id);
          const x = due.get(d.speaks_for!) ?? { quantity: 0, dockets: [] };
          x.quantity += Math.max(0, Math.floor(Number(d.data?.quantity) || 0));
          x.dockets.push(d.id);
          due.set(d.speaks_for!, x);
        }
        const steps: Step[] = [];
        for (const [who, x] of [...due].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          const amount = Math.ceil((x.quantity * p.price_per_tonne) / 1000);
          if (amount <= 0) continue;
          steps.push(because(`The month's ${p.kind} from ${who}: ${x.quantity} at ${usd(p.price_per_tonne)} a tonne, invoiced.`,
            say("invoice", `Invoice: ${usd(amount)} for ${x.quantity} of ${p.kind} taken this month.`, { to: [who], visible: [me, who], basis: x.dockets[0], data: { outcome: { money: { to: p.account, amount: String(amount), for: `disposal of ${p.kind}` } }, dockets: x.dockets } })));
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
 * mean posted wage times the chance of a job: postings / (postings + those competing for them: the town's jobseekers,
 * as the latest published count of recipients of `jobseekers_payment` says, and the adults it has brought in the last
 * `memory_days`). In Harris & Todaro the chance is the destination's employment rate: a town's own unemployed make it
 * less. The one who came for the job looks for work; other adults do at `participation_bps` (`template_outside_lf`
 * for those who don't). For each posting, a household comes with probability
 * `response_bps` x the gap over `outside_monthly_income` (capped). Households are drawn from the same census shares as
 * the town's; adults bring a few months' income elsewhere as savings. It writes the household's paperwork (the
 * `household` record the newcomers bring). Documented in docs/behaviour/boundary.md.
 */
export const migration: BehaviourModule = {
  name: "world.migration",
  version: "0.4.0",
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
        savings_by_age: null as { from: number; pct: [number, number, number, number, number] }[] | null, // the world's: an adult's savings by age (else months of income elsewhere)
        template: "newcomer",
        households: null as HouseholdSpec | null, // who comes, as the world's profile describes households (required)
        search_limit: 200,
        jobseekers_payment: "", // the support payment whose published recipients count as jobseekers ("": none published)
        participation_bps: 10_000, // of adults other than the one who came for the job, those looking for work
        template_outside_lf: "", // the template for those who aren't ("": everyone takes `template`)
        // Where bodies have a skill (schooling): the years each newcomer has had, as the world's people have, and how much
        // of the variable a year is (null: newcomers start at the variable's initial).
        schooling: null as (SchoolingSpec & { variable: string; per_year: number }) | null,
      },
      ctx.params,
    );
    if (!p.households) throw new Error("world.migration: params.households is required (the world's household mix)");
    const H: HouseholdSpec = p.households;
    /** What an adult brings: the world's savings by age, else a few months' income from elsewhere. */
    const savingsOf = (age: number, r: { below(n: number): number }) => {
      const band = p.savings_by_age ? [...p.savings_by_age].reverse().find((b) => b.from <= age) : undefined;
      return band ? drawSavings(band.pct, r.below(10_000)) : Math.floor((p.savings_months[0] + r.below(p.savings_months[1] - p.savings_months[0] + 1)) * p.outside_monthly_income);
    };
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
        if (looked !== obs.t && obs.woke_for !== "done" && todo.length === 0 && !expecting) {
          looked = obs.t;
          return { type: "look", looks: [{ channel: "jobs", query: { standing: true, limit: p.search_limit } }] };
        }
        if (looked === obs.t && postings.length && todo.length === 0 && !expecting && !pending.length) {
          const monthly = postings.map((x) => Math.floor(((x.data?.wage ?? 0) * 30 * DAY) / (x.data?.period ?? 14 * DAY)));
          const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
          const recent = brought.filter((b) => obs.t - b.t < p.memory_days * DAY).reduce((a, b) => a + b.adults, 0);
          const stats = book.open("support_statistics").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
          const jobseekers = p.jobseekers_payment ? Number(stats?.data?.recipients?.[p.jobseekers_payment] ?? 0) : 0;
          const chance = postings.length / (postings.length + recent + jobseekers);
          const gapBps = Math.floor(((mean * chance - p.outside_monthly_income) * 10_000) / p.outside_monthly_income);
          const perPosting = Math.min(10_000, Math.max(0, Math.floor((gapBps * p.response_bps) / 10_000)));
          let n = 0;
          for (let i = 0; i < postings.length && n < p.max_households_per_month; i++) if (ctx.rng(`come-${obs.t}-${i}`).below(10_000) < perPosting) n++;
          const r = ctx.rng(`households-${obs.t}`);
          for (let k = 0; k < n; k++) {
            const d = drawHousehold(H, (m) => r.below(m));
            const refs = d.members.map((_, j) => `m${j}`);
            const born_at = d.members.map((m) => obs.t - (m.age * 365 + m.day) * DAY);
            // The one who came for the job looks for work; the others at the world's participation.
            const templateOf = (j: number) => (j === d.leaseholder || !p.template_outside_lf || r.below(10_000) < p.participation_bps ? p.template : p.template_outside_lf);
            const blocks = d.members.map((m, j) => C.call("presence", {
              name: C.text(`m${++arrivals}`), age: C.text(`${m.age * 365 + m.day} days`), sex: m.sex, template: templateOf(j),
              ...(m.age >= 18 ? { carrying: C.amountText(savingsOf(m.age, r)) } : {}),
              ...(p.schooling ? { variables: C.json({ [p.schooling.variable]: yearsOfSchooling(m.age, p.schooling, (n) => r.below(n)) * p.schooling.per_year }) } : {}),
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
