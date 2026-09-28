# The municipal economy: design (draft for review)

**Status:** draft, 2026-09-28, for Naz's review before anything is built. Nothing here changes a contract until it's signed off. §9 lists the decisions needed.

## 1. Why

In seven pilots, a real-model mayor (docs/real-models.md) kept looking for the job it expected: "a costed budget with staff and services". The town had none. It has $2M in the bank, one budget line (parks), no staff, no services and no running costs. Its only revenue is a placeholder tax of 10% of rent. **Stewardship is choosing between competing needs with scarce resources and living with the effects on people.** Without trade-offs there's nothing to steward, and nothing to study. Patching office reports one question at a time (G1, G2 in docs/gaps.md) doesn't fix that.

What's missing is the part of the economy a council actually runs:
- money coming in from a real base;
- services that people depend on, done by workers;
- physical things that wear out;
- people who notice.

**The test for every mechanism below:** does a steward's decision act through it, and does it affect people or nature? If not, it's out.

## 2. Constraints

- **Kernel = physics** (VISION §5, D18/D19). No laws or institutions in the kernel. A rate, a cap or a service standard is a record in the world's config. Councils, valuers and crews are participants who do the work.
- **Simulate the real world** (memory: *simulate-real-world-not-game*). For every mechanism: who actually does this, how, at what cost? Nothing happens automatically because a rule says so.
- **What participants know comes from perception or their own parameters** (D57). No module reads the world config.
- **Proportional fidelity** (D25):
  - **~100%** for who decides, who pays and who carries it out;
  - **medium** for amounts;
  - **low** for engineering detail (road pavements, truck routes).
- **The call language stays stable.** Anything that can be said with existing calls is. The one proposed exception, `work`, is in §5.3 and §9, flagged for sign-off; P12 says physics changes and the translator move together.
- **Sourced behaviour** (docs/behaviour/): every citizen rule has a source, and every number is a parameter.
- **The platform doesn't judge.** Service levels, complaints and rates are measured from the logs, never scored in the world.

## 3. What a real council's money does (sources)

Victoria is the reference, as for the rest of the town. Figures are for the whole sector.

| | Figure | Source |
|---|---|---|
| Revenue, 2024–25 | $15.3B: rates and charges **51%**, government grants **19%**, developer contributions 14%, user fees 7%, other 9% | VAGO, *Results of 2024–25 Audits: Local Government*, appendix C |
| Expenses, 2024–25 | $12.4B: employee costs **38%**, materials and services **37%**, depreciation **19%**, other 6% | same |
| Rates are the only local tax | $24.5B nationally, 2024–25: 2.9% of all tax | ABS, *Taxation Revenue, Australia, 2024–25* |
| What rates are levied on | Most Victorian councils use **capital improved value** (land plus buildings), **revalued every year by the Valuer-General**, not by the council | Land Use Victoria, *Council rating valuations*; council rating pages (e.g. Warrnambool) |
| The cap | The average general-rate rise is capped by the state (**3.0% for 2025–26**; the average cap since 2016 is 2.3%). Councils can apply to the Essential Services Commission for more. 77 of 79 complied in 2025–26 | ESC; Premier of Victoria media release |
| Waste | Usually a **separate service charge**, outside the cap, meant to reflect the service's cost rather than property value | Local Government Victoria, *Minister's good practice guidelines for service rates and charges* |
| Waste generated | **512 kg per person per year** of municipal solid waste (2022–23) | DCCEEW, *National Waste and Resource Recovery Report 2024* |
| Assets wear out | For example, spray seals on roads last **10–15 years**. Councils under-renew: the sector's capital renewal gap ratio was 1.15, and 17% of the capital budget went unspent (2023–24) | VAGO, *Maintaining Local Roads*; VAGO, *Results of 2023–24 Audits* |
| Staff | About 40,600 FTE at 30 June 2023. Against about 6.9M residents, that's about **6 FTE per 1,000 people** (derived; to confirm) | Vic Councils, *Local government facts* (to confirm against the MAV workforce report) |
| Scale | Sector expenses over population is about **$1,800 per resident a year** (derived from the rows above; to confirm) | derived |

**For our towns:** the 200-person town's real council would spend about $360,000 a year and employ one or two people; the 1,000-person town about $1.8M and six. The town's $2M is 5–6 years of that. **Real councils run close to even each year.** The balance is a reserve, not a budget.

## 4. The design in one picture

```
           Valuer (state)        Grants (Commonwealth, via the state)
                │ valuations              │ quarterly payments
                ▼                         ▼
 owners ──rates──► TOWN'S ACCOUNT ◄──waste charge── households
                        │
          budget (lines, adopted by the council)
                        │  finance pays
          ┌─────────────┼───────────────────┐
     wages (staff)   contractors      materials
          │             │                   │
     WORK: crews collect waste, maintain parks and civic buildings
          │
     STOCKS change: bins emptied, condition restored
          │
     people notice: complain, petition, move away (sourced)
```

## 5. The pieces

### 5.1 Revenue

- **Rates:**
  - The **rating law** is a law record: the rate in the dollar on capital improved value, and when it's due. The council adopts it with the budget each year, as real councils declare rates.
  - The **valuer** is an office of the state (the outside world, D31) that publishes each property's value every year. A valuation is a statement per lot: land plus the buildings on it. The value itself is a behaviour model: sales evidence (the land market exists weakly now), or a documented approximation such as the builder's published prices for the buildings plus a land value per lot.
  - The **rates officer** (an evolution of today's tax clerk) sends each owner a rates notice, records the debt as a claim, and chases arrears. Penalty interest applies, and ultimately land can be sold for unpaid rates, as the real law allows.
  - **Owners pay:** landlords, shops and factories in this town. Whether they pass it on in rent is behaviour (§6).
- **The rate cap:** a law of the state (the outside world): an average rate rise over the cap needs the regulator's approval. It's a scenario knob; the cap can be absent. It's the classic squeeze: rising costs against capped revenue.
- **Waste charge:** per household, set in the budget, cost-reflective. It's billed and collected like rates.
- **Grants:** the Commonwealth's financial assistance grants, paid by the outside world quarterly, at an amount per resident set in the world config.
- **Replaces the rent tax.** "10% of rent" is a placeholder with no source. Rates are the real local tax. The tax clerk's machinery is reused (reports, claims, penalties).
- **Out for now:** developer contributions (tied to permits, later), borrowing, and user fees beyond waste.

### 5.2 Spending: two services and the town's assets

Chosen because each one is a real trade-off that people feel, not for completeness:

1. **Waste collection** is every household, every week, and highly visible. The decisions it forces: service level (weekly or fortnightly), crew size, and in-house or contracted. Contracting is a real choice with real risks, using the existing agreement primitive and a contractor firm. When the crew can't keep up, bins overflow.
2. **Maintaining the town's assets:** parks, the civic building, and later streets (§9). They **wear**. Maintenance restores them, and neglect lets them fall out of use. This is the renewal-versus-new trade-off VAGO reports councils getting wrong. It sits naturally beside capital works: the park the mayor built also has to be looked after.
3. **Staff:** council jobs are ordinary employment agreements with the town, held by citizens and paid by finance. At about 6 per 1,000 people, the town becomes a real local employer. Hiring and wages are budget decisions.

**The budget** gets real lines: staff, waste, maintenance, parks and capital works, reserves. The finance officer's controls stay as they are (within the adopted budget; over $50,000 needs the mayor's written approval).

### 5.3 Physics: stocks and work

Services are only real if something physical happens. Two generic pieces of physics, configured per world, cover waste, wear and later nature:

- **Stocks on places:**
  - A world config names **stock kinds** and how each one changes by itself: per occupant per day, per day, capped. For waste in a dwelling, that's a per-person generation rate from the national figure above. For a structure's condition, that's decay per day, on a life of years.
  - The kernel keeps the numbers and applies the changes as time passes, as it does life physics now. It **doesn't decide what they mean**. An overflowing bin is a number that people perceive and respond to.
  - The same mechanism later carries habitat quality, soil and pollution for the nature layer (VISION §7, Stage 4). **It's one mechanism, not three.**
- **Work (D24, designed, not yet built):**
  - A performer who is present spends time on a **task** that changes a stock: empty the bins in these dwellings, restore a park's condition.
  - Each task kind is in the config, with how much time it takes per unit and what materials it uses. The materials are paid to the boundary, like construction until the materials question is settled.
  - Performers have capacity (hours a day), so **service levels follow from staffing**, and the budget has teeth. This is the Acemoglu & Restrepo task framework D24 already named.
- **Contract impact:** a new physics section in the world config (stock kinds, task kinds), new state (stocks on spaces and structures), perception of stocks (a site's condition, a bin's fill), and **one new act, `work`**. That's a new block and a new call function; see §9 Q1.

### 5.4 Institutions: who does what

| Who | Does | New or existing |
|---|---|---|
| Valuer (state) | Values each lot every year and publishes it | New, outside world |
| Grants (Commonwealth) | Pays quarterly, per resident | New, outside world |
| Rate regulator (state) | Rules on applications to exceed the cap | New, outside world (optional) |
| Rates officer | Notices, claims, arrears, penalties | Evolves from the tax clerk |
| Finance officer | Pays wages, contractors and materials within the budget | Existing |
| Works crew (council staff) | Collect waste and maintain assets, within their hours | New: citizens in council jobs, their duties a role module |
| Waste contractor | The same, under contract, if the council contracts it out | New firm, optional |
| Council and clerk | Adopt the budget and the rating law | Existing |
| The steward (mayor) | Prepares the budget, sets the service levels, decides the rates, hires, contracts, and answers the complaints | Existing seat (§9 Q2) |
| Induction brief | What the town has, what each office does, how the budget works | One record at genesis (G1), written for any incoming mayor |

### 5.5 Mapping to the call language

- **Existing calls cover:**
  - employment and contracts (`agreement`);
  - rates and charges (a `statement` law plus claims);
  - valuations, notices and the brief (`statement`);
  - payments (`money`);
  - budget adoption (the council form);
  - applications to exceed the cap (a form).
- **One new call:** `work(task=..., at=..., ...)`, for the kernel's work act. Code crews use it. A model-run steward would rarely do physical work itself, but the call language has to be able to express it (P14: the same interface for everyone).

## 6. Citizens and firms respond (sourced; each a parameter)

| Behaviour | Source to use | Notes |
|---|---|---|
| **Complain** to the council when their bin isn't emptied or a park is run down: a letter, after some days, with a propensity | Service-request (311) literature: who reports varies by neighbourhood, and responsiveness varies too (e.g. Stowers 2022, *State and Local Government Review*; to select one with rates) | Complaints are how a steward learns. Who complains, and who doesn't, is itself a finding |
| **Petition** over services | The existing petition mechanism and source (AES 2016) | New tags, the same machinery |
| **Move away** when local quality is poor: an amenity term in the existing migration choice | Banzhaf & Walsh (2008, *AER*): households "vote with their feet" for local environmental quality, measurably for large changes | Small differences should do little; that's what the source supports |
| **Landlords pass rates on** in rent | Property-tax incidence and capitalisation literature (to source: e.g. Oates 1969, and later work) | A rate decision reaching tenants is exactly the kind of indirect effect worth studying |
| **Owners pay rates late or not at all** under stress | Arrears data from councils (to source) | Gives the rates officer something real to do |

## 7. What the steward then decides

These are real trade-offs, none of them scripted:
- the rate level against the cap, and whether to apply for more;
- weekly or fortnightly waste; in-house or contracted;
- maintenance or new works (the renewal gap); which park first;
- how many staff, at what wages; reserves or spending;
- how to answer complaints, and whose.

Every one of these reaches people (bills, rent, jobs, bins, parks). Later, through the same stocks, it reaches nature.

## 8. Build stages (after sign-off)

1. **Contracts:** stocks and work (a physics proposal to Naz, with tests).
2. **Kernel:** stocks and the work act, with statistical and invariant tests, as for life physics.
3. **Revenue:** valuer, rating law, rates officer and grants. The rent tax is retired.
4. **Services:** crew role modules, waste and maintenance, council jobs, the budget's lines, the contractor firm.
5. **Citizens:** complaints, the amenity term in migration, rates passed on in rent.
6. **The induction brief;** calibration targets added to docs/calibration.md (§3 as outcomes: revenue mix, spending mix, staff per 1,000).
7. **A gap-finding pilot** with a real model, then triage.

Each stage ends with every test passing and its docs updated.

## 9. Decisions needed from Naz

1. **Stocks and work in the kernel.** This is a contract change, with one new act and one new call function. The alternative, services as records with nothing physical, is the stage set again. **Recommend yes.**
2. **Mayor or CEO?** In Victoria, the mayor is a councillor; the CEO runs the administration and prepares the budget. Our steward seat acts like an executive. Options:
   - keep "mayor", as a documented liberty (a strong-mayor model, as in some cities);
   - make the seat the CEO, accountable to the council.

   **Recommend the CEO** for faithfulness (D25 puts "who decides" at ~100%), but it's a framing choice for studies.
3. **Retire the rent tax for rates?** **Recommend yes:** it has no source.
4. **The state layer** (valuer, grants, cap regulator) as the outside world's participants (D31). **Recommend yes.** The cap is optional per world.
5. **Streets:** they need geography (a street network), which D25 puts at low fidelity. Start with parks and the civic building, and add streets when geography comes. **Recommend deferring.**
6. **Town size.** A real council serves thousands; ours are 200 and 1,000. **Recommend the 1,000-person town as the municipal baseline**, and checking speed at 3,000.
7. **Which services.** Waste and asset maintenance to start, as argued in §5.2. Anything else is added only under the §1 test.
