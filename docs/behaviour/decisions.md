# What a decision waits for, and how it is looked at again (`participants/src/behaviour/decisions.ts`; foundations F8)

**Source:** `participants/src/behaviour/decisions.ts` (the law's shape, `Waits`, `Reconsiderations`); the support office in `world.ts`
(`world.transfers` 0.10.0), the planning office in `institutions.ts` (`city.planning_officer` 0.11.0), the claimant's side in `citizen.ts`,
an employer's answer in `Staffing.confirm` (`firms.ts`), a venue's reading of the days in `desk.ts` (`Hearings`). The law's data: each
profile's `values.decisions`, with its sources. Plan: docs/design/foundations.md, law 5 and 6 (rows F8). Tests:
`participants/test/decisions.test.ts`, `orchestrator/test/foundations-laws.test.ts`.

Nothing here makes a decision wait, change or come out differently by itself. A law says what a decision needs, and what routes lie from it; an
office does the asking and the deciding as work with its time; a person asks for a second look or does not. The kernel knows none of it.

## The law, as data

The generator writes one published law, `law-decisions` (the higher government's), from the profile's list of rules. A rule is for a **kind of
decision** (the kind of statement the office makes: `benefit_decision`, `permit_decision`) and, where a place's law differs by payment, for
named `payments` only (a rule for named payments beats the rule for the kind).

| Field | Says |
|---|---|
| `needs[]` | what the decision waits for before it is made: `from` `claimant` (their papers) or `employer` (the claimant's last employer, found from the pay reports on the office's file), `what` in words, `within_days`, and `else`: `refuse` the claim, or `decide` on what is on hand |
| `review` | the office that made the decision looks at it again if asked within `within_days`; `grounds` in words; `required`: an appeal lies only after it |
| `appeal` | the matter a venue that can set the decision aside says it hears (`claim_refused`); `within_days` of the decision, or of the review's answer where a review is required; `grounds`; `fee` (hours of ordinary pay in the profile, money in the law) |
| `refused_by` | where the office is a head and staff (a model holds the office): `office-holder` (the head alone refuses; the staff put a claim that fails before them) or `staff` |

A route a place's law lacks is left out of its rule (no `review`: nothing to ask the office; no `appeal`: no venue is told to hear it). Where a profile has
no rule for a payment, the old behaviour stands (ask the other side; take it to a venue that hears it).

## What a decision waits for (the support office)

A claim arrives. The office reads the law for the claim's payment:

- For each `need` it has not yet asked, the office writes once: `evidence_request` to the claimant (`what`, `by`), or `confirmation_request` to the last
  employer that reported pay for the claimant (no employer on file: nothing to ask, and nothing waited for). Each is an act of the office with its performer's time
  (`publish/evidence_request`, `publish/confirmation_request`: placeholder rows).
- The claimant, on a letter asking for papers, sends `evidence` when they next act (a quarter of an hour of their time, `publish/evidence`); an employer's
  payroll office answers a request from its own books: `confirmation_answer` (in its employ now, ended on a day, or no record). Both are theirs to
  do or not: a seat in either chair may not.
- The claim stays on the office's file while anything asked for is out and not yet late. At its next round the office decides when everything has come, or a
  need's days have run: with `else: refuse`, the claim is refused and says what did not come; with `else: decide`, it is decided on what is on hand.
- **No delay is a parameter.** The days are a deadline, not a duration. How long a claim takes is the claimant's wakes, the employer's payroll office's, and the
  office's round (a code office wakes on what is addressed to it; its staff, under a standing order, at their daily round).

**What it does not do:** weigh the content of the papers (they are an act of sending, as a claim's declared facts are taken as stated); check the employer's
answer against the claim beyond its arrival. Nobody is asked about a person who was never on a pay report (informal work).

## A decision looked at again

A `review_request` (the one request every grievance uses) addressed to an office, `about` one of its decisions of a kind whose law has a `review`:

1. Inside the days the law gives: the office decides it again, on the facts then on file and without a slip (the performer who slipped is not drawn a second time on a case
   being looked at: a review is the office doing the work again, as work with its time, `publish/decision_review`).
2. It records what it found: **`decision_review`** (`decision`, `outcome` `changed` / `upheld`, `found`; the record's author and time say by whom and when) and answers
   the asker (`remedy_answer`, `granted`, `review`, `decision`).
3. Found wrong, the office puts it right itself: the support office writes the new `benefit_decision` (`on_review`, `replaces`) and starts paying from then; the planning
   office a new `permit_decision` and the liberty to build. Nothing pays or grants by itself.
4. After the days: the answer is no, and says the law allows so many. A second request about the same decision is answered from the first (the file holds the review).

A refusal that went wrong by a **slip** is found wrong because the facts on file say the claim qualified: the review recomputes the decision, it does not read a flag.
There is no record in the world that a decision "slipped" (the performer did not know); there is the draw in the log (`slip-publish/benefit_decision-...`) and the review's finding.
That is the whole of "a record that a decision went wrong by a slip": the first is the log's, the second the world's.

A venue that sets a refusal aside (`finding: set_aside`) is obeyed by the office the same way: it decides the claim again (`decideAgain`) and writes the decision.

## Appeal: the venue and the days

The tribunal says it hears `claim_refused` (and can set aside) only where the law has an `appeal` for it; the appeal's fee is the law's (one notice of what the
tribunal hears for each fee). An application's days are counted from the decision, or from the answer to the review where one is required; the citizen tenders both dates
(`decided_on`, `reviewed_on`). A venue that can order reads the law and turns away an application that is out of time (finding `rejected`, with the days), or that
lacks the review the law asks for first. The ombudsman (recommend only) is not an appeal and keeps its own terms.

## The places' routes

All recalled from the law of each place, **not opened**, and flagged in each profile's `sources` ("recalled, to confirm"; a figure with no source is a PLACEHOLDER). Confidence is mine: **M** (medium, a statute or guidance recalled with its section), **L** (low, a placeholder or an analogy).

| Profile | Review (days) | Appeal (days, to) | Fee | Needs | Confidence |
|---|---|---|---|---|---|
| au-vic | 91, required (authorised review officer) | 91, Administrative Review Tribunal | none | papers 14; employer (JobSeeker) 14, decide without | M |
| gb-eng | 30, required (mandatory reconsideration) | 30, First-tier Tribunal | none | papers 14 (a placeholder) | M |
| us-oh | pension 65, required (reconsideration); unemployment 21, optional | 65 / 21 | none | papers 10; employer (unemployment) 10 | M |
| de-ni | 30, required (Widerspruch) | 30, social court | none | papers 14; employer (insurance) 14 | M |
| jp-akita | none (examiner is apart) | 91, social insurance / employment insurance examiner | none | papers 14; employer (insurance) 10 | M |
| br-mg | none | 30, board of appeals | none | papers 30 | M (pension), L (cash transfer) |
| mx-jal | 21, optional | 45, administrative court | none assumed | papers 15 | L |
| ke-nakuru | none | 90 (Fair Administrative Action Act) | none assumed | papers 14 | L |
| in-tn | none | 30 | none assumed | papers 14 | L (placeholder) |

Every profile also has a **planning permit** rule: a 30-day second look by the office, a **placeholder** (no source opened).

## What is left out

- Late requests for good reason; a second officer for the second look (the deciding performer looks again: the sim has one office-holder for the post); costs, representation, and the further appeals (a court, a re-examination).
- Reviews and appeals for decisions other than claims for support and planning permits: lending (`loan_decision`), landlords' variation answers, funds. The class is general (`Reconsiderations(me, kinds)` with the office's `redo`); an office's decision kind is wired by giving it one.
- Planning permit appeals to a body that hears them: nobody in the town brings a permit to a venue yet.
- Whether a person asks for a review is behaviour, at the grievance machinery's rates (docs/behaviour/frictions.md), not a figure here.
- The waits of other offices (the desks' and tribunal's days, planning's incomplete applications, lending's minutes) stay as they were, as their own procedures.
