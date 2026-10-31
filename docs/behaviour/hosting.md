# Hosting: compute in the town, on its feeders and its main

**Source:** the kernel's `runs_on` (`kernel/crates/contracts/src/config.rs` `RunsOn`; the delivery's check in
`kernel/crates/world/src/exec.rs`, the draw in `kernel/crates/world/src/kernel.rs` `draw_hosted`), the host's code
(`kernel/crates/actors/src/market/hosting.rs`, `firm.host`), the provider's fee (`market/services.rs`, `hosting`), and the
generator's `hosting` (`worlds/generator/hosting.ts`, the profile's `values.hosting`). Design: `docs/design/foundations-2.md`
4.1 (P4) and 7.3 (step E5). Decisions: `docs/decisions.md`, "Compute in the town". Tests: `kernel/tests/foundations.rs`
("p4: a system runs on hardware held somewhere"), `worlds/test/generate.test.ts` ("hosting").

## The law (kernel, foundations-2 P4)

A system's template may say what it **runs on**: a kind of hardware (goods, held somewhere), how many units a lane takes,
who holds them and where (a structure), and the recipe an hour of a lane's work is there (a task that takes nobody's
time: what it uses and what it gives). Then:

- **It is delivered only where there is room**: a `deploy` is refused (`insufficient_quantity`) when the hardware held
  there does not cover the lanes of the systems already running on it and the new one's.
- **Its work draws there.** As its seconds of work add up (its own acts, the acts it is named on, its share of a work),
  each whole hour is the recipe at its host: the inputs taken from the holder's holding there, the outputs put into it,
  the emissions added to the world's counters. When the host does not hold what the hour takes, the act is refused
  (`insufficient_quantity`): **a system whose host has no power does nothing.**

A template that says nothing of it runs on nothing in the world: the outside's own machines, abroad, as before.

## A host in the town (generator, `hosting: "local"`)

The owner ruled that AI suppliers are abroad or local (2026-10-25). Where a town asks (`hosting: "local"`, with
`assistants: true` and the profile's `values.hosting`), the assistants' providers run their systems at a **hosting firm**
in the town:

- **Its building** (`data-centre`, a building of its own on a lot of its own, the last taken) holds its servers
  (`hardware`, one a lane), and is on the town's network like any building: an electricity, a water and a sewer
  connection, sized by what it draws a day at full work, and the feeders and mains are sized with it. What comes in is
  held there (it is not used as it comes, as a home's is): its clients' work draws on it, and its plant uses the rest.
- **An hour of a server's work** (`compute`) takes the server's power times the building's overhead (its PUE) in kWh,
  with the grid's emissions, and its cooling water, which goes out to the sewer.
- **The firm** (`firm.host`) does what a building's operator does: each day its plant (idle servers, cooling, lighting)
  uses what came in beyond what it keeps in hand for its clients' work (a day of full work: `plant-energy`,
  `plant-water`), and it pays the bills addressed to it (the retailer's from its meter, the water corporation's as the
  owner of its lot) when its account covers them. Its income is its clients' fee: each provider pays it a month
  (`hosting` in the provider's parameters), its power and water at full work at the place's tariffs with a margin,
  shared among them.
- **So compute competes with homes on the same network.** It is one more large user on a feeder and the main: in a
  shortage, who goes short follows from the network's physics, the supply in force and the operators' acts, as for any
  building (foundations-2 2.1). When its holding of power runs out, its clients' systems stop.

| Figure (au-vic) | Value | Basis |
|---|---|---|
| `servers` | 20 | Placeholder: the room for the town's share of the assistants' systems (ME-24). |
| `server_watts` | 6,500 | An AI accelerator server of eight accelerators (Shehabi et al. 2024; to confirm; ME-24). |
| `pue_bps` | 15,600 | The industry's average PUE, 1.56 (Uptime Institute 2024; to confirm; ME-24). |
| `water_ml_per_kwh` | 500 | On-site cooling water a kWh (Li, Yang, Islam and Ren 2023; to confirm; ME-24). |
| `margin_bps`, `opening_months` | 2,000; 3 | Placeholders (ME-24). |

## What it does not do yet (risk ME-24)

- **The host is not a firm that chose to enter**: it is there from the start where a town asks for it. Entry by expected
  profit into any industry, a hosting industry among them, is step E3.
- **The building's draw has the households' hourly shape** (the kind's), not a data centre's flat one; its connection's
  rate is fixed at full work and its plant uses what the work does not, so its draw is near constant, as a data centre's
  is, but nobody turns it down.
- **Cooling water goes to the sewer**, where much of it really evaporates (no recipe yet carries water to the air).
- **The building has no staff** (its operations are a building management system), and its servers do not wear out.
- **A provider's desk for persons runs there too**, and so do its later releases (`capability`).
