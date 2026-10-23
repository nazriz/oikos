// MT-18: the generator calls the Rust rules (worlds/generator/rules.ts), and they give the town the TypeScript copies gave:
// the same generated config, to the byte, in every profile, with the household draws, the tax withheld, the payments' declarations
// and the age of stopping work all taken from the Rust module. (The TypeScript copies stay for the seat-side readers until they go. The words of the laws have no copy: the engine writes them on both sides.)
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "../generator/generate";
import { rustRulesInUse } from "../generator/rules";

const root = join(import.meta.dir, "../..");
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec), citizens: 150, shops: 8 };
// (The same objects whatever order the Rust and the TypeScript law drafts write their keys in.)
const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canon(v)])) : x);
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

test("every profile's town is the same whether the Rust rules or the TypeScript copies are called", () => {
  if (!rustRulesInUse()) { console.warn("the engine's native module is not built: nothing to compare"); return; }
  for (const profile of profiles) {
    const rust = JSON.stringify(canon(generate({ ...spec, profile })));
    process.env.OIKOS_TS_RULES = "1";
    let ts: string;
    try { ts = JSON.stringify(canon(generate({ ...spec, profile }))); } finally { delete process.env.OIKOS_TS_RULES; }
    expect(rust === ts, `${profile}: the towns differ`).toBe(true);
  }
}, 120_000);
