// The city's folds (src/folds/town.ts, people.ts) on a small mock run: every occupied/vacated event becomes one row,
// nobody is in two structures at once, the whereabouts engine (keyframes + replay) agrees with a plain replay at any
// moment, and the town's structures and seat are read from the header.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot } from "../../scripts/pilot-mock";
import { currentLogs, logLines } from "../../orchestrator/src/logs";
import { townFold, type TownBundle } from "../src/folds/town";
import { peopleFold, type PeopleBundle } from "../src/folds/people";
import { makeCity } from "../src/client/city/data";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-lens-city-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const entry = { name: "city", world: "worlds/town.yaml", sets: ["citizens=20", "mayor=llm"], model: "codex/gpt-6.1-sol", until: 100 * 86_400, budget: 25, env: { OIKOS_CLAUDE_BIN: "/nonexistent" } };

test("town and people folds over a mock run: one row per move, nobody in two places, whereabouts exact at any moment", async () => {
  const out = join(base, "w.mock");
  expect(await mockPilot(entry, out, 3)).toMatchObject({ generated: true });
  const log = currentLogs(join(out, "city"))[0]!;
  const town = townFold(), people = peopleFold();
  const ctx = { runId: "city", dir: "" };
  let occupied = 0, vacated = 0, initial = 0;
  for await (const raw of logLines(log)) {
    const l = JSON.parse(raw);
    if (l.kind === "header") initial = l.body.config.world.occupancy?.length ?? 0;
    if (l.kind === "event" && l.body.event === "occupied") occupied++;
    if (l.kind === "event" && l.body.event === "vacated") vacated++;
    town.line(l, ctx); people.line(l, ctx);
  }
  const T = (await town.finish(ctx)).json as TownBundle;
  const pr = await people.finish(ctx);
  const P = pr.json as PeopleBundle;
  const f = pr.files!;
  const t = new Uint32Array(f.t!.buffer.slice(0)), p = new Uint16Array(f.p!.buffer.slice(0)), s = new Uint16Array(f.s!.buffer.slice(0)), k = new Int8Array(f.k!.buffer.slice(0));

  // Every move is one row; t never goes back.
  expect(occupied).toBeGreaterThan(0);
  expect(P.rows).toBe(initial + occupied + vacated);
  expect(t.length).toBe(P.rows);
  expect(k.filter((x) => x > 0).length).toBe(initial + occupied);
  for (let i = 1; i < t.length; i++) expect(t[i]! >= t[i - 1]!).toBe(true);

  // The town: structures placed on the ground, a hall, the seat found.
  expect(T.structures.length).toBeGreaterThan(0);
  for (const st of T.structures) expect(st.x >= 0 && st.y >= 0 && st.x < T.ground.w && st.y < T.ground.h).toBe(true);
  expect(T.hall).toBeDefined();
  expect(T.seats.length).toBeGreaterThan(0);
  for (const a of T.acts) expect(T.seats).toContain(a.participant);
  // Papers point at a structure that exists, or at people.
  for (const p of T.papers) expect(p.s !== undefined ? p.s >= 0 && p.s < T.structures.length : true).toBe(true);
  // Every vote counted belongs to an election's ballot, and none comes before the ballot was issued.
  for (const e of T.elections) for (const [vt] of e.votes) expect(vt >= e.t).toBe(true);

  // Nobody is in two structures at once: a plain replay, checking every occupied row finds its person nowhere.
  const at = new Int32Array(P.people.length).fill(-1);
  for (let i = 0; i < t.length; i++) {
    if (k[i]! > 0) { expect(at[p[i]!]).toBe(-1); at[p[i]!] = s[i]!; }
    else { expect(at[p[i]!]).toBe(s[i]!); at[p[i]!] = -1; }
  }

  // The client's engine agrees with the plain replay at moments forward and back (keyframes, then replay).
  const city = makeCity(T, P, t, p, s, k);
  const end = t[t.length - 1]!;
  for (const m of [end, 0, end / 2, end / 3, end * 0.9, 3600 * 7.5, end / 2 + 1800]) {
    city.where.seek(m);
    const ref = new Int32Array(P.people.length).fill(-1);
    for (let i = 0; i < t.length && t[i]! <= m; i++) ref[p[i]!] = k[i]! > 0 ? city.sMap[s[i]!]! : -1;
    expect(Array.from(city.where.at)).toEqual(Array.from(ref));
    expect(city.where.count.reduce((a, b) => a + b, 0)).toBe(ref.filter((x) => x >= 0).length);
  }
}, 180_000);
