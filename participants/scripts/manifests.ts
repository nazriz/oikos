// Writes each built-in behaviour module's manifest (contracts/module.schema.json; docs/design/rebuild.md 5.2) to
// participants/manifests/<name>.json, from the module itself: its parameters as it declares them (their defaults, as
// its `params` call has them, and what it reads of its parameters directly), each figure's source from the comment
// beside it (or "placeholder"), what the world must give (`need`), the decisions it records and the beliefs it keeps.
//
//   bun participants/scripts/manifests.ts          write them
//   bun participants/scripts/manifests.ts --check  exit 1 if any would change (the test runs this)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { modules } from "../src/index";
import { onParams, type ParticipantContext } from "../src/module";
import { Randomness } from "../src/rng";

const OUT = join(import.meta.dir, "../manifests");

/** A module's parameters as it's created: its declared defaults, and the keys it reads directly. */
function seen(name: string): { defaults: { [k: string]: unknown }; read: Set<string> } {
  const m = modules[name]!;
  const defaults: { [k: string]: unknown } = {};
  const read = new Set<string>();
  const params = new Proxy({} as { [k: string]: unknown }, { get: (_, k) => (typeof k === "string" && k !== "then" && k !== "toJSON" ? (read.add(k), undefined) : undefined), ownKeys: () => [], getOwnPropertyDescriptor: () => undefined });
  const ctx: ParticipantContext = { participant: "p", entity: "e", rng: (purpose) => new Randomness(1n).stream(["manifest", purpose]), world: { tickSeconds: 3600, runEnd: 365 * 86_400, currency: { code: "XXX", minor_units: 0 } }, params }; // (no world here: "XXX" is ISO 4217's code for no currency)
  onParams((d) => Object.assign(defaults, d));
  try {
    m.create(ctx);
  } catch {
    // (A module that needs what the world must give stops there; what it declared before is enough.)
  } finally {
    onParams(undefined);
  }
  return { defaults, read };
}

/** The part of a module's source file that's this module: from its `name:` to the next module's. */
function sourceOf(name: string): string {
  const src = readFileSync(modules[name]!.source, "utf8");
  const at = src.indexOf(`name: "${name}"`);
  if (at < 0) return "";
  const next = src.indexOf("\n  name: \"", at + 10);
  return src.slice(at, next < 0 ? undefined : next);
}

/** The comment beside each parameter's default: `key: value, // comment`. */
function comments(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of src.split("\n")) {
    const m = /^\s+([a-z_][a-z0-9_]*): .*?,?\s*\/\/\s*(.+)$/.exec(line);
    if (m && !out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** What the module reads directly with a default: `ctx.params.key ?? literal`. */
function directDefaults(src: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const m of src.matchAll(/ctx\.params\.([a-z_][a-z0-9_]*)\)?\s*(?:as [^?]+)?\?\?\s*([^,;)\n]+)/g)) {
    try {
      out.set(m[1]!, JSON.parse(m[2]!.trim().replace(/_/g, "")));
    } catch {
      /* not a literal */
    }
  }
  return out;
}

/** Whether a comment says where a figure comes from (a survey, a law, a year, the world's profile), not only what it is. */
const SOURCED = /placeholder|profile|\b(1[89]|20)\d\d\b|\bAct\b|survey|census|statistic|BoE|ABS|ARLA|RBA|OECD|et al|the world gives|the world must/i;

function schemaOf(v: unknown): object {
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "string") return { type: "string" };
  if (typeof v === "boolean") return { type: "boolean" };
  if (Array.isArray(v)) return { type: "array" };
  if (v && typeof v === "object") return { type: "object" };
  return {};
}

function unitOf(key: string): string | undefined {
  for (const [suffix, unit] of [["_bps", "bps"], ["_days", "days"], ["_months", "months"], ["_seconds", "seconds"], ["_hours", "hours"], ["_years", "years"], ["_cents", "cents"]] as const)
    if (key.endsWith(suffix)) return unit;
  return undefined;
}

export function manifest(name: string): object {
  const m = modules[name]!;
  const src = sourceOf(name);
  const { defaults, read } = seen(name);
  const notes = comments(src);
  const direct = directDefaults(src);
  const required = new Set([...src.matchAll(/need\([a-z]+, \[([^\]]*)\]/g)].flatMap((x) => [...x[1]!.matchAll(/"([^"]+)"/g)].map((y) => y[1]!)));
  // (And what it reads of its parameters as it goes: `p.<name>`, the module's parameters by convention.)
  const used = new Set([...src.matchAll(/\bp\.([a-z_][a-z0-9_]*)/g)].map((x) => x[1]!));
  const keys = [...new Set([...Object.keys(defaults), ...read, ...used])].filter((k) => k in defaults || read.has(k) || used.has(k)).sort();
  const params = Object.fromEntries(keys.map((k) => {
    const d = k in defaults ? defaults[k] : direct.get(k);
    const unit = unitOf(k);
    const note = notes.get(k);
    return [k, {
      schema: { ...schemaOf(d), ...(note ? { description: note } : {}) },
      ...(unit ? { unit } : {}),
      ...(d !== undefined ? { default: d } : {}),
      ...(required.has(k) ? { required: true } : {}),
      source: note && SOURCED.test(note) && !/^placeholder$/i.test(note) ? note : d === undefined ? "the world gives it (no default)" : "placeholder",
    }];
  }));
  const decisions = [...new Set([...src.matchAll(/decide\("([a-z_]+)"/g)].map((x) => x[1]!))].sort();
  const beliefs = [...new Set([...src.matchAll(/of: "(agreement|between|held)"/g)].map((x) => x[1]!))];
  return {
    name, version: m.version, doc: m.doc, params,
    perceives: [],
    ...(decisions.length ? { decisions } : {}),
    ...(beliefs.length ? { beliefs: beliefs.map((b) => ({ name: b, about: "agreement" })) } : {}),
    state: "none",
    ...(m.keeps?.length ? { keeps: m.keeps } : {}),
    ...(m.boundary?.length ? { boundary: m.boundary } : {}),
    ...(m.takes?.length ? { takes: m.takes } : {}),
    ...(m.issues?.length ? { issues: m.issues } : {}),
    ...(m.routines?.length ? { routines: m.routines } : {}),
  };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  mkdirSync(OUT, { recursive: true });
  let stale = 0;
  // (Every module but the do-nothing stand-in tests use, `idle`: it takes no parameters and isn't a behaviour.)
  // (A kind whose TypeScript actor was deleted at the cut-over (participants/src/engine-kinds.ts) has its manifest as it was written last,
  // from that actor: the engine's kind compiles it in (kernel/crates/actors) and owns it now. Nothing here writes it.)
  for (const name of Object.keys(modules).filter((n) => n.includes(".") && !modules[n]!.source.endsWith("/engine-kinds.ts")).sort()) {
    const path = join(OUT, `${name}.json`);
    const text = JSON.stringify(manifest(name), null, 2) + "\n";
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
        console.log(`stale: ${path}`);
        stale++;
      }
    } else writeFileSync(path, text);
  }
  if (check && stale) process.exit(1);
  if (!check) console.log(`wrote the manifests to ${OUT}`);
}
