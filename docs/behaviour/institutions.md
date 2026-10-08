# The people inside institutions (planning officer, inspector, builder, registry, child protection)

**Source:** `participants/src/behaviour/institutions.ts`. These are code seats of the town (`entity: city`) and of the builder. None of this is kernel law. Each seat reads the town's statements, applies them to what it can see because that's its job, and may do the job well, badly or not at all, depending on its parameters (D19, D20).

Laws are read through their optional **formal** conditions, using the CEL helper `participants/src/law.ts` (D27). An institution treats a law as a *prohibition* when its Institutional Grammar breakdown says `must_not`. A condition that evaluates to true on an act means that act would breach the law.

## `city.planning_officer`

Wakes weekly. For each permit application addressed to the town:
0. An application that doesn't say which lot, or what kind of building, gets a decision saying so (`incomplete`), rather than being judged.
1. It asks whether *granting* the permit would breach a prohibition addressed to the office. For example, `law-river` says "the planning office may not grant a permit for building on the river parcels", with formal condition `block.block == 'grant_permit' && block.parcel in [...]`.
2. If not, it **grants**: it records a *liberty* claim (Hohfeld) for the applicant to build that structure on that parcel, and publishes the decision.
3. If so, it **refuses**, publishing the decision with the law it cites.

It also reads **the town's own asset register** (0.9.0): the lots the town's titles say it holds, what its register says stood on each at the start, and the notices of building work the town has been given since (`ownLand`: docs/behaviour/ownership.md). Its report, sent in answer to any letter, lists how many lots the town owns and the ones with nothing built on them by that register, the first 40 by number, and says the register is paper: go and see a lot before relying on it. A real council keeps such a register, and "which vacant land do we own?" is a question it answers. Without it, a language-model mayor with a parks budget had no way to find a lot (pilot 6, docs/real-models.md). Until 0.9.0 the office was shown the whole land register and a monthly survey of every cell of the town (docs/no-god-view.md): it is shown neither now.

**Parameters:** `compliance_bps` (default 10000) is how often it follows the law. Below 10000, some unlawful permits get granted: a lax or captured office. `town` (default `city`) is whose land the register lists.

**Source:** administrative decision-making as procedure-following (MOISE+-style roles and procedures, borrowing survey §1). Discretion is a parameter rather than a mechanism.

## `city.inspector` (v0.6.0)

It inspects the building work it is told of. There is no patrol: until 0.6.0 the inspector was shown every cell of the town every 14 days, and the whole land register (docs/no-god-view.md).
1. **Notice.** Whoever builds gives the town notice of building work as it begins (the builder's `building_notice`: what, on which lot, where, for whom), and of a demolition.
2. **The visit.** The inspector goes to the site: a visit, which takes the office's time (the way there and back, and the world's time at a place, `knowing.visit_seconds`) and shows what is there when it arrives.
3. **Whose it is.** It asks the land registry about the one lot (the titles to it, then the dealings in each), and reads the owner from the answer.
4. **Judging.** It evaluates the building prohibitions for the lot's owner against the permits the town has granted (the town's own records). For a breach it records a **fine** (a claim: the town's right, the owner's duty) and publishes a **demolition order** to the owner, both citing the law.
5. **The valuer.** It tells the valuer what was built or brought down (`valuation_request`), as a council asks for a supplementary valuation (docs/behaviour/public-finance.md).

What happens next is up to the owner, and to whoever else might enforce.

**Parameters:**
- `fine` (default $50,000, matching the example law);
- `compliance_bps` (default 10000): how often it acts on what it finds. Below 10000 it sometimes looks the other way;
- `sites`, `register`, `valuer`: the channel it goes to a site through, the land register's channels, and whom it tells.

**Basis:** a builder "must ensure the relevant building surveyor is notified without delay of the completion of each mandatory notification stage", and the surveyor "must cause the building work to be inspected in person"; a surveyor may otherwise inspect only work "for which a permit has been issued", and work without a permit comes to a council by complaint (Building Act 1993 (Vic) ss 33 to 35: docs/behaviour/knowing.md, section 3). Deterrence depends on the probability of detection and the size of the sanction (Becker 1968): detection is now only of what is notified.

**Leaves out:** the later stages (one notice, at the start, stands for all); a complaint from a neighbour about work nobody gave notice of, so such work is never found; the fee for a search of the register.

## `firm.builder` (v0.12.0)

A builder with a yard, a crew and a supplier (phase B). It wakes daily.
- **Taking on work.** For each construction agreement a client has signed, it signs too and queues the job. A job is a building (what, on which lot) or a demolition (what to bring down).
- **Materials.** It adds up what its waiting jobs need, sets that against what's in its yard and what's already on order, and orders the shortfall from its supplier (the world market) at the supplier's published price, paid with the order ([trade.md](trade.md)). The supplier's delivery notes tell it what has come.
- **Starting.** Oldest first:
  - a building once its materials are in the yard (`structure(type, on, by = itself, materials_at = yard)`);
  - a demolition once it knows what the building is. That comes from its own record of what it built, or from going to see it; it needs the type to know how many hours bringing it down takes.
- **Going to look, and giving notice** (0.12.0; docs/design/knowing.md). Until 0.12.0 the foreman was shown every cell of the town each week. Now, once a client has signed, the foreman goes to the lot (its cells, from the plan the land registry gives for the one lot) or to the building to come down: a visit, which takes the firm's time. Only then is the job taken on, or declined because the lot is built on. What stands on its sites afterwards it knows from its own crew, who see a building as they leave it each day (`seen`, on the outcome of their work). As work begins it gives notice of it (`building_notice`: the lot, where, what, for whom) to those the world says (`notify`: the town, whose inspector comes; the water corporation, which connects it), and of a demolition.

  It **invoices** the agreed price as it starts: an `invoice` statement whose data is the payment asked for (`data: { outcome: { money: { to, amount } }, agreement }`). Payment is the client's act, through their bank.
- **Working.** On working days (5 of every 7) the crew at the yard (whoever occupies its workplace: the firm's employees) works on its sites, oldest first. Each worker works up to a working day (the world's physical limit; the builder knows it as `working_day`), shared evenly across the crew. It works on a building until its hours are done (the kernel finishes it once its least time has passed too), and on a demolition until it's down. A site that's gone, or is no longer being built (demolished meanwhile), is dropped.
- **Its crew** is sized to its work. It works out the hours of work in hand (jobs begun, and jobs waiting) and the hands needed to do them within `horizon_days` (90). While it has fewer, it hires, up to the yard's room. When it has more, it lets the most recent hire go, at most one a week, keeping a core crew of `min_crew` (2). It also lets someone go if it can't cover the next pay period. Hiring and paying are the shared `Staffing` routine ([firms.md](firms.md)).

- **The plan of the lot** (0.11.0). It is no longer shown the plan of every lot in town: when a job names a lot it has never seen the plan of, it looks that lot up in the register by its id, once, before it plans (`register`: its channel onto the plans; none: it knows the plans it is shown). A builder is given, or searches, the plan of the site it is asked to build on ([ownership.md](ownership.md), "What an owner knows"). It still walks the whole ground weekly (its `ground` channel): see docs/decisions.md, 2026-10-08, for what narrowing that would take.

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

**Births (0.6.0).** The mother of a newborn tells the registry (`birth_notification`: the child, when born, the mother), in the same wake she brings the child home; the registry registers it once (`birth_registration`), and sends the entry to her and to those sent every entry (`feeds`). Nothing else acts on a birth registration yet: it is what the statistician's population estimate counts (docs/behaviour/boundary.md). In the profile's place a birth must be registered by the parents within 60 days (Births, Deaths and Marriages Registration Act 1996 (Vic) s 18: to confirm, not opened); here it is the same day.

## `city.child_protection` (v0.1.0)

On a registration naming children with no adult at home, or a child's own request for help (a `care_request`, made when every adult of their household has died), it takes them into care. The town has no foster homes yet, so care is elsewhere: they leave the town with the office's worker. Loosely after Victoria's child protection service; foster and kinship care in town are future work.

