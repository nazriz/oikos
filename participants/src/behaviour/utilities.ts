// utility.water and utility.energy: a water corporation and an energy retailer (docs/behaviour/utilities.md;
// docs/design/world-expansion.md 6.1). Water is physics: each day the corporation draws what the town uses from the
// river (a field), and when the river can't give it, it says so (restrictions). Energy is bought from the grid (the
// outside) and supplied, each unit emitting what the grid's generation does (a world counter). Both bill: water the
// owners of homes, quarterly (who pays is the world's: the owner, here); energy its customers, monthly.

import * as C from "../calls";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, goSee, ownAccount, say, StandingWork, type Step, usd, variableToday, visited, VISIT_MAX } from "./common";
import { stepper } from "./firms";
import { Respondent } from "./frictions";
import { slip } from "../slip";
import { Deliveries, goodsPrices, held as heldAt, order } from "./trade";
import * as P from "./papers";

/** A date as papers write one. */
const dated = (t: number) => `year ${Math.floor(t / (365 * DAY)) + 1}, day ${Math.floor((t % (365 * DAY)) / DAY) + 1}`;

export const water: BehaviourModule = {
  name: "utility.water",
  answers: {"office": "the water corporation", "acts": "What it acts on: its roll of properties, each billed by its meter each quarter; and the notices it is given of land changing hands and of building work."},
  routines: [
    { task: "draw_water", at: "works", every: 1, what: "Each day the works draws from the river what the town uses, by the published estimate of how many live in it, and says so when the river cannot give it." },
    { task: "bill", at: "works", every: ["bill_every_days", 91], what: "Before each round of bills a reader goes round the meters; then each property's owner is sent a bill for the service charge and what its meter shows was used. How often the bills go out is the order's." },
  ],
  keeps: [
    { what: "property_roll", why: "Its customer roll: the valuer's roll of each property it supplies is given to it, as valuations are given to a rating authority." },
    { what: "acquisition_notice", why: "Its customer roll: each notice that land it supplies has changed hands is given to it." },
  ],
  version: "0.3.0", // 0.3.0: its staff's first round of bills falls due one period after the standing order came into force, and they report the draws, the bills and when the next go out; 0.2.0: bills by its customer roll and the meters it reads; draws what the published population uses; no longer shown the town or the land register
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
      // Who knows what (docs/behaviour/utilities.md, "Who knows what"): its customer roll (a register it keeps from
      // what it is given), the meter a home's building carries (a measure of the building, in litres), the channel
      // its reader goes to the meters through, and how many days before the bills the round of readings begins.
      roll: "roll", meter: "water_used", meters: "", read_days: 21,
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the office-holder alone, who sets the standing work orders; "staff" its staff, who follow them.
      part: "" as "" | "seat" | "staff",
    }, ctx.params);
    need(p, ["works"], "utility.water");
    const me = ctx.entity;
    const book = new Book();
    const routines = new StandingWork(me, p.part);
    let billEvery = p.bill_every_days * DAY;
    let billingNow = p.part === "";
    // The customer roll: each property we supply, its owner as we were last told, and the buildings on it.
    const lots = new Map<string, { owner?: string; buildings: Set<string> }>();
    const lotOfBuilding = new Map<string, string>();
    const taken = new Set<string>();
    // Each meter: what it read when last billed, and what it read when last gone to (and when).
    const billedAt = new Map<string, number>();
    const reading = new Map<string, { litres: number; at: number }>();
    const unmetered = new Set<string>(); // gone to, and no meter there: not a home
    let toRead: string[] = []; // this round's meters still to go to
    let out = false; // a reader is out
    let outSince = 0;
    let lastDay = -1;
    let nextBill = p.bill_every_days * DAY;
    let billedUnder = ""; // the standing order the round of bills is counted from (the staff's)
    let reportDay = -1;
    let roundFor = -1; // the bill date the round under way is for
    let restricted = false;
    const building = (lot: string, structure: string) => {
      const x = lots.get(lot) ?? { buildings: new Set<string>() };
      x.buildings.add(structure);
      lots.set(lot, x);
      lotOfBuilding.set(structure, lot);
    };
    return stepper(
      (obs) => {
        book.absorb(obs);
        const roll = obs.channels[p.roll];
        if (roll?.kind === "records") for (const r of [...roll.records].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
          if (r.record !== "statement" || taken.has(r.id) || typeof r.data?.lot !== "string") continue;
          taken.add(r.id);
          if (r.kind === "property_roll") {
            lots.set(r.data.lot, { ...(lots.get(r.data.lot) ?? { buildings: new Set<string>() }), ...(typeof r.data.owner === "string" ? { owner: r.data.owner } : {}) });
            for (const b of (r.data.buildings ?? []) as { structure: string; dwellings?: number }[]) if (b.dwellings) building(r.data.lot, b.structure);
          } else if (r.kind === "acquisition_notice" && typeof r.data.owner === "string") lots.set(r.data.lot, { ...(lots.get(r.data.lot) ?? { buildings: new Set<string>() }), owner: r.data.owner });
        }
        // Notice of building work: a new building is connected (whether it is a home, its meter says when first read);
        // one brought down is taken off.
        for (const n of book.open("building_notice")) {
          if (taken.has(n.id) || !(n.addressed_to ?? []).includes(me)) continue;
          taken.add(n.id);
          if (typeof n.data?.removes === "string") {
            const lot = lotOfBuilding.get(n.data.removes);
            if (lot) lots.get(lot)?.buildings.delete(n.data.removes);
            lotOfBuilding.delete(n.data.removes);
          } else if (typeof n.data?.lot === "string" && typeof n.data?.structure === "string") building(n.data.lot, n.data.structure);
        }
        // The reader is back: each meter gone to, as it read.
        if (p.meters) {
          const back = visited(obs, p.meters);
          if (back.length) out = false;
          for (const c of back) {
            const st = c.structure;
            if (!st || !lotOfBuilding.has(st.structure)) continue;
            const v = st.variables?.[p.meter];
            if (!v) {
              if (st.complete) unmetered.add(st.structure);
              continue;
            }
            reading.set(st.structure, { litres: variableToday(v, obs.t) ?? v.value, at: obs.t });
          }
        }
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- each day: what the town uses, drawn from the river ----
        // (What it uses is what its people use: the statistician's published estimate of how many there are, at the
        // world's figure a head. Nobody counts them at home.)
        steps.push(...routines.set(book, [
          { task: p.task, at: p.works, every: DAY, why: "Setting the works' daily draw of what the town uses, as a standing work order." },
          { task: "bill", at: p.works, every: p.bill_every_days * DAY, why: `Setting the billing round: the meters read and the bills sent every ${p.bill_every_days} days, as a standing work order.` }]));
        const billing = routines.does(book, "bill", t, { every: p.bill_every_days * DAY });
        billingNow = !!billing;
        if (billing) billEvery = billing.every;
        // (Under a standing order the round is the order's: the first bills go out one period after it came into force,
        // and a new order starts its own count. Until 2026-10-09 the staff kept the office's own first date whatever
        // the order said: a seat that ordered bills every 30 days had none in 43.)
        if (billing?.order && billing.order.id !== billedUnder) {
          billedUnder = billing.order.id;
          nextBill = billing.order.from + billing.every;
        }
        const day = Math.floor(t / DAY);
        if (day !== lastDay) {
          const days = lastDay < 0 ? 1 : day - lastDay;
          lastDay = day;
          const estimate = book.open("population_estimate").sort((a, b) => b.at - a.at)[0];
          const people = Math.max(0, Math.floor(Number(estimate?.data?.residents) || 0));
          // (Only while the draw is ours to make: a day it was not made is not made up.)
          const kl = routines.does(book, p.task, t, { every: DAY }) ? Math.ceil((people * p.litres_per_person_per_day * days) / 1000) : 0;
          if (kl > 0) {
            const st = because(`The town of ${people} used about ${kl} kL of water (${days} day${days > 1 ? "s" : ""}): drawing it from the river.`, C.call("work", { task: p.task, units: C.text(String(kl)), at: p.works }));
            routines.did(p.task, t, { units: kl });
            st.then = (out) => {
              const dry = out.status !== "applied" && out.refusal?.code === "field_exhausted";
              if (out.status !== "applied") {
                routines.undid(p.task, { units: kl });
                routines.heldUp(p.task, dry ? "the river could not give what the town uses" : `the draw was refused (${out.refusal?.code ?? "no reason given"})`);
              }
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
        // ---- the quarter's bills: to each home's owner, the service charge and what its meter shows was used ----
        const acc = ownAccount(obs);
        if (t >= nextBill && acc && billing) {
          nextBill = t + billEvery;
          for (const [h, lot] of [...lotOfBuilding].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (unmetered.has(h)) continue;
            const owner = lots.get(lot)?.owner;
            // (A meter not read this quarter is billed the service charge alone; what it shows is billed when it is read.)
            const read = reading.get(h);
            const kl = read ? Math.max(0, Math.round((read.litres - (billedAt.get(h) ?? 0)) / 1000)) : 0;
            if (read) billedAt.set(h, read.litres);
            if (!owner || owner === me) continue;
            const amount = p.service_per_quarter + kl * p.price_per_kl;
            routines.did("bill", t);
            steps.push(because(`The quarter's water bill for ${h}: ${usd(p.service_per_quarter)} service, and ${kl} kL at ${usd(p.price_per_kl)}.`,
              say("invoice", `Water bill for ${h}: ${usd(amount)} (service ${usd(p.service_per_quarter)}; ${kl} kL used).`, { to: [owner], visible: [owner, me],
                data: { outcome: { money: { to: acc.account, amount: String(amount) } }, service: "water", home: h, kl } })));
          }
        }
        // The staff's report to the office, once a day (docs/behaviour/standing-work.md, "The staff's report").
        if (billing) routines.note("bill", `${p.meters ? `the meters are read from ${dated(Math.max(0, nextBill - p.read_days * DAY))} and ` : ""}the next bills go out on ${dated(nextBill)}`);
        if (p.part === "staff" && reportDay !== day) {
          reportDay = day;
          steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the water corporation's staff", tasks: { [p.task]: ["days' draw", "kL"], bill: ["bills"] } }));
        }
        return steps;
      },
      (obs) => (Math.floor(obs.t / DAY) + 1) * DAY + 6 * 3600,
      // The round of meter readings before each quarter's bills: the reader goes to a visit's worth of meters at a
      // time, and to the next when back.
      (obs) => {
        if (!p.meters || !billingNow) return [];
        if (roundFor !== nextBill && obs.t >= nextBill - p.read_days * DAY) {
          roundFor = nextBill;
          toRead = [...lotOfBuilding.keys()].filter((h) => !unmetered.has(h)).sort();
        }
        // (A reader who found nothing where they went brings nothing back: after two days, the next sets out.)
        if (out && obs.t - outSince > 2 * DAY) out = false;
        if (out || !toRead.length) return [];
        out = true;
        outSince = obs.t;
        return [goSee(p.meters, toRead.splice(0, VISIT_MAX))];
      },
    );
  },
};

export const energy: BehaviourModule = {
  name: "utility.energy",
  answers: {"office": "the energy retailer", "acts": "What it acts on: its customers' accounts, each billed each quarter; and notice that a customer has left or has died."},
  routines: [
    { task: "supply_energy", at: "depot", every: 1, what: "Each day the network supplies what the customers use from what the retailer holds, and more is bought from the grid when it runs below a fortnight's use. Those who ask to be supplied are taken on, and those gone taken off." },
    { task: "bill", at: "depot", every: ["bill_every_days", 30], what: "Each customer is sent a bill for the supply charge and what they used; one who has gone, their last. How often the bills go out is the order's." },
  ],
  // (What it buys in, it orders on its own order form: its staff's orders to the grid are that paper.)
  issues: [P.ORDER, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  version: "0.4.0", // 0.4.0: how often a bill is wrong is a slip at the rate of the world's table of slips (foundations F7), no longer a parameter; 0.3.1: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.3.0: some bills are wrong (an estimated reading entered too high), at the friction dial, and the retailer answers a customer who asks for a wrong bill to be put right from its own record of the bill; 0.2.1: its staff's first bills fall due one period after the standing order came into force; 0.2.0: has an order form of its own for buying from the grid; its staff report what they supplied and billed, and why they did not buy when stock ran low (docs/behaviour/standing-work.md, "The staff's report")
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
      // Wrong bills (docs/behaviour/utilities.md, "Wrong bills"): how often a bill is wrong is a slip, the world's table of
      // slips has its rate (foundations F7); this is by how much a wrong bill overstates the units used.
      billing_over_bps: 0,
      respond: {} as object, // how it answers a customer who asks for a bill to be put right
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the office-holder alone, who sets the standing work orders; "staff" its staff, who follow them.
      part: "" as "" | "seat" | "staff",
    }, ctx.params);
    need(p, ["depot", "grid"], "utility.energy");
    const me = ctx.entity;
    const book = new Book();
    const routines = new StandingWork(me, p.part);
    const customers = new Map<string, { account: string; since: number; billedTo: number }>(); // person -> their account
    const ended = new Set<string>();
    let lastDay = -1;
    let owed = 0; // units supplied by the network, not yet taken from what we hold
    let onOrder = 0; // ordered from the grid, not yet delivered (or refunded)
    const deliveries = new Deliveries();
    let nextBill = p.bill_every_days * DAY;
    let billedUnder = ""; // the standing order the round of bills is counted from (the staff's)
    let reportDay = -1;
    // A bill asked about: what it should have been, from the days it names, against what was billed. Only a bill of ours, to the asker.
    const resp = new Respondent(ctx.rng, me, null, {
      params: p.respond,
      truth: (m, from, bk) => {
        if (m.matter !== "bill" || !m.about) return undefined;
        const inv = bk.records.get(m.about) as any;
        if (!inv || inv.kind !== "invoice" || inv.speaks_for !== me || !(inv.addressed_to ?? []).includes(from) || inv.data?.service !== "energy") return undefined;
        const days = Math.floor(Number(inv.data.days) || 0);
        const billed = Math.floor(Number(inv.data.outcome?.money?.amount) || 0);
        const right = days * p.supply_per_day + p.units_per_customer_per_day * days * p.price_per_unit;
        return { owed: Math.max(0, billed - right), wrong: billed > right };
      },
    });
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const acc = ownAccount(obs);
        steps.push(...routines.set(book, [
          { task: p.task, at: p.depot, every: DAY, why: "Setting the daily supply to our customers, as a standing work order." },
          { task: "bill", at: p.depot, every: p.bill_every_days * DAY, why: `Setting the billing round: every customer billed every ${p.bill_every_days} days, as a standing work order.` }]));
        const supplying = routines.does(book, p.task, t, { every: DAY });
        const billingBy = routines.does(book, "bill", t, { every: p.bill_every_days * DAY });
        // The staff's report to the office, once a day (docs/behaviour/standing-work.md, "The staff's report").
        const tell = (): Step[] => {
          const today = Math.floor(t / DAY);
          if (p.part !== "staff" || reportDay === today) return [];
          reportDay = today;
          return routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the energy retailer's staff", tasks: { [p.task]: ["days' supply", "units"], bill: ["bills"] } });
        };
        if (!supplying && !billingBy) return [...steps, ...tell()];
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
        // What's come (or been refunded) is no longer on order.
        for (const d of deliveries.take(book, me)) if (d.kind === p.kind) onOrder = Math.max(0, onOrder - d.ordered);
        const held = heldAt(obs, p.depot, p.kind);
        const supply = supplying ? Math.min(owed, held) : 0;
        if (supply > 0) {
          owed -= supply;
          steps.push(because(`Supplying the ${supply} units our ${customers.size} customers used.`, C.call("work", { task: p.task, units: C.text(String(supply)), at: p.depot })));
          routines.did(p.task, t, { units: supply });
        }
        // (Below a fortnight's use, with what's on order: a month's from the grid.)
        const fortnight = customers.size * p.units_per_customer_per_day * 14;
        const grid = goodsPrices(book, p.grid);
        const unit = grid.prices[p.kind];
        // (For the staff's report: what is held, and why nothing was bought when it ran below a fortnight's use.)
        const low = !!supplying && held - supply + onOrder < fortnight + owed;
        if (supplying) {
          const q = Math.max(1, customers.size * p.units_per_customer_per_day * 30 + owed);
          const holds = `${held - supply} ${p.kind} held${onOrder ? ` and ${onOrder} on order` : ""}`;
          if (owed - supply > 0 && held - supply <= 0) routines.heldUp(p.task, `nothing is held to supply from: ${owed - supply} units used by customers are still to be supplied`);
          routines.note(p.task, !low ? holds : unit === undefined || !grid.account ? `${holds}, below a fortnight's use (${fortnight}); the grid's price list is not on file, so nothing was ordered`
            : acc && acc.balance < q * unit ? `${holds}, below a fortnight's use (${fortnight}); a month's from the grid (${q} at ${usd(unit)} each) comes to ${usd(q * unit)} and the account holds ${usd(acc.balance)}, so nothing was ordered: a smaller order is the office's to place on its order form` : `${holds}; a month's (${q}) ordered from the grid`);
        }
        if (supplying && acc && unit !== undefined && grid.account && low) {
          const q = Math.max(1, customers.size * p.units_per_customer_per_day * 30 + owed);
          if (acc.balance >= q * unit) {
            onOrder += q;
            const st = order({ me, seller: p.grid, sellerAccount: grid.account, kind: p.kind, quantity: q, unitPrice: unit, at: p.depot, from: acc.account, why: `Below a fortnight's supply: buying a month's from the grid (${q}).` });
            // (On order until it's delivered: until 2026-10-02 the order's own acceptance cleared it, and the office
            // ordered again at every step until the energy came, 1,400 times on one day of pilot 7d.)
            st.then = (out) => { if (out.status !== "applied") onOrder = Math.max(0, onOrder - q); };
            steps.push(st);
          }
        }
        // ---- the month's bills: each customer, the supply charge and their use; a customer gone, their last ----
        if (billingBy?.order && billingBy.order.id !== billedUnder) {
          billedUnder = billingBy.order.id;
          nextBill = billingBy.order.from + billingBy.every;
        }
        const billing = !!billingBy && t >= nextBill;
        if (billing) nextBill = t + billingBy!.every;
        if (acc && billingBy) for (const [who, c] of [...customers].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (!billing && !gone.has(who)) continue;
            const days = Math.max(0, Math.round((t - c.billedTo) / DAY));
            c.billedTo = t;
            if (gone.has(who)) customers.delete(who);
            if (days === 0 || gone.has(who) && book.all("death_registration").some((r) => r.data?.deceased === who)) continue;
            // (A bill may be wrong: an estimated reading entered too high, so more units are billed than were used.)
            const wrong = slip(ctx, "publish/invoice/metered_bill", who, { days });
            const units = wrong ? Math.round((p.units_per_customer_per_day * days * (10_000 + p.billing_over_bps)) / 10_000) : p.units_per_customer_per_day * days;
            const amount = days * p.supply_per_day + units * p.price_per_unit;
            routines.did("bill", t);
            steps.push(because(`${who}'s energy bill: ${days} days' supply and ${units} units.`,
              say("invoice", `Energy bill: ${usd(amount)} (${days} days' supply at ${usd(p.supply_per_day)}; ${units} units at ${usd(p.price_per_unit)}).`, { to: [who], visible: [who, me],
                data: { outcome: { money: { to: acc.account, amount: String(amount) } }, service: "energy", days, units, ...(wrong ? { estimated: true } : {}) } })));
        }
        if (billingBy) routines.note("bill", `the next bills go out on ${dated(nextBill)}`);
        // Customers who ask for a bill to be put right are answered by whoever does the billing, once.
        if (billingBy && acc) steps.push(...resp.steps(book, t, acc.account, acc.balance));
        steps.push(...tell());
        return steps;
      },
    );
  },
};
