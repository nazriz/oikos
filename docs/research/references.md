# References: ideas we use, and where

Every idea Terrarium takes from someone else's work goes here: what it is, the citation, and where we use it. Keep it
current; it's what we cite from. Entries marked **(to confirm)** are cited from memory or a secondary source and need
checking against the original before publication. Behaviour rules' own sources stay in docs/behaviour/ (each doc's
sources); this list is for the architecture and design ideas.

## Citizens' minds (docs/design/ai-citizens.md; research: docs/research/citizen-minds-2026-09.md)

### How a citizen decides

| Idea | Citation | Used in |
|---|---|---|
| Needs, and objects that advertise what they satisfy: the intelligence is in the world | Forbus, K. & Wright, W. (2001), "Some notes on programming objects in The Sims" (Northwestern University class notes) **(to confirm)**; The Sims (Maxis, 2000) | Offers (2a), in our "facts, not advertised needs" form |
| Utility AI: considerations, each an input through a response curve, multiplied | Mark, D. (2009), *Behavioral Mathematics for Game AI*, Course Technology; Mark, D. & Lewis, M. (2015), "Building a Better Centaur: AI at Massive Scale" (the Infinite Axis Utility System), GDC AI Summit; [gameai.com/iaus](https://www.gameai.com/iaus.php) | The body's appraisal of an option |
| Switching between strategies (repeating, imitating, comparing, deliberating) by satisfaction and certainty | Jager, W. (2000), *Modelling Consumer Behaviour*, PhD thesis, University of Groningen; Jager, W. & Janssen, M. (2012), "An updated conceptual framework for integrated modeling of human decision making: The Consumat II", ECCS 2012 **(to confirm)** | When a citizen acts by habit, copies others, compares, or deliberates; when it asks the model |
| Learning from experience: attractions updated by payoffs received and forgone, chosen by logit | Camerer, C. & Ho, T.-H. (1999), "Experience-weighted attraction learning in normal form games", *Econometrica* 67(4), 827–874; Ho, T.-H., Camerer, C. & Chong, J.-K. (2007), "Self-tuning experience weighted attraction learning in games", *Journal of Economic Theory* 133, 177–198 | How a citizen learns what's worth taking up, including something new, by trying it |
| Reinforcement learning as a model of how people play repeated games | Erev, I. & Roth, A. E. (1998), "Predicting how people play games", *American Economic Review* 88(4), 848–881 | A simpler alternative to EWA; one of the two to test |
| Options kept until a cheap signal says to reconsider | Kaiya, Z. et al. (2023), "Lyfe Agents: Generative agents for low-cost real-time social interactions", [arXiv:2310.02172](https://arxiv.org/abs/2310.02172) | Routines ("repeating" in CONSUMAT's terms) |
| Planning a goal as a chain of steps | Orkin, J. (2006), "Three States and a Plan: The AI of F.E.A.R.", GDC 2006; Orkin, J. (2004), "Applying Goal-Oriented Action Planning to Games", *AI Game Programming Wisdom 2*; hierarchical task networks in Killzone 2/3 and Horizon Zero Dawn (Guerrilla Games) **(HTN source to confirm)** | Multi-step goals (moving house, changing jobs): a later phase |

### Who a citizen is

| Idea | Citation | Used in |
|---|---|---|
| Ten basic human values, in a circle of compatible and opposed values | Schwartz, S. H. (1992), "Universals in the content and structure of values", *Advances in Experimental Social Psychology* 25, 1–65; in agent-based models: [JASSS 27(1) 2 (2024)](https://www.jasss.org/27/1/2.html), [JASSS 23(4) 6 (2020)](https://www.jasss.org/23/4/6.html) | What a citizen believes in; what weighs its needs; where religion and politics attach |
| A pan-cultural order of the ten values' importance (benevolence highest, power lowest) | Schwartz, S. H. & Bardi, A. (2001), "Value hierarchies across cultures: Taking a similarities perspective", *Journal of Cross-Cultural Psychology* 32(3), 268–290 **(to confirm)** | The profile's placeholder for people's values, until a place's own survey data |
| Values (what one believes) apart from facets (how one acts); values set needs | Dwarf Fortress (Bay 12 Games), [personality values](https://dwarffortresswiki.org/index.php/Personality_value), [facets](https://dwarffortresswiki.org/index.php/DF2014:Personality_facet), [needs](https://dwarffortresswiki.org/Need) | The split between values and temperament; needs weighted by values |
| Basic needs, emotion and closeness in generative agents | Wang, Z., Chiu, Y. Y. & Chiu, Y. C. (2023), "Humanoid Agents", EMNLP demos, [arXiv:2310.05418](https://arxiv.org/abs/2310.05418) | Needs that rise and fall |
| A value system of 11 desires, including spiritual satisfaction, driving activity choice | Wang, Y. et al. (2025), "Simulating Human-like Daily Activities with Desire-driven Autonomy", ICLR 2025, [OpenReview](https://openreview.net/forum?id=3ms8EQY7f8) | The first set of needs, and meaning and spirituality later |
| Emotions from appraisal: 22 types, from events against goals, others' acts against standards, and objects against tastes | Ortony, A., Clore, G. L. & Collins, A. (1988), *The Cognitive Structure of Emotions*, Cambridge University Press | Emotions: gratitude, resentment, hope, fear, colouring decisions and relationships (a later phase) |
| An agent architecture built on OCC appraisal | Dias, J., Mascarenhas, S. & Paiva, A. (2014), "FAtiMA Modular: Towards an agent architecture with a generic appraisal framework", in *Emotion Modeling*, LNCS 8750 **(to confirm)** | How to compute appraisal cheaply |

### How citizens live together

| Idea | Citation | Used in |
|---|---|---|
| Social practices: recurring situations that offer affordances; agents still choose | Evans, R. & Short, E. (2014), "Versu—A Simulationist Storytelling System", *IEEE Transactions on Computational Intelligence and AI in Games* 6(2), 113–130 | Practices (2b) |
| Social physics: relationships, history and norms drive social exchanges (volitions) | McCoy, J., Treanor, M., Samuel, B., Mateas, M. & Wardrip-Fruin, N. (2011), "Prom Week: social physics as gameplay", FDG 2011; McCoy, J. et al. (2014), "Social Story Worlds with Comme il Faut", *IEEE TCIAIG* 6(2); Samuel, B., Reed, A. A., Maddaloni, P., Mateas, M. & Wardrip-Fruin, N. (2015), "The Ensemble Engine: Next-Generation Social Physics", FDG 2015 | Relationships and social moves (befriend, help, complain, gossip): a later phase |
| Ensemble extended with language models | "Paradise: An Experiment Extending the Ensemble Social Physics Engine with Language Models", FDG 2024, [ACM](https://dl.acm.org/doi/10.1145/3649921.3659841) **(not read: paywalled)** | To read before the relationships phase |
| Characters' knowledge: observed, told, misremembered, forgotten, lied about | Ryan, J. et al. (2017), "Simulating Character Knowledge Phenomena in Talk of the Town", *Game AI Pro 3*, ch. 37 | Knowledge and belief spread (5) |
| Conformist and prestige-biased transmission | Boyd, R. & Richerson, P. J. (1985), *Culture and the Evolutionary Process*, University of Chicago Press; Henrich, J. & Boyd, R. (1998), "The evolution of conformist transmission and the emergence of between-group differences", *Evolution and Human Behavior* 19(4); Henrich, J. & Gil-White, F. (2001), "The evolution of prestige", *Evolution and Human Behavior* 22(3), 165–196 **(to confirm)** | Imitation: whom citizens copy, and how new practices spread |
| Conversion through networks and participation, not persuasion alone | Stark, R. & Lofland, J. (1965), "Becoming a World-Saver: A Theory of Conversion to a Deviant Perspective", *American Sociological Review* 30(6), 862–875 **(to confirm)** | Belief (5): being told only firms up a belief already held; conversion comes through taking part |
| Credibility-enhancing displays: belief follows what people do | Henrich, J. (2009), "The evolution of costly displays, cooperation and religion", *Evolution and Human Behavior* 30(4), 244–260 | Belief strengthening with others' costly displays (5) |
| Diffusion of innovations: relative advantage, compatibility, complexity, trialability, observability; stages from knowledge to confirmation | Rogers, E. M. (2003), *Diffusion of Innovations*, 5th ed., Free Press; review: Zhang, H. & Vorobeychik, Y. (2019), "Empirically grounded agent-based models of innovation diffusion", *Artificial Intelligence Review* 52, [arXiv:1608.08517](https://arxiv.org/abs/1608.08517) | How citizens come to take up something new, a steward's construct included |
| Threshold models of collective behaviour | Granovetter, M. (1978), "Threshold Models of Collective Behavior", *American Journal of Sociology* 83(6) | Already used (petition signing); adoption thresholds |
| Hierarchical task networks: tasks decomposed by methods chosen among alternatives | Erol, K., Hendler, J. & Nau, D. S. (1994), "HTN planning: complexity and expressivity", AAAI-94; in games: Humphreys, T. (2013), "Exploring HTN Planners through Example", *Game AI Pro*, ch. 12 **(to confirm)** | Goals with steps (3d): one level, methods tried in turn |
| Emotions by appraisal: events against goals, acts against standards, objects liked or not | Ortony, A., Clore, G. L. & Collins, A. (1988), *The Cognitive Structure of Emotions*, Cambridge University Press; FAtiMA: Dias, J., Mascarenhas, S. & Paiva, A. (2014), "FAtiMA Modular: Towards an Agent Architecture with a Generic Appraisal Framework", in *Emotion Modeling*, Springer **(to confirm)** | Feelings (3d): anger, fear, gratitude, fading |
| Taking part in social groups, and weekly contact with family and friends (Australia) | Australian Bureau of Statistics (2020), *General Social Survey: Summary Results, Australia, 2019*: 50.0% of adults took part in a social group in the last 12 months; 67.8% had weekly face-to-face contact outside the household | Who belongs to a group at the start, and a calibration target for gatherings (the profile) |
| Weak ties carry news: former workmates, housemates, fellow members | Granovetter, M. (1973), "The Strength of Weak Ties", *American Journal of Sociology* 78(6), 1360–1380 | Contacts, including those met at gatherings |

### Religion

| Idea | Citation | Used in |
|---|---|---|
| Computational models of religion: ritual, identity, credibility, religiosity against existential security | Modeling Religion Project, [Center for Mind and Culture](https://mindandculture.org/projects/past-projects/modeling-religion-project/); Gore, R., Lemos, C., Shults, F. L. & Wildman, W. J. (2018), "Forecasting Changes in Religiosity and Existential Security with an Agent-Based Model", *JASSS* 21(1) 4 | Belief and religion as world content (VISION 16), later |
| Costly groups can be stable in a larger population | [JASSS 14(3) 6](https://jasss.soc.surrey.ac.uk/14/3/6.html) **(authors to confirm)** | The same, later |

### Scaling minds with models

| Idea | Citation | Used in |
|---|---|---|
| Generative agents: memory, reflection, planning | Park, J. S. et al. (2023), "Generative Agents: Interactive Simulacra of Human Behavior", UIST 2023 | The upper bound we don't pay for |
| Reusing a model's reasoning for similar situations | Yu, Y. et al. (2024), "Affordable Generative Agents", *TMLR*, [arXiv:2402.02053](https://arxiv.org/abs/2402.02053) | Remembering the model's answers (4) |
| Asking per archetype, not per person; diversity is the cost | Chopra, A. et al. (2024), "On the limits of agency in agent-based models", [arXiv:2409.10568](https://arxiv.org/abs/2409.10568); Chopra, A. (2025), "Large Population Models", [arXiv:2507.09901](https://arxiv.org/abs/2507.09901); [AgentTorch](https://github.com/AgentTorch/AgentTorch) | Per-archetype answers; personal traits after the lookup (4) |
| Binned context, candidate sets, repeated model scores compiled to lookup tables | "GenWorld: Empirically Grounded Urban Simulation Infrastructure for Scalable LLM-Agent Studies" (2026), [arXiv:2606.27650](https://arxiv.org/abs/2606.27650) | Remembered answers as tables (4) |
| Large-scale model societies | Piao, J. et al. (2025), "AgentSociety", [arXiv:2502.08691](https://arxiv.org/abs/2502.08691); Altera.AL (2024), "Project Sid", [arXiv:2411.00114](https://arxiv.org/abs/2411.00114) | Context; Project Sid saw religion transmitted |
| Fast and slow: a small model imitating a large one, the large one when needed | Lin, B. Y. et al. (2023), "SwiftSage", NeurIPS 2023, [arXiv:2305.17390](https://arxiv.org/abs/2305.17390); agent distillation surveys, [arXiv:2505.13820](https://arxiv.org/abs/2505.13820), [arXiv:2604.00626](https://arxiv.org/abs/2604.00626) | The path to a trained citizen model (7) |
| A model game master adjudicating the world | Vezhnevets, A. S. et al. (2023), "Generative agent-based modeling with actions grounded in physical, social, or digital space using Concordia", [GitHub](https://github.com/google-deepmind/concordia) | **Not taken**: the kernel adjudicates |

### Warnings we design against

| Idea | Citation | Used in |
|---|---|---|
| Framing swings results in model social simulations; audits needed (TRAILS) | "Stop Drawing Scientific Claims from LLM Social Simulations Without Robustness Audits" (2026), [arXiv:2605.18890](https://arxiv.org/abs/2605.18890) | The robustness audit of remembered answers (4) |
| Model personas collapse to an "average person"; segmentation helps a little | "From Individual to Society" (ACM Computing Surveys), [doi:10.1145/3800683](https://dl.acm.org/doi/10.1145/3800683); "Restoring Heterogeneity in LLM-based Social Simulation" (2026), [arXiv:2604.06663](https://arxiv.org/abs/2604.06663) | No personas: circumstances and traits (4) |
| Norms are hard to infer by watching when most comply | Savarimuthu, B. T. R. et al. (2010), "Obligation Norm Identification in Agent Societies", [*JASSS* 13(4) 3](https://www.jasss.org/13/4/3.html) | Constructs as legible records (2) |

## The translator (docs/design/translator-and-resolver.md)

### The local model's shape (16.10, proposed)

| Idea | Citation | Used in |
|---|---|---|
| A model that answers typed questions about a state with calibrated distributions, not text ("System One" models) | TypeSafe AI, Jev documentation, [docs.typesafe.ai](https://docs.typesafe.ai/introduction) (read 2026-09-30); its architecture isn't described there | The idea: the translator decides and copies, never generates |
| Intent detection and slot filling as one model | Liu, B. & Lane, I. (2016), "Attention-Based Recurrent Neural Network Models for Joint Intent Detection and Slot Filling", Interspeech 2016 **(to confirm)** | The baseline build: a verdict head and span heads |
| Pointing at the input instead of generating: outputs that are positions in the input | Vinyals, O., Fortunato, M. & Jaitly, N. (2015), "Pointer Networks", NeurIPS 2015 **(to confirm)**; copying in sequence-to-sequence models: See, A., Liu, P. J. & Manning, C. D. (2017), "Get To The Point", ACL 2017 **(to confirm)** | Copy-only ids and text in the target build |
| Proper scoring rules: log loss rewards honest probabilities | Gneiting, T. & Raftery, A. E. (2007), "Strictly Proper Scoring Rules, Prediction, and Estimation", *Journal of the American Statistical Association* 102(477), 359–378 **(to confirm)** | The training objective, and why no reinforcement learning is needed |
| Modern networks are overconfident; temperature scaling and expected calibration error | Guo, C., Pleiss, G., Sun, Y. & Weinberger, K. Q. (2017), "On Calibration of Modern Neural Networks", ICML 2017 **(to confirm)** | Calibrating the translation's confidence; the calibration measure |

## Laws and claims (D19, D27; kernel/crates/law)

| Idea | Citation | Used in |
|---|---|---|
| A statement's grammar: attributes, deontic, aim, conditions, or else | Crawford, S. E. S. & Ostrom, E. (1995), "A Grammar of Institutions", *American Political Science Review* 89(3), 582–600 | Laws' and procedures' `adico` part |
| Positions a claim can hold (a liberty, a right, and their correlatives) | Hohfeld, W. N. (1913), "Some Fundamental Legal Conceptions as Applied in Judicial Reasoning", *Yale Law Journal* 23(1), 16–59 | Claim records' `position`; the law reader's `holds_liberty` and `holds_right` |
| A small, total, side-effect-free expression language, with errors that `&&` and `\|\|` absorb when the other side decides | Google, *Common Expression Language* specification, [github.com/google/cel-spec](https://github.com/google/cel-spec); the parser we use is `cel-parser` from [cel-rust](https://github.com/cel-rust/cel-rust) | Statements' `formal` conditions (a subset: integers only, allowlisted functions); the evaluator is ours |
