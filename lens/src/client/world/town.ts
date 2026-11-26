// The town as a model: every structure as a building of its kind on its lot, the streets with their carriageways,
// kerbs, pavements and markings, the gardens, hedges and fields, trees, and street lamps. Built once per run from the
// town bundle and the plan (layout.ts); what changes with time (lit windows, smoke, the clock's hands, buildings going
// up) is driven by engine.ts through the handles returned here.
import * as THREE from "three";
import type { TownBundle } from "../../folds/town";
import { Buf, Frame, Panels, blend, col, shade, type Col } from "./geo";
import { h01, hashStr, Plan, STREET } from "./layout";

const P = {
  brick: ["#9b5a45", "#a46a52", "#8d5340", "#b07a5c", "#a86048"].map(col),
  render: ["#ddd3c0", "#e6dfcf", "#cfc4ad", "#d8cbb3", "#e2d6bf"].map(col),
  buff: ["#b89c7c", "#c4ab8a", "#a99175"].map(col),
  slate: ["#4f555b", "#5a5f63", "#474c52"].map(col),
  tile: ["#8f5a43", "#9a6449", "#7f513f"].map(col),
  door: ["#2f4a3d", "#2c3a52", "#6b2b2b", "#2a2a2a", "#e2ddd0", "#5b4a3a"].map(col),
  awning: ["#2f5a48", "#6e2f2c", "#2d4061", "#8a6a33", "#4b4f55", "#5d3f52"].map(col),
  frame: col("#ece8de"),
  stone: col("#cbc2ad"),
  concrete: col("#b9b6ae"),
  darkConcrete: col("#8d8b86"),
  metal: col("#7f8a84"),
  copper: col("#6f9a88"),
  sign: col("#26313a"),
  lawn: col("#62793f"),
  lawn2: col("#5c7240"),
  paving: col("#b7b1a4"),
  gravel: col("#a59d8c"),
  forecourt: col("#a9a49a"),
  yard: col("#8f8b82"),
  hedge: col("#3f5a32"),
  fence: col("#8b7d6a"),
  asphalt: col("#57554f"),
  pavement: col("#9f9b92"),
  kerb: col("#c9c5bb"),
  kerbTop: col("#cfcbc1"),
  verge: col("#6f8749"),
  lawns: ["#62793f", "#5c7240", "#6a8045", "#587039"].map(col),
  marking: col("#e9e5d8"),
  playground: col("#6d6c70"),
};
const pick = <T,>(a: T[], r: number): T => a[Math.floor(r * a.length) % a.length]!;

export interface Chimney { x: number; y: number; z: number; owner: number; scale: number }
export interface TreeSpec { x: number; z: number; h: number; r: number; kind: 0 | 1; tone: number }

export interface TownModel {
  buildings: THREE.BufferGeometry;
  buildingOwner: Int32Array;
  /** Buildings begun during the run: their own geometry, shown from `started`, rising until `completed`. */
  later: { i: number; geo: THREE.BufferGeometry; owner: Int32Array; started: number; completed?: number; height: number }[];
  ground: THREE.BufferGeometry;
  asphalt: THREE.BufferGeometry;
  pavement: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
  hedges: THREE.BufferGeometry;
  windows: Panels;
  shopGlass: Panels;
  chimneys: Chimney[];
  lamps: { x: number; z: number; heading: number }[];
  trees: TreeSpec[];
  /** Where each structure's roof top is (for arcs and labels), and its centre. */
  tops: Float32Array;
  centres: Float32Array;
  /** The town hall's clock: where each of its faces is (centre, outward heading). */
  clock?: { faces: { x: number; y: number; z: number; heading: number }[]; r: number };
  /** Polling-place furniture spot by structure: in front of its door. */
  fronts: Float32Array;
  /** Each structure's bounding box: min x, y, z, max x, y, z (Infinity when it has no building). */
  boxes: Float32Array;
}

export function buildTown(town: TownBundle, plan: Plan): TownModel {
  const cell = town.ground.cell;
  const B = new Buf(), G = new Buf(), A = new Buf(), PV = new Buf(), M = new Buf(), HG = new Buf();
  const windows = new Panels(), shopGlass = new Panels();
  const chimneys: Chimney[] = [];
  const later: TownModel["later"] = [];
  const nS = town.structures.length;
  const tops = new Float32Array(nS), centres = new Float32Array(nS * 2), fronts = new Float32Array(nS * 2);
  let clock: TownModel["clock"];

  // ---------- Buildings ----------
  town.structures.forEach((s, i) => {
    const L = plan.lots[i];
    if (!L) return;
    const F = new Frame(L.cx, L.cz, L.face[0], L.face[1]);
    const r = h01(hashStr(s.id)), r2 = h01(hashStr(s.id), 2), r3 = h01(hashStr(s.id), 3);
    const target = s.started !== undefined ? new Buf() : B;
    target.who = i;
    G.who = i;
    const half = (L.d / 2);
    const ctx: Ctx = { F, B: target, G, windows, shopGlass, i, r, r2, r3, half, w: L.w, chimneys };
    let res: Built;
    const t = s.type;
    if (s.category === "residential") res = (s.spaces.dwelling ?? 0) > 1 ? apartments(ctx) : /large/.test(t) ? largeHouse(ctx) : house(ctx);
    else if (s.category === "commercial") res = /office/.test(t) ? offices(ctx) : /unit/.test(t) ? shopUnit(ctx) : shop(ctx);
    else if (s.category === "industrial") res = /yard/.test(t) ? yard(ctx) : factory(ctx);
    else if (s.category === "civic") {
      if (/station/.test(t)) res = station(ctx);
      else { res = townHall(ctx); clock = res.clock; }
    }
    else if (s.category === "health") res = clinic(ctx);
    else if (s.category === "education") res = school(ctx);
    else if (s.category === "utility") res = /sub/.test(t) ? substation(ctx) : works(ctx);
    else if (s.category === "green") res = park(ctx);
    else res = shopUnit(ctx);
    // The door, for walks: on the front wall.
    L.door = [F.x(res.door[0], res.door[1] + 0.6), F.z(res.door[0], res.door[1] + 0.6)];
    tops[i] = res.height;
    centres[i * 2] = F.x(0, res.cz ?? 0); centres[i * 2 + 1] = F.z(0, res.cz ?? 0);
    fronts[i * 2] = F.x(res.door[0] + 2.2, res.door[1] + 2.2); fronts[i * 2 + 1] = F.z(res.door[0] + 2.2, res.door[1] + 2.2);
    if (target !== B) later.push({ i, geo: target.geometry(), owner: Int32Array.from(target.owner), started: s.started!, completed: s.completed, height: res.height });
  });

  // ---------- Streets ----------
  const c2 = cell / 2, cw = STREET.carriage, pw = STREET.pavement, kh = 0.14;
  for (const [id, j] of plan.joins) {
    const [x, z] = plan.centre(id);
    A.who = -1; PV.who = -1; M.who = -1;
    // Carriageway: the middle square and an arm toward each street it joins.
    A.flat(x - cw, z - cw, x + cw, z + cw, 0.04, P.asphalt);
    if (j & 1) A.flat(x + cw, z - cw, x + c2, z + cw, 0.04, P.asphalt);
    if (j & 4) A.flat(x - c2, z - cw, x - cw, z + cw, 0.04, P.asphalt);
    if (j & 2) A.flat(x - cw, z + cw, x + cw, z + c2, 0.04, P.asphalt);
    if (j & 8) A.flat(x - cw, z - c2, x + cw, z - cw, 0.04, P.asphalt);
    // Pavements, raised a kerb's height: along every arm's sides, across the end of a side with no street.
    const kerb = (x0: number, z0: number, x1: number, z1: number) => {
      const Fw = new Frame((x0 + x1) / 2, (z0 + z1) / 2, 0, 1);
      PV.box(Fw, -(x1 - x0) / 2, (x1 - x0) / 2, 0, kh + 0.012, -(z1 - z0) / 2, (z1 - z0) / 2, P.kerb, P.kerbTop);
    };
    const slab = (x0: number, z0: number, x1: number, z1: number) => {
      const Fw = new Frame((x0 + x1) / 2, (z0 + z1) / 2, 0, 1);
      PV.box(Fw, -(x1 - x0) / 2, (x1 - x0) / 2, 0, kh, -(z1 - z0) / 2, (z1 - z0) / 2, P.kerb, P.pavement);
    };
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ex = sx > 0 ? (j & 1) : (j & 4), ez = sz > 0 ? (j & 2) : (j & 8);
      // The corner quadrant: an L of pavement where both arms run, or a band beside the one that does.
      const ax = [x + sx * cw, x + sx * c2].sort((a, b) => a - b) as [number, number];
      const az = [z + sz * cw, z + sz * c2].sort((a, b) => a - b) as [number, number];
      const bx = [x + sx * cw, x + sx * pw].sort((a, b) => a - b) as [number, number];
      const bz = [z + sz * cw, z + sz * pw].sort((a, b) => a - b) as [number, number];
      if (ex) slab(ax[0], bz[0], ax[1], bz[1]);
      if (ez) slab(bx[0], az[0], bx[1], az[1]);
      if (!ex && !ez) slab(bx[0], bz[0], bx[1], bz[1]);
      else if (ex && ez) slab(bx[0], bz[0], bx[1], bz[1]);
      // Kerb stones along the carriageway's edge, a shade lighter than the paving.
      const kz = [z + sz * cw, z + sz * (cw + 0.28)].sort((a, b) => a - b) as [number, number];
      const kx = [x + sx * cw, x + sx * (cw + 0.28)].sort((a, b) => a - b) as [number, number];
      if (ex) kerb(ax[0], kz[0], ax[1], kz[1]);
      if (ez) kerb(kx[0], az[0], kx[1], az[1]);
      if (!ex && !ez) { kerb(bx[0], kz[0], bx[1], kz[1]); kerb(kx[0], bz[0], kx[1], bz[1]); }
    }
    if (!(j & 1)) kerb(x + cw, z - cw, x + cw + 0.28, z + cw);
    if (!(j & 4)) kerb(x - cw - 0.28, z - cw, x - cw, z + cw);
    if (!(j & 2)) kerb(x - cw, z + cw, x + cw, z + cw + 0.28);
    if (!(j & 8)) kerb(x - cw, z - cw - 0.28, x + cw, z - cw);
    // The verge: mown grass between the pavement and the lots.
    G.who = -1;
    G.flat(x - c2, z - c2, x + c2, z + c2, 0.015, P.verge);
    // Ends with no street: pavement across the end of the carriageway.
    if (!(j & 1)) slab(x + cw, z - cw, x + pw, z + cw);
    if (!(j & 4)) slab(x - pw, z - cw, x - cw, z + cw);
    if (!(j & 2)) slab(x - cw, z + cw, x + cw, z + pw);
    if (!(j & 8)) slab(x - cw, z - pw, x + cw, z - cw);
    // Markings: a dashed centre line along straight runs; a stop line where a street meets a junction.
    const n = [j & 1, j & 2, j & 4, j & 8].filter(Boolean).length;
    const straightEW = j === 5, straightNS = j === 10;
    const dash = (x0: number, z0: number, x1: number, z1: number) => M.flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), 0.06, P.marking);
    if (straightEW) for (let k = -c2 + 1.5; k < c2; k += 6) dash(x + k, z - 0.08, x + k + 3, z + 0.08);
    if (straightNS) for (let k = -c2 + 1.5; k < c2; k += 6) dash(x - 0.08, z + k, x + 0.08, z + k + 3);
    if (n >= 3 || (n === 2 && !straightEW && !straightNS)) {
      // At a junction: short dashes on each arm, and a give-way line across its near half.
      if (j & 1) { dash(x + cw + 1, z - 0.08, x + cw + 4, z + 0.08); dash(x + cw + 7, z - 0.08, x + cw + 10, z + 0.08); }
      if (j & 4) { dash(x - cw - 4, z - 0.08, x - cw - 1, z + 0.08); dash(x - cw - 10, z - 0.08, x - cw - 7, z + 0.08); }
      if (j & 2) { dash(x - 0.08, z + cw + 1, x + 0.08, z + cw + 4); dash(x - 0.08, z + cw + 7, x + 0.08, z + cw + 10); }
      if (j & 8) { dash(x - 0.08, z - cw - 4, x + 0.08, z - cw - 1); dash(x - 0.08, z - cw - 10, x + 0.08, z - cw - 7); }
    }
  }

  // Lamps along the pavements: every street cell, alternating sides, at the pavement's outer edge.
  const lamps: TownModel["lamps"] = [];
  for (const [id, j] of plan.joins) {
    const [x, z] = plan.centre(id);
    const k = (id % plan.W) + Math.floor(id / plan.W);
    const side = k % 2 ? 1 : -1;
    const e = pw - 0.5;
    if (j === 5) lamps.push({ x, z: z + side * e, heading: side > 0 ? Math.PI : 0 });
    else if (j === 10) lamps.push({ x: x + side * e, z, heading: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    else if (k % 2 === 0) lamps.push({ x: x + e, z: z + e, heading: Math.PI * 1.25 });
  }

  // ---------- The ground's own furniture: hedgerows round the fields ----------
  const { w: GW, h: GH } = town.ground;
  const cover = coverGrid(town);
  const farm = cover.names.indexOf("farmland");
  HG.who = -1;
  if (farm >= 0) {
    for (let by = 0; by < GH; by += 3) for (let bx = 0; bx < GW; bx += 3) {
      const ci = by * GW + bx;
      if (cover.grid[ci] !== farm) continue;
      const tone = blend(P.hedge, col("#55693c"), h01(ci, 4));
      // North and west edges of each 3x3 field (the next field's edges close it).
      for (const [horiz] of [[true], [false]] as const) {
        if (h01(ci, horiz ? 5 : 6) < 0.12) continue; // a gap: a gate, or a hedge grubbed out
        const x0 = bx * cell, z0 = by * cell, len = 3 * cell;
        const Fh = new Frame(horiz ? x0 + len / 2 : x0, horiz ? z0 : z0 + len / 2, 0, 1);
        const hh = 1.4 + h01(ci, 7) * 1.2;
        if (horiz) HG.box(Fh, -len / 2, len / 2, 0, hh, -0.8, 0.8, shade(tone, 0.85), tone);
        else HG.box(Fh, -0.8, 0.8, 0, hh, -len / 2, len / 2, shade(tone, 0.85), tone);
      }
    }
  }

  // ---------- Trees ----------
  const trees: TreeSpec[] = [];
  const taken = new Uint8Array(GW * GH);
  for (const s of town.structures) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (x < GW && y < GH) taken[y * GW + x] = s.category === "green" ? 2 : 1;
  const perCover: Record<string, number> = { woodland: 7, scrub: 0.6, grassland: 0.05, riverbank: 0.7, wetland: 0.35, farmland: 0.04 };
  const town0 = town.places.find((p) => p.kind === "town")?.area;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ci = y * GW + x;
    const name = cover.names[cover.grid[ci]!] ?? "ground";
    if (taken[ci] === 1) continue;
    const inTown = town0 && x >= town0.x && y >= town0.y && x < town0.x + town0.w && y < town0.y + town0.h;
    let n = taken[ci] === 2 ? 4 : inTown ? (h01(ci, 31) < 0.35 ? 1 : 0) : perCover[name] ?? 0;
    if (n < 1) n = h01(ci, 32) < n ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const a = h01(ci * 11 + k, 1), b = h01(ci * 11 + k, 2), c = h01(ci * 11 + k, 3);
      const conifer = name === "woodland" && h01(ci * 11 + k, 4) < 0.3;
      trees.push({ x: (x + 0.08 + a * 0.84) * cell, z: (y + 0.08 + b * 0.84) * cell, h: (conifer ? 11 : 8) + c * 7, r: conifer ? 2.6 + c : 3.2 + c * 2.4, kind: conifer ? 1 : 0, tone: h01(ci * 11 + k, 5) });
    }
  }
  // Street trees on the verges, and a tree in many back gardens.
  for (const [id, j] of plan.joins) {
    if (h01(id, 41) > 0.3 || (j !== 5 && j !== 10)) continue;
    const [x, z] = plan.centre(id);
    const side = h01(id, 42) < 0.5 ? -1 : 1, off = pw + 2.6;
    trees.push({ x: j === 5 ? x + 6 : x + side * off, z: j === 5 ? z + side * off : z + 6, h: 7 + h01(id, 43) * 4, r: 2.6 + h01(id, 44) * 1.4, kind: 0, tone: h01(id, 45) });
  }
  town.structures.forEach((s, i) => {
    const L = plan.lots[i];
    if (!L || s.category !== "residential" || (s.spaces.dwelling ?? 0) > 1 || h01(i, 51) < 0.4) return;
    const F = new Frame(L.cx, L.cz, L.face[0], L.face[1]);
    const lx = (h01(i, 52) - 0.5) * 14, lz = -9 - h01(i, 53) * 2;
    trees.push({ x: F.x(lx, lz), z: F.z(lx, lz), h: 6 + h01(i, 54) * 5, r: 2.4 + h01(i, 55) * 1.8, kind: h01(i, 56) < 0.2 ? 1 : 0, tone: h01(i, 57) });
  });

  // ---------- Assemble ----------
  // Each building's bounding box (for hiding labels behind buildings).
  const boxes = new Float32Array(nS * 6);
  for (let i = 0; i < nS; i++) boxes.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], i * 6);
  for (let tri = 0; tri < B.owner.length; tri++) {
    const o = B.owner[tri]!;
    if (o < 0) continue;
    for (let v = 0; v < 3; v++) {
      const p = (tri * 3 + v) * 3;
      for (let a = 0; a < 3; a++) {
        const x = B.pos[p + a]!;
        if (x < boxes[o * 6 + a]!) boxes[o * 6 + a] = x;
        if (x > boxes[o * 6 + 3 + a]!) boxes[o * 6 + 3 + a] = x;
      }
    }
  }
  return {
    buildings: B.geometry(), buildingOwner: Int32Array.from(B.owner), later,
    ground: G.geometry(), asphalt: A.geometry(), pavement: PV.geometry(), markings: M.geometry(), hedges: HG.geometry(),
    windows, shopGlass, chimneys, lamps, trees, tops, centres, clock, fronts, boxes,
  };
}

export function coverGrid(town: TownBundle): { grid: Uint8Array; names: string[] } {
  const { w, h } = town.ground;
  const grid = new Uint8Array(w * h);
  const names = ["ground"];
  for (const r of town.terrain) {
    let k = names.indexOf(r.cover);
    if (k < 0) { k = names.length; names.push(r.cover); }
    for (let y = r.y; y < Math.min(h, r.y + r.h); y++) for (let x = r.x; x < Math.min(w, r.x + r.w); x++) grid[y * w + x] = k;
  }
  return { grid, names };
}

// ---------- Building kinds ----------

interface Ctx {
  F: Frame; B: Buf; G: Buf; windows: Panels; shopGlass: Panels; i: number; r: number; r2: number; r3: number;
  /** Half the lot's depth; the lot's front edge is at local z = +half. */
  half: number; w: number; chimneys: Chimney[];
}
interface Built { door: [number, number]; height: number; cz?: number; clock?: TownModel["clock"] }

const FL = 2.9;

/** Windows along one wall: `n` evenly between u0 and u1, at height y. Front/back walls run along x; sides along z. */
function row(c: Ctx, side: "front" | "back" | "left" | "right", wall: number, u0: number, u1: number, y: number, n: number, w = 1.2, h = 1.4, skip?: (k: number) => boolean) {
  for (let k = 0; k < n; k++) {
    if (skip?.(k)) continue;
    const u = u0 + ((k + 0.5) / n) * (u1 - u0);
    const seed = h01(c.i * 131 + k * 7 + Math.round(y * 10), side.length);
    if (side === "front") c.windows.add(c.F, u, y, wall + 0.05, w, h, "front", c.i, seed);
    else if (side === "back") c.windows.add(c.F, u, y, wall - 0.05, w, h, "back", c.i, seed);
    else if (side === "right") c.windows.add(c.F, wall + 0.05, y, u, w, h, "right", c.i, seed);
    else c.windows.add(c.F, wall - 0.05, y, u, w, h, "left", c.i, seed);
  }
}

/** A garden: lawn over the lot, a paved path from the door to the front, a hedge or low wall along the front. */
function garden(c: Ctx, doorX: number, frontZ: number, drive?: [number, number]) {
  const { F, G, half } = c;
  const W = c.w / 2 - 0.3;
  G.flatF(F, -W, W, -half + 0.3, half - 0.3, 0.025, pick(P.lawns, h01(c.i, 9)));
  G.flatF(F, doorX - 0.7, doorX + 0.7, frontZ, half, 0.035, P.paving);
  if (drive) G.flatF(F, drive[0], drive[1], frontZ - 4, half, 0.035, P.gravel);
  const hedge = h01(c.i, 10) < 0.6;
  const seg = (x0: number, x1: number) => {
    if (x1 - x0 < 0.3) return;
    if (hedge) G.box(F, x0, x1, 0, 1.0, half - 1.1, half - 0.4, P.hedge, blend(P.hedge, col("#5a7444"), 0.4));
    else G.box(F, x0, x1, 0, 0.7, half - 0.9, half - 0.6, P.fence);
  };
  const gaps: [number, number][] = [[doorX - 0.8, doorX + 0.8]];
  if (drive) gaps.push([drive[0] - 0.2, drive[1] + 0.2]);
  gaps.sort((a, b) => a[0] - b[0]);
  let x = -W;
  for (const [g0, g1] of gaps) { seg(x, g0); x = Math.max(x, g1); }
  seg(x, W);
}

function house(c: Ctx): Built {
  const { F, B, r, r2, r3 } = c;
  const bungalow = r < 0.25;
  const floors = bungalow ? 1 : 2;
  const w = 8.5 + r2 * 2.5, d = 7.5 + r3 * 1.5;
  const x0 = -w / 2 - 2, x1 = w / 2 - 2;
  const front = 6.5 - r * 1.5, back = front - d;
  const wall = r2 < 0.55 ? pick(P.brick, r3) : pick(P.render, r3);
  const roof = r3 < 0.6 ? pick(P.slate, r) : pick(P.tile, r);
  const eave = floors * FL;
  B.box(F, x0, x1, 0, eave, back, front, wall);
  // Plinth.
  B.box(F, x0 - 0.05, x1 + 0.05, 0, 0.35, back - 0.05, front + 0.05, shade(wall, 0.7));
  const alongX = r < 0.75;
  const rise = alongX ? d * 0.42 : w * 0.38;
  B.gable(F, x0, x1, back, front, eave, rise, roof, wall, alongX);
  // A chimney stack on one end.
  const cx = r2 < 0.5 ? x0 + 0.9 : x1 - 0.9;
  B.box(F, cx - 0.4, cx + 0.4, eave + rise * 0.5, eave + rise + 0.9, back + d * 0.45, back + d * 0.45 + 0.7, shade(wall, 0.9));
  // Door and porch.
  const doorX = x0 + w * (r < 0.5 ? 0.28 : 0.72);
  B.box(F, doorX - 0.5, doorX + 0.5, 0.1, 2.1, front, front + 0.08, pick(P.door, r2 * 7));
  if (r3 < 0.45) { B.box(F, doorX - 0.9, doorX + 0.9, 2.3, 2.45, front, front + 1.0, shade(roof, 0.9)); }
  // Windows: the ground floor beside the door, the upper floor across the front; the back and the sides.
  row(c, "front", front, x0 + 0.6, x1 - 0.6, 1.45, 3, 1.15, 1.35, (k) => Math.abs(x0 + 0.6 + ((k + 0.5) / 3) * (w - 1.2) - doorX) < 1.1);
  if (floors > 1) row(c, "front", front, x0 + 0.6, x1 - 0.6, FL + 1.45, 3, 1.1, 1.25);
  for (let f = 0; f < floors; f++) row(c, "back", back, x0 + 0.6, x1 - 0.6, f * FL + 1.45, 2, 1.1, 1.25);
  row(c, "left", x0, back + 1, front - 1, floors * FL - 1.3, 1, 0.9, 1.0);
  garden(c, doorX, front, [x1 + 1.0, x1 + 3.8]);
  return { door: [doorX, front], height: eave + rise, cz: (front + back) / 2 };
}

function largeHouse(c: Ctx): Built {
  const { F, B, r, r2, r3 } = c;
  const w = 12 + r2 * 3, d = 9 + r3 * 2;
  const x0 = -w / 2 - 1.5, x1 = w / 2 - 1.5;
  const front = 5.5 - r, back = front - d;
  const wall = r2 < 0.5 ? pick(P.brick, r) : pick(P.render, r);
  const roof = pick(r3 < 0.5 ? P.slate : P.tile, r2);
  const eave = 2 * FL + 0.2;
  B.box(F, x0, x1, 0, eave, back, front, wall);
  B.box(F, x0 - 0.05, x1 + 0.05, 0, 0.4, back - 0.05, front + 0.05, shade(wall, 0.7));
  B.hip(F, x0, x1, back, front, eave, d * 0.4, roof, 0.5);
  // A bay at the front and a garage to one side.
  const bx = x0 + w * 0.25;
  B.box(F, bx - 1.6, bx + 1.6, 0, FL, front, front + 1.0, wall);
  B.box(F, bx - 1.75, bx + 1.75, FL, FL + 0.25, front - 0.1, front + 1.15, shade(roof, 0.9));
  c.windows.add(F, bx, 1.5, front + 1.05, 2.4, 1.5, "front", c.i, h01(c.i, 77));
  B.box(F, x1 + 0.2, x1 + 3.6, 0, 2.7, back + 2, front - 1, shade(wall, 0.95), shade(roof, 0.8));
  B.box(F, x1 + 0.5, x1 + 3.3, 0.05, 2.2, front - 1, front - 0.93, P.frame);
  const doorX = x0 + w * 0.62;
  B.box(F, doorX - 0.55, doorX + 0.55, 0.1, 2.2, front, front + 0.08, pick(P.door, r3 * 5));
  row(c, "front", front, doorX + 1.2, x1 - 0.5, 1.5, 1, 1.2, 1.4);
  row(c, "front", front, x0 + 0.6, x1 - 0.6, FL + 1.5, 4, 1.1, 1.3);
  for (let f = 0; f < 2; f++) row(c, "back", back, x0 + 0.6, x1 - 0.6, f * FL + 1.5, 3, 1.2, 1.4);
  row(c, "left", x0, back + 1, front - 1, 1.5, 2, 1.1, 1.3);
  row(c, "left", x0, back + 1, front - 1, FL + 1.5, 2, 1.1, 1.3);
  B.box(F, x0 + 1.5, x0 + 2.3, eave, eave + d * 0.4 + 0.6, back + 2, back + 2.8, shade(wall, 0.85));
  garden(c, doorX, front, [x1 + 0.6, x1 + 3.2]);
  return { door: [doorX, front], height: eave + d * 0.4, cz: (front + back) / 2 };
}

function apartments(c: Ctx): Built {
  const { F, B, G, r, r2, r3, half } = c;
  const floors = 4 + (r < 0.4 ? 1 : 0);
  const w = 19, d = 12.5;
  const front = 8, back = front - d;
  const wall = r2 < 0.5 ? pick(P.buff, r3) : pick(P.render, r3);
  const h = floors * 3.0 + 0.6;
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  // Parapet, a stair-core on the roof, a base course.
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.7, back - 0.1, back + 0.25, shade(wall, 0.85));
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.7, front - 0.25, front + 0.1, shade(wall, 0.85));
  B.box(F, -w / 2 - 0.1, -w / 2 + 0.25, h, h + 0.7, back, front, shade(wall, 0.85));
  B.box(F, w / 2 - 0.25, w / 2 + 0.1, h, h + 0.7, back, front, shade(wall, 0.85));
  B.box(F, -2, 2, h, h + 2.6, back + 3, back + 7, shade(wall, 0.9), P.darkConcrete);
  B.box(F, -w / 2 - 0.05, w / 2 + 0.05, 0, 0.9, back - 0.05, front + 0.05, P.darkConcrete);
  // Entrance with a canopy in the middle of the front; balconies either side on each upper floor.
  B.box(F, -1.1, 1.1, 0.1, 2.4, front, front + 0.08, col("#30363d"));
  B.box(F, -2.2, 2.2, 2.7, 2.9, front, front + 1.6, P.darkConcrete);
  for (let f = 1; f < floors; f++) {
    for (const bx of [-6.2, 5.2]) {
      B.box(F, bx - 1.8, bx + 1.8, f * 3.0, f * 3.0 + 0.18, front, front + 1.3, P.concrete);
      B.box(F, bx - 1.8, bx + 1.8, f * 3.0 + 0.18, f * 3.0 + 1.05, front + 1.22, front + 1.3, shade(P.concrete, 0.8));
    }
  }
  for (let f = 0; f < floors; f++) {
    const y = f * 3.0 + 1.6;
    row(c, "front", front, -w / 2 + 0.8, w / 2 - 0.8, y, 6, 1.3, 1.45, (k) => f === 0 && (k === 2 || k === 3));
    row(c, "back", back, -w / 2 + 0.8, w / 2 - 0.8, y, 6, 1.3, 1.45);
    row(c, "left", -w / 2, back + 1, front - 1, y, 3, 1.2, 1.4);
    row(c, "right", w / 2, back + 1, front - 1, y, 3, 1.2, 1.4);
  }
  // Grounds: a lawn round it, paved forecourt, bins store.
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.lawn2);
  G.flatF(F, -3.5, 3.5, front, half, 0.035, P.paving);
  G.box(F, 7.5, 10, 0, 1.5, front + 1, front + 2.5, P.concrete);
  return { door: [0, front], height: h + 0.7, cz: (front + back) / 2 };
}

function shop(c: Ctx): Built {
  const { F, B, G, r, r2, r3, half } = c;
  const w = 13 + r2 * 4, d = 12;
  const front = half - 2.2, back = front - d;
  const floors = r < 0.7 ? 2 : 1;
  const wall = r3 < 0.5 ? pick(P.brick, r) : pick(P.render, r);
  const h = floors * 3.3 + 0.5;
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  // A parapet at the front with a pitched roof behind, or a flat roof.
  B.box(F, -w / 2, w / 2, h, h + 0.9, front - 0.3, front, wall);
  if (r2 < 0.6) B.gable(F, -w / 2 + 0.2, w / 2 - 0.2, back + 0.2, front - 0.4, h, 2.6, pick(P.slate, r3), wall, true, 0.1);
  // Shopfront: a fascia board, glazing either side of a door, an awning.
  const awning = pick(P.awning, r3 * 3);
  B.box(F, -w / 2 + 0.3, w / 2 - 0.3, 2.9, 3.5, front, front + 0.18, P.sign);
  B.box(F, -w / 2 + 0.3, w / 2 - 0.3, 0, 0.45, front, front + 0.12, shade(wall, 0.7));
  B.box(F, -0.6, 0.6, 0.05, 2.5, front, front + 0.06, col("#2b3036"));
  c.shopGlass.add(F, -w / 4 - 0.15, 1.65, front + 0.07, w / 2 - 1.9, 2.3, "front", c.i, h01(c.i, 3));
  c.shopGlass.add(F, w / 4 + 0.15, 1.65, front + 0.07, w / 2 - 1.9, 2.3, "front", c.i, h01(c.i, 4));
  // The awning: a sloped canvas with a valance.
  const ax0 = -w / 2 + 0.4, ax1 = w / 2 - 0.4;
  const Pz = (x: number, y: number, z: number) => new THREE.Vector3(F.x(x, z), y, F.z(x, z));
  const inside = Pz(0, 0, front - 3);
  B.poly([Pz(ax0, 2.85, front + 0.1), Pz(ax1, 2.85, front + 0.1), Pz(ax1, 2.3, front + 2.0), Pz(ax0, 2.3, front + 2.0)], awning, inside);
  B.poly([Pz(ax0, 2.3, front + 2.0), Pz(ax1, 2.3, front + 2.0), Pz(ax1, 2.0, front + 2.02), Pz(ax0, 2.0, front + 2.02)], shade(awning, 0.8), inside);
  if (floors > 1) row(c, "front", front, -w / 2 + 1, w / 2 - 1, 3.3 + 1.6, 3, 1.3, 1.5);
  for (let f = 0; f < floors; f++) row(c, "back", back, -w / 2 + 1, w / 2 - 1, f * 3.3 + 1.6, 2, 1.2, 1.3);
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.forecourt);
  return { door: [0, front], height: h + (r2 < 0.6 ? 2.6 : 0.9), cz: (front + back) / 2 };
}

function shopUnit(c: Ctx): Built {
  const { F, B, G, r, half } = c;
  const w = 18, d = 14, front = half - 4, back = front - d, h = 5.2;
  const wall = r < 0.5 ? col("#a7aaa6") : col("#8f9a93");
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  B.box(F, -w / 2, w / 2, h - 0.8, h, front, front + 0.15, P.sign);
  B.box(F, -7, -1.5, 0.05, 3.8, front, front + 0.06, col("#c3c5c1"));
  B.box(F, 1, 2.2, 0.05, 2.2, front, front + 0.06, col("#30363d"));
  c.shopGlass.add(F, 5.2, 1.6, front + 0.07, 4.6, 2.4, "front", c.i, h01(c.i, 3));
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.yard);
  return { door: [1.6, front], height: h, cz: (front + back) / 2 };
}

function offices(c: Ctx): Built {
  const { F, B, G, r, half } = c;
  const w = 18, d = 15, front = half - 4, back = front - d, floors = 5, fh = 3.5;
  const wall = r < 0.5 ? col("#c9c3b5") : col("#b3b7b6");
  const h = floors * fh + 0.4;
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.6, back - 0.1, front + 0.1, shade(wall, 0.85), P.darkConcrete);
  B.box(F, -2.5, 2.5, h, h + 2.2, back + 4, back + 8, shade(wall, 0.85));
  B.box(F, -1.6, 1.6, 0.05, 2.8, front, front + 0.06, col("#2b3036"));
  B.box(F, -3, 3, 3.1, 3.3, front, front + 2.0, P.darkConcrete);
  for (let f = 0; f < floors; f++) {
    const y = f * fh + 1.9;
    row(c, "front", front, -w / 2 + 0.6, w / 2 - 0.6, y, 7, 1.9, 1.9, (k) => f === 0 && k === 3);
    row(c, "back", back, -w / 2 + 0.6, w / 2 - 0.6, y, 7, 1.9, 1.9);
    row(c, "left", -w / 2, back + 0.8, front - 0.8, y, 5, 1.9, 1.9);
    row(c, "right", w / 2, back + 0.8, front - 0.8, y, 5, 1.9, 1.9);
  }
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.forecourt);
  return { door: [0, front], height: h + 2.2, cz: (front + back) / 2 };
}

function factory(c: Ctx): Built {
  const { F, B, G, r, r2, half } = c;
  const w = 21, d = 17, front = half - 3.5, back = front - d, h = 7.5 + r * 2;
  const wall = r2 < 0.5 ? P.metal : col("#8c7f72");
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall);
  B.box(F, -w / 2 - 0.05, w / 2 + 0.05, 0, 1.2, back - 0.05, front + 0.05, pick(P.brick, r));
  // A saw-tooth roof: four bays, glazed slopes facing back.
  const bays = 4, bw = d / bays;
  const Pz = (x: number, y: number, z: number) => new THREE.Vector3(F.x(x, z), y, F.z(x, z));
  for (let k = 0; k < bays; k++) {
    const z0 = back + k * bw, z1 = z0 + bw;
    const inside = Pz(0, h, (z0 + z1) / 2);
    B.poly([Pz(-w / 2, h, z0), Pz(w / 2, h, z0), Pz(w / 2, h + 2.6, z1), Pz(-w / 2, h + 2.6, z1)], shade(P.slate[0]!, 1.1), inside);
    B.poly([Pz(-w / 2, h, z1), Pz(w / 2, h, z1), Pz(w / 2, h + 2.6, z1), Pz(-w / 2, h + 2.6, z1)], col("#5f6f78"), inside);
    B.poly([Pz(-w / 2, h, z0), Pz(-w / 2, h, z1), Pz(-w / 2, h + 2.6, z1)], wall, inside);
    B.poly([Pz(w / 2, h, z0), Pz(w / 2, h, z1), Pz(w / 2, h + 2.6, z1)], wall, inside);
  }
  // Loading doors, an office block at the front corner, and a brick chimney stack.
  B.box(F, -8, -3, 0.05, 4.5, front, front + 0.08, col("#5d6468"));
  B.box(F, 2, 9.5, 0, 6, front, front + 4.5, pick(P.brick, r2), P.darkConcrete);
  B.box(F, 5, 6.2, 0.05, 2.3, front + 4.5, front + 4.56, col("#30363d"));
  row(c, "front", front + 4.5, 2.2, 9.3, 1.7, 3, 1.3, 1.4, (k) => k === 1);
  row(c, "front", front + 4.5, 2.2, 9.3, 4.4, 3, 1.3, 1.4);
  row(c, "left", -w / 2, back + 1, front - 1, 3.5, 5, 1.6, 1.1);
  const sx = -w / 2 + 2.5, sz = back + 2.5, sh = 24 + r * 6;
  B.prism(F, sx, sz, 1.4, 0, sh, pick(P.brick, r * 3), 10, col("#3a3a3a"), 1.0);
  B.prism(F, sx, sz, 1.2, sh, sh + 0.8, col("#5a4a40"), 10, col("#262626"), 1.2);
  c.chimneys.push({ x: F.x(sx, sz), y: sh + 0.8, z: F.z(sx, sz), owner: c.i, scale: 1 });
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.yard);
  return { door: [5.6, front + 4.5], height: h + 2.6, cz: (front + back) / 2 };
}

function yard(c: Ctx): Built {
  const { F, B, G, half } = c;
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.yard);
  B.box(F, -9, 1, 0, 4.5, -8, 2, P.metal);
  B.gable(F, -9, 1, -8, 2, 4.5, 1.4, P.slate[1]!, P.metal, false, 0.3);
  B.box(F, -7, -3, 0.05, 3.5, 2, 2.06, col("#5d6468"));
  for (let k = 0; k < 6; k++) B.box(F, 3 + (k % 3) * 2.6, 5.2 + (k % 3) * 2.6, 0, 1.2 + (k % 2) * 1.2, -6 + Math.floor(k / 3) * 3, -4 + Math.floor(k / 3) * 3, col(k % 2 ? "#8a6b4a" : "#9a7a52"));
  // A fence round the yard.
  for (const [x0, x1, z0, z1] of [[-12, 12, half - 1, half - 0.9], [-12, 12, -half + 0.9, -half + 1], [-12, -11.9, -half + 1, half - 1], [11.9, 12, -half + 1, half - 1]] as const) {
    if (z0 === half - 1) { G.box(F, x0, -2, 0, 1.8, z0, z1, P.fence); G.box(F, 2, x1, 0, 1.8, z0, z1, P.fence); }
    else G.box(F, x0, x1, 0, 1.8, z0, z1, P.fence);
  }
  return { door: [-5, 2], height: 6 };
}

function townHall(c: Ctx): Built {
  const { F, B, G, r, half } = c;
  const w = 22, d = 15, front = half - 5.5, back = front - d, floors = 2, fh = 4.3, h = floors * fh + 0.6;
  const stone = P.stone, roof = P.slate[2]!;
  B.box(F, -w / 2, w / 2, 0, h, back, front, stone);
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, 0, 1.0, back - 0.1, front + 0.1, shade(stone, 0.8));
  B.box(F, -w / 2 - 0.15, w / 2 + 0.15, h - 0.4, h, back - 0.15, front + 0.15, shade(stone, 0.92));
  B.hip(F, -w / 2, w / 2, back, front, h, 4.2, roof, 0.4);
  // Portico: steps, four columns, a pediment.
  for (let k = 0; k < 3; k++) B.box(F, -5.2 - k * 0.4, 5.2 + k * 0.4, 0, 0.35 + (2 - k) * 0.35, front, front + 4.2 + k * 0.6, shade(stone, 0.9));
  for (const x of [-4.2, -1.4, 1.4, 4.2]) B.prism(F, x, front + 3.3, 0.42, 1.05, 6.6, shade(stone, 1.05), 10);
  B.box(F, -5.2, 5.2, 6.6, 7.4, front, front + 4.0, shade(stone, 0.95));
  B.gable(F, -5.2, 5.2, front, front + 4.0, 7.4, 2.0, roof, shade(stone, 0.95), false, 0.2);
  B.box(F, -1.3, 1.3, 1.05, 4.0, front, front + 0.08, col("#3a2c24"));
  for (let f = 0; f < floors; f++) {
    const y = f * fh + 2.4;
    row(c, "front", front, -w / 2 + 0.8, w / 2 - 0.8, y, 7, 1.3, 2.2, (k) => k >= 2 && k <= 4);
    row(c, "back", back, -w / 2 + 0.8, w / 2 - 0.8, y, 7, 1.3, 2.2);
    row(c, "left", -w / 2, back + 1, front - 1, y, 4, 1.3, 2.2);
    row(c, "right", w / 2, back + 1, front - 1, y, 4, 1.3, 2.2);
  }
  row(c, "front", front, -4, 4, fh + 2.4, 3, 1.3, 2.2);
  // The clock tower, rising from the middle of the roof.
  const tz = (front + back) / 2 - 1, ts = 4.6, tb = h, tt = h + 12;
  B.box(F, -ts / 2, ts / 2, tb, tt, tz - ts / 2, tz + ts / 2, shade(stone, 1.02));
  B.box(F, -ts / 2 - 0.25, ts / 2 + 0.25, tt, tt + 0.5, tz - ts / 2 - 0.25, tz + ts / 2 + 0.25, shade(stone, 0.9));
  // The belfry: open arches, read as dark recesses.
  for (const s of ["front", "back", "left", "right"] as const) {
    const o = ts / 2 + 0.03;
    if (s === "front") B.box(F, -1, 1, tt - 4.5, tt - 2.2, tz + o - 0.05, tz + o, col("#2b2622"));
    if (s === "back") B.box(F, -1, 1, tt - 4.5, tt - 2.2, tz - o, tz - o + 0.05, col("#2b2622"));
    if (s === "left") B.box(F, -o, -o + 0.05, tt - 4.5, tt - 2.2, tz - 1, tz + 1, col("#2b2622"));
    if (s === "right") B.box(F, o - 0.05, o, tt - 4.5, tt - 2.2, tz - 1, tz + 1, col("#2b2622"));
  }
  B.hip(F, -ts / 2 - 0.2, ts / 2 + 0.2, tz - ts / 2 - 0.2, tz + ts / 2 + 0.2, tt + 0.5, 6.5, P.copper, 0.1);
  // Clock faces, just under the belfry.
  const cy = tt - 6.6, cr = 1.35;
  const faces: NonNullable<Built["clock"]>["faces"] = [];
  for (const [ox, oz, out] of [[0, ts / 2, "front"], [0, -ts / 2, "back"], [ts / 2, 0, "right"], [-ts / 2, 0, "left"]] as const) {
    const ang = F.heading + (out === "front" ? 0 : out === "back" ? Math.PI : out === "right" ? -Math.PI / 2 : Math.PI / 2);
    faces.push({ x: F.x(ox * 1.02, tz + oz * 1.02), y: cy, z: F.z(ox * 1.02, tz + oz * 1.02), heading: ang });
  }
  // Forecourt: paving, a flagpole.
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.lawn);
  G.flatF(F, -9, 9, front, half, 0.035, P.paving);
  B.prism(F, 8, front + 4.5, 0.08, 0, 11, col("#d8d8d8"), 6);
  void r;
  return { door: [0, front + 4.6], height: tt + 7, cz: (front + back) / 2, clock: { faces, r: cr } };
}

function station(c: Ctx): Built {
  const { F, B, G, half } = c;
  const w = 20, d = 9, front = half - 5, back = front - d, h = 4.2;
  const wall = pick(P.brick, 0.2);
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall);
  B.gable(F, -w / 2, w / 2, back, front, h, 2.6, P.slate[0]!, wall, true, 0.5);
  // The canopy over the platform side, on columns.
  B.box(F, -w / 2 - 2, w / 2 + 2, h - 0.3, h, back - 5, back, col("#5a6a62"));
  for (let x = -w / 2; x <= w / 2; x += 5) B.prism(F, x, back - 4.3, 0.15, 0, h - 0.3, col("#3b4a44"), 6);
  B.box(F, -w / 2 - 2, w / 2 + 2, 0, 0.9, back - 7, back - 4.8, P.concrete);
  B.box(F, -1.2, 1.2, 0.05, 2.6, front, front + 0.08, col("#2b3036"));
  row(c, "front", front, -w / 2 + 1, w / 2 - 1, 1.7, 6, 1.4, 1.8, (k) => k === 2 || k === 3);
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.forecourt);
  return { door: [0, front], height: h + 2.6, cz: (front + back) / 2 };
}

function clinic(c: Ctx): Built {
  const { F, B, G, half } = c;
  const w = 20, d = 13, front = half - 5, back = front - d, fh = 3.6, h = 2 * fh + 0.5;
  const wall = col("#e6e3da");
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.6, back - 0.1, front + 0.1, shade(wall, 0.88), P.darkConcrete);
  B.box(F, -w / 2, w / 2, 0, 0.8, back - 0.02, front + 0.02, col("#9aa3a0"));
  // An entrance with a wide canopy; a sign board in the institutions' green.
  B.box(F, -1.8, 1.8, 0.05, 2.6, front, front + 0.06, col("#2b3036"));
  B.box(F, -4.5, 4.5, 3.0, 3.25, front, front + 3.2, col("#d4d2cb"));
  for (const x of [-4.2, 4.2]) B.prism(F, x, front + 3.0, 0.12, 0, 3.0, col("#9aa3a0"), 6);
  B.box(F, -3.6, 3.6, 3.5, 4.3, front, front + 0.12, col("#2F7D5B"));
  for (let f = 0; f < 2; f++) {
    const y = f * fh + 1.9;
    row(c, "front", front, -w / 2 + 0.8, w / 2 - 0.8, y, 7, 1.5, 1.5, (k) => f === 0 && k >= 2 && k <= 4);
    row(c, "back", back, -w / 2 + 0.8, w / 2 - 0.8, y, 7, 1.5, 1.5);
    row(c, "left", -w / 2, back + 1, front - 1, y, 4, 1.5, 1.5);
    row(c, "right", w / 2, back + 1, front - 1, y, 4, 1.5, 1.5);
  }
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.lawn);
  G.flatF(F, -6, 6, front, half, 0.035, P.paving);
  return { door: [0, front], height: h + 0.6, cz: (front + back) / 2 };
}

function school(c: Ctx): Built {
  const { F, B, G, half } = c;
  const w = 21, d = 9, front = half - 9, back = front - d, fh = 3.6, h = 2 * fh + 0.5;
  const wall = pick(P.brick, 0.6);
  B.box(F, -w / 2, w / 2, 0, h, back, front, wall, P.darkConcrete);
  B.box(F, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.6, back - 0.1, front + 0.1, P.concrete, P.darkConcrete);
  // A wing at the back, a hall with a pitched roof.
  B.box(F, -w / 2, -w / 2 + 9, 0, 6, back - 9, back, wall);
  B.gable(F, -w / 2, -w / 2 + 9, back - 9, back, 6, 2.5, P.slate[1]!, wall, false, 0.4);
  // Bands of tall classroom windows.
  for (let f = 0; f < 2; f++) {
    const y = f * fh + 1.9;
    row(c, "front", front, -w / 2 + 0.8, w / 2 - 0.8, y, 8, 1.7, 2.0, (k) => f === 0 && k === 4);
    row(c, "back", back, -w / 2 + 9.5, w / 2 - 0.8, y, 5, 1.7, 2.0);
    row(c, "right", w / 2, back + 1, front - 1, y, 3, 1.6, 2.0);
  }
  row(c, "right", -w / 2 + 9, back - 8.5, back - 0.5, 3, 3, 1.6, 2.6);
  B.box(F, 1.2, 3.4, 0.05, 2.6, front, front + 0.06, col("#2c3a52"));
  B.box(F, 0.6, 4.0, 2.8, 3.0, front, front + 1.6, P.darkConcrete);
  // A playground in front, marked out, behind railings.
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.lawn);
  G.flatF(F, -10, 10, front + 0.5, half - 1, 0.035, P.playground);
  G.flatF(F, -6, -5.8, front + 1.5, half - 2, 0.045, P.marking);
  G.flatF(F, 5.8, 6, front + 1.5, half - 2, 0.045, P.marking);
  G.flatF(F, -6, 6, front + 4.9, front + 5.1, 0.045, P.marking);
  G.box(F, -c.w / 2 + 0.5, -1.2, 0, 1.4, half - 0.6, half - 0.5, col("#2b3a33"));
  G.box(F, 1.2, c.w / 2 - 0.5, 0, 1.4, half - 0.6, half - 0.5, col("#2b3a33"));
  return { door: [2.3, front], height: h + 0.6, cz: (front + back) / 2 };
}

function works(c: Ctx): Built {
  const { F, B, G, half } = c;
  const w = 19, d = 12, front = half - 7, back = front - d, h = 6.5;
  B.box(F, -w / 2, w / 2, 0, h, back, front, P.metal);
  B.gable(F, -w / 2, w / 2, back, front, h, 1.8, P.slate[0]!, P.metal, true, 0.3);
  for (const x of [-6, 0]) B.box(F, x - 2.2, x + 2.2, 0.05, 4.6, front, front + 0.08, col("#d4a43a"));
  B.box(F, 5, 6.2, 0.05, 2.3, front, front + 0.06, col("#30363d"));
  row(c, "front", front, 4, 9, 4.8, 2, 1.4, 1.0);
  // Tanks.
  B.prism(F, 8.5, back + 1, 2.6, 0, 6.5, col("#b8bdb7"), 14, col("#9aa09a"));
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.025, P.yard);
  return { door: [5.6, front], height: h + 1.8, cz: (front + back) / 2 };
}

function substation(c: Ctx): Built {
  const { F, B, G, half } = c;
  G.flatF(F, -9, 9, -9, 9, 0.03, P.gravel);
  for (const x of [-5, 0, 5]) {
    B.box(F, x - 1.6, x + 1.6, 0, 2.6, -2.5, 1, col("#7a8580"));
    for (let k = 0; k < 3; k++) B.prism(F, x - 1 + k, -0.8, 0.14, 2.6, 3.6, col("#c9c2b0"), 6);
  }
  B.box(F, -3, 3, 0, 3, -8, -4.5, pick(P.brick, 0.3), P.darkConcrete);
  // A palisade fence.
  for (const [x0, x1, z0, z1] of [[-9, 9, 8.9, 9], [-9, 9, -9, -8.9], [-9, -8.9, -9, 9], [8.9, 9, -9, 9]] as const) G.box(F, x0, x1, 0, 2.4, z0, z1, col("#3d4a45"));
  void half;
  return { door: [0, 9], height: 4 };
}

function park(c: Ctx): Built {
  const { F, G, half } = c;
  G.flatF(F, -c.w / 2 + 0.3, c.w / 2 - 0.3, -half + 0.3, half - 0.3, 0.03, P.lawn);
  G.flatF(F, -0.9, 0.9, -half + 0.3, half - 0.3, 0.04, P.gravel);
  return { door: [0, half - 1], height: 1 };
}
