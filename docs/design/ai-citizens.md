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

```jsonc
"offer": {
  "by": "shop-3",                    // who offers (defaults to the statement's speaks_for)
  "to": { "anyone": true },          // or { "members_of": "union" }, { "entities": [...] }, { "min_age": 18 }
  "take_up": "order",                // how: sign (an agreement), apply (a form), order, join, attend
  "terms": {                         // what the taker would enter into: an agreement's terms, in the typed vocabulary (2c)
    "commitments": [
      { "who": "taker", "does": { "pay": { "amount": "130.00", "to": "acc-shop-3" } }, "per": "unit" },
      { "who": "shop-3", "does": { "deliver": { "kind": "goods", "quantity": "per_unit" } } }
    ]
  },
  "quantity": { "available": 400 }, // how many can take it (a posting: 1; a home: 1; a shop: its stock)
  "until": "day 120"                 // standing until withdrawn, or until then
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

```jsonc
"practice": {
  "at": "hall/space.1",               // where (a space)
  "every": "7 days", "first": "day 3", "lasts": "2 hours",
  "roles": [                          // who may take part, as what
    { "role": "leader",   "who": { "holds": "priest" } },
    { "role": "attendee", "who": { "members_of": "st-marks" }, "open": true }
  ],
  "during": [                         // what's expected, in the typed vocabulary (2c): facts, not effects
    { "role": "attendee", "does": { "pay": { "amount": "5.00", "to": "acc-st-marks" } }, "optional": true }
  ]
}
```

Taking part is ordinary physics: being in the space at the time, and doing what one chooses to do there.

Version one is thinner than Versu's practices. Those have stages and expectations, and people weigh how others will see what they do. The schema leaves room for `stages` and `expected` (per role, per stage) later, for rituals and ceremonies with a shape.

### 2c. A typed vocabulary for what people commit to

Today an agreement's `does` is free-form data, a hidden convention (VISION 15). The proposal is a small typed vocabulary, used by agreements, offers and practices:
- `pay` (an amount, to, every);
- `deliver` (goods, a quantity);
- `work` (a task, at, hours);
- `allow` (occupy a space, use a thing);
- `attend` (a practice);
- `represent` / `text` (anything else, in words).

It's validated by the schema, rendered in words for models and humans, and readable by code. Today's `does` shapes migrate to it.

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
2. **The new citizen, first scope:**
   - values, temperament and needs;
   - the four ways of deciding;
   - EWA learning;
   - work, housing, shopping, support and retirement, and leaving.
3. **The switch, in one step:** the generator uses the new citizen, and tests move over (about 40 files touch citizen behaviour). It's judged against the last calibration runs, and `citizen.default` is retired.
4. **Belonging:** unions and clubs as offers and practices; imitation and diffusion. The first test that a new institution just works.
5. **Feelings and relationships** (3d).
6. **Asking the model:** on Naz's go-ahead, in pilots.
7. **Meaning and belief:** religion as content (VISION 16).

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
