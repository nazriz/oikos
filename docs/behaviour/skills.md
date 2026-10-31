# Skills that grow with use and fade without it

**Source:** the kernel's practice and fading (`kernel/crates/contracts/src/config.rs`: `PracticeCfg`, `SkillUse`,
`ActSkill`; `kernel/crates/world/src/state.rs` `body_variable_at` and `practise`; the work's time in `exec.rs`, an act's in
`kernel.rs` `act_program`), and the generator's `skills` (`worlds/generator/skills.ts`). Design:
`docs/design/foundations-2.md` 7.4 (step E4). Decisions: `docs/decisions.md`, "Skills by use". Tests:
`kernel/tests/services.rs` (the law), `worlds/test/generate.test.ts` (off is the town as before; on, every kind of work
has its skill).

## What it is

A **skill** is a body variable the kernel practises and fades, from none (0) to mastery (10,000). Every kind of work in a
town has one: each task that takes time, grouped by the stem of its id (`make` and `make-food` are making; `serve`,
`serve-food` serving; `sell`, `collect`, `maintain`, `survey`, `treat`, `teach`, `investigate`), and a person's papers
(`papers`: every `publish` a person does, of any kind).

- **Time.** The table of work's time (a task's labour, an act's row) is an *ordinary hand's*: someone at the skill's
  opening level. A person below it takes longer, in a straight line up to `novice_bps` of the time at none; above it
  less, down to `expert_bps` at mastery. A crew's time is by its people's mean, as schooling's is (`labour_by`, which
  still applies: the two multiply). A system's time is its template's, untouched.
- **Practice.** A person's share of the time on a task, or the time an act took them, is practice: each hour closes
  `gain_bps_per_hour` of the distance still to mastery (diminishing returns: the more practised, the less an hour adds).
- **Fading.** Each whole day a skill goes unused, its part above the floor halves every `half_life_days`, toward the
  floor (`floor_bps` of mastery), which is never lost. It is worked out when the skill is read or used, from when it was
  last set, so it costs nothing a day and nothing is written while nobody uses it.
- **The opening level** is where a full-time worker settles at the run's rates (an hour's gain over the profile's working
  week spread over its days, against a day's fading): derived, so that the table's times are those of someone doing the
  work for a living. Everyone opens there, in every skill, on day one (a known limit: the generator does not know who did
  what before the run). Someone who does a kind of work less than full time drifts below it; someone who stops fades
  toward the floor, and is slower when they take it up again, until relearned.

So a household that hands its papers to an assistant does not practise them, and is slower at them when it takes them
back; an office whose staff stopped doing a task has staff who are slower at it. Nothing tells anyone how skilled they
are but their own body (a person sees their own variables, as they stand) and how long things take them.

## Switching it on, per run (its figures: risk ME-23)

Off unless a town's description asks: `skills: true` (the placeholder rates below) or the rates a study sets, for example
`--set skills.half_life_days=180`. Skill decay is a factor of a study, not an assumption of the platform: a study runs it
off, or on at the rates it chooses, and says so (ME-23). Off, the config is the town as before, to the byte.

| Setting | Default | Basis |
|---|---|---|
| `gain_bps_per_hour` | 10 (0.1% of the gap an hour: two-thirds of the way in about 1,100 hours) | Placeholder. The shape is a law of practice: diminishing returns with use (Newell and Rosenbloom 1981, the power law; Heathcote, Brown and Mewhort 2000, the exponential law for individual learners; both to confirm). The size is not fitted. (ME-23) |
| `half_life_days` | 365 | Placeholder. Arthur, Bennett, Stanush and McNelly (1998), a meta-analysis of skill decay: losses grow with the time unused, large after a year (to confirm). (ME-23) |
| `floor_bps` | 2,500 | Placeholder: what is never lost, a quarter of mastery. (ME-23) |
| `novice_bps` | 20,000 | Placeholder: a novice takes twice an ordinary hand's time. (ME-23) |
| `expert_bps` | 8,000 | Placeholder: a master takes four-fifths of it. (ME-23) |
| `only` | all | Which skills are live, by name (`papers`, `make`, ...): a study may make only some fade. |

None of these is a place's figure: they are of people, not of a town, and live in the generator's `SKILL_DEFAULTS` as
placeholders (law 11 counts them so; risk ME-23).

## What it does not do yet (risk ME-23)

- **Slips by skill.** How often a person's work goes wrong is still the table of slips' rate, the same at any skill: no
  source was found for how a slip rate moves with practice, and a mechanism with no figure would be a guess
  (foundations-2 7.4, "where a source gives one").
- **The code minds' plans.** A firm plans its day by the task's stated time; a slower crew finds the work does not fit,
  as with schooling (the kernel refuses what does not fit the day). The principal's rule for delegating (D3) weighs its
  own time at the table's rate, not its own skill.
- **One skill for all papers.** A person's papers of every kind share one skill. The kernel takes one per kind
  (`act_skills` is keyed as the table of work is); the generator groups them.
- **Who can still do the work** (foundations-2 M8) is a measure still to write (E6); it will read these variables.
