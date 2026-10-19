// The shared rules the generator calls (docs/design/rust-port.md 1.1): the Rust rules (kernel/src/rules_api.rs, served
// by the engine's native module), so nothing is written twice; the TS ones where the module is not built, or a test
// asks for them (OIKOS_TS_RULES) to hold the two equal. Each is held equal to its TS twin (orchestrator/test/rust-world.test.ts and
// contracts/test/law-drafts.json). A lane that ports a rule the generator uses adds it here and in rules_api.rs.

import { existsSync } from "node:fs";
import { join } from "node:path";
import * as ts from "@oikos/participants";

type Native = { rules(name: string, args: string): string };

/** The native module, shared with the host's loader (orchestrator/src/kernel.ts keeps it on the same global). */
function native(): Native | undefined {
  const g = globalThis as { __oikosNative?: Native };
  if (g.__oikosNative) return g.__oikosNative;
  const root = join(import.meta.dir, "../..");
  const path = process.env.OIKOS_ENGINE_MODULE ?? ["kernel/target/release", "kernel/target/debug"].flatMap((d) => ["liboikos_napi.dylib", "liboikos_napi.so"].map((f) => join(root, d, f))).find(existsSync);
  if (!path) return undefined;
  const m = { exports: {} as Native };
  process.dlopen(m, path);
  return (g.__oikosNative = m.exports);
}

// (Since the cut-over, 2026-10-19, the Rust rules whenever the engine's native module is built; the TS ones only where it is not, as for a
// checkout that has not built the kernel.)
const rust = (): Native | undefined => (process.env.OIKOS_TS_RULES ? undefined : native());
const call = <T>(n: Native, name: string, args: object): T => JSON.parse(n.rules(name, JSON.stringify(args)));
/** Without the absent parts (Rust writes them as null; TS leaves them out). */
const present = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined)) as T;

export const planLaw: typeof ts.planLaw = (p) => {
  const n = rust();
  return n ? present(call(n, "forms.plan_law", p)) : ts.planLaw(p);
};
export const planLawWords: typeof ts.planLawWords = (p) => {
  const n = rust();
  return n ? call(n, "forms.plan_law_words", p) : ts.planLawWords(p);
};
export const possessionOrderFor: typeof ts.possessionOrderFor = (law, months) => {
  const n = rust();
  return n ? call(n, "forms.possession_order_for", { law, plan_months: months }) : ts.possessionOrderFor(law, months);
};
export const draftLaw: typeof ts.draftLaw = (id, schedule, values) => {
  const n = rust();
  return n ? present(call(n, "law.draft", { schedule_id: id, schedule, values })) : ts.draftLaw(id, schedule, values);
};
