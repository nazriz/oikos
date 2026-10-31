// Guardrails for a general platform (docs/profiles.md). The platform's code is the same for every place and time:
// every place-specific figure lives in a profile (worlds/profiles/), with its source. These tests keep it that way.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { draftLaw } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";
import { officeBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");

/** The platform's code: everything that runs, for any world. (Docs, profiles, example worlds, laws and tests are content.) */
const CODE = ["kernel/src", "kernel/crates", "participants/src", "orchestrator/src", "translator/src", "measure/src", "measure/queries", "worlds/generator", "contracts"];
// (A Rust module's tests in a file of their own, `tests.rs`, and the market's test kit are tests, as a `.test.ts` is.)
const SKIP = [/node_modules/, /\/examples\//, /\.test\.ts$/, /\/tests?\//, /\/tests\.rs$/, /\/testkit\.rs$/, /\/target\//, /\.md$/];

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

// ---- a study's tags are for measurement only (docs/design/foundations-2.md 7.5): which kinds of system a study counts
// as one technology (`ai`) is `meta.study_tags`, written by the generator from a scenario and read by measures. No code of
// the world (the kernel, its actors, the participants' side, the translator) reads it, so nothing in the world can know
// which systems are AI.
test("no world code reads a study's tags", () => {
  const world = ["kernel/src", "kernel/crates/actors", "kernel/crates/world", "kernel/crates/perception", "kernel/crates/rules", "kernel/crates/sight", "participants/src", "translator/src"];
  const found: string[] = [];
  for (const dir of world) for (const f of files(join(root, dir))) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (/study_tags/.test(line)) found.push(`${relative(root, f)}:${i + 1}`); });
  }
  expect(found).toEqual([]);
});

// ---- no origin group in the code: where people come from is profile data (values.culture.origin, docs/behaviour/culture.md);
// the platform's code names none of a profile's groups, and no figure of theirs.
test("platform code names no profile's origin group", () => {
  const names = new Set<string>();
  for (const f of readdirSync(PROFILE_DIR).filter((x) => x.endsWith(".json"))) {
    const o = JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8")).values?.culture?.origin;
    for (const g of o?.groups ?? []) if (String(g.name).length >= 5) names.add(String(g.name));
  }
  expect(names.size).toBeGreaterThan(5);
  const found: string[] = [];
  for (const dir of CODE) for (const f of files(join(root, dir))) {
    // (A citation of a model by an institution's name, "Bank of England", is no group.)
    const text = readFileSync(f, "utf8").replaceAll("Bank of England", "");
    for (const n of names) if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) found.push(`${relative(root, f)}: "${n}"`);
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
 * - Rust's unit tests, which sit in the files they test (everything from `#[cfg(test)]` on);
 * - the name `cents` for an amount in the smallest unit (money.ts `cents()`, and variables and comments that follow
 *   it): a name the code uses for "the smallest unit" whatever the currency, about 160 lines across every module.
 *   The rule reads the word only in texts the code writes or matches, where it would reach a world.
 */
const EXEMPT: { file: RegExp; line: RegExp }[] = [
  { file: /^kernel\/crates\/(world|resolver)\/src\/|^translator\/src\/(resolver|preview)\.ts$/, line: /(starts_with|strip_prefix|startsWith)\((["'])\$\2\)|`\$\$\{(ref|v\.var|b\.ref)\}`|format!\("\$\{\w+\}( is (not bound|bound twice)[^"]*)?"\)/ },
  { file: /./, line: /"\$[1-9] ?"\)/ },
  { file: /^orchestrator\/src\/(cost|batch|models|cli)\.ts$|^participants\/src\/llm\/call\.ts$/, line: /usd|budget|spending limit|model calls/i },
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
  expect(currencyIn("participants/src/shared/x.ts", "text: `pays $${ref}`")).toBeDefined();

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
    const retail = officeBy(c, "firm.retailer");
    expect(retail.params.wage).toBe(p.values.wages_per_pay_period.shop);
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

// ---- no money and no place's figure in the example legal code; a generated town's words are in its own money ----
// (Found by the live check of 2026-10-09: the planning law said "a fine of $50,000" in the euro and the yen town, and
// seats copied it into their notebooks.)

/** Every sign a currency is written with, and every word for one: the profiles' own (their signs, codes and words),
 * and the common ones besides. */
const ALL_SIGNS = [...new Set(["$", "€", "£", "¥", "₹", "₩", "₽", "₦", "₱", "฿", ...profiles.map((p) => p.values.currency.symbol).filter(Boolean) as string[]])];
const ALL_MONEY_WORDS = [...new Set(["dollar", "dollars", "euro", "euros", "pound", "pounds", "yen", "rupee", "rupees", "peso", "pesos", "shilling", "shillings", "cent", "cents", "pence", "penny", "paise",
  ...profiles.flatMap((p) => [p.values.currency.code, ...((p.values.currency as any).unit_words ?? []), ...((p.values.currency as any).minor_words ?? [])])])];
/** (Words for a currency that are also plain words of the language the world is written in.) */
const PLAIN_WORDS = new Set(["real"]);
const moneyWordIn = (s: string, own: Set<string> = new Set()) => ALL_MONEY_WORDS.find((w) => !own.has(w) && !PLAIN_WORDS.has(w) && new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(s));
const signIn = (s: string, own: string[] = []) => ALL_SIGNS.find((x) => !own.some((o) => o.includes(x)) && s.includes(x));

/** A record's words: what a person reads of it (its text, its breakdown, an agreement's words, a form's or a
 * schedule's descriptions and labels, a proposal's own words). Not its rule (a formal condition is arithmetic in the
 * units the world holds things in) and not its data. */
function wordsOf(r: any): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, v: unknown) => { if (typeof v === "string") out.push([`${r.id}.${where}`, v]); };
  add("text", r.text);
  for (const [k, v] of Object.entries(r.adico ?? {})) add(`adico.${k}`, v);
  add("terms.text", r.terms?.text);
  for (const [i, c] of (r.terms?.commitments ?? []).entries()) add(`terms.commitments.${i}`, c?.does?.text);
  const d = r.data ?? {};
  for (const k of ["text", "title", "proposal"]) add(`data.${k}`, d[k]);
  for (const [k, v] of Object.entries(d.adico ?? {})) add(`data.adico.${k}`, v);
  for (const group of ["fields", "figures"]) for (const [k, f] of Object.entries(d[group] ?? {})) for (const part of ["description", "label"]) add(`data.${group}.${k}.${part}`, (f as any)?.[part]);
  return out;
}

test("the example legal code holds no sum of money, no currency and no figure: a law's figures are a place's, written in when a world is made", () => {
  const dir = join(root, "worlds/law");
  const found: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    for (const r of JSON.parse(readFileSync(join(dir, f), "utf8")).records) for (const [where, s] of wordsOf(r)) {
      const sign = signIn(s), word = moneyWordIn(s);
      if (sign) found.push(`${f} ${where}: the sign ${sign}`);
      if (word) found.push(`${f} ${where}: the word "${word}"`);
      if (/\d/.test(s)) found.push(`${f} ${where}: a figure, in "${s.slice(0, 80)}"`);
    }
  }
  expect(found).toEqual([]);
  // (The rule catches what it is for.)
  expect(signIn("a fine of $50,000")).toBe("$");
  expect(moneyWordIn("a fine of 50,000 dollars")).toBe("dollars");
  expect(moneyWordIn("a real estate")).toBeUndefined();
});

test("every word a generated town is given is in its own money: no other place's sign or word, and no sum as a bare count of the smallest unit", () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const found: string[] = [];
  for (const p of profiles) {
    const cur = p.values.currency as any;
    const own = new Set<string>([cur.code, ...(cur.unit_words ?? []), ...(cur.minor_words ?? [])]);
    const c = generate({ ...spec, citizens: 60, profile: p.id });
    const words: [string, string][] = c.world.records.flatMap(wordsOf);
    // (What its offices are told in words: a budget line's description, a seat's framing, a channel's title.)
    const told = (where: string, v: unknown): void => {
      if (typeof v === "string") { if (/\s/.test(v)) words.push([where, v]); }
      else if (Array.isArray(v)) v.forEach((x, i) => told(`${where}.${i}`, x));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) told(`${where}.${k}`, x);
    };
    for (const x of c.participants) told(`${x.id}.framing`, x.framing), told(`${x.id}.params`, x.controller?.params);
    for (const x of c.positions) told(`position ${x.id}.title`, x.title), told(`position ${x.id}.channels`, (x.channels ?? []).map((ch: any) => ch.title));
    expect(words.length).toBeGreaterThan(100);
    for (const [where, s] of words) {
      const sign = signIn(s, cur.symbol ? [cur.symbol] : []), word = moneyWordIn(s, own);
      if (sign) found.push(`${p.id} ${where}: the sign ${sign}, in "${s.slice(0, 80)}"`);
      if (word) found.push(`${p.id} ${where}: the word "${word}", in "${s.slice(0, 80)}"`);
      // A sum written as people write it has its sign or its marks; five digits and more in a row is a count of the
      // smallest unit, or seconds. (An id is no number: it has letters or marks beside its digits.)
      const bare = /(?<![\w.,:-])\d{5,}(?![\w.,:-]*\w)/.exec(s);
      if (bare) found.push(`${p.id} ${where}: a bare figure ${bare[0]}, in "${s.slice(0, 80)}"`);
      // Nor a length of time in seconds or a share in basis points: the units the world holds things in are not words.
      const unit = /\bseconds?\b|\bbasis points?\b|\bbps\b/.exec(s);
      if (unit) found.push(`${p.id} ${where}: "${unit[0]}", in "${s.slice(0, 80)}"`);
    }
    // The planning law's fine is the profile's, in its words and in what the inspector is told.
    const planning = c.world.records.find((r: any) => r.id === "law-planning");
    expect(planning.data.fine).toBe(p.values.town_finance.unpermitted_building_fine);
    expect(planning.text).not.toMatch(/[{}]/);
    expect(officeBy(c, "city.inspector").params.fine).toBe(planning.data.fine);
    // Every law made from figures reads exactly as its schedule writes it from the figures it carries.
    for (const r of c.world.records.filter((x: any) => x.kind === "law" && x.data?.schedule)) {
      const s = c.world.records.find((x: any) => x.id === r.data.schedule);
      expect(s).toBeDefined();
      const law = draftLaw(s.id, s.data, Object.fromEntries(Object.entries(r.data.figures).map(([k, f]: [string, any]) => [k, f.value])));
      expect({ text: r.text, adico: r.adico, formal: r.formal, data: r.data }).toEqual({ text: law.text, adico: law.adico, formal: law.formal, data: law.data });
    }
  }
  expect(found).toEqual([]);
}, 120_000);
