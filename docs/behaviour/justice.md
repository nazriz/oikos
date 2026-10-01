# Justice: the tribunal (`tribunal.member` v0.1.0, `tribunal.registrar` v0.1.0)

**Source:** `participants/src/behaviour/tribunal.ts`; the parties' side in `citizen.ts`, `firms.ts` (the landlord) and
`bank.ts` (garnishee orders). Design: docs/design/world-expansion.md §5. Figures: the profile's `justice`, with sources.

A law in the world binds nobody by itself: the engine never stops an act for breaking one (no laws in the kernel). A
law is enforced only if someone takes a breach to the tribunal, the tribunal decides, and the parties obey or someone
makes them. Each step is a person's, and each can fail. The tribunal is the state's (in the au-vic profile, a civil and
administrative tribunal on VCAT's model). No contract changes: applications, hearings, orders and enforcement are
records.

## The tribunal

| | Rule | Source |
|---|---|---|
| **Applications** | A party applies (`tribunal_application`) against another, of a kind it hears: a notice of rent increase said to break the law, or a debt unpaid. With it, a copy of the record relied on (the notice, the debt), since the tribunal can't see what passed between the parties. Anything else is rejected. | — |
| **Listing** | Listed for a hearing `hearing_after_days` (21) on, and both sides told (`hearing_notice`). The respondent may answer (`tribunal_response`) before then. | Placeholder (VCAT's times to finalise, to source) |
| **A rent increase** | On the day: the notice (the original if the tribunal can see it, else the copy), tested against the laws in force when it was given, as the landlord gave it (`breaches`, the law reader). Breaching: **invalid**, the rent stays as it was. Not: **valid**, dismissed. Not the respondent's notice to the applicant: dismissed. | The tenancy law's own words: "Or else: the increase is invalid" |
| **A debt** | The debt on the record (the applicant's, against the respondent), less what the respondent says it has paid: an order to **pay** it within `pay_within_days` (28), into the applicant's account. Nothing owed: dismissed. | Placeholder |
| **A charge** (0.2.0) | From the police, with what their investigation found. If it names the respondent: proven, and an order to make good the goods' value to the one they were taken from. | docs/behaviour/crime.md |
| **Enforcement** | A creditor whose order to pay is due and unpaid asks the registrar (`enforcement_request`). The registrar orders the debtor's banks (a `garnishee_order`) to pay what's unpaid from what they hold for the debtor. | Garnishee orders (Judgment Debt Recovery Act 1984 (Vic), to confirm) |

## The parties

- **Tenants** (citizen 0.26.0): given a notice of rent increase that breaks the law as they read it, they take it to the
  tribunal with the chance `challenge_bps` (the profile: 20%, a placeholder: few do). Meanwhile they pay the rent as it
  was. Found valid, they pay it from then. Found invalid, nothing changes for them.
- **Creditors** (citizen): a debt owed them (unpaid wages) still unpaid `apply_after_days` (30) on: they apply with the
  chance `apply_bps` (30%, a placeholder). If an order to pay goes unpaid a day past its date, they ask for it to be
  enforced.
- **Landlords** (firm.landlord 0.12.0): told their notice is invalid, they withdraw it as often as they comply with the
  law (`compliance_bps`). A landlord who doesn't keeps expecting the higher rent and, in time, may give notice for
  "arrears". That's unlawful, and real.
- **Firms** pay debts recorded against them as before. A debt settled from their account, by them or by their bank
  under a garnishee order, counts as paid, so it isn't paid twice.
- **The bank** (bank.payment_system 0.10.0) carries out the garnishee orders of the courts the world names: from the
  debtor's accounts it holds, up to the amount, to the creditor, settling the debt.

## In the small town

With the generator's laws, compliant landlords find a lawful date for every increase (a notice period, once a year), so
nothing reaches the tribunal. With a 5% cap on increases (as a council might pass on a tenants' petition), landlords who
don't comply raise rents anyway. In the test, with every tenant challenging, every unlawful notice was found invalid,
and half the landlords withdrew them.

## Leaves out (for now)

- **Possession orders, and a sheriff to carry them out.** No tenant in the world stays on past a notice: they leave
  when the term or notice ends, home or no home. Staying on until a possession order is behaviour to add, with a source
  (VCAT's possession applications), and the kernel already lets anyone remove a body (whether lawfully is content).
- Other kinds of case: bonds, repairs, discrimination, a challenge to a decision of the town, the bargaining tribunal
  (decisions.md).
- Appeals; costs; legal representation; the tribunal's own staff and time.
- Evidence weighed: the tribunal believes what the parties say they paid (no one lies yet).
