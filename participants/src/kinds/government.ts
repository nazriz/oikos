import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import { staffingForm } from "../readers/staffing";
import * as P from "../shared/papers";


/**
 * city.mayor_code: a rule-following mayor, for the all-code control condition
 * (a language model runs the office in AI experiments). Proposes a budget each year;
 * when the budget allows, applies for planning permission for a park and,
 * once granted, commissions the builder; approves the invoices it
 * commissioned (the payments procedure needs the mayor's written approval
 * over a set amount); turns a petition into a proposal once its organiser's
 * published count shows enough people have signed, with probability `responsiveness_bps`. A rejected budget is
 * tabled again every 45 days until one is adopted.
 */
export const mayorCode: BehaviourModule = {
  name: "city.mayor_code",
  answers: {"office": "the mayor's office", "acts": "What it acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives no direction by letter.", "forms": [{"about": ["direction", "direct ", "staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "If your letter asks for a direction: this office has given none on the matter, and an office needs none to act within its own powers and its budget line."}]},
  issues: P.MAYOR,
  issuesWith: (p) => ({ electoral: p.electoral }),
  version: "0.12.1", // 0.12.1: its answer to a petition carries what is answered, in the paper's words and data, as the form now does; 0.12.0: tables the next year's budget before the year begins (budget_lead_days), and each paper says its lines as the town writes its money; builds by the budget of the year it is in
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create: inEngine("city.mayor_code"),
};


/**
 * city.council_clerk: runs the council's votes, as the charter says. Puts each
 * proposal to a ballot of the councillors for `vote_days`, counts the votes
 * cast by councillors (checked against the directory), and publishes
 * the result, and, if passed, the law or budget itself, with the ballot as
 * its basis.
 *
 * It is also the council's drafter. A law made from figures has a schedule (a record of the town's: how the law's
 * words, its breakdown and its rule are written from its figures) and a form for amending it, whose fields are the
 * figures. A proposal on such a form that passes is written into law by the schedule, with the figures given and the
 * rest as they stood; the clerk publishes it in place of the law in force, which it withdraws. So an amended law is
 * read by everyone exactly as the law it replaces was. A law proposed in free words stands as its words, and the
 * result says so. The clerk knows no particular law: schedules and forms are the world's content.
 */
export const councilClerk: BehaviourModule = {
  name: "city.council_clerk",
  answers: {"office": "the council clerk's office", "acts": "What it acts on: a proposal put to the council on the council proposal form (council_proposal) or on a law's amendment form, which it puts to a ballot of the councillors; and the votes cast in a councillor's post while a ballot is open.", "forms": [{"about": ["propos", "motion", "amend", "resolution", "put to the council", "put to council"], "say": "What you want the council to decide goes on the council proposal form (council_proposal); a change to a figure in a law in force goes on that law's amendment form."}], "report": true},
  issues: P.COUNCIL_CLERK,
  routines: [{ task: "enact", at: "office", every: 1, what: "When the council has passed a proposal made on a law's amendment form and the clerk has declared the result, the office's drafters write the amended law out by the law's own schedule, with the figures the proposal gives and the rest as they stand, publish it in place of the law in force, and withdraw that one. Declaring a result does not by itself change a law: this does. A law proposed in free words, or a budget, is not theirs: the clerk publishes that." }],
  version: "0.11.1", // 0.11.1: its drafters, with no standing order for enact, say what waits to be written into law; 0.11.0: where a seat holds the office, its drafters are a staff post that writes a passed amendment into the law under the standing order for enact, and the office-holder declares the result without it; 0.10.0: a result names who voted for and against; a vote on a closed ballot, or by someone who is no councillor, is not counted and its caster is told; 0.9.1: amends a law of optional figures (one added, one taken away by nought, a law made from one figure); 0.9.0: a proposal already balloted and a ballot already declared, by the office's own papers, are not put or counted again; a budget is for the year its proposal names
  doc: "docs/behaviour/government.md",
  cadence: () => DAY,
  create: inEngine("city.council_clerk"),
};

/**
 * city.councillor: votes on council ballots by a spatial rule (Downs 1957;
 * Enelow & Hinich 1984): each councillor has an ideal point on a single
 * tenants-versus-development axis, and votes for a proposal when it lies
 * closer to that point than the status quo does, with some noise. Budgets
 * pass on a base propensity. params (the councillor's own traits): leaning (-100 = pro-development ...
 * +100 = pro-tenant), noise_bps, budget_yes_bps.
 */
export const councillor: BehaviourModule = {
  name: "city.councillor",
  answers: {"office": "a councillor", "acts": "A councillor acts by voting on the council's open ballots, and a letter does not change a vote. What you want the council to decide goes to the council clerk on the council proposal form (council_proposal).", "report": true},
  version: "0.6.0", // 0.6.0: moves a motion of their own where given one (`motion`: none by default), on the council proposal form; 0.5.2: leaves alone a ballot that says it is closed
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create: inEngine("city.councillor"),
};

/**
 * city.finance_officer: pays the town's bills as the payments procedure says:
 * within the adopted budget, and over `approval_over` only with the mayor's
 * written approval. Pays by instructing the bank (it is the account's named
 * signatory). Answers letters with its report, including the budget's lines
 * (`budget_lines`: line → what it pays for). params: compliance_bps (how often it follows procedure).
 */
export const financeOfficer: BehaviourModule = {
  name: "city.finance_officer",
  issues: [...P.FINANCE, P.AUDIT_ANSWER],
  answers: {"office": "the finance office", "acts": "What it acts on: an invoice addressed to the town, paid within the adopted budget (over the payments procedure's figure, once the mayor's written approval is on file); a payroll notice from an office that has taken someone on or is losing someone; and the tax withheld from wages, paid over each month. It does not start, stop or change a payment on a letter.", "forms": [{"about": ["approv"], "say": "An approval of an invoice is the mayor's to give, in writing, naming the invoice."}], "report": true},
  version: "0.10.1", // 0.10.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.10.0: 0.10.0: sets a new starter's wage up on the hiring office's payroll notice, from the first pay day it gives (with none after payroll_wait_days, from the agreement on file); asks the mayor, once, for the written approval an invoice over the procedure's figure needs. 0.9.0: pays within the adopted budget of the year it is in; while the year has none, under the budget last adopted at a twelfth a month (the charter's interim rule); spending is reckoned by the year
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create: inEngine("city.finance_officer"),
};

/**
 * city.tax_clerk: administers the tax law. For each tax report, records the
 * tax owed as a claim (the town's right, the reporter's duty) at the law's
 * rate; watches the town's account for payment; after `grace_days` unpaid,
 * records the law's penalty and sends a demand. It can only work from what's
 * reported: under-reporting is invisible to it (audits need records it
 * doesn't have; a later module).
 */
export const taxClerk: BehaviourModule = {
  name: "city.tax_clerk",
  version: "0.4.2",
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create: inEngine("city.tax_clerk"),
};

/**
 * city.rates_officer: administers the rating law (docs/behaviour/public-finance.md). From the latest valuation of each
 * property, it reckons a year's rates at the law's rate on its value, and every instalment period sends each owner a
 * notice for their share, recording it as the town's claim against them (payable into the town's account, by the due
 * date). What's still unpaid after the due date draws the law's penalty interest, monthly, recorded as a claim too,
 * with a letter. A payment settles a claim when it names it.
 */
export const ratesOfficer: BehaviourModule = {
  name: "city.rates_officer",
  answers: {"office": "the rates office", "acts": "What it acts on: the valuer's valuations, on which it levies under the rating law; a payment that names the rates it pays; and a direction on its recovery form (rates_recovery) from those the town's rule on directions names.", "report": true},
  routines: [{ task: "levy", at: "office", follows: ["law", "law-rates"], what: "At each instalment the rating law sets, the rates clerks send every owner on the rate book a notice of their share and record it as owed to the town; each month they add the law's penalty interest to what is overdue and write to the owner. When the notices go out is the law's: the first once the valuer has valued the town's properties and not before the office's first levy day, then one for each instalment the law sets, evenly through the year (two instalments a year are 182 days apart, four are 91). The order says only that they are to be sent." }],
  keeps: [
    { what: "valuation", why: "The rating authority keeps the rate book: the valuer sends it the valuation of every rateable lot, which is what it levies on." },
  ],
  takes: [{ form: "rates_recovery", title: "Recovery direction to the rates officer",
    fields: { interest: { type: "choice", options: ["yes", "no"], required: true, description: "Whether rates left unpaid after their due date are charged the law's penalty interest: yes, as the office does of its own accord; no, none is added." } },
    follows: "While a direction with interest no stands, the rates officer adds no penalty interest to overdue rates and writes to nobody about them. The rates themselves are still levied and still owed, and interest already recorded stays on record." }],
  version: "0.4.3", // 0.4.3: when the last notices went out, and the interest charged on each claim, are read from the office's own file, so a new holder carries on (bug hunt 2026-10-17); 0.4.2: a direction on its recovery form reaches its staff's post; 0.4.1: a payment that names the rates notice pays the claim recorded with it; 0.4.0: its clerks report to the rates officer the notices sent under the standing order and when the next go out; 0.3.0: takes a written direction on penalty interest (docs/behaviour/directions.md)
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  create: inEngine("city.rates_officer"),
};

/**
 * city.works: the town's works office (docs/behaviour/services.md). It hires a works crew to what the adopted budget's
 * staff line pays for (the finance officer runs their payroll), and each working day sets the crew at the depot to
 * the town's services, within their hours: collecting waste from the homes due a collection (a round every
 * `collect_every_days`, and any home complained about first), then maintaining the town's most worn assets. Weekly,
 * it takes what's been collected to the landfill, with a docket. The crew works from the depot on the homes and
 * parks (no travel, D25). What the tasks take (their labour, what a unit changes) is the office's own knowledge of
 * the work, from the world's catalogue.
 */
export const works: BehaviourModule = {
  name: "city.works",
  answers: {"office": "the works office", "acts": "What it acts on: the adopted budget's staff line, which sets its crew; a complaint of a collection missed; and a direction on one of its own forms from those the town's rule on directions names.", "forms": [{"about": ["staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "On staffing it follows a direction on its staffing form (works_staffing) from those the town's rule on directions names, and no letter."}, {"about": ["collect", "round", "waste", "bin", "rubbish"], "say": "On how often it collects it follows a direction on its collection form (works_collection) from those the town's rule on directions names; a collection missed is reported as a complaint."}], "report": true},
  routines: [
    { task: "collect", at: "depot", every: ["collect_every_days", 7], what: "The crew at the depot collects waste from each address on the round as often as the order says, homes complained about first, as far as its hours go, and takes what it has collected to the landfill each week with a docket." },
    { task: "maintain", at: "depot", every: 1, what: "With the hours the round leaves, the crew keeps up the most worn of the town's own assets, and someone is sent to inspect an asset nobody has seen." },
    { task: "answer", at: "depot", every: 1, what: "The office's counter staff sort the day's post that is routine under this procedure and answer it, each working day, so that the works manager is not brought back for it.",
      papers: [{ kind: "complaint", how: "a complaint of a collection missed puts the home first on the next round of collection" }] },
  ],
  issues: [P.JOB_ADVERTISEMENT, ...P.PAYROLL, ...P.WORKS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "works crew", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), landfill: p.landfill, payroll_office: p.payroll_office || undefined, budget_line: p.staff_line ?? "staff" }),
  staffed: (p) => ({ role: p.role ?? "works crew", own: "role_or_unnamed", posts: { budget_line: p.staff_line ?? "staff", wage: p.wage ?? 0, period: p.period ?? 14 * DAY } }),
  keeps: [{ what: "service_address", why: "The round is the works office's own: it makes an entry for each address its crew collects from, and adds to it as homes are built." }],
  takes: [
    staffingForm("works_staffing", "the works office", "works crew"),
    { form: "works_collection", title: "Collection direction to the works office",
      fields: { every: { type: "duration", required: true, description: "How often each address on the round is to be collected from (a week, a fortnight)." } },
      follows: "While it stands, the crew collects from each address on the round once in that time, as its hours allow, homes complained about first. With no direction, the office keeps to its own round." },
  ],
  version: "0.6.2", // 0.6.2: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.6.1: 0.6.1: a direction on its forms reaches its staff's post, and one on how often binds the round whatever the standing order's rhythm; its notice of a new starter names the budget line the post is on; told not to recruit, it says what that does of an offer already made; 0.6.0: its staff report to the office what they did under each standing order, or why not, and who of them worked (docs/behaviour/standing-work.md, "The staff's report"); 0.5.0: sends the office that pays the town's staff a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"); 0.4.0: takes written directions on its staffing and on how often it collects (docs/behaviour/directions.md); 0.3.0: collects from its own round of addresses and keeps up the town's own assets, each seen by the crew that works on it or by going to inspect; no longer shown the town
  doc: "docs/behaviour/services.md",
  cadence: () => DAY,
  firstWake: (ctx) => 7 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("city.works"),
};
