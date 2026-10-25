// The papers offices issue, as forms of their own stationery (docs/behaviour/office-papers.md; contracts: FormWrites;
// forms.ts). Each is the typed statement a code module makes already, set out as a form: its fields, and how they are
// written into the statement the rest of the world reads. A module lists the ones its office issues (`issues`), and
// says what of the office's own they carry (`issuesWith`: each "@name"). Where a model holds the office the world
// publishes them for it, and a paper filled in on its form is the paper the module would have made, to the letter.
//
// Nothing here is read by a code office: it goes on making its papers as it did.

import type { FormField, Issued } from "../module";
import { KIND } from "./decisions";

const f = (type: string, description: string, o: { required?: boolean; options?: string[] } = {}): FormField => ({ type, ...(o.required ? { required: true } : {}), ...(o.options ? { options: o.options } : {}), description });
const req = { required: true };
const YES_NO = ["yes", "no"];

// ------------------------------------------------------------------ any employer

/** A job advertisement, as any employer here places one (firms.ts, `Staffing`). */
export const JOB_ADVERTISEMENT: Issued = {
  form: "job_advertisement", title: "Job advertisement",
  does: "How the office takes on staff of its own: it puts the posts on the jobs board at the wage given, for people to apply, and the office then offers employment to those it takes on. It commits no money until someone is taken on.",
  fields: {
    wage: f("amount", "The wage for each pay period.", req),
    period: f("duration", "The pay period: how often the wage is paid.", req),
    posts: f("count", "How many posts this advertisement is for.", req),
    account: f("account", "The account the wages are paid from, where the office itself pays them."),
  },
  writes: {
    kind: "job_posting", text: "Hiring: {wage} every {period}.",
    data: { wage: "#wage", period: "=period", openings: "=posts", role: "@role", industry: "@industry", workplace: "@workplace_structure", space: "@workplace" },
    offer: { by: "=self", to: { min_age_years: 18 }, take_up: "apply", available: "=posts", terms: { template: "employment",
      commitments: [{ who: "=self", does: { outcome: { money: { from: "=account", amount: "=wage", for: "wages" } } }, every: "=period" }, "@occupancy"], termination: "@termination" } },
  },
};

/**
 * Payroll notices: what an office that takes staff on sends the office that pays them, where they are two offices of
 * one organisation (a town's works manager and its finance officer; firms.ts, `Staffing`): a new starter, with what
 * the payroll needs to set the wage up, and a leaver, with the last day. The paper is the organisation's own and is
 * marked with the payroll office (`data.office`); the hiring office's words say who it is for.
 */
export const PAYROLL: Issued[] = [
  { form: "payroll_starter", title: "Payroll notice of a new starter, to the office that pays the organisation's staff", does: "Tells the office that pays the organisation's staff that someone has been taken on, with what it needs to set their wage up. It pays nobody by itself: the paying office sets the payment up. Write to that office too, naming the notice: a paper on the organisation's own file is not put in front of it.",
    fields: {
      employee: f("entity", "Who has been taken on.", req), post: f("text", "The post they hold.", req), agreement: f("record", "The employment agreement, signed by both.", req),
      wage: f("amount", "The wage for each pay period, before tax.", req), period: f("duration", "The pay period.", req),
      first_pay: f("date", "The first pay day (a pay period after both signed, unless the agreement says otherwise).", req), account: f("account", "The account the wage is paid into.", req),
    },
    writes: { kind: "payroll_notice", text: "Payroll notice, new starter: {employee}, {post}, under employment agreement {agreement}. Pay: {wage} every {period} before tax, into {account}; first pay day {first_pay}, then every {period}. The post is one of those the {@budget_line} line of the adopted budget pays for: the wage is on that line. For the {@payroll_office} office: the wage payment is to be set up from that day.",
      basis: "=agreement", to: ["=self"], visible: ["=self"],
      data: { notice: "starter", office: "@payroll_office", employee: "=employee", post: "=post", agreement: "=agreement", wage: "=wage", period: "=period", first_pay: "=first_pay", account: "=account", line: "@budget_line" } } },
  { form: "payroll_leaver", title: "Payroll notice of a leaver, to the office that pays the organisation's staff", does: "Tells the office that pays the organisation's staff that someone's employment is ending and when, so that their wage payment ends then. It ends no employment and stops no payment by itself. Write to that office too, naming the notice.",
    fields: {
      employee: f("entity", "Who is leaving.", req), post: f("text", "The post they held.", req), agreement: f("record", "The employment agreement that is ending.", req),
      last_day: f("date", "The last day of the employment.", req), reason: f("choice", "Why it ends.", { ...req, options: ["notice", "died"] }),
    },
    writes: { kind: "payroll_notice", text: "Payroll notice, leaver: {employee}, {post}, employment agreement {agreement} ends on {last_day} ({reason}). For the {@payroll_office} office: pay is due to that day, and the wage payment under the agreement is to end then.",
      basis: "=agreement", to: ["=self"], visible: ["=self"],
      data: { notice: "leaver", office: "@payroll_office", employee: "=employee", post: "=post", agreement: "=agreement", last_day: "=last_day", reason: "=reason" } } },
];

/** What a job advertisement carries of the employer's own: the post, the trade, where the work is, and the notice. */
export function staffingOwn(o: { role?: string; industry?: string; workplace?: string; notice_days?: number }): { [name: string]: unknown } {
  const notice = Number.isInteger(o.notice_days) && o.notice_days! > 0 ? o.notice_days! * 86_400 : 0;
  return {
    role: o.role, industry: o.industry || undefined, workplace: o.workplace || undefined, workplace_structure: o.workplace ? o.workplace.split("/")[0] : undefined,
    occupancy: o.workplace ? { who: "taker", does: { outcome: { occupancy: { in: o.workplace } } } } : undefined,
    termination: notice ? [{ party: "=self", notice }, { party: "taker", notice }] : undefined,
  };
}

// ------------------------------------------------------------------ the registrar of births and deaths

// ------------------------------------------------------------------ answering (frictions.ts, `Respondent`)

/** The answer to a request to put something right, as any organisation asked gives one (frictions.ts, `Respondent`). */
export const REMEDY_ANSWER: Issued = {
  form: "remedy_answer", title: "Answer to a request to put something right",
  does: "Answers someone who has asked the office in writing to put something right: yes or no, and where money is owed them and paid, how much. It does nothing by itself: what puts the thing right (a payment, a repair ordered, a paper withdrawn) is done besides.",
  fields: { request: f("record", "The request answered.", req), asker: f("entity", "Who asked.", req), matter: f("text", "What it is about, in the word the request uses.", req), granted: f("choice", "Whether it will be put right.", { ...req, options: YES_NO }),
    amount: f("amount", "Where money is owed them and paid: how much."), reason: f("text", "Where it is refused: why.") },
  writes: { kind: "remedy_answer", text: "Answer to your request {request}: {granted}.", basis: "=request", to: ["=asker"], visible: ["=asker", "=self"], data: { request: "=request", matter: "=matter", granted: "?granted", amount: "#amount", reason: "=reason" } } };

/** The answer to a body that hears grievances, told of an application against the office (frictions.ts, `Respondent`). */
const venueAnswer = (form: string, kind: string, title: string): Issued => ({
  form, title,
  does: "Answers a body that has told the office of an application against it, from the office's own books: what they show is owed, whether the thing is done, whether the paper complained of was wrong. The body decides on it when the time to answer has run; with no answer it decides in default.",
  fields: { application: f("record", "The application answered.", req), venue: f("entity", "The body that sent the notice.", req), applicant: f("entity", "Who applied."),
    known: f("choice", "Whether the office's books say anything of it.", { ...req, options: YES_NO }), owed: f("amount", "What the books show is owed the applicant (nought: nothing)."),
    done: f("choice", "For a thing to be put right: whether it is done.", { options: YES_NO }), wrong: f("choice", "For a paper complained of: whether it was wrong.", { options: YES_NO }),
    statement: f("text", "What the office says in answer, in its own words, where these do not say it (what it disputes, and why).") },
  writes: { kind, text: "Answer on {application}.", basis: "=application", to: ["=venue"], visible: ["=venue", "=self", "=applicant"], data: { application: "=application", owed: "#owed", done: "?done", wrong: "?wrong", known: "?known", statement: "=statement" } } });
export const VENUE_ANSWERS: Issued[] = [
  venueAnswer("complaint_answer", "complaint_response", "Answer to a desk's notice of an application against the office"),
  venueAnswer("tribunal_answer", "tribunal_response", "Answer to the tribunal's notice of an application against the office"),
];

export const REGISTRY: Issued[] = [
  { form: "death_registration", title: "Entry in the register of deaths", does: "Registers a death on the notification of it: the entry is what a bank, the land registry and the family act on, and it is sent to whoever reported the death.",
    fields: {
      deceased: f("entity", "Who has died.", req),
      notification: f("record", "The notification of the death that the entry is made on.", req),
      reported_by: f("entity", "Who reported the death: they are sent the entry.", req),
      partner: f("entity", "The dead person's partner, if the notification names one."),
      children: f("list", "The dead person's children, as the notification names them."),
      without_adult: f("list", "Children left with no adult at home, as the notification names them."),
      tell: f("list", "Those the notification asks to be told, who are sent the entry too."),
      estate: f("list", "Those written to where nobody of the family reported the death and the estate is to be administered."),
    },
    writes: { sends: [{ to: ["@feeds"], why: "They are sent every entry in the register of deaths as of right, to keep their own records by: whoever keeps a roll of electors takes the dead off it, and whoever pays someone a pension or support stops paying it." }], kind: "death_registration", text: "Death registered: {deceased}.", basis: "=notification",
      to: ["=reported_by", "=tell", "@feeds", "=estate"], visible: ["=self", "=reported_by", "=tell", "@feeds", "=estate"],
      data: { deceased: "=deceased", reported_by: "=reported_by", partner: "=partner", children: "=children", without_adult: "=without_adult" } } },
  { form: "death_certificate", title: "Certified copy of an entry of death", does: "Gives whoever asks a certified copy of a death already registered.",
    fields: { deceased: f("entity", "Who has died.", req), registration: f("record", "The entry in the register.", req), informant: f("entity", "Whom the copy is for.", req) },
    writes: { kind: "death_certificate", text: "Death of {deceased}: registered (entry {registration}).", basis: "=registration", to: ["=informant"], data: { deceased: "=deceased", registration: "=registration" } } },
  { form: "birth_registration", title: "Entry in the register of births", does: "Registers a birth on the notification of it, and sends the entry to whoever reported it.",
    fields: { child: f("entity", "The child.", req), notification: f("record", "The notification of the birth.", req), reported_by: f("entity", "Who reported the birth: they are sent the entry.", req),
      born_at: f("date", "When the child was born, as the notification gives it."), mother: f("entity", "The child's mother.") },
    writes: { sends: [{ to: ["@feeds"], why: "They are sent every entry in the register of births as of right, to keep their own records by." }], kind: "birth_registration", text: "Birth registered: {child}.", basis: "=notification", to: ["=reported_by", "@feeds"], visible: ["=self", "=reported_by", "@feeds"], data: { child: "=child", born_at: "=born_at", mother: "=mother" } } },
  { form: "transmission_application", title: "Application to the land registry for a dead owner's land to pass", does: "Asks the land registry to pass a dead owner's land to the heir the law of succession names.",
    fields: { deceased: f("entity", "The owner who has died.", req), heir: f("entity", "Whom the land passes to, as the law of succession says.", req), notification: f("record", "The notification of the death.", req) },
    writes: { sends: [{ to: ["@land_registry"], why: "The land registry keeps the titles to land: passing a dead owner's land is its to do." }], kind: "transmission_application", text: "Transmission on death: whatever land {deceased} held passes to {heir}.", basis: "=notification", to: ["@land_registry"], data: { deceased: "=deceased", heir: "=heir" } } },
];

// ------------------------------------------------------------------ the town's offices

export const MAYOR: Issued[] = [
  { form: "invoice_approval", title: "The mayor's written approval of an invoice",
    fields: { invoice: f("record", "The invoice approved for payment.", req) },
    writes: { kind: "approval", text: "Approved for payment: {invoice}.", basis: "=invoice", to: ["=self"], data: { invoice: "=invoice" } } },
  { form: "nomination", title: "Nomination for an office at an election",
    fields: { office: f("entity", "The office stood for (the post, by its id).", req), name: f("text", "The name to go on the ballot.", req), platform: f("text", "What the candidate puts to the electors.", req),
      incumbent: f("choice", "Whether the candidate holds the office now.", { options: YES_NO }), values: f("list", "What the candidate stands for, in a word or two each.") },
    writes: { sends: [{ to: ["@electoral"], why: "The body that runs the election takes the nominations and puts the names on the ballot paper." }], kind: "nomination", text: "Nomination for {office}: {name}. {platform}", to: ["@electoral"], visible: "public", assertion: { that: "=platform" }, data: { office: "=office", name: "=name", incumbent: "?incumbent", values: "=values" } } },
  { form: "petition_response", title: "Answer to a petition", does: "Answers a petition publicly, to its organiser: what has been done about what it asks (put to the council, or not, and why). The answer is written in full on the form (`answer`): what has been done about what the petition asks, or why not, in the mayor's own words; it is the paper's text. It puts nothing to the council by itself: that is the council proposal form, or a law's amendment form.",
    fields: { petition: f("record", "The petition answered.", req), organiser: f("entity", "Its organiser."),
      answer: f("text", "What is answered, in full: what has been done about what the petition asks, or why not.", req) },
    writes: { kind: "petition_response", text: "Answer to petition {petition}: {answer}", basis: "=petition", to: ["=organiser"], visible: "public", data: { petition: "=petition", answer: "=answer" } } },
];

export const COUNCIL_CLERK: Issued[] = [
  { form: "council_ballot", title: "A ballot of the council on a proposal", does: "Puts a proposal to the vote of the councillors, each in their own post, for as long as it says. The latest vote of each post cast while it is open is the one that counts.",
    fields: { proposal: f("record", "The proposal put to the vote.", req), open_for: f("duration", "How long the ballot stays open.", req), tags: f("list", "What the proposal is about, a word each (budget, tenant_protection, development).") },
    writes: { kind: "ballot", text: "Ballot of the council on {proposal}, open for {open_for}.", basis: "=proposal", data: { proposal: "=proposal", options: ["yes", "no"], closes_at: "+open_for", electorate: "council", tags: "=tags" } } },
  { form: "council_result", title: "The result of a ballot of the council", does: "Declares how a ballot went, from the count of every vote on file, naming who voted which way. Declaring a result does not by itself change a law: a passed proposal made on a law's amendment form is written into that law by the office's drafters, under its standing work order for enact; a law proposed in words, or a budget, the clerk publishes.",
    fields: { ballot: f("record", "The ballot counted.", req), yes: f("count", "Votes for.", req), no: f("count", "Votes against.", req), passed: f("choice", "Whether it passed.", { ...req, options: YES_NO }),
      voted_for: f("list", "The councillors' posts that voted for (a council's votes are public record)."), voted_against: f("list", "The councillors' posts that voted against.") },
    writes: { kind: "ballot_result", text: "Result of {ballot}: {yes} for, {no} against.", basis: "=ballot", data: { ballot: "=ballot", yes: "=yes", no: "=no", passed: "?passed", voted_for: "=voted_for", voted_against: "=voted_against" } } },
  // (Its lines, one amount each, are the town's own budget lines: the world adds them when it publishes the form.)
  { form: "adopted_budget", title: "The budget as the council adopted it",
    fields: { year: f("count", "The year the budget is for.", req), ballot: f("record", "The ballot that adopted it.", req) },
    writes: { kind: "budget", text: "The town's budget for year {year}.", basis: "=ballot", data: { year: "=year", lines: {} } } },
];

export const PLANNING: Issued[] = [
  // (A decision to grant records the permission with it: the applicant's liberty to build that kind of building on
  // that lot, which is what the building inspector reads. Until 2026-10-11 the form wrote the decision alone, and a
  // seat's permit granted nothing: a park granted on it was fined and ordered down the same day.)
  { form: "permit_decision", title: "Decision on a planning permit application", does: "Decides a permit application (granted, refused, or sent back as incomplete) and tells the applicant. A decision to grant records the permission with it: the applicant's liberty to build that kind of building on that lot, which the building inspector reads. So a grant says the lot and the kind of building, as the application gives them.",
    fields: { application: f("record", "The application decided.", req), applicant: f("entity", "Who applied: the decision is sent to them.", req),
      decision: f("choice", "Granted, refused, or sent back as incomplete.", { ...req, options: ["granted", "refused", "incomplete"] }),
      lot: f("lot", "For a grant: the lot the permission is for, as the application names it."), structure_type: f("structure_type", "For a grant: the kind of building permitted, as the application names it."),
      law: f("record", "The law the building would breach, if any."), missing: f("list", "For an incomplete application: what it does not say (lot, structure_type)."),
      reason: f("text", "Why it is decided so, in words, where the law named does not say it (a refusal, or what to send in).") },
    writes: { kind: "permit_decision", text: "Permit {decision}: application {application}.", basis: "=application", to: ["=applicant"], data: { application: "=application", decision: "=decision", law: "=law", missing: "=missing", reason: "=reason" },
      claim: { when: { decision: "granted" }, position: "liberty", holder: "=applicant", about: { action: "build", object: "=lot", structure_type: "=structure_type" }, basis: "=application" } } },
];

export const INSPECTOR: Issued[] = [
  { form: "valuation_request", title: "Request to the valuer for a supplementary valuation", does: "Asks the valuer to value a lot again after building work, so that its rates follow what now stands on it.",
    fields: { notice: f("record", "The notice of building work it follows from.", req), lot: f("lot", "The lot."), structure: f("structure", "What was built."), structure_type: f("structure_type", "The kind of building."), removed: f("structure", "What was demolished.") },
    writes: { sends: [{ to: ["@valuer"], why: "The valuer values the town's lots: the request is the valuer's to act on." }], kind: "valuation_request", text: "Supplementary valuation asked for, on notice {notice}.", basis: "=notice", to: ["@valuer"], data: { lot: "=lot", structure: "=structure", structure_type: "=structure_type", removed: "=removed" } } },
  { form: "demolition_order", title: "Order to demolish a building", does: "Orders an owner to take down a building put up in breach of a law.",
    fields: { owner: f("entity", "The owner ordered to demolish it.", req), structure: f("structure", "The building.", req), law: f("record", "The law it was built in breach of.", req), lot: f("lot", "The lot it stands on.") },
    writes: { kind: "demolition_order", text: "Order: demolish {structure}, built in breach of {law}.", basis: "=law", to: ["=owner"], data: { structure: "=structure", lot: "=lot", law: "=law" } } },
];

export const WORKS: Issued[] = [
  { form: "disposal_docket", title: "Docket for waste delivered to the landfill", does: "Goes with a load of waste taken to the landfill: what was delivered and how much, which the landfill charges by.",
    fields: { kind: f("text", "What was delivered.", req), quantity: f("count", "How much of it.", req) },
    writes: { sends: [{ to: ["@landfill"], why: "The landfill takes the load and charges by the docket." }], kind: "disposal_docket", text: "Delivered: {quantity} of {kind}.", to: ["@landfill"], visible: ["=self", "@landfill"], data: { kind: "=kind", quantity: "=quantity" } } },
];

export const ENVIRONMENT: Issued[] = [
  { form: "habitat_register", title: "Register of the lots where a listed species was found", does: "Publishes the lots where a survey found a listed species: the planning office refuses permits on them.",
    fields: { round: f("count", "The survey round it is from.", req), lots: f("list", "The lots.", req) },
    writes: { sends: [{ to: ["@planning"], why: "The planning office decides permits, and refuses them on the lots the register lists." }], kind: "habitat_register", text: "Habitat register, round {round}: {lots}.", to: ["@planning"], visible: "public", data: { round: "=round", lots: "=lots" } } },
];

export const ELECTORAL: Issued[] = [
  { form: "election_notice", title: "Notice of an election",
    fields: { office: f("entity", "The office to be filled (the post, by its id).", req), poll_at: f("date", "Polling day.", req), nominations_close_at: f("date", "When nominations close.", req),
      method: f("choice", "How the votes are counted.", { ...req, options: ["preferential", "plurality"] }) },
    writes: { kind: "election_notice", text: "Election for {office}: nominations close {nominations_close_at}; polling {poll_at}.", visible: "public", data: { office: "=office", poll_at: "=poll_at", nominations_close_at: "=nominations_close_at", method: "=method" } } },
];

// ------------------------------------------------------------------ finance

/** The return of tax withheld from wages, in totals (tax.ts writes it with a line for each charge besides: a table, which no form of fields holds). */
export const FINANCE: Issued[] = [
  { form: "withholding_return", title: "Return of tax withheld from wages, to a collector", does: "Reports to a collector what has been withheld from the wages paid in a period and what is paid over with it. It moves no money: what is paid over is paid besides, by a payment to each collector's account. The office's books count what is withheld and not yet paid over from the day of the last return. The law on tax from pay lists its returns and the day each falls due by; one return reports the charges the law names for it, and the books say which return falls due next.",
    fields: { collector: f("entity", "The collector reported to.", req), account: f("account", "The account the wages were paid from.", req), period_end: f("date", "The day the period ended.", req), withheld: f("amount", "What was withheld in the period, in all.", req), paid: f("amount", "What is paid over now, in all.", req), law: f("record", "The law it is withheld under: the tax law that lists the return (it names the charges each return reports; report them in that return, not in another).") },
    writes: { kind: "withholding_report", text: "Withheld from wages, owed: {withheld}; paid now: {paid}.", basis: "=law", to: ["=collector"], visible: ["=self", "=collector"], data: { account: "=account", paid: "#paid", period_end: "=period_end", withheld: "#withheld" } } },
];

// ------------------------------------------------------------------ the tribunal

export const TRIBUNAL_MEMBER: Issued[] = [
  { form: "hearing_listing", title: "Notice of hearing: a rent increase, a debt or a charge", does: "Lists an application about a notice of rent increase, a debt or a charge for a hearing on a day, and tells both sides; the respondent may answer before then. It decides nothing. (An application on the tribunal's other lists is listed on the notice of hearing form.)",
    fields: { application: f("record", "The application listed.", req), kind: f("choice", "What the application is.", { ...req, options: ["rent_increase", "debt", "charge"] }), applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it is against.", req), hearing: f("date", "The day of the hearing.", req) },
    writes: { kind: "hearing_notice", text: "Notice of hearing: application {application} ({kind}) by {applicant} against {against}, to be heard on {hearing}. The respondent may answer before then.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=kind", applicant: "=applicant", against: "=against", hearing_at: "=hearing" } } },
  { form: "hearing_notice", title: "Notice of hearing on the tribunal's lists", does: "Lists an application on the tribunal's lists (possession of a let home, rent in arrears, a home in disrepair, pay come short, faulty goods, a wrong bill, a refused claim) and tells both sides: what is said, and the day the other side may answer by. The other side answers a notice on this form, and no letter. It decides nothing. A case already listed is put off (adjourned) by a fresh notice with a later day.",
    fields: { application: f("record", "The application listed.", req), matter: f("text", "What it is about, in the word the application uses (possession, arrears, disrepair ...).", req), applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it is against.", req),
      answer_by: f("date", "The day the other side may answer by: the case is decided on or after it.", req), about: f("record", "The lease or other paper the application is about, where it names one (a tenant answers a notice about possession only if it names the lease)."),
      amount: f("amount", "The sum the application says is owed, where it gives one."), structure: f("structure", "The building, where the application names one."), seeks: f("text", "What the application seeks, where it says.") },
    writes: { kind: "hearing_notice", text: "{applicant} has applied to us about {matter} (application {application}). You may answer by {answer_by}.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=matter", matter: "=matter", applicant: "=applicant", against: "=against", hearing_at: "=answer_by", answer_by: "=answer_by", about: "=about", amount: "#amount", structure: "=structure", seeks: "=seeks" } } },
  { form: "possession_order", title: "Order on an application for possession of a let home", does: "Decides an application for possession of a let home for rent owed, and tells landlord and tenant: dismissed (the tenant stays, and the notice to vacate is spent); a plan (the tenant stays, paying the rent and a sum a month toward what is owed; a plan not kept, the landlord may apply again); or possession on a day (the tenant and household are to leave by it). It moves nobody: a tenant still there after the day is put out only on a warrant the landlord asks the tribunal's registrar for, by whoever carries its warrants out. What the law asks before an order, how long a plan may run and how many days on the day for possession falls are in the law on possession and the tribunal's procedure.",
    fields: { application: f("record", "The application decided.", req), landlord: f("entity", "The landlord who applied.", req), tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req),
      finding: f("choice", "What is ordered.", { ...req, options: ["dismissed", "plan", "possession"] }), owed: f("amount", "The rent found owed (a plan, or possession)."),
      instalment: f("amount", "For a plan: the sum a month toward what is owed, beyond the rent."), pay_into: f("account", "For a plan: the account it is paid into."), date: f("date", "For possession: the day the tenant is to leave by."),
      home: f("space", "The home, as the application names it (needed for a warrant to be issued on the order)."), building: f("structure", "The building it is in."), household: f("list", "Who lives there by the lease, as the application names them."),
      waited_days: f("count", "Days from the application to this order, for the tribunal's own figures."),
      reason: f("text", "The tribunal's reasons for the order, in words.") },
    writes: { kind: "tribunal_order", text: "Order on {application}: {finding}.", basis: "=application", to: ["=landlord", "=tenant"], visible: ["=landlord", "=tenant", "=self"],
      data: { application: "=application", kind: "possession", matter: "possession", applicant: "=landlord", against: "=tenant", finding: "=finding", binding: true, waited_days: "=waited_days", about: "=lease", amount: "#owed", instalment: "#instalment", to: "=pay_into", due: "=date", space: "=home", structure: "=building", household: "=household", reason: "=reason" } } },
  { form: "tribunal_order", title: "Order of the tribunal on an application", does: "Decides an application before the tribunal (anything but possession of a let home, which has its own form) and tells both sides: what is found, and for an order to pay, how much, into which account and by when; for a thing to be put right, by when. It moves no money and does nothing by itself: an order to pay left unpaid is enforced by the registrar, when the one owed asks.",
    fields: {
      application: f("record", "The application decided.", req), kind: f("text", "What the application was, in the word it uses (rent_increase, debt, charge; or the matter on the tribunal's lists: arrears, disrepair, bill ...).", req),
      applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it was against."),
      finding: f("choice", "What is found: dismissed; rejected (not something the tribunal hears); pay (money to the applicant); do (put it right); set_aside (a paper); for a rent increase, invalid or valid; for a debt already paid, paid.", { ...req, options: ["dismissed", "rejected", "pay", "do", "set_aside", "invalid", "valid", "paid"] }),
      matter: f("text", "For a case on the tribunal's lists: the matter, in the same word as the application's (those ordered act on an order only with it)."), binding: f("choice", "For a case on the tribunal's lists: yes (an order of the tribunal binds).", { options: YES_NO }),
      notice: f("record", "For a rent increase: the notice challenged."), laws: f("list", "The laws the notice breaches, where it is found invalid."),
      claim: f("record", "For a debt: the claim."), amount: f("amount", "For an order to pay: how much."), pay_into: f("account", "For an order to pay: the account it is paid into."),
      due: f("date", "For an order to pay or to put right: the day it is due by."), victim: f("entity", "For a charge: who was wronged."), report: f("record", "For a charge: the report it came from."), paid: f("amount", "For a debt found paid: how much was paid."),
      about: f("record", "The paper the application is about, where it names one."), structure: f("structure", "The building, where the application names one."), seeks: f("text", "What the application sought, where it said."),
      waited_days: f("count", "Days from the application to this order, for the tribunal's own figures."),
      reason: f("text", "The tribunal's reasons for what it found, in words."),
    },
    writes: { kind: "tribunal_order", text: "Order on {application}: {finding}.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=kind", matter: "=matter", applicant: "=applicant", against: "=against", finding: "=finding", binding: "?binding", waited_days: "=waited_days", about: "=about", structure: "=structure", seeks: "=seeks",
        notice: "=notice", laws: "=laws", claim: "=claim", amount: "#amount", to: "=pay_into", due: "=due", victim: "=victim", report: "=report", paid: "#paid", reason: "=reason" } } },
];

export const TRIBUNAL_REGISTRAR: Issued[] = [
  { form: "garnishee_order", title: "Order to a debtor's bank to pay an unpaid order of the tribunal", does: "Has the banks pay an order of the tribunal left unpaid, from what the debtor holds with them.",
    fields: { order: f("record", "The tribunal's order left unpaid.", req), debtor: f("entity", "Who owes.", req), creditor: f("entity", "Who is owed.", req), amount: f("amount", "How much.", req), pay_into: f("account", "The account it is to be paid into.", req), claim: f("record", "The claim it settles, if the order names one.") },
    writes: { sends: [{ to: ["@banks"], why: "The banks hold what the debtor has: the order is theirs to pay." }], kind: "garnishee_order", text: "Order to pay {amount} from what {debtor} holds, into {pay_into}, under {order}.", basis: "=order", to: ["@banks"], visible: ["@banks", "=self", "=debtor", "=creditor"],
      data: { order: "=order", debtor: "=debtor", amount: "#amount", to: "=pay_into", claim: "=claim" } } },
  { form: "warrant", title: "Warrant of possession", does: "Issued on a landlord's request, on an order of the tribunal for possession whose day has passed with the tenant still there: it names the home, the tenant and the household, and the days between which it is to be carried out. It goes to whoever carries the tribunal's warrants out, and the tenant and the landlord see it. It moves nobody by itself: someone must go, and a warrant not carried out by its last day lapses. How much notice of the day the tenant must have, and how long a warrant runs, are in the law on possession.",
    fields: { order: f("record", "The tribunal's order for possession.", req), lease: f("record", "The lease.", req), tenant: f("entity", "The tenant.", req), landlord: f("entity", "The landlord.", req),
      home: f("space", "The home.", req), building: f("structure", "The building it is in."), household: f("list", "Who is to be removed: the tenant and those living there by the lease.", req),
      not_before: f("date", "The first day it may be carried out (after the notice of the day the law gives the tenant).", req), until: f("date", "Its last day: after it, it has lapsed.", req) },
    writes: { sends: [{ to: ["@enforcer"], why: "They carry the tribunal's warrants out: nobody else may." }], kind: "warrant", text: "Warrant of possession under order {order}: {tenant} and their household are to be removed from {home}, and possession given to {landlord}. To be carried out no sooner than {not_before} and by {until}.", basis: "=order", to: ["@enforcer"], visible: ["@enforcer", "=self", "=tenant", "=landlord"],
      data: { order: "=order", lease: "=lease", tenant: "=tenant", landlord: "=landlord", space: "=home", structure: "=building", household: "=household", not_before: "=not_before", until: "=until" } } },
  { form: "enforcement_decline", title: "A request to enforce, declined", does: "Tells whoever asked for an order to be enforced, or for a warrant, that it is declined: there is no such order to them to enforce. It does nothing else.",
    fields: { request: f("record", "The request declined.", req), asker: f("entity", "Who asked.", req) },
    writes: { kind: "enforcement_decline", text: "Declined: no such order to you to enforce (request {request}).", basis: "=request", to: ["=asker"], visible: ["=asker", "=self"] } },
];

// ------------------------------------------------------------------ landlords

export const LANDLORD: Issued[] = [
  { form: "rental_listing", title: "A home advertised to let",
    fields: { structure: f("structure", "The building.", req), space: f("space", "The home in it.", req), type: f("structure_type", "The kind of building.", req), rent: f("amount", "The rent a month.", req),
      account: f("account", "The account the rent is paid into.", req), bedrooms: f("count", "How many bedrooms."), then: f("choice", "What follows the lease's term: periodic, if it continues until ended by notice.", { options: ["periodic"] }) },
    writes: { kind: "rental_listing", text: "To let: {space}, {rent} a month.", data: { structure: "=structure", space: "=space", type: "=type", bedrooms: "=bedrooms", rent: "#rent" },
      offer: { by: "=self", take_up: "apply", available: 1, terms: { template: "lease", then: "=then", commitments: [{ who: "=self", does: { outcome: { occupancy: { in: "=space" } } } }, { who: "taker", does: { outcome: { money: { to: "=account", amount: "=rent", for: "rent" } } }, every: 2_592_000 }] } } } },
  { form: "rent_increase", title: "Notice of a rent increase",
    fields: { lease: f("record", "The lease.", req), tenant: f("entity", "The tenant.", req), rent: f("amount", "The new rent a month.", req), was: f("amount", "The rent now.", req),
      from: f("date", "The day the new rent starts.", req), last_from: f("date", "The day the rent now paid started.", req) },
    writes: { kind: "rent_increase", text: "Notice of rent increase: {rent} a month from {from} (now {was}).", basis: "=lease", to: ["=tenant"], visible: ["=self", "=tenant"], data: { lease: "=lease", rent: "#rent", from: "=from", was: "#was", last_from: "=last_from" } } },
  { form: "tax_report", title: "Return of rent received, to the town",
    fields: { rent_received: f("amount", "The rent received in the period.", req), account: f("account", "The account it was received into.", req), period_end: f("date", "The day the period ended.", req) },
    writes: { sends: [{ to: ["@city"], why: "The return is made to the town, which the rent is reported to." }], kind: "tax_report", text: "Rent received this month: {rent_received}.", to: ["@city"], data: { period_end: "=period_end", rent_received: "#rent_received", account: "=account" } } },
  { form: "death_notification", title: "Notification of a death, to the registrar",
    fields: { deceased: f("entity", "Who has died.", req) },
    writes: { sends: [{ to: ["@city"], why: "The town's registrar registers deaths, on a notification." }], kind: "death_notification", text: "Notification of a death: {deceased}.", to: ["@city"], data: { deceased: "=deceased" } } },
  { form: "rent_reminder", title: "Request to a tenant for rent owed", does: "Asks a tenant in writing for rent that is owed, with the sum and the account. It ends nothing and moves no money.",
    fields: { tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req), amount: f("amount", "How much is owed.", req), account: f("account", "The account it is to be paid into.") },
    writes: { kind: KIND.request, text: "Request: the rent for your home is {amount} in arrears. Please pay it.", basis: "=lease", to: ["=tenant"], visible: ["=self", "=tenant"], data: { matter: "arrears", against: "=tenant", about: "=lease", amount: "#amount", account: "=account" } } },
  { form: "payment_plan_offer", title: "Offer to a tenant of a plan to pay rent owed", does: "Offers a tenant behind with the rent a plan: the rent as it falls due, and a sum a month toward what is owed. The tenant answers on the offer whether the household can pay it, and what it could pay. It ends nothing and binds nobody: a plan agreed is kept, or not, by the tenant's payments.",
    fields: { tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req), owed: f("amount", "How much is owed.", req), instalment: f("amount", "The sum a month toward what is owed, beyond the rent.", req), account: f("account", "The account it is to be paid into.") },
    writes: { kind: "plan_offer", text: "Offer of a plan: pay the rent as it falls due and {instalment} a month toward the {owed} owed under {lease}. Please answer whether you can.", basis: "=lease", to: ["=tenant"], visible: ["=self", "=tenant"], data: { lease: "=lease", owed: "#owed", instalment: "#instalment", account: "=account" } } },
  { form: "arrears_application", title: "Application for an order that a tenant pay rent owed", does: "Applies to a body that says it hears rent in arrears (its notice of what it hears, and what applying costs, is public) for an order that the tenant pay. The body tells the tenant, gives them time to answer and decides. A fee, where the body has one, is paid with it, by a payment. It ends no tenancy.",
    fields: { venue: f("entity", "The body applied to.", req), hearing: f("record", "Its notice of what it hears."), tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req), amount: f("amount", "How much is owed.", req), account: f("account", "The account it is to be paid into.", req) },
    writes: { kind: "tribunal_application", text: "Application: {tenant} owes us {amount} in rent under {lease}.", basis: "=hearing", to: ["=venue"], visible: ["=self", "=venue", "=tenant"],
      data: { kind: "arrears", matter: "arrears", against: "=tenant", about: "=lease", amount: "#amount", account: "=account", evidence: { id: "=lease", record: "agreement" } } } },
  { form: "notice_to_vacate", title: "Notice to a tenant to vacate for rent owed", does: "Gives a tenant written notice to leave the home by a day, for rent owed. It ends nothing by itself and puts nobody out: if the rent owed is paid before the day the notice is spent (withdraw it); if the tenant is still there after the day, the landlord may apply to the tribunal for possession. How long rent must have been owed before it may be given, and how many days it must run, are in the law on possession. A notice is given when it is on the record, addressed to the tenant: that is how papers are served here.",
    fields: { tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req), arrears: f("amount", "The rent owed.", req), by: f("date", "The day the tenant is to leave by.", req), law: f("record", "The law the notice is given under.") },
    writes: { kind: "notice_to_vacate", text: "Notice to vacate: the rent under {lease} is {arrears} in arrears. You are to leave the home by {by}. If the arrears are paid before then, this notice lapses. If you are still there after it, we may apply to the tribunal for possession.", basis: "=lease", to: ["=tenant"], visible: ["=self", "=tenant"],
      data: { lease: "=lease", reason: "arrears", arrears: "#arrears", by: "=by", law: "=law" } } },
  { form: "possession_application", title: "Application to the tribunal for possession of a let home", does: "Applies to the tribunal for possession of a home whose tenant is behind with the rent and has not left on a notice to vacate that has run out. It states the lease, the rent, what is owed, the home and who lives there by the lease, and the notice relied on: which paper, the day it was given and the day it gave. The tribunal tells the tenant, who may answer, and decides: a plan to pay, possession on a day, or dismissal. The tribunal's fee, where it has one, is paid with it, by a payment. It ends no tenancy and puts nobody out.",
    fields: { tenant: f("entity", "The tenant.", req), lease: f("record", "The lease.", req), owed: f("amount", "The rent owed.", req), rent: f("amount", "The rent a month."), account: f("account", "The account rent is paid into."),
      home: f("space", "The home."), building: f("structure", "The building it is in."), household: f("list", "Who lives there by the lease: the tenant first."),
      notice: f("record", "The notice to vacate relied on."), notice_given: f("date", "The day that notice was given."), notice_by: f("date", "The day that notice gave to leave by."),
      plan_broken: f("choice", "Yes, where the tribunal set a plan to pay and it has not been kept.", { options: YES_NO }) },
    writes: { sends: [{ to: ["@tribunal"], why: "The tribunal hears applications for possession." }], kind: "tribunal_application", text: "Application for possession: {tenant} is {owed} behind with the rent under {lease} and has not left on our notice to vacate.", basis: "=lease", to: ["@tribunal"], visible: ["=self", "@tribunal", "=tenant"],
      data: { kind: "possession", matter: "possession", against: "=tenant", about: "=lease", amount: "#owed", rent: "#rent", account: "=account", breach: "?plan_broken", space: "=home", structure: "=building", household: "=household",
        notice: "=notice", notice_given: "=notice_given", notice_by: "=notice_by", evidence: { id: "=lease", record: "agreement" } } } },
  { form: "possession_reply", title: "Reply to a tenant's answer to an application for possession", does: "Replies to what a tenant has answered the tribunal on an application of this office's for possession: what the rent book shows owed on the day of the reply, and whether a plan the tenant offers would be taken. It goes to the tribunal, for the member who decides, and to the tenant. It withdraws nothing and decides nothing.",
    fields: { application: f("record", "The application for possession.", req), tenant: f("entity", "The tenant.", req), owed: f("amount", "What the rent book shows owed on the day of this reply.", req),
      takes_plan: f("choice", "Whether the plan the tenant offers would be taken.", { options: YES_NO }), words: f("text", "Anything else for the tribunal, in words.") },
    writes: { sends: [{ to: ["@tribunal"], why: "The tribunal's member decides the application, on what both sides have said." }], kind: "tribunal_reply", text: "Reply on application {application}: our rent book shows {owed} owed by {tenant} today.", basis: "=application", to: ["@tribunal", "=tenant"], visible: ["=self", "@tribunal", "=tenant"],
      data: { application: "=application", against: "=tenant", owed: "#owed", takes_plan: "?takes_plan", words: "=words" } } },
  { form: "warrant_request", title: "Request to the tribunal's registrar for a warrant of possession", does: "Asks the tribunal's registrar for a warrant on an order for possession whose day has passed with the tenant still there. The registrar issues it to whoever carries the tribunal's warrants out; the landlord puts nobody out. The fee, where there is one, is paid with it, by a payment. A warrant not carried out by its last day lapses, and another is asked for.",
    fields: { order: f("record", "The tribunal's order for possession.", req) },
    writes: { sends: [{ to: ["@tribunal"], why: "The tribunal's registrar issues its warrants." }], kind: "warrant_request", text: "Request for a warrant of possession under order {order}: the tenant has not left.", basis: "=order", to: ["@tribunal"], visible: ["=self", "@tribunal"], data: { order: "=order" } } },
  { form: "repair_order", title: "Order to the builder for a repair, paid with the order", does: "Orders the repair of a building of the landlord's from the builder, who does it when its price has come into the builder's account: the price is paid with the order, by a payment. The builder says when it is done, or that it cannot be.",
    fields: { building: f("structure", "The building to repair.", req), units: f("count", "How many units of repair work.", req), account: f("account", "The account the price is paid from.", req) },
    writes: { sends: [{ to: ["@builder"], why: "The builder does the repair." }], kind: "repair_order", text: "Order: the repair of {building} ({units} units of work), paid with this order.", to: ["@builder"], visible: ["=self", "@builder"], data: { structure: "=building", units: "=units", account: "=account" } } },
  { form: "variation_answer", title: "Answer to a tenant's request to vary a tenancy", does: "Answers a tenant who has asked in writing to vary something of the tenancy (to stay on, for time): yes or no. It changes no lease by itself: what is agreed is then done (a new lease offered, a notice withdrawn).",
    fields: { request: f("record", "The request answered.", req), tenant: f("entity", "The tenant.", req), about: f("text", "What was asked, as the request names it.", req), granted: f("choice", "Whether it is agreed.", { ...req, options: YES_NO }),
      reason: f("text", "What else is said to the tenant: on what terms it is agreed, or why not.") },
    writes: { kind: "variation_answer", text: "Answer to your request {request}: {granted}.", basis: "=request", to: ["=tenant"], visible: ["=self", "=tenant"], data: { about: "=about", granted: "?granted", reason: "=reason" } } },
  REMEDY_ANSWER, ...VENUE_ANSWERS,
];

// ------------------------------------------------------------------ the lender

export const LENDING: Issued[] = [
  { form: "loan_decision", title: "Decision on a loan application",
    fields: { application: f("record", "The application decided.", req), applicant: f("entity", "Who applied.", req), approved: f("choice", "Whether it is approved.", { ...req, options: YES_NO }), reason: f("text", "Why not, where it is declined."),
      amount: f("amount", "Where approved: how much is lent."), months: f("count", "Where approved: over how many months."), rate_bps: f("count", "Where approved: the yearly rate, in hundredths of a percent."), payment: f("amount", "Where approved: the monthly repayment.") },
    writes: { kind: "loan_decision", text: "Loan application {application}: approved {approved}.", basis: "=application", to: ["=applicant"], visible: ["=applicant", "=self"],
      data: { application: "=application", approved: "?approved", reason: "=reason", amount: "#amount", months: "=months", rate_bps: "=rate_bps", payment: "#payment" } } },
  { form: "loan_payout", title: "Advice that a loan has been paid out",
    fields: { loan: f("record", "The loan agreement.", req), borrower: f("entity", "The borrower.", req), request: f("record", "The request for the payout.", req), amount: f("amount", "How much was paid out.", req), account: f("account", "The account it was paid into.", req) },
    writes: { kind: "loan_payout", text: "Loan {loan}: {amount} paid out into {account}.", basis: "=request", to: ["=borrower"], visible: ["=borrower", "=self"], data: { loan: "=loan", amount: "#amount", account: "=account" } } },
  { form: "funding_draw", title: "A draw on the bank's wholesale funding",
    fields: { amount: f("amount", "How much is drawn.", req), account: f("account", "The account it is to be paid into.", req), rate_bps: f("count", "The yearly rate, in hundredths of a percent.", req) },
    writes: { sends: [{ to: ["@funder"], why: "The funder is who the draw is made on: it pays it." }], kind: "funding_draw", text: "Funding drawn: {amount} into {account}.", to: ["@funder"], visible: ["=self", "@funder"], data: { amount: "#amount", account: "=account", rate_bps: "=rate_bps" } } },
  { form: "loan_arrears", title: "Letter to a borrower behind with a loan", does: "Tells a borrower in writing that a loan is behind, and by how much. It changes nothing of the loan.",
    fields: { loan: f("record", "The loan agreement.", req), borrower: f("entity", "The borrower.", req), behind: f("amount", "How much is behind.", req) },
    writes: { kind: "loan_arrears", text: "Loan {loan}: {behind} behind. Please pay.", basis: "=loan", to: ["=borrower"], visible: ["=borrower", "=self"], data: { loan: "=loan", behind: "#behind" } } },
  { form: "loan_default", title: "Notice to a borrower that a loan is in default", does: "Tells a borrower in writing that a loan is in default: how much is behind and how much is owing in all. It moves nothing by itself.",
    fields: { loan: f("record", "The loan agreement.", req), borrower: f("entity", "The borrower.", req), behind: f("amount", "How much is behind.", req), outstanding: f("amount", "How much is owing in all.", req) },
    writes: { kind: "loan_default", text: "Loan {loan} is in default: {behind} behind, {outstanding} owing.", basis: "=loan", to: ["=borrower"], visible: ["=borrower", "=self"], data: { loan: "=loan", behind: "#behind", outstanding: "#outstanding" } } },
];

// ------------------------------------------------------------------ the police

export const POLICE: Issued[] = [
  { form: "charge", title: "A charge laid before the tribunal", does: "Lays a charge before the tribunal against someone, on a report of a crime and the evidence found.",
    fields: { against: f("entity", "Who is charged.", req), victim: f("entity", "Who was wronged.", req), report: f("record", "The report it comes from.", req), amount: f("amount", "The value of what was taken.", req), account: f("account", "The account the victim is to be paid into.", req),
      found: f("entity", "The evidence: who was found with the goods."), found_at: f("structure", "The evidence: where."), goods: f("text", "The evidence: what goods.") },
    writes: { sends: [{ to: ["@tribunal"], why: "The tribunal hears the charge." }], kind: "tribunal_application", text: "Charge against {against}, on report {report}.", basis: "=report", to: ["@tribunal"], visible: ["=self", "@tribunal", "=against"],
      data: { kind: "charge", against: "=against", victim: "=victim", report: "=report", amount: "#amount", account: "=account", evidence: { found: "=found", at: "=found_at", goods: "=goods" } } } },
  { form: "death_notification", title: "Notification of a death, to the registrar", does: "Tells the registrar of a death the police have found, so that it can be registered.",
    fields: { deceased: f("entity", "Who has died.", req), found_at: f("space", "Where they were found.") },
    writes: { sends: [{ to: ["@registry"], why: "The registrar registers deaths, on a notification." }], kind: "death_notification", text: "Notification of a death: {deceased}.", to: ["@registry"], data: { deceased: "=deceased", found_at: "=found_at" } } },
  { form: "warrant_executed", title: "A warrant of possession carried out", does: "Says, to the tenant and the landlord, that a warrant of the tribunal has been carried out and possession is the landlord's, and how many of the household were there and were put out (none, where nobody was there: possession is given all the same, and nobody was removed). It is the paper of what officers have done at the home, not the doing of it.",
    fields: { warrant: f("record", "The warrant.", req), lease: f("record", "The lease.", req), tenant: f("entity", "The tenant.", req), landlord: f("entity", "The landlord.", req), home: f("space", "The home.", req), household: f("list", "The household the warrant names.", req),
      removed: f("count", "How many of the household were there and were put out (nobody there: 0).", req) },
    writes: { kind: "warrant_executed", text: "Warrant {warrant} has been carried out at {home}: of {tenant} and their household, {removed} were there and were put out. Possession is {landlord}'s.", basis: "=warrant", to: ["=tenant", "=landlord"], visible: ["=self", "=tenant", "=landlord", "=household"],
      data: { warrant: "=warrant", lease: "=lease", tenant: "=tenant", space: "=home", household: "=household", removed: "=removed" } } },
  { form: "warrant_lapsed", title: "A warrant of possession not carried out in its time", does: "Tells the landlord that a warrant ran out before an officer could carry it out, and has lapsed: the landlord may ask the tribunal's registrar for another.",
    fields: { warrant: f("record", "The warrant.", req), lease: f("record", "The lease.", req), landlord: f("entity", "The landlord.", req) },
    writes: { kind: "warrant_lapsed", text: "Warrant {warrant} was not carried out by its last day, and has lapsed.", basis: "=warrant", to: ["=landlord"], visible: ["=self", "=landlord"], data: { warrant: "=warrant", lease: "=lease" } } },
  { form: "investigation_closed", title: "An investigation closed", does: "Tells whoever reported a crime that its investigation is closed, and whether it was solved.",
    fields: { report: f("record", "The report.", req), reporter: f("entity", "Who reported it.", req), solved: f("choice", "Whether it was solved.", { ...req, options: YES_NO }) },
    writes: { kind: "investigation_closed", text: "Report {report}: closed; solved {solved}.", basis: "=report", to: ["=reporter"], visible: ["=self", "=reporter"], data: { report: "=report", solved: "?solved" } } },
];

// ------------------------------------------------------------------ the union

const members = f("list", "The members it concerns.", req);
export const UNION: Issued[] = [
  { form: "wage_claim", title: "A wage claim on an employer",
    fields: { employer: f("entity", "The employer.", req), rise_bps: f("count", "The rise claimed, in hundredths of a percent.", req), members: f("count", "How many members work there.", req) },
    writes: { kind: "wage_claim", text: "Wage claim on {employer}: a rise of {rise_bps} hundredths of a percent.", to: ["=employer"], visible: ["=self", "=employer"], data: { employer: "=employer", rise_bps: "=rise_bps", members: "=members" } } },
  { form: "offer_accepted", title: "Acceptance of an employer's wage offer",
    fields: { employer: f("entity", "The employer.", req), offer: f("record", "The offer accepted.", req), claim: f("record", "The claim it answers.", req), rise_bps: f("count", "The rise accepted, in hundredths of a percent.", req) },
    writes: { kind: "offer_accepted", text: "Offer {offer} accepted.", basis: "=offer", to: ["=employer"], visible: ["=self", "=employer"], data: { employer: "=employer", claim: "=claim", rise_bps: "=rise_bps" } } },
  { form: "action_ballot", title: "A ballot of members on industrial action",
    fields: { employer: f("entity", "The employer.", req), claim: f("record", "The claim in dispute."), closes: f("date", "The day the ballot closes.", req), members },
    writes: { kind: "action_ballot", text: "Ballot on industrial action at {employer}, closing {closes}.", to: ["=members"], visible: ["=self", "=members"], data: { employer: "=employer", claim: "=claim", closes: "=closes" } } },
  { form: "industrial_action", title: "Notice of industrial action",
    fields: { employer: f("entity", "The employer.", req), from: f("date", "The day it starts.", req), until: f("date", "The day it ends.", req), members, ballot: f("record", "The ballot that approved it.", req),
      voted: f("count", "How many voted.", req), yes: f("count", "How many voted for.", req), eligible: f("count", "How many could vote.", req) },
    writes: { kind: "industrial_action", text: "Industrial action at {employer} from {from} until {until}.", to: ["=employer", "=members"], visible: "public",
      data: { employer: "=employer", from: "=from", until: "=until", members: "=members", ballot: "=ballot", voted: "=voted", yes: "=yes", eligible: "=eligible" } } },
  { form: "stop_work", title: "Call to stop work",
    fields: { employer: f("entity", "The employer.", req), until: f("date", "The day work resumes.", req), members },
    writes: { kind: "stop_work", text: "Stop work at {employer} until {until}.", to: ["=employer", "=members"], visible: ["=self", "=employer", "=members"], data: { employer: "=employer", until: "=until", members: "=members" } } },
  { form: "return_to_work", title: "Call to return to work",
    fields: { employer: f("entity", "The employer.", req), members },
    writes: { kind: "return_to_work", text: "Return to work at {employer}.", to: ["=employer", "=members"], visible: ["=self", "=employer", "=members"], data: { employer: "=employer", members: "=members" } } },
  { form: "ballot_result", title: "Result of a ballot of members on industrial action", does: "Declares the result of a ballot of members on industrial action, to the employer and the members: how many could vote, how many did, how many said yes, and whether it is approved. Action may be notified only on a ballot that meets what the law on industrial action asks.",
    fields: { ballot: f("record", "The ballot."), employer: f("entity", "The employer.", req), members: f("list", "The members balloted.", req), eligible: f("count", "How many could vote.", req), voted: f("count", "How many voted.", req), yes: f("count", "How many voted yes.", req), passed: f("choice", "Whether it is approved.", { ...req, options: YES_NO }) },
    writes: { kind: "ballot_result", text: "Protected action ballot at {employer}: {voted} of {eligible} members voted, {yes} yes; approved {passed}.", basis: "=ballot", to: ["=employer", "=members"], visible: ["=self", "=employer", "=members"],
      data: { employer: "=employer", ballot: "=ballot", voted: "=voted", yes: "=yes", eligible: "=eligible", passed: "?passed" } } },
];

// ------------------------------------------------------------------ the paper

export const EDITOR: Issued[] = [
  { form: "news_item", title: "An item in the paper",
    fields: { headline: f("text", "What the item says.", req), source: f("record", "The record it reports.", req), kind: f("text", "What kind of record that is.", req),
      tone: f("choice", "How it reads for the town's government: -1 against, 0 neither, 1 for.", { ...req, options: ["-1", "0", "1"] }), about_office: f("choice", "Whether it is about an office up for election.", { ...req, options: YES_NO }), edition: f("count", "The edition it is in.", req) },
    writes: { kind: "news", text: "{headline}", basis: "=source", visible: "public", assertion: { that: "=headline", about: ["@town"] }, data: { kind: "=kind", tone: "#tone", about_office: "?about_office", edition: "=edition" } } },
];

// ------------------------------------------------------------------ shops and works

/** An order to a supplier, a delivery note and a report of theft, as a shop or a works writes them (trade.ts). */
/** An order to a supplier (trade.ts, `order`): the paper a seller acts on. Any office that buys in has it. */
export const ORDER: Issued = { form: "order", title: "An order to a supplier, paid with the order",
    does: "How the office buys from a supplier, the outside world's market among them: it places the order at the seller's listed price. The form pays nothing by itself: pay the whole sum into the account the seller's price list names, at the same sitting. The seller delivers once an order is paid in full, sends back money that comes with no order waiting for it, and declines an order unpaid after a week.",
    fields: { seller: f("entity", "Whom it is ordered from.", req), kind: f("text", "What is ordered.", req), quantity: f("count", "How many.", req), unit_price: f("amount", "The price of each, as the seller advertises it.", req),
      deliver_to: f("entity", "Who is to receive them.", req), at: f("structure", "Where they are to be delivered.", req), account: f("account", "The account the order is paid from.", req), retry_of: f("record", "An earlier order this one repeats."), for_days: f("count", "How many days the order may be served over.") },
    writes: { kind: "order", text: "Order: {quantity} {kind} at {unit_price} each, delivered to {deliver_to} at {at}. Paid with this order.", to: ["=seller"], visible: ["=self", "=seller"],
      data: { kind: "=kind", quantity: "=quantity", unit_price: "#unit_price", deliver_to: "=deliver_to", at: "=at", account: "=account", retry_of: "=retry_of", for_days: "=for_days" } } };

export const TRADE: Issued[] = [
  ORDER,
  { form: "delivery_note", title: "A delivery note for an order served",
    fields: { order: f("record", "The order.", req), buyer: f("entity", "Who ordered.", req), kind: f("text", "What was ordered.", req), ordered: f("count", "How many were ordered.", req), delivered: f("count", "How many were delivered.", req), refund: f("amount", "What was refunded for those not delivered.", req),
      declined: f("choice", "Where nothing was delivered because the order was not paid for, or the buyer had not paid what it owed on earlier ones.", { options: ["unpaid", "overdue"] }) },
    writes: { kind: "delivery_note", text: "Delivered: {delivered} of {ordered} {kind} (order {order}).", basis: "=order", to: ["=buyer"], visible: ["=buyer", "=self"], data: { order: "=order", kind: "=kind", ordered: "=ordered", delivered: "=delivered", refund: "#refund", declined: "=declined" } } },
  { form: "wage_offer", title: "An answer to a union's wage claim",
    fields: { union: f("entity", "The union that made the claim.", req), claim: f("record", "The claim answered.", req), rise_bps: f("count", "The rise offered, in hundredths of a percent.", req), why: f("text", "Why that much.") },
    writes: { kind: "wage_offer", text: "We offer a rise of {rise_bps} hundredths of a percent, in answer to {claim}.", basis: "=claim", to: ["=union"], visible: ["=self", "=union"], data: { employer: "=self", claim: "=claim", rise_bps: "=rise_bps", why: "=why" } } },
  { form: "export_invoice", title: "An invoice for goods sent to a buyer",
    fields: { buyer: f("entity", "Who is invoiced.", req), offer: f("record", "The buyer's standing offer it is sent under."), kind: f("text", "What was sent.", req), quantity: f("count", "How many.", req), from_at: f("structure", "Where they were sent from.", req),
      amount: f("amount", "The sum invoiced.", req), account: f("account", "The account it is to be paid into.", req), memo: f("text", "What the payment is for, in a few words.", req) },
    writes: { kind: "invoice", text: "Invoice: {quantity} {kind}, {amount}.", basis: "=offer", to: ["=buyer"], visible: ["=self", "=buyer"], data: { kind: "=kind", quantity: "=quantity", from_at: "=from_at", outcome: { money: { to: "=account", amount: "=amount", for: "=memo" } } } } },
  { form: "crime_report", title: "A report of goods taken, to the police",
    fields: { kind: f("text", "What was taken.", req), quantity: f("count", "How many.", req), at: f("structure", "Where from.", req), value: f("amount", "What it was worth.", req), account: f("account", "The account to be paid into if it is recovered.", req) },
    writes: { sends: [{ to: ["@police"], why: "The police investigate what is reported to them." }], kind: "crime_report", text: "Report: {quantity} {kind} taken from {at}.", to: ["@police"], visible: ["=self", "@police"], data: { kind: "=kind", quantity: "=quantity", at: "=at", value: "#value", account: "=account" } } },
];

// ------------------------------------------------------------------ a body that hears grievances (desk.ts)

/** A desk's, an ombudsman's or a mediation service's papers (docs/behaviour/frictions.md, "Venues"). */
export const DESK: Issued[] = [
  { form: "complaint_notice", title: "Notice of an application to the one it is against", does: "Tells the one an application is against what is said of them, and by when they may answer. It decides nothing.",
    fields: {
      application: f("record", "The application.", req), matter: f("text", "What it is about, in the word the application uses.", req),
      applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it is against.", req), answer_by: f("date", "The day they may answer by.", req),
      about: f("record", "The paper the application is about, where it names one."), amount: f("amount", "The sum the application seeks, where it gives one."), structure: f("structure", "The building, where the application names one."), seeks: f("text", "What the application seeks, where it says."),
    },
    writes: { kind: "complaint_notice", text: "{applicant} has applied to us about {matter} (application {application}). You may answer by {answer_by}.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=matter", matter: "=matter", applicant: "=applicant", against: "=against", answer_by: "=answer_by", hearing_at: "=answer_by", about: "=about", amount: "#amount", structure: "=structure", seeks: "=seeks" } } },
  { form: "venue_decision", title: "Decision on an application", does: "Says what is decided on an application, to both sides. It moves no money and does nothing by itself: an order or a recommendation is words, which the other side follows or does not.",
    fields: {
      application: f("record", "The application decided.", req), matter: f("text", "What it was about, in the word the application uses.", req),
      applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it was against."),
      finding: f("choice", "What is decided: pay (money to the applicant), do (put it right), set_aside (a paper), settled (the two agreed), dismissed, rejected (not something heard here), referred (passed to whoever must act).", { ...req, options: ["pay", "do", "set_aside", "settled", "dismissed", "rejected", "referred"] }),
      binding: f("choice", "Whether it is an order (yes) or a recommendation (no).", { ...req, options: YES_NO }),
      amount: f("amount", "For pay: how much."), pay_into: f("account", "For pay: the account it is paid into."), due: f("date", "For pay or do: the day it is due by."),
      about: f("record", "The paper the application is about, where it names one."), structure: f("structure", "The building, where the application names one."), seeks: f("text", "What the application sought, where it said."),
      waited_days: f("count", "Days from the application to this decision, for the office's own figures."),
      reason: f("text", "The reasons for the decision, in words."),
    },
    writes: { kind: "venue_decision", text: "Decision on {application}: {finding}.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=matter", matter: "=matter", applicant: "=applicant", against: "=against", finding: "=finding", binding: "?binding", waited_days: "=waited_days", about: "=about", structure: "=structure", seeks: "=seeks", amount: "#amount", to: "=pay_into", due: "=due", reason: "=reason" } } },
];

// ------------------------------------------------------------------ the support office

export const SUPPORT: Issued[] = [
  { form: "benefit_decision", title: "Decision on a claim for support", does: "Says what is decided on a claim, to the claimant. A claim granted on it is paid by the office's staff each period from then, at the sum and for the time the decision gives, while the office's standing order for paying claims is in force; a claim refused on it is not paid. It moves no money by itself.",
    fields: { claim: f("record", "The claim decided.", req), claimant: f("entity", "Who made the claim.", req), payment: f("text", "Which payment of the support law the claim is for, as the claim names it.", req),
      granted: f("choice", "Whether it is granted.", { ...req, options: YES_NO }), reason: f("text", "Why not, where it is refused."),
      amount: f("amount", "Where granted: the sum paid each period."), every: f("duration", "Where granted: the period it is paid by."), until: f("date", "Where granted for a time: the day the payment ends.") },
    writes: { kind: "benefit_decision", text: "Claim {claim}: granted {granted}.", basis: "=claim", to: ["=claimant"], visible: ["=claimant", "=self"],
      data: { claim: "=claim", payment: "=payment", granted: "?granted", reason: "=reason", amount: "#amount", every: "=every", until: "=until" } } },
];

// ------------------------------------------------------------------ the taxpayer's account (world.tax_collector; risk PB-23)

/**
 * A taxpayer's papers to the tax collector, as forms published for anyone who pays tax over (an employer's payroll, or
 * whoever holds the office that pays it): a claim to have a credit on its account repaid, or set against its next
 * return where the law allows, and a request for a statement of its own account. Each is a paper of the one who files
 * it, to the collector, and of no one else's. A code payroll officer writes the same statements from its own books
 * (kernel/crates/actors/src/firms/staffing.rs).
 */
export const TAX_CREDIT_CLAIM: Issued = {
  form: "tax_credit_claim", title: "A claim for tax paid and not owed: repaid, or set against the next return",
  does: "Asks the tax collector to repay a credit on your account with it (tax paid twice, or paid and not owed), into the account you name, or, where the law on tax paid and not owed allows it, to agree that the credit be set against your next return. The collector decides it against your account as it keeps it; a credit set against a return is used by paying that much less on the return and saying so on it. It moves no money by itself.",
  fields: {
    office: f("entity", "The tax collector.", req), use: f("choice", "Repaid (refund), or set against the next return (set_off).", { ...req, options: ["refund", "set_off"] }),
    amount: f("amount", "How much you claim (left out: the whole of the credit)."), account: f("account", "The account a refund is paid into."),
    particulars: f("text", "What was paid and not owed, in words (the payment, its day, the period it was for)."),
  },
  writes: { kind: "tax_credit_claim", text: "Claim for tax paid and not owed: {use} {amount}.", to: ["=office"], visible: ["=self", "=office"],
    data: { office: "=office", use: "=use", amount: "#amount", account: "=account", particulars: "=particulars" } },
};
export const TAX_ACCOUNT_REQUEST: Issued = {
  form: "tax_account_request", title: "A request for a statement of your account with the tax collector",
  does: "Asks the tax collector for a statement of your own account with it: what your returns say was owed, what it has received from you, what it has repaid, and whether you owe or are in credit. Only your own account is stated.",
  fields: { office: f("entity", "The tax collector.", req), particulars: f("text", "Anything the collector should know.") },
  writes: { kind: "tax_account_request", text: "Please send a statement of our account.", to: ["=office"], visible: ["=self", "=office"], data: { office: "=office", particulars: "=particulars" } },
};
/** What the tax collector issues (world.tax_collector), where a model holds the office. */
export const TAX_COLLECTOR: Issued[] = [
  { form: "tax_credit_decision", title: "Decision on a claim for tax paid and not owed", does: "Says what is decided on a taxpayer's claim, to the taxpayer: a refund granted (and how much), a credit that may be set against its next return, or a refusal and why. A refund granted on it is paid by a payment from the collector's account into the account the claim names; it moves no money by itself.",
    fields: { claim: f("record", "The claim decided.", req), taxpayer: f("entity", "Who made the claim.", req), use: f("choice", "What was asked for.", { ...req, options: ["refund", "set_off"] }),
      granted: f("choice", "Whether it is granted.", { ...req, options: YES_NO }), amount: f("amount", "Where granted: how much."), reason: f("text", "Why not, or why less than was asked.") },
    writes: { kind: "tax_credit_decision", text: "Claim {claim}: granted {granted}.", basis: "=claim", to: ["=taxpayer"], visible: ["=taxpayer", "=self"],
      data: { claim: "=claim", taxpayer: "=taxpayer", use: "=use", granted: "?granted", amount: "#amount", reason: "=reason" } } },
  { form: "tax_statement", title: "Statement of a taxpayer's account", does: "Tells a taxpayer how its own account stands: what its returns say was owed, what was received from it, what was repaid, and what is owing or in credit. It changes nothing on the account.",
    fields: { taxpayer: f("entity", "Whose account.", req), owed: f("amount", "Owed on its returns, in all.", req), paid: f("amount", "Received from it, in all.", req), refunded: f("amount", "Repaid to it, in all."),
      credit: f("amount", "In credit by (nothing: 0)."), outstanding: f("amount", "Owing (nothing: 0).") },
    writes: { kind: "tax_statement", text: "Statement of account: owed {owed}, paid {paid}; in credit {credit}.", to: ["=taxpayer"], visible: ["=taxpayer", "=self"],
      data: { taxpayer: "=taxpayer", owed: "#owed", paid: "#paid", refunded: "#refunded", credit: "#credit", outstanding: "#outstanding" } } },
];

// ------------------------------------------------------------------ a tenant's answer, and a place's own order form

/**
 * The tribunal's form for a tenant's answer to an application for possession (docs/behaviour/justice.md, "A tenant's
 * answer"): published in the town, for anyone served with such an application. Every field but the first is the
 * tenant's to give or leave out; a code citizen writes the same statement from its own record (citizen.ts).
 */
export const POSSESSION_ANSWER: Issued = {
  form: "possession_answer", title: "Answer to an application for possession of the home you rent",
  does: "For a tenant told by the tribunal that their landlord has applied for possession of their home: what the tenant wants the tribunal to know before it decides. It is filed with the tribunal by the day the notice of hearing gives, and a copy goes to the landlord, who may reply. Nothing on it need be filled in but the application; what is left out is not held against anyone.",
  fields: {
    application: f("record", "The application answered, as the notice of hearing names it.", req), landlord: f("entity", "The landlord who applied, as the notice of hearing names them: a copy goes to them.", req),
    left: f("choice", "Yes, where you have left the home.", { options: YES_NO }), left_on: f("date", "The day you left."),
    owes: f("amount", "What you say is owed today."), disputes_sum: f("choice", "Yes, where you say less is owed than the landlord says.", { options: YES_NO }),
    disputes_notice: f("choice", "Yes, where you say the notice to vacate did not give the days the law asks.", { options: YES_NO }),
    can_pay: f("amount", "What the household could pay a month toward what is owed, beyond the rent (nothing: 0)."), every: f("duration", "How often that could be paid."),
    out_of_work_since: f("date", "Where someone in the home is out of work: since when."), pay_short: f("choice", "Yes, where pay has come short of what was agreed.", { options: YES_NO }),
    claim: f("choice", "A claim for support: refused, or made and not yet decided.", { options: ["refused", "pending"] }), claim_on: f("date", "The day it was refused or made."),
    ill: f("choice", "Yes, where someone in the home is ill.", { options: YES_NO }),
    people: f("count", "How many people live in the home."), children: f("count", "How many of them are children."), ages: f("list", "Their ages."),
    lived_days: f("count", "How many days you have lived there."),
    go_to: f("choice", "Whether you have anywhere to go.", { options: ["nowhere", "someone_to_ask", "means_for_another"] }),
  },
  writes: { kind: "tribunal_response", text: "Answer to application {application}.", basis: "=application", to: ["@tribunal", "=landlord"], visible: ["=self", "@tribunal", "=landlord"],
    data: { application: "=application", left: "?left", left_at: "=left_on", owes: "#owes", disputes_sum: "?disputes_sum", disputes_notice: "?disputes_notice", offer: "#can_pay", every: "=every", out_of_work_since: "=out_of_work_since", pay_short: "?pay_short",
      claim: "=claim", claim_on: "=claim_on", ill: "?ill", people: "=people", children: "=children", ages: "=ages", lived_days: "=lived_days", go_to: "=go_to" } },
};

// ------------------------------------------------------------------ what a decision waits for, and asking it to be looked at again (foundations F8, F9)

/**
 * The papers a person of the town files with an office that decides, as forms published for whoever is asked: a claimant's papers for
 * a claim that waits for them, an employer's confirmation, and a request that an office look at what it decided again (or put right
 * what went wrong at its hands). A code citizen writes the same statements from its own record (citizen.ts, decisions.ts, firms.ts);
 * a model in the chair needs a form to write them (foundations F9). Each is a paper of the one who files it, to the office, and of no
 * one else's. The translator's next round has to learn their names (docs/decisions.md, "Foundations F9").
 */
export const CLAIM_EVIDENCE: Issued = {
  form: "evidence", title: "Papers for a claim that is waiting for them",
  does: "Answers an office's request for papers for your claim: what you send, and who your last employer was where it asks. Goes to the office by the day its request gives.",
  fields: {
    office: f("entity", "The office that asked.", req), claim: f("record", "Your claim, as the request names it.", req), need: f("text", "What it asks for, as it names it.", req),
    request: f("record", "The request this answers.", req), what: f("text", "What you send, in words.", req),
    last_employer: f("entity", "Your last employer, where it asks."),
  },
  writes: { kind: "evidence", text: "For my claim {claim}: {what}", basis: "=request", to: ["=office"], visible: ["=self", "=office"],
    data: { claim: "=claim", need: "=need", request: "=request", last_employer: "=last_employer" } },
};
export const CONFIRMATION_ANSWER: Issued = {
  form: "confirmation_answer", title: "An employer's answer to an office that asks it to confirm a worker's employment",
  does: "Answers an office's request to confirm what your books show of a person who worked for you, by the day it gives. Say only what your own books show.",
  fields: {
    office: f("entity", "The office that asked.", req), claim: f("record", "The claim it is about.", req), need: f("text", "What it asks to be confirmed, as it names it.", req),
    request: f("record", "The request this answers.", req), subject: f("entity", "The person it asks about.", req), what: f("text", "What your books show, in words.", req),
    employed: f("choice", "Yes: in your employment now.", { options: YES_NO }), known: f("choice", "Yes: your books have them, now or before.", { options: YES_NO }), ended_on: f("date", "Where it ended: the day."),
  },
  writes: { kind: "confirmation_answer", text: "Answer to your request {request}: {what}", basis: "=request", to: ["=office"], visible: ["=self", "=office"],
    data: { claim: "=claim", need: "=need", request: "=request", subject: "=subject", employed: "?employed", known: "?known", ended_on: "=ended_on" } },
};
export const REVIEW_REQUEST: Issued = {
  form: "review_request", title: "A request to look at a decision again, or to put something right",
  does: "Asks the office or body to look again at what it decided, or to put right what went wrong at its hands, inside the days the law gives where it gives any.",
  fields: {
    office: f("entity", "The office or body asked.", req), matter: f("text", "What went wrong, in a word or two (claim_refused).", req), about: f("record", "The paper it is about."),
    particulars: f("text", "Anything the office should know."), seeks: f("text", "What you ask for."),
  },
  writes: { kind: "review_request", text: "Request: please put this right ({matter}).", basis: "=about", to: ["=office"], visible: ["=self", "=office"],
    data: { matter: "=matter", against: "=office", about: "=about", particulars: "=particulars", seeks: "=seeks" } },
};

/** What a place's law says of a plan to pay in place of possession, as typed fields (the profile's; no place's figures
 * here): whether the tribunal may set one, must consider one, or has none; where it is taken away; and where paying
 * everything owed within a time ends the claim. */
export function planLaw(P: { plan_months: number; plan_consider?: string; plan_barred_rent_months?: number; cure_days?: number }): { plan_consider: "may" | "must" | "none"; plan_barred_rent_months?: number; cure_days?: number } {
  const consider = P.plan_months > 0 ? (P.plan_consider === "must" ? "must" : P.plan_consider === "none" ? "none" : "may") : "none";
  return { plan_consider: consider, ...(consider !== "none" && P.plan_barred_rent_months ? { plan_barred_rent_months: P.plan_barred_rent_months } : {}), ...(P.cure_days ? { cure_days: P.cure_days } : {}) };
}
/** The same, in the law's words: what the tribunal may or must do before it orders possession. */
export function planLawWords(P: { plan_months: number; plan_consider?: string; plan_barred_rent_months?: number; cure_days?: number }): string {
  const L = planLaw(P);
  const barred = L.plan_barred_rent_months ? `; it may not where ${L.plan_barred_rent_months} months' rent or more is owed on the day it decides` : "";
  const plan = L.plan_consider === "must" ? `Before it orders possession the tribunal must consider whether the tenant could pay what is owed by a plan, the tenant staying and paying the rent and a sum a month over no more than ${P.plan_months} months, and may set one in place of possession${barred}.`
    : L.plan_consider === "may" ? `The tribunal may, in place of possession, set a plan to pay: the tenant staying and paying the rent and a sum a month over no more than ${P.plan_months} months${barred}.`
    : "The law gives the tribunal no plan to pay to set in place of possession.";
  const cure = L.cure_days ? ` If everything owed is paid within ${L.cure_days} days of the application, the claim is at an end and the tenancy goes on.` : " Where what is owed has been paid, there is nothing to order.";
  return plan + cure;
}

/** The possession order form as a place's law has it: with the plan where the law gives the tribunal one to set, and
 * without it (the option, its fields and its words) where the law gives none; what the law has in its stead is said
 * from the same typed fields (worlds/generator: `planLaw`). */
export function possessionOrderFor(law: { plan_consider: "may" | "must" | "none"; plan_barred_rent_months?: number; cure_days?: number }, planMonths: number): Issued {
  const x = TRIBUNAL_MEMBER.find((i) => i.form === "possession_order")!;
  const tail = " It moves nobody: a tenant still there after the day is put out only on a warrant the landlord asks the tribunal's registrar for, by whoever carries its warrants out. What the law asks before an order and how many days on the day for possession falls are in the law on possession and the tribunal's procedure.";
  const head = "Decides an application for possession of a let home for rent owed, and tells landlord and tenant: ";
  const cure = law.cure_days ? ` Where everything owed has been paid within ${law.cure_days} days of the application the law ends the claim: dismissed.` : "";
  if (law.plan_consider === "none") {
    const { instalment: _i, pay_into: _p, ...fields } = x.fields as { [k: string]: FormField };
    const { instalment: _a, to: _b, ...data } = x.writes.data as { [k: string]: unknown };
    return { ...x, does: `${head}dismissed (the tenant stays, and the notice to vacate is spent); or possession on a day (the tenant and household are to leave by it). The law here gives the tribunal no plan to pay to set.${cure}${tail}`,
      fields: { ...fields, finding: f("choice", "What is ordered.", { ...req, options: ["dismissed", "possession"] }), owed: f("amount", "The rent found owed (possession).") }, writes: { ...x.writes, data } };
  }
  const barred = law.plan_barred_rent_months ? `, which the law does not allow where ${law.plan_barred_rent_months} months' rent or more is owed on the day of the order` : "";
  return { ...x, does: `${head}dismissed (the tenant stays, and the notice to vacate is spent); a plan (the tenant stays, paying the rent and a sum a month toward what is owed, over no more than ${planMonths} months${barred}; a plan not kept, the landlord may apply again); or possession on a day (the tenant and household are to leave by it). ${law.plan_consider === "must" ? "The law asks the tribunal to consider a plan before it orders possession." : "The law allows a plan in place of possession."}${cure}${tail}` };
}

// ------------------------------------------------------------------ the audit office (auditor.ts; docs/behaviour/auditor.md)

/** A body's answer to the audit office's request, from its own books: the thing asked for and nothing else. */
export const AUDIT_ANSWER: Issued = {
  form: "audit_answer", title: "Answer to the audit office's request for a named item",
  does: "Answers the audit office's public request under the audit law, by the day it gives: the count of your decisions of a kind in a period, one of them by its number with its file, or your payments for the period against the bank's record. Say only what your books show. It does nothing else by itself.",
  fields: { request: f("record", "The request this answers.", req), auditor: f("entity", "The audit office.", req), audit: f("text", "The audit's key, as the request gives it.", req), ask: f("choice", "What was asked for.", { ...req, options: ["count", "nth", "statement"] }),
    nth: f("count", "For a decision by its number: which."), count: f("count", "For a count: how many."), statement: f("text", "The books' entries asked for, in words.") },
  writes: { kind: "audit_answer", text: "Answer to audit request {request}: {statement}", basis: "=request", to: ["=auditor"], visible: ["=auditor", "=self"],
    data: { request: "=request", audit: "=audit", ask: "=ask", nth: "=nth", count: "=count" } },
};

export const AUDIT: Issued[] = [
  { form: "audit_request", title: "Audit request to a body, for one named item",
    does: "Asks, in public, a body the audit law names for one thing: the count of its decisions of a kind in a period, one of them by its number, or its statement of payments for the period. The body must answer by the day given; asking for more than one thing is more than one request. It examines nothing by itself.",
    fields: { body: f("entity", "The body asked.", req), audit: f("text", "The audit's key (the body, the check and the period).", req), ask: f("choice", "What is asked for.", { ...req, options: ["count", "nth", "statement"] }),
      kind: f("text", "For decisions: the kind of decision."), nth: f("count", "For one decision: its number in the period (from 1)."), begins: f("date", "The period's first day.", req), ends: f("date", "The day the period ends.", req), answer_by: f("date", "The day the body must answer by.", req) },
    writes: { kind: "audit_request", text: "Audit request: {ask} for the period from {begins} to {ends}. To be answered by {answer_by}.", visible: "public", data: { audit: "=audit", ask: "=ask", kind: "=kind", nth: "=nth", from: "=begins", to: "=ends", answer_by: "=answer_by" } } },
  { form: "audit_finding", title: "Audit finding on one item (the audit office's working paper)",
    does: "Records what the examination of one item found, in the law's terms: that the decision agrees or does not agree with the law and the procedure published for its kind, or that it cannot be told from the file. A finding is the audit office's own working paper; the report is what is published. It reverses and fines nothing.",
    fields: { body: f("entity", "The body.", req), audit: f("text", "The audit's key.", req), item: f("record", "The decision or statement examined.", req), nth: f("count", "Its number in the period."), agrees: f("choice", "Whether it agrees with the law.", { options: YES_NO }), says: f("text", "What was found, in the law's terms.", req) },
    writes: { kind: "audit_finding", text: "Audit finding on {item}: {says}.", basis: "=item", visible: ["=self"], data: { audit: "=audit", item: "=item", nth: "=nth", agrees: "?agrees", says: "=says" } } },
  { form: "audit_report", title: "Audit report on a body for a period (public)",
    does: "Publishes what the audit of a body for a period found: how many decisions there were, how many were examined, how many agree with the law and how many do not (with the particulars of each, as the findings give them), or whether the accounts reconcile. It is public, by the law; the council, the bodies that hear complaints and the body audited read it. It reverses and fines nothing: what follows is for people, by the review and appeal the law already gives.",
    fields: { body: f("entity", "The body audited.", req), audit: f("text", "The audit's key.", req), check: f("choice", "What was checked.", { ...req, options: ["decisions", "accounts"] }), period: f("count", "The period's number.", req), begins: f("date", "The period's first day.", req), ends: f("date", "The day it ends.", req),
      population: f("count", "For decisions: how many were made in the period."), sample: f("count", "For decisions: how many were examined."), agreed: f("count", "How many agree with the law."), not_agreed: f("count", "How many do not."), not_checked: f("count", "How many could not be told from the file."),
      particulars: f("text", "Where any do not agree: each decision and what was found, in the law's terms.") },
    writes: { kind: "audit_report", text: "Audit of {body}, {check}, {begins} to {ends}: {population} made, {sample} examined; {agreed} agree with the law, {not_agreed} do not, {not_checked} could not be told from the file. {particulars}", visible: "public",
      data: { body: "=body", audit: "=audit", check: "=check", period: "#period", from: "=begins", to: "=ends", population: "#population", sample: "#sample", agreed: "#agreed", not_agreed: "#not_agreed", not_checked: "#not_checked" } } },
];
