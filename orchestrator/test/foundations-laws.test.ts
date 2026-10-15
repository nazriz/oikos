// The laws of how the world works (docs/design/foundations.md section 1; step F0, written first) as tests of the
// generated town and the platform, beside the kernel's own (kernel/tests/foundations.rs). What the platform keeps today
// passes. What it does not yet keep is `test.todo`: the assertion is written in full, runs with `bun test --todo`
// (every one must FAIL today: F0 checked), and is switched on by the step that builds it (change `test.todo` to
// `test`). The inventory below is the list of special cases the foundations delete, kept honest while they stand and
// emptied by F5 to F8; F10's backstop (all-work-takes-time.test.ts) requires it empty.
//
// Nothing here calls a model, runs a world, or changes a hash.

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { generate } from "@oikos/worlds/generator/generate";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// (A living town: it carries the everyday frictions, so the offices and venues that have the dials F6 deletes.)
const town = () => generate({ ...spec, factories: 5, living: spec.living ?? {} });

// ---------------------------------------------------------------------------------------------------------------------
// The laws already law, and where their tests are.
// ---------------------------------------------------------------------------------------------------------------------

test("laws 6 and 7, and law 1's money and goods, are kept already, each by a test that exists", () => {
  const holds: [string, string][] = [
    ["kernel/tests/money_conservation.rs", "law 1: money is conserved"],
    ["kernel/tests/goods.rs", "law 1: goods are held, moved by their holder"],
    ["kernel/tests/statements_have_no_power.rs", "law 6: authority is a record the readers apply, never the kernel's refusal"],
    ["kernel/tests/knowing.rs", "law 7: information lives with its keeper"],
    ["orchestrator/test/no-god-view.test.ts", "law 7: the backstop"],
    ["kernel/tests/time.rs", "law 2: acts take time and take effect when done"],
    ["kernel/tests/foundations.rs", "laws 1 to 5: the kernel's side, with the pending ones ignored"],
  ];
  for (const [f] of holds) expect(existsSync(join(root, f)), f).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Law 3 (generator): every post is held by a person or a system someone supplied.
// ---------------------------------------------------------------------------------------------------------------------

test.todo("F5: law 3: every post in a generated town is held by a person, or by a system delivered from a template by a supplier", () => {
  const c = town();
  const byId = new Map<string, any>(c.participants.map((p: any) => [p.id, p]));
  const free = c.positions
    .filter((p: any) => p.holder)
    .map((p: any) => ({ post: p.id, holder: byId.get(p.holder) }))
    .filter(({ holder }: any) => holder && holder.kind === "system" && !(holder.template && holder.supplier))
    .map(({ post }: any) => post);
  expect(free, "posts held by a system nobody supplied").toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Law 2 (behaviour): no parameter sets throughput or delay directly; a backlog comes from hours.
// ---------------------------------------------------------------------------------------------------------------------

const DIALS = /^(cases_per_day|capacity_per_day|processing_days|error_bps)$|^(cases|capacity|claims|decisions|reviews)_per_day$/;
/** The throughput dials a generated town hands its modules: `cases_per_day`, `capacity_per_day`, `processing_days`,
 * `error_bps`, and any other `<cases|capacity|claims|decisions|reviews>_per_day`. (A physical rate, as litres a person a day,
 * or a rate of events in a population, is not a dial.) */
function dials(x: unknown, path: string, out: Set<string>) {
  if (Array.isArray(x)) x.forEach((v, i) => dials(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
    if (DIALS.test(k)) out.add(k);
    dials(v, `${path}.${k}`, out);
  }
}

test.todo("F6: law 2: a generated town sets no throughput or delay as a parameter (the dials F6 deletes, and any *_per_day capacity)", () => {
  const found = new Set<string>();
  const c = town();
  dials(c.positions.map((p: any) => p.role_module), "positions", found);
  dials(c.participants.map((p: any) => p.controller), "participants", found);
  expect([...found].sort(), "throughput or delay set directly").toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Law 5: an error arises from procedure, data and time, or from a slip at a sourced rate through `slip()`.
// ---------------------------------------------------------------------------------------------------------------------

const BEHAVIOUR = join(root, "participants/src/behaviour");
/** Streams named for a wrong decision drawn by chance: `ctx.rng("uphold-...")`, `bill-error-`, `short-pay-`, `wrong-`. */
const CHANCE_OF_WRONG = /\brng\(\s*[`"'](?:uphold|bill-error|short-pay|wrong|slip|error)[-`"'$]/;

test.todo("F7: law 5: no module makes a decision wrong by chance except through slip() (participants/src/slip.ts)", () => {
  expect(existsSync(join(root, "participants/src/slip.ts")), "the one helper").toBe(true);
  const drawn: string[] = [];
  for (const f of readdirSync(BEHAVIOUR).filter((n) => n.endsWith(".ts"))) {
    readFileSync(join(BEHAVIOUR, f), "utf8").split("\n").forEach((l, i) => {
      if (CHANCE_OF_WRONG.test(l)) drawn.push(`participants/src/behaviour/${f}:${i + 1}`);
    });
  }
  expect(drawn, "errors drawn outside slip()").toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Law 2 (table): every record kind a module or form writes has a row in the work table. F2 defines the table's shape
// and F10 owns the real check (it needs the table to exist), so there is nothing to run before then.
// ---------------------------------------------------------------------------------------------------------------------

test.todo("F10: law 2: every record kind any module or form writes has a row in the world's work table (or is named in a short, reasoned list of free acts)", () => {
  throw new Error("not written: the work table is F2's, and the check is F10's");
});

// ---------------------------------------------------------------------------------------------------------------------
// The backstop inventory: every special case the plan deletes or replaces, where it stands.
// ---------------------------------------------------------------------------------------------------------------------

type Entry = { id: string; law: number; step: string; kind: "delete" | "replace" | "history"; file: string; find: string; what: string; plan?: string; count: number; lines: string[] };
const inv = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/foundations-inventory.json"), "utf8")) as { entries: Entry[]; unpriced: { file: string; what: string; step: string }[]; stays: { what: string; file: string; find: string }[] };

/** Where a literal string stands now: "file:line" for each line holding it (a glob counts across its files). */
function stands(file: string, find: string): string[] {
  const files = file.includes("*") ? [...new Glob(file).scanSync(root)].sort() : [file];
  const out: string[] = [];
  for (const f of files) readFileSync(join(root, f), "utf8").split("\n").forEach((l, i) => { if (l.includes(find)) out.push(`${f}:${i + 1}`); });
  return out;
}

test("the inventory is well formed: unique ids, known steps, laws 1 to 7, a plan section and a reason for each", () => {
  const ids = new Set(inv.entries.map((e) => e.id));
  expect(ids.size).toBe(inv.entries.length);
  for (const e of inv.entries) {
    expect(e.law, e.id).toBeGreaterThanOrEqual(1);
    expect(e.law, e.id).toBeLessThanOrEqual(7);
    expect(e.step, e.id).toMatch(/^F([1-9]|1[01])$/);
    expect(["delete", "replace", "history"], e.id).toContain(e.kind);
    expect(e.what.length, e.id).toBeGreaterThan(10);
    expect(e.find.length, e.id).toBeGreaterThan(3);
  }
});

test("every special case in the inventory still stands where it says, as many times as it says (so the list rots when a case is removed without its entry)", () => {
  const wrong: string[] = [];
  for (const e of inv.entries) {
    const now = stands(e.file, e.find);
    if (now.length !== e.count) wrong.push(`${e.id}: ${e.count} in ${e.file}, now ${now.length}${now.length ? ` (${now.slice(0, 4).join(", ")})` : ""}`);
  }
  expect(wrong, "an entry that changed: remove it (the case is gone) or update it, with a line in docs/decisions.md").toEqual([]);
  for (const u of inv.unpriced) expect(statSync(join(root, u.file)).isFile(), u.file).toBe(true);
  for (const s of inv.stays) expect(stands(s.file, s.find).length, s.what).toBeGreaterThan(0);
});

test("the inventory covers the plan's deletions: every step from F1 to F8 has entries, and every kernel one is in the kernel", () => {
  const steps = new Set(inv.entries.map((e) => e.step));
  // (A step that is built has taken its entries out with the code: F1 to F3 have none left but history.)
  for (const s of ["F4", "F5", "F6", "F7", "F8"]) expect(steps.has(s), s).toBe(true);
  for (const e of inv.entries.filter((x) => x.id.startsWith("k-"))) expect(e.file, e.id).toMatch(/^kernel\//);
});

test.todo("F10: the foundations are in: nothing the inventory lists is left (every `delete` and `replace` entry stands nowhere; `history` entries excepted)", () => {
  const left = inv.entries.filter((e) => e.kind !== "history").flatMap((e) => stands(e.file, e.find).map((l) => `${e.id} (${e.step}): ${l}`));
  expect(left).toEqual([]);
});
