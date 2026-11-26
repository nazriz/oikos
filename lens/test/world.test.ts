// The 3D town's plan (src/client/world/layout.ts) on a hand-made town: a walk between two doors keeps to the streets
// (every point between the two garden paths lies on a street cell's pavement), starts and ends at the doors, and a lot
// with no street beside it faces the nearest one; the right-hand offset is mitred, so corners stay on the pavement.
import { expect, test } from "bun:test";
import { offsetRight, Plan, STREET } from "../src/client/world/layout";

//   x: 0 1 2 3 4
// y0   A # . . .
// y1   . # # # #
// y2   . . . C #     C: no street beside it? (it has one: (4,2)); D at (2,3) has none
// y3   . . D . B
const S = (id: string, x: number, y: number, category = "residential") => ({ id, x, y, w: 1, h: 1, category });
const town = {
  ground: { cell: 25, w: 5, h: 4 },
  structures: [
    S("A", 0, 0), S("B", 4, 3), S("C", 3, 2), S("D", 2, 3),
    S("r1", 1, 0, "transport"), S("r2", 1, 1, "transport"), S("r3", 2, 1, "transport"), S("r4", 3, 1, "transport"), S("r5", 4, 1, "transport"), S("r6", 4, 2, "transport"),
  ],
};

test("a walk runs door to door along the pavements of the street cells it crosses", () => {
  const plan = new Plan(town);
  const r = plan.walk(0, 1);
  const A = plan.lots[0]!, B = plan.lots[1]!;
  expect(r.pts[0]).toEqual(A.door);
  expect(r.pts.at(-1)).toEqual(B.door);
  expect(A.fronted && B.fronted).toBe(true);
  expect(A.face).toEqual([1, 0]); // its only street is east of it
  // Between the gates, every point is within a street cell and on a pavement (not the carriageway).
  for (const [x, z] of r.pts.slice(1, -1)) {
    const cx = Math.floor(x / 25), cy = Math.floor(z / 25);
    expect(plan.isRoad(cx, cy)).toBe(true);
    const ox = Math.abs(x - (cx + 0.5) * 25), oz = Math.abs(z - (cy + 0.5) * 25);
    expect(Math.max(ox, oz)).toBeGreaterThan(STREET.kerb);
  }
  expect(r.len).toBeGreaterThan(100);
  // A lot with no street beside it faces the nearest street and reaches it by a path.
  const D = plan.lots[3]!;
  expect(D.fronted).toBe(false);
  expect(D.road).toBeGreaterThanOrEqual(0);
  // Unjoined streets: no chain.
  expect(plan.cells(5 * 0 + 1, 99)).toEqual([]);
});

test("the right-hand offset keeps its distance on straights and mitres the corners", () => {
  const p = offsetRight([[0, 0], [10, 0], [10, 10]], 2);
  // Heading east, the right is south (+z); then heading south, the right is west (-x).
  expect(p[0]).toEqual([0, 2]);
  expect(p[1]![0]).toBeCloseTo(8);
  expect(p[1]![1]).toBeCloseTo(2);
  expect(p[2]![0]).toBeCloseTo(8);
  expect(p[2]![1]).toBeCloseTo(10);
});
