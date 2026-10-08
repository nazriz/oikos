// The papers offices issue, as forms of their own stationery (docs/behaviour/office-papers.md; contracts: FormWrites;
// forms.ts). Each is the typed statement a code module makes already, set out as a form: its fields, and how they are
// written into the statement the rest of the world reads. A module lists the ones its office issues (`issues`), and
// says what of the office's own they carry (`issuesWith`: each "@name"). Where a model holds the office the world
// publishes them for it, and a paper filled in on its form is the paper the module would have made, to the letter.
//
// Nothing here is read by a code office: it goes on making its papers as it did.

import type { FormField, Issued } from "../module";

const f = (type: string, description: string, o: { required?: boolean; options?: string[] } = {}): FormField => ({ type, ...(o.required ? { required: true } : {}), ...(o.options ? { options: o.options } : {}), description });
const req = { required: true };
const YES_NO = ["yes", "no"];

// ------------------------------------------------------------------ any employer

/** A job advertisement, as any employer here places one (firms.ts, `Staffing`). */
export const JOB_ADVERTISEMENT: Issued = {
  form: "job_advertisement", title: "Job advertisement",
  fields: {
    wage: f("amount", "The wage for each pay period.", req),
    period: f("duration", "The pay period: how often the wage is paid.", req),
    posts: f("count", "How many posts this advertisement is for.", req),
    account: f("account", "The account the wages are paid from, where the office itself pays them."),
  },
  writes: {
    kind: "job_posting", text: "Hiring: {wage} every {period}.",
    data: { wage: "#wage", period: "=period", role: "@role", industry: "@industry", workplace: "@workplace_structure", space: "@workplace" },
    offer: { by: "=self", to: { min_age_years: 18 }, take_up: "apply", available: "=posts", terms: { template: "employment",
      commitments: [{ who: "=self", does: { outcome: { money: { from: "=account", amount: "=wage", for: "wages" } } }, every: "=period" }, "@occupancy"], termination: "@termination" } },
  },
};

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

export const REGISTRY: Issued[] = [
  { form: "death_registration", title: "Entry in the register of deaths",
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
    writes: { kind: "death_registration", text: "Death registered: {deceased}.", basis: "=notification",
      to: ["=reported_by", "=tell", "@feeds", "=estate"], visible: ["=self", "=reported_by", "=tell", "@feeds", "=estate"],
      data: { deceased: "=deceased", reported_by: "=reported_by", partner: "=partner", children: "=children", without_adult: "=without_adult" } } },
  { form: "death_certificate", title: "Certified copy of an entry of death",
    fields: { deceased: f("entity", "Who has died.", req), registration: f("record", "The entry in the register.", req), informant: f("entity", "Whom the copy is for.", req) },
    writes: { kind: "death_certificate", text: "Death of {deceased}: registered (entry {registration}).", basis: "=registration", to: ["=informant"], data: { deceased: "=deceased", registration: "=registration" } } },
  { form: "birth_registration", title: "Entry in the register of births",
    fields: { child: f("entity", "The child.", req), notification: f("record", "The notification of the birth.", req), reported_by: f("entity", "Who reported the birth: they are sent the entry.", req),
      born_at: f("date", "When the child was born, as the notification gives it."), mother: f("entity", "The child's mother.") },
    writes: { kind: "birth_registration", text: "Birth registered: {child}.", basis: "=notification", to: ["=reported_by", "@feeds"], visible: ["=self", "=reported_by", "@feeds"], data: { child: "=child", born_at: "=born_at", mother: "=mother" } } },
  { form: "transmission_application", title: "Application to the land registry for a dead owner's land to pass",
    fields: { deceased: f("entity", "The owner who has died.", req), heir: f("entity", "Whom the land passes to, as the law of succession says.", req), notification: f("record", "The notification of the death.", req) },
    writes: { kind: "transmission_application", text: "Transmission on death: whatever land {deceased} held passes to {heir}.", basis: "=notification", to: ["@land_registry"], data: { deceased: "=deceased", heir: "=heir" } } },
];

// ------------------------------------------------------------------ the town's offices

export const MAYOR: Issued[] = [
  { form: "invoice_approval", title: "The mayor's written approval of an invoice",
    fields: { invoice: f("record", "The invoice approved for payment.", req) },
    writes: { kind: "approval", text: "Approved for payment: {invoice}.", basis: "=invoice", to: ["=self"], data: { invoice: "=invoice" } } },
  { form: "nomination", title: "Nomination for an office at an election",
    fields: { office: f("entity", "The office stood for (the post, by its id).", req), name: f("text", "The name to go on the ballot.", req), platform: f("text", "What the candidate puts to the electors.", req),
      incumbent: f("choice", "Whether the candidate holds the office now.", { options: YES_NO }), values: f("list", "What the candidate stands for, in a word or two each.") },
    writes: { kind: "nomination", text: "Nomination for {office}: {name}. {platform}", to: ["@electoral"], visible: "public", assertion: { that: "=platform" }, data: { office: "=office", name: "=name", incumbent: "?incumbent", values: "=values" } } },
];

export const COUNCIL_CLERK: Issued[] = [
  { form: "council_ballot", title: "A ballot of the council on a proposal",
    fields: { proposal: f("record", "The proposal put to the vote.", req), open_for: f("duration", "How long the ballot stays open.", req), tags: f("list", "What the proposal is about, a word each (budget, tenant_protection, development).") },
    writes: { kind: "ballot", text: "Ballot of the council on {proposal}, open for {open_for}.", basis: "=proposal", data: { proposal: "=proposal", options: ["yes", "no"], closes_at: "+open_for", electorate: "council", tags: "=tags" } } },
  { form: "council_result", title: "The result of a ballot of the council",
    fields: { ballot: f("record", "The ballot counted.", req), yes: f("count", "Votes for.", req), no: f("count", "Votes against.", req), passed: f("choice", "Whether it passed.", { ...req, options: YES_NO }) },
    writes: { kind: "ballot_result", text: "Result of {ballot}: {yes} for, {no} against.", basis: "=ballot", data: { ballot: "=ballot", yes: "=yes", no: "=no", passed: "?passed" } } },
  // (Its lines, one amount each, are the town's own budget lines: the world adds them when it publishes the form.)
  { form: "adopted_budget", title: "The budget as the council adopted it",
    fields: { year: f("count", "The year the budget is for.", req), ballot: f("record", "The ballot that adopted it.", req) },
    writes: { kind: "budget", text: "The town's budget for year {year}.", basis: "=ballot", data: { year: "=year", lines: {} } } },
];

export const PLANNING: Issued[] = [
  { form: "permit_decision", title: "Decision on a planning permit application",
    fields: { application: f("record", "The application decided.", req), applicant: f("entity", "Who applied: the decision is sent to them.", req),
      decision: f("choice", "Granted, refused, or sent back as incomplete.", { ...req, options: ["granted", "refused", "incomplete"] }),
      law: f("record", "The law the building would breach, if any."), missing: f("list", "For an incomplete application: what it does not say (lot, structure_type).") },
    writes: { kind: "permit_decision", text: "Permit {decision}: application {application}.", basis: "=application", to: ["=applicant"], data: { application: "=application", decision: "=decision", law: "=law", missing: "=missing" } } },
];

export const INSPECTOR: Issued[] = [
  { form: "valuation_request", title: "Request to the valuer for a supplementary valuation",
    fields: { notice: f("record", "The notice of building work it follows from.", req), lot: f("lot", "The lot."), structure: f("structure", "What was built."), structure_type: f("structure_type", "The kind of building."), removed: f("structure", "What was demolished.") },
    writes: { kind: "valuation_request", text: "Supplementary valuation asked for, on notice {notice}.", basis: "=notice", to: ["@valuer"], data: { lot: "=lot", structure: "=structure", structure_type: "=structure_type", removed: "=removed" } } },
  { form: "demolition_order", title: "Order to demolish a building",
    fields: { owner: f("entity", "The owner ordered to demolish it.", req), structure: f("structure", "The building.", req), law: f("record", "The law it was built in breach of.", req), lot: f("lot", "The lot it stands on.") },
    writes: { kind: "demolition_order", text: "Order: demolish {structure}, built in breach of {law}.", basis: "=law", to: ["=owner"], data: { structure: "=structure", lot: "=lot", law: "=law" } } },
];

export const WORKS: Issued[] = [
  { form: "disposal_docket", title: "Docket for waste delivered to the landfill",
    fields: { kind: f("text", "What was delivered.", req), quantity: f("count", "How much of it.", req) },
    writes: { kind: "disposal_docket", text: "Delivered: {quantity} of {kind}.", to: ["@landfill"], visible: ["=self", "@landfill"], data: { kind: "=kind", quantity: "=quantity" } } },
];

export const ENVIRONMENT: Issued[] = [
  { form: "habitat_register", title: "Register of the lots where a listed species was found",
    fields: { round: f("count", "The survey round it is from.", req), lots: f("list", "The lots.", req) },
    writes: { kind: "habitat_register", text: "Habitat register, round {round}: {lots}.", to: ["@planning"], visible: "public", data: { round: "=round", lots: "=lots" } } },
];

export const ELECTORAL: Issued[] = [
  { form: "election_notice", title: "Notice of an election",
    fields: { office: f("entity", "The office to be filled (the post, by its id).", req), poll_at: f("date", "Polling day.", req), nominations_close_at: f("date", "When nominations close.", req),
      method: f("choice", "How the votes are counted.", { ...req, options: ["preferential", "plurality"] }) },
    writes: { kind: "election_notice", text: "Election for {office}: nominations close {nominations_close_at}; polling {poll_at}.", visible: "public", data: { office: "=office", poll_at: "=poll_at", nominations_close_at: "=nominations_close_at", method: "=method" } } },
];

// ------------------------------------------------------------------ the tribunal

export const TRIBUNAL_MEMBER: Issued[] = [
  { form: "tribunal_order", title: "Order of the tribunal on an application",
    fields: {
      application: f("record", "The application decided.", req), kind: f("choice", "What the application was.", { ...req, options: ["rent_increase", "debt", "charge"] }),
      applicant: f("entity", "Who applied.", req), against: f("entity", "Whom it was against.", req),
      finding: f("choice", "What is found.", { ...req, options: ["dismissed", "invalid", "valid", "pay", "paid"] }),
      notice: f("record", "For a rent increase: the notice challenged."), laws: f("list", "The laws the notice breaches, where it is found invalid."),
      claim: f("record", "For a debt: the claim."), amount: f("amount", "For an order to pay: how much."), pay_into: f("account", "For an order to pay: the account it is paid into."),
      due: f("date", "For an order to pay: the day it is due by."), victim: f("entity", "For a charge: who was wronged."), report: f("record", "For a charge: the report it came from."), paid: f("amount", "For a debt found paid: how much was paid."),
    },
    writes: { kind: "tribunal_order", text: "Order on {application}: {finding}.", basis: "=application", to: ["=applicant", "=against"], visible: ["=applicant", "=against", "=self"],
      data: { application: "=application", kind: "=kind", applicant: "=applicant", against: "=against", finding: "=finding", notice: "=notice", laws: "=laws", claim: "=claim", amount: "#amount", to: "=pay_into", due: "=due", victim: "=victim", report: "=report", paid: "#paid" } } },
];

export const TRIBUNAL_REGISTRAR: Issued[] = [
  { form: "garnishee_order", title: "Order to a debtor's bank to pay an unpaid order of the tribunal",
    fields: { order: f("record", "The tribunal's order left unpaid.", req), debtor: f("entity", "Who owes.", req), creditor: f("entity", "Who is owed.", req), amount: f("amount", "How much.", req), pay_into: f("account", "The account it is to be paid into.", req), claim: f("record", "The claim it settles, if the order names one.") },
    writes: { kind: "garnishee_order", text: "Order to pay {amount} from what {debtor} holds, into {pay_into}, under {order}.", basis: "=order", to: ["@banks"], visible: ["@banks", "=self", "=debtor", "=creditor"],
      data: { order: "=order", debtor: "=debtor", amount: "#amount", to: "=pay_into", claim: "=claim" } } },
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
    writes: { kind: "tax_report", text: "Rent received this month: {rent_received}.", to: ["@city"], data: { period_end: "=period_end", rent_received: "#rent_received", account: "=account" } } },
  { form: "death_notification", title: "Notification of a death, to the registrar",
    fields: { deceased: f("entity", "Who has died.", req) },
    writes: { kind: "death_notification", text: "Notification of a death: {deceased}.", to: ["@city"], data: { deceased: "=deceased" } } },
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
    writes: { kind: "funding_draw", text: "Funding drawn: {amount} into {account}.", to: ["@funder"], visible: ["=self", "@funder"], data: { amount: "#amount", account: "=account", rate_bps: "=rate_bps" } } },
];

// ------------------------------------------------------------------ the police

export const POLICE: Issued[] = [
  { form: "charge", title: "A charge laid before the tribunal",
    fields: { against: f("entity", "Who is charged.", req), victim: f("entity", "Who was wronged.", req), report: f("record", "The report it comes from.", req), amount: f("amount", "The value of what was taken.", req), account: f("account", "The account the victim is to be paid into.", req),
      found: f("entity", "The evidence: who was found with the goods."), found_at: f("structure", "The evidence: where."), goods: f("text", "The evidence: what goods.") },
    writes: { kind: "tribunal_application", text: "Charge against {against}, on report {report}.", basis: "=report", to: ["@tribunal"], visible: ["=self", "@tribunal", "=against"],
      data: { kind: "charge", against: "=against", victim: "=victim", report: "=report", amount: "#amount", account: "=account", evidence: { found: "=found", at: "=found_at", goods: "=goods" } } } },
  { form: "death_notification", title: "Notification of a death, to the registrar",
    fields: { deceased: f("entity", "Who has died.", req), found_at: f("space", "Where they were found.") },
    writes: { kind: "death_notification", text: "Notification of a death: {deceased}.", to: ["@registry"], data: { deceased: "=deceased", found_at: "=found_at" } } },
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
export const TRADE: Issued[] = [
  { form: "order", title: "An order to a supplier, paid with the order",
    fields: { seller: f("entity", "Whom it is ordered from.", req), kind: f("text", "What is ordered.", req), quantity: f("count", "How many.", req), unit_price: f("amount", "The price of each, as the seller advertises it.", req),
      deliver_to: f("entity", "Who is to receive them.", req), at: f("structure", "Where they are to be delivered.", req), account: f("account", "The account the order is paid from.", req), retry_of: f("record", "An earlier order this one repeats."), for_days: f("count", "How many days the order may be served over.") },
    writes: { kind: "order", text: "Order: {quantity} {kind} at {unit_price} each, delivered to {deliver_to} at {at}. Paid with this order.", to: ["=seller"], visible: ["=self", "=seller"],
      data: { kind: "=kind", quantity: "=quantity", unit_price: "#unit_price", deliver_to: "=deliver_to", at: "=at", account: "=account", retry_of: "=retry_of", for_days: "=for_days" } } },
  { form: "delivery_note", title: "A delivery note for an order served",
    fields: { order: f("record", "The order.", req), buyer: f("entity", "Who ordered.", req), kind: f("text", "What was ordered.", req), ordered: f("count", "How many were ordered.", req), delivered: f("count", "How many were delivered.", req), refund: f("amount", "What was refunded for those not delivered.", req),
      declined: f("choice", "Where nothing was delivered because it was not paid for.", { options: ["unpaid"] }) },
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
    writes: { kind: "crime_report", text: "Report: {quantity} {kind} taken from {at}.", to: ["@police"], visible: ["=self", "@police"], data: { kind: "=kind", quantity: "=quantity", at: "=at", value: "#value", account: "=account" } } },
];
