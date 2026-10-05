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
    expect(retail.controller.params.wage).toBe(p.values.wages_per_fortnight.shop);
    const person = c.participants.find((x: any) => x.kind === "person");
    expect(person.controller.params.retirement_age).toBe(p.values.retirement_age);
  }
});

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
