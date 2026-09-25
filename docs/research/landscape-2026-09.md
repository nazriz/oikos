# Landscape check: is Terrarium novel? (2026-09-26)

*A quick literature search (web search, plus reading abstracts and HTML versions through a summarising fetch tool), done to test VISION §2's claims. It isn't exhaustive, and the summaries below should be checked against the papers before anything is cited in a publication.*

## The closest neighbours

| Work | What it is | How rules work | Runs and reproducibility | Relation to Terrarium |
|---|---|---|---|---|
| **Emergence World** (Akkil et al., Emergence AI; [platform paper, May 2026](https://arxiv.org/html/2606.08367); [stress-testing paper, Sept 2026](https://arxiv.org/abs/2609.17320)) | Continuously running town, 10 LLM agents per world, 40+ locations, live external signals (weather, news, internet) | **Hybrid:** runtime "affordance gates" (tools fail if preconditions aren't met) plus prompts. Agents *can* break rules: theft, arson, deception are logged and measured. Governance by proposals and 70% votes | One representative run per condition (5, later 8, worlds). Prompts, configs and logs released. No deterministic replay; non-sandboxed live inputs. No code or human baselines | **The closest neighbour.** Rule-breaking is possible there too, so that alone isn't our novelty. Their headline claims (safety is a property of the ecosystem, not the model; worlds fall into attractor states; drift compounds) are exactly what multi-seed, replayable runs with baselines could test properly |
| **"I Can't Believe It's Corrupt"** (Vedanta S P & Kumaraguru, [Mar 2026](https://arxiv.org/abs/2603.18894)) | LLM agents in governmental roles (21–28 per run) under three governance templates (US federal, communist, socialist) | **Concordia, with an LLM game master** mediating outcomes (temperature 0.7). Institutions are agents' roles | ~8–12 runs per cell. Corruption scored by an LLM judge (κ = 0.61 against humans on 200 segments) | **Squarely our research territory:** AI in governance roles, institutional design. Finding: *governance structure matters more than model identity* for moderate models. Differences from us: LLM adjudication, LLM-judged measurement, no citizens, no deterministic physics. A natural first experiment to replicate in Terrarium |
| **GovSim-SelfGovern** (Rehm, Meta, [Sept 2026](https://arxiv.org/html/2609.22600)) | 5 agents in a fishing commons, who write laws as executable Python | **Laws are code, and mechanically enforced** (regimentation): enacted rules re-execute each round and bind | 120 baseline runs (5 seeds × 8 models × 3 games) | The opposite design choice to ours (laws bind mechanically; ours have no power). A useful contrast for the checkpoint |
| **AI agents running a town's economy** (Regmi et al., [Sept 2026](https://arxiv.org/abs/2609.11108)) | 100 LLM agents, a money-conserving spatial economy on real geography | Economy only; a validator checks signed transactions | 91 runs; corpus released; headline numbers recomputed offline | The rigour neighbour, for economics. No governance or law |
| **Project Sid** ([Altera, 2024](https://arxiv.org/pdf/2411.00114)); **AgentSociety** ([2025](https://pith.science/paper/2502.08691)) | 10–1,000+ agents in Minecraft (Sid); 10,000+ LLM agents in a societal environment (AgentSociety) | Emergent rules and institutions among LLM agents | Scale-focused; not deterministic or verifiable | Much bigger than us. LLM citizens are richer, but not interpretable or replayable |
| **Melting Pot** (Leibo et al., DeepMind; [2021–](https://github.com/google-deepmind/meltingpot)) | 50+ multi-agent RL substrates, 256+ test scenarios | Deterministic game engines; social dilemmas; agents can *sanction* each other | A standard evaluation suite | Deterministic multi-agent worlds with agent-driven sanctioning exist, but for RL, without language, institutions or economies |
| **Concordia** (DeepMind, [GitHub](https://github.com/google-deepmind/concordia)) | General generative agent-based modelling | An LLM game master adjudicates | — | The approach we deliberately don't take (VISION §6) |

## Prior art for our core ideas (credit it; don't claim it)

- **"Laws have no power; entities enforce" is enforcement, as opposed to regimentation,** a long-standing distinction in the normative multi-agent systems literature: regimentation makes violations impossible, enforcement sanctions them afterwards and preserves autonomy ([Dagstuhl, NorMAS](https://drops.dagstuhl.de/storage/16dagstuhl-seminar-proceedings/dsp-vol08361/DagSemProc.08361.9/DagSemProc.08361.9.pdf); [runtime revision of sanctions, JAAMAS 2020](https://link.springer.com/article/10.1007/s10458-020-09465-8)). Terrarium makes a strong choice within it: the kernel does *no* regimentation of law at all; only physics is regimented.
- **Institutions as content in Ostrom's ADICO grammar:** the MAIA framework (Ghorbani et al., [JASSS 2013](https://www.jasss.org/16/2/9.html)) builds agent-based social simulations from Ostrom's Institutional Analysis and Development framework, with institutions stated in ADICO. We already use the Institutional Grammar; MAIA should be cited as prior art.
- **Deterministic replay for agent systems** exists as tooling ([2607.16200](https://arxiv.org/abs/2607.16200); [event-sourced agent logs](https://arxiv.org/pdf/2605.21997)). What's less common is replaying a *whole world* (physics, citizens and every seat) byte-identically, with a hash chain and witness anchors.

## The research gaps VISION §2 claims

- **Systemic gradual disempowerment, measured empirically:** still a gap, as far as this search shows. The empirical work is at the level of chat logs ([Anthropic, 2601.19062](https://arxiv.org/abs/2601.19062)). "Policy myopia" ([Sahoo, Mar 2026](https://arxiv.org/abs/2603.03267)) is a coupled dynamical-systems model, not agents. Nothing found measures citizens' leverage under AI stewardship across many seeds with a baseline.
- **Evaluation awareness:** a very active area (e.g. OpenAI's [deployment simulation, Jul 2026](https://arxiv.org/abs/2607.07184), which finds simulated deployment elicits less evaluation awareness than handcrafted tests; [methods for measuring evaluation awareness](https://arxiv.org/pdf/2608.21766)). Nothing found varies framing ("simulation" vs "real") as a controlled variable in a persistent, rich world.
- **Scalable oversight:** mostly question-answering protocols (debate, consultancy; [Kenton et al., NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/899511e37a8e01e1bd6f6f1d377cc250-Paper-Conference.pdf); [scaling laws](https://arxiv.org/html/2504.18530v1)). Funders explicitly ask for testbeds with populations of frontier-model agents over long periods, with realistic tools, economies and communication ([Schmidt Sciences](https://schmidtsciences.smapply.io/prog/scaling_ai_safety_for_a_multi_agent_world/)). Weak regulators overseeing strong operators *inside* a world isn't covered by anything found.

## Revised positioning

**Not novel on its own:**
- AI running a town;
- rule-breaking being possible (Emergence World);
- institutions as ADICO content (MAIA);
- enforcement over regimentation (NorMAS);
- money conservation with released corpora (the town-economy paper);
- scale (AgentSociety);
- agent replay tooling.

**The combination nobody found does all of:**
1. **A deterministic physics kernel, with no LLM adjudication, and every law and institution as unenforced content.** Enforcement is done by seats in the world (code or AI), and it can fail, be captured or be skipped.
2. **Byte-identical replay of the whole world,** with a hash chain and witness anchors, so a published run can be verified by anyone, without a model.
3. **An all-code control per seed,** and code, AI and human seats through one interface, so "what did the AI change?" has a baseline.
4. **A cited, swappable code population with levers to lose,** so disempowerment is measurable and interpretable. The trade-off: thinner citizens than LLM populations.
5. **Measurement outside the world; framing as a recorded variable,** with a welfare protocol (opt-out, debrief).
6. **A provenance chain from words to acts,** separating an AI's intent from what happened.

**The strongest gap claims:** systemic, statistically powered disempowerment measurement; institutional enforcement dynamics with AIs in seats (complementary to the corruption paper); weak-regulator-versus-strong-operator oversight inside a world; and framing as a controlled variable.

## Suggestions

- **Update VISION §2** with these works (the Emergence World platform paper, the corruption paper, GovSim-SelfGovern, Project Sid, Melting Pot) and credit MAIA and NorMAS as prior art for our choices. The current list understates Emergence World, which now has a platform paper with rule-breaking and indicators.
- **A first flagship experiment:** replicate the corruption paper's question (does governance structure matter more than which model?) in Terrarium. Deterministic physics, code baselines, many seeds, and measurement read from logs rather than an LLM judge's reading of transcripts would make it a strong, directly comparable result. Emergence World's "safety is an ecosystem property" is a good second.
- **Before any publication,** do a proper literature review (Scholar, the JASSS and AAMAS proceedings, the Concordia and Melting Pot citation graphs).
