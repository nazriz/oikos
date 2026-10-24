// A generated town cached for the Rust tests is read only when the generator's inputs are those it was made from
// (orchestrator/test/lib/town-key.ts, write-town.ts; scripts/worktree-warm.ts drops the copies it clones).
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropCachedTowns } from "../../scripts/worktree-warm";
import { INPUTS, townKey } from "./lib/town-key";

const repo = join(import.meta.dir, "../..");
const tree = () => {
  const d = mkdtempSync(join(tmpdir(), "oikos-town-key-"));
  for (const i of INPUTS) mkdirSync(join(d, i), { recursive: true });
  writeFileSync(join(d, "worlds/generator/generate.ts"), "export const v = 1;\n");
  writeFileSync(join(d, "worlds/profiles/p.yaml"), "a: 1\n");
  writeFileSync(join(d, "participants/src/x.ts"), "export {};\n");
  writeFileSync(join(d, "contracts/world-config.schema.json"), "{}\n");
  return d;
};

test("the key changes with a generator source, a profile, a rule the generator calls, a schema, the spec or an argument; and with nothing else", () => {
  const d = tree();
  try {
    const k = townKey(d, ["spec", "1"]);
    expect(townKey(d, ["spec", "1"])).toBe(k);
    for (const [f, text] of [["worlds/generator/generate.ts", "export const v = 2;\n"], ["worlds/profiles/p.yaml", "a: 2\n"], ["participants/src/x.ts", "export const y = 1;\n"], ["contracts/world-config.schema.json", "{ }\n"]] as const) {
      const before = readFileSync(join(d, f), "utf8");
      writeFileSync(join(d, f), text);
      expect(townKey(d, ["spec", "1"]), f).not.toBe(k);
      writeFileSync(join(d, f), before);
      expect(townKey(d, ["spec", "1"]), `${f} put back`).toBe(k);
    }
    expect(townKey(d, ["spec2", "1"])).not.toBe(k);
    expect(townKey(d, ["spec", "1", "shop_mix=true"])).not.toBe(k);
    // (A file's date is not an input: a clone touches them all.)
    utimesSync(join(d, "worlds/generator/generate.ts"), new Date(0), new Date(0));
    expect(townKey(d, ["spec", "1"])).toBe(k);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("write-town writes a town once for the same inputs, and again for a key that is not the current one (a stale copy is never read)", () => {
  const d = mkdtempSync(join(tmpdir(), "oikos-write-town-"));
  const out = join(d, "t.json");
  const run = () => Bun.spawnSync(["bun", "orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out, "1"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  try {
    expect(run().exitCode).toBe(0);
    const made = statSync(out).mtimeMs;
    expect(JSON.parse(readFileSync(out, "utf8")).world).toBeDefined();
    expect(readFileSync(`${out}.key`, "utf8")).toHaveLength(64);
    Bun.sleepSync(20);
    expect(run().exitCode).toBe(0);
    expect(statSync(out).mtimeMs, "same inputs: not written again").toBe(made);
    // A copy made by another generator: a different key, and a town that is not the current one's.
    writeFileSync(out, "{\"stale\":true}");
    writeFileSync(`${out}.key`, "an older generator's key");
    expect(run().exitCode).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).stale).toBeUndefined();
    // A file with no key at all (made before keys) is no better.
    rmSync(`${out}.key`);
    writeFileSync(out, "{\"stale\":true}");
    expect(run().exitCode).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).stale).toBeUndefined();
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 120_000);

test("a warmed worktree takes no cached town from the checkout it was cloned from", () => {
  const d = mkdtempSync(join(tmpdir(), "oikos-warm-"));
  try {
    const tmp = join(d, "kernel/target/tmp");
    mkdirSync(tmp, { recursive: true });
    for (const f of ["a1-town.json", "a1-town.json.key", "observations-town.json", "keep.txt"]) writeFileSync(join(tmp, f), "x");
    expect(dropCachedTowns(d)).toBe(3);
    expect(existsSync(join(tmp, "a1-town.json"))).toBe(false);
    expect(existsSync(join(tmp, "keep.txt"))).toBe(true);
    expect(dropCachedTowns(join(d, "nowhere"))).toBe(0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
