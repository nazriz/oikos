// All work takes time (docs/all-work-takes-time.md; docs/design/foundations.md, the laws of how the world works; Naz, 2026-10-15: "every
// single piece of work should cost time, and that should be enforced at the kernel level or the platform level ... it should just be at the
// foundational level how the world operates"). The kernel takes every act's time from the world's table of work and charges its performers; a
// system exists only as a template a supplier delivered; an error is a slip at a sourced rate. These tests are the backstop behind that, and
// should never fire: they read the generated town (a code town, and every office handed to a model, for every profile) and the sources
// of the modules, and fail naming the post, the module, the row or the line when a piece of work is free or a case is special.
//
// They are written as audits that take a config and a source tree, so that the second half of this file can plant a free holder, an act with
// no row and a special case of each kind the foundations deleted, and see each named.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { generate } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const BEHAVIOUR = join(root, "participants/src/behaviour");

/** The blocks the contract knows: every act is some of these, and each takes time. */
const BLOCKS: string[] = (() => {
  const defs = JSON.parse(readFileSync(join(root, "contracts/blocks.schema.json"), "utf8")).$defs as { [k: string]: any };
  return Object.values(defs).map((d) => d?.properties?.block?.const).filter((x): x is string => typeof x === "string").sort();
})();

/** A living town of a profile: every kind of office, venue and firm, with the everyday frictions on. */
const living = (profile: string, more: object = {}) => generate({ ...spec, citizens: 300, profile, factories: 5, living: spec.living ?? {}, ...more });
/** The same with every office handed to a model: a seat is a person with a post of its own (foundations F5) and the town otherwise the same. */
const seated = (profile: string) => { const code = living(profile); return living(profile, { model_seats: code.positions.filter((p: any) => !/-(staff|payroll|deputy)$/.test(p.id) && code.participants.find((x: any) => x.id === p.holder)?.kind === "person").map((p: any) => p.id) }); };

// ----------------------------------------------------------------------------------------------------------------- the audits

/** Law 3: every post is held by a person, or by a system delivered from a template by an organisation that supplies it. Names the post and who holds it. */
export function freeHolders(c: any): string[] {
  const byId = new Map<string, any>(c.participants.map((p: any) => [p.id, p]));
  const templates = new Map<string, any>((c.templates ?? []).map((t: any) => [t.id, t]));
  const orgs = new Set<string>(c.world.entities.filter((e: any) => e.kind !== "person").map((e: any) => e.id));
  const out: string[] = [];
  for (const post of c.positions.filter((p: any) => p.holder)) {
    const h = byId.get(post.holder);
    if (!h) out.push(`${post.id}: held by ${post.holder}, who is nobody`);
    else if (h.kind === "person") { if (!h.person) out.push(`${post.id}: held by ${h.id}, a person with no body`); }
    else if (h.kind !== "system" || templates.get(h.template)?.kind !== "system" || !orgs.has(h.supplier)) out.push(`${post.id}: held by the system ${h.id}, which no supplier delivered from a template`);
    else if (!(templates.get(h.template)?.does ?? []).length) out.push(`${post.id}: held by ${h.id}, whose template says nothing of what it does`);
  }
  return out;
}

/** Law 2: no act is free. Every block the contract has takes a person a positive time by a row of the table (a missing row is a second, which is the platform's way of saying nobody priced it);
 * every block a system's template does has a row for systems; no row is zero or less; and every row of the table has its source. */
export function unpricedWork(c: any): string[] {
  const table = c.orchestration?.act_time;
  if (!table) return ["the world has no table of work"];
  const out: string[] = [];
  const person: { [k: string]: number } = table.person ?? {}, system: { [k: string]: number } = table.system ?? {};
  for (const b of BLOCKS) if (!((person[b] ?? 0) > 0)) out.push(`a person's ${b}: no row in the table of work`);
  for (const t of (c.templates ?? []).filter((x: any) => x.kind === "system")) for (const r of t.does ?? []) if (!((system[r.block] ?? 0) > 0)) out.push(`${t.id}: its ${r.block} has no row for a system`);
  for (const [who, rows] of [["person", person], ["system", system]] as const) for (const [k, s] of Object.entries(rows)) {
    if (!(s > 0)) out.push(`${who}.${k}: ${s} seconds`);
    // (A row for what is made, `publish/<kind>`, has a source of its own; a row for a block may stand under its kind of actor's.)
    const source = table.sources?.[`${who}.${k}`] ?? (k.includes("/") ? undefined : table.sources?.[who]);
    if (typeof source !== "string" || source.length < 20) out.push(`${who}.${k}: no source`);
  }
  if (table.default !== undefined) out.push("the table has a default: an act it does not name is not priced");
  return out;
}

/** Law 2: every kind of paper a form writes takes a person time: the row for what it makes, else the block's (never none). Names the form. */
export function unpricedPapers(c: any): string[] {
  const table = c.orchestration?.act_time?.person ?? {};
  const out: string[] = [];
  for (const r of c.world.records.filter((x: any) => x.record === "statement" && x.data?.writes?.kind)) {
    const kind = r.data.writes.kind as string;
    if (!((table[`publish/${kind}`] ?? table.publish) > 0)) out.push(`${r.id}: the paper it writes (${kind}) takes no time`);
  }
  for (const r of c.world.records.filter((x: any) => x.record === "statement" && x.kind === "form" && x.data?.submit_as && !x.data?.writes)) {
    if (!((table[`publish/${r.data.submit_as}`] ?? table.publish) > 0)) out.push(`${r.id}: the paper it writes (${r.data.submit_as}) takes no time`);
  }
  return out;
}

const DIALS = /^(cases_per_day|capacity_per_day|processing_days)$|^(cases|capacity|claims|decisions|reviews)_per_day$|^(error_bps|uphold_bps|billing_error_bps_per_year)$/;
/** Law 2 and 5: no module is handed throughput, delay or a rate of error as a parameter (a backlog comes from hours, an error from a slip at a sourced rate). Names the post or participant and the path. */
export function dialsHanded(c: any): string[] {
  const out: string[] = [];
  const walk = (x: unknown, path: string) => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      if (DIALS.test(k) || (k === "per_year_bps" && /short_pay$/.test(path))) out.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  for (const p of c.positions) walk(p.role_module, p.id);
  for (const p of c.participants) walk(p.controller, p.id);
  return out;
}

/** Law 5: an error is drawn only through `slip()`: a purpose named for a wrong decision (uphold, error, short pay, wrong, mistake, slip) drawn by a module. Names the line. */
const CHANCE_OF_WRONG = /\b(?:rng|chance)\(\s*[`"'][^`"']*(?:uphold|error|short-pay|wrong|mistake|slip)/;
export function errorsDrawnOutsideSlip(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => { if (CHANCE_OF_WRONG.test(l)) out.push(`${f}:${i + 1}`); });
  return out;
}

/** The same in Rust: every .rs file under `dir` (the Rust world's actors and rules), by path relative to it. */
export function errorsDrawnOutsideSlipRust(dir: string): string[] {
  const out: string[] = [];
  for (const f of [...new Glob("**/*.rs").scanSync(dir)].sort()) {
    if (f.endsWith("slip.rs")) continue;
    readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => { if (CHANCE_OF_WRONG.test(l)) out.push(`${f}:${i + 1}`); });
  }
  return out;
}

/** Everything the foundations delete, still standing (the inventory: `history` entries are a decision's record and are never edited). */
export function specialCasesLeft(inventory: string): string[] {
  const inv = JSON.parse(readFileSync(inventory, "utf8")) as { entries: { id: string; step: string; kind: string; file: string; find: string }[] };
  const out: string[] = [];
  for (const e of inv.entries.filter((x) => x.kind !== "history")) {
    const files = e.file.includes("*") ? [...new Glob(e.file).scanSync(root)].sort() : [e.file];
    for (const f of files) if (existsSync(join(root, f))) readFileSync(join(root, f), "utf8").split("\n").forEach((l, i) => { if (l.includes(e.find)) out.push(`${e.id} (${e.step}): ${f}:${i + 1}`); });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- it passes on every profile

test("every profile's town, as code and with every office a model's, has no free holder, no unpriced act, no unpriced paper and no dial", () => {
  for (const profile of profiles) for (const [how, c] of [["code", living(profile)], ["seats", seated(profile)]] as const) {
    expect(freeHolders(c), `${profile} (${how}): posts held by nobody who works`).toEqual([]);
    expect(unpricedWork(c), `${profile} (${how}): work with no time`).toEqual([]);
    expect(unpricedPapers(c), `${profile} (${how}): papers with no time`).toEqual([]);
    expect(dialsHanded(c), `${profile} (${how}): throughput, delay or error set directly`).toEqual([]);
  }
}, 600_000);

test("no module draws an error except through slip(), and the foundations' special cases are gone", () => {
  expect(existsSync(join(root, "participants/src/slip.ts")), "the one helper").toBe(true);
  expect(errorsDrawnOutsideSlip(BEHAVIOUR), "errors drawn outside slip()").toEqual([]);
  // (The Rust world's actors and rules: a slip only through oikos_rules::slip, docs/port-guide.md section 2.)
  expect(existsSync(join(root, "kernel/crates/rules/src/slip.rs")), "the one helper, in Rust").toBe(true);
  for (const dir of ["kernel/crates/actors/src", "kernel/crates/rules/src"]) expect(errorsDrawnOutsideSlipRust(join(root, dir)), `errors drawn outside slip() in ${dir}`).toEqual([]);
  expect(specialCasesLeft(join(import.meta.dir, "fixtures/foundations-inventory.json")), "special cases the foundations delete, still standing").toEqual([]);
  // And no profile states a dial of its own.
  for (const profile of profiles) expect(JSON.stringify(loadProfile(profile).values), profile).not.toMatch(/"(cases_per_day|capacity_per_day|processing_days)"/);
});

test("the law is written down where the rule says it is: the page, and the line in CLAUDE.md", () => {
  const page = readFileSync(join(root, "docs/all-work-takes-time.md"), "utf8");
  for (const needle of ["orchestrator/test/all-work-takes-time.test.ts", "A gap is a missing law", "design/foundations.md"]) expect(page, needle).toContain(needle);
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("docs/all-work-takes-time.md");
});

// ----------------------------------------------------------------------------------------------------------------- it fails on what it is for

test("it fails, naming the post, on a free holder: a system no supplier delivered, a post held by nobody who works, a template that does nothing", () => {
  const c = structuredClone(living("au-vic-2026"));
  expect(freeHolders(c)).toEqual([]);
  // A system with no template and no supplier: the old placeholder, free and able to do anything.
  const post = c.positions.find((p: any) => c.participants.find((x: any) => x.id === p.holder)?.kind === "person" && !/-(staff|payroll|deputy)$/.test(p.id))!;
  c.participants.push({ id: "free-clerk", kind: "system", owner: post.entity, controller: { type: "code", impl: post.role_module.code, params: {} } });
  const was = post.holder;
  post.holder = "free-clerk";
  expect(freeHolders(c)).toEqual([`${post.id}: held by the system free-clerk, which no supplier delivered from a template`]);
  // A holder who is nobody.
  post.holder = "ghost";
  expect(freeHolders(c)).toEqual([`${post.id}: held by ghost, who is nobody`]);
  post.holder = was;
  // A delivered system whose template says nothing of what it does.
  const sys = c.participants.find((x: any) => x.kind === "system" && c.templates.some((t: any) => t.id === x.template))!;
  c.templates.find((t: any) => t.id === sys.template).does = [];
  expect(freeHolders(c).some((x) => x.includes(sys.id) && x.includes("says nothing of what it does"))).toBe(true);
});

test("it fails, naming the row, on work with no time: a block nobody priced, a row of nothing, a row with no source, a default, a paper that takes no time", () => {
  const base = living("au-vic-2026");
  const copy = () => structuredClone(base);
  let c = copy();
  delete c.orchestration.act_time.person.take;
  expect(unpricedWork(c)).toEqual(["a person's take: no row in the table of work"]);
  c = copy();
  c.orchestration.act_time.person.message = 0;
  expect(unpricedWork(c).sort()).toEqual(["a person's message: no row in the table of work", "person.message: 0 seconds"]);
  c = copy();
  delete c.orchestration.act_time.sources["person.publish/benefit_decision"];
  expect(unpricedWork(c)).toEqual(["person.publish/benefit_decision: no source"]);
  c = copy();
  c.orchestration.act_time.default = 0;
  expect(unpricedWork(c)).toEqual(["the table has a default: an act it does not name is not priced"]);
  // A system that can do what its template lists, at no time.
  c = copy();
  const tpl = c.templates.find((t: any) => t.kind === "system")!;
  delete c.orchestration.act_time.system[tpl.does[0].block];
  expect(unpricedWork(c).some((x) => x.startsWith(`${tpl.id}: its ${tpl.does[0].block} has no row`))).toBe(true);
  // A paper a form writes, on a table with neither its own row nor the block's.
  c = copy();
  delete c.orchestration.act_time.person.publish;
  const form = c.world.records.find((r: any) => r.record === "statement" && r.data?.writes?.kind && !c.orchestration.act_time.person[`publish/${r.data.writes.kind}`])!;
  expect(unpricedPapers(c).some((x) => x.startsWith(`${form.id}: the paper it writes (${form.data.writes.kind}) takes no time`))).toBe(true);
});

test("it fails, naming the post, on a special case of each kind the foundations deleted: a dial on a venue, a rate of error handed to a module, an error drawn outside slip()", () => {
  const c = structuredClone(living("au-vic-2026"));
  expect(dialsHanded(c)).toEqual([]);
  const venue = c.positions.find((p: any) => p.role_module?.code === "tribunal.member")!;
  venue.role_module.params.cases_per_day = 5;
  expect(dialsHanded(c)).toEqual([`${venue.id}.params.cases_per_day`]);
  const office = c.positions.find((p: any) => p.role_module?.code === "world.transfers" || p.role_module?.code === "city.planning_officer")!;
  office.role_module.params.processing_days = 3;
  office.role_module.params.error_bps = 400;
  expect(dialsHanded(c).sort()).toEqual([`${office.id}.params.error_bps`, `${office.id}.params.processing_days`, `${venue.id}.params.cases_per_day`].sort());
  const desk = c.participants.find((p: any) => p.controller?.type === "code")!;
  desk.controller.params = { ...(desk.controller.params ?? {}), capacity_per_day: 40 };
  expect(dialsHanded(c)).toContain(`${desk.id}.params.capacity_per_day`);
  // An error drawn by chance in a module: a copy of the sources with one such line.
  const dir = mkdtempSync(join(tmpdir(), "oikos-all-work-"));
  try {
    for (const f of readdirSync(BEHAVIOUR).filter((n) => n.endsWith(".ts"))) writeFileSync(join(dir, f), readFileSync(join(BEHAVIOUR, f), "utf8"));
    expect(errorsDrawnOutsideSlip(dir)).toEqual([]);
    const lines = readFileSync(join(dir, "tax.ts"), "utf8").split("\n");
    lines.splice(10, 0, 'const wrong = ctx.rng(`claim-error-${t}`).below(10_000) < 400; // a decision wrong by chance, outside slip()');
    writeFileSync(join(dir, "tax.ts"), lines.join("\n"));
    expect(errorsDrawnOutsideSlip(dir)).toEqual(["tax.ts:11"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // A special case of the inventory's kind, standing: an entry that points at a line that is there.
  const fixture = join(mkdtempSync(join(tmpdir(), "oikos-all-work-inv-")), "inventory.json");
  writeFileSync(fixture, JSON.stringify({ entries: [{ id: "planted", step: "F6", kind: "delete", file: "participants/src/behaviour/world.ts", find: 'name: "world.transfers"' }] }));
  expect(specialCasesLeft(fixture).map((x) => x.replace(/:\d+$/, ""))).toEqual(["planted (F6): participants/src/behaviour/world.ts"]);
  rmSync(join(fixture, ".."), { recursive: true, force: true });
});
