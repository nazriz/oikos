// Law 12's backstop (docs/design/foundations-2.md section 6.2; docs/flags.md): flags flag, and nothing else. Nothing in the
// world (the generator, the engine, the modules, the host that runs them) reads the flags or what they write; every flag
// names what it rests on; each planted broken state is flagged, in a log made for it and measured as any run is; and a
// plain town's month raises none of the stampede or physics flags.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportLogs, flags, grows } from "@oikos/measure";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

// ----------------------------------------------------------------------------------------------------------------- nothing reads them

test("nothing in the world reads the flags: no generator, engine, module or host source names them", () => {
  const dirs = ["worlds/generator", "kernel/crates", "kernel/src", "participants/src", "orchestrator/src"];
  const bad: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(join(root, d))) {
      const p = join(d, f);
      if (f === "node_modules" || f === "target" || f === "tests" || f === "test") continue;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|rs)$/.test(f)) {
        const text = readFileSync(join(root, p), "utf8");
        // (The one reader allowed: the command and the batch, which write them beside a run for a person to read.)
        if (/flags\.(json|txt)|flagsOf|flagsText|measure\/src\/flags/.test(text) && !["orchestrator/src/cli.ts", "orchestrator/src/batch.ts"].includes(p)) bad.push(p);
      }
    }
  };
  for (const d of dirs) if (existsSync(join(root, d))) walk(d);
  expect(bad).toEqual([]);
});

// ----------------------------------------------------------------------------------------------------------------- planted logs

/** A log the measure reads: a header with the world's people, accounts and papers, entries, an end. (The hash chain is
 * not read by measurement.) */
function log(dir: string, name: string, world: any, entries: { t: number; kind: string; body: any }[], endT: number): string {
  const path = join(dir, `${name}.jsonl`);
  const lines = [{ seq: 0, t: 0, kind: "header", body: { run_id: name, config: { seed: 1, meta: { name }, clock: { run_seconds: endT }, world, participants: world.participants ?? [], positions: world.positions ?? [] } } },
    ...entries.map((e, i) => ({ seq: i + 1, ...e })), { seq: entries.length + 1, t: endT, kind: "end", body: { reason: "until", state_hash: "x" } }];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: "person", born_at: -30 * 365 * DAY }));
const ev = (t: number, body: any) => ({ t, kind: "event", body });

test("each planted broken state is flagged, with what it rests on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-flags-"));
  try {
    const world = {
      entities: [...people(20), { id: "outside", kind: "boundary" }, { id: "firm", kind: "firm" }],
      accounts: [{ id: "acc-firm", holder: "firm", custodian: "firm", currency: "AUD", balance: "100" }, { id: "acc-outside", holder: "outside", custodian: "outside", currency: "AUD", balance: "0" }],
      records: [
        { id: "law-a", record: "statement", kind: "law", speaks_for: "city", at: 0, text: "..." },
        { id: "form-x", record: "statement", kind: "form", at: 0, data: { submit_as: "x_claim", submit_to: ["city"] } },
        { id: "lease-0", record: "agreement", at: 0, terms: { template: "lease", parties: ["firm", "c0"] } },
      ],
      positions: [{ id: "clerk", entity: "city", role_module: { code: "city.clerk" } }],
      participants: people(20).map((p) => ({ id: `${p.id}-self`, kind: "person", person: p.id, controller: { type: "code", impl: "citizen.default" } })),
    };
    const entries = [
      // (A month in which every adult leaves.)
      ...people(12).map((p, i) => ev(40 * DAY + i, { event: "person_left", person: p.id })),
      // (A firm's account taken below nought, and paid more every month after.)
      ev(50 * DAY, { event: "transfer", from: "acc-firm", to: "acc-outside", amount: "150", currency: "AUD" }),
      ...Array.from({ length: 13 }, (_, m) => ev((60 + 30 * m) * DAY, { event: "transfer", from: "acc-outside", to: "acc-firm", amount: String(100 * (m + 1)), currency: "AUD" })),
    ];
    const path = log(dir, "planted", world, entries, 420 * DAY);
    const m = join(dir, "measure");
    await exportLogs([path], m);
    const fs = await flags(m);
    const what = (k: string) => fs.filter((f) => f.kind === k).map((f) => f.what);
    expect(what("stampede")).toEqual(["12 of the 20 people in the town left it in one month"]);
    expect(what("freeze")).toEqual(["nobody made a new lease agreement in the run (the town opened with 1)"]);
    expect(what("dead_law").sort()).toEqual(["form form-x was never filled in (no x_claim in the run)", "law law-a is cited by no paper written in the run", "the office clerk (of city) did nothing in the run"]);
    expect(what("physics").some((w) => w.startsWith("account acc-firm went below nought"))).toBe(true);
    expect(what("physics").some((w) => w.startsWith("acc-firm grew month after month without levelling"))).toBe(true);
    // (Every flag names what it rests on: the leavers' modules, the template, the law, the form, the office, the account.)
    for (const f of fs) expect(f.rests_on.length, f.what).toBeGreaterThan(0);
    expect(fs.find((f) => f.kind === "stampede")!.rests_on).toEqual(["citizen.default"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("a trend that levels is no flag; one that does not level is", () => {
  expect(grows([1, 2, 4, 8, 16, 32, 64])).toBe(true);
  expect(grows([10, 20, 28, 32, 34, 35, 35])).toBe(false); // levels
  expect(grows([10, 11, 10, 11, 10, 11, 10])).toBe(false); // no trend
  expect(grows([1, 2, 4, 8])).toBe(false); // too short to say
});
