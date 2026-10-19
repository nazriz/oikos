// Perception is changes (contracts v0.4): the kernel sends each participant only
// what changed since its last look, and the runtime keeps its view, per capacity.
// The kernel's own invariant test checks the kernel side (kernel/tests/perception.rs);
// this checks the runtime's View on a real town: after every look, each capacity's
// accounts, survey and directory equal the kernel's full picture. Every citizen's
// surroundings are checked too, and must follow them when they move.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical, slice } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

// (This checks the TS runtime's View, which the Rust world does not use: its engine keeps each actor's view in
// kernel/crates/sight, held to the kernel's full picture by kernel/tests/perception.rs, a property test over generated
// worlds and ops, every look of every participant. The inspector here is also called once a day on the Rust world, not
// at every look.)

// (A code unit's TS view against the kernel's full picture, after every look: the TS world's, deleted at the cut-over, 2026-10-19. The
// engine's view is held to the kernel's picture by kernel/tests/perception.rs.)

