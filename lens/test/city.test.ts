// The city's folds (src/folds/town.ts, people.ts) on a small hand-made log in the kernel's line shapes (no kernel, no
// run slot): every occupied/vacated event becomes one row, nobody is in two structures at once, the whereabouts engine
// (keyframes + replay) agrees with a plain replay at any moment, a structure built mid-run is placed, and the seat's
// acts, the election and the papers are read and placed.
import { expect, test } from "bun:test";
import { townFold, type TownBundle } from "../src/folds/town";
import { peopleFold, type PeopleBundle } from "../src/folds/people";
import { makeCity } from "../src/client/city/data";
import { electionView, homeAt, papersIn, PAPER_GROUPS } from "../src/client/city/civic";

const DAY = 86_400, H = 3600;

/** A town of 3 houses, a workplace and a hall, 6 people, 3 days of commuting, a house built on day 2, a seat that
 * writes to the works office, a ballot with 2 candidates and 4 votes, and a complaint about a house. */
function log(): any[] {
  let seq = 0;
  const L: any[] = [];
  const line = (kind: string, t: number, body: any) => L.push({ seq: seq++, t, kind, body });
  const types = [
    { id: "house", category: "residential", footprint: { w: 1, h: 1 }, spaces: [{ kind: "dwelling", count: 1, capacity: 6 }] },
    { id: "works", category: "industrial", footprint: { w: 1, h: 1 }, spaces: [{ kind: "workplace", count: 1, capacity: 20 }] },
    { id: "civic", category: "civic", footprint: { w: 1, h: 1 }, spaces: [{ kind: "workplace", count: 1, capacity: 10 }, { kind: "hall", count: 1, capacity: 50 }] },
    { id: "road", category: "transport", footprint: { w: 1, h: 1 }, spaces: [] },
  ];
  const people = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const homeOf = (i: number) => `house-${(i % 3) + 1}`;
  line("header", 0, {
    run_id: "hand-made",
    config: {
      meta: { name: "Testville" },
      catalogue: { structure_types: types },
      participants: [{ id: "mayor-system", kind: "person", controller: { type: "llm" } }, ...people.map((p) => ({ id: `${p}-self`, kind: "person", controller: { type: "code" } }))],
      positions: [{ id: "works", entity: "city", title: "Works manager", holder: "p1-self" }],
      world: {
        ground: { cell: 25, w: 12, h: 10, terrain: [{ x: 0, y: 0, w: 12, h: 10, label: "grassland" }] },
        places: [{ id: "district", kind: "district", name: "District", area: { x: 0, y: 0, w: 12, h: 10 } }, { id: "town", kind: "town", name: "Testville", within: "district", area: { x: 0, y: 0, w: 8, h: 6 } }],
        structures: [
          { id: "house-1", at: "cell.1.1", type: "house", variables: { disrepair: 100 } },
          { id: "house-2", at: "cell.3.1", type: "house" },
          { id: "house-3", at: "cell.5.1", type: "house" },
          { id: "works-1", at: "cell.3.4", type: "works" },
          { id: "town-hall", at: "cell.1.4", type: "civic" },
          ...[0, 1, 2, 3, 4, 5, 6].map((x) => ({ id: `road-${x}`, at: `cell.${x}.2`, type: "road" })),
        ],
        entities: [{ id: "city", kind: "government", name: "Town of Testville" }, ...people.map((p) => ({ id: p, kind: "person", name: p, born_at: -30 * 365 * DAY }))],
        records: [{ kind: "property_roll", id: "roll-1", data: { owner: "city", buildings: [{ structure: "town-hall" }] } }, { kind: "household", id: "hh-1", data: { members: [{ person: "p1" }, { person: "p4" }] } }],
        occupancy: people.map((p, i) => ({ occupant: p, space: `${homeOf(i)}/dwelling.1` })),
        network: { nodes: [], links: [] },
        flows: [], populations: [],
      },
    },
  });
  for (let d = 0; d < 3; d++) {
    people.forEach((p, i) => {
      if (i === 5) return; // p6 stays home
      const go = d * DAY + 9 * H + i * 60, at = go + 20 * 60, back = d * DAY + 17 * H + i * 60, home = back + 25 * 60;
      line("event", go, { event: "vacated", occupant: p, space: `${homeOf(i)}/dwelling.1`, reason: "left" });
      line("event", at, { event: "occupied", occupant: p, space: "works-1/workplace.1" });
      line("event", back, { event: "vacated", occupant: p, space: "works-1/workplace.1", reason: "left" });
      line("event", home, { event: "occupied", occupant: p, space: `${homeOf(i)}/dwelling.1` });
    });
    if (d === 1) line("event", d * DAY + 8 * H, { event: "structure_started", structure: "str.1", structure_type: "house", on: "cell.7.1", built_by: "city" });
  }
  line("event", 2 * DAY + 12 * H, { event: "structure_completed", structure: "str.1" });
  // The seat writes to the works manager; the act is applied.
  line("command", DAY + 10 * H, { command: "act", participant: "mayor-system", as: "mayor", blocks: [{ block: "message", to: ["works"], text: "Collect the waste." }] });
  const cmd = L[L.length - 1].seq;
  line("event", DAY + 10 * H, { event: "action_started", action: "act.1", cause: cmd });
  line("event", DAY + 10 * H, { event: "action_applied", action: "act.1" });
  // An election: a ballot, 4 votes, a result. A complaint about house-2.
  const rec = (t: number, r: any) => line("event", t, { event: "recorded", record: r });
  rec(DAY, { kind: "ballot", id: "b1", data: { office: "mayor", candidates: [{ number: "1", candidate: "p1-self", for: "p1", name: "p1" }, { number: "2", candidate: "mayor-system", for: "city", name: "p2" }] } });
  for (const [k, p] of ["p3", "p4", "p5", "p6"].entries()) rec(DAY + (k + 1) * H, { record: "vote", id: `v${k}`, ballot: "b1", choice: k % 2 ? "1>2" : "2>1", speaks_for: p });
  rec(2 * DAY, { kind: "ballot_result", id: "r1", data: { ballot: "b1", winner: "mayor-system", electors: 6, formal: 4 } });
  rec(DAY + 15 * H, { kind: "complaint", id: "c1", speaks_for: "p2", data: { structure: "house-2", about: "waste" }, text: "Our waste." });
  rec(DAY + 16 * H, { kind: "benefit_decision", id: "d1", speaks_for: "outside", addressed_to: ["p6"], data: { granted: true }, text: "Granted." });
  L.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return L;
}

test("town and people folds on a hand-made log: one row per move, nobody in two places, exact whereabouts, the civic layers placed", async () => {
  const lines = log();
  const town = townFold(), people = peopleFold();
  const ctx = { runId: "hand-made", dir: "" };
  for (const l of lines) { town.line(l, ctx); people.line(l, ctx); }
  const T = (await town.finish(ctx)).json as TownBundle;
  const pr = await people.finish(ctx);
  const P = pr.json as PeopleBundle;
  const f = pr.files!;
  const t = new Uint32Array(f.t!.buffer.slice(0)), p = new Uint16Array(f.p!.buffer.slice(0)), s = new Uint16Array(f.s!.buffer.slice(0)), k = new Int8Array(f.k!.buffer.slice(0));

  // Every move is one row (the header's occupancy at t = 0 included); t never goes back.
  const moves = lines.filter((l) => l.kind === "event" && (l.body.event === "occupied" || l.body.event === "vacated")).length;
  expect(P.rows).toBe(6 + moves);
  expect(t.length).toBe(P.rows);
  for (let i = 1; i < t.length; i++) expect(t[i]! >= t[i - 1]!).toBe(true);

  // The town: structures on the ground, the hall found, the seat and its act (applied, reaching the works manager).
  for (const st of T.structures) expect(st.x >= 0 && st.y >= 0 && st.x < T.ground.w && st.y < T.ground.h).toBe(true);
  expect(T.structures[T.hall!]!.id).toBe("town-hall");
  expect(T.seats).toEqual(["mayor-system"]);
  expect(T.acts.map((a) => a.status)).toEqual(["applied"]);
  expect(T.targets.works).toMatchObject({ kind: "person", person: "p1" });
  // Who holds power: the town's posts with their first holders, and each participant's person.
  expect(T.power.history).toContainEqual([0, "works", "p1-self", null]);
  expect(T.power.bodies["p1-self"]).toBe("p1");
  // A structure begun mid-run is placed, with when it began and was completed.
  expect(T.structures.find((x) => x.id === "str.1")).toMatchObject({ x: 7, y: 1, started: DAY + 8 * H, completed: 2 * DAY + 12 * H });

  // Nobody is in two structures at once.
  const at = new Int32Array(P.people.length).fill(-1);
  for (let i = 0; i < t.length; i++) {
    if (k[i]! > 0) { expect(at[p[i]!]).toBe(-1); at[p[i]!] = s[i]!; }
    else { expect(at[p[i]!]).toBe(s[i]!); at[p[i]!] = -1; }
  }

  // The client's engine agrees with a plain replay, forward and back.
  const city = makeCity(T, P, t, p, s, k);
  const end = t[t.length - 1]!;
  for (const m of [end, 0, 9 * H + 30 * 60, DAY + 12 * H, end / 3, 2 * DAY + 17 * H + 10 * 60, DAY + 12 * H]) {
    city.where.seek(m);
    const ref = new Int32Array(P.people.length).fill(-1);
    for (let i = 0; i < t.length && t[i]! <= m; i++) ref[p[i]!] = k[i]! > 0 ? city.sMap[s[i]!]! : -1;
    expect(Array.from(city.where.at)).toEqual(Array.from(ref));
    expect(city.where.count.reduce((a, b) => a + b, 0)).toBe(ref.filter((x) => x >= 0).length);
  }

  // The election: 4 votes counted by first preference, the seat's candidacy known, voters placed at home.
  const ev = electionView(city, 2 * DAY + H)!;
  expect(ev.phase).toBe("declared");
  expect(ev.first).toEqual({ "2": 2, "1": 2 });
  expect(ev.homes.find((h) => h.seat)?.name).toBe("p2");
  for (const v of ev.votes) expect(v.s).toBe(homeAt(city, v.person, DAY));
  // Papers: the complaint at the house it names, the benefit decision at its person's home.
  const placed = papersIn(city, 2 * DAY, 7 * DAY, new Set(PAPER_GROUPS.map((_, i) => i)));
  expect(placed.find((x) => x.p.id === "c1")?.s).toBe(city.sById.get("house-2"));
  expect(placed.find((x) => x.p.id === "d1")?.s).toBe(city.sById.get("house-3"));
});
