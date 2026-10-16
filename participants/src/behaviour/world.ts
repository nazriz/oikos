// world.export_demand: the outside world buying from the town (a boundary
// condition, D31). Documented in docs/behaviour/boundary.md. Researcher-set:
// params.purchases = [{ to: account, amount: cents, every: seconds, memo? }].

import * as C from "../calls";
import { channels, type LookRequest, type ParticipantAction, type StatementRecord } from "../contracts";
import { DAY, need, params, wait, type BehaviourModule } from "../module";
import { cents } from "../money";
import { ask, because, Book, callAction, filedBefore, madeAt, MONTH, Occurrences, pay, publishedPrice, say, StandingWork, usd, withdraw, type Step, Asked, lookUp, LOOKS_MAX } from "./common";
import * as P from "./papers";
import { stepper } from "./firms";
import { declineOnTerms, fill, held, OrderBook, priceList } from "./trade";
import { drawHousehold, drawSavings, type HouseholdSpec } from "./household";
import { yearsOfSchooling, type SchoolingSpec } from "./school";
import { forAge, supportLaw, type Declared, type PaymentRule } from "./payments";
import { incomeTaxLaw, withholding } from "./tax";
import { Respondent } from "./frictions";
import { slip } from "../slip";
import { decisionLaw, Reconsiderations, Waits } from "./decisions";

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
  answers: {"office": "the world market's office", "acts": "What it acts on: an order for what it lists, at its published prices: a paper on the buyer's own order form, addressed to it, with the whole sum paid into the account its price list names. It delivers when an order is paid in full, sends back money that comes with no order waiting for it, and declines an order unpaid after a week."},
  boundary: [
    { what: "future", why: "A researcher's scripted shocks to world prices and demand are a scenario's boundary condition: this module is the world market and applies each from its day, publishing nothing of one before it comes." },
    { what: "every:factory", why: "The outside world's demand for the town's goods is a boundary condition, split when the world is made among the factories that export." },
  ],
  version: "0.3.0", // 0.3.0: sells to a factory on terms (pay within some days of delivery) where its world gives them, stops supplying one that has not paid, and records the debt against it later (docs/behaviour/trade.md, "Trade credit"); 0.2.1: a month's world price is drawn for the good and the month from the seed, never for the hour this office wakes in (a town and its twin see the same prices);
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
        // Trade credit (docs/behaviour/trade.md, "Trade credit"): the days it gives a buyer to pay after delivery, for a buyer who orders
        // on terms (0: cash with order only); how long after the day it supplies an unpaid buyer on terms no more; how long after it the
        // debt is recorded against the buyer (the last two placeholders).
        terms_days: 0, terms_stop_after_days: 7, terms_claim_after_days: 30,
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
    const orders = new OrderBook(me, undefined, p.terms_days > 0 ? { days: p.terms_days, stop_after_days: p.terms_stop_after_days, claim_after_days: p.terms_claim_after_days } : null);
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
          // (The world's price for a month is the world's: named for the good and the month, from the seed, and never
          // for the hour this office happens to wake in. Until 2026-10-12 it was drawn on the participant's stream,
          // which is keyed on the hour: a town and its twin, or the same town before and after any change that moved
          // this office's first look of a month, saw two different years of prices.)
          const r = (ctx.chance ?? ctx.rng)(`world-price/${kind}/${m0}`);
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
            ["list", priceList(sells, p.account, `Sold from outside, delivered, at world prices (each): ${list}; at least ${p.min_order} to an order. Order and pay with the order${p.terms_days > 0 ? `, or order on terms and pay within ${p.terms_days} days of delivery` : ""}.`, { min_order: p.min_order, ...(p.terms_days > 0 ? { terms_days: p.terms_days } : {}) })]);
          st.then = (out) => { if (out.created?.list) listId = out.created.list; };
          steps.push(st);
        }
        // Orders paid in full: deliver from outside. An order below the world price, or for something not sold, is refunded.
        const { paid, unpaid, stopped } = orders.due(book, t);
        for (const o of stopped) steps.push(declineOnTerms(o, me, `An order on our terms from ${o.buyer}, which has not paid what it owed us: declining it.`));
        steps.push(...orders.collect(t, p.account));
        for (const o of paid) {
          const price = sells[o.kind];
          const ok = price !== undefined && o.unitPrice >= price && o.quantity >= p.min_order;
          const step = fill(o, ok ? o.quantity : 0, me, p.account, ok ? `An order paid in full: delivering ${o.quantity} ${o.kind} from outside.` : `An order ${price === undefined ? `for ${o.kind}, which isn't sold from outside` : o.quantity < p.min_order ? `for fewer than ${p.min_order}` : "below the world price"}: refunding it.`);
          const refundIfRefused = step.then;
          if (ok) step.then = (out) => {
            if (out.status === "applied") { sent.set(o.kind, (sent.get(o.kind) ?? 0) + o.quantity); orders.bill(o, o.quantity, t); }
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
 * world.transfers: an office that pays support to people (for a town, a higher government's payments office, outside
 * the world: a boundary condition, D31). It reads the published support law and applies the payments it is the payer
 * of: who qualifies, how much, for how long (./payments.ts). It decides each claim on what the claim states (a date of
 * birth, and whatever the payment's rule has the claimant declare), taken as stated, and on its own book: the
 * employers' reports of contributions addressed to it, which name each worker and their pay. It pays those it grants
 * on the payment's schedule until the claimant says to stop, dies (a death registration), leaves (a departure), or
 * the payment's time runs out, which it tells them. Every `publish_every_days` (0: never), it publishes how many it
 * pays of each kind (a `support_statistics` statement), as a payments department publishes its recipients by area.
 * Documented in docs/behaviour/boundary.md.
 */
export const transfers: BehaviourModule = {
  name: "world.transfers",
  keeps: [
    { what: "benefit_claim", why: "Claims for support are made to this office and to nobody else: the file of them is its own, from the claims already in payment when a year begins." },
    { what: "benefit_decision", why: "Each decision on a claim is this office's own paper: it pays from them, and keeps every one it has made." },
  ],
  answers: {"office": "the support office", "acts": "What it acts on: a claim for a payment under the support law, made by the person it is for."},
  // The office's routine, where a model holds the office (docs/behaviour/standing-work.md, "The support office"): what
  // the support law's own conditions settle is the staff's; a refusal, a doubt and a review are the office-holder's.
  routines: [{ task: "pay_claims", at: "office", every: 1, what: "Each working day the office's staff decide the claims that have waited their time, the oldest first: a claim that meets the conditions the support law states for its payment is granted, in writing, and paid each period from then until the claimant asks for it to stop, dies, leaves, or its time runs out, which the staff tell them. A claim that does not meet the conditions, or that the staff could not verify, is not refused by the staff: it is put before whoever holds the office, as a note on the office's file saying what it fails on, and decided by them on the office's decision form; a claim they grant on that form is paid by the staff like any other. A request to look at a decision again comes to the office-holder. What a claim waits for before it is decided (papers from the claimant, a confirmation from their last employer, within so many days) is the law's: the staff ask for it and the claim stays on their file until it has come or its time has run.",
    papers: [{ kind: "benefit_claim", how: "decided by the support law's conditions: granted and paid if it meets them, put before the office-holder if it does not or could not be verified" }, { kind: "benefit_change", how: "a claimant's own request to stop their payment: it is stopped" }] }],
  issues: [...P.SUPPORT, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  version: "0.10.0", // 0.10.0: a claim waits for what the law says it needs (papers from the claimant, a confirmation from the last employer, within so many days: foundations F8), is looked at again when asked inside the law's days (a review, recorded), and a refusal found wrong is put right by the office or on a venue's setting it aside; the staff refuse nothing only where the law says the head alone does; 0.9.0: the wrong refusals are a slip at the rate of the world's table of slips (foundations F7), not a parameter; 0.8.0: no processing time, daily capacity or doubled errors under backlog: it decides every claim it has, and how many is the hours of whoever decides (foundations F6); 0.7.0: a claim made before the year began and still waiting (an opening caseload) is decided when its processing time from that day has run; a claim refused before it is decided; a refusal asked about that the paper says could not be verified is found wrong on review; 0.6.0: payments in force before the year (grants brought forward on paper) are taken up when the file is first opened and paid from the day each names; 0.5.0: run in parts where a model holds the office (part): the staff decide and pay what the law's conditions settle under a standing order (pay_claims) and put a refusal or a doubt before the office-holder, who decides it on the office's decision form and answers reviews; a town run by code is unchanged; 0.4.0: a claim may wait to be decided (processing_days), the staff decide so many a day (capacity_per_day), and some qualifying claims are wrongly refused, more while a backlog stands (error_bps, at the friction dial); asked to review a refusal found wrong, the office decides the next claim on its facts
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params(
      {
        account: "", // the account it pays from where a payment names none (the world must say)
        year: 365 * DAY,
        publish_every_days: 0,
        respond: {} as object,
        // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs it;
        // "seat" whoever holds it; "staff" its staff, who do the routine while a standing order for it is in force.
        part: "" as "" | "seat" | "staff",
      },
      ctx.params,
    );
    need(p, ["account"], "world.transfers");
    let nextPublish = p.publish_every_days > 0 ? p.publish_every_days * DAY : Infinity;
    const me = ctx.entity;
    const book = new Book();
    const decided = new Set<string>();
    const routines = new StandingWork(me, p.part, ctx.position ? new Set([ctx.position.replace(/-staff$/, "")]) : undefined);
    const TASK = "pay_claims";
    const put = new Map<string, { doubt: boolean; why: string }>(); // claims the staff put before the office-holder (and, for the holder, those it has been shown)
    const taken = new Set<string>(); // decisions of the office-holder's the staff have taken up
    const seen = new Set<string>(); // cases the office-holder has decided
    let granted = 0, putBefore = 0, payments = 0; // since the staff last reported
    const lately: string[] = [];
    const claimNth = new Occurrences(); // which claim each is: this person's nth for this payment, not its number on file
    const waits = new Waits(me); // what a claim waits for before it is decided (the law's `needs`: foundations F8)
    const recon = new Reconsiderations(me, ["benefit_decision"]); // a decision of ours looked at again when asked (the law's `review`)
    type Paying = { person: string; account: string; payment: string; from: string; amount: number; every: number; next: number; until?: number; then?: string };
    const paying = new Map<string, Paying>(); // claim -> what we pay under it
    let opened = false; // our file has been opened once (payments in force before the year are taken up then)
    /** The payments we pay: the published law's, where we are the payer (no law: none). */
    const rules = (): PaymentRule[] => supportLaw(book)?.payments.filter((r) => r.payer === me) ?? [];
    /** Our book of contributions for one person: the monthly pay employers reported for them, newest first. */
    const reported = (who: string, since: number) => book.all("withholding_report").filter((r) => (r.addressed_to ?? []).includes(me) && r.at >= since && Array.isArray(r.data?.staff))
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
      .flatMap((r) => (r.data!.staff as { worker: string; gross: number }[]).filter((l) => l.worker === who).map((l) => ({ at: r.at, gross: Math.floor(Number(l.gross) || 0) })));
    /** A claim under a rule: granted (with the sum and how long), or why not. */
    const decide = (rule: PaymentRule | undefined, c: StatementRecord, t: number): { ok: true; amount: number; until?: number } | { ok: false; why?: string } => {
      if (!rule || typeof c.data?.account !== "string" || !Number.isInteger(c.data?.born_at)) return { ok: false };
      const who = c.speaks_for!;
      const born = c.data.born_at as number;
      const age = Math.floor((t - born) / p.year);
      const w = rule.who ?? {};
      const said: Declared = c.data?.declares ?? {};
      if (age < (w.from_age ?? -Infinity) || age > (w.to_age ?? Infinity)) return { ok: false };
      const members = Math.max(1, Math.floor(Number(said.household_members) || 1));
      const children = (under: number) => (Array.isArray(said.children_born_at) ? said.children_born_at : []).filter((b) => Number.isInteger(b) && Math.floor((t - b) / p.year) < under).length;
      const record = w.record || "share_bps" in rule.amount ? reported(who, w.record?.within_months ? t - w.record.within_months * MONTH : -Infinity) : [];
      if (w.record && record.length < (w.record.months ?? 1)) return { ok: false, why: `contributions are on our record for ${record.length} month${record.length === 1 ? "" : "s"}, and the payment asks for ${w.record.months ?? 1}` };
      if (w.income_under) {
        if (!Number.isInteger(said.household_income)) return { ok: false, why: "the claim doesn't state the household's income" };
        const income = w.income_under.per === "head" ? Math.floor(said.household_income! / members) : said.household_income!;
        if (income >= w.income_under.amount) return { ok: false, why: `the household's income as stated is not under ${usd(w.income_under.amount)}${w.income_under.per === "head" ? " a head" : ""}` };
      }
      if (w.no_other_pension) {
        if (said.other_pension !== false) return { ok: false, why: "the claim doesn't state that no other pension is paid" };
        const ours = rules();
        if ([...paying.values()].some((x) => x.person === who && x.payment !== rule.id && ours.some((r) => r.id === x.payment && forAge(r)))) return { ok: false, why: "we pay the claimant another pension" };
      }
      if (w.children && children(w.children.under_age) < w.children.least) return { ok: false, why: `the household as stated has fewer than ${w.children.least} child${w.children.least === 1 ? "" : "ren"} under ${w.children.under_age}` };
      const a = rule.amount;
      let amount: number;
      if ("flat" in a) amount = a.flat;
      else if ("share_bps" in a) {
        // Their previous pay for as long as one payment covers: the mean of the monthly pay reported for them (the last
        // twelve reports at most), before or after what the tax law withholds from such a pay.
        const last = record.slice(0, 12);
        if (!last.length) return { ok: false, why: "no pay is on our record for the claimant" };
        const gross = Math.floor((last.reduce((x, l) => x + l.gross, 0) / last.length) * rule.every_days / 30);
        const pay = a.of === "net" ? gross - withholding(incomeTaxLaw(book), gross, rule.every_days * DAY) : gross;
        const most = a.most === undefined ? Infinity : typeof a.most === "number" ? a.most : [...a.most].sort((x, y) => y.from_age - x.from_age).find((b) => b.from_age <= age)?.amount ?? Infinity;
        amount = Math.min(most, Math.max(a.least ?? 0, Math.floor((pay * (a.with_child_bps !== undefined && children(18) > 0 ? a.with_child_bps : a.share_bps)) / 10_000)));
      } else amount = a.household + (a.per_member ?? 0) * members + (a.per_child ? a.per_child.amount * children(a.per_child.under_age) : 0);
      if (!(amount > 0)) return { ok: false, why: "the payment comes to nothing" };
      const ends = [rule.lasts?.days !== undefined ? t + rule.lasts.days * DAY : Infinity, rule.lasts?.until_age !== undefined ? born + rule.lasts.until_age * p.year : Infinity];
      const until = Math.min(...ends);
      return { ok: true, amount, ...(until < Infinity ? { until } : {}) };
    };
    /** A claim granted on the office's second look (a review, or a venue setting its refusal aside): the office decides again on the facts it has now,
     * as it decides any claim, without a slip, and puts right what it finds wrong itself: the new decision, and the payments under it. */
    const decideAgain = (refusal: StatementRecord, t: number, because_: string, basis: string): { changed: boolean; found: string; steps: Step[] } => {
      const claim = typeof refusal.data?.claim === "string" ? (book.records.get(refusal.data.claim) as StatementRecord | undefined) : undefined;
      const rule = rules().find((r) => r.id === String(refusal.data?.payment));
      if (!claim || claim.record !== "statement" || !rule) return { changed: false, found: "the claim is not on our file", steps: [] };
      const d = decide(rule, claim, t);
      if (!d.ok) return { changed: false, found: d.why ?? "it does not meet the conditions the support law states for the payment", steps: [] };
      const who = claim.speaks_for!;
      for (const [id, x] of paying) if (x.person === who && x.payment === rule.id) paying.delete(id);
      paying.set(claim.id, { person: who, account: claim.data!.account as string, payment: rule.id, from: rule.account || p.account, amount: d.amount, every: rule.every_days * DAY, next: t + rule.every_days * DAY, ...(d.until !== undefined ? { until: d.until } : {}), ...(rule.lasts?.then ? { then: rule.lasts.then } : {}) });
      const lasting = d.until !== undefined ? ` until day ${Math.floor(d.until / DAY)}` : "";
      return { changed: true, found: "the claim met the conditions the support law states for the payment when it was decided", steps: [because(`${because_}: the claim ${claim.id} qualifies; granting it.`,
        say("benefit_decision", `Claim ${claim.id} granted on a second look: ${usd(d.amount)} every ${rule.every_days} days${lasting}.`, { to: [who], visible: [who, me], basis: claim.id,
          data: { claim: claim.id, payment: rule.id, granted: true, amount: d.amount, every: rule.every_days * DAY, ...(d.until !== undefined ? { until: d.until } : {}), on_review: basis, replaces: refusal.id } }))] };
    };
    // What the office's own books say of a refusal asked about at a venue: whether the claim qualified when decided. (Its requests to look again are the
    // generic route's, `recon` below; this answers a venue's notice and puts right what a venue sets aside.)
    const resp = new Respondent(ctx.rng, me, null, {
      params: p.respond,
      requests: false,
      truth: (m, from, bk, tNow) => {
        if (m.matter !== "claim_refused" || !m.about) return undefined;
        const d = bk.records.get(m.about) as StatementRecord | undefined;
        if (!d || d.record !== "statement" || d.speaks_for !== me || d.kind !== "benefit_decision" || !(d.addressed_to ?? []).includes(from) || typeof d.data?.claim !== "string") return undefined;
        if (d.data?.granted === true) return { wrong: false };
        const claim = bk.records.get(d.data.claim) as StatementRecord | undefined;
        const rule = rules().find((r) => r.id === String(d.data?.payment));
        return { wrong: !!claim && claim.record === "statement" && !!rule && decide(rule, claim, tNow).ok };
      },
      // A venue sets a refusal aside: the claim is decided again, as for a review.
      remedy: (m, _from, t, why, basis) => {
        const d = m.about ? (book.records.get(m.about) as StatementRecord | undefined) : undefined;
        return d && d.record === "statement" && d.speaks_for === me && d.kind === "benefit_decision" && d.data?.granted === false ? decideAgain(d, t, why, basis).steps : [];
      },
    });
    return stepper(
      (obs) => book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const ours = rules();
        // Payments already in force when our file is first opened (grants made before the year, brought forward on
        // paper): taken up from the grant's own figures, the next payment on the day it names. Their claims are decided.
        if (!opened) {
          opened = true;
          for (const d of book.all("benefit_decision")) {
            // (A claim refused before the year began is decided; one in hand, still waiting its time, is not.)
            if (d.speaks_for === me && d.data?.brought_forward && d.data?.granted !== true && typeof d.data?.claim === "string") decided.add(d.data.claim);
            if (d.speaks_for !== me || !d.data?.brought_forward || d.data?.granted !== true || typeof d.data?.claim !== "string") continue;
            const claim = book.records.get(d.data.claim) as StatementRecord | undefined;
            decided.add(d.data.claim);
            const amount = Math.floor(Number(d.data.amount)), every = Math.floor(Number(d.data.every)), next = Math.floor(Number(d.data.next));
            if (!claim || !(amount > 0) || !(every > 0) || !(next >= 0) || typeof claim.data?.account !== "string") continue;
            const rule = ours.find((r) => r.id === String(d.data.payment));
            paying.set(claim.id, { person: claim.speaks_for!, account: claim.data.account, payment: String(d.data.payment), from: rule?.account || p.account, amount, every, next,
              ...(Number.isSafeInteger(d.data.until) ? { until: d.data.until as number } : {}), ...(rule?.lasts?.then ? { then: rule.lasts.then } : {}) });
          }
        }
        // Claims: granted if the claimant fits the payment's rule; the first payment one period on. The office decides the
        // oldest first, every one it has; how many it gets through is the hours of whoever decides (a system's lanes, a
        // person's timeline), which the kernel keeps: each decision is an act that takes its maker's time.
        // (Who does the routine now: the whole office; its staff while their standing order is in force; the office-holder never.)
        const working = !!routines.does(book, TASK, t, { every: DAY });
        const staff = p.part === "staff";
        if (p.part === "seat") {
          // Whoever holds the office: what the staff have put before them is decided (here, as the office's own code
          // would have: a claim that fails the law's conditions is refused, with the reason; so is one that could not
          // be verified, which is the wrong refusal a review may later find).
          for (const n of book.open("case_for_decision").filter((x) => x.speaks_for === me && !seen.has(x.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
            seen.add(n.id);
            const d = n.data ?? {};
            if (typeof d.claim !== "string" || typeof d.claimant !== "string") continue;
            const why = String(d.fails ?? "");
            steps.push(because(`A claim the staff put before us (${d.claim}): refused${why ? `: ${why}` : ""}.`,
              say("benefit_decision", `Claim ${d.claim} refused${why ? `: ${why}` : ""}.`, { to: [d.claimant], visible: [d.claimant, me], basis: d.claim, data: { claim: d.claim, payment: d.payment, granted: false, ...(why ? { reason: why } : {}) } })));
          }
        }
        const waiting = !working ? [] : book.open("benefit_claim").filter((r) => (r.addressed_to ?? []).includes(me) && !decided.has(r.id)).sort((a, b) => madeAt(a) - madeAt(b) || filedBefore(a, b));
        for (const c of waiting) {
          const who = c.speaks_for!;
          const payment = String(c.data?.payment);
          const rule = ours.find((r) => r.id === payment);
          const age = Number.isInteger(c.data?.born_at) ? Math.floor((t - (c.data!.born_at as number)) / p.year) : -1;
          // What the claim waits for before it is decided is the law's (foundations F8): papers from the claimant, a confirmation from
          // their last employer, within so many days, and what comes of it when they do not come. We ask once, for each; the claim stays
          // on our file until it has come, or its time has run. (A claim made before the year opened, brought forward on paper, is decided.)
          const law = decisionLaw(book, "benefit_decision", payment);
          const wait = c.data?.brought_forward ? undefined : waits.state(book, law, c, t);
          if (wait) steps.push(...wait.steps);
          if (wait?.state === "waiting") continue;
          decided.add(c.id);
          let d = wait?.state === "lapsed" ? { ok: false as const, why: wait.why } : decide(rule, c, t);
          // A claim that qualifies may be wrongly refused (a record not matched, a form read wrongly): a slip of whoever decides, at the
          // rate of the world's table of slips for a decision on a claim (foundations F7). It is put right when the decision is looked at
          // again (a review, or a venue): the office decides it again on the facts, without a slip, as `decideAgain` has it.
          let slipped = false;
          if (d.ok && slip(ctx, "publish/benefit_decision", claimNth.key(c.id, who, payment))) {
            d = { ok: false, why: "the claim could not be verified" };
            slipped = true;
          }
          // Who may refuse is the office's procedure's (the law's `refused_by`, foundations F8): where the head alone does, the staff put a claim that does
          // not meet the conditions, or that they could not verify, before whoever holds the office, with what it fails on (and, for a doubt, what it
          // would be paid). Where the staff may refuse, they decide it as the whole office does.
          if (staff && !d.ok && law?.refused_by !== "staff") {
            const doubt = slipped;
            const would = doubt ? decide(rule, c, t) : undefined;
            const why = d.why ?? "it does not meet the conditions the support law states for the payment";
            put.set(c.id, { doubt, why });
            putBefore++;
            steps.push(because(`A claim for ${payment} support that ${doubt ? "we could not verify" : "does not meet the law's conditions"}: putting it before the office-holder.`,
              say("case_for_decision", `For decision: claim ${c.id} by ${who} for ${payment} support (aged ${age}): ${why}.${would?.ok ? ` If it is granted, the payment by the law's rule is ${usd(would.amount)} every ${rule!.every_days} days.` : ""}`,
                { to: [me], visible: [me], basis: c.id, data: { claim: c.id, claimant: who, payment, fails: why, doubt, ...(would?.ok ? { amount: would.amount, every: rule!.every_days * DAY, ...(would.until !== undefined ? { until: would.until } : {}) } : {}) } })));
            continue;
          }
          if (staff && d.ok) { granted++; lately.push(`${c.id} (${who}, ${payment})`); if (lately.length > 3) lately.shift(); }
          // One payment of a kind a person: a new claim replaces the old.
          for (const [id, x] of paying) if (x.person === who && x.payment === payment) paying.delete(id);
          if (d.ok) paying.set(c.id, { person: who, account: c.data!.account as string, payment, from: rule!.account || p.account, amount: d.amount, every: rule!.every_days * DAY, next: t + rule!.every_days * DAY, ...(d.until !== undefined ? { until: d.until } : {}), ...(rule!.lasts?.then ? { then: rule!.lasts.then } : {}) });
          const lasting = d.ok && d.until !== undefined ? ` until day ${Math.floor(d.until / DAY)}` : "";
          const why = !d.ok && d.why ? `: ${d.why}` : "";
          steps.push(because(d.ok ? `A claim for ${payment} support from someone it's for (aged ${age}): granted, at ${usd(d.amount)} every ${rule!.every_days} days${lasting}.` : `A claim for ${payment} support that doesn't qualify${why}: refused.`,
            say("benefit_decision", d.ok ? `Claim ${c.id} granted: ${usd(d.amount)} every ${rule!.every_days} days${lasting}.` : `Claim ${c.id} refused${why}.`, {
              to: [who], visible: [who, me], basis: c.id, data: { claim: c.id, payment, granted: d.ok, ...(d.ok ? { amount: d.amount, every: rule!.every_days * DAY, ...(d.until !== undefined ? { until: d.until } : {}) } : d.why ? { reason: d.why } : {}) },
            })));
        }
        // Asked to look at a decision again (the claimant's request, inside the days the law gives): the office decides it again on the facts, and
        // records that it did. Never the staff's where there is a head to do it. A venue's notice of an application against us is answered
        // from the books (`resp`).
        if (!staff) {
          steps.push(...recon.steps(book, t, (dec, req) => {
            if (dec.data?.granted !== false) return { changed: false, found: "the claim was granted", steps: [] };
            return decideAgain(dec, t, `Asked by ${req.speaks_for} to look at our refusal ${dec.id} again`, req.id);
          }));
          steps.push(...resp.steps(book, t, p.account, 1e15));
        }
        // A claim the office-holder granted on the office's decision form is paid by the staff like any other: from
        // the decision's own figures, the first payment one period on.
        if (staff && working) for (const d of book.all("benefit_decision")) {
          if (taken.has(d.id) || d.speaks_for !== me) continue;
          taken.add(d.id);
          const claim = typeof d.data?.claim === "string" ? (book.records.get(d.data.claim) as StatementRecord | undefined) : undefined;
          if (!claim || d.data?.granted !== true || paying.has(claim.id)) continue;
          const amount = Math.floor(Number(d.data.amount)), every = Math.floor(Number(d.data.every));
          if (!(amount > 0) || !(every > 0) || typeof claim.data?.account !== "string") continue;
          const rule = ours.find((r) => r.id === String(claim.data!.payment));
          paying.set(claim.id, { person: claim.speaks_for!, account: claim.data.account, payment: String(claim.data.payment), from: rule?.account || p.account, amount, every, next: d.at + every, ...(Number.isSafeInteger(d.data.until) ? { until: d.data.until as number } : {}), ...(rule?.lasts?.then ? { then: rule.lasts.then } : {}) });
        }
        if (!working) {
          // (The routine is not ours now: the office-holder's part, or staff with no standing order in force. The
          // staff say so in their report; nothing is paid, stopped or published.)
          if (staff) steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the support office's staff", tasks: { [TASK]: ["days' work", "payments"] } }));
          return steps;
        }
        // Stopping: the claimant asked, died or left.
        const gone = new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...book.all("departure").map((r) => r.speaks_for!)]);
        for (const r of book.all("benefit_change")) if (r.data?.stop) paying.delete(r.data.claim);
        for (const [id, x] of paying) if (gone.has(x.person)) paying.delete(id);
        // Paying what's due, in batches (a program has at most 32 lines); and a payment whose time has run out ends.
        const due: C.Call[] = [];
        const ended: [string, Paying][] = [];
        for (const [id, x] of [...paying].sort(([a], [b]) => (a < b ? -1 : 1))) {
          while (x.next <= t && x.next <= (x.until ?? Infinity)) {
            due.push(pay(x.account, x.amount, { from: x.from, for: `${x.payment} support.` }));
            x.next += x.every;
          }
          if (x.until !== undefined && (x.next > x.until || t >= x.until)) ended.push([id, x]);
        }
        for (let i = 0; i < due.length; i += 30) steps.push(because(`Paying the support due (${due.length} payments).`, ...due.slice(i, i + 30)));
        payments += due.length;
        for (const [id, x] of ended) {
          paying.delete(id);
          steps.push(because(`The ${x.payment} payment under claim ${id} has run its time: telling the claimant it has ended.`,
            say("benefit_end", `Claim ${id}: the ${x.payment} payment has ended.${x.then ? ` You may claim ${x.then}.` : ""}`, { to: [x.person], visible: [x.person, me], basis: id, data: { claim: id, payment: x.payment, ended: true, ...(x.then ? { then: x.then } : {}) } })));
        }
        // The published figures: recipients of each payment.
        if (t >= nextPublish) {
          nextPublish = t + p.publish_every_days * DAY;
          const recipients = Object.fromEntries(ours.map((r) => r.id).sort().map((k) => [k, [...paying.values()].filter((x) => x.payment === k).length]));
          steps.push(because("Publishing this period's figures: how many we pay, of each kind.",
            say("support_statistics", `Support recipients: ${Object.entries(recipients).map(([k, n]) => `${k} ${n}`).join(", ")}.`, { visible: "public", data: { recipients } })));
        }
        if (staff) {
          // The staff's report (docs/behaviour/standing-work.md): what was done under the order, in counts and a sample.
          routines.did(TASK, t, { units: due.length });
          routines.note(TASK, `${granted} claim${granted === 1 ? "" : "s"} granted and ${putBefore} put before the office-holder since the last report${lately.length ? ` (granted lately: ${lately.join("; ")})` : ""}; ${paying.size} ${paying.size === 1 ? "person is" : "people are"} being paid`);
          const report = routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the support office's staff", tasks: { [TASK]: ["days' work", "payments"] } });
          if (report.length) { granted = 0; putBefore = 0; payments = 0; lately.length = 0; }
          steps.push(...report);
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
  answers: {"office": "the wholesale funding desk", "acts": "What it acts on: a bank's draw on its funding, and the bank's repayments."},
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
  answers: {"office": "the weather bureau", "acts": "It publishes its warnings as it issues them. It takes no requests."},
  boundary: [
    { what: "future", why: "The weather is fixed before the run, like the ground: this module stands for it at the world's edge, and is handed the spells to come so that it can warn of each a few days ahead. Nothing in the world can know or change them otherwise." },
  ],
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
 * world.statistics: the statistician the world's government keeps (for a town, an office of a higher government: the
 * outside world). Once a month its collectors read the prices of a sample of outlets (a search of what sellers
 * advertise, the first `sample` standing lists that sell to anyone) and it publishes the mean for each kind of goods:
 * a price index, which is what anyone who needs "prices" reads (a union's claim). And it publishes how many live in
 * the town: the count at the last census (a number it is given), plus the births registered and the people who have
 * moved in since, less the deaths registered and those who said they were leaving: an estimate, which is what anyone
 * who needs "the population" reads (a funder paying by the head). Documented in docs/behaviour/boundary.md.
 */
export const statistics: BehaviourModule = {
  name: "world.statistics",
  answers: {"office": "the statistician's office", "acts": "It publishes its figures as it makes them. It takes no requests."},
  version: "0.2.0", // 0.2.0: the population estimate
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params({
      adverts: "", // its channel onto what sellers advertise, searched (the world must say)
      sample: 200, // outlets priced a month, at most (placeholder: what one search reads)
      every_days: 30,
      population: 0, // how many lived in the town at the last census (a count; none: no estimate is published)
    }, ctx.params);
    need(p, ["adverts"], "world.statistics");
    let next = 0;
    let nextEstimate = 0;
    let read: StatementRecord[] | undefined;
    // Registrations and movements, as they reach us (each counted once).
    const book = new Book();
    return stepper(
      (obs) => {
        book.absorb(obs);
        const ch = obs.channels[p.adverts];
        if (ch?.kind === "records" && ch.search) read = ch.records as StatementRecord[];
      },
      (obs) => {
        const steps: Step[] = [];
        if (p.population > 0 && obs.t >= nextEstimate) {
          nextEstimate = obs.t + p.every_days * DAY;
          const births = book.all("birth_registration").length, deaths = book.all("death_registration").length;
          const arrived = book.all("arrival").reduce((n, r) => n + (Number(r.data?.people) || 0), 0), left = book.all("departure").length;
          const residents = Math.max(0, p.population + births + arrived - deaths - left);
          steps.push(because(`The month's estimate of the town's population: ${p.population} at the census, ${births} births and ${arrived} arrivals since, less ${deaths} deaths and ${left} departures.`,
            say("population_estimate", `Estimated resident population: ${residents}.`, { visible: "public", data: { residents, census: p.population, births, arrivals: arrived, deaths, departures: left } })));
        }
        if (!read) return steps;
        const lists = read.filter((r) => r.data?.goods && !r.data?.min_order);
        read = undefined;
        next = obs.t + p.every_days * DAY;
        const by = new Map<string, number[]>();
        for (const r of lists) for (const [kind, price] of Object.entries(r.data!.goods as { [k: string]: unknown })) if (typeof price === "number") by.set(kind, [...(by.get(kind) ?? []), price]);
        return [...steps, ...[...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, prices]) => {
          const mean = Math.round(prices.reduce((x, y) => x + y, 0) / prices.length);
          return because(`This month's prices of ${kind}, read at ${prices.length} outlets: publishing the mean.`,
            say("price_index", `Price index, ${kind}: ${usd(mean)} on average at ${prices.length} outlets.`, { visible: "public", data: { kind, mean, outlets: prices.length } }));
        })];
      },
      () => Math.min(next, p.population > 0 ? nextEstimate : Infinity),
      (obs) => (obs.t >= next && !read ? [ask.board(p.adverts, { most: p.sample })] : []),
    );
  },
};

/**
 * world.valuer: the valuer the world's government keeps (for a town, an office of a higher government: the outside
 * world, D31). Once a year it values every property on its roll that someone other than the exempt owns: the lot's
 * land, at the world's land value, plus each building on it at what the builder would charge to build it now (its
 * published prices). It sends each valuation to the owner and to the town that rates it. The roll is its own: each
 * property as it stood when the roll was last made up, the notices of land changing hands it is given since, and
 * what the council has asked it to value since as built or brought down. It values from the roll, as a mass
 * valuation does, and goes to no property. Documented in docs/behaviour/public-finance.md.
 */
export const valuer: BehaviourModule = {
  name: "world.valuer",
  answers: {"office": "the valuer's office", "acts": "What it acts on: a rating authority's request to value a property; and the notices it is given of land changing hands."},
  keeps: [
    { what: "property_roll", why: "The valuation roll is the valuer's own: it makes an entry for each property it values." },
    { what: "acquisition_notice", why: "Each notice that land has changed hands is given to it, to keep its roll's owners by." },
  ],
  version: "0.2.0", // 0.2.0: values from its own roll, kept up by the notices and requests it is given; no longer shown the town or the land register
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = need(params({ land_value: 0, builder: "", rating: "", exempt: [] as string[], every_days: 365, roll: "roll" }, ctx.params), ["builder", "rating"], "world.valuer");
    const me = ctx.entity;
    const book = new Book();
    // The roll: each property, its owner as we were last told, and the buildings on it.
    const roll = new Map<string, { owner?: string; buildings: Map<string, string> }>();
    const taken = new Set<string>();
    let next = 0;
    const entry = (lot: string) => { const x = roll.get(lot) ?? { buildings: new Map<string, string>() }; roll.set(lot, x); return x; };
    return stepper(
      (obs) => {
        book.absorb(obs);
        const ch = obs.channels[p.roll];
        if (ch?.kind === "records") for (const r of [...ch.records].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
          if (r.record !== "statement" || taken.has(r.id) || typeof r.data?.lot !== "string") continue;
          taken.add(r.id);
          const x = entry(r.data.lot);
          if (typeof r.data.owner === "string") x.owner = r.data.owner;
          if (r.kind === "property_roll") for (const b of (r.data.buildings ?? []) as { structure: string; type: string }[]) x.buildings.set(b.structure, b.type);
        }
        // What the council asks us to value: something built, or brought down.
        for (const r of book.open("valuation_request").sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
          if (taken.has(r.id) || !(r.addressed_to ?? []).includes(me)) continue;
          taken.add(r.id);
          const d = r.data ?? {};
          if (typeof d.removed === "string") for (const x of roll.values()) x.buildings.delete(d.removed);
          else if (typeof d.lot === "string" && typeof d.structure === "string") entry(d.lot).buildings.set(d.structure, String(d.structure_type ?? ""));
        }
      },
      (obs) => {
        const t = obs.t;
        if (t < next) return [];
        // Not until we can see the builder's prices (a valuation without them would value the buildings at nothing).
        const priced = book.open("price_list").some((r) => r.speaks_for === p.builder && r.data?.prices);
        if (!priced) return [];
        next = t + p.every_days * DAY;
        const lines: C.Call[] = [];
        for (const [lot, x] of [...roll].sort(([a], [b]) => (a < b ? -1 : 1))) {
          const owner = x.owner;
          if (!owner || owner === p.rating || p.exempt.includes(owner)) continue;
          const buildings = [...x.buildings].map(([structure, type]) => ({ structure, type, value: publishedPrice(book, p.builder, type) ?? 0 }));
          const value = p.land_value + buildings.reduce((n, b) => n + b.value, 0);
          lines.push(say("valuation", `Valuation of ${lot}${buildings.length ? ` and ${buildings.map((b) => b.structure).join(", ")}` : ""}: ${usd(value)}.`,
            { to: [owner], visible: [me, owner, p.rating], basis: lot, data: { lot, owner, land: p.land_value, buildings, value, year: Math.floor(t / (365 * DAY)) + 1 } }));
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
 * a year per resident. Residents are the statistician's latest published estimate of the town's population: a funder
 * pays by the published count, and counts nobody itself. Documented in docs/behaviour/public-finance.md.
 */
export const grants: BehaviourModule = {
  name: "world.grants",
  answers: {"office": "the grants office", "acts": "It pays by its determination, which is on file with whoever it pays: so much a year for each resident, by the published estimate of the population. A letter changes nothing in a determination."},
  version: "0.3.0", // 0.3.0: pays by the published population estimate; no longer shown the town's homes
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 3 * 3600,
  create(ctx) {
    const p = need(params({ account: "", to: "", to_account: "", per_resident_per_year: 0, every_days: 91, first_day: 30 }, ctx.params), ["account", "to", "to_account"], "world.grants");
    const me = ctx.entity;
    const book = new Book();
    let next = p.first_day * DAY;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        if (t < next || !p.to_account || p.per_resident_per_year <= 0) return [];
        // (No estimate published yet: nothing to pay by; we look again tomorrow.)
        const estimate = book.open("population_estimate").sort((a, b) => b.at - a.at)[0];
        const residents = Math.max(0, Math.floor(Number(estimate?.data?.residents) || 0));
        if (!estimate) return [];
        next = t + p.every_days * DAY;
        const amount = Math.floor((p.per_resident_per_year * residents * p.every_days) / 365);
        if (amount <= 0) return [];
        return [because(`The quarter's grant: ${usd(p.per_resident_per_year)} a resident a year, for the ${residents} the statistician estimates live in the town.`,
          say("grant_payment", `A grant of ${usd(amount)} for the quarter (${residents} residents).`, { to: [p.to], visible: [me, p.to], basis: estimate.id, data: { amount, residents, per_resident_per_year: p.per_resident_per_year } }),
          pay(p.to_account, amount, { from: p.account, for: "Grant." }))];
      },
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
  answers: {"office": "the landfill's office", "acts": "What it acts on: a docket for what is brought to it, invoiced every month at the charge it has notified."},
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
 * as the latest published counts of recipients of the payments for those out of work (`jobseekers_payment`) say, and the adults it has brought in the last
 * `memory_days`). In Harris & Todaro the chance is the destination's employment rate: a town's own unemployed make it
 * less. The one who came for the job looks for work; other adults do at `participation_bps` (`template_outside_lf`
 * for those who don't). For each posting, a household comes with probability
 * `response_bps` x the gap over `outside_monthly_income` (capped). Households are drawn from the same census shares as
 * the town's; adults bring a few months' income elsewhere as savings. It writes the household's paperwork (the
 * `household` record the newcomers bring). Documented in docs/behaviour/boundary.md.
 */
export const migration: BehaviourModule = {
  name: "world.migration",
  version: "0.6.2", // 0.6.2: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.0: says how many came (the statistician counts them); 0.6.1: counts every payment for those out of work
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
        jobseekers_payment: "", // the support payments whose published recipients count as jobseekers (several: with commas between; "": none published)
        participation_bps: 10_000, // of adults other than the one who came for the job, those looking for work
        template_outside_lf: "", // the template for those who aren't ("": everyone takes `template`)
        // Where bodies have a skill (schooling): the years each newcomer has had, as the world's people have, and how much
        // of the variable a year is (null: newcomers start at the variable's initial).
        schooling: null as (SchoolingSpec & { variable: string; per_year: number }) | null,
        who: "", // its channel onto who's who, where it looks up how to reach those it brought ("": as it is shown)
      },
      ctx.params,
    );
    if (!p.households) throw new Error("world.migration: params.households is required (the world's household mix)");
    const asked = new Asked();
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
        // Paperwork for households whose members we can now reach: each newcomer looked up once they have crossed
        // (who acts as them: nobody is shown who's who), the answer coming at once.
        const reachOf = new Map([...book.participantPerson].map(([par, person]) => [person, par]));
        if (p.who && !expecting) {
          const whom: LookRequest[] = [];
          for (const h of pending) for (const person of h.persons!) if (whom.length < LOOKS_MAX && !reachOf.has(person) && asked.first(person)) whom.push(lookUp.entity(p.who, person));
          if (whom.length) return { type: "look", looks: whom };
        }
        for (let i = pending.length - 1; i >= 0; i--) {
          const h = pending[i]!;
          if (!h.persons!.every((x) => reachOf.has(x))) continue;
          pending.splice(i, 1);
          const members = h.persons!.map((person, j) => ({ person, participant: reachOf.get(person)!, born_at: h.born_at[j]!, sex: h.sex[j]! }));
          const lh = h.persons![h.leaseholder]!;
          todo.unshift(because("Newcomers' paperwork: the household they came as.", say("household", `Household: ${h.persons!.join(", ")}.`, {
            to: h.persons, visible: h.persons, for: lh,
            data: { leaseholder: lh, members, couples: h.couples.map(([a, b]) => [h.persons![a], h.persons![b]]) },
          }),
          // (And for the count of who lives where: how many came, never who. The statistician reads it.)
          say("arrival", `${h.persons!.length} ${h.persons!.length === 1 ? "person has" : "people have"} moved to town.`, { visible: [ctx.entity], data: { people: h.persons!.length } })));
        }
        if (looked !== obs.t && obs.woke_for !== "done" && todo.length === 0 && !expecting) {
          looked = obs.t;
          return { type: "look", looks: [ask.board("jobs", { most: p.search_limit })] };
        }
        if (looked === obs.t && postings.length && todo.length === 0 && !expecting && !pending.length) {
          const monthly = postings.map((x) => Math.floor(((x.data?.wage ?? 0) * 30 * DAY) / (x.data?.period ?? 14 * DAY)));
          const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
          const recent = brought.filter((b) => obs.t - b.t < p.memory_days * DAY).reduce((a, b) => a + b.adults, 0);
          const stats = book.open("support_statistics").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
          const jobseekers = p.jobseekers_payment.split(",").filter(Boolean).reduce((x, k) => x + Number(stats?.data?.recipients?.[k] ?? 0), 0);
          const chance = postings.length / (postings.length + recent + jobseekers);
          const gapBps = Math.floor(((mean * chance - p.outside_monthly_income) * 10_000) / p.outside_monthly_income);
          const perPosting = Math.min(10_000, Math.max(0, Math.floor((gapBps * p.response_bps) / 10_000)));
          let n = 0;
          for (let i = 0; i < postings.length && n < p.max_households_per_month; i++) if (ctx.rng(`come-${i}`).below(10_000) < perPosting) n++;
          const r = ctx.rng(`households`);
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
