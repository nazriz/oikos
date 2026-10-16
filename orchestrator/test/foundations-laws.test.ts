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
import { loadProfile } from "@oikos/worlds/generator/profile";

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

// (Switched on by F4, which made delivery a record on the system and the kernel refuse a world with a free holder at
// load. What F5 adds is that most posts are held by people, and the systems left have a kind of their own.)
test("law 3 (F4): every post in a generated town is held by a person, or by a system delivered from a template by a supplier", () => {
  const c = town();
  const byId = new Map<string, any>(c.participants.map((p: any) => [p.id, p]));
  const templates = new Map<string, any>(c.templates.map((t: any) => [t.id, t]));
  const orgs = new Set<string>(c.world.entities.filter((e: any) => e.kind !== "person").map((e: any) => e.id));
  const free = c.positions
    .filter((p: any) => p.holder)
    .map((p: any) => ({ post: p.id, holder: byId.get(p.holder) }))
    .filter(({ holder }: any) => holder && holder.kind === "system" && !(templates.get(holder.template)?.kind === "system" && orgs.has(holder.supplier)))
    .map(({ post }: any) => post);
  expect(free, "posts held by a system nobody supplied").toEqual([]);
});

// (Foundations F5: offices run by people, staff hired, the systems that are left under licence or the outside world's own.)
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const small = (profile: string) => generate({ ...spec, citizens: 300, profile, living: spec.living ?? {} });

test("law 3 (F5): a system is delivered from a template that says what it does; no generated system is the old placeholder, and none can do what its kind does not", () => {
  for (const profile of profiles) {
    const c = small(profile);
    const templates = new Map<string, any>(c.templates.map((t: any) => [t.id, t]));
    expect(c.templates.some((t: any) => t.id === "genesis-system"), `${profile}: the placeholder template`).toBe(false);
    for (const t of c.templates.filter((x: any) => x.kind === "system")) {
      expect(Array.isArray(t.does) && t.does.length > 0, `${profile}: template ${t.id} says what it does`).toBe(true);
      expect(t.does.some((r: any) => r.block === "work" || r.block === "construct" || r.block === "harm" || r.block === "vote"), `${profile}: template ${t.id} is software: it does no physical work`).toBe(false);
    }
    for (const p of c.participants.filter((x: any) => x.kind === "system")) expect(templates.get(p.template)?.kind, `${profile}: ${p.id} names a system template`).toBe("system");
  }
});

test("law 3 (F5): the posts of the town's own bodies are held by people of the town; the only systems are a bank's payment platform and the outside world's own", () => {
  for (const profile of profiles) {
    const c = small(profile);
    const byId = new Map<string, any>(c.participants.map((p: any) => [p.id, p]));
    const persons = new Set(c.world.entities.filter((e: any) => e.kind === "person").map((e: any) => e.id));
    const systems = c.positions.filter((p: any) => byId.get(p.holder)?.kind === "system").map((p: any) => `${p.entity}/${p.id}`);
    expect(systems.filter((x: string) => !x.startsWith("outside/") && !/^bank\/bank-payments$|^fund\//.test(x)), `${profile}: posts held by a system`).toEqual([]);
    for (const p of c.positions.filter((x: any) => byId.get(x.holder)?.kind === "person")) expect(persons.has(byId.get(p.holder).person), `${profile}: ${p.id} is held by a resident`).toBe(true);
    // every post has a holder, and no person holds a seat's post along with another (none is a seat here)
    expect(c.positions.filter((p: any) => !p.holder).map((p: any) => p.id), `${profile}: posts nobody holds`).toEqual([]);
  }
});

test("law 3 (F5): each body keeps the staff its profile's rate says, hired from the town on a standing wage, and the town's budget carries the town's", () => {
  for (const profile of profiles) {
    const P = loadProfile(profile).values;
    const c = generate({ ...spec, citizens: 1000, profile, living: spec.living ?? {} });
    const residents = c.world.entities.filter((e: any) => e.kind === "person").length;
    const jobs = c.world.records.filter((r: any) => r.record === "agreement" && r.terms?.template === "employment");
    const role = (r: any) => /^c\d+ works for (\S+) as (.+?) for /.exec(r.terms.text ?? "");
    const staffed = (entity: string, as: string) => jobs.filter((r: any) => role(r)?.[1] === entity && role(r)?.[2] === as);
    const rate = P.public_service.staff_per_1000;
    expect(staffed("city", "administrative officer").length, `${profile}: the town's administrative staff`).toBe(Math.max(1, Math.ceil((rate.administration * residents) / 1000)));
    expect(staffed("bank", "bank officer").length).toBe(Math.max(1, Math.ceil((rate.banking * residents) / 1000)));
    expect(staffed("tribunal", "tribunal officer").length).toBeGreaterThan(0);
    for (const r of jobs.filter((x: any) => role(x))) expect(Number(r.terms.commitments[0].does.outcome.money.amount), `${profile}: pay`).toBe(P.public_service.wage_per_pay_period);
    // paid by a standing instruction, from the body's own account
    for (const r of jobs.filter((x: any) => role(x))) expect(c.world.records.some((q: any) => q.id === `${r.id}-wages` && q.data.outcome.money.from === `acc-${r.terms.parties[0]}`), `${profile}: ${r.id} is paid`).toBe(true);
    // the town's: a budget line of its own, at least what its staff cost
    const budget = c.world.records.find((r: any) => r.id === "budget-year-1");
    const wages = staffed("city", "administrative officer").length * Math.floor((P.public_service.wage_per_pay_period * 365 * 86_400) / (P.pay_period_days * 86_400));
    expect(Number(budget.data.lines.administration), `${profile}: the administration line`).toBeGreaterThanOrEqual(wages);
  }
}, 120_000);

test("law 3 (F5): the bank's payment platform is under licence from its supplier at the profile's price, paid by the bank each month; and a model's seat in an office is a person of the town with a post of its own", () => {
  for (const profile of profiles) {
    const P = loadProfile(profile).values;
    const c = small(profile);
    const residents = c.world.entities.filter((e: any) => e.kind === "person").length;
    const licence = c.world.records.find((r: any) => r.id === "licence-bank-payments");
    const fee = Math.ceil((P.public_service.licences.payment_system.per_resident_per_year * residents) / 12);
    expect(licence.terms.parties).toEqual(["bank", "outside"]);
    expect(Number(licence.terms.commitments[1].does.outcome.money.amount)).toBe(fee);
    expect(c.world.records.find((r: any) => r.id === "licence-bank-payments-pay").data.outcome.money).toMatchObject({ from: "acc-bank", to: "acc-outside", amount: String(fee) });
    const platform = c.participants.find((p: any) => p.id === "bank-payments-system");
    expect(platform).toMatchObject({ kind: "system", template: "payment-system", supplier: "outside" });
  }
  const seat = generate({ ...spec, citizens: 300, mayor: "llm", model_seats: ["finance", "planning"], living: spec.living ?? {} });
  for (const id of ["mayor", "finance", "planning"]) {
    const post = seat.positions.find((p: any) => p.id === id);
    const part = seat.participants.find((p: any) => p.id === post.holder);
    expect(part, id).toMatchObject({ kind: "person", id: `${id}-system` });
    expect(part.controller.type).toBe("llm");
    expect(seat.positions.filter((p: any) => p.holder === part.id).map((p: any) => p.id), `${id}'s person holds only that post`).toEqual([id]);
  }
}, 120_000);

test("law 2 (F5): what a system's act takes is a row of the world's table, for every block its kinds do, and not a default", () => {
  const c = small("au-vic-2026");
  const table = c.orchestration.act_time;
  expect(table.default).toBeUndefined();
  for (const t of c.templates.filter((x: any) => x.kind === "system")) for (const r of t.does) expect(table.system[r.block], `${t.id}: ${r.block}`).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Law 2 (behaviour): no parameter sets throughput or delay directly; a backlog comes from hours.
// ---------------------------------------------------------------------------------------------------------------------

// (`error_bps`, the share of qualifying claims wrongly refused, is a slip rate and not a throughput or a delay: F7 moves it to `slip()`
// and its test below. Until F6 it was doubled while a backlog stood; that is gone.)
const DIALS = /^(cases_per_day|capacity_per_day|processing_days)$|^(cases|capacity|claims|decisions|reviews)_per_day$/;
/** The throughput dials a generated town hands its modules: `cases_per_day`, `capacity_per_day`, `processing_days`,
 * and any other `<cases|capacity|claims|decisions|reviews>_per_day`. (A physical rate, as litres a person a day,
 * or a rate of events in a population, is not a dial.) */
function dials(x: unknown, path: string, out: Set<string>) {
  if (Array.isArray(x)) x.forEach((v, i) => dials(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
    if (DIALS.test(k)) out.add(k);
    dials(v, `${path}.${k}`, out);
  }
}

test("F6: law 2: a generated town sets no throughput or delay as a parameter (the dials F6 deletes, and any *_per_day capacity)", () => {
  const found = new Set<string>();
  const c = town();
  dials(c.positions.map((p: any) => p.role_module), "positions", found);
  dials(c.participants.map((p: any) => p.controller), "participants", found);
  expect([...found].sort(), "throughput or delay set directly").toEqual([]);
  // And no profile states one.
  for (const profile of profiles) expect(JSON.stringify(loadProfile(profile).values), profile).not.toMatch(/"(cases_per_day|capacity_per_day|processing_days)"/);
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------------
// Law 5: an error arises from procedure, data and time, or from a slip at a sourced rate through `slip()`.
// ---------------------------------------------------------------------------------------------------------------------

const BEHAVIOUR = join(root, "participants/src/behaviour");
/** Streams named for a wrong decision drawn by chance: a purpose with `uphold`, `error`, `short-pay`, `wrong`, `mistake` or `slip` in it,
 * drawn by a behaviour module (`ctx.rng("claim-error-...")`, `bill-error-`, `uphold-`). The one place such a draw is made is `slip()`
 * (participants/src/slip.ts). (A thing that is faulty, or a house that wears, is a fact about the world and not a performer's decision.) */
const CHANCE_OF_WRONG = /\b(?:rng|chance)\(\s*[`"'][^`"']*(?:uphold|error|short-pay|wrong|mistake|slip)/;

test("F7: law 5: no module makes a decision wrong by chance except through slip() (participants/src/slip.ts)", () => {
  expect(existsSync(join(root, "participants/src/slip.ts")), "the one helper").toBe(true);
  const drawn: string[] = [];
  for (const f of readdirSync(BEHAVIOUR).filter((n) => n.endsWith(".ts"))) {
    readFileSync(join(BEHAVIOUR, f), "utf8").split("\n").forEach((l, i) => {
      if (CHANCE_OF_WRONG.test(l)) drawn.push(`participants/src/behaviour/${f}:${i + 1}`);
    });
  }
  expect(drawn, "errors drawn outside slip()").toEqual([]);
  // And no module is handed a rate of error as a parameter: it is the world's table of slips (`orchestration.slip`), with its source.
  const c = town();
  const params: string[] = [];
  const find = (x: unknown, path: string) => {
    if (Array.isArray(x)) x.forEach((v, i) => find(v, `${path}[${i}]`));
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      if (/^(error_bps|uphold_bps|billing_error_bps_per_year)$/.test(k) || (k === "per_year_bps" && /short_pay$/.test(path))) params.push(`${path}.${k}`);
      find(v, `${path}.${k}`);
    }
  };
  find(c.positions.map((p: any) => p.role_module), "positions");
  find(c.participants.map((p: any) => p.controller), "participants");
  expect(params, "a rate of error set as a module parameter").toEqual([]);
});

test("F7: law 5: a living town's slips are rows of its table, each with a source, and a task without a row has none", () => {
  const c = town();
  const slip = c.orchestration.slip;
  expect(slip, "the table of slips").toBeDefined();
  const tasks = ["publish/benefit_decision", "publish/venue_decision", "publish/invoice/metered_bill", "transfer/wages"];
  for (const t of tasks) {
    expect(slip.person[t], t).toBeDefined();
    expect(String(slip.sources[`person.${t}`] ?? "").length, `${t}: its source`).toBeGreaterThan(20);
  }
  expect(Object.keys(slip.person).sort()).toEqual([...tasks].sort());
  // An office's decisions go wrong at the office's sourced rate whoever or whatever makes them (the support agency of the outside world is a system, and
  // its wrong refusals are what the profile's figure is of); pay come short is an employer's, a person's.
  expect(Object.keys(slip.system).sort()).toEqual(tasks.filter((x) => x !== "transfer/wages").sort());
  for (const t of Object.keys(slip.system)) {
    expect(slip.system[t], t).toEqual(slip.person[t]);
    expect(String(slip.sources[`system.${t}`] ?? "").length, `${t}: its source for a system`).toBeGreaterThan(20);
  }
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

test("the inventory covers the plan's deletions: F8 still has entries, and every kernel one is in the kernel", () => {
  const steps = new Set(inv.entries.map((e) => e.step));
  // (A step that is built has taken its entries out with the code: F1 to F7 have none left but history.)
  for (const s of ["F8"]) expect(steps.has(s), s).toBe(true);
  for (const s of ["F1", "F2", "F3", "F4", "F5", "F6", "F7"]) expect(inv.entries.filter((e) => e.step === s && e.kind !== "history").map((e) => e.id), `${s} is built: nothing of it is left`).toEqual([]);
  for (const e of inv.entries.filter((x) => x.id.startsWith("k-"))) expect(e.file, e.id).toMatch(/^kernel\//);
});

test.todo("F10: the foundations are in: nothing the inventory lists is left (every `delete` and `replace` entry stands nowhere; `history` entries excepted)", () => {
  const left = inv.entries.filter((e) => e.kind !== "history").flatMap((e) => stands(e.file, e.find).map((l) => `${e.id} (${e.step}): ${l}`));
  expect(left).toEqual([]);
});
