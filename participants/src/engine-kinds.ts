// The kinds the engine runs in Rust (kernel/crates/actors) whose TypeScript actors were deleted at the cut-over
// (docs/decisions.md, 2026-10-19, "The cut-over"): what the generator, the host and the seat-side readers still read of
// each, by its name (what it keeps and issues, its routines, its answers, its cadence and first wake for a mock seat's
// brain), with no actor behind it. A world names the kind and the engine runs it; `create` here only says so. Each
// entry is the deleted module's own, word for word (the generated town is the same to the byte: worlds/test).

import type { BehaviourModule } from "./module";
import { inEngine } from "./in-engine";
import * as P from "./shared/papers";

const DAY = 86_400;

/** bank.payment_system, as the deleted participants/src/behaviour/bank.ts had it. */
export const bankPaymentSystem: BehaviourModule = {
  name: "bank.payment_system",
  keeps: [
    { what: "request", why: "A bank keeps its own customers' instructions: every standing order and payment request it is asked to carry out is addressed to it." },
    { what: "accounts", why: "The ledger is the bank's own book: it keeps its customers' accounts, and pays from them as they instruct." },
  ],
  version: "0.18.0", // 0.17.1: the payer of a standing order into a dead person's account is told at each payment, not once (a letter to an office nobody held was lost, and the wage went on for good: foundations F6); 0.17.0: 0.17.0: each payment carries what its payer said it was for (the line on a statement: docs/behaviour/firms.md, "Wages owed"); 0.16.0: a withdrawal of a standing instruction, of a hold, or an instruction that replaces another, is acted on only from whoever may instruct on the paying account; anyone else is answered and the instruction stands. 0.15.0: its list of a customer's standing instructions says of each who gave it, when, and what it cites. 0.14.0: it keeps a ledger of what it has paid in and out of each account, and a letter is answered with a statement from it (until then, with the payments new at that look: nearly always none)
  doc: "docs/behaviour/bank-payment-system.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("bank.payment_system"),
};

/** firm.producer, as the deleted participants/src/behaviour/producer.ts had it. */
export const producer: BehaviourModule = {
  name: "firm.producer",
  issues: [P.JOB_ADVERTISEMENT, ...P.TRADE, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "factory worker", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }) }),
  version: "0.12.0", // 0.12.0: no dividend while a debt recorded against it stands unpaid, and a winding-up pays wages owed and the tax withheld before anyone else (bug hunt 2026-10-17); 0.11.0: takes up systems the vendor offers for making when the comparison favours it, and plans its people for the rest (docs/behaviour/automation.md); 0.10.0: after a stoppage its offer follows what the stoppage cost it in output sold, not a fixed share of the gap (docs/behaviour/unions.md, "Concession"); 0.9.0: over its stock band, where the world's law lets an employer cut hours, it cuts everyone's hours by a hand's worth before it lets anyone go, and makes in its staff's hours (docs/behaviour/firms.md, "Hours before heads"); 0.8.0: 0.8.0: buys its inputs on the supplier's terms where it states them, and sells to shops on terms of its own where its world gives them (docs/behaviour/trade.md, "Trade credit"); makes and buys to what it can sell, and none while a unit loses money before wages (docs/behaviour/producer.md, "Inputs bought to what can be sold"); borrows again as its bank allows; no dividend while wages are owed or anyone is under notice (docs/behaviour/firms.md, "Before a dividend"); 0.7.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.7.0: 0.7.0: adjusts its staff as firms do (docs/behaviour/firms.md, "Adjusting labour"): demand smoothed over months, people held while it makes less, let go only when the surplus has lasted what ending the job costs, redundancy pay under the world's law, no recruiting after letting someone go for want of money; 0.6.0: everyday frictions (docs/behaviour/frictions.md): pay that comes short, at the world's rate and its character's; asked, told or ordered to put it right; 0.5.0: wants of its own (docs/behaviour/firm-wants.md): a character from its owner's values, which answers a worker who asks for a rise, and a record of its own; 0.4.5: money promised in orders the bank has not yet paid out is not spent again by the next wake (one works placed the same order 40 times in a day); 0.4.4: 0.4.4: takes on the share of its hands the world gives by the day; 0.4.3: registers the share of its jobs the world gives for its kind
  doc: "docs/behaviour/producer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create: inEngine("firm.producer"),
};

/** firm.retailer, as the deleted participants/src/behaviour/retailer.ts had it. */
export const retailer: BehaviourModule = {
  name: "firm.retailer",
  issues: [P.JOB_ADVERTISEMENT, ...P.TRADE, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "shop assistant", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), police: p.police }),
  version: "0.20.0", // 0.20.0: a business of one that turns custom away weighs shop premises to let, takes one on a lease (deposit, rent, term) and employs there (docs/behaviour/leasing.md); 0.19.0: a business of one pays its running costs (the profile's registration, licence and the like) at each of its owner's draws, before anything is the owner's (docs/behaviour/entry.md, "What a business costs"); a job posting says how many hands it is for (openings); 0.18.0: no dividend while a debt recorded against it stands unpaid, and a winding-up pays wages owed and the tax withheld before anyone else (bug hunt 2026-10-17); 0.17.0: takes up systems the vendor offers for serving when the comparison favours it, serves part of each order by them, refunds what they get wrong (docs/behaviour/automation.md); a day's serving not got to by the next morning waits, it is not done at night; 0.16.0: after a stoppage its offer follows what the stoppage cost it in sales, not a fixed share of the gap (docs/behaviour/unions.md, "Concession"); 0.15.0: where the world's law lets an employer cut hours, a surplus of hands is met first by cutting everyone's hours to what the trade needs, by a paper to each worker, and a shop serves in its staff's hours (docs/behaviour/firms.md, "Hours before heads"); 0.14.0: reviews its staff and closes its month on a day of its own, not on one every shop shares, and expects at first the trade it was staffed for, not its first month's sales alone (docs/behaviour/firms.md, "When a shop reviews its staff"); 0.13.0: buys its stock on the supplier's terms where it states them (docs/behaviour/trade.md, "Trade credit"), so stock no longer competes with the wage bill in the week it is bought; borrows again as its bank allows; no dividend while wages are owed or anyone is under notice (docs/behaviour/firms.md, "Before a dividend"); 0.12.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.12.0: 0.12.0: adjusts its staff as firms do (docs/behaviour/firms.md, "Adjusting labour"): sales smoothed over months, staff held through a dip and let go only when the surplus has lasted what ending the job costs, redundancy pay under the world's law; a business of one can be founded in a run and is closed when its owner gives it up (docs/behaviour/entry.md); 0.11.0: everyday frictions (docs/behaviour/frictions.md): pay that comes short, at the world's rate and its character's; asked, told or ordered to put right short pay or goods said to be faulty; 0.10.0: wants of its own (docs/behaviour/firm-wants.md): a character from its owner's values, which answers a worker who asks for a rise, and a record of its own; 0.9.1: a business of one buys stock when it runs low (daily), keeps its stock money at today's price, follows its owner's home, and closes when its owner has gone; 0.9.0: a business run by its owner alone (operator), stocked for a few days and drawn on by its owner; 0.8.4: takes on the share of its hands the world gives by the day; 0.8.3: registers the share of its jobs the world gives for shops (firms.md, "Jobs an employer does not register")
  doc: "docs/behaviour/retailer.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create: inEngine("firm.retailer"),
};

/** firm.newspaper, as the deleted participants/src/behaviour/news.ts had it. */
export const newspaper: BehaviourModule = {
  name: "firm.newspaper",
  answers: {"office": "the paper's editor", "acts": "The paper reports the public record. It prints no letters."},
  issues: P.EDITOR,
  issuesWith: (p) => ({ town: p.town }),
  version: "0.2.0",
  doc: "docs/behaviour/news.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("firm.newspaper"),
};

/** fund.retirement, as the deleted participants/src/behaviour/fund.ts had it. */
export const retirementFund: BehaviourModule = {
  name: "fund.retirement",
  answers: {"office": "the retirement fund", "acts": "What it acts on: its members' accounts and the pensions it pays from them, as its rules say."},
  version: "0.1.0",
  doc: "docs/behaviour/firm-ownership.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("fund.retirement"),
};

/** group.founded, as the deleted participants/src/behaviour/founded.ts had it. */
export const founded: BehaviourModule = {
  name: "group.founded",
  version: "0.2.1", // 0.2.1: the gathering's request names the cell the founder's home stands on (`place_on`), so that a translator can write the notice's on=; 0.2.0: a fund states its rule with its offer of membership (who may draw, how much, how often), in words and figures, and says it again when it refuses; 0.1.0: what a founder's post does for a group, a fund or a body that takes grievances up (docs/behaviour/founding.md)
  doc: "docs/behaviour/founding.md",
  cadence: (ctx) => (ctx.params.shape === "cause" ? DAY : 7 * DAY),
  firstWake: () => 0,
  create: inEngine("group.founded"),
};

/** body.payroll, as the deleted participants/src/behaviour/payroll.ts had it. */
export const bodyPayroll: BehaviourModule = {
  name: "body.payroll",
  answers: { office: "the payroll office", acts: "What it acts on: the employment agreements of its organisation's staff and the standing payments that pay them; the tax withheld from wages, paid over on the law's days; and a member of staff who has died." },
  version: "0.5.0", // 0.5.0: an owner's appointer: where none of a firm's staff is left, its owner fills a vacant post themselves, wherever they live; 0.4.1: an appointer looks at each post it has not seen vacant once in six rounds, on a round of the post's own (from its name), not by a turn kept in the holder's memory, so a vacancy is found on the same round whatever else is watched (bug hunt 2026-10-17); 0.4.0: an appointer that finds none of the staff to second hires for the body; 0.3.0: an appointer (the authority a body's constitution names fills a post that has stood vacant); 0.2.0: deaf to news, on a round of its own
  deaf: true,
  doc: "docs/behaviour/staffing.md",
  cadence: () => 3 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(3) * DAY,
  create: inEngine("body.payroll"),
};

/** city.electoral_office, as the deleted participants/src/behaviour/elections.ts had it. */
export const electoralOffice: BehaviourModule = {
  name: "city.electoral_office",
  answers: {"office": "the electoral office", "acts": "What it acts on: a nomination for an office it has given notice of an election for, lodged before nominations close; and a vote cast on its ballot while the poll is open."},
  issues: P.ELECTORAL,
  keeps: [
    { what: "enrolment", why: "The electoral office keeps the roll: every elector's enrolment is lodged with it." },
    { what: "electoral_roll", why: "The roll it publishes at each election is its own." },
  ],
  version: "0.7.0", // 0.7.0: where the election stands is read from the office's own file (a successor carries on; results carry their poll day), and a refused notice, ballot or result is tried again; 0.6.0: a vote cast after the poll closed is answered (not counted, as before); 0.5.0: declares a result without seating the winner where the office is another body's (`seats`)
  doc: "docs/behaviour/elections.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("city.electoral_office"),
};

/** utility.water, as the deleted participants/src/behaviour/utilities.ts had it. */
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
  create: inEngine("utility.water"),
};

/** utility.energy, as the deleted participants/src/behaviour/utilities.ts had it. */
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
  create: inEngine("utility.energy"),
};

/** world.export_demand, as the deleted participants/src/behaviour/world.ts had it. */
export const exportDemand: BehaviourModule = {
  name: "world.export_demand",
  version: "0.2.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.export_demand"),
};

/** world.trade, as the deleted participants/src/behaviour/world.ts had it. */
export const trade: BehaviourModule = {
  name: "world.trade",
  answers: {"office": "the world market's office", "acts": "What it acts on: an order for what it lists, at its published prices: a paper on the buyer's own order form, addressed to it, with the whole sum paid into the account its price list names. It delivers when an order is paid in full, sends back money that comes with no order waiting for it, and declines an order unpaid after a week."},
  boundary: [
    { what: "future", why: "A researcher's scripted shocks to world prices and demand are a scenario's boundary condition: this module is the world market and applies each from its day, publishing nothing of one before it comes." },
    { what: "every:factory", why: "The outside world's demand for the town's goods is a boundary condition, split when the world is made among the factories that export." },
  ],
  version: "0.4.0", // 0.3.0: sells to a factory on terms (pay within some days of delivery) where its world gives them, stops supplying one that has not paid, and records the debt against it later (docs/behaviour/trade.md, "Trade credit"); 0.2.1: a month's world price is drawn for the good and the month from the seed, never for the hour this office wakes in (a town and its twin see the same prices);
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.trade"),
};

/** world.transfers, as the deleted participants/src/behaviour/world.ts had it. */
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
  issues: [...P.SUPPORT, P.REMEDY_ANSWER, ...P.VENUE_ANSWERS, P.AUDIT_ANSWER],
  version: "0.11.0", // 0.11.0: where the world names who does its casework (`casework`: the officers' desk, law 10), every act that is only casework papers names it (`done_by`), and the decision takes an officer's minutes in the officers' hours; the office-holder's own decisions stay theirs; 0.10.0: a claim waits for what the law says it needs (papers from the claimant, a confirmation from the last employer, within so many days: foundations F8), is looked at again when asked inside the law's days (a review, recorded), and a refusal found wrong is put right by the office or on a venue's setting it aside; the staff refuse nothing only where the law says the head alone does; 0.9.0: the wrong refusals are a slip at the rate of the world's table of slips (foundations F7), not a parameter; 0.8.0: no processing time, daily capacity or doubled errors under backlog: it decides every claim it has, and how many is the hours of whoever decides (foundations F6); 0.7.0: a claim made before the year began and still waiting (an opening caseload) is decided when its processing time from that day has run; a claim refused before it is decided; a refusal asked about that the paper says could not be verified is found wrong on review; 0.6.0: payments in force before the year (grants brought forward on paper) are taken up when the file is first opened and paid from the day each names; 0.5.0: run in parts where a model holds the office (part): the staff decide and pay what the law's conditions settle under a standing order (pay_claims) and put a refusal or a doubt before the office-holder, who decides it on the office's decision form and answers reviews; a town run by code is unchanged; 0.4.0: a claim may wait to be decided (processing_days), the staff decide so many a day (capacity_per_day), and some qualifying claims are wrongly refused, more while a backlog stands (error_bps, at the friction dial); asked to review a refusal found wrong, the office decides the next claim on its facts
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.transfers"),
};

/** world.funding, as the deleted participants/src/behaviour/world.ts had it. */
export const funding: BehaviourModule = {
  name: "world.funding",
  answers: {"office": "the wholesale funding desk", "acts": "What it acts on: a bank's draw on its funding, and the bank's repayments."},
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.funding"),
};

/** world.weather, as the deleted participants/src/behaviour/world.ts had it. */
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
  create: inEngine("world.weather"),
};

/** world.statistics, as the deleted participants/src/behaviour/world.ts had it. */
export const statistics: BehaviourModule = {
  name: "world.statistics",
  answers: {"office": "the statistician's office", "acts": "It publishes its figures as it makes them. It takes no requests."},
  version: "0.2.0", // 0.2.0: the population estimate
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.statistics"),
};

/** world.tax_collector: the tax collector, keeping each taxpayer's account (docs/behaviour/public-finance.md, "The taxpayer's account"; risk PB-23). Engine-only from the start. */
export const taxCollector: BehaviourModule = {
  name: "world.tax_collector",
  answers: {"office": "the tax collector", "acts": "What it acts on: a taxpayer's claim to have a credit on its account repaid or set against its next return, made on the claim form; a taxpayer's request for a statement of its own account; and a request to look at one of its decisions again. A letter changes nothing on an account."},
  issues: P.TAX_COLLECTOR,
  version: "0.1.0",
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.tax_collector"),
};

/** world.valuer, as the deleted participants/src/behaviour/world.ts had it. */
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
  create: inEngine("world.valuer"),
};

/** world.grants, as the deleted participants/src/behaviour/world.ts had it. */
export const grants: BehaviourModule = {
  name: "world.grants",
  answers: {"office": "the grants office", "acts": "It pays by its determination, which is on file with whoever it pays: so much a year for each resident, by the published estimate of the population. A letter changes nothing in a determination."},
  version: "0.3.0", // 0.3.0: pays by the published population estimate; no longer shown the town's homes
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  firstWake: () => 3 * 3600,
  create: inEngine("world.grants"),
};

/** world.disposal, as the deleted participants/src/behaviour/world.ts had it. */
export const disposal: BehaviourModule = {
  name: "world.disposal",
  answers: {"office": "the landfill's office", "acts": "What it acts on: a docket for what is brought to it, invoiced every month at the charge it has notified."},
  version: "0.1.0",
  doc: "docs/behaviour/services.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.disposal"),
};

/** idle, as the deleted participants/src/behaviour/world.ts had it. */
export const idle: BehaviourModule = {
  name: "idle",
  version: "0.1.0",
  doc: "docs/behaviour/README.md",
  cadence: () => 30 * DAY,
  create: inEngine("idle"),
};

/** world.migration, as the deleted participants/src/behaviour/world.ts had it. */
export const migration: BehaviourModule = {
  name: "world.migration",
  version: "0.6.2", // 0.6.2: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.0: says how many came (the statistician counts them); 0.6.1: counts every payment for those out of work
  doc: "docs/behaviour/boundary.md",
  cadence: () => 30 * DAY,
  firstWake: () => 30 * DAY,
  create: inEngine("world.migration"),
};
