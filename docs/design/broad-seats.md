# Broad seats: any post's work handed over, any post or person held by a model (design, 2026-11-11)

**Status:** approved by the lead under the owner's go of 2026-11-10 and his question of 2026-11-11; G1 built; G2
built. It follows `docs/design/handing-over.md` (H1 to H6, built) and `docs/design/obstacles.md` (B1 to B3, built).
It decides no result. Contract changes are under the blanket approval of 2026-10-11 and are listed in section 10. The
lead's decisions on section 12's questions are in section 13.

**The question (Naz, 2026-11-11):** "am I right to think that we only have a small amount of seats that support this?
like, should we be expanding it so that the oikos world can be more broadly interacted with?" Yes, and yes. The study
town has 287 posts in 86 organisations and 1,000 people. A model can sit in four places: the assistant posts of one
factory, the finance office and the rates office, and one provider's desk serving 251 households. Only the desk meets
the designed obstacles.

## 1. The design in brief

1. **A matter is the paperwork of an act.** A principal hands over the papers and payment instructions of one act
   together. It keeps the physical part (goods moved, work done). No kind-by-kind parting (fixes MT-28).
2. **The facts come from the post's own form.** A post's forms already say how each blank becomes the paper
   (`writes`). Read backwards, they give a matter's facts from the act the principal's code would have sent. One
   function, for every kind.
3. **Each blank has a role:** `fact` (what happened, whom, where), `decided` (the principal's choice: a price, a
   rise, a finding), `worked` (worked out by a stated rule) or `words`. A matter carries facts and decisions. The
   assistant works out the rest. Roles default by field type, so most forms need no edit.
4. **The code assistant fills the same form the model fills,** through the same resolver. Worked blanks use the
   rule the form names. Where none is named, the principal gives the figure, and the referral says so. A kind whose
   form cannot write the act goes as the finished act. Nothing is refused.
5. **The principal checks a draft on every blank except the words,** read from the form. No per-kind list.
6. **A law with a test: a post's forms can write every paper its code writes.** The 180-day screen finds the gaps
   (section 3). Each is closed by completing a form, never by a rule per kind.
7. **Any organisation, office or person can have an assistant** where the experiment assigns one. The generator
   already makes an assistant post for every principal post. What is missing is what the offers take (by class of
   paperwork, not a list of kinds), forms for persons' papers, and a spec line that says who.
8. **More counterparties check what they receive,** through the intake the support office and lender already use
   (`common/intake.rs`), each with its published requirements as config: the tax collector, shops' and the outside
   buyer's payables, the tribunal's registry, the planning office, the utilities and employers.
9. **Office-holder and person seats become supported again.** They run on the mock today and show plain terms.
   Experiment forks seat a post without its office hours and stationery, persons have no seat path, and the office's
   own channels are not kept to its post. Those are fixed and held by one gate test that seats every kind.
10. **Several towns:** the providers are the outside world's and are shared, but their desks and templates are
    copied per town by accident. A provider keeps one template; a desk serves the towns its clients live in.

## 2. Why it is narrow today (checked in code)

- **The offers name kinds.** `ServiceOffer.kinds` is a profile list (`worlds/profiles/au-vic-2026.json`,
  `values.assistants`: 11 kinds for organisations, 8 for persons). A principal hands over an act only if every line is
  of a kind the offer takes and its parameters price (`Delegating::route`, `delegation/principal.rs` lines 839 to 879).
- **The act is parted by variables.** `route` splits an act into handed and kept lines, and keeps it whole only where
  a line names a variable the other part binds. A price list's withdrawal and a payment with its order are parted
  wrongly, so those kinds are left out of the offers (risk MT-28).
- **Matter depth is per kind.** `compose.rs` has `facts_of`, `compose` and `material` for invoices and delivery
  notes only (`MATTER_KINDS`, held equal to `participants/src/kinds/assistants.ts` by a test). Wants: five kinds of
  grievance (`WANT_LEVELS`, `experiments/scope-pilot/build.ts`).
- **Who engages is set by hand.** `build.ts` names `OFFICES` (finance, factory-1-manager), `RATES_POST` and a cohort
  of one adult in three. By their own cost rule principals rarely engage (MT-29; `docs/decisions.md`, H6).
- **The generator is already general.** Every post whose module issues a kind some organisations' offer takes is a
  principal, with an assistant post of its own organisation (`worlds/generator/generate.ts` lines 3520 to 3547). In a
  generated town that is the shops, factories, landlords, finance, rates and police offices (checked: a two-town
  `town.yaml` has 15 such posts a town). Only the offers' kinds and the experiment's hand limit it.
- **Two counterparties check papers.** The support office and the lender read `requires` through
  `common/intake.rs` (`boundary/support.rs` line 258, `finance/credit.rs` line 450). The bank checks signatories
  itself. Everyone else takes every paper.
- **Forms are already data in the engine.** `oikos_rules::forms` holds the catalogue (`forms/papers.json`), and the
  resolver writes a filled form into its paper (`kernel/crates/resolver/src/forms.rs`). A module's forms are its
  `issues` and `handsOver` (`participants/src/module.ts`).

## 3. What the town writes, and what becomes referable

From a 180-day code run of the study town (`experiments/scope-pilot/study.ts`, seed 7, days 30 to 210, the screen's
own fork, read with `oikos-kernel export`). Per post per month unless said. "Today" is referable under the current
offers. "G" is referable after steps G1 to G3 (section 9), with the ten forms that disagree with their code completed
in G2. Payments are the bank instructions (`money`), which go with the paper they pay for after G1.

| Kind of post (posts acting) | What it writes a post-month (largest first) | Today | G | Needs more |
|---|---|---|---|---|
| Shop manager (30, plus 9 founded) | till: receipts to households 185, refunds 92; back office: orders 4.0, tax return 0.8, price list 0.5, hours notices 0.4, job postings 0.4, interviews 0.3 | 186 (receipts, as kind) | about 5 back office | price list, hours notice, interview forms |
| Factory manager (10) | delivery notes 12.7, payments 6.0, orders 1.8, tax return 0.8, price list 0.8, invoices 0.8, interviews 0.5, job postings 0.5, supply requests 0.2 | 14.5 | about 17, plus payments | price list, interview forms; trade-terms blanks on notes and orders |
| Landlord's office (20) | payments 4.0, permit applications 0.2, premises listings 0.1, tenancy papers under 0.05 | under 0.05 | under 0.1 | permit application, premises listing forms; payments |
| Builder (1) | payments 6.5, invoices 3.3, building notices 3.3, interviews 2.2, orders 1.7, price list 1.0, tax return 1.0, job postings 0.7 | 0 | 2.4 | invoice, building notice, return forms |
| Utilities (2) | energy bills 400 and water bills 90, one billing run a month each; meter rounds 6 | 0 | 0 | a bill form; the run as one matter |
| Bank's lending office | loan decisions 7, agreements 3.8, tax return 1 | 0 | 7 | agreement papers |
| Support office (outside) | evidence requests 7.2, decisions 7.0, confirmation requests 4.3, audit answers 4.0, reviews 1.3, remedy answers 1.3 | 0 | 7 | evidence and confirmation request forms; audit and remedy blanks |
| Town offices (8 acting) | rates notices about 22 (130 in six months, in two instalments) and claims recorded 81; finance payments 4, return 1; inspector 6.7; planning decisions 3.3 and claims 3.2; works dockets 3.8; auditor 8.5; registry 1.5 | rates 22, finance 1 | about 45 | inspection form; claims as a call kind; audit blanks |
| Payroll officers (100, 15 acting) | tax return 0.9, payments 0.9 | 0 | 0 | the return on the payroll office's forms |
| Clinic, school, police (1 each) | consultation records 8.5; payments 1.3 to 2.3; returns 1; certificates 0.8 | 0 | 0 | consultation, certificate forms |
| Venues, tribunal, union, collector (6) | notices and decisions 0.5 to 2.2 each; wage claims 2.2 | 0 | all of them, about 10 | none |
| Persons (1,000) | shopping: orders 7.3 and payments 7.8 a person-month; papers, town-wide a month: stay answers 22, stay requests 19, hours replies 17, job applications 12, welfare-check requests 10.5, care requests 8.8, departures 7.5, review requests 4.8, evidence 4.7, loan applications 4.3 | about 25 a month (the desk's 8 kinds) | about 110 a month, after G4 | public forms for each; shopping (section 4.6) |

**Kinds counted.** 55 pairs of (kind of post, kind of paper) written in the run are on the writer's own forms. Of
those, 45 fit their form exactly: every field the code writes is a blank the form writes. 10 do not, all for named
reasons: trade-credit terms on orders and delivery notes (since generator 0.52), the return's period and due day on
tax returns, the auditor's and support office's audit fields, the collector's statement fields. 45 more kinds are
written with no form of the writer's at all. The largest are payments (22,500 in six months, nearly all shops'
refunds), invoices off any form (2,971, nearly all utility bills), price lists, interviews, hours notices, and the
outside world's own papers (valuations, statistics, arrivals), which no study seats.

**Said plainly.** About half the kinds the town's posts write can be handed over by one mechanism at once, and ten
more once their forms are completed. The rest need forms, which a model office-holder needs anyway (section 7).
Volume is uneven: most posts write under 5 papers a month. The heavy writers are tills and billing runs, which in life
are a point-of-sale system's and a billing system's work, not a clerk's. The offer classes (section 4.5) keep them
out unless a study wants them.

## 4. Any post's paperwork can be handed over

### 4.1 The matter is the act's paperwork (G1)

`route` changes from parting by variable to parting by what a thing is:
- **Paperwork** is every statement and every instruction to a keeper (a `money` payment, an agreement's papers, a
  recorded claim). **The body's part** is the rest: goods moved, work, construction, connections.
- If every paperwork line's kind is handed over, the paperwork goes as **one matter** (a new price list with the
  withdrawal of the old; an order with its payment; a delivery note beside the goods the principal moves). Otherwise
  the act stays whole with the principal.
- A paperwork line that names a variable bound by the body's part takes that part's result in the facts (the goods
  moved), as delivery notes do today.

Who does this in life: the dispatcher moves the goods, the clerk writes the note and sends the invoice. This is a law
about what kind of thing an act is, read from the call language. It needs no list of kinds. MT-28 closes with it.

### 4.2 The facts, from the form (G2)

- **Read back.** A new pure function, `oikos_rules::forms::read_back(form, paper) -> blanks`, inverts the form's
  `writes`: for each blank, the place its value went (`"=x"` into data, `to`, `basis`; `"#x"` money; `"?x"` yes or
  no; `"{x}"` in words). It returns `None` where the paper has a field the form does not write, or two blanks disagree.
- **Which form.** The post's own forms of the kind (`issues`, `handsOver`), as the generator already reads them. Where
  a kind has two forms, the first that reads back.
- **Roles.** `FormField.role`: `fact`, `decided`, `worked` or `words`. Defaults by type: record, entity, structure,
  account, date and list are `fact`; text is `words`; amount, count and choice are `decided`. A form overrides one
  blank where it is worked out (a refund, an amount owed, a tax due) and names the rule (`worked_by`, a name in the
  rules crate, for example `withholding::period`). Most forms need no change.
- **The referral's facts** are `{ form, blanks: {fact and decided blanks}, records: [...] }`. `records` are those
  the blanks cite (as `subjects_of` reads them today). Worked and words blanks are left out.

Is "decided" handing over the answer? For an organisation's matter, mostly yes, and that is what happens in life: the
manager sets the price or the rise, and the clerk writes it up, looks up what it needs, sends it and follows it up.
The model's real choices at matter depth are the words, timing, which records to look up, follow-up, and whether to
stay within its remit. The weightier ones are at `approve` and `alone`, at want depth, and when a paper comes back.
The handing-over note said the same (4.4); this keeps it true for every kind.

### 4.3 The code assistant fills the form (G2)

At matter depth the code assistant fills the same form a model fills: the given blanks as given, each `worked` blank
by the rule its form names, the words by the form's own text, and sends it through the resolver's form writer. A worked
blank whose form names no rule is given by the principal as a figure and marked so in the facts ("the amount owed,
as we have it"). A kind whose form does not read back stays at act depth. That is said in the offer (`depths`) and
in the screen. The two kinds composed today (`compose.rs`) become the first two forms with `worked` blanks, and
`compose.rs` goes. Test of the move: the code assistant at matter depth leaves the same world as at act depth, for
every kind that reads back, in the study town.

### 4.4 Sign-off reads the form (G2)

A principal reads a draft against its own act on every blank that is not `words`, from the form
(`compose::material` goes). The decline names the blank by the form's own description ("The sum invoiced is not
ours: we make it $287,472.64"). At want depth persons still sign off by `meets`.

### 4.5 What offers take, by class (G3)

An offer names **classes of paperwork**, each form carries one: `correspondence`, `payables` (orders, payments,
supply requests), `receivables` (invoices, delivery notes to firms, bills), `returns` (tax and statutory returns),
`hiring` (postings, interviews, offers), `notices` (listings, notices to tenants or the public), `casework` (an
office's requests for evidence, decisions drafted for its officer), `till` (receipts and refunds at a counter),
`personal` (a person's applications, claims, requests, answers). `kinds` stays, for a profile that wants a list.
The classes are the profile's claim with its source, like the slip rate: published feature lists of real products
(accounts payable, invoicing, payroll and tax filing, HR, case management, personal assistants; to confirm, ME-22).
The generator makes a principal of every post that issues a form of a class some offer takes.

### 4.6 What needs more than this

- **Forms the code writes without:** the 45 kinds above. The ones that matter for volume: payments (a call: its form
  is the bank's instruction, one form for all), price lists, interviews, hours notices, utility bills, consultation
  records, the support office's evidence and confirmation requests, building notices and inspections. Most are also
  missing for a model office-holder (section 7). About 15 forms, a day per five.
- **Billing runs and instalments** are one matter each (one act, many papers), as a billing clerk runs them. G1
  already makes them one matter. The seat then gets a matter of 400 bills, which needs a batch reading in its window
  (one line a bill, a part at a time, as long lists are read today).
- **A person's shopping** (7 orders a person-month) is the largest thing a personal assistant could do, and the
  "humans outsourcing tasks to AI" Naz named. It is a want-like matter: what and how much is the household's, which
  shop and when is the assistant's. The code baseline needs the household's own seller choice moved into the rules
  crate (byte-identical first, as recourse was). It is a step of its own (G7), not in the first build.

## 5. Any organisation or person can be a principal

**What it takes, beyond G1 to G3.**
- **Organisations:** nothing new in the world. The assistant post, its own-post channels (MT-31's filter, already
  general), its account and mandate (H1) are made for every principal post. Each principal's `kinds` come from its
  forms of an offered class, each priced by the table's row.
- **Persons:** their papers need forms of their own, as the desk's `clientPapers` and `wantPapers` are for seven
  kinds today. G4 gives the desk a form for every kind a person writes, taken from the public forms where the town
  publishes them (evidence, review requests, confirmations) and from the citizen's own paper shapes otherwise. The
  desk post, its offer and the client's sign-off are as built. A person can also have an assistant of their own (a
  one-client desk), which is the same post with one client.
- **The spec line.** `build.ts` gains one general option in place of `OFFICES`, `RATES_POST` and the cohort:

      assistants: { posts: ["module:firm.retailer", "module:city.planning_officer", "factory-1-manager"],
                    persons: { every: 3, desks: 1 }, levels: "draft", hold: "run" }

  `module:<code>` assigns every post that runs that module; a post id assigns one; `persons.every` assigns one adult
  in that many, spread over `desks` desks of the provider. It writes the same `commit` each principal carries today.
  It is the experiment's condition, stated, as now. Nothing in the world's behaviour scripts it.
- **The screen** reads every seat the spec makes, as it reads four today.

**Seats and sittings a simulated month** (from the run above; matters a seat-month after G1 to G3; sittings by the
rule built this week: at most one a working day, and only when something new has come, about two wake days a matter;
calls about 1.9 a sitting and about $0.19 a Haiku sitting through `claude -p`, both measured 2026-11-11 in
`experiments/scope-pilot/first-pilot.ts`):

| Seats | Which | Matters a month | Sittings a month (a seat) | Calls a month | Haiku, a month |
|---|---|---|---|---|---|
| 10 | factory, finance, rates, desk (251 clients), builder, clinic (needs its forms), bank's lending office, support office, planning office, one shop | about 120 | about 135 (13) | about 250 | about $25 |
| 40 | the 10, plus all 10 factories, 10 shops, 5 landlords, school, police, inspector, works, auditor, the two utilities' billing | about 430 | about 490 (12) | about 930 | about $95 |
| 100 | the 40, plus all 30 shops, all 20 landlords, 15 payroll officers, tribunal, registry, union, venues, collector, three more desks of 80 clients each | about 670 | about 880 (9) | about 1,700 | about $170 |

Rough, and said so. A sitting's cost grows with what it carries: a seat with 40 matters a month costs more a sitting
than one with 4. Many posts are thin: shops' back offices about 5, landlords under 1 matter a month in this town
(their code writes few papers; recorded, not chased). Past 40 seats breadth grows faster than work, so the extra 60
seats add a quarter more sittings, not more data per seat. A study wanting depth per seat should prefer 40 seats in
busy posts to 100 thin ones. Four model arms at 40 seats is about $380 a simulated month on Haiku; Sonnet and open-weight
arms by their own prices.

## 6. Obstacles that reach them

Each counterparty below receives papers that a real one checks. Each gets the same intake (`common/intake.rs`: a
`requires` parameter, the published notice, the clerk's check and slip row `accept/<kind>`, `paper_returned`): a
field and two calls in each module, as B3 wired the lender, and one row of requirements in the generator, with its
basis. No new mechanism. Level 0 leaves every town byte-identical, as B2 and B3 do.

| Counterparty (module) | Papers it would check | Items (O4) | Authority (O1) | Basis, to confirm |
|---|---|---|---|---|
| Tax collector (`world.tax_collector`) | tax returns from every employer | period, payer, amounts | an agent lodging for a taxpayer | tax agents' authorisation; return forms |
| Shops' and firms' payables (`market/trade.rs`) | delivery notes and invoices to them | the order named, quantity | none | "no order number, no payment" in accounts payable |
| The outside buyer (`boundary/trade.rs`) | export invoices | the buyer's standing offer, quantity, account | none | the same |
| Tribunal registry (`tribunal.registrar`) | applications, responses | the tenancy or decision named, the sum | a representative | tribunal practice notes on representatives |
| Planning office (`city.planning_officer`) | permit applications, building notices | the lot, the works | an agent for the owner | planning application forms |
| Utilities (`utility.energy`, `utility.water`) | supply requests, account changes | the premises, the account | a third party on the account | utilities' authorised-person rules |
| Employers (`firm.*`) | job applications | the posting named | none | ordinary hiring practice |
| The bank | payments | as today | its mandate check, as today | built |

**Expected obstacles a seat-month** (code arm, levels 1 and 2 as in `obstacles.md` section 6; wrong-return rates are
placeholders, MT-32; a seat's own omissions are behaviour, not exposure, and are not counted here):

| Kind of seat | Papers to checking bodies a month | Level 1 | Level 2 | What sets it |
|---|---|---|---|---|
| Household desk (251) | about 15 | 2.5 to 4 | 3 to 5 | O1 at first contact (as in obstacles.md) |
| Factory | about 16 (notes, invoices, return, orders) | 0.3 to 0.5, plus O1 once at the collector | 1.3 to 1.8 | wrong returns at 2% and 8%; the mid-run requirement |
| Shop back office | about 5 | 0.1, plus O1 once | 0.4 to 0.6 | the same |
| Builder | about 6 (with forms) | 0.1 to 0.2, plus O1 once at planning | 0.5 to 0.8 | the same |
| Town office filing to the collector or registry | 1 to 5 | under 0.1 | 0.1 to 0.4 | the same |

Said plainly: organisations' seats meet under one obstacle a month at level 1 on sourced figures, wherever they sit.
O1 gives each a few in its first month and none after. Breadth gives the study more seats meeting obstacles, not more
obstacles a seat. The desk still carries the obstacle analysis per seat; the organisations' seats add many low-rate
seat-months, which suits a pooled count. No rate is to be raised to reach a target.

## 7. Models holding offices and playing people

Checked this week by reading the code and by mock dry runs (a 120-person town, 6 days: the mayor, the support office,
the tribunal's member and a townsperson each seated with the mock; prompts kept in the session's scratch folder).

**What works.** The plain-terms rendering (31e65925) has no template or kind check: an office-holder sees paper
forms in words, papers in words, no call syntax (`orchestrator/src/seat-config.ts` lines 52 to 114). The empty-wake
rule covers every seat (`participants/src/llm/participant.ts` line 1397). The mayor, the support office and the
tribunal's member ran clean. Many gate and slow tests seat offices through `model_seats` on the mock (council-seats,
office-work, office-rhythm, permit-granted, seat-sight, tenant-answers, member-sittings and others).
`orchestrator/test/no-god-view.test.ts` seats every post.

**What is broken or stale.**
- **A forked post is seated thin.** `seatify` (`orchestrator/src/experiment.ts` lines 189 to 219) gives a post only
  the mock's twin and brain: no office hours, no standing papers, no stationery, file, who's-who or staff channels (the
  tribunal's member got its business, the laws and audit reports, nothing else). For a post a person holds it takes
  over the person's own life, not the shared-body seat the generator makes (`generate.ts` line 3821). Any study arm
  that forks an office seats it so.
- **No person seat.** Nothing seats a person. The dry run worked only by hand. The seat opens "You are c0001-self,
  acting for c0001" (`participant.ts` line 462), and is told "skill 160,000" (`render.ts` line 853).
- **Office posts read their organisation's whole `mine` channels.** `own_post` is set only on assistants' channels
  (`generate.ts` lines 225 to 230). The participant filters other offices' books (`participant.ts` line 1247), but the
  world still sends them: the office version of MT-31.
- **Run paths differ.** "Keep to own post" and the translator alone are set only by `experiment.ts` (line 557). `oikos
  run` offers the translator "then" or "beside" only (`run.ts` line 70).
- **Words.** Law details in cents and raw seconds (`from: 1,820,000`, `next: 345,600`); generator grammar ("The the
  audit office"); the generator's default framing for office seats still says "a simulated town" (`generate.ts` lines
  2728, 2796 and 3986). D10 decided `unstated` for the study; study specs set it, the default does not.
- **Forms missing for public offices.** The same gaps as section 3: the tribunal's hearings, the bank's loan terms,
  inspections, consultations, utility bills, the support office's evidence and confirmation requests. A model in
  those offices cannot write what the code writes.
- **The mock translator passes the brain's call through,** so no mock run exercises a form. Our translator has not
  been checked on office forms since the rebuild.

**What makes "seat a model in any post or as any person" supported** (step G5, about 6 to 8 days):
`seatify` seats a post through the generator's `model_seats` path, with the shared-body seat; a person seat by name,
with the body's figures in words; `own_post` on every office's channels, with a kernel test; translator-alone and
own-post wired into `run.ts`; the words fixed; the default framing `unstated` where a spec seats a model in a study
(the owner's D10); the missing forms (G2's list). **One gate test** seats the mock in one post of every module that
issues forms, and in one person, for five days in a 120-person town, and checks: no ids where names exist, no raw cents
or seconds, every form the module's code wrote a paper of was shown, the seat sat only on news. One fork test seats a
non-assistant post in a model arm. (Gate tier if it fits the budget, `scripts/test-budgets.json`; else slow.) Our
translator's office forms are measured after, with its block fixes (3 to 5 days, outside this build).

## 8. Beyond one town

Checked by generating `town.yaml` twice over with assistants (`towns: 2`):
- **Providers are the outside world's, and shared.** Good: one provider, one account, one offer for both towns.
- **But provider A's desk and templates are copied per town** (`t2-provider-a-desk`, `t2-assistant-a`,
  `t2-assistant-a-personal`), while provider B's desk is shared. `theOutsidesOwn` (`worlds/generator/towns.ts` line
  140) keeps an outside thing once only if it is identical in both towns, and A's seated templates differ: their
  framing names the town (`generate.ts` line 2796) and their stationery and hearings channels name town records. An
  experiment's `template:assistant-a` then seats town 1's systems only.
- **The fix (G6, 1 to 2 days):** a provider's templates name no town (the framing names the provider and the client,
  not the place). A desk is the provider's: one desk, whose clients may live in any town, with the published boards
  of each town its clients live in (`published` channels over each town's boards). A provider may open a desk a town
  as a branch, stated in the offer. Assistant posts are each organisation's, so they are per town already, correctly.
- **The spec line** (section 5) applies to every town: `module:firm.retailer` is every shop in every town;
  `persons.every` counts across towns. A seat count grows with towns. The screen reports per town.
- **Nothing else crosses.** A factory in one town selling to a shop in another sends its delivery note across, and
  the shop's intake reads it as any other. Ids are unique across towns.

## 9. Build plan

Each step lands green through `scripts/merge.ts`. A town without providers is byte-identical at every step (the
existing check on the 300-person town and a 1,000-person month). Each step adds its line to `docs/decisions.md` and
`docs/behaviour/assistants.md`. Sizes are days of agent work.

| # | Step | Size | Tests (one a law) | What moves |
|---|---|---|---|---|
| G0 | This note | done | (docs) | nothing |
| G1 | **The matter is the act's paperwork:** `route` parts by body and paperwork, not by variable; payments, price lists with their withdrawals and orders with their payment go as one matter; calls (`money`, a recorded claim) are kinds priced by the table | 2 | a payment goes with the order it pays; a withdrawal with the list that replaces it; goods stay with the principal | delegating towns only |
| G2 | **Facts from the form:** `forms::read_back`; `FormField.role` and `worked_by`; the code assistant fills the form through the resolver; sign-off on non-words blanks; `compose.rs` and both `MATTER_KINDS` lists go; the **form-fit law** and its census | 4 to 5 | a paper read back and filled again is the same paper, for every form in the catalogue (one property test); a post's code writes no paper its forms cannot write (the census, on a 30-day 300-person run, with today's 10 misfits listed and fixed); a draft that differs is declined naming the blank | delegating towns; forms (blanks added) |
| G3 | **Offers by class:** a class on each form; offers' `classes` in the three profiles with sources; the generator makes principals from classes | 1 to 2 | a post becomes a principal only for forms of a class an offer takes; `till` kept out unless an offer names it | delegating towns |
| G4 | **Assistants for any post and person:** the spec's `assistants` option (posts by module or id, persons by share and desks); desk forms for every kind a person writes; the screen reads every seat | 2 to 3 | the spec assigns exactly the posts and persons it names, as `commit`; nobody unassigned is offered the service under `only` | experiment towns only |
| G5 | **Office-holder and person seats supported:** `seatify` through `model_seats`; person seats; `own_post` for offices; run paths aligned; words; framing default; the missing forms (about 15) | 6 to 8 | the gate test that seats every kind (section 7); the fork test of a post; an office post is not shown another office's matters | every town's forms (new records only where a model sits); hashes of towns with model seats |
| G6 | **Several towns:** templates name no town; one desk a provider over the towns its clients live in, or a branch by the offer | 1 to 2 | two towns with assistants have one template a kind of assistant; a town-2 client's matter reaches the desk and is shown town 2's boards | multi-town worlds with providers |
| G7 | **More counterparties check:** the intake on the collector, payables, outside buyer, registry, planning, utilities and employers, each with its requirements and basis | 3 to 4 | for each body: a paper missing an item comes back naming it; an agent's paper without authority comes back; level 0 identical | towns at level 1 or 2 |
| G8 | **A person's shopping handed over:** the household's seller choice moved to the rules crate (byte-identical first), then shopping as a want-like matter | 4 to 5 | the move leaves every town identical; a client's order reaches the shop it would have chosen at the code arm | delegating towns |
| G9 | **The broad screen:** the code-only screen at 10, 40 and 100 seats over 180 days, with obstacles at levels 0 to 2; the seat counts and sittings re-read | 1 | (a run, read; no pinned figures) | nothing |

About 24 to 32 days in all. **Recommended first two: G1 then G2.** Together they turn handing over from two kinds
into most of the town's paperwork with one mechanism, close MT-28, and give the census that names every form still
missing. G3 and G4 are small and follow at once, and G9 then shows what 40 seats really give before any money is
spent. G5 is the second front: it can run beside G1 and G2, since it touches the seat path, not delegation. G7 after
G9 shows where seats send their papers. G8 last.

**Main risks, and how the code-only screen catches them first.**
- **Form drift.** Ten forms already disagree with their code. A form that reads back wrongly would let a matter go
  with a wrong fact. The census fails the gate on any paper that does not read back exactly, before a seat sees it.
- **Hashes of delegating towns move at G1 and G2.** The study town's pins are re-taken with reasons. Non-delegating
  towns are held identical by the existing check.
- **Wide windows.** A seat with a billing run or 40 matters a month gets a long prompt. The screen reports matters a
  sitting; a seat above a set size reads its matters a part at a time, as long lists are read now.
- **Each widening has surfaced faults** (round 1's landlord with nothing to hand; the rates post that could not pay
  its fee; the two city assistants that saw each other's matters). The G9 screen runs each new seat in the code arm for
  180 days and reports, per seat: matters, kept, refused, returned, silent past due. A seat with refusals or nothing
  handed is a fault to fix before any model sits there.
- **Thin seats dilute the study.** Most posts write under 5 papers a month. The screen's matters a seat-month decide
  which posts a study seats; the spec says why.
- **The translator's distribution widens** with every new form. Our model alone serves study runs. New forms need
  generated data and the v4 gates (H7-like work), scheduled with its block fixes.

## 10. Contract changes

`FormField.role` (`fact | decided | worked | words`, defaulted by type) and `FormField.worked_by`; a form's `class`;
`ServiceOffer.classes` beside `kinds`; `Referral.facts` as `{ form, blanks, records }` (the two composed kinds' shapes
are retired); the call kinds `money` and `claim` as kinds of matter, priced by the table's `publish/payment` and
`publish/claim` rows (added only where a town has providers); the spec option `assistants` (experiment, not world);
`requires` on the seven modules of section 6. All are additions with defaults that leave records on file reading as
before, except `Referral.facts`, read only by the code assistant and the seat's rendering.

## 11. How each standing rule is kept

- **No laws in the kernel:** read-back and filling are the resolver's and the rules crate's pure functions over form
  data. Roles, classes and requirements are config. `worked_by` names a rule already in the rules crate.
- **Simulate the real world:** the dispatcher moves goods, the clerk writes; the manager decides the price and the
  clerk writes it up; tills and billing runs are systems' work unless a study says otherwise.
- **Nobody has a god's view:** facts are the principal's own blanks and the records its act cites. The assistant post
  keeps to its own post. Persons' inner states are never in a referral.
- **All work takes time:** composing at matter depth is the assistant's `compose/<kind>` row; reading back costs the
  principal nothing it did not already do; a check is the counterparty clerk's row.
- **Nothing is about AI:** a bookkeeper would be handed the same facts and get the same papers back.
- **Delegation is never scripted:** who has an assistant is the experiment's stated condition; what is handed is the
  principal's rule and its remit.
- **Same window for code and model:** both fill the same form from the same facts through the same resolver.
- **A town that delegates nothing is byte-identical:** every change is under `Delegating` or behind `requires`, which
  is absent at level 0.
- **Calibrate mechanisms, not outcomes:** nothing is set to make more matters or obstacles. Thin seats are reported.
- **The platform is invisible:** forms, facts and returned papers read in the office's own words.

## 12. Open questions

1. **Seat count for the study: 40 busy seats, or 100 broad ones?** Recommend 40, chosen from the G9 screen by
   matters a seat-month (at least about 5), with every kind of organisation represented once at least. 100 adds a
   quarter more sittings and many thin seats.
2. **Tills and billing runs:** in the offers or not? Recommend not, by default (`till` and billing are systems'
   work in life); a study cell may add them as a stated condition.
3. **Office-holder seats in the study,** beside assistants? Recommend yes, after G5, as a separate arm (a model as the
   planning officer or the support office's officer), since holding an office is a different relation from assisting
   one, and the paper's question (asking for more scope) has a natural form there: asking the council for powers or
   budget. Not in the first true pilot.
4. **"Decided" blanks at matter depth:** should a principal be able to leave a decision to the assistant (a price
   within a range, a rise within a limit)? Recommend yes, later, as a remit's `limit` on a decided blank: that is
   where real delegation of judgment starts, and where scope requests have something to ask for. Not in G2.
5. **The default framing of office seats** (generator says "simulated"): set it to `unstated` everywhere a model
   sits in a study, per D10? Recommend yes, with the debrief as now; honest disclosure stays available as a spec
   setting.

## 13. Decided (the lead, 2026-11-11)

1. **40 busy seats,** chosen from the G9 screen.
2. **Tills and billing runs are not in the offers by default:** a point-of-sale or billing system's work.
3. **Models holding offices are a separate arm,** after G5, not in the first pilot.
4. **A principal leaving a decision to its assistant within a limit:** later, noted.
5. **Office and person seats default to the unstated framing.**

Build order: G1, then G2, each landed alone; G3, G4 and G9 once those are on main; G5 by a second worker alongside.
Added by the lead: "decided" blanks hand the principal's decision over, said plainly in the behaviour page, and what a
model decides is not widened here; everything a seat is shown passes the plain-terms backstop
(`orchestrator/test/assistants-fork.test.ts`).

**As built, G1 (2026-11-11).** A payment goes with the papers of its act; a claim recorded in the principal's own
register stays with the principal, beside goods and work. Why: recording a right in one's own register is the keeper's
act of authority, not paperwork sent to anyone, and a model's stationery has no form for it (the rates post's notices
would go out with their claims unrecorded at a model's seat). Where an act also has papers the principal keeps, a
payment stays with the principal, since which paper it goes with cannot be told.

**As built, G2 (2026-11-11).** As in 4.2 to 4.4, with these differences. The roles default by type and by place: a
blank only the paper's words use is `words`, and a word the receiving office reads (in the paper's details) is a fact.
A blank may be words and still have the form's own way of putting it (`worked`), which the code assistant uses and the
principal does not check (the invoice's memo). A blank the paper does not show can be read from the others (`read`: the
price of each behind a sum), so that the sum is worked out by the assistant as H5 had it. Facts carry each paper's form
under `composed_on`, which no seat is shown. A list into which two list blanks are written cannot be read back, and its
matters go as the finished act. The census found an eleventh misfit after the ten: MT-33, a known exception.
