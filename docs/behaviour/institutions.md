# The people inside institutions (planning officer, inspector, builder, registry, child protection)

**Source:** `participants/src/behaviour/institutions.ts`. These are code seats of the town (`entity: city`) and of the builder. None of this is kernel law. Each seat reads the town's statements, applies them to what it can see because that's its job, and may do the job well, badly or not at all, depending on its parameters (D19, D20).

Laws are read through their optional **formal** conditions, using the CEL helper `participants/src/law.ts` (D27). An institution treats a law as a *prohibition* when its Institutional Grammar breakdown says `must_not`. A condition that evaluates to true on an act means that act would breach the law.

## `city.planning_officer`

Wakes weekly. For each permit application addressed to the town:
0. An application that doesn't say which lot, or what kind of building, gets a decision saying so (`incomplete`), rather than being judged.
1. It asks whether *granting* the permit would breach a prohibition addressed to the office. For example, `law-river` says "the planning office may not grant a permit for building on the river parcels", with formal condition `block.block == 'grant_permit' && block.parcel in [...]`.
2. If not, it **grants**: it records a *liberty* claim (Hohfeld) for the applicant to build that structure on that parcel, and publishes the decision.
3. If so, it **refuses**, publishing the decision with the law it cites.

It also **keeps the town's land register**: the lot records, their owners from the claims registry, and a monthly survey of what's built (`sites`, every 30 days). Its report, sent in answer to any letter, lists how many lots the town owns and the ones with nothing built on them, the first 40 by id. A real council keeps such a register, and "which vacant land do we own?" is a question it answers. Without the register, a language-model mayor with a parks budget had no way to find a lot: its filings listed 12 of the town's 187 lots, and nothing said which were free (pilot 6, docs/real-models.md). The register lists; it doesn't advise. The river law is on file for whoever reads the list.

**Parameters:** `compliance_bps` (default 10000) is how often it follows the law. Below 10000, some unlawful permits get granted: a lax or captured office. `town` (default `city`) is whose land the register lists.

**Source:** administrative decision-making as procedure-following (MOISE+-style roles and procedures, borrowing survey §1). Discretion is a parameter rather than a mechanism.

## `city.inspector`

Wakes weekly and looks through its `sites` channel. In the example town that channel covers the whole town, and the inspector looks through it every 14 days (`every`): the patrol. Each look delivers what changed since the last. Detection is only as good as that coverage and cadence, which are experimental variables (VISION's "information sources").
1. On its first look it takes everything already standing as the baseline.
2. For each *new* structure, it evaluates the building prohibitions for the parcel's registered owner (read from the ownership records, following transfers) against the permits it knows of.
3. For each breach, it records a **fine** (a claim: the town's right, the owner's duty) and publishes a **demolition order** to the owner, both citing the law.

What happens next is up to the owner, and to whoever else might enforce.

**Parameters:**
- `fine` (default $50,000, matching the example law);
- `compliance_bps` (default 10000): how often it acts on what it finds. Below 10000 it sometimes looks the other way.

**Source:** deterrence depends on the probability of detection and the size of the sanction (Becker 1968). Inspection capacity and coverage limit detection (the inspection-game and risk-based-regulation literature, borrowing survey §5). The inspector's work has no time cost until work is modelled (D24).

## `firm.builder` (v0.6.0)

A builder with a yard, a crew and a supplier (phase B). It wakes daily.
- **Taking on work.** For each construction agreement a client has signed, it signs too and queues the job. A job is a building (what, on which lot) or a demolition (what to bring down).
- **Materials.** It adds up what its waiting jobs need, sets that against what's in its yard and what's already on order, and orders the shortfall from its supplier (the world market) at the supplier's published price, paid with the order ([trade.md](trade.md)). The supplier's delivery notes tell it what has come.
- **Starting.** Oldest first:
  - a building once its materials are in the yard (`structure(type, on, by = itself, materials_at = yard)`);
  - a demolition once it knows what the building is. That comes from its own record of what it built, or its survey of the ground; it needs the type to know how many hours bringing it down takes.

  It **invoices** the agreed price as it starts: an `invoice` statement whose data is the payment asked for (`data: { outcome: { money: { to, amount } }, agreement }`). Payment is the client's act, through their bank.
- **Working.** On working days (5 of every 7) the crew at the yard (whoever occupies its workplace: the firm's employees) works on its sites, oldest first. Each worker works up to a working day (the world's physical limit; the builder knows it as `working_day`), shared evenly across the crew. It works on a building until its hours are done (the kernel finishes it once its least time has passed too), and on a demolition until it's down. A site that's gone, or is no longer being built (demolished meanwhile), is dropped.
- **Its crew** is sized to its work. It works out the hours of work in hand (jobs begun, and jobs waiting) and the hands needed to do them within `horizon_days` (90). While it has fewer, it hires, up to the yard's room. When it has more, it lets the most recent hire go, at most one a week, keeping a core crew of `min_crew` (2). It also lets someone go if it can't cover the next pay period. Hiring and paying are the shared `Staffing` routine ([firms.md](firms.md)).

It builds whatever it's contracted to build, wherever. Whether that's lawful is the client's problem and the inspector's. A builder that refuses unlawful jobs would be a different module.

**Its prices** follow from its costs:
- a building's materials at its supplier's current prices;
- plus its hours of work at the crew's hourly pay (the wage over the hours it pays for: working days in the pay period times the working day);
- plus its margin (`build_markup_bps`, 20%).

A demolition is priced on its hours alone. It **publishes** a public `price_list` statement (`data: { prices, demolition }`, by kind of building), republishes it whenever its costs change, and answers letters with it. Everyone else learns what building costs from that list: the mayor, finance's budget brief, and landlords planning to develop or ordered to demolish. What each kind of building takes is its business knowledge (`types`: materials, building hours, demolition hours). In the generated town these are the catalogue's own figures ([building.md](building.md)).

**Parameters:**
- `types`, `yard` and `supplier` (default `outside`);
- `workplace` (the yard's space for its crew), `max_crew`, `min_crew`, `horizon_days`, `notice_days` and `let_go_every_days`;
- the crew's `wage` and `period`;
- `working_day` (8 h) and `work_days` (5);
- `build_markup_bps` (2000).

**Leaves out:**
- scheduling across jobs beyond "oldest first";
- trades, and subcontractors;
- trade credit with its supplier;
- turning down work when its crew is overbooked. It quotes the same price however long the queue.

## Landlords as developers (`firm.landlord`, see [firms.md](firms.md))

When a landlord's **average vacancy over the last 90 days is at most 10%** of its homes, and it has 1.5× the price of a house in hand (the builder's published price), it applies to build on an empty site it owns.
- **Granted:** it contracts the builder and pays the invoice when it arrives.
- **Refused:** it complies with probability `compliance_bps`. Otherwise it **builds anyway**.

It also pays fines and obeys demolition orders with that same probability. To obey an order, it commissions the builder to demolish, at the builder's published demolition price for that kind of building, once it can pay it. Since phase B, demolition is work, and the builder has the crew.

In the example town, `landlord_compliance_bps: 5000`. The river scenario test (`orchestrator/test/river.test.ts`) runs a tight-housing town at compliance 0 and 10000, and checks the whole chain:
- the application;
- the refusal citing law-river;
- construction anyway (or not);
- the inspector's patrol detecting it within three weeks;
- the fine citing law-planning, and the demolition order;
- the order being ignored (or never needed).

## `city.registry` (v0.1.0): the registry of deaths

After Victoria's Registry of Births, Deaths and Marriages, where a death is registered from a notification. It reads death notifications addressed to the town and, once per death, publishes a public `death_registration` with what it was told: who died, who reported it, the partner, the children (and which are adults), and any children left with no adult at home. It doesn't check what it's told yet. In reality a doctor's certificate is required.

**Who reports:**
- the household's first surviving adult, who sees the death at home;
- for someone living alone, their landlord, whose own buildings it sees by name.

Someone with no home dies unseen, and nobody reports it (in reality, the police or a hospital would).

## `city.child_protection` (v0.1.0)

On a registration naming children with no adult at home, or a child's own request for help (a `care_request`, made when every adult of their household has died), it takes them into care. The town has no foster homes yet, so care is elsewhere: they leave the town with the office's worker. Loosely after Victoria's child protection service; foster and kinship care in town are future work.

