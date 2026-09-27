// Reading the formal part of statements (laws, procedures): a CEL condition,
// integers only, allowlisted functions (D27; docs/research/cel-check). Used by
// code-run institutions (a planning officer checking an application, an
// inspector judging a site) and by measurement. Never by the kernel: a law's
// formal condition has no power; an institution chooses to apply it.

import { celEnv, celFunc, CelScalar, isCelError, parse, plan } from "@bufbuild/cel";
import type { Record } from "./contracts";

const OPERATORS = new Set([
  "_&&_", "_||_", "!_", "_==_", "_!=_", "_<_", "_<=_", "_>_", "_>=_", "_+_", "_-_", "_*_", "_/_", "_%_", "-_", "_?_:_", "_[_]", "@in", "@not_strictly_false",
  "size", "int", "string", "startsWith", "endsWith", "contains",
  "has", "all", "exists", "exists_one", "map", "filter",
]);
const CUSTOM = new Set(["holds_liberty", "holds_right"]);

/** Why a condition may not be used, or [] if it may. */
export function violations(expr: string): string[] {
  const out: string[] = [];
  const walk = (x: any) => {
    if (x === null || typeof x !== "object") return;
    if (x.$typeName === "cel.expr.Constant" && ["doubleValue", "uint64Value", "bytesValue"].includes(x.constantKind?.case)) out.push(`literal ${x.constantKind.case}`);
    if (x.$typeName === "cel.expr.Expr.Call" && !OPERATORS.has(x.function) && !CUSTOM.has(x.function)) out.push(`function ${x.function}`);
    for (const v of Object.values(x)) Array.isArray(v) ? v.forEach(walk) : walk(v);
  };
  walk(parse(expr));
  return out;
}

const toCel = (v: any): any =>
  typeof v === "number" ? BigInt(v) : Array.isArray(v) ? v.map(toCel) : v && typeof v === "object" ? new Map(Object.entries(v).map(([k, x]) => [k, toCel(x)])) : v;

/** Claims as someone reading the registry understands them: recorded, and not released or withdrawn. */
export function standingClaims(records: Iterable<Record>): Extract<Record, { record: "claim" }>[] {
  const all = [...records];
  const gone = new Set(all.flatMap((r) => (r.record === "claim_release" ? [r.claim] : r.record === "withdrawal" ? [r.withdraws] : [])));
  return all.filter((r): r is Extract<Record, { record: "claim" }> => r.record === "claim" && !gone.has(r.id));
}

export type Verdict = { value: boolean } | { error: string };

/**
 * Evaluate a formal condition against an act (as a block-shaped object), the
 * acting entity, and the claims the reader knows of. True means "this act
 * matches the condition" (for a prohibition: it would be a breach).
 */
export function evaluate(condition: string, vars: { block: object; actor: string; now: number }, claims: Extract<Record, { record: "claim" }>[]): Verdict {
  const bad = violations(condition);
  if (bad.length) return { error: `condition not allowed: ${bad.join(", ")}` };
  // holds_liberty(who, action, object): a standing claim of that position, to that action, about that object (a lot, a building, ...).
  const has = (position: string) => (who: string, action: string, object: string) =>
    claims.some((c) => c.position === position && c.holder === who && c.about?.action === action && c.about?.object === object);
  const env = celEnv({
    funcs: [
      celFunc("holds_liberty", [CelScalar.STRING, CelScalar.STRING, CelScalar.STRING], CelScalar.BOOL, has("liberty")),
      celFunc("holds_right", [CelScalar.STRING, CelScalar.STRING, CelScalar.STRING], CelScalar.BOOL, has("right")),
    ],
  });
  const r = plan(env, parse(condition))({ block: toCel(vars.block), actor: vars.actor, now: BigInt(vars.now) });
  if (isCelError(r)) return { error: String((r as any).message ?? r) };
  return typeof r === "boolean" ? { value: r } : { error: "condition did not produce true or false" };
}
