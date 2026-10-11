// The behaviour modules' manifests (contracts/module.schema.json; docs/design/rebuild.md 5.2), written from the modules
// by participants/scripts/manifests.ts and kept in step by a test. A world is checked against them when it loads.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Manifest {
  name: string;
  version: string;
  doc: string;
  params: { [k: string]: { schema: { type?: string }; unit?: string; default?: unknown; required?: boolean; source: string } };
  perceives: object[];
  decisions?: string[];
  beliefs?: { name: string; about: string }[];
  state?: string;
  keeps?: { what: string; why: string }[];
  boundary?: { what: string; why: string }[];
  issues?: { form: string; title: string; fields: { [name: string]: { type: string; required?: boolean; options?: string[]; description: string } }; writes: { kind: string; text: string; [k: string]: unknown } }[];
  routines?: { task: string; what: string; at: string; papers?: { kind: string; how: string }[] }[];
  takes?: { form: string; title: string; fields: { [name: string]: { type: string; required?: boolean; options?: string[]; description: string } }; follows: string }[];
}

const DIR = join(import.meta.dir, "../manifests");
let loaded: Map<string, Manifest> | undefined;

/** Every built-in module's manifest, by name. */
export function manifests(): Map<string, Manifest> {
  loaded ??= new Map(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const m = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Manifest;
    return [m.name, m];
  }));
  return loaded;
}

const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);

/** What's wrong with the parameters a world gives a module, by its manifest: none if nothing (or no manifest). */
export function paramErrors(module: string, given: { [k: string]: unknown }): string[] {
  const m = manifests().get(module);
  if (!m) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(given)) {
    const p = m.params[k];
    if (!p) {
      out.push(`${module} takes no parameter "${k}"`);
      continue;
    }
    const want = p.schema.type;
    const got = typeOf(v);
    if (want && got !== want && !(want === "number" && got === "integer") && v !== null && v !== undefined) out.push(`${module}'s "${k}" is ${want === "integer" ? "a whole number" : `a${/^[aeiou]/.test(want) ? "n" : ""} ${want}`}, not ${JSON.stringify(v).slice(0, 60)}`);
  }
  return out;
}
