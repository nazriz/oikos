# How a death comes to be known (D54; revised 2026-10-08)

**Source:** `citizen.ts` (`citizen.default` v0.40.0: `seeDeathAtHome`, the child's word, and `wonderNextDoor`), `household.ts`
(`SAYING.died`), `firms.ts` (`firm.landlord` v0.12.3),
`police.ts` (`police.station` v0.3.1), `common.ts` (`stoodEmpty`), `institutions.ts` (`city.registry`). Figures: the
profile's `life.found_alone_after`, with its source. What follows a registration (the estate, wages, the lease, children
in care) is in [households.md](households.md) and [institutions.md](institutions.md).

Nothing in the world acts on a death until the registry has registered it: the bank goes on paying the dead person's
standing orders, the employer their wages, the landlord waits for rent. So who tells the registry, and when, decides
how long a dead person goes on being treated as alive.

## What happens in a real place

- **Someone who lives with others** is found by them, at once or when they come home. A doctor certifies the death
  and tells the registrar within 48 hours; the funeral director sends the registration within 7 days of the burial or
  cremation (Victoria: Births, Deaths and Marriages Registration Act 1996, as the registry describes doctors' and
  funeral directors' duties; read 2026-10-08).
- **Someone who lives alone** is found when somebody misses them: a relative or friend who can't reach them, a
  neighbour who sees the post pile up, a landlord, an employer, a carer; often it is the police who go in, asked by
  one of these. The one country found to count how long that takes is Japan (National Police Agency, people who died
  alone at home in 2025: 76,941): 37% the same or the next day, 21% in 2 to 3 days, 14% in 4 to 7 days, 29% after 8
  days or more, of them 9% after a month or more and 0.3% after a year or more. (Read as reported in the press, not in
  the agency's own tables: to confirm. No figure for Victoria or Australia was found.)

## What the world does

| | Rule | Basis |
|---|---|---|
| **Sharing the home** | A person sees who has left their home and why, whenever they are awake in it (the kernel shows a space's last five departures to those in the building). At every wake at home, not only when they plan their week, an adult looks for a household member who left by dying. Of the surviving adults at home at that moment, the first in the household's list reports it to the registry (who died, the partner, the children, which of them are adults) and writes the household's new record without them; the others do nothing but stop paying their share of the rent to a dead leaseholder. One who comes home later finds the household's record already changed, and reports nothing. Seeing a death makes that wake's plan the week's full plan (the lease may have passed to them). | Those who live with someone know first; a doctor has 48 hours. No waiting time is added: see "Leaves out" |
| **Only a child at home** | A child old enough for school (any child, in a world with no school) who sees someone of the household die at home, with no adult of the household there, tells the first of its surviving adults, once, in the household's own words ("… has died at home, …"). The adult told reports it as if they had seen it, from wherever they are, and, if they never knew where the household had come to live, goes there. With no adult of the household left, the child asks child protection for help, as before. | A child calls the parent who is out. Found 2026-10-08: a family new to town whose leaseholder died the day after moving in, before telling her partner where the home was; he stayed at his work, the child came and went, and nobody reported it |
| **Someone else lives there, not of the household** | An adult who lives in a home and sees someone not of their household die there (a home let again while they still live in it; a lodger) reports it to the registry at their next wake at home, naming no family (they do not know it). Found 2026-10-08 in the deaths test's town once people shopped differently: a leaseholder new to town died within a week of taking a home, before the rest of the family, still at their work, had ever been there, and the earlier tenant was still living in it; so the home never stood empty, nobody of the household was there, and nobody reported it. | Anyone present at a death, and the occupier of the house, may give the registrar the information (for England and Wales, Births and Deaths Registration Act 1953 s 16: to confirm, from memory; Victoria's Act puts the duty on the doctor and the funeral director) |
| **Nobody else at home: how anyone can tell** | From outside, a home nobody lives in any more is one that is empty and that nobody has gone into or out of for a day (`stoodEmpty`). Where people share a home, one of them comes or goes within a day (the daily round), and it is theirs to report: only they can say who the family is, and an estate reported by anyone else passes to the town. So the landlord and the police report only a death in a home that has stood empty for a day since. | — (a day: the round's own rhythm, not a place's figure) |
| **A tenant, by the landlord** | A landlord sees who is in the homes it owns (its office's sight of its own buildings). At its weekly look, and whenever else it is woken, a tenant who left by dying, in a home that has stood empty, and not yet registered: reported to the registry. | An owner's inspection. Kept from before; it now waits for the home to stand empty |
| **A neighbour, who asks the police** | Once a day a person sees the buildings beside the one they are in, as anyone sees them from outside: how many are in each home, and when anyone was last seen going in or coming out; never who (the kernel shows nothing else of a home one is not in). A home that someone went into after anyone last left, with nobody in it now, holds someone who has not come out. In their own building a person knows their neighbours by name, and sees that one has died and their home stood empty since. How long such a silence goes before anybody remarks on it is drawn once for the home and the silence from `found_alone_after` (the share within 1, 3, 7, 30 and 365 days; any moment within the band drawn), counted from when someone was last seen going in, and never less than a day. When that time has come, an adult who sees it asks the police to call there (a `welfare_check_request` naming the home). Every adult beside the home draws the same time, so several may ask; the police go once. A home with nobody living beside it is remarked on by nobody. | "Reports of uncollected mail or when neighbors or relatives ... raised concerns"; the times are Japan's National Police Agency's (docs/behaviour/knowing.md, section 3, with what was and was not opened) |
| **The police, when asked** | The police are shown nobody's home. Asked to call at one, they send an officer the same day: a visit, which takes the station's time (the way there and back, and the world's time at a place, `knowing.visit_seconds`) and during which the office does nothing else. The officer goes in, and sees who is there and who last left and why; whoever died there is reported to the registry as found there, unless the police have been told it is registered, or someone went on living in the home for more than a day after the death (it was theirs to report, and is no finding of a later call: until 2026-10-11 every death a home had ever seen was "found" at the next call there, months after it was registered). A world with no police has nobody to ask. | The police go to a home when someone asks them to check on a person (Western Australia Police Force, "Police welfare checks"; none found for the profile's place: docs/behaviour/knowing.md, section 3) |
| **The registry** | Registers a death the first time it is reported, with what the report says of the family. | [institutions.md](institutions.md) |

**Parameters.** `life.found_alone_after` in the profile (a list of `{ within_days, bps }`, shares adding to 10,000), handed to
every person as `welfare.found_after`, with whom to ask (`welfare.police`) and the channel that shows the buildings
beside them (`welfare.channel`); `calls_channel` and `registry` on `police.station`. Without `found_alone_after` in the
profile, or without police, nobody is given the sight of next door and no calls are made.

## Who is told (registry 0.5.0, citizen 0.38.0, bank 0.11.0, the employers' modules; generator 0.28.0)

Nobody is shown the register of deaths (docs/no-god-view.md). Until registry 0.5.0 every entry was published, and
every employer, the bank, the clinic, the school, the police, the energy retailer, every landlord and the support
office were shown every death in the town and looked through them for their own people. Now an entry is the
registry's own record, and it is sent to those concerned:

| Who | How they come to know | Basis |
|---|---|---|
| **Whoever reported it** | The entry is addressed to them: the family member, the landlord, the police. | The informant is given the certificate (Births, Deaths and Marriages Registration Act 1996 (Vic) ss 37, 39: the doctor notifies the registrar within 48 hours and the funeral director within 7 days of the disposal; the registry's "Register a death" page; both opened 2026-10-08) |
| **Those the family names** | Reporting a death, a household member names whom the dead person dealt with, as far as the household knows them (`tell` on the notification): their bank, the energy retailer, the school if they were of school age, and the landlord if the one reporting holds the lease. The registry addresses its entry to each. | The bereaved choose whom to tell, and one notice can reach many: GOV.UK, "Tell Us Once" (opened: it reaches government bodies; "banks, mortgage providers ... utility companies, landlords" are for the bereaved to tell); the Australian Death Notification Service, where the notifier picks the banks, utilities and others to be told once the death is registered (to confirm: its own site would not open; as state registries describe it) |
| **Those sent every entry as of right** (`feeds`) | The support office; a retirement fund where the town has one. | Registrars-General send lists of deaths to the electoral authority (Commonwealth Electoral Act 1918 s 108, as the Australian Electoral Commission's 2000 submission on tax file numbers sets out; opened, the current section not), and registry data is matched by the payer of pensions (Services Australia: to confirm). The fund is a stand-in: a fund is told by the family, who here are not told which fund |
| **The town's own offices** | The registry is the town's, so its entries are the town's own papers: the electoral office (the roll) and child protection (children left without an adult) read them as before. | The same s 108 feed; a registrar's referral |
| **An estate with no family** (`estate_tells`) | Where the report names no family (a landlord's or the police's), the estate passes to the town, and the registry addresses the entry to the bank and the energy retailer as well. | An administrator writes to the institutions a dead person may have dealt with (a public trustee's practice: to confirm, no source opened) |
| **An employer** | Is on no register and is told by no registry. It learns from its bank: when a wage next falls due into the account of someone the bank has been told has died, the bank writes to whoever pays it, at each payment until it is stopped (once, until foundations F6, which lost the letter when the paying office had nobody in it) ("Your payments to ... : the account's holder, ..., has died"). The payment is still made, into the estate; the employer then stops the wages and ends the employment, as it did on seeing the entry. So an employer learns at the next pay day, up to a pay period after the bank does. | A payment to a dead person's account comes back to its sender with the reason (in the United States' clearing rules a return code of its own, "beneficiary or account holder deceased": to confirm, from memory); an employer acts "on receipt of an official death/funeral notice, a registered death certificate or written notification ... from the deceased's legal representative" (Southern Cross University, "Death of an employee", opened: one employer's policy). The household record does not say where each member works, so the family cannot name the employer |
| **A bank** | By the entry: named by the family, or written to by the town for an estate with no family. It stops the dead person's instructions and settles the estate, as before. | "Once notified ... we will place a stop on accounts held individually in the name of the deceased" (ANZ, "Deceased estates", opened); a bank is told by the family or the estate's representative |
| **A landlord** | By the entry, when it reported the death itself or the family member reporting held the lease; otherwise it is not told, and the rent stopping is what it sees (its arrears rule). | Consumer Affairs Victoria, "If a renter or rental provider dies" (opened: says what follows once the provider knows, not how it comes to know) |
| **The police** | Are not told of registrations. They may call at a home already registered; the registry registers a death once. | — |
| **Someone leaving town** | Tells those they deal with (`tell_on_leaving`: the town where they are enrolled, the energy retailer, whoever pays them support): their departure is addressed to each, and each is shown the departures addressed to it. | — (a change of address is given to those one deals with) |

**Parameters.** `feeds`, `estate_tells` on `city.registry` (the world gives them; none: only the reporter is told);
`tell_on_leaving` on `citizen.default`. No figure is new.

**What knowing less does.** The bank, the support office, the school and the energy retailer learn at the same moment
as before. An employer learns up to a pay period later, and pays the estate that wage. A landlord whose tenant's family
does not hold the lease is not told at all. A firm that is neither named nor paying the dead person (the builder for a
client, a shop for a customer) never learns.

## What changed on 2026-10-08, and what it leaves weak

Until police.station 0.3.0 the police were given the sight of every home in the town, by name, whenever they asked,
and drew the time to come themselves: a stand-in for callers the world did not have. Nobody is shown a town
(docs/no-god-view.md). The caller is now in the world: a neighbour, who sees only what anyone sees from the street.

- **The time is the home's, not the neighbour's.** Whoever lives beside a silent home draws the same time for it
  (a draw keyed by the home and the silence, not by who draws: `chance` in a module's context). Drawn by each
  neighbour separately, a home with eight neighbours would be found at the soonest of eight draws, and the figure
  would mean nothing. What the figure counts is how long until the police are told by anyone.
- **Someone with no neighbour is not found** by this rule: a house with nobody living in the cells around it. Their
  landlord still finds a tenant; an owner living alone beside empty lots is found by nobody. In a real town a relative
  elsewhere or the post would raise it; neither is in the world.
- **What a neighbour infers is certain here** (someone went in, nobody came out, nobody is there: only a death does
  that), where a real neighbour only suspects. The wait drawn from the figures stands for the suspicion growing.
- **An officer's hour is not used:** the call takes the station's time (its one lane), not a named officer's working
  day (docs/design/knowing.md, section 12).

## Observed

- **The small town with deaths far raised** (the deaths test: 200 people, a year, 15% a year from age 25): 18 deaths
  at home early enough to follow. 13 with another adult at home: every one reported by a housemate, in 0.0 to 2.3
  days (the longest over a weekend). 5 with nobody at home: 2 tenants by their landlords (3.1 and 7.2 days), 3 by the
  police (2.3, 4.3 and 25.4 days). Before: 14 of 18 registered within a fortnight, 4 never (a family of five who
  planned their week at the wrong time, a family who left town the same day, two owners living alone).
- **1,000 people, a year, three seeds, the life table's own rates:** 23 deaths at home (22 before; a different run
  after the first death), 22 registered (15 before), 21 of the 22 that had a fortnight left within it (15 of 21
  before). By a housemate 15, a landlord 2, the police 5; one found by the police after 229 days (drawn from the
  longest band), one died on the year's last day.

## Leaves out (for now)

- **The time registration itself takes.** A real registration follows the funeral by up to a week; here the registry
  registers the day it is told. Nothing in the world yet depends on the difference, and no figure for the usual gap
  was found.
- **A death outside any building** (on the way somewhere) leaves no trace anyone is shown, and is never registered: 3
  of 26 deaths in town in the year above. In a real town such a death is found at once. It needs the physics to show
  it to someone (a kernel change), so it is left for a decision.
- **A death at work** is seen by nobody who acts on it (the employer is shown who is at work, and acts only on a
  registration). The police's calls are at the homes they are asked to call at only.
- **An employer whose worker has not come, and a landlord whose rent has stopped, do not ask the police.** The
  landlord still looks into its own buildings itself (a landlord's real right of entry is on notice, on a ground:
  docs/behaviour/knowing.md, section 3). An employer learns from its bank, as above.
- **Who really calls:** relatives, friends and neighbours missing someone (people's ties are in the world; nobody
  acts on not having seen someone). With them, the police would be called rather than look.
- **A home with only children too young for school in it** and the household's adults away: nobody tells anyone, and
  the home is not empty, so nobody outside calls either. Not seen in these runs.
- **The housemate asleep.** Someone at home when a housemate dies learns of it the next time they are woken (leaving
  for work, usually within hours; over a weekend, up to two days), not at that moment: nothing wakes a person for
  what happens beside them.
- **The first band's "same or next day"** cannot be met by the police, who must first see the home stand empty for a
  day: those deaths are reported on the second or third day.
- **Heirs outside the household.** A person living alone has no heir the world knows (children who have left home are
  not recorded as theirs), so their estate passes to the town, as before.
