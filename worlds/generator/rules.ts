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

/** Whether the Rust rules are in use (the module is built and nothing asks for the TypeScript ones). */
export const rustRulesInUse = (): boolean => rust() !== undefined;

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

// Tax on pay, the payments, and the household draws (MT-18, 2026-10-23): the Rust rules whenever the module is built.
const memo = new Map<string, number>();
export const withholding: typeof ts.withholding = (law, gross, period) => {
  const n = rust();
  if (!n) return ts.withholding(law, gross, period);
  if (!law || gross <= 0 || period <= 0) return 0;
  const key = `${(law as { id?: string }).id}|${law.charges.length}|${gross}|${period}`;
  let v = memo.get(key);
  if (v === undefined) memo.set(key, (v = call<number>(n, "withholding.withholding", { law, gross, period })));
  return v;
};
export const dayPayPeriod: typeof ts.dayPayPeriod = (days) => {
  const n = rust();
  return n ? call<number>(n, "withholding.day_pay_period", { work_days: days }) : ts.dayPayPeriod(days);
};
export const declarationFor: typeof ts.declarationFor = (rule, facts) => {
  const n = rust();
  return n ? (call<object | null>(n, "support.declaration_for", { rule, facts }) ?? undefined) as ReturnType<typeof ts.declarationFor> : ts.declarationFor(rule, facts);
};
export const forAge: typeof ts.forAge = (r) => {
  const n = rust();
  return n ? call<boolean>(n, "support.for_age", { rule: r }) : ts.forAge(r);
};
export const forOutOfWork: typeof ts.forOutOfWork = (r) => {
  const n = rust();
  return n ? call<boolean>(n, "support.for_out_of_work", { rule: r }) : ts.forOutOfWork(r);
};
export const stopsWorkAt: typeof ts.stopsWorkAt = (curve, draw) => {
  const n = rust();
  return n ? (call<number | null>(n, "support.stops_work_at", { curve, draw }) ?? undefined) : ts.stopsWorkAt(curve, draw);
};
export const bedroomsNeeded: typeof ts.bedroomsNeeded = (h, t, year, standard) => {
  const n = rust();
  return n ? call<number>(n, "household.bedrooms_needed", { household: h, t, year, standard: standard ?? null }) : ts.bedroomsNeeded(h, t, year, standard);
};
export const drawSavings: typeof ts.drawSavings = (pct, q) => {
  const n = rust();
  return n ? call<number>(n, "household.draw_savings", { pct, q }) : ts.drawSavings(pct, q);
};
/** The town's households (and the adults' age bands where the spec has none), drawn on the generator's keyed streams. */
export function drawTown(spec: ts.HouseholdSpec, seed: bigint, citizens: number, below: (stream: string) => (n: number) => number): { adult_age_bands: ts.HouseholdSpec["adult_age_bands"]; households: ReturnType<typeof ts.drawHousehold>[] } {
  const n = rust();
  if (n) {
    const r = call<{ adult_age_bands: ts.HouseholdSpec["adult_age_bands"] | null; households: ReturnType<typeof ts.drawHousehold>[] }>(n, "household.town", { spec, seed: Number(seed), citizens });
    return { adult_age_bands: r.adult_age_bands ?? undefined, households: r.households.map((d) => ({ ...d, extended: d.extended ?? undefined })) };
  }
  let H = spec, bands: ts.HouseholdSpec["adult_age_bands"];
  if (!H.adult_age_bands) { const ar = below("age-bands"); bands = ts.adultAgeBands(H, (k) => ar(k)); H = { ...H, adult_age_bands: bands }; }
  const hr = below("households"), out: ReturnType<typeof ts.drawHousehold>[] = [];
  for (let count = 0; count < citizens; ) { const d = ts.drawHousehold(H, (k) => hr(k)); count += d.members.length; out.push(d); }
  return { adult_age_bands: bands, households: out };
}

// The words of the laws (MT-18, 2026-10-24): written once, in Rust (`words.*`), with the town's currency and the names of
// whom each account is paid to served as data, not as a closure; no TypeScript copy is left. They need the engine's module.
const words = (name: string, args: object): string => {
  const n = native(); // (the engine's whatever OIKOS_TS_RULES says: there is no other copy)
  if (!n) throw new Error(`the law's words are written by the engine (rule ${name}): build the kernel (bun run kernel), or set OIKOS_ENGINE_MODULE`);
  return call<string>(n, name, args);
};
type Currency = Parameters<typeof ts.formatMoney>[1];
export const chargesInWords = (charges: ts.Charge[], currency: Currency, payees: Record<string, string> = {}): string => words("words.charges", { charges, currency, payees });
export const withholdingInWords = (o: { period_days: number; work_days?: number }): string => words("words.withholding", { period_days: o.period_days, work_days: o.work_days ?? null });
export const returnsInWords = (law: ts.IncomeTaxLaw): string => words("words.returns", { law });
export const paymentsInWords = (payments: ts.PaymentRule[], currency: Currency, payees: Record<string, string> = {}): string => words("words.payments", { payments, currency, payees });
export const decisionsInWords = (rules: ts.DecisionLaw[], currency: Currency): string => words("words.decisions", { rules, currency });
export const linesInWords = (lines: Record<string, number>, currency: Currency): string => words("words.lines", { lines: Object.entries(lines), currency });
