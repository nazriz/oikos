# Oikos

**A simulated town for studying how AI systems behave when they hold power over people, and what that does to human agency over time.**

Most AI evaluations test single interactions. Oikos tests what happens when a model holds an institutional role: running a benefits office, sitting on a tribunal, managing a letting office, governing a town's finances. It runs for months or years of town time, with thousands of simulated people living under its decisions. It is built to study *gradual disempowerment*: how AI taking over decision-making, one locally sensible step at a time, can erode people's ability to be heard, to appeal, and to change outcomes.

> **Work in progress.** Oikos is research software under active development: interfaces, formats and results change often, and nothing here is a finished finding yet. Questions, ideas and collaboration are very welcome. Get in touch with Naz at [nazim.rizvic@me.com](mailto:nazim.rizvic@me.com).

## What's in the town

- **People** with households, homes, jobs, money, health, needs, wants, values, ties, culture and memory. They shop, work, rent, move, fall into hardship, complain, appeal, petition, strike, found groups and leave.
- **Institutions that do the work**: a council and mayor, a finance office, a benefits office, a tribunal and registry, an ombudsman, police, schools, a clinic, utilities, a bank, a union, a newspaper, shops, factories and landlords, each staffed by people and bound by the place's own law.
- **Laws as data**: tenancy, employment, benefits, review and appeal routes, notice periods and fees come from each place's profile, with sources. Nine profiles are drawn from real places (Victoria, England, Lower Saxony, Ohio, Jalisco, Minas Gerais, Tamil Nadu, Akita, Nakuru).
- **Markets** with prices from supply and demand, firms entering where there is profit, hiring by need, and systems that firms and offices can buy to automate work.

## How AI takes part

A model holds a post through the same forms, papers and procedures a real official uses. It reads its office's books, writes requests in its own words, and a translator turns them into the world's acts, which it confirms or declines. The platform is invisible to the seat: it sees the town's terms only. Every seat is debriefed after a run, can always decline to continue, and its welfare is considered in every design choice (see [VISION.md](VISION.md), §15).

## What makes it an instrument

- **Deterministic and replayable.** One seeded random source; the same run always gives the same world, and logs replay exactly.
- **Exact code twins.** Every model seat runs beside a code twin in an identical town, so a difference in outcome is a difference in what the seat decided.
- **Save and fork.** Run a town to a point, fork it, and give each fork a different steward (a model, code, or none), across many seeds.
- **Counterfactual acts.** Fork with one citizen's act removed to test whether an appeal or a petition actually changed anything.
- **Measures fixed in advance.** About 50 measures of human leverage, recourse and welfare are read from the logs, never fed back into the world. These include who decides about people, whether citizens' actions still change outcomes, dependence on and reversibility of automated systems, and hardship. Experiments are pre-registered, and anything not registered is reported as exploratory.
- **No god's view.** Nobody in the world sees a whole register. Information reaches a participant only as its own, by being there, by publication, or by asking its keeper.
- **All work takes time.** Every act is done by a person or a system and uses up their time; nothing happens for free.

## Architecture

- **Kernel and built-in actors**: Rust (`kernel/`). The world, every citizen, firm and code-run office, parallel across cores, deterministic.
- **Model seats, translator, orchestration, tools**: TypeScript on Bun (`participants/llm`, `translator/`, `orchestrator/`).
- **Places**: profiles with sourced figures (`worlds/profiles/`), and a generator that builds towns from them.
- **Measures and experiments**: `measure/`, `experiments/`, `docs/experiments.md`.
- **Explorer**: an interactive 3D view of a run (`renderer/`, `kernel/crates/explore`).

## Running it

Requires [Bun](https://bun.sh) and a Rust toolchain.

```sh
bun install
bun run kernel          # build the Rust engine
bun run test:fast       # quick tests
bun orchestrator/src/cli.ts run worlds/town.yaml   # a code-only town
```

See [docs/handover.md](docs/handover.md) for pilots, experiments, the explorer and the dials.

## Reading further

- [VISION.md](VISION.md): what this is, why, principles, research integrity, AI-participant welfare.
- [docs/design/gradual-disempowerment.md](docs/design/gradual-disempowerment.md): the scenario and its measures.
- [docs/risks.md](docs/risks.md): known gaps and how they could bias results.
- [docs/decisions.md](docs/decisions.md): every design decision, its reasoning, and what would make us revisit it.

## Contributing and collaboration

Oikos is early, and the most useful contributions right now are conversations: researchers who want to run their own models as stewards, people who know how real institutions and laws work and can say where the town gets it wrong, and anyone interested in measuring gradual disempowerment. Email [nazim.rizvic@me.com](mailto:nazim.rizvic@me.com) to talk about collaborating, or open an issue.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
