// Can @bufbuild/cel evaluate Oikos's `formal` conditions under our rules:
// integers only (exact, overflow is an error), custom functions, a static
// allowlist, determinism, and failing safely on bad input?
import { expect, test } from "bun:test";
import { parse, plan, celEnv, celFunc, CelScalar, isCelError } from "@bufbuild/cel";

// ---- static restriction: allowlist of functions, no decimals/uints ----
const OPERATORS = new Set(["_&&_", "_||_", "!_", "_==_", "_!=_", "_<_", "_<=_", "_>_", "_>=_", "_+_", "_-_", "_*_", "_/_", "_%_", "-_", "_?_:_", "_[_]", "@in", "@not_strictly_false", "size", "int", "string",
  // Macros: bounded by the size of the list or map they range over.
  "has", "all", "exists", "exists_one", "map", "filter"]);
const CUSTOM = new Set(["holds_liberty", "min_int"]);
function violations(expr: string): string[] {
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

// ---- inputs: every JSON number becomes an exact CEL int ----
const toCel = (v: any): any =>
  typeof v === "number" ? BigInt(v) : Array.isArray(v) ? v.map(toCel) : v && typeof v === "object" ? new Map(Object.entries(v).map(([k, x]) => [k, toCel(x)])) : v;

type Claim = { position: string; holder: string; about: { action: string; parcel: string } };
function envFor(claims: Claim[]) {
  return celEnv({
    funcs: [
      celFunc("holds_liberty", [CelScalar.STRING, CelScalar.STRING, CelScalar.STRING], CelScalar.BOOL, (who, action, parcel) =>
        claims.some((c) => c.position === "liberty" && c.holder === who && c.about.action === action && c.about.parcel === parcel)),
      celFunc("min_int", [CelScalar.INT, CelScalar.INT], CelScalar.INT, (a, b) => (a < b ? a : b)),
    ],
  });
}
function evaluate(expr: string, vars: Record<string, unknown>, claims: Claim[] = []) {
  const v = violations(expr);
  if (v.length) return { rejected: v };
  const r = plan(envFor(claims), parse(expr))(Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, toCel(x)])));
  return isCelError(r) ? { error: String(r.message ?? r) } : { value: r };
}

const RIVER = "block.parcel in ['p10','p11','p12'] && !holds_liberty(actor, 'build', block.parcel)";

test("the river law's formal condition", () => {
  const permit: Claim = { position: "liberty", holder: "devco", about: { action: "build", parcel: "p12" } };
  expect(evaluate(RIVER, { actor: "devco", block: { parcel: "p12" } })).toEqual({ value: true });            // no permit: breaks the law
  expect(evaluate(RIVER, { actor: "devco", block: { parcel: "p12" } }, [permit])).toEqual({ value: false }); // permit held
  expect(evaluate(RIVER, { actor: "devco", block: { parcel: "p00" } })).toEqual({ value: false });          // not the river
});

test("rent cap over agreement commitments (comprehension macro)", () => {
  const expr = "agreement.commitments.exists(c, c.pay * 2592000 > 160000 * c.every * agreement.units)";
  expect(evaluate(expr, { agreement: { units: 2, commitments: [{ pay: 320000, every: 2592000 }] } })).toEqual({ value: false });
  expect(evaluate(expr, { agreement: { units: 2, commitments: [{ pay: 320001, every: 2592000 }] } })).toEqual({ value: true });
});

test("integer arithmetic is exact; overflow and division by zero are errors, not wrong answers", () => {
  expect(evaluate("7 / 2 == 3 && -7 / 2 == -3 && 7 % 2 == 1", {})).toEqual({ value: true });
  expect(evaluate("x * 3", { x: 9007199254740991 })).toEqual({ value: 27021597764222973n });
  expect(evaluate("9223372036854775807 + 1", {})).toHaveProperty("error");
  expect(evaluate("x / 0", { x: 5 })).toHaveProperty("error");
  expect(evaluate("min_int(a, b)", { a: 4, b: -2 })).toEqual({ value: -2n });
});

test("static restrictions reject decimals and non-allowlisted functions", () => {
  expect(evaluate("x > 1.5", { x: 1 })).toEqual({ rejected: ["literal doubleValue"] });
  expect(evaluate("double(x) < 3", { x: 1 })).toHaveProperty("rejected");
  expect(evaluate("timestamp('2026-01-01T00:00:00Z') < now", {})).toHaveProperty("rejected");
  expect(evaluate("name.matches('a.*')", { name: "a" })).toHaveProperty("rejected");
  expect(evaluate("x > 1u", { x: 1 })).toHaveProperty("rejected");
  expect(violations(RIVER)).toEqual([]);
});

test("missing data fails safely (an error, never a guess)", () => {
  expect(evaluate("block.parcel == 'p1'", { block: {} })).toHaveProperty("error");
  expect(evaluate("nope > 1", {})).toHaveProperty("error");
});

test("deterministic, and fast enough", () => {
  const vars = { actor: "devco", block: { parcel: "p12" } };
  const run = plan(envFor([]), parse(RIVER));
  const input = Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, toCel(x)]));
  const t0 = performance.now();
  const results = new Set<unknown>();
  for (let i = 0; i < 100_000; i++) results.add(run(input));
  const ms = performance.now() - t0;
  console.log(`100k evaluations: ${ms.toFixed(0)} ms (${((ms * 1000) / 100_000).toFixed(2)} µs each)`);
  expect([...results]).toEqual([true]);
  // Map-keyed comprehensions give the same answer regardless of insertion order.
  expect(evaluate("m.all(k, m[k] > 0)", { m: { a: 1, b: 2 } })).toEqual(evaluate("m.all(k, m[k] > 0)", { m: { b: 2, a: 1 } }));
});
