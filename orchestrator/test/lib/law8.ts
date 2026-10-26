// The audits of law 8's backstop (orchestrator/test/nothing-from-nothing.test.ts; docs/nothing-from-nothing.md): each
// reads a world's config, or the sources of the modules, and names what breaks "nothing physical from nothing".

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

export const root = join(import.meta.dir, "../../..");
export const INVENTORY = join(import.meta.dir, "../fixtures/foundations-2-inventory.json");
/** Where the engine's behaviour is written: the Rust world's actors, its rules and the world's physics, and what of the town's kinds is still read in TypeScript. */
export const SOURCES = ["kernel/crates/actors/src", "kernel/crates/rules/src", "kernel/crates/world/src", "participants/src/kinds", "participants/src/shared", "participants/src/readers"];

export type Task = { id: string; in?: string; labour?: number; consumes?: Record<string, string>; produces?: Record<string, string>; changes?: Record<string, number>; draws?: { field: string; per_unit: number }; emits?: Record<string, number>; on_body?: unknown; surveys?: boolean; investigates?: boolean };
type Resource = { id: string; unit: string; class?: "stock" | "dissipates" | "service" };

/** Every module's parameters in a world: each post's role module, and each participant's controller. */
function moduleParams(c: any): { who: string; module: string; params: Record<string, unknown> }[] {
  const out: { who: string; module: string; params: Record<string, unknown> }[] = [];
  for (const p of c.positions ?? []) if (p.role_module?.params) out.push({ who: p.id, module: p.role_module.code, params: p.role_module.params });
  for (const p of c.participants ?? []) if (p.controller?.type === "code" && p.controller.params) out.push({ who: p.id, module: p.controller.impl, params: p.controller.params });
  return out;
}

/** The kinds an edge sells (each world market's `sells`) and takes (its `buys`, and what a disposal edge takes in). */
function edgeKinds(c: any): { sells: Set<string>; takes: Set<string> } {
  const sells = new Set<string>(), takes = new Set<string>();
  for (const m of moduleParams(c)) {
    if (m.module === "world.trade") {
      for (const k of Object.keys((m.params.sells as object) ?? {})) sells.add(k);
      for (const k of Object.keys((m.params.buys as object) ?? {})) takes.add(k);
    }
    if (m.module === "world.disposal" && typeof m.params.kind === "string") takes.add(m.params.kind);
  }
  // (A world's own edges' scarce kinds, C6: sold by the edge, so made by it.)
  for (const e of c.world?.edges ?? []) for (const k of Object.keys(e.supplies ?? {})) sells.add(k);
  return { sells, takes };
}

// ----------------------------------------------------------------------------------------------------------------- the audits

/** A building's variable is a condition, never a stock: none grows by its occupants, none is a kind of the world's,
 * and no module reads one as a meter it bills or draws against. Names the variable. */
export function stocksAsVariables(c: any): string[] {
  const kinds = new Set<string>((c.catalogue.resources ?? []).map((r: Resource) => r.id));
  const out: string[] = [];
  for (const v of c.catalogue.variables ?? []) {
    if (v.per_occupant_per_day) out.push(`${v.id}: grows by its occupants (per_occupant_per_day)`);
    if (kinds.has(v.id)) out.push(`${v.id}: a variable with the name of a kind the world holds`);
  }
  const vars = new Set<string>((c.catalogue.variables ?? []).map((v: any) => v.id));
  const seen = new Set<string>();
  for (const m of moduleParams(c)) for (const [k, x] of Object.entries(m.params)) {
    if (/^meters?$/.test(k) && typeof x === "string" && vars.has(x) && !seen.has(`${m.module}.${x}`)) { seen.add(`${m.module}.${x}`); out.push(`${x}: read as a meter by ${m.module}`); }
  }
  return [...new Set(out)].sort();
}

/** Every kind something consumes is made by a recipe, an edge or nature; every kind made is held or taken by something. Names the kind. */
export function orphanKinds(c: any): string[] {
  const tasks: Task[] = c.catalogue.tasks ?? [];
  const { sells, takes } = edgeKinds(c);
  const made = new Set<string>([...sells]);
  const used = new Set<string>([...takes]);
  for (const t of tasks) {
    for (const k of Object.keys(t.produces ?? {})) made.add(k);
    for (const k of Object.keys(t.consumes ?? {})) used.add(k);
  }
  for (const f of c.catalogue.fields ?? []) if (f.kind) made.add(f.kind);
  for (const s of c.catalogue.structure_types ?? []) for (const k of Object.keys(s.materials ?? {})) used.add(k);
  // (What reaches a holding by a connection is used by whoever holds it: a kind a network carries is made by its source, C3.)
  for (const s of c.world?.network?.supplies ?? []) { made.add(s.kind); }
  for (const x of c.world?.connections ?? []) used.add(x.kind);
  const out: string[] = [];
  for (const k of [...used].sort()) if (!made.has(k)) out.push(`${k}: consumed, and nothing makes it (no recipe, edge or nature)`);
  for (const k of [...made].sort()) if (!used.has(k)) out.push(`${k}: made, and nothing uses it or takes it in`);
  return out;
}

/** Every recipe at a workplace states its energy and water (nought is allowed, with its basis in the figure table; silence is not). Names the recipe. */
export function silentRecipes(c: any): string[] {
  const kinds = new Set<string>((c.catalogue.resources ?? []).map((r: Resource) => r.id));
  const out: string[] = [];
  for (const t of (c.catalogue.tasks ?? []) as Task[]) {
    if (t.in !== "workplace") continue;
    const says = (k: string) => Object.prototype.hasOwnProperty.call(t.consumes ?? {}, k);
    const missing = ["energy", "water"].filter((k) => !says(k));
    if (missing.length) out.push(`${t.id}: states no ${missing.join(" and no ")}${missing.some((k) => !kinds.has(k)) ? " (the world has no such kind)" : ""}`);
  }
  return out;
}

/** A module charges (or draws) for a quantity it read from a meter or a holding, never for an assumed use a head or a customer. Names the module and the parameter. */
const ASSUMED_USE = /_per_(customer|person|household|occupant|home)_per_(day|month|year)$/;
export function billsWithoutMeters(c: any): string[] {
  const out = new Set<string>();
  for (const m of moduleParams(c)) for (const k of Object.keys(m.params)) if (ASSUMED_USE.test(k)) out.add(`${m.module}: ${k} (an assumed use, not a meter or a holding)`);
  return [...out].sort();
}

/** Nothing vanishes: a draw goes into a holding (its field holds a kind), and no process only destroys a stock kind. Names the recipe. */
export function vanishing(c: any): string[] {
  const resources = new Map<string, Resource>((c.catalogue.resources ?? []).map((r: Resource) => [r.id, r]));
  const fields = new Map<string, any>((c.catalogue.fields ?? []).map((f: any) => [f.id, f]));
  const out: string[] = [];
  for (const t of (c.catalogue.tasks ?? []) as Task[]) {
    if (t.draws && !fields.get(t.draws.field)?.kind) out.push(`${t.id}: draws from ${t.draws.field}, which holds no kind: what is drawn goes nowhere`);
    const stock = Object.keys(t.consumes ?? {}).filter((k) => (resources.get(k)?.class ?? "stock") === "stock");
    const effect = Object.keys(t.produces ?? {}).length || Object.keys(t.changes ?? {}).length || Object.keys(t.emits ?? {}).some((k) => fields.get(k)?.kind) || t.on_body || t.surveys || t.investigates || (t as any).collects;
    if (stock.length && !effect) out.push(`${t.id}: only destroys ${stock.join(", ")} (a stock kind: it must become something, or be a kind that dissipates or a service)`);
  }
  return out;
}

/** No module shares out a shortfall by a rule of its own (a share, a ration, a priority, a cut of its own reckoning): who goes
 * short follows from the network's physics, the supply contracts in force and the operators' own acts. Names the file and the rule. */
const ALLOCATION = /\bpro[_ ]?rata\b|\bration(?:ed|ing|s)?\b|\bshare[sd]?_out\b|\ballocat\w*_shortfall\b|\bshortfall_share\b|\brestriction_cut_bps\b|\bprice_elasticity_bps\b/;
export function allocationRules(dirs: string[], base = root): string[] {
  const out = new Set<string>();
  for (const d of dirs) {
    const dir = join(base, d);
    if (!existsSync(dir)) continue;
    for (const f of [...new Glob("**/*.{rs,ts}").scanSync(dir)].sort()) {
      if (/(^|\/)tests?(\.rs|\/)|\.test\.ts$/.test(f)) continue;
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        const code = line.replace(/\/\/.*$/, "");
        const m = code.match(ALLOCATION);
        if (m) out.add(`${d}/${f}: ${m[0]}`);
      }
    }
  }
  return [...out].sort();
}

export type Inventory = { done: string[]; found: Record<string, string[]>; entries: { id: string; step: string; kind: string; file: string; find: string; what: string }[] };
export const inventory = (path = INVENTORY): Inventory => JSON.parse(readFileSync(path, "utf8"));

/** A special case a landed step deleted, standing again (an entry of the inventory whose step is done, still found). Names the entry and the line. */
export function specialCasesLeft(path = INVENTORY): string[] {
  const inv = inventory(path);
  const out: string[] = [];
  for (const e of inv.entries.filter((x) => inv.done.includes(x.step))) {
    const files = e.file.includes("*") ? [...new Glob(e.file).scanSync(root)].sort() : [e.file];
    for (const f of files) if (existsSync(join(root, f))) readFileSync(join(root, f), "utf8").split("\n").forEach((l, i) => { if (l.includes(e.find)) out.push(`${e.id} (${e.step}): ${f}:${i + 1}`); });
  }
  return out;
}

/** A special case the inventory lists as standing (its step not yet landed), still found: the cases left to delete. */
export function casesStanding(inv: Inventory): string[] {
  return inv.entries.filter((e) => !inv.done.includes(e.step)).filter((e) => {
    const files = e.file.includes("*") ? [...new Glob(e.file).scanSync(root)].sort() : [e.file];
    return files.some((f) => existsSync(join(root, f)) && readFileSync(join(root, f), "utf8").includes(e.find));
  }).map((e) => e.id);
}

export const AUDITS: Record<string, (c: any) => string[]> = { stocksAsVariables, orphanKinds, silentRecipes, billsWithoutMeters, vanishing };

