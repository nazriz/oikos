# Behaviour modules

Every code seat in a world runs a **behaviour module**: a documented, cited, swappable rule set in `seats/src/behaviour/` (D30). Modules are **world content**. They are not part of the platform, and none of them is "the" behaviour: a researcher can replace any of them, retune its parameters, or hand the seat to an LLM or a human.

Each module's doc gives:
1. **What it does**, in plain words.
2. **Where the rule comes from**: the literature or real-world practice it follows, with sources.
3. **Parameters** and their defaults.
4. **What it deliberately leaves out.**

Rules every module follows (so re-runs are reproducible):
- It sees only its Observation and acts only through SeatActions, like any other seat. Modules act through **calls** (contracts/calls.md): they say what they want brought about (`money(...)`, `form(...)`, `agreement(...)`), and the resolver turns that into the seat's own acts, exactly as for a language seat, only without the translator or a preview (D36). Paying someone is `money(...)`, and the resolver asks the account's bank. Agreements carry their commitments as outcomes, and payment requests are `request` statements (contracts/outcomes.schema.json). Helpers for all of this are in `seats/src/behaviour/common.ts`.
- Randomness comes only from `ctx.rng(purpose)`: the kernel's keyed streams, keyed by seat, time and purpose.
- No clocks and no I/O. Memory is allowed, as long as it depends only on what the seat has observed and drawn.
- Its `version` is bumped whenever its rules change. Each run's log records every module's version and source hash (the `orchestrator` annotation).

| Module | Seat | Doc |
|---|---|---|
| `bank.payment_system` | a bank's automated payment system | [bank-payment-system.md](bank-payment-system.md) |
| `world.export_demand` | the outside world (a boundary condition, D31) | [boundary.md](boundary.md) |
| `citizen.default` | a townsperson: housing, work, spending, leaving town | [citizen.md](citizen.md) |
| `firm.landlord` | a landlord's letting office | [firms.md](firms.md) |
| `firm.employer` | a shop's or factory's manager | [firms.md](firms.md) |
| `city.planning_officer` | decides permit applications under the laws that bind the office | [institutions.md](institutions.md) |
| `city.inspector` | patrols, detects unpermitted building, fines and orders demolition | [institutions.md](institutions.md) |
| `firm.builder` | builds what it's contracted to build, and invoices | [institutions.md](institutions.md) |
| `city.mayor_code` | a rule-following mayor (the all-code control; an LLM takes this seat in AI runs) | [government.md](government.md) |
| `city.council_clerk` | runs council ballots, publishes results and what passed | [government.md](government.md) |
| `city.councillor` | votes on council ballots (spatial voting) | [government.md](government.md) |
| `city.finance_officer` | pays the town's invoices under the payments procedure | [government.md](government.md) |
| `city.tax_clerk` | assesses reported tax, chases arrears | [government.md](government.md) |
| `idle` | does nothing (placeholder, and a control condition) | this page |

The town these modules run in is made by the [generator](generator.md).
