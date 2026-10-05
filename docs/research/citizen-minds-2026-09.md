# Citizen minds: what we can learn from others (research pass, 2026-09-29)

**Why:** today's citizens are hand-written rule sets. Each new part of the world (a church, an institution a model mayor
invents) needs new citizen code, and rules interact in ways that keep breaking (the herding onto one shop). Naz asked
for AI citizens instead. They should be simple, scale to a town or a city at microseconds a decision, and understand
constructs they've never seen, learning in context. And they should be a path to training citizen models. Belief and
religion (VISION principle 16) and a world that grows from within (principle 17) have to fit.

This note is what exists, what to take from it, and a proposed architecture. The design is docs/design/ai-citizens.md;
every idea used, with its citation, is in docs/research/references.md. A second pass (below, "Beyond The Sims")
followed Naz's question, "is there more we can do?"

## What exists

### Game AI: cheap minds, intelligence in the world

- **Needs and advertisements (The Sims).**
  - People have a few needs; objects in the world advertise which needs they satisfy.
  - Adding an object adds behaviour without new person-code. The intelligence lives in the world.
- **Utility AI with considerations** (Dave Mark's Infinite Axis Utility System, GDC 2015, [gameai.com](https://www.gameai.com/iaus.php); [overview](https://en.wikipedia.org/wiki/Utility_system)).
  - Each possible action is scored by "considerations": an input, a response curve and four parameters. The scores are multiplied.
  - It's data-driven, needs little programming once hooked up, and is less brittle than if/then rules.
- **Social practices** (Versu, Evans and Short; Evans led The Sims 3's AI; [paper](https://www.semanticscholar.org/paper/Versu%E2%80%94A-Simulationist-Storytelling-System-Evans-Short/74c6364ae004ce58e3f15a20c1e6d22198a93e21), [intro](https://emshort.blog/2013/02/14/introducing-versu/)).
  - A practice is a recurring social situation (a meal, a trial, a service) with roles and stages. It provides affordances to those taking part.
  - "The practices never control the agents directly": each agent still chooses by utility.
  - This is the multi-person generalisation of an advertisement, and the natural shape for rituals, meetings and institutions.
- **Simulated knowledge and belief** (Talk of the Town, James Ryan; [Game AI Pro 3 ch. 37](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter37_Simulating_Character_Knowledge_Phenomena_in_Talk_of_the_Town.pdf)).
  - Characters hold beliefs about others, formed by observing, by being told (truly or falsely), or by confabulating.
  - Beliefs propagate, are misremembered and forgotten; repeating one strengthens commitment to it.
  - All symbolic and cheap: a model of *what people know* that doesn't need a language model.

### Language-model agents: rich, expensive, and the work to make them cheap

- **Needs inside model agents.**
  - [Humanoid Agents](https://arxiv.org/abs/2310.05418) (2023) adds basic needs, emotion and closeness in relationships to generative agents.
  - [D2A](https://openreview.net/forum?id=3ms8EQY7f8) (ICLR 2025) drives agents by an 11-dimension value system, *spiritual satisfaction* among them. At each step the agent scores candidate activities against its desires. That's utility AI with a model proposing the candidates.
- **Cheaper cognition.**
  - [Lyfe Agents](https://arxiv.org/abs/2310.02172): an agent picks a high-level option and follows it until a cheap, non-model signal says to reconsider. Memory is compressed by summarising and forgetting.
  - [Affordable Generative Agents](https://arxiv.org/abs/2402.02053) (TMLR 2024): a "Lifestyle Policy" reuses earlier model reasoning for similar situations, calling the model only for situations it hasn't seen. Up to 96% cheaper. They observe that in a fixed environment the variety of behaviour flattens: agents have a finite repertoire.
- **Scale.**
  - [AgentSociety](https://arxiv.org/abs/2502.08691) (2025) ran over 10,000 model agents and 5 million interactions.
  - [AgentTorch](https://github.com/AgentTorch/AgentTorch) and "LLM archetypes" ([Chopra et al.](https://arxiv.org/pdf/2409.10568); [Large Population Models](https://arxiv.org/pdf/2507.09901)) ask the model how a *type* of person decides, not each individual. They simulated 8.4 million New Yorkers this way, with lower error than other agent-based methods, at the cost of less diversity within a type.
  - [GenWorld](https://arxiv.org/abs/2606.27650) (June 2026) is the closest to what we want:
    - agents get binned observations and a *finite candidate set* of actions;
    - a teacher model scores the candidates 10–30 times per context;
    - the scores are compiled offline into lookup tables that run at 0.54 µs a decision, for 196,608 residents validated against census data.
    - Its gaps: the compilation's fidelity isn't validated, and novel situations get a hard-coded fallback. It never asks the teacher again.
- **Civilisation-scale demos.** [Project Sid](https://arxiv.org/pdf/2411.00114) runs 10–1,000+ agents with concurrent cognitive modules and one bottleneck decision. Its agents developed roles and changed collective rules, *and transmitted culture and religion*.
- **Different design choices from ours.** [Concordia](https://github.com/google-deepmind/concordia) (DeepMind) has a model "game master" adjudicate the world. Oikos deliberately doesn't: the kernel is physics, and no model adjudicates.

### From an expensive mind to a cheap one

- [SwiftSage](https://arxiv.org/abs/2305.17390): fast and slow thinking.
  - The fast module is a small model (T5, 770M parameters) trained to imitate the large one's actions.
  - The slow module is a large model, used when the fast one isn't enough.
- Agent distillation: small models trained on large agents' trajectories come close to much larger ones. Examples are [structured agent distillation](https://arxiv.org/abs/2505.13820) and [on-policy distillation](https://arxiv.org/html/2604.00626v3), where the student acts and the teacher corrects.
  - This is the route to "citizen models".

### Learning new rules and institutions

- **Inferring norms by watching** ([Savarimuthu et al.](https://www.jasss.org/13/4/3.html); a [review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12979424/)) works when norms are broken and punished. It's hard when people mostly comply.
  - Our advantage: a construct in Oikos is a *record*: an offer, a practice, a law in institutional grammar. So citizens needn't infer its shape; they can read it, if they come to know of it.
- **Model agents learn rules from context** and norms emerge among them ([social learning and norms](https://arxiv.org/abs/2510.14401)). But an institution's *structure* strongly shapes outcomes ([When Agents Evolve, Institutions Follow](https://arxiv.org/abs/2604.27691): 57-point gaps between designs).

### Religion in agent-based models

- **The Modeling Religion Project** ([Center for Mind and Culture](https://mindandculture.org/projects/past-projects/modeling-religion-project/)):
  - models of ritual, social identity and credibility;
  - an agent-based forecast of religiosity against existential security ([JASSS 2018](https://www.jasss.org/21/1/4.html)).
- **Credibility-enhancing displays** (Henrich 2009, [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1090513809000245)):
  - people believe those who act on what they say;
  - parents' displays predict children's belief ([replication](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11195988/));
  - costly groups can be stable in a larger population ([JASSS](https://jasss.soc.surrey.ac.uk/14/3/6.html)).
- These are mechanisms we can use: belief spreads through what people *do*, not only what they say.

### Warnings

- **Model-driven social simulations are fragile.** Small changes to persona format or instructions shifted cooperation by up to 76 percentage points ([Stop Drawing Scientific Claims… Without Robustness Audits](https://arxiv.org/abs/2605.18890), May 2026; it proposes the TRAILS audit taxonomy). Any model in a citizen's mind is an instrument to hold fixed and audit, like our translator.
- **Models collapse toward an "average person".** Personas become uniform, and pushing harder produces caricature ([ACM survey](https://dl.acm.org/doi/10.1145/3800683); [micro-to-macro validity gap](https://arxiv.org/pdf/2507.19364)). Segmenting helps, but responses stay more uniform than people's ([Restoring Heterogeneity](https://arxiv.org/html/2604.06663): KL divergence from 4.65 to 1.10, "persistent over-regularization").
  - Diversity should come from data-driven traits and personal histories, not from asking a model to play a persona.

## What to take, and a proposed architecture

**A layered citizen.** Every layer acts only through the participant API, as every participant does.

1. **The body, at every wake, in microseconds.**
   - Needs, drawn from D2A's dimensions, to be sourced: subsistence, shelter, security, social, status, and later meaning and spiritual.
   - Traits and history that make people differ, drawn from census-style data, not model personas.
   - Light mood and memory.
   - It chooses by utility (considerations and response curves) among what the world offers.
2. **Offers and practices as world content**, the Sims' and Versu's lesson in our terms.
   - A job posting, a rental listing, a price list, a union's membership, a church's service, an institution the mayor invents: each says what it gives, what it asks, and who may take part.
   - They're records built from general building blocks (VISION principle 15), so the body can use a new one the day it appears, and a model or a human can read it too.
   - Proposed as a contract change.
3. **Compiled policies, also microseconds** (GenWorld). Where hand-written considerations are weak, a teacher model's scores for a type of person in a type of situation are compiled into tables and sampled from.
4. **The sparse mind, rarely: compile on a miss.** This is where we go beyond GenWorld.
   - When a citizen meets something no table covers (a new construct, a crisis), the teacher is asked, *once per archetype* (AgentTorch), several times (GenWorld), with the construct's own words.
   - The answer is compiled into the table (the Lifestyle Policy's reuse), so everyone after decides in microseconds.
   - This is in-context learning at the scale of a population.
   - For the few directly and heavily affected, a personal consultation is possible.
5. **Knowledge spreads; nobody is omniscient** (Talk of the Town; credibility-enhancing displays). A citizen knows a construct only through their perception: seeing it, being told of it, watching others take part. Belief is a record-like state that spreads, strengthens with others' costly displays, and fades.
6. **The learning loop.**
   - Every decision is logged with its options, features, scores, choice, and which layer made it.
   - That's the dataset for a small citizen model (SwiftSage's fast module, agent distillation). It takes over the tables and most teacher calls, while the teacher stays for the new.

**How a citizen understands a construct a model mayor invents:**
- *structurally*, at once, because it's an offer or a practice built from blocks;
- *semantically*, once per archetype, through the sparse mind reading its words;
- *socially*, over time, as knowledge of it spreads by what people see and hear.

**For research integrity:**
- The teacher model, its framing and the compiled tables are versioned and recorded in every log, as the translator is.
- Runtime teacher calls are logged, so replay and resume stay exact.
- Robustness audits (TRAILS) are run on the compiled policies.
- The all-code body is always there as the control.

## What's new here, as far as we found

GenWorld compiles offline and falls back on the unseen. Affordable Generative Agents reuses per agent. Archetypes trade away diversity. **Nobody combines all of these:**
- constructs that are *legible world records* (offers, practices, laws);
- a body that can use them at once;
- compiling on a miss, per archetype, when something new appears;
- deterministic replay of the whole.

That combination is what lets a model mayor's invention reach a town of thousands the same day, affordably and verifiably.

## Beyond The Sims (second pass, same day)

What game AI and social simulation added after needs and advertisements, all cheap enough for thousands of citizens.
Citations in docs/research/references.md.

- **How people switch between ways of deciding** (CONSUMAT, Jager 2000; Jager and Janssen 2012).
  - Repeating, imitating, comparing or deliberating, depending on how satisfied and how certain one is.
  - The answer to "when should a citizen think hard", and so when to ask a model.
- **Learning from experience** (experience-weighted attraction, Camerer and Ho, *Econometrica* 1999; reinforcement, Erev and Roth, *AER* 1998).
  - Attractions updated by what one got and, less, by what one could have got; choice by their logit.
  - Fitted to how people learn in experiments. It's how a citizen learns a new thing is worth taking up, by trying it, with no model.
- **Learning from others** (Boyd and Richerson 1985: conformist and prestige-biased transmission).
  - People copy what's common and what the respected do. How practices, and faiths, spread.
- **How new things spread** (Rogers, *Diffusion of Innovations*): relative advantage, compatibility, complexity, trialability and observability; innovators to laggards.
- **Values** (Schwartz's ten basic values, measured across cultures). Dwarf Fortress's split between values (what one believes) and facets (how one acts), with values setting needs.
- **Emotions by appraisal** (OCC, Ortony, Clore and Collins 1988, "computationally friendly"; FAtiMA builds agents on it).
- **Social physics** (Comme il Faut and Prom Week; the Ensemble engine 2015): relationships, history and norms drive social moves. "Paradise" (FDG 2024) extends Ensemble with language models; not read, paywalled.
- **Goals with steps** (Orkin's goal-oriented action planning, F.E.A.R.; hierarchical task networks in Killzone and Horizon Zero Dawn).

Taken together: values, habits, learning, imitation and feelings, in code. The model is only needed to say what
something genuinely new *means*.

## Open, for Naz

- The needs: which dimensions, from which sources, and when "meaning" and "spiritual" come in.
- Offers and practices as building blocks: the contract change (the design doc will propose it).
- Which teacher model, and when the sparse mind is first switched on (it's a model in citizens' seats, however rarely).
- Scope of the first version: work, housing and shopping only, compared with today's citizens on the same towns and targets.
