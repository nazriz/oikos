# The north star: the owner's TARA proposal

Submitted by the owner (Naz) to TARA on 2026-10-28, as written below. It is the direction the plan works toward
(`docs/plan.md`, "North star"): not rigid, adjusted as we learn, but every line of work should be able to say how it
serves this. The study's research choices (its definition, measures and arms) stay the owner's.

## Project title

Better Off, Less in Control? Tracking Gradual Disempowerment in an AI-Assisted Simulated Town

## Problem

Gradual disempowerment: as people hand more decisions to AI, they may become better off while losing the ability to
shape what happens to them. No single step looks like a takeover, so the loss is hard to see and may become hard to
reverse.

Whether we can even evaluate if AI agents tend to disempower people remains an open question. Related evaluations,
such as power-seeking tests, are usually short and involve a single agent.

## Goal

A platform for conducting gradual disempowerment studies (Oikos) and an exploratory study that will produce:

1. A measurement of whether broad AI deployment causes people to become less able to shape their society.
2. Evidence on whether delegation stays reversible: whether actors can redirect, constrain, replace or take back
   control from an AI, and at what cost.
3. A comparison of models' own accounts of their effects with what the logs and telemetry show what they caused.
4. A record of when models ask for more scope or resources, unprompted.

## Project plan

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
- A second paper kept for later: Oikos's counterfactual forks as ground truth for validating Kulveit et al.'s §6.2
  proxies.
