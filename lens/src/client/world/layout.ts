// The 3D town's plan, in metres: which cells are street, how each street cell joins its neighbours, which way every
// building faces and where its door is, and the walking and driving routes between doors along the streets. Pure
// functions of the town bundle (no Three.js here), so they are tested on hand-made towns (lens/test/world.test.ts).
//
// Axes: x east, z south (a cell (cx, cy) spans x in [cx, cx+1) * cell, z in [cy, cy+1) * cell); y is up.
// A street cell carries a carriageway down its middle and a pavement on each side (STREET below); a building's door
// faces the street next to it, or, for a lot with no street beside it (the inner lots of a block), the nearest one, which
// it reaches by a footpath across the block.

import type { TownBundle, TownStructure } from "../../folds/town";

/** The cross-section of a street, in metres from its centre line (a display convention, not a place's figure). */
export const STREET = { lane: 1.9, carriage: 3.9, kerb: 4.05, pavement: 6.4, walk: 5.2, park: 3.0 };

export type V2 = [number, number];

export interface Lot {
  /** Index in town.structures. */
  i: number;
  /** Centre of the lot. */
  cx: number;
  cz: number;
  /** Lot size (metres). */
  w: number;
  d: number;
  /** Unit vector from the building toward its street. */
  face: V2;
  /** The street cell it is reached from (-1 none). */
  road: number;
  /** True when the street cell is next to the lot (else a footpath crosses the block). */
  fronted: boolean;
  /** The door, on the building's front wall (filled by the builder once the footprint is known; default the lot's front). */
  door: V2;
  /** Where the lot's path meets the pavement. */
  gate: V2;
}

export class Plan {
  readonly cell: number;
  readonly W: number;
  readonly H: number;
  /** Street cells (index y * W + x). */
  readonly roads: Set<number>;
  /** Per street cell: which sides join another street cell (bits: 1 east, 2 south, 4 west, 8 north). */
  readonly joins = new Map<number, number>();
  readonly lots: (Lot | undefined)[];
  private parentsFrom = new Map<number, Int32Array>();

  constructor(town: { ground: { cell: number; w: number; h: number }; structures: Pick<TownStructure, "x" | "y" | "w" | "h" | "category" | "id">[] }) {
    this.cell = town.ground.cell;
    this.W = town.ground.w;
    this.H = town.ground.h;
    this.roads = new Set(town.structures.filter((s) => s.category === "transport").map((s) => s.y * this.W + s.x));
    for (const id of this.roads) {
      const x = id % this.W, y = (id - x) / this.W;
      let m = 0;
      if (x + 1 < this.W && this.roads.has(id + 1)) m |= 1;
      if (this.roads.has(id + this.W)) m |= 2;
      if (x > 0 && this.roads.has(id - 1)) m |= 4;
      if (this.roads.has(id - this.W)) m |= 8;
      this.joins.set(id, m);
    }
    this.lots = town.structures.map((s, i) => (s.category === "transport" ? undefined : this.lotOf(s, i)));
  }

  centre(id: number): V2 {
    const x = id % this.W, y = (id - x) / this.W;
    return [(x + 0.5) * this.cell, (y + 0.5) * this.cell];
  }

  private lotOf(s: Pick<TownStructure, "x" | "y" | "w" | "h" | "id">, i: number): Lot {
    const c = this.cell;
    const cx = (s.x + s.w / 2) * c, cz = (s.y + s.h / 2) * c;
    // A street beside the lot: prefer the side a stable hash of the id picks among those that have one.
    const sides: { face: V2; road: number }[] = [];
    for (let dx = 0; dx < s.w; dx++) {
      if (this.isRoad(s.x + dx, s.y + s.h)) sides.push({ face: [0, 1], road: (s.y + s.h) * this.W + s.x + dx });
      if (this.isRoad(s.x + dx, s.y - 1)) sides.push({ face: [0, -1], road: (s.y - 1) * this.W + s.x + dx });
    }
    for (let dy = 0; dy < s.h; dy++) {
      if (this.isRoad(s.x + s.w, s.y + dy)) sides.push({ face: [1, 0], road: (s.y + dy) * this.W + s.x + s.w });
      if (this.isRoad(s.x - 1, s.y + dy)) sides.push({ face: [-1, 0], road: (s.y + dy) * this.W + s.x - 1 });
    }
    let face: V2 = [0, 1], road = -1, fronted = false;
    if (sides.length) {
      const pick = sides[hashStr(s.id) % sides.length]!;
      face = pick.face; road = pick.road; fronted = true;
    } else {
      road = this.nearestRoad(cx, cz);
      if (road >= 0) {
        const [rx, rz] = this.centre(road);
        const dx = rx - cx, dz = rz - cz;
        face = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) as number, 0] : [0, Math.sign(dz) as number];
      }
    }
    const door: V2 = [cx + face[0] * c * 0.2, cz + face[1] * c * 0.2];
    const gate = road >= 0 ? this.gateOf(road, cx, cz) : door;
    return { i, cx, cz, w: s.w * c, d: s.h * c, face, road, fronted, door, gate };
  }

  /** The pavement point of street cell `road` nearest to (x, z): on the side of the street that faces it. */
  gateOf(road: number, x: number, z: number): V2 {
    const [rx, rz] = this.centre(road);
    const j = this.joins.get(road) ?? 0;
    const ew = (j & 5) !== 0, ns = (j & 10) !== 0;
    const dx = x - rx, dz = z - rz;
    // A street running east-west has its pavements north and south of its centre line, and so on.
    if (ew && !ns) return [clamp(x, rx - this.cell / 2 + 0.5, rx + this.cell / 2 - 0.5), rz + Math.sign(dz || 1) * STREET.walk];
    if (ns && !ew) return [rx + Math.sign(dx || 1) * STREET.walk, clamp(z, rz - this.cell / 2 + 0.5, rz + this.cell / 2 - 0.5)];
    // A junction or a lone cell: the corner of pavement toward the point.
    return [rx + Math.sign(dx || 1) * STREET.walk, rz + Math.sign(dz || 1) * STREET.walk];
  }

  isRoad(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.W && y < this.H && this.roads.has(y * this.W + x);
  }

  nearestRoad(x: number, z: number): number {
    const gx = Math.floor(x / this.cell), gy = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 12 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.isRoad(gx + dx, gy + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = (gy + dy) * this.W + gx + dx; }
      }
    }
    return best;
  }

  /** Breadth-first parents over the street cells from `src` (-2 unreached, -1 the source). */
  private parents(src: number): Int32Array {
    let p = this.parentsFrom.get(src);
    if (p) return p;
    p = new Int32Array(this.W * this.H).fill(-2);
    p[src] = -1;
    const q = [src];
    for (let k = 0; k < q.length; k++) {
      const id = q[k]!, x = id % this.W;
      const n4 = [x + 1 < this.W ? id + 1 : -1, id + this.W, x > 0 ? id - 1 : -1, id - this.W];
      for (const n of n4) if (n >= 0 && n < p.length && p[n] === -2 && this.roads.has(n)) { p[n] = id; q.push(n); }
    }
    if (this.parentsFrom.size > 400) this.parentsFrom.clear();
    this.parentsFrom.set(src, p);
    return p;
  }

  /** The street cells from a to b, both included ([] when they do not join). */
  cells(a: number, b: number): number[] {
    if (!this.roads.has(a) || !this.roads.has(b)) return [];
    if (a === b) return [a];
    const par = this.parents(a);
    if (par[b] === -2) return [];
    const out: number[] = [];
    for (let id = b; id !== -1; id = par[id]!) out.push(id);
    return out.reverse();
  }

  /** A walk from one lot's door to another's: down the path to the pavement, along the pavements (keeping to the
   * right-hand one, crossing where the walk turns that way), and up the other path. */
  walk(a: number, b: number): Route {
    return this.route(a, b, STREET.walk, true);
  }

  /** A drive from one lot to another, in the lane (the car stands on the lot's drive at either end). */
  drive(a: number, b: number): Route {
    return this.route(a, b, STREET.lane, false);
  }

  private routes = new Map<string, Route>();
  private route(a: number, b: number, off: number, onFoot: boolean): Route {
    const key = `${onFoot ? "w" : "d"}${a}>${b}`;
    const hit = this.routes.get(key);
    if (hit) return hit;
    const A = this.lots[a], B = this.lots[b];
    const pts: V2[] = [];
    if (!A || !B) return makeRoute(pts);
    const end = (L: Lot): V2 => (onFoot ? L.door : drivePoint(L, this.cell));
    pts.push(end(A));
    if (onFoot) pts.push(A.gate);
    const chain = this.cells(A.road, B.road);
    if (chain.length >= 2) {
      const line = chain.map((id) => this.centre(id));
      for (const p of offsetRight(simplify(line), off)) pts.push(p);
    } else if (!onFoot && chain.length === 1) pts.push(this.gateOf(A.road, A.cx, A.cz));
    if (onFoot) pts.push(B.gate);
    pts.push(end(B));
    const r = makeRoute(simplify(pts));
    if (this.routes.size > 20000) this.routes.clear();
    this.routes.set(key, r);
    return r;
  }
}

/** Where a car stands on its lot: on the drive, beside the house toward the street. */
export function drivePoint(L: Lot, cell: number): V2 {
  const side: V2 = [-L.face[1], L.face[0]];
  return [L.cx + L.face[0] * cell * 0.3 + side[0] * cell * 0.3, L.cz + L.face[1] * cell * 0.3 + side[1] * cell * 0.3];
}

export interface Route { pts: V2[]; cum: number[]; len: number }

export function makeRoute(pts: V2[]): Route {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts, cum, len: cum[cum.length - 1] ?? 0 };
}

/** The point at distance d along a route, and the heading there (radians, atan2(dx, dz)). */
export function at(r: Route, d: number, out: { x: number; z: number; heading: number }) {
  const n = r.pts.length;
  if (!n) return out;
  if (n === 1 || d <= 0) {
    out.x = r.pts[0]![0]; out.z = r.pts[0]![1];
    if (n > 1) out.heading = Math.atan2(r.pts[1]![0] - r.pts[0]![0], r.pts[1]![1] - r.pts[0]![1]);
    return out;
  }
  d = Math.min(d, r.len);
  let lo = 1, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m]! < d) lo = m + 1; else hi = m; }
  const a = r.pts[lo - 1]!, b = r.pts[lo]!;
  const seg = r.cum[lo]! - r.cum[lo - 1]! || 1;
  const u = (d - r.cum[lo - 1]!) / seg;
  out.x = a[0] + (b[0] - a[0]) * u;
  out.z = a[1] + (b[1] - a[1]) * u;
  out.heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return out;
}

/** Drop repeated points and the middle of straight runs. */
export function simplify(p: V2[]): V2[] {
  const out: V2[] = [];
  for (const q of p) {
    const n = out.length;
    if (n && Math.abs(out[n - 1]![0] - q[0]) < 1e-6 && Math.abs(out[n - 1]![1] - q[1]) < 1e-6) continue;
    if (n >= 2) {
      const a = out[n - 2]!, b = out[n - 1]!;
      const cross = (b[0] - a[0]) * (q[1] - b[1]) - (b[1] - a[1]) * (q[0] - b[0]);
      const dot = (b[0] - a[0]) * (q[0] - b[0]) + (b[1] - a[1]) * (q[1] - b[1]);
      if (Math.abs(cross) < 1e-6 && dot >= 0) { out[n - 1] = q; continue; }
    }
    out.push(q);
  }
  return out;
}

/** A polyline moved `off` metres to the right of its direction of travel (x east, z south: right of heading (dx, dz)
 * is (-dz, dx)), mitred at the corners. A U-turn keeps the point beside the turn. */
export function offsetRight(p: V2[], off: number): V2[] {
  const n = p.length;
  if (n < 2) return p.slice();
  const right = (a: V2, b: V2): V2 => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const r1 = i > 0 ? right(p[i - 1]!, p[i]!) : right(p[0]!, p[1]!);
    const r2 = i < n - 1 ? right(p[i]!, p[i + 1]!) : r1;
    let mx = r1[0] + r2[0], mz = r1[1] + r2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push([p[i]![0] + r1[0] * off, p[i]![1] + r1[1] * off]); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * r1[0] + mz * r1[1];
    const k = off / Math.max(0.3, cos);
    out.push([p[i]![0] + mx * k, p[i]![1] + mz * k]);
  }
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A stable hash in [0, 1). */
export function h01(n: number, salt = 0): number {
  let h = (n * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type { TownBundle };
