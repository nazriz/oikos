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
