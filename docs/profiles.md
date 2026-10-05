# Profiles: where a place's figures live

Oikos is a general platform. **Its code is the same for every place and time.** Everything true of one place (its census shares, life tables, wages, rents, support payments, industry shares, currency) lives in a **profile**, with its source, and reaches a world through its generator.

## The layers

| Layer | Holds | Place-specific? |
|---|---|---|
| Kernel and contracts | Physics: money, goods, work, records, time | Never |
| Behaviour modules (`participants/src/behaviour/`) | General rules ("a person retires at an age and claims support"; "a shop restocks by Lengnick's band") with neutral names. Defaults are placeholders or "none" (e.g. no retirement age unless the world sets one) | Never |
| Generators (`worlds/generator/`) | A general procedure for making a kind of world (a town) from a spec and a profile, deriving what it needs by general formulas (hours per item from an industry's labour share and a wage) | Never |
| **Profiles** (`worlds/profiles/<id>.json`) | Every place-specific figure, each with its source, and the calibration targets for that place | **Yes: this is where a place lives** |
| Specs (`worlds/*.yaml`) | A world's shape: how many people, homes, shops; which profile | Only by naming a profile |
| Worlds' content (laws, `worlds/law/`) | A world's legal code, as records | Yes, as content |

A model's parameters from the literature (Lengnick's Table 1, the Bank of England model's rent share) are rules' parameters, not place facts, and belong with the rule. Where a rule is modelled on a real place's institution (a registry of deaths), the module says so in its doc (docs/behaviour/), not in code.

## A profile

`worlds/profiles/au-vic-2026.json` (a town in regional Victoria, Australia, as of September 2026) is the first. Its structure:
- **`values`**: the figures, in the world's units (money in the currency's smallest unit; rates in basis points or per 10,000; configs are integers).
- **`sources`**: a source for every value, keyed by its dotted path (a key covers everything under it). A figure without a source says it's a placeholder, and why.
- **`targets`**: what that place's outcomes look like, with sources: measured against, never set (docs/calibration.md).

A town spec names its profile (`profile: au-vic-2026`); a spec can override a figure for an experiment (wages, households), and that override is the spec's, not the profile's.

**Adding a place:** copy a profile, replace every figure with that place's, with sources; mark what you can't source as a placeholder. Nothing else changes. If a place needs something a profile can't express (a payment with a means test, say), that's a change to the rule (a module parameter, documented), made generally.

## Guardrails

- **`orchestrator/test/generality.test.ts`:**
  - platform code (kernel, participants, orchestrator, translator, measure, the generator, contracts) must not name a place, its statistics offices, agencies, payments or currency;
  - platform code (kernel, participants, orchestrator, translator, measure) must not write a currency's sign or its words: a world's money is written as its config says (`world.currencies`: its sign, its words, its decimal places), which a profile supplies. The test lists what it leaves alone, and why;
  - every figure in every profile must have a source;
  - a town must generate from every profile, taking its figures from it;
  - platform code must not name any of a generated world's entities, accounts or buildings: a module is told whom it deals with (its parameters), and `need()` fails at once if a world doesn't say.
- **CLAUDE.md** states the rule.
- **Reviews:** a new place-specific figure goes in a profile, with its source, or it doesn't go in.

## Known exceptions (to fix)

- **The translator's prompt gives its worked examples in one currency** ("$9,000"; translator/src/index.ts), and the training data's other ways of writing an amount are that currency's (translator/train/data.ts): a world in another currency would be translated from examples in the wrong one. To write from the world's currency, once the prompt has settled.
- **The finance officer's module still has a default for the payment its procedure needs approval over** (`approval_over`); the generated town now gives it from the profile, but the default should go.
- **Names:** the helper that words an amount is still called `usd`, and an amount in the smallest unit `cents`, across the behaviour modules. They write whatever the world's currency is; the names are one place's.
- **Some rules were modelled on one country's institutions:**
  - the Age Pension's age window, as the support payments' eligibility;
  - Victoria's rules in the example legal code.

  The rules are general in form, but they were chosen with one place in mind. As a second profile is added, each should be checked.
