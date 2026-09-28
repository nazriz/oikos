// Credit (phase C, stage C2): loans as agreements. A lender's office (bank.lending) decides applications on what it
// can see of the applicant's account, pays out, and follows repayments into arrears and default; borrowers (households,
// factories, shops) apply when short, take the loan offered, and repay by standing order. Documented in
// docs/behaviour/credit.md.

import type { Observation } from "../contracts";
import { channels } from "../contracts";
import { cents } from "../money";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, commitmentOf, DAY, MONTH, offer, ownAccount, pay, record, say, sign, type Step, usd } from "./common";
import { stepper } from "./firms";

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
 * A borrower's side: apply to a lender when short, take the loan offered (sign it, and ask the bank to pay the
 * repayments monthly), and remember a refusal for a while. The same for a household or a firm.
 */
export class Borrowing {
  private applied: number | null = null; // when we applied, if we're waiting to hear
  private refusedAt = -Infinity;
  private readonly taken = new Set<string>();
  private repayingUntil = -Infinity; // a loan we're repaying (or have been offered): no other till it's done
  impaired = false; // we've defaulted: the lender won't lend to us again
  constructor(private readonly me: string, private readonly lender: string, private readonly o: { retry_days?: number } = {}) {}

  /** Waiting on an application (so don't act as if the money won't come, for a few days). */
  waiting(t: number): boolean {
    return this.applied !== null && t - this.applied < 14 * DAY;
  }

  /** Whether we'd apply now: not waiting, not refused lately, not in default. */
  canApply(t: number): boolean {
    return !this.waiting(t) && !this.impaired && t >= this.repayingUntil && t - this.refusedAt >= (this.o.retry_days ?? 60) * DAY;
  }

  /** Applying: how much, over how long, from and to which account, and why (the lender reads the account itself). */
  apply(t: number, account: string, amount: number, months: number, purpose: string, why: string): Step {
    this.applied = t;
    return because(why, say("loan_application", `Application for a loan of ${usd(amount)} over ${months} months, for ${purpose}.`, {
      to: [this.lender], visible: [this.me, this.lender], data: { amount, months, account, purpose },
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
      else this.repayingUntil = Math.max(this.repayingUntil, t + (Number(r.data?.months) || 12) * MONTH);
    }
    for (const r of book.all("loan_default")) if ((r.addressed_to ?? []).includes(this.me)) this.impaired = true;
    if (!account) return steps;
    for (const r of book.records.values()) {
      if (r.record !== "agreement" || r.terms.template !== "loan" || !r.terms.parties.includes(this.me) || r.terms.parties[0] !== this.lender || this.taken.has(r.id) || book.signedBy(r.id, this.me)) continue;
      this.taken.add(r.id);
      this.applied = null;
      const owe = commitmentOf(r, this.me);
      const m = owe.outcome?.money;
      if (!m) continue;
      steps.push(because(`The loan we applied for is offered: signing, and asking our bank to pay the ${usd(cents(m.amount))} a month.`,
        sign(r.id),
        pay(m.to, cents(m.amount), { from: account, every: owe.every ?? MONTH, first: owe.every ?? MONTH, basis: r.id, for: "Loan repayment." })));
    }
    return steps;
  }
}

/** What a lender remembers of a loan it has made. */
interface Loan { agreement: string; borrower: string; account: string; principal: number; payment: number; months: number; start?: number; arrearsNoticeAt?: number; defaulted?: boolean }

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
  version: "0.1.0",
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
        default_days: 90, // this far behind: default
        arrears_days: 30, // this far behind: arrears (a notice)
        reserve: 5_000_000, // kept in the bank's own account, cents
        funding_from: null as string | null, // who lends the bank money when it's short (an entity outside)
        funding_rate_bps: 500, // what that funding costs, a year
      },
      ctx.params,
    );
    const me = ctx.entity;
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

    return stepper(
      (obs: Observation) => {
        book.absorb(obs);
        own = own ?? ownAccount(obs)?.account;
        for (const tx of channels.transactions(obs)) {
          const list = inflows.get(tx.to) ?? [];
          if (tx.from !== tx.to) list.push({ t: tx.t, amount: cents(tx.amount) });
          while (list.length && list[0]!.t < obs.t - 90 * DAY) list.shift();
          inflows.set(tx.to, list);
          // Repayments: from a borrower's account into ours, set against their loans, oldest first.
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
        if (!acc) return steps;
        const kindOf = (e: string) => (book.entityKind.get(e) === "person" ? "person" : "organisation"); // (the directory says)
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
          const months = Math.min(p.max_months, Math.max(1, Math.floor(Number(a.data?.months) || 12)));
          const kind = kindOf(who);
          const rate = p.rate_bps[kind] ?? p.rate_bps.organisation!;
          const income = incomeOf(account);
          const already = current(who).reduce((x, l) => x + l.payment, 0);
          const assessed = repayment(amount, rate + p.buffer_bps, months) + already;
          const cap = Math.floor((income * (p.max_share_bps[kind] ?? 2000)) / 10_000);
          const holderOk = accounts.get(account)?.holder === who && accounts.get(account)?.custodian === me;
          const refuse = !holderOk ? "we don't keep that account for you" : amount <= 0 ? "it doesn't say how much" : defaulted.has(who) ? "you're in default on a loan with us"
            : behind(who) ? "you're behind on a loan with us"
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
              text: `${me} lends ${who} ${usd(amount)}, paid into ${account}; ${who} repays ${usd(monthly)} a month for ${months} months (${rate / 100}% a year).`,
              basis: a.id,
            })],
            say("loan_decision", `Loan application ${a.id} approved: offered.`, { to: [who], visible: [who, me], basis: a.id, data: { application: a.id, approved: true, amount, months, rate_bps: rate, payment: monthly } }));
          st.then = (out) => { if (out.created?.loan) loans.set(out.created.loan, { agreement: out.created.loan, borrower: who, account, principal: amount, payment: monthly, months }); };
          steps.push(st);
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
        return steps;
      },
    );
  },
};

