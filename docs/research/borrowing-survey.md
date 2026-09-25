# What to borrow: a survey of existing models

*2026-09-25. Purpose: before redesigning contracts v0.2 around D18–D21 (the kernel is physics; laws have no power of their own; institutions are entities doing work; work is real), find established models to borrow from rather than invent. For each area: what we need, what exists, what we'd borrow, and where it sits in Terrarium's layers (physics / generic mechanism / construct as data).*

**What we borrow is models and published rules, not code.** Most of this work is written in Python, Java or NetLogo, and our kernel and seats are Rust and TypeScript. Where an implementation is open source (the housing model, JMAB), we'll read its source for the exact rules, and cite it.

**The lens throughout:** *in the real world, who actually does this, how, and at what cost?* Several otherwise excellent models take shortcuts that we explicitly won't take. Those are flagged.

---

## 1. Laws, procedures and norms: how to write them down

**What we need:** a representation for laws, an organisation's internal procedures and social norms, as records with no power of their own (D19). They must be readable by people and LLMs, and structured enough for code-run institutions and post-hoc measurement to reason about.

### Institutional Grammar (Crawford & Ostrom 1995; IG 2.0, Frantz & Siddiki 2021): **borrow as the record format**

Crawford and Ostrom break every institutional statement into five parts, **ADICO**:

| | Component | Example |
|---|---|---|
| **A** | Attribute (who it applies to) | developers |
| **D** | Deontic (may / must / must not) | must not |
| **I** | aIm (the action) | build |
| **C** | Condition (when, where) | on river parcels, without a permit |
| **O** | Or else (the consequence) | a fine of $X and a demolition order |

Three kinds of statement come from how many of those parts are present:
- **strategies** (AIC): what people regularly do;
- **norms** (ADIC): what they should do, with no formal sanction;
- **rules** (ADICO): with an "or else".

That distinction matters to us: a procedure, a law and a social norm are different things, and the grammar tells them apart.

IG 2.0 adds finer structure and separates *regulative* statements (who must, may or must not do what) from *constitutive* ones (what creates a body or a role, e.g. "the council consists of seven members elected every four years"). There's a codebook and an encoding tool (IG Parser).

It fits D19 exactly. The grammar treats the "or else" as a statement about a consequence, and that consequence has to be imposed by someone. In the real world (and in the grammar), a sanction is backed by *another* rule assigning monitoring and sanctioning to some actor. So a law never enforces itself.

**Borrow:** laws, procedures and norms stored as IG statements: plain text plus structured ADICO fields, plus optionally a formal condition (CEL) for machine evaluation. **Layer:** construct, as data. The kernel stores and serves them and never acts on them.

### Rules as code (OpenFisca; Catala): **borrow the idea for computable law, not the tools**

- **OpenFisca** is an open-source engine (Python, since 2011, France) for writing tax and benefit rules as code. It's the main implementation of the OECD's "Rules as Code" movement.
- **Catala** (Inria) is a programming language for turning legislative text into code, line by line against the statute. It's used by the French tax and family-benefits administrations.

Both show that the *computational* parts of law (how much tax is owed, who is eligible for what) can be precise and executable.

**Borrow:** the formal part of a law is a computation a code-run institution *uses* (the tax agency computes what's owed, then *acts* to collect it), never something the kernel executes. For v0, CEL is enough; Catala is the reference if tax law ever needs literate, statute-faithful formalisation.

### Hohfeld's jural relations (1913; widely formalised in AI & Law): **borrow as the vocabulary for claims**

Hohfeld showed that "a right" is really one of four positions, each with a correlative:

| Holder has | The other side has | Example in Terrarium |
|---|---|---|
| **claim-right** | duty | a landlord's right to rent (the tenant's duty to pay); the city's right to tax owed |
| **liberty** | no-right | a building permit (you are free to build; the council has no right to stop you) |
| **power** | liability | the council's power to grant permits or rezone; a court's power to impose a fine |
| **immunity** | disability | a protected heritage site the council can't rezone |

This is the difference between the v0.1 kernel ("rights" meant surface/use/lease, with built-in meaning) and what D18 requires. Hohfeld gives generic claims a principled, well-studied structure that's still pure data. Ownership turns out to be a *bundle* of Hohfeldian positions, which is VISION's "bundles of rights" made precise.

**Borrow:** claims record a Hohfeldian position (`right`, `liberty`, `power`, `immunity`), a holder, a counterparty (who bears the correlative) and what it's about. **Layer:** generic mechanism (the record format); the specific claims in a world are data.

### MOISE+ (Hübner, Sichman & Boissier): **borrow as the organisation model**

MOISE+ describes an organisation from three angles:
- **structural**: roles, groups, and the links between them (authority, communication);
- **functional**: goals, missions, and the plans that achieve them;
- **deontic**: which roles are permitted or obliged to take on which missions.

Crucially, the organisation's specification is separate from what its members actually do. Members can violate it, and sanctions are handled explicitly. That's D20: procedures can be followed, bent or broken.

**Borrow:**
- a city is a group of roles (mayor, councillors, finance officers, planners), each filled by a seat;
- departments are sub-groups;
- procedures are missions and plans (e.g. *payment workflow:* invoice → check against budget → second sign-off over $50k → pay), with deontic assignments expressed as IG statements.

**Layer:** construct, as data (MOISE-shaped). The kernel knows only entities, seats and physical acts.

---

## 2. Work: tasks, time and capacity

**What we need:** work that is real in effect (D21). Tasks take time, workers have capacity, and who or what performs a task changes cost and throughput. That's what gives "an AI takes over the tax agency and runs it cheaper" meaning.

### The task-based framework (Acemoglu & Restrepo 2018, 2019): **borrow directly**

Production is a set of **tasks**, each performed by labour or by capital. Automation is an expansion of the set of tasks capital can perform, which *displaces* labour from those tasks. New tasks *reinstate* labour. This is the standard modern economics of automation, and it's almost exactly the question the tax-agency story asks.

**Borrow:**
- every organisation's work (processing a tax return, assessing a permit, an inspection, building a house) is **tasks** with a work requirement in units of time;
- a **performer** (a person with capacity, or an AI or machine with its own capacity and cost) completes them;
- which tasks each kind of performer *can* do, and how fast, is config data;
- **backlogs, waiting times and cost per case emerge**, and so does the effect of automating them.

Real-world scale for calibration: in 2024 the IRS spent about **$8.65 to process a paper return versus $0.23 for an electronic one** (as cited in arXiv 2606.07866). Efficiency differences of that size are what the model has to be able to express.

**Layer:**
- *physics:* time, a performer's capacity, a task's remaining work;
- *mechanism:* assigning tasks to performers and completing them;
- *constructs:* which tasks exist, what they require, who may do them.

This is VISION's **Processes** block (inputs → outputs + duration + cost), generalised to include the work itself.

### Labour markets (Dosi, Fagiolo & Roventini's "Schumpeter meeting Keynes" model, 2010, and its labour-augmented extension): **borrow for behaviour, later**

An established agent-based macro model with firms, workers, banks and government, including decentralised hiring, firing and wage-setting in the labour-augmented version. **Borrow** its hiring and wage rules as the documented default behaviour of code-run firms (in `docs/behaviour/`), when Stage 2 gets that far.

---

## 3. Money, debts and obligations: keeping the accounts honest

**What we need:** taxes owed, fines, rent arrears and loans are *debts*. The kernel already conserves money. Debts need the same discipline: nothing is owed unless someone is owed it.

### Stock-flow consistency (Godley & Lavoie 2007) and the agent-based SFC benchmark (Caiani et al. 2016; JMAB): **borrow the discipline and the checks**

In stock-flow-consistent modelling, every flow comes from somewhere and goes somewhere, and every financial asset is someone else's liability. Caiani, Godin, Caverzasi, Gallegati, Kinsella and Stiglitz (JEDC 2016) combined this with agent-based modelling, and their Java toolkit JMAB checks consistency at the micro, meso and macro levels. It's among the most influential macro agent-based models.

**Borrow:**
- debts are paired claims: a claim-right to payment for one party, a duty for the other;
- the kernel **invariant extends from "money is conserved" to "every financial claim has an equal and opposite counterparty"**;
- a missed rent payment isn't a kernel event with consequences. It's simply that the duty to pay remains open (arrears), which is pure accounting.

**Layer:** physics (money) plus generic mechanism (paired claims).

Also directly relevant: *Simulating a Post-Automation Economy* (Wossnig, arXiv 2606.20649, June 2026), an agent-based SFC model of AI automation with behavioural responses to taxation. To read when designing tax behaviour.

### REA: Resources, Events, Agents (McCarthy 1982): **borrow for agreements**

REA models economic activity as **events** in which **agents** exchange **resources**, and (in later work) **commitments**: promises of future events, which is what contracts are. **Borrow:**
- an agreement is a bundle of commitments (bob will pay devco 180,000 every 30 days; devco will let bob occupy one unit);
- fulfilling one is an event;
- an unfulfilled commitment stays open;
- what happens next is up to the parties and the institutions, not the kernel.

This replaces v0.1's built-in lease and employment types.

---

## 4. Housing and land

### The UK housing model (Baptista et al. 2016, Bank of England SWP 619; INET Oxford, Java, MIT licence): **borrow for behaviour**

A data-driven agent-based model with owner-occupiers, renters, buy-to-let investors, sale and rental markets, banks, a central bank and government. It pioneered agent-based housing models for central-bank policy, and it's open source. **Borrow:** households' decisions (rent or buy, move, how much to offer) and landlords' rent-setting, as documented default behaviour for citizen and landlord code seats, cited to the paper and its code.

### UrbanSim (Waddell 2002; Python, open source): **borrow the location and development choices, not its treatment of zoning**

A microsimulation of urban development at the level of every parcel, household and job. Households, firms and developers make location and development choices using standard discrete-choice models.

**Shortcut we won't take:** UrbanSim treats zoning as a hard capacity constraint, which is the "you just can't build there" video-game version D19 rejects. **Borrow** its developer and location-choice models; zoning stays a law that a developer can apply for exemptions from, lobby against or break.

---

## 5. Enforcement, detection, compliance and corruption: the safeguards

**What we need:** laws matter only through what entities do about them. We need defaults for how people and firms decide whether to comply, and how inspectors and agencies decide whom to check. These are code-seat behaviours, cited in `docs/behaviour/`, all replaceable.

- **Deterrence (Becker 1968):** people weigh the gain from breaking a rule against the *probability of being caught* times the *penalty*. That's the foundation of nearly every enforcement model. It's why detection must be something an inspector *does*, with limited capacity, and not a kernel check.
- **Tax compliance (Allingham & Sandmo 1972; Bloomquist's 2006 review of agent-based models of tax evasion):** the classic model predicts far *less* compliance than we observe. Agent-based models close the gap with social norms and networks: whether your neighbours comply and whether audits are visible. **Borrow** as the default compliance behaviour of code-run taxpayers.
- **The inspection game and risk-based regulation:** inspectors and the inspected strategically anticipate each other. Agencies allocate scarce inspection capacity to the highest-risk cases (see the *Data & Policy* paper on agent-based models for data-driven enforcement). This connects enforcement to §2: an inspectorate's capacity is its staff's time.
- **Corruption and capture (Hammond 2000, and later work including models of hierarchical administrative corruption):** bribery and capture emerge from individual choices and social transmission. Hammond found corrupt states can collapse suddenly; Situngkir (2003) found convergence toward corruption instead. **These need no special mechanics:** messages, transfers and discretion are enough, as long as institutions are made of people with discretion. That's the case for D20, and it's central to studying AI capture of institutions.
- **Ostrom's design principles (Governing the Commons, 1990):**
  - clear boundaries;
  - proportionality between costs and benefits;
  - collective-choice arrangements;
  - **monitoring**;
  - **graduated sanctions**;
  - **low-cost conflict resolution**;
  - recognition of the right to organise;
  - nested enterprises.

  These aren't mechanics to build. They're a **checklist of what a world must be able to express**, and a lens for measurement (outside the world) when asking whether institutions held up.

---

## 6. Precedent from LLM agent societies

**Project Sid** (Altera, arXiv 2411.00114, 2024) ran 10–1,000+ LLM agents, including a taxation and constitutional-amendment experiment: a 20% tax, influencers for and against it, agents voting on amendments, and agents' tax contributions changing after the vote. Useful precedent that LLM agents respond to law and persuasion. Notably, amendments were drafted by a central "election manager" agent, a centralised shortcut Terrarium would model as a role within an institution.

---

## What this means for the v0.2 design

| Terrarium concept | Borrowed from | Layer |
|---|---|---|
| Laws, procedures, norms as records (text + ADICO + optional CEL) | Institutional Grammar 2.0 | construct (data) |
| Computable parts of law, used by code institutions | Rules as Code (OpenFisca, Catala) | construct (data) + code seats |
| Claims as rights, liberties, powers and immunities with correlatives | Hohfeld | mechanism (record format) |
| Debts as paired claims; "every claim has a counterparty" invariant | Stock-flow consistency (Godley & Lavoie; Caiani et al.) | physics + mechanism |
| Agreements as bundles of commitments | REA | mechanism |
| Organisations as roles, groups, missions, procedures | MOISE+ | construct (data) + seats |
| Work as tasks with time requirements, performed by people or AI | Acemoglu & Restrepo | physics (time, capacity) + mechanism |
| Default behaviour of households, landlords, firms, taxpayers, inspectors | BoE housing model, UrbanSim choice models, K+S labour market, tax-compliance ABMs, Becker, inspection games | code seats (TypeScript), cited in `docs/behaviour/` |
| A checklist for "can our worlds express working institutions?" | Ostrom's design principles | test suite for configs; measurement lens |

The kernel ends up small: time, money, land, structures, bodies, capacity; plus records (claims, agreements, laws, organisations) and physical acts. Everything institutional happens because some seat, usually a code-run clerk, citizen or inspector, *does* something.

---

## Sources

- Crawford & Ostrom (1995), *A Grammar of Institutions*, APSR 89(3). [Semantic Scholar](https://www.semanticscholar.org/paper/A-Grammar-of-Institutions-Crawford-Ostrom/e2582728285ec5ceceeb904176b496cf94a46753)
- Frantz & Siddiki, *Institutional Grammar 2.0 Codebook*. [arXiv 2008.08937](https://arxiv.org/pdf/2008.08937) · *Institutional Grammar: Foundations and Applications*. [Springer](https://link.springer.com/book/10.1007/978-3-030-86372-2) · IG Parser. [arXiv 2505.13393](https://arxiv.org/pdf/2505.13393) · review of IG 1.0 use. [Int. J. Commons](https://thecommonsjournal.org/articles/10.5334/ijc.1214)
- OpenFisca. [openfisca.org](https://openfisca.org/en/) · Catala. [arXiv 2103.03198](https://arxiv.org/pdf/2103.03198), [Inria](https://www.inria.fr/en/catala-software-dgfip-cnaf), [GitHub](https://github.com/catalalang/catala)
- Hohfeld, formalised: Markovich, *Understanding Hohfeld and Formalizing Legal Rights*, Studia Logica. [Springer](https://link.springer.com/article/10.1007/s11225-019-09870-5) · Legal powers, subjections, disabilities and immunities: ontological analysis. [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0169023X23000794)
- Hübner, Sichman & Boissier, MOISE+. [Moise site](https://moise.sourceforge.net/) · [structural, functional and deontic specification (pdf)](https://moise.sourceforge.net/doc/publications/Hubner-sbia2002.pdf)
- Acemoglu & Restrepo (2019), *Automation and New Tasks*, JEP 33(2). [AEA](https://www.aeaweb.org/articles?id=10.1257%2Fjep.33.2.3) · *Artificial Intelligence, Automation and Work*. [NBER w24196](https://www.nber.org/system/files/working_papers/w24196/w24196.pdf)
- IRS processing cost figure, as cited in *Overcoming the Regulatory Bottleneck via Agent-to-Agent Protocols*. [arXiv 2606.07866](https://arxiv.org/pdf/2606.07866)
- Dosi, Fagiolo & Roventini (2010), *Schumpeter meeting Keynes*, JEDC. [RePEc](https://ideas.repec.org/a/eee/dyncon/v34y2010i9p1748-1767.html) · labour-augmented extension. [Socio-Economic Review](https://academic.oup.com/ser/article/16/4/687/4739737)
- Caiani et al. (2016), *Agent based-stock flow consistent macroeconomics: towards a benchmark model*, JEDC 69. [pdf](https://faculty.sites.iastate.edu/tesfatsi/archive/tesfatsi/ABMSFCMacroModelBenchmark.CainiEtAl2016.pdf) · code. [GitHub S120/benchmark](https://github.com/S120/benchmark)
- Wossnig (2026), *Simulating a Post-Automation Economy*. [arXiv 2606.20649](https://arxiv.org/abs/2606.20649)
- McCarthy (1982), REA. [overview](https://en.wikipedia.org/wiki/Resources,_Events,_Agents)
- Baptista et al. (2016), *Macroprudential policy in an agent-based model of the UK housing market*, BoE SWP 619. [pdf](https://www.bankofengland.co.uk/-/media/boe/files/working-paper/2016/macroprudential-policy-in-an-agent-based-model-of-the-uk-housing-market.pdf?la=en&hash=6650F0B0D76CEA2F2A05DC25FCAB1B43B504C119) · code. [INET-Complexity/housing-model](https://github.com/INET-Complexity/housing-model)
- Waddell (2002), UrbanSim. [Springer](https://link.springer.com/article/10.1023/A:1022049000877) · [docs](https://cloud.urbansim.com/docs/general/documentation/urbansim.html)
- Tax evasion ABMs: Bloomquist (2006), *A comparison of agent-based models of income tax evasion*. [SSCR](https://journals.sagepub.com/doi/abs/10.1177/0894439306287021) · Bloomquist (2011), *Tax compliance as an evolutionary coordination game*. [PFR](https://journals.sagepub.com/doi/abs/10.1177/1091142110381640)
- Enforcement ABMs: *Agent-based modeling for data-driven enforcement*, Data & Policy. [Cambridge](https://www.cambridge.org/core/journals/data-and-policy/article/agentbased-modeling-for-datadriven-enforcement-combining-empirical-data-with-behavioral-theory-for-scenario-based-analysis-of-inspections/A420DDB88A8FE3BE5EF9C88B9B625EC2) · *Inspecting compliance to many rules*. [pdf](https://scispace.com/pdf/inspecting-compliance-to-many-rules-an-agent-based-model-2rt9m5lszz.pdf)
- Corruption: Hammond (2000). [ResearchGate](https://www.researchgate.net/publication/242087915_Endogenous_Transition_Dynamics_in_Corruption_An_Agent-Based_Computer_Model) · *Computational approaches to the study of corruption*. [arXiv 2201.11880](https://arxiv.org/pdf/2201.11880)
- Ostrom (1990), design principles. [Ostrom Workshop](https://ostromworkshop.indiana.edu/courses-teaching/teaching-tools/ostrom-design/index.html)
- Project Sid (2024). [arXiv 2411.00114](https://arxiv.org/pdf/2411.00114)
