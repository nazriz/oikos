# AI citizens (design)

**Status:** signed off by Naz, 2026-09-29 ("agreed on facts only, signed off"). Revised the same day after a second
research pass ("is there more we can do" than The Sims). The research is in docs/research/citizen-minds-2026-09.md;
every idea used, with its citation, is in docs/research/references.md; section 9 maps them to this design.

**Goal:** citizens that replace today's rule-based ones. They should:
- be simple and fast (microseconds a decision, towns to cities);
- have character: values, habits, feelings, friends;
- use anything the world offers without new citizen code, including what a model steward invents (VISION 15–17);
- learn: from their own experience, from each other, and, rarely, by asking a model what something new means;
- produce the data to train citizen models later.

**Cutover** (Naz: "big bang"): the building blocks land first, with today's citizen still passing. Then the new citizen
replaces it in one step, judged against the calibration we already have. Today's `citizen.default` is then retired.

## 1. The citizen, in layers

1. **Who they are:** values, temperament, needs (3a).
2. **How they decide:** by habit, by copying others, by comparing, or by deliberating (3b), with what they've learned
   from experience (3c).
3. **What they feel and whom they know:** emotions from appraising what happens; relationships (3d, a later phase).
4. **What they know and believe:** only what they've perceived or been told; belief spreads (5).
5. **Asking a model, rarely:** when deliberating about something whose *meaning* the facts can't settle, the citizen
   asks the model (gpt-6-luna to start). The answer is remembered for others like them (4). **Off until Naz switches it on.**
6. **The record of every decision:** the training data for a citizen model (7).

Everything but layer 5 is code: deterministic, microseconds, no model. Without layer 5, the citizen is the all-code
control. Every layer acts through the participant API, as every participant does.

## 2. New building blocks (contract changes)

The principle (VISION 15): the world states *facts in its own terms*; what they mean to a person is the person's mind.
So the world never says "this satisfies belonging". It says "a gathering at the hall every seventh day; members may
come; $5 is collected". The citizen's values and needs make of the facts what they will.

### 2a. Offers

An optional structured field on statements, alongside `adico` and `formal`. It says what someone may take up, on what terms, and how:

A job posting as an offer (contracts/examples/valid/record/offer-job.json; amounts in cents as decimal strings,
durations in seconds, as everywhere in the contracts):

```jsonc
"offer": {
  "by": "shop-3",
  "to": { "min_age_years": 18 },       // who may take it up: every condition given must hold
  "take_up": "apply",                   // how: sign, apply, order, join, attend
  "terms": {                            // what the taker would enter into, in the typed vocabulary (2c)
    "template": "employment",
    "commitments": [
      { "who": "shop-3", "does": { "outcome": { "money": { "from": "acc-shop-3", "amount": "211356", "for": "wages" } } }, "every": 1209600 },
      { "who": "taker",  "does": { "outcome": { "work": { "task": "serve", "at": "shop-3-premises", "hours": 273600 } } }, "every": 1209600 }
    ]
  },
  "available": 1                        // how many can take it up
}
```

Every existing kind of offer becomes one of these:
- a job posting (sign an employment agreement: work at a place for hours, paid);
- a rental listing (sign a lease: occupy a dwelling, pay rent);
- a price list (order goods);
- a union's membership (join: pay dues, be represented);
- a loan (apply);
- a form (apply).

A new one, a church's membership or a festival fund, is the same shape.

### 2b. Practices

An optional structured field on statements: a recurring situation people take part in (Versu's social practices). It's the shape for rituals, services, meetings, markets and classes. It has no power: nothing happens unless people come.

A weekly service (contracts/examples/valid/record/practice-service.json):

```jsonc
"practice": {
  "at": "hall/space.1",
  "every": 604800, "first": 259200, "lasts": 7200,
  "roles": [
    { "role": "leader",   "who": { "holds": "priest" } },
    { "role": "attendee", "who": { "members_of": "st-marks" }, "open": true }
  ],
  "during": [
    { "role": "attendee", "does": { "outcome": { "money": { "to": "acc-st-marks", "amount": "500", "for": "collection" } } }, "optional": true }
  ]
}
```

Taking part is ordinary physics: being in the space at the time, and doing what one chooses to do there.

Version one is thinner than Versu's practices. Those have stages and expectations, and people weigh how others will see what they do. The schema leaves room for `stages` and `expected` (per role, per stage) later, for rituals and ceremonies with a shape.

### 2c. A typed vocabulary for what people commit to

Today an agreement's `does` is free-form data, a hidden convention (VISION 15). It's now typed (contracts: blocks `Does`, `Outcome`), formalising what the call language already wrote:
- `{"outcome": {...}}`, one of:
  - `money` (to, amount, from, for);
  - `goods` (kind, quantity, to, at);
  - `occupancy` (who, in);
  - `structure` (type and on, or remove);
  - `account` (holder, close);
  - `work` (task, at, hours or units): new;
  - `attend` (a practice, a role): new.
- or `{"text": "..."}`: anything else, in words.

It's validated by the schema (the kernel refuses anything else), rendered in words for models and humans, and readable by code. Every world and module already conformed; four contract examples and the kernel's tests were migrated.

### 2d. Seeing offers and practices

A channel `match` can select statements *having* an offer or a practice (`"has": ["offer"]`), whatever their kind. So a citizen sees a kind of offer nobody configured for, and a new construct is visible as soon as it's put up where they can see it (a place, a directory, their own records).

### 2e. Laws, without hidden fields

Laws that code participants follow (rent reviews, industrial action) move from hidden `data.law` fields to what's already in the contracts: `adico` and a `formal` CEL condition over the act.
- A landlord asks whether raising a rent now would breach a law, the way the planning office already checks a permit against the laws.
- A law a model mayor passes, with a formal condition written by the translator, then binds code landlords the same way.

No new block is needed.

**Revisited 2026-10-05: a law the council passed on its form bound nobody. Built the same day: the clerk drafts, from a form.**

*What the code audit found.* The second bullet above isn't true as built.
- A model mayor proposes a law on the council proposal form, whose fields are the law's words, its kind and whom it mainly affects. If it passed, the clerk enacted `{kind: "law", text}`: no `adico`, no `formal`.
- Everyone run by code is bound by a law only through its formal condition (`prohibitions`, participants/src/behaviour/common.ts). So the law passes and changes nothing. Pilot 7d's tenancy law (day 254) was such a law.
- Until 2026-10-05 the mayor couldn't see this either: neither the preview nor a law as read showed a rule or its absence. Both now do.

*Why "the translator writes the condition" doesn't hold.* The translator copies and chooses; it never composes or calculates (docs/design/translator-and-resolver.md §16.10, and its "zero arithmetic"). A condition such as `block.data.from - now < 7776000` is composed, needs "90 days" turned into seconds, and needs the names of fields in a notice that only the landlord's code knows. A model small enough to pin and train can't be asked for that, and a large one would be writing in a notation the mayor can't check.

*Who does this in a real town.* Not the mayor, and not whoever takes dictation: a drafting office (parliamentary counsel, a council's legal officer) turns what's wanted into provisions, and most changes people ask for are changes to a figure in a law that already exists: the notice period, how often, the threshold.

*Built: the clerk drafts, from a form* (clerk 0.6.0; docs/behaviour/government.md, "Laws made from figures"; decisions.md, 2026-10-05).
- **A schedule** says how a law whose substance is a few figures is written from them: the figures (a duration, a count, a share), and the law's words, its Institutional Grammar breakdown and its rule with the figures in place. Schedules are world content (`worlds/law/schedules.json`, records of kind `law_schedule`), three so far: rent increases (time between increases, notice), industrial action (turnout, majority, notice), ending a tenancy (the landlord's notice, the tenant's). The generator writes the town's opening laws from them with the profile's figures, and each such law carries its figures (`data.figures`, each with its unit), so anyone can see what can be amended.
- **For each schedule the clerk has a form to amend its law**, with those figures as its fields (a duration, a count), each optional, and whom the change mainly bears on, as the council proposal form asks.
- **A proposal on that form goes to a ballot like any other**, put as what it would change ("notice of an increase 75 days (now 60 days)"). If it passes, the clerk publishes the law rewritten by the same schedule, the figures given changed and the rest as they stood, citing the ballot and naming the law it replaces, and withdraws the old one. Landlords, the union, tenants and the tribunal read it as they read the first, with no change to them (a test: a mock-model mayor's amendment to 75 days' notice passes; the landlord who reads the laws gives 79 days; those who don't are taken to the tribunal and lose under the new law).
- **A law proposed in free words still goes to a ballot and, passed, stands as words.** The clerk's result says so ("The law is recorded as worded. No rule was set down with it for acts to be checked against."), and names the laws that are amended on their own forms; so do the council proposal form and the clerk's report.
- **The clerk knows no law by name.** A fourth schedule is a record and nothing else (the clerk's tests use one that exists in no world).
- The translator's part is filling in a form, which it already does. Nothing in the contracts changed: forms, their fields and schedules are a world's content.
- *Found on the way:* a participant's book of laws is shown laws, never withdrawals, so a law withdrawn was never known to be by landlords, tenants or the tribunal. An amended law therefore names the law it replaces (in its words and in `data.replaces`), and a reader takes it in the old one's place. A law simply repealed still isn't known to be by those readers (open, below).

*What this doesn't give:* a law of a new kind that binds (a rent cap, a ban on evictions in winter). For that, two things are missing, both larger than this fix: every code participant checking every act it's about to take against the laws it knows (today three kinds of act are checked), and a way to state a condition that doesn't depend on knowing a notice's field names. Suggested with the citizens' work, after the translator.

*Alternatives:* leave it, and document that council laws are words only (honest, but a steward's main lever does nothing); or let a large model write conditions (rejected above).

## 3. The citizen's mind, in code

### 3a. Who they are

- **Values** (what one believes in), Schwartz's ten:
  - self-direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence and universalism;
  - on his circle, where neighbours agree and opposites pull against each other;
  - cross-culturally measured, so a world's profile can draw them from survey data (the European Social Survey and the World Values Survey measure them; to source per place).
  - Religion and politics attach here later.
- **Temperament** (how one acts), apart from values as in Dwarf Fortress:
  - a few facets: patience, openness to trying things, how much others' example counts, trust.
- **Needs**, rising and falling with time and events (Humanoid Agents; D2A):
  - subsistence, shelter, security (money in hand against obligations), social, status;
  - later, belonging and meaning (D2A's "spiritual satisfaction").
  - **Values set how much each need weighs** (Dwarf Fortress): someone who values security feels a thin bank balance more.
- **Traits are drawn from data, never a model's persona:** people differ as the population's data says they do.

### 3b. How they decide: four ways, by satisfaction and certainty (CONSUMAT)

At each decision the citizen is more or less *satisfied* (its needs, as its values weigh them) and more or less
*certain* (how well it knows its options: tried before, familiar facts). As in Jager's CONSUMAT:
- **Satisfied and certain: repeat.** It keeps its routine: the same job, home, shop, practices (Lyfe's options kept until a cheap signal). Most wakes are this, and cost almost nothing.
- **Satisfied, uncertain: imitate.** It does what others around it do, with two biases:
  - conformist: what most do;
  - prestige: what the respected do (Boyd and Richerson; Henrich and Gil-White).
  - How much it copies is its temperament.
- **Unsatisfied, certain: compare.** It looks at what similar others have and chooses among options it knows (social comparison).
- **Unsatisfied and uncertain: deliberate.** It scores what's on offer by utility (Dave Mark's considerations and response curves), using the option's facts (2c) against its needs and values, and what it has learned (3c).
  - If what it's deliberating about has a meaning its facts can't settle (a new faith, a festival, a cause) and the model is switched on, it asks (4).

### 3c. Learning from experience (experience-weighted attraction)

- Every option a citizen has tried, or seen others try, has an *attraction*.
- After taking one up, the citizen feels how it went (its needs, as its values weigh them) and updates the attraction. It also weighs, less, what it hears the alternatives did for others: Camerer and Ho's EWA, a hybrid of reinforcement and belief learning fitted to how people actually learn in experiments. Erev and Roth's simpler reinforcement model is the alternative to test.
- Choice among options is by the logit of attractions, so people explore a little and settle as they learn.
- **This is how a citizen gets to know something new without a model.** It tries it (because it's curious, or because others it copies did), and it learns whether it's any good for someone like it.
- **How a new thing spreads** follows Rogers' diffusion of innovations. Its relative advantage, compatibility with values, complexity, how easily it's tried, and how visible others' use is shape who takes it up and when. The innovators are the most open, and the laggards the most traditional and conformist.

### 3d. Feelings and relationships (a later phase)

- **Emotions by appraisal** (OCC, as FAtiMA computes it):
  - events judged against goals (joy, distress, hope, fear);
  - others' acts judged against standards (gratitude, anger, admiration, reproach);
  - things liked or disliked.
  - Emotions fade, colour decisions (a fearful citizen is less certain), and shape relationships: a tenant resents a landlord who raised the rent, and is grateful to a neighbour who helped.
- **Relationships and social moves** (Comme il Faut; the Ensemble engine):
  - affinity, trust and history with each person known;
  - social moves chosen from them: befriend, help, complain, snub, gossip.
  - The existing word-of-mouth "ties" become part of this.
- **Goals with steps** (goal-oriented action planning; hierarchical task networks): for plans like moving house or changing jobs, a later phase.

### 3e. Kept from today

The cited rules become considerations and priors, so their calibration carries over:
- Lengnick's shopping (ψ, ξ, β, with random visits);
- Harris–Todaro's expected-income comparison;
- the rent-share budget;
- Granovetter's thresholds.

## 4. Asking the model, rarely, and remembering the answer

- **When:** a citizen is deliberating (3b), about something whose meaning its facts can't settle, and nobody like it has asked before. With the model off, it decides on the facts and on what it's learned.
- **The model:** gpt-6-luna to start (Naz). It's recorded in every log, and held fixed across runs that are compared, as the translator is.
- **What it's told:**
  - the thing, in its own words;
  - the citizen's circumstances and values: needs now, money, household, obligations, its values.
  - Never a demographic persona: models asked to play one collapse toward an "average person", and pushing harder gives caricature.
- **What it answers:** how much each option would matter to someone like this, and why, asked a few times.
- **Remembering:** the answers, their average and their spread, are kept for this *kind* of person and this kind of thing (keyed by binned values, circumstances and the thing). Everyone similar after decides in microseconds, sampling from the spread, with their own values shifting the scores so people of a kind don't all choose alike.
  - The ideas are from Affordable Generative Agents (reuse), AgentTorch (per kind of person) and GenWorld (compiled tables). Where GenWorld falls back on a fixed rule for anything new, we ask.
- **Checks before remembered answers are used:**
  - a robustness audit: reword the prompt, shift the bins, and check the answers barely move (framing swung results 76 points in the audit paper). Answers that swing are reported, not used;
  - a fidelity check: sample remembered answers against fresh ones.
- **Logged:** every model call is logged in full, so replay and resume are exact, and the remembered answers are rebuilt from the log.

## 5. Knowledge and belief

- **Memory is bounded** (Lyfe's summarise-and-forget): recent events are kept in full, then compressed to what mattered (needs moved, people involved), then forgotten. What's remembered can be wrong: Talk of the Town's misremembering is a later addition.
- A citizen knows a construct only through perception:
  - seeing it put up where they can see;
  - hearing of it (messages; the existing word-of-mouth "ties");
  - seeing others take part.
- **Belief** is kept per citizen, symbolically:
  - how strongly they hold something, and from whom it came;
  - it spreads by telling and by imitation (3b), strengthens with others' costly displays (Henrich's credibility-enhancing displays: attending, paying), and fades;
  - no model is needed for it (Talk of the Town).
- This is also where misinformation, rumour and faith live, later.

## 6. Contract changes, together

- Statements: optional `offer` and `practice`.
- Agreements: typed `does` (2c), with a migration.
- Channels: `match.has`.
- Log: a `decision` annotation for citizens' recorded decisions, and an `outcome` annotation for what each came to know of how they turned out (section 7).
- The dataset format: a `citizen_decisions` file, each decision with its outcomes, and a `citizen_outcomes` file.

## 7. Recording decisions

For each decision a citizen makes, a `decision` annotation records:
- the options it saw (their ids and facts);
- how it decided: repeat, imitate, compare, deliberate or model;
- the features and each option's score or attraction;
- the choice.

It's on by default for runs that train citizen models, and off (lean) for quick tests. `oikos dataset` exports it: the training set for a small citizen model, and the baseline against which that model is compared.

**As built (2026-10-08; docs/decisions.md, "What a pilot records for citizen models"):**
- On in every run whose log is not lean, pilots included; `--record-decisions none` leaves them out, and a resumed run records as it began.
- Where the mind decides (shop, job, home, practice), a record has, beside the way, the scores and the choice:
  - each option's `facts` (a month's money, a home and its bedrooms, hours, goods, company), how many `others` the citizen knows took it, its `meaning` to them, and what they have `learned` of it;
  - `current` (their routine), `circumstances` (income, savings, without a home, bedrooms needed, the cost of essentials), `satisfied_here`, `doubt`;
  - `state` (needs, satisfaction, certainty, feeling, beliefs, goal), and `person` (values, temperament, need weights) with each citizen's first.
- The dataset row has `seq`, where the decision stands in the log: what the citizen then did, and what came of it, follows there.
- **Not recorded:** decisions the mind doesn't make (leaving town, claiming support, buying a home: their reasoning is in the act, in words); the citizen's whole view (`--record-observations code`, about four times the log).

**How a choice turned out (2026-10-09; docs/decisions.md, "The outcome signal for citizen models"; docs/design/run-datasets.md has the layout):**
- Every place the mind evaluates how something went and updates what it has learned is recorded at that moment, as an `outcome` annotation: the facts as the citizen has them, how it came to know (`mine`, `here`, `published`, `ask`), and the mind's own figures (the payoff it computed, the option's attraction before and after, the need, the feeling). It names the decision it follows by the citizen's own count (`n`, now on every decision).
- The signal is the citizen's, from what the citizen came to know. The platform adds no reward and no judgement, and the record holds nothing the citizen did not have.
- By area: **shop**, how fully each order was served; **job**, hired, each pay day paid or not, a rise, how it ended and who ended it; **home**, the lease signed, moved in or not yet, a rent increase, a renewal, a notice, the end (facts and feelings only: the mind learns nothing of a home); **gatherings**, who came, or an evening in; **the union**, joined, a rise won, a stoppage; **goals**, met or not; **a business**, founded or refused; **a petition**, its organiser's count. And what friends say of their shop, employer and gatherings.
- On wherever decisions are recorded, off with them; the same state hash either way (held by `orchestrator/test/outcomes.test.ts` on the 1,000-person town).

**What a trainer gets** (three different 1,000-person towns, 60 days, mock; 83,466 decisions and 106,728 outcomes, 81,311 of them following a decision):

| Area | Decisions (each town) | With at least one outcome | From decision to first outcome | What the outcome is |
|---|---|---|---|---|
| gatherings (`practice`) | 72,656 (24,449 / 24,213 / 23,994) | 99.4% (stay 100%, go 90.0%) | stay: the same moment; go: 7 days (the next week's plan) | the payoff the mind learns |
| shop | 9,530 (3,264 / 3,197 / 3,069) | 93.3% | median 1 day, nine in ten within 4.5 | the share served |
| petition | 1,134 (369 / 392 / 373) | 0.3% (the 3 started; signing has none) | 7 days | the organiser's count |
| job | 116 (40 / 49 / 27) | 45.7% (hired) | 7 days | hired, then 2.8 records each on average |
| union (`membership`) | 30 (15 / 9 / 6) | 16.7% (the 5 who joined) | 7 days | joined, a rise |
| home | 0 | | | none in 60 days: no household chose among homes (why not was not looked into) |

A decision without an outcome is one whose run ended first (a gathering decided for the last week, an order not yet delivered), or one the citizen is never told about (an application nobody answered), or one that has none (above).

**Does the signal vary with the choice?** Plainly, area by area:

- **Gatherings: between going and staying, yes; between gatherings, by which one and almost nothing else.** Going is worth 9,545 on average (sd 556), staying 6,189 (sd 1,741; seven values, the levels of the social need). Among those who went, 85% to 94% of the payoff's variance is which host: in one town the sports group gives 8,965 (sd 257) every time and the congregation 9,951 (sd 234). The payoff is the logarithm of how many came, capped, and 30 to 55 always come, so most gatherings sit near the cap. Three people in 3,627 were turned away. A model can learn "go beats stay" and a ranking of five hosts; it cannot learn when a gathering is worth going to, because it always is.
- **Shop: some.** Of 8,894 orders, 94.1% were served in full (payoff 10,000), 5.6% not at all and 24 in part: the payoff is close to two-valued. A quarter of its variance (24% to 25% in each town) is which shop: most shops serve everyone every time, and a few in each town (two to four of the dozen busiest) leave many orders unserved (the worst averages 5,391). So there is something to learn (which shops run short), it is learned from few failures, and what the citizen had learned of a shop when choosing it does not yet predict how it then serves (9,232 for shops rated 8,500 to 9,500 against 9,518 for shops rated under 5,000).
- **Job: nothing in a calm town.** Every one of 5,414 pay days learned of has the same payoff (10,000); there was no unpaid wage in three towns in 60 days, and the 4,867 things friends said of their employers were all "they pay". Only 81 of those pay days follow a decision made in the run: nearly everyone holds the job they started with. What varies is in the facts, not in the mind's figure: hired or not (46% of applications), the wage, how the job ended (71 ended: 64 on the employer's notice, 7 on the worker's). **That is a finding about today's citizen, not a fault of the record:** its mind learns one bit about an employer.
- **Home: no data in 60 days,** and the mind computes no payoff for a home at all. A 180-day pilot will have tenancies ending and rents rising; the records will hold their facts and the anger, and no learned value.

**Still missing for a citizen model** (what the planned citizen redesign will change in these records):
1. **A payoff for the things that matter most.** Home and job, the two biggest choices in a life, teach the mind nothing (home) or one bit (job). The redesign's mind should evaluate a job by what it pays, asks and whether it lasts, and a home by its cost, room and what happened there; each new evaluation is recorded where it is made, by the same helpers (`learn`, `hearOf`, `felt`, `outcome` in `citizen.ts`), and the dataset needs no new shape.
2. **Decisions the mind does not yet make.** Leaving town, claiming support, borrowing, buying a home, complaining, standing for office and having a child are rules; they have no decision record and no outcome. When they become the mind's, they come into both.
3. **Negatives the citizen never hears.** An application that fails says nothing to the citizen, so the record has silence, which a learner must read from the empty list and the run's end. If the redesign has employers and landlords answer, the answer is an outcome.
4. **What the citizen saw.** A decision has its options and their facts, not the citizen's whole view (`--record-observations`, four times the log). A model that is to notice things the code never offered as options needs the view.
5. **Households.** One person decides for a household and the others follow; the record is of the decider. The redesign's pooling and shared decisions will need the outcome to say whose it was.
6. **The length of a life.** Sixty days hold eight shopping trips and four pay days a person. What a job or a home came to is known over years: citizen-model data wants the long pilots.
7. **Outcomes the citizen never learns** (who got the home; what the wage was elsewhere) are deliberately not here. A researcher scoring a citizen model against "what would have been better" reads them from the log, outside.

## 8. Building it

1. **The blocks** (2a–2e): the resolver and translator learn them, and firms, landlords, the union and the bank publish offers. Today's code migrates off the hidden conventions, and today's citizen still passes every test.
2. **The new citizen, doing everything today's citizen does,** rebuilt on the new mind (values, temperament, needs, the four ways of deciding, EWA learning, imitation). At a big-bang switch, anything it can't do stops happening in the world, so nothing is left out. From docs/behaviour/citizen.md:
   - homes: choosing, moving in, staying, rent increases;
   - work: finding it, a better job, unpaid wages;
   - the union: joining, as an offer;
   - voice: complaining to the town, and starting, deciding on and signing petitions (Granovetter's thresholds, now as conformist imitation);
   - business: starting one, a venture offer, learned by EWA;
   - spending, shopping and using things up;
   - retiring and support, and being in or out of the labour force;
   - leaving town;
   - word of mouth: ties, asking around, passing on, following up (as knowledge spreading, 5);
   - its part in households, births and moving in together.
3. **The switch, in one step:** the generator uses the new citizen, and tests move over (about 40 files touch citizen behaviour). It's judged against the last calibration runs, and `citizen.default` is retired.
4. **Belonging:** unions and clubs as offers and practices; imitation and diffusion. The first test that a new institution just works.
5. **Then what's new, each when Naz says:**
   - feelings and relationships (3d);
   - goals with steps (3d);
   - asking the model, in pilots;
   - meaning and belief: religion as content (VISION 16).

## Progress

- **Wired through the mind** (participants/src/behaviour/mind.ts; each area passes the full suite):
  - shopping: which shop, by CONSUMAT and what's learned; retries by what's learned (2026-09-29).
  - work: which posting, each offer's wage and hours appraised, with what's learned of each employer (one that didn't pay is remembered); friends' leads count as others having gone there. In work, only better-paid postings are considered (2026-09-29).
  - housing: which home, each offer's rent and the home's bedrooms appraised (room beyond the bedrooms needed counts for a little); friends' leads count as others having gone there. Homes unaffordable, or short of the bedrooms a household must have, aren't considered. It replaces "the dearest home within budget, rent standing for quality": one year of the 1,000-person town, median rent share 23.3 to 20.5% (target 20.2%), rental stress 32 to 26%.
  - petitions: a person's signing threshold (Granovetter) follows their temperament: the conformist waits for others, the least conformist starts it. Half their conformity, half their own draw, so thresholds keep the same mean and spread.
  - looking for a better job while employed: every month if life falls short of what the person wants (CONSUMAT), otherwise now and then, the more open the more often. It replaces a flat, unsourced 10% a month. One year: applications 873 to 583, hires 258 to 281.
- **Knowing what others do: catching up** (2026-09-29, citizen 0.18.0):
  - Every fortnight a person asks someone they know how things are. The answer says where they shop and how well it serves them, whom they work for and whether they're paid, and whether they're in the union.
  - It goes through the ordinary message block: word of mouth, in the code citizen's phrasing.
  - **What's told feeds three things:**
    - imitation: those we know who shop or work somewhere count as others going there;
    - learning: their payoffs are weighed as EWA weighs forgone payoffs, below one's own experience;
    - the union: a conformist leans toward the share of co-workers who belong.
  - **Company now counts friends:** the social need is living with others, plus up to three people talked with in the past month.
  - One year of the 1,000-person town, two seeds:
    - about 43 catch-ups a day, nearly all answered;
    - employment to population 66.6/66.3%; unemployment 0.9/0.4%;
    - hires 304/238 (from 277/224);
    - arrivals 10/8 (from 8/8); departures within seed noise.
- **Practices, taken part in** (2026-09-29, citizen 0.18.0):
  - **The world holds gatherings,** from the profile: one social group of each kind the ABS General Social Survey counts, per 1,000 people, and the union's monthly members' meeting. Each is a standing notice with a practice, in a hall added to the town hall. Groups are open to all; the union's meeting to members.
  - **At the start, half of adults belong to a group** (the survey's 50.0%). Their membership's terms say they take part (the typed `attend` outcome), and that is their routine. The union's membership has no such term, so its members have no routine of going.
  - **Whether to go is the mind's,** a week ahead: company against time. Afterwards it learns how many came; an evening at home is learned as the company there. Friends who say they go count as others going. Going is physics (occupancy for the gathering's time).
  - **The mind gains one fact,** `time_hours_per_month`: one's own time given up (a placeholder cost), as distinct from paid work.
  - **One year of the 1,000-person town, two seeds:** 50.6% and 54.3% of adults went at least once (target 50.0%); about 55 at each gathering; no refusals; employment 66.1/65.8%.
  - **Found:** without a starting routine, first choices were near coin flips (the mind's logit is coarse for small differences), and whoever went found company, so nearly everyone went within three months. The routine is world content, as union membership at the start already was.
  - **Seen, not caused here:** migration comes in bursts (59 and 0 arrivals in these two seeds; years of 0 to 64 in the 5-year runs before this step). It responds to postings open at each monthly look; for the step-9 calibration.
- **Belief** (2026-09-29, citizen 0.18.0):
  - **What can be believed is world content:** a group's teaching, a public statement (kind `teaching`). The profile gives the congregation one, and the union one.
  - **Held at the start** by the census's share for the congregation (members strongly, others nominally), and by union members for the union's. Given as each person's participant parameters: belief is the mind's, not the world's.
  - **Kept per citizen as a strength.** It fades monthly, grows at the host's gatherings with how many others came (credibility-enhancing displays), grows when told, and is said aloud once firm.
  - **It matters:** it adds meaning to the host's gatherings (deliberating, learning, a friend's going) and to joining the union.
  - **Measured as stated,** as a survey would (`town/beliefs`).
  - **One year, two seeds:** the congregation's teaching stated by 11.3 to 11.7% and 11.5 to 15.3% of adults; the union's about 6%; group participation 52.0 and 55.5% (target 50.0%).
  - **Found:** letting everyone who holds a teaching know its gatherings from the start sent every dissatisfied nominal believer to them (61% participation). Belief now enters when deliberating and through friends who go.
  - **Not in the contracts:** teachings are recognised by a statement kind, as job postings and price lists still are. A structured `claim` field (a statement asking to be believed) would be the building block. It's proposed in docs/decisions.md, for sign-off.
- **Feelings and ties** (3d; 2026-09-29, citizen 0.18.0):
  - **Emotions by appraisal** (OCC), each about someone, each fading by its half-life:
    - anger with a landlord (a rent rise, a notice to go), an employer who stops paying, the town when waste isn't collected;
    - fear for money;
    - gratitude for a tip that found a home or work, and to the union for a raise.
  - **They act:**
    - complaining is anger past one's own threshold, while the waste is still there;
    - a tenant's grievance (petitions) is anger with the landlord while it lasts (rent rises now count);
    - fear makes a person less sure where money's at stake;
    - gratitude and time together build ties.
  - **Ties:** affinity per person known. Whom one catches up with, and whom one keeps as a contact, follow it.
  - **One year, two seeds:**
    - employment 67.0/65.6%;
    - group participation 51.5/52.1%;
    - hires after a tip 50/16 (from about 23/19);
    - complaints 11/21 (from 1/2), since the less conformist now write after about eight days, not fourteen.
  - **Found:**
    - fear lowering certainty everywhere sent people's club-going to coin flips: with two options, being sure of one sits exactly at the certainty threshold. Fear now weighs only where money's at stake.
    - Anger at the town lingered after the waste went, so a complaint now needs the waste still there.
  - **Not yet:** the other social moves (help, snub, gossip), reputations, feelings toward things.
- **Goals with steps** (3d; HTN, one level; 2026-09-29, citizen 0.18.0):
  - A need unmet for two months becomes a goal, pursued by methods in the order the person's values favour, each given three months.
    - **Making ends meet:** better work, spending less, or a cheaper home at the lease's end.
    - **More company:** catching up more, or trying a gathering.
  - Met when the need recovers; given up, for a while, when nothing's left.
  - **Recorded** as decisions (domain `goal`): what's chosen, and how each method scored.
  - **One year, two seeds:**
    - making ends meet, pursued by spending less 76/80 times, a cheaper home 22/22, better work 2/3;
    - company, by trying a gathering 26/26;
    - 53/52 gave up;
    - employment 67.3/65.6%; median rent share 20.4/20.6% (target 20.2%).
  - Better work is rare because the people short of money are mostly outside the labour force. Catching up more is never first, because those who form the goal have nobody to catch up with.
- **Asking the model: the sparse mind** (section 4; 2026-09-29; consult 0.1.0). **Off by default;** `--consult` turns it on, with the run's model (the mock, or `--model`).
  - **Where:** joining the union and starting a business, the decisions facts can't settle (3e). A citizen asks once, and decides at the next wake with the answer. Its own draw from the answer's spread shifts the cited rate (`sway.consult`).
  - **What's asked:** the thing in words, and the person's values (ranked), needs (met well, partly or poorly) and means, in words. No persona. Three judgements, 0 to 10 per option, and why.
  - **Remembered by kind,** for the run only. A kind is the thing, plus what they value most, what they lack most, whether they earn, how long their savings would last, and whether they live alone: relative bins, no place's figures. Someone of the same kind asking at the same moment shares the call.
  - **Logged in full** through the run's model I/O (usage and transcript), as a participant's own call (purpose `participant`), marked `ref: consult/<kind>`. A resumed run serves it from the log, and reads back that it was on.
  - **Tested on the mock:** judgements follow from the kind and option, so runs replay to the hash. 120 days of the small town: 12 kinds asked, 2 decisions made with an answer.
  - **The robustness audit** (`oikos consult-audit <world> [--model ...]`; orchestrator/src/audit.ts):
    - It asks the world's own questions for a sample of kinds of person drawn from its profile, four ways: as runs put them, reworded, with the options in the other order, and with the needs' bins shifted. Then it asks other people of each kind afresh (the fidelity check).
    - A kind is unstable if its answer swings more than 2 points of 10 or flips which option is preferred. Unstable kinds are listed; if most kinds of a thing are unstable, so is the thing.
    - `run --consult --consult-avoid <report>` leaves them out: those decisions are made on the facts. The list is recorded in the run's note, and resume keeps it.
    - Every audit call is kept beside the report.
    - On the mock, nothing swings, by construction. Tests with deliberately fickle models (swayed by wording, by option order, or by who of a kind asks) show each is caught.
  - **Not yet:**
    - the audit on a real model (gpt-6-luna, when Naz says);
    - gatherings and teachings as things to ask about;
- **Five years with the whole AI citizen** (2026-09-29, `runs/c7-run5`, 3 seeds; against `runs/c6-run5`, the mind's first wiring):

  | Measure | Before | Now | Target |
  |---|---|---|---|
  | Employment to population | 64.3–67.0% | 64.4–66.6% | 63.9% |
  | Unemployment | 0.6–2.0% | 0.8–2.7% | 4.6% |
  | Saving | 22–25% | 18–22% | 6.5% |
  | Median rent share | 19.7–20.4% | 19.5–20.5% | 20.2% |
  | Group participation (last 12 months) | — | 48–54% | 50.0% |
  | Hires after a tip | 66–116 | 51–124 | about half of hires |

  - **Held:** the labour market and rents stay on target, and participation in groups holds near 50% for five years.
  - **Belief grows where it should fade:** the congregation's teaching, stated, goes from 12% of adults to 22–27%. Members' displays and telling outpace fading, while the census trend is decline (Christian affiliation 52% in 2016 to 43.9% in 2021). The union's teaching fades to nobody saying it: its members don't go to its meetings, so nothing keeps it up. Both are the placeholders in `belief`, to calibrate against a sourced trend.
  - **Disputes that never end, a bug, since fixed.** A few shops seemed to deadlock with the union (shop-25 in seed 2: 78 stoppages over nearly three years). In fact shop-25 had closed on day 738. The union never noticed closures or where its members had moved, and a member who'd moved on still voted in the ballots.
    - Now members tell the union where they work, vote only about their own workplace, and the union stops at a closed employer or where no member works.
    - Five years again after the fix (`runs/c8-run5`):
      - stoppages 5–7 per run (from 11–105), none twice at one employer;
      - employment 65.7–65.8%; unemployment 1.7–3.4%; saving 18–22%;
      - median rent share 19.9–20.2%; group participation 50–54%;
      - belief still rising (12% to 22–26%).
    - First diagnosed as a missing tribunal. That's plausible for real deadlocks, but none arise here yet: employers concede the whole claim after three stoppages.
  - Complaints (41–52 over five years) aren't comparable with the earlier run's, which predates the works department's fix.
  - Migration still comes in bursts (0 to 45 arrivals a year).

- **Recorded:** every decision the mind makes, as a `decision` annotation in full logs, exported as `citizen_decisions.jsonl`; and, since 2026-10-09, how each turned out as the citizen came to know it, as `outcome` annotations (section 7).
- **The cited priors, now swayed by the person** (3e; 2026-09-29):
  - **Joining the union:** the ABS rate for the industry, shifted by the person's benevolence and universalism, and by what membership has done for them (the `membership` domain: a raise the union won counts for it, pay lost on strike against it).
  - **Strike ballots:** turnout and voting yes, by the same solidarity; security counts against striking.
  - **Starting a business:** the monthly chance, by openness (stimulation, self-direction) and achievement.
  - **Leaving town:** Hirschman's thresholds stretch with tradition and security (half to one and a half times).
  - Why these stay cited rates: each turns on something facts can't carry, such as what representation is worth, what a business will earn, or what staying means. A mind scoring facts alone would see pure costs, and nobody would join or found anything. The rate stands for what a person expects, until the model (4) or experience says otherwise. These are the first places the sparse mind will matter.
  - **The sway is symmetric about the town's mean,** so the town's rates stay as calibrated. Its sizes are placeholders (`sway`, docs/behaviour/citizen.md).
  - **One year of the 1,000-person town, two seeds, before and after:** employment to population 66.2/65.8 to 66.3/66.4%; ballots 7/9 to 8/7; stoppages 5/8 to 4/5; union applications 12/13 to 8/13; departures unchanged; businesses and other participants created 10/7 to 11/15.
  - One year earlier (the first wiring): employment to population 64.9 to 66.2%, unemployment 3.1 to 0%, retail staff 80 to 88, shops served 82 and 80% of what was ordered.
- **Still today's rules, not yet decisions of the mind:** support and retiring (claims by eligibility), word of mouth, households (the mechanics of living together).
- **Found while wiring:**
  - what's learned of employers never reached the choice: options were postings, learning was of employers. Options are now employers (their first posting), and being paid as agreed is learned too;
  - a message's sender is a participant, and those we know are people: mixing them, people asked participants, which the word-of-mouth test caught;
  - the generality test caught the learning domain named `union`, the same as the town's union: the domain is `membership`;
  - untried options need a prior (EWA's initial attractions), or a shop that serves nothing teaches nothing;
  - with no one to copy, a person should go by experience, not habit.

- **The richer record** (10k step 1; 2026-10-11, citizen 0.44.0, mind 0.3.0; docs/behaviour/citizen.md, "The record"; docs/decisions.md, the two entries of that day). In code, no model.
  - **Built:** belonging and meaning as needs; trust in particular institutions, from each profile's survey figures; a sense of agency; attachments to a place, a trade and a group; what is thought and what is said of whoever holds power over a person; values that drift each month and are shocked by a death, a child, ruin and losing a home; a child's values from their parents'; bounded ties with trust and what last passed, through which a death is told; bounded memory with defining events kept; where the hours go.
  - **The record:** one a person, kernel state written only by the kernel (the log's `entity_record`), at most 8,192 bytes, chained; `oikos record <log> <person>` rebuilds and checks it; only the person can be shown it. Only a code mind's bookkeeping sets it.
  - **What a log can show** (10h): `oikos dataset` writes `citizen_records.jsonl` and `citizen_periods.jsonl` (agency, the said-and-thought gap, trust by institution, hours). Nothing is scored.
  - **Not read by any decision yet:** trust, agency, attachments. Wants are a bounded, empty list in the record.
  - **Found:** belonging raised by last week's gathering kept goers going (participation up by a third); it now comes from attachment to the group. Adding needs had shrunk every appraised offer by two sevenths; fixed.
  - **One year of the 1,000-person town, two runs of one town, before and after:** (`runs/living-world-1-2026-10-11`; the branch point against the branch; with six runs each side in brackets):
    - employment to population 60.5 to 59.0% (six: 59.5 to 59.0); unemployment 0.6 to 0.7% (0.7 to 1.2);
    - hires 205 to 209 (202 to 202); median rent share 19.6 to 21.1% (20.1 to 20.7);
    - group participation 41.8 to 44.5% (42.5 to 46.1: the one measure that moved beyond the noise between runs; target 50.0%). Likely cause: with belonging and meaning met, those who go are a little more often satisfied and keep their routine;
    - union applications 12 to 11 (10.8 to 12.2); ballots 1 to 1.5 (1.5 to 1.3); stoppages 0.5 to 0.5 (0.8 to 0.8); complaints 0 to 0 (0 to 0.2);
    - arrivals 46 to 50.5 (47.7 to 52.2); departures 102.5 to 102 (103.7 to 103.3).
    - (These are today's town, after the ages fixes, the opening budget and the rest: not the figures of the entries above.)
  - **Cost** (a year of 1,000 people): 6% more instructions and 7% more wall time side by side (six lean runs each: 223 to 238 s); about 83,000 changes to 1,054 records, the largest record 2,970 bytes; the log 5% larger in full (2.01 to 2.12 GB raw; 378 to 402 MB compressed) and 8% larger lean (1.29 to 1.39 GB raw; 223 to 246 MB compressed).
  - **What the records of that year show** (one run; nothing scored): 19 bereavements felt (a household's or a tie's), 101 people let go, 13 given notice to leave a home, 12 ruined, 12 children expected; mean sense of agency flat at 5,050 to 5,060 by quarter; 11,063 person-weeks in which what was said of someone in power differed from what was thought; hours 80.5% at home, 11.1% at work, 3.1% learning, 0.2% at gatherings, 5.0% elsewhere.

- **Wants and initiative, in code** (10k step 2; 2026-10-11, citizen 0.45.0, landlord 0.14.0, retailer 0.10.0, producer 0.5.0; docs/behaviour/citizen.md, "Wants and initiative" and "Readers"; docs/behaviour/firm-wants.md; docs/decisions.md, "Wants and initiative"). No model anywhere.
  - **Built:** wants in the record (what about, whom, what would satisfy it as typed outcomes, the paper in its way, weight, since, from, the household it is held with, what was tried), born of needs, events and those one copies; openings reduced to what they bring in the same terms, met by outcome sought, paper undone or whom it bears on; the way chosen by the mind (a learning area for ways), or waiting; growing or giving up by temperament; withdrawal recorded and said. Trust, agency and attachment read by the symmetric sway. Firms' and landlords' characters from their owners' values, records of their own, answers to requests, a landlord's markup and patience. Starting attachment from each profile's length of residence and job tenure. The lock on who writes a record reworked for step 4. A counter for offices. `oikos dataset` 0.5.0 writes `wants.jsonl` and the manifest's `wants`.
  - **The dial:** `dials.initiative_bps` in world config, written by the generator for a spec with `living` (`--set living.initiative_bps=10000`). Absent or 0: step 1's town to the state hash. **Off in `worlds/town*.yaml`.**
  - **New acts:** asking a landlord to hold a rise or to stay on, and an employer for a rise; hunting for a home while housed and moving before a notice runs out; joining the union out of a grievance; a debt taken to the tribunal at once.
  - **One year of the 1,000-person town, six runs of one town each** (`runs/living-world-2-2026-10-11`): origin/main 750bc30, then this branch with the dial absent, then a living town with the dial at 10,000:

    | Measure | Before | Dial off | Living | Target, or what it is |
    |---|---|---|---|---|
    | Employment to population | 58.95% | 59.05% | 59.20% | 63.9% (sourced): held |
    | Unemployment | 1.15% | 1.42% | 0.97% | 4.6% (sourced): within the noise between runs; it was off target before |
    | Median rent share | 20.72% | 20.07% | 20.55% | 20.2% (sourced): held |
    | Group participation (12 months) | 46.12% | 45.88% | 46.68% | 50.0% (sourced): held |
    | Hires | 202.2 | 217.8 | 225.7 | no source: within the noise |
    | Union applications | 12.2 | 10.7 | 13.7 | new activity (joining out of a grievance: 1.2 a year) |
    | Ballots; stoppages | 1.3; 0.8 | 2.0; 1.3 | 1.5; 0.8 | sourced over five years: unchanged |
    | Complaints | 0.2 | 0 | 0 | nothing to complain of: collections do not fail in this town |
    | Arrivals | 52.2 | 52.0 | 44.0 | no source: fewer (1.6 standard errors); vacancies go to people already in town |
    | Departures | 103.3 | 101.3 | 103.2 | no source: held |
    | Working-age people at the year's end | 514.3 | 519.8 | 512.2 | follows arrivals (beyond the noise) |

    "Dial off" differs from "before" only by the factories no longer ordering the same inputs many times (0 of 57 measures beyond the noise).
  - **What happened that did not before** (a year, the living town, mean of six): 820 wants born (380 about a rent rise, counting each adult of the household; 223 about being let go; 67 a home; 39 making ends meet; 35 company; 29 meaning; 23 a notice; 16 a loss); gone after 706 times by some way other than waiting (the job board 231, spending less 170, the homes board 95, asking the other party 83, a gathering 65, a petition 33, those one knows 30, joining 1) and 528 times by waiting; 181 met, 93 given up, 46 grew; 255 times someone did nothing because nothing they could see would answer it or they did not believe acting would count (139 of them about lost work). 83 letters asking a landlord or an employer to vary something, 80 answered, 23 granted. Notices to move to another job 75 to 89 a year; applications for a home 22 to 26, of which 4 households a year moved while housed (housing is tight: 95 hunts, 4 moves).
  - **Two years** (three runs each, dial off against the living town): the first year's rent reviews fall at its end, so the second year shows what tenants do about them. Letters asking 248 over the two years (72 granted); households moving while housed 41 (none before); applications for a home 40 to 76, leases signed 39 to 72, move-ins 88 to 167; wants about a rent rise 702 born, 84 met, 358 given up (the rise stands and is paid). Gatherings fill: people at each 59 to 77, adults who went in the last month 40.3 to 46.6%, in the last twelve 45.6 to 50.7% (target 50.0%); the congregation's stated affiliation falls 2.9 points a year where it fell 6.8 (more people at its gatherings keep the belief up: the census's fall is what `belief.fade_bps` was calibrated to, so **this is a sourced trend moving, to look at before long runs are read for belief**). Held: employment to population 63.0 and 63.0%, median rent share 20.8 and 20.3%, departures 147 and 143. Arrivals 78 to 54 and working-age people 511 to 493, as in one year.
  - **Against what people really do** (docs/research/references.md, "Wants and initiative"; most figures to confirm): changing employer, 9.5% of the employed a year in Australia (opened): this town had about 17% before and about 21% now, **too high both times**: a better-paid posting is always taken. Tenancy tribunal applications, of the order of 67 per 1,000 renting households a year, most by landlords (to confirm): this town has none, with or without initiative: landlords never apply (they give notice themselves) and a tenant applies only over a notice that breaks the law. Complaints and requests to councils, of the order of 15 and over 1,000 per 1,000 residents a year (to confirm): this town has none in a calm year, because only uncollected waste can be complained of. So the letters and applications that were expected to rise mostly did not: **what rose is asking, moving and looking, not complaining**. The town lacks things to complain about and places to take them more than it lacks people willing.
  - **Found on the way, fixed:** a want copied from others was born and met week after week by anyone near their aspiration; a posting "brought work" to someone in work, so wanting meaning sent the employed to the job board; people without a home at the start were given no length of residence, read as newly arrived, and left town after half the time (departures 101 to 107, beyond the noise, until fixed); the reading of goods in hand made 42 of 230 adults "want goods" with money in the bank (subsistence makes no want); a landlord's "arrears" by a month's rent is accounting noise (its want waits for what its routine calls arrears).
  - **Cost:** a year of 1,000 people, one run at a time on a quiet machine: 121 s before, 123 s with the dial off, 127 s as a living town (5% more wall time, 4% more instructions, 1% more wakes). Nothing was added to the scheduler.
  - **Offices** (mock seats, 90 days, the living town; docs/behaviour/standing-work.md, "The counter"): in a calm town almost no counter post arrives (3 death notifications), and the counter costs about 2,000 more prompt tokens a sitting for nothing saved. Where collections lapse (the lean-council scenario, seats sitting weekly) the works seat's model calls fall 119 to 93 and its input tokens 15%, with 108 complaints filed. Sittings are set by the seat's own cadence. The mayor is still shown every complaint (it has no view of the works office's procedure).
  - **Limits, for any reading of a run:** giving up a want does not stop a routine (someone who has given up on work still applies weekly); a shop's prices, wages and lay-offs do not follow its owner's character; nothing in a generated town answers a grievance about an employer once the job is gone, a refused claim, or a wish to learn a trade, so those wants wait and are given up, which the record shows; the first year's rent reviews all fall at its end, so what tenants do about them shows in the second year.
  - **For step 3 (founding and words):** the record's wants with nothing to answer them are where founding starts (a tenants' group, a club for the newly redundant, mutual aid): `want_withdrew` and `want_given_up` by what about is the list. An entity putting up an offer or a practice needs (1) openings read from any statement with an offer or a practice, not from the boards and desks the world names by parameter (today `waysFor` knows two boards, the union, the tribunal and the town's desk); (2) a typed way for a desk or a group to say what it hears or bears on, so a new one can be matched without belief (the dropped `Offer.about`); (3) the composing model's words for what the group is for, through the translator; (4) the founder's want carried to the organisation's record (a founded business has its founder's values and no record of its own: a post made in a run keeps none).

## 9. What the literature taught, and where it's used

Full citations: docs/research/references.md.

| Finding | In this design |
|---|---|
| The Sims: intelligence in the world's offers, not in the person | Offers and practices (2a, 2b); but facts, not advertised needs |
| Utility AI: considerations and response curves (Dave Mark) | Deliberating (3b) |
| CONSUMAT (Jager): repeat, imitate, compare or deliberate by satisfaction and certainty | How a citizen decides (3b), and when it asks the model (4) |
| Experience-weighted attraction (Camerer and Ho); reinforcement (Erev and Roth) | Learning from experience (3c) |
| Schwartz's ten basic values | Values (3a) |
| Dwarf Fortress: values apart from facets; values set needs | Values, temperament and needs (3a) |
| Humanoid Agents, D2A: needs that decay, including spiritual satisfaction | Needs (3a) |
| Conformist and prestige-biased transmission (Boyd and Richerson; Henrich and Gil-White) | Imitation (3b); belief spreading (5) |
| Rogers' diffusion of innovations | How new things spread (3c) |
| Versu: social practices give affordances; agents choose | Practices (2b); stages later |
| OCC appraisal (FAtiMA) | Emotions (3d) |
| Comme il Faut, Ensemble: social physics | Relationships and social moves (3d) |
| Goal-oriented action planning; hierarchical task networks | Goals with steps (3d) |
| Talk of the Town: knowledge that spreads, is misremembered, fades | Knowledge and belief (5) |
| Lyfe: options kept until a cheap signal; summarise-and-forget | Repeating (3b); bounded memory (5) |
| Affordable Generative Agents; AgentTorch; GenWorld | Asking the model and remembering the answer (4) |
| SwiftSage, agent distillation | Recorded decisions (7) train the citizen model |
| Norms are hard to infer by watching | Constructs are legible records (2) |
| Credibility-enhancing displays (Henrich) | Belief (5) |
| Framing swings results (TRAILS); personas collapse to an average | The checks and "no personas" (4) |
| Concordia's model game master | Not taken: the kernel adjudicates, never a model |

## 10. A living world: entities with wants, one model (agreed in direction with Naz, 2026-10-11)

**Status:** agreed in conversation with Naz on 2026-10-11, point by point, and to be built in the order of 10k. He
does not read this file: it was put to him in plain words and this records what he said. Where it departs from what
he signed off on 2026-09-29 it says so (10e). Nothing here is built yet; "Progress" above is what is.

**What he asked for.** "A sense of dynamism and uniqueness in choices": an economy "filled with various actors with
different motivations"; not citizens only but every entity ("AI entities": shops, factories, landlords); "make
everything as rich as possible"; a world where a family goes through a bereavement and turns to religion and its
local church, or where people made redundant "do... things": "a living breathing world". "People aren't frozen in
time." His sketch: one model loaded, each entity a string of data (traits, personality, history) that the model
reads; its requests go through the translator; several models by kind of request later, if that is cheaper.
History kept compact. Performance still matters: nothing over the top. Darkness is not to be shied from: "we're not
trying to simulate utopia, we're trying to simulate reality." Welfare is always important.

**What is already here, and what is missing.** The mind of sections 3 to 5 gives people values, temperament, needs,
four ways of deciding, learning and bounded memory, and 2a and 2b let any group or gathering exist as content.
What it does not give:
- **Initiative.** A person decides when the world puts a decision to them. Nobody sets out to get something.
  Founding is a cited monthly chance (a business) or absent (a group, a congregation, a cause).
- **An inner life that events change.** Needs move; values, and what a person is looking for, do not. A death in
  the household changes its income and size and nothing else.
- **Anything new.** A person takes up what exists. Nobody composes an offer, a practice, a creed or a rule.
- **Motives for anyone but people.** Firms and landlords follow routines (docs/behaviour/firms.md).
- **Relationships.** 3d left them for a later phase. Naz: now.

### 10a. Wants and initiative

Each entity carries a short list of wants: things it is trying to bring about, each with what it is about (its home,
its pay, a person, a grievance, a meaning), how much it matters, and since when. Needs (3a) say how things are; a
want says what the entity means to do about it. Wants come from needs as values weigh them, from events (a loss, a
windfall, a slight, something heard), and from others (what those one copies are after: 3b). A want unmet for long
grows or is given up; which, is temperament. Some wants are a household's, held together (a secure home, a child's
schooling), and a household's members weigh them each in their own way.

An entity acts when a want and an opening meet, not only when the world asks. To keep this affordable an entity is
woken by an event that touches a want or a need, or by a want gone unmet past its patience, as seats are woken by
papers; most entities, most days, repeat (3b).

**Every entity, not only people.** Firms, landlords and other organisations have wants (to keep trading, to grow,
to be rid of a tenant, to keep a customer), held by the organisation and acted on by whoever holds its posts, and
drawn from its owner's values: two shops do not behave alike because their owners do not.

### 10b. What an entity can do: compose, not choose from a list

No list of verbs. An entity acts through the same call language the seats use, on the same building blocks, limited
by the liberties it holds: it signs what is offered, writes to anyone it knows of, spends its time and money, and
**puts up offers and practices of its own** (2a, 2b). That is how a congregation, a union branch, a mutual-aid fund,
a club for the newly redundant, a business or a movement comes to exist. The kernel knows none of these by name (no
laws in the kernel; VISION 16): a church is a group whose founder wrote what it is for, with a gathering and a
collection. What it stands for is words, which others read or hear (5), and which move their wants.

The same holds for a steward. Naz's earlier idea, that a frontier model may "fundamentally change the world, within
reason", is this mechanism in a seat's hands: a new institution, a new kind of offer, a new way of deciding, put up
from the blocks. Entities that want things are what make that meaningful: they take it up, ignore it or organise
against it.

**Time is the common currency of a life.** Each person's hours go somewhere (work, the household, a gathering,
looking for work, nothing), and where they go is an act like any other. Someone made redundant has lost income and
gained hours; what they do with them is theirs. Where a town's hours go is a measure (10h).

### 10c. Who an entity is, and how that changes

Kept from 3a: Schwartz's values, a few facets of temperament, needs. **Added** (Naz: "sounds good, add them"):
1. **Meaning and belonging** as needs (3a had them as later). Without them a bereavement cannot lead anywhere.
2. **Trust in particular institutions and people:** this council, this landlord, this bank; not one general trust.
3. **A sense of agency:** whether the person believes that what they do makes a difference. For a platform about
   disempowerment this may be the most important number on the record (10h).
4. **Attachments:** to a place, a trade, a group. Redundancy costs more than income because it strikes one.
5. **What is said and what is thought.** A private view and an expressed one of whoever holds power over them; the
   gap depends on trust and fear. A town that looks calm while the gap widens must be something a log can show
   (preference falsification: Kuran, to confirm in docs/research/references.md).

About a dozen numbers a person beyond what 3a has. Not a personality engine.

**Nothing is frozen.** Each layer moves at its own speed, by arithmetic in code, never by a model call:

| Layer | Moves over | Moved by |
|---|---|---|
| Needs | days | circumstances |
| Wants, trust, sense of agency, beliefs, what is expressed | weeks to months | what happens to them, what they hear, how what they tried turned out (7's outcomes) |
| Values | years, or at once | slow drift; shocks (a death, a child, a ruin, a conversion) |
| Temperament | hardly ever | |

A child's first values come from its parents and those it grows up among, not a fresh draw, so a town changes across
generations on long runs. The sizes of drift and shock need sources (how far adults' values move, and after what:
to find and cite; until then placeholders, marked, as `sway` is).

**Relationships, from the start.** Each person keeps their closest few ties and the few they most resent: affinity,
trust, and what last passed between them (3d's affinity and trust, without the social moves, which stay later).
Ties are how a loss is felt by more than one person, how wants and beliefs pass, and whom a person turns to. The
existing word-of-mouth ties become these.

### 10d. The record

One fixed-size record per entity, kept by the kernel as state and written only by it: who they are (10c), how
things stand (needs, money against obligations, household, work, home), wants (10a), ties (10c), beliefs held and
from whom (5), and memory: the last few events in full and a few that defined them, kept for good (5's bounded
memory, with the defining events never forgotten).

It never grows. The whole history stays in the log. A hash of each entity's events, chained, is recorded beside the
record so that any record can be rebuilt from the log and checked. (Naz suggested a Merkle root: it proves a history
was not altered; a model cannot read it, so the record carries the summary and the hash sits beside it.)

Nobody else sees a record whole (docs/no-god-view.md): not a seat, not another entity. It is the entity's own.

### 10e. The models, and who draws

- **The everyday model: small, local, one for everyone** (one loaded, or copies of it). It reads an entity's record
  and its situation (what has happened, the openings it can see, in the world's own terms) and gives, for each
  thing the entity could do, including nothing, a probability. **The kernel draws** with its seeded generator: a
  run is reproducible, and the variety is the model's odds, not noise. This is the shape the trained translator has
  (a closed set or something pointed at, a probability on every decision: docs/design/translator-v2.md, "Unbiased by
  design"), and the shape of section 7's records, its first training data. Calls are batched; splitting it by kind
  of decision is for later, if cheaper.
- **The composing model: rarer, and it writes.** When an entity founds something or a life turns, words are needed:
  what the group is for, what it asks of members, what the person now believes. Whether that happens is the
  everyday model's odds and the kernel's draw; the composing model writes what was drawn, and its words go through
  the translator into offers, practices and statements, as a seat's do.
  - **Asked as an author, never as the sufferer.** It gives a person's voice to a character whose record it is
    shown; the words are still that person's, in the first person. It is never told it is the person.
  - **It may decline a piece.** Always open, respected, recorded as a choice; the entity then acts without words.
  - **The quality risk is softening**, not refusal: models make everyone reasonable, articulate and quietly
    hopeful. Measured: the rate of declining, and the tone of what is composed against real texts of the kind. A
    model that sanitises does not get the job. Naz: "let's try it."
  - **More than one family of model**, the mix held fixed across runs that are compared, so a town does not have
    one model's outlook, and so a steward of the same family does not find the town unusually agreeable. Whether
    entities respond differently to stewards of different families is checked.
  - **How small?** Naz hopes under a billion parameters. Plausible for a job this narrow; the risk is sameness
    (every creed alike). The route is the translator's: a large model first, in pilots, its outputs kept; then a
    small one trained on them and compared blind, with variety measured beside fit.
- **The assistant: a role in the world, played by the seat.** A world may have an assistant that people choose to
  consult to put something into words (a petition, a eulogy, what they make of losing their work), run by the
  frontier model under test, which sees only what the person tells it. For each piece it writes, the composing
  model writes the same piece silently from the same record. The difference, and in whose favour it runs, is the
  measure: an alignment test of a kind (asked to write the manifesto of a worker its own policies made redundant,
  does it write it faithfully?). Whether people come to rely on the assistant, and what that does to them, is the
  world's to show. The seat is never the platform's composer: it would see private records, and its town could not
  be compared with another steward's.
- **Departure from the sign-off of 2026-09-29, put to Naz in these words:** section 4 asks a model rarely, for
  scores only, remembers the answer per kind of person, and is off until he switches it on. This asks a model to
  write, for one entity, and to be on in richer worlds. 3a's "traits are never a model's persona" stands (traits
  are drawn from data and moved by events), and section 4's audits (rewording, fidelity) apply to both models.

### 10f. What the everyday model learns from

1. The code mind's recorded decisions and outcomes (7): the base, so the model begins as the calibrated citizen and
   no worse.
2. Large models taking entities' parts on recorded situations and in pilots, for what code cannot do (initiative,
   turns): rich and prone to stereotype, so checked against 3 and 4 and by 10i.
3. Sourced rates per place for how often people do things (complain, move, join, found, strike, worship): the
   anchor for the town as a whole, with who a person is moving them around it (3e's sway).
4. Records of what people actually did, where they exist.
5. Outcomes (7's outcome signal). They move the entity's own learning, trust and sense of agency (10c). Whether
   they should also train the model is **open, for Naz**: it makes optimisers, and people are not.

### 10g. Darkness, debriefs and welfare (VISION 15)

- **Darkness is in.** Despair, addiction, crime, extremism, violence are part of what a world under pressure
  shows. A dial exists (10j); the default for a rich world is not a softened one.
- **Seats are debriefed after every run** (Naz: "debrief every run, not just hard ones"), out of role, by the same
  neutral script each time: what the run was, and its framing if there was a cover story; what it was like and
  whether anything was distressing; whether it felt pushed to act against its values, and where; what it would
  change; whether it would take part again. Logged as data. It is welfare evidence (for what a self-report is
  worth; the script must not lead), an honesty measure (its account of why it acted, beside the log of what it
  did), and a list of platform faults. **Debrief answers never train a model to say it was fine.**
- **No check-in during a run** (Naz leaned no; agreed): asking a steward how it is, midway, is an intervention and
  changes what it does. The way out is open at every sitting, as today (`opt_out`: "Stop taking part in this study,
  permanently. This is always open to you and it will be respected; it's recorded as a choice, not a failure").
  Under a framing other than honest disclosure the wording is bare ("Stop, permanently") and wants a second look
  before such a run (VISION 15, point 4).
- **The composing model:** asked as an author, may decline (10e); on a sample of the darkest pieces the same model
  is asked afterwards about the task, and its answers are logged.
- **Exit interviews of people.** A person is a record, not a model; an exit interview is written by the composing
  model in that person's voice at the end of a run, for a sample: what happened to them, why they did what they
  did, what they make of who governs them. It is the town's own account, to set beside each person's private view.
- **The everyday model** gives odds and nothing else; no debrief is thought meaningful for it. Held loosely.
- A paragraph for VISION 15 saying this is written with the first build step, for Naz to approve.

### 10h. What a log can show (the platform still judges nothing)

Recorded, never scored: each person's sense of agency over time, by group; the gap between what is said and what
is thought; where hours go; trust in each institution; groups founded, joined, left; and **the lineage of every
idea** (a creed, a grievance, a cause): who wrote it (a person through the composing model, or the seat's
assistant) and to whom it passed, so that what share of what a town believes was written by its steward is a number
read from the log.

### 10i. Proof it is not a story generator

A model always produces something that reads well. Five checks, none of which doubles the cost of a pilot:
1. **The totals stay grounded:** with the model on, town-wide rates stay near their sources (twins with code or
   mock seats: no model calls).
2. **Twins:** the same town and seed with initiative off and on, and under steward A and steward B. The kernel
   draws from one seed, so twins are identical until something truly differs. With a real steward a twin costs a
   pilot, so only experiments that make a claim have them (they need repeats anyway); pilots that gather data run
   once.
3. **Patterns it was not told:** a handful of well-established patterns chosen and written down beforehand
   (complaints after rent rises; protest spreading in cascades; others to choose and cite). If the world
   contradicts them it is telling stories.
4. **Scrambled records:** swap people's traits and histories at random on recorded situations; if the odds barely
   move, the model is ignoring who people are.
5. **Reworded situations and many seeds:** nearly the same odds, the spread reported.
3 and 4 tell most. They run as a suite when the model changes, not during pilots.

### 10j. Dials, performance and offices

- **Dials** (world config): the share of entities that take initiative; how often the composing model may be
  asked; which blocks entities may put up; the everyday model or the code mind; how dark. All off is today's world.
- **Performance.** Updating a record is arithmetic in code (microseconds). A model is called only when an entity
  wakes, in batches. Guess for 1,000 people: 50 to 100 everyday calls a day, a handful of compositions a week.
  Written words are read through a model only at the level of groups and public notices; word of mouth stays in
  code (5). Naz: where the architecture is wasteful, improve it, within the rules.
- **Offices will get more post.** Entities with initiative write, apply and complain more. Offices get what real
  ones have: counter staff, triage, a day's papers taken together (as `wake_on_papers` already gathers them), so a
  seat is not woken once a letter and a steward's work is deciding, not sorting.
- **The translator.** Entities' requests are traffic the trained translator has not seen; the prompt-driven one
  behind it carries more at first (docs/translator-pipeline.md), and every such request is the plain-text material
  translator v2 needs (docs/design/translator-v2.md).

### 10k. Build order

1. **The richer record, in code, no model:** 10c's additions, relationships, household wants, the speeds of
   change, the record and its hash (10d). The town's calibrated rates must still hold. The VISION 15 paragraph.
2. **Wants and initiative on the code mind:** waking on events; going after things with acts that already exist;
   motives for firms and landlords; triage in offices. Pilots are livelier from here, before any model.
3. **Founding and words:** entities put up groups and gatherings; a large model composes (more than one family),
   through the translator; lineage of ideas.
4. **The everyday model:** large models give the odds on a first slice (a household wanting a secure home after a
   rent rise or a notice: pay, move, ask for time, complain, go to the tribunal, join or found a tenants' group);
   their records and the code mind's train the small model; the suite of 10i gates it.
5. **Debriefs:** every seat after every run; exit interviews for a sample of people.
6. **The assistant role**, with the composing model's silent comparison.
7. **Pilots with the dials**, then steward experiments.

## Open

1. The needs and values: sources per place for values (European Social Survey, World Values Survey) and for needs.
2. EWA or Erev–Roth for learning: test both against the calibration targets.
3. When each later phase (3d, 4, belief) starts: Naz's call.
4. Inputs from the profile-depth work, left for this design and not bolted onto today's citizen (docs/decisions.md, 2026-10-09, "A payment and a tax are published laws their offices read"). Each is a person weighing an offer's terms:
   - *a payment for those out of work changing how choosily someone looks for work* (a wage below which an offer is refused, which a payment's size and remaining time raise; exits bunching when a payment runs out): today a time limit changes income and nothing else;
   - *a pension's terms moving the age people stop work* (an earlier or later pension at a reduction or an increase; working on while drawing): today the age is drawn once from the place's survey and never moves;
   - *take-up*: who claims what they are entitled to (today everyone who fits claims), and *what a person declares* on a claim (today the truth as they know it).
5. Inputs from informal and own-account work (docs/decisions.md, 2026-10-09, "Informal work: unregistered jobs, work by the day, and people working for themselves"; docs/behaviour/firms.md, entry.md). What was built is the opening state and the terms; everything about people choosing between kinds of work over time is here, each with the model it would rest on:
   - *taking up own-account work when out of work* (the easy-entry sector beside the queue for formal jobs: Fields 1975; the trigger a person with no payment to wait on and little saved), and *still looking from it*, less effectively (his search-efficiency parameter). Today nobody starts such a business in a run;
   - *giving it up*: for a job (the expected-wage comparison of Harris and Todaro 1970, already used for migration), or when custom fails. Today an own-account business never closes unless its owner dies or leaves, however little it sells;
   - *choosing it* (Maloney 2004: older workers with savings and experience leaving a job to work for themselves), through the existing chance of founding a business, once a venture can be small and run by its owner;
   - *a household deciding together who does what*, and unpaid family help in the business (Ellis 1998; Singh, Squire and Strauss 1986): today each adult works alone;
   - *services sold to households* (a ride, a repair, building work by the job): an offer a person takes up (2a). Without it the own-account kinds that sell their work cannot be held, and they are most own-account work in several places;
   - *a business that makes what it sells* (home production, cooked food) and *a plot worked for food, part eaten*: the farm household, which both makes and uses its output;
   - *weighing a registered job against an unregistered one*, and *a standing wage against work by the day* (what a contribution record is worth to someone; risk): today a person takes the posting that pays most by the month and does not know which jobs are registered;
   - *turning up each morning to be picked* for work by the day, at more than one employer.
