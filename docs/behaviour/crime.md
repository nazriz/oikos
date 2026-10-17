# Crime and policing (world-expansion §7.2)

**Source:** the kernel (`take`; investigation as work); `police.ts` (`police.station` v0.1.0); `citizen.ts`
(offending, paying orders); `retailer.ts` (the stocktake); `tribunal.ts` (charges). Contract: world-expansion §7.3
(signed 2026-10-02). Figures: the profile's `crime`, with sources.

**Care, given the stakes:** crime is where a simulation most easily encodes prejudice. Nothing here ties offending to
any group, only to circumstances: need, opportunity, and the chance of being caught.

## The physics (kernel)

- **Taking** (`take`): a person takes goods another holds at a structure where the taker is, without consent. The
  holder sees their holding fall, and nobody is told who. The log records the truth (`taken`).
- **Investigation is work** (a task that `investigates`): given whose goods were taken, where and what, it finds the
  latest such taking's taker with the task's `detection_bps`, told only to the investigator. Like a survey: evidence
  found by work, with a chance.

## People

| | Rule | Source |
|---|---|---|
| **Offending** | In need (less than a month's essentials) and at work where the employer keeps goods: the month's chance of taking some (`take_bps`, 2%), less as the chance of being caught they reckon (`caught_bps`, 30%) is higher. They take a few (5) and bring them home. | Becker (1968); Cohen and Felson (1979). Placeholders, deliberately rare |
| **Noticing** | Shops: a monthly stocktake. What's there against the books (last count, what came, what was served); short, reported to the police with its value. | Ordinary retail practice |
| **The police** | The state's, paid by a grant from outside: `police_per_1000` (2.3) officers. They take reports and investigate each (4 hours of an officer's day). Found: a charge to the tribunal, with what they found. Not found: unsolved, as most are. | Victoria Police annual report (to confirm) |
| **Found dead at home** | The police are also who calls at a home nobody has been in or out of since someone died there, and reports the death (`police.station` v0.2.0). | [deaths.md](deaths.md) |
| **Detection** | One investigation in five finds who (`detection_bps`). | Crime Statistics Agency Victoria (to confirm) |
| **The tribunal** | A charge with evidence naming the respondent: proven, and an order to make good the goods' value to the shop. | docs/behaviour/justice.md |
| **Paying** | Someone ordered to pay does, when they can keep a month's essentials. | — |

## In the small town

The profile's rates give almost none in a year. In the test, with the chance far raised: about 20 takings in 200 days,
a handful found at shops' stocktakes, each investigated, about one in five charged, ordered and paid.

## Leaves out (for now)

- **Factories' and other employers' stocktakes:** taking from them goes unnoticed. People whose workplace keeps no
  goods are refused when they try (`insufficient_quantity`).
- **Fraud** (money taken by a forged instruction): it needs records to carry a claimed signer apart from the true
  author, a change to the records model.
- Burglary, violence (harm exists in the physics, but no one does it), sentencing beyond restitution, prisons,
  deterrence learned from others' convictions, and policing that patrols or prevents.

**Found 2026-10-02:** the station lost the finding of the first of two investigations done in one day (it arrived while the
second was under way, and was read only at the next plan): those reports were never charged or closed. Findings are
now kept as they come (police.station 0.1.1). And taking is only from an employer that sells goods (citizen 0.33.0):
a builder's labourer had tried the yard, which holds materials.

## When a model holds the station (2026-10-12)

The officers' routine (warrants carried out on their day, reports looked into, homes called at) is theirs under standing work orders in force at the start, and the office-holder hires and makes the orders: docs/behaviour/standing-work.md, "The police station".

## In the Rust port (2026-10-17, lane E)

Where the Rust station decides fresh (police.station keeps version 0.6.0 in its manifest; the module is `offices/police.rs`):

- **A successor carries on from the file.** A report is looked into unless a charge or a closure of the station's cites it; a warrant is carried out unless an executed or lapsed notice of the station's cites it; a death found is reported unless a notification of the station's names the dead. Before, a new holder of the post started with an empty memory and would look into every report again. What stays in memory: an investigation under way (its finding comes only to whoever ordered it, so a station changing hands mid-investigation looks into that report again), how many of a household were put out so far, and the homes a call found nobody dead at (nothing is written about a call that found nothing). *Revisit if* calls that find nothing need to be on record (a reply to the neighbour who asked would do it; it needs a paper kind).
- **A tenant registered dead is not put out** (bug hunt 2026-10-17, finding 3). A warrant against a tenant whom the station's file shows dead, by an entry of the register of deaths or a certified copy of one, is not carried out; the landlord is told it lapsed, and why (`reason: tenant_dead`). Basis: a possession order is against a living party; the court officer serving it checks the party is alive (to confirm: the practice of bailiffs and sheriffs). The station does not itself ask the registry: the register is the registrar's, and it learns of a death by being sent the entry or a copy. *Revisit if* the register stops being sent to the station: it would then need to ask for a certified copy by name.
- **A warrant not yet due no longer holds up the ones behind it.** The TS stopped at the first.
- **No coin decides whether the station acts** (risk PB-16). Whether a warrant is carried out turns on a cause: an officer at the station with hours left in their working day, on a working day, within the warrant's days. There is no `compliance_bps` here; the coins of that name live in the planning officer, the inspector, landlords and the union.
- The first wake is spread by a hash of the participant's id (there is no random stream at that point).
