// Writes each built-in kind's manifest (contracts/module.schema.json; docs/design/rebuild.md 5.2) to
// participants/manifests/<name>.json, from the engine: every kind compiles its manifest in (kernel/crates/actors), so the
// engine's is the one source and the TypeScript side reads a copy of it (participants/src/manifests.ts: a world's
// parameters are checked against it when it loads). Before the cut-over this script derived them from the TypeScript
// modules; those actors are gone.
//
//   bun participants/scripts/manifests.ts          write them
//   bun participants/scripts/manifests.ts --check  exit 1 if any would change (the test runs this)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rustManifests } from "../../orchestrator/src/rust-world";
import { modules } from "../src/index";

const OUT = join(import.meta.dir, "../manifests");

if (import.meta.main) {
  const check = process.argv.includes("--check");
  mkdirSync(OUT, { recursive: true });
  const all = rustManifests();
  let stale = 0;
  // (The kinds the TypeScript side knows, as before: the engine has others, test doubles and a rent portal, a world is not checked against.)
  const known = (n: string) => n in all && n.includes(".") && n in modules;
  for (const name of Object.keys(modules).filter(known).sort()) {
    const path = join(OUT, `${name}.json`);
    const text = JSON.stringify(all[name], null, 2) + "\n";
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
        console.log(`stale: ${path}`);
        stale++;
      }
    } else writeFileSync(path, text);
  }
  // (A manifest of a kind the engine no longer has.)
  for (const f of readdirSync(OUT).filter((f) => f.endsWith(".json"))) {
    if (!known(f.slice(0, -5))) {
      if (check) { console.log(`stale: ${join(OUT, f)} (no such kind)`); stale++; } else rmSync(join(OUT, f));
    }
  }
  if (check && stale) process.exit(1);
  if (!check) console.log(`wrote the manifests to ${OUT}`);
}
