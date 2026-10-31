// What a world's numbers rest on (docs/design/foundations-2.md, law 11; step N1 and N2, counting only). Every profile's
// town is counted: each number is sourced, to confirm, derived, fitted, a placeholder, a convention, or unbased. The
// places that are still unbased are listed in fixtures/figures-unbased.json, which may only shrink: a new unbased place
// fails (give it a row in worlds/generator/figures.ts, true of the code that makes it), and so does a listed place that
// no town has any more (take it off the list). Counting changes no world: it is never in a config or a log.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { FIGURE_BASIS } from "@oikos/worlds/generator/figures";
import { PROFILE_DIR, loadProfile } from "@oikos/worlds/generator/profile";
import { basisOf, classify, figuresFor, figuresReport, figuresText, leaves, matches, shape } from "../src/figures";

const root = join(import.meta.dir, "../..");
const FIXTURE = join(import.meta.dir, "fixtures/figures-unbased.json");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
/** Profiles whose town is also counted living (the rest share its parameters' shape). */
const LIVING = ["au-vic-2026", "gb-eng-2026"];
const ids = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

test("a note says what its figure rests on, and a note that calls anything a placeholder counts as one", () => {
  expect(classify(undefined)).toBe("unbased");
  expect(classify("")).toBe("unbased");
  expect(classify("PLACEHOLDER: borrowed from another place")).toBe("placeholder");
  expect(classify("Opened: the census table, and the rest are placeholders")).toBe("placeholder");
  expect(classify("Fitted to the census trend")).toBe("fitted");
  expect(classify("From a secondary summary (to confirm)")).toBe("to_confirm");
  expect(classify("The statistics office's labour force survey, August, table 1")).toBe("sourced");
});

test("a pattern covers its subtree, `*` one segment and `**` any", () => {
  expect(matches("a.*.c", "a.x.c")).toBe(true);
  expect(matches("a.*.c", "a.x.c.d.e")).toBe(true);
  expect(matches("a.*.c", "a.x.d")).toBe(false);
  expect(matches("a.**", "a.x.y.z")).toBe(true);
  expect(matches("a.b", "a.bc")).toBe(false);
});

test("ids and positions are grouped, a parameter's name never is", () => {
  const c = { participants: [{ id: "school", controller: { code: "m", params: { school: { ages: [5, 18] } } } }], world: { entities: [{ id: "school" }], accounts: [{ id: "acc-1", balance: 3 }] } };
  expect(shape(["participants", "0", "controller", "params", "school", "ages", "1"], c)).toBe("participants.*.controller.params.school.ages.*");
  expect(shape(["world", "accounts", "0", "balance"], c)).toBe("world.accounts.*.balance");
  expect(shape(["x", "lot-12", "rent"], c)).toBe("x.*.rent");
});

test("a number nothing speaks for is counted unbased, and one the work table's note speaks for is not", () => {
  const c = { orchestration: { act_time: { person: { publish: 900 }, sources: { person: "Placeholder: minutes" } } }, made_up: { figure: 7 } };
  const r = figuresReport(c);
  expect(r.numbers).toBe(2);
  expect(r.by_class.placeholder).toBe(1);
  expect(r.by_class.unbased).toBe(1);
  expect(r.unbased).toEqual([{ at: "made_up.figure", count: 1 }]);
  expect(figuresText(r)).toContain("made_up.figure");
});

test("a row's profile path reads the note of the same part below it, and a row may hold for one id, or where a path is given", () => {
  const c = { h: { lone_bps: 1, group_bps: 2 }, tasks: [{ id: "a", labour: 5 }, { id: "b", labour: 6 }], t: { days: 3 }, dials: { on: 1 } };
  const profile = { values: {}, sources: { "h.lone_bps": "The census, table 3", h: "PLACEHOLDER: the rest", "x.on": "The law, s 2" } };
  const table = [
    { at: "h", profile: "h" },
    { at: "tasks.*.labour", id: "a", class: "convention" as const, why: "an hour" },
    { at: "tasks.*.labour", class: "derived" as const, why: "from the wage" },
    { at: "t.days", profile: "x.on", given: "dials.on" },
  ];
  const at = (...path: string[]) => basisOf(c, { path, value: 0 }, profile, table).class;
  expect(at("h", "lone_bps")).toBe("sourced");
  expect(at("h", "group_bps")).toBe("placeholder");
  expect(at("tasks", "0", "labour")).toBe("convention");
  expect(at("tasks", "1", "labour")).toBe("derived");
  expect(at("t", "days")).toBe("sourced");
  expect(basisOf({ ...c, dials: {} }, { path: ["t", "days"], value: 0 }, profile, table).class).toBe("unbased");
});

test("every profile's town is counted, and the unbased places are only those listed (the list only shrinks)", () => {
  const listed: string[] = JSON.parse(readFileSync(FIXTURE, "utf8")).unbased;
  const found = new Set<string>();
  const used = new Set<number>();
  // (Each profile's plain town, and two living ones, with founding, for the parameters only a living town is given; and one
  // with skills by use, assistants hosted in the town and the outside's releases, for their figures.)
  const towns = [...ids.map((id) => ({ id, extra: {} })), ...LIVING.map((id) => ({ id, extra: { living: { founding: true } } })), { id: LIVING[0]!, extra: { skills: true, assistants: true, hosting: "local", capability: { tag: "ai", of: ["case-handling-system"], every_days: 182, time_bps: 8000, slip_bps: 8000, price_bps: 10_000 } } }];
  for (const { id, extra } of towns) {
    const config = generate({ ...spec, ...extra, citizens: 60, profile: id });
    const r = figuresFor(config, { profile: id });
    expect(r.numbers).toBeGreaterThan(1000);
    for (const u of r.unbased) found.add(u.at);
    // (Which rows of the generator's table speak for something in some town.)
    const profile = loadProfile(id) as any;
    for (const leaf of leaves(config)) {
      const row = basisOf(config, leaf, { values: profile.values, sources: profile.sources }).row;
      if (row !== undefined) used.add(row);
    }
  }
  const fresh = [...found].filter((x) => !listed.includes(x)).sort();
  const gone = listed.filter((x) => !found.has(x));
  expect({ new_unbased_places: fresh }).toEqual({ new_unbased_places: [] });
  expect({ listed_but_gone: gone }).toEqual({ listed_but_gone: [] });
  // (A row that speaks for nothing in any town is a statement about code that no longer makes it.)
  const family = (i: number) => FIGURE_BASIS[i]!.family ?? FIGURE_BASIS[i]!.at;
  const live = new Set([...used].map(family));
  const dead = [...new Set(FIGURE_BASIS.map((_, i) => family(i)))].filter((f) => !live.has(f));
  expect({ rows_that_match_nothing: dead }).toEqual({ rows_that_match_nothing: [] });
}, 240_000); // (eleven towns to generate)
