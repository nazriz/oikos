// The land: a painted texture of the district by cover (meadow, fields in strips, woodland floor, wetland with pools,
// scrub, the river's banks), a fine detail texture to break it up at street level, and the land beyond the district
// that fades into the haze. The river is its own mesh (engine.ts) with moving water.
import * as THREE from "three";
import type { TownBundle } from "../../folds/town";
import { coverGrid } from "./town";
import { h01 } from "./layout";

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i: number, j: number) => h01((i * 73856093) ^ (j * 19349663), seed);
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, seed: number) => noise2(x, y, seed) * 0.5 + noise2(x * 2.03, y * 2.03, seed + 1) * 0.3 + noise2(x * 4.1, y * 4.1, seed + 2) * 0.2;
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a: number[], b: number[], f: number) => [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f];

const COVER: Record<string, string> = {
  grassland: "#6c7f47", woodland: "#3e5131", farmland: "#8f8a55", scrub: "#7f7c52", wetland: "#5f7354",
  riverbank: "#6f8350", cleared: "#8a7d62", ground: "#6c7f47", built: "#80806f",
};
const CROPS = ["#b4a467", "#7d9150", "#8a7049", "#a6a060", "#6e8748", "#9b8a55"].map(rgb);

export function paintGround(town: TownBundle, px = 10): HTMLCanvasElement {
  const { w, h } = town.ground;
  const W = w * px, H = h * px;
  const { grid, names } = coverGrid(town);
  const water = new Uint8Array(w * h);
  for (const chain of town.river) for (const [x, y] of chain) if (x >= 0 && y >= 0 && x < w && y < h) water[y * w + x] = 1;
  const base = names.map((n) => rgb(COVER[n] ?? COVER.ground!));
  const iWood = names.indexOf("woodland"), iFarm = names.indexOf("farmland"), iWet = names.indexOf("wetland"), iScrub = names.indexOf("scrub");
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const pool = rgb("#4f6a6e");
  for (let Y = 0; Y < H; Y++) {
    const cy = Math.floor(Y / px), fy = (Y + 0.5) / px;
    for (let X = 0; X < W; X++) {
      const cx = Math.floor(X / px), fx = (X + 0.5) / px;
      const ci = cy * w + cx;
      const k = grid[ci]!;
      let c: number[] = base[k]!;
      const n = fbm(fx * 0.25, fy * 0.25, 11);
      let s = 0.88 + n * 0.24;
      if (k === iWood) {
        c = mixc(c, rgb("#4b5a35"), noise2(fx * 0.6, fy * 0.6, 9));
        s = 0.75 + noise2(fx * 3, fy * 3, 5) * 0.35;
      } else if (k === iFarm) {
        // Fields of 3 x 3 cells, each its own crop, ploughed or sown in rows.
        const bx = Math.floor(cx / 3), by = Math.floor(cy / 3);
        const hb = h01(bx * 131 + by * 977, 3);
        c = CROPS[Math.floor(hb * CROPS.length)]!;
        const along = hb < 0.5 ? fx : fy;
        s = 0.92 + 0.08 * Math.sin(along * Math.PI * 7) + (n - 0.5) * 0.14;
        // A headland strip round the field's edge.
        const ex = (fx / 3) % 1, ey = (fy / 3) % 1;
        if (ex < 0.035 || ey < 0.035 || ex > 0.965 || ey > 0.965) { c = rgb("#7d8a56"); s = 0.95; }
      } else if (k === iWet) {
        const t = noise2(fx * 1.3, fy * 1.3, 21);
        if (t > 0.64) { c = mixc(c, pool, Math.min(1, (t - 0.64) * 8)); s = 0.95; }
        else { c = mixc(c, rgb("#7d8a5a"), noise2(fx * 4, fy * 4, 22) * 0.5); }
      } else if (k === iScrub) {
        const t = noise2(fx * 3, fy * 3, 31);
        s = 0.85 + n * 0.2 + (t > 0.68 ? -0.2 : 0);
      } else {
        c = mixc(c, rgb("#7f8a52"), noise2(fx * 0.9, fy * 0.9, 61) * 0.6);
      }
      if (water[ci]) { c = mixc(c, rgb("#5e6e4e"), 0.6); }
      const o = (Y * W + X) * 4;
      d[o] = Math.min(255, c[0]! * s); d[o + 1] = Math.min(255, c[1]! * s); d[o + 2] = Math.min(255, c[2]! * s); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The country beyond the district: a tiling patchwork of fields and meadows with hedges, for the haze to take. One
 * tile is `metres` across. Nothing here is the world's: the world ends at the district's edge. */
export function beyondTexture(metres = 2400): THREE.CanvasTexture {
  const N = 1024, px = N / metres;
  const cv = Object.assign(document.createElement("canvas"), { width: N, height: N });
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#6c7f47";
  ctx.fillRect(0, 0, N, N);
  const fields = ["#878553", "#938d5c", "#76884c", "#7f7150", "#6f8249", "#6a7d45", "#8a8656"];
  // Fields on a jittered grid of about 150 m, drawn wrapped so the tile repeats without a seam.
  const G = 16, cellPx = N / G;
  let k = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const r = h01(gx * 31 + gy * 977, 71), r2 = h01(gx * 31 + gy * 977, 72);
    const split = r < 0.5;
    for (let part = 0; part < (split ? 2 : 1); part++) {
      const c = fields[Math.floor(h01(k++, 73) * fields.length)]!;
      const x = gx * cellPx, y = gy * cellPx;
      const w = split && r2 < 0.5 ? cellPx / 2 : cellPx, h = split && r2 >= 0.5 ? cellPx / 2 : cellPx;
      const ox = split && r2 < 0.5 ? part * cellPx / 2 : 0, oy = split && r2 >= 0.5 ? part * cellPx / 2 : 0;
      ctx.fillStyle = c;
      ctx.fillRect(x + ox, y + oy, w, h);
      // Furrows.
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "#000";
      if (h01(k, 74) < 0.6) for (let s = 2; s < (r2 < 0.5 ? w : h); s += 4) r2 < 0.5 ? ctx.fillRect(x + ox + s, y + oy, 1, h) : ctx.fillRect(x + ox, y + oy + s, w, 1);
      ctx.globalAlpha = 1;
      // Hedges round the field.
      ctx.strokeStyle = "#465a36";
      ctx.lineWidth = Math.max(1, 3 * px * 2);
      ctx.strokeRect(x + ox, y + oy, w, h);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A tiling detail texture (grey around mid), multiplied into the ground at a few metres a tile. */
export function detailTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Tileable: noise on a torus by sampling with wrapped lattice.
    const v = (tile(x / 16, y / 16, 16, 1) * 0.5 + tile(x / 6, y / 6, N / 6, 2) * 0.3 + tile(x / 2.5, y / 2.5, N / 2.5, 3) * 0.2);
    const g = Math.round(150 + (v - 0.5) * 110);
    const o = (y * N + x) * 4;
    data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
function tile(x: number, y: number, period: number, seed: number): number {
  const P = Math.max(1, Math.round(period));
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i: number, j: number) => h01(((((i % P) + P) % P) * 73856093) ^ ((((j % P) + P) % P) * 19349663), seed);
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Ground material: the painted map times the detail texture (tiled every `metres`), lit and shadowed. */
export function groundMaterial(map: THREE.Texture, detail: THREE.Texture, size: [number, number], metres = 7): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.97, metalness: 0, envMapIntensity: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uRep = { value: new THREE.Vector2(size[0] / metres, size[1] / metres) };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;\nuniform vec2 uRep;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float dt = texture2D(uDetail, vMapUv * uRep).r * 0.6 + texture2D(uDetail, vMapUv * uRep * 0.13).r * 0.4;
        diffuseColor.rgb *= 0.55 + dt * 0.9;`);
  };
  return m;
}
