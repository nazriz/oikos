# Culture: what a town holds in common

Design: [docs/design/ai-citizens.md](../design/ai-citizens.md) section 14. Code: `participants/src/behaviour/culture.ts` (the arithmetic), `participants/src/behaviour/citizen.ts` (where a person holds, learns and acts on it), `worlds/generator/generate.ts` (the dial, and origin). Decisions: docs/decisions.md, 2026-10-13, "Culture: plan" and "Culture: building it". Sources: [docs/research/references.md](../research/references.md), "Culture". **Off by default**: `living.culture` in a spec, `dials.culture` in the world config. With it off no line of this is entered and the world is byte-identical to the world without it.

**Nothing here is the town's.** Every figure is one person's belief, kept in their own record. What a town holds in common is read from logs, outside (design 14h). The platform judges nothing: no conduct is the one a good town has, and no group is better or worse at anything. Every size is a **placeholder** unless this page names a source; they are one set for every conduct, and parameters of the dial (`dials.culture.step`).

## What a person holds

For each **conduct** their world gives them (a closed list in code, at most 12; each tied to one draw the code mind already makes):

| Conduct | The occasion; "does" is | Draw it sways |
|---|---|---|
| `answer_tribunal` | served with an application for possession; answers it | `possession.answer_bps` (`answer-<lease>`) |
| `stay_past_notice` | told to vacate, cannot pay; still there at the date | `possession.stay_bps` (`stay-<lease>`) |
| `take_to_tribunal` | an unlawful rent rise, or a debt unpaid; applies | `tribunal.challenge_bps`, `apply_bps` (through `reads`) |
| `complain` | a service failed; writes to the town | `complain_bps` (through `reads`) |
| `take_in` | asked for a roof by someone known; says yes | `stay.willing_affinity_bps` |
| `join_union` | a new job; joins | `union_join_bps` |
| `strike` | a ballot for action; votes yes | `strike_vote_yes_bps` |
| `take_from_employer` | short of money at work among goods; takes some | `crime.take_bps` |
| `apply_possession`, `heads_before_hours`, `order_possession` | an organisation's conducts: a person may hold a view of them; no decision of a person uses them | none |

Three conducts asked for are not choices anyone makes today (paying rent before other things, paying rates, reporting a neighbour) and wait for the choice.

The numbers (basis points; whole percent in the record):
- `does`: of those I know of who met the occasion, the share who did it (Bicchieri's empirical expectation; Cialdini's descriptive norm);
- `approves`: how far I take those around me to approve of doing it (the normative expectation; the injunctive norm);
- `own`: what I think of it myself, from my values; `says`: what I say when asked;
- `n`: how much I have seen, as a weight held to `window` (20).

**How it starts.** `does` and `approves` start at the profile's (`values.culture.conducts.<conduct>.does_bps / approves_bps`); where it gives no `does_bps` it is the conduct's own rate in this world, so the picture people start with is the town as calibrated; where it gives no `approves_bps`, 5,000, a named placeholder. A person from an origin group whose profile gives group figures starts from those instead. Weight `prior_weight` (4). `own` starts at the person's starting `approves`, plus their own lean (a normal draw of sd `own_sd_bps` 1,500 on their own stream, `culture-own-<conduct>`) and `values_bps` (500) per standard deviation of the values that speak to the conduct (`VALUE_MAP` in `culture.ts`: ours, to test against data, as needs-from-values is). **`n` and a conduct a person holds:** a conduct is held where the world gives the person a rate for it or the profile a figure; `take_in` has no rate, so it starts at the placeholder 5,000.

**What I think and what I say.** `own` settles half the way to `approves` every `internalise_days` (1,095), worked out when read (nothing runs daily; Kelman 1958 on compliance becoming internalised). `says` is `own` moved toward `approves` by how much belonging weighs with me times what integrity leaves, the arithmetic of `Inner.view` (Kuran 1995, preference falsification, as built there).

**The record.** One section, `norms`, **positional**: an array of at most 12 places, the place in the closed list of conducts (`CONDUCTS` in `culture.ts`) being the conduct, each a row `[does, approves, own, says, n]` in whole percent, `null` where the person holds none, trailing nulls left off (`normsRows` reads it back as named rows). Written again only when a figure has moved by 2 in 100 (`grain_percent`). It does not grow with the town or with time. **Why positional (2026-10-13, step 0):** the kernel canonicalises and hashes a person's whole record at every change to it, so any section costs its bytes each time anything in the record is written, moved or not. Named rows were about 400 bytes of a 1,700-byte record (a quarter of it); positional rows are about 120, and a record carrying the section is 16% bigger than one without, where it was 32%. The log carries only a changed section, so it is unaffected.

## The term at a decision

```
lean = ( c * (w_does * (does - does0) + w_approves * (approves - approves0)) + (1 - c) * (own - approves0) ) / sd_bps
rate' = rate * (1 + sway * lean)        (lean held to three standard deviations; the rate to 0..10000)
```
`c` is the person's conformity (0 to 1); `does0`, `approves0` the profile's (the point the picture is measured from); `sd_bps` 2,500; `w_does` 0.6, `w_approves` 0.4 (where what is done and what is approved part, people follow what is done: Bicchieri and Xiao 2009; the sizes are placeholders); `sway` 0.3 (as trust and agency have). A conformist follows the street; someone who is not follows themself. **No draw is added, moved or renamed:** the same draw meets a shifted rate. **With every figure at the profile's the lean is the person's own alone, which sums to nothing over a town** (tested over 3,000 drawn people), so the calibrated rates hold on day 1 and move only as the town does. No conduct has a size of its own.

## Learning what others do: three routes, no fourth

A picture moves only by what reaches a person **along a tie** (what someone known tells them of themselves), **by being there**, or **by what is published**. `Culture.weight` refuses any other route (a test tries them: docs/no-god-view.md). Nobody passes on what a third person did, so one act is never counted twice: a person tells each act once to each person who asks.

| Route | Weight | What moves |
|---|---|---|
| a tie told me of their own act (or said what they think of it) | 1; `close_weight` (2) for a close tie (affinity from `close_affinity_bps`, 3,000) | `does` toward 1 or 0; `approves` toward what they said |
| I was there | 1 | `does` |
| published (a ballot's declared result) | up to `published_weight` (4), as its share | `does` toward the share |

A sighting moves `does` toward it by its weight over the weight held: `does += (x - does) * w / n'`, with `n' = min(window, n + w)`; so the recent counts for more once `window` is full (Cialdini, Reno and Kallgren 1990; adoption that needs several sources and spreads through close ties is complex contagion: Centola and Macy 2007). Approval is the same rule on `approves`, from what others *say* (Bicchieri 2006), weighted `w / (n + w)`.

**What I tell.** Asked how things are, a person adds up to `phrases` (3) of: what they did at an occasion in the last `news_days` ("When a service failed: I wrote to the town."), and what they say of it ("I say writing to the town about a service is wrong."). **Not telling:** I mention my own conduct only if it sits within `conceal_bps` (7,500) of what I take to be approved, or my integrity is high (`integrity_tells_bps`); what was seen cannot be kept back; what I say is `says`. This is why private conduct is under-counted (Kuran 1995).

## Origin

Where people come from, as groups the place's own statistics name (`values.culture.origin`: `groups`, `same_household_bps`, `homophily_bps`, `by_group`), each with its source in the profile; a profile with no figure has no such groups. **Naz, 2026-10-13:** origin divides a town as building, workplace, membership and tenure do. It does two things only:

1. **It makes ties within a group likelier (homophily).** A person tells others which group they come from when asked how things are (only where the profile has `homophily_bps`); when choosing whom to catch up with, and on what a talk adds to a tie, someone of one's own group counts `1 + homophily_bps / 10,000` times (McPherson, Smith-Lovin and Cook 2001; the figure and its source are the profile's, or a marked placeholder).
2. **Where a source gives a group's figures for a conduct (`by_group`), those who come from it start there.**

Nothing in code makes any group better or worse at anything, and no conduct is defined about a group. Prejudice between groups may emerge from the mechanisms (a tie cools toward someone for what they did, and ties are mostly within groups); the platform records it and judges nothing. Origin is generated on a stream of its own (`generator/origin`), so no other draw moves: in each household, whoever has no parent in the town: the first is drawn from the shares, each other is of that group with `same_household_bps`, else drawn again; whoever has parents takes a parent's group (equal chance where the parents differ; no source found gives a split). A child born in a run, and a newcomer, have no group until step 4.

## Where it is in the decisions (step 3)

One bounded term per conduct, at the draw the conduct already has (`citizen.ts`): `answer_tribunal`, `stay_past_notice` and `take_from_employer` sway the rate before the draw; `take_to_tribunal` (a rent rise challenged, a debt applied for) and `complain` sway it inside `reads`, beside trust and agency; `take_in` sways the affinity a tie must have (a lean toward yes lowers it); `join_union` and `strike` add the lean (times the sway) to the shift beside `union_peers` and the vote's own shift. Where the choice already has an outcome (answer, stay, challenge, take in), the outcome records the numbers and the lean (`norm_does`, `norm_approves`, `norm_own`, `norm_says`, whole percent; `norm_lean`, hundredths of a standard deviation, in its `facts`); join, strike, complain and take have none, so their lean is not recorded. **Not built:** the term on a want's way (`adj` of `waysFor`, `pursue`).

## Not built here (steps 4 to 9 of the plan)

Breaking one seen, esteem, what is said in company, children's and newcomers' pictures, a law as one hearing of approval (4); town memory (5); an organisation's practice (6; **a seat is not handed it as ready counts: Naz, 2026-10-13**); the measures (7); the profiles' conduct figures (8); the proof run (9). **No pilot uses culture until step 9's proof has passed.**

## Cost

Nothing runs daily. A norm moves at a catch-up, a sighting or a published count; fading is worked out when a figure is read, and the section is worked out again only when a picture has moved or a month has gone (an unchanged section is the same array, not compared again, not written again). A decision costs one term, about ten integer operations. Measured (docs/decisions.md, 2026-10-13, "Culture: the cost of carrying the section"): culture's own computing (hearing, telling, the terms) is about 0.25% of a run's time. The kernel's record writes are 2.9% of a 60-day run of the 1,000-person town (630 ms of 22 s), and carrying the section adds to those writes 16% as named rows (+0.45% of the run) and 7% as positional rows (+0.19%); the log's growth is 0.4%. The 2.3% to 2.8% first reported was a whole-run timing, which on a shared machine varies by about 4% between identical runs, and did not reproduce. **The floor** is the kernel's: a record write canonicalises the merged record twice and hashes it, whichever section moved, so every section is paid for by its size at every write (630 ms with no culture at all). Only a change to the kernel (keeping each section's canonical bytes, so a write pays for what it changed) would make an unchanged section free; it is not made here (the kernel is not this work's), and it would make every section of every record cheaper, not only this one.
