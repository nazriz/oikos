# How a death comes to be known (D54; revised 2026-10-08)

**Source:** `citizen.ts` (`citizen.default` v0.36.1: `seeDeathAtHome`, and the child's word), `household.ts`
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
| **Nobody else at home: how anyone can tell** | From outside, a home nobody lives in any more is one that is empty and that nobody has gone into or out of for a day (`stoodEmpty`). Where people share a home, one of them comes or goes within a day (the daily round), and it is theirs to report: only they can say who the family is, and an estate reported by anyone else passes to the town. So the landlord and the police report only a death in a home that has stood empty for a day since. | — (a day: the round's own rhythm, not a place's figure) |
| **A tenant, by the landlord** | A landlord sees who is in the homes it owns (its office's sight of its own buildings). At its weekly look, and whenever else it is woken, a tenant who left by dying, in a home that has stood empty, and not yet registered: reported to the registry. | An owner's inspection. Kept from before; it now waits for the home to stand empty |
| **Anyone, by the police** | Each day they work, the police look at the town's homes (a channel they see only when they ask to). A death in a home that has stood empty is theirs to call at: when is drawn once for each such person from `found_alone_after` (the share found within 1, 3, 7, 30 and 365 days; any moment within the band drawn), counted from the death. When that time has come, at the next day's work, an officer with an hour free (`call_seconds`) calls, and the death is reported to the registry as found there, unless it has been registered since. A world with no police has nobody to do this. | Japan's National Police Agency, 2025 (to confirm); the hour is a placeholder |
| **The registry** | Registers a death the first time it is reported, with what the report says of the family. | [institutions.md](institutions.md) |

**Parameters.** `life.found_alone_after` in the profile (a list of `{ within_days, bps }`, shares adding to 10,000), handed to the police as
`found_after`; `homes_channel`, `registry`, `call_seconds` (3,600) on `police.station`. Without `found_alone_after` in
the profile the police are given no sight of homes and make no calls.

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
