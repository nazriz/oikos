// The people inside the town's institutions, and the builder. Documented in
// docs/behaviour/institutions.md, with sources.
//
// None of this is law in the kernel: each participant reads the town's statements
// and applies them to what it can see, because that is its job, and
// (depending on its parameters) it may do the job well, badly, or not at all.

import { Reconsiderations } from "./decisions";
import { amount, cents, moneyNow } from "../money";
import * as C from "../calls";
import type { LookRequest, Observation, SiteStructure, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { standingClaims } from "../law";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { ask, Asked, Directions, goSee, ownerLooks, visited, VISIT_MAX, nextLook, because, Book, prohibitions, holdsOf, noting, cellsOf, commitmentOf, DAY, Letters, lotOf, ownAccount, record, say, sign, type Step, usd, withdraw, outOfTime, team, StandingWork, CounterWork } from "./common";
import { Deliveries, goodsPrices, held, order } from "./trade";
import { Bargaining, receipts, Staffing, Takings, stepper, WindingUp } from "./firms";
import * as P from "./papers";

/** Who the registry says owns a lot: the latest standing ownership claim, following transfers. */
export function ownerOf(book: Book, lot: string): string | undefined {
  let holder: string | undefined;
  // (Standing: recorded, and not released or withdrawn, as `standingClaims` reads the registry.)
  const titles = book.claimsBy("object", lot).filter((c) => c.about?.kind === "ownership" && !book.released.has(c.id) && !book.withdrawn.has(c.id));
  for (const c of titles) holder = c.holder;
  // A transfer counts if the holder made it, or whoever issued the title (the land registry: a death's transmission, say).
  for (const r of book.ofType("claim_transfer")) {
    const c = titles.find((x) => x.id === r.claim);
    if (c && (r.speaks_for === holder || r.speaks_for === c.speaks_for)) holder = r.to;
  }
  return holder;
}

/** A lot of an organisation's own, as its papers have it: its ground, and what stands on it. */
export interface OwnLot { lot: string; cells: string[]; structures: { structure: string; type: string }[] }

/**
 * An organisation's own land as its own papers have it (docs/design/knowing.md, section 8: "the town's own asset
 * register"): the lots its titles say it holds now; for each, its ground and what stood on it when its asset register
 * was last made up (`asset_register`: its own document, one entry a lot); and what the notices of building work it
 * has been given since say was begun or brought down there. Paper, not sight: what stands there today is known by
 * going to look.
 */
export function ownLand(book: Book, owner: string): OwnLot[] {
  const register = book.open("asset_register").filter((r) => r.speaks_for === owner).sort((a, b) => b.at - a.at)[0];
  const lots = new Map<string, OwnLot>();
  for (const a of ((register?.data?.assets ?? []) as { lot: string; cells?: string[]; structure?: string; type?: string }[])) {
    if (typeof a.lot !== "string") continue;
    const x = lots.get(a.lot) ?? { lot: a.lot, cells: a.cells ?? [], structures: [] };
    if (a.structure && a.type) x.structures.push({ structure: a.structure, type: a.type });
    lots.set(a.lot, x);
  }
  // (Land that has come to it since: its titles are its own papers.)
  for (const c of book.claimsBy("holder", owner)) if (c.about?.kind === "ownership" && typeof c.about.object === "string" && !lots.has(c.about.object)) lots.set(c.about.object, { lot: c.about.object, cells: cellsOf(book, c.about.object), structures: [] });
  for (const r of book.ofType("claim_transfer")) {
    const c = r.to === owner ? book.records.get(r.claim) : undefined;
    if (c?.record === "claim" && c.about?.kind === "ownership" && typeof c.about.object === "string" && !lots.has(c.about.object)) lots.set(c.about.object, { lot: c.about.object, cells: cellsOf(book, c.about.object), structures: [] });
  }
  const notices = book.open("building_notice").filter((n) => (n.addressed_to ?? []).includes(owner)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  for (const n of notices) {
    const d = n.data ?? {};
    if (typeof d.removes === "string") for (const x of lots.values()) x.structures = x.structures.filter((st) => st.structure !== d.removes);
    else if (typeof d.lot === "string" && typeof d.structure === "string" && lots.has(d.lot) && !lots.get(d.lot)!.structures.some((st) => st.structure === d.structure)) lots.get(d.lot)!.structures.push({ structure: d.structure, type: String(d.structure_type ?? "") });
  }
  return [...lots.values()].filter((x) => ownerOf(book, x.lot) === owner).sort((a, b) => (a.lot < b.lot ? -1 : 1));
}

/**
 * city.planning_officer: decides permit applications. For each application it
 * asks whether granting it would breach a prohibition addressed to the office
 * (e.g. "no permit may be granted on the river lots"), by evaluating the
 * law's formal condition on the act of granting. It grants (records a
 * liberty to build) or refuses (publishes the decision), citing the law.
 * It reads the town's own asset register (the lots the town's titles say it holds, and what its
 * papers say stands on each), and its report lists the town's lots with nothing on them.
 * params: compliance_bps (how often it follows the law; default 10000), town.
 */
export const planningOfficer: BehaviourModule = {
  name: "city.planning_officer",
  answers: {"office": "the planning office", "acts": "What it acts on: an application for a planning permit on the permit form (permit_application), which it decides under the planning law.", "forms": [{"about": ["permit", "build", "applic", "develop"], "say": "An application to build goes on the permit form (permit_application), naming the lot and the kind of building."}], "report": true},
  issues: P.PLANNING,
  version: "0.11.0", // 0.11.0: looks at a refusal again when asked inside the days the law gives, and records that it did (foundations F8); 0.10.0: its decision form records the liberty to build beside a decision to grant (FormWrites `claim`), as the code office does; 0.9.1: its decision form says what records the permission (the liberty to build, beside the decision); 0.9.0: the town's land from the town's own papers; no longer shown the land register or a survey of the town
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ compliance_bps: 10_000, town: ctx.entity, // (the town: the office's own)
      // A law against building where a listed species lives, if the world has one: applied by the latest habitat
      // register the environment office publishes (the lots it found them on).
      habitat_law: "" }, ctx.params);
    const book = new Book();
    const decided = new Set<string>();
    const decided_: { application: string; decision: "granted" | "refused" | "incomplete"; law?: string }[] = [];
    const letters = new Letters(planningOfficer.answers);
    const recon = new Reconsiderations(ctx.entity, ["permit_decision"]); // a refusal looked at again when asked inside the days the law gives (foundations F8)
    return noting(book, stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
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
            decided_.push({ application: app.id, decision: "incomplete" });
            steps.push(because("An application missing what it needs: saying so.", say("permit_decision", `Application ${app.id} can't be decided: it doesn't say ${missing.map((f) => (f === "lot" ? "which lot" : "what kind of building")).join(" or ")}.`,
              { to: [applicant], basis: app.id, data: { application: app.id, decision: "incomplete", missing } })));
            continue;
          }
          const granting = { block: "grant_permit", lot: app.data?.lot, structure_type: app.data?.structure_type };
          // (The habitat law in force: itself or what has replaced it; withdrawn, it's no longer applied.)
          const habitat = p.habitat_law ? book.current(p.habitat_law) : undefined;
          const register = book.open("habitat_register").sort((a, b) => b.at - a.at)[0];
          const onHabitat = habitat && ((register?.data?.lots as string[] | undefined) ?? []).includes(app.data?.lot);
          const breached = prohibitions(book).find((l) => holdsOf(book, l, { block: granting, actor: applicant, now: obs.t })) ?? (onHabitat ? habitat : undefined);
          const follows = ctx.rng(`comply-${app.id}`).below(10_000) < p.compliance_bps;
          const refuse = breached && follows;
          decided_.push({ application: app.id, decision: refuse ? "refused" : "granted", ...(breached ? { law: breached.id } : {}) });
          const decision = say("permit_decision",
            refuse ? `Permit refused for ${app.data?.lot}: it would breach ${breached!.id}.` : `Permit granted to build ${app.data?.structure_type} on ${app.data?.lot}.`,
            { to: [applicant], basis: app.id, data: { application: app.id, decision: refuse ? "refused" : "granted", ...(breached ? { law: breached.id } : {}) } });
          const step: Step = because(
            refuse ? `Refusing: granting it would breach ${breached!.id}, and we follow the law.` : breached ? `Granting, although it breaches ${breached.id} (we don't always follow the law).` : "Granting: no law we know of forbids it.",
            decision);
          if (!refuse) step.unshift(record("liberty", applicant, { action: "build", object: app.data?.lot, structure_type: app.data?.structure_type }, { basis: app.id }));
          steps.push(step);
        }
        // Asked to look at a refusal again: the law applied once more to the application as it stands, with the laws now in force, without the draw of
        // whether the office follows them (a review does); a permit it would now grant is granted, with the liberty to build that goes with it.
        steps.push(...recon.steps(book, obs.t, (dec, req) => {
          if (dec.data?.decision !== "refused") return { changed: false, found: "the permit was not refused", steps: [] };
          const app = typeof dec.data?.application === "string" ? (book.records.get(dec.data.application) as StatementRecord | undefined) : undefined;
          if (!app || app.record !== "statement" || app.speaks_for !== req.speaks_for) return { changed: false, found: "the application is not on our file, or is not the asker's", steps: [] };
          const granting = { block: "grant_permit", lot: app.data?.lot, structure_type: app.data?.structure_type };
          const habitat = p.habitat_law ? book.current(p.habitat_law) : undefined;
          const register = book.open("habitat_register").sort((a, b) => b.at - a.at)[0];
          const onHabitat = habitat && ((register?.data?.lots as string[] | undefined) ?? []).includes(app.data?.lot);
          const breached = prohibitions(book).find((l) => holdsOf(book, l, { block: granting, actor: app.speaks_for!, now: obs.t })) ?? (onHabitat ? habitat : undefined);
          if (breached) return { changed: false, found: `it would still breach ${breached.id}`, steps: [] };
          const grant = say("permit_decision", `Permit granted to build ${app.data?.structure_type} on ${app.data?.lot}, on a second look.`,
            { to: [app.speaks_for!], basis: app.id, data: { application: app.id, decision: "granted", on_review: req.id, replaces: dec.id } });
          const step: Step = because(`Asked to look at our refusal ${dec.id} again: nothing we know of forbids it now; granting.`, grant);
          step.unshift(record("liberty", app.speaks_for!, { action: "build", object: app.data?.lot, structure_type: app.data?.structure_type }, { basis: app.id }));
          return { changed: true, found: "no law in force forbids it now", steps: [step] };
        }));
        steps.push(...letters.answer(() => {
          // (Its own decisions, as it made them: its channels show it applications, not what it published in reply, so
          // until 2026-10-02 the report said "39 decided: 0 granted, 0 refused", and pilot 7e's mayor asked why.)
          const granted = decided_.filter((d) => d.decision === "granted").length;
          const refused = decided_.filter((d) => d.decision === "refused").map((d) => `${d.application} (${d.law ?? "?"})`);
          // The town's asset register: its lots, and which of them its papers show with nothing built (paper, not
          // sight: whoever relies on a lot goes to look at it).
          const townLots = ownLand(book, p.town);
          const vacant = townLots.filter((x) => x.structures.length === 0).map((x) => x.lot);
          const land = townLots.length
            ? ` By the town's asset register it owns ${townLots.length} lots; ${vacant.length} have nothing built on them${vacant.length ? `: ${vacant.slice(0, 40).join(", ")}${vacant.length > 40 ? `, and ${vacant.length - 40} more` : ""}` : ""}. (The register is paper: go and see a lot before relying on it.)`
            : "";
          return `Report from the planning office: ${decided.size} applications decided: ${granted} granted, ${refused.length} refused${refused.length ? ` (${refused.join(", ")})` : ""}${decided_.some((d) => d.decision === "incomplete") ? `, ${decided_.filter((d) => d.decision === "incomplete").length} sent back incomplete` : ""}.${land} Apply on the permit application form (form-permit).`;
        }));
        return steps;
      },
    ));
  },
};

/**
 * city.inspector: inspects building work it is told of. Whoever builds tells the town when work begins (a building
 * notice: what, on which lot, where); the inspector goes to that site (a visit: it takes the office's time), asks the
 * land registry who owns the lot, and judges what it finds against the building law and the permits the town has
 * granted. A breach gets a fine (a claim) and a demolition order; what happens next is up to the owner, and whoever
 * enforces orders. It then tells the valuer what was built or brought down (`valuer`), as a council asks for a
 * supplementary valuation. Work nobody tells the town of is not found: there is no patrol.
 * params: fine (in the smallest unit of money), compliance_bps (how often it acts on what it finds), the channels it goes and asks through.
 */
export const inspector: BehaviourModule = {
  name: "city.inspector",
  answers: {"office": "the building inspector's office", "acts": "What it acts on: a notice of building work given to the town, whose site it goes to see; and a direction on its enforcement form (inspector_enforcement) from those the town's rule on directions names.", "report": true},
  issues: P.INSPECTOR,
  issuesWith: (p) => ({ valuer: p.valuer }),
  takes: [{ form: "inspector_enforcement", title: "Enforcement direction to the building inspector",
    fields: {
      fines: { type: "choice", options: ["yes", "no"], required: true, description: "Whether a breach the inspector finds is fined and ordered demolished: yes, as the office does of its own accord; no, it is recorded and nothing more." },
      fine: { type: "amount", description: "The fine for a breach, where it is to be other than the office's usual one." },
    },
    follows: "While a direction with fines no stands, the inspector still goes to the sites it is told of and still tells the valuer what was built, but lays no fine and makes no demolition order on a breach: it records the breach in its report. With fines yes, it fines and orders as before, at the amount given if one is." }],
  version: "0.7.0", // 0.7.0: takes a written direction on enforcement (docs/behaviour/directions.md); 0.6.0: goes to the sites it is notified of and asks the registry who owns them; no patrol of the town
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ fine: 5_000_000, compliance_bps: 10_000,
      sites: "sites", // the channel it goes to a site through (a visit)
      register: { lots: "lots", titles: "titles", dealings: "dealings" }, // the land register, asked about one lot
      valuer: "", // whom it tells of what was built or brought down (none: nobody)
      // Whose written directions it follows (docs/behaviour/directions.md): the town's own rule, a record the world
      // names (none: it follows nobody's); and how often it follows one it is given.
      directed_under: "", direction_compliance_bps: 10_000,
    }, ctx.params);
    const book = new Book();
    const directions = new Directions(ctx, { under: p.directed_under, compliance_bps: p.direction_compliance_bps, office_words: "the building inspector" });
    const notFined: string[] = []; // breaches found and, by direction, not acted on
    const asked = new Asked();
    const notices: { id: string; lot?: string; at?: string; structure?: string; type?: string; removes?: string; gone?: boolean }[] = [];
    const taken = new Set<string>();
    const sitesSeen = new Map<string, SiteStructure | null>(); // structure -> as we found it (null: nothing there)
    const found: string[] = []; // breaches acted on: "structure on lot (law)"
    let inspected = 0;
    const letters = new Letters(inspector.answers);
    const report = () =>
      `Report from the building inspector: ${taken.size} notices of building work received, ${inspected} sites inspected. ${found.length ? `Breaches found and acted on (a fine and a demolition order each): ${found.join(", ")}.` : notFined.length ? "No breaches acted on." : "No breaches found."}${notFined.length ? ` Breaches found and, by direction, not fined or ordered demolished: ${notFined.join(", ")}.` : ""} We inspect the work we are told of; work nobody tells the town of we don't see.`;
    return noting(book, stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
        for (const n of book.open("building_notice")) {
          if (taken.has(n.id) || !(n.addressed_to ?? []).includes(obs.entity)) continue;
          taken.add(n.id);
          const d = n.data ?? {};
          notices.push({ id: n.id, ...(typeof d.lot === "string" ? { lot: d.lot } : {}), ...(typeof d.at === "string" ? { at: d.at } : {}), ...(typeof d.structure === "string" ? { structure: d.structure } : {}),
            ...(typeof d.structure_type === "string" ? { type: d.structure_type } : {}), ...(typeof d.removes === "string" ? { removes: d.removes } : {}) });
        }
        // What a visit found: each site gone to, as it was.
        const back = visited(obs, p.sites);
        for (const n of notices) {
          if (n.gone || !n.structure || sitesSeen.has(n.structure)) continue;
          const here = back.filter((c) => c.structure?.structure === n.structure || c.cell === n.at);
          if (here.length) sitesSeen.set(n.structure, here.find((c) => c.structure?.structure === n.structure)?.structure ?? null);
          // (Gone to, and nothing of it there to be found: it does not stand.)
          else if (back.length && asked.since(`site:${n.id}`) >= 0 && asked.since(`site:${n.id}`) < obs.t) sitesSeen.set(n.structure, null);
        }
      },
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        const claims = standingClaims(book.records.values());
        for (const n of [...notices]) {
          // Something brought down: the valuer is told; nothing to inspect.
          if (n.removes) {
            notices.splice(notices.indexOf(n), 1);
            if (p.valuer) steps.push(because(`${n.removes} is being brought down: telling the valuer.`, say("valuation_request", `Supplementary valuation: ${n.removes} has been demolished.`, { to: [p.valuer], basis: n.id, data: { removed: n.removes, ...(n.lot ? { lot: n.lot } : {}) } })));
            continue;
          }
          if (!n.structure || !sitesSeen.has(n.structure)) continue;
          notices.splice(notices.indexOf(n), 1);
          inspected++;
          const st = sitesSeen.get(n.structure);
          if (!st) continue; // nothing stands there: nothing to judge
          // The lot it stands on (its corner cell's), and its owner, by the registry.
          const lot = n.lot ?? lotOf(book, st.at);
          const owner = (lot && ownerOf(book, lot)) ?? st.built_by ?? "unknown";
          const cells = visited(obs, p.sites).filter((c) => c.structure?.structure === st.structure).map((c) => c.cell).sort();
          const act = { block: "construct", lot, at: st.at, cells: cells.length ? cells : [st.at], structure_type: st.type };
          const breached = prohibitions(book).find((l) => holdsOf(book, l, { block: act, actor: owner, now: obs.t }, claims));
          if (p.valuer) steps.push(because(`A ${st.type} is being built on ${lot ?? st.at}: asking the valuer for a supplementary valuation.`,
            say("valuation_request", `Supplementary valuation: a ${st.type} (${st.structure}) on ${lot ?? st.at}.`, { to: [p.valuer], basis: n.id, data: { ...(lot ? { lot } : {}), structure: st.structure, structure_type: st.type } })));
          if (!breached || ctx.rng(`act-${st.structure}`).below(10_000) >= p.compliance_bps) continue;
          // An enforcement direction that stands (from whoever the town says may direct us): whether a breach is
          // fined and ordered down, and at what amount.
          const enforcement = directions.standing(book, "inspector_enforcement");
          if (enforcement?.data?.fines === "no") {
            notFined.push(`${st.structure} on ${lot ?? st.at} (${breached.id}; direction ${enforcement.id})`);
            continue;
          }
          const fine = typeof enforcement?.data?.fine === "string" ? cents(enforcement.data.fine) : p.fine;
          found.push(`${st.structure} on ${lot ?? st.at} (${breached.id})`);
          steps.push(because(`Inspected: ${st.structure} is being built in breach of ${breached.id}; fining the owner and ordering it demolished.`,
            record("right", me, { kind: "fine", amount: fine, for: `Unpermitted ${st.type} on ${lot ?? st.at} (${st.structure}).` }, { against: owner, basis: breached.id }),
            say("demolition_order", `Order: demolish ${st.structure} on ${lot ?? st.at}, built in breach of ${breached.id}.`, { to: [owner], basis: breached.id, data: { structure: st.structure, lot, law: breached.id } }),
          ));
        }
        steps.push(...directions.letters(book, (d) => (d.data?.fines === "no" ? "A breach the inspector finds is recorded in its report, and neither fined nor ordered demolished." : `A breach the inspector finds is fined${typeof d.data?.fine === "string" ? ` ${usd(cents(d.data.fine))}` : ""} and ordered demolished.`)));
        steps.push(...letters.answer(report));
        return steps;
      },
      undefined,
      // Before it judges: who owns each lot notified (the registry, asked about the one lot), and the site itself, gone to.
      (obs) => {
        // (One search of a register is answered to a look: one for each of its channels now, and the rest as this is
        // asked again, until there is nothing more to ask.)
        const looks: LookRequest[] = [];
        const used = new Set<string>();
        const go: string[] = [];
        for (const n of notices) {
          if (n.removes || !n.structure) continue;
          const lot = n.lot ?? (n.at ? lotOf(book, n.at) : undefined);
          if (lot) looks.push(...ownerLooks(book, asked, p.register, lot, used));
          else if (n.at && !used.has(p.register.lots) && asked.first(`ground:${n.at}`)) {
            used.add(p.register.lots);
            looks.push(ask.about(p.register.lots, "data.cells", n.at, { most: 1 }));
          }
          // (To the ground notified, where the notice says it: a building may be gone, its ground is always there.)
          if (!sitesSeen.has(n.structure) && go.length < VISIT_MAX && asked.first(`site:${n.id}`, obs.t)) go.push(n.at ?? n.structure);
        }
        if (go.length) looks.push(goSee(p.sites, go));
        return looks;
      },
    ));
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
  answers: {"office": "the builder's office", "acts": "What it acts on: a construction agreement signed with it, built once a permit for the site is in force and invoiced as agreed. Its prices are published.", "report": true},
  issues: [P.JOB_ADVERTISEMENT, P.ORDER],
  issuesWith: (p) => P.staffingOwn({ role: "construction worker", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }),
  version: "0.14.0", // 0.14.0: after a stoppage its offer follows what the stoppage cost it in takings, not a fixed share of the gap (docs/behaviour/unions.md, "Concession"); 0.13.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.13.0: 0.13.0: takes repair orders from a client who has paid for them (`repair_task`; none by default: nothing changes), done by its crew in its own hours, oldest first; 0.12.3: takes on the share of its hands the world gives by the day, and pays them for the days there is building to do; 0.12.2: registers the share of its jobs the world gives for its kind; 0.12.1: with what 0.11.2 changed; 0.12.0: goes to a lot before building on it, sees its sites as its crew works on them, and gives notice of building work; no longer shown the town
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
        work_days: 5, // of every 7 look_at: 0, look_days: 5, // when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)
        build_markup_bps: 2000,
        quote_valid_days: 30, // a published price is honoured this long (placeholder: a common term for a builder's quote)
        workplace: "", // the space in the yard its crew works in
        max_crew: 12,
        min_crew: 2, // a core crew, kept through quiet times
        horizon_days: 90, // the crew it wants: enough to do the work in hand within this
        notice_days: 14,
        // Of the jobs it fills, the share it puts on its payroll returns (the world's figure for employers of its kind;
        // 10,000: all). One it does not register is paid whole, and reported to nobody (docs/behaviour/firms.md).
        registered_bps: 10_000,
        // Work by the day (docs/behaviour/firms.md): of the jobs it fills, the share it fills by the day, and what it
        // pays for a day (the world's figures for employers of its kind; 0: every job is on a standing wage).
        casual_bps: 0, day_wage: 0,
        let_go_every_days: 7, // at most one let go in this time
        // The land register, where this world keeps one to look things up in: our channel onto its plans of lots.
        // (None: whatever plans we know are those we're shown.)
        register: null as { lots: string } | null,
        // Going to look (docs/design/knowing.md, section 8): the channel its foreman goes to a lot or a building
        // through, before building there or bringing it down (none: it relies on what it is shown).
        sites: "",
        // Whom it gives notice of building work to as it begins (the council, whose inspector comes; whoever connects
        // the services): the world gives them.
        notify: [] as string[],
        // Repairs (docs/behaviour/building.md, "Repairs"): the catalogue task that repairs a building ("": it takes no
        // repair orders), the seconds of work a unit takes, what it charges a unit (cents), and whether the day's repairs
        // are done before its building work (a small job fitted in) or after it.
        repair_task: "", repair_labour: 0, repair_price: 0, repair_first: true,
      },
      ctx.params,
    );
    need(p, ["supplier"], "firm.builder");
    const book = new Book();
    // The plan of a lot a client asks us to build on, looked up in the register when the job comes in, once.
    const planAsked = new Asked();
    // When we last went to see each cell of ground or building (our own going: what we remember of it is as old as that).
    const wentAt = new Map<string, number>();
    /** Where on a lot our foreman goes to look: the first of its cells we have not seen built on (a lot is one place
     * to go to; a block of many cells is not walked cell by cell). */
    const groundToSee = (lot: string): string | undefined => cellsOf(book, lot).find((c) => builtCell.get(c) !== true);
    const plansToRead = (obs: Observation): LookRequest[] => {
      // (One search of the register is answered to a look, and one going sets out at a time: this is asked again
      // until there is nothing more to ask.)
      let plan: LookRequest | undefined, visit: LookRequest | undefined;
      for (const r of book.ofType("agreement")) {
        if (r.record !== "agreement" || !r.terms.parties.includes(obs.entity) || handled.has(r.id)) continue;
        const job = commitmentOf(r, obs.entity).outcome?.structure;
        const lot = job?.on;
        if (!plan && p.register && lot && !book.records.has(lot) && planAsked.first(lot)) {
          plan = ask.one(p.register.lots, lot);
          plansOut.add(lot);
        }
        // The foreman goes to the lot (or to what is to come down) once the client has signed, before we take the job
        // on: what stands there is seen by going, not known.
        if (visit || !p.sites || !book.signedBy(r.id, r.terms.parties.find((x) => x !== obs.entity) ?? "")) continue;
        const place = job?.remove ?? (lot ? groundToSee(lot) : undefined);
        if (place && planAsked.first(`site:${r.id}:${place}`)) {
          visit = goSee(p.sites, [place]);
          going.set(r.id, [place]);
        }
      }
      return [...(plan ? [plan] : []), ...(visit ? [visit] : [])];
    };
    const staffing = new Staffing(ctx, ctx.entity, { period: p.period, notice_days: p.notice_days, registered_bps: p.registered_bps, casual_bps: p.casual_bps, day_wage: p.day_wage, work_days: p.work_days, week_days: p.look_days, workplace: p.workplace || undefined, role: "construction worker", ...(p.industry ? { industry: p.industry } : {}) });
    // What's recorded against us to pay (rates on our yard, a fine), paid as a firm pays its debts (we don't wind up).
    const dues = new WindingUp(ctx.entity, { short_days: 0, wind_up_days: 0, idle_days: 0, reprice_days: 0, reprice_bps: 0 });
    let lastLetGo = -Infinity;
    const letters = new Letters(builder.answers);
    const deliveries = new Deliveries();
    const handled = new Set<string>(); // contracts taken on
    const going = new Map<string, string[]>(); // contract -> the places its foreman has set out to see
    const plansOut = new Set<string>(); // lots whose plan we have asked the register for, not yet answered
    const noPlan = new Set<string>(); // lots the register has no plan of
    const waiting: { agreement: string; client: string; type?: string; on?: string; remove?: string; price?: string }[] = []; // signed, not yet begun
    const builtCell = new Map<string, boolean>(); // what stands on each cell, as we last saw it
    const finished = new Set<string>(); // buildings our crew has seen finished
    const ourLots = new Set<string>(); // lots with a building job of ours on them, queued or begun
    const projects: { structure: string; task: "build" | "demolish"; left: number; flying?: number }[] = []; // (flying: hours sent to the crew whose work has not taken effect yet, which takes their hours: F1, 2026-10-15)
    const typeOf = new Map<string, string>(); // structure -> its kind of building: what we've built, and what we've seen
    const onOrder = new Map<string, number>(); // kind -> ordered, not yet delivered
    const orderQty = new Map<string, { kind: string; quantity: number }>(); // our order -> what it was for
    const used = new Map<string, number>(); // worker -> seconds worked today
    let usedDay = -1;
    let publishedAt = "";
    // Repairs. Money that has come into our account, by the account it came from; what of it is already spoken for by
    // orders we took on; the orders we have dealt with; and the ones we have taken on and not finished.
    const paidIn = new Map<string, number>();
    const spokenFor = new Map<string, number>();
    const dealtWith = new Set<string>();
    const repairs: { id: string; orderer: string; structure: string; units: number; left: number; at: number; refused: number; flying?: number }[] = [];
    // Hourly pay: the wage over the hours it pays for (working days in the period x the working day).
    let wage: number = p.wage; // (an enterprise agreement raises it)
    const takings = new Takings(); // money paid into our account by others: what a day without our crew costs us (Bargaining)
    const bargaining = new Bargaining(ctx.entity, { takingsPerDay: (t) => takings.perDay(t) });
    const hourly = () => Math.ceil((wage * 3600) / ((p.period / DAY) * (p.work_days / 7) * p.working_day));
    return Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        dues.absorb(obs, ownAccount(obs)?.account);
        letters.take(obs, book);
        const own = p.repair_task ? ownAccount(obs) : undefined;
        if (own) for (const [from, c] of receipts(obs, own.account)) paidIn.set(from, (paidIn.get(from) ?? 0) + c);
        { const acc = ownAccount(obs); if (acc) for (const [, c] of receipts(obs, acc.account)) takings.add(obs.t, c); }
        // (The register's answer comes with the observation after we ask: a lot it has no plan of is not on it.)
        for (const lot of plansOut) if (!book.records.has(lot)) noPlan.add(lot);
        plansOut.clear();
        if (p.sites) {
          const back = visited(obs, p.sites);
          for (const c of back) {
            wentAt.set(c.cell, obs.t);
            if (c.structure) wentAt.set(c.structure.structure, obs.t);
          }
          // (A building we went to see that is not there any more: seen, as gone.)
          if (back.length) for (const places of going.values()) for (const x of places) if (!wentAt.has(x) && !x.startsWith("cell.")) wentAt.set(x, obs.t);
        }
        // What our crew left on the sites it worked on today: theirs to know.
        for (const o of obs.outcomes) for (const st of o.seen ?? []) {
          typeOf.set(st.structure, st.type);
          if (st.complete) finished.add(st.structure);
        }
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
        for (const c of channels.cells(obs)) {
          if (c.structure) typeOf.set(c.structure.structure, c.structure.type);
          builtCell.set(c.cell, !!c.structure);
        }
        // Where on a lot a building goes: a lot of one cell, there; a bigger one (a block of the landscape), the first of
        // its cells we've seen free (the foreman's walk of the ground).
        const siteOn = (lot: string) => {
          const cells = cellsOf(book, lot);
          return cells.length <= 1 ? lot : (cells.find((c) => builtCell.get(c) === false) ?? lot);
        };
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
          if (!book.signedBy(r.id, client) || book.takenBack(r.id)) continue; // (an offer its maker has taken back is not taken on)
          // (Not before our foreman has been to the lot, or to what is to come down, since the contract was made.)
          // (A lot the register has no plan of can't be gone to: the job is taken as it was, and fails where it would have.)
          if (job?.on && !job.remove && p.sites) {
            // (Seen: a cell of the lot gone to since the contract and found free, or every cell of it seen built on.)
            const cells = cellsOf(book, job.on);
            const free = cells.some((c) => builtCell.get(c) === false && (wentAt.get(c) ?? -1) >= r.at);
            const full = cells.length > 0 && cells.every((c) => builtCell.get(c) === true);
            if (cells.length ? !free && !full : !!p.register && !noPlan.has(job.on)) continue;
          }
          going.delete(r.id);
          // (Not before we know our own price for it: we wait for our supplier's prices, as a firm would.)
          const ours = job?.type ? prices[job.type] : undefined;
          if (job?.type && ours === undefined) continue;
          handled.add(r.id);
          // A lot already built on, or with a job of ours on it: declined, saying so (we can't do what we'd sign to).
          const lotCells: string[] = (job?.type && job.on ? (book.records.get(job.on) as any)?.data?.cells : undefined) ?? [];
          if (job?.type && job.on && (ourLots.has(job.on) || (lotCells.length && lotCells.every((c) => builtCell.get(c))))) {
            steps.push(because(`${client} asks us to build a ${job.type} on ${job.on}, which is already built on${ourLots.has(job.on) ? " (our own job there)" : ""}: declining, and saying so.`,
              say("offer_declined", `We can't build a ${job.type} on ${job.on}: it's already built on${ourLots.has(job.on) ? ", with our own job there" : ""}.`, { to: [client], visible: [me, client], basis: r.id, data: { agreement: r.id, reason: "site_taken" } })));
            continue;
          }
          // Offered less than our price: declined, saying what we charge (a firm answers an offer it won't take). A price
          // we've published in the last `quote_valid_days` is honoured: a client who offers at a list we've since raised
          // gets the price it was quoted.
          const type = job?.type;
          const quoted = type ? book.all("price_list").filter((l) => l.speaks_for === me && typeof l.data?.prices?.[type] === "number" && obs.t - l.at <= p.quote_valid_days * DAY).map((l) => l.data!.prices[type] as number) : [];
          if (agreed !== undefined && ours !== undefined && cents(agreed) < Math.min(ours, ...quoted)) {
            steps.push(because(`${client} offers ${usd(cents(agreed))} to build a ${job!.type}; our price is ${usd(ours)}: declining, and saying so.`,
              say("offer_declined", `We can't build a ${job!.type} on ${job!.on} for ${usd(cents(agreed))}: our price is ${usd(ours)}. Offer us a construction agreement at that price and we'll take it on.`, { to: [client], visible: [me, client], basis: r.id, data: { agreement: r.id, price: String(ours) } })));
            continue;
          }
          waiting.push({ agreement: r.id, client, type: job?.type, on: job?.on, remove: job?.remove, price: agreed === undefined ? undefined : amount(cents(agreed)) });
          if (job?.type && job.on) ourLots.add(job.on);
          if (!book.signedBy(r.id, me) && !book.takenBack(r.id)) steps.push(because("A client has signed a construction contract: taking it on.", sign(r.id)));
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
          const invoice = w.price ? [say("invoice", `Invoice: ${moneyNow(w.price)} for ${w.remove ? `demolishing ${w.remove}` : `building a ${w.type} on ${w.on}`}.`, { to: [w.client], basis: w.agreement, data: { outcome: { money: { to: acc.account, amount: w.price, for: w.remove ? `demolishing ${w.remove}` : `building a ${w.type} on ${w.on}` } }, agreement: w.agreement, ...(w.remove ? {} : { type: w.type }) } })] : [];
          if (w.remove) {
            // We need to know what it is (how long it takes to bring down): once we've seen it, we start.
            const type = typeOf.get(w.remove);
            if (!type) continue;
            waiting.splice(waiting.indexOf(w), 1);
            const labour = p.types[type]?.demolition_labour ?? 0;
            const sid = w.remove;
            // Anything of ours being built there stops.
            for (const pr of projects) if (pr.structure === sid && pr.task === "build") pr.left = 0;
            const s = because(`A demolition contract: starting to bring down ${sid}, and invoicing the price.`, C.call("structure", { remove: sid, by: me }), ...invoice,
              ...(p.notify.length ? [say("building_notice", `Notice of building work: ${sid} is being demolished, for ${w.client}.`, { to: p.notify, basis: w.agreement, data: { removes: sid, client: w.client } })] : []));
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
            ["site", C.call("structure", { type: w.type, on: siteOn(w.on), by: me, materials_at: p.yard })], ...invoice);
          const at = siteOn(w.on);
          s.then = (out) => {
            const sid = out.created?.site;
            if (sid) typeOf.set(sid, w.type!);
            if (sid && x.build_labour > 0) projects.push({ structure: sid, task: "build", left: x.build_labour });
            // Notice of the work, as it begins: to the council (whose inspector comes) and whoever else the world says.
            if (sid && p.notify.length) return [because(`Work has begun on a ${w.type} on ${w.on}: giving notice of it.`,
              say("building_notice", `Notice of building work: a ${w.type} (${sid}) begun on ${w.on}, for ${w.client}.`, { to: p.notify, basis: w.agreement, data: { lot: w.on, at: at.startsWith("cell.") ? at : cellsOf(book, w.on!)[0], structure: sid, structure_type: w.type, client: w.client } }))];
          };
          steps.push(s);
        }

        // Repair orders addressed to us: taken on once the money for them has come in from the account the order names
        // (a repair is paid for first); declined, in writing, if it has not come within 14 days, or if there is nothing
        // we can do. Oldest first, so that where one account pays for several, the older is covered first.
        if (p.repair_task) {
          const orders = book.open("repair_order").filter((r) => !dealtWith.has(r.id) && (r.addressed_to ?? []).includes(me)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
          for (const r of orders) {
            const orderer = r.speaks_for ?? "", structure = r.data?.structure, units = r.data?.units, from = r.data?.account;
            const decline = (reason: string, text: string) => {
              dealtWith.add(r.id);
              steps.push(because(`${orderer} ordered a repair of ${structure ?? "something"} and ${reason}: declining, and saying so.`,
                say("repair_declined", text, { to: [orderer], visible: [me, orderer], basis: r.id, data: { order: r.id, ...(typeof structure === "string" ? { structure } : {}), reason } })));
            };
            if (typeof structure !== "string" || !Number.isSafeInteger(units) || units <= 0 || typeof from !== "string") { decline("the order is not one we can read", "We can't take this order: it must name the building, a number of units, and the account it is paid from."); continue; }
            const due = units * p.repair_price;
            if ((paidIn.get(from) ?? 0) - (spokenFor.get(from) ?? 0) >= due) {
              dealtWith.add(r.id);
              spokenFor.set(from, (spokenFor.get(from) ?? 0) + due);
              repairs.push({ id: r.id, orderer, structure, units, left: units, at: r.at, refused: 0 });
            } else if (t - r.at >= 14 * DAY) decline("the money has not come", `We have not taken your repair order for ${structure}: the ${usd(due)} for it has not come into our account in 14 days. Send the order again with the money.`);
          }
        }

        // The day's work: the crew at the yard, on our sites, oldest first, each up to a working day.
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        // Our own crew, there now.
        const ours = new Set(staffing.workers(book, t));
        const here = [...new Set(channels.cells(obs).filter((c) => c.structure?.structure === p.yard).flatMap((c) => c.structure!.spaces.flatMap((sp) => sp.occupants ?? [])))].filter((w) => ours.has(w)).sort();
        // (Those here with the most time between them, the work shared evenly: someone who's done a day's work elsewhere
        // today joins tomorrow.)
        const crew = team(here, (w) => p.working_day - (used.get(w) ?? 0)).who;
        // Repairs, oldest order first, in the crew's hours: as many units as the hours left allow, each order until its units
        // are done, and then the orderer is told. (Our one crew does the repairs and the building: what one takes the other
        // does not have.)
        const repairWork = () => {
          if (!p.repair_task || p.repair_labour <= 0) return;
          for (const r of [...repairs]) {
            if (r.left - (r.flying ?? 0) <= 0) continue;
            const avail = Math.min(...crew.map((w) => p.working_day - (used.get(w) ?? 0)));
            const units = Math.min(r.left - (r.flying ?? 0), Math.floor((Math.max(0, avail) * crew.length) / p.repair_labour));
            if (units <= 0) break;
            const share = Math.ceil((units * p.repair_labour) / crew.length);
            for (const w of crew) used.set(w, (used.get(w) ?? 0) + share);
            r.flying = (r.flying ?? 0) + units;
            const close = (kind: "repair_done" | "repair_declined", why: string, text: string, data: object) => {
              repairs.splice(repairs.indexOf(r), 1);
              return [because(why, say(kind, text, { to: [r.orderer], visible: [me, r.orderer], basis: r.id, data: { order: r.id, structure: r.structure, ...data } }))];
            };
            const s = because(`The day's work: ${crew.length} of our crew repairing ${r.structure} (${units} of the ${r.left} units left).`,
              C.call("work", { task: p.repair_task, units: C.text(String(units)), at: p.yard, by: C.json(crew), on: r.structure }));
            s.then = (out) => {
              r.flying = Math.max(0, (r.flying ?? 0) - units);
              if (out.status === "applied") {
                r.left -= units;
                return r.left <= 0 ? close("repair_done", `The repair of ${r.structure} is done: telling ${r.orderer}.`, `The repair of ${r.structure} is done: ${r.units} units.`, { units: r.units }) : undefined;
              }
              for (const w of crew) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
              const short = outOfTime(out);
              if (short?.who) { used.set(short.who, p.working_day - short.left); for (const w of crew) used.set(w, Math.max(used.get(w) ?? 0, p.working_day - short.left)); } // (the crew shares the work, so the others have no more room than they)
              else if (short) for (const w of crew) used.set(w, p.working_day);
              if (short) return undefined; // (tomorrow)
              // The building is gone; or the work is refused again and again: the order is closed, saying so.
              if (out.refusal?.code === "unknown_structure" || ++r.refused >= 3) return close("repair_declined", `The repair of ${r.structure} cannot be done (${out.refusal?.code ?? "refused"}): telling ${r.orderer}.`, `We cannot repair ${r.structure}: ${out.refusal?.code === "unknown_structure" ? "it is not there" : "the work was refused"}.`, { reason: out.refusal?.code ?? "refused" });
            };
            steps.push(s);
          }
        };
        if (day % 7 < p.work_days && crew.length && p.repair_first) repairWork();
        if (day % 7 < p.work_days && crew.length) {
          for (const pr of [...projects]) {
            // A building finished (its hours done, or seen finished by the crew): nothing more to do there. (One that is
            // gone is learned by the work on it being refused: below.)
            if (pr.left <= 0 || (pr.task === "build" && finished.has(pr.structure))) {
              projects.splice(projects.indexOf(pr), 1);
              continue;
            }
            const avail = Math.min(...crew.map((w) => p.working_day - (used.get(w) ?? 0)));
            if (avail <= 0) break;
            const units = Math.min(pr.left - (pr.flying ?? 0), avail * crew.length);
            if (units <= 0) continue;
            const share = Math.ceil(units / crew.length);
            for (const w of crew) used.set(w, (used.get(w) ?? 0) + share);
            pr.flying = (pr.flying ?? 0) + units;
            const s = because(`The day's work: ${crew.length} of our crew ${pr.task === "build" ? "building" : "demolishing"} ${pr.structure} (${Math.round(units / 3600)} hours of the ${Math.round(pr.left / 3600)} left).`,
              C.call("work", { task: pr.task, units: C.text(String(units)), at: p.yard, by: C.json(crew), on: pr.structure }));
            s.then = (out) => {
              pr.flying = Math.max(0, (pr.flying ?? 0) - units);
              if (out.status === "applied") pr.left -= units;
              else {
                for (const w of crew) used.set(w, Math.max(0, (used.get(w) ?? 0) - share));
                // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
                const short = outOfTime(out);
                if (short?.who) { used.set(short.who, p.working_day - short.left); for (const w of crew) used.set(w, Math.max(used.get(w) ?? 0, p.working_day - short.left)); } // (the crew shares the work, so the others have no more room than they)
                else if (short) for (const w of crew) used.set(w, p.working_day);
                // Not (or no longer) there to work on: the job is over.
                if (["not_being_built", "not_coming_down", "unknown_structure"].includes(out.refusal?.code ?? "")) pr.left = 0;
              }
            };
            steps.push(s);
          }
        }
        if (day % 7 < p.work_days && crew.length && !p.repair_first) repairWork();
        // The crew: enough hands for the work in hand (waiting and begun) within the horizon, within the yard's room.
        const crewNow = staffing.workers(book, t);
        const inHand = projects.reduce((x, pr) => x + Math.max(0, pr.left), 0) + repairs.reduce((x, r) => x + r.left * p.repair_labour, 0) + waiting.reduce((x, w) => x + ((w.remove ? p.types[typeOf.get(w.remove) ?? ""]?.demolition_labour : w.type ? p.types[w.type]?.build_labour : 0) ?? 0), 0);
        const perHand = (p.horizon_days * p.working_day * p.work_days) / 7;
        const want = Math.min(p.max_crew, Math.max(p.min_crew, Math.ceil(inHand / perHand)));
        const bill = Math.floor((crewNow.length * wage * 30 * DAY) / p.period);
        steps.push(...bargaining.steps(book, t, staffing, acc.account, acc.balance, (rise) => { wage = Math.floor((wage * (10_000 + rise)) / 10_000); }));
        steps.push(...staffing.routine(obs, book, acc.account, {
          target: want, wage: wage, canPost: acc.balance >= bill + wage,
          work: inHand > 0, // (hands by the day are paid for the days there is building to do)
          why: `${Math.round(inHand / 3600)} hours of work in hand need ${want} hands to do within ${p.horizon_days} days; we have ${crewNow.length}: posting a job.`,
        }));
        // (Short of the next pay period for those we're keeping: someone already given notice is still crew until it runs
        // out, and counting them let the whole crew go, one after another within the moment.)
        const keeping = staffing.staying(book, t);
        const broke = keeping > 0 && acc.balance < keeping * wage;
        if ((crewNow.length > want && t - lastLetGo >= p.let_go_every_days * DAY) || broke) {
          const s = staffing.letGo(book, t, broke ? `Can't cover the next pay period (${usd(acc.balance)} for ${keeping}): letting the most recent hire go.` : `${Math.round(inHand / 3600)} hours of work in hand need ${want} hands; we have ${crewNow.length}: letting the most recent hire go.`,
            broke ? "Redundancy: we can't cover the wage bill." : "Redundancy: there isn't the work.");
          if (s.length) lastLetGo = t;
          steps.push(...s);
        }
        steps.push(...letters.answer(() => `Our prices for building on your lot, finished, and for demolition: ${priceText() || "none yet (we're waiting on our supplier's prices)"}. To have us build or demolish, offer us a construction agreement: what to build and on which lot (or what to demolish), and the price, paid from your account on our invoice. We start once you've signed and we have the materials; permits are the owner's to get.`,
          "A letter asking about work: answering with our prices and how we take on a job."));
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
      plansToRead,
    ), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};


/**
 * land.registry: the body that keeps the register of land (docs/behaviour/ownership.md, "Who knows what"; after a
 * Torrens registry: title is by registration). The plans of the lots and every title and dealing are its register,
 * and it alone is shown them whole; anyone else asks it about one lot or one title (the kernel answers a search of
 * the register: the registry does no work for one). What it does itself:
 * - a transmission on death: asked by the registrar of deaths, it passes each title the dead person held to the heir
 *   named, as the body that issued the title may;
 * - notices: each time land changes hands it tells the bodies that keep a roll of their own from such notices (the
 *   valuer, the water corporation: `notify`), as whoever acquires land must tell them where the profile is from.
 */
export const landRegistry: BehaviourModule = {
  name: "land.registry",
  answers: {"office": "the land registry", "acts": "What it acts on: a question about one lot or one title, asked of the register; a transfer of a title by its holder; and an application for a dead owner's land to pass.", "report": true},
  keeps: [
    { what: "lot", why: "The land registry makes the register of land: the plan of each lot is part of it." },
    { what: "records:claim", why: "The register of land it keeps: every title is made by being entered in it." },
    { what: "records:claim_transfer", why: "The register of land it keeps: every dealing in a title." },
    { what: "records:claim_release", why: "The register of land it keeps: every title given up." },
    { what: "records:withdrawal", why: "The register of land it keeps: what has been struck from it." },
  ],
  version: "0.1.0",
  doc: "docs/behaviour/ownership.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params({
      // Who is told each time land changes hands (the world gives them; none: nobody is).
      notify: [] as string[],
    }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const letters = new Letters(landRegistry.answers);
    const applied = new Set<string>(); // transmission applications dealt with
    let dealings = 0; // how many transfers of the register we have read
    let passed = 0;
    let told = 0;
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
      },
      (obs) => {
        const steps: Step[] = [];
        const title = (id: string) => { const c = book.records.get(id); return c?.record === "claim" && c.about?.kind === "ownership" && typeof c.about?.object === "string" ? c : undefined; };
        // Land that has changed hands since we last looked: a notice to those who keep a roll from such notices.
        const transfers = book.ofType("claim_transfer");
        for (const r of transfers.slice(dealings)) {
          const c = title(r.claim);
          if (!c || !p.notify.length || ownerOf(book, c.about.object) !== r.to) continue;
          told++;
          steps.push(because(`${c.about.object} has passed to ${r.to}: telling ${p.notify.join(", ")}.`,
            say("acquisition_notice", `Notice of acquisition: ${c.about.object} is now ${r.to}'s.`, { visible: [me, ...p.notify], basis: r.id, data: { lot: c.about.object, owner: r.to, title: c.id } })));
        }
        dealings = transfers.length;
        // A transmission on death: each title the dead person held passes to the heir named.
        for (const a of book.open("transmission_application")) {
          if (applied.has(a.id) || !(a.addressed_to ?? []).includes(me)) continue;
          applied.add(a.id);
          const who = a.data?.deceased, heir = a.data?.heir;
          if (typeof who !== "string" || typeof heir !== "string") continue;
          const held = standingClaims(book.claimsBy("holder", who)).filter((c) => c.about?.kind === "ownership");
          const lots = new Set<string>([...held.map((c) => c.about.object as string), ...book.ofType("claim_transfer").filter((r) => r.to === who).map((r) => title(r.claim)?.about.object as string).filter(Boolean)]);
          for (const lot of [...lots].sort()) {
            if (ownerOf(book, lot) !== who) continue;
            const t = standingClaims(book.claimsBy("object", lot)).find((c) => c.about?.kind === "ownership");
            if (!t) continue;
            passed++;
            steps.push(because(`${who} held ${lot}, and has died: entering its transmission to their heir, ${heir}.`, C.call("claim", { transfer: t.id, to: heir, basis: a.id })));
          }
        }
        steps.push(...letters.answer(() => `Report from the land registry: ${book.open("lot").length} lots on the register; ${passed} titles passed on a death, ${told} notices of acquisition sent. To know who owns a lot, search the register for the lot or the title.`));
        return steps;
      },
    );
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
  answers: {"office": "the registry of births, deaths and marriages", "acts": "What it acts on: a notification of a death or of a birth, which it enters in its register; it sends the entry to whoever reported it and to those the notification names.", "report": true},
  routines: [{ task: "answer", at: "office", every: 1, what: "The office's counter staff enter in the register each notification of a death or of a birth that comes to the office, and those entitled are told, each working day, so that the registrar is not brought back for it.",
    papers: [
      { kind: "death_notification", how: "entered in the register from the notification, and those entitled are told of the entry" },
      { kind: "birth_notification", how: "entered in the register from the notification, and those entitled are told of the entry" },
    ] }],
  issues: P.REGISTRY,
  issuesWith: (p) => ({ feeds: p.feeds ?? [], land_registry: p.land_registry }),
  version: "0.7.0", // 0.7.0: keeps no register of land: it applies to the land registry for a dead owner's titles to pass; 0.6.0: registers births
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        // Who is sent every entry as of right (a support office that pays by age; where a place's law sends its
        // registry's entries): the world gives them.
        feeds: [] as string[],
        // Whom the town writes to when it is left to administer an estate, the death reported by nobody of the family
        // (the banks, the utilities): the world gives them.
        estate_tells: [] as string[],
        // The land registry: where it applies for a dead owner's land to pass to their heir (none: land is left as it is).
        land_registry: "",
        // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
        // "seat" the registrar alone; "staff" the counter staff, who enter notifications under a standing order.
        part: "" as "" | "seat" | "staff", office: "",
        // Whether the town gives the office a counter (its `answer` routine): then its staff enter notifications, only
        // while a standing order for it is in force. Not given: whoever runs the office does, as ever.
        counter: false,
      },
      ctx.params,
    );
    const book = new Book();
    const registered = new Set<string>();
    const read = new Set<string>(); // notifications dealt with
    const born = new Set<string>();
    const letters = new Letters(registry.answers);
    const routines = new StandingWork(ctx.entity, p.part, ctx.position ? new Set([ctx.position.replace(/-staff$/, "")]) : undefined);
    const counter = new CounterWork(routines, !!p.counter);
    return stepper(
      (obs) => {
        book.absorb(obs);
        if (p.part !== "staff") letters.take(obs, book);
      },
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        steps.push(...routines.set(book, counter.order(p.office || ctx.position || "office")));
        for (const r of book.all("death_registration")) registered.add(r.data?.deceased);
        // (At the counter, where the town gives the office one: its staff, under a standing order for it.)
        const counting = counter.works(book, obs.t);
        for (const n of counting ? book.open("death_notification") : []) {
          const who = n.data?.deceased;
          if (!who || read.has(n.id) || !(n.addressed_to ?? []).includes(me)) continue;
          read.add(n.id);
          counter.answered("death_notification");
          // Already registered, and reported again by someone who was not sent the entry (a landlord who has found a
          // tenant the police reported): they are given a certified copy, as a later informant is told it is done.
          if (registered.has(who)) {
            const entry = book.all("death_registration").find((r) => r.data?.deceased === who);
            if (entry && n.speaks_for && n.speaks_for !== me && !(entry.addressed_to ?? []).includes(n.speaks_for)) steps.push(because(`${who}'s death is reported to us again (by ${n.speaks_for}): it is registered already; sending them a certified copy of the entry.`,
              say("death_certificate", `Death of ${who}: registered (entry ${entry.id}).`, { to: [n.speaks_for], basis: entry.id, data: { deceased: who, registration: entry.id } })));
            continue;
          }
          registered.add(who);
          const d = n.data;
          // The entry is the register's, and nobody is shown the register (docs/no-god-view.md). It is sent to whoever
          // reported the death, to those they named as having had dealings with the dead person, to those sent every
          // entry as of right, and, where nobody of the family reported it, to those the town writes to as the
          // estate's administrator (docs/behaviour/deaths.md, "Who is told").
          const family = Array.isArray(d.children);
          const told = [...new Set([n.speaks_for, ...((Array.isArray(d.tell) ? d.tell : []) as unknown[]), ...p.feeds, ...(family ? [] : p.estate_tells)].filter((x): x is string => typeof x === "string" && x !== me))];
          steps.push(because(`A death is reported to us (${who}, by ${n.speaks_for}): registering it, and telling ${told.join(", ") || "nobody else"}.`, say("death_registration", `Death registered: ${who}.`, {
            basis: n.id, to: told, visible: [me, ...told],
            data: { deceased: who, reported_by: n.speaks_for, ...(d.partner ? { partner: d.partner } : {}), children: d.children ?? [], without_adult: d.without_adult ?? [] },
          })));
          // The land the deceased held passes to their heir, as the succession law says (the partner; else the eldest adult
          // child; else the town). The register of land is the land registry's: we apply to it for the transmission, on
          // the registration, and it finds what the dead person held (we are shown no titles).
          const heir = (d.partner as string | undefined) ?? ((d.adult_children ?? []) as string[])[0] ?? me;
          if (p.land_registry) steps.push(because(`${who} has died: applying to the land registry for whatever land they held to pass to their heir, ${heir}, as the law of succession says.`,
            say("transmission_application", `Transmission on death: whatever land ${who} held passes to ${heir}.`, { to: [p.land_registry], basis: n.id, data: { deceased: who, heir } })));
        }
        // A birth reported to us: registered, and the entry sent to whoever reported it and to those sent every entry.
        for (const n of counting ? book.open("birth_notification") : []) {
          const child = n.data?.child;
          if (typeof child !== "string" || born.has(child) || !(n.addressed_to ?? []).includes(me)) continue;
          born.add(child);
          counter.answered("birth_notification");
          const told = [...new Set([n.speaks_for, ...p.feeds].filter((x): x is string => typeof x === "string" && x !== me))];
          steps.push(because(`A birth is reported to us (${child}, by ${n.speaks_for}): registering it.`, say("birth_registration", `Birth registered: ${child}.`, {
            basis: n.id, to: told, visible: [me, ...told], data: { child, born_at: n.data?.born_at, mother: n.data?.mother },
          })));
        }
        if (counting) counter.flush(obs.t);
        if (p.part === "staff" && counter.offered) {
          const report = routines.report(book, obs.t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the registry's counter staff", tasks: { ...counter.tasks } });
          counter.reported(report);
          steps.push(...report);
        }
        if (p.part !== "staff") steps.push(...letters.answer(() => `Report from the registrar: ${born.size ? `${born.size} births and ` : ""}${registered.size} deaths registered${registered.size ? ` (${[...registered].sort().join(", ")})` : ""}.`));
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
  answers: {"office": "the child protection office", "acts": "What it acts on: an entry of a death that leaves children with no adult at home.", "report": true},
  version: "0.3.1",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(_ctx: ParticipantContext) {
    const book = new Book();
    const taken = new Set<string>();
    const letters = new Letters(childProtection.answers);
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
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
