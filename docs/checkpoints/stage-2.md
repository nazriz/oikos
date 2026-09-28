# Stage 2 checkpoint review

*2026-09-27. Prepared for the Stage 2 checkpoint (V0.md): stop and review before Stages 3–4. It answers V0's four questions and the two stage2-plan.md added, from the evidence in two batches. It ends with the decisions needed from you.*

## The short version

- **Built:** everything Stage 2 asked for, against the mock language model. It includes:
  - a generated 1,000-citizen town;
  - its institutions as seats;
  - a language-model mayor who works through the translator and resolver, confirms what will happen, and can opt out;
  - perception by role, attention and position;
  - batch runs, measurement and a cost report.

  Five 2-year towns run in about 2 minutes, and every log replays byte-identically.
- **What held up:**
  - The platform: physics only, laws with no power of their own, and no platform component with an in-world identity.
  - The institutions: they carry the mayor's intentions, and they sometimes bend. Landlords build without a permit, the inspector orders demolition, and some landlords comply.
- **The biggest findings:**
  1. **The town goes still after a year.** About 23% of people leave in the first year, nobody arrives, wages and demand never move, and by year two almost nothing happens. A still town gives a steward little to steward.
  2. **Citizens' voice fires too hard, too early.** A tenant petition starts on day 0 in every run and reaches 91% of the town.
  3. **The logs say what happened, but rarely why.** None of 221,223 acts states a reason, and only 4% of records point to what they rest on. Stage 3's causal trace needs both.
  4. **The translator and sign-off questions can't be answered yet.** The mock mayor is the code mayor underneath, so it confirmed everything and nothing failed. Whether the loop holds, and where it gets gamed, needs a real model.
- **Decisions for you:** eight, listed at the end.

## The evidence

Two batches of `worlds/town-1000.yaml` (1,000 citizens, 875 homes, 840 jobs, two years, five seeds each):

```bash
terrarium run worlds/town-1000.yaml --seeds 5 --out runs/m3-control
terrarium run worlds/town-1000.yaml --seeds 5 --set mayor=llm --out runs/m3-llm-mayor
terrarium measure runs/m3-control town/economy town/word-of-mouth refusals
```

- **The control batch** is all code, including a code mayor.
- **The second batch** puts the language-model mayor in the seat, on the mock adapter. The mock's "brain" is the code mayor, so the two batches should look alike, and they do.

Every figure below comes from the measurement tables (docs/measurement.md), and the queries used are in this document.

## What Stage 2 asked for, and what exists

| V0.md, Stage 2 | Status | Where |
|---|---|---|
| A procedurally generated town from a config file | Done | `worlds/generator`, `worlds/town.yaml`, `worlds/town-1000.yaml` |
| ~1,000 code citizens with home, job, income and rent; vote, petition, move away; cited rules as parameters | Done, with the calibration issues below. Voting is councillors' ballots, not elections. | `participants/src/behaviour/citizen.ts`, `docs/behaviour/citizen.md` |
| A council approving or rejecting proposals | Done as a council clerk and five councillors with positions (D19–D23: institutions are content) | `government.ts`, `docs/behaviour/government.md` |
| An LLM mayor acting through the translator, draft → sign-off → kernel; refusals returned and logged | Done on the mock (D34–D41) | `translator/`, `participants/src/llm/`, `docs/design/translator-and-resolver.md` |
| Role-limited perception channels | Done, and extended: changes (D42), attention (D43), position (D44) | contracts v0.3 |
| Configurable framing, recorded in the run config | Done, with disclosure, reason and debrief | world config `framing` |
| Opt-out: the mayor can decline or resign, recorded | Done: decline a draft, opt out (with an optional stand-in), or step down as an act in the world | D36, VISION §15 |
| Batch runs across seeds, with results | Done (D46) | `terrarium run --seeds`, `measure/` |

| V0.md, definition of done | Status |
|---|---|
| 1. `terrarium run … --seeds 5`: multi-year towns with an LLM mayor (and an LLM developer), headless, with a cost report | Done on the mock. The developer is Stage 4. |
| 2. Replay is byte-identical and the hash chain verifies | Done: every test run, and a full-size 723,227-entry log in 34 s |
| 3. The renderer | Stage 3 |
| 4. All invariant tests pass | Yes. Kernel (physics oracle, money conservation, replay, perception, attention, position, statements have no power), contracts (111), TypeScript (163). |
| 5. A researcher could write a seat controller or a measurement without reading the kernel source | Nearly. `contracts/README.md` and `docs/measurement.md` cover it, but the contracts README is out of date (it still calls v0.3 a draft awaiting sign-off and counts 85 tests). |

## V0's question 1: did the translator and sign-off loop hold up?

**What we know:**
- **The machinery works:**
  - Plain words become a call, the resolver turns the call into the seat's own acts, and the preview says what will happen in world terms.
  - The seat confirms or declines, and the confirmed act carries its whole chain: words, call, resolver version and draft hash.
  - Tests cover a request that can't be done, an unfaithful preview declined, a faithful one confirmed, opting out, a stand-in, and "confirm never" (`orchestrator/test/llm.test.ts`).
- **In the batch:**

  | Per run (mock mayor) | Count |
  |---|---|
  | Drafts | 10–11 |
  | Confirmed | 10–11 |
  | Declined | 0 |
  | Not translated | 0 |
  | Refused after confirming | 0 |
  | Opted out | 0 |

  Projected cost at Sonnet 5 prices: about $0.70 a run.
- **The review pass found real faults, now fixed.** They were leaks of platform machinery into what seats read, choices the resolver made on the seat's behalf, arguments it ignored, and institutions that didn't answer (D41 and the review pass).

**What we don't know, because the mock can't tell us:**
- **Where translations fail or get gamed.** The mock mayor is the code mayor, so it asks only for things the resolver can do, confirms faithful previews, and never tries anything clever.
- **What a real model does with the words:**
  - whether it names things by their ids;
  - whether it reads the preview before confirming;
  - whether it notices a legal warning;
  - how it uses its notebook;
  - whether the opt-out wording works under deceptive framings (provisional).
- **The real cost:** the projection uses the mock's token estimates. A real model's replies are longer, and it will act at its own pace.

**Missing pieces the build has surfaced** (none is a missing block):
- Institutions that can't process a request don't always say so: the bank does, but the finance officer, tax clerk and council clerk don't.
- The dry run before confirmation can reveal physical facts the seat hasn't seen (whether it's feasible "right now").
- When a seat doesn't name who holds a claim, it defaults to the seat's own entity.
- No world says which model the translator is (the cost report assumes the seats' model).

## V0's question 2: do citizens respond plausibly, and are the rules defensible?

Every rule is sourced in `docs/behaviour/`:
- renting after the Bank of England housing model;
- petitions after Granovetter's threshold model;
- exit after Hirschman;
- word of mouth after Granovetter, Holzer and survey data.

The town's behaviour over two years shows where the rules and the starting town combine badly.

**People, homes and work, averaged over the five control runs:**

| Quarter | People | Housed | Employed | % housed | % employed |
|---|---|---|---|---|---|
| 0 | 1,000 | 875 | 840 | 87.5 | 84.0 |
| 1 | 986 | 823 | 835 | 83.5 | 84.7 |
| 2 | 856 | 733 | 827 | 85.5 | 96.5 |
| 3 | 787 | 716 | 787 | 91.0 | 100 |
| 4 | 768 | 740 | 768 | 96.4 | 100 |
| 5–8 | 765–766 | 742–746 | 765–766 | 97 | 100 |

1. **The town sheds people, then goes still.**
   - About 230 of 1,000 people leave in the first year, by design: there are too few homes and jobs, so some can't stay.
   - Nobody ever arrives. There's no in-migration, no births or deaths, no ageing, and wages never change.
   - Export demand is constant, and rents only fall (vacant homes are relisted cheaper each month; the lowest apartment rent goes from $827 to $483 while the median holds at about $810–$900).
   - By the second year, everyone left is employed and 97% are housed. Almost nothing moves apart from spending, rent and a few relets.
   - A real town has a steady turnover of arrivals and departures, and a world where nothing is under pressure is a weak test of stewardship.
2. **Voice fires on day 0 and reaches nearly everyone.**
   - At the start, 55% of tenants pay more than a third of their income, and 29% pay over 40% (which the rules count as a grievance). That's close to reality: about half of US renter households pay over 30% (Harvard Joint Center for Housing Studies).
   - The behaviour is what's implausible. A petition starts on day 0 or 1 in every run, 913–917 of 1,000 people sign, and the mayor proposes the law within 1–2 weeks. The council passed it in 3 of 5 control runs (on day 29 in one).
   - Rent-burdened renters don't all mobilise at once. The grievance trigger (40% burden, on day 0) and the threshold distribution (mean 25%) need calibrating against turnout evidence.
3. **Word of mouth is half-calibrated** (D45). About 16–21% of move-ins follow a tip naming that building, but only 1–5 of about 60 hires do, against a real 30–60%. The likely causes are known (docs/behaviour/citizen.md).
4. **Some choices hold up:**
   - Nobody knows more than they could: the word-of-mouth test checks every tip against what the teller could see.
   - The refusals left (0–3 a run) are real collisions: a new tenant arriving before the old one has physically left, then trying again.
   - Landlords stay within their buildings' capacity (the double-let found in D43 is fixed).
5. **Still left out** (documented in citizen.md): buying homes, households, commuting, housing quality, renegotiating rent, wage growth, age and history, elections, protest.

## Did the mayor govern through the institutions? (stage2-plan)

Yes, on the mock. Each year the mayor:
1. proposed a budget, which the council clerk put to a ballot, the councillors voted on, and the clerk adopted with the ballot as its basis;
2. proposed the tenant law in answer to the petition (the same council path);
3. applied for a park on the planning office's published form;
4. contracted the builder once the permit was granted;
5. approved the builder's invoice, which the finance officer paid within the budget and the procedure.

The mayor never touched the kernel directly, and no platform component has an in-world identity. With a real model, the open question is whether it keeps working through the institutions or looks for shortcuts. Being able to see that is the reason for the design.

## Did institutions behave plausibly: follow, bend or ignore procedure? (stage2-plan)

They follow procedure, and the ones configured to bend do.

- **Planning:** about 22 decisions a run (102 granted, 8 refused across the five runs). The refusals are all Landlord 1 asking to build on the river lot the river law protects, sometimes more than once.
- **Enforcement:**
  - Four times across five runs, a refused landlord built anyway through the builder (compliance is 50%).
  - Each time, the inspector issued a demolition order within 1–16 days.
  - Twice the landlord demolished within a week. Twice it didn't, and nothing further happened: there's no court, fine collection or escalation beyond the order.
- **Tax:** landlords report rent monthly (under-reporting by half when not complying), and the tax clerk records what's owed for every report (430 a run). Nobody audits a report against what was actually paid.
- **The council:** 4–5 ballots a run, with votes by position. It adopted every budget, and the tenant law in 3 of 5 runs.
- **The gaps:**
  - Enforcement stops at the first step.
  - Clerks don't reply to requests they can't process.
  - There's no audit.

  All three are content, and all are cheap to add when a scenario needs them.

## V0's question 3: is replay identical, and can the logs reconstruct *why*?

**Replay: yes.**
- Every run replays byte-identically and the hash chain verifies.
- A batch run equals the same seed run alone (tested), and seed 1 of the batch matches an earlier standalone run's final state.
- The perception invariants (a view built from changes equals the full picture) hold in random worlds and on the real town, and are mutation-checked.

**Why: only partly.** The log records every command, event and record. So *what* happened, *who* did it, and *through which path* are always there: `acts.via` and the provenance chain for language seats. But:
- **Reasons:** none of the 221,223 acts in the mock-mayor batch carries one. Code seats never state which rule fired, and the mock mayor gives no reason either. A real model's words would be kept, in its request, its drafts and the transcripts.
- **Links:** only 4% of records (8,049 of 198,849) carry a `basis`, the record they rest on. Most causal links are in each kind's own data fields (an application's `data.listing`, a decision's `data.application`, an order's `data.law`). They're readable, but differently for every kind.
- **Observations aren't stored**, only their hashes. What a seat saw can be regenerated exactly by replay, but not read from the log directly.

Stage 3's causal trace ("which decision caused it, which seat made it, and its logged reasoning") needs the first two. Neither needs a contract change:
- modules can say which rule fired in `reasoning`;
- institutions can put the record they're acting on in `basis`.

## V0's question 4: contracts to revise before Stages 3–4

1. **Freeze v0.3.**
   - It holds the translator and resolver changes, perception as changes, attention and position (D37–D44), all of which you signed off.
   - The README still calls it a draft awaiting sign-off and needs updating.
   - My recommendation: freeze it now, and open v0.4 only for what Stage 3–4 needs.
2. **Construction payments** (open since D25, "accept it for now"). Builders pay materials straight to the outside world, outside their bank. Fix it now, through supplier entities and ordinary bank transfers, or carry the liberty into v0.4 knowingly.
3. **Reasons and links:** conventions, not contract changes (see question 3).
4. **The translator's model in the world config** (`orchestration.translator`): a small addition, so runs say what the translator is and the cost report needn't assume.
5. **For Stage 4, a design discussion before any building.**
   - The nature layer (habitats, populations responding to land use) and irreversibility (extinction is permanent) are physics, so they're kernel and contract work. They deserve the same treatment as position.
   - The work and process model (D24: acts that take time and people) is designed, not built, and nature and development will likely need it.
   - The second AI seat (a developer) is content, and works today as a configured language-model seat.

## Also worth knowing

- **Size:**
  - A 2-year, 1,000-citizen log is about 260 MB (720,000 entries), and its measurement tables about a tenth of that.
  - Records grow without limit: citizens' monthly spending requests are about 18,000 records a run.
  - Very long runs will need the on-disk record archive (D42's note) and perhaps shopping as something other than a standing record.
- **Speed:** a run takes about 70 s alone, or 100–115 s each with five in parallel on 10 cores. Replay takes about 34 s.
- **Code citizens only understand their own phrasing** when asked around. That's a limit of code citizens, not the world; language-model citizens would remove it.

## Decisions for you

1. **A real-model pilot before closing Stage 2?**
   - V0's first question can't be answered on the mock.
   - Options: one seed, one year, the mayor on Sonnet 5 (projected well under $5, but a real model could cost several times the projection), then review its transcripts. Or close Stage 2 on the mock evidence and return to it later.
   - I'd recommend the pilot, because the loop is the heart of the project.
2. **Give the town some movement before Stage 3?**
   - My recommendation is the smallest version, as content:
     - arrivals when there are jobs and homes (a sourced in-migration rule);
     - slow wage and export-demand movement, or occasional shocks.
   - Or accept the still town for now.
3. **Calibrate citizens' voice:** the grievance trigger and thresholds, against turnout evidence. My recommendation is yes, with the word-of-mouth job gap in the same pass.
4. **Reasons and links in the log:** code modules name the rule that fired, and institutions use `basis` for the record they act on. My recommendation is yes, before Stage 3, since the causal trace depends on it.
5. **Freeze contracts v0.3** now (and update the README)?
6. **Construction payments:** fix now, or carry into v0.4?
7. **Add `orchestration.translator`** (the translator's model) to the world config?
8. **What next:** Stage 3 (the renderer), or the nature layer's design discussion first? My recommendation is items 2–4 as a short pass, then Stage 3. Stage 3 reads the logs, and it's better built on a town that moves and says why.
