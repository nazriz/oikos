// The two resolvers agree. Runs use the engine's (kernel/crates/resolver, a port in Rust); the one with unit tests of
// its own, and the one the translator's test set runs on, is this repository's TypeScript one (translator/src). In
// shadow mode a run resolves every call both ways and stops at the first difference. Until 2026-10-05 no test ran in
// shadow mode, so the resolver every run depends on was checked only by hand (the code audit of that day).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

// (The shadow is the host's: it resolves the calls its own units make both ways. On the Rust world the engine resolves
// every code actor's calls itself, with the one resolver it has, so there is nothing for a second to shadow; that the
// two agree is what this shows on the TS world's run, and the translator's test set runs the TS resolver on its own.)

// (Every call of the TS world's code units resolved by both resolvers: the TS world was deleted at the cut-over, 2026-10-19; the engine
// has one resolver, and seats' calls go through it.)

