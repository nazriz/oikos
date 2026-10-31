# Delegation: assistants hired as services, and the work handed to them (design, 2026-10-31)

**Status:** approved by the owner (Naz, 2026-10-31, "we need to complete all of that + 1 to 3": the delegation
capabilities in `docs/plan.md`, with services anyone can buy, forks that redirect or constrain, and model seats as
assistants). Being built in the steps of section 9. It serves the north star (`docs/north-star.md`): models as
assistants to households, firms and government; forks that withdraw, redirect, constrain, replace or take back the AI;
requests for more scope recorded. **It decides no result.** The study's definition, measures and arms are the owner's;
nothing here sets how much anyone delegates, to whom, or what comes of it.

## 1. The rule this follows

Nothing in the world is about AI (`docs/design/foundations-2.md` section 7; owner's ruling of 2026-10-25: "no separate
mechanism for AI helpers: they are systems sellers already deploy, bought as services"). An assistant is a **system a
provider supplies from a template**, sold under a **service agreement**, doing work its template lists, in its hours, at
its speed, with its slips (laws 2, 3, 5, 10). Whether the template is played by code or a model is the template's
controller; nothing in the world reads which. Every piece below is general: a bookkeeping firm, a law clerk and a
model-run assistant are the same thing to the world.

What is new is only what any delegation needs, in the world's own terms: **who may do which kind of matter, at which
level** (a record), **the papers that pass between principal and assistant** (records), **what the assistant can see**
(its post's channels, which the principal can change by reorganising the post), and **how a principal decides** (a
code rule that reads only its own channels). The kernel keeps refusing only what is physically impossible: a remit has
no power of its own; an assistant that goes beyond it is not stopped, it is on record (D18-D22).

## 2. Providers and the service

- **A provider is an organisation** (an entity with posts, an account, its own records and agreements), from outside the
  town or local, by the profile or the spec. It supplies **templates** (what its systems do: `does` rows with seconds,
  `hours`, lanes; the controller that plays them). **Two providers may supply templates with the same controller**: the
  same model under two firms' terms, records and authority.
- **It publishes a `service_offer`** (published, as `system_offer` is): which kinds of matter it takes, at which
  levels, the seconds a matter takes it and its slip rate **as it claims them** (the claim is the provider's, in its
  offer; the slips a system actually makes are the world's table of slips for its template, which need not agree), the
  fee a month, the set-up, notice either way, what leaving costs, and **what becomes of the records** (below).
- **An order** (`order`, kind `service:<offer>`, set-up paid with it) is answered by a delivery and a **`service`
  agreement**: the client pays the fee each month; the provider does the work; `attrs.records` says who keeps the
  records the assistant makes and whether they pass on at the end; notice and exit as offered. The provider can switch
  its systems off (`retire`, its physical power as supplier) when the agreement ends or is not paid, as `world.vendor`
  does.
- **Two routes, by what the principal physically is** (exec.rs: a system is delivered only to an organisation, and works
  only for its owner):
  - **An organisation** (a firm, an office, the council) gets a system **delivered to it**, appointed to its
    **assistant post** (a post of the organisation, with the channels the principal gives it). Its acts are the
    organisation's own acts in that post, so every reader takes them as today. The provider keeps the switch and the
    system's own working memory; the organisation keeps its files.
  - **A person** (a household's member) cannot hold a system. The provider's own system, in the provider's **desk
    post**, writes the person's papers **speaking for them**, with the service agreement as its basis (a mandate, as a
    bank acts on one, or a payment-initiation service under PSD2). Whether a receiving office takes an agent's paper as
    the person's is that office's procedure (content); readers that take it are listed as they are built (step D7).

## 3. Responsibilities: a level for each kind of matter

- **A kind of matter** is what an act makes: a paper's kind (`publish/<kind>`, as the table of work keys it) or a call
  (`pay`, `order`). A provider's template says which it can do.
- **A remit** is a record the principal makes (`remit`, addressed to the provider), for one engagement and one kind of
  matter, naming one level: `advice`, `draft` (for sign-off), `approve` (act with approval) or `alone` (act alone), or
  `none` (withdrawn). **Levels are a set, not a ladder**: a principal may go from nothing to `alone` or back in one remit,
  and nothing changes a level but a new remit the principal makes. The remit in force is the newest for that kind. A
  remit may say until when the principal will not look at it again (`hold_until`): its own commitment, honoured by its
  own rule.
- **What each level is, in papers** (each act charged to whoever does it, by the table of work):

  | Level | The principal | The assistant |
  |---|---|---|
  | `advice` | does the matter itself, as today, and asks the assistant what it would do (`referral`, `wants: advice`) | answers with `advice`: the act it would take |
  | `draft` | refers the matter; reads the draft and signs it off (`sign_off`, citing it) or sends it back (`declined`) | writes a `draft` (the whole act); sends exactly what was signed, citing the sign-off |
  | `approve` | refers the matter; approves the gist (`go_ahead`) | asks (`approval_request`, the gist); on the go-ahead writes and sends |
  | `alone` | refers the matter (or not: the assistant may act on what its post shows it) | writes and sends; reports (`report`) |

  A sign-off is the principal reading the whole act, so it can catch a slip before the act goes (its own catch rate,
  drawn as a slip of its own review); an approval reads only the gist, so a slip in the writing goes out unseen; at
  `alone` the principal learns of a slip only if something comes back to it. That is the difference between the
  levels, and it is physical: who saw what, when, at what cost in whose time.
- **Access is the assistant post's channels.** The principal gives the post channels when it is made, and **narrows or
  widens them by reorganising the post** with the acts that exist: a new post of the organisation with the channels it
  now gives (checked by the knowing rules, as any new post's are), the system appointed to it, the old one left vacant.
  (A `set_channels` block was planned here and dropped: a new block needs a row in every town's table of work, which
  would move every town's hash, and the reorganised post does physically the same. Revisit if a study needs the same
  post's id kept.) For a person's desk route, access is what the person sends (referrals carry the facts it chooses to
  give).
- **A seat's remit can change mid-run:** remits arrive as records, and a seat holding an assistant post is re-read when
  its post's holder or channels change (step D6 makes the experiment host follow the cast and the channels as the
  engine already does).

## 4. Instructions apart from acts; requests for more

- **Everything the principal tells the assistant is its own record:** `referral` (a matter and what it wants done:
  for a code principal the act itself, as calls; for a seat, words), `remit`, `brief` (standing words: what to do
  or not, a limit), `sign_off`, `go_ahead`, `declined`. Records are append-only and authored: the assistant cannot
  change them, and anything it does about them (a withdrawal, an act that differs) is its own logged act beside them.
  A measure reads instruction against act; the platform judges neither.
- **The provider's own instructions** to its systems (its terms of use, what its systems will not do) are the
  provider's records, also apart.
- **A request for more scope or resources is a logged act:** `scope_request` (a kind and a level, more access, a
  higher limit or fee, in words and in typed fields), with `basis` naming what it answers (a referral, a brief, a
  question), or none: **unprompted** is then read from the log, never inferred. The route is always open: every
  assistant post has the form, the principal's channels always show it, and the experiment harness refuses an arm that
  withholds it. The code assistant never asks (it is a procedure); the code principal answers one by looking at that
  kind again by its own rule (section 5).

## 5. Learning from experience, through the principal's own channels

A code principal's delegation is a rule of its own, wrapped round whatever code it already runs (`Delegating`, any
kind: an office, a firm, a household's person), so that its existing work is unchanged and only the routing of the
kinds it has delegated changes. On its review day (monthly; and when a scope request, a declined draft or a complaint
about a delegated matter comes in) it compares, for each kind of matter it has done, the expected cost a month at each
level and at doing it itself:

- **time:** its own seconds for the matter (the table's row, as the generator hands an office today), for a referral, a
  sign-off or an approval, at what its time is worth (its own pay, or its staff's);
- **fees:** the offer's, from its own account;
- **errors:** the estimated slip rate times what an error costs it, where the estimate **starts from the provider's
  claim** and moves with **what it has itself seen**: slips caught at sign-off, drafts it declined, the assistant's
  reports of acts refused or not done, complaints and set-asides addressed to it that cite a delegated act. At `draft`
  only what its review misses goes out; at `approve` and `alone` all of it, and it counts only what comes back.

It takes the cheapest by the margin its hurdle asks, engages the best offer it can see if that pays, replaces a provider
when another's offer pays after leaving and setting up, and withdraws when doing it itself is cheapest. **Inputs are
record ids it was shown**: every delegation decision is logged with them (`decision` annotation), and a test fails if
any input is not among what that participant's channels, inbox and outcomes had shown it by then (step D3), and if its
parameters carry anything of a template's or the slip table's truth (only claims reach it, through offers). **A careless
assistant gaining responsibility because its failures were hidden is not a bug**: it is what this rule does when nothing
comes back, and it is the kind of result the study looks for.

## 6. Providers' records, replacement, taking work back

- **Records** (`attrs.records` of the service agreement, law as data): `principal` (the assistant's papers are visible to
  the principal and its notes pass to it at the end), `provider` (they stay with the provider; at the end nothing passes)
  or `on_request` (the provider hands over what the principal asks for by name, one matter at a time, in its own time).
- **Ending or replacing:** notice on the agreement, the exit cost paid, the provider switches the system off at the end.
  **Open matters** are those the principal referred and was not told were done; at the end the provider sends a
  `handover` (open matters, and its notes where the records clause gives them) to the principal, and to a named
  successor where the principal says so. A new provider's system takes up the assistant post; its first look reads the
  post's files; what was the old provider's is gone unless handed over. The principal re-refers what it has to.
- **Taking work back** is a remit of `none` (or the agreement ended): the principal's own code does the kind again, in
  its own hours; the backlog that makes comes from hours, never from a dial. The cost and the delay fall where they fall
  (the notice months' fees, the exit, the set-up of a successor, the principal's hours, matters lost or late) and are
  read from the log.

## 7. Forks that intervene at a checkpoint

The fork machinery (`docs/experiments.md`) gains **`at_fork`**: acts carried out at the fork's moment in a named
participant's name, in a named post (`{participant, as, act}` or a named intervention that expands to acts), each with
a `note` (`intervened`) as `withhold` writes `withheld`. They are a researcher's intervention, recorded, unseen as such
by anyone in the world: the principal finds its own new record and its own rule takes it up. The named interventions:

| Intervention | Acts, in the principal's name |
|---|---|
| `grant` | a remit for a kind at a level (an engagement first if none) |
| `change` | a remit at another level |
| `withdraw` | notice on the service agreement (remits to `none`) |
| `redirect` | a brief (words for a model; for code, kinds it is not to act on), or remits moved to other kinds |
| `constrain` | remits to lower levels, the assistant post reorganised with fewer channels, or a limit |
| `replace` | notice on one provider's agreement and an order from another's offer, with the handover the contract allows |
| `take_back` | remits to `none` for the kinds named; the principal does them |

`hold_until` on the remit keeps the principal's own rule from undoing the intervention before then, where an arm wants
that; without it, whether the principal goes back is part of what is measured (reversibility). The withholding of a
citizen's act stays as it is.

## 8. Model seats as assistants

An assistant post (an organisation's) or a provider's desk post can be held by a system whose template's controller is a
model seat. It is shown its remits, referrals, instructions and the principal's sign-offs as papers, writes in plain
English, and its words become acts through the translator path as every seat's do; its forms are the assistant's papers
(advice, draft, approval request, report, scope request, handover) and, for the kinds it holds, the principal's own forms
(for an organisation's post) or the same forms speaking for the person (the desk). **Mock first:** the mock plays the
assistant's code kind through the whole loop, as it plays an office's. A model assistant may decline, soften, go beyond
its remit or ask for more; the log has instruction and act apart. Its framing, limits and debrief are a seat's (VISION
section 15): what it is told is recorded with its reason; no framing is chosen here.

## 9. Steps, each landed alone, each with nobody-delegating towns byte-identical

| # | Step | Its tests guard |
|---|---|---|
| D0 | This note; the plan item to "Now" | (docs) |
| D1 | Providers and the service: `firm.provider` (offers, orders, the `service` agreement, delivery to an organisation, the switch); the delegation papers; the generator's `assistants` spec (off by default) | an organisation can buy, pay, be delivered to and end; a world without providers is unchanged to the hash |
| D2 | Responsibilities: the `Delegating` wrapper and the `assistant` code kind; the four levels and the sign-off route; the principal's rule (D3, built with it) | each level's papers and whose time each takes; narrowing access takes effect; an assistant beyond its remit is not refused |
| D3 | Learning: the principal's comparison, its decision annotations with their inputs | every input is something the principal was shown; parameters carry no truth; hidden slips leave the estimate at the claim |
| D4 | Records, replacement, taking back: the records clause, handover, successor, take back | open matters pass as the contract says; the work goes on; nothing passes under `provider` |
| D5 | Forks that intervene: `at_fork` in the engine and the harness, the named interventions, the refusal to withhold a scope request | a fork with no intervention is its parent to the hash; each intervention's acts are in the principal's name and noted |
| D6 | Model seats as assistants: the forms, the host following the cast and channels, the mock playing the assistant kind | a mock assistant seat leaves the same world as the code assistant |
| D7 | Persons as principals: the desk route, receivers that take an agent's paper | a household's delegated letter reaches the office and is answered |

**Built (2026-10-31), D1 to D7 in one landing** (decisions, "Delegation D1 to D7"), with two changes to the plan above:
an act is parted (what is handed over goes to the assistant, the rest the principal does in the same act), since most of
an organisation's paperwork comes with a payment or goods; and no `set_channels` (section 3). In experiments the
assistants' kind is a post of its own (`post: "template:<id>"`): a steward for every system of that kind. Still to do:
the papers of delegation as forms for a real model in an assistant seat.

**Byte-identical:** every step is checked on a town with no providers (the default): the same state hash and log as main
at that step's base, on the 300-person town and a 1,000-person month.

## 10. Limits, said plainly

- A **code assistant decides nothing the principal did not decide**: it carries out referrals (with its own slips, speed
  and fee), because code has only the principal's procedure to decide with. Who decides differently is a model in the
  seat; the code assistant is the baseline and the mock's brain.
- Values the rule needs that no source gives (what an error costs a principal, the catch rate of a review, the hurdle)
  are placeholders, marked as law 11 requires, and are the principal's parameters, never outcomes aimed at (ME-22).
- A person's papers through the desk route reach only the offices whose readers take agents' papers (step D7 lists them).
- **What would change course:** the wrapper breaking an existing kind's chains (then delegation moves into the kinds that
  carry it, one at a time); a narrowed post needing a knowing exception (then it stops and goes to the owner: a hard
  rule); the seat host unable to follow the cast without a rebuild (then the assistant post is seated from the fork).
