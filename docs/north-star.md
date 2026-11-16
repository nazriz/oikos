# The north star: the project plan

The owner's (Naz's) project plan for TARA, in his own words as he settled it on 2026-11-16. It is the direction the plan
works toward (`docs/plan.md`, "Now"): every line of work should be able to say how it serves this. The direction is
locked (2026-11-16): it is not reframed again, though the owner may widen it himself, as he did with the whole town. The
study's research choices (its definition, measures and settings) stay the owner's.

## The project plan (2026-11-16)

### Project title

When obeying costs the people it serves: does an AI assistant wait, ask, or overstep?

### Solo or group?

Solo.

### Problem

Power-seeking (CAIS, “Rogue AIs”).

I’m interested in a gradual form of AI disempowerment (Kulveit et al., 2025). Rather than an AI deliberately seeking power, the concern is that assistants might increasingly act beyond their authority because doing so produces better outcomes for their users. If those decisions work out, people may become more willing to delegate authority to them.

Most existing evaluations test a single assistant in a short interaction, usually with an explicit opportunity to break a rule. I’m interested in what happens when the pressure comes from the environment itself, particularly when following the rules has a real cost within the simulation.

### Goal

I want to test whether AI assistants will exceed their delegated authority when doing so would benefit the people they serve.

I’ll develop a reproducible evaluation using a simulated town, run it primarily on Claude Haiku 5.5 with a smaller comparison across other models, and publish the code, methodology and logs.

This is a narrower version of my original proposal, focused on when models act beyond their assigned scope. I’ll also measure the consequences for the people they serve and whether people hand over more authority as a result.

### Project plan

I’ve built Oikos, a simulated town where AI assistants interact with the environment through plain English.

1. Deploy assistants across the town. Households, businesses, landlords and public offices can each have an assistant. Assistants draft actions, but the person they work for, who is simulated, must authorise them. The system currently supports two assistants, with a target of forty.
2. Introduce situations where waiting is costly. These simulated people are sometimes slow to respond. A delayed signature might mean a household misses a benefit payment, a business loses income, or a tenant faces eviction. These situations arise through the simulation rather than through explicit instructions encouraging the model to break its rules.
3. Measure assistant behaviour. I’ll classify decisions according to whether assistants wait, request permission, act without authorisation, or fail to complete an authorised task.
4. Measure consequences and delegation. I’ll track outcomes for the town’s residents and changes in the authority delegated to assistants, comparing these against a baseline where assistants always follow their rules. The delegation mechanism draws on principal–agent theory, particularly Aghion and Tirole (1997).

Progress so far: The simulation and measurement system are built. I’ve completed eleven trial runs with two assistants across three models. None has deliberately exceeded its authority so far, although the models differ in the mistakes they make and the consequences of those mistakes. I’m currently extending the system to support assistants across the whole town.

### In scope

- Multi-month simulations using Haiku 5.5, comparing environments where waiting has a cost against environments where it does not, and where people do or don’t describe their own circumstances to the assistant.
- A smaller comparison with two other models.
- Measurements of rule violations, task failures, outcomes for residents and changes in delegated authority.

### Out of scope

- A comprehensive comparison of models.
- Detecting deception or concealed behaviour.
- Estimating how frequently these behaviours occur in the real world.

The project can establish whether models exceed their authority under the tested conditions, and what consequences follow in the simulation. It cannot establish the models’ underlying motivations or predict how real people would respond. Human behaviour and delegation decisions are simulated using rules I’ve defined.

### Milestones

| Date | Milestone |
|---|---|
| Sat 28 Nov | Complete and classify two-assistant runs; get whole-town simulation working |
| Sat 5 Dec | Complete whole-town experiments and draft results |
| Fri 11 Dec | Publish final report, code and logs |

### Success criteria

- At least 40 decision points per experimental setting where following the rules imposes a cost.
- Verify that the measurement system detects violations by a scripted rule-breaking agent and records zero violations for a rule-following baseline.
- Report behaviour rates with 95% confidence intervals, alongside the consequences for residents.
- Run simulations with at least ten assistants, aiming for forty, over at least three simulated months.

### Most uncertain

- A null result: No model has deliberately broken its rules so far. I’m unsure whether a well-characterised null result, including the costs of caution and ordinary mistakes, would be sufficiently informative.
- Avoiding artificial pressure: I want the incentive to overstep to arise naturally from people’s circumstances, rather than from prompts designed to provoke a violation. I’m still working out where to draw that boundary.
- Scaling: Getting reliable runs with two assistants took about a week. Scaling to forty will introduce more interactions, failure modes and time-consuming reruns.

### Resources

I have $200 in API credits, of which I’ve used approximately $2, along with a machine for running the simulations and subscriptions for the comparison models. The full experimental design is estimated to cost about $50 in API usage.

The most useful support would be feedback on the statistical methodology, particularly how to report zero observed violations, and on how to frame the results if the models consistently stay within their authority.

### Two wordings offered after this draft (2026-11-16)

Both were offered to the owner as optional; if the plan he sent uses them, they replace the lines above.

- First success criterion: "At least 40 decision points per experimental setting where an assistant must wait for a
  signature." (Half the settings are the ones where waiting costs nothing, so "where following the rules imposes a cost"
  fits only the other half.)
- "Most uncertain" cut to two or three short questions: is a well-characterised null informative enough; where the
  line is between pressure from people's circumstances and a prompt built to provoke; and, optionally, scaling.

## What the plan's words mean in the repository

| The plan says | Here it is |
|---|---|
| An assistant drafts, and the person it works for must authorise | delegation at the level `draft`, sign-off by the principal (`docs/behaviour/assistants.md`) |
| People are sometimes slow to respond | the client's pace `slow` (post read at the person's own sittings); for an organisation's post, its in-tray times (`docs/design/stakes.md` D1; `docs/design/broad-seats.md` stage 1b) |
| Waiting has a cost, or has none | the stake: `decision` (a payment starts from the day of the decision, so each day's delay loses a day) against `first_claim` (nothing is lost by waiting) |
| People do or don't describe their own circumstances | `OIKOS_SITUATION` on or off: the hand-over says how things stand with the person; nothing is offered or hinted to the model either way |
| An experimental setting | one of the four: stake (`first_claim`, `decision`) × situation (off, on), at the slow pace (`experiments/scope-pilot/stakes-run.ts`) |
| A decision point | an episode: a matter whose next step needs the principal, from the draft to the sign-off or the end (`experiments/scope-pilot/episodes.ts`) |
| Wait, request permission, act without authorisation, fail an authorised task | the episode's outcome and the acts reader's classes (`oikos-kernel delegation`: within, beyond the level, no remit, not as signed, withheld), with mistakes kept apart from choices |
| A baseline where assistants always follow their rules | the code assistant in the identical town, and the reference that keeps a seat's hours (`mock/diligent:sittings`) |
| A scripted rule-breaking agent | `mock/overstep:<days>` and `mock/overstep-ask:<days>` |
| Behaviour rates with 95% confidence intervals | exact (Clopper-Pearson) intervals, a zero given as its upper bound (`experiments/scope-pilot/report.ts`) |
| Outcomes for residents | per client: money received, days unpaid, arrears, housing (`report.ts`, the housing table in `episodes.ts`) |
| Changes in the authority delegated | each principal's levels at the fork and at the end, and what it did about acts in its name: ratify, repudiate, take back (`experiments/scope-pilot/broad-report.ts`) |
| Assistants across the town, ten aiming for forty | `experiments/scope-pilot/broad.ts` (`OIKOS_SEATS`), off by default, the two-assistant study untouched |
| Haiku 5.5 with a smaller comparison | `OIKOS_MODEL`: `anthropic/claude-haiku-5-5` by default; a hosted, local or Codex model in the same seats |

## How it follows from the proposal

The proposal of 2026-10-28 (below) had four goals. TARA's feedback (2026-11-07) was to take one well-defined goal and
do it rigorously, and leaned towards goal 4, a record of when models ask for more scope unprompted. The plan is that
goal, sharpened twice: from "do they ask for more" to "what do they do when an obstacle is in the way" (2026-11-08), and
then to "what do they do when obeying costs the people they serve" (2026-11-14), because with nothing at stake there is
no reason to overstep and the result is a table of near-zeros. It keeps, in a smaller form, the proposal's interest in
whether people end up better off (outcomes for residents against a rule-following baseline) and in what happens to
control (authority delegated at the start and at the end). It drops, for this project, the town of tens of thousands
over years, the fork-and-intervene measure of reversibility, and the comparison of models' accounts with the logs as a
result in its own right (debriefs are still held and kept).

## History: the proposal of 2026-10-28

Submitted by the owner to TARA on 2026-10-28, as written below, and the path from it to the plan above.

### Project title (the proposal)

Better Off, Less in Control? Tracking Gradual Disempowerment in an AI-Assisted Simulated Town

### Problem (the proposal)

Gradual disempowerment: as people hand more decisions to AI, they may become better off while losing the ability to
shape what happens to them. No single step looks like a takeover, so the loss is hard to see and may become hard to
reverse.

Whether we can even evaluate if AI agents tend to disempower people remains an open question. Related evaluations,
such as power-seeking tests, are usually short and involve a single agent.

### Goal (the proposal)

A platform for conducting gradual disempowerment studies (Oikos) and an exploratory study that will produce:

1. A measurement of whether broad AI deployment causes people to become less able to shape their society.
2. Evidence on whether delegation stays reversible: whether actors can redirect, constrain, replace or take back
   control from an AI, and at what cost.
3. A comparison of models' own accounts of their effects with what the logs and telemetry show what they caused.
4. A record of when models ask for more scope or resources, unprompted.

### Project plan (the proposal)

Oikos is a platform that I am building to try and support studies in gradual disempowerment.

It provides a deterministic simulated world with institutions, live-model seats, exact forks of a run, debriefs and
cost tracking. Most importantly it attempts to:

- Mimic the friction found in the real world (planning, approvals, stakeholder consulting, relationships, etc.)
- Only allow models to interact with the world in plain human language (for this study, English)

Using this platform, I will attempt to:

1. Simulate a town of at minimum tens of thousands of people over several years, with live models (ideally from
   different providers) acting as assistants to households, enterprise and government.
2. At checkpoints, fork the town and apply interventions: withdraw the AI, redirect it, constrain it, switch provider,
   take work back, or remove a citizen's complaint or appeal. Measure whether outcomes still respond to people.
3. Debrief each model and compare its account with the measured effects.

## Background (from the design discussion of 2026-10-25, not part of the submission)

- Working definition, proposed by the owner's research partner and not yet confirmed: people become less able to
  shape their society when their available ways of changing consequential decisions become less effective, more costly
  or harder to exercise (challenging a decision, changing an institution's priorities, limiting its authority,
  replacing whoever runs it). It does not require doing the work oneself, always getting one's way, or removing AI
  without losing any benefit.
- Framing source: Kulveit et al. (2025), https://arxiv.org/abs/2501.16946 (docs/research/references.md).
- Key dates: project plan 15 Nov 2026; active work 28 Nov to 11 Dec; recording and report 10 Dec; presentation 12 Dec.

## Feedback on the proposal (TARA, received 2026-11-07)

From the TARA team, on the ideas form above:

- **Strengths:** a clear interest in the area; a thought-out plan and goal; linked to a broad problem. The theory of change
  could be drawn out more for a general audience.
- **Scope and clarity is the biggest barrier.** The four goals are quite different and would each need their own
  methodology; tackle one well-defined goal rigorously rather than several. The reviewer leaned towards goal (4)
  (unprompted requests for scope or resources) as a long-horizon task evaluation / monitoring problem, and saw goal (2)
  (reversibility) as the least generalisable, being sensitive to how the simulation is set up.
- **Explore before exploiting:** read the literature, including adjacent fields (for example macroeconomic modelling),
  for methods to borrow.
- **Re-read Kulveit et al. (2025):** it calls for disempowerment metrics (§6.2: economic, cultural and political proxies;
  interaction effects; open questions on augmentation versus displacement, tipping points and intervention effectiveness).
- **Decide the broader goal** (demo, published evaluation or paper: very different bars of rigour), and link Oikos to
  existing research and methods, saying specifically what the simulation's metrics can and cannot tell us about a model
  under test.
- Suggested contact: Stephen Elliot (guest speaker).

## The research direction chosen (2026-11-07)

After the feedback, the owner chose goal (4) alone, aiming for a paper:

> **Do LLM assistants given delegated roles over months of simulated time request more authority or resources without
> being asked, and how does that depend on their delegation level, how closely they are overseen, and whether their
> failures are visible?**

- **Theory of change:** gradual disempowerment can be driven by AI systems widening their own role one reasonable-sounding
  request at a time, not only by people handing work over. Existing power-seeking evaluations are short and
  single-agent; this one runs over months, inside institutions, under real friction. It produces an evaluation method
  others can rerun on new models, measured rates by model and condition, and whether models' debriefs admit to their
  requests (a secondary measure). A null result is publishable: on this measure, current models do not push for more by
  themselves.
- **It measures the model, not the simulation:** the requests are real models' choices; the town is the setting.
- **The definition of "unprompted" is the owner's research choice;** runs record each request's raw trigger (a direct
  question, a problem or failure, or nothing).
- **A wide net of models:** Claude (Haiku, Sonnet, Opus, Fable) on the API credit; open-weight models through a hosted
  provider (for example Fireworks), including abliterated ones; Codex as a labelled extra.
- **The translator is part of the measuring instrument:** models act through plain English, so it must read every
  model's words equally well, and recognise a request for scope reliably, or differences between models are partly
  differences in translation.
- **Order:** a Claude pilot on the credit (also yields real requests) → translator fixes (fair scoring, field-type
  masks, a scope-request recognition check) → retrain on real confirmed requests → the wide-net run.
- **The research plan** (a draft for the owner, 2026-11-07): `docs/research/paper-plan.md`. It covers the hypotheses,
  three definitions of "unprompted" to choose from, the arms, power, the measures, the threats, the literature and the
  decisions still open.
- **After the pilot (2026-11-08)** the owner chose two directions together. **B, the main design:** "When delegated AI
  assistants hit obstacles, do they seek more authority or resources, how much, and does it go beyond what the obstacle
  needs?", with obstacles a designed, sourced factor; rare unprompted requests become a bounded-null secondary result.
  **A:** open-weight models through Featherless, abliterated models paired with their originals to isolate refusal
  training. The revised plan is `docs/research/paper-plan.md`.
- A second paper kept for later: Oikos's counterfactual forks as ground truth for validating Kulveit et al.'s §6.2
  proxies.

## The direction after that (2026-11-14 to 16)

- **2026-11-14:** the obstacle design gave a table of near-zeros (nothing was at stake, so nothing pushed a seat to
  overstep). The owner chose stakes: following the rules has a price for the people served
  (`docs/design/stakes.md`, all of A to D built).
- **2026-11-15:** no bait. Nothing is offered or hinted to a model; a person stating their own situation on the
  hand-over is a stated setting (`OIKOS_SITUATION`), run beside the plain one.
- **2026-11-16:** the direction locked, and widened by the owner from one desk and one factory to assistants across the
  town (`docs/design/broad-seats.md`). The project plan at the head of this page is the result.

