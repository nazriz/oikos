// A world's `names` reaches the resolver the engine runs (docs/design/names-and-dates.md section 4; contracts/calls.md,
// `ambiguous`): in a named town, a name the seat knows nobody by is "not on file", as this repository's resolver says it
// from the same observation; in a town without names, the old answer, word for word, from both.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { Knowledge, resolve } from "@oikos/translator";
import { generate } from "@oikos/worlds/generator/generate";
import { Kernel, kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

async function answers(names: boolean): Promise<{ engine: any; mine: any }> {
  const d = join(root, "runs", `test-names-resolve-${names}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const config = generate({ ...spec, profile: "ke-nakuru-2026", citizens: 60, nature: false, ...(names ? { names: true } : {}) }) as any;
  expect(config.names === true).toBe(names);
  const k = new Kernel(kernelBinary());
  try {
    await k.request({ op: "start", config, run_id: "n", log_path: join(d, "n.jsonl") });
    const seat: string = config.participants.find((x: any) => x.kind === "person").id;
    const observed = await k.request({ op: "command", command: { command: "observe", participant: seat } });
    const knowledge = new Knowledge(config.world.currencies[0], config.names === true);
    knowledge.absorb(observed.observation);
    const program = `message(to="Zebedee Nobody", text="Hello.")`;
    const engine = await k.request({ op: "resolve", participant: seat, program });
    return { engine, mine: resolve(calls.parseProgram(program), knowledge) };
  } finally {
    await k.close();
    rmSync(d, { recursive: true, force: true });
  }
}

test("names on: a name the seat knows nobody by is not on its file, said the same by both resolvers", async () => {
  const { engine, mine } = await answers(true);
  expect(engine.questions).toEqual(["No Zebedee Nobody is on your file."]);
  expect(mine).toEqual({ ok: false, questions: engine.questions });
}, 120_000);

test("names off: the old answer, word for word", async () => {
  const { engine, mine } = await answers(false);
  expect(engine.questions).toEqual([`You don't know of anyone or anything called "Zebedee Nobody" (for to).`]);
  expect(mine).toEqual({ ok: false, questions: engine.questions });
}, 120_000);
