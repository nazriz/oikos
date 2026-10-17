# Porting the world to Rust: the guide

For the agents porting the built-in actors (plan: `docs/design/rust-port.md`; the frame: decisions log, 2026-10-17,
"The port's frame"). Read `CLAUDE.md`, `docs/no-god-view.md`, `docs/all-work-takes-time.md` and `docs/risks.md` first:
their rules bind every actor you write.

**The cutover is all at once** (the owner, 2026-10-17). There is no bridge: TS actors and Rust actors never run in
one world. Each lane ports its modules and tests them alone in the Rust world, with stand-ins for what it depends on;
then one integration step switches every module over together and runs the gate. Backward compatibility is not
required: old logs need not replay on the new world (the `pre-foundations` tag and the old code keep them), and the
log format and the tools may change if the logs get better.

---

## 1. The frame

```
kernel/crates/
  sight     what an actor may see and say: Observation and its parts, the Picture (view.rs, from view.ts),
            Action, the call language (re-exported). Values only.
  rules     pure rules the actors and the generator share: slip.rs; calendar.rs (civil dates, weekdays, holidays,
            calendar months from the world's start date); identity.rs (ids and names); forms.rs (an office's
            stationery and the forms catalogue, forms/papers.json); law.rs (reading a law against an act; laws
            written from figures); withholding, support, decisions, household to come. Depends on core and law.
  actors    the actors: lib.rs (Actor, Kind, Ctx, Cx, Question/Answer, Belief), steps.rs (Step, Plan, Stepper, say/pay),
            draws.rs (how streams are named), registry.rs (joins each group's KINDS), stub.rs;
            common/ (the book, asking, letters, standing work, laws, money, call builders: section 5.1);
            papers/ (a type per paper kind, by lane, and agreements: 5.2);
            citizen/ (A1; mind.rs is the seam to A2: 5.4), mind/ (A2), firms/ (C1), market/ (C2),
            finance/ (D), offices/ (E), boundary/ (weather.rs, the worked example; C2's outside world).
  explore   the explorer's data layer, interface only (section 9).
kernel/src/engine.rs   the run loop with the actors inside: units from the cast, rounds, parallel decide, carry-out.
kernel/tests/engine.rs, actors_boundary.rs, papers_typed.rs   the engine's tests, the boundary and paper backstops.
orchestrator/test/port-weather.test.ts       the worked example against the TS module, to the state hash.
participants/test/port-forms.test.ts         the forms catalogue equal to papers.ts until the cut-over.
contracts/test/law-drafts.json               laws drafted from figures: the TS answers the Rust is held to.
scripts/port-gate.ts                         the gate's measured half.
```

- **The boundary is a dependency rule.** `oikos-actors` depends on `oikos-sight`, `oikos-core`, `oikos-contracts`,
  `oikos-rules`, `serde`, `serde_json` and nothing else; `oikos-rules` on `oikos-core`, `oikos-law` (the law reader:
  pure) and serde (`kernel/tests/actors_boundary.rs` checks both lists). A Rust
  crate can name only its own dependencies, so an actor cannot name `State`, `World`, `observe` or the resolver's
  knowledge. Adding a dependency to `actors` needs the integration agent's yes and a line in this guide.
- **A moment** (engine.rs, top comment): those due wake in key order; each looks through the kernel's command path
  (logged, delivered, knowledge kept for the resolver); every code actor of the round steps at once on up to
  `threads` threads, each result in its unit's slot; seats go to the host; then everything is carried out serially in
  key order. A step is a pure function of the picture, the actor's own memory and its keyed streams.
- **Questions to models** (consult, compose, reading): `cx.ask(Question)` in one wake; the engine queues them
  (`Engine::questions`); the host answers (`Engine::answer`); the answers arrive in `cx.answers` at the actor's next
  wake. An actor never waits inside a step.
- **Seats** attach through the participant API: `Engine::next()` returns `Due::Seats` with each awake seat's
  observation as the contract's JSON; the host `submit`s an `Action` for each (a confirmed draft is an `Act` with its
  provenance); `next()` again carries the round out. The TS seat host is wired to this in the integration step (lane F).

## 2. Conventions (the checklist; rust-port.md 2.5)

- **Rewrite, do not transliterate.** Same behaviour, same parameters (names and meanings unchanged, so profiles and
  configs keep working), Rust's shape. A module's doc in `docs/behaviour/` keeps its sources; update it where the Rust
  decides fresh.
- **Integers** for money (cents), basis points, ppm, seconds. Floats only where a model needs them (half-lives,
  softmax), through `libm`, and rounded to an integer before anything compares or records them.
- **Ordered collections** (`BTreeMap`, `BTreeSet`, sorted `Vec`) wherever iteration can reach an outcome. `HashMap`
  only for a lookup never iterated, with `// lookup only` on the line (the backstop greps).
- **No clock, I/O, env, threads, globals, `RefCell`, `Mutex`, `rand`** in `actors` or `rules` (the backstop greps).
  Randomness only from `cx.rng(purpose)` (named by who, the matter or day, and the purpose: draws.rs) or
  `cx.chance(purpose)` (a fact about a thing). A slip only through `oikos_rules::slip::slip(cx, ...)`.
- **Where TS relied on JavaScript**, decide explicitly and say so in the module's doc: `Math.round` (half up), ties
  (an id tie-break), string order (byte order; ids are ASCII; never sort names for an outcome), object key order (never
  relied on). Record ids sort by `filedBefore` (rec.9 before rec.10), not as strings.
- **Dates are civil dates.** A month is a calendar month (`rules::calendar::Calendar::months_after`), not 30 days,
  wherever the law or a contract says a month; a working day is the calendar's. Ids are keys; what a seat reads is a
  name (`rules::identity`).
- **No place in the code.** Every place figure is a parameter from the profile (docs/profiles.md); the generality
  backstop will scan `kernel/crates/actors` and `rules` as it scans `participants/src`.
- **No god's view.** An actor knows what it was shown (`Picture`), its parameters and its memory. What it keeps whole
  (a register's keeper) is declared in its manifest's `keeps`, what it carries of the world's edge in `boundary`
  (weather.rs does), with the reason in words.
- **All work takes time.** Never write a mechanic that does something by itself: every effect is an act the kernel
  places on its performer's timeline. A module that needs another body's work sends it a paper.
- **Every actor's memory saves** (`Actor::save`, `Kind::restore`: required). A `Stepper` saves its plan and steps for
  you if the plan and its token derive `Serialize`/`Deserialize`. This is what snapshot and fork rest on.
- **Manifests**: `Kind::manifest()` returns the module's manifest (contracts/module.schema.json); until the cut-over it
  must equal `participants/manifests/<name>.json` in every key that file has (engine.rs test for weather shows how).
- **Market laws are built natively, not ported** where the risk register flags a fixed rule (risks.md ME-*, A-2, the
  summary): business entry by expected profit, not a fixed birth rate, and new businesses able to employ; prices from
  supply and demand; hiring by firms that need labour; exports from demand, not the opening output; rents set by the
  market at review, not +5% every time; strikes settled by a bargaining model, not won after three stoppages. Each with
  its real-world source in `docs/research/references.md`, the risk's entry updated in `docs/risks.md`, and a line in
  the decisions log. Coordinate with the disempowerment agent's market check (branch `gd-adoption`) before building.
- **Fix wrong assumptions as you go**, each with a real-world basis, recorded in `docs/risks.md`. Calibrate
  mechanisms, not outcomes: a bad outcome that emerges is not a bug.

## 3. How to port a module (the worked example: `world.weather`)

1. Read the TS module and its doc. Read its unit tests (`participants/test`) and the scenario tests that exercise it
   (`grep -l <name> orchestrator/test`).
2. Write the kind in `kernel/crates/actors/src/<group>/<module>.rs` (`boundary`, `citizen`, `mind`, `firms`,
   `finance`, `offices`): a `struct` implementing `Kind` (name, version, doc, manifest, cadence, first_wake, deaf,
   create, restore) and its actor. An office that plans work and sends it one act at a time is a `Plan` run by
   `Stepper` (steps.rs: what `stepper` was in firms.ts; `then`/`redo` are the plan's methods given the step's token).
   Build calls with `steps::say`, `steps::pay`, `steps::call`; the program is written in name order, as TS's was.
3. Register it in its group's `KINDS` (`<group>/mod.rs`, one line; `registry.rs` joins the groups).
4. Port its unit tests beside the code (`#[cfg(test)]`), rewritten to assert the behaviour, not TS's numbers.
5. Test it alone in the Rust world (section 4).
6. Bump nothing in TS. TS behaviour is frozen.

`world.weather` (boundary/weather.rs) took 120 lines: a `Plan` with no books, its `plan` the TS one's loop, its
`until` the next warning. `orchestrator/test/port-weather.test.ts` runs the TS module in the TS loop and the Rust kind
in the engine on the same generated town, every other actor idle in both, and gets the same warnings and **the same
final state hash**, and the same hash on 1 and 14 threads. A module ported that faithfully, in a world where every other
actor is idle or scripted, should match its TS twin to the hash; where it decides fresh (section 2), it will not, and
the test asserts the behaviour instead.

## 4. Testing a module alone

- **Rust tests** (`kernel/tests/<lane>_*.rs`, `cargo test --test <file>`): start from a world config (a small
  hand-written one, `common::riverbend()`, or a generated town written to JSON by a TS helper), point the participants
  under test at your kind, and run `engine::run_code_world` with `EngineOptions { stand_in: Some("idle".into()), .. }`
  so every kind not yet ported stands idle. Read the log (`Engine::into_log`) and assert on records, events and acts.
  kernel/tests/engine.rs shows each step.
- **Stand-ins for what you depend on**: `idle` (does nothing), and `stub.script` (does what its `script` param says,
  when it says: `[{ "at": seconds, "call": "<call language>" }]`), so a landlord's notice, an employer's pay or a
  bank's statement reaches your actor as the real one's would. Write the dependency's papers exactly as its lane's
  paper types say (section 5).
- **TS scenario tests are the outside referee**, run against the all-Rust world once every module is in (the
  integration step). Before that, a lane may run a scenario test against a Rust world where everything else is idle or
  scripted if the test's assertions only touch its modules (as port-weather.test.ts does).
- **Determinism**: every lane's tests run their world on 1 thread and on 14 (`EngineOptions::threads`, `share_at: 1`)
  and assert the same hash.
- **Heavy runs through the slots** (`bun scripts/slots.ts --weight N -- cargo test ...`). Each lane builds in its own
  worktree's `kernel/target`. Never run `test:all`.

## 5. The interfaces between modules (step 1b: settled)

Modules meet only through the world: papers (statements of a kind, with their `data`), agreements (by template),
payments (memos, `settles`, `per_instruction`), letters, and forms; and the citizen's life meets its mind through one
trait. All of it was written in step 1b (decisions log, 2026-10-17, "Port step 1b"), so the lanes can work at once.

### 5.1 The common ground: `actors::common` (common.ts, contracts.ts helpers)

| Rust | Replaces | What it is |
|---|---|---|
| `Book` (`common/book.rs`) | `Book` | Everything an actor has seen, indexed as records arrive: `absorb(&pic)` (fresh records back), `get`, `all(kind)`, `open(kind)` (standing), `of_type`, `claims_by(ClaimKey, v)`, `lot_over(cell)`, `practices`/`hearings`/`assertions`; `withdrawn`, `withdrawn_at`, `current` (follows amendments), `repealed`, `on_hold(id, by)`, `released`; `signed_by`, `concluded`, `taken_back`, `in_force`, `ends_at`, `reading`, `signed_at`, `notices`; `author_entity`, `position`, `person_of`, `entity_kind`, `entities_of_kind`; `note_unread`/`take_unread`; `save`/`restore` (and `Serialize`). No shelves (decided fresh: no globals; records are `Arc`s already). |
| `data`, `kind`, `is_kind`, `text`, `addressed_to`, `part(r, Piece)`, `bases_of`, `cites`, `cited_words`, `first_due`, `made_at`, `truthy`, `Fields` (`.s`, `.i`, `.ids`, `.flag` on JSON) | contracts.ts `basesOf`, `firstDue`, `madeAt`, `r.data?.x` | Reading a record's parts leniently, for code not yet on a typed paper. |
| `ask::{one, about, board}`, `look_up::{entity, participant, position, name, holders}`, `go_see`, `visited`, `owner_looks`, `who_wrote`, `Asked`, `VISIT_MAX`, `LOOKS_MAX` (`asking.rs`) | `ask`, `lookUp`, `goSee`, `visited`, `ownerLooks`, `whoWrote`, `Asked` | The only ways to know what someone else keeps (docs/no-god-view.md). |
| `Letters`, `Letter`, `message`, `office_note`, `REPORT_TAIL`, `what_it_acts_on`, `acknowledged`, `Answering<A>`, `PAYMENT_FAILED::{note, is}`, `PAYEE_DIED::{note, who}` (`letters.rs`) | the same | An office's letters; `Answering` wraps an actor whose module's `answers` has no report (common.ts `answering`). |
| `StandingWork`, `Part`, `WorkOrder`, `work::Routine`, `work::ReportOf`, `CounterWork`, `Directions`, `approval_of`, `Pace` (`work.rs`) | the same | Routine work by standing order, the staff's report (`staff_report`), the counter, directions on an office's own form, who approves a payment, a manager's sense of pace (integers: thousandths of a second). |
| `prohibitions`, `breaches`, `holds_of`, `noted`, `condition_of`, `laws::figures` (`laws.rs`) | the same | Laws weighed against an act (a law binds code only this way). |
| `own_account`, `own_banked`, `receipts`, `cents`, `notices_of`, `bill_settled`, `published_price`, `brought_forward` (`money.rs`) | the same; firms.ts `receipts` | Money as an actor sees it: `i64` cents (the kernel's `i128` saturated). |
| `withdraw`, `move_in`, `move_out`, `vote`, `record` (`calls.rs`); `steps::{say, pay, call, because}`; `papers::agreements::{offer, sign, notice}` | the call builders | Every act an actor writes. |
| `filed_before`, `team`, `out_of_time`, `next_look`, `next_working(cal, ..)`, `stood_empty`, `variable_today`, `structure_of`, `cells_of`, `lot_of`, `petition_signatures`, `published_count`, `between(lo, hi, rng)`, `Occurrences`, `latest_by_speaker`, `starts_on`, `NOTICE_LAG`, `DAY`, `MONTH` (30 days, only where TS meant a fixed 30), `YEAR` | the same; `Latest` | Small shared rules. |
| `when_words(t, world)`, `money_words(n, world)`, `duration_words(s)` | `whenWords`/`dateWords`, `usd`, `durationWords` | **The one place a date is written in words.** With a calendar it writes the civil date (ISO until lane N gives the profile's words); without, "year N, day D". Lane N changes it; every other lane calls it and never formats a date itself. |

`WorldInfo` gained `calendar: Option<rules::calendar::Calendar>`, read by the engine from the config's `calendar`
(lane N writes the section). `oikos-sight` re-exports `CmpOp`, `Condition`, `Order` and `Going` (a visit's places)
for `ask`.

### 5.2 Papers: `actors::papers`

One Rust type per statement kind one module writes and another reads: **172 kinds**, `Serialize` + `Deserialize`,
each with `impl Paper { const KIND }`, a doc comment naming its writers and readers, and round-trip tests from JSON
shaped as the TS writes it. Conventions are in `papers/mod.rs` (optional fields, unknown fields allowed, `lenient`
readers for amounts a seat's form writes as decimal strings and yes/no written as words). A writer puts
`papers::data(&p)` in `Say { data }`; a reader takes `papers::read::<P>(record)`.

| File | Owner | Kinds |
|---|---|---|
| `citizen.rs` | A1 | 30: job and rental applications, claims for support, a tenant's answers and requests, death and birth notifications, household, petitions, enrolments, departures, care, stays, supply, trading |
| `mind.rs` | A2 | 7: founded groups' papers (purpose, membership, notice, fund claim and decision, hall booking, wound up) |
| `firms.rs` | C1 | 26: job postings, payroll notices, withholding and tax reports, hours, wage offers, closures and sales, the landlord's listings, rent increases, notices to vacate, applications and replies to the tribunal, rent statements |
| `market.rs` | C2 | 27: price lists, orders, delivery notes, invoices, buying offers, the outside world's support decisions, statistics, valuations, weather, arrivals, environment and habitat; gd-adoption's systems and tenders (marked) |
| `finance.rs` | D | 30: the bank instruction (`request`), loans, the fund, the union's papers, news, grievances and their answers, evidence and review papers, signatories and registers |
| `offices.rs` | E | 52: what every office reads (hold, direction, work_order, staff_report, budget, law, law_schedule, procedure, form, lot), the council, planning and the inspector, registries, police, tribunal and desk, school, elections, utilities, office books |

A kind written in two lanes is in the file of its first writer, and the others write it through the same type
(`tribunal_application`: firms.rs, the police write it too; `death_notification`: citizen.rs, the police and firms
too). `kernel/tests/papers_typed.rs` fails if a kind TS writes by name, or a module reads by name, has no type.

**Agreements** (`papers/agreements.rs`): the templates in use (`EMPLOYMENT`, `LEASE`, `LOAN`, `MEMBERSHIP`, `SALE`,
`PITCH`, `LICENCE`, `NEWCOMER`), each with who offers and who reads it; `Outcome` and its parts; `outcome_of`,
`template_of`, `parties_of`, `other_party`, `commitment_of`, `commitments_of`, `lease_terms` (`LeaseTerms`),
`job_terms` (`JobTerms`), `advertised_job`; the builders `offer` (`Offer`), `sign`, `notice`. Owned by 1b: a change
is told to every lane a template's doc names.

### 5.3 Forms and law: `oikos_rules::forms`, `oikos_rules::law`

- **Forms** (`rules/src/forms.rs`): the types (`FormField`, `Issued`, `FormWrites`, `FormClaim`, `Sends`, `Taken`,
  `Routine`, `Every`, `Answers`, `AnswerForm`, `Opening`, `Kept`, `Ordered` for fields in the order written) and the
  **catalogue**: papers.ts's 77 forms in 28 groups by export name (`catalogue()`, `group("LANDLORD")`,
  `form("TRIBUNAL_MEMBER", "possession_order")`, `all()`), read from `rules/forms/papers.json`, which
  `scripts/port-forms.ts` writes and `participants/test/port-forms.test.ts` holds equal to the TS until the cut-over
  (then the JSON is the source). `plan_law`, `plan_law_words`, `possession_order_for`, `staffing_own` port papers.ts's
  functions. A kind's manifest builds its `issues` from the catalogue. Writing a filled form into its paper stays the
  engine resolver's (`resolver/src/forms.rs`); the mock seat's reverse (`fieldsFor`) stays TS. **Lane E owns the
  catalogue's content and exports it by name for the translator.**
- **Law** (`rules/src/law.rs`): `evaluate`, `violations`, `standing_claims`, `Claim` (the law reader, `oikos-law`:
  `rules` now depends on it; the boundary test says so), and laws written from figures by a schedule: `LawFigure`,
  `LawSchedule`, `HeldFigure`, `DraftLaw` (`data()`, `formal_part()`), `draft_law`, `figure_words`, `held_in`,
  `held_value`, `figure_given`, `figures_of`. Held to the TS by `contracts/test/law-drafts.json` (every schedule of
  worlds/law/schedules.json, with each optional figure left out: `scripts/port-law-cases.ts`): equal in all 10.

### 5.4 The mind's seam: `actors::citizen::mind`

A1 writes the citizen's life against the trait `Mind` (`Outlook` + the calls below); A2 implements it in
`actors::mind` (`mind::make`, `mind::restore`, which until A2 lands return `Plain`, the stand-in A1 tests with:
params `mind: "plain"`). The rule: life owns the body, household, money, home, job, the book and every act; the mind
owns values, temperament, what was learned, feelings, ties, trust, agency, wants, norms, beliefs, town memory, the
person's own record, the `decision`/`outcome` annotations and every question to a model (`cx.ask`; answers in
`cx.answers` at the next wake). Neither reads the other's insides.

| Call | From citizen.ts |
|---|---|
| `woke(cx, pic, book, life)` | the start of a wake; answers to its questions arrive here |
| `decide(cx, life, Decide) -> Decision` | `decide` (home, job, shop, practice, vote ...): needs from `Life`, recorded and numbered |
| `choose_known(cx, domain, options, follows)` | `learned(d).choose` (the shop retry) |
| `choose_conduct(cx, life, ConductAsk) -> Conduct` | `cul.term`/`reads`/`cul.act`: a yes-or-no a norm leans; life draws (`draw_bps`) |
| `outcome(cx, life, Outcome)` | `outcome`, `learn`, `hearOf` (about 70 places) |
| `treated(cx, Treated)` | `inner.experience`, `tried`, `doneTo`, `landing` (about 60) |
| `event(cx, life, Event) -> Heard` | `inner.happened`, `wantBorn` from life's events, `grieve`, the inbox's talk |
| `plan(cx, pic, book, life, &dyn Openings) -> Planned` | `plan`'s mind half: wants and their ways, gatherings, founding, civic acts, talk; returns steps and chosen ways (`Intent`), which life carries out |
| `say_how`, `troubles_to_tell`, `record(cx, life)`, `words_done`, `save` | `newsOfMine`, `SAYING.trouble`, `writeRecord`, `Words.done`, memory |
| `Outlook`: `value_z`, `facet`, `trust_z`, `agency_z`, `attached`, `feeling`, `affinity`, `closest`, `learned`, `wants`, `initiative`, `pursuing`, `patience_days`, `satisfaction` | the ~40 places life read mind state |

Shared plain data: `Life` (the person's circumstances, made fresh by life before each call), `Housed`, `Born`,
`Facts`, `Choice`, `Decide`, `Decision`, `ConductAsk`, `Conduct`, `Way`, `Outcome`, `Treated`, `Event`, `Heard`,
`WantView`, `Opening`, `Intent`, `Openings` (life's trait: the ways open for a want), `Chosen`, `Planned`, `Tie`.
z-scores are hundredths of a standard deviation (integers). The file is A2's; A1 is told of every change.

### 5.5 The registry

Each group has its own `KINDS` list (`boundary`, `citizen`, `mind`, `firms`, `market`, `finance`, `offices`);
`registry.rs` joins them, so no lane edits another's line.

### 5.6 What the lanes must still agree (not settled by 1b)

1. **The mind seam's `Event` and `Intent` variants** (A1 and A2). The lists are TS's as the seam analysis found them,
   each with an `Other` for what recurs; A2 says by its first day which variants it handles, A1 which it reports, and
   a variant one side needs is added by A2 with A1 told.
2. **Who builds `Life`, and when** (A1): before each `decide` and `choose_conduct`, as TS read balances fresh.
3. **Rents at review** (the guide's C2 "with A1"): the landlord is firms.ts, so **C1** owns the rule; the market
   evidence it reads (listings, what let and for how much) is C2's. C1 and C2 agree the paper (a `rental_listing`
   and what a let says) before building.
4. **gd-adoption** (not merged): it settles strikes by what a stoppage costs each side (Hicks; B10) in TS, which lane
   **D** ports as its bargaining model rather than inventing one; and it adds `automation.ts` (an outside vendor's
   systems, adoption by firms and offices), which is in no lane: proposed **C2** (the vendor, at the world's edge)
   with **C1** (the firms' adoption). Its paper types are in market.rs, marked (two of their fields are fractional as the TS writes them, held as the
   JSON number: whoever ports it gives them an integer unit). Whoever ports it reads its decisions
   entries first. No entry called a "market check" was found on the branch; C1 and C2 ask its owner before building
   entry, hiring and prices natively.
5. **`books.ts`** (an office's books for its clerk) was in no lane: assigned to **E** with the offices (its paper,
   `office_books`, is in offices.rs). The seat-side readers (`openbooks*`, `daybook`, `roster`, `tally`, `diary`) stay
   TS.
6. **Dates in words** are lane N's (`common::when_words`); until N lands, papers carry ISO dates where a world has a
   calendar and "year N, day D" where not.
7. **Memory at 10,000 people**: a book holds a pointer per record and its own indexes (no shared shelves). If phase 3
   finds books too large, the engine hands them a shared index; no lane's code changes.

## 6. What not to touch

- `kernel/crates/world`, `perception`, `contracts`, `terms`, `law`, `nature`: the world's physics. A change needs
  the integration agent (and stays physics: no laws in the kernel).
- `kernel/src/engine.rs` and `crates/sight`: the frame; changes through lane F or the integration agent.
- Anything in `participants/src/behaviour/*` or the generator's output (frozen; a fault that corrupts a pilot's data is
  fixed in TS and listed for the port).
- Another lane's modules and paper types (message their owner).
- `docs/decisions.md` beyond your own appended entry; `CLAUDE.md`.

## 7. The gate

All on the finished Rust world (rust-port.md section 3): every TS scenario test passes; a year of the 1,000-person
living town in au-vic-2026, gb-eng-2026 and ke-nakuru-2026, five seeds a side, every standing measure within three
standard errors and each beyond two named with a likely cause, health breaches the same in kind
(`bun scripts/port-gate.ts --ts <checkout of ts-world-final> --rust <candidate>`); twins exact; the same state hash on
1 and 14 threads (the harness checks this too); the no-god-view, all-work-takes-time and generality backstops,
extended to read the Rust manifests and scan `kernel/crates/actors` and `rules`; truth audits on in every scenario
test with zero divergences (the engine's `audit` option ports truth.ts).

## 8. The split

**Step 1b, the common ground: done** (decisions log, 2026-10-17, "Port step 1b"). Section 5 is what it built: the
common ground, 172 paper types and the agreement templates, forms and law in `rules`, the mind's seam, and a registry
by lane. The seven start from the branch it is on.

**Step 2, the seven at once (6 to 8 days).** Each in its own worktree off the frame (with 1b); each ports its unit
tests, tests its kinds alone (section 4), and messages the owner of any paper type it needs changed. **All seven can
start now, together.** Nothing waits on another lane: what a lane needs of another is a paper type (written), a
stand-in (`idle`, `stub.script` writing the other lane's papers), or for A1 the plain mind. Order within the week, so
the others' tests get real counterparts sooner: A2 settles the seam's `Event`/`Intent` lists on its first day; C1's
`Staffing` and landlord and E's registry and tribunal are what most other lanes' scripted stand-ins imitate, so they
go first in those lanes.

Every lane may call: all of `actors::common`, `actors::steps`, `actors::papers` (read any type; write its own),
`actors::papers::agreements`, `oikos_rules` (`slip`, `calendar`, `identity`, `forms`, `law`, and the rules lanes add),
`oikos_sight`, and `Cx` (`rng`, `chance`, `ask`, `decided`, `learned`, `set_record`). No lane calls another lane's
actor code; they meet only through papers, agreements, payments, letters and forms (and A1 and A2 through the seam).

| Lane | Model | Owns (writes) | Also owns | May call beyond the common set | Its tests |
|---|---|---|---|---|---|
| A1 citizen: life | Opus | `actors/src/citizen/` (all but `mind.rs`): citizen.ts's life, `household`, `health`; `papers/citizen.rs` | `rules::household` (the generator calls it) | the seam: `citizen::mind::{make, restore, Mind, Outlook}` and its data types; implements `Openings` | participants/test's citizen, household, health, deaths, housing, recourse tests, rewritten in `citizen/` and `kernel/tests/a1_*.rs`, with `mind: "plain"`; the citizen's scenario tests (deaths, housing, recourse) against a Rust world with the rest idle or scripted |
| A2 citizen: mind | Opus | `actors/src/mind/`, `citizen/mind.rs` (the seam), `papers/mind.rs`: citizen.ts's deciding half, `mind`, `inner`, `wants`, `culture`, `townmemory`, `reading`, `founding`, `founded` | the questions to models (consult, compose, reading) as `Question` kinds the host answers | nothing of A1's | mind, inner, wants, culture, townmemory, reading, founding tests, driving `Mind` directly from a test harness of `Life`s and events (no life code needed); `kernel/tests/a2_*.rs`; the founded group's post as a kind |
| C1 firms | Sonnet | `actors/src/firms/`, `papers/firms.rs`: `firms` (employers, landlords, builders, works), `payroll`, `returns`, `tax`, `payments`, `orgwants`, `practice` | `rules::withholding`, `rules::support`; native firm entry by expected profit and hiring by need (risks ME-*); rents at review (5.6, 3) | — | participants/test's firms, payroll, tax, payments, landlord tests; `kernel/tests/c1_*.rs` with citizens scripted (applications, rent, tenants' answers as `stub.script` papers) |
| C2 market | Sonnet | `actors/src/market/`, `actors/src/boundary/` (but `weather.rs`), `papers/market.rs`: `retailer`, `producer`, `trade`, `lengnick`, `world`, `environment`; `automation` once gd-adoption merges (5.6, 4) | native price formation from supply and demand; exports from demand (ME-15) | — | retail, production, trade, world, environment tests; `kernel/tests/c2_*.rs` with shoppers and firms scripted |
| D finance and bodies | Sonnet | `actors/src/finance/`, `papers/finance.rs`: `bank`, `credit`, `fund`, `union`, `news`, `frictions`, `decisions` | `rules::decisions`; the strike bargaining model, ported from gd-adoption's (5.6, 4) | — | bank, lending, fund, union, news, frictions, decisions tests; `kernel/tests/d_*.rs` |
| E public offices | Sonnet | `actors/src/offices/`, `papers/offices.rs`, `rules/forms/papers.json` (the catalogue): `government`, `institutions`, `police`, `tribunal`, `desk`, `school`, `elections`, `utilities`, `books`, papers.ts's forms | the forms registry exported by name for the translator | — | government, institutions, police, tribunal, desk, school, elections, utilities, books tests; `kernel/tests/e_*.rs`; `participants/test/port-forms.test.ts` until the cut-over |
| F the platform | Opus | `kernel/src/engine.rs`, `crates/sight`, `crates/napi`, the TS host, snapshot and fork, the binary log, the event stream, manifests to JSON, the generator calling `rules`, the twins' detached actor, the backstops reading Rust, the reserved shapes for travel | the experiment harness on snapshot and fork if time allows; otherwise lane G | everything in the frame | `kernel/tests/engine.rs`, the backstops, twin and determinism tests |

What every lane owes besides: its manifests equal `participants/manifests/<name>.json` (section 2), its behaviour
docs updated where the Rust decides fresh, risks it fixes updated in `docs/risks.md`, and one decisions entry.

**Lane G, the explorer and experiments (1 Sonnet, can start now; reads logs only, independent of the actors).** The
explorer's data layer in `kernel/crates/explore` (section 9), ported from the `explorer` branch; then the experiment
harness on F's snapshot and fork: many seeds and forks across cores, each with a different steward or none, measures
collected per fork set (the unit of an experiment is a set of forks). **Built** (docs/explorer.md, docs/experiments.md,
docs/decisions.md 2026-10-18): the data layer in `kernel/crates/explore` with its service and `oikos-explore`; the harness in
`orchestrator/src/experiment.ts` (`oikos experiment`).

**Lane N, names and ordinary dates (1 Sonnet, can start now; docs/design/names-and-dates.md).** The profiles'
`names` and `calendar` sections with sources (research agents, one a profile, as the profile pattern does); names drawn
in the generator by streams keyed on stable identities (twins hold); offices' own references for records
(`data.reference`); the config's start date and `rules::calendar` (types in the frame) with a shared test file in
`contracts/test/`; the resolver reading names and dates (only among what the seat has been shown) and seats shown names
and dates, ids underneath for the log and tools. Lanes A1 to E count dates with `rules::calendar` and write them in words only
through `common::when_words`, which N changes (it writes ISO dates until then), never "year N, day D" themselves. The translator's next round learns names and dates.

Seat-side readers (`openbooks*`, `daybook`, `roster`, `tally`, `diary`) stay TS.

**Step 3, integration and the gate (1 Opus, 2 Sonnet, about 5 days).** Merge the lanes; every module switched over
together; the TS scenario tests against the all-Rust world; `scripts/port-gate.ts`; every failure traced to its module
and sent back to its lane. Then speed (phase 3 of the plan) and deleting the TS actors (phase 4).

## 9. The explorer's data layer

Interface fixed in `kernel/crates/explore/src/lib.rs`; implementation is lane G's, ported from `renderer/src/
indexer.ts`, `store.ts`, `trace.ts`, `world.ts` and `panels.ts` on branch `explorer` (not reinvented):
- `RunIndex`: every kept line by ordinal, the lines naming an id (person, place, organisation, record, account), lines
  by day, the act behind each effect; the run's meta.
- `RunIndex::trace(ord, about, depth)`: the causal trace as `Link`s (role, sentence, who, class, why, status, record),
  newest first, back through acts, standing instructions and bases to genesis; nothing inferred.
- `Decider`: self, person, system, seat, world, by role in the world.
- `RunIndex::panel`: person, organisation, building, seat's act, town pulse, as the client's JSON.
- `ROUTES`: the HTTP/JSON service on 127.0.0.1, the same routes `renderer/src/server.ts` serves, so the Three.js client
  is unchanged. A Rust viewer (Bevy) uses the trait in process, and can index a live run from F's event stream.
- Debriefs and what a seat kept back are never indexed (VISION 15).

## 10. The platform (lane F): snapshot, fork, the binary log, the stream, the host

- **Snapshot and fork** (`kernel/src/engine/snapshot.rs`): `Engine::snapshot()` saves the whole run: the kernel's state
  (derived lookups made again on reading, `State::rebuild_derived`), the schedule, the cast, every unit's view, draws,
  looks, answers and actor memory (`Actor::save`), what each seat and unit knows for the resolver, unanswered
  questions, and a round still waiting on seats. Take it between moments (`Engine::next_by(t)` stops there without
  moving the clock) or while seats are out (`Due::Seats`). `Engine::resume(&snap, out, ..)` goes on exactly as the run
  would have (the same log bytes and hash, on any number of threads); `Engine::fork` is the same in memory, cheap (the
  state is persistent). `Snapshot::to_bytes`/`from_bytes` for disk. **Every lane's `save`/`restore` must round-trip
  through JSON**: an actor whose memory is nothing saves `null`.
- **The binary log** (`kernel/src/blog.rs`): put `BinLog` where the JSONL file would go. The same hash-chained entries,
  compressed in blocks (zstd), hashes as bytes, `prev`/`seq` implied; snapshot frames among them; a fork's log names
  its parent and the entry it carries on from. `oikos-kernel export <log.oklog>` writes the JSONL log back byte for
  byte (a fork's with its parents' entries first), so `verify`, `replay` and every tool read it.
- **The live stream** (`kernel/src/stream.rs`): `Tee` hands every log line to a `Stream` the watcher pulls, capped, with
  a count of what a slow watcher missed. Nothing in the world reads it.
- **The host** (`kernel/src/host.rs`; N-API `World`, `Detached`, `rules`, `manifests` in `kernel/crates/napi`): JSON in
  and out. TS: `orchestrator/src/rust-world.ts` (`RustWorld`, `DetachedActor`, `rustRule`, `runRustWorld`);
  `runWorld` under `OIKOS_WORLD=rust` runs `run.ts`'s own loop against the engine (`start` with `engine`; kernel/src/
  engine/hosted.rs): every seat feature as on the TS world, no code unit in TS; `OIKOS_STAND_IN=idle` until the
  cut-over. Seats of every fork can be out at once; the host records each
  seat's usage with `annotate`. A mock seat sitting as its code twin is decided by its brain's Rust kind run detached.
- **Rules by name** (`kernel/src/rules_api.rs`): the generator calls them through `worlds/generator/rules.ts` under
  `OIKOS_WORLD=rust`. A lane porting a rule the generator uses adds a line in each.
- **Travel** (docs/design/travel.md): roads, vehicle types, vehicles and positions in transit, as shapes only.
