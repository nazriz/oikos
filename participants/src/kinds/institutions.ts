import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


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
  create: inEngine("city.planning_officer"),
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
  create: inEngine("city.inspector"),
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
  create: inEngine("firm.builder"),
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
  create: inEngine("land.registry"),
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
  create: inEngine("city.registry"),
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
  create: inEngine("city.child_protection"),
};
