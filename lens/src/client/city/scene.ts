// The town's shapes, in metres: building footprints and heights, the palette, the road graph people walk along, and
// the painted ground. Pure functions of the town bundle (no deck.gl here), so they are made once per run.
import type { TownBundle, TownStructure } from "./data";
import { hash01, strHash } from "./data";

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
export const mix = (a: RGBA | RGB, b: RGBA | RGB, f: number): RGBA => [
  a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, (a[3] ?? 255) + ((b[3] ?? 255) - (a[3] ?? 255)) * f,
];

/** The look's palette (docs/design/lens.md section 4): one accent per meaning; the town itself in the quiet tones of an
 * architect's model, so the accents (people, acts) carry the meaning. */
export const PAL = {
  ink: "#0b0f17", panel: "#111723", panel2: "#161d2b", hair: "#ffffff14", text: "#e8e6e1", muted: "#9aa3b2",
  // The town's own objects (docs/design/lens-look.md): road-marking yellow, stop-sign red, ballot-box blue, council green.
  seat: "#E8B400", citizen: "#8C7B6B", institution: "#2F7D5B", flag: "#C8102E", election: "#1F5FAD",
  // Building walls by category: pale, slightly warm, told apart by hue rather than strength.
  category: {
    residential: "#ddd6ca", commercial: "#d9b49a", industrial: "#a3aab4", civic: "#B7CDBF", health: "#e6c1c8",
    education: "#a9cbdc", utility: "#9aa1aa", green: "#7f9277", transport: "#5b6170", other: "#bdb8ae",
  } as Record<string, string>,
  roofs: ["#7f6a62", "#6f7279", "#86735f", "#706560", "#7b7f86"],
  // Ground covers: desaturated, a little cool; tone, not colour, tells them apart.
  cover: {
    woodland: "#4b5a4d", farmland: "#939884", wetland: "#6c7f7b", grassland: "#8b9584", scrub: "#878a78",
    riverbank: "#8f998b", cleared: "#99958a", road: "#55585e", built: "#8d8a80", ground: "#899282",
  } as Record<string, string>,
  water: "#557f94",
  lot: "#aeada5",
  // People by where they are.
  // People by where they are: by day in plan inks, at night the lamplit versions (whereNight).
  where: { dwelling: "#46586A", workplace: "#2F7D5B", classroom: "#3B6EA8", hall: "#5B6B78", waiting: "#B5523B", moving: "#1D2B36", other: "#5B6B78" } as Record<string, string>,
  // Night lights in near-white, never yellow: yellow means the AI mayor (docs/design/lens-look.md).
  whereNight: { dwelling: "#E9E4DA", workplace: "#8FD1B0", classroom: "#A9C8EE", hall: "#C9D3DB", waiting: "#F0A493", moving: "#FFFFFF", other: "#C9D3DB" } as Record<string, string>,
  window: "#EFE8DA",
};

export const WHERE_LABEL: Record<string, string> = {
  dwelling: "At home", workplace: "At work", classroom: "At school", hall: "In a hall", waiting: "At the clinic", moving: "On the way", other: "Elsewhere",
};

/** One box of a building: centre, size, base height and height (metres). */
export interface Mass { cx: number; cy: number; w: number; h: number; z: number; height: number; roof: "hip" | "flat" | "none"; roofH: number }
/** How a structure is drawn: its main mass and any others (a tower, a wing, a chimney). Shapes only: no place's figures. */
export interface Shape { cx: number; cy: number; fw: number; fh: number; height: number; floors: number; roof: number; kind: "box" | "flat" | "road"; masses: Mass[]; /** The highest point, roof included. */ top: number }

export function shapeOf(s: TownStructure, cell: number): Shape {
  const cx = (s.x + s.w / 2) * cell;
  const cy = -(s.y + s.h / 2) * cell;
  const W = s.w * cell, H = s.h * cell;
  const r = hash01(strHash(s.id));
  const r2 = hash01(strHash(s.id), 7);
  const r3 = hash01(strHash(s.id), 13);
  const dwellings = s.spaces.dwelling ?? 0;
  if (s.category === "transport") return { cx, cy, fw: W, fh: H, height: 0, floors: 0, roof: 0, kind: "road", masses: [], top: 0 };
  if (s.category === "green") return { cx, cy, fw: W * 0.92, fh: H * 0.92, height: 0.3, floors: 0, roof: 0, kind: "flat", masses: [], top: 0.3 };
  const t = s.type;
  const m: Mass[] = [];
  const box = (fx: number, fy: number, fw: number, fh: number, height: number, roof: Mass["roof"] = "flat", z = 0, roofH = 0) =>
    m.push({ cx: cx + fx * W, cy: cy + fy * H, w: fw * W, h: fh * H, z, height, roof, roofH });
  const swap = r3 < 0.5; // which way the long side runs
  const wh = (a: number, b: number): [number, number] => (swap ? [b, a] : [a, b]);
  let floors = 2;
  if (s.category === "residential" && dwellings > 1) {
    floors = Math.min(9, Math.max(4, Math.ceil(dwellings / 2)));
    const [a, b] = wh(0.74, 0.5);
    box(0, 0, a, b, floors * 3.0);
  } else if (s.category === "residential") {
    const large = /large/.test(t);
    floors = large ? 2 : r < 0.45 ? 1 : 2;
    const [a, b] = wh(large ? 0.58 : 0.5, large ? 0.42 : 0.38);
    const h = floors * 2.8;
    box((r2 - 0.5) * 0.08, (r - 0.5) * 0.08, a, b, h, "hip", 0, Math.min(a * W, b * H) * 0.36);
    if (large) { const [c, d] = wh(0.24, 0.26); box(swap ? 0.16 : 0.2, swap ? 0.2 : 0.16, c, d, 2.8, "hip", 0, Math.min(c * W, d * H) * 0.4); }
  } else if (s.category === "commercial" && /office/.test(t)) {
    floors = 7; box(0, 0, 0.56, 0.56, 7 * 3.5); box(0, 0, 0.72, 0.72, 4.2);
  } else if (s.category === "commercial") {
    floors = /unit/.test(t) ? 1 : r < 0.5 ? 1 : 2;
    const [a, b] = wh(0.72, 0.52);
    box(0, 0.06, a, b, floors * 3.9);
  } else if (s.category === "industrial") {
    floors = 1;
    if (/yard/.test(t)) { box(-0.1, 0, 0.6, 0.5, 4.5); box(0.28, 0.2, 0.25, 0.3, 3.2); }
    else { const [a, b] = wh(0.84, 0.62); box(0, 0, a, b, 8 + r * 3); box(0.3, -0.3, 0.07, 0.07, 22 + r2 * 6); }
  } else if (s.category === "civic") {
    floors = 3;
    if (/station/.test(t)) { box(0, 0, 0.7, 0.55, 7.5); }
    else { box(0, 0.05, 0.82, 0.62, 10.5); box(0, -0.24, 0.2, 0.2, 24, "hip", 0, 4); }
  } else if (s.category === "health") {
    floors = 2; box(0, -0.1, 0.8, 0.42, 8); box(-0.25, 0.22, 0.3, 0.36, 8);
  } else if (s.category === "education") {
    floors = 2; box(0, -0.2, 0.88, 0.36, 8.5); box(0.28, 0.18, 0.32, 0.5, 8.5); box(-0.3, 0.26, 0.26, 0.3, 5);
  } else if (s.category === "utility") {
    floors = 1;
    if (/sub/.test(t)) box(0, 0, 0.5, 0.5, 4);
    else { box(-0.2, 0, 0.42, 0.7, 6.5); box(0.25, -0.2, 0.28, 0.28, 9); box(0.25, 0.22, 0.28, 0.28, 9); }
  } else box(0, 0, 0.6, 0.6, 6);
  const main = m[0]!;
  const top = Math.max(...m.map((x) => x.z + x.height + x.roofH * 0.6));
  return { cx, cy, fw: main.w, fh: main.h, height: main.height, floors, roof: main.roof === "hip" ? main.roofH : 0.6, kind: "box", masses: m, top };
}

/** The four faces of a hipped roof over a mass, with their outward normals. */
export function hipFaces(m: Mass, over = 0.7): { poly: [number, number, number][]; n: [number, number, number] }[] {
  const w = m.w + over * 2, h = m.h + over * 2, z = m.z + m.height, rh = m.roofH;
  const x0 = m.cx - w / 2, x1 = m.cx + w / 2, y0 = m.cy - h / 2, y1 = m.cy + h / 2;
  const faces: [number, number, number][][] = [];
  if (w >= h) {
    const r0 = m.cx - (w - h) / 2, r1 = m.cx + (w - h) / 2, Z = z + rh;
    faces.push([[x0, y0, z], [x1, y0, z], [r1, m.cy, Z], [r0, m.cy, Z]]);
    faces.push([[x1, y1, z], [x0, y1, z], [r0, m.cy, Z], [r1, m.cy, Z]]);
    faces.push([[x0, y1, z], [x0, y0, z], [r0, m.cy, Z]]);
    faces.push([[x1, y0, z], [x1, y1, z], [r1, m.cy, Z]]);
  } else {
    const r0 = m.cy - (h - w) / 2, r1 = m.cy + (h - w) / 2, Z = z + rh;
    faces.push([[x0, y1, z], [x0, y0, z], [m.cx, r0, Z], [m.cx, r1, Z]]);
    faces.push([[x1, y0, z], [x1, y1, z], [m.cx, r1, Z], [m.cx, r0, Z]]);
    faces.push([[x0, y0, z], [x1, y0, z], [m.cx, r0, Z]]);
    faces.push([[x1, y1, z], [x0, y1, z], [m.cx, r1, Z]]);
  }
  return faces.map((poly) => {
    const [a, b, c] = poly as [[number, number, number], [number, number, number], [number, number, number]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: [number, number, number] = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(...n) || 1;
    return { poly, n: [n[0] / l, n[1] / l, n[2] / l] };
  });
}

/** The shadow a mass casts on the ground with light travelling along `dir` (convex hull of its base and its projected top). */
export function shadowOf(m: Mass, dir: [number, number, number], maxLen = 3): [number, number][] {
  const k = Math.min(maxLen, 1 / Math.max(0.12, -dir[2]));
  const top = m.z + m.height + m.roofH * 0.7;
  const dx = dir[0] * k * top, dy = dir[1] * k * top;
  const hw = m.w / 2, hh = m.h / 2;
  const pts: [number, number][] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { pts.push([m.cx + sx * hw, m.cy + sy * hh]); pts.push([m.cx + sx * hw + dx, m.cy + sy * hh + dy]); }
  return hull(pts);
}
function hull(p: [number, number][]): [number, number][] {
  const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function rect(cx: number, cy: number, w: number, h: number, z = 0): [number, number, number][] {
  return [[cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z], [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z]];
}

// ---------- Roads: a grid graph of road cells, and walking routes along it ----------

export class Roads {
  readonly cells: Set<number>;
  readonly segments: { a: [number, number]; b: [number, number] }[] = [];
  private W: number;
  private parentsFrom = new Map<number, Int32Array>();
  private nearestOf = new Map<number, number>();
  private routes = new Map<string, Route>();
  constructor(private town: TownBundle) {
    this.W = town.ground.w;
    this.cells = new Set(town.structures.filter((s) => s.category === "transport").map((s) => s.y * this.W + s.x));
    const c = town.ground.cell;
    for (const id of this.cells) {
      const x = id % this.W, y = Math.floor(id / this.W);
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (this.cells.has((y + dy) * this.W + x + dx)) this.segments.push({ a: [(x + 0.5) * c, -(y + 0.5) * c], b: [(x + dx + 0.5) * c, -(y + dy + 0.5) * c] });
      }
    }
  }
  private nearest(x: number, y: number): number {
    const key = y * this.W + x;
    const hit = this.nearestOf.get(key);
    if (hit !== undefined) return hit;
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 8 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const id = (y + dy) * this.W + x + dx;
        if (x + dx < 0 || x + dx >= this.W || !this.cells.has(id)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = id; }
      }
    }
    this.nearestOf.set(key, best);
    return best;
  }
  private parents(src: number): Int32Array {
    let p = this.parentsFrom.get(src);
    if (p) return p;
    p = new Int32Array(this.W * this.town.ground.h).fill(-2);
    p[src] = -1;
    const q = [src];
    for (let i = 0; i < q.length; i++) {
      const id = q[i]!, x = id % this.W;
      for (const n of [id + 1, id - 1, id + this.W, id - this.W]) {
        if ((n === id + 1 && x === this.W - 1) || (n === id - 1 && x === 0)) continue;
        if (n >= 0 && n < p.length && p[n] === -2 && this.cells.has(n)) { p[n] = id; q.push(n); }
      }
    }
    this.parentsFrom.set(src, p);
    return p;
  }
  /** A route from structure a to structure b (metres), along the roads where they join, else straight. */
  route(a: TownStructure, b: TownStructure): Route {
    const key = `${a.id}>${b.id}`;
    let r = this.routes.get(key);
    if (r) return r;
    const c = this.town.ground.cell;
    const pa: [number, number] = [(a.x + a.w / 2) * c, -(a.y + a.h / 2) * c];
    const pb: [number, number] = [(b.x + b.w / 2) * c, -(b.y + b.h / 2) * c];
    const pts: [number, number][] = [pa];
    const ra = this.nearest(a.x, a.y), rb = this.nearest(b.x, b.y);
    if (ra >= 0 && rb >= 0 && a.id !== b.id) {
      const par = this.parents(ra);
      if (par[rb] !== -2) {
        const chain: number[] = [];
        for (let id = rb; id !== -1; id = par[id]!) chain.push(id);
        chain.reverse();
        for (const id of chain) pts.push([((id % this.W) + 0.5) * c, -(Math.floor(id / this.W) + 0.5) * c]);
      }
    }
    pts.push(pb);
    r = makeRoute(simplify(pts));
    if (this.routes.size > 20000) this.routes.clear();
    this.routes.set(key, r);
    return r;
  }
}

export interface Route { pts: [number, number][]; cum: number[]; len: number }
function simplify(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const q of p) {
    const n = out.length;
    if (n && out[n - 1]![0] === q[0] && out[n - 1]![1] === q[1]) continue;
    if (n >= 2) {
      const a = out[n - 2]!, b = out[n - 1]!;
      if ((b[0] - a[0]) * (q[1] - b[1]) - (b[1] - a[1]) * (q[0] - b[0]) === 0) { out[n - 1] = q; continue; }
    }
    out.push(q);
  }
  return out;
}
function makeRoute(pts: [number, number][]): Route {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts, cum, len: cum[cum.length - 1]! };
}
export function along(r: Route, f: number, out: [number, number]): [number, number] {
  const d = Math.max(0, Math.min(1, f)) * r.len;
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i]! < d) i++;
  const a = r.pts[i - 1]!, b = r.pts[i] ?? a;
  const seg = r.cum[i]! - r.cum[i - 1]! || 1;
  const u = (d - r.cum[i - 1]!) / seg;
  out[0] = a[0] + (b[0] - a[0]) * u;
  out[1] = a[1] + (b[1] - a[1]) * u;
  return out;
}

// ---------- The painted ground ----------

/** Smooth value noise in [0, 1]. */
function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i: number, j: number) => hash01(i * 73856093 ^ j * 19349663, seed);
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, seed: number): number {
  return noise2(x, y, seed) * 0.5 + noise2(x * 2.03, y * 2.03, seed + 1) * 0.3 + noise2(x * 4.1, y * 4.1, seed + 2) * 0.2;
}

/** Paint the ground like a model's base: covers in quiet tones with gentle variation, woodland stippled, fields in
 * soft strips, the river with a pale bank, and crisp pale lots under buildings. Returns a canvas. */
export function paintGround(town: TownBundle, px = 10, plan = false): HTMLCanvasElement | OffscreenCanvas {
  const { w, h } = town.ground;
  const W = w * px, H = h * px;
  const cover = new Uint8Array(w * h);
  const names: string[] = ["ground"];
  const idx = (n: string) => { let i = names.indexOf(n); if (i < 0) { i = names.length; names.push(n); } return i; };
  for (const r of town.terrain) {
    const k = idx(r.cover);
    for (let y = r.y; y < Math.min(h, r.y + r.h); y++) for (let x = r.x; x < Math.min(w, r.x + r.w); x++) cover[y * w + x] = k;
  }
  const lot = new Uint8Array(w * h);
  for (const s of town.structures) {
    const v = s.category === "transport" ? 2 : s.category === "green" ? 3 : 1;
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (x < w && y < h) lot[y * w + x] = v;
  }
  const water = new Uint8Array(w * h);
  for (const chain of town.river) for (const [x, y] of chain) if (x >= 0 && y >= 0 && x < w && y < h) water[y * w + x] = 1;
  // On the plan (light theme) the covers are washed toward survey paper, like a printed map's land tints.
  const paper = hex("#EDF0F2");
  const wash = (c: RGBA) => (plan ? mix(c, paper, 0.55) : c);
  const base = names.map((n) => wash(hex(PAL.cover[n] ?? PAL.cover.ground!)));
  const wat = plan ? hex("#9CC3D8") : hex(PAL.water), bank = wash(hex("#adb2a4"));
  const lotC = plan ? hex("#F4F1EA") : hex(PAL.lot), lotEdge = plan ? hex("#B9B3A6") : hex("#7e817b"), parkC = wash(hex("#819478"));
  const crops = [hex("#9d9d86"), hex("#8e997b"), hex("#a49c84"), hex("#939d84"), hex("#a0957e")].map(wash);
  const fence = wash(hex("#6f7a68"));
  const inTown = townMask(town);
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const iWood = names.indexOf("woodland"), iFarm = names.indexOf("farmland"), iWet = names.indexOf("wetland"), iScrub = names.indexOf("scrub"), iGrass = names.indexOf("grassland");
  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && water[y * w + x] === 1;
  // (The broad variation, a period of about eight cells, sampled every 5 px and interpolated: three noise lookups per
  // pixel were most of the ~260 ms this took on opening a run.)
  const G = 5, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
  const broad = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) broad[j * gw + i] = fbm(((i * G + 0.5) / px) * 0.12, ((j * G + 0.5) / px) * 0.12, 11);
  const edge = wash(hex("#66705f"));
  for (let Y = 0; Y < H; Y++) {
    const gj = Math.floor(Y / G), gv = (Y - gj * G) / G;
    const cy = Math.floor(Y / px), fy = (Y + 0.5) / px, uy = (Y % px + 0.5) / px;
    for (let X = 0; X < W; X++) {
      const cx = Math.floor(X / px), fx = (X + 0.5) / px, ux = (X % px + 0.5) / px;
      const ci = cy * w + cx;
      const k = cover[ci]!;
      let c: RGBA = base[k]!;
      const gi = Math.floor(X / G), gu = (X - gi * G) / G, g0 = gj * gw + gi;
      const n = (broad[g0]! * (1 - gu) + broad[g0 + 1]! * gu) * (1 - gv) + (broad[g0 + gw]! * (1 - gu) + broad[g0 + gw + 1]! * gu) * gv;
      let shade = 0.95 + (n - 0.5) * 0.1;
      if (k === iWood) {
        const t = noise2(fx * 2.6, fy * 2.6, 5) * 0.65 + noise2(fx * 6, fy * 6, 6) * 0.35;
        shade = 0.82 + t * 0.32;
      } else if (k === iFarm) {
        const bx = Math.floor(cx / 3), by = Math.floor(cy / 3);
        const hb = hash01(bx * 131 + by * 977, 3);
        c = crops[Math.floor(hb * crops.length)]!;
        const along = hb < 0.5 ? fx : fy;
        shade = 0.97 + 0.03 * Math.sin(along * Math.PI * 3) + (n - 0.5) * 0.06;
        const ex = (fx / 3) % 1, ey = (fy / 3) % 1;
        if (ex < 0.02 || ey < 0.02) { c = edge; shade = 1; }
      } else if (k === iWet) {
        const t = noise2(fx * 1.4, fy * 1.4, 21);
        if (t > 0.68) { c = mix(c, wat, 0.6); shade = 1; }
      } else if (k === iScrub) {
        const t = noise2(fx * 4, fy * 4, 31);
        shade = 0.96 + (t > 0.72 ? -0.08 : 0) + (n - 0.5) * 0.08;
      } else if (k === iGrass && !inTown[ci]) {
        // Countryside: paddocks, each a slightly different tone, with fence lines.
        const P = paddock(cx, cy), ex = (fx - P.x0) / P.w, ey = (fy - P.y0) / P.h;
        shade = 0.95 + (P.r - 0.5) * 0.1 + (n - 0.5) * 0.06;
        if (Math.min(ex, ey) * Math.min(P.w, P.h) < 0.035) { c = fence; shade = 1; }
      }
      const L = lot[ci]!;
      if (L === 1) {
        // A pale lot, inset from the cell with a fine darker edge.
        const e = Math.min(ux, 1 - ux, uy, 1 - uy);
        if (e > 0.07) { c = lotC; shade = 1 + (n - 0.5) * 0.04; }
        else if (e > 0.045) { c = lotEdge; shade = 1; }
      } else if (L === 3) {
        c = parkC; shade = 0.95 + noise2(fx * 3, fy * 3, 41) * 0.1;
      }
      if (water[ci]) {
        // The river, with a pale bank where it meets land.
        let e = 1;
        if (!isWater(cx - 1, cy)) e = Math.min(e, ux);
        if (!isWater(cx + 1, cy)) e = Math.min(e, 1 - ux);
        if (!isWater(cx, cy - 1)) e = Math.min(e, uy);
        if (!isWater(cx, cy + 1)) e = Math.min(e, 1 - uy);
        c = e < 0.08 ? bank : wat;
        shade = 0.97 + noise2(fx * 2, fy * 2, 51) * 0.06;
      }
      const o = (Y * W + X) * 4;
      d[o] = Math.min(255, c[0] * shade); d[o + 1] = Math.min(255, c[1] * shade); d[o + 2] = Math.min(255, c[2] * shade); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The land beyond the district, a quiet field that fades into the backdrop (the world ends at its edge; this only
 * keeps the map from looking like a tile in space). The district fills the middle quarter. */
export function paintBeyond(plan = false): HTMLCanvasElement | OffscreenCanvas {
  const N = 256;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(N, N) : Object.assign(document.createElement("canvas"), { width: N, height: N });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(N, N);
  const base = plan ? hex("#D3D9D2") : hex("#6f7d68");
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Distance from the district's square (the middle fifth), in the margin.
    const dx = Math.max(0, Math.abs(x / N - 0.5) - 0.125) / 0.375, dy = Math.max(0, Math.abs(y / N - 0.5) - 0.125) / 0.375;
    const d = Math.min(1, Math.hypot(dx, dy));
    const n = noise2(x / 10, y / 10, 77) * 0.6 + noise2(x / 3, y / 3, 78) * 0.4;
    const shade = 0.55 + n * 0.25;
    const o = (y * N + x) * 4;
    img.data[o] = base[0] * shade; img.data[o + 1] = base[1] * shade; img.data[o + 2] = base[2] * shade;
    img.data[o + 3] = 255 * Math.pow(1 - d, 2) * 0.6;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Which cells are inside the town (any place below the district). */
export function townMask(town: TownBundle): Uint8Array {
  const { w, h } = town.ground;
  const m = new Uint8Array(w * h);
  for (const p of town.places) {
    if (!p.within) continue;
    const a = p.area;
    for (let y = a.y; y < Math.min(h, a.y + a.h); y++) for (let x = a.x; x < Math.min(w, a.x + a.w); x++) m[y * w + x] = 1;
  }
  return m;
}
/** The countryside's paddocks: blocks of about 5 by 4 cells, staggered by row (cell coordinates of the block). */
export function paddock(cx: number, cy: number): { x0: number; y0: number; w: number; h: number; r: number } {
  const ph = 4, by = Math.floor(cy / ph);
  const pw = 5 + (by % 2), off = (by * 3) % pw, bx = Math.floor((cx + off) / pw);
  return { x0: bx * pw - off, y0: by * ph, w: pw, h: ph, r: hash01(bx * 7919 + by * 104729, 61) };
}

/** Trees: woodland, park clusters, street trees on the verges, hedgerow trees on paddock fences, and trees along the
 * river. [x, y, height, radius] in metres. */
export function treesOf(town: TownBundle, perCell = 2): Float32Array {
  const { w, h, cell } = town.ground;
  const cover = new Array<string>(w * h).fill("");
  for (const r of town.terrain) for (let y = r.y; y < Math.min(h, r.y + r.h); y++) for (let x = r.x; x < Math.min(w, r.x + r.w); x++) cover[y * w + x] = r.cover;
  const taken = new Set(town.structures.filter((s) => s.category !== "green").map((s) => s.y * w + s.x));
  const roads = new Set(town.structures.filter((s) => s.category === "transport").map((s) => s.y * w + s.x));
  const parks = new Set(town.structures.filter((s) => s.category === "green").map((s) => s.y * w + s.x));
  const water = new Set<number>();
  for (const chain of town.river) for (const [x, y] of chain) water.add(y * w + x);
  const inTown = townMask(town);
  const out: number[] = [];
  const tree = (x: number, y: number, hgt: number, r: number) => out.push(x * cell, -y * cell, hgt, r);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (roads.has(i)) {
      // Street trees on the verges, every other cell, where the side is not a building's front.
      if ((x + y) % 2) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = (y + dy) * w + x + dx;
        if (roads.has(j) || water.has(j) || x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
        if (hash01(i * 4 + dx * 2 + dy, 71) < 0.55) tree(x + 0.5 + dx * 0.43 + dy * 0.25, y + 0.5 + dy * 0.43 + dx * 0.25, 4.5 + hash01(i, 72) * 2, 2.2);
      }
      continue;
    }
    if (taken.has(i) || water.has(i)) continue;
    const c = cover[i];
    if (parks.has(i)) {
      // A park: two loose clusters.
      for (let k = 0; k < 7; k++) {
        const cl = k % 2, cxr = 0.3 + cl * 0.4 + (hash01(i, 80 + cl) - 0.5) * 0.15, cyr = 0.35 + cl * 0.3;
        const a = hash01(i * 9 + k, 81) * Math.PI * 2, d = hash01(i * 9 + k, 82) * 0.18;
        tree(x + cxr + Math.cos(a) * d, y + cyr + Math.sin(a) * d, 6 + hash01(i * 9 + k, 83) * 5, 2.6 + hash01(i * 9 + k, 84) * 1.5);
      }
      continue;
    }
    const nearWater = water.has(i + 1) || water.has(i - 1) || water.has(i + w) || water.has(i - w);
    let n = c === "woodland" ? perCell : c === "scrub" ? (hash01(i, 2) < 0.25 ? 1 : 0) : c === "riverbank" ? (hash01(i, 4) < 0.55 ? 1 : 0) : 0;
    if (nearWater && c !== "woodland" && hash01(i, 6) < 0.45) n++;
    if (c === "grassland" && !inTown[i]) {
      // Hedgerow trees along the paddock fences, and the odd tree standing alone.
      const P = paddock(x, y);
      if ((x === P.x0 || y === P.y0) && hash01(i, 7) < 0.4) tree(x === P.x0 ? x + 0.05 : x + hash01(i, 8), y === P.y0 ? y + 0.05 : y + hash01(i, 9), 6 + hash01(i, 10) * 4, 3 + hash01(i, 10) * 1.5);
      else if (hash01(i, 5) < 0.015) n++;
    } else if (c === "grassland" && hash01(i, 5) < 0.02) n++;
    for (let k = 0; k < n; k++) {
      const rx = hash01(i * 7 + k, 11), ry = hash01(i * 7 + k, 12), rh = hash01(i * 7 + k, 13);
      tree(x + 0.1 + rx * 0.8, y + 0.1 + ry * 0.8, 5 + rh * 6, 3 + rh * 2);
    }
  }
  return new Float32Array(out);
}
