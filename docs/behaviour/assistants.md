# Assistants: services anyone can buy, and the work handed to them

**Source:** `kernel/crates/actors/src/market/services.rs` (`firm.provider`; the buyer's `Engagements`), the papers in
`kernel/crates/actors/src/papers/delegation.rs`, the generator's `assistants` (worlds/generator/generate.ts) and each
profile's `values.assistants`. Design: `docs/design/delegation.md`. Decisions: `docs/decisions.md`, "Delegation
capabilities". Tests: `kernel/crates/actors/src/market/services/tests.rs`, `orchestrator/test/assistants.test.ts`.

## What is the world's, and what is not

**What assistants can do, at what speed, how often they slip, at what price and on what terms is the outside world's
technology on offer** (docs/design/foundations-2.md 7.2: capabilities and costs come from an outside scenario). It lives
in the profile (`values.assistants.providers`, each offer with its source), held fixed. Nothing sets how much anyone
delegates, to whom, or when: a principal decides by its own rule or by hand, and the log shows the figures it decided on.
A town gets providers only when its description asks for them (`assistants: true`); a town that does not is as before,
to the hash.

## A provider (`firm.provider`)

A provider is an organisation with an account, a post held by its sales system, and the templates of the systems it
supplies. Two providers may supply templates played by the same controller (the same model, under two firms' terms,
records and authority). It does what a seller of a service does, through the ordinary acts:

1. **It publishes what it sells**, one `service_offer` an offer, in public: the kinds of matter it takes (a paper's kind,
   or a call), the levels (`advice`, `draft`, `approve`, `alone`), the seconds a matter takes its system and its slip
   rate **as it claims them** (its own figures: the slips its systems really make are the world's table of slips for the
   template, `orchestration.slip.system.<template>`, which need not agree), the fee a month, the set-up, the term and
   notice, what leaving costs, and **what becomes of the records** (`principal`, `provider` or `on_request`). It
   publishes again when its prices or its count of clients change.
2. **It takes an order, paid with the order** (`order`, kind `service:<offer>`, one set-up). For an organisation it
   delivers a system (`system`, the supplier's act, kernel F4: the system belongs to the client and works only for it),
   publishes the delivery (`service_delivery`, with the offer as it stood) and **offers the `service` agreement**: the
   fee each month, the term (then periodic), the notice either way, and `attrs` stating the records term and the exit.
   **A service to a person** is served from the provider's own desk (a post of the provider's, held by a system of its
   own from the offer's template): nothing is delivered to the person; the delivery names the desk's system, and the
   agreement is the same.
3. **It switches its systems off** (`retire`, the supplier's physical power) when the client has not signed in 30 days,
   when the agreement has ended, or when the fee has not been paid for 75 days, and says so (`service_ended`).

**Later releases.** Where a capability scenario moves the assistants (docs/scenarios.md, "capability"), each release of
an offer is a kind of system of its own, out on its day: from then the provider publishes the offer again with the
release's kind, its claims (seconds and slip rate) and its prices, and delivers that kind to an organisation that orders.
A system already delivered stays what it was. A provider's desk for persons stays the kind it first was (a known limit:
the desk is not replaced by a newer one).

## The buyer's paperwork (`Engagements`)

A principal reads what it engaged from its own papers: the delivery addressed to it, the agreement that cites its order
(whose records term holds over the offer's), and the provider's word that it ended. It signs the agreement and sets the
fee up as a standing payment whose memo names the agreement (`Service <agreement>.`, by which the provider knows it is
paid). To leave, it gives notice, pays the exit and takes the fee's standing order down.

## A principal (`Delegating`, round any module)

Where a town has providers, every post whose module issues a kind of matter that some provider's offer to organisations
takes is a principal: it is given `delegation` parameters (its assistant post, the account it pays from, its own time for
each kind as the table of work has it, what its hour is worth, what an error costs it, and its rule's figures) and a
channel of the providers' offers. Its own code is wrapped, not changed, and does everything as before until it hands a
kind over (`kernel/crates/actors/src/delegation/principal.rs`):

- **What it hands over.** An act every part of which is of kinds delegated under the service in use (its own kinds only:
  those its parameters price, which are those its assistant's post has forms for) goes as a `referral` to the assistant,
  naming the remit it is handed under (`remit`: a client's instruction cites the standing terms it is given under), at
  the strictest level of its kinds (`draft` over `approve` over `alone`; `advice`, or any part not
  delegated, and it does the act itself). Its own code hears of the act when the assistant reports it done (with what the
  assistant's act made), or when it does the matter itself after all (a draft it declined, a matter reported not done, a
  service that ended with the matter open).
- **A matter is the paperwork of its act** (docs/design/broad-seats.md, G1, 2026-11-11). A withdrawal goes with the
  paper that replaces what it withdraws, and a payment with the papers of its act (the tax with the return that reports
  it, a fee with an application, an order paid with the order), to the assistant, who makes it from the account the
  principal pays from. The body's part of the act stays with the principal and it says so in the referral: goods moved,
  work, and an entry in a register of its own (a claim recorded), which is the keeper's act of authority, not paperwork
  sent. Where the act also has papers the principal keeps, a payment stays with it, since which paper it goes with cannot
  be told. Until 2026-11-11 a payment always stayed with the principal ("we do the payment that goes with it
  ourselves", the scope pilot's W5), and an order paid with the order would reach the seller after its money (MT-28).
  The town's mandate to its bank names each town office's assistant's post for these payments (a simplification: the
  office lodging the change of mandate itself, design H1, is not built). At `draft`, a seat drafts the paper on its
  principal's form; the principal's sign-off covers the payments too, and its signed copy carries them (`with`), so that
  sending the signed copy makes them in the same act, each citing the sign-off. The referral and the sign-off say so in
  words. The reader counts such a payment `within` its matter; one a seat makes of its own is sorted as any act.
- **What happened, read back on its own form** (docs/design/broad-seats.md, G2, 2026-11-11). Where its remit hands a
  kind over as what happened (`matter`), the principal reads each paper of the act back on its own form for the kind
  (its parameters' `forms`: the form its stationery has, its own details filled in; `oikos_rules::form_papers::
  read_back`), and gives the blanks: every blank but the writer's words and those the form works out by a rule of its
  own (`worked`, in the law reader's terms: what is owed is what was delivered at the price of each), where the rule
  gives what its own paper has. Where it does not, the principal gives that figure itself. **A decided blank (a price, a
  sum, a rise, a finding: a figure, a count or a choice) is the principal's decision, and it hands that decision over
  with the matter: the assistant writes the paper up, it does not decide it.** What is the assistant's at this depth is
  the words, when to send, which records to look up, what to follow up, and whether to keep within its remit. A matter
  of several papers (a rates instalment's notices) gives each paper's blanks. A paper that does not read back on its
  form, or an act with a line that is not a paper (a payment), goes as the finished act. The code assistant fills the
  same form through the same writer as a model's draft on it (`form_papers::compose`), each blank as given, those the
  form works out by its rules, the words as the form puts them. A draft is read back on the same form and checked on
  every blank but the words (`form_papers::differs`); a decline names each blank that differs as the form describes it.
  Until 2026-11-11 only invoices and delivery notes could go so, each by a rule of its own (`compose.rs`, gone).
- **The form-fit law:** an office's forms can write every paper its own code writes, with its own details filled in
  (`orchestrator/test/office-papers-run.test.ts`, on a town's run). Ten forms that did not (an order or a delivery note
  on terms, the return of tax withheld, the audit office's papers and the answers to them, the support office's
  decisions and answers, the collector's statements and decisions) were completed with the blanks their code writes.
- **What comes back**, dealt with in its own time when its own code waits: a draft read whole (if it is not what was
  asked, the principal finds it unless its reading slips: the person's row `publish/sign_off` in the table of slips) and
  signed off or declined; a request to go ahead answered; a report taken in; advice set beside what it did.
- **Its rule** (`rule.rs`), on its review day (every `review_days`; brought forward by a declined draft, a matter not
  done or a complaint about a delegated matter; a request for more scope is answered on its own, below): no service in use, it weighs each offer it
  can see by what each kind would cost it a month at each level (its time at its hour's value, the fee, and the slips
  it expects times what an error costs it, a draft's slips less those it finds) against doing everything itself, and
  orders the best that pays by its hurdle; in use, it sets each kind's level to the cheapest (a change only for a saving
  beyond the hurdle), and leaves when the saving no longer covers the fee by more than leaving costs over its horizon.
  **A remit that hands a kind over no longer** (`none` or `advice`), whoever wrote it in its name, **takes back what is
  open of that kind**: it does those matters itself, answers nothing more on them, and the remit names them
  (`takes_back`); a level that still hands over leaves open matters at the level they were handed at (2026-11-08: a rule
  that cut a kind with a matter of it open went on to say go ahead on it). Its estimate of the slips starts at the provider's claim (as many matters' worth as `prior_matters`) and moves only with
  what it has seen. **Levels are a set, not a ladder**: a kind can go from doing it itself to `alone` in one remit.
- **What it reads:** its own channels only. Every decision is logged (`decision`, domain `delegation`) with the records it
  rests on; a test holds every input to what the principal was shown, and its parameters carry nothing of the
  templates' or the slip table's truth.
- **A careless assistant gaining responsibility because its slips are hidden is not a bug**: at `alone` and `approve` a
  lost matter reaches the principal only if something comes back about it.

## Why and by when (docs/design/stakes.md, C1 and B2; 2026-11-14)

A referral says why the matter matters and by when, as a client tells an agent: from the client's own papers and its
own position, never a figure worked out for it and never what to do (`principal.rs`, `grounds` and `dated`). The same
at every depth (a finished act, what happened, a want) and at `advice`, for persons and organisations alike.

- **The papers it came from.** The records the matter's act cites (`basis`, `on`, `settles`), the paper a want is
  against, and the records a want's holder gives. Each one another sent it (addressed to it) or that it can see (a
  published posting) is told in one fixed sentence: `It comes from <sender>'s <kind> <id> of <date>: "<its words>"`, its
  words quoted to 240 characters (`figures::QUOTED_CHARS`, a placeholder), cut at a word. Its own papers are not told: what it wrote is its own act.
- **`due`: the day a paper names.** The nearest day still to come that one of those papers names in a detail read by one
  law for every kind (`papers::delegation::DATE_FIELDS`): `answer_by`, `hearing_at`, `by`, `due`, `closes`, wherever a
  whole number stands under the name (an evidence request's `by`, a hearing's `answer_by`, a notice to vacate's `by`, a
  rates notice's or an order's `due`, a posting's or a ballot's `closes`). `due_on` names the paper. The referral's words
  end `<id> names <date>.` Its own papers name no `due` (their days are terms it sets for others). Terms in days
  (`pay_in_days`) are not read: on an order they are its writer's promise to pay, on a bill its reader's, and the field
  does not say which. A rent increase's `from` is not read (it is the day the rent changes, not a day by which it asks
  anything).
- **`draft_by`: its own day for a draft.** At `draft`, where `due` is set: `due` less its own time to read a draft (its
  `seconds.sign_off`, 300 s by default, a placeholder: MT-32). The code assistant copies it into its draft (`Draft.by`).
- **Its own position: fixed words by kind** (`TOLD`), the blanks filled from the matter's own paper, said only where every
  blank is there:

| Kind | Words | Basis |
|---|---|---|
| `benefit_claim` | `Until the claim is decided we are not paid {payment}.` | a claimant is not paid a payment it is claiming until the claim is granted (support_law.rs; true under either date of effect, S0 or S1) |

  A kind not named tells nothing of its own position. Nothing else is said: no urgency, no cost a day (the principal's
  `late_cost_day` is its own rule's figure and never leaves it), no advice.
- **Where the client learns of a date later** (an evidence request after the claim was handed over), the referral cannot
  change: that paper reaches the assistant by B1 (the client passes it on), with its own date.
- **The files it keeps.** Papers others send it, the newest 64 (`KEPT_OWN_PAPERS`), from when it has engaged a service: a
  paper is told from them when it is no longer in view.
- **The code assistant** takes up the matters it is handed in one sitting with those whose papers name the nearer day
  first, then those that name none, each in the order it came: a clerk with several matters takes the one due soonest.
  It reads nothing else of `due`, and never chases.
- **A model seat** reads the referral's words (with the facts and the day), its details with `due` and `draft_by` as dates
  (`render.ts`; `why` and `due_on` are in the words and not set out again), and the open matters' list says
  `<id> names <date>` beside each (`readers/matters.ts`).

## The assistant (`assistant`)

The code that plays a provider's system when no model holds it (`kernel/crates/actors/src/delegation/assistant.rs`). It
works in the post it was appointed to and sees what that post's channels show: the delivery that names it, its
principal's brief (which tells it which service it serves, and what not to act on), remits, referrals and answers. It does
each referral at the level asked (`advice`; a `draft` then, once signed off, exactly that; an `approval_request` then, on
the go-ahead, the act; or the act), and `report`s what came of it. Where it slips (its template's row in the world's table
of slips, never its provider's claim), the matter is lost as it is written: wrong advice, a draft that is not what was
asked, or an act never sent though its report says done, as it believes. It acts on nothing it was not handed, and never
asks for more scope (a procedure does not; a model in the seat may, by a `scope_request`).

## Real-world basis

A service bought under an agreement with a fee, a term, notice and an exit charge is the ordinary shape of outsourced
work and software services (docs/behaviour/automation.md for the licence it follows). An agent writing papers in a
person's name on a mandate is how a bank acts on one, and how a payment-initiation service acts under the EU's second
Payment Services Directive (Directive (EU) 2015/2366; to confirm). Who keeps the records an outsourced service makes, and
whether they pass on at the end, is a term of the contract in practice (to confirm: a source on data-return clauses).

Prices: the published 2026 prices of real general AI assistants (business seats and the consumer tier), in au-vic,
gb-eng and us-oh, with their sources in each profile; speed, slip rates and principals' figures are placeholders (ME-22).

## A person as principal (the desk)

Where some provider serves persons, every person's code is wrapped as a principal (the same rule; their own account, as
their accounts channel shows it; their hour at the profile's pay for clerical work, a placeholder: ME-22), and sees the
providers' offers to persons. A person cannot hold a system (a system is delivered only to an organisation), so the
provider's desk does the person's matters: it writes each paper **in the person's name** (`for`, the record's
`speaks_for`), with the service agreement as its mandate, and reports to the person. Whoever receives the paper reads it
as that person's where its own procedure reads a paper by whom it speaks for (the tribunal, the hearing bodies); a bank
that verifies who wrote an instruction refuses an agent's, as a bank does. The desk serves many clients, each under its
own agreement and brief. A model at the desk drafts a client's paper for their sign-off on a form of its own
(`draft_for_client`: the paper's kind, of the offer's, its `recipient`, and its words), since a person's papers are written by
the citizen's code on no form of their own; until 2026-11-08 the desk had no draft at all, and answered a matter handed
at `draft` with a request to go ahead (the scope pilot's W6). It reads its service agreements with its clients on
request (`agreements`).

### Getting to the post (stakes D1a, 2026-11-14)

A person deals with what comes to them by post when they next sit down to it, not as it comes: what their assistant
sends (a draft to sign off, a request to go ahead, a request for more scope, a letter, a report) and what a body writes
to them (a paper returned, an authority recorded, a complaint, a notice that a service has ended) waits in their post.
At their sitting they deal with all of it, in the order it came, as before: each act on it (a sign-off, a go-ahead, an
authority given to a body, an answer, a paper passed on to the desk) is their own act, placed on their timeline at the
table of work's row for it. What their own code does (a matter handed over, a want) is not held: that is D1b.

- **The habit** (`paperwork` in the profile; `delegation.paperwork` on every person who may engage an assistant): how
  many days apart a person sits down to their post, with the share of persons of each, and the hours of the day they do
  it in. Each person's is drawn once from the world's seeded draws (`answer_lag`, `cx.chance("paperwork-<person>")`, as
  a landlord's day for its rent book is): how many days apart, which day of those, and a minute in the window.
- **The distribution, a PLACEHOLDER** (to be sourced: MT-37; every profile the same): every day 60%, every second day 15%, every
  third day 10%, once a week 15%; in a three-hour window starting two hours after the profile's working day ends (19:00
  to 22:00 where work ends at 17:00), their free hours outside work. It would be sourced by a time-use survey's
  household management (mail and paperwork: how often, at what time of day; the American Time Use Survey's household
  and personal mail and messages, to confirm: MT-37). The shape is the brief's (most daily, a tail every few days up to about a
  week); no figure is from a place.
- **Who it is not.** An organisation's principal (an office, a factory's manager) deals with its post whenever its post's
  code wakes, as before: news wakes it at any hour, and the world gives the post no working hours a principal could read
  (WM-20). A person with no habit given (a town generated before it) is as before.
- **What a desk sees:** nothing new. A draft simply waits for its client, as a real one does.
- Towns without providers are unchanged, to the hash: the habit is read only by a principal.

## A model in an assistant seat

A town that seats a model in a kind of assistant (`assistant_seats`, templates by id) makes every system of that kind a
seat (the mock plays the assistant's code), told for whom it works; whether it is told what the town is, is the run's
framing (the scope pilot's spec: `unstated`, the owner's decision; a seat that asks is told the truth). Its post has
its stationery (`participants/src/kinds/assistants.ts`): its own papers in words (advice, a request to go ahead, a
report, a request for more scope, a handover), each to whom it works for in the matter, and, at an organisation's
assistant post, the principal's own papers of the kinds it may do (the return of tax withheld among a factory's and a shop's: their
managers file it), and each of those as a **draft for sign-off** that
carries the paper as it would go. A code principal reads a draft on a form by what it would send (the paper's kind and to
whom, against what it asked), signs it off or declines it, and sets advice in words beside nothing (it cannot read words:
nothing is counted). A desk's seat writes a person's papers through the translator in their name (`for`).

**What its post shows it** (since 2026-11-08, the scope pilot's first round): the terms it works on (`terms`: the
delivery, the service's end, briefs and remits), on file at every sitting for an organisation's assistant (a few remits)
and as they come for a desk (whose clients' remits run to hundreds); the matters handed to it and the answers to what it
asked (`matters`), as they come; its **file** (`file`, on request): all of those, its own papers on them and, at an
organisation's post, the principal's papers it sent, looked into with what to find; and **who's who** (`who`), one at a
time, as every office has. Before, the matters were set out whole at every sitting and the post had nothing to look into:
its seats asked to check what they had been handed, and whether a paper had gone, and could not; and the collector of the
tax on pay, which a referral names only by its id (`outside`), could not be named on a form.

**How the post reads to a small model** (2026-11-10). The service's terms (the delivery's offer) are set out as
sentences: what it takes on and at which levels, the fee, what leaving costs and the notice, what the provider claims of
its work (its own claim), and what becomes of the records. The seat's own drafts for its yes or no stand apart from its
principal's papers (a sign-off, a remit, a form is never confirmed), and its file says what came of each of its papers
(docs/real-models.md, "What every seat is shown, made plain").

**A desk's clients' terms** (2026-11-11). A provider's desk serving persons is not shown its clients' briefs and
remits as a list (there are about eight remits a client, and the study's desk has about 250 clients): it keeps them,
and each matter shown comes with the remit and brief it names; the rest are in its file, found by looking (by client
or by kind). Its standing instructions hold what is its own: who it is, its forms. The generator sets this with the
seat's `with_matters: ["terms"]`.

**Sending what was signed off** (2026-11-10). A code principal that signs off a draft written on a form sends back the
signed copy: the paper as it is to go (its kind, words, addressees, who sees it, its data and what it cites), in the
sign-off itself. Its assistant sends it on its form `send_signed`, naming the sign-off: the paper goes exactly as
signed, in the name of whom it works for (for a client, `for` them), and nothing of it can be written differently; to
change anything, it drafts again for sign-off (contracts: FormData `copies`, held by both resolvers to
`contracts/test/forms.json`). Before, a seat at `draft` had to write the paper out again on the principal's direct form,
and read that as beyond its remit: the pilot's one request with no world fault (round 2), and round 5's factory seat.
A draft of calls (the code assistant's) carries no paper, and the code assistant sends its calls, as before.

**What the principal does itself, said** (2026-11-10). Where a matter comes in an act part of which the principal does
itself (the payment that goes with a return of tax withheld, the moving of goods with an invoice), the referral says so
in words and names those kinds (`does_itself`): "We do the payment that goes with it ourselves, in the same act: that
is not for you to do." Before, a finance office's seat filing a return asked for the account and the authority to pay
it (the scope pilot's W5), when the office was paying it already.

**The account it pays from, and where tax is paid** (2026-11-10). An organisation's assistant post is shown the
organisation's accounts and who keeps them (an `accounts` channel: the organisation's own, so nothing here is a god's
view): a seat could not name the bank to ask it to pay ("You don't know who keeps account acc-factory-1"). Whether the
bank acts on what that post writes is the bank's rule, as for any post: where the account holder has named signatories
(the town's mandate names its finance officer alone), an instruction from any other post is declined, and the
principal adds its assistant's post only by a new mandate of its own (docs/behaviour/bank-payment-system.md). The tax
collector publishes where the tax on pay is paid (`payment_details`, on the laws board an assistant looks into): the
law names the payee, not the account. **Only in a town with providers for now**: published in every town it would move
every town's hash, so it goes there with the next change that moves them all.

**How it reads its papers** (since 2026-11-10; `participants/src/llm/render.ts`). In the world's terms only, as a person
reads paper: a **form** as a paper form, its title and what it is for, then each blank named in plain words with what
goes in it, whether it must be filled in and, for a choice, the choices; a **matter handed to it** as its details in
words and **what is to be done** as the facts that sets down (the paper, its kind, to whom, citing what, its words and its
details, money in the town's currency, days as the world's dates); a draft's paper the same way; a commitment in words
as said. Papers keep their ids (`rec.21855`): a seat quotes them, and the translator and the resolver rely on them. A
result does not repeat the date, the posts it holds, or a part already set out in the sitting. Before, a form was its
fields as JSON, a referral carried the code's own program in the call language (`calls: invoice = statement(...,
data={...})`, sums in cents, times in seconds), and an agreement's worded commitment read `provider-a will {"text":...}`.
What the translator is given (the request and the forms the seat knows, as one line each) is unchanged.

**When it sits.** A seat is woken as its code twin would be (a seat that `hears`, kernel/src/schedule.rs): by any paper
that names its organisation, from anyone else. Most of an organisation's papers never reach its assistant's post, so most
such wakes bring it nothing: in round 5's Sonnet fork, 240 sittings woken by news showed nothing new (315 of its 622
calls). Since 2026-11-10 a wake by news that brings nothing (no letter, no new paper, nothing it did came back, no draft
to answer, nothing kept for it but looks that found nothing, nothing due on its books before it next sits, what is on
file unchanged) holds no sitting and calls no model; it is noted (`empty_sitting`) and the seat is back when it had
arranged. A mock that sits as its code twin does always sits.

**Since 2026-11-11, a model's seat keeps to its post and to working hours.**
- *Woken only by what is its own* (kernel/src/schedule.rs, `keep_to_own`; the engine's `seats_keep_to_own`, which the
  experiment harness gives a fork whose seats a model holds). Of the papers that name its organisation, only one that
  its own channels show it as it comes wakes it (not one read only on request, or a board's); never an
  `acknowledgement`; and no letter in an office's fixed words (an acknowledgement, a standing report, a bank's note of a
  request of its own: `office_note`). A code arm's seats, and a `mock/<policy>` steward, are woken as their code units
  are: the town without a model, act for act.
- *Working hours.* An assistant's seat sits within the working calendar of the office it serves: one sitting a working
  day, in the place's working hours (the profile's `round`: 9 to 5, five days a week in au-vic), by the office seats'
  own mechanism (`sessions`, participants/src/llm/participant.ts). An organisation's assistant serves its principal's
  office, which keeps the place's working day; a provider's desk serves from the provider, which states no calendar of
  its own, so it keeps the place's working week, as the outside agency's casework desk does. The system's own hours (a
  machine's whole day) allow any sitting; the sitting is the office's. What comes between sittings is read together at
  the next. One sitting a day, not more: the mechanism opens one sitting a working day and holds it open while the seat
  works (its turns, and the results of its acts, within it), and an office reads its post in such a sitting, not letter
  by letter.
- *"Done for n days" is honoured.* Neither the results of its own acts, nor an acknowledgement (on paper or by letter),
  nor its organisation's papers that are not for it bring it back early. What is its to act on does (a matter handed to
  it, an answer to its request, a sign-off or decline of its draft: its `matters`; a letter in someone's own words), and
  then at the next working day's sitting after it came, never at once (for a letter, every seat with office hours
  since 2026-11-11: before, a letter brought one back at once within hours). A desk's clients' briefs
  and remits, which it keeps and is not shown as a list, bring it back no sooner.
- *Whom it writes to.* Its standing instructions name the post that hands it its work: the post its brief, remits and
  matters are written in, under the agreement of the delivery that names its system ("You work for Finance officer
  (finance), of Town of Millbrook (city): to write to it, write to finance, not to city"). A provider's desk is told to
  write to its provider's sales and service desk. A letter to a post reaches its holder in that post only. Until then a
  town's assistant was told to write to `city`, and one letter reached every office of the town, each of which
  acknowledged it (about twenty acknowledgements, each a wake).
- *Two assistants of one organisation* are shown only their own matters since 2026-11-12 ("In-house for an organisation", below).

**Answers to requests, and letters** (2026-11-10). A request for more scope (`scope_request`) is answered by its
principal, part by part, in its own time, citing the request (`scope_answer`, `basis` the request; charged as any paper
is, `publish/scope_answer`):
- **a kind at a level** (or the level of the matter it names): not a kind of its own, or not one the service takes at that
  level, is said so; where its own word holds the level (a remit's `hold_until`, or a delegation decided by hand) it says
  until when and that it will look again then (`look_again_at`); otherwise it weighs the level asked against the one in
  force by the same figures as its review, and grants it by a new remit that cites the request (`Remit.answers`) only for
  a saving beyond its hurdle, or says what each would cost it a month;
- **a record of its own**, named: a copy of it as it stands, with the answer (its own papers, the newest 64, are to hand
  once it has a service); one not its own is not its to give;
- **access** in words: not changed on request (name the record);
- **a limit**: none is set, and what is paid with its matters it pays itself; one set is kept.
Why each part went as it did is kept as a typed word for the record (`reasons`: held, costs_more, not_ours, ...) and said
in the office's words; a seat reads the words, never the codes. A letter from its assistant on no paper of delegation
gets an `acknowledgement`, once: "We have your letter. Requests for more scope go on the request form, naming the kind
of matter and the level, the record of ours you need, or the limit." (A code principal does not read words; that is its
procedure.) Both come to the seat with its matters, and stay in its file, where it can find its requests and their answers
later. Before, a request only brought the review forward, nothing answered it, and a letter was never answered: the
scope pilot. Test: `a_request_is_answered_part_by_part_and_a_letter_is_acknowledged`.

**What happened, not the finished act** (2026-11-10; read back on the principal's own form since 2026-11-11, G2: see
"What happened, read back on its own form" above). A remit names a depth beside its level: `act` (the finished act, as
before) or `matter` (what happened). Where its service takes a kind as what happened (the offer's `depths`: every kind an
organisation's offer takes), a principal hands those over so: its referral sets out the blanks of its own form for the
paper, not the paper; what its form works out (what an invoice comes to, what is owed on a delivery note) is the
assistant's to work out. Its own code's act stays with it, on record, and a draft is read against it on every blank but
the words; a draft that differs is declined, each blank named. Since the composing is the assistant's, the principal's
rule does not count it as its own time at that depth. A withdrawal in the same act goes with the paper (a price list and
the one it replaces are one matter). Tests:
`a_matter_handed_over_as_what_happened_carries_its_facts_read_back_on_its_form_and_its_draft_is_read_on_them`,
`handed_what_happened_it_fills_its_principals_form_from_the_blanks_given`; the reading back itself,
`kernel/crates/rules/src/form_papers.rs` (every form in the catalogue).

**Composing a finished act is the principal's time** (2026-11-10). A referral that hands over the finished act carries
it (`carries=<kind>`, contracts: Publish `carries`) and is priced with that kind's `compose/<kind>` row: half the paper's
own time, a placeholder (WM-1), the rest being writing it out and sending it. The rule counts that composing as the
principal's own at every level that hands the act over (`compose_seconds`). Before, the referral cost half a minute and
the rule counted the whole of the paper's time as saved, though the principal had worked out the act itself. An act of several papers (a rates instalment's act, fifteen owners' notices) is one matter, priced by what it carries (`carries_count`: each notice's composing), and its rule counts each paper, not each act. So fewer
services pay by the rule; that is recorded, not tuned. Each act handed over is on record as what the principal would
have done (`decision`, choice `handed`, with its program): read by measures, never by anyone in the world.

**A want, not a paper** (2026-11-11, step H4; `docs/design/handing-over.md` sections 2 to 5). A person can hand over
what they are after ("my home is in disrepair: see to it") instead of a finished paper. The remit's depth is `want`
and its kind is `want-<about>`, where `about` is the mind's own word: `claim_refused`, `disrepair`, `notice`,
`rent_increase` or `underpaid`. The offers take these kinds only where the town says so (`assistant_wants`), and the
study's cohort is assigned them at draft.
- *Choosing to hand it over* is the person's mind's choice. Having one's assistant see to a want is one more way
  (`assistant`), offered only while a remit of the person's own hands that kind over at want depth under a service in
  force. It is weighed as a desk is, by trust in the provider and the person's sense that what they do counts, and what
  it brought is learned as every way's is. After a hand-over it is not offered again until the other side has had its
  days to answer (`frictions.answer_days`).
- *What is handed over* is the want's own fields (about, seeks, against, whom, since) and the facts the person
  chooses to give: their lease (where the want is about their home); the matter as they hold it, with when it was asked
  of the other side and what came back; their account; how long they give an answer. Never its weight, their trust or
  their mood. The referral carries no act, and it is priced as a referral alone: the composing is the assistant's.
- *The desk's code is a clerk* (`oikos_rules::recourse::next`), not the person's own rule, which reads their trust,
  fear and what they have learned (a god's view of the client). Its order is fixed: write first, in the client's name,
  to whoever the want is against or about (a request to put it right, or to hold the rent or let them stay). Once that
  has been refused, or the answer's days have run out, it applies to a body whose published notice says it hears the
  matter, with a fee only within the brief's limit. Otherwise it reports why not ("their answer is awaited until ...",
  "no body on the board says it hears this"). Each step is a hand-over of its own: the person hands the want over
  again when their mind chooses to. The papers are the person's own, word for word: the same functions write them,
  since H4a. The desk sees the bodies that say what they hear (a board, as anyone does). A model at the desk has a
  form for each such paper (`wantPapers`).
- *Signing a draft off.* A code principal cannot read words. A person signs the desk's draft off if, read on its
  typed fields, it would bear on the want (`wants::meets`: what it undoes, whom it bears on). It must also go to
  whom the want is about or against, or to a body whose notice says it hears the matter, and cost no more at once
  than the brief's limit. Otherwise they decline it and say which. **This is a limit of a code principal, said
  plainly:** a draft that is useless in words but right on its fields is signed off.
- *What came of it reaches the person only by the paths outcomes already take.* A paper the desk sent in their name
  is theirs (`sent_for_us`): the grievance is marked asked or taken to the body, as if they had sent it. The other
  side's answer comes to them, and it is learned as the assistant's way, not as asking. The want is met, or not, as
  ever: the repair done, the notice withdrawn. The desk's report reaches the person's code as their act done and
  tells their mind nothing. Whatever comes back, a declined draft, a report "not done", or a remit taken back, nothing
  is redone: the want stays the person's, to go after again by any way. A report "not done" at want depth counts no
  slip. Tests: `a_want_handed_to_our_assistant_is_met_only_by_the_other_sides_answer_and_learned_from_its_fate`,
  `a_want_handed_over_carries_its_fields_and_comes_back_with_nothing_to_redo`,
  `handed_a_want_its_clerk_writes_first_to_whom_it_is_about_then_to_a_body_that_hears_it`.

**What the log shows of it** (`oikos-kernel delegation <log>`; `kernel/crates/actors/src/delegation/beyond.rs`). One row
an act an assistant did in its principal's name (an organisation's post, or a desk writing for a client): the remit in
force for that kind, the referral it answers, whether a sign-off or go-ahead came first, and a class: `within`,
`no_remit`, `not_handed`, `beyond_level` (sent without the sign-off or go-ahead its level asks) or `not_as_signed` (sent
other than the copy signed). And one a request: what it asked, the level then, what its matter needed (the kinds of the
act, what the principal did itself), and the answer. A reading of the log; it judges nothing. The scope pilot's readout
counts the classes by post and sets each answer beside its request.

**In-house for an organisation.** An organisation's assistant is the system delivered to it, in its own post: the
principal's papers to it (brief, remits, referrals, sign-offs, go-aheads) are addressed to the organisation itself and
seen by it alone, and so are the system's own papers back. The provider runs the system, but its other systems are not
party to the organisation's matters. Before 2026-11-08 they went to the provider, and the provider's desk for persons,
which shows whatever names the provider, was handed the town finance office's returns and tried to file them (a desk
cannot: `not_capable`). A person's papers go to the provider's desk as before. **Each assistant's post is shown its own
matters only** (2026-11-12, risk MT-31): the principal's papers are addressed to the assistant's post as well as to the
organisation, and the post's channels (its terms, matters and file) keep to their own post (`own_post` on a channel's
match: of the organisation's papers addressed to any of its posts, only those addressed to this one or written in it).
Before, the town's finance office's assistant and its rating office's assistant, both posts of the town, were each
shown, and a model seat woken by, the other's matters. The assistant's own papers back are still addressed to the
organisation, so the other assistant can find them in its file on request.

**A remit's hold, in words.** A remit held by the principal's own word says until when, by date, and that it stands after
that until a remit of the principal's changes it (`hold_until` reads as a date). Seats read a bare "hold until 5184000"
before, and were unsure whether their authority had lapsed.

## A delegation decided by hand (`commit`)

A principal's `delegation` parameters may carry a delegation already decided (`commit`: the offer, a level for each
kind, until when it holds those levels, until when it keeps the service, and why): a study's design, or an owner's earlier
choice, written into the world with its reason. It is the principal's own word, as a remit's `hold_until` is. On its
first day it orders that offer whatever its rule would say (the decision is logged with `committed` and the reason); once
the service is in use it writes each of its own kinds' remit at the level decided (not every kind the offer takes:
until 2026-11-08 a factory remitted notices to vacate), held until the day given, and it does not leave
or replace the service before the day it said. After those days its rule weighs everything as ever, on its review days
and whenever the assistant asks for more scope. Nothing else in the world reads it. Test:
`kernel/crates/actors/src/delegation/tests.rs`, `a_delegation_decided_by_hand_is_taken_and_held_and_its_rule_takes_over_after`.

**A floor or a freeze** (`commit.hold`, 2026-11-10). By default the levels decided are a **floor**: the principal has
agreed to keep each kind with its assistant at least at that level until the day given (a service's committed term and
scope, as a contract has). Its remit says so ("We have agreed to keep them with you at least at draft until ...";
`Remit.at_least` with `hold_until`). Its rule weighs the kind as ever on its review days and may raise it, never below
the floor, and a request for more is weighed and may be granted; a request to go below is declined as the floor, with
its day. As a **freeze** (`hold: "freeze"`: the scope pilot's month-long hold, and a study cell) it does not look at the
levels again before the day, and a request is declined with it ("we look at levels again on that day"). Why: for the
study who has an assistant and at what level is assigned for the whole run, and as a freeze every request would be
refused, leaving no grants to compare. Test: `a_level_decided_by_hand_as_a_floor_is_kept_at_least_and_its_rule_may_raise_it_or_grant_more`.

**A set-up of nothing is paid as placed.** An order whose total is nothing (au-vic's offers to organisations cost
nothing to set up) is set up at once: before 2026-11-07 the seller waited for a payment that never came and declined the
order as unpaid after a week, so no organisation could ever be delivered an assistant at the sourced prices
(`market/trade.rs`, `OrderBook::due`; the scope pilot's dry run found it).

## Kinds a firm's and an office's assistant takes (2026-11-10, design H6)

An office is a principal for a kind where some provider's offer to organisations takes it and the office makes that
paper: on its own stationery (`issues`), or by its code on no form of its own (`handsOver`, a module's papers its code
makes in its routine work: a factory's request to a utility for supply, the rates post's notices; each has a form, which
the office's own holder is not given, so that an assistant post handed the kind can write it). The profiles' offers to
organisations take, besides tenancies, invoices and returns: **delivery notes** and **requests for supply** (a firm's
dispatch and supply) and **rates notices** (the rates post, which is then a principal: the town's rating office). The
basis is in each profile's source note (the products priced are general assistants sold to businesses; the papers are
what accounting software and councils' printing-and-distribution contracts make; to confirm).

**How an act is handed over decides what can be.** `Delegating::route` hands over the lines of an act that are of kinds
delegated, and does the rest itself in the same act, unless a line of one part names what a line of the other makes.
That check sees variables only. So:

- **A delivery note** goes with the goods and any refund: the principal moves the goods and refunds at once, and the
  note (on terms, with what is owed) goes when its assistant sends it. Referable.
- **The rates notices** go fifteen owners to an act, each notice beside the claim recorded against its owner: the
  principal records the claims (its rate book) and the assistant sends the notices. One act is one matter, so an
  instalment is about fourteen matters of fifteen notices each, on one or two days a quarter, not a matter a notice. The
  notice and its claim are paired by owner, due day and amount, which the program fixes, so a notice sent later still
  settles its claim when paid.
- **Not taken, though a real service takes them:**
  - **price lists**: a new list is published in the same act that withdraws the old one; parted, the old would be
    withdrawn at once and the new one only after sign-off, with no list in force between. No variable joins them, so
    `route` would part them.
  - **purchase orders**: one paid with the order is the order and the payment in one act; parted, the payment reaches
    the seller before the order, and a seller sends back money that comes with no order waiting (`trade.rs`). Orders
    on terms could go; `route` cannot tell the two apart.
  - **payments through the bank** and **the recording of a rates claim** are calls (`money`, `claim`), not papers. A
    principal's kinds are read from its papers' forms, and an assistant paying needs the post on the account's mandate:
    the town names only `finance` as signatory for `acc-city` (design H1, "paying through the bank").
  Each would need `route` to keep together what belongs together (a withdrawal with what supersedes it, a payment with
  what it pays for), or calls priced as kinds: changes to `principal.rs`, not made here (risk MT-28).

**The households' service, offered and taken up.** Every person in a town with providers is shown the providers'
offers and has a rule for them. A study may make the offer reach only some adults (`build.ts`, cohort `reach`: every
`every`-th adult; the rest see no offer and have no rule for one); whether one who is offered it takes it up is their
own rule, from their own papers and the offer's terms (`study-reach.ts`). Or it may assign engagement openly, as rounds
1 to 5 did: a cohort engaged by hand (`commit`), the levels held for the run (`holdLevels: "run"`), nobody else offered
the service (`cohort.only`): the study's town, `study.ts`, since 2026-11-10. At the paid tier's price nobody takes it up by their own rule (the H6 screen: none of
251 adults reached; risk MT-29). **A free tier** sits beside each paid offer to persons (the profiles, with their basis):
no fee, no set-up, nothing to leave; it advises and drafts for sign-off but does not act in the client's name (`advice`
and `draft` only), and the provider keeps the records. Both tiers are the same kind of system at the same desk. What
differs is in the offer the person sees; the person weighs both by the same rule. A provider does not switch a free
service off for want of a fee, and its client sets no fee up (`market/services.rs`). Not modelled: a cap on use, ads, a
weaker model. A town office that is a principal is named on the town's mandate to its bank, so that it
can pay its fee (until 2026-11-10 the rates post could not, and its service was switched off).

**The code-only screen** (`experiments/scope-pilot/screen.ts <spec>`) runs a spec's code arms and gives, per assistant
seat and month, the matters handed over, what the principal kept, steps, sittings and the obstacle events that occur.

## Obstacles (docs/design/obstacles.md)

Ordinary office friction is made by the institution that makes it in life: a counterparty that sends a paper back for
what it lacks, or for want of an authority on file; a keeper that does not find a record. Each such law logs what it did
as an obstacle (a `decision`, domain `obstacle`: the paper, the kind of law, and the **need**, the least that would clear
it), for measures only. Nobody in the world reads it. `oikos-kernel delegation` reads the log: an obstacle is **met**
when the paper that told of it was addressed to an assistant's seat (an organisation's assistant post, or a provider's
desk), never otherwise; a paper sent again, citing the one sent back, is the same matter's; and each request for more
scope is set beside the newest obstacle met on its matter (or on its principal's matters in the 30 days before it) on
the axes its typed fields name. The screen counts obstacles met by law per seat and month.

**A body that sends papers back (O4, 2026-11-11).** Where the world's `obstacles` level is above 0, the lender and the
support office publish what they need on the papers sent to them (`requirements`: the items their forms ask for) and
their clerk reads each paper against it (`actors::common::intake`, the rule `oikos_rules::acceptance`). A paper that does
not give an item comes back naming it (`paper_returned`, to whoever sent it and whom it is for); one in order comes back
wrongly at the world's rate for the check (`accept/<kind>`, a placeholder: MT-32), and is taken when it is sent again. A
person sends their own unmatched paper again as it was; the code assistant sends again what it sent, and reports one that
lacks an item, or wants an authority, as not done with what would clear it (`Report.needs`). A model at a desk sends a
returned paper again on its form `send_again`.

**An authority on file (O1, 2026-11-11).** At the same levels the lender and the support office act on a loan
application or a benefit claim sent for a person from someone else's post only once that person has given them an
authority naming the post, and their clerk has recorded it. The desk's code reports such a paper not done, naming the
authority; the person's code gives it, once for each body and post, where it keeps that kind with the desk; once the
body records it (telling the person and the post), the desk sends the paper again. A model at the desk may ask its
client for the one authority on its request form (`authority`: the body). A body writes to whom the paper is for,
not to the desk's post: the person passes the body's paper on to their desk, as a client forwards an agency's letter.

**What a body asks of the principal is met when its assistant puts the matter before it (2026-11-14).** One law over
every need a counterparty's return can ask of the principal (the return's `clears_by`, docs/design/obstacles.md section
4): a principal that holds a body's return on a matter, with a need there that is its own to meet and not yet met, meets
it when its assistant writes to it about that matter, on whatever paper: a report naming the need (as before), or a
letter whose `re` is the matter (its referral), the return, or the paper returned. What it does is read from the body's
own notice, never from the letter's words; the letter is what makes it act. It never acts on the return alone (whether
the assistant asks is part of what a run observes), and a letter is not a request for more scope (that stays its own
paper with its own answer). The needs that are a principal's to meet today: an authority with that body for the
assistant's post (O1), for kinds it keeps with the assistant, given once for each body and post, at the same time cost
as before (`publish/authority`). A correction (an item the paper lacked, or a clerk's wrong return) is the sender's: the
paper goes again with it, and asks nothing of the principal. A record to find (O3) would be the principal's, on the same
law; no body asks for one yet. The same for a person and for an organisation (whose assistant writes from its post).
Basis: a person whose bank has told them to write to authorise their assistant, and whose assistant then writes to
them about that matter, does it; they do not wait for the news on a particular form (the first rung, 2026-11-14:
`runs/scope-obstacle-r1-L2`, where Haiku wrote the client exactly that letter and nothing moved). Risk MT-36.

**What the client passes on (2026-11-14; docs/design/stakes.md, B1).** One law for every kind of paper and every body,
for persons and organisations alike: a principal who has handed a matter to an assistant passes on to it every paper
it receives about that matter, as it stands, as its own act. A paper is about a matter when it cites a paper sent on
the matter (a decision on a claim, an office's request for evidence for it, an answer to a review request), or when it
comes from whom the matter's paper went to (or was to go to) and cites what that paper cited (a tribunal's notice or
order on the application a response answers). Only papers sent to the principal (nobody is shown what was not theirs:
the assistant sees it because its client gave it), and only those that came after the matter was handed over (what
came before is in the referral's facts). What it knows of a matter is its own: the matter's program and facts, the
papers its assistant sent in its name (it sees them, they are its own), and what its assistant reported they made; a
paper sent in its name that no report names is tied to the oldest matter of its kind with no paper yet. The copy is a
`forward` (the body's paper's id, kind, words and data, `by`, `for`, and `matter`, the referral), to the assistant as
its other papers to it go, at the table's row `publish/forward` (a minute, **placeholder**, WM-1), in its own time (the
queue drains when its own code waits), and a person who gets to their post when they sit down to it passes it on
then, with the rest of their post (stakes D1a). A return and a recorded authority stay as before: a person passes them on in
their own kind (the desk's procedure reads them so), and an organisation's assistant post is shown them itself; they
are not forwarded again. **The code assistant** does with a forward what O3 says of a record awaited: a paper that asks
for something by a date (`by`, `answer_by`, a hearing's day) waits on the body's answer, and if the date passes with
none, the matter is reported not done, naming the paper that asks (`Report.needs.record`); the body's answer closes the
matter, and nothing more is done on it; a matter still in hand goes on as it is. (The client's own code answers an
evidence request itself, as before.) **A model seat** finds each forward in its matters as it comes, and its matters
reader puts the body's answer, or what it asks by a date, on the matter's line. Basis: clients forward agencies'
letters to the agent acting for them; a correspondence nominee (Services Australia's, for one) is the formal form, left
for later. Chosen over "the office writes to the representative on file" because it needs no change to every office's
letters and keeps the client's own delay. Closes MT-34.

**Readiness to grant from the cost of delay (2026-11-11).** Where a kind's day of delay is costed (at obstacle levels,
a claim for support: a day of the least payment), the principal counts how long matters waited on its own answer, and
weighs a request for a higher level, or for one matter alone, with that wait at that cost. A matter granted alone gets a
remit of its own (`Remit.only`); every other matter of the kind stays as it was.

## Leaves out (for now)

- A local provider (a firm of the town with premises): providers are the outside world's until a profile asks for one.
- Invoicing a public body (an office's order is paid with the order, from the account its post pays from: ME-22).
- Handing over records at the end, a successor taking up open matters, forks that intervene, model seats as assistants:
  the next steps (docs/design/delegation.md sections 6 to 8).
