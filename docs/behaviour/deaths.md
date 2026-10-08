# How a death comes to be known (D54; revised 2026-10-08)

**Source:** `citizen.ts` (`citizen.default` v0.39.1: `seeDeathAtHome`, and the child's word), `household.ts`
(`SAYING.died`), `firms.ts` (`firm.landlord` v0.12.3),
`police.ts` (`police.station` v0.2.0), `common.ts` (`stoodEmpty`), `institutions.ts` (`city.registry`). Figures: the
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
| **Anyone, by the police** | Each day they work, the police look at the town's homes (a channel they see only when they ask to). A death in a home that has stood empty is theirs to call at: when is drawn once for each such person from `found_alone_after` (the share found within 1, 3, 7, 30 and 365 days; any moment within the band drawn), counted from the death. When that time has come, at the next day's work, an officer with an hour free (`call_seconds`) calls, and the death is reported to the registry as found there, unless it has been registered since. A world with no police has nobody to do this. | Japan's National Police Agency, 2025 (to confirm); the hour is a placeholder |
| **The registry** | Registers a death the first time it is reported, with what the report says of the family. | [institutions.md](institutions.md) |

**Parameters.** `life.found_alone_after` in the profile (a list of `{ within_days, bps }`, shares adding to 10,000), handed to the police as
`found_after`; `homes_channel`, `registry`, `call_seconds` (3,600) on `police.station`. Without `found_alone_after` in
the profile the police are given no sight of homes and make no calls.

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
| **An employer** | Is on no register and is told by no registry. It learns from its bank: when a wage next falls due into the account of someone the bank has been told has died, the bank writes to whoever pays it, once ("Your payments to ... : the account's holder, ..., has died"). The payment is still made, into the estate; the employer then stops the wages and ends the employment, as it did on seeing the entry. So an employer learns at the next pay day, up to a pay period after the bank does. | A payment to a dead person's account comes back to its sender with the reason (in the United States' clearing rules a return code of its own, "beneficiary or account holder deceased": to confirm, from memory); an employer acts "on receipt of an official death/funeral notice, a registered death certificate or written notification ... from the deceased's legal representative" (Southern Cross University, "Death of an employee", opened: one employer's policy). The household record does not say where each member works, so the family cannot name the employer |
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

## What the police's sight stands for, and why it is the weak point

In a real town the police do not look into homes: somebody calls them. The callers (relatives elsewhere, neighbours,
the post) are not in the world, so the time until somebody calls is taken from the figures, and the police are given
the sight that lets them act when that time comes: who is in each of the town's homes and who last left, by name, when
they ask. That is more than a police station knows. It is asked for, never shown unasked, and the code office uses it
for this alone; a model holding the office could ask for it at any time. See "Revisit if" in the decisions log
(2026-10-08).

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
  registration). The police's calls are at homes only.
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
