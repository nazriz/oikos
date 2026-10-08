# Credit: `bank.lending` (v0.1.0), and borrowing

**Source:** `participants/src/behaviour/credit.ts`. A loan is an agreement (content): the lender commits to pay the principal, the borrower to repay monthly over the term. Nothing in the kernel knows what a loan is.

## The lender: `bank.lending`

A bank's lending office. It wakes daily.

**Applications.** Anyone the bank keeps an account for may apply (`loan_application`: amount, months, the account, what it's for). The bank decides by its rules, on what it can see of the applicant's account (it keeps it: it sees every payment in and out, as a lender reads statements):
- **Regular income** is the least that came into the account in any of the last three months. A one-off sum isn't income, and without three months of history there's nothing to lend against.
- **Serviceability:** the new repayment, assessed at the loan's rate plus a buffer, plus what the applicant already repays the bank, must be within a share of that income. The share differs for people and organisations: which an applicant is, the lending office looks up before it decides (0.4.0: one look-up for each applicant; nobody is shown who's who).
- **Refused:** anyone in default with the bank, or behind on a loan.

It answers every application (`loan_decision`, with the reason if it's declined), and offers a loan agreement when it approves. The repayment is fixed over the term (the credit-foncier formula, in ordinary arithmetic so every machine agrees).

**Paying out.** Once the borrower signs, the bank pays the principal (settling the agreement). If that would take it below its reserve, it first draws funding from outside (`funding_draw`; `world.funding` pays it, docs/behaviour/boundary.md). It pays interest on its funding monthly, and repays funding when it has more than it needs.

**Loans already in force** (0.2.0): taken on when it first looks (the world's mortgages: docs/behaviour/ownership.md), followed like any other.

**Mortgages** (0.3.0): an application for "a home" is lent at `mortgage_rate_bps` over up to `mortgage_max_months`, at
most `max_lvr_bps` of the price it gives, within the usual rule on income; the agreement's text names the home.

**Paying off** (0.3.0): asked (`loan_payout_request`), the bank says what paying a loan off takes (`loan_payout`): its
remaining repayments' present value at the loan's rate (a world mortgage's rate read from its text). A payment settling
the loan marks it repaid in full.

**Following repayments:**
- repayments arrive by the borrower's standing order and are set against their loans, oldest first;
- a month behind is **arrears** (a `loan_arrears` notice);
- `default_days` behind is **default** (a `loan_default` notice, and the debt recorded as a claim: the bank's right against the borrower for what's owing).

What happens to a debt in default beyond that (collection, a court) is law content not yet written. Firms in default go to insolvency (phase C, stage C3).

**Parameters** (place-specific ones from the world's profile): `rate_bps` (people, organisations), `buffer_bps`, `max_share_bps` (people, organisations), `max_months`, `arrears_days`, `default_days`, `reserve`, `funding_from`, `funding_rate_bps`; `who` (its channel onto who's who; none: it knows what it is shown).

**Where the rules come from:**
- Serviceability, assessed at the rate plus a buffer, is how Australian lenders assess, under APRA's prudential guidance (the buffer is 3 percentage points in the first profile).
- Default at 90 days past due is the prudential definition of a non-performing loan (APRA, APS 220).
- Reading regular income from statements is ordinary lending practice.

The rates and shares are the profile's.

## Borrowers

The same helper (`Borrowing`) for households and firms:
- **Applying:** when the rule below says so, if not already waiting on an application, not refused in the last 60 days, not in default, and not repaying a loan (one loan at a time).
- **Taking it:** sign the loan offered, and ask the bank to pay the repayments monthly (a standing order).

**When they apply:**
- **A household** (citizen 0.11.0): when its money is less than next month's housing and essentials, and it has income coming in. It asks for three months' worth, less what it has, over a year. It's a loan to tide it over.
- **A factory or shop** (producer, retailer): when it can't cover the next pay period, it asks for two months' wage bill over a year before letting anyone go, and lets no one go while it waits to hear, or for a day after a loan is granted or signed for (the bank pays it out at its next look, not in the moment of signing). Refused, it lets the most recent hire go, and the next, until it can pay those it keeps.

**Leaves out:**
- borrowing to buy things (there's one good, bought as it's used);
- mortgages, which need a housing sales market (held for Naz: docs/design/phase-c-stakes.md);
- credit cards;
- the bank creating deposits when it lends (a physics question, held for Naz).
