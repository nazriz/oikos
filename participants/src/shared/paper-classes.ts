// The classes of paperwork (docs/design/broad-seats.md 4.5, G3): what kind of office work each form is, so that a
// provider's offer can say what its assistants take as real products do (accounts payable, invoicing, tax filing,
// hiring, case management) instead of a list of kinds. Each form of every module's stationery (`issues`) and of what it
// hands over (`handsOver`) has one; a module states the class of a paper of its own where it differs from its form's
// (`BehaviourModule.classes`: a shop's delivery note is a till receipt). Read only where a town's offers take paperwork
// by class (the generator's `assistant_classes`); nothing else reads them. participants/test/paper-classes.test.ts holds
// the table complete.
//
// The classes:
//   correspondence: answers and letters to those who wrote to the office (a complaint's answer, a remedy, a reply)
//   payables:       what the office orders and pays for (orders, supply requests, a repair ordered, a draw on funds)
//   receivables:    what it bills or sends with goods (delivery notes to firms, invoices, rates notices)
//   returns:        statutory returns (tax withheld, tax reports)
//   hiring:         advertising posts, offering wages, telling payroll of starters and leavers
//   notices:        notices to tenants or the public (listings, rent increases, notices to vacate)
//   casework:       an office's decisions and requests on the matters before it, drafted for its officer (a loan, a
//                   permit, a valuation asked for, an audit, an application to the tribunal)
//   till:           receipts at a counter: a point-of-sale system's work, not a clerk's (decided 2026-11-11, 13.2)
//   records:        entries a registrar makes in the register it keeps (births, deaths, transmissions)
//   adjudication:   a tribunal's or a registrar's orders and warrants: the decision-maker's own act
//   governance:     a council's, an electoral office's or a union's own acts (ballots, budgets, nominations, action)
//   press:          a newspaper's items

export type PaperClass = "correspondence" | "payables" | "receivables" | "returns" | "hiring" | "notices" | "casework" | "till" | "records" | "adjudication" | "governance" | "press";

/** The class of each form, by the form's name. */
export const FORM_CLASS: { [form: string]: PaperClass } = {
  // correspondence
  complaint_answer: "correspondence", remedy_answer: "correspondence", tribunal_answer: "correspondence", crime_report: "correspondence",
  death_notification: "correspondence", possession_reply: "correspondence", variation_answer: "correspondence", audit_answer: "correspondence",
  rent_reminder: "correspondence", payment_plan_offer: "correspondence", petition_response: "correspondence",
  // payables
  order: "payables", supply_request: "payables", repair_order: "payables", funding_draw: "payables",
  // receivables
  delivery_note: "receivables", export_invoice: "receivables", rates_notice: "receivables",
  // returns
  withholding_return: "returns", tax_report: "returns",
  // hiring
  job_advertisement: "hiring", wage_offer: "hiring", payroll_starter: "hiring", payroll_leaver: "hiring",
  // notices
  rental_listing: "notices", rent_increase: "notices", notice_to_vacate: "notices", election_notice: "notices", habitat_register: "notices",
  // casework
  arrears_application: "casework", possession_application: "casework", warrant_request: "casework", charge: "casework",
  loan_decision: "casework", loan_payout: "casework", loan_arrears: "casework", loan_default: "casework",
  permit_decision: "casework", valuation_request: "casework", demolition_order: "casework", disposal_docket: "casework",
  audit_request: "casework", audit_finding: "casework", audit_report: "casework", complaint_notice: "casework", venue_decision: "casework",
  benefit_decision: "casework", tax_credit_decision: "casework", tax_statement: "casework",
  warrant_executed: "casework", warrant_lapsed: "casework", investigation_closed: "casework", invoice_approval: "casework",
  // records
  birth_registration: "records", death_registration: "records", death_certificate: "records", transmission_application: "records",
  // adjudication
  hearing_listing: "adjudication", hearing_notice: "adjudication", possession_order: "adjudication", tribunal_order: "adjudication",
  warrant: "adjudication", garnishee_order: "adjudication", enforcement_decline: "adjudication",
  // governance
  adopted_budget: "governance", council_ballot: "governance", council_result: "governance", nomination: "governance",
  action_ballot: "governance", ballot_result: "governance", industrial_action: "governance", offer_accepted: "governance",
  return_to_work: "governance", stop_work: "governance", wage_claim: "governance",
  // press
  news_item: "press",
};

/** The class of a paper an office writes on a form: the module's own word for its kind, else the form's. */
export function classOf(module: { classes?: { [kind: string]: PaperClass } } | undefined, form: { form: string; writes: { kind: string } }): PaperClass | undefined {
  return module?.classes?.[form.writes.kind] ?? FORM_CLASS[form.form];
}
