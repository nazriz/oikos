# The people inside institutions (planning officer v0.3.0, inspector v0.2.0; builder v0.3.0)

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

## `firm.builder`

Wakes weekly. For each construction agreement a client has signed, if it can pay for the materials, it signs too and builds (`construct`), the materials being bought from outside (the temporary liberty in docs/decisions.md). It then **invoices** the client for the contract price (an `invoice` statement whose data is the payment it asks for, in the shared outcome language: `data: { outcome: { money: { to, amount } }, agreement }`). Payment is the client's act, through their bank. It builds whatever it's contracted to build, wherever. Whether that's lawful is the client's problem and the inspector's. A builder that refuses unlawful jobs would be a different module.

## Landlords as developers (`firm.landlord`, see [firms.md](firms.md))

When a landlord's **average vacancy over the last 90 days is at most 10%** of its homes, and it has 1.5× the price of a house in hand, it applies to build on an empty site it owns.
- **Granted:** it contracts the builder and pays the invoice when it arrives.
- **Refused:** it complies with probability `compliance_bps`. Otherwise it **builds anyway**.

It also pays fines and obeys demolition orders with that same probability.

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

