// The real pilot shape, act for act, over a year in which residents die (review of foundations, findings 1 and 10), and with seats
// that live and act (foundations F9, twins with a live seat).
// Since foundations F5 a model's seat in a post is a participant of its own (`<post>-system`, `shares_body`) beside the
// person who holds the post, and its mock is the office's own code as its brain. A town with such seats is the town
// without them but for those posts (docs/design/foundations.md section 4): here the two towns are run from one seed for a
// year with deaths well above life's, seats in the posts of two people who die early in it, and every act and every event of the world
// must be the same, but for the names of the seats. A seated resident who dies must take the seat with them (the seat
// ends and the post falls vacant at that moment, in both towns): finding 1 was a seat that outlived its body.
//
// The first test holds two seats, sitting as their code twins do (since 2026-10-17, fix-housing: a land registrar who lives to transfer a title, and a councillor who lives to vote, do so at another hour than their twin when they keep office hours, and that is a seat's decision and not a fault: the profile figures that let them live moved the draws), one of whom dies early. The second holds the case the first could not (the review's
// finding 10: a seat that stays alive did not give the twin act for act): nineteen live seats in posts that have work, each a mock that
// sits as its code twin does (`mock.twin`: back when its brain's module would be, woken by what wakes the code unit of its post, drawing
// as the person does, one step of its brain where the code unit takes one, and its looks in one look), for a year with deaths. Every act
// of the year, in order, and every event of the world in each moment, is then the same, to the second.
// What made it so (docs/decisions.md, "Foundations F9 and F10"): (a) the engine's advance stops at the moment news is delivered, a paper is
// recorded, a body gives news or a keeper answers, so news reaches whoever it reaches when it happens and not at the first wake the engine
// happens to have (a seat's sittings are other moments than its twin's); (b) a moment's wakes are in the order of the person's own unit for
// the post, and a seat's request is drafted and confirmed inside its place in that order (the acts of one moment begin in one order);
// (c) what is written by a person's seat is not news to the person, as what the person writes is not, and a letter to a seat is a letter to
// its person and the other way about; (d) the seat's brain is told the name of each act it sent. The third test holds (a) alone: seats that
// keep office hours and do nothing move nothing of the town beside them.
//
// What is not held: a post whose office a seat makes more of than its twin has (a clerk who files its books, staff under standing orders:
// the office of a landlord, the clinic, the principal, the police, the union, the water and energy bodies, the registrar of the tribunal) is
// another town by those papers and the time they take: the posts here are those whose module has no routines and keeps no books.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modules as builtin } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const SEATS = ["councillor-4", "land-registrar"];

/** Posts with work whose office is the same office with a seat in it (no clerk, no staff, no standing orders of its own). */
const BUSY = ["shop-1-manager", "shop-2-manager", "shop-3-manager", "shop-4-manager", "shop-5-manager", "shop-6-manager", "factory-1-manager", "factory-2-manager", "editor",
  "councillor-1", "councillor-2", "councillor-3", "councillor-4", "councillor-5", "builder-foreman", "land-registrar", "electoral", "inspector", "child-protection"];

async function town(name: string, seats: string[], o: { days?: number; deaths?: number; twin?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...spec, ...(seats.length ? { model_seats: seats } : {}) });
    // Far more deaths than life (25% a year from 25), so that some of those seated die within the year.
    config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: o.deaths ?? 2500 }];
    // (A mock seat that sits as its code twin does: said in its own configuration, as a world says what its seats are.)
    if (o.twin) for (const id of seats) config.participants.find((x: any) => x.id === config.positions.find((p: any) => p.id === id).holder).controller.params.mock.twin = true;
    const held = new Map<string, string>(config.positions.map((p: any) => [p.id, config.participants.find((q: any) => q.id === p.holder)?.person ?? p.holder]));
    const s = await runWorld({ config, runId: name, outDir: dir, until: (o.days ?? 365) * DAY, logDetail: "lean", recordObservations: "none" } as any);
    expect(s.participantErrors).toBe(0);
    return { lines: readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)), held };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a year of the town with seats beside their people is the town without them, act for act, and a seated resident who dies takes the seat with them", async () => {
  const t0 = Date.now();
  const [twin, pilot] = await Promise.all([town("twin-seat-code", []), town("twin-seat-mock", SEATS, { twin: true })]);
  // A seat's name is the name of the person it sits beside, whose acts they are (the twin's participant for them).
  const names = new Map<string, string>(SEATS.map((id) => [`${id}-system`, `${twin.held.get(id)!}-self`]));
  const plain = (x: string) => { let y = x; for (const [a, b] of names) y = y.split(a).join(b); return y; };
  const rows = (lines: any[], kind: string) => lines.filter((l) => l.kind === kind);
  // (Every act in order: when, by whom, doing what. Not by the day: to the second.)
  const acts = (r: typeof twin) => rows(r.lines, "command").filter((l) => l.body.command === "act").map((l) => plain(`${l.t}|${l.body.participant}|${JSON.stringify(l.body.blocks)}`));
  // (Every event of the world but the seats' own coming and going.)
  const events = (r: typeof twin) => rows(r.lines, "event").filter((l) => l.body.event !== "observation" && !(l.body.event === "participant_ended" && names.has(l.body.participant))).map((l) => plain(`${l.t}|${JSON.stringify({ ...l.body, cause: undefined })}`)).sort();
  const a = acts(twin), b = acts(pilot);
  console.log(`twin seats: ${a.length} acts in the twin, ${b.length} beside the seats; ${events(twin).length} events; ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  expect(a.length).toBeGreaterThan(10_000);
  // The seated who died: the same people at the same moments in both towns.
  const died = (r: typeof twin) => rows(r.lines, "event").filter((l) => l.body.event === "person_died").map((l) => `${l.t}|${l.body.person}`);
  const seatedPeople = new Set(SEATS.map((id) => twin.held.get(id)!));
  const seatedDead = died(pilot).filter((x) => seatedPeople.has(x.split("|")[1]!));
  console.log(`twin seats: ${seatedDead.length} of the ${seatedPeople.size} seated died in the year`);
  expect(seatedDead.length).toBeGreaterThan(0);
  expect(died(pilot)).toEqual(died(twin));
  for (const d of seatedDead) {
    const t = Number(d.split("|")[0]), person = d.split("|")[1]!;
    for (const post of SEATS.filter((id) => twin.held.get(id) === person)) {
      const seat = `${post}-system`;
      // The seat ended with them, at that moment, and did nothing after.
      const ended = rows(pilot.lines, "event").filter((l) => l.body.event === "participant_ended" && l.body.participant === seat);
      expect(ended.map((l) => l.t)).toEqual([t]);
      expect(rows(pilot.lines, "command").filter((l) => l.body.participant === seat && l.t > t).length).toBe(0);
      // And the post fell vacant at that moment, in both towns.
      const vacated = (r: typeof twin) => rows(r.lines, "event").filter((l) => l.body.event === "appointed" && l.body.position === post && l.body.holder == null).map((l) => l.t);
      expect(vacated(pilot)[0]).toBe(t);
      expect(vacated(twin)[0]).toBe(t);
    }
  }
  expect(b.length).toBe(a.length);
  expect(b).toEqual(a);
  expect(events(pilot)).toEqual(events(twin));
}, 1_800_000);

/** Every act (when, by whom, doing what), in order, and every event of the world (but observations and the seats' own coming and going) in each moment, with the seats' names those of their people. */
function stream(r: Awaited<ReturnType<typeof town>>, seats: string[]) {
  const names = new Map<string, string>(seats.map((id) => [`${id}-system`, `${r.held.get(id)!}-self`]));
  const plain = (x: string) => { let y = x.replace(/rec\.[0-9]+/g, "rec").replace(/act\.[0-9]+/g, "act"); for (const [a, b] of names) y = y.split(a).join(b); return y; };
  const acts = r.lines.filter((l) => l.kind === "command" && l.body.command === "act").map((l) => plain(`${l.t}|${l.body.participant}|${JSON.stringify(l.body.blocks)}`));
  // (A letter's recipients are listed in the order of their ids, which a seat's name changes: they are the same people.)
  const body = (b: any) => (b.event === "message_delivered" ? { ...b, to: b.to.map(plain).sort() } : b);
  const events = r.lines.filter((l) => l.kind === "event" && l.body.event !== "observation" && !(l.body.event === "participant_ended" && names.has(l.body.participant)))
    .map((l) => ({ t: l.t as number, s: plain(`${l.t}|${JSON.stringify({ ...body(l.body), cause: undefined })}`) })).sort((x, y) => x.t - y.t || (x.s < y.s ? -1 : 1)).map((x) => x.s);
  return { acts, events };
}

test("a year with nineteen live seats that sit as their code twins do is the town without them, act for act and event for event, in order, with residents dying", async () => {
  // (Each post is one whose office has no staff, clerk or standing orders of its own to be made of it by a seat: the structure of the town is the same.)
  const base = generate(spec);
  for (const id of BUSY) {
    const m = builtin[base.positions.find((p: any) => p.id === id)!.role_module.code]!;
    expect(m.routines ?? [], `${id} has routines`).toEqual([]);
    expect(m.books, `${id} keeps books`).toBeUndefined();
  }
  const [twin, pilot] = await Promise.all([town("twin-live-code", []), town("twin-live-mock", BUSY, { twin: true })]);
  const a = stream(twin, BUSY), b = stream(pilot, BUSY);
  console.log(`twin live seats: ${a.acts.length} acts and ${a.events.length} events in the twin's year; ${b.acts.length} and ${b.events.length} beside nineteen seats`);
  expect(a.acts.length).toBeGreaterThan(50_000);
  // (Seats did sit, and some of their people died, so some seats ended with them: the town without seats has no such ending to set beside.)
  expect(pilot.lines.some((l) => l.kind === "event" && l.body.event === "participant_ended" && String(l.body.participant).endsWith("-system"))).toBe(true);
  expect(b.acts.length).toBe(a.acts.length);
  expect(b.acts).toEqual(a.acts);
  expect(b.events.length).toBe(a.events.length);
  expect(b.events).toEqual(a.events);
}, 1_800_000);

test("quiet seats that keep office hours move nothing of the town beside them: every act of 200 days is the same, to the second", async () => {
  // (The review's finding 10 (b): a quiet live seat alone shifted a shop worker's act by 300 s from day 172. A letter or a paper reached
  // a person at the first moment the engine had a wake after it, and a seat's sittings are other moments than its twin's.)
  const seats = ["councillor-4", "land-registrar"];
  const [twin, pilot] = await Promise.all([town("twin-quiet-code", [], { days: 200, deaths: 0 }), town("twin-quiet-mock", seats, { days: 200, deaths: 0 })]);
  const a = stream(twin, seats), b = stream(pilot, seats);
  expect(a.acts.length).toBeGreaterThan(30_000);
  expect(b.acts).toEqual(a.acts);
}, 1_800_000);
