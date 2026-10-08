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

`worlds/profiles/au-vic-2026.json` (a town in regional Victoria, Australia, as of September 2026) was the first; eight more places were written on 2026-10-08. A profile's structure:
- **`values`**: the figures, in the world's units (money in the currency's smallest unit; rates in basis points or per 10,000; configs are integers).
- **`sources`**: a source for every value, keyed by its dotted path (a key covers everything under it). A figure without a source says it's a placeholder, and why.
- **`targets`**: what that place's outcomes look like, with sources: measured against, never set (docs/calibration.md).

A town spec names its profile (`profile: au-vic-2026`); a spec can override a figure for an experiment (wages, households), and that override is the spec's, not the profile's.

**Adding a place:** copy a profile, replace every figure with that place's, with sources; mark what you can't source as a placeholder. Nothing else changes. If a place needs something a profile can't express (a payment that falls as income rises, say), that's a change to the rule (a module parameter or a law's form, documented), made generally.

## A place's laws on pay and support, and when people stop work (2026-10-08)

Three things a profile states as its place's own rules, in forms general enough for any place. Each is published in the town as a law that its office reads; none is a module's setting.

- **Tax on pay** (`public_finance.income_tax.charges`): the law's list of charges, each with what it is charged on, its schedule, its reliefs, and whom it is paid to (`paid_to`: one of `public_finance.funds`, the place's named funds and bodies; `"town"` for a local tax; nothing said: the general government). The forms are in docs/behaviour/public-finance.md. Sums are a year's.
- **Support payments** (`support.payments`): the law's list of payments, each a rule in three parts: who qualifies, how much, for how long; and how often it is paid and from where (`paid_from`: a fund, or the general government). The forms are in docs/behaviour/boundary.md (`world.transfers`). A payment reckoned from a record of contributions needs a charge that is reported worker by worker (`itemised`); the generator refuses a profile that has the one without the other.
- **Stopping work** (`labour_force_share_by_age`): the share of people in the labour force by age band, from the place's labour force survey; the first band is the reference. Each person in the labour force is given their own age of stopping, drawn so the shares by age come out as the survey's (docs/behaviour/citizen.md, "Stopping work"). Left out, everyone stops at `retirement_age`. With it, `retirement_age` is still the age the profile's other figures by age turn on (the retired's savings, a retirement fund's access) and the top of the working ages the measures use; the pension's age is the payment's own, and so is the last age of a payment for those out of work.

**Moving a figure into these forms, and saying a rule truly.** An author states a rule as the law states it where the source gives it; where the source gives only a typical sum or an approximation, the author keeps that as a stand-in and the source note says what the true rule's form would be. Every note that was changed on 2026-10-08 ends with what was moved, what was said for the first time and from what, and what is still a stand-in.

## What a profile states, and what the generator derives

A profile states what can be observed in a place: wages, rents, prices of real things, rates, shares, ages, how its institutions work. The generator derives the rest by formulas that are the same everywhere. An author never picks a scale.

**Stated:**
- **Pay.** `pay_period_days` (how often wages are paid: 14, 30...) and `wages_per_pay_period` (a full-time gross wage for one period, by kind of work; likewise the doctor's, the teacher's and the officer's). State the place's own period and its own figures; nothing is converted to another place's period.
- **The working week.** `ordinary_hours_per_week` is the week a full-time wage is pay for: what people there work. It is not a legal ceiling above that (a 48-hour maximum is not a 48-hour week). The generator spreads it over the days of the week people work (`round.work_days`), so it has to fit the round's working hours.
- **Shares of output** (`industry`): manufacturing's labour and input shares, retail's purchases and labour shares.
- **Prices of real things**: inputs and building materials by the kilogram, energy and water by their units.
- **What organisations other than firms hold on the first day** (`opening`: the bank, the town, the builder, a landlord) and the least a working adult has saved. These are still stated sums, and they should be ones that make sense against the place's wages.

**Derived (don't state them):**
- **An hour's pay**: a period's pay over the hours worked in it (the working week, by the pay period).
- **An item of goods.** Goods are counted in items, the town's own unit and no real thing: by default an item is what half an hour of factory work makes, so its price at the factory gate is that work's pay over manufacturing's labour share. Its time to make, its inputs, the shop's price and the time to serve it follow from the profile's shares. The unit's size changes no outcome (tested: twice the price is half the items, the same money and the same staff). `prices.goods_world` may be stated to fix the unit (the first profile's item is 100.00); the generator then checks it is a size whole numbers can carry (an item's seconds of work and units of inputs within 5% of what the shares give, and no more than a working day's work) and refuses the profile if not, saying so.
- **A firm's opening money**: its working capital. A shop's is a month's stock and three months' wages for its opening staff; a factory's is a month's wages and a month's inputs for its opening staff. A profile that states `opening.shop` or `opening.factory` is refused. (Until 2026-10-08 a factory's was a stated sum, and whether a town worked turned on how that sum happened to compare with half a month of its factories' inputs: see the decisions log, "A town from any place".)
- **What the town's shops expect to sell**, their opening staff and stock, and the world market's demand for the factories' goods: from wages after tax, pensions by how often they are paid, and the rent of the homes that are let.

## What a place may not have

A place that has no such institution leaves the figure out. Nothing is stated as nought to stand for "none":
- no payment to the unemployed: leave it out of `support.payments` (nobody claims one, none is paid or counted); no payments at all: an empty list, and no support law is written;
- no tax on pay: an empty list of charges (no law is written, nothing is withheld);
- no landfill charge: leave out `services.landfill_levy_per_tonne` (no budget line for it);
- no serviceability buffer: leave out `credit.serviceability_buffer_bps`;
- no rule on rent increases: leave out `tenancy.rent_review_months` and `rent_increase_notice_days` (no such law is written; `tenancy.rent_review_practice_months` says how often landlords review rents anyway, if they do);
- no ballot before industrial action: leave out `industrial_action.ballot_turnout_bps` and `ballot_pass_bps`; with `notice_days` alone the law requires notice only, and with none of the three there is no such law;
- no retirement fund: leave out `retirement_fund` (and a town doesn't ask for one);
- voting required by law or not: `elections.compulsory_voting` (the town's election law says "must" or "may").

Still required, though some places lack them (to do): a union, council rates, a clinic and school funded from outside.

## Guardrails

- **`orchestrator/test/generality.test.ts`:**
  - platform code (kernel, participants, orchestrator, translator, measure, the generator, contracts) must not name a place, its statistics offices, agencies, payments or currency;
  - platform code (kernel, participants, orchestrator, translator, measure) must not write a currency's sign or its words: a world's money is written as its config says (`world.currencies`: its sign, its words, its decimal places), which a profile supplies. The test lists what it leaves alone, and why. The translator's instructions are among what it checks (they name no currency and are the same for every world: the translator copies an amount as written, and the parser, which has the world's currency, reads it);
  - every figure in every profile must have a source;
  - a town must generate from every profile, taking its figures from it;
  - platform code must not name any of a generated world's entities, accounts or buildings: a module is told whom it deals with (its parameters), and `need()` fails at once if a world doesn't say.
- **CLAUDE.md** states the rule.
- **Reviews:** a new place-specific figure goes in a profile, with its source, or it doesn't go in.

## Known exceptions (to fix)

- **A currency's block does not say how its place writes numbers.** It has the sign, the code, the words and the decimal places; it has no field for the decimal mark (a comma in much of Europe and Latin America), for how digits are grouped (in twos after the first three, in India), or for a sign written after the amount. So every world's amounts are *shown* one way (the sign first, commas between thousands, a point before the decimals: `formatMoney`), whatever its place does. They are *read* in every way that can only be one number (`parseAmount`, and the kernel's `parse_amount`; contracts/calls.md says which; contracts/test/amounts.json holds both to one table): the sign before or after, "1.234,56", "12,50", "1,50,000", "5 lakh". What can't be told without the field is refused, not guessed: "1.234" (a decimal point with a digit too many, or thousands). Proposed, not added: optional `decimal_mark`, `grouping` and `symbol_after` on a currency (docs/decisions.md, 2026-10-08, "The translator reads any world's money"). The training data's invented worlds already say these of themselves (translator/train/data.ts, `Writing`).
- **Other signs and abbreviations a place uses for its money** ("Rs", "A$", "p") are read only if the profile lists them among `unit_words`, which takes letters alone.
- **The finance officer's module still has a default for the payment its procedure needs approval over** (`approval_over`); the generated town now gives it from the profile, but the default should go.
- **Names:** the helper that words an amount is still called `usd`, and an amount in the smallest unit `cents`, across the behaviour modules (about 400 uses). They write whatever the world's currency is; the names are one place's. Not renamed on 2026-10-08, when the measures' money columns were (`money_in`, `money_out`, `paid_to_town`, in the world's own currency by `runs.minor_units`): several branches were editing those modules at once. A mechanical rename for a quiet moment.
- **Sums rounded to a figure that suits a currency with two decimal places and wages in the thousands:** a firm asks its bank for working capital to the nearest 100,000 of the smallest unit, a household for 10,000 (firm.producer, firm.retailer, citizen.default). Harmless where amounts are larger; coarse where a wage is a few thousand of the smallest unit. To derive from the wage.
- **Module defaults in money and in items** (a wage of 150,000, a price of 6,000, essentials of 40,000, a wholesale order of at least 50 items, a household's fortnight of 10 items for how well subsistence is met): placeholders the generated town overrides, except the last two, which are counts of items and so depend on the unit's size where a profile fixes it.
- **Shopping is fortnightly** (citizen.default buys every 14 days) and a job's notice is 14 days, whatever the pay period.
- **How money is written** is one convention: the sign before the amount, thousands in threes with commas, a full stop before the decimals (`formatMoney`, and the resolver's twin). Not every place's.
- **The profiles' own notes on `opening`** still mention a shop's and a factory's opening sums (removed from the figures on 2026-10-08; the prose is their authors').
- **Three profiles state a working week longer than their daily round** (gb-eng-2026: 48 hours over five days of 9 to 5; mx-jal-2026: 48 over five; ke-nakuru-2026: 52 over five days of 8 to 5): each gave the legal ceiling. The town generates and runs (a wage buys the hours stated), but the day is longer than the round shows. For their authors.
- **Figures of nought still standing for "none" in the profiles as written** (a profile can now leave the thing out; the figures are their authors', so they were left for them): a landfill charge of 0 (de-ni-2026, in-tn-2026, ke-nakuru-2026); a serviceability buffer of 0 (us-oh-2026, de-ni-2026, in-tn-2026, mx-jal-2026); ballot figures of 0 (in-tn-2026: both; de-ni-2026: turnout) and a notice of 0 days (us-oh-2026, de-ni-2026). Until they are left out, those towns have a levy line of nothing and a ballot law that binds nothing. (The payment of nought to the unemployed in three profiles is gone since 2026-10-08, and so is the levy of nought on pay in two.)
- **Every profile states `pay_period_days` 14**, with wages its author converted to fourteen days: where pay is monthly, the author restates the wages for a month and sets 30.
- **Stated sums that should follow from wages** and still don't: what the bank, the town, the builder and a landlord hold on the first day, the least a working adult has saved, and the retired's savings (`opening`, `retiree_savings`). Each author scaled the first profile's by a wage ratio.
- **Some rules were modelled on one country's institutions:**
  - the stand-ins that remain in the profiles' support payments and taxes (each note says which): a family transfer paid as a flat payment to those out of work (br-mg-2026), a means-tested pension paid to everyone (in-tn-2026), tariffs approximated by steps (de-ni-2026, jp-akita-2026, br-mg-2026);
  - Victoria's rules in the example legal code.
  - the retirement fund's rules, in a world that has one (`fund.retirement`, off by default: a pension of at least a yearly share of the balance, rising with age; paid from the age people here stop work), after Australia's account-based pensions.

  The rules are general in form, but they were chosen with one place in mind. As a second profile is added, each should be checked.
