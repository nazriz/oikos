// Names and ordinary dates (docs/design/names-and-dates.md): the profiles' sections are well formed and sourced; a town
// asked to be named and dated is, from the profile alone; the draws are keyed on stable ids (twins hold); a town not asked
// is as it was; nothing in a name is an input to what a module reads.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calendarWords, readCalendarDate } from "@oikos/participants";
import { generate, type TownSpec } from "../generator/generate";
import { easter, expandHolidays, profileNamesProblems } from "../generator/names";
import { loadProfile, PROFILE_DIR } from "../generator/profile";

const root = join(import.meta.dir, "../..");
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as TownSpec;
const ids = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const small = (profile: string, extra: Partial<TownSpec> = {}): TownSpec => ({ ...base, profile, citizens: 90, ...extra });
const schema = () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "log"]) ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  return ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
};

test("every profile states names and a calendar, well formed, each with its source", () => {
  expect(ids.length).toBe(9);
  for (const id of ids) {
    const P = loadProfile(id);
    expect(P.values.names, id).toBeDefined();
    expect(P.values.calendar, id).toBeDefined();
    expect(profileNamesProblems(P), id).toEqual([]);
    // (A list that was not found says so; one that was found names where.)
    for (const k of ["names.given", "names.family", "calendar.holidays"]) expect(P.sources[k]!.length, `${id} ${k}`).toBeGreaterThan(60);
    // (A town's name is not a real town's: the profiles say they looked.)
    expect(P.sources["names.town"], id).toMatch(/gazetteer|checked|not a real|invented|searched/i);
  }
});

test("a named, dated town: people, bodies and homes have names, the config has a calendar, and it is a valid world", () => {
  const valid = schema();
  for (const id of ids) {
    const P = loadProfile(id);
    const config = generate(small(id, { names: true, calendar: true })) as any;
    expect(valid(config), `${id}: ${JSON.stringify(valid.errors?.slice(0, 2))}`).toBe(true);
    const people = config.world.entities.filter((e: any) => e.kind === "person");
    expect(people.length).toBeGreaterThan(80);
    expect(people.every((e: any) => e.name !== e.id && e.name.trim() === e.name && e.name.length >= 3), id).toBe(true);
    for (const e of config.world.entities.filter((x: any) => ["landlord", "shop", "factory"].includes(x.kind))) expect(e.name, `${id} ${e.id}`).not.toMatch(/^(Property Co\.|Shop|Factory) \d+$/);
    expect(config.world.entities.find((e: any) => e.id === "city").name, id).toContain(P.values.names!.town);
    const cal = config.calendar;
    expect(cal.start, id).toBe(P.values.calendar!.start_date);
    expect(cal.months.length).toBe(12);
    expect(cal.holidays.length).toBeGreaterThan(2);
    expect(calendarWords(cal, 0)).not.toMatch(/year 1/);
    // (Texts that name a person say the name: the leases.)
    const lease = config.world.records.find((r: any) => r.record === "agreement" && String(r.id).startsWith("lease-"));
    if (lease) expect(lease.terms.text, id).not.toMatch(/\bc\d{4}\b/);
  }
}, 180_000);

test("a town not asked for names and dates is as it was: ids and no calendar", () => {
  const config = generate(small("ke-nakuru-2026")) as any;
  expect(config.calendar).toBeUndefined();
  expect(config.world.entities.filter((e: any) => e.kind === "person").every((e: any) => e.name === e.id)).toBe(true);
  expect(config.world.entities.find((e: any) => e.id === "landlord-1").name).toBe("Property Co. 1");
});

test("names are drawn on streams keyed on stable ids: a bigger town, the same seed, names the people it shares", () => {
  const a = generate(small("us-oh-2026", { names: true, citizens: 90 })) as any;
  const b = generate(small("us-oh-2026", { names: true, citizens: 150 })) as any;
  const nameOf = (c: any) => new Map<string, string>(c.world.entities.map((e: any) => [e.id, e.name] as [string, string]));
  const na = nameOf(a), nb = nameOf(b);
  // (Ids c0001.. are the same people in the same households while the town grows: the first households are the same.)
  let same = 0, total = 0;
  for (const [id, n] of na) if (/^c\d{4}$/.test(id) && nb.has(id)) { total++; if (nb.get(id) === n) same++; }
  expect(total).toBeGreaterThan(70);
  expect(same / total).toBeGreaterThan(0.98);
  // and the shops, which are the same shops, the same names
  for (const [id, n] of na) if (/^(shop|factory|landlord)-1$/.test(id)) expect(nb.get(id)).toBe(n);
  // and a twin (the same spec twice) is the same
  expect(JSON.stringify(generate(small("us-oh-2026", { names: true })))).toBe(JSON.stringify(generate(small("us-oh-2026", { names: true }))));
}, 180_000);

type P = { id: string; name: string; sex?: string; parents?: string[] };
/** A person's father in the town: the male parent who is in it. */
const dadOf = (p: P, all: P[]) => (p.parents ?? []).map((x) => all.find((y) => y.id === x)!).filter(Boolean).find((x) => x.sex === "male");

test("customs: a household shares a family name by the place's rule; two family names where the place writes two; family name first where it comes first", () => {
  const people = (id: string) => (generate(small(id, { names: true })) as any).world.entities.filter((e: any) => e.kind === "person") as P[];
  // father's name passed down (us-oh): a child of a father has his last word
  const us = people("us-oh-2026");
  let kids = 0;
  for (const p of us) {
    const dad = dadOf(p, us);
    if (!dad) continue;
    kids++;
    expect(p.name.split(" ").at(-1)).toBe(dad.name.split(" ").at(-1));
  }
  expect(kids).toBeGreaterThan(10);
  // two family names (mx-jal): given name, then two; a child's first family name is the father's first
  const mx = people("mx-jal-2026");
  for (const p of mx.filter((x) => (x.parents ?? []).length)) {
    const dad = dadOf(p, mx);
    if (dad) expect(p.name.split(" ").at(-2)).toBe(dad.name.split(" ").at(-2));
  }
  // family name first (jp-akita): the given name is last
  const jp = people("jp-akita-2026");
  const given = new Set<string>(loadProfile("jp-akita-2026").values.names!.given.male.flatMap((c) => c.names.map((n) => n.name)));
  expect(jp.filter((p) => given.has(p.name.split(" ").at(-1)!)).length).toBeGreaterThan(jp.length * 0.4);
  // a patronymic (in-tn): the second word is a father's given name, so a child's is its father's first word
  const tn = people("in-tn-2026");
  for (const p of tn) {
    const dad = dadOf(p, tn);
    if (dad) expect(p.name.split(" ")[1]).toBe(dad.name.split(" ")[0]);
  }
}, 180_000);

test("a name is no input to anything a module reads: the same town with and without names differs in names alone", () => {
  const strip = (c: any) => JSON.parse(JSON.stringify(c, (k, v) => (k === "name" || k === "text" || k === "description" || k === "calendar" || k === "reason" || k === "system" ? undefined : v)));
  const plain = generate(small("gb-eng-2026")) as any;
  const named = generate(small("gb-eng-2026", { names: true })) as any;
  // (Ids, kinds, money, structures, who lives where: the same.)
  expect(strip(named.world.accounts)).toEqual(strip(plain.world.accounts));
  expect(strip(named.world.structures)).toEqual(strip(plain.world.structures));
  expect(named.world.entities.map((e: any) => e.id)).toEqual(plain.world.entities.map((e: any) => e.id));
}, 180_000);

test("holidays: fixed, nth weekday, last weekday, Easter-relative and listed, with the place's way of keeping one on a day of rest", () => {
  const rules = [
    { name: "a", fixed: { month: 1, day: 1 } },
    { name: "b", nth_weekday: { month: 9, weekday: 0, n: 1 } },
    { name: "c", nth_weekday: { month: 5, weekday: 0, n: -1 } },
    { name: "d", easter_offset: -2 },
    { name: "e", on: ["2026-10-20", "2027-10-20"] },
    { name: "f", fixed: { month: 6, day: 6 }, observed: { saturday: 2, sunday: 1 } },
    { name: "g", fixed: { month: 7, day: 4 }, shift_if_rest: true },
  ] as any;
  const got = expandHolidays(rules, 2026, 2027, [5, 6]);
  expect(easter(2026)).toEqual({ year: 2026, month: 4, day: 5 });
  expect(easter(2027)).toEqual({ year: 2027, month: 3, day: 28 });
  expect(got).toContain("2026-01-01");
  expect(got).toContain("2026-09-07");   // first Monday of September 2026
  expect(got).toContain("2027-09-06");
  expect(got).toContain("2026-05-25");   // last Monday of May 2026
  expect(got).toContain("2026-04-03");   // Good Friday 2026
  expect(got).toContain("2027-03-26");
  expect(got).toContain("2026-10-20");
  expect(got).toContain("2027-10-20");
  expect(got).toContain("2026-06-08");   // 6 June 2026 is a Saturday: kept on the Monday
  expect(got).toContain("2027-06-07");   // 6 June 2027 is a Sunday: kept on the Monday
  expect(got).toContain("2026-07-06");   // 4 July 2026 is a Saturday: shifted past the rest days
  expect(got).toContain("2027-07-05");   // 4 July 2027 is a Sunday
});

test("a calendar in a town's config reads and writes the place's dates; the start month is the weather's too", () => {
  const config = generate(small("au-vic-2026", { names: true, calendar: true, start_date: "2026-03-12" })) as any;
  expect(calendarWords(config.calendar, 0, true)).toBe("Thursday 12 March 2026");
  expect(readCalendarDate(config.calendar, "12 March 2026", 0)).toBe(0);
  expect(() => generate(small("au-vic-2026", { calendar: true, start_date: "2026-03-12", start_month: 5 }))).toThrow(/start_month/);
}, 180_000);
