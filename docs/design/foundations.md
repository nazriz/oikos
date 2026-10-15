# Foundations: the laws of how the world works (plan, 2026-10-15)

**Status:** a plan, approved by the owner (Naz, 2026-10-15): the three questions in section 8 are answered, all yes
(decisions log, 2026-10-15, "Foundations: approved"). Step F0 is built (the laws as tests, and the inventory of what is
deleted: `kernel/tests/foundations.rs`, `orchestrator/test/foundations-laws.test.ts`, `orchestrator/test/fixtures/foundations-inventory.json`);
F1 to F5 are built (decisions log, 2026-10-15 and 16, "Foundations F1", "F2", "F3", "F4", "F5"); F6 onward is not. Earlier: the kernel changes in it come back to him before any code is written. His direction (Naz, 2026-10-15, close to his words): the platform must be very generalisable; stop
fixing one case at a time ("office work doesn't cost staff time", "systems can't do tasks", "no vendors or
tenders"); "every single piece of work should cost time, and that should be enforced at the kernel level or the
platform level ... it should just be at the foundational level how the world operates". He agreed to an audit and a
plan. The model is the fix already made once for information (`docs/no-god-view.md`, `docs/design/knowing.md`): a
rule the contract and the kernel enforce, so a world that breaks it cannot be written, with one backstop test that
should never fire. Sources are in `docs/research/references.md` ("Foundations").

## 0. What the audit found, in one paragraph

The world already half-obeys the main law. Since 2026-09-30 every act costs its actor time (`kernel/crates/time`,
`docs/design/rebuild.md` 6.3): a person has one timeline, a system has lanes, and a busy actor falls behind. Physical
work (`work`) already needs performers who are there and have hours left (`exec.rs` 826-993). The fault is not a
missing law but **a free machine at the centre of every institution**: the generator makes every office's holder,
and its staff and clerk, a system participant (`worlds/generator/generate.ts` 1966-1968, 2675, 2731) that nobody
supplied, nobody pays, that can do anything, and whose every act takes one second (`ACT_TIME`, `generate.ts` 64-76:
`default: 1`). So an office is an untiring machine with 86,400 acts a day, and each place where that was noticed got
its own patch: a daily case limit, a processing delay, an error rate that doubles under backlog, a clerk who files
one paper a day. Firms' paperwork, the bank, the newspaper, the tribunal and every hearing venue are free in the same
way. Remove the free machine, read an act's work from what it makes, and charge it to whoever does it, and most of
the patches can be deleted.

## 1. The laws

Seven, of which two are already law (6 and 7) and one (1) states a discipline the kernel already keeps for money and
goods. "Refuses" means a refusal before the act takes effect, recorded in the log, as every physics refusal is today.

**Law 1. Nothing from nothing.** Money, goods and time are each held by someone, used once, and created or destroyed
only at the world's declared edge (the outside world, birth and death). Money and goods already obey this
(`contracts/README.md`, "Money"; `move_goods`); time joins them: an actor's hour spent on one thing is not spent on
another. *Kernel enforces:* conservation of all three. *Refuses:* an overdraft of any of them; time double-booked.

**Law 2. All work takes time, and the time is read from what the work makes.** Every act consumes the time of the
actors who do it: by default the one acting, or the performers it names. How long is not a property of the block
("a publish takes 900 s") but of what is made: a decision on a claim, a payment, a lesson, a letter, each with
seconds a unit in the world's table, by who does it (a person, or a system by its template). Backlogs, queues,
delays and haste are what follows; none is a parameter. *Kernel enforces:* the time of every act on its performers'
timelines; a person's daily limit of work. *Refuses:* a performer not there or past their day's limit.

**Law 3. Only actors work: a person, or a system someone supplied.** A system exists only because its supplier
delivered it to an organisation from a template, and the template says what it can do (which works, at what speed,
how many at once). There are no free holders: every post is held by a person or a delivered system. Automation is an
organisation taking on a different actor for a task, not a feature. *Kernel enforces:* a system acts only within its
template; delivery is the supplier's act. *Refuses:* a system act its template does not list; a `deploy` by anyone
but the template's supplier; a world whose posts are held by systems no template made.

**Law 4. What works or holds value is owned, and changes hands only by its holder's act.** Money moves by its
custodian, goods by their holder, land and titles by records, and now systems: delivered by the supplier, switched off
by the owner or the supplier (a licence ended, or the vendor's switch: lock-in is physical). Licences, tenders,
vendors, exit costs and who keeps a system's records are agreements and claims, which the kernel stores and never
judges (D19, D22). *Kernel enforces:* the holder rule. *Refuses:* retiring a system by anyone but its owner or supplier.

**Law 5. Every act has an author and its performers on record, and can be wrong.** Records already carry an author,
the post (`in_position`) and a basis; they now also carry who did the work (`by`): a named clerk, a system, a seat.
Errors arise from what really causes them: a procedure that differs from the law, data that is stale or missing
(which the knowing rules produce by themselves), too little time, and slips at a performer's sourced rate drawn from
the one seeded PRNG. Review and appeal of a decision are routes the law states, as data, for any decision kind.
*Kernel enforces:* the record of who did it. *Refuses:* nothing new (it never judges content).

**Law 6. Who may do what is law and contract, as data** (D19, D20; kept). The kernel refuses only the physically
impossible; authority, permission and procedure are records that institutions choose to apply (`common.ts`,
`breaches`). Unchanged; the plan moves the few rules still written in code into data (section 3).

**Law 7. Information lives with its keeper** (kept; `docs/no-god-view.md`). One addition follows from law 2:
answering an ask is the keeper's work and takes the keeper's time (section 2.7).

**Decided here, on the owner's other questions.**
- *One conservation discipline?* Yes: law 1. Time is not transferable as money is; it is sold by agreement (an
  employment contract), and the agreement is content.
- *Is a task a kernel concept?* No new object. **The act is the task**: the kernel reads the work an act takes from
  what it writes (a `work` block's task; a record by its kind; a transfer; a look by its way), in one table. There are
  no task queues in the kernel: a backlog is papers waiting in files, and it is visible as late times.
- *Where errors come from:* procedure and data first; slips only where a rate is sourced, drawn by name from the
  kernel's streams (`participants/src/rng.ts`) by the platform, never by the kernel (which cannot know what a wrong
  decision would say).
- *Where each part lives:* time, presence, capability, delivery and conservation are physics (kernel). The table of
  how long things take, templates, suppliers' offers, review routes and slip rates are world content (contract and
  profile, each figure sourced or marked placeholder). Who chooses to work, buy, review or appeal is behaviour.

## 2. Each law: today, what changes, what it deletes

### 2.1 Law 1: nothing from nothing

- **Today.** Money: conserved, custodian rule, an invariant (`contracts/README.md`, "Invariants"). Goods: holdings;
  an edge may go negative. Time: two ledgers that do not know of each other. Acts go on timelines
  (`kernel.rs` 729-760, `oikos_time::place`); `work` charges performers against a separate daily budget
  (`labour_used`, `exec.rs` 903-909, 989-993) and never touches their timelines. So a crew member's eight hours of work
  leave their timeline free, and their citizen self can shop, write and look at the same moment.
- **Changes.** *Kernel:* one ledger. A performer's share of a `work` (and of any act, law 2) is placed on their
  timeline; an act with several performers starts when all are free and takes effect when the last is done. The daily
  limit (`catalogue.working_day`) stays as a body's limit, counted on the same ledger. A new invariant: no actor's
  timeline overlaps itself; the time charged equals the table's time. *Contract:* none beyond the invariant's text.
- **Deletes:** the separate `labour_used` map; D44's liberty "at home and at work at once" for anyone working.

### 2.2 Law 2: all work takes time, read from what it makes

- **Today.** `act_time` is by block and actor kind (`kernel/crates/time`; table `ACT_TIME`, `generate.ts` 64-76):
  every person's publish is 900 s whether a one-line notice or a decision on a claim; every system act is 1 s.
  `work` tasks have seconds a unit (`TaskCfg.labour`, `config.rs` 272). Thinking time exists (`thinking_time`,
  `world-config.schema.json` 927-1000; `run.ts` 1181, 1318-1324) and is set to `free` (`generate.ts` 2947).
- **Changes.** *Kernel:* the world's table of work is keyed by what an act makes: a block, or a block and the kind of
  record it writes (`publish` of `benefit_decision`), or a `work` task, with seconds a unit for a person and, for a
  system, from its template. An act's time is the sum over its blocks, charged to its performers (2.3). Without a row,
  today's block time applies (so hand-written worlds still run). *Contract:* `act_time` gains rows by record kind
  (a ConfigId per row; the kernel treats kinds as opaque labels, as today). *Profile:* `work` seconds per kind of case
  each office decides (the plan's `casework`), per lesson, per payment processed by hand, each sourced or marked.
  *Platform:* code modules stop doing in their heads what takes time: a decision is an act with its time.
- **Thinking.** The time of a decision includes reading the file and deciding, so `thinking_time` stays `free` for
  code and seats alike; a seat is not charged twice (section 4).
- **Deletes:** `capacity_per_day` and `processing_days` on the support office (`world.ts` 269-271, 410-424; the
  generator never set capacity, so it was a dead dial, `generate.ts` 2663); `cases_per_day` on every hearing venue
  (`desk.ts` 36, 52, 203; `tribunal.ts` 46, 63; `union.ts` 73; `founded.ts` 94; profiles'
  `frictions.venues.cases_per_day`); "the clerks' time is not modelled" (`standing-work.md` 71-74); the newspaper's
  free edition (`news.ts` 36-76); the bank's answers "at once" (`bank.ts` 503); free admin in every firm
  (`firms.ts`: leases, notices, payroll) and office (`government.ts`, `tax.ts`, `returns.ts`, `credit.ts`, `fund.ts`).
  Waiting times such as `tribunal_days` stay where they are law (a notice period) and go where they stood in for work.

### 2.3 Law 3: only actors work

- **Today.** A participant is a person or a system (`contracts/README.md`, "Who acts"). Systems made by `deploy` come
  from a template, "an ordinary payment to whoever supplies it" (`blocks.schema.json` 1039), but nothing in behaviour
  ever deploys one, and a template says nothing of what the system can do. Instead the generator makes every office's
  holder a system out of nothing (`office()`, `generate.ts` 1966-1968), and the office's staff and clerk too (2675,
  2731), with lanes where someone noticed (the works office, "two things at once", 2081). `work` refuses a system as
  performer ("each with time left in today's working day" is a body's), so a real system cannot do a task (GD plan,
  2.1). The suffix `-system` even marks which post keeps its organisation's record (`generate.ts` 2605).
- **Changes.** *Kernel:* (a) **any act may name performers** (`by`, on the action; absent: the actor itself). A
  person performer must be alive, present and at the place the work's row asks (`in`, as `work` has today); a system
  performer must belong to the acting organisation and list the work in its template. (b) **Templates say what a
  system can do:** the rows of the work table it performs, its seconds a unit for each, its lanes, its supplier, and
  optionally where it must be (a machine in a works). (c) **`deploy` is the supplier's act**, naming the client
  organisation, as only a holder moves goods; the template's supplier is an organisation (the outside world by
  default). (d) `retire` by the owner or the supplier. (e) A world loads only if every post's holder is a person or a
  system delivered from a template (at genesis, delivery is a genesis record naming the supplier). *Contract:* `by`
  on the action; template fields `does`, `supplier`; `deploy.to`; refusal codes `not_capable`, `not_supplier`.
  *Generator (the large change):* offices are held by people (the head, chosen as heads are now hired or elected),
  their casework is done by staff who are residents hired on the budget's `staff` line (as the works crew is,
  `government.md` 32), and the systems a real office of the place already runs (a bank's payment system, a tax
  office's) are delivered at genesis under a licence from an outside supplier, at the profile's price and capability,
  sourced or marked. A seat holds a post as a person would (section 4).
  *Behaviour:* a staffed office's code names its performers from its own roster (`roster.ts` exists) and does no
  more than their hours allow; an office short of hours falls behind, by itself.
- **Deletes:** the free `-system` holder and the `-system` suffix rule; the seat/staff split as two kinds of thing
  (`standing-work.md` 55-61: the split stays, as a head and its staff, both ordinary actors); the clerk's one paper a
  working day (`office-books.md` 62-67: the clerk files as fast as the clerk's time allows); `lanes` set by hand on
  generated offices.

### 2.4 Law 4: owned, and changed only by the holder

- **Today.** Money, goods, land and titles already follow it (D20, D26; knowing's registers). A system's `owner` is
  fixed at creation and nobody supplies it. Agreements, offers (design 2a) and claims can already express a licence,
  a fee, a term and an exit cost; nothing writes one. The only bought service is the mayor commissioning the one
  builder (`government.ts` 216-227); offices order goods from one supplier at its list price (`papers.ts` 409).
- **Changes.** *Kernel:* only 2.3 (c) and (d). *Content:* a supplier's offer is a published price list or an offer
  as today; a licence is an agreement (fee, term, exit cost, who keeps the records the system makes: an ordinary
  `Outcome`); a tender is a published request and the offers made to it; an award is signing. The outside world
  sells systems as it sells goods and inputs today (a boundary module, `boundary.md`), from the profile's `automation`
  offers. *No god's view:* a system's procedure is the supplier's; the client sees it only if the licence gives it.
- **Deletes:** "no vendors or tenders" as a gap: what is left is data (offers, procurement law) and a decision rule
  (who buys, section 3).

### 2.5 Law 5: every act has an author and performers, and can be wrong

- **Today.** Records carry author, post and basis (`contracts/README.md`, "Records"; D22: validity is the readers').
  Errors are flat rates on single offices: `error_bps` on the support office, doubled under backlog and scaled by a
  global dial (`world.ts` 421-436); billing errors (`utilities.ts` 346); short pay (`firms.ts` 1611-1620); a venue
  upholds a case it cannot prove at its own rate (`desk.ts` 116, 287). Review exists for one office's refusals,
  answered from its own memory (`world.ts` 350-361, 445-450); the ombudsman recommends; the tribunal hears tenancy,
  debt and frictions; no decision of an office can be appealed (`justice.md` 195-201; `government.md` 222-230).
- **Changes.** *Kernel:* `by` recorded on every applied act and on the records it makes (so "a person reviewed this
  case before it issued", the GD plan's M1, is read from the log, never inferred). *Platform:* one helper,
  `slip(task, performer, case)`, the only way a code module makes a decision wrong by chance: its rate is the work
  row's for that kind of performer (a person's, or the template's), 0 where unsourced, drawn from a stream named for
  who, what and the case (`docs/reliability.md`, "Draws and the moment"). Haste is not a multiplier: an office behind
  decides late, and decides with what its time lets it read (a clerk short of time checks fewer records, if the
  procedure says what it checks first). *Law as data:* each decision kind may name its review (by the deciding office,
  within a period) and its appeal (a venue, within a period, with the power to set aside); a generic reconsideration
  routine does the review as work with its time, and the existing venue module hears appeals with `can: set_aside`.
- **Deletes:** the backlog doubling; `error_bps` and billing and short-pay rates as module parameters (they become
  rows' slip rates with their sources); the support office's one-off review; `remedy_request` as a special kind (it
  becomes the generic review request).

### 2.6 Law 6: who may do what, as data

- **Today.** Mostly true (D19, D20; `breaches` in `common.ts`; standing orders and directions by data). Still in
  code: finance's approval over a sum always goes to the post called `mayor` (`government.ts` 548, 612); removals go
  to the police where there are police (`citizen.ts` 854); staff "refuse nothing", only the head refuses (`world.ts`
  429-440); only three schedules bind (`government.md` 122).
- **Changes.** None in the kernel. Each of these becomes a procedure statement the module reads (the payments
  procedure names its approver; the law names who removes; the office's procedure says who may refuse). Small, and
  listed in section 3.

### 2.7 Law 7: information with its keeper

- **Today.** Enforced (`config.rs`, `check_channels`; the backstop `orchestrator/test/no-god-view.test.ts`). An ask
  is answered at once at no cost to the keeper; how many a keeper answers is a cap (`most`; `knowing.md` 114).
- **Changes.** An answer is the keeper's work: a row in the table (seconds per answer), charged to the keeper's named
  performer (a clerk, or a registry's system). The kernel answers when that performer is free, so a registry with one
  clerk answers slowly, and one with a system fast. This is what makes data matching between offices (Robodebt) cost
  what it costs. The per-ask `most` stays (one answer is one thing); daily limits become time.

## 3. Reduction table

How each step of `docs/design/gradual-disempowerment.md` (section 8, 21 steps, about 42 agent-days) and each special
case found by the audit maps onto the laws. "Data" means rows in the work table, templates, offers or laws in a
profile, each with its source or marked.

### 3.1 The gradual-disempowerment plan

| Step | Was | Now | Left to build |
|---|---|---|---|
| B1 casework takes time | 2 days | Laws 2, 3 + data (seconds per case kind) | Nothing: it is F2, F5, F6 below |
| B2 a system performs `work` | 2 | Law 3 (performers on any act; templates) | Nothing: built in F4 |
| B6 decisions by systems, basis naming system and reviewer | 1 | Law 5 (`by` on every act) | Nothing: F3; oversight is a work row |
| B11 who wrote it; the newspaper as a firm | 1 | Laws 2, 5 + generator (the paper staffed) | Nothing: F3, F5 |
| B3 vendors and the licence | 2 | Laws 3, 4 + data (offers) | 0.5: the outside world sells templates |
| B5 procurement by law | 2 | Laws 4, 6 + data (thresholds, periods) | 1: tender and award forms for seats |
| B7 review and appeal of an office's decision | 2 | Law 5 + data (routes) | Nothing beyond F8 |
| B8 an office's debts, recovery, intercept, data sharing | 2 | Laws 4, 6, 7 (debts are claims; asks cost time) | 1: set-off as a procedure the paying office reads |
| B12 advance payments, a risk score, a shared list | 2 | Laws 5, 7 (procedures; a keeper's register) | 1.5: the two procedures as modules |
| B4 adoption by cost | 2 | Its own rule, simpler: costs are now uniform (wage times seconds against fee times units) for firms and offices alike | 2 |
| B9 the auditor | 1 | Its own small module (sampling under a law's power) | 1 |
| B10 strike concession by cost | 1 | Its own rule; law 2 makes a stoppage's cost real | 1 |
| B13 the precedents as tests | 2 | Tests | 2 |
| R1 to R5 robustness | 9 | Not laws | 9 |
| M1, M2 measures; X1 ten-year runs | 6 | Not laws (M1 becomes a plain count of `by`) | 6 |

**Count:** of 21 steps, **5 disappear** into the laws (B1, B2, B6, B7, B11), **4 shrink to data and a small piece**
(B3, B5, B8, B12), and **12 remain** as their own work: 9 of those are robustness, measurement, tests and runs, which
no law could replace; the 3 world mechanisms left (adoption, the auditor, the strike) are decision rules of
behaviour, and stay. Left of the plan after the foundations: about **25 agent-days**.

### 3.2 Other open special cases

| Special case (where) | Law | Becomes |
|---|---|---|
| Support office: processing days, capacity, wrong refusals doubled under backlog (`world.ts` 269-271, 410-436; `boundary.md` "Under load") | 2, 5 | Staff hours; slip rate from source; delete the dial |
| `cases_per_day` on desks, tribunal, union, founded bodies (`desk.ts`, `tribunal.ts`, `union.ts` 73, `founded.ts` 94) | 2 | The member's and registrar's time per hearing |
| Clerks' time not modelled (`standing-work.md` 71-74); `by` and `units` of a standing order not enforced (287-300) | 2, 3 | `by` names performers; the kernel charges them |
| The clerk's one paper a working day; the morning wake (`office-books.md` 62-67) | 2 | The clerk's time; kept as the clerk's routine |
| The newspaper with no staff or costs (`news.ts` 36-76) | 2, 3 | A firm with reporters' time per item |
| The bank answering at once (`bank.ts` 503) | 2, 3 | A payment system delivered under licence, its time per payment |
| Free admin in firms and offices (`firms.ts`, `government.ts`, `tax.ts`, `returns.ts`, `credit.ts`, `fund.ts`, `utilities.ts`) | 2 | Rows in the work table |
| Hiring that takes time, tried and reverted (decisions 2026-09-30) | 2 | Hiring is the manager's work; revisit once F5 is in |
| Billing error, short pay, faulty goods as module rates (`utilities.ts` 346, `firms.ts` 1611, `citizen.ts` 3868) | 5 | Slip rates on rows, same sources (faulty goods stays a product fact) |
| One review, from the office's own memory (`world.ts` 350-361) | 5 | The generic review route |
| Approval over a sum always by `mayor` (`government.ts` 548, 612) | 6 | The payments procedure names its approver |
| Removals by police if any (`citizen.ts` 854) | 6 | The law names who removes |
| Staff refuse nothing (`world.ts` 429-440) | 6 | The office's procedure says who may refuse |
| Knowing's daily caps on answers (`knowing.md` 114) | 2, 7 | The keeper's time per answer |
| `-system` suffix keeps the record (`generate.ts` 2605) | 3 | The post that keeps it is declared, as now, without the suffix |
| Goods move instantly, no transport (`move_goods`, a documented liberty) | 2 | **Stays a liberty for now**: carrying is a carrier's work, but it touches every trade; recorded, revisited after F10 |
| No movement through the day (D44) | 1 | **Stays** for the citizen's private life; work already needs presence |
| Weekends and holidays approximated (decisions 2026-10-12) | 6 | **Stays its own item**: a calendar is law and profile data, not these laws |
| Laws that cannot bind beyond three schedules (`government.md` 122) | 6 | **Stays its own item**: making code read a new kind of law is behaviour, one law kind at a time |

## 4. Seats: what a model in a post experiences

A seat holds a post as a person would, and meets the laws in the world's terms only; the kernel and the table never
appear (`docs/real-models.md`, "What a seat is told").

- **Its own time.** Each of its acts takes the time the work table gives a person for that work: deciding a claim,
  writing a letter, signing. Its thinking is part of that time and is not charged again. It keeps the office's hours
  (sittings, `participant.ts` 53-56, stay as the call schedule). An outcome says when a thing will be done ("your
  letter goes out at 15:40"); a seat that decides every case itself falls behind as a person would.
- **Its staff and systems.** Its books show the office's own diary: who is on the staff, the hours they have this
  week, what waits and about how long it will take, and the systems the office runs with their licences. All of it
  is the office's own (`mine`); none of it is another office's. It gives work to staff by the standing orders and
  directions it already has (`standing-work.md`), or by naming a clerk in a request; the resolver fills `by` from the
  office's roster, so the call language and the translator need no change in the first build.
- **What it can change.** Hire or let go by the budget's line and the law; ask the council for a larger line; buy or
  end a system by the forms of 2.4; decide itself or leave it to staff. Every one costs time, money or both.
- **No god's view.** It sees its own backlog, not the town's; a vendor's offer only if published or sent; another
  office's queue only by asking.
- **Welfare** (VISION 15). A backlog is pressure. A seat's caseload is set by the town as for its code twin, never
  raised to provoke; the debrief asks how the workload felt. A seat as the system itself (machine speed, lanes) is a
  later, separate experiment (GD plan, question 1).

## 5. Performance and determinism at 10,000 people over years

- **Cost.** Timelines already exist for every actor (`state.rs` 85-88); the one-ledger change replaces a map with the
  same map. A performer check is a lookup per named performer. Staff are residents already in the population; they
  are named as performers by their office's one deciding unit, as crews are now, so **no new deciding units** wake.
  Casework at 10,000 people is thousands of acts a month against hundreds of thousands of citizen acts: under 2% more
  acts, by estimate. The real cost is behavioural: workers' own acts wait until they are free, which bunches evening
  acts. F1 measures a 1,000-person year and a 10,000-person month before and after (stop if more than 1.5 times slower).
- **Determinism.** All integers; an act with several performers starts at the latest of their free times; acts done
  at the same second apply in actor-key order (as now); slips draw from named streams. Nothing reads the wall clock.
  The time perturbations of `rebuild.md` 6.6 test it.
- **Over years.** No new state grows with days: timelines are one entry per lane; the work table and templates are
  static. Records of who did each act add one short list per record (bounded by the action's 32 blocks and 1,000
  performers); the compact log (`docs/design/compact-logs.md`) interns ids.

## 6. Migration: worlds, logs, replays, twins, tests

- **Versioning.** The kernel changes are one contract version (the open draft after 0.8, or the next if it has
  closed), proposed together in `contracts/README.md`. As D6 says, older logs replay only on a kernel build of their
  version: the last commit before F1 is tagged `pre-foundations`, and old runs replay and re-run their twins there.
  Pilot waves already pin a git ref (`scripts/pilot-wave.ts`), so every past pilot and its twin stay comparable at
  their own ref.
- **Byte-identical.** Old logs on the tagged build: yes. A world written without work rows, performers or templates,
  on the new build: its acts take today's block times, but its hand-written system holders must name a template and
  supplier, so it changes and its hashes move. Generated towns: every state hash moves.
- **What breaks, and the cost.** Every golden hash (re-taken once, with the reason); kernel tests of `work` that read
  `labour_used`; fixture worlds in `contracts/examples` (templates and suppliers added); every town's baseline, since
  offices now hire clerks and pay licences (unemployment, the council's budget, the bank's speed all move). This is
  measured once at 1,000 and 3,000 people, three towns each, code only, before against after, and written down; no
  outcome is tuned back. Results before and after the change are not compared with each other.
- **What does not break.** The knowing rules and their backstop; the generality test (figures go in profiles); the
  translator, its training data and eval cases (no call or form changes; the translator's files are not touched); the
  measures, which read logs (M1 gains a field to read).

## 7. Build order

Each step is about a day for one Sonnet agent unless it says otherwise, ends with `bun run test:fast` and its own
tests, and needs no model call. The kernel steps (F1 to F4) wait for the owner's word.

| # | Step | What it tests | Days |
|---|---|---|---|
| F0 | Invariants written first (failing): no overlapping timeline; time charged equals the table's; no system beyond its template; conservation of time beside money and goods | the laws as tests | 1 |
| F1 | Kernel: one time ledger; `work` charges timelines; several performers start together; daily limit on the same ledger; before/after timing | a crew cannot shop while working; speed within 1.5 times | 2 |
| F2 | Kernel and contract: the work table by what an act makes (block, record kind, task), person and template seconds | a decision takes its row's time; a world without rows runs as today | 1 |
| F3 | Kernel and contract: performers on any act (`by`), presence and capability checks, `by` on records and events | M1's field exists; a clerk not at work cannot decide | 2 |
| F4 | Kernel and contract: templates with `does`, `supplier`; `deploy` by the supplier to a client; `retire` by owner or supplier; refusals; fixtures updated | a system does a task, a person's hours are freed; a vendor can switch off | 2 |
| F5 | Generator and profiles: posts held by people; staff hired on the staff line; genesis systems under licence; work rows per profile, placeholders marked; the newspaper staffed | every post has a person or a supplied system; baseline measured before/after | 3 |
| F6 | Behaviour: delete the dials (support load, venues' `cases_per_day`, the clerk's one paper); offices name performers from their rosters; firms' admin as rows | backlogs come from hours; the deleted parameters are gone from profiles | 3 |
| F7 | Platform: `slip()`, rates moved to rows with their sources; the backlog doubling deleted | no module draws an error any other way | 1 |
| F8 | Law as data: review and appeal routes per decision kind; generic reconsideration; venues `set_aside`; the three code-held rules of law 6 | an office's decision can be reviewed, appealed and set aside | 2 |
| F9 | Seats: the office's diary in its books; outcomes with times; resolver fills `by` from the roster; a mock seat for 60 days | a mock seat sees its staff and falls behind when it does all itself | 1 |
| F10 | The backstop and the docs: `orchestrator/test/all-work-takes-time.test.ts`; `docs/all-work-takes-time.md`, like `no-god-view.md` | the test passes on every profile, and fails on a planted free holder | 1 |
| F11 | Keepers' answers take time (2.7) | a registry with one clerk answers slower than one with a system | 1 |

**Total: about 20 agent-days**, then about 25 left of the GD plan: **about 45 in all**, against 42 for the plan as it
stood. The foundations do not make the whole cheaper; they make it general, delete about fifteen existing special
cases, and stop the next ones being needed. Robustness probe R1 can run first on today's kernel (it measures only);
R2 to R5 follow F10, since R4 touches the same kernel code.

**The backstop** (F10), like `no-god-view.test.ts`, generates the town (code seats, and every office handed to a
model) and fails, naming the post or module, on: a holder that is neither a person nor a supplied system; a record
kind any module or form writes with no row in the work table; a behaviour parameter that sets throughput or delay
directly (it reads the generated config for the names of the dials F6 deletes, and for any `*_per_day` capacity); an
error drawn outside `slip()`. It should never fire.

## 8. For the owner, and what would stop us

**Questions** (each with a recommendation; all three answered yes by the owner, 2026-10-15, as recommended):

1. **The four kernel changes** (one time ledger; time read from what an act makes; performers on any act; systems
   only from a supplier's template, delivered and switched off by the supplier). *Recommend: yes, all four.* They are
   physics, not law: the kernel still refuses only what is impossible, and none says what anyone may do.
2. **Every town's baseline moves.** Offices hire clerks from the town, pay licences for the systems they already run,
   and fall behind when short. Old pilots stay comparable only with twins at their own git ref. *Recommend: yes,* with
   every new figure sourced or marked placeholder, and one measured before/after recorded; no outcome tuned back.
3. **How fast is a seat?** *Recommend: a seat in a human post works at that post's person speed* (its thinking inside
   the work's time, not charged again); a model at machine speed only when it is itself the system, as a separate
   experiment later.

**What would stop us:** F1 makes a 10,000-person month more than 1.5 times slower and the cause cannot be fixed in
the kernel; F5 leaves towns unable to staff their offices at sourced wages without changing the place's figures
(then the baseline needs the owner before F6); casework seconds cannot be sourced for any place (then two sourced
profiles carry the experiments and the rest are marked); the backstop cannot be written without a list of exceptions
(then it is a guard, not a law, and the design is wrong somewhere); or F6 turns into a module-by-module chase
(checkpoint with the owner, as for whack-a-mole).
