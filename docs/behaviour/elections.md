# `city.electoral_office` (v0.3.1): the town's elections

**Source:** `participants/src/behaviour/elections.ts`. A position of the town's (`entity: city`), run by code here; a
person or a model could hold it. Design: docs/design/world-expansion.md §3.1. The voters are citizens
(docs/behaviour/citizen.md, "Elections"); the incumbent is the mayor (docs/behaviour/government.md).

An election is people and records, with no mechanics of its own. The office keeps the roll, gives notice, takes
nominations, publishes the ballot, counts the votes it alone may see, publishes the result, and appoints the winner
with the ordinary `position` call. Whoever is elected then holds the mayor's position, and its role module runs for
them. The contract didn't change: a vote is a record, a secret ballot is a vote visible only to the town, and a
preferential vote is a ranking (`a>b>c`).

| | Rule | Source |
|---|---|---|
| **The law** | The generator writes it (`law-elections`): the electors elect the mayor every `term_years` (4), by preferential vote, run by the electoral office; every adult resident must enrol and vote. | Local Government Act 2020 (Vic). Victoria's councillors choose most mayors; electing the mayor directly is a liberty |
| **The roll** | Everyone who has enrolled with the town (genesis enrolments for the adults at the start; citizens enrol when they come of age or arrive), less those whose deaths are registered and those who've left. | — |
| **Notice** | `nominations_open_days` (60) before polling day: a public `election_notice` giving polling day, the close of nominations and the method. | Placeholder timetable |
| **Nominations** | `nomination` statements to the town for this office, made since the notice, one per candidate (the last counts). They close `nominations_close_days` (30) before polling day. | — |
| **Unopposed** | One candidate at the close: elected unopposed, with no ballot (a `ballot_result` saying so, and the appointment). None: no one is elected, and the office stays as it is. | Local Government Act 2020 (Vic): an unopposed candidate is declared elected (to confirm the section) |
| **The ballot paper** | Each candidate has a number on it, in order; a vote ranks the numbers (`2>1>3`), as on a real ballot. (Ranking by ids ran past a vote's length limit with 18 candidates, and every vote was rejected: found.) | — |
| **The roll and the ballot** | At the close: the `electoral_roll` (who may vote; the office's own record, for the town's eyes only since 0.4.0: see "Who sees the roll") and a `ballot` for `electorate: "roll"`, listing the candidates, open for `voting_days` (14) up to polling day. | — |
| **The count** | On polling day: each elector's last formal vote (a ranking of at least one candidate; others are informal) made while the ballot was open (0.3.1: one made before it opened, or at or after its close, isn't counted), counted by instant runoff (the last-placed candidate is out, their ballots go to the next preference still standing, until one has a majority). Under `plurality`, only first preferences count, for one round. | Instant runoff, as in Victoria's single-member elections |
| **The result** | A public `ballot_result` with the winner, the rounds, formal votes, electors and turnout. The winner is appointed to the office. The next election is a term later. | — |

## Who sees the roll (electoral office 0.4.0, citizen 0.37.0, generator 0.25.0)

Nobody has a god's view (docs/no-god-view.md). Until 0.4.0 the roll was published to the whole town at each election, a
list of every elector by name, and every citizen read it to see whether to vote.

| | Rule | Source |
|---|---|---|
| **The roll is the office's** | The `electoral_roll` is made for the town's eyes only (`visible: [town]`); the office counts votes against it, as before. Enrolments reach it because each is addressed to it (its `keeps`). | A roll is kept by the electoral authority and may be inspected at its offices; it is not sent to electors or sold (Australian Electoral Commission, "About the electoral roll": "An electronic copy of the current national roll is available for public inspection at any AEC state office"; "The electoral roll is not available for sale in any format") |
| **An elector knows they are enrolled** | A citizen votes on a ballot open to the roll if they hold an enrolment of their own made before the ballot was put. Their own enrolment is one of their own papers. | An elector checks their own enrolment, not the roll (the AEC's "check my enrolment" look-up) (to confirm) |
| **Not modelled: inspection** | Nobody inspects the roll at the office (no behaviour needs to; a seat that did would ask the office). | Commonwealth Electoral Act 1918 s 90A (inspection at the Commission's offices) (to confirm: the 2004 amending Act was opened, the current compilation was not) |

What differs from the roll itself: someone enrolled whose death is registered or who has left can't vote anyway; someone
who enrols after the ballot is put is not on the roll and does not vote (before: the same, read off the published roll).
The mayor's office is no longer shown the roll either.

## What it does in the small town (three seeds; elections at day 365 and, in the test, day 200)

- **A town run well:** the incumbent is re-elected in every seed, with turnout 79–85% (the profile's 83%).
- **A mayor who funds no works crew** (waste uncollected, complaints, anger at the town): the incumbent loses in every
  seed, and a resident becomes mayor, then carries on the office: the next budget and the petitions' proposals.

## Found by running it

- **The council's clerk counted the electoral ballot as a council vote.** Fixed: it counts only ballots for the
  council (`electorate: "council"`).
- **A newly elected mayor redid the office's past work:** it re-approved an invoice, commissioned again a park already
  built (the builder signed), and re-tabled an adopted budget. The mayor module kept what it had done in memory, which
  a successor doesn't have. Now it reads the office's record: what the office has acted on, whoever held it.
- **The incumbent's successor nominated itself after nominations had closed.** It now stands only while they're open.
- **A town run well sometimes has no challenger** (people stand less when they approve of the town): the ballot then had one name. Now the sole candidate is elected unopposed, as the law says.

## Leaves out (for now)

- Electing councillors (the council's five are fixed); wards; by-elections and casual vacancies.
- Campaigns: spending, canvassing, debates, how-to-vote cards. A candidate's platform is their top two values.
- Postal and early voting; scrutineers; recounts; challenges in a court (justice, §5).
- Penalties for not voting (compulsory, but no fine is issued).
