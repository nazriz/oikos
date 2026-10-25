// A large town's config goes to the engine as a file written participant by participant (RustWorld.start,
// writeConfigFile; SC-1): the file is the text JSON.stringify gives, and the run started from it is the run started
// from the text, byte for byte.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { RustWorld, writeConfigFile } from "../src/rust-world";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a config written participant by participant is the text JSON.stringify gives", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-cfgfile-"));
  try {
    const config = generate({ ...spec, years: 1 }) as any;
    // (With what JSON.stringify leaves out or changes: a member undefined, a hole in a list.)
    config.orchestration = { ...config.orchestration, left_out: undefined };
    const file = join(dir, "c.json");
    writeConfigFile(config, file);
    expect(readFileSync(file, "utf8") === JSON.stringify(config)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run started from the config as a file is the run started from its text", () => {
  const config = generate({ ...spec, years: 1 }) as any;
  const run = (viaFile: boolean) => {
    const w = RustWorld.start(config, { until: 5 * DAY, stand_in: "idle" }, viaFile);
    for (let d = w.next(); d.due !== "end"; d = w.next()) for (const s of d.seats) w.submit(s.key, { type: "wait" });
    const end = w.finish();
    return { hash: end.state_hash, log: Buffer.from(w.logBytes()!) };
  };
  const [a, b] = [run(false), run(true)];
  expect(b.hash).toBe(a.hash);
  expect(a.log.length).toBeGreaterThan(100_000);
  expect(Buffer.compare(a.log, b.log)).toBe(0);
}, 120_000);
