// Writes a generated town's world config to a file, for the Rust lanes' tests of a module alone in the engine
// (docs/port-guide.md, section 4): `bun orchestrator/test/lib/write-town.ts <spec.yaml> <out.json> [years] [key=value ...]`; a key=value (a JSON value) overrides the spec's
// (`shop_mix=true`, `citizens=80`).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";

const root = join(import.meta.dir, "../../..");
const [specPath, out, years, ...sets] = process.argv.slice(2);
const spec = Bun.YAML.parse(readFileSync(join(root, specPath ?? "worlds/town.yaml"), "utf8")) as any;
const set = Object.fromEntries(sets.map((s) => { const i = s.indexOf("="); return [s.slice(0, i), JSON.parse(s.slice(i + 1))]; }));
writeFileSync(out!, JSON.stringify(generate({ ...spec, ...set, years: Number(years ?? 1) })));
