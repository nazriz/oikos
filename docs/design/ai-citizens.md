# AI citizens (design, for review)

**Status:** signed off by Naz, 2026-09-29 ("agreed on facts only, signed off"). Cutover: the building blocks first, with
today's citizen still passing; then the new citizen replaces it in one step. The research behind it is in
docs/research/citizen-minds-2026-09.md; section 9 maps each finding to where it's used.

**Goal:** citizens that replace today's rule-based ones. They should:
- be simple and fast (microseconds a decision, towns to cities);
- use anything the world offers without new citizen code, including what a model steward invents (VISION 15–17);
- come to understand new constructs, learning in context;
- produce the data to train citizen models later.

Today's citizen (`citizen.default`) is retired once the new one matches it on the same towns and targets (section 8).

## 1. The layers

1. **The body** (every wake, microseconds, no model): needs, traits and a little memory. It chooses by utility among the options the world offers (section 3). The body alone is the all-code control.
2. **Compiled policies** (microseconds): for decisions where the body's own scoring is weak, a table of a teacher model's scores for this kind of person in this kind of situation, sampled from (GenWorld).
3. **The sparse mind** (rarely; **off until Naz switches it on**): when a citizen meets something no table covers, a teacher model is asked, once per archetype, several times. The answer is compiled into the table for everyone after. That's population-level in-context learning (section 4).
4. **Knowledge** (no model): a citizen knows a construct only through perception and word of mouth (section 5).
5. **The record of every decision:** the training data for a citizen model (section 7).

Every layer acts through the participant API, as every participant does: the same calls, the same resolver, the same kernel.

## 2. New building blocks (contract changes)

The principle (VISION 15): the world states *facts in its own terms*; what they mean to a person is the person's mind. So the world never says "this satisfies belonging". It says "a gathering at the hall every seventh day; members may come; $5 is collected". The body's needs map the facts to value.

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

## 3. The body

- **Needs** (a first set, each with a source to find):
  - subsistence;
  - shelter;
  - security (money in hand against obligations);
  - social;
  - status;
  - later, belonging and meaning. D2A has *spiritual satisfaction* among its 11.
  - Each rises and falls with time and what happens (hunger rises; a pay rise lifts security).
- **Traits:**
  - from the world's profile, census-style, drawn per person, so people differ by data, not by a model's persona;
  - they include how much each need weighs, patience, risk tolerance, and how much others' example counts.
- **Appraising an option** (utility AI with considerations):
  - an option's facts (money in and out, a space to occupy, hours of work, company at a place and time, membership) are scored against needs through response curves;
  - the scores are combined, and a trait-shaped weighted random choice is made among the best few;
  - the facts are typed (2c), so a new option made of familiar facts is scored at once.
- **Routines** (Lyfe's option-action): once a citizen takes up something ongoing (a job, a lease, a weekly service), it keeps to it until a cheap signal says to reconsider: a need falling below a threshold, a better offer seen, a notice. Most wakes are routine.
- **Kept from today:** the cited rules become considerations, so their calibration carries over:
  - Lengnick's shopping (ψ, ξ, β);
  - Harris–Todaro's expected-income comparison;
  - the rent-share budget;
  - Granovetter's signing thresholds.

## 4. Compiled policies and the sparse mind

- **Where the body's scoring is weak** (a choice that turns on what something means, not its facts), a policy table gives scores, keyed by:
  - the archetype (binned traits);
  - the situation (binned needs and circumstances);
  - the option's kind or construct.
- **A miss** (a construct no row covers): the sparse mind asks the teacher for scores over the candidates, K times, with the construct's own words. The mean and spread become the row, and everyone of that archetype after decides in microseconds.
  - **What the teacher is told about the person:** their circumstances and behavioural traits (needs now, money, household, obligations, how much others' example counts), never a demographic persona. Models asked to play a persona collapse toward an "average person", and pushing harder gives caricature (the survey and heterogeneity papers).
  - **The spread is kept, not only the mean:** a row samples from the teacher's distribution.
  - **Personal traits act after the lookup:** a person's own weights shift the row's scores. Otherwise everyone in an archetype would choose alike on meaning, which is AgentTorch's diversity cost.
- **Held fixed like the translator:** teacher model, framing, K and binning are versioned and recorded in the log. Every teacher call is logged in full, so replay and resume are exact. The table is rebuilt from the log.
- **Off by default.** Switching it on is a model in citizens' seats, however rarely, so it's Naz's call per run. Without it, a construct nobody's seen is scored on its facts alone.
- **Before any table is trusted, two checks:**
  - **A robustness audit** (TRAILS; framing alone swung cooperation 76 points in the audit paper): re-compile with the teacher's prompt reworded and the bins shifted, and check the rows barely move. Rows that swing are reported, not used.
  - **Fidelity:** sample rows and compare them with fresh teacher answers. GenWorld leaves this unvalidated.

## 5. Knowledge and belief

- **Memory is bounded** (Lyfe's summarise-and-forget): recent events are kept in full, then compressed to what mattered (needs moved, people involved), then forgotten. What's remembered can be wrong: Talk of the Town's misremembering is a later addition.
- A citizen knows a construct only through perception:
  - seeing it put up where they can see;
  - hearing of it (messages; the existing word-of-mouth "ties");
  - seeing others take part.
- **Belief** is kept per citizen, symbolically:
  - how strongly they hold something, and from whom it came;
  - it spreads by telling, strengthens with others' costly displays (Henrich's credibility-enhancing displays: attending, paying), and fades;
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
- the features;
- each option's score;
- the choice;
- which layer decided (body, table, mind).

It's on by default for runs that train citizen models, and off (lean) for quick tests. `terrarium dataset` exports it: the training set for a small citizen model, and the baseline against which that model is compared.

## 8. Building it, and retiring today's citizen

1. The blocks: 2a–2e, with the resolver and translator learning them, and today's code migrated off the hidden conventions.
2. **`citizen.utility`, first scope:** work, housing, shopping, support and retirement, leaving. It runs beside `citizen.default` on the same generated towns and is compared on the calibration targets and the tests' behaviours.
3. **Parity, then the switch:** the generator uses the new citizen; tests move over; `citizen.default` is retired. About 40 test files touch citizen behaviour, and they move with it.
4. **Belonging:** unions and clubs as offers and practices. The first test that a new institution just works.
5. **The sparse mind:** on Naz's go-ahead, in pilots.
6. **Meaning and belief:** religion as content (VISION 16).

## 9. What the literature taught, and where it's used

| Finding (docs/research/citizen-minds-2026-09.md) | In this design |
|---|---|
| The Sims: intelligence in the world's offers, not in the person | Offers and practices (2a, 2b); but facts, not advertised needs |
| Utility AI: considerations and response curves (Dave Mark) | The body's appraisal (3) |
| Versu: social practices give affordances; agents choose | Practices (2b); stages and expectations left for later |
| Talk of the Town: symbolic knowledge that spreads, is misremembered, fades | Knowledge and belief (5); misremembering later |
| Humanoid Agents, D2A: needs that decay, including spiritual satisfaction | Needs (3) |
| Lyfe: options kept until a cheap signal; summarise-and-forget memory | Routines (3); bounded memory (5) |
| Affordable Generative Agents: reuse the model's reasoning for similar situations | Compiled rows reused by everyone after a miss (4) |
| AgentTorch: ask per archetype; diversity is the cost | Per-archetype rows; personal traits after the lookup (4) |
| GenWorld: binned context, candidate sets, K samples compiled to tables; fidelity unvalidated; novel states fall back | Compiled policies (4); a fidelity check; compile on a miss instead of falling back |
| SwiftSage, agent distillation: a small model imitates the large | Recorded decisions (7) train the citizen model |
| Norms are hard to infer by watching when most comply | Constructs are legible records; nothing to infer about their shape (2) |
| Credibility-enhancing displays (Henrich) | Belief strengthens with others' costly displays (5) |
| Framing swings results up to 76 points (TRAILS) | Robustness audit before a table is used (4) |
| Model personas collapse to an "average person" | No personas: circumstances and traits; spread kept (4) |
| Concordia's model game master | Not taken: the kernel adjudicates, never a model |

## Open, for Naz

1. The contract changes in section 6: sign-off, or changes.
2. The first needs, and where their sources should come from.
3. Whether any construct's meaning should ever reach the body *without* the mind: for instance, a world stating that its church offers "fellowship". My view: no. Facts only; meaning is a mind's.
