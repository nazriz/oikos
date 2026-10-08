# References: ideas we use, and where

Every idea Oikos takes from someone else's work goes here: what it is, the citation, and where we use it. Keep it
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
| Laws are drafted by a drafting office from instructions, not by the lawmaker who wants them | Office of Parliamentary Counsel (UK), *Drafting Guidance* (gov.uk); Xanthaki, H. (2014), *Drafting Legislation: Art and Technology of Rules for Regulation*, Hart **(to confirm)** | The council's clerk writes a law from a form's figures (`city.council_clerk`; docs/design/ai-citizens.md 2e) |
| Figures a lawmaker will want to change are kept apart from a law's wording, so that changing one doesn't mean redrafting (schedules to an Act; amounts and periods prescribed or indexed) | Thornton, G. C. (1996), *Legislative Drafting*, 4th ed., Butterworths, on schedules **(to confirm)** | Law schedules (`worlds/law/schedules.json`): a law's figures, and its words and rule written from them |
| Amendment by substitution: the amending law states what it replaces, and readers take the text as amended | Thornton (1996), on textual amendment **(to confirm)** | An amended law names the law it replaces; a reader's book takes it in the old one's place (`Book`, participants/src/behaviour/common.ts) |
| A small, total, side-effect-free expression language, with errors that `&&` and `\|\|` absorb when the other side decides | Google, *Common Expression Language* specification, [github.com/google/cel-spec](https://github.com/google/cel-spec); the parser we use is `cel-parser` from [cel-rust](https://github.com/cel-rust/cel-rust) | Statements' `formal` conditions (a subset: integers only, allowlisted functions); the evaluator is ours |

## Nature (docs/behaviour/nature.md; kernel/crates/nature)

| Idea | Citation | Used in |
|---|---|---|
| Logistic growth toward a carrying capacity | Verhulst, P.-F. (1838), "Notice sur la loi que la population suit dans son accroissement", *Correspondance mathématique et physique* 10, 113–121 | Births and crowding deaths |
| Fewer breed when too few are near (an Allee effect) | Allee, W. C. (1931), *Animal Aggregations*, University of Chicago Press | `min_viable` |
| Populations in patches, going extinct and recolonised (metapopulations) | Levins, R. (1969), "Some demographic and genetic consequences of environmental heterogeneity for biological control", *Bulletin of the Entomological Society of America* 15, 237–240; Hanski, I. (1998), "Metapopulation dynamics", *Nature* 396, 41–49 | Fragmentation: barriers and dispersal ranges |
| Mean crowding: an individual's experience of density exceeds the mean density | Lloyd, M. (1967), "Mean crowding", *Journal of Animal Ecology* 36, 1–30 | Crowding counts the others, not oneself |
| Natal dispersal: the young leave where they were born | Greenwood, P. J. (1980), "Mating systems, philopatry and dispersal in birds and mammals", *Animal Behaviour* 28, 1140–1162 **(to confirm)** | Newborns disperse out of the home range |
| Dispersal as a correlated random walk | Kareiva, P. M. & Shigesada, N. (1983), "Analyzing insect movement as a correlated random walk", *Oecologia* 56, 234–238 **(to confirm)** | The dispersal walk |
| Spinning a model up to its own equilibrium before the experiment | Common practice in climate and ecosystem models (e.g. ocean and land-carbon spin-up) **(a citation to find)** | `nature_spin_up_days` |
| Imperfect detection in wildlife surveys | MacKenzie, D. I. and others (2002), "Estimating site occupancy rates when detection probabilities are less than one", *Ecology* 83, 2248–2255 **(to confirm)** | Surveys find each animal with a detection chance |


## Elections and information (docs/behaviour/elections.md, news.md; docs/design/world-expansion.md §3)

| Idea | Citation | Used in |
|---|---|---|
| Retrospective voting: voters judge the incumbent on how things have gone for them | Fiorina, M. P. (1981), *Retrospective Voting in American National Elections*, Yale University Press **(to confirm)** | A citizen's approval of the town's government follows its own satisfaction and anger at the town |
| Economic voting | Lewis-Beck, M. S. & Stegmaier, M. (2000), "Economic determinants of electoral outcomes", *Annual Review of Political Science* 3, 183–219 **(to confirm)** | As above: fortunes over the term move approval |
| Instant-runoff (preferential) counting | The single transferable vote in single-member form (Hare); Victoria's preferential voting, *Local Government Act 2020* (Vic) **(to confirm the section)** | The electoral office's count |
| News values: what makes an event news | Galtung, J. & Ruge, M. H. (1965), "The structure of foreign news", *Journal of Peace Research* 2, 64–91 **(to confirm)** | The paper's weights by kind of record (placeholders) |
| Media slant: what a paper runs, and how, leans | Gentzkow, M. & Shapiro, J. M. (2010), "What drives media slant? Evidence from U.S. daily newspapers", *Econometrica* 78, 35–71 **(to confirm)** | The paper's `leaning_bps` |

## Public services (docs/behaviour/health.md, education.md; docs/design/world-expansion.md §4)

| Idea | Citation | Used in |
|---|---|---|
| Human capital: schooling raises productivity, and earnings rise log-linearly with years of it | Mincer, J. (1974), *Schooling, Experience, and Earnings*, NBER **(to confirm)** | Skill speeds work (`labour_by`), steeply enough to give the profile's return a year |
| The return to a year of schooling in Australia | Leigh, A. (2008), "Returns to education in Australia", *Economic Papers* 27(3), 233–249 **(to confirm)** | The profile's `return_per_year_bps` (10%) |
| Credentials as a signal employers screen on | Spence, M. (1973), "Job market signaling", *Quarterly Journal of Economics* 87(3), 355–374 | Not yet used: certificates exist, employers don't read them (leaves out) |

## Homes for sale (docs/behaviour/ownership.md)

| Idea | Citation | Used in |
|---|---|---|
| Sellers cut their asking price the longer a home is on the market | Merlo, A. & Ortalo-Magné, F. (2004), "Bargaining over residential real estate: evidence from England", *Journal of Urban Economics* 56(2), 192–216 **(to confirm)** | A home unsold after a month is relisted for less, down to a floor |
| Lending above 80% of a home's value as higher risk (a 20% deposit, or mortgage insurance) | APRA, *Prudential Practice Guide APG 223: Residential Mortgage Lending* **(to confirm)** | The bank's `max_lvr_bps`; buyers' `deposit_bps` |

## What each seat knows, and what it looks up (docs/decisions.md, 2026-10-08, "Nobody has the land register by heart"; docs/behaviour/ownership.md)

| Idea | Citation | Used in |
|---|---|---|
| Title by registration: the register, not a chain of deeds, says who owns land; it is public and is searched folio by folio, for a fee | Torrens, R. R. (1859), *The South Australian System of Conveyancing by Registration of Title*; Transfer of Land Act 1958 (Vic), s 27 (the Register) and s 114 (searches) **(to confirm)**; Land Use Victoria, title and plan searches (LANDATA) **(to confirm)** | Citizens', landlords' and the builder's `lots`, `titles` and `dealings` channels are shown on request and searched by a lot's or a title's id; no fee is charged (left out) |
| A buyer's conveyancer searches the title before settlement and confirms registration after | Consumer Affairs Victoria, "Conveyancing and transferring land ownership" **(to confirm)** | A person passed a title looks up the title and the dealings in it before treating the land as theirs (`citizen.ts` `registerLooks`, `holderOf`); the search before paying is left out |
| People have limited attention, and inform themselves when it is worth their while | Simon, H. A. (1955), "A behavioral model of rational choice", *Quarterly Journal of Economics* 69(1), 99–118; Sims, C. A. (2003), "Implications of rational inattention", *Journal of Monetary Economics* 50(3), 665–690 **(to confirm)** | The rule the change follows: a seat is shown what someone in its position would be sent, and searches for the rest when a decision needs it (D43's attention, applied to the registers) |
| An employer gives the employees an enterprise agreement covers access to it | Fair Work Act 2009 (Cth), s 180 (pre-approval steps: access and explanation for the employees covered) **(to confirm)** | A person in work reads the agreements at their own workplace when they plan (`citizen.ts`, `work_board`); nobody is shown every workplace's |
## Who owns firms (docs/behaviour/firm-ownership.md; proposed 2026-10-08)

Each read 2026-10-08 unless marked.

| Idea | Citation | Used in |
|---|---|---|
| Small firms are their owners': nearly every business is small | ABS, *Counts of Australian Businesses, including Entries and Exits*, July 2022 to June 2026 (released 18 August 2026): 97.4% of businesses have under 20 employees; partnerships 7.0%, sole proprietors 30.1%. https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2022-jun2026 | Shops and landlords closely held (`firm_ownership.forms_bps`, `closely_held.households_bps`) |
| Most businesses are family businesses | KPMG and Family Business Australia surveys (2021, 2022): 67% of Australian businesses **(to confirm: seen only as quoted)** | The same |
| A minority of households holds shares directly, far more of the wealthy, who hold most of the value; business assets are the wealthiest fifth's | RBA Bulletin, April 2009, "The Composition and Distribution of Household Wealth in Australia" (HILDA 2006: 38% of households; 8%, 25% and 72% of the lowest, second and highest fifths; 85% of business assets' value in the highest). https://www.rba.gov.au/publications/bulletin/2009/apr/2.html ; RBA Bulletin, March 2012 (HILDA 2010: 34%). https://www.rba.gov.au/publications/bulletin/2012/mar/3.html ; ASX, *Australian Investor Study 2023* (38% of adults hold listed investments). https://asx.com.au/content/dam/asx/about/media-releases/2023/29-20-june-women-younger-australians-lift-number-of-adult-investors.pdf | `direct_holders.by_wealth_fifth_bps`; `closely_held.owner_wealth_fifth_bps` |
| The same pattern elsewhere: few hold stocks directly, the mean holding is many times the median, a fifth of families own a private business | Federal Reserve, "Changes in U.S. Family Finances from 2019 to 2022: Evidence from the Survey of Consumer Finances" (October 2023). https://www.federalreserve.gov/publications/october-2023-changes-in-us-family-finances-from-2019-to-2022.htm | That the mechanism is general, not one place's (docs/behaviour/firm-ownership.md) |
| Most households' stake in companies is through retirement funds: two and a half times what they hold directly | ABS, *Australian National Accounts: Finance and Wealth*, June quarter 2026 (superannuation reserves 4,433.1 billion; shares and other equity 1,749.5 billion). https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-finance-and-wealth/latest-release ; RBA Bulletin, June 2016, "Household Wealth in Australia: Evidence from the 2014 HILDA Survey" (84% of households hold superannuation). https://www.rba.gov.au/publications/bulletin/2016/jun/1.html | The profile's `retirement_fund.share_bps_of_local` and `member_bps`: used only by a world that asks for a retirement fund (off by default since 2026-10-08) |
| A retirement fund pays retired members a pension from their balance, at least a yearly share of it that rises with age; at death the balance goes to the estate | Moneysmart (ASIC), "Account-based pensions". https://moneysmart.gov.au/retirement-income/account-based-pensions ; APRA, *Quarterly superannuation statistics*, March 2026 (benefit payments 143.5 billion in the year, contributions 226.1 billion, return 7.4%). https://www.apra.gov.au/quarterly-superannuation-performance-statistics-highlights-march-2026 | `fund.retirement` (in a world that asks for a fund): `drawdown_bps_by_age`, `pay_every_days`, a member's death |
| What a fund costs | Productivity Commission (2018), *Superannuation: Assessing Efficiency and Competitiveness*: fees about 1.1% of assets a year **(to confirm: seen only as quoted)** | The profile's `retirement_fund.cost_bps_of_income` (with APRA's return) |
| Landlords are households with one investment property, or a few | RBA Bulletin, May 2026, "Insights from New Data on Australian Housing Investors" (about 70% of investors own one; nearly 40% are in the top fifth of incomes). https://rba.gov.au/publications/bulletin/2026/may/insights-from-new-data-on-australian-housing-investors.html | Landlords closely held, by wealthier households |

## Roads and weather (docs/behaviour/daily-round.md, weather.md)

| Idea | Citation | Used in |
|---|---|---|
| Comfortable walking speed, about 1.4 m/s | Bohannon, R. W. (1997), "Comfortable and maximum walking speed of adults aged 20–79 years", *Age and Ageing* 26(1), 15–19 **(to confirm)** | Travel off roads, 18 s a 25 m cell |
| The urban heat island: built ground hotter than open land | Oke, T. R. (1982), "The energetic basis of the urban heat island", *Quarterly Journal of the Royal Meteorological Society* 108(455), 1–24 **(to confirm)** | More heat on built cells and roads |
| Heatwaves raise illness and death, most among the old | Department of Human Services (2009), *January 2009 Heatwave in Victoria: an Assessment of Health Impacts* **(to confirm)** | Heat raises the chance of illness; the elderly die of it more (fatality by age) |

## Crime (docs/behaviour/crime.md; docs/design/world-expansion.md §7.2)

| Idea | Citation | Used in |
|---|---|---|
| Offending as a choice weighed against the chance and cost of being caught | Becker, G. S. (1968), "Crime and punishment: an economic approach", *Journal of Political Economy* 76(2), 169–217 | The chance of taking falls with the chance of being caught one reckons |
| Routine activity: crime needs a motivated offender, a suitable target, and no capable guardian | Cohen, L. E. & Felson, M. (1979), "Social change and crime rate trends: a routine activity approach", *American Sociological Review* 44(4), 588–608 | Taking only where one is, from goods there (work), in need |

## How a death comes to be known (docs/behaviour/deaths.md; docs/decisions.md, 2026-10-08)

| Idea | Citation | Used in |
|---|---|---|
| How long people who die alone at home lie before they are found: counted, by bands of days | National Police Agency of Japan, people who died alone at home in 2025 (76,941: 28,398 found the same or next day, 15,865 in 2 to 3 days, 10,456 in 4 to 7, 22,222 after 8 or more, of them 7,148 after a month or more and 208 after a year or more). Read 2026-10-08 in a press summary of the agency's release, not in its own tables **(to confirm)** | The profile's `life.found_alone_after`; when the police call at a home that has stood empty since a death (`police.ts`) |
| A doctor notifies the registrar of a death within 48 hours; the funeral director registers it within 7 days of the burial or cremation | Births, Deaths and Marriages Victoria, "Legal requirements: doctors" and "Legal requirements: funeral directors" (under the Births, Deaths and Marriages Registration Act 1996 (Vic)); read 2026-10-08 | Why those who share a home report with no waiting time added; the gap to registration itself is left out (deaths.md) |

## The translator's own model (translator/model; docs/design/translator-and-resolver.md §16.10)

| Idea | Citation | Used in |
|---|---|---|
| Output steps that point at positions of the input instead of writing from a vocabulary | Vinyals, O., Fortunato, M. & Jaitly, N. (2015), "Pointer networks", *Advances in Neural Information Processing Systems* 28 | Every id, amount, name and text in a program is a span of the request (`encode.ts`, the model's span heads) |
| A word known by hashes of its character n-grams, so an unseen word still has a representation | Bojanowski, P., Grave, E., Joulin, A. & Mikolov, T. (2017), "Enriching word vectors with subword information", *Transactions of the ACL* 5, 135–146 | A piece of the request is known by hashes of itself and of its letters three at a time (`py/model.py`, `features`): no word list |
| Reader and writer built of attention layers | Vaswani, A. et al. (2017), "Attention is all you need", *Advances in Neural Information Processing Systems* 30 | The model's reader and writer |
| A small pretrained encoder, fine-tuned, as the reader (the second arm) | He, P., Gao, J. & Chen, W. (2023), "DeBERTaV3: improving DeBERTa using ELECTRA-style pre-training with gradient-disentangled embedding sharing", *ICLR*; the published model `microsoft/deberta-v3-xsmall` (MIT licence, read 2026-10-06) | `py/train.py --encoder`, `py/model.py` (`Config.encoder`), `py/tokens.py` |
| Fine-tuning a pretrained encoder at a lower rate than the layers added on top of it | Howard, J. & Ruder, S. (2018), "Universal language model fine-tuning for text classification", *ACL* (discriminative fine-tuning) **(to confirm)** | `py/train.py`: `--encoder-lr` for the encoder, `--lr` for the writer and heads |
| Fitting one temperature on held-out data so stated confidence matches how often answers are right (to confirm: not built yet) | Guo, C., Pleiss, G., Sun, Y. & Weinberger, K. Q. (2017), "On calibration of modern neural networks", *ICML* | Planned for the threshold below which the model asks back |

## Nobody has a god's view (docs/no-god-view.md; docs/decisions.md, 2026-10-08)

Sources opened on 2026-10-08 unless marked.

| Idea | Citation | Used in |
|---|---|---|
| A roll is kept by the electoral authority, open to inspection at its offices, not sent out or sold | Australian Electoral Commission, "About the electoral roll", https://www.aec.gov.au/Enrolling_to_vote/About_Electoral_Roll/ ; Electoral and Referendum Amendment (Access to Electoral Roll and Other Measures) Act 2004 (Cth), inserting ss 90A and 90B of the Commonwealth Electoral Act 1918 (the current compilation's wording **(to confirm)**); for comparison, North Northamptonshire Council, "Viewing the electoral register" (the full register "can only be inspected under supervision at the council offices") | The roll is the electoral office's own; an elector knows by having enrolled (docs/behaviour/elections.md, "Who sees the roll") |
| A household deals with a handful of sellers, knows their prices, and now and then looks at one more | Lengnick, M. (2013), "Agent-based macroeconomics: A baseline model", *Journal of Economic Behavior & Organization* 86, 102-120 (Table 1: n = 7 sellers; a monthly search probability of 0.25; a 1% threshold, not used here); Ding, M., Gaskin, S. & Hauser, J. (2009), "A critical review of non-compensatory and compensatory models of consideration-set decisions", Sawtooth Software Conference; Hauser, J. & Wernerfelt, B. (1990), "An evaluation cost model of consideration sets", *Journal of Consumer Research* 16(4) **(to confirm: not opened)**; 4.4 grocery stores a month (Food Marketing Institute, as reported by The Takeout, 2019) **(to confirm)** | Shops known by passing them and by word of mouth (docs/behaviour/citizen.md, "Which shops a household knows"); `spending.shops_known`, `spending.shop_search_bps_per_month` |
| Buyers look at listings when they are buying | National Association of Realtors (2024), *Profile of Home Buyers and Sellers*, as reported by Virginia REALTORS, https://virginiarealtors.org/2024/12/09/key-takeaways-from-nars-2024-profile-of-home-buyers-and-sellers/ (10 weeks, 7 homes); the share who found their home online **(to confirm)** | The sale board is searched when a purchase is in prospect (same section) |
| A price index is made by a statistics office from a sample of outlets | Australian Bureau of Statistics (2025), *Consumer Price Index: Concepts, Sources and Methods*, "Price collection", https://www.abs.gov.au/statistics/detailed-methodology-information/concepts-sources-methods/consumer-price-index-concepts-sources-and-methods/2025/price-collection | `world.statistics`; the union's claims (docs/behaviour/boundary.md, unions.md) |
| A union bargains for its members, within the industries its rules cover | Fair Work Act 2009 (Cth) s 176 **(to confirm)** | `union.organiser`: workplaces learned from members, `industries` |
| A death is made known by telling those concerned, not by a public register | Births, Deaths and Marriages Registration Act 1996 (Vic) ss 37, 39 (authorised version 045); Births, Deaths and Marriages Victoria, "Register a death", https://www.bdm.vic.gov.au/deaths/register-a-death ; GOV.UK, "Tell Us Once", https://www.gov.uk/after-a-death/organisations-you-need-to-contact-and-tell-us-once ; Australian Death Notification Service, https://deathnotification.gov.au/ **(to confirm)**; ANZ, "Deceased estates", https://www.anz.com.au/personal/bank-accounts/your-account/deceased-estates/ ; Australian Electoral Commission (2000), submission 39 to the House Economics Committee's inquiry into tax file numbers (s 108 lists of deaths), https://aphref.aph.gov.au/house/committee/efpa/tfnaudit/tfnsub39.pdf ; Southern Cross University, "Death of an employee", https://scu.edu.au/staff/hr-services/a-z-easyfind/death-of-an-employee ; Consumer Affairs Victoria, "If a renter or rental provider dies"; a returned payment's reason "account holder deceased" **(to confirm)** | The registry's entry is addressed to those concerned; the bank tells whoever pays a dead person (docs/behaviour/deaths.md, "Who is told") |
| A seat is shown the price list of whom it deals with, not every seller's | Trade practice: a builder quotes on its own published rates; a supplier sends its price list to its customers **(to confirm: no source opened; the rule narrows what was shown to what each office's code already read)** | `pricesOf` and `market` in `worlds/generator/generate.ts` |

## What an act rests on (contracts: Basis; docs/decisions.md, 2026-10-08)

| Idea | Citation | Used in |
|---|---|---|
| A payment is passed on its supporting documents together (the order, the record of receipt, the invoice) and on the authority to spend (the appropriation), each cited on the voucher | The three-way match and the payment voucher of accounts-payable and public-finance practice: e.g. Romney, M. & Steinbart, P., *Accounting Information Systems*, Pearson (the expenditure cycle) **(to confirm)**; International Federation of Accountants, *Handbook of International Public Sector Accounting Pronouncements* (on appropriations as authority to spend) **(to confirm)** | `basis` as one record or several, in the order cited (blocks and records: `Basis`); the translator's rule that every record cited in support is a basis and the record acted on is not |

## Running large towns (docs/decisions.md, 2026-10-08; participants/src/behaviour/common.ts)

| Idea | Citation | Used in |
|---|---|---|
| Values that are the same are held once and found again by what they are made of (hash consing; the flyweight) | Goto, E. (1974), "Monocopy and associative algorithms in extended Lisp", Technical Report 74-03, University of Tokyo **(to confirm)**; Gamma, E., Helm, R., Johnson, R. & Vlissides, J. (1994), *Design Patterns*, Addison-Wesley (Flyweight) | A book's shelves: a list shown whole to many readers is one shelf, found by its records, with each reader's differences beside it (`Book`, `Pages`) |

## Reading an amount as its place writes it (participants/src/calls.ts `parseAmount`; docs/decisions.md, 2026-10-08)

| Idea | Citation | Used in |
|---|---|---|
| A currency code is a country's two letters and a letter for the currency, so a sign several currencies share is told apart by the country's letters before it | ISO 4217, *Codes for the representation of currencies*, International Organization for Standardization **(to confirm: the standard was not opened; the two-letter prefix before a sign is common usage, not part of it)** | A marker of the world's money: its sign with the first two letters of its code |
| Digits grouped as the last three and then twos, with lakh (a hundred thousand) and crore (ten million) for the larger groups | The Indian numbering system, as in everyday and official use in South Asia **(to confirm with a source: e.g. the Reserve Bank of India's own publications write sums this way)** | Groups of two read in any currency; lakh and crore among the multipliers; the training data's `grouping: "twos"` |
| Where a place's decimal mark and digit grouping differ, a number is read by its locale, and a lone separator with three digits after it cannot be read without one | Unicode CLDR, number formatting patterns and symbols (decimal and grouping separators by locale), Unicode Technical Standard #35 **(to confirm)** | What is refused and not guessed; the proposed currency fields `decimal_mark`, `grouping`, `symbol_after` |

## A shared development machine (docs/dev-machine.md; docs/decisions.md, 2026-10-08; scripts/slots.ts)

| Idea | Citation | Used in |
|---|---|---|
| A pool of tokens that every job on a machine draws from before it starts heavy work, however deep in a tree of processes it is, with a job's children counted as inside its token | GNU Make's jobserver: Smith, P. D., "Jobserver Implementation", in the GNU Make manual, "Sharing Job Slots with GNU make" (Free Software Foundation) **(to confirm: section title and author as cited)** | `scripts/slots.ts`: the tokens are files in one directory rather than bytes in a pipe, so that jobs in unrelated process trees share them and a dead holder's can be reclaimed |
| A lock taken by making a hard link to a file already written (atomic on a local file system; the lock is never seen half written) | The `open(2)` manual's note on lock files over NFS (`link(2)` to a unique file, in place of `O_EXCL`) **(to confirm)** | `scripts/slots.ts`, `claim` |

## A works' money (docs/behaviour/producer.md, generator.md; docs/decisions.md, 2026-10-08)

| Idea | Citation | Used in |
|---|---|---|
| A firm keeps a buffer of money in proportion to its wage bill before it pays its owners | Lengnick, M. (2013), "Agent-based macroeconomics: A baseline model", *Journal of Economic Behavior & Organization* 86, 102-120 (the liquidity buffer, chi) | `firm.producer`: inputs are bought with the next pay period's wages kept aside |
| Working capital is what carries a firm from paying for inputs and wages to being paid for what it sells | Richards, V. D. and Laughlin, E. J. (1980), "A cash conversion cycle approach to liquidity analysis", *Financial Management* 9(1), 32-38 **(to confirm: not opened; cited for the idea only, no figure taken from it)** | `worlds/generator/generate.ts`: a works' opening money (a month's wages and a month's inputs for its opening staff), as the reason it is derived |

## Scenarios: the size of each shift (docs/scenarios.md; worlds/scenarios/)

Checked on 2026-10-08. "Opened" means the source's own page was read and the figure seen there; "search result only"
means the figure was read in a search engine's summary of the source and the page itself could not be opened (most
refused the request), so it stays **(to confirm)**. One size has no source and says so in its file: the town's opening
balance under `lean-council` (the profile's own is a placeholder).

| Idea | Citation | Used in |
|---|---|---|
| The flood planned against is the one with a 1% chance in any year | Federal Emergency Management Agency, glossary, "Base flood": "a flood having a one percent chance of being equaled or exceeded in any given year" (fema.gov/glossary/base-flood; opened). Ball, J. et al. (eds) (2019), *Australian Rainfall and Runoff: A Guide to Flood Estimation*, Commonwealth of Australia: annual exceedance probability **(to confirm: the site refused the request)** | `wet-year`: the 99th percentile of 199 years |
| Choosing a year by where it stands among a climate's own years, leaving the climate as it is | Rainfall deciles: Gibbs, W. J. & Maher, J. V. (1967), *Rainfall deciles as drought indicators*, Bureau of Meteorology Bulletin 48, Melbourne **(to confirm: the bulletin's existence and title seen in library catalogues' search results; the Bureau's page refused the request)** | `chooseWeather` (worlds/generator/weather.ts); `wet-year`, `dry-year`, `hot-summer` |
| Water suppliers plan against a drought of a stated rarity, and expect to restrict use about once in ten to twenty years | England's water resources planning guideline: resilience to a 1-in-200-year drought, moving to 1-in-500 by 2039 **(to confirm: the guideline's file could not be read; two water companies' plans say so in search results)**. How often restrictions come, and that they are triggered by reservoir or groundwater levels: Dobson, B., "Hosepipe bans", Centre for Systems Engineering and Innovation blog, Imperial College London (blogs.imperial.ac.uk/csei/?p=269; opened; a secondary source) | `dry-year`: the 1st percentile of 199 years; the finding that the town's supplier restricts only when the river refuses its draw (docs/decisions.md) |
| A one-in-twenty season as a level for describing a climate's extremes | IPCC (2012), *Managing the Risks of Extreme Events and Disasters to Advance Climate Change Adaptation*, Summary for Policymakers: the one-in-twenty-year hottest day **(to confirm: search result only; the file refused the request)** | `hot-summer`: the 95th percentile by heatwave days |
| Councils do run out of reserves | Section 114 notices under the Local Government Finance Act 1988 (England): Northamptonshire (February and July 2018), Croydon (November and December 2020), Birmingham (September 2023), as listed in Wikipedia's articles on each (opened; a secondary source). National Audit Office (2018), *Financial sustainability of local authorities 2018*: about one in ten upper-tier authorities would exhaust their reserves within three years at 2016-17's rate of use (nao.org.uk, the report's press release; opened) | `lean-council`: that the condition is real |
| How much a council holds against what it spends | A minimum general reserve of about 5% of net revenue spending, attributed to CIPFA in councils' own papers **(to confirm: search result only; no primary statement found)** | `lean-council`: a hundredth of the profile's opening balance is between 2% and 3% of a year's spending in the first profile's town |
| Grants from a higher government can halve within a decade | National Audit Office (2018), as above: "49.1% real-terms reduction in government funding for local authorities, 2010-11 to 2017-18" (opened) | `lean-council`: grants at half the profile's |
| World trade fell by an eighth in one year, and a manufacturing exporter's by a quarter | World Trade Organization (2010), press release 598, 26 March 2010: a 12.2% contraction in the volume of world trade in 2009; export volumes of the United States -13.9%, the European Union -14.8%, Japan -24.9%; the value in dollars fell 23%, "thanks in large part to falling prices of oil and other primary commodities" (wto.org/english/news_e/pres10_e/pr598_e.htm; opened) | `export-slump`: the world market's demand at 75% (first tried at 88%) |
| Unemployment about doubles in a deep recession | United States Bureau of Labor Statistics, Current Population Survey, unemployment rate: 5.0% in December 2007, 10.0% in October 2009, as served by the Federal Reserve Bank of St. Louis (series UNRATE; opened) | `jobs-slump`: twice the share out of work |
| Places differ by half again in their share of people 65 and over | World Bank, World Development Indicators, population ages 65 and above (% of total), SP.POP.65UP.TO.ZS: Japan 29.4%, OECD members 17.9%, in 2022 (the Bank's data service; opened) | `ageing-town`: the age bands from 65 at one and a half times |
| A country's housing can fall short of need by about a tenth of the stock | Centre for Cities (2023), *The housebuilding crisis: The UK's 4 million missing homes*: "a backlog of 4.3 million homes" (centreforcities.org; opened). The stock it is a share of (about 30 million dwellings) is not from that page **(to confirm)** | `housing-shortage`: a tenth fewer homes |
| Rents can rise by a quarter in three years | CoreLogic's quarterly rental reviews, as reported: national rents up 22.2% from September 2020 to 2023; 30.4% in the 38 months from July 2020 **(to confirm: search results only)** | `dear-rents`: every rent a quarter higher |
| Older works put out about two and a half times the pollution for what they make | Shapiro, J. S. & Walker, R. (2018), "Why Is Pollution from US Manufacturing Declining? The Roles of Environmental Regulation, Productivity, and Trade", *American Economic Review* 108(12); NBER working paper 20879, abstract: "air pollution emissions from U.S. manufacturing fell by 60 percent despite a substantial increase in manufacturing output" (nber.org/papers/w20879; opened). The size of the rise in output, and the journal reference, **(to confirm)** | `dirty-industry`: a factory's pollution at 2.5 times |
| Rural places have half the doctors a head of cities, or fewer | National Rural Health Association, "About rural health care": physicians per 10,000 people, 13.1 rural and 31.2 urban (ruralhealthweb.org/about-nrha/about-rural-health-care; opened; the page gives no year) | `doctor-shortage`: half the doctors |
| A police force can lose a seventh of its officers in a few years | Home Office (2017), *Police workforce, England and Wales, 31 March 2017*, Statistical Bulletin 10/17: 143,734 full-time-equivalent officers in March 2010, 123,142 in March 2017 **(to confirm: search result only; the bulletin's file could not be read)** | `police-understrength`: 86% of the establishment |
| Wholesale electricity prices can double within a year, and retailers on a fixed tariff fail | European Commission, *Quarterly report on European electricity markets*: the European Power Benchmark averaged 230 EUR/MWh in 2022, 121% above 2021; Australian Energy Market Operator, *Quarterly Energy Dynamics Q2 2022*: an average of 264 a megawatt-hour against 85 a year before; National Audit Office (2022), *The energy supplier market*: 29 suppliers failed from July 2021 **(to confirm: all three search results only)**. International Energy Agency (2023), *Electricity Market Report 2023* **(to confirm: not opened)** | `energy-price-shock`: the grid's price doubled |

Looked for and not used yet: recorded offences a head (Crime Statistics Agency Victoria, year ending December 2024:
8,691.6 offences per 100,000 people, of which property and deception offences are about 58%; **to confirm: search
result only**), against the profile's placeholder chance of taking (`crime.take_bps_per_month_in_need`); the notice a
local election is given (the Local Elections (Parishes and Communities) (England and Wales) Rules 2006: notice not
later than the twenty-fifth day before the poll; **to confirm: search result only**), against `election-due`'s sixty days.
