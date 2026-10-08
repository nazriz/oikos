// Guardrails for a general platform (docs/profiles.md). The platform's code is the same for every place and time:
// every place-specific figure lives in a profile (worlds/profiles/), with its source. These tests keep it that way.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";

const root = join(import.meta.dir, "../..");

/** The platform's code: everything that runs, for any world. (Docs, profiles, example worlds, laws and tests are content.) */
const CODE = ["kernel/src", "kernel/crates", "participants/src", "orchestrator/src", "translator/src", "measure/src", "measure/queries", "worlds/generator", "contracts"];
const SKIP = [/node_modules/, /\/examples\//, /\.test\.ts$/, /\/tests?\//, /\/target\//, /\.md$/];

/**
 * Names that belong to one place: its statistics offices, agencies, laws, payments and currency. Seen in platform code,
 * they mean a place's figures or rules have been built in instead of coming from a profile or a world's content.
 */
const PLACE_SPECIFIC = /\b(ABS|AIHW|AIFS|ASFA|ASIC|APRA|RBA|ATO|VAGO|REIV|DSS|Centrelink|Services Australia|Fair Work|Safe Work|Homes Victoria|Australian?|Victorian?|Melbourne|Sydney|Commonwealth|JobSeeker|Age Pension|AUD)\b/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.some((r) => r.test(p))) continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|rs|sql|json)$/.test(name)) out.push(p);
  }
  return out;
}

test("platform code names no place: its figures and rules come from profiles and world content", () => {
  const found: string[] = [];
  for (const dir of CODE) for (const f of files(join(root, dir))) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const m = PLACE_SPECIFIC.exec(line);
      if (m) found.push(`${relative(root, f)}:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 120)}`);
    });
  }
  expect(found).toEqual([]);
});

// ---- no currency in the code: a world's money is written as its config says (world.currencies: its sign, its words,
// its decimal places), so the code that runs for any world writes no currency's sign and none of its words.

/** Where the rule holds: what resolves, words and measures a world. (The generator and the contracts' own documents
 * are covered by the rule above; a profile is where a currency belongs.) */
const MONEY_CODE = ["kernel/src", "kernel/crates", "participants/src", "translator/src", "orchestrator/src", "measure/src", "measure/queries", "measure/probe.ts"];

/** A currency's sign, written as money: before a digit, before a value set into a text, escaped in a pattern, or alone
 * as a text. (In Rust, also before a value set into a format string.) */
const SIGN = [/\$(?=[0-9])/, /\$\$\{/, /(?<!\\)\\\$/, /["'`]\$["'`]/];
const SIGN_RS = [...SIGN, /\$\{/];
/** A currency's words, anywhere: in what's written, in a name, in a comment. */
const UNIT_WORD = /dollar|\bbucks?\b/i;
/** The word for a currency's smallest unit, in a text the code writes or matches (see the exemptions for the rest). */
const MINOR_WORD = /\bcents?\b/i;

/**
 * What the rule leaves alone, each for a reason:
 * - the block language's own reference sign: a block names something made earlier in the same action as `$name`
 *   (contracts/blocks.schema.json), which is no currency's;
 * - a pattern's replacement naming what it matched (`"$1"`);
 * - what a model run costs whoever runs it: providers bill in US dollars, and that's the operator's money, not the
 *   world's (spending limits, the cost report);
 * - the translator's prompt, whose worked examples are written in one currency (translator/src/index.ts): to fix, by
 *   writing them in the world's (held while the prompt is being changed and a model trained on it);
 * - Rust's unit tests, which sit in the files they test (everything from `#[cfg(test)]` on);
 * - the name `cents` for an amount in the smallest unit (money.ts `cents()`, and variables and comments that follow
 *   it): a name the code uses for "the smallest unit" whatever the currency, about 160 lines across every module.
 *   The rule reads the word only in texts the code writes or matches, where it would reach a world.
 */
const EXEMPT: { file: RegExp; line: RegExp }[] = [
  { file: /^kernel\/crates\/(world|resolver)\/src\/|^translator\/src\/(resolver|preview)\.ts$/, line: /(starts_with|strip_prefix|startsWith)\((["'])\$\2\)|`\$\$\{(ref|v\.var|b\.ref)\}`|format!\("\$\{\w+\}( is (not bound|bound twice)[^"]*)?"\)/ },
  { file: /./, line: /"\$[1-9] ?"\)/ },
  { file: /^orchestrator\/src\/(cost|batch|models|cli)\.ts$|^participants\/src\/llm\/call\.ts$/, line: /usd|budget|spending limit|model calls/i },
  { file: /^translator\/src\/index\.ts$/, line: /^\s*" .* -> {2}\w+\(/ },
];

/** The texts a line of code writes or matches (its quoted parts, and those inside the values set into them, without
 * the values themselves); nothing of a comment. */
function texts(line: string): string {
  if (/^\s*(\/\/|\/?\*)/.test(line)) return "";
  const out: string[] = [];
  // Code from `i` to the end of the line, or to the brace that closes a value set into a text: returns where it stopped.
  const code = (i: number, inValue: boolean): number => {
    for (let depth = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === "/" && line[i + 1] === "/" && !inValue) return line.length;
      if (c === "{") depth++;
      else if (c === "}") { if (inValue && depth === 0) return i; depth--; }
      else if (c === '"' || c === "'" || c === "`") i = text(i + 1, c);
    }
    return i;
  };
  // A text from `i` to its closing quote: returns where that is.
  const text = (i: number, quote: string): number => {
    let s = "";
    for (; i < line.length && line[i] !== quote; i++) {
      if (line[i] === "\\") s += line[++i] ?? "";
      else if (quote === "`" && line[i] === "$" && line[i + 1] === "{") { i = code(i + 2, true); s += " "; }
      else s += line[i];
    }
    out.push(s);
    return i;
  };
  code(0, false);
  return out.join("\n");
}

/** What of a currency a line of platform code holds, if anything. */
function currencyIn(file: string, line: string): string | undefined {
  if (EXEMPT.some((e) => e.file.test(file) && e.line.test(line))) return undefined;
  if ((file.endsWith(".rs") ? SIGN_RS : SIGN).some((r) => r.test(line))) return "a currency's sign";
  if (UNIT_WORD.test(line)) return "a currency's word";
  if (MINOR_WORD.test(texts(line))) return "a word for a currency's smallest unit";
  return undefined;
}

test("platform code writes no currency: no sign and no words but those the world's config gives", () => {
  // (The rule catches what it's for, and leaves what it should.)
  for (const line of ['return `$${whole}.${frac}`;', 'if (s.startsWith("$")) s = s.slice(1);', "const m = /^\\$(\\d+)/.exec(s);", 'out.push_str(&format!("${grouped}"));', "// about $90 trillion", 'case "dollars": return 100n;',
    "const perDollar = 100n;", "say(`Dues: ${p.dues} cents a month.`)", 'const minor = unit === "cent";']) expect(currencyIn(line.includes("format!") ? "kernel/crates/x/src/y.rs" : "participants/src/x.ts", line)).toBeDefined();
  for (const line of ["const n = cents(a.balance); // in cents", "return `${symbol}${whole}`;", 'sql("select $run")', "const total = `${a} of ${b}`;"]) expect(currencyIn("participants/src/x.ts", line)).toBeUndefined();
  expect(currencyIn("translator/src/resolver.ts", '{ block: "sign_agreement", agreement: `$${ref}`, as: me }')).toBeUndefined();
  expect(currencyIn("participants/src/behaviour/x.ts", "text: `pays $${ref}`")).toBeDefined();

  const found: string[] = [];
  for (const dir of MONEY_CODE) for (const f of statSync(join(root, dir)).isDirectory() ? files(join(root, dir)) : [join(root, dir)]) {
    if (f.endsWith(".json")) continue;
    const file = relative(root, f);
    const code = f.endsWith(".rs") ? readFileSync(f, "utf8").split(/^#\[cfg\(test\)\]$/m)[0]! : readFileSync(f, "utf8");
    code.split("\n").forEach((line, i) => {
      const what = currencyIn(file, line);
      if (what) found.push(`${file}:${i + 1}: ${what} in ${line.trim().slice(0, 120)}`);
    });
  }
  expect(found).toEqual([]);
});

/** Every leaf value's dotted path in `values`. */
function leaves(v: unknown, path = ""): string[] {
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [path];
}

const profiles = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8")) as Profile);

test("every figure in every profile has a source (or says it's a placeholder), and every target has one", () => {
  expect(profiles.length).toBeGreaterThan(0);
  for (const p of profiles) {
    expect(p.id && p.place && p.as_of).toBeTruthy();
    const unsourced = leaves(p.values).filter((path) => !Object.keys(p.sources).some((s) => path === s || path.startsWith(`${s}.`)));
    expect({ profile: p.id, unsourced }).toEqual({ profile: p.id, unsourced: [] });
    for (const s of Object.values(p.sources)) expect(s.trim().length).toBeGreaterThan(10);
    for (const t of p.targets) expect(t.source.trim().length).toBeGreaterThan(10);
  }
});

test("a town is generated from each profile, taking its figures from it", () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  for (const p of profiles) {
    const c = generate({ ...spec, citizens: 60, profile: p.id });
    expect(c.world.currencies).toEqual([p.values.currency]);
    const retail = c.participants.find((x: any) => x.controller?.impl === "firm.retailer");
    expect(retail.controller.params.wage).toBe(p.values.wages_per_pay_period.shop);
    const person = c.participants.find((x: any) => x.kind === "person");
    expect(person.controller.params.retirement_age).toBe(p.values.retirement_age);
  }
}, 120_000); // (nine towns to generate: longer than a test's usual five seconds on a busy machine)

test("platform code names none of a generated world's entities, accounts or buildings: modules are told whom they deal with", () => {
  // Every id the generated town has (its organisations, people, accounts and buildings): none may be written into the
  // platform's code (a module's default, a comparison), or the code would work only in worlds that happen to use it.
  const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const config = generate(base);
  const ids = new Set<string>([...config.world.entities.map((e: any) => e.id), ...config.world.accounts.map((a: any) => a.id), ...config.world.structures.map((s: any) => s.id)]);
  const found: string[] = [];
  for (const dir of ["participants/src", "orchestrator/src", "translator/src", "measure/src"]) for (const f of files(join(root, dir))) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/^\s*\*/.test(code) || /\bneed\(/.test(code)) return; // doc comments; the names of parameters a world must give
      for (const m of code.matchAll(/"([A-Za-z0-9_.-]+)"/g)) if (ids.has(m[1]!)) found.push(`${relative(root, f)}:${i + 1}: "${m[1]}" in ${line.trim().slice(0, 120)}`);
    });
  }
  expect(found).toEqual([]);
});
