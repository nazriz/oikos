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

/** The look's palette (docs/design/lens.md section 4): one accent per meaning, buildings in quiet earth tones. */
export const PAL = {
  ink: "#0b0f17", panel: "#111723", panel2: "#161d2b", hair: "#ffffff14", text: "#e8e6e1", muted: "#9aa3b2",
  seat: "#f2b44b", citizen: "#5cc8c0", institution: "#8b9cf6", flag: "#f0647a", election: "#b48cf2",
  // Buildings by category: muted, warm, separable at a glance.
  category: {
    residential: "#d8c7ab", commercial: "#d49a72", industrial: "#8a94a3", civic: "#9aa8f0", health: "#e2a9b5",
    education: "#86bcd6", utility: "#7d8796", green: "#6f9a66", transport: "#5b6170", other: "#a39e93",
  } as Record<string, string>,
  // Ground covers.
  cover: {
    woodland: "#2f4a32", farmland: "#7d7a4a", wetland: "#3d5a52", grassland: "#5f7448", scrub: "#6b6a46",
    riverbank: "#71806a", cleared: "#7d7260", road: "#55585e", built: "#6d6a60", ground: "#5c6650",
  } as Record<string, string>,
  water: "#2e5f7a",
  // People by where they are.
  where: { dwelling: "#ffd89a", workplace: "#5cc8c0", classroom: "#9fd3ff", hall: "#b9a3ff", waiting: "#ff9fb0", moving: "#ffffff", other: "#c8d0dc" } as Record<string, string>,
  window: "#ffc677",
};

export const WHERE_LABEL: Record<string, string> = {
  dwelling: "At home", workplace: "At work", classroom: "At school", hall: "In a hall", waiting: "At the clinic", moving: "On the way", other: "Elsewhere",
};

/** How tall, how wide: from the structure's type and its number of spaces (no place's figures: shapes only). */
export interface Shape { cx: number; cy: number; fw: number; fh: number; height: number; floors: number; roof: number; kind: "box" | "flat" | "road" }

export function shapeOf(s: TownStructure, cell: number): Shape {
  const cx = (s.x + s.w / 2) * cell;
  const cy = -(s.y + s.h / 2) * cell;
  const W = s.w * cell, H = s.h * cell;
  const r = hash01(strHash(s.id));
  const r2 = hash01(strHash(s.id), 7);
  const spaces = Object.values(s.spaces).reduce((a, b) => a + b, 0);
  const dwellings = s.spaces.dwelling ?? 0;
  if (s.category === "transport") return { cx, cy, fw: W, fh: H, height: 0, floors: 0, roof: 0, kind: "road" };
  if (s.category === "green") return { cx, cy, fw: W * 0.92, fh: H * 0.92, height: 0.3, floors: 0, roof: 0, kind: "flat" };
  let fw = 0.62, fh = 0.55, floors = 2, fl = 3.1;
  const t = s.type;
  if (s.category === "residential") {
    if (dwellings > 1) { floors = Math.min(8, Math.max(3, Math.ceil(dwellings / 3))); fw = 0.78; fh = 0.72; fl = 3.0; }
    else if (/large/.test(t)) { floors = 2; fw = 0.66; fh = 0.58; }
    else { floors = r < 0.3 ? 1 : 2; fw = 0.56; fh = 0.5; }
  } else if (s.category === "commercial") {
    if (/office/.test(t)) { floors = 5; fw = 0.74; fh = 0.7; fl = 3.4; }
    else if (/unit/.test(t)) { floors = 1; fw = 0.8; fh = 0.62; fl = 4.5; }
    else { floors = r < 0.5 ? 1 : 2; fw = 0.74; fh = 0.62; fl = 3.6; }
  } else if (s.category === "industrial") { floors = 1; fw = 0.86; fh = 0.76; fl = 7 + r * 3; if (/yard/.test(t)) { fl = 3.5; fw = 0.8; } }
  else if (s.category === "civic") { floors = /station/.test(t) ? 2 : 3; fw = 0.8; fh = 0.8; fl = 4.2; }
  else if (s.category === "health") { floors = 2; fw = 0.8; fh = 0.7; fl = 3.8; }
  else if (s.category === "education") { floors = 2; fw = 0.88; fh = 0.84; fl = 3.8; }
  else if (s.category === "utility") { floors = 1; fw = /sub/.test(t) ? 0.5 : 0.86; fh = /sub/.test(t) ? 0.5 : 0.8; fl = /sub/.test(t) ? 3.5 : 6; }
  else { floors = Math.max(1, Math.min(4, spaces)); }
  // A little variety, so the grid reads as a town and not a spreadsheet.
  fw *= 0.94 + r2 * 0.1; fh *= 0.94 + r * 0.1;
  return { cx, cy, fw: fw * W, fh: fh * H, height: floors * fl, floors, roof: s.category === "residential" && dwellings <= 1 ? 1.2 : 0.6, kind: "box" };
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

/** Paint the ground: covers with their own texture, the river, the lots under buildings. Returns a canvas. */
export function paintGround(town: TownBundle, px = 8): HTMLCanvasElement | OffscreenCanvas {
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
    if (s.category === "transport") { for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) lot[y * w + x] = 2; continue; }
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) lot[y * w + x] = s.category === "green" ? 3 : 1;
  }
  const water = new Uint8Array(w * h);
  for (const chain of town.river) for (const [x, y] of chain) if (x >= 0 && y >= 0 && x < w && y < h) water[y * w + x] = 1;
  const base = names.map((n) => hex(PAL.cover[n] ?? PAL.cover.ground!));
  const wat = hex(PAL.water);
  const lotC = hex("#7b776c"), parkC = hex("#58784f");
  // Farmland fields: blocks of 3x3 cells with their own crop and furrow direction.
  const crops = [hex("#8a8550"), hex("#6f7c44"), hex("#94804c"), hex("#7a8a52"), hex("#867158")];
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const iWood = names.indexOf("woodland"), iFarm = names.indexOf("farmland"), iWet = names.indexOf("wetland"), iScrub = names.indexOf("scrub"), iBank = names.indexOf("riverbank");
  for (let Y = 0; Y < H; Y++) {
    const cy = Math.floor(Y / px), fy = (Y + 0.5) / px;
    for (let X = 0; X < W; X++) {
      const cx = Math.floor(X / px), fx = (X + 0.5) / px;
      const ci = cy * w + cx;
      const k = cover[ci]!;
      let c: RGBA = base[k]!;
      const n = fbm(fx * 0.35, fy * 0.35, 11);
      let shade = 0.86 + n * 0.28;
      if (k === iWood) {
        // Crowns: bright tops on a dark understory.
        const t = noise2(fx * 2.4, fy * 2.4, 5) * 0.6 + noise2(fx * 5, fy * 5, 6) * 0.4;
        shade = 0.62 + t * 0.75;
        c = mix(c, hex("#3d5c3a"), noise2(fx * 0.5, fy * 0.5, 9));
      } else if (k === iFarm) {
        const bx = Math.floor(cx / 3), by = Math.floor(cy / 3);
        const hb = hash01(bx * 131 + by * 977, 3);
        c = crops[Math.floor(hb * crops.length)]!;
        const along = hb < 0.5 ? fx : fy;
        shade = 0.9 + 0.1 * Math.sin(along * Math.PI * 2.2) + (n - 0.5) * 0.12;
        // Field edges: a thin darker hedge line.
        const ex = (fx / 3) % 1, ey = (fy / 3) % 1;
        if (ex < 0.03 || ey < 0.03) { c = hex("#3e4a30"); shade = 0.9; }
      } else if (k === iWet) {
        const t = noise2(fx * 1.6, fy * 1.6, 21);
        if (t > 0.66) { c = mix(c, wat, 0.75); shade = 0.9 + (t - 0.66); }
        else shade = 0.85 + n * 0.25;
      } else if (k === iScrub) {
        const t = noise2(fx * 3.5, fy * 3.5, 31);
        shade = 0.8 + n * 0.2 + (t > 0.7 ? -0.18 : 0);
      } else if (k === iBank) {
        shade = 0.95 + n * 0.12;
      }
      const L = lot[ci]!;
      if (L === 1) { c = mix(c, lotC, 0.75); shade = 0.95 + n * 0.08; }
      else if (L === 3) { c = parkC; const t = noise2(fx * 2.6, fy * 2.6, 41); shade = 0.8 + t * 0.4; }
      if (water[ci]) {
        // The river: water with a soft bank toward the cell edge.
        const ex = Math.min((X % px) / px, 1 - (X % px) / px, 0.5), ey = Math.min((Y % px) / px, 1 - (Y % px) / px, 0.5);
        const nb = (dx: number, dy: number) => { const xx = cx + dx, yy = cy + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && water[yy * w + xx] === 1; };
        let edge = 1;
        if (!nb(-1, 0) && (X % px) / px < 0.25) edge = Math.min(edge, ex * 4);
        if (!nb(1, 0) && (X % px) / px > 0.75) edge = Math.min(edge, ex * 4);
        if (!nb(0, -1) && (Y % px) / px < 0.25) edge = Math.min(edge, ey * 4);
        if (!nb(0, 1) && (Y % px) / px > 0.75) edge = Math.min(edge, ey * 4);
        c = mix(c, wat, Math.min(1, 0.35 + edge));
        shade = 0.92 + noise2(fx * 3, fy * 3, 51) * 0.16;
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
export function paintBeyond(): HTMLCanvasElement | OffscreenCanvas {
  const N = 256;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(N, N) : Object.assign(document.createElement("canvas"), { width: N, height: N });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(N, N);
  const base = hex("#4f5f45");
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

/** Trees for the woodland and parks: a few per cell, jittered. [x, y, height, radius] in metres. */
export function treesOf(town: TownBundle, perCell = 2): Float32Array {
  const { w, h, cell } = town.ground;
  const cover = new Array<string>(w * h).fill("");
  for (const r of town.terrain) for (let y = r.y; y < Math.min(h, r.y + r.h); y++) for (let x = r.x; x < Math.min(w, r.x + r.w); x++) cover[y * w + x] = r.cover;
  const taken = new Set(town.structures.filter((s) => s.category !== "green").map((s) => s.y * w + s.x));
  const parks = new Set(town.structures.filter((s) => s.category === "green").map((s) => s.y * w + s.x));
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (taken.has(i)) continue;
    const c = cover[i];
    const n = c === "woodland" ? perCell : parks.has(i) ? 3 : c === "scrub" ? (hash01(i, 2) < 0.25 ? 1 : 0) : c === "riverbank" ? (hash01(i, 4) < 0.3 ? 1 : 0) : c === "grassland" ? (hash01(i, 5) < 0.02 ? 1 : 0) : 0;
    for (let k = 0; k < n; k++) {
      const rx = hash01(i * 7 + k, 11), ry = hash01(i * 7 + k, 12), rh = hash01(i * 7 + k, 13);
      out.push((x + 0.1 + rx * 0.8) * cell, -(y + 0.1 + ry * 0.8) * cell, 5 + rh * 6, 3 + rh * 2);
    }
  }
  return new Float32Array(out);
}
