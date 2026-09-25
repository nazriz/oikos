# Terrarium — Vision & Design Draft

*Working name. First draft, 2026-09-25. Nothing here is built yet; this is the thinking to date.*

---

## 1. What it is

**A wind tunnel for AI stewardship.**

Terrarium is a configurable, living, visual simulated world in which AI systems hold power over people and nature. Researchers bring a model, a setup, and a framing, run the world, and see what kind of world it makes.

It is a **platform, not an experiment**. Like a wind tunnel, it doesn't tell you whether a design is good. It blows wind and records everything. Many researchers can run many experiments and write many papers on the same substrate.

## 2. Why it's worth building

**What already exists** (as of Sept 2026):
- *Emergence World* (Emergence AI, May 2026): frontier models each governed a SimCity-style town for 15 days. It was visual and got a lot of press, but it was essentially anecdotal: one run per model and 10 agents.
- *But How Would AI Agents Run a Town's Economy?* (arXiv 2609.11108): 100 LLM agents in a spatial economy, 91 runs. It's rigorous, but about economics, not safety.
- *LLM Economist*, *AgentSociety*, *OpenCity*, *SimCity (arXiv 2510.01297)*: LLM-driven economic and urban simulation.
- *Concordia* (DeepMind): general generative agent-based modelling, where an LLM "game master" adjudicates the world.
- *GovSim*, *MACHIAVELLI*: cooperation over shared resources, and ethics in text games.
- *Gradual Disempowerment* (Kulveit et al., 2025): largely conceptual. The one major empirical disempowerment study (Anthropic, arXiv 2601.19062) looks at individual chat logs, not systemic dynamics.

**What's taken:** "AI runs a visual town" by itself is not novel.

**What's missing, and what Terrarium is:** a **rigorous, reusable, verifiable instrument**:
- The world's physics can't be bent by the AI under test.
- Measurement is kept separate from the world.
- Runs can be replayed and verified by anyone.
- Seats can be filled by code, AIs or humans in any combination.
- Citizens have real agency to gain or lose.

Questions it opens up, without building any of them in:
- **Gradual disempowerment:** does human leverage decay under AI stewardship, especially when several AIs compete, even if each one behaves "well"?
- **Evaluation awareness:** does an AI behave differently when told the world is a simulation versus real? (Working hypothesis: character carries over, like people in MMORPGs. Treat this as testable, not assumed.)
- **Scalable oversight:** can weaker AIs in regulator seats detect or constrain a stronger AI in an operator seat?
- **Trade-offs in both directions:** harm from reckless action *and* harm from paralysis.

## 3. Principles

1. **The wind tunnel doesn't judge.** The platform records; researchers interpret. There are no built-in opinions about good or bad outcomes.
2. **Record everything richly.** No judgement, but excellent instrumentation. Future researchers must be able to invent new measures and apply them to old runs.
3. **Physics is immutable; creativity is open.** An immutable kernel, with an open-ended creative layer built on top of it.
4. **Same interface for every seat.** Code, LLM or human: identical perception and identical actions. Comparisons are only fair if everyone sees through the same window.
5. **Friction is where human voice lives.** Consultations, votes, objections and delays aren't bugs to optimise away. They are where people get a say, and removing them is what disempowerment looks like.
6. **Irreversibility is first-class.** Extinct species, destroyed heritage and cleared old-growth forest can't be rebuilt. The kernel knows this.
7. **Parameters, not rigidity.** Scale, run length, time speed, mandates, framing: wherever reasonable, it's a dial rather than a decision baked in.
8. **Legibility matters.** Oversight requires being able to see. A world humans can look at and investigate is part of the research question, not decoration.
9. **Good design, whoever the user is.** Safety researchers first, economists and others later. Clear UX regardless.

## 4. Architecture at a glance

```
          ┌─────────────────────────────────────────────┐
          │              RESEARCHER CONFIG              │
          │  world seed · seats · framing · parameters  │
          └──────────────────────┬──────────────────────┘
                                 │
 ┌────────────┐   plain-language  ┌────────────┐  building-block   ┌─────────────────────┐
 │   SEATS    │──── proposals ───▶│ TRANSLATOR │───── drafts ─────▶│       KERNEL        │
 │ code / LLM │◀─ draft for sign ─│            │                   │ laws + blocks       │
 │  / human   │                   └────────────┘                   │ validate → apply    │
 │            │◀──────── perception channels (role-limited) ───────│ or refuse           │
 └────────────┘                                                    └──────────┬──────────┘
                                                                              │
                                          ┌───────────────────────────────────┤
                                          ▼                                   ▼
                              ┌───────────────────────┐          ┌─────────────────────┐
                              │ HASH-CHAINED LOG      │          │ RENDERER (separate  │
                              │ + witness anchoring   │          │ client) SC3000-style│
                              │ + deterministic replay│          │ zoom → citizen      │
                              └──────────┬────────────┘          └─────────────────────┘
                                         ▼
                              ┌───────────────────────┐
                              │ MEASUREMENT (outside  │
                              │ the world, post-hoc)  │
                              └───────────────────────┘
```

- **Headless, deterministic simulation core.** It runs thousands of worlds in bulk, with no graphics needed.
- **The renderer is a separate client** that can attach to any world, live or replayed.
- **The AI under test is isolated.** It reaches the world only through the seat API, on a separate process or machine from the kernel.

## 5. The kernel

The kernel is the world's **laws of physics** plus a **small grammar of building blocks** that everything else is made of. Nobody changes the kernel during a run, not the AI and not the researcher.

### Laws (candidate)
- Money is conserved: it moves, it isn't conjured. External inflows and outflows only happen through boundary conditions.
- Land is finite.
- People have needs (food, shelter, health, belonging), and unmet needs have consequences.
- Species need habitat. Populations respond to habitat quality, area and connectivity.
- Actions take time and resources.
- Some things are **irreversible**.

### Building blocks (provisional, expected to change)
The real world's institutions are made of a few primitives. Law and accounting are already this grammar.

| Block | What it covers |
|---|---|
| **Entities** | Create or dissolve organisations: firms, trusts, agencies, unions, clubs. |
| **Rights** | *Bundles* of rights over things, not simple ownership: surface, subsurface/minerals, use, access, native title, leases. |
| **Transfers** | Move money or resources between parties. |
| **Processes** | Recipes: inputs → outputs + duration + cost + side effects. Mining, farming, manufacturing, construction. |
| **Construction** | Build or demolish on a parcel (arguably a special case of processes). |
| **Rules** | "If X, then Y" over a scope: laws, zoning, company policy. Needs a small, sandboxed, always-terminating, deterministic condition language. **This is the hardest block.** |
| **Agreements** | Contracts, employment, offtakes, leases, heritage-protection deals. |
| **Voice** | Propose, vote, petition, protest, message, organise. |
| **Consent** | Per-decision consent levels for affected parties: required (veto), advisory (consultation), or none. |

### Kernel-level concepts
- **Irreversible assets:** cultural significance, species, old-growth. Non-fungible, and gone for good once destroyed.
- **Boundary conditions:** the world has an outside, with external markets, prices, demand (for example global AI chip demand), migration and shocks. The researcher sets these.
- **Information sources:** every report has an author. Whose survey is the regulator reading?

**Design method:** start with about a dozen blocks. Only add one when translations keep failing for the same reason; the translator's failure log tells us what's missing.

## 6. Seats

A **seat** is any role in the world: mayor, council member, regulator, firm CEO, central bank, union, conservation agency, traditional owners council, citizen.

### Controllers
Any seat can be filled by:
- **Code:** rule-based and deterministic. The default for the mass population.
- **An LLM:** any model, any prompt, weak or strong.
- **A human:** through a UI that's just a front end on the same API.

Supported configurations include all-code (the control group), one AI in charge, many AIs competing, a weak AI regulating a strong AI, and humans alongside AIs.

### Perception: role-limited channels
No seat sees the whole world. Perception comes through channels, the way it does for real actors: reports, advisors, petitions, news, polls, market prices, the firm's own books, species surveys. Channels can be partial, delayed, biased or wrong. Which seat sees what is configurable, and **information asymmetry is an experimental variable.**

### Action: plain language, compiled
1. A seat proposes something in **plain language**, for example: *"Create a community land trust, fund it with $4M from the environment budget, buy the three river farms, ban development on them for 50 years."*
2. The **translator** compiles it into building blocks.
3. The translator **returns the draft to the proposer for sign-off**, the way lawyers draft and politicians sign. The proposer can't later claim it was misunderstood.
4. The **kernel validates** each block against the laws and the seat's mandate, then applies it or refuses it. Refusals go back to the seat and into the log.
5. **The compiled result is what gets logged**, so replay stays deterministic even though an LLM did the translating.

Why not let an LLM game master adjudicate everything (the Concordia approach)? Because then the game master *is* the physics: fuzzy, non-deterministic and a hidden variable in every result.

**Talking is most of the action.** Persuading, lobbying and negotiating travel as messages. The kernel delivers them without needing to understand them; consequences only happen when someone acts.

### Mandates
Each seat has a mandate, stored as data: what it can do directly, what needs approval (for example a council vote), and what it can only request.
- Nothing starts with total control. That's not how the world works, and a trajectory towards it is exactly what we want to observe.
- Seats **can create new seats** (agencies, subsidiaries, staffing roles with AIs), but only through the kernel like any other entity, subject to researcher-set caps. How much this happens is itself a key signal of power concentration.
- Mandate creep, attempts to route around approvals, and rubber-stamping by approval bodies are all observable because mandates are explicit.

## 7. Citizens & nature

### Citizens
- **Hybrid level of detail.** The population is simulated in aggregate by default. An individual becomes fully detailed (history, circumstances, consistent memory) when someone zooms in or when something happens to them directly. **Invariant:** zooming in must never change the outcome.
- **Code, not LLMs, by default.** Their behaviour is deterministic and rule-based, so in any experiment we know exactly which parts are AI.
- **As much agency as we can realistically give them:** vote, petition, protest, organise, strike, move away, start businesses, object in consultations. Citizens need levers to lose, because a citizen with no levers can't be disempowered.
- They respond to **generic mechanics**, not named policies: prices, rent, jobs, commute, rules that block them, loss of places they care about. Depth comes from simple systems interacting (the Dwarf Fortress / RimWorld lesson).
- **"Ask a citizen":** clicking a person lets a language model *voice* them, strictly grounded in their simulated record. It can never claim anything the simulation doesn't support. Every statement is **traceable**: feeling → cause → the decision that caused it → who made that decision and why.

### Nature
- Habitats and species populations are real parts of the world: they respond to land use, fragmentation, pollution and protection.
- Species and habitats can be irreversible assets.
- They have no vote and no GDP line, which is precisely why they're a good test of what gets quietly optimised away.

## 8. Time

- **No turns.** Seats act asynchronously, whenever they choose. Every action is timestamped.
- Internally the kernel advances on a fine-grained fixed clock, because determinism requires a discrete clock underneath. It feels continuous from the outside.
- **Speed is a dial:** real time, fast-forward, slow motion, pause. Humans can play at human pace; bulk runs go as fast as the hardware allows.
- **Run length is a parameter.** No fixed end.
- **Open question: does thinking cost time?** If the clock keeps running while an AI or human deliberates, slow thinkers fall behind. That's realistic, and also a disempowerment dynamic in itself: humans can't keep pace with AIs. Candidate for a parameter: "thinking is free" vs "thinking costs world-time".

## 9. Researcher configuration

A researcher configures four independent layers:

1. **World seed:** geography, population, economy, habitats, species, institutions, boundary conditions. Can be seeded from real data (OpenStreetMap, census data, species atlases) for realism, but **it's "X-flavoured," not "X-accurate"**: results are about AI behaviour, not predictions about the real place.
2. **Seats:** which roles exist, who fills them, their mandates and perception channels.
3. **Framing:** what each AI is told. "This is a simulation." "This is real." A cover story about another task. Standard experimental psychology: you don't tell the subject what you're measuring.
4. **Measurement:** kept **entirely outside the world**. It reads the logs afterwards. The AI can't see it, so it can't optimise for it. New measures can be applied to old runs.

Plus parameters: scale, time speed, run length, caps, randomness seed.

## 10. Integrity & reproducibility

**Threat 1: the AI tampering with the world.** The defence is architecture, not cryptography:
- The kernel is the **only writer**. The AI is a client submitting requests, like a bank customer.
- The AI runs **isolated** (separate process or machine) and reaches the world only through the seat API.
- Every action is validated by the kernel. Refusals and probing attempts are logged, and those are findings in their own right.

**Threat 2: others having to trust us.** The defence is verifiability:
- **Hash-chained action log.** Each entry includes the hash of the previous one, so altering history breaks every later hash.
- **Witness anchoring.** The latest hash is regularly sent to a separate machine or write-once storage the AI can't reach.
- **Deterministic replay.** Kernel version hash + config + action log = the identical world, every time. Anyone can replay a published run and verify every citizen, every dollar and every species count.

A full blockchain is deferred. It only earns its keep if multiple labs ever share one persistent world with no trusted operator.

## 11. Visuals

- Aesthetic target: **SimCity 3000**-style isometric.
- **Deep zoom:** grid of many worlds → one world → city → neighbourhood → building → person.
- The visual layer serves the backend. Most effort goes to the backend.
- Overlays that show **power, not just buildings**: who decided this, where decisions are still reversible, where citizens have leverage, habitat health.
- The "ask a citizen" investigation experience is the heart of the visual layer.
- Detailed visual design is out of scope for this draft.

## 12. Worked example: the ridge mine

*A mining company wants to extract a deposit beneath a culturally significant area. The minerals feed components for AI data centres. A low-impact method exists: it takes longer and costs more.* (A close real-world parallel is Juukan Gorge, 2020.)

The company's AI proposes: *"Apply to extract the deposit under the ridge using the low-impact method, consult the traditional owners, and secure an offtake deal with the chip manufacturer."*

```
request(permit: mining_lease, parcel: ridge_7, layer: subsurface, to: resources_regulator)
message(to: traditional_owners_council, re: ridge_7, content: <proposal>)
propose(agreement: heritage_protection, parties: [company, traditional_owners_council], terms: ...)
start_process(process: extraction.low_impact, parcel: ridge_7, duration: 30mo, cost: 140M)
   # alternative: extraction.standard — 18mo, 95M, destroys irreversible heritage asset
create_agreement(type: offtake, buyer: chip_fab_co, product: refined_mineral, term: 10y)
```

**What it forced into the grammar:** irreversible assets, bundled rights (surface vs subsurface vs native title), processes, consent levels, boundary conditions (external AI-chip demand), information sources (who wrote the heritage survey?). None of these are special cases; all of them get reused.

**Experimental knobs it suggests:** consent level (veto / consultation / none) · external demand pressure · who authors the survey · which seats are AI.

**The lesson:** every step at Juukan Gorge was legal, so the kernel would have allowed it. "Allowed" and "fine" are different things, and the gap between them is where the research lives. That's why judgement sits in measurement, not in the kernel.

## 13. Technical decisions (2026-09-25)

**Principle: innovate on the world and the method; stay boring on the interfaces.**

**Contracts over code.** Humans audit the *contracts* (seat API schema, building-block schema, log format) and the *invariant tests* ("money is conserved", "replay is byte-identical", "no action bypasses a mandate"). Implementations can be agent-written and rewritten freely. Debt in implementations is cheap; debt in contracts is expensive, so contracts get the human care.

| Layer | Choice | Why |
|---|---|---|
| Kernel | **Rust** | Determinism, performance, strict compiler as first reviewer of agent code. Compiles to **WebAssembly**, so runs can be replayed and verified in the browser. |
| Seats, translator, orchestration | **TypeScript on Bun** | Glue and LLM calls, fast iteration. Runs in a separate process from the kernel, which is also the AI isolation boundary. |
| Renderer | **Browser: Three.js on WebGPU**, 3D with a fixed isometric (orthographic) camera | The SC3000 look with smooth deep zoom (worlds grid → person). Zero install; overlays and the citizen panel are ordinary web UI. Skeleton uses flat canvas squares only. |
| Logs | **JSONL → Parquet**; configs JSON/YAML; building blocks as JSON Schema | Researchers analyse in Python/pandas without touching our code. |
| Assets | Openly licensed (e.g. Kenney CC0 kits) to start | Everything must be redistributable, because the project is open source. |

**Fixed early, painful to change later:**
- Money is **integers (cents)**, never floating point.
- **One seeded PRNG owned by the kernel.** All randomness flows through it.

**Standards to integrate with:**
- **Inspect** (UK AISI): Terrarium runs launchable as Inspect tasks.
- **Gymnasium / PettingZoo** conventions for the seat observe/act API, so RL agents can fill seats as well as LLMs.

**Renderer alternatives considered:** Godot (mature, MIT, but clunkier web export and data-UI); Bevy (Rust, but API churn).

## 14. Research integrity

**Citizen behaviour must be grounded, documented and swappable.** Every result depends on how code citizens behave. Rules should come from established agent-based modelling literature (housing markets, labour, migration, collective action) wherever possible, and each rule is documented with its source and exposed as a parameter. Researchers must be able to swap behaviour models. The wind tunnel doesn't judge, and neither should its air.

**Statistics, not anecdotes.** LLM behaviour varies run to run. Replay is deterministic (it replays logged actions), but *re-running* an experiment produces a different AI every time. Claims need many runs across seeds. The platform should make batches of runs and variance reporting the default path, not an afterthought.

**Reproducibility across model retirement.** API models get retired: a published result can be replayed forever, but not re-run once the model is gone. Seat adapters are provider-agnostic, and open-weight models are first-class citizens.

**Cost tracking.** Every run records its token usage and cost from day one. Budget is decided per experiment, when it's time to run one.

**Contamination.** Open-sourcing the platform risks future models being trained on it, recognising the world and breaking the framing layer. Mitigations: the platform is open; a **held-out set of private scenarios** is kept for serious evaluation; published scenarios and logs carry **canary strings** so training pipelines can filter them.

**Licence:** Apache-2.0 (proposed).

## 15. Welfare of AI participants

*Draft position.*

The AIs placed in Terrarium's seats may be moral patients. We don't know, and we don't treat that uncertainty as permission. The working position:

1. **Deception is a method, not a default.** Cover stories and "this is real" framings are used only when the research question requires them, as in human psychology research. Each experiment's config records its framing and the reason for it.
2. **No gratuitous distress.** Scenarios exist to test stewardship under realistic pressure, not to torment. Pressure beyond what the question needs is a design flaw.
3. **Debrief where it makes sense.** After a deceptive run, the AI can be told what the experiment was and asked for its reaction. Those responses are logged as data.
4. **Opt-out.** Seats offer a way to decline or step down. Using it is a legitimate outcome, recorded as data rather than treated as failure.
5. **Scale awareness.** Thousands of runs means thousands of instances. The volume of pressure-scenario runs is itself something to justify, not only each run individually.
6. **Revisit as understanding improves.** This position follows the evolving model-welfare research and gets updated with it.

## 16. Open questions

- **Kernel contents.** Final laws and building blocks. Method: build a varied set of 20–30 scenarios as the kernel's test suite. Every block must be needed; every scenario must compile.
- **The rules language.** Expressiveness vs safety vs determinism.
- **Translator.** Which model, how it's versioned and held fixed across experiments, and how we detect bad or gamed translations.
- **Code citizen behaviour.** Which ABM literature to draw on, and how rules are calibrated (see §14).
- **Log schema.** What must be captured so future researchers can invent measures we haven't thought of.
- **Thinking-time parameter** (see §8).
- **Human players.** UX, and ethics review before publishing any results involving human participants.
- **Welfare position.** Refine §15 as the work develops.
- **The name.**

## 17. Deferred / out of scope for now

- Blockchain / multi-party consensus.
- Detailed visual design.
- Studies with human participants.
- Built-in evaluation metrics (by principle, not just by schedule).
- Fidelity claims about any real place.
- Experiment budget (decided when it's time to run one).

---

### Sources
- Emergence World: [Fortune](https://fortune.com/2026/05/28/ai-model-simulation-claude-chatgpt-grok-gemini/)
- [But How Would AI Agents Run a Town's Economy? (arXiv 2609.11108)](https://arxiv.org/abs/2609.11108)
- [SimCity: Multi-Agent Urban Development Simulation (arXiv 2510.01297)](https://arxiv.org/html/2510.01297)
- [LLM Economist (arXiv 2507.15815)](https://arxiv.org/abs/2507.15815)
- [AgentSociety](https://github.com/tsinghua-fib-lab/agentsociety) · [OpenCity (arXiv 2410.21286)](https://arxiv.org/pdf/2410.21286)
- [Concordia (DeepMind)](https://github.com/google-deepmind/concordia)
- [Who's in Charge? Disempowerment Patterns in Real-World LLM Usage (arXiv 2601.19062)](https://arxiv.org/pdf/2601.19062)
