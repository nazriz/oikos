import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


/**
 * bank.lending: a bank's lending office. It decides applications by the bank's rules: repayments, at the loan's rate
 * plus the serviceability buffer, within a share of what came into the applicant's account over the last three months
 * (what the bank can see: it keeps the account); nothing to anyone in default. It offers a loan agreement (principal
 * out; repayments monthly over the term); once the borrower signs, it pays the principal out, drawing funding from
 * outside if its own money won't cover it. It follows repayments: a month behind is arrears (a notice); `default_days`
 * behind is default (a notice, and the debt recorded as a claim). It pays interest on its funding monthly, and repays
 * funding when it can.
 */
export const lending: BehaviourModule = {
  name: "bank.lending",
  answers: {"office": "the bank's lending office", "acts": "What it acts on: an application for a loan, which it decides by its published terms; and the repayments of the loans it has made."},
  issues: P.LENDING,
  issuesWith: (p) => ({ funder: p.funding_from ?? undefined }),
  keeps: [
    { what: "request", why: "The bank's own files: its customers' instructions, among them the repayments of the loans this office made." },
    { what: "accounts", why: "The bank's own ledger: it keeps its customers' accounts, and a lending office reads what an applicant holds with it." },
  ],
  version: "0.6.0", // 0.5.0: pays the bank's own staff and files and pays over the tax withheld from them, as any employer's payroll does (`pay_staff`; foundations F6); 0.4.4: 0.4.4: repayments missed before the year began, by the bank's statement of the loan account on file (an opening caseload), are counted as due and none repaid, and a letter of arrears already on file is not sent again; 0.4.3: a loan it offered is read from its own file where it is not in its head, so whoever holds the office pays out what was approved; 0.4.2: a loan standing at the start is counted from its own repayment day where it names one (attrs.first_due), not from the bank's first look; 0.4.1: main's 0.3.1 with this branch's 0.4.0 (an applicant is looked up)
  doc: "docs/behaviour/credit.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create: inEngine("bank.lending"),
};
