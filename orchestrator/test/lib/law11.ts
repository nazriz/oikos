// Law 11 in the code (docs/design/foundations-2.md 5.1, step N4): a number in the engine's behaviour code
// (`kernel/crates/actors`, `kernel/crates/rules`) or the generator is a convention (a unit, a count of days in a week, basis
// points), read from parameters, or declared once in a figure registry (`kernel/crates/actors/src/figures.rs`,
// `worlds/generator/registry.ts`) with its class and source. Today's literals are counted by file in
// `orchestrator/test/fixtures/code-figures-inventory.json`, which only shrinks (every-number-has-a-basis.test.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

export const CODE_INVENTORY = join(import.meta.dir, "../fixtures/code-figures-inventory.json");
/** Where the engine's behaviour and the generator are written. */
export const CODE_DIRS = ["kernel/crates/actors/src", "kernel/crates/rules/src", "worlds/generator"];
/** The registries: each figure once, with its class and source. */
export const REGISTRIES = ["kernel/crates/actors/src/figures.rs", "worlds/generator/registry.ts"];
/** Numbers that are conventions wherever they are written: small counts and indices, the units of time (a minute, an
 * hour, a day, a week, a month of thirty days, a year), basis points and their whole, percent, a thousand (milli). A
 * literal written as a product of these (`7 * DAY`) is these. Stated once, with their reason. */
export const CONVENTIONS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "12", "24", "30", "31", "52", "60", "100", "365", "366", "1000", "3600", "10000", "86400", "604800", "2592000", "31536000"]);
/** The registry's class words (law 11's classes). */
export const CLASSES = ["sourced", "to_confirm", "derived", "fitted", "placeholder", "convention"];

/** A source with its tests, comments and strings left out: only what the code computes with. A scanner, not a pattern:
 * a template's `${...}` is code and stays, a Rust lifetime (`'a`) is no string, and a string's text never counts. */
export function codeOf(text: string, rust: boolean): string {
  const t = rust ? text.split(/\n#\[cfg\(test\)\]/)[0]! : text;
  let out = "";
  // (What we are inside: a template's text, or the code of one of its `${`, with the braces counted.)
  const stack: ("tpl" | number)[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!, top = stack.at(-1);
    if (top === "tpl") {
      if (c === "\\") { i++; continue; }
      if (c === "`") { stack.pop(); out += " "; continue; }
      if (c === "$" && t[i + 1] === "{") { stack.push(0); i++; out += " "; continue; }
      continue;
    }
    if (c === "/" && t[i + 1] === "/") { while (i < t.length && t[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); i = e < 0 ? t.length : e + 1; out += " "; continue; }
    if (c === '"' || (c === "'" && (!rust || t[i + 2] === "'" || (t[i + 1] === "\\" && t.indexOf("'", i + 2) - i < 8)))) {
      for (i++; i < t.length && t[i] !== c && t[i] !== "\n"; i++) if (t[i] === "\\") i++;
      out += " ";
      continue;
    }
    if (!rust && c === "`") { stack.push("tpl"); out += " "; continue; }
    if (typeof top === "number") {
      if (c === "{") stack[stack.length - 1] = top + 1;
      else if (c === "}") { if (top === 0) { stack.pop(); out += " "; continue; } stack[stack.length - 1] = top - 1; }
    }
    out += c;
  }
  return out;
}

/** The literals in a source that are not conventions. */
export function literals(text: string, rust: boolean): string[] {
  const out: string[] = [];
  for (const m of codeOf(text, rust).matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?:_?(?:i64|u32|u64|i32|usize|f64|i128|u8|u16|n))?(?![\w.])/g)) {
    const n = m[1]!.replace(/_/g, "");
    if (!CONVENTIONS.has(n)) out.push(n);
  }
  return out;
}

/** Each file's count of literals that are not conventions (the registries apart). */
export function codeFigures(base: string, dirs = CODE_DIRS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dirs) {
    const dir = join(base, d);
    if (!existsSync(dir)) continue;
    for (const f of [...new Glob("**/*.{rs,ts}").scanSync(dir)].sort()) {
      const path = `${d}/${f}`;
      if (REGISTRIES.includes(path) || /(^|\/)(tests?)(\/|\.rs$)|\.test\.ts$/.test(f) || f === "figures.ts") continue;
      const n = literals(readFileSync(join(dir, f), "utf8"), f.endsWith(".rs")).length;
      if (n) out[path] = n;
    }
  }
  return out;
}

/** A registry's figures that say no class: each `const` (or exported const) must have, in the comment lines just above it,
 * one beginning with a class. */
export function unclassed(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:pub\s+)?(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)/);
    if (!m) return;
    const above: string[] = [];
    for (let j = i - 1; j >= 0 && /^\s*(\/\/|\/\*\*|\*)/.test(lines[j]!); j--) above.push(lines[j]!);
    if (!CLASSES.some((c) => new RegExp(`(///|/\\*\\*|//|\\*)\\s*${c}\\b`, "i").test(above.join(" ")))) out.push(m[1]!);
  });
  return out;
}
