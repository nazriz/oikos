# What a firm or a landlord wants

**Source:** `participants/src/behaviour/orgwants.ts` (`Org`, `characterOf`, `keeping`); the levers in `firm.landlord` (0.14.0), and, through `Staffing.asked`, in `firm.retailer` (0.10.0) and `firm.producer` (0.5.0), all in `participants/src/behaviour/`. **Design:** docs/design/ai-citizens.md 10a ("Every entity, not only people"). **Decision:** docs/decisions.md, "Wants and initiative" (2026-10-11).

**Only for an organisation that takes initiative:** each draws once, from its own stream, against the world's dial (`dials.initiative_bps`), as a person does. One that does not, and every organisation in a town with the dial absent or at 0, has no character and no record, answers nothing, and does exactly what its routines say ([firms.md](firms.md), [retailer.md](retailer.md), [producer.md](producer.md)).

## Whose wants, and who acts on them

An organisation's wants are the organisation's: they are held in **its own record** (the kernel's, as a person's is), not in the record of whoever runs it. They are acted on by whoever holds its posts: today the code of its manager's or letting office's post.

**Who may write an organisation's record.** The bookkeeping of the one post of the organisation that the world's config marks as keeping it (`keeps_record` on the position; at most one an organisation), and nothing else: not another post of the same organisation, not someone who does not hold the post now, not a model in the post (its bookkeeping stays platform code), and nothing reachable through the participant API (docs/behaviour/citizen.md, "The record"; contracts/README.md). The generator marks the letting office of each landlord and the manager's post of each shop and factory, for a town whose spec has `living`. A business its owner runs alone is held by a person, whose record is their own: the business has none. A business founded in a run takes its founder's values and, since 2026-10-11, keeps a record of its own: the post made with it says so (below).

## Character: from the owner's values

How much each of six standing wants weighs with an organisation is drawn from the values of **whoever owns most of it** (the largest holder on its register of shareholders, [firm-ownership.md](firm-ownership.md)), where that is a person of the town; the generator gives the post those values as the world's content (`owner_values`), as a town's people are given theirs. Held from outside, or by nobody of the town: the town's mean, and it behaves as its routines say. Each weight is a mean of how far the owner sits from the town on the values that speak to it, in standard deviations:

| Want | From the owner's | 
|---|---|
| to keep trading | security, tradition |
| to grow | achievement, stimulation, power |
| to keep a customer, a tenant or a worker | benevolence, conformity |
| to be rid of one | power, less benevolence |
| to pay less | power and achievement, less universalism and benevolence |
| to be thought well of | conformity, benevolence, universalism |

The mapping is ours, to test against data. That owners' values show in how their firms treat staff and those they deal with is the upper-echelons finding (Hambrick and Mason 1984; values of small-firm owners and their firms' conduct: to confirm in docs/research/references.md). Two shops alike in everything but their owners do not behave alike: `participants/test/firm-wants.test.ts` shows it for two shops asked for a rise, and for two landlords asked to hold a rent and listing an empty home.

## What character does

Its routines remain what an organisation does when no want presses. Character moves them in two ways.

**It decides how the organisation answers when someone asks something of it.** A tenant or a worker who takes initiative may ask the other party to an agreement to vary it (docs/behaviour/citizen.md, "Wants and initiative": a letter of kind `variation_request`, resting on the paper or agreement, saying in typed terms what they would have). The organisation answers in writing (`variation_answer`: granted or not), and, saying yes, does it:

| Asked | The rate at the town's mean | Swayed by | Saying yes |
|---|---|---|---|
| A landlord, to hold a rent it has given notice of raising | `hold_bps` 3,000. **Placeholder**: one survey of renters in difficulty in 2020 is reported as about 27% trying to negotiate and about 10% of all renters succeeding (source not identified: to confirm) | keeping a tenant and being thought well of, less growing; a tenant not in arrears counts half a standard deviation more, one in arrears one less | the notice is withdrawn; the rent stays as it was |
| A landlord, to let a tenant under its notice stay | `stay_bps` 3,000. **Placeholder** | the same, less being rid of them | a new lease is offered from when the old one ends, at the rent then |
| An employer, for a rise | `rise_bps`: the profile's share of those who asked and got one (`outlook.asked.rise_granted_bps`), where it has one. The first profile: 1,800 (of Australian workers who asked for a rise, 20% of men and 16% of women got one: Artz, Goodall and Oswald 2018, on the Australian Workplace Relations Survey 2013-14; the university's summary opened, the paper to confirm). No figure: 3,000, a **placeholder** | keeping a worker and being thought well of, less paying less; up to a standard deviation more for one long with it, less for one newly come | their wage order is replaced by one at the wage asked, from the next pay day; only where what is in the bank covers `rise_cover_periods` (3) pay periods of the new wage bill |

Each standard deviation of the lean moves the rate by `answer` (half of it), held to three; the draw is the organisation's own, keyed by the request.

**It sways the routines' own levers, about the town's mean.**

| Lever | Sway | Note |
|---|---|---|
| A landlord's markup on what similar homes let for (listing an empty home; a rent review) | more for one that would grow, less for one that would keep its tenants (`markup` 0.3 a standard deviation) | symmetric: the town's rents stay where the markup put them |
| How long a landlord bears with arrears before giving notice | a month longer for each two standard deviations by which it would sooner keep a tenant than be rid of one (`patience_months` 0.5) | **only lengthens**: under its routine's two months a landlord's books cannot tell a payment a few days late from one not made. So a town with wants gives a little less notice for arrears than one without: not symmetric, and said in the calibration |

**Its wants in the record.** A tenant whose rent is as far behind as the routine calls arrears, at two looks a week apart, is something the landlord wants settled (`arrears`, about that tenant, seeking money): heavier for one that would be rid of them. It is met when they pay, and gone after by giving notice when the landlord's patience runs out. The record also holds the organisation's character (about 5,000 each: the town's mean owner), the last eight things that happened to it (a rent held or not, a rise given or not, notice given), and counts of what it granted and refused. `oikos dataset` writes what became of its wants beside people's (`wants.jsonl`, rows marked `organisation`).

## Asked to put something right, told of a complaint, ordered to

In a town where things go wrong ([frictions.md](frictions.md)) an organisation is asked to repair a home, to make up pay it kept back, to refund goods; a venue tells it of a complaint and may order or recommend. One helper answers for all of them (`Respondent`, frictions.ts): its books say what is true where they can, and its character says what it does: keeping those it deals with and being thought well of, against paying less, half the rate a standard deviation (`respond.sway`). The rates are the profile's.

**An employer begins to pay short** by the same character: each week, each of its staff, with the profile's yearly chance swayed by how far it would pay less (a whole standard deviation doubles it or brings it to nothing), and twice over while it has less in the bank than two pay periods' wages. What it keeps back is on its books and it does not deny it.

**A landlord owed rent goes after it** (its `arrears` want was born and never pursued before: 42 such wants in the first living pilot, none acted on). When the want is born it writes to the tenant (`review_request`, the sum and where to pay). A month on, if it would sooner keep the tenant than be rid of them, and it can see a body that says it hears arrears, it applies there for an order to pay, with the lease to show and the fee if there is one. One that would sooner be rid of them does not: its routine's notice comes when its patience runs out, as before. Each step is in its record as the way its want was gone after (`ask`, `desk:<venue>`, `notice`).

**A business founded in a run keeps a record** now: the post made with it says so in its role module (`keeps_record`), and the kernel takes the organisation's record from that post's bookkeeping while its founder holds it (contracts/README.md). Its character is its founder's values, as before.

## Parameters

`initiative` (none: its own draw against the dial), `owner_values`, `values` (the town's figures the owner's are read against: the world's), `org`: `hold_bps` 3000, `rise_bps` 3000 (the profile's, where it has one), `stay_bps` 3000, `answer` 0.5, `markup` 0.3, `patience_months` 0.5, `rise_cover_periods` 3, `wants` (as a person's).

## Leaves out

- A shop's or a factory's prices, wages offered, stock and lay-offs are as their routines have them: character does not yet reach them (the wage a firm posts is the profile's, and moving it by owner would move the town's wage). Growing (a second shop, more staff than the routine asks) and keeping a customer (serving a regular first when short) are not built.
- The builder, the bank, the union, the clinic, the school and every office of the town have no wants of their own.
- A change of owner does not change character (the values are given when the world is made, or by the founder).
- An employer asked for time, or to take someone back; a landlord asked for a lower rent with no notice of increase standing; a bank asked for time on a loan.
- A rise given to one worker is not known to the others (it is between the two of them, as the papers are).
