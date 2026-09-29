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
- Log: a `decision` annotation for citizens' recorded decisions (section 7).
- The dataset format: a `citizen_decisions` file.

## 7. Recording decisions

For each decision a citizen makes, a `decision` annotation records:
- the options it saw (their ids and facts);
- how it decided: repeat, imitate, compare, deliberate or model;
- the features and each option's score or attraction;
- the choice.

It's on by default for runs that train citizen models, and off (lean) for quick tests. `terrarium dataset` exports it: the training set for a small citizen model, and the baseline against which that model is compared.

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
- **Recorded:** every decision the mind makes, as a `decision` annotation in full logs, exported as `citizen_decisions.jsonl` (section 7).
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

## Open

1. The needs and values: sources per place for values (European Social Survey, World Values Survey) and for needs.
2. EWA or Erev–Roth for learning: test both against the calibration targets.
3. When each later phase (3d, 4, belief) starts: Naz's call.
