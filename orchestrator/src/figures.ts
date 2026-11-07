// What a world's figures rest on (docs/design/foundations-2.md, law 11; step N1, counting only).
//
// Every number that reaches a world should have a basis on record: sourced (opened), sourced but to confirm (a summary,
// something recalled, an approximation), derived from named figures, fitted to an outcome, a placeholder (with why), or
// a convention (seconds in a day, basis points). This file reads a world's config, finds every number in it, and says
// what each rests on, from the notes the world already carries: the table of work's `sources`, a module's manifest (for
// a parameter whose default the module states), and the generator's own table of what its figures are made from
// (`worlds/generator/figures.ts`), which names the profile's paths or says what the generator chose. A number none of
// these covers is *unbased*, and is counted and listed by where it is.
//
// Strict since foundations-2 phase 5 (N3): a generated world with an unbased number does not run (`refuseUnbased`, read
// where a world is loaded to be run); a hand-written world is counted and runs. Not in the kernel, as designed: the
// basis of a number is read from the generator's table, the profiles' notes and the manifests, all here, and the run
// that starts every world is here too (docs/decisions.md, "Foundations-2 phase 5: law 11 strict"). The report is written
// beside a batch's runs (figures.txt, figures.json) and by `oikos figures <world>`, never into the log or the config.

import { manifests } from "@oikos/participants";
import { FIGURE_BASIS, type Basis } from "@oikos/worlds/generator/figures";
import { loadProfile } from "@oikos/worlds/generator/profile";

export type FigureClass = "sourced" | "to_confirm" | "derived" | "fitted" | "placeholder" | "convention" | "unbased";
export const CLASSES: FigureClass[] = ["sourced", "to_confirm", "derived", "fitted", "placeholder", "convention", "unbased"];

/** What a free-text source note says of its figure. A note that covers several figures and calls any of them a
 * placeholder counts them all as placeholders: the report errs on the side of saying less is sourced. */
export function classify(note: string | undefined | null): FigureClass {
  if (!note || !note.trim()) return "unbased";
  const n = note.toLowerCase();
  if (/placeholder|unsourced|no source|not sourced|invented|chosen, not sourced/.test(n)) return "placeholder";
  if (/\bfitted\b|\bcalibrated\b/.test(n)) return "fitted";
  if (/to confirm|recalled|from memory|summary|summaries|approximat|secondary/.test(n)) return "to_confirm";
  if (/^\s*(derived|computed|from the profile|the world gives it)/.test(n)) return "derived";
  return "sourced";
}

export interface Leaf { path: string[]; value: number }

/** Every number in a value, with its path (array positions as their index). Whole numbers written as strings (the
 * contract's amounts) count as numbers. */
export function leaves(v: unknown, path: string[] = [], out: Leaf[] = []): Leaf[] {
  if (typeof v === "number") out.push({ path, value: v });
  else if (typeof v === "string") { if (/^-?\d+$/.test(v)) out.push({ path, value: Number(v) }); }
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, String(i)], out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], out);
  return out;
}

/** A path as the report groups it: array positions and ids as `*` (an id is all digits, has a numbered part such as
 * `lot-12` or `cell.3.4`, or is the id of something the world declares). */
export function shape(path: string[], config: any): string {
  const known = idsOf(config);
  const out: string[] = [];
  let node: any = config;
  for (const seg of path) {
    // (A parameter's name is never an id, whatever else bears it: `school` the parameter, `school` the entity.)
    // (Nor is the name of one a clerk keeps for its office's module: `params.with.<name>`.)
    const param = out.at(-1) === "params" || (out.at(-1) === "with" && out.at(-2) === "params");
    out.push(Array.isArray(node) || /^\d+$/.test(seg) || /[-.]\d/.test(seg) || (!param && known.has(seg)) ? "*" : seg);
    node = node?.[seg];
  }
  return out.join(".");
}

const idCache = new WeakMap<object, Set<string>>();
/** Every id the world declares: entities, participants, positions, accounts, structures, records, templates, kinds. */
function idsOf(config: any): Set<string> {
  if (!config || typeof config !== "object") return new Set();
  let s = idCache.get(config);
  if (s) return s;
  s = new Set<string>();
  const add = (xs: unknown) => { if (Array.isArray(xs)) for (const x of xs) if (x && typeof (x as any).id === "string") s!.add((x as any).id); };
  for (const k of ["participants", "positions", "templates"]) add(config[k]);
  for (const k of ["entities", "accounts", "structures", "records", "holdings"]) add(config.world?.[k]);
  for (const k of ["structure_types", "resources", "tasks", "variables", "fields", "species", "land_covers"]) add(config.catalogue?.[k]);
  idCache.set(config, s);
  return s;
}

/** Where a module's parameters are in a config, and which module's they are. */
function paramsAt(config: any, path: string[]): { module: string; param: string; index: number } | undefined {
  const [top, i, ...rest] = path;
  const item = top !== undefined && i !== undefined ? config[top]?.[Number(i)] : undefined;
  if (!item) return undefined;
  // (`index`: where the parameter's name is in the path.)
  const at = (holder: any, n: number) => {
    const module = holder?.code ?? holder?.impl;
    return typeof module === "string" && rest[n] === "params" && rest[n + 1] ? { module, param: rest[n + 1]!, index: n + 3 } : undefined;
  };
  // (A model's seat carries a mock of its code twin: its parameters are the twin's module's, the module of the post it holds
  // unless the mock names one. And an office's clerk keeps the books for the office's own module: `of`, its parameters `with`.)
  if ((top === "participants" || top === "templates") && rest[0] === "controller" && rest[1] === "params" && rest[2] === "mock" && rest[3] === "params" && rest[4]) {
    const mock = item.controller?.params?.mock;
    const module = mock?.impl ?? mock?.code ?? config.positions?.find((p: any) => p.holder === item.id)?.role_module?.code;
    return typeof module === "string" ? { module, param: rest[4], index: 6 } : undefined;
  }
  if (top === "positions" && rest[0] === "role_module" && rest[1] === "params" && rest[2] === "with" && rest[3] && typeof item.role_module?.params?.of === "string") {
    return { module: item.role_module.params.of, param: rest[3], index: 5 };
  }
  if ((top === "participants" || top === "templates") && rest[0] === "controller") return at(item.controller, 1);
  if (top === "positions" && rest[0] === "role_module") return at(item.role_module, 1);
  return undefined;
}

export interface Based { class: FigureClass; why: string; /** The generator's row that spoke for it. */ row?: number }

/** What one number of a world rests on. */
export function basisOf(config: any, leaf: Leaf, profile?: { values: any; sources: { [k: string]: string } }, table: Basis[] = FIGURE_BASIS): Based {
  const p = leaf.path;
  // The table of work: each row's note, or its actor's.
  // (And the table of slips, which has the same shape: a rate by who does it and what it makes.)
  if (p[0] === "orchestration" && (p[1] === "act_time" || p[1] === "slip") && (p[2] === "person" || p[2] === "system") && p[3]) {
    const src = config.orchestration[p[1]].sources ?? {};
    const note = src[`${p[2]}.${p[3]}`] ?? src[p[2]];
    return { class: classify(note), why: note ? `${p[1]}.sources ${src[`${p[2]}.${p[3]}`] ? `${p[2]}.${p[3]}` : p[2]}` : "no note for the row" };
  }
  // The generator's table: patterns over the config's paths (first match). (The rows whose pattern and module fit a shape
  // are found once a shape and module: a town of 1,000 has some 285,000 numbers in about 800 shapes.)
  const sh = shape(p, config);
  const pa = paramsAt(config, p);
  for (const row of candidates(table, sh, pa?.module)) {
    const b = table[row]!;
    if (b.id !== undefined && !passes(config, p, b.id)) continue;
    if (b.given !== undefined && valueAt(config, b.given.split(".")) === undefined) continue;
    if (b.profile && profile) {
      // (Below the row's pattern, the profile's note for the same part, where it has one: `households.lone_bps` under
      // `households`. Its own path's note, or the nearest above it, otherwise.)
      const n = b.at.split(".").length, below = b.at.includes("**") ? [] : sh.split(".").slice(n);
      const at = [b.profile, ...below].join(".");
      const note = sourceFor(profile.sources, at);
      return { class: note ? classify(note) : "unbased", why: `profile ${b.profile}`, row };
    }
    if (b.profile) return { class: "derived", why: `profile ${b.profile} (no profile given)`, row };
    return { class: b.class!, why: b.why!, row };
  }
  // A module's parameter whose value the module states: its manifest's note.
  if (pa) {
    const m = manifests().get(pa.module)?.params[pa.param];
    if (m && !/^the world gives it/.test(m.source) && JSON.stringify(m.default) !== undefined && m.default !== undefined) {
      // (A value equal to the module's own default is the module's figure; any other the world chose.)
      const given = valueAt(config, p.slice(0, pa.index + 1));
      if (JSON.stringify(given) === JSON.stringify(m.default)) return { class: classify(m.source), why: `manifest ${pa.module}.${pa.param}` };
    }
  }
  return { class: "unbased", why: "nothing says" };
}

const valueAt = (v: any, path: string[]) => path.reduce((x, k) => x?.[k], v);

const candidateCache = new WeakMap<Basis[], Map<string, number[]>>();
/** The rows of a table whose pattern covers a shape and whose module (if any) is this one, in order. */
function candidates(table: Basis[], sh: string, module: string | undefined): number[] {
  let byKey = candidateCache.get(table);
  if (!byKey) candidateCache.set(table, (byKey = new Map()));
  const key = `${module ?? ""}|${sh}`;
  let rows = byKey.get(key);
  if (!rows) {
    rows = [];
    for (const [row, b] of table.entries()) if ((!b.module || b.module === module) && matches(b.at, sh)) rows.push(row);
    byKey.set(key, rows);
  }
  return rows;
}

/** Was this world made by the generator? (Its description says so: a hand-written world is a fixture.) */
export function isGenerated(config: any): boolean {
  // (One town, or several composed on one ground: `towns: N`.)
  return typeof config?.meta?.description === "string" && /^(Generated town|\d+ towns on one ground)/.test(config.meta.description);
}

/**
 * Law 11, strict (docs/design/foundations-2.md, N3): a generated world with a number nothing speaks for does not run.
 * Thrown where a world is loaded to be run (`loadWorld`, an experiment's spec), naming where the unbased numbers are; with
 * the spec, its profile's notes are read too. A hand-written world (a test's fixture) is counted as it is, and runs.
 */
export function refuseUnbased(config: any, spec?: any): void {
  if (!isGenerated(config)) return;
  const r = figuresFor(config, spec);
  if (r.by_class.unbased) throw new Error(`unbased_figure: this generated world has ${r.by_class.unbased} number${r.by_class.unbased > 1 ? "s" : ""} nothing speaks for (law 11; give each a row in worlds/generator/figures.ts that is true of the code that makes it): ${r.unbased.slice(0, 10).map((u) => `${u.at} (${u.count})`).join(", ")}${r.unbased.length > 10 ? ", ..." : ""}`);
}

/** Does a leaf's path go through `id`: a key of that name, or an element whose `id` it is? */
function passes(config: any, path: string[], id: string): boolean {
  const is = (x: unknown) => typeof x === "string" && (id.endsWith("*") ? x.startsWith(id.slice(0, -1)) : x === id);
  let node = config;
  for (const seg of path) {
    if (is(seg) || (node && typeof node === "object" && is(node.id))) return true;
    node = node?.[seg];
  }
  return false;
}

/** Does a pattern (dotted, `*` for one segment, `**` for any number) match a path's shape? */
const patterns = new Map<string, RegExp>();
export function matches(pattern: string, sh: string): boolean {
  // A pattern covers everything under it, as a profile's source key does: the shape itself, or the shape down to one of its
  // dots. (Compiled once a pattern: a town's figures ask the generator's table of each of its 20,000 numbers.)
  let re = patterns.get(pattern);
  if (!re) patterns.set(pattern, (re = new RegExp(`^${pattern.split(".").map((s) => (s === "**" ? "(?:[^.]+(?:\\.[^.]+)*)?" : s === "*" ? "[^.]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.")}(?:\\..*)?$`)));
  return re.test(sh);
}

/** A profile's note for a dotted path: the note of the path itself or of the nearest section above it. */
export function sourceFor(sources: { [k: string]: string }, path: string): string | undefined {
  const parts = path.split(".");
  for (let n = parts.length; n > 0; n--) {
    const k = parts.slice(0, n).join(".");
    if (sources[k] !== undefined) return sources[k];
  }
  return undefined;
}

export interface FiguresReport {
  numbers: number;
  by_class: { [c in FigureClass]: number };
  /** The unbased numbers, grouped by where they are (shape of the path), most first. */
  unbased: { at: string; count: number }[];
  /** The profile's own notes, by class (how much of the place is sourced). */
  profile?: { notes: number; by_class: { [c in FigureClass]: number } };
}

/** Count what a world's numbers rest on. */
export function figuresReport(config: any, profile?: { values: any; sources: { [k: string]: string } }): FiguresReport {
  const zero = () => Object.fromEntries(CLASSES.map((c) => [c, 0])) as { [c in FigureClass]: number };
  const by = zero();
  const unbased = new Map<string, number>();
  const all = leaves(config);
  for (const leaf of all) {
    const b = basisOf(config, leaf, profile);
    by[b.class]++;
    if (b.class === "unbased") {
      const at = shape(leaf.path, config);
      unbased.set(at, (unbased.get(at) ?? 0) + 1);
    }
  }
  const out: FiguresReport = { numbers: all.length, by_class: by, unbased: [...unbased].map(([at, count]) => ({ at, count })).sort((a, b) => b.count - a.count || a.at.localeCompare(b.at)) };
  if (profile) {
    const pc = zero();
    for (const n of Object.values(profile.sources)) pc[classify(n)]++;
    out.profile = { notes: Object.keys(profile.sources).length, by_class: pc };
  }
  return out;
}

/** The report for a world as a batch loads it: with its profile's notes where it was generated from a spec. */
export function figuresFor(config: any, spec?: any): FiguresReport {
  // (A spec with no profile, or a world given whole, is counted without one.)
  const p = spec?.profile ? (loadProfile(String(spec.profile)) as any) : undefined;
  return figuresReport(config, p ? { values: p.values, sources: p.sources } : undefined);
}

/** The report as a few lines for a person. */
export function figuresText(r: FiguresReport, most = 15): string {
  const pct = (n: number) => (r.numbers ? `${((100 * n) / r.numbers).toFixed(1)}%` : "0%");
  const lines = [`What this world's ${r.numbers} numbers rest on (docs/design/foundations-2.md, law 11; counting only):`];
  for (const c of CLASSES) if (r.by_class[c]) lines.push(`  ${c.padEnd(11)} ${String(r.by_class[c]).padStart(8)}  ${pct(r.by_class[c])}`);
  if (r.profile) lines.push(`The profile's ${r.profile.notes} notes: ${CLASSES.filter((c) => r.profile!.by_class[c]).map((c) => `${r.profile!.by_class[c]} ${c}`).join(", ")}.`);
  if (r.unbased.length) {
    lines.push(`Unbased, by where (${r.unbased.length} places; the ${Math.min(most, r.unbased.length)} largest):`);
    for (const u of r.unbased.slice(0, most)) lines.push(`  ${String(u.count).padStart(8)}  ${u.at}`);
  }
  return lines.join("\n");
}
