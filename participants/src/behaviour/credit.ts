// Credit (phase C, stage C2): loans as agreements. A lender's office (bank.lending) decides applications on what it
// can see of the applicant's account, pays out, and follows repayments into arrears and default; borrowers (households,
// factories, shops) apply when short, take the loan offered, and repay by standing order. Documented in
// docs/behaviour/credit.md.

import type { LookRequest, Observation } from "../contracts";
import { channels } from "../contracts";
import { cents } from "../money";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, commitmentOf, DAY, MONTH, offer, ownAccount, pay, record, say, sign, type Step, usd, Asked, lookUp, LOOKS_MAX } from "./common";
import { Staffing, stepper } from "./firms";
import * as P from "./papers";

/**
 * The monthly repayment on a loan (the credit-foncier formula: fixed payments that repay principal and interest over
 * the term), in cents, rounded up. Worked in ordinary arithmetic (no powers), so every machine gets the same answer.
 */
export function repayment(principal: number, annualBps: number, months: number): number {
  if (months <= 0) return principal;
  const r = annualBps / 12 / 10_000;
  if (r === 0) return Math.ceil(principal / months);
  let f = 1;
  for (let i = 0; i < months; i++) f *= 1 + r;
  return Math.ceil((principal * r * f) / (f - 1));
}

/**
 * A share of an amount, in ten-thousandths, as a whole number of the smallest unit: rounded down, or up. Whole numbers
 * throughout (the remainder decides the rounding; no fraction is ever made), exact while the amount times ten thousand
 * is within 2^53.
 */
export function shareDown(amount: number, bps: number): number {
  const n = amount * bps;
  if (!Number.isSafeInteger(n)) throw new Error(`a share of ${amount} is beyond this code's exact arithmetic`);
  return (n - (n % 10_000)) / 10_000;
}
export function shareUp(amount: number, bps: number): number {
  const n = amount * bps;
  return shareDown(amount, bps) + (n % 10_000 > 0 ? 1 : 0);
}

/** The most a lender lends against a price at a share of it (a loan-to-value limit): that share, rounded down to a
 * whole unit. A loan is within the limit exactly when it is no more than this. */
export const mostAgainst = (price: number, lvrBps: number) => shareDown(price, lvrBps);

/**
 * What a buyer borrows for something at a price, putting down a share of it as the deposit: the deposit is rounded up
 * to a whole unit, so the loan is the rest of the price rounded down. A lender that lends at most the rest of the price
 * (80% against a 20% deposit) admits it at any price. Rounding the deposit down asks for a unit more than that limit
 * wherever the share is not whole, and was refused for it (until 2026-10-08: docs/decisions.md, "A home loan asked a
 * fraction over the limit").
 */
export const loanFor = (price: number, depositBps: number) => price - shareUp(price, depositBps);

/**
 * A borrower's side: apply to a lender when short, take the loan offered (sign it, and ask the bank to pay the
 * repayments monthly), and remember a refusal for a while. The same for a household or a firm.
 */
export class Borrowing {
  private applied: number | null = null; // when we applied, if we're waiting to hear
  private refusedAt = -Infinity;
  private grantedAt = -Infinity; // when a loan was last approved, or signed for: its money is on the way
  private readonly taken = new Set<string>();
  private repayingUntil = -Infinity; // a loan we're repaying (or have been offered): no other till it's done
  impaired = false; // we've defaulted: the lender won't lend to us again
  /** `retry_days`: after a refusal. `again_days`: a firm that is repaying a loan may apply for another this long after the last was granted, and the
   * bank decides it on its rule (it counts what the borrower already repays); without it, one loan at a time until it is repaid
   * (docs/behaviour/credit.md, "More than one loan"). */
  constructor(private readonly me: string, private readonly lender: string, private readonly o: { retry_days?: number; again_days?: number } = {}) {}

  /** Waiting on an application (so don't act as if the money won't come, for a few days), or on the money of a loan
   * granted: the lender pays it out once it has seen our signature, at its next look, not in the moment we sign (a day
   * is allowed for it). Without the second, a firm let someone go for want of a loan in the moment it signed for one. */
  waiting(t: number): boolean {
    return (this.applied !== null && t - this.applied < 14 * DAY) || t - this.grantedAt < DAY;
  }

  /** Whether we'd apply now: not waiting, not refused lately, not in default. */
  canApply(t: number): boolean {
    return !!this.lender && !this.waiting(t) && !this.impaired && (this.o.again_days !== undefined ? t - this.grantedAt >= this.o.again_days * DAY : t >= this.repayingUntil) && t - this.refusedAt >= (this.o.retry_days ?? 60) * DAY;
  }

  /** Applying: how much, over how long, from and to which account, and why (the lender reads the account itself). */
  apply(t: number, account: string, amount: number, months: number, purpose: string, why: string, extra: object = {}): Step {
    this.applied = t;
    return because(why, say("loan_application", `Application for a loan of ${usd(amount)} over ${months} months, for ${purpose}.`, {
      to: [this.lender], visible: [this.me, this.lender], data: { amount, months, account, purpose, ...extra },
    }));
  }

  /** Each observation: decisions on our applications, loans offered to us (signed, and repaid by standing order), defaults. */
  steps(book: Book, t: number, account: string | undefined): Step[] {
    const steps: Step[] = [];
    for (const r of book.all("loan_decision")) {
      if (this.taken.has(r.id) || !(r.addressed_to ?? []).includes(this.me)) continue;
      this.taken.add(r.id);
      this.applied = null;
      if (!r.data?.approved) this.refusedAt = t;
      else {
        this.repayingUntil = Math.max(this.repayingUntil, t + (Number(r.data?.months) || 12) * MONTH);
        this.grantedAt = t;
      }
    }
    for (const r of book.all("loan_default")) if ((r.addressed_to ?? []).includes(this.me)) this.impaired = true;
    if (!account) return steps;
    for (const r of book.ofType("agreement")) {
      if (r.record !== "agreement" || r.terms.template !== "loan" || !r.terms.parties.includes(this.me) || r.terms.parties[0] !== this.lender || this.taken.has(r.id) || book.signedBy(r.id, this.me) || book.takenBack(r.id)) continue;
      this.taken.add(r.id);
      this.applied = null;
      const owe = commitmentOf(r, this.me);
      const m = owe.outcome?.money;
      if (!m) continue;
      this.grantedAt = t;
      steps.push(because(`The loan we applied for is offered: signing, and asking our bank to pay the ${usd(cents(m.amount))} a month.`,
        sign(r.id),
        pay(m.to, cents(m.amount), { from: account, every: owe.every ?? MONTH, first: owe.every ?? MONTH, basis: r.id, for: "Loan repayment." })));
    }
    return steps;
  }
}

/** What a lender remembers of a loan it has made. */
interface Loan { agreement: string; borrower: string; account: string; principal: number; payment: number; months: number; start?: number; arrearsNoticeAt?: number; defaulted?: boolean; rate_bps?: number }

/** What's left on a loan: its remaining repayments' present value at its rate (what paying it off now takes). */
export function payout(payment: number, annualBps: number, monthsLeft: number): number {
  if (monthsLeft <= 0) return 0;
  const r = annualBps / 12 / 10_000;
  if (r === 0) return payment * monthsLeft;
  return Math.ceil((payment * (1 - (1 + r) ** -monthsLeft)) / r);
}

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
  version: "0.5.0", // 0.5.0: pays the bank's own staff and files and pays over the tax withheld from them, as any employer's payroll does (`pay_staff`; foundations F6); 0.4.4: 0.4.4: repayments missed before the year began, by the bank's statement of the loan account on file (an opening caseload), are counted as due and none repaid, and a letter of arrears already on file is not sent again; 0.4.3: a loan it offered is read from its own file where it is not in its head, so whoever holds the office pays out what was approved; 0.4.2: a loan standing at the start is counted from its own repayment day where it names one (attrs.first_due), not from the bank's first look; 0.4.1: main's 0.3.1 with this branch's 0.4.0 (an applicant is looked up)
  doc: "docs/behaviour/credit.md",
  cadence: () => DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(24) * 3600,
  create(ctx: ParticipantContext) {
    const p = params(
      {
        // Place-specific figures are placeholders here: a world sets them from its profile (docs/profiles.md).
        rate_bps: { person: 1200, organisation: 800 } as { [kind: string]: number }, // lending rates, a year
        buffer_bps: 300, // assessed at the rate plus this (serviceability)
        max_share_bps: { person: 3000, organisation: 2000 } as { [kind: string]: number }, // of monthly income, for repayments
        max_months: 60,
        // Mortgages (docs/behaviour/ownership.md): a loan for a home, at its own rate, over longer, for at most a share of
        // the price (the loan-to-value ratio). 0: none.
        mortgage_rate_bps: 0, mortgage_max_months: 360, max_lvr_bps: 8000,
        default_days: 90, // this far behind: default
        arrears_days: 30, // this far behind: arrears (a notice)
        reserve: 5_000_000, // kept in the bank's own account, cents
        funding_from: null as string | null, // who lends the bank money when it's short (an entity outside)
        funding_rate_bps: 500, // what that funding costs, a year
        who: "", // its channel onto who's who, where it looks up what kind of applicant it has ("": it knows what it is shown)
        // The bank's own staff (foundations F6): the payroll of an employer is done by someone of it, and nobody but the lending office
        // may be shown the bank's whole file of instructions, among which the wages it pays are only a few. "": it pays no staff.
        pay_staff: false, period: 14 * DAY, notice_days: 14,
      },
      ctx.params,
    );
    const me = ctx.entity;
    const asked = new Asked();
    const book = new Book();
    const decided = new Set<string>();
    const loans = new Map<string, Loan>(); // agreement -> loan
    const inflows = new Map<string, { t: number; amount: number }[]>(); // account -> what came in (last 90 days)
    const repaid = new Map<string, number>(); // agreement -> repaid so far
    const defaulted = new Set<string>(); // borrowers in default
    let funding = 0; // what we owe our funder
    let fundingAsked = 0; // a draw asked for and not yet come
    let drawId: string | undefined; // that draw's record (the funder's payment settles it)
    let funderAccount: string | undefined;
    let nextInterest = MONTH;
    let own: string | undefined;
    let termsOffered = false;
    const paidOut = new Map<string, number>(); // a loan -> when a payment of ours that settles it was seen to leave (its principal paid out)
    let adopted = false; // loans in force when we first looked (the world's: mortgages already being repaid), taken on
    const payroll = p.pay_staff ? new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, role: "staff", does: { hire: false, pay: true }, wakes: DAY }) : undefined;

    return stepper(
      (obs: Observation) => {
        book.absorb(obs);
        payroll?.absorb(obs);
        own = own ?? ownAccount(obs)?.account;
        for (const tx of channels.transactions(obs)) {
          if (own && tx.from === own && tx.settles && !paidOut.has(tx.settles)) paidOut.set(tx.settles, tx.t);
          const list = inflows.get(tx.to) ?? [];
          if (tx.from !== tx.to) list.push({ t: tx.t, amount: cents(tx.amount) });
          while (list.length && list[0]!.t < obs.t - 90 * DAY) list.shift();
          inflows.set(tx.to, list);
          // Repayments: from a borrower's account into ours, set against their loans, oldest first.
          // A payout (paying a loan off: docs/behaviour/ownership.md): the loan it names is repaid.
          const payoff = own && tx.to === own && tx.settles ? loans.get(tx.settles) : undefined;
          if (payoff) {
            repaid.set(payoff.agreement, payoff.payment * payoff.months);
            continue;
          }
          if (own && tx.to === own) {
            let x = cents(tx.amount);
            for (const l of [...loans.values()].filter((l) => l.account === tx.from && l.start !== undefined).sort((a, b) => a.start! - b.start!)) {
              const left = l.payment * l.months - (repaid.get(l.agreement) ?? 0);
              const part = Math.min(x, Math.max(0, left));
              repaid.set(l.agreement, (repaid.get(l.agreement) ?? 0) + part);
              x -= part;
              if (x <= 0) break;
            }
          }
          // Funding: the funder's payment settles our draw.
          if (own && tx.to === own && drawId && tx.settles === drawId) {
            funding += cents(tx.amount);
            funderAccount = tx.from;
            fundingAsked = 0;
            drawId = undefined;
          }
        }
      },
      (obs: Observation) => {
        const t = obs.t;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        // Loans in force when we first look: their repayments as their terms say, from when we first see them.
        if (!adopted) {
          adopted = true;
          for (const r of book.ofType("agreement")) {
            if (r.record !== "agreement" || r.terms.template !== "loan" || r.terms.parties[0] !== me || loans.has(r.id) || !book.inForce(r.id)) continue;
            const who = r.terms.parties[1]!;
            const repay = r.terms.commitments.find((c: any) => c.who === who)?.does?.outcome?.money;
            if (!repay?.from) continue;
            const payment = cents(repay.amount), months = Math.max(1, Math.round((r.terms.term ?? 0) / MONTH));
            const rateOf = /\(([\d.]+)% a year\)/.exec(String(r.terms.text ?? ""));
            // (A loan that names the day its first repayment falls due, so long after it began (`attrs.first_due`: each
            // borrower's own day), is counted from that day: a month before it is where its months begin. Until
            // 2026-10-11 every loan standing at the start was counted from the bank's first look, so every borrower
            // who had not paid fell into arrears, and then into default, on the same day.)
            const firstDue = Number.isSafeInteger((r.terms as any).attrs?.first_due) && (r.terms as any).attrs.first_due > 0 ? ((r.terms as any).attrs.first_due as number) : undefined;
            // (Repayments missed before the year began, by our statement of the loan account: counted as due, none repaid; a
            // letter of arrears already on file is not sent again.)
            const carried = book.open("loan_statement").filter((x) => x.speaks_for === me && x.data?.loan === r.id && x.data?.brought_forward).sort((a, b) => b.at - a.at)[0];
            const missed = carried ? Math.max(0, Math.floor(Number(carried.data?.payments) || 0)) : 0;
            const lettered = book.open("loan_arrears").some((x) => x.speaks_for === me && x.data?.loan === r.id && x.data?.brought_forward);
            loans.set(r.id, { agreement: r.id, borrower: who, account: repay.from, principal: payment * months, payment, months, start: (firstDue !== undefined ? r.at + firstDue - MONTH : t) - missed * MONTH, ...(lettered ? { arrearsNoticeAt: t } : {}), ...(rateOf ? { rate_bps: Math.round(Number(rateOf[1]) * 100) } : {}) });
          }
        }
        // What borrowing from us is, for anyone who might (docs/design/ai-citizens.md 2a): published once.
        if (!termsOffered) {
          termsOffered = book.open("loan_terms").some((r) => r.speaks_for === me);
          if (!termsOffered) {
            termsOffered = true;
            const rates = Object.entries(p.rate_bps).map(([k, r]) => `${r / 100}% a year for ${k === "person" ? "people" : "organisations"}`).join(", ");
            steps.push(because("Saying what borrowing from us is: apply, and we lend what we judge can be repaid.",
              say("loan_terms", `Loans: apply to us, saying how much, over how long (up to ${p.max_months} months) and what for. Interest: ${rates}. Repaid monthly.`, { visible: "public",
                offer: { by: me, take_up: "apply", terms: { template: "loan", commitments: [
                  { who: me, does: { text: `Lends the amount applied for, if it judges it can be repaid, over up to ${p.max_months} months.` } },
                  { who: "taker", does: { text: `Repays it monthly with interest (${rates}).` } },
                ] } } })));
          }
        }
        if (!acc) return steps;
        const kindOf = (e: string) => (book.entityKind.get(e) === "person" ? "person" : "organisation"); // (as the directory said when it was looked up)
        const accounts = new Map(channels.accounts(obs).map((a) => [a.account, a]));
        // Regular income, as a lender reads a statement: the least that came in in any of the last three months (a
        // one-off sum isn't income; without three months of history there's nothing to lend against).
        const incomeOf = (account: string) => {
          const fs = inflows.get(account) ?? [];
          return Math.min(...[0, 1, 2].map((k) => fs.filter((f) => f.t >= t - (k + 1) * MONTH && f.t < t - k * MONTH).reduce((x, f) => x + f.amount, 0)));
        };
        // What an applicant already owes us each month, and whether they're behind on it.
        const current = (who: string) => [...loans.values()].filter((l) => l.borrower === who && !l.defaulted && (l.start === undefined || (repaid.get(l.agreement) ?? 0) < l.payment * l.months));
        const behind = (who: string) => current(who).some((l) => l.start !== undefined && Math.min(l.months, Math.floor((t - l.start) / MONTH)) * l.payment > (repaid.get(l.agreement) ?? 0));

        // Applications: decided on the bank's rules.
        for (const a of book.open("loan_application").filter((r) => (r.addressed_to ?? []).includes(me) && !decided.has(r.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
          decided.add(a.id);
          const who = a.speaks_for!;
          const account = String(a.data?.account);
          const amount = Math.floor(Number(a.data?.amount) || 0);
          const mortgage = a.data?.purpose === "a home" && p.mortgage_rate_bps > 0;
          const price = Math.floor(Number(a.data?.price) || 0);
          const months = Math.min(mortgage ? p.mortgage_max_months : p.max_months, Math.max(1, Math.floor(Number(a.data?.months) || 12)));
          const kind = kindOf(who);
          const rate = mortgage ? p.mortgage_rate_bps : p.rate_bps[kind] ?? p.rate_bps.organisation!;
          const income = incomeOf(account);
          const already = current(who).reduce((x, l) => x + l.payment, 0);
          const assessed = repayment(amount, rate + p.buffer_bps, months) + already;
          const cap = Math.floor((income * (p.max_share_bps[kind] ?? 2000)) / 10_000);
          const holderOk = accounts.get(account)?.holder === who && accounts.get(account)?.custodian === me;
          const refuse = !holderOk ? "we don't keep that account for you" : amount <= 0 ? "it doesn't say how much" : defaulted.has(who) ? "you're in default on a loan with us"
            : behind(who) ? "you're behind on a loan with us"
            // (In whole units: the most we lend on the price, rounded down; a loan of exactly that much is within it.)
            : mortgage && amount > mostAgainst(price, p.max_lvr_bps) ? `it's more than ${p.max_lvr_bps / 100}% of the home's price (${usd(price)})`
            : assessed > cap ? `the repayments${already ? ` (with the ${usd(already)} a month you already repay us)` : ""}, ${usd(assessed)} a month at ${(rate + p.buffer_bps) / 100}% (our rate and the buffer we assess at), are more than ${(p.max_share_bps[kind] ?? 2000) / 100}% of your regular income (${usd(income)}, the least that came into your account in any of the last three months)` : "";
          if (refuse) {
            steps.push(because(`A loan application we can't approve: ${refuse}.`, say("loan_decision", `Loan application ${a.id} declined: ${refuse}.`, { to: [who], visible: [who, me], basis: a.id, data: { application: a.id, approved: false, reason: refuse } })));
            continue;
          }
          const monthly = repayment(amount, rate, months);
          const st = because(`A loan application that meets our rules: ${usd(amount)} over ${months} months at ${rate / 100}% (${usd(monthly)} a month; ${usd(assessed)} at the assessment rate, within ${(p.max_share_bps[kind] ?? 2000) / 100}% of ${usd(income)} a month coming in): offering it.`,
            ["loan", offer(who, {
              template: "loan", term: months * MONTH,
              we: pay(account, amount, { for: "Loan principal." }),
              they: pay(acc.account, monthly, { from: account, every: MONTH, for: "Loan repayment." }),
              text: `${me} lends ${who} ${usd(amount)}${mortgage && a.data?.home ? ` for their home, ${a.data.home}` : ""}, paid into ${account}; ${who} repays ${usd(monthly)} a month for ${months} months (${rate / 100}% a year).`,
              basis: a.id,
            })],
            say("loan_decision", `Loan application ${a.id} approved: offered.`, { to: [who], visible: [who, me], basis: a.id, data: { application: a.id, approved: true, amount, months, rate_bps: rate, payment: monthly } }));
          st.then = (out) => { if (out.created?.loan) loans.set(out.created.loan, { agreement: out.created.loan, borrower: who, account, principal: amount, payment: monthly, months, rate_bps: rate }); };
          steps.push(st);
        }

        // Asked what paying a loan off takes: its remaining repayments' present value at its rate (a payout figure).
        for (const r of book.open("loan_payout_request").filter((x) => (x.addressed_to ?? []).includes(me) && !decided.has(x.id))) {
          decided.add(r.id);
          const l = loans.get(String(r.data?.loan));
          if (!l || l.borrower !== r.speaks_for) continue;
          const left = Math.max(0, l.months - Math.floor((repaid.get(l.agreement) ?? 0) / Math.max(1, l.payment)));
          const amount = payout(l.payment, l.rate_bps ?? p.rate_bps.person!, left);
          steps.push(because(`A payout figure for loan ${l.agreement}: ${left} repayments left, worth ${usd(amount)} now.`,
            say("loan_payout", `To pay off loan ${l.agreement}: ${usd(amount)}, to ${acc.account}, naming the loan.`, { to: [l.borrower], visible: [l.borrower, me], basis: r.id, data: { loan: l.agreement, amount, account: acc.account } })));
        }
        // A loan we offered that is on our file and not in our head (2026-10-11): whoever holds the office carries on
        // from its papers. Until then an offer was remembered only by the id its making gave back; where the offer was
        // made through someone else's hand (the mock in the lending seat says each act as a seat would, and hears no
        // id back) nothing was remembered, and no loan it approved was ever paid out: 232 offers, no principal, in a
        // 120-day run of a 3,000-person town. Read from the agreement: made in the run, ours, not yet paid out.
        for (const r of book.ofType("agreement")) {
          if (r.record !== "agreement" || r.terms.template !== "loan" || r.terms.parties[0] !== me || loans.has(r.id) || r.author === "genesis") continue;
          const who = r.terms.parties[1]!;
          const lent = r.terms.commitments.find((c: any) => c.who === me)?.does?.outcome?.money;
          const repay = r.terms.commitments.find((c: any) => c.who === who)?.does?.outcome?.money;
          if (!lent?.to || !repay?.from) continue;
          const payment = cents(repay.amount), months = Math.max(1, Math.round((r.terms.term ?? 0) / MONTH));
          const rateOf = /\(([\d.]+)% a year\)/.exec(String(r.terms.text ?? ""));
          loans.set(r.id, { agreement: r.id, borrower: who, account: lent.to, principal: cents(lent.amount), payment, months, ...(rateOf ? { rate_bps: Math.round(Number(rateOf[1]) * 100) } : {}), ...(paidOut.has(r.id) ? { start: paidOut.get(r.id)! } : {}) });
        }
        // Signed: pay the principal out (drawing funding first if we're short).
        const toPay = [...loans.values()].filter((l) => l.start === undefined && book.signedBy(l.agreement, l.borrower));
        const needed = toPay.reduce((x, l) => x + l.principal, 0);
        if (needed > 0 && acc.balance - needed < p.reserve && p.funding_from && fundingAsked === 0) {
          const draw = p.reserve + needed - acc.balance;
          fundingAsked = draw;
          const st = because(`Loans to pay out (${usd(needed)}) would take us below our reserve: drawing ${usd(draw)} of funding.`,
            ["draw", say("funding_draw", `Please lend us ${usd(draw)}.`, { to: [p.funding_from], visible: [me, p.funding_from], data: { amount: draw, account: acc.account, rate_bps: p.funding_rate_bps } })]);
          st.then = (out) => {
            drawId = out.created?.draw;
            if (!drawId) fundingAsked = 0;
          };
          steps.push(st);
        }
        let room = acc.balance - (p.funding_from ? 0 : p.reserve);
        for (const l of toPay.sort((a, b) => (a.agreement < b.agreement ? -1 : 1))) {
          if (room < l.principal) break;
          room -= l.principal;
          l.start = t;
          steps.push(because(`${l.borrower} has signed: paying out the ${usd(l.principal)} loan.`, pay(l.account, l.principal, { from: acc.account, for: "Loan principal.", settles: l.agreement })));
        }

        // Following repayments: arrears, then default.
        for (const l of [...loans.values()].filter((x) => x.start !== undefined && !x.defaulted)) {
          const dueCount = Math.min(l.months, Math.floor((t - l.start!) / MONTH));
          const behind = dueCount * l.payment - (repaid.get(l.agreement) ?? 0);
          if (behind <= 0) {
            l.arrearsNoticeAt = undefined;
            continue;
          }
          // How long behind: since the earliest payment not covered.
          const covered = Math.floor((repaid.get(l.agreement) ?? 0) / l.payment);
          const since = l.start! + (covered + 1) * MONTH;
          if (t - since >= p.default_days * DAY) {
            l.defaulted = true;
            defaulted.add(l.borrower);
            const outstanding = l.payment * l.months - (repaid.get(l.agreement) ?? 0);
            steps.push(because(`${l.borrower}'s loan is ${Math.floor((t - since) / DAY)} days behind (${p.default_days} is default): recording the debt and the default.`,
              say("loan_default", `Loan ${l.agreement} is in default: ${usd(behind)} behind, ${usd(outstanding)} owing.`, { to: [l.borrower], visible: [l.borrower, me], basis: l.agreement, data: { loan: l.agreement, behind, outstanding } }),
              record("right", me, { kind: "debt", amount: outstanding, for: `Loan ${l.agreement}, in default.` }, { against: l.borrower, basis: l.agreement })));
          } else if (t - since >= p.arrears_days * DAY && l.arrearsNoticeAt === undefined) {
            l.arrearsNoticeAt = t;
            steps.push(because(`${l.borrower}'s loan is ${Math.floor((t - since) / DAY)} days behind: a notice of arrears.`,
              say("loan_arrears", `Loan ${l.agreement}: ${usd(behind)} behind. Please pay.`, { to: [l.borrower], visible: [l.borrower, me], basis: l.agreement, data: { loan: l.agreement, behind } })));
          }
        }

        // Our funding: interest monthly, and repaid when we have more than we need.
        if (p.funding_from && t >= nextInterest) {
          nextInterest = t + MONTH;
          const interest = Math.ceil((funding * p.funding_rate_bps) / 12 / 10_000);
          const repay = Math.min(funding, Math.max(0, acc.balance - interest - 2 * p.reserve));
          const s: Step = because(`Monthly: interest on our funding (${usd(funding)} at ${p.funding_rate_bps / 100}%)${repay ? `, and repaying ${usd(repay)} of it, as we have more than we need` : ""}.`);
          if (funderAccount && interest > 0) s.push(pay(funderAccount, interest, { from: acc.account, for: "Interest on funding." }));
          if (funderAccount && repay > 0) s.push(pay(funderAccount, repay, { from: acc.account, for: "Funding repaid." }));
          if (s.length) {
            if (funderAccount) funding -= repay;
            steps.push(s);
          }
        }
        // The bank's own staff are paid and their tax paid over as any employer's: starts, stops (a death), returns on the law's days.
        if (payroll && own) steps.push(...payroll.routine(obs, book, own, { target: 0, wage: 0, canPost: false }));
        return steps;
      },
      undefined,
      // What kind of applicant each new application is from (a person, or an organisation: the bank's rates and its
      // rule on income differ): looked up before it is decided, each applicant once. Nobody is shown who's who.
      (obs) => {
        if (!p.who) return [];
        const out: LookRequest[] = [];
        for (const a of book.open("loan_application")) {
          const applicant = a.speaks_for;
          if (out.length >= LOOKS_MAX || decided.has(a.id) || !applicant || !(a.addressed_to ?? []).includes(obs.entity!)) continue;
          if (!book.entityKind.has(applicant) && asked.first(applicant)) out.push(lookUp.entity(p.who, applicant));
        }
        return out;
      },
    );
  },
};

