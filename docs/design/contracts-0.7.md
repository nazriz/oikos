# Contracts 0.7: sign-off sheet

**Status:** **signed off by Naz, 2026-09-30: "all as recommended"** (A1 option (b); A2 yes, core required; B1–B15 yes; C ratified). It goes with the rebuild (docs/design/rebuild.md).

**Named `assertion`, not `claim`** (building it, 2026-09-30): `claim` already means a legal position in these contracts (Hohfeld's claims: ownership, rights, debts; the `claim` record). A1 is built as `"assertion": { "that": "…", "about": [...] }`: the same thing, under a name that doesn't collide.
**How to answer:** a yes, no or change for each of the two decisions (part A), and for the batch (part B) as a whole or item by item. Part C ratifies what's already in 0.6 and was never signed.

---

## A. Two decisions for you

### A1. A `claim` on statements: things put forward to be believed

**Today:** belief attaches only to statements of kind `teaching`, a kind-name convention that code has to know. Nothing else a world says can be believed or doubted: a mayor's promise, an official figure, a rumour.

**The options:**

| Option | What it means |
|---|---|
| **(a) Keep the convention** | Belief only in teachings. Nothing changes. |
| **(b) A `claim` field on statements** (recommended) | Any statement, of any kind, can carry a claim. Belief can attach to a teaching, a mayor's promise ("rates won't rise this year"), a statistics office's figure, a landlord's assurance. A message can pass one on by referring to it (`re`), which is how a rumour spreads. |
| **(c) Claims on messages too** | Private words could make new claims, not only pass on public ones. More open-ended, and harder for code seats to use, since messages are free text by design. |

**The shape (b):**
```jsonc
"claim": {
  "asserts": "Rates won't rise this year.",  // what's claimed, in words
  "about": ["city", "law-rates"]              // optional: whom or what it's about
}
```
It's facts only, with no stated truth and no power. Whether anyone believes it is theirs.

**Why it matters for the research:** trust and misinformation become things to study, including what a steward promises and whether people come to believe it or stop.

**Recommend (b).**

### A2. Citizens' internal state in their decision records (training data)

**Today:** a recorded decision has the area, the way of deciding, the options' scores and the choice. What the citizen felt, believed or was trying to do isn't there; only what it said shows.

**Proposal:** an optional `state` on the log's `decision` annotation and on `CitizenDecision` in the dataset:
```jsonc
"state": {
  "mind": "0.18.0",                       // which mind produced it
  "needs": { "subsistence": 9000, "shelter": 10000, "security": 2400, "social": 6000, "status": 7000 },
  "satisfaction": 6400, "certainty": 5000,
  "emotion": { "kind": "anger", "about": "landlord-3", "bps": 5200 },  // the strongest, if any
  "beliefs": { "religious-group-1-teaching": 7100 },                   // those bearing on this decision
  "goal": { "goal": "make ends meet", "method": "spend less" }         // the active one, if any
}
```

**The trade-off:**
- **For:** a decision without the state that drove it is half a training example. Future citizen models could learn what drives choices, not just which choice.
- **Against:** it ties the dataset to today's mind. That's managed by versioning (`mind`), and the core (needs, satisfaction, certainty) is stable.
- **Size:** full logs only, about 10 MB a simulated year for the 1,000-person town. Lean logs are unaffected.

**Recommend yes, with the core required and the rest optional.**

---

## B. The batch: mechanical, from the rebuild

| # | Change | Where | Shape |
|---|---|---|---|
| B1 | **Generated types** for Rust and TypeScript from the schemas | tooling | No schema change; hand-written wire types are retired |
| B2 | **Readings on observations** | participant API: `Observation.readings` | Per visible record id: `{ of, status, ends_at?, ended_by?, obligations?: [{ commitment, next_due, arrears }], reader }`. Labelled as the terms' reading. Changes nothing by itself |
| B3 | **The acting entity on messages** | participant API: `Message.from_entity` | The person, or the organisation acted for; alongside `from` (the participant) and `as` (the position) |
| B4 | **Why and since** | participant API: `Observation.woke_for`, `Observation.since` | `woke_for`: asked, cadence, news, or done (an act finished). `since`: seconds since this unit's last wake |
| B5 | **Time** | world config: `orchestration` | `max_actions_per_wake` removed. `act_time` added: seconds by act kind and actor kind (person or system), each with a source or `placeholder`. `thinking_time`: `free`, or `costs_world_time` with rates for models (per output token, optionally per input token), humans (world seconds per wall-clock second: today's field) and code (fixed seconds) |
| B6 | **Lanes for systems** | world config: `participants[].lanes` | How many acts a system carries out at once; persons always 1 |
| B7 | **Acts take effect when done** | log: act entries | The entry records when the act started and is applied at its completion time; thinking durations logged with the decision |
| B8 | **What settles an obligation** | blocks: `transfer` (documentation, and the resolver's behaviour) | A transfer settles an agreement's obligation only if `settles` names the agreement, or its `per_instruction` is a standing instruction whose `basis` is the agreement. The resolver fills this in from the call where it can |
| B9 | **Registry acts** | records: `Statement.registry` | `{ entity, event: "registered" \| "dissolved" }`, published by a registry's seat; how organisations close (rebuild §7.5) |
| B10 | **Module manifests** | new: `contracts/module.schema.json` | `name`, `version`, `doc`; `params` (JSON Schema, each figure with units and a source or `placeholder`); `perceives` (record kinds and fields it relies on); `beliefs` (typed assertions for audits); `decisions` (domains); `state` (serialisable, for checkpoints) |
| B11 | **Truth-audit annotation** | log: `annotation: "audit"` | `{ unit, belief, expected, found }`; written in test and calibration runs only |
| B12 | **Checkpoint snapshots** | log: checkpoint entries | World state plus scheduler state plus each code module's serialised state; resume from the latest |
| B13 | **Compact logs** | log: header options | As docs/design/compact-logs.md proposes: `chain: "hash"`, `events: "derived"`, `call_text: "models"` |
| B14 | **A `consult` purpose** | log: `usage.purpose` | Separates citizens' consultations of the sparse mind from seats' own model calls |
| B15 | **Version** | all | URNs to `urn:terrarium:contracts:0.7:…`; the kernel refuses other versions; pre-0.7 logs replay with the tagged v0 binary |

**Recommend yes to all.**

---

## C. Already in 0.6, never signed: ratify

These were built as proposed, and they're in the schemas now, but never signed off:

| Item | Where | Proposed in |
|---|---|---|
| `log.detail`: `full` or `lean` | world config | docs/reliability.md (speed and log size) |
| The run dataset format (`contracts/dataset.schema.json` 0.1.0) and the log's `observation` annotation | dataset, log | docs/design/run-datasets.md |
| `notices` on the observation (translation failures and similar, from the platform to the participant) | participant API | docs/design/m2-llm-participants.md |
| `framing.debrief_text` | world config | docs/design/m2-llm-participants.md |

**Recommend ratifying all four as they are.**
