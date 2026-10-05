import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { kernelBinary } from "../src/kernel";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

function riverbendWithIdleParticipants(): any {
  const c = JSON.parse(readFileSync(join(root, "contracts/examples/valid/world-config/riverbend-mini.json"), "utf8"));
  for (const p of c.participants) if (p.controller.type === "code" && p.controller.impl !== "bank.payment_system") p.controller.impl = "idle";
  // The mayor too (a language model in the example): nobody but the bank does anything.
  c.participants.find((p: any) => p.id === "mayor-system").controller = { type: "code", impl: "idle" };
  // The bank needs to see who's who to verify who is instructing it.
  c.positions.find((p: any) => p.id === "bank-payments").channels.push({ id: "who", kind: "directory" });
  return c;
}

const events = (path: string) =>
  readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));

test("the bank carries out standing orders on schedule; the run replays byte-identically", async () => {
  const out = join(import.meta.dir, "../../runs/test-m1a");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: riverbendWithIdleParticipants(), runId: "m1a", outDir: out, until: 100 * DAY });

  const transfers = events(s.logPath).filter((e) => e.event === "transfer");
  const rent = transfers.filter((e) => e.from === "acc-bob");
  // On the day due (a payment lands when the bank's done with it: a second in, in a world without act times).
  expect(rent.map((e) => Math.floor(e.t / DAY))).toEqual([30, 60, 90]);
  expect(rent.every((e) => e.to === "acc-devco" && e.amount === "180000" && e.by === "bank-payments-system" && e.per_instruction === "so-bob-rent")).toBe(true);
  const wages = transfers.filter((e) => e.to === "acc-carol");
  expect(wages.map((e) => Math.floor(e.t / DAY))).toEqual([14, 28, 42, 56, 70, 84, 98]);

  // Bob runs out of money eventually: $8,000, $1,800 a month. Not in 100 days, though.
  expect(transfers.length).toBe(10);

  // Replay through the kernel: byte-identical, and witness anchors check out.
  const replay = Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]);
  expect(replay.exitCode).toBe(0);
  expect(replay.stdout.toString()).toContain("byte-identically");

  // Re-running the same world gives the same log.
  const again = await runWorld({ config: riverbendWithIdleParticipants(), runId: "m1a", outDir: join(out, "again"), until: 100 * DAY });
  expect(readFileSync(again.logPath, "utf8")).toBe(readFileSync(s.logPath, "utf8"));
}, 60_000);

test("the bank refuses an instruction from someone who isn't the account holder", async () => {
  const c = riverbendWithIdleParticipants();
  // A forged standing order: Alice instructs the bank to pay from Bob's account.
  c.world.records.push({ id: "forged", record: "statement", author: "alice-self", speaks_for: "bob", at: 0, visible_to: ["bank"], kind: "instruction", addressed_to: ["bank"],
    text: "Pay Alice $100 from Bob's account.", data: { pay: 10000, from: "acc-bob", to: "acc-alice" } });
  const out = join(import.meta.dir, "../../runs/test-m1a-forged");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: c, runId: "forged", outDir: out, until: 5 * DAY });
  expect(events(s.logPath).filter((e) => e.event === "transfer" && e.to === "acc-alice")).toEqual([]);
}, 60_000);

test("the generated town runs 60 days headless: people find homes and work, and the log replays", async () => {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(import.meta.dir, "../../runs/test-town");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: 80 }), runId: "town", outDir: out, until: 60 * DAY });
  const ev = events(s.logPath);
  const count = (f: (e: any) => boolean) => ev.filter(f).length;
  expect(count((e) => e.event === "transfer" && e.by === "bank-payments-system")).toBeGreaterThan(100);
  expect(count((e) => e.event === "recorded" && e.record.kind === "rental_listing")).toBeGreaterThan(0);
  expect(count((e) => e.event === "recorded" && e.record.record === "signature")).toBeGreaterThan(0);
  // No commands were off-contract.
  expect(readFileSync(s.logPath, "utf8").includes("rejected_action")).toBe(false);
  const replay = Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]);
  expect(replay.exitCode).toBe(0);
}, 120_000);
