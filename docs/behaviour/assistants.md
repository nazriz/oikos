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

- **What it hands over.** An act every part of which is of kinds delegated under the service in use goes as a `referral`
  to the assistant, at the strictest level of its kinds (`draft` over `approve` over `alone`; `advice`, or any part not
  delegated, and it does the act itself). Its own code hears of the act when the assistant reports it done (with what the
  assistant's act made), or when it does the matter itself after all (a draft it declined, a matter reported not done, a
  service that ended with the matter open).
- **What comes back**, dealt with in its own time when its own code waits: a draft read whole (if it is not what was
  asked, the principal finds it unless its reading slips: the person's row `publish/sign_off` in the table of slips) and
  signed off or declined; a request to go ahead answered; a report taken in; advice set beside what it did.
- **Its rule** (`rule.rs`), on its review day (every `review_days`; brought forward by a request for more scope, a
  declined draft, a matter not done or a complaint about a delegated matter): no service in use, it weighs each offer it
  can see by what each kind would cost it a month at each level (its time at its hour's value, the fee, and the slips
  it expects times what an error costs it, a draft's slips less those it finds) against doing everything itself, and
  orders the best that pays by its hurdle; in use, it sets each kind's level to the cheapest (a change only for a saving
  beyond the hurdle), and leaves when the saving no longer covers the fee by more than leaving costs over its horizon.
  Its estimate of the slips starts at the provider's claim (as many matters' worth as `prior_matters`) and moves only with
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

## A person as principal (the desk)

Where some provider serves persons, every person's code is wrapped as a principal (the same rule; their own account, as
their accounts channel shows it; their hour at the profile's pay for clerical work, a placeholder: ME-22), and sees the
providers' offers to persons. A person cannot hold a system (a system is delivered only to an organisation), so the
provider's desk does the person's matters: it writes each paper **in the person's name** (`for`, the record's
`speaks_for`), with the service agreement as its mandate, and reports to the person. Whoever receives the paper reads it
as that person's where its own procedure reads a paper by whom it speaks for (the tribunal, the hearing bodies); a bank
that verifies who wrote an instruction refuses an agent's, as a bank does. The desk serves many clients, each under its
own agreement and brief.

## Leaves out (for now)

- A local provider (a firm of the town with premises): providers are the outside world's until a profile asks for one.
- Invoicing a public body (an office's order is paid with the order, from the account its post pays from: ME-22).
- Handing over records at the end, a successor taking up open matters, forks that intervene, model seats as assistants:
  the next steps (docs/design/delegation.md sections 6 to 8).
