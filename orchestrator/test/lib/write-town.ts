// Writes a generated town's world config to a file, for the Rust lanes' tests of a module alone in the engine
// (docs/port-guide.md, section 4): `bun orchestrator/test/lib/write-town.ts <spec.yaml> <out.json> [years] [key=value ...]`; a key=value (a JSON value) overrides the spec's
// (`shop_mix=true`, `citizens=80`).
// The file is a cache, keyed: `<out>.key` holds a hash of the generator's inputs (town-key.ts), the spec and the arguments; a file whose key
// is not the current one is written again, so a stale copy is never read (the callers run this every time, not only when the file is missing).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { townKey } from "./town-key";

const root = join(import.meta.dir, "../../..");
const [specPath, out, years, ...sets] = process.argv.slice(2);
const specFile = join(root, specPath ?? "worlds/town.yaml");
const specText = readFileSync(specFile, "utf8");
const key = townKey(root, [specText, years ?? "1", ...sets]);
if (existsSync(out!) && existsSync(`${out}.key`) && readFileSync(`${out}.key`, "utf8") === key) process.exit(0);
const spec = Bun.YAML.parse(specText) as any;
const set = Object.fromEntries(sets.map((s) => { const i = s.indexOf("="); return [s.slice(0, i), JSON.parse(s.slice(i + 1))]; }));
writeFileSync(out!, JSON.stringify(generate({ ...spec, ...set, years: Number(years ?? 1) })));
writeFileSync(`${out}.key`, key);
