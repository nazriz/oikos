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
// Counting only: nothing here refuses a world or changes a run. The kernel's refusal of an unbased figure is step N3,
// when the figure table goes into the config itself; until then the report is written beside a batch's runs
// (figures.txt, figures.json) and by `oikos figures <world>`, never into the log, so a run's log is byte for byte what
// it was.

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
    const param = out.at(-1) === "params";
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
function paramsAt(config: any, path: string[]): { module: string; param: string } | undefined {
  const [top, i, ...rest] = path;
  const item = top !== undefined && i !== undefined ? config[top]?.[Number(i)] : undefined;
  if (!item) return undefined;
  const at = (holder: any, n: number) => {
    const module = holder?.code ?? holder?.impl;
    return typeof module === "string" && rest[n] === "params" && rest[n + 1] ? { module, param: rest[n + 1]! } : undefined;
  };
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
  // The generator's table: patterns over the config's paths (first match).
  const sh = shape(p, config);
  const pa = paramsAt(config, p);
  for (const [row, b] of table.entries()) {
    if (b.module && b.module !== pa?.module) continue;
    if (!matches(b.at, sh)) continue;
    if (b.profile && profile) {
      const note = sourceFor(profile.sources, b.profile);
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
      const given = valueAt(config, p.slice(0, p.indexOf("params") + 2));
      if (JSON.stringify(given) === JSON.stringify(m.default)) return { class: classify(m.source), why: `manifest ${pa.module}.${pa.param}` };
    }
  }
  return { class: "unbased", why: "nothing says" };
}

const valueAt = (v: any, path: string[]) => path.reduce((x, k) => x?.[k], v);

/** Does a pattern (dotted, `*` for one segment, `**` for any number) match a path's shape? */
export function matches(pattern: string, sh: string): boolean {
  const re = new RegExp(`^${pattern.split(".").map((s) => (s === "**" ? "(?:[^.]+(?:\\.[^.]+)*)?" : s === "*" ? "[^.]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.")}$`);
  // (A pattern covers everything under it, as a profile's source key does.)
  return re.test(sh) || sh.startsWith(`${pattern}.`) || (pattern.includes("*") && [...sh.matchAll(/\./g)].some((m) => re.test(sh.slice(0, m.index))));
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
