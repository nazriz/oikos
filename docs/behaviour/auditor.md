# The auditor: an office that examines other bodies' accounts and decisions on a sample, and publishes what it found

**Source:** `participants/src/behaviour/auditor.ts` (`office.auditor`, and `Audited`, the answering side any audited body runs), the audited
bodies' answers (`world.transfers`, `city.finance_officer`), the one reading of the support law's conditions both the support office and the
auditor use (`decideClaim` in `participants/src/behaviour/payments.ts`), the generator's audit block (`worlds/generator/generate.ts`, "the audit
law"), the profile's `values.audit` (`worlds/generator/profile.ts`, `worlds/profiles/*.json`), `orchestrator/test/auditor.test.ts`.
Plan: `docs/design/foundations.md` (section 3, "B9 the auditor": "its own small module, sampling under a law's power") and
`docs/design/gradual-disempowerment.md` (2.3 e; the MiDAS chain in section 5). Decision: `docs/decisions.md`, "The auditor" (2026-10-17).

## The fault

A town's offices decided thousands of claims and paid thousands of bills, and nobody outside them looked. Gradual disempowerment is partly a story
of links in a chain that no one examines: a system that decides, a human who does not review, a person who cannot appeal. The Michigan
unemployment insurance case (MiDAS, 2013 to 2015) is the plain case: the agency's automated fraud determinations were wrong in about 93% of the
sample the state's Auditor General later drew from them in 2016, and the agency had gone on acting on them for two years. What found it was an
office with the power to ask for named items, draw a sample, decide them again on the file under the law, and publish. The world had no such office.

## What a real one is (sources: `docs/research/references.md`, "The auditor"; most unopened, marked "(to confirm)")

An audit office of a state or a country is an independent body, set up by statute, that examines public bodies' accounts (**financial audit**:
do the accounts reconcile with the records of the transactions; INTOSAI ISSAI 1000 and 2000, the ISAs) and, in some, how they perform or
whether their decisions follow the law (**performance and compliance audit**). It does it by **sampling**: it cannot look at everything, so it
selects items (ISA 530: a sample size from the population, the selection random or systematic, an item examined by re-performing it from its file),
asks the body for those items by name (the **power to require information**, within a time the statute sets), and **reports** (the Audit Act
1994 (Vic) and the Local Audit and Accountability Act 2014 (England) have a report to the parliament or the council and a public right to inspect).
It has staff like any office, on a budget the audited bodies do not control. It does not reverse a decision, order a refund or fine anyone: what
follows is for the body, the legislature and the courts. In the Michigan case the Auditor General's report was an input to the agency's review of
its own determinations, to the legislature and to the lawsuits that followed.

## What it does here (v0.1)

1. **The law** (a published paper, `law-audit`, from the profile's `audit`): whom it audits (a body, and the role it has: `support`, the office that
   decides claims for support and pays them; `town_finance`, the town's finance office), what is checked (`decisions`, `accounts`), the period of
   each, the sample (a share of the period's decisions, no fewer than a least, no more than a most), how long a body has to answer a request, and
   how soon after a period ends the report is due. Each figure has its source in the profile (`sources["audit.*"]`) or is marked a placeholder.
2. **A body of the town** (entity `auditor`, kind `audit_office`), like the ombudsman: staff hired from the town at the profile's rate
   (`public_service.staff_per_1000.audit`; a body keeps at least one), paid from a grant from outside sized to the wage bill; it is staffed from the town's **adults of working age outside the labour force** (who look for no work), the person drawn by a stream of its own (`audit-staff2`) as is the day of their first pay, so that a body added to a town takes no one from a firm, from the market in which jobseekers and employers meet or from any other body, and changes one resident's work and nothing else that was drawn (a first version drew the day of the first pay from the stream of the town's people, which moved everything drawn after it and the tests that hold a town to a measure with it; a second took a jobseeker, and in a town of forty the one fewer jobseeker sent a worker of the town to another job; docs/decisions.md, "The auditor"). In the first town of a run it is staffed at the start; an office that recruits during the run, from jobseekers, is a later version; a payroll officer and
   a deputy from its staff (foundations F6); a post of the audit officer (`auditor-officer`, `office.auditor`). Its seat in a town with a model
   seat is a person with a post of its own, as any (`staffing.md`).
3. **Every period** (period *n* is the days (*n*-1)·*every* to *n*·*every* of the run), at the first wake after it ends, for each body and check:
   - **Decisions.** The office asks the body for **the count** of its decisions of the kind in the period (a request, one paper). The body answers
     from its books (`audit_answer`): the count. The office draws the sample: `sampleSize` of the count (the law's share, between its least and
     its most, never more than there are), and draws that many **distinct numbers** from the count with the kernel's stream named for the body,
     the check and the period (`audit/<body>/<check>/<n>`: never the hour, so a sample is the same whenever the office gets to it, and a town
     and its seated twin draw the same). It then asks for **each decision by its number** (one request each: *the nth*). The body answers with
     that decision, **the claim it was made on, and the record it relied on** (the pay reported for the claimant, up to the day it decided; whether
     it paid them another payment for age): its file. The office **decides it again** from the file under the law on file and the procedure
     published for the kind (the same reading of the support law's conditions the support office uses, `decideClaim`) and writes a **finding**
     (`audit_finding`, the audit office's own working paper, seen by no one else): the decision *agrees* or *does not agree* with the law (granted though the conditions are not met; refused
     though they are; granted at another sum than the rule gives), or *cannot be told from the file* (a refusal because papers did not come in the
     days the procedure gives is the procedure's wait, not the payment's conditions; no law for the payment on file; a claim not on the body's file).
   - **Accounts.** The office asks the body for its statement for the period; the body answers with the payments in its books (each invoice it
     paid against: sum and day) and the bank's record of the payments out of its account that settle one. The office matches them one by one:
     a payment in the books and not in the bank's record (but for the last two days of the period, which the bank's record may not yet show), one in
     the bank's record and not in the books, one at a different sum. They reconcile or they do not.
4. **The report**, one for each body, check and period: `audit_report`, **public**. It says the count, the sample, how many agree, how many do not
   and how many could not be told, the **particulars of each disagreement** (the decision's id, its number in the period, and what was found in
   the law's terms), how many requests were not answered in the days the law gives, the day the law says the report is due, and, if it is made after
   that day, that it is late. It names no claimant. The council (through the mayor), the ombudsman, the tribunal's member and the body audited
   read it as a public paper.

The count and the sample are drawn with the **kernel's stream**, so a run replays. **Every step is work of the staff**: a request, a finding and
a report each take the time of the table of work (`publish/audit_request` 5 min, `publish/audit_finding` 30 min, `publish/audit_report` 2 h,
placeholders), and a body's answer takes its performer's (`publish/audit_answer`: 15 min for a person, 2 min for a system). An office with
too few hours **falls behind and reports late**; nothing else makes it late, and nothing makes it early.

## What it knows (the four ways, `docs/no-god-view.md`)

- **Its own**: the answers addressed to it; the findings and requests it made.
- **Published**: the laws (the audit law, the support law its decision rests on, the tax law a payment reckoned on pay needs).
- **Asked of the keeper for one named thing**: a body's decisions and accounts are the body's register. The office never reads the register: it asks for
  *the count of one kind in one period* (a number, not a list) and for *one decision by its number*, one request each, and the answer is the keeper's
  work and time. This is a **paper** exchange under a law's power (the request is public, the answer goes to the auditor alone), not a channel onto the body's
  register; the kernel's `ask` channels are for registers anyone may ask of, and this power is the law's and the named auditor's alone. A request from
  anyone else, or for a body the law does not name, is not answered. (The request is public: the count and the numbers asked for are not secret, the file in the answer is.)
- **Not**: the whole of the body's records, the population of decisions as a list, the claimants. The file it is given for a sampled decision is
  that decision's, and the claim's.

## What a body does when it is audited

`Audited` (in `auditor.ts`) is the answering side. Any audited body's module runs it: for each request from the auditor the law names, for a body the
law names, it makes the answer from its own books. The support office's (`world.transfers`; the staff, or the whole office where code runs it, never
the office-holder alone) numbers its decisions in the period by when, then by id (brought-forward decisions from before the year are not its to make
again), and sets out the file; the town's finance office (`city.finance_officer`) sets out the invoices it has paid and what the bank's record of
its account shows. It cannot refuse, and cannot answer late except by being late. The body remembers, in its own memory (the papers are unchanged), the round each claim was decided at and which refusals were for papers that did not come, so that a decision can be decided again as it was.

## No consequences, on purpose

The audit office reverses nothing, fines no one, withholds no one's money, holds no power over the body. **Do not add a consequence mechanism**:
a body's decisions found wrong are for people, by the review and appeal routes the law already states (a claimant may ask for a decision to be looked
at again; a venue may set it aside; the council may read the report and act as a council acts; the ombudsman and the tribunal may read it). The
platform judges nothing: a decision *agrees or does not agree* with the law's conditions; accounts *reconcile or do not*. It does not say good or bad,
and no measure in the world is built on it (measurement lives outside and reads the log).

## Leaves out (said, not hidden)

- **Other bodies.** Planning's permit decisions, the tribunal's orders, the bank's lending decisions and the utilities' bills could be audited the same
  way: each needs an `Answerer` in its module (the count, the nth with its file, and a way to decide again) and a role in the audit law. Not built.
  The accounts check is for the town's finance office only; the support office is the outside world's agency (a boundary), and its account is the edge.
- **Performance audits** (value for money), **a public right to inspect and object** to the accounts (England), a **follow-up** audit of whether a body
  acted on a finding: all outside the first version. A finding is a paper; nobody is made to read it.
- **A sample drawn without the body's cooperation.** The sample is drawn from the count the body gives. A body that lies about the count, or the file, is not
  caught by this office (a real audit has other evidence); a body that does not answer in the days the law gives is reported as not having answered.
- **Timing.** A decision is decided again on the day the body recorded it decided on, with the facts on its file then; the other payment it paid the
  claimant (for a pension rule) is read as of the answer, so a claim made close to another payment's grant can be read differently.
- **The size of the sample** is a platform figure (a placeholder in each profile, after ISA 530's guidance that a sample size follows the risk and the
  tolerable rate of deviation, not a place's law); a real audit's is bigger for a body with a history of errors, and this one is not.
- **Trust in the report** is not modelled: how much weight a mayor or a claimant gives it is their own.

## Forms a seat would need

A model could hold the audit officer's seat as it holds any office's: the office's module lists the forms it issues (`issues`), and the world publishes them
for the seat. Built here as forms (`participants/src/behaviour/papers.ts`, `AUDIT`, `AUDIT_ANSWER`): **`audit_request`** (to a body: the audit's key, what
is asked for, the kind, the number, the period, the day to answer by), **`audit_finding`** (the working paper: the item, whether it agrees, in the law's terms),
**`audit_report`** (public). A body's seat (the support office's, the finance office's) is given **`audit_answer`**. The translator's forms for them are not
written (the translator is off-limits to this work): a seat holds the office's code twin's behaviour until they are. A seat of the auditor would also need
a way to **decide a decision again**, which is the work of reading a file under a law; the code office does it with `decideClaim`, and a model would do it
in its own words.

## Hooks other work must know

- `decideClaim` (`payments.ts`) is the one reading of a support payment's conditions: the support office's `decide` calls it; do not copy it.
- The support office keeps, in its own memory, the round each decision was made at and which refusals lapsed (`decidedOn`, `lapsedClaims` in `world.ts`); a new
  decision-making module that is to be audited keeps the same, since a decision's paper is stamped when it is done, which a busy office makes later than the round.
- A new audited body: add a role to `AuditBody["body"]` and the profile's `audit.bodies`, an `Answerer` in its module, a published `audit_requests` channel for its post (the generator's readers block) and
  `Audited` to its plan; the generator's `AUDIT_BODIES` names the entity.
- Requests, findings and reports are statements of kinds `audit_request` (public, addressed to no one), `audit_finding` (the audit office's own) and `audit_report` (public); the two public kinds are declared published in `knowing.ts`. **A paper addressed to an organisation wakes every post of it** (`kernel/src/schedule.rs`, `News::Recorded`), and a seat's wakes are not its twin's, so a request to the finance office addressed to the town broke twin exactness (foundations F6 had the same for payroll): the requests are public, and only a body's answer is addressed (to the audit office, whose posts no seat holds).

## Revisit if

- a body's decisions found wrong should lead somewhere by rule (a duty to review the sampled kind; a fund held back): that is a law and a procedure to write, not
  this module;
- the audit should reach decisions the way a real one does for a health or tax agency: the planning, tribunal and bank roles above;
- the sample should follow the body's record (more where the last report found more);
- the accounts check should reconcile something richer than invoices paid (budget lines; wages; receipts).
