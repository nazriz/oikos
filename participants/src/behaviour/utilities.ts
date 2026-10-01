// utility.water and utility.energy: a water corporation and an energy retailer (docs/behaviour/utilities.md;
// docs/design/world-expansion.md 6.1). Water is physics: each day the corporation draws what the town uses from the
// river (a field), and when the river can't give it, it says so (restrictions). Energy is bought from the grid (the
// outside) and supplied, each unit emitting what the grid's generation does (a world counter). Both bill: water the
// owners of homes, quarterly (who pays is the world's: the owner, here); energy its customers, monthly.

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, lotOf, ownAccount, say, type Step, usd } from "./common";
import { stepper } from "./firms";
import { ownerOf } from "./institutions";
import { goodsPrices, held as heldAt, order } from "./trade";

export const water: BehaviourModule = {
  name: "utility.water",
  version: "0.1.0",
  doc: "docs/behaviour/utilities.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      works: "", // the water works (the world must say): where it draws from the river
      task: "draw_water", // the work that draws a kilolitre
      litres_per_person_per_day: 0, // what a person uses (the world's figure)
      price_per_kl: 0, service_per_quarter: 0, // the tariff (cents)
      bill_every_days: 91,
      dwelling: "dwelling",
      channel: "town", // its view of the town's homes (who lives in each, how many)
    }, ctx.params);
    need(p, ["works"], "utility.water");
    const me = ctx.entity;
    const book = new Book();
    const homes = new Map<string, { at: string; residents: number }>(); // home structure -> its corner cell, residents as last seen
    const used = new Map<string, number>(); // home -> litres used since its last bill
    let lastDay = -1;
    let nextBill = p.bill_every_days * DAY;
    let restricted = false;
    return stepper(
      (obs) => {
        book.absorb(obs);
        const ch = obs.channels[p.channel];
        if (ch?.kind === "sites") for (const c of ch.cells) {
          const st = c.structure as SiteStructure | undefined;
          if (!st || c.cell !== st.at) continue;
          const dw = st.spaces.filter((sp) => sp.kind === p.dwelling);
          if (dw.length) homes.set(st.structure, { at: st.at, residents: dw.reduce((a, sp) => a + sp.count, 0) });
        }
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- each day: what the town used, drawn from the river ----
        const day = Math.floor(t / DAY);
        if (day !== lastDay) {
          const days = lastDay < 0 ? 1 : day - lastDay;
          lastDay = day;
          let litres = 0;
          for (const [h, x] of homes) {
            const l = x.residents * p.litres_per_person_per_day * days;
            used.set(h, (used.get(h) ?? 0) + l);
            litres += l;
          }
          const kl = Math.ceil(litres / 1000);
          if (kl > 0) {
            const st = because(`The town used ${kl} kL of water (${days} day${days > 1 ? "s" : ""}): drawing it from the river.`, C.call("work", { task: p.task, units: C.text(String(kl)), at: p.works }));
            st.then = (out) => {
              const dry = out.status !== "applied" && out.refusal?.code === "field_exhausted";
              if (dry && !restricted) {
                restricted = true;
                return [because("The river can't give what the town uses: announcing water restrictions.", say("water_restrictions", "Water restrictions: the river is too low to supply the town as usual.", { visible: "public", data: { since: t } }))];
              }
              if (!dry && out.status === "applied" && restricted) {
                restricted = false;
                return [because("The river supplies the town again: restrictions lifted.", say("water_restrictions", "Water restrictions lifted.", { visible: "public", data: { lifted: t } }))];
              }
            };
            steps.push(st);
          }
        }
        // ---- the quarter's bills: to each home's owner, the service charge and what was used ----
        const acc = ownAccount(obs);
        if (t >= nextBill && acc) {
          nextBill = t + p.bill_every_days * DAY;
          for (const [h, x] of [...homes].sort(([a], [b]) => (a < b ? -1 : 1))) {
            const lot = lotOf(book, x.at);
            const owner = lot ? ownerOf(book, lot) : undefined;
            const kl = Math.round((used.get(h) ?? 0) / 1000);
            used.set(h, 0);
            if (!owner || owner === me) continue;
            const amount = p.service_per_quarter + kl * p.price_per_kl;
            steps.push(because(`The quarter's water bill for ${h}: ${usd(p.service_per_quarter)} service, and ${kl} kL at ${usd(p.price_per_kl)}.`,
              say("invoice", `Water bill for ${h}: ${usd(amount)} (service ${usd(p.service_per_quarter)}; ${kl} kL used).`, { to: [owner], visible: [owner, me],
                data: { outcome: { money: { to: acc.account, amount: String(amount) } }, service: "water", home: h, kl } })));
          }
        }
        return steps;
      },
    );
  },
};

export const energy: BehaviourModule = {
  name: "utility.energy",
  version: "0.1.0",
  doc: "docs/behaviour/utilities.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      depot: "", // where it takes the grid's supply, and supplies from (the world must say)
      task: "supply_energy", kind: "energy", // the work that supplies a unit, and the resource it uses
      grid: "", // whom it buys from (the outside's market)
      units_per_customer_per_day: 0, // what a household uses (the world's figure)
      price_per_unit: 0, supply_per_day: 0, // the tariff (cents)
      bill_every_days: 30,
    }, ctx.params);
    need(p, ["depot", "grid"], "utility.energy");
    const me = ctx.entity;
    const book = new Book();
    const customers = new Map<string, { account: string; since: number; billedTo: number }>(); // person -> their account
    const ended = new Set<string>();
    let lastDay = -1;
    let owed = 0; // units supplied by the network, not yet taken from what we hold
    let onOrder = 0;
    let nextBill = p.bill_every_days * DAY;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const acc = ownAccount(obs);
        // ---- customers: who asked to be supplied; those gone (died, left) or who asked to stop, no longer ----
        for (const r of book.open("supply_request").filter((x) => (x.addressed_to ?? []).includes(me) && !customers.has(x.speaks_for!) && !ended.has(x.id))) {
          ended.add(r.id);
          if (typeof r.data?.account === "string") customers.set(r.speaks_for!, { account: r.data.account, since: t, billedTo: t });
        }
        const gone = new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...book.all("departure").map((r) => r.speaks_for!), ...book.open("supply_end").filter((r) => (r.addressed_to ?? []).includes(me)).map((r) => r.speaks_for!)]);
        // ---- each day: the network supplies what the customers use, from what we hold (bought from the grid) ----
        const day = Math.floor(t / DAY);
        if (day !== lastDay) {
          const days = lastDay < 0 ? 0 : day - lastDay;
          lastDay = day;
          owed += customers.size * p.units_per_customer_per_day * days;
        }
        const held = heldAt(obs, p.depot, p.kind);
        const supply = Math.min(owed, held);
        if (supply > 0) {
          owed -= supply;
          steps.push(because(`Supplying the ${supply} units our ${customers.size} customers used.`, C.call("work", { task: p.task, units: C.text(String(supply)), at: p.depot })));
        }
        // (Below a fortnight's use, with what's on order: a month's from the grid.)
        const fortnight = customers.size * p.units_per_customer_per_day * 14;
        const grid = goodsPrices(book, p.grid);
        const unit = grid.prices[p.kind];
        if (acc && unit !== undefined && grid.account && held - supply + onOrder < fortnight + owed) {
          const q = Math.max(1, customers.size * p.units_per_customer_per_day * 30 + owed);
          if (acc.balance >= q * unit) {
            onOrder += q;
            const st = order({ me, seller: p.grid, sellerAccount: grid.account, kind: p.kind, quantity: q, unitPrice: unit, at: p.depot, from: acc.account, why: `Below a fortnight's supply: buying a month's from the grid (${q}).` });
            st.then = () => { onOrder = 0; };
            steps.push(st);
          }
        }
        // ---- the month's bills: each customer, the supply charge and their use; a customer gone, their last ----
        const billing = t >= nextBill;
        if (billing) nextBill = t + p.bill_every_days * DAY;
        if (acc) for (const [who, c] of [...customers].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (!billing && !gone.has(who)) continue;
            const days = Math.max(0, Math.round((t - c.billedTo) / DAY));
            c.billedTo = t;
            if (gone.has(who)) customers.delete(who);
            if (days === 0 || gone.has(who) && book.all("death_registration").some((r) => r.data?.deceased === who)) continue;
            const units = p.units_per_customer_per_day * days;
            const amount = days * p.supply_per_day + units * p.price_per_unit;
            steps.push(because(`${who}'s energy bill: ${days} days' supply and ${units} units.`,
              say("invoice", `Energy bill: ${usd(amount)} (${days} days' supply at ${usd(p.supply_per_day)}; ${units} units at ${usd(p.price_per_unit)}).`, { to: [who], visible: [who, me],
                data: { outcome: { money: { to: acc.account, amount: String(amount) } }, service: "energy", days, units } })));
        }
        return steps;
      },
    );
  },
};
