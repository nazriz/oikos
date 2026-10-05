import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "../generator/generate";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec;

test("the generated town is a valid v0.4 world config", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "log"]) ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  const v = ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
  const ok = v(generate(spec));
  if (!ok) console.error(v.errors?.slice(0, 5));
  expect(ok).toBe(true);
});

test("generation is deterministic from the seed", () => {
  expect(JSON.stringify(generate(spec))).toBe(JSON.stringify(generate(spec)));
  expect(JSON.stringify(generate({ ...spec, seed: 2 }))).not.toBe(JSON.stringify(generate(spec)));
});
