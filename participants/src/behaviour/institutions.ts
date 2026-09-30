// The people inside the town's institutions, and the builder. Documented in
// docs/behaviour/institutions.md, with sources.
//
// None of this is law in the kernel: each participant reads the town's statements
// and applies them to what it can see, because that is its job, and
// (depending on its parameters) it may do the job well, badly, or not at all.

import { amount, cents } from "../money";
import * as C from "../calls";
import type { StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { evaluate, standingClaims } from "../law";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, prohibitions, cellsOf, commitmentOf, DAY, Letters, lotOf, ownAccount, record, say, sign, type Step, usd, withdraw } from "./common";
import { Deliveries, goodsPrices, held, order } from "./trade";
import { Bargaining, Staffing, stepper, WindingUp } from "./firms";

/** Who the registry says owns a lot: the latest standing ownership claim, following transfers. */
export function ownerOf(book: Book, lot: string): string | undefined {
  let holder: string | undefined;
  const titles = standingClaims([...book.ofType("claim"), ...book.ofType("claim_release"), ...book.ofType("withdrawal")]).filter((c) => c.about?.kind === "ownership" && c.about?.object === lot);
  for (const c of titles) holder = c.holder;
  for (const r of book.ofType("claim_transfer")) if (titles.some((c) => c.id === r.claim)) holder = r.to;
  return holder;
}

/**
 * city.planning_officer: decides permit applications. For each application it
 * asks whether granting it would breach a prohibition addressed to the office
 * (e.g. "no permit may be granted on the river lots"), by evaluating the
 * law's formal condition on the act of granting. It grants (records a
 * liberty to build) or refuses (publishes the decision), citing the law.
 * It keeps the town's land register (lots, their owners from the registry, and
 * what its survey shows built), and its report lists the town's vacant lots.
 * params: compliance_bps (how often it follows the law; default 10000), town.
 */
export const planningOfficer: BehaviourModule = {
  name: "city.planning_officer",
  version: "0.7.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ compliance_bps: 10_000, town: ctx.entity }, ctx.params); // (the town: the office's own)
    const book = new Book();
    const decided = new Set<string>();
    const letters = new Letters();
    // What the survey last showed on each cell: built or not.
    const built = new Map<string, boolean>();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
        for (const c of channels.cells(obs)) built.set(c.cell, !!c.structure);
      },
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        const apps = book.open("permit_application").filter((a) => (a.addressed_to ?? []).includes(me) && !decided.has(a.id));
        for (const app of apps.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          decided.add(app.id);
          const applicant = app.speaks_for!;
          // An application it can't decide gets a reply saying why (§9.3).
          const missing = ["lot", "structure_type"].filter((f) => typeof app.data?.[f] !== "string");
          if (missing.length) {
            steps.push(because("An application missing what it needs: saying so.", say("permit_decision", `Application ${app.id} can't be decided: it doesn't say ${missing.map((f) => (f === "lot" ? "which lot" : "what kind of building")).join(" or ")}.`,
              { to: [applicant], basis: app.id, data: { application: app.id, decision: "incomplete", missing } })));
            continue;
          }
          const granting = { block: "grant_permit", lot: app.data?.lot, structure_type: app.data?.structure_type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: granting, actor: applicant, now: obs.t }, []);
            return "value" in v && v.value;
          });
          const follows = ctx.rng(`comply-${app.id}`).below(10_000) < p.compliance_bps;
          const refuse = breached && follows;
          const decision = say("permit_decision",
            refuse ? `Permit refused for ${app.data?.lot}: it would breach ${breached!.id}.` : `Permit granted to build ${app.data?.structure_type} on ${app.data?.lot}.`,
            { to: [applicant], basis: app.id, data: { application: app.id, decision: refuse ? "refused" : "granted", ...(breached ? { law: breached.id } : {}) } });
          const step: Step = because(
            refuse ? `Refusing: granting it would breach ${breached!.id}, and we follow the law.` : breached ? `Granting, although it breaches ${breached.id} (we don't always follow the law).` : "Granting: no law we know of forbids it.",
            decision);
          if (!refuse) step.unshift(record("liberty", applicant, { action: "build", object: app.data?.lot, structure_type: app.data?.structure_type }, { basis: app.id }));
          steps.push(step);
        }
        steps.push(...letters.answer(() => {
          const decisions = book.open("permit_decision").filter((d) => d.speaks_for === me || d.in_position !== undefined);
          const granted = decisions.filter((d) => d.data?.decision === "granted").length;
          const refused = decisions.filter((d) => d.data?.decision === "refused").map((d) => `${d.data?.application} (${d.data?.law ?? "?"})`);
          // The land register: the town's lots, and which of them the last survey showed with nothing built.
          const townLots = book.open("lot").map((l) => l.id).filter((l) => ownerOf(book, l) === p.town).sort();
          const vacant = townLots.filter((l) => { const cs = cellsOf(book, l); return cs.length > 0 && cs.every((c) => built.get(c) === false); });
          const land = townLots.length
            ? ` The town owns ${townLots.length} lots; ${vacant.length} have nothing built on them${vacant.length ? `: ${vacant.slice(0, 40).join(", ")}${vacant.length > 40 ? `, and ${vacant.length - 40} more` : ""}` : ""}.`
            : "";
          return `Report from the planning office: ${decided.size} applications decided: ${granted} granted, ${refused.length} refused${refused.length ? ` (${refused.join(", ")})` : ""}.${land} Apply on the permit application form (form-permit).`;
        }));
        return steps;
      },
    );
  },
};

/**
 * city.inspector: patrols. Through a `sites` channel (whose coverage and
 * refresh interval the world sets) it sees what's built. Anything new that
 * the building law prohibits (evaluated against the permits it knows of,
 * for the lot's registered owner) gets a fine (a claim) and a demolition
 * order. What happens next is up to the owner, and whoever enforces orders.
 * params: fine (cents), compliance_bps (how often it acts on what it finds).
 */
export const inspector: BehaviourModule = {
  name: "city.inspector",
  version: "0.5.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ fine: 5_000_000, compliance_bps: 10_000 }, ctx.params);
    const book = new Book();
    const known = new Set<string>(); // structures already judged (or standing when we started)
    const found: string[] = []; // breaches acted on: "structure on lot (law)"
    let first = true;
    const letters = new Letters();
    const report = () =>
      `Report from the building inspector: ${known.size} buildings on record. ${found.length ? `Breaches found and acted on (a fine and a demolition order each): ${found.join(", ")}.` : "No breaches found."}`;
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      (obs) => {
        const me = obs.entity;
        const buildings = channels.structures(obs);
        const steps: Step[] = [];
        if (first) {
          for (const st of buildings) known.add(st.structure);
          first = false;
          return [...steps, ...letters.answer(report)];
        }
        const claims = standingClaims(book.records.values());
        for (const st of buildings) {
          if (known.has(st.structure)) continue;
          known.add(st.structure);
          // The lot it stands on (its corner cell's), by the registry.
          const lot = lotOf(book, st.at);
          const owner = (lot && ownerOf(book, lot)) ?? st.built_by ?? "unknown";
          const cells = channels.cells(obs).filter((c) => c.structure?.structure === st.structure).map((c) => c.cell).sort();
          const act = { block: "construct", lot, at: st.at, cells, structure_type: st.type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: act, actor: owner, now: obs.t }, claims);
            return "value" in v && v.value;
          });
          if (!breached || ctx.rng(`act-${st.structure}`).below(10_000) >= p.compliance_bps) continue;
          found.push(`${st.structure} on ${lot ?? st.at} (${breached.id})`);
          steps.push(because(`On patrol: ${st.structure} was built in breach of ${breached.id}; fining the owner and ordering it demolished.`,
            record("right", me, { kind: "fine", amount: p.fine, for: `Unpermitted ${st.type} on ${lot ?? st.at} (${st.structure}).` }, { against: owner, basis: breached.id }),
            say("demolition_order", `Order: demolish ${st.structure} on ${lot ?? st.at}, built in breach of ${breached.id}.`, { to: [owner], basis: breached.id, data: { structure: st.structure, lot, law: breached.id } }),
          ));
        }
        steps.push(...letters.answer(report));
        return steps;
      },
    );
  },
};

/**
 * firm.builder: takes construction and demolition contracts, and does the work (phase B). Its business knowledge
 * (params): for each kind of building, the materials it takes and the hours of building and demolition work
 * (`types`); where it keeps materials and its crew works (`yard`); whom it buys materials from (`supplier`, whose
 * price list it reads); what it pays its crew (`wage` per `period`); and its margin.
 * - Prices: materials at the supplier's prices, plus the crew's hours at their hourly wage, plus its margin. Published,
 *   and republished when its costs change.
 * - When a client has signed a construction contract: it signs, buys any materials it lacks (an order to its
 *   supplier, paid with the order), and once the materials are in the yard it starts the building and invoices the
 *   agreed price.
 * - Each working day (`work_days` of every 7) its crew at the yard works on the sites it has begun, oldest first,
 *   each worker up to a working day's hours, until a building's hours are done, or a demolition's.
 * - Its crew is sized to its work: it hires while the hours in hand need more hands over the next `horizon_days`
 *   (up to the yard's room), and lets one go at a time when it has more than that (keeping `min_crew`).
 * Documented in docs/behaviour/institutions.md.
 */
export const builder: BehaviourModule = {
  name: "firm.builder",
  version: "0.7.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        types: {} as { [type: string]: { materials: { [kind: string]: number }; build_labour: number; demolition_labour: number } },
        yard: "",
        industry: "", // what the work is (its postings say)
        supplier: "", // whom it buys materials from (the world must say)
        wage: 150_000, // the crew's pay, cents per period
        period: 14 * DAY,
        working_day: 8 * 3600, // seconds a worker works in a day
        work_days: 5, // of every 7
        build_markup_bps: 2000,
        workplace: "", // the space in the yard its crew works in
        max_crew: 12,
        min_crew: 2, // a core crew, kept through quiet times
        horizon_days: 90, // the crew it wants: enough to do the work in hand within this
        notice_days: 14,
        let_go_every_days: 7, // at most one let go in this time
      },
      ctx.params,
    );
    need(p, ["supplier"], "firm.builder");
    const book = new Book();
    const staffing = new Staffing(ctx, ctx.entity, { period: p.period, notice_days: p.notice_days, workplace: p.workplace || undefined, role: "construction worker", ...(p.industry ? { industry: p.industry } : {}) });
    // What's recorded against us to pay (rates on our yard, a fine), paid as a firm pays its debts (we don't wind up).
    const dues = new WindingUp(ctx.entity, { short_days: 0, wind_up_days: 0, idle_days: 0, reprice_days: 0, reprice_bps: 0 });
    let lastLetGo = -Infinity;
    const letters = new Letters();
    const deliveries = new Deliveries();
    const handled = new Set<string>(); // contracts taken on
    const waiting: { agreement: string; client: string; type?: string; on?: string; remove?: string; price?: string }[] = []; // signed, not yet begun
    const projects: { structure: string; task: "build" | "demolish"; left: number }[] = [];
    const typeOf = new Map<string, string>(); // structure -> its kind of building: what we've built, and what we've seen
    const onOrder = new Map<string, number>(); // kind -> ordered, not yet delivered
    const orderQty = new Map<string, { kind: string; quantity: number }>(); // our order -> what it was for
    const used = new Map<string, number>(); // worker -> seconds worked today
    let usedDay = -1;
    let publishedAt = "";
    // Hourly pay: the wage over the hours it pays for (working days in the period x the working day).
    let wage: number = p.wage; // (an enterprise agreement raises it)
    const bargaining = new Bargaining(ctx.entity);
    const hourly = () => Math.ceil((wage * 3600) / ((p.period / DAY) * (p.work_days / 7) * p.working_day));
    return Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        letters.take(obs);
        for (const d of deliveries.take(book, obs.entity)) {
          const o = orderQty.get(d.order);
          if (!o) continue;
          orderQty.delete(d.order);
          onOrder.set(o.kind, Math.max(0, (onOrder.get(o.kind) ?? 0) - o.quantity));
        }
      },
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        if (!acc) return steps;
        steps.push(...dues.payDebts(book, acc.account, acc.balance, staffing.workers(book, t).length * wage));
        for (const c of channels.cells(obs)) if (c.structure) typeOf.set(c.structure.structure, c.structure.type);
        const supply = goodsPrices(book, p.supplier);
        const materialsCost = (m: { [kind: string]: number }) => Object.entries(m).reduce((x, [k, q]) => x + (supply.prices[k] === undefined ? Infinity : q * supply.prices[k]!), 0);
        const withMargin = (x: number) => Math.floor((x * (10_000 + p.build_markup_bps)) / 10_000);
        const prices: { [type: string]: number } = {};
        const demolition: { [type: string]: number } = {};
        for (const [type, x] of Object.entries(p.types)) {
          const m = materialsCost(x.materials);
          if (Number.isFinite(m)) prices[type] = withMargin(m + Math.ceil((x.build_labour * hourly()) / 3600));
          demolition[type] = withMargin(Math.ceil((x.demolition_labour * hourly()) / 3600));
        }
        const priceText = () => Object.keys(prices).sort().map((type) => `${type} ${usd(prices[type]!)} (demolition ${usd(demolition[type]!)})`).join("; ");
        // Our prices, published for anyone who wants building work, and again whenever our costs change.
        const key = JSON.stringify([prices, demolition]);
        if (Object.keys(prices).length && key !== publishedAt) {
          const old = book.open("price_list").filter((r) => r.speaks_for === me);
          publishedAt = key;
          steps.push(because(old.length ? "Our costs have changed: republishing our prices." : "Publishing our prices, so clients know what building costs.",
            ...old.map((r) => withdraw(r.id, "Superseded.")),
            say("price_list", `Our prices for building on your lot, finished, and for demolition: ${priceText()}.`, { visible: "public", data: { prices, demolition } })));
        }

        // Contracts a client has signed: take them on (sign), and queue them. A construction contract is known by its
        // terms, whatever it's called: we build or demolish something, and the client pays (pilot 9: a mayor's
        // contract, drafted from plain words, carried no template, and the builder ignored it all year).
        for (const r of book.ofType("agreement")) {
          if (r.record !== "agreement" || !r.terms.parties.includes(me) || handled.has(r.id)) continue;
          const client = r.terms.parties.find((x) => x !== me);
          if (!client) continue;
          const job = commitmentOf(r, me).outcome?.structure;
          const agreed = commitmentOf(r, client).outcome?.money?.amount;
          if (r.terms.template !== "construction" && !(job && agreed !== undefined)) continue;
          if (!book.signedBy(r.id, client)) continue;
          // (Not before we know our own price for it: we wait for our supplier's prices, as a firm would.)
          const ours = job?.type ? prices[job.type] : undefined;
          if (job?.type && ours === undefined) continue;
          handled.add(r.id);
          // Offered less than our price: declined, saying what we charge (a firm answers an offer it won't take).
          if (agreed !== undefined && ours !== undefined && cents(agreed) < ours) {
            steps.push(because(`${client} offers ${usd(cents(agreed))} to build a ${job!.type}; our price is ${usd(ours)}: declining, and saying so.`,
              say("offer_declined", `We can't build a ${job!.type} on ${job!.on} for ${usd(cents(agreed))}: our price is ${usd(ours)}. Offer us a construction agreement at that price and we'll take it on.`, { to: [client], visible: [me, client], basis: r.id, data: { agreement: r.id, price: String(ours) } })));
            continue;
          }
          waiting.push({ agreement: r.id, client, type: job?.type, on: job?.on, remove: job?.remove, price: agreed === undefined ? undefined : amount(cents(agreed)) });
          if (!book.signedBy(r.id, me)) steps.push(because("A client has signed a construction contract: taking it on.", sign(r.id)));
        }

        // Materials: what the waiting jobs need, oldest first, as far as we can pay for them, against what's in the yard
        // and on order; order the shortfall. (A job we can't yet pay materials for waits, and so do the jobs after it.)
        const need = new Map<string, number>();
        const shortOf = (k: string, q: number) => Math.max(0, q - held(obs, p.yard, k) - (onOrder.get(k) ?? 0));
        const costOf = (m: Map<string, number>) => [...m].reduce((x, [k, q]) => x + shortOf(k, q) * (supply.prices[k] ?? Infinity), 0);
        for (const w of waiting) {
          const next = new Map(need);
          for (const [k, q] of Object.entries((w.type && p.types[w.type]?.materials) || {})) next.set(k, (next.get(k) ?? 0) + q);
          if (costOf(next) > acc.balance) break;
          for (const [k, q] of next) need.set(k, q);
        }
        for (const [kind, q] of [...need].sort(([a], [b]) => (a < b ? -1 : 1))) {
          const short = shortOf(kind, q);
          const price = supply.prices[kind];
          if (short <= 0 || price === undefined || !supply.account || acc.balance < short * price) continue;
          onOrder.set(kind, (onOrder.get(kind) ?? 0) + short);
          const s = order({ me, seller: p.supplier, sellerAccount: supply.account, kind, quantity: short, unitPrice: price, at: p.yard, from: acc.account, why: `Our waiting jobs need ${q} ${kind} and the yard has ${held(obs, p.yard, kind)}: ordering ${short} from our supplier.` });
          s.then = (out) => {
            const id = out.created?.order;
            if (id) orderQty.set(id, { kind, quantity: short });
            else onOrder.set(kind, Math.max(0, (onOrder.get(kind) ?? 0) - short));
          };
          steps.push(s);
        }

        // Start what we can, oldest first: buildings once their materials are in the yard; demolitions at once.
        const inYard = new Map<string, number>();
        const stock = (k: string) => inYard.get(k) ?? held(obs, p.yard, k);
        for (const w of [...waiting]) {
          const invoice = w.price ? [say("invoice", `Invoice: ${w.price} cents for ${w.remove ? `demolishing ${w.remove}` : `building a ${w.type} on ${w.on}`}.`, { to: [w.client], basis: w.agreement, data: { outcome: { money: { to: acc.account, amount: w.price, for: w.remove ? `demolishing ${w.remove}` : `building a ${w.type} on ${w.on}` } }, agreement: w.agreement } })] : [];
          if (w.remove) {
            // We need to know what it is (how long it takes to bring down): once we've seen it, we start.
            const type = typeOf.get(w.remove);
            if (!type) continue;
            waiting.splice(waiting.indexOf(w), 1);
            const labour = p.types[type]?.demolition_labour ?? 0;
            const sid = w.remove;
            // Anything of ours being built there stops.
            for (const pr of projects) if (pr.structure === sid && pr.task === "build") pr.left = 0;
            const s = because(`A demolition contract: starting to bring down ${sid}, and invoicing the price.`, C.call("structure", { remove: sid, by: me }), ...invoice);
            s.then = (out) => { if (out.status === "applied" && labour > 0) projects.push({ structure: sid, task: "demolish", left: labour }); };
            steps.push(s);
            continue;
          }
          const x = w.type ? p.types[w.type] : undefined;
          if (!x || !w.on) {
            waiting.splice(waiting.indexOf(w), 1);
            continue;
          }
          if (!Object.entries(x.materials).every(([k, q]) => stock(k) >= q)) continue;
          for (const [k, q] of Object.entries(x.materials)) inYard.set(k, stock(k) - q);
          waiting.splice(waiting.indexOf(w), 1);
          const s = because(`The materials for a ${w.type} on ${w.on} are in the yard: starting it, and invoicing the agreed price.`,
            ["site", C.call("structure", { type: w.type, on: w.on, by: me, materials_at: p.yard })], ...invoice);
          s.then = (out) => {
            const sid = out.created?.site;
            if (sid) typeOf.set(sid, w.type!);
            if (sid && x.build_labour > 0) projects.push({ structure: sid, task: "build", left: x.build_labour });
          };
          steps.push(s);
        }

        // The day's work: the crew at the yard, on our sites, oldest first, each up to a working day.
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        // Our own crew, there now.
        const ours = new Set(staffing.workers(book, t));
        const crew = [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.yard).flatMap((c) => c.structure!.spaces.flatMap((sp) => sp.occupants ?? [])))].filter((w) => ours.has(w)).sort();
        if (day % 7 < p.work_days && crew.length) {
          const standing = new Set(channels.cells(obs).flatMap((c) => (c.structure ? [c.structure.structure] : [])));
          for (const pr of [...projects]) {
            // A building finished (its hours done and its time passed), or one that's gone: nothing more to do there.
            const st = channels.cells(obs).find((c) => c.structure?.structure === pr.structure)?.structure;
            if (pr.left <= 0 || (pr.task === "build" && st?.complete) || (pr.task === "demolish" && !standing.has(pr.structure))) {
              projects.splice(projects.indexOf(pr), 1);
              continue;
            }
            const avail = Math.min(...crew.map((w) => p.working_day - (used.get(w) ?? 0)));
            if (avail <= 0) break;
            const units = Math.min(pr.left, avail * crew.length);
            const share = Math.ceil(units / crew.length);
            for (const w of crew) used.set(w, (used.get(w) ?? 0) + share);
            const s = because(`The day's work: ${crew.length} of our crew ${pr.task === "build" ? "building" : "demolishing"} ${pr.structure} (${Math.round(units / 3600)} hours of the ${Math.round(pr.left / 3600)} left).`,
              C.call("work", { task: pr.task, units: C.text(String(units)), at: p.yard, by: C.json(crew), on: pr.structure }));
            s.then = (out) => {
              if (out.status === "applied") pr.left -= units;
              else {
                for (const w of crew) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
                // Not (or no longer) there to work on: the job is over.
                if (["not_being_built", "not_coming_down", "unknown_structure"].includes(out.refusal?.code ?? "")) pr.left = 0;
              }
            };
            steps.push(s);
          }
        }
        // The crew: enough hands for the work in hand (waiting and begun) within the horizon, within the yard's room.
        const crewNow = staffing.workers(book, t);
        const inHand = projects.reduce((x, pr) => x + Math.max(0, pr.left), 0) + waiting.reduce((x, w) => x + ((w.remove ? p.types[typeOf.get(w.remove) ?? ""]?.demolition_labour : w.type ? p.types[w.type]?.build_labour : 0) ?? 0), 0);
        const perHand = (p.horizon_days * p.working_day * p.work_days) / 7;
        const want = Math.min(p.max_crew, Math.max(p.min_crew, Math.ceil(inHand / perHand)));
        const bill = Math.floor((crewNow.length * wage * 30 * DAY) / p.period);
        steps.push(...bargaining.steps(book, t, staffing, acc.account, acc.balance, (rise) => { wage = Math.floor((wage * (10_000 + rise)) / 10_000); }));
        steps.push(...staffing.routine(obs, book, acc.account, {
          target: want, wage: wage, canPost: acc.balance >= bill + wage,
          why: `${Math.round(inHand / 3600)} hours of work in hand need ${want} hands to do within ${p.horizon_days} days; we have ${crewNow.length}: posting a job.`,
        }));
        if ((crewNow.length > want && t - lastLetGo >= p.let_go_every_days * DAY) || (crewNow.length && acc.balance < crewNow.length * wage)) {
          const broke = acc.balance < crewNow.length * wage;
          const s = staffing.letGo(book, t, broke ? `Can't cover the next pay period (${usd(acc.balance)} for ${crewNow.length}): letting the most recent hire go.` : `${Math.round(inHand / 3600)} hours of work in hand need ${want} hands; we have ${crewNow.length}: letting the most recent hire go.`,
            broke ? "Redundancy: we can't cover the wage bill." : "Redundancy: there isn't the work.");
          if (s.length) lastLetGo = t;
          steps.push(...s);
        }
        steps.push(...letters.answer(() => `Our prices for building on your lot, finished, and for demolition: ${priceText() || "none yet (we're waiting on our supplier's prices)"}. To have us build or demolish, offer us a construction agreement: what to build and on which lot (or what to demolish), and the price, paid from your account on our invoice. We start once you've signed and we have the materials; permits are the owner's to get.`,
          "A letter asking about work: answering with our prices and how we take on a job."));
        return steps;
      },
    ), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};


/**
 * city.registry: the registry of deaths (after a real registry of births, deaths and marriages, where a death is
 * registered from a notification: docs/behaviour/institutions.md). It reads death notifications addressed to the town and, once per death,
 * publishes a public registration with what it was told: who died, who reported it, the partner, the children and
 * any children left with no adult at home. It doesn't check what it's told (a later module could).
 */
export const registry: BehaviourModule = {
  name: "city.registry",
  version: "0.3.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(_ctx: ParticipantContext) {
    const book = new Book();
    const registered = new Set<string>();
    const letters = new Letters();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        for (const r of book.all("death_registration")) registered.add(r.data?.deceased);
        for (const n of book.open("death_notification")) {
          const who = n.data?.deceased;
          if (!who || registered.has(who) || !(n.addressed_to ?? []).includes(me)) continue;
          registered.add(who);
          const d = n.data;
          steps.push(because(`A death is reported to us (${who}, by ${n.speaks_for}): registering it.`, say("death_registration", `Death registered: ${who}.`, {
            basis: n.id, visible: "public",
            data: { deceased: who, reported_by: n.speaks_for, ...(d.partner ? { partner: d.partner } : {}), children: d.children ?? [], without_adult: d.without_adult ?? [] },
          })));
        }
        steps.push(...letters.answer(() => `Report from the registrar: ${registered.size} deaths registered${registered.size ? ` (${[...registered].sort().join(", ")})` : ""}.`));
        return steps;
      },
    );
  },
};

/**
 * city.child_protection: children left with no adult at home. On a death registration naming children without an
 * adult, or a child's own request for help, it takes them into care, which (the town having no foster homes yet)
 * is care elsewhere: they leave the town with the office's worker. After a real child protection service, much
 * simplified (docs/behaviour/institutions.md).
 */
export const childProtection: BehaviourModule = {
  name: "city.child_protection",
  version: "0.3.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(_ctx: ParticipantContext) {
    const book = new Book();
    const taken = new Set<string>();
    const letters = new Letters();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      () => {
        const steps: Step[] = [];
        const children = [
          ...book.all("death_registration").flatMap((r) => (r.data?.without_adult ?? []) as string[]),
          ...book.all("care_request").flatMap((r) => (r.data?.children ?? []) as string[]),
        ];
        for (const c of children) {
          if (taken.has(c)) continue;
          taken.add(c);
          steps.push(because("A child with no adult at home: taking them into care elsewhere.", C.call("presence", { who: c, leave: "yes" })));
        }
        steps.push(...letters.answer(() => `Report from the child protection office: ${taken.size} children taken into care elsewhere (the town has no foster homes).`));
        return steps;
      },
    );
  },
};
