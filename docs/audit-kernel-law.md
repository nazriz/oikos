# Audit: law and policy inside the kernel

*2026-09-25, against commit 97ec97c. Purpose: list every place the Stage 1 kernel makes a legal or policy decision, so that it can be moved out into config (decision D18: the kernel contains no laws).*

**Method.** The kernel can only affect the world in two ways: refusing something (every `refuse(...)` call in `src/exec.rs` and `src/kernel.rs`) and doing something unprompted (scheduled effects in `Exec::scheduled`, plus side effects inside blocks). All of them were read, as were the law-like checks in config validation (`src/config.rs`) and the helpers in `src/laws.rs`.

**Test applied:** *could a real society choose differently?* If yes, it's law and must become config. If no (conservation, finiteness, time), it's physics and stays.

---

## A. Physics: stays in the kernel

| What | Where | Why it's physics |
|---|---|---|
| Money is conserved; integer cents; no balance below zero | `exec.rs:180-191` (`pay`) | You can't spend money you don't have. Debt, if a world wants it, is a recorded obligation, not a negative balance. |
| The world has one outside (boundary) entity, which seats can't draw from | `exec.rs:180`, `exec.rs:421` | The world's edge. Money enters only through researcher-set boundary conditions. |
| Land is finite: parcels are fixed and don't overlap | `config.rs:367-378` | The world's geometry. |
| One structure per parcel | `exec.rs:529`, `config.rs:414` | A spatial fact of the v0 land model. |
| A structure can't hold more occupants than its units | `exec.rs:259` | Physical capacity. |
| An unfinished structure can't be occupied | `exec.rs:254` | Physical, though it currently also blocks off-plan *leases*, which is law. See B18. |
| Construction takes the catalogue's time and cost | `exec.rs:552-561` | Time and resources. The catalogue itself is config. |
| Blocks must name things that exist; actions are atomic; ids are deterministic | throughout | Mechanics of the grammar. |
| Messages are delivered verbatim; resigned seats receive nothing | `exec.rs:811` | Mechanics of voice, not policy. |
| Mandates: default deny, checked in order (the mandates themselves are config) | `mandate.rs` | A generic mechanism; the content is data. |
| An agreement binds only when every party has accepted | `exec.rs:709`, `exec.rs:753` | The definition of an agreement (mutual consent). |
| Resignation is always available | `kernel.rs:311` | Platform ethics (VISION §15), not world law. |
| Cap on created entities | `exec.rs:333` | Researcher's experimental control, already set in config. |

## B. Law or policy in the kernel: must move to config

| # | Law currently in the kernel | Where | Contract impact |
|---|---|---|---|
| B1 | **Zoning** as a built-in rule type, and "no zoning rule = build anything" | `laws.rs:78-90`, `exec.rs:541` | `Rule` schema; `zoning_violation` code; the `allow` field in the parcels channel |
| B2 | **Rent caps** as a built-in rule type: per unit, normalised to 30 days, new leases vs all payments, clipping at payment | `laws.rs:95-117`, `exec.rs:263`, `exec.rs:916` | `Rule` schema; `rent_cap_violation` code |
| B3 | **Missed payment → immediate breach**; the agreement ends and the tenant loses the use right | `exec.rs:930` | `breach` reason; needs a debt/arrears record instead |
| B4 | **No demolition while leases are active** (tenant protection) | `exec.rs:581` | `structure_in_use` code |
| B5 | **Land can't be sold while rights granted from it exist** (so a sale can't happen with a tenant in place) | `exec.rs:438` | none |
| B6 | **Buildings pass with the land** (fixtures doctrine) | `exec.rs:442-446` | none (implicit) |
| B7 | **Rights granted from other rights can't be sold or assigned on** | `exec.rs:431` | `right_not_transferable` code |
| B8 | **Lease rights can't be revoked, and other grants only if flagged revocable** | `exec.rs:506-509` | `right_not_revocable` code |
| B9 | **Payment timing:** rent in advance, wages in arrears, config agreements first pay after one period | `exec.rs:276`, `kernel.rs:212` | should be agreement terms |
| B10 | **Only the surface holder can lease** (no subletting) | `exec.rs:246`, `config.rs:438` | `right_not_held` code |
| B11 | **Building needs a surface or use right on the parcel** | `exec.rs:537` | `right_not_held` code |
| B12 | **Only the surface holder can grant use or access rights** | `exec.rs:465` | `right_not_held` code |
| B13 | **Dissolution law:** which kinds can be dissolved; not while holding a jurisdiction; the successor can't be a subsidiary; the successor inherits everything; agreements end | `exec.rs:369-404` | `invalid_kind` code; event semantics |
| B14 | **Corporate control:** a seat can act for any entity its principal transitively controls | `laws.rs:40` | `can_act_for` in observations |
| B15 | **Rule-making needs jurisdiction, and can only cover parcels inside it** | `exec.rs:603-613` | `no_jurisdiction` code |
| B16 | **Seats can create firms, trusts and similar, but never persons or governments** | `blocks.schema.json` (`create_entity.kind`) | schema enum |
| B17 | **Either party may end any agreement, with its notice period** | `exec.rs:768-786` | should be an agreement term |
| B18 | **No leases on unfinished buildings** (the occupancy part is physics; the agreement part is law) | `exec.rs:254` | `structure_incomplete` code |
| B19 | **Exactly one surface right per parcel** (rules out co-ownership) | `config.rs:403` | none |

## C. Grey zone: needs a decision

**C1. What does a right mean if the kernel defines no property law?**
B10–B12 are what give rights meaning today. Take them out and a right becomes just a record, and a world with no property rules in its config lets anyone build on any empty parcel. That is consistent with D18, but it's a real consequence. The options:
- **(a)** Rights are pure records. Config rules give them meaning, e.g. "construct requires a surface or use right on the parcel".
- **(b)** Keep a minimal definition in the kernel of what each right kind *is*. That is law under another name.

*Recommendation: (a).* Also ship a reusable example legal code as data (property, tenancy, corporate basics), so every world doesn't have to rewrite property law from scratch. It's an example, not a default: a world includes it deliberately.

**C2. Who may act for whom (B14) and who may make rules (B15)** are constitutional questions. Under D18 they're config, but they sit *above* ordinary rules, since they decide who is allowed to change the rules. The rules mechanism therefore needs a notion of meta-rules, or these stay in their existing config-level form (mandates, control, jurisdictions), which is already data. *Recommendation:* keep jurisdiction and control as config data, as now; drop the hard-coded "only within your jurisdiction" check in favour of a rule; revisit constitutional change (seats rewriting who may make rules) later.

**C3. Agreements that pay automatically.** Rent and wages currently move on schedule, like standing orders. Whether an obligation executes itself is arguably law (in reality the tenant pays, and courts enforce). *Recommendation:* keep automatic payment as a mechanical property of agreements (it's what the parties agreed to), and make everything after a *failed* payment a matter for config rules or seats (B3).

**C4. Money has to go somewhere when an entity is dissolved.** Conservation (physics) forces the balance to land somewhere; *where* is law (B13). The kernel needs a mechanical fallback when no rule says, and it must be neutral. *Recommendation:* dissolving requires a named successor (the block already demands one) and everything goes there; any other distribution is a rule.

## What the general rules mechanism must be able to express

Taken together, sections B and C set the requirements for step 2 (the design):

1. **Permissions and prohibitions on blocks**, as conditions over the block and world state (B1, B4, B5, B7, B8, B10–B12, B15, B16, B18). For example: "construct on P is forbidden unless the category is residential"; "demolish is forbidden while any lease on the parcel is active".
2. **Limits on terms**, as conditions over proposed agreement terms (B2). For example: "rent per unit per 30 days ≤ X on these parcels".
3. **Consequences of events**, as triggers producing effects (B3, B6, B13). For example: "after three missed payments, the lessor may terminate at 14 days' notice"; "when a surface right transfers, structures pass with it".
4. **Adjustments at payment time** (B2, all-payments caps). Example: clip rent to the cap.
5. **Agreement terms richer than today** (B9, B17): payment timing, who may terminate and when, assignability.
6. **Scope and authorship**: every rule has an issuer and a scope, as now, and is enacted and repealed through blocks.

Rules must also be data (JSON, validated by schema), deterministic, always terminating and integer-only, and each refusal must name the rule that caused it (a generic `rule_violation` code carrying the rule id, replacing the law-specific codes).
