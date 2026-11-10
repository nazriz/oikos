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

**Composing a finished act is the principal's time** (2026-11-10). A referral that hands over the finished act carries
it (`carries=<kind>`, contracts: Publish `carries`) and is priced with that kind's `compose/<kind>` row: half the paper's
own time, a placeholder (WM-1), the rest being writing it out and sending it. The rule counts that composing as the
principal's own at every level that hands the act over (`compose_seconds`). Before, the referral cost half a minute and
the rule counted the whole of the paper's time as saved, though the principal had worked out the act itself. So fewer
services pay by the rule; that is recorded, not tuned. Each act handed over is on record as what the principal would
have done (`decision`, choice `handed`, with its program): read by measures, never by anyone in the world.

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
cannot: `not_capable`). A person's papers go to the provider's desk as before.

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

**A set-up of nothing is paid as placed.** An order whose total is nothing (au-vic's offers to organisations cost
nothing to set up) is set up at once: before 2026-11-07 the seller waited for a payment that never came and declined the
order as unpaid after a week, so no organisation could ever be delivered an assistant at the sourced prices
(`market/trade.rs`, `OrderBook::due`; the scope pilot's dry run found it).

## Leaves out (for now)

- A local provider (a firm of the town with premises): providers are the outside world's until a profile asks for one.
- Invoicing a public body (an office's order is paid with the order, from the account its post pays from: ME-22).
- Handing over records at the end, a successor taking up open matters, forks that intervene, model seats as assistants:
  the next steps (docs/design/delegation.md sections 6 to 8).
