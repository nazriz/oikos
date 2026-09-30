// Reading the formal part of statements (laws, procedures): a CEL condition,
// integers only, allowlisted functions (D27; docs/research/cel-check). Used by
// code-run institutions (a planning officer checking an application, an
// inspector judging a site) and by measurement. Never by the kernel: a law's
// formal condition has no power; an institution chooses to apply it.
//
// The reader is Rust (kernel/crates/law), built to WebAssembly and loaded here
// synchronously (`bun run kernel` builds it). TERRARIUM_LAW=ts reads with
// @bufbuild/cel instead, and =shadow reads both ways and compares (under test,
// a difference is an error), while the Rust reader is checked against it.

import { celEnv, celFunc, CelScalar, isCelError, parse, plan } from "@bufbuild/cel";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Record } from "./contracts";

const LAW_MODE = (process.env.TERRARIUM_LAW ?? "engine") as "engine" | "ts" | "shadow";
const CRATE = join(import.meta.dir, "../../kernel/crates/law");
const MODULE = process.env.TERRARIUM_LAW_MODULE ?? join(import.meta.dir, "../../kernel/target/wasm32-unknown-unknown/release/terrarium_law.wasm");

/** The crate's source fingerprint, as its build.rs computes it: FNV-1a over each file's path and bytes, in path order. */
function sourceFingerprint(): string | undefined {
  if (!existsSync(join(CRATE, "src"))) return undefined;
  const files = ["Cargo.toml", "build.rs", ...readdirSync(join(CRATE, "src")).map((f) => `src/${f}`)].sort();
  let h = 0xcbf29ce484222325n;
  for (const f of files) for (const b of [...new TextEncoder().encode(f), ...readFileSync(join(CRATE, f))]) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}

type Wasm = { memory: WebAssembly.Memory; law_alloc(n: number): number; law_free(p: number, n: number): void; law_call(p: number, n: number): bigint };
let wasm: Wasm | undefined;

/** One call to the Rust reader (a JSON question, a JSON answer). A trap (the parser panicking on malformed input) is an
 * error answer, and the next call starts a fresh instance. */
function rust(q: object): any {
  if (!wasm) {
    if (!existsSync(MODULE)) throw new Error(`the law reader isn't built (${MODULE}): run \`bun run kernel\``);
    wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(MODULE))).exports as unknown as Wasm;
    const theirs = sourceFingerprint();
    const built = rust({ op: "source" }).source;
    if (theirs && built !== theirs) {
      wasm = undefined;
      throw new Error(`the law reader at ${MODULE} was built from other sources than kernel/crates/law: run \`bun run kernel\``);
    }
  }
  const w = wasm;
  const input = new TextEncoder().encode(JSON.stringify(q));
  const p = w.law_alloc(input.length);
  new Uint8Array(w.memory.buffer, p, input.length).set(input);
  let packed: bigint;
  try {
    packed = w.law_call(p, input.length);
  } catch (e) {
    wasm = undefined;
    return { error: `parse: ${(e as Error).message}` };
  }
  const [op, on] = [Number(packed >> 32n), Number(packed & 0xffffffffn)];
  const out = JSON.parse(new TextDecoder().decode(new Uint8Array(w.memory.buffer, op, on)));
  w.law_free(op, on);
  w.law_free(p, input.length);
  return out;
}

/** Law reads compared both ways (TERRARIUM_LAW=shadow), and where they differed. */
export const lawShadow = { checked: 0, differed: 0, last: [] as { condition: string; ts: string; rust: string }[] };

const OPERATORS = new Set([
  "_&&_", "_||_", "!_", "_==_", "_!=_", "_<_", "_<=_", "_>_", "_>=_", "_+_", "_-_", "_*_", "_/_", "_%_", "-_", "_?_:_", "_[_]", "@in", "@not_strictly_false",
  "size", "int", "string", "startsWith", "endsWith", "contains",
  "has", "all", "exists", "exists_one", "map", "filter",
]);
const CUSTOM = new Set(["holds_liberty", "holds_right"]);

/** Why a condition may not be used, or [] if it may (a condition that can't be parsed says so). */
export function violations(expr: string): string[] {
  if (LAW_MODE === "ts") return violationsTs(expr);
  const r = rust({ op: "violations", condition: expr });
  return r.violations ?? [r.error];
}

function violationsTs(expr: string): string[] {
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
  if (LAW_MODE === "ts") return evaluateTs(condition, vars, claims);
  const r = rust({ op: "evaluate", condition, block: vars.block, actor: vars.actor, now: vars.now, claims: claims.map((c) => ({ position: c.position, holder: c.holder, about: c.about })) });
  const byRust: Verdict = "value" in r ? { value: r.value } : { error: String(r.error) };
  if (LAW_MODE === "shadow") {
    let byTs: Verdict;
    try {
      byTs = evaluateTs(condition, vars, claims);
    } catch (e) {
      byTs = { error: String((e as Error).message) };
    }
    lawShadow.checked++;
    // (Errors are compared as errors: the two readers word them differently.)
    const [a, b] = ["value" in byTs ? `value ${byTs.value}` : "error", "value" in byRust ? `value ${byRust.value}` : "error"];
    if (a !== b) {
      lawShadow.differed++;
      lawShadow.last.push({ condition, ts: "value" in byTs ? a : byTs.error, rust: "value" in byRust ? b : byRust.error });
      if (lawShadow.last.length > 50) lawShadow.last.shift();
      if (process.env.NODE_ENV === "test") throw new Error(`the Rust law reader differs on ${condition}\n  of ${JSON.stringify(vars).slice(0, 600)}\n  here: ${JSON.stringify(byTs)}\n  Rust: ${JSON.stringify(byRust)}`);
    }
  }
  return byRust;
}

function evaluateTs(condition: string, vars: { block: object; actor: string; now: number }, claims: Extract<Record, { record: "claim" }>[]): Verdict {
  const bad = violationsTs(condition);
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
