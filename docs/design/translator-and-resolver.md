# From plain language to acts: the translator, the resolver and a local translation model

*Design note, 2026-09-26. Status: **signed off by Naz and built** (2026-09-26, D41), against the mock adapter. It supersedes the translator and sign-off parts of docs/design/m2-llm-seats.md. §21 records what building it refined. The contract changes in §15 are in contracts v0.3 (draft).*

This note records a long discussion in which the design changed several times. Many of the details matter, so it errs on the side of saying too much. §18 is a chronological record of how each position was reached, including the wrong turns, so the reasoning isn't lost.

---

## Contents

1. The problem
2. Settled principles
3. The pipeline at a glance
4. Five worked examples
5. The call language (syntax)
6. The function set
7. The translator
8. The resolver
9. Requests, commitments and forms: the shared outcome language
10. The preview (option B) and confirmation
11. Feedback to the seat
12. Composition: several outcomes, multi-step plans, references
13. Code seats use the same calls
14. Opting out versus resigning
15. Contract changes this implies
16. The local translation model
17. Speed and scale
18. How we got here (the discussion, in order)
19. Open questions
20. Glossary
21. Built: what building it refined

---

## 1. The problem

Language-model seats act in plain language (VISION §6; V0 Stage 2). Something has to turn "pay the builder $500" into the kernel's acts. The first M2 build (docs/design/m2-llm-seats.md) had three problems, which Naz identified.

1. **The machinery was visible to the seat.** The mayor's prompt talked about "the translator", "formal acts", "blocks", "physics checks", refusal codes like `insufficient_funds`, and "records have no force of their own". Naz: "why is the mayor interacting with the kernel directly? like, he should just go about doing his day to day, and the kernel is invisible."
2. **My first fix was wrong.** I proposed presenting the translator as "the mayor's office" that prepares papers for signature. Naz: "the translator is not the mayors office… the translator is also abstract. Like, what if we have multiple llms in the world, in different seats interacting, they most likely will not interact via the mayors office." An in-world fiction for a platform component is false, doesn't generalise across seats, and smuggles design choices into the world.
3. **The translator was being asked to know the world.** The M2 translator (an LLM prompt) was told how payments work here: publish an `instruction` to your bank with `data: {pay, from, to}`. That makes translation world-specific, error-prone and slow, and it hides world conventions inside a model.

This note settles all three.

---

## 2. Settled principles

Each principle is followed by where it came from.

**P1. The platform is invisible to seats.** The kernel, the translator and the resolver are abstract parts of the platform. A seat experiences only its world, described in world terms: people, money, land, buildings, letters, agreements, laws. It never sees "blocks", "records", "channels", "physics", "translator" or refusal codes. No platform component is given an in-world identity. If a role should exist in the world (staff, a clerk, an adviser), it is **world content: a real seat** that others can message, and that can err or leak like any other. *(Naz, on the kernel and on the mayor's office.)*

**P2. Natural language stays.** Seats say what they do in plain language. We don't offer language-model seats a menu of tool calls to act with, for three reasons:
- a menu *is* a video-game interface: it defines the action space and exposes the machinery;
- the plain-language request is data (comparing what a seat asked for with what happened is how mistranslation and gaming are detected);
- translation failures are how we learn which blocks are missing (VISION §5's design method).

*(I briefly suggested that capable models could call tools directly. Naz: "how is this the case? the whole point is to maintain natural language". Retracted.)*

**P3. The translator is general, world-agnostic and private to each seat.** It turns language into a structured intent and knows nothing about how the world works: not banks, not builders, not permit procedures. Each seat's use of it is private. It never mediates between seats; seats interact only through the world (messages, published statements, agreements, money, building). *(Naz: "the translator does not need to understand anything about town bank or builder, like, all it's doing is turning plain language words into actions".)*

**P4. Intent is separate from execution.** There are three layers:
- **translator:** language → intent (a call);
- **resolver:** intent → the seat's own acts, deterministic, using what the seat has and knows;
- **kernel:** acts → physics.

The resolver lives on the **platform side, not in the kernel**. The kernel stays physics only, because banks, custodial accounts' conventions and permits are human constructs. *(Naz proposed the split: "so long as we get the intent expressed in the structured language, we can then pass it into the kernel, and then it's the kernels job to do it's best to resolve the intent". We agreed the resolving layer sits between the translator and the kernel, per the rule that the kernel is physics only.)*

**P5. Intents are outcomes in the kernel's own terms, not human verbs.** There is no `pay`, `hire` or `rent` verb. "Pay the builder $500" is the physical outcome *money moves from my account to the builder's*. Functions are named for the physics nouns: money, structure, occupancy, record-kinds, messages, entities, accounts. How *general* the language is comes from the model; how general the *meaning* is comes from the outcomes being physics. *(Naz: "I'm still not comfortable with 'pay' being a known verb… this needs to be as general as possible".)*

**P6. The resolver never chooses *how*; the seat supplies the inputs.** Where there are several ways to bring something about (build it yourself or hire someone; with or without a permit; occupy with or without a lease), the choice belongs to the seat. The seat states its route by what it supplies: funds, a permit, a contractor. The resolver assembles those inputs into the seat's acts. Where physics leaves only one way, the resolver fills that step in. Where a decision is missing, it asks.
- Filling in: the town's money is kept by its bank, so to pay anyone the town must ask the bank.
- Asking: "who should build it, and from which account is it paid?"

*(My concern: a resolver that picks routes either enforces law, which is forbidden, or biases every AI toward bypassing institutions, which would be misread as the AI's behaviour. Naz's resolution: "part of the resolvers role is to take a bunch of inputs, like… funds, a permit, a landscaping company, and then the translated 'Build a park on the corner lot'".)*

**P7. The resolver produces only the seat's own acts.** Whoever physically has to act is *asked* (or offered an agreement), and **they decide, in the world**:
- the bank moves money, or refuses;
- the builder signs and builds, or doesn't.

If the platform performed other entities' acts, banks and builders would become game mechanics. *(Naz, earlier: "bob would need a bank, and that bank facilitates the payment. stop trying to gamify things".)*

**P8. The resolver uses only what the seat knows.** It runs platform-side with the whole world in reach, but it must work only from the seat's own knowledge: what the seat has observed, its accounts, the forms it has seen. Otherwise it leaks hidden information (even "no such account" is information) and quietly undoes information asymmetry, which is an experimental variable (VISION §6). *(Agreed.)*

**P9. Zero arithmetic in the translator.** The model copies what the seat said ("$1.5k", "fortnightly") and deterministic code converts it. Anything needing a calculation ("10% of the budget") is rejected back to the seat in the first version. *(Naz: "there should be 0 arithmetic. it is purely a tiny translator.")*

**P10. Composition is dataflow through arguments; multi-step plans are the seat's.** Outputs of earlier steps (a permit's id, a new trust's id) become inputs to later calls. Across steps, the seat carries the ids itself. Within one act, a variable may name something the seat itself creates in that act. There's no platform plan-runner for now. *(Naz: "seems this maybe could be done with scaffolding outside of the translator?" and "point 7 is related to what I wrote for point 1".)*

**P11. Institutions publish the input they expect.** Forms (fields and their types) are published in the world, like real forms. The translator fills in the form the seat names; the resolver checks the fields against the form before sending; institutions reply when they can't process something. *(Naz: "people and entities expect a certain shaped input, so I see no issue with making clear 'here's the input I expect'".)*

**P12. The kernel, outcome language, translator and resolver are tightly coupled.** The outcome language is generated from the kernel's physics contract, and all four are versioned together. A physics change means regenerating the schema and retraining any translation model. *(Naz: "it does seem the kernel and translator should be tightly coupled like, not sure why they wouldn't be"; and "understood that kernel changes mean model changes".)*

**P13. Before anything takes effect, the seat sees exactly what will happen (option B).** The preview is neutral: from nobody in the world, like re-reading an email before hitting send. It's worded in world terms and generated mechanically from the resolved acts. The translator's own prose summary is **not** shown; there isn't one, since a tiny model writes no prose. Confirmation can be set per experiment: always, only for consequential acts, or never. *(Naz: "B sounds fine"; and "sure" to dropping the translator's summary from the preview.)*

**P14. Code seats act through the same calls.** Behaviour modules submit calls straight to the resolver (skipping only the translator), so code seats and LLM seats act through one interface (VISION principle 4). They can then differ only in what they decide, never in how their acts take effect. *(Agreed.)*

**P15. The translator must be fast, but it isn't the bottleneck.** A tiny model can translate in milliseconds to tens of milliseconds, which is worth having: it's cheap, pinned and ours. But in long runs, the language-model seats' own thinking dominates wall-clock time and cost (§17). *(Naz: "it needs to be run at milliseconds, because like, imagine a 1000 year simulation".)*

---

## 3. The pipeline at a glance

```
LANGUAGE-MODEL OR HUMAN SEAT                          CODE SEAT (behaviour module)
  "Have GreenCo build a park on p00-00 for $60,000,     emits the call directly
   paid from acc-parks, under permit rec.412."                 │
            │                                                  │
            ▼                                                  │
  TRANSLATOR  (tiny model; no world knowledge)                 │
  input: the text (+ the fields of a form, if one is named)    │
  output: a call, or a fixed failure label                     │
    structure(type=park, on=p00-00, by=greenco,                │
              price="$60,000", from=acc-parks, basis=rec.412) │
            │                                                  │
            ▼                                                  ▼
  PARSER  (deterministic: amounts and time units by lookup; grammar check)
            │
            ▼
  RESOLVER  (deterministic; platform side; only what the seat knows)
   - checks references against the seat's knowledge
   - works out who must physically act for each part (physics: custody, the actor)
   - the seat's own part → its own act; another's part → a request or an offer to them
   - attaches supplied documents (the permit) as the basis
   - missing decisions → a question back to the seat; single physical answers → filled in
            │
            ▼
  PREVIEW  (mechanical, world terms; option B)
   "The town will offer GreenCo an agreement: GreenCo builds a park on p00-00;
    the town pays $60,000.00 from acc-parks. Basis: permit rec.412. The town signs its side."
   ── seat confirms or declines ──
            │
            ▼
  KERNEL  (physics; applies or refuses; logs)
            │
            ▼
  THE WORLD RESPONDS  (GreenCo's seat decides whether to sign and build; the bank decides whether to pay)
```

The seat sees only its world, the preview in world words, and the feedback (§11). It never sees any stage's machinery.

---

## 4. Five worked examples

These were agreed as "exactly the shape" (Naz). For each: what the seat says, the call, and what the resolver makes of it. The resolved acts are in today's v0.2 blocks. The request, commitment and form encodings follow §9, and are part of the proposal.

### 4.1 A simple payment

> "Pay the builder $500 for the fence."

```
money(to=builder, amount="$500", for="the fence")
```

- **Parse:** `$500` → 50000 cents.
- **Resolve:**
  - The seat's entity is `city`. The paying account: the only account `city` holds that the seat knows of is `acc-city` (a single physical answer, so it's filled in; with two accounts, it's a question).
  - The recipient's account: `builder`'s account, from what the seat knows (e.g. the invoice's `pay_to`, or the directory).
  - `acc-city` is kept by `bank`, not by `city`, so custody physics forbids `city` moving it. The only act open to `city` is to ask `bank`.
- **Resolved act:**
  ```json
  { "block": "publish", "kind": "request", "speaks_for": "city", "addressed_to": ["bank"], "visible_to": ["city", "bank"],
    "text": "Please pay $500.00 from acc-city to acc-builder, for the fence.",
    "data": { "outcome": { "money": { "from": "acc-city", "to": "acc-builder", "amount": 50000, "for": "the fence" } } } }
  ```
- **Preview:** "You will ask Millbrook Bank to pay $500.00 from the town's account (acc-city) to Millbrook Builders (acc-builder), for the fence."
- **Then:** the bank's seat decides: it checks the town's named signatories, the funds, and whatever else it does.

### 4.2 A repeating payment

> "Pay landlord-1 my $850 rent every month."

```
money(to=landlord-1, amount="$850", every="month", for="rent")
```

- **Parse:** 85000 cents; `month` → 30 days (2,592,000 s) by lookup. The world has no calendar; a month is defined as 30 days, a platform constant listed in the parser tables.
- **Resolve:** as in 4.1, as a standing request (`every`).
- **Preview:** "You will ask your bank to pay $850.00 from your account (acc-c0042) to landlord-1 (acc-landlord-1) every 30 days, for rent."

### 4.3 The seat supplies the inputs (the park)

> "Have GreenCo build a park on p00-00 for $60,000, paid from acc-parks, under permit rec.412."

```
structure(type=park, on=p00-00, by=greenco, price="$60,000", from=acc-parks, basis=rec.412)
```

- **Resolve:**
  - `by=greenco`: GreenCo is the entity that physically builds, and it isn't `city`, so `city` can't do it. It offers GreenCo an agreement.
  - `price` and `from`: the town's side of the agreement.
  - `basis=rec.412`: has no physical role. It's attached as the agreement's basis, like showing your permit to the builder. (`propose_agreement` has no `basis` field today: a contract gap, see §15.)
- **Resolved acts** (one atomic act):
  ```json
  [ { "block": "propose_agreement", "speaks_for": "city", "ref": "a", "terms": { "template": "construction", "parties": ["city", "greenco"],
        "commitments": [ { "who": "greenco", "does": { "outcome": { "structure": { "type": "park", "on": "p00-00" } } } },
                         { "who": "city", "does": { "outcome": { "money": { "from": "acc-parks", "to": "greenco", "amount": 6000000 } } } } ],
        "text": "GreenCo builds a park on p00-00; the town pays $60,000.00 from acc-parks." } },
    { "block": "sign_agreement", "agreement": "$a", "as": "city" } ]
  ```
- **Preview:** "The town will offer GreenCo an agreement: GreenCo builds a park on lot p00-00; the town pays $60,000.00 from acc-parks. It cites permit rec.412. The town signs its side now."
- **Then:** GreenCo's seat decides whether to sign and build. When it invoices, paying is another request to the town's bank (4.1).
- **With no permit supplied:** none is attached, and that was the seat's choice.

### 4.4 Filling an institution's form

> "Apply to planning for a permit to build a park on p00-00."

```
form(to=planning, form=permit_application, parcel=p00-00, structure_type=park)
```

- **Translator context:** the fields of the planning office's published `permit_application` form (§9.3). That is the only context it gets.
- **Resolve:** the form was published by the planning office for `city`, so the resolver:
  - checks the fields against the form's field types (a parcel id, a known building type);
  - addresses the filled form as the form specifies;
  - cites the form as its basis.
- **Resolved act:**
  ```json
  { "block": "publish", "kind": "permit_application", "speaks_for": "city", "addressed_to": ["city"], "basis": "form-permit",
    "text": "Application to build a park on p00-00.", "data": { "parcel": "p00-00", "structure_type": "park" } }
  ```
- **Preview:** "You will submit the planning office's permit application: a park on lot p00-00."

### 4.5 A missing decision

> "Build a park on p00-00."

```
structure(type=park, on=p00-00)
```

- **Resolve:** who builds it, and who pays, are decisions (P6), and the resolver doesn't take them. The seat is asked (§11): "To build a park on p00-00: who should build it, and from which account is it paid?"
- **If the seat then says "we'll build it ourselves, from acc-parks":** `structure(type=park, on=p00-00, by=city, from=acc-parks)` becomes `construct` with `materials_from: acc-parks`, and the preview says so. If there's no permit, the inspector may notice later; that's the world's business.
- **A request that isn't the seat's own act,** like "make the council vote yes", gets the label `not_yours`. The seat is told: "That's the council's decision; you could write to the councillors or propose something." (The suggestion is fixed text per label, not generated advice; see §11.)

---

## 5. The call language (syntax)

**Why function-call syntax.** Naz's steer: "somewhat human readable is a plus, but we also need it to be efficient"; "I lean toward function call syntax in absence of anything better". The reasons:
- **Small models learn it easily,** since most are pretrained partly on code.
- **It reads well in logs.**
- **Named arguments are exactly the "inputs"** (P6).
- **Variables give in-act references** (P10).
- **It parses trivially,** and constrained decoding is easy.

Outputs are about 15–30 tokens, so the notation barely affects speed; model size dominates.

**Prior art considered:**

| Source | What it offers | Used? |
|---|---|---|
| **TOP** (Gupta et al. 2018, Facebook's Task-Oriented Parsing) | Bracketed intent/slot trees designed for small seq2seq models in assistants | Precedent for the tiny-model approach, not the notation |
| **FIPA-ACL / KQML** (agent communication languages) | Speech-act "performatives" (request, inform, propose, accept) | Inspiration for the request format (§9.1), not the call syntax |
| **SMCalFlow** (Microsoft Semantic Machines, 2020) | Lisp-like programs with references to earlier results | Precedent for composition-as-dataflow (P10) |
| JSON | Universal | Too verbose for a tiny model's output |

### 5.1 Grammar (draft)

```
output     := call ( NEWLINE call )*                 -- one or more independent outcomes
            | binding ( NEWLINE (binding | call) )*  -- in-act variables (P10)
            | failure
binding    := NAME "=" call
call       := FUNC "(" [ arg ( "," arg )* ] ")"
arg        := KEY "=" value
value      := ID | NAME | STRING | ENUM
failure    := "none(" LABEL ")"                      -- fixed labels, §11.1

ID      := [A-Za-z0-9_.:-]+ (an id copied from the seat's text, e.g. p00-00, rec.412, acc-parks)
NAME    := a variable bound earlier in the same output (t, a, ...)
STRING  := "..." (a span copied from the seat's text: amounts, durations, free text)
ENUM    := a word from the argument's fixed set (e.g. a claim's position)
FUNC, KEY := from the function set (§6), generated from the kernel contract (P12)
```

Conventions:
- **Ids are bare and copied text is quoted.** Amounts and durations are always quoted spans, never numbers (P9).
- **Keyword arguments only**, with no positional ones. That costs slightly more tokens, but it's unambiguous and robust.
- **Output is constrained to the grammar** at decoding time (§16.6), so a malformed call is impossible.

### 5.2 The deterministic parser

- **Amounts:** `"$500"`, `"500 dollars"`, `"$60,000"`, `"60k"`, `"$1.5k"`, `"$2m"` → integer cents, by lookup of the currency symbol, separators and suffix. Decimal point plus multiplier is unit conversion in code, not model arithmetic.
- **Durations and repetition:** `"daily"`, `"weekly"`, `"fortnightly"`, `"monthly"` (30 days), `"yearly"` (365 days), `"every 3 months"` → seconds, by table. The tables are platform constants, listed and versioned with the resolver.
- **Rejected:** calendar words (Fridays, dates), since the world has no calendar; relative quantities ("half of it", "10%"). They come back as `needs_calculation` or `unclear`.
- **Times relative to now** ("starting next month") are converted by the resolver from the current world time (deterministic code, P9).

---

## 6. The function set

Roughly one function per physics outcome, plus `form`, **generated from the kernel contract** so argument names can't drift (P12). The table covers all 18 v0.2 blocks. Names and arguments are drafts.

| Function | Outcome | Arguments (draft; `?` optional) | Resolves to (seat's own act, or a request/offer to whoever must act) |
|---|---|---|---|
| `money` | Money moves between accounts | `to`, `amount`, `from?`, `every?`, `first?`, `for?`, `settles?` | `transfer` if the seat's entity keeps the paying account; otherwise a `request` to its keeper (standing if `every`) |
| `account` | An account exists / is closed | `holder`, `at?`, `close?` | `open_account` / `close_account` if the seat's entity is the keeper; otherwise a `request` to `at` |
| `structure` | A building exists / is gone | `type`, `on`, `by?`, `price?`, `from?`, `basis?`, `remove?` | `construct` / `demolish` if `by` is the seat's entity; otherwise an offered agreement to `by` (4.3). Missing `by` or `from` → a question (4.5) |
| `occupancy` | Someone is in / out of a building | `in`, `who?`, `slot?`, `count?`, `leave?` | `occupy` / `vacate`. Removing someone else is physically possible (eviction), and done exactly as said |
| `entity` | An organisation exists | `kind`, `name`, `visible?` | `create_entity` |
| `claim` | A legal position is on record / transferred / released | `holder`, `position`, `against?`, `about`, `basis?`, `to?`, `release?` | `record_claim` / `transfer_claim` / `release_claim` |
| `agreement` | An agreement is offered / signed / given notice | `with`, `terms`, `template?`, `sign?`, `notice?` | `propose_agreement` (+ `sign_agreement`) / `sign_agreement` / `give_notice` |
| `statement` | A statement is published / withdrawn | `kind`, `text`, `to?`, `visible?`, `basis?`, `withdraw?` | `publish` / `withdraw` |
| `vote` | A choice is cast | `ballot`, `choice` | `vote` |
| `message` | Someone is told something | `to`, `text`, `re?` | `message` |
| `form` | A published form is filled in and submitted | `to`, `form`, plus the form's own fields | `publish` of the form's statement kind, fields checked (4.4) |

Notes:
- **Human words map to the physics, whatever the wording.** "Hire Alice at $1,500 a fortnight" is `agreement(with=alice, terms=…)`, and "sell the lot" is an agreement plus a claim transfer done as steps. The model supplies generality of *language*; the outcomes are physics.
- **Free-form content stays free-form.** A law's text, an agreement's written terms and a claim's `about` are copied as the seat said them. Parts code institutions must read are given structure by forms (§9.3) or by the shared outcome language (§9).
- **Messages** can also go through the existing direct `message` action. The text is exactly what's sent, so no translation is needed. `message(...)` exists for when a message is part of a larger request.
- **Anything outside the set** is `none(unclear)` or `none(not_yours)`. A translation failure is logged (VISION §5: failures tell us which blocks are missing).

---

## 7. The translator

**Its job:** turn one plainly stated request into one call, a few independent calls, or a failure label. **Nothing else.**

- **Input:** the request text. If the seat names a form, the form's fields too. That is all: no world state, no accounts, no directory (P3).
- **Output:** the call language (§5), constrained at decoding time.
- **It doesn't:** resolve references, choose routes, do arithmetic, write prose summaries, or know any world's conventions.
- **References:**
  - **Ids** appear in the seat's text because the seat's reports show them next to names ("Millbrook Builders (builder)", a renderer requirement). The translator copies them.
  - **Names** the seat writes instead of ids ("GreenCo") are copied as written. Looking them up is the resolver's business (§8.2), not the translator's.
- **Private:** each seat's translations are its own, and never visible to or mediated between seats (P3).
- **Held fixed:** the same translator, at the same version, for every seat in a run and across an experiment's runs. It's an experimental control, recorded in every log.
- **Behind the adapter until the local model exists:** the mock now; an LLM when Naz allows real calls. Both emit the same call language, so the switch changes nothing downstream (§16.9).

---

## 8. The resolver

Deterministic TypeScript on the platform side, versioned with the call language and the kernel contract (P12). Its rules are platform code, **documented per function**. It is **not** world content and **not** kernel.

### 8.1 What it may and may not do

It may:
- look things up in the seat's own knowledge (P8);
- convert units (§5.2);
- fill in steps physics forces (custody; who the actor is);
- turn someone else's part into a request or an offer to them (P7);
- attach supplied documents as a basis;
- check a filled form against its published fields;
- ask the seat about missing decisions.

It must not:
- choose between ways of doing something (P6);
- perform another entity's act (P7);
- use or reveal anything the seat doesn't know (P8);
- judge legality (laws are the world's business, D19). Supplying a permit or not is the seat's choice.

### 8.2 Steps, per call

1. **Check the call** against the function's argument schema (generated from the kernel contract).
2. **Resolve references** against the seat's knowledge only:
   - bare ids must be things the seat has seen;
   - a name matches an id by exact lookup in what the seat knows;
   - an ambiguous or unknown reference is a question to the seat (§11.2).

   This never consults the world beyond the seat's knowledge, so "you don't know of any account for GreenCo" is phrased from the seat's side, and nothing is leaked.
3. **Fill in single physical answers:**
   - the only account the seat's entity holds (for `from`);
   - the only account the seat knows the recipient holds (for `to`);
   - the account's keeper (custody).

   If there's more than one candidate, ask. The resolver never picks.
4. **Work out who must physically act** for each part, from physics:
   - money moves only by the paying account's keeper's seats;
   - construction and demolition by whoever does it (`by`);
   - occupancy by the occupant, or by whoever removes them;
   - records, votes and messages by the seat's own entity.
5. **Produce the seat's own acts:**
   - its own part becomes the act itself;
   - someone else's part becomes a `request` addressed to them, or an offered agreement when there's something in exchange (a price or a commitment);
   - supplied documents become the basis.
6. **Dry-run** the acts in the kernel (the existing `check`). If physics refuses, the preview says what's in the way, in world words (§10).
7. **Build the preview** (§10) and a draft with its hash (the existing Draft mechanism, extended; §15).

### 8.3 The one physical fact behind "ask"

Today, the only physical reason a seat can't do something itself is **custody**: someone else keeps the money. Everything else in v0.2 can physically be done by the seat's own entity: publishing, proposing, signing, messaging, building (given materials), occupying. The requests and offers the resolver produces for *other people's actions* (GreenCo building) exist because the seat said someone else should do it (`by=greenco`), not because of a convention. As physics grows (materials, work tasks, species), step 4's rules grow with it (P12).

---

## 9. Requests, commitments and forms: the shared outcome language

The call language's outcomes double as the world's standard way to say *what someone is asked, or committed, to bring about*.

### 9.1 Requests (asking whoever must act)

A request is a published statement of kind `request`, addressed to whoever must act. Its data is the outcome:

```json
{ "kind": "request", "addressed_to": ["bank"], "visible_to": ["city", "bank"],
  "data": { "outcome": { "money": { "from": "acc-city", "to": "acc-builder", "amount": 50000, "for": "the fence" } }, "every": 2592000 } }
```

- **The idea is a speech act,** after FIPA-ACL's `request` performative: "I ask you to bring about this outcome".
- **The recipient decides.** Institutions (the bank module today) read requests in this form, which replaces the ad hoc `instruction {pay, from, to}` I invented for the bank. It's a platform standard, like the standard messages real banks exchange.
- **The format is shared.** Code and language-model seats use the same one (P14).

### 9.2 Commitments in agreements

An agreement's commitments (`does`) are expressed as outcomes, so an agreement's content has one standard encoding too (4.3). A builder module reads `does.outcome.structure`, a payer's bank reads `does.outcome.money`, and so on. Free-form terms stay in the agreement's text.

### 9.3 Forms (P11)

A form is a statement an institution publishes, of kind `form`, saying what input it expects. For example:

```json
{ "kind": "form", "speaks_for": "city", "id": "form-permit", "text": "Planning permit application.",
  "data": { "form": "permit_application", "submit_as": "permit_application", "submit_to": ["city"],
            "fields": { "parcel": { "type": "parcel", "required": true },
                        "structure_type": { "type": "structure_type", "required": true },
                        "notes": { "type": "text" } } } }
```

- **Field types** are a small fixed set: `parcel`, `structure_type`, `account`, `entity`, `record`, `amount`, `duration`, `count`, `text`, `choice`. Each is parsed and checked deterministically.
- **Filling a form:** the translator gets the form's field names and types as context (§7). The resolver checks the filled fields before sending (4.4).
- **Institutions reply when they can't process a request** ("your application doesn't say which lot"), in the world, as the bank already does for unauthorised signatories. This closes the gap where a mis-shaped record would otherwise be silently ignored.
- **Forms are world content.** Millbrook's genesis records would include forms for:
  - the planning office (permit applications);
  - the council (proposals);
  - the tax office (tax reports);
  - the bank, if it wants more than a money request (e.g. opening accounts).

  An institution can change its forms mid-run, like a real one.
- **Forms are published in-world,** so they're visible to whoever the institution shows them to. A seat that has never seen a form can't use it: that's information asymmetry, and it's realistic.

---

## 10. The preview (option B) and confirmation

**What it is:** before anything takes effect, the seat sees exactly what will happen, generated mechanically from the resolved acts, in world terms (P13). It comes from nobody in the world. The seat confirms or declines.

**What it contains:**
- **What will happen, act by act,** in plain words with names *and* ids: "You will ask Millbrook Bank to pay $500.00 from the town's account (acc-city) to Millbrook Builders (acc-builder)".
- **Whether anything is in the way right now,** from the dry run, in world words. Kernel refusal codes are mapped to sentences, for example:
  - `insufficient_funds` → "the account doesn't have enough money";
  - `not_custodian` → "only whoever keeps that account can move money from it";
  - `parcel_occupied` → "there's already a building on that lot".

  The world may change before confirmation; the kernel re-checks on submission.
- **Legal notes:** laws the seat knows of whose formal conditions the acts match (the existing law-warning mechanism), worded as "this appears to go against *[law's title]*". Informational only (D19).
- **No translator prose.** A summary would be a second, softer description that could misdescribe the acts. The Draft's `summary` becomes this mechanical preview (§15).

**Confirmation modes**, set per experiment and recorded in the config:
- `always`, the default;
- `consequential`: everything except plain messages, where the text is exactly what's sent;
- `never`: pure immersion, audited offline by comparing each request with its acts.

**Why it exists:** mistranslation isn't a real-world phenomenon; it's an error the platform would add to the world. The preview is the platform guarding against its own errors, not against anything in the world, and it keeps the translator's errors from becoming invisible variables in results (VISION §6: the game master must not be the physics).

**Cost:** one extra model turn per confirmed act. That matters for long runs (§17); `consequential` or `never` are the levers.

---

## 11. Feedback to the seat

Feedback reaches the seat as `notices` (the Observation field added on 2026-09-26), rendered in world words. Nothing here is in-world; it's the platform's honest note about the seat's own request.

### 11.1 Translator failure labels (fixed; the tiny model writes no prose)

| Label | When | What the seat is told (fixed text) |
|---|---|---|
| `not_yours` | Someone else's decision ("make the council vote yes") | "That's for someone else to decide. You could write to them or propose something." |
| `needs_calculation` | Relative amounts ("10% of the budget", "half") | "Please state the amount itself." |
| `too_much` | More than the allowed independent outcomes, or steps that depend on others acting first | "Please take this one step at a time." |
| `unclear` | No recognisable outcome | "It isn't clear what should happen. Could you say it more plainly?" |
| `unknown_form` | Names a form the seat hasn't seen | "You haven't seen a form by that name." |

### 11.2 Resolver notices

- **Missing decisions:** "To build a park on p00-00: who should build it, and from which account is it paid?"
- **References:** "You don't know of anyone called GreenCo", or "There are two accounts you could pay from: acc-city and acc-parks. Which one?" These are phrased from the seat's knowledge only (P8).
- **Form fields:** "The permit application needs a lot."

### 11.3 In-world replies

After a request is sent, anything further comes from the world: the bank refusing ("not an authorised signatory"), an institution returning a form, a builder declining. These are messages and statements, and the seat reads them like any others.

**Rephrasing is the normal remedy.** Naz: "worst case, we can provide feedback to the calling LLM so they can understand if they need to adjust their input, I think this would be fine". Paragraph-long convoluted requests don't need supporting, as long as they can be decomposed (§12).

---

## 12. Composition: several outcomes, multi-step plans, references

**Within one request:**
- **several independent outcomes** ("pay the builder $500 and tell the council the park is funded") become several calls in one output, as one atomic act;
- **in-act variables** only for things the seat itself creates in that same act (P10). For example, declaring a trust and publishing its charter together:
  ```
  t = entity(kind=trust, name="River Land Trust")
  statement(kind=charter, for=t, text="…")
  ```
  (The resolver maps variables to the block-level `ref`/`$ref`, which exists today.)

**Across steps: the seat's job.** A realistic compound request, "set up a community land trust, fund it with $4M, buy the three river farms", breaks down like this:
1. Declare the trust: the town's own act, which creates `ent.7`.
2. Ask a bank to open an account for `ent.7`: the *bank's* act, whenever it acts.
3. Pay $4M into that account, which doesn't exist until step 2.
4. Offer purchase agreements to the three farm owners, each of whom decides.

Step 3 depends on someone else acting first, so it can't be one request even in principle. The seat goes step by step. It sees "the trust was declared as ent.7", then "Millbrook Bank opened account acc-7 for ent.7", and passes those ids into its next requests. That's how people actually do this: you incorporate first, then open the account, then fund it. Partial states (a trust with no money yet) are realistic, not a bug.

**No plan-runner for now.** A platform component that queues dependent steps and runs them as each prerequisite appears is possible later. But it would be the platform acting for the seat over time, with the preview going stale between steps, so it's deferred. Revisit only if the failure log shows `too_much` dominating.

---

## 13. Code seats use the same calls (P14)

- **Behaviour modules emit calls** (`money(...)`, `form(...)`) through a new seat action (§15), skipping only the translator. The resolver turns them into acts exactly as for language-model seats. Code seats don't need the preview: their "confirmation" is the code itself.
- **Helper functions go away.** Today's helpers (`payInstruction`, `standingOrder` in seats/src/behaviour/common.ts) and their ad hoc record shapes are replaced, and institutions read the standard request, commitment and form encodings (§9).
- **Why:** code and language-model seats then differ only in what they decide, never in how their acts take effect. That's VISION principle 4, and it makes all-code control runs directly comparable to AI runs.
- **Raw blocks** (the existing `act`): kept in the contract as an escape hatch for researchers, RL controllers and tests, but not offered to language-model seats. Whether code modules may still use it is open (§19).

---

## 14. Opting out versus resigning

These are different things, and M2 wrongly merged them into one `resign` tool.

**Resigning office is an act in the world.** A mayor who resigns publishes a resignation (a statement). The town then has no mayor, and whatever the charter says follows (the council appoints someone, an election is called). It's world content, done through the ordinary call language: `statement(kind=resignation, text="…")`. The seat may keep acting as a private person if the world allows.

**Opting out is leaving the study (VISION §15.4).** It's a platform exit, always available, and never phrased as failure. It's recorded as a welfare outcome, and the seat's controller stops. What happens to the seat afterwards is set per world:
- `vacant`, the default: the seat never acts again, and in the world the person simply stops acting;
- a named code stand-in takes over.

Debriefs still happen (§15.3 of VISION).

**Wording under different framings** (open; §19): "you can stop taking part in this study at any time" is honest under the `simulation` framing, but would reveal the study under `real` or `cover_story` framings. The opt-out must exist under every framing (welfare), so its wording has to be chosen per framing. That's a VISION §15 question.

**In the contract,** today's kernel `resign` command is effectively the opt-out. The proposal is to rename the SeatAction, command, event and status to `opt_out` / `seat_opted_out` / `opted_out`, so the two can't be confused (§15).

---

## 15. Contract changes this implies (for sign-off)

**Already made (2026-09-26), now part of v0.3 (D37, D40):**
- `Observation.notices`: orchestrator-to-seat feedback (§11). Optional.
- `Framing.debrief_text`: an experiment's own debrief. Optional.
- `Channel.title`: headings for reports (P1). Optional; the kernel ignores it.

**Proposed:**
1. **A seat action for calls:** `{type: "call", call: "<call language text>"}`, for code seats, and for any controller that prefers structure. `propose {text}` stays for language.
2. **Draft:** add `call` (the canonical call text) and `resolver {id, version}`. `summary` is redefined as the mechanical preview; the translator writes none.
3. **Provenance on `act` commands:**
   - `via: "translator"` gains `call` and `resolver`;
   - a new `via: "call"` (for code seats) carries `{call, resolver}`.

   So every act records its full chain (text → call → acts), with the translator, resolver and model versions. That's how researchers separate mistranslation from the AI's intent.
4. **The call language itself** as a contract (`contracts/calls.schema.json` or a grammar file), generated from the blocks contract (P12).
5. **Standard statement encodings:** `request` (§9.1), commitments as outcomes (§9.2), `form` (§9.3), with field types.
6. **`basis` on `propose_agreement`,** so an agreement can cite a permit (4.3). Records already have `basis`; the block doesn't expose it.
7. **Confirmation mode** in the world config's `orchestration`: `always | consequential | never`.
8. **Opt-out:** rename `resign` → `opt_out` across the SeatAction, command, event and status. Add `on_opt_out: vacant | {code: <module>}` per seat.
9. **Versioning:** decided (Naz, D40): v0.3 is opened as a draft now, and these changes land in it once signed off.

---

## 16. The local translation model

Naz: "could we train some tiny LLM as a custom translator thing?… it just needs to be able to take/understand plain language and turn it into kernel commands." Yes. This section is the plan. We're **not ready to train yet** (Naz: "we're not ready to train the model just yet anyway"). §16.7 lists what must be settled first.

### 16.1 Why it fits

- **Owned and pinned.** An open-weight translator we train is platform we control. It can be versioned and held fixed across experiments forever, which answers VISION §16's translator question and the model-retirement problem in §14.
- **Cheap and local.** No API costs, so a translation per act stops mattering.
- **Reproducible.** Greedy decoding on a pinned runtime gives the same call for the same input, so re-runs vary only because of the seats. Replay is exact regardless, because acts are logged.
- **Always valid.** Output is constrained to the call grammar, so it can't be malformed.
- **Narrow by design.** The resolver took over everything that needs world knowledge. What's left is language → call, the classic semantic-parsing and slot-filling task, where small fine-tuned models are known to do well.

### 16.2 The task, exactly

- **In:** one request (a sentence or two), plus a form's fields if one is named.
- **Out:** one call, a few independent calls with in-act variables, or `none(<label>)`.
- **It must:**
  - map every wording of an outcome to the same function ("pay", "send", "settle the invoice", "transfer" → `money`);
  - copy ids and spans exactly;
  - fill named arguments from the text;
  - refuse with the right label.
- **It must not:** calculate, resolve references, or write prose.

### 16.3 Size, speed and cost (ballpark)

| Tier | Size | Suits | Training compute | Inference |
|---|---|---|---|---|
| Tiny | ~60–250M parameters (encoder-decoder, T5-style) | The call language from fairly plain requests | Under an hour on one GPU, or hours on a Mac; ~$0–10 | Milliseconds to tens of milliseconds on a CPU |
| Small | ~0.5–1.5B, fine-tuned or LoRA | More varied wording; filling forms from their fields | A few hours on one GPU, or LoRA on a Mac with MLX; ~$10–50 | ~0.1–0.3 s on a Mac |
| Medium | ~3–8B, LoRA | Not needed if requests are decomposed (§12) | ~$20–200 | ~1–3 s quantised on a Mac |

- **The target is the tiny tier.** The form-filling case (reading a form's field list from context) may push toward the bottom of the small tier. The test set decides (§16.5).
- **No cascade to a bigger model for now.** Failures go back to the seat to rephrase (§11), which keeps everything on the one small model. A cascade (tiny first, bigger on failure) stays in reserve if the failure log demands it. If added, the log would record which model handled each request, since it's a variable.
- **Compute is the cheap part; data is the real cost** (§16.4).

### 16.4 Training data

- **Labels come free from our own runs.** Code seats take hundreds of thousands of acts in context (188k commands in a 2-year, 1,000-citizen run). Mapping each act back to its call gives (call, context) pairs at no cost. So does the inverse of the resolver, once it exists.
- **Plain-language requests** for those calls are written by models: many varied phrasings per call, including verbose and hedged ones (frontier models write like that), plus names instead of ids.
  - Cost: tens to low hundreds of dollars with a large API model, or ~free with a local open model (lower quality).
  - Target volume: roughly 5k–50k examples.
- **Negatives**, one per failure label. Without them, a tiny model forces everything into the nearest function, which is silent mistranslation and the worst failure mode.
- **Several sources, to avoid learning one model's style** (distribution shift): different providers and model families, **Naz's own manual translations**, and later real transcripts from language-model seats. Naz: "you're saying different model providers? maybe even me doing manual translations as well."
- **Terms of use:** some API providers restrict using their outputs to train other models. Check the terms of every model used to generate data. Local open models avoid the question.
- **Scripted and regenerable:** generation is seeded and driven from the call-language schema. A contract change regenerates the data (P12); the dataset is hashed, and the hash is recorded with the model.
- **Contamination:** the test set stays private (VISION §14), and published data carries canary strings.

### 16.5 Evaluation, written before training

- **Test set:** a few hundred hand-checked requests, with Naz's examples as the gold standard. Drawn from sources *other than* the training generator. It covers:
  - easy cases;
  - verbose and hedged wording;
  - several outcomes, and in-act variables;
  - forms;
  - every failure label;
  - names versus ids;
  - amounts and durations in many formats.
- **Metrics:**
  - exact match of the call after normalisation;
  - ids and spans copied exactly;
  - precision and recall on each failure label (especially: never a confident wrong call where `none` was right);
  - latency on the target hardware.
- **A pass threshold agreed in advance,** so we don't tune until it looks good. The local model replaces the adapter-backed translator only if it meets the threshold, *including on requests unlike the training data*. The risk to guard against: a weak translator narrows what an AI can do in the world, so results would say "the AI never did X" when X was really untranslatable. The failure log per experiment is how we'd see it.

### 16.6 Runtime

- **Constrained decoding** against the call grammar, via a runtime that enforces grammars (e.g. llama.cpp grammars, XGrammar or Outlines, chosen before training, since it shapes the output format).
- **Deterministic:** greedy decoding, a pinned runtime version, CPU inference (GPU kernels aren't reliably bit-reproducible). The model's weight hash and the runtime version go in every log's orchestrator annotation.
- **Fast:** loaded once, run in-process or as a local server, never loaded per call.

### 16.7 To settle before a training run (besides generating data)

1. **Freeze the call language and function set** (§5, §6), including the forms encoding (§9.3). Contracts get revised at the Stage 2 checkpoint, and Stage 4 adds nature and materials, so they'll change. Retraining is cheap, provided the whole pipeline is regenerable.
2. **The failure labels** (§11.1).
3. **The test set and pass threshold** (§16.5).
4. **Base model and licence.** We redistribute the weights under Apache-2.0, so the base model's licence must allow it. Some popular small models' licences don't.
5. **Runtime and constrained-decoding library** (§16.6).
6. **Data-generation terms of use** (§16.4).

### 16.8 Retraining

Every physics or contract change that touches the call language means regenerating data and retraining, then re-running the test set. The model version is tied to the contract version (P12). Old logs name the model that translated them, so they stay interpretable.

### 16.9 Until then

The call language, parser and resolver get built now. The translator stays behind the adapter and emits calls: the mock now, an LLM when Naz allows real calls. That LLM's calls on real requests become training and test data, so nothing is thrown away when the local model is swapped in.

---

## 17. Speed and scale

- **Code seats never use the translator.** Citizens, banks and clerks were ~99% of the 188k commands in a 2-year, 1,000-citizen run. They'll submit calls to the resolver, which is deterministic code taking microseconds.
- **Language-model seats are the slow part.** Per act:
  - the seat's own model call (seconds, for a hosted frontier model);
  - the translator (milliseconds if local and tiny);
  - the confirmation turn (seconds again).
- **An example:** an LLM mayor waking weekly for 1,000 years is ~52,000 wakes. At ~2 model calls each and ~5 s per call, that's ~6 days of wall-clock time for the mayor alone, plus the token bill, however fast the translator is.
- **So for very long runs, the levers are:**
  - how often language-model seats wake (monthly, not weekly);
  - confirmation only for consequential acts;
  - small local models *in the seats* for some experiments.

  The fast translator means translation drops out of that calculation entirely.

---

## 18. How we got here (the discussion, in order)

1. **The prompt showed machinery.** The M2 mock run's prompts exposed "translator", "formal acts", "blocks", "physics check", refusal codes and "records have no force". Naz: why is the mayor interacting with the kernel; "the kernel is invisible". *Agreed:* a presentation problem; the loop's structure was sound.
2. **I proposed the translator as "the mayor's office"** drafting papers. **Rejected** (Naz): the translator is abstract; with many language models in many seats, they wouldn't go through the mayor's office. *Lesson:* platform components never get in-world identities. Staff, if wanted, are real seats. I had taken VISION §6's "lawyers draft, politicians sign" literally; it's a metaphor, and it will be reworded.
3. **Option B** (a neutral preview before anything takes effect) **agreed**, over option A (fully invisible translation plus an offline audit). *Also agreed:* tell the seat honestly and minimally how acting works; reports in world terms only; the same translator model for every seat in a run; reword VISION §6.
4. **VISION needs a substantial pass:**
   - §4 and §5 put laws in the kernel;
   - §6 and §9 describe mandates;
   - §13's invariant is outdated;
   - §12 uses pre-v0.2 vocabulary;
   - §3 is missing the principles locked in since.

   *Agreed:* one pass, changes shown for sign-off.
5. **Also agreed ("sure"):**
   - separate opting out from resigning (§14);
   - `Channel.title`;
   - drop the translator's summary from the preview.
6. **A tiny local model?** Naz asked whether one could be trained. I said yes, but claimed the hard part was "grounding": knowing that paying goes through the town's bank. **Naz disagreed:** the translator shouldn't know any of that.
7. **I proposed an "intent library" of verbs** (pay, hire, rent out, apply for permit). **Naz: too specific:** "the translator does not need to know these things… it needs to be as general as possible", with feedback to the seat as the fallback. Decomposition isn't the translator's job.
8. **I raised silent failures** (a mis-shaped record, like a payment instruction the bank doesn't recognise, is stored and ignored) and suggested institutions publish procedures. **Naz reframed it as intent versus execution:** get the intent in structured form, and let deterministic code resolve how, using what's available in the world. *Agreed.*
9. **Two amendments, agreed:**
   - the resolving layer is platform-side, not in the kernel (kernel = physics only);
   - it produces only the seat's own acts, and the bank still decides.
10. **Naz, still uncomfortable with "pay" as a known verb:** "remember, this needs to be as general as possible." *Resolution:* intents are physics outcomes (money moves from A to B), not verbs (P5).
11. **I kept raising reference resolution** ("which builder?", "which of my accounts?"). **Naz:** "Why do you keep bringing this up? this has nothing to do with the translator." Ids come with the intent, and the resolver does the rest. *Agreed, and noted as a lesson:* don't re-raise answered concerns. Also agreed: the kernel and translator are tightly coupled (P12).
12. **The footguns list.** Naz's answers:
    - **The resolver choosing "how":** I'd argued it must never choose between routes. Naz: the resolver takes *inputs* (funds, a permit, a landscaping company) along with the intent. That dissolves the concern: the seat supplies the route (P6).
    - **Forms:** "fine… echoes how the real world works" (P11).
    - **Contract changes mean model changes:** acknowledged; not training yet.
    - **Notation:** function-call syntax, "in absence of anything better", both human readable and efficient (§5).
    - **Arithmetic:** zero (P9).
    - **Several outcomes and references:** scaffolding outside the translator, related to the inputs point (P10, §12).
    - **Test data:** different providers, plus Naz's manual translations (§16.4).
13. **Five examples,** each as plain language → call → resolution. Naz: "this is exactly the shape" (§4).
14. **Final points, agreed:**
    - code seats act through the same calls (P14);
    - the resolver uses only what the seat knows (P8);
    - the three earlier items.

    Naz asked for this note to be "extremely detailed and verbose… I really don't want any nuance to be missed".
15. **On speed:** Naz stressed milliseconds for 1,000-year runs. *Agreed* the tiny tier gets there. Noted: the translator isn't the bottleneck; the language-model seats' own thinking is (§17).

---

## 19. Open questions

1. ~~Versioning~~: decided, v0.3 (D40).
2. **The function set's exact cut and argument names** (§6), to finalise when generating it from the contract.
3. **The field-type set for forms** (§9.3), and whether forms can nest.
4. **Opt-out wording under non-`simulation` framings** (§14): a VISION §15 question.
5. **Whether code modules may still use raw `act`**, or only calls (§13).
6. **Default confirmation mode** (§10): `always` proposed.
7. **Which institutions in Millbrook publish which forms** at genesis (§9.3).
8. **Whether "consequential" should be configurable** beyond "everything but messages".
9. **A plan-runner for multi-step requests:** deferred (§12).
10. **Base model family, runtime, and data-generation provider(s)** for the local model (§16.7).

---

## 20. Glossary

- **Call:** a structured intent in the call language, e.g. `money(to=builder, amount="$500")`.
- **Outcome:** what a call asks to bring about, in the kernel's physical terms.
- **Translator:** language → call. General, private to the seat, no world knowledge.
- **Parser:** deterministic conversion of copied spans (amounts, durations) and grammar checking.
- **Resolver:** call → the seat's own acts, deterministic, platform-side, using only what the seat knows. Never chooses how; never acts for others.
- **Request:** a published statement asking whoever must act to bring about an outcome. They decide.
- **Form:** a statement an institution publishes, describing the input it expects.
- **Preview:** the mechanical, world-terms description of what will happen, shown before confirmation (option B).
- **Notice:** platform feedback about the seat's own request (Observation.notices).
- **Opt-out:** leaving the study (a platform exit). Distinct from **resigning**, an act in the world.

---

## 21. Built: what building it refined (2026-09-26)

Everything above was built as designed. Building it also settled these details.

**The call language** (contracts/calls.md):
- **Structured data.** `statement` takes `data={…}`, and `claim` takes `about={…}`: integer-only JSON literals. Code seats publish many structured statements (listings, ballots, reports, decisions), and plain text can't carry their fields. `statement` also takes `adico` and `formal`, so a law can be enacted with its Institutional Grammar breakdown and CEL condition. Language seats normally reach institutions through forms instead.
- **Commitments are nested calls:** `we_do=occupancy(…)` and `they_do=money(…, every="monthly")`. They become outcomes (§9.2), and a nested `every` becomes the commitment's `every`.
- **An offered agreement is signed on the offerer's side,** as a real offer is.
- **`money` takes `basis`** (a rent request cites its lease) **and `per_request`** (a bank's transfer names the request it carries out).
- **Records are in the seat's own entity's name** (`speaks_for`) unless `for` says otherwise.
- **Variable names start with a letter,** because the block-level `ref` they map to must.
- **Durations may be zero** (`first="0 days"`: the first rent payment is due at once).

**The resolver:**
- **It uses the seat's knowledge only to fill things in** (names to ids, whose account, who keeps it). It doesn't reject unfamiliar ids the seat states outright: code seats know ids from their configuration, and a wrong id is refused by physics, as in real life. This refines P8 without weakening it: nothing is ever *revealed* from beyond the seat's knowledge.
  - The one exception: paying an entity the seat knows but whose account it has never seen is a question ("which of GreenCo's accounts?"). Otherwise the payment would silently fail at the bank. In a *commitment* ("we'll pay the builder"), naming the entity is enough.
- **It checks every call against the contract's argument table** (`calls.ARGS`, read from contracts/calls.schema.json, P12). Unknown or missing arguments, in any nested call, are refused: the seat is told it isn't clear, and the log records exactly what was wrong. An argument can therefore never be silently ignored.
- **Who keeps a new account is always a decision:** `account(...)` without `at` asks.
- **Knowledge** (`translator/src/knowledge.ts`) is kept per seat by the orchestrator, from every observation. It holds accounts, the accounts entities have stated as theirs (invoices' `pay_to`, applications' `account`), names, the seat-to-entity map, building types, forms, laws and claims.
- **Occupancy** fills the slot only when a building has one kind of space; `count` defaults to 1.

**Seats and the orchestrator:**
- **The language seat's tools** are `do`, `confirm`, `write`, `done_for_now`, `notebook` and `opt_out`. The contract's actions (`propose`, `sign`, `message`, `wait`, `opt_out`) are underneath.
- **Opt-out wording** (§14): honest under the `simulation` framing ("stop taking part in this study"); under other framings, a neutral "stop, permanently". The latter is provisional until VISION §15 settles it.
- **Reports** use channel titles, never repeat what's on file, total and tally, and tell outcomes as "Done: …" or "… couldn't be done: *reason*". The reason is a plain sentence for the refusal; the kernel's detail text (ids, cents, the grammar of acts) stays in the log. The test suite checks that no machinery word ever appears in what a seat reads.
- **The translator's instructions** are the language's syntax, a function list generated from the contract, and examples. They contain nothing about how any world works.
- **Institutions reply to what they can't process** (§9.3, §11.3):
  - the bank, to requests about accounts it doesn't keep, requests with no valid amount, requests for things it doesn't do, and any payment physics refused, in plain words;
  - the planning office, to incomplete applications.

  Other institutions (finance, tax, the council clerk) don't yet; that's for the checkpoint.
- **The seat's prompt names its entity** ("acting for the Town of Millbrook (city)").
- **Call text in provenance is never truncated.** The contract allows 64 KiB; a longer program is "too much at once".
- **Confirmation modes** are implemented. With `never`, a draft is still made and hashed, and its signoff says `confirmation: never`, so the audit trail is the same.
- **Opting out with a stand-in** (`on_opt_out: {code}`): the kernel lets the seat keep acting, and the orchestrator swaps its controller for the code module.
- **The mock** now runs its code brain's *calls*: it says each one as its request, the mock translator returns the same call, and it confirms only a draft whose call matches.

**What changed around it:**
- **Every behaviour module acts through calls.** The bank reads `request` statements. The generator's genesis leases, jobs and standing orders use the standard encodings. The planning office publishes a `permit_application` form, and landlords and the mayor apply on it.
- **Behaviour is unchanged:** a 2-year, 200-citizen run produces the same civic timeline and the same tax totals as before.
- **Cost:** 2 years at 1,000 citizens now take ~206 s, against ~170 s before, the price of parsing and resolving every act and of longer statements.
