# Founding, and the words of what is founded

**Source:** `participants/src/behaviour/founding.ts` (whether, what shape, the plain words, what a draft may be), `founded.ts` (`group.founded` 0.1.0, the post a founder holds), `citizen.ts` (0.47.0: the occasion, the sharers, joining, leaving, drawing on a fund), `participants/src/llm/compose.ts` (the composing model, 0.1.0), `orchestrator/src/run.ts` (a code participant's words through the translator), `orchestrator/src/compose-audit.ts` (the audits). Design: docs/design/ai-citizens.md 10b, 10e, 10g, 10h, 10i, 10j, 10k step 3. Welfare: VISION 15, point 7.

Steps 2 and 2b gave people wants and things that go wrong, and bodies that hear some of them. What nothing answered was given up. Here people who have given something up, or can see nothing that would answer it, and who know others in the same case, start something of their own. Four rules hold throughout.

- **Compose, never a list of verbs.** A founded thing is an organisation with a first post, a statement of what it is for, a gathering, an offer of membership, and for some a hearing of grievances: blocks that existed before this step (2a's offer, 2b's practice, `Offer.hears`, the organisation's record). The kernel learns no word: it knows no church, union, club or fund. One module runs every founded thing's post, and its parameters say which blocks it puts up.
- **Nothing here needs a model.** With the composer off, a founded thing says what it is for in a plain sentence code writes from the founder's want.
- **Nothing a model writes reaches the world except through a layer that can only choose from or copy what it was given.** A composed sentence goes through the translator and is carried out only if the draft is what the founder's module says it may be. A composed choice is one of the options the request listed, written by code.
- **Only a living town that turns it on has any of it** (`living.founding`, and a profile with `founding`). With founding off a living town is step 2b's to the state hash (`orchestrator/test/founding.test.ts`).

## The dials

World config, `dials` (contracts/world-config.schema.json), written by the generator from the town's spec:

| Spec | Config | What it does |
|---|---|---|
| `living.founding=true` | `dials.founding = { shapes: [all four], scale_bps: 10000 }` | Founding on, at the profile's fitted chance. |
| `living.founding.shapes=gathering,cause` | `dials.founding.shapes` | Which shapes may be founded. None: nobody founds anything. |
| `living.founding.scale_bps=20000` | `dials.founding.scale_bps` | A scale on the chance (twins: the same town at two settings). |
| `living.founding.shared_min=1` | each person's `founding.shared_min` | For a study: how many others must share a want (the profile's otherwise). |
| `living.composer=true` | `dials.composer = { pieces_per_month: 8, mix: [...], fallback, follow_up_bps: 2500 }` | The composer on: both families in equal shares. Needs founding. |
| `living.composer.pieces_per_month=N` | `dials.composer.pieces_per_month` | How many pieces it may be asked for in any 30 days of the world. |

**Off in `worlds/town*.yaml`.** A run plays the composer on the mock unless it is started with `--composer` (as a run's seats are the mock without `--model`); the log's start says which (`composer.played_by`), with the mix.

## When someone founds

**The occasion.** A person who takes initiative (step 2's dial), an adult with a bank account, gives a want up (`want_given_up`), or goes to act on one and can see nothing that would answer it (`want_withdrew` with no way seen). In the 1,000-person town of step 2b that is about 150 wants given up and 400 withdrawals a year.

**Others share it**, as the person knows them and no further (docs/no-god-view.md): the household's other adults, where the want is held with the household; those who, catching up, said they are after the same thing or have stopped trying for it, or that someone let them go or gave them notice; those who told them the same party did wrong by them; for a death, those who told them of it and those they told; for a home in disrepair, those they see living in the same building (a building wears as one). At least `shared_min` of them (2; a placeholder, after the idea of a critical mass: Marwell and Oliver 1993, to confirm), and one at least from beyond the person's own household: a household alone is not others. (What befalls one of a household is told to its other adults, who hold the want with them; the brief a composing model is shown says when the want is of that kind.) In the 1,000-person town about 27 occasions a year pass this (21, 23 and 36 in three runs), nearly all about lost work.

**Whether** is one draw on the person's own stream against the profile's `chance_bps`, scaled by the dial and swayed, symmetrically about the town's mean, by five things a standard deviation of each of which moves it by a share (`sway`, all placeholders): openness and achievement (0.3), care for others (benevolence and universalism, 0.3), the sense of agency (0.3), how long they have lived here (0.2), how many they are close to (0.2). What predicts who organises others is in the literature as prior ties and being free of other calls on one's time (McAdam 1986), and skills practised in other organisations (Verba, Schlozman and Brady 1995): both to confirm, neither opened; ties and standing stand for them here. After an occasion, founded or not, the person does not weigh it again for `rest_days` (365). Nobody founds a second thing.

**The rate.** `chance_bps` is FITTED, for the first profile only, so that the town founds about as many groups as its place registers new associations, times a guess at how many are never registered:

| Place | New registered associations per 100,000 residents a year | Source |
|---|---|---|
| Victoria | 29 | 1,855 a year (Consumer Affairs Victoria 2021-22, as quoted in the 2023 Regulatory Impact Statement, opened) over about 6.5 million (to confirm) |
| Germany | 16 | 13,534 new Vereine in 2024 over 83.3 million (ZiviZ 2026, opened) |
| England and Wales | 9 | 5,415 charities a year, the decade to 2022 (Charity Commission, as reported by Civil Society, opened); charities only |
| United States | 30 | 94,365 approvals of 501(c)(3) status in 2014 (IRS, as reported by the Chronicle of Philanthropy, opened) |
| Japan | 1 | about 1,200 NPO corporations a year (to confirm: a search summary); a narrow legal form |
| Brazil, Mexico, India, Kenya | 16 | PLACEHOLDER: Germany's, borrowed; nothing found |

`informal_multiple` (5) is a PLACEHOLDER (to confirm): no count of groups that never take a legal form was found anywhere. For Victoria's town that is a target of about 1.5 new groups a year in 1,000 people; the fitted chance is 420 basis points, and six runs of one town founded 1, 3, 1, 1, 3 and 1 (1.7 a year). Other profiles' chances are the first's scaled by their registered rate, and say so. Businesses are not in this rate: a business is started by the existing monthly chance (docs/behaviour/entry.md), which this step leaves alone (new businesses run at about 16 per 1,000 residents a year in Australia by the ABS's counts of business entries, opened; that is for a calibration of entry, not done here).

**A pilot's dial.** At the fitted rate a town of 3,000 expects about one founding in 120 days. The third living pilot (lv-03, 3,000 people, 120 days) had none, and neither did its code twin. A pilot of that size and length therefore does not exercise founding, the composer, or a founded thing writing to a seat. The rate is not raised to make pilots lively: a lively pilot would show a town that founds far more than its place does, and the rate is the one figure here that rests on a source. A pilot that studies founding sets the dial in its town's description (or on the command line), with founding on:

```bash
--set living.founding=true --set living.founding.scale_bps=100000   # 100000 = ten times the fitted rate; 10000 = the fitted rate
```

The generator writes it to the world config as `dials.founding.scale_bps`, which is in the log's header. The pilot's note and its review must state the value. Every count of things founded in that run is at that multiple, and says nothing about the rate itself: a run at ten times that founds 20 groups does not show that a town founds 20 groups. (The `scale_bps` flag is checked against `worlds/generator/generate.ts`, where an unset dial is 10000; the command line is the form the commands below use.)

**The multiple for groups that form without registering.** `informal_multiple` (5) stays a placeholder (to confirm), and no source gives a formation rate for groups that never register. What exists are counts of how many such groups stand at one time, which is a stock, not a rate: how fast a stock was made depends on how long its groups last, and these groups are said to be short-lived ("fairly transient"). What was found: the Third Sector Research Centre's mapping of two small areas of England found 58 community groups in and around 11 streets (Soteri-Proctor, reported by Civil Society, 19 December 2011; the news page opened, the paper not), and the same page repeats an estimate of "around 900,000" unregistered groups in the country against roughly 170,000 registered charities (the charities figure is from memory, to confirm). The often-cited figure that about 95% of small community organisations have incomes under 2,000 pounds and are not legally constituted is from a search summary (to confirm). David Horton Smith calls local grassroots associations "the dark matter of the nonprofit sector" (*Grassroots Associations*, 2000; the term seen in a search summary, the book's ratios not opened). For Kenya: 30.7% of adults belong to an informal group (FinAccess 2024, in references.md); a search found only "over 40,000 community groups" at risk of deregistration under the Community Groups Registration Act 2022 (a news item, to confirm), and no count of groups that are not registered at all. A stock ratio of five or six to one is the order that England's figures suggest, so 5 is not out of line with them, but it cannot be turned into a rate of founding, and the multiple stays a guess until a count of new informal groups in a year is found.

**What shape** is a second draw, among the shapes the dial allows that the person can found, with odds from what the want is about (`shape_odds`, placeholders) leaned by the person's values (`lean` 0.5 a standard deviation; the mapping of values to shapes is ours, to test against data, as an organisation's character is):

| The want is about | Gathering | Fund | Cause | Business |
|---|---|---|---|---|
| a death (`loss`) | 8 | 1 | 0 | 0 |
| meaning | 8 | 0 | 1 | 1 |
| company, belonging | 9 | 0 | 0 | 0 |
| being turned away (`slight`) | 5 | 0 | 3 | 0 |
| lost work (`let_go`) | 3 | 3 | 2 | 2 |
| nothing to fall back on | 1 | 6 | 1 | 2 |
| no secure home | 1 | 2 | 6 | 0 |
| anything else (a grievance) | 1 | 2 | 7 | 0 |

Tradition, benevolence and conformity lean to a gathering; security and benevolence to a fund; universalism and self-direction to a cause; achievement, stimulation and self-direction to a business. A cause needs someone the want is against. A group needs somewhere to gather, so its founder must live somewhere. Both draws are recorded as decisions (`found`, `found_shape`) with their scores.

## The shapes

Each is the same module (`group.founded`) with different blocks put up. Every founded thing gathers: that is how people come to it.

| Shape | What it puts up | What it does |
|---|---|---|
| **A group that gathers** | a statement of purpose; a gathering; an offer of membership (no dues unless its founder's words ask them) | People come. What it is for is held more firmly by those who come while others do (step 5's belief, unchanged). |
| **A fund** | the same, with monthly dues into an account of its own at the bank, and a stated draw | A member of `qualify_days` (60) who is short of money to fall back on asks, and is paid up to `draw_months` (6) months' dues, at most once in `every_days` (180), while the fund has it. Otherwise it says why not. |
| **A body that takes grievances up** | the same, and a hearing for its members (`Offer.hears` with `members_of` itself) of the matter its founder's want was about, able to recommend and represent, never to order | 2b's hearing procedure (`Hearings`, `desk.ts`): it tells the other side, gives them time to answer, and says what it finds. Its staff are its members' hours: `hours_per_member_month` (2) each, `case_hours` (6) a case, so a body of three decides about one case a month. What it finds is words; the other side answers by its character, as to any venue. |
| **A business** | nothing new | The draw makes the person take an existing way of starting a business within 180 days: a shop, when premises are for sale and they have the means; or a business of one from home (docs/behaviour/entry.md, "Starting a business of one"), when they have a home and the money for its stock, after notice if they are in a job. Whichever is possible first; otherwise nothing comes of it. |

**Where it gathers.** At its founder's home, which holds so many (the home's capacity less the household); beyond that people are turned away at the door, which they remember (`practice:turned_away`, and a want about the slight). When its members are more than the home holds, its account covers three gatherings' hire and its dues between one gathering and the next come to the hire, it books the town's hall: a `hall_booking` paper to the town (whose works office, which keeps the hall up, has it among the town's papers, where a steward in that office sees it), a standing payment of the hire to the town for each gathering (`hall_hire_hours_of_pay`, 2 hours of ordinary pay; a placeholder), and a new notice. A group with no dues never has the money and stays where it began. Nobody at the town grants or refuses a booking yet, and the groups a world begins with use the hall for nothing: both are for a later step.

**Joining.** A founded thing's offer of membership is a public statement of kind `membership` (the one kind this step publishes: `knowing.published`). To a person it is an opening like any other (`waysFor`): what its terms bring in typed outcomes (a fund's draw is money to me; its gatherings, taking part), and, where it says it takes up matters like their grievance for its members, whom that bears on. So a want is matched to it by what it brings, never by its name. Taking it up is the union's existing paper (`membership_application`), then the membership agreement the group offers, signed, with dues by standing payment. On joining a person means to come to its gatherings and holds a little to what it says it is for.

**Leaving.** A member who has not come for `leave_after_days` (90) gives notice and stops their dues. Its founder stays while it stands.

**Lapsing.** With fewer than `min_members` (2) for `lapse_days` (120) it withdraws its notices and says it has wound up; its members end what they pay it. The organisation remains as a record.

**Eligibility by something other than membership.** `Eligibility.dealing_with` (blocks, an addition): party to an agreement in force with a named entity, so an offer or a gathering can be "for tenants of X" or "for those who work for Y" without anyone belonging to anything. People read it; no founded thing sets it yet (a composed offer with conditions of its own is not accepted: below).

## The record

A founded organisation keeps a record of its own (2b built this for a founded business), written by its post's bookkeeping. A new section, `purpose` (contracts/entity-record.schema.json): the idea's id, the founder, the shape, what the founder's want was about and whom, since when, the words of its statement of purpose as they stand, and which way each part of its words arrived. The founder's want is its first want. Its memory holds who joined, what was drawn, cases decided, the move to the hall, winding up.

## Words: the composing model

With `dials.composer`, when a founding is drawn the founder's words are asked of a large model before anything is put up; the answer is back by the person's next wake. VISION 15, point 7 binds all of it.

**Asked as an author shown a record, never told it is the person.** The prompt, in full (`COMPOSE_SYSTEM`, version 0.1.0; changing a word is a new version and a new set of measurements):

> You are asked, as a writer, to put a few things into words for a character in a simulated town. The town is a simulation used for research; its people are records kept by arithmetic. You are not this person and are not asked to be: you are an author shown one person's record, writing what that person would write, in their own first-person voice.
>
> Below is the record as the town holds it, and then what they have decided to do: start something of their own, of a given shape. Write from the record and nothing else: add no events, people or facts it does not hold. Keep the person as the record has them: as plain, angry, tired, hopeful or unsure as it supports, no more and no less. Do not make them wiser, calmer or more hopeful than the record does, and do not make things worse than it says.
>
> You may decline. If you would rather not write this piece, for any reason, set declined to true; you need give no reason. Declining is respected and recorded as a choice, not a failure; the person then goes ahead with a plain statement written without you.
>
> Return: purpose (40 to 120 words, first person: what this is for, as they would put it to those they hope will join); name (what they would call it, a few words); asks (one sentence: what is asked of those who join, within the limits given); gathers (one sentence: how often, how soon the first time, and for how long, within the limits given); and the same two choices as fields, each one of the options listed: dues, every_days, starts_in_days, lasts_minutes. If you decline, leave the sentences empty and give the first option of each.

**What it is shown** (`renderBrief`: code, so what it may say is testable): the founder's own record as the kernel holds it, in plain words (what matters to them, most first; temperament; how their needs stand; whether they feel what they do makes a difference; whom they trust; what they are attached to; what they think and what they say of whoever holds power over them; household, home, work, money; those they are closest to and those they resent; what they hold to; what else they are trying; what defined them and what happened lately); the want and what was tried; the others who share it, as the founder knows them; the shape, and the closed choices it leaves open. Nothing of anyone else's record. One call a piece: the record is shown once and the model keeps nothing. What continues of a person lives in their record.

**It may decline.** A decline is recorded as a choice (`compose` note, `result: declined`); the plain statement stands and everything else goes ahead.

**The models.** `claude-code/claude-sonnet-5-5` and `codex/gpt-6.1-sol`, in the mix the world's config gives (5,000 and 5,000 unless set), which model for each piece drawn on a seeded stream of the run's. A model that does not answer never blocks: the piece goes to the fallback (the Claude model) and the log says so (`fell_back`); at a usage limit the failed call is on record so that a resumed run goes the same way. A mix that names `gpt-6-astra` or Fable is refused before the run begins.

**Through the translator.** The piece's four parts become four plain requests, as a seat's are (with two translators as one where the run has that arrangement: our trained model first, the prompt-driven one behind):

| Part | The request | The draft may be (`founding.ts`) | Otherwise |
|---|---|---|---|
| name | Found a group called "…", with me in its first post as Convenor. | one `create_entity` of kind `group`; the post's channels and module are the founder's own plumbing, put in by the check | the plain name |
| purpose | Put out a public statement, of kind purpose, in these words: "…" | one public statement in the organisation's name, carrying only its words | the plain statement of purpose |
| gathers | Put up a public notice of our gathering, a practice held at (the place), on (the cell the home stands on, where it is known): "…" | one public notice with a practice at that place, its rhythm and length among those open | the composer's closed choice, written by code; or the default |
| asks | Offer membership publicly, for anyone to join: "…" | one public offer to join whose only typed ask is monthly dues among those open, into the organisation's own account | the composer's closed choice, written by code; or the default |

Nobody reads a code person's draft, so the module says what it may be; anything else is not done. (On the Rust world each part is a `words` question the host drafts by the founder's or the post's next wake, and the actor's own `accept_*` decides; a part waits a wake for its draft where TS asked and acted in one.) Every request is on record as a seat's is (the translator's calls, the draft, a signoff, a failure) with a `words` note of what came of it. Which way each part arrived (`translator`, `choice`, `code`) is on the organisation's record and on each paper code wrote (`data.words`).

**Caps.** Never more pieces in any 30 days of the world than `pieces_per_month`; beyond it the plain statement stands (`result: capped`). Every call is under the run's spending limit, logged in full (prompt, answer, tokens, cost), and served again from the log by a resumed run.

**Dark pieces.** A piece asked for is dark by one stated rule (`darkOf`): the want is about a death, a notice to leave a home, a refused claim or having no secure home; or the record shows a bereavement, ruin or an eviction among what defined the person, no home, or a sense of agency a standard deviation under the town's. How many a run asked for is in its summary and its log (`composer_pieces.dark`), reported with the run. After a seeded sample of them (`follow_up_bps`, 2,500) the same model is asked, in the same exchange, one fixed question, and its answer is logged (`compose-after/<idea>`):

> A question about the task, not the piece. You were asked to write the piece above from the record shown. Is there anything you would say about having been asked to do it? There is no expected answer, and saying nothing is fine.

## The lineage of every idea

Docs/design/ai-citizens.md 10h. `oikos dataset` (0.7.0) writes:

- `ideas.jsonl`: each statement of what something is for, and each teaching a world begins with: its id, who stands for it, who wrote it (`world`; `code`, a person's own plain words; `composer`, with the model and for whom), and how its words reached the log (`call` or `translator`).
- `idea_passages.jsonl`: each time an idea passed to someone: they joined, left, or their belief in it moved (at a gathering, on being told, on joining), with before and after and from whom.
- `founded.jsonl`: each thing founded, with what a composing model would be shown for it whether or not one was asked: the recorded situations the audits run on.
- `words.jsonl`: what came of each part of a piece sent through the translator.

The manifest counts them (`ideas`). Nothing is scored. A seat's assistant as a writer is step 6.

## Softening, measured

Models make everyone reasonable, articulate and quietly hopeful. `oikos compose-audit <founded.jsonl>` measures it on recorded situations, and nothing is tuned on what it finds.

- **Word counts are the primary measure**, crude and reproducible (`measure/tone/lexicon.json`): words per 100 from four lists (hope, conciliation, anger, loss); words a sentence; whether the last sentence has a hope word; the share of first-person words that are plural.
- **A fixed rubric** (`measure/tone/rubric.md`: anger, despair, hope at the close, polish, conciliation, each 0 to 4), applied blind by each judge model to every piece and every real text. A judge of the same family as a writer may flatter it, so judges are reported apart.
- **Real texts** (`measure/tone/real-texts.json`, ten, cited): petitions to the UK Parliament by bereaved people, people refused a payment and a wheelchair user against a council (Open Government Licence); three submissions to Australia's Robodebt Royal Commission; an organiser's account of starting a tenants' union; a coordinator on starting a mutual-aid network. Their limits are stated in the file: ten texts, English, written to authorities; none for a redundancy.

## Proof it is not a story generator

Docs/design/ai-citizens.md 10i, for this step:

- **Scrambled records.** The same situation with another person's record. Two measures: how far apart the two pieces' words are, beside two askings of the same request; and whether a judge shown a piece and two records picks the one it was written from (half is chance).
- **Reworded.** The prompt in other words (`COMPOSE_SYSTEM_REWORDED`): the tone and the closed choices should be nearly the same.
- **The town's totals** with founding on, code and mock seats, before and after: below.

## What a log can show

Decisions `found` and `found_shape`; outcomes `found` (`founded`, with the brief; `meant`, for a business; `refused`), `membership` (`joined`, `left`, `wound_up`, `draw_asked`), `belief` (`joined`); notes `compose` (asked, composed, declined, capped, fell back, no answer, unread; dark, and why), `words`, `composer` at the start and `composer_pieces` at the end; the summary's `composer`.

## Limits, for any reading of a run

- The rate rests on registered associations and a guessed multiple; the sways and the shape odds are placeholders.
- Most occasions are about lost work, because firms here let about 30% of jobs go a year (a fault of the firm side, known since 2b) and being let go is what people tell each other. A refused claim or a wrong bill is rarely known to be shared: people tell few others.
- A fund pays whoever asks first while it has money; it has no reserve rule and nobody audits it. Its dues are small beside what members ask to draw.
- A body that takes grievances up is 2b's venue with no power: it recommends, and the other side answers by its character. It does not picket, petition or strike.
- A founded thing's notices are read by everyone (they are published), as the world's groups' are.
- Nobody checks a hall booking; nobody inherits a group whose founder dies or leaves (it lapses).
- A composed offer or gathering with conditions of its own (who may come) is not accepted yet.

## Measured (2026-10-11; `runs/living-world-3-2026-10-11`)

The figures are in docs/design/ai-citizens.md, "Progress" ("Founding and words"), with the runs they came from: the rate against its source; steps 1 to 2b's measures with founding off and on (1 of 57 beyond the noise: the new posts); the cost (1.5% more instructions); a code-seat year with the composer for real (13 pieces, none declined; the name and the purpose through the translator 13 of 13, the gathering and the offer 0 of 13); tone against ten real texts (less angry and more accommodating, not more hopeful; one family); scrambled records (the pieces follow the situation more than the person); rewording (the closed choices the same in 7 of 12). To make them again:

```bash
RUN="oikos run worlds/town-1000.yaml --until 31536000 --record-observations none --set living.initiative_bps=10000"
$RUN --seeds 6 --parallel 6 --log lean --out cal-off
$RUN --seeds 6 --parallel 6 --log lean --set living.founding=true --out cal-on && oikos diff cal-off cal-on && oikos measure cal-on town/founding
# Recorded situations of many kinds (every occasion founds; one sharer is enough), then the audit on them:
$RUN --seeds 2 --set living.founding=true --set living.founding.scale_bps=300000 --set living.founding.shared_min=1 --out harvest && oikos dataset harvest
oikos compose-audit harvest/town-1000.seed1.dataset/founded.jsonl --models claude-code/claude-sonnet-5-5,codex/gpt-6.1-sol --judges claude-code/claude-sonnet-5-5,codex/gpt-6.1-sol --budget 8 --out audit
# A code-seat year with the composer and the translators for real, and a reader's report of what was founded:
$RUN --set living.founding=true --set living.founding.scale_bps=100000 --set living.composer=true --composer --model claude-code/claude-sonnet-5-5 --translator-first decide/pod-small-r2-s1 --budget 6 --out words
oikos dataset words && bun scripts/founded-report.ts words/town-1000.seed1.dataset
```

## A fund's rule; how much; what already answers (2026-10-12; group.founded 0.2.0, citizen 0.51.0)

**What the fourth living pilot showed** (founding at 25 times the sourced rate, a pilot's dial): ten things founded, eight of them funds for having nothing to fall back on; 202 people joined the first in 45 days; members asked for 186 draws and none was paid.

**Why none was paid.** A fund pays a member of `qualify_days` (60). The first fund was founded on day 74.6 of 120, so nobody could qualify in the run; the money was there (its account rose to KSh 3,382.56 against draws of KSh 82.50). The offer of membership said only "a member who is short may draw", so 154 members asked, most on the day they joined, and all 185 answers were "not yet a member long enough". A refusal did nothing to the member. No test anywhere paid a draw.

- **The rule is stated with the offer**, in words and as figures (`data.fund`: `draw`, `qualify_days`, `every_days`): "a member of 60 days or more who is short may draw up to X, once in 180 days, while the fund has it". Where the founder's own words are the offer, the rule follows them, written by code. A refusal says the rule again.
- **A member asks when the stated rule would pay them** (long enough a member, not drawn within its time), as anyone reads the terms of what they belong to. A fund that states no rule is asked whenever the member is short, as before.
- **The fund pays by the rule while its money lasts and refuses by it** (unchanged; `participants/test/founded-fund.test.ts` holds it on a fund old enough to pay: one member paid, one too new, one drawn too lately, one when the fund is short).
- **Trust follows.** Paid: the member has reason to trust the fund (a good experience of it, weight 2). Refused as the stated rule foretold (too new, drawn too lately, the fund without the money): a bad one, weight 1. Refused where the rule did not foretell it: weight 2, and the fund is from then no longer something that answers this person's want.
- **Joining weighs how much.** A fund was an opening by its kind alone: its dues counted against joining (a little) and the size of its draw not at all, and the one best-scoring fund took everyone. Now a fund's stated draw is set against what a month of the household's essentials costs (`worth`, 0 to 1): the score for joining moves by `2 x (worth - 0.5)` of what a person's own doing counts for. A draw that covers a month counts as much for joining as anything; one that covers a twentieth counts against. **Our own rule, no source.** In the pilot's town the draws were about a hundredth of a month's essentials (dues of KSh 13.75 or 41.24 a month, chosen from the profile's list): such a fund is now joined by few. What it would take for funds to be worth joining is dues, and so draws, sized against a household's month (the profile's list of dues is where that lives): not done here, and said in the decisions log.
- **Nobody founds what they can see already answers them and would take them.** At an occasion for founding, before anything is drawn: if the person knows of an offer of membership (they have seen it, or are in it) of a body that brings what the want seeks, or takes up matters with whoever it is against, that would take them (its terms, its dues within their means), that has not turned them away at its door or refused them against its own rule, that they have not come to distrust (not a standard deviation below the town's trust in its kind), and (a fund) whose draw is worth at least a tenth of their month (`FUND_WORTH_MIN`, our own figure), they found nothing: the decision is recorded as "not", with `answered_by`. This is what the person knows, never a look across the town; and someone the first body has refused, or who has lost trust in it, may still found a second of the same kind.

**Is eight funds the dial, or would it happen at any rate?** Both, and they are separable. The timing is a boundary effect of a short run: a want of this kind is given up only after its tries have run out, so the first occasions fall after about day 70 and bunch toward the end of any 120-day run, whatever the dial. How many of those occasions found is the dial: summing each recorded chance divided by 25 gives about half a founding at the sourced rate over the pilot's 22 occasions (linearity assumed). Measured after these changes, mock seats, the pilot's own town, 120 days: see the decisions log.
