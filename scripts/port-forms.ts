// Writes the forms catalogue the Rust rules crate reads (kernel/crates/rules/forms/papers.json; docs/port-guide.md,
// step 1b) from participants/src/behaviour/papers.ts: every exported form (an `Issued`, or a list of them), by its
// export's name, in the order the file has them. Until the cut-over the TS file is the source and
// participants/test/port-forms.test.ts holds the two equal; after it, the JSON is the source and this script goes.
//
//   bun scripts/port-forms.ts           write it
//   bun scripts/port-forms.ts --check   exit 1 if it would change

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as P from "../participants/src/behaviour/papers";

export const OUT = join(import.meta.dir, "../kernel/crates/rules/forms/papers.json");

const isForm = (x: unknown): boolean => !!x && typeof x === "object" && !Array.isArray(x) && typeof (x as { form?: unknown }).form === "string" && "writes" in (x as object);

export function catalogue(): string {
  const out: { [name: string]: unknown } = {};
  for (const [name, v] of Object.entries(P)) {
    if (typeof v === "function") continue;
    if (isForm(v) || (Array.isArray(v) && v.length && v.every(isForm))) out[name] = v;
  }
  return JSON.stringify(out, null, 1) + "\n";
}

if (import.meta.main) {
  const text = catalogue();
  if (process.argv.includes("--check")) {
    const had = (() => { try { return readFileSync(OUT, "utf8"); } catch { return ""; } })();
    if (had !== text) { console.error(`${OUT} is out of date: bun scripts/port-forms.ts`); process.exit(1); }
  } else writeFileSync(OUT, text);
}
