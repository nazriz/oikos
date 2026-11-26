// The map: a stylised 3D town that follows Lens's one clock. Ground painted by cover, roads, buildings extruded by
// kind and size under a light that follows the hour, people as glowing points at the building they are in and
// moving along the roads between, and overlays: who is where, the seat's acts, disrepair, wildlife, the networks.
// Reads the town and people bundles (src/folds/town.ts, people.ts); talks to the rest of Lens only through useLens.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, LightingEffect, LinearInterpolator, OrbitView } from "@deck.gl/core";
import type { OrbitViewState, PickingInfo } from "@deck.gl/core";
import { ArcLayer, BitmapLayer, ColumnLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { useLens } from "../state";
import { hash01, loadCity, personRows, placeAt, strHash, tripOf, type CityData } from "./data";
import { along, hex, mix, PAL, paintBeyond, paintGround, rect, Roads, shapeOf, treesOf, WHERE_LABEL, type RGBA, type Shape } from "./scene";
import { skyAt } from "./sky";
import { Panel, Tooltip, Clock, type Overlays, type HoverInfo, DEFAULT_OVERLAYS, Card } from "./Panel";
import { CITY_CSS } from "./style";

const DAY = 86_400;
/** A gap between leaving one place and entering the next longer than this is not a walk: they are away. */
const MAX_TRIP = 3 * 3600;
const ACT_WINDOW = 7 * DAY;

export interface CityViewProps {
  /** The run's key; defaults to the open run in the shared state. (`run` is the same, as the shell's map slot passes it.) */
  runKey?: string;
  run?: string;
  /** Show the selection card on the map (default true; the shell's inspector drawer may stand in for it). */
  card?: boolean;
  /** Where the bundle is served; defaults to `/api/run/<key>`. */
  base?: string;
  /** Start the camera here instead of framed on the town (zoom, rotationX = tilt, rotationOrbit = turn, target in metres). */
  camera?: Partial<{ zoom: number; rotationX: number; rotationOrbit: number; target: [number, number, number] }>;
}

export function CityView({ runKey, run: runProp, base, camera, card = true }: CityViewProps) {
  const open = useLens((s) => s.run);
  const key = runKey ?? runProp ?? open;
  const url = base ?? (key ? `/api/run/${encodeURIComponent(key)}` : null);
  const { city, error } = useCity(url);
  return (
    <div className="lens-city">
      <style>{CITY_CSS}</style>
      {city ? <Map city={city} camera={camera} card={card} /> : <div className="lc-loading">{error ? <span className="lc-err">The town could not be read: {error}</span> : url ? <><div className="lc-spin" />Drawing the town</> : "No run open"}</div>}
    </div>
  );
}

interface Built {
  shapes: Shape[];
  /** Indices of drawable buildings (boxes), parks, roads. */
  boxes: number[];
  parks: number[];
  windows: { pos: Float32Array; owner: Uint32Array; h: Float32Array; n: number };
  lamps: Float32Array;
  trees: Float32Array;
  ground: HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
  /** The land beyond the district: fades out to the backdrop. */
  beyond: HTMLCanvasElement | OffscreenCanvas;
  roads: Roads;
  /** Per person: jitter inside their building (fractions of footprint). */
  jx: Float32Array; jy: Float32Array; jz: Float32Array;
  disrepairMax: number;
  labels: { pos: [number, number, number]; text: string; size: number; tier: number }[];
}

function build(c: CityData): Built {
  const town = c.town, cell = town.ground.cell;
  const shapes = town.structures.map((s) => shapeOf(s, cell));
  const boxes: number[] = [], parks: number[] = [];
  shapes.forEach((sh, i) => { if (sh.kind === "box") boxes.push(i); else if (sh.kind === "flat") parks.push(i); });
  // Windows: on each wall, a row per floor.
  const wp: number[] = [], wo: number[] = [], wh: number[] = [];
  for (const i of boxes) {
    const sh = shapes[i]!, s = town.structures[i]!;
    if (!["residential", "commercial", "civic", "health", "education"].includes(s.category)) continue;
    const fl = sh.height / Math.max(1, sh.floors);
    for (let f = 0; f < sh.floors; f++) {
      const z = f * fl + fl * 0.55;
      for (const [ax, ay, len, nx, ny] of [[1, 0, sh.fw, 0, -1], [1, 0, sh.fw, 0, 1], [0, 1, sh.fh, -1, 0], [0, 1, sh.fh, 1, 0]] as const) {
        const n = Math.max(1, Math.floor(len / 4.2));
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n - 0.5;
          const x = sh.cx + ax * u * len * 0.86 + nx * (sh.fw / 2 + 0.25);
          const y = sh.cy + ay * u * len * 0.86 + ny * (sh.fh / 2 + 0.25);
          wp.push(x, y, z); wo.push(i); wh.push(hash01(wp.length, i));
        }
      }
    }
  }
  // Street lamps: one at each road cell, to one side.
  const lamps: number[] = [];
  for (const id of town.structures.filter((s) => s.category === "transport")) lamps.push((id.x + 0.2) * cell, -(id.y + 0.2) * cell, 5);
  const nP = c.people.people.length;
  const jx = new Float32Array(nP), jy = new Float32Array(nP), jz = new Float32Array(nP);
  for (let q = 0; q < nP; q++) { jx[q] = hash01(q, 1) - 0.5; jy[q] = hash01(q, 2) - 0.5; jz[q] = hash01(q, 3); }
  let disrepairMax = 1;
  for (const s of town.structures) if (s.vars?.disrepair !== undefined) disrepairMax = Math.max(disrepairMax, s.vars.disrepair);
  const labels: Built["labels"] = [];
  for (const p of town.places) {
    const a = p.area;
    if (p.kind === "district") labels.push({ pos: [(a.x + a.w * 0.5) * cell, -(a.y + a.h - 3) * cell, 0], text: p.name.toUpperCase(), size: 13, tier: 0 });
    else labels.push({ pos: [(a.x + a.w / 2) * cell, -(a.y - 1.6) * cell, 0], text: p.name.toUpperCase(), size: 15, tier: 0 });
  }
  town.structures.forEach((s, i) => {
    if (!["civic", "health", "education", "utility"].includes(s.category) && !(s.category === "commercial" && /office/.test(s.type))) return;
    const sh = shapes[i]!;
    labels.push({ pos: [sh.cx, sh.cy, sh.height + 6], text: structureName(c, i), size: 11, tier: 1 });
  });
  return {
    shapes, boxes, parks,
    windows: { pos: new Float32Array(wp), owner: new Uint32Array(wo), h: new Float32Array(wh), n: wo.length },
    lamps: new Float32Array(lamps), trees: treesOf(town), ground: paintGround(town), beyond: paintBeyond(), roads: new Roads(town), jx, jy, jz, disrepairMax, labels,
  };
}

export function structureName(c: CityData, i: number): string {
  const s = c.town.structures[i]!;
  if (s.houses && c.town.entities[s.houses]) {
    const e = c.town.entities[s.houses]!;
    if (e.kind === "government") return s.category === "civic" ? "Town hall" : e.name;
    return e.name;
  }
  return pretty(s.id);
}
export const pretty = (id: string) => {
  const t = id.replace(/^apts-/, "apartments-").replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function fitZoom(w: number, h: number, metresW: number, metresH: number) {
  return Math.log2(Math.min(w / metresW, h / metresH));
}

/** The city's data for a bundle URL, loaded once and shared (the map and the inspector read the same). */
const cityCache = new globalThis.Map<string, Promise<CityData>>();
export function useCity(url: string | null): { city: CityData | null; error: string | null } {
  const [state, setState] = useState<{ city: CityData | null; error: string | null; url: string | null }>({ city: null, error: null, url: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    let p = cityCache.get(url);
    if (!p) { p = loadCity(url); cityCache.set(url, p); p.catch(() => cityCache.delete(url)); }
    p.then((c) => { if (live) setState({ city: c, error: null, url }); }, (e) => { if (live) setState({ city: null, error: String(e?.message ?? e), url }); });
    return () => { live = false; };
  }, [url]);
  return state.url === url ? state : { city: null, error: null };
}

function Map({ city, camera, card }: { city: CityData; camera?: CityViewProps["camera"]; card: boolean }) {
  const t = useLens((s) => s.t);
  const selection = useLens((s) => s.selection);
  const hovered = useLens((s) => s.hovered);
  const select = useLens((s) => s.select);
  const hover = useLens((s) => s.hover);
  const setTrack = useLens((s) => s.setTrack);
  const setSpan = useLens((s) => s.setSpan);
  const span = useLens((s) => s.span);
  const B = useMemo(() => build(city), [city]);
  const town = city.town, cell = town.ground.cell;
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [overlays, setOverlays] = useState<Overlays>(() => {
    try { return { ...DEFAULT_OVERLAYS, ...JSON.parse(localStorage.getItem("lens.city.overlays") ?? "{}") }; } catch { return DEFAULT_OVERLAYS; }
  });
  useEffect(() => { try { localStorage.setItem("lens.city.overlays", JSON.stringify(overlays)); } catch { /* private mode */ } }, [overlays]);
  const [tip, setTip] = useState<HoverInfo | null>(null);

  // The span, when nothing else has set one (the shell does, from the meta fold).
  useEffect(() => { if (span[1] === 0 && town.span[1] > 0) setSpan(town.span); }, [town, span, setSpan]);

  // Timeline: the town's own moments and the seat's acts.
  useEffect(() => {
    setTrack({
      id: "city.acts", label: "Acts on the town",
      marks: town.acts.map((a) => ({ t: a.t, label: actLabel(a), tone: a.status === "refused" ? "bad" : "seat", select: { kind: "act", seq: a.seq } })),
    });
    setTrack({
      id: "city.moments", label: "Town",
      marks: town.moments.filter((m) => m.kind !== "birth_begun").map((m) => ({ t: m.t, label: momentLabel(m), tone: m.kind === "death" ? "bad" : m.kind === "building_completed" ? "good" : "muted" })),
    });
  }, [town, setTrack]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    return () => ro.disconnect();
  }, []);

  // The camera: framed on the town (first place below the district), the district around it.
  const home = useMemo((): OrbitViewState => {
    const tp = town.places.find((p) => p.kind !== "district") ?? town.places[0];
    const a = tp?.area ?? { x: 0, y: 0, w: town.ground.w, h: town.ground.h };
    return { target: [(a.x + a.w / 2) * cell, -(a.y + a.h / 2 + 2) * cell, 0], zoom: fitZoom(size.w, size.h, a.w * cell * 0.95, a.h * cell * 1.15), rotationX: 48, rotationOrbit: -18, minZoom: -4, maxZoom: 4.5, minRotationX: 12, maxRotationX: 90, ...camera } as OrbitViewState;
  }, [town, cell, size.w > 700, size.h > 500]);
  const [view, setView] = useState<OrbitViewState>(home);
  const homed = useRef(false);
  useEffect(() => { if (!homed.current && size.w > 1) { homed.current = true; setView(home); } }, [home, size.w]);

  // Where everyone is, now.
  city.where.seek(t);
  const hour = ((t % DAY) + DAY) % DAY / 3600;
  const dark = useDark();
  const sky = useMemo(() => skyAt(Math.round(hour * 12) / 12, dark), [Math.round(hour * 12), dark]);
  const effects = useMemo(() => [new LightingEffect({
    ambient: new AmbientLight({ color: sky.ambientColor, intensity: sky.ambientIntensity }),
    sun: new DirectionalLight({ color: sky.sunColor, intensity: sky.sunIntensity, direction: sky.sunDir }),
    fill: new DirectionalLight({ color: [150, 170, 220], intensity: 0.25 + 0.15 * sky.night, direction: [-0.4, -0.8, -0.5] }),
  })], [sky]);

  // Selection-derived ids.
  const selS = sel2structure(city, selection);
  const selP = selection?.kind === "person" ? city.pById.get(selection.id) ?? -1 : -1;
  const hovS = sel2structure(city, hovered);
  const selAct = selection?.kind === "act" ? selection.seq : hovered?.kind === "act" ? hovered.seq : -1;

  // Fly to what is selected.
  useEffect(() => {
    let p: [number, number, number] | undefined;
    if (selS >= 0) { const sh = B.shapes[selS]!; p = [sh.cx, sh.cy, 0]; }
    else if (selP >= 0) { const xy = personXY(city, B, selP, useLens.getState().t); if (xy) p = [xy[0], xy[1], 0]; }
    if (!p) return;
    setView((v) => ({ ...v, target: p!, zoom: Math.max(v.zoom as number, 2.1), transitionDuration: 900, transitionInterpolator: new LinearInterpolator(["target", "zoom"]) } as any));
  }, [selS, selP]);

  // ---- People, every frame ----
  const nP = city.where.nP;
  const people = useMemo(() => ({ pos: new Float32Array(nP * 3), col: new Uint8Array(nP * 4), counts: {} as Record<string, number> }), [nP]);
  const kindNames = city.people.spaceKinds;
  const whereCol = useMemo(() => kindNames.map((k) => hex(PAL.where[k] ?? PAL.where.other!)), [kindNames]);
  const movingCol = hex(PAL.where.moving!);
  {
    const W = city.where, pos = people.pos, col = people.col, counts: Record<string, number> = {};
    const tmp: [number, number] = [0, 0];
    for (let q = 0; q < nP; q++) {
      const s = W.at[q]!;
      let a = 0, c: RGBA = movingCol;
      if (s >= 0) {
        const sh = B.shapes[s]!;
        // Gathered on the roof of the building they are in, spread over its footprint.
        pos[q * 3] = sh.cx + B.jx[q]! * sh.fw * 0.8;
        pos[q * 3 + 1] = sh.cy + B.jy[q]! * sh.fh * 0.8;
        pos[q * 3 + 2] = sh.height + sh.roof + 0.8 + B.jz[q]! * 0.6;
        const k = W.kind[q]!;
        c = whereCol[k] ?? movingCol;
        a = 255;
        const name = kindNames[k] ?? "other";
        counts[name] = (counts[name] ?? 0) + 1;
      } else {
        const trip = tripOf(city, q);
        if (trip && trip.from >= 0 && trip.to >= 0 && trip.t2 - trip.t1 <= MAX_TRIP) {
          const r = B.roads.route(town.structures[trip.from]!, town.structures[trip.to]!);
          along(r, (t - trip.t1) / Math.max(1, trip.t2 - trip.t1), tmp);
          pos[q * 3] = tmp[0] + B.jx[q]! * 3; pos[q * 3 + 1] = tmp[1] + B.jy[q]! * 3; pos[q * 3 + 2] = 1.6;
          a = 255;
          counts.moving = (counts.moving ?? 0) + 1;
        } else if (trip || city.people.people[q]) {
          const gone = city.people.died[q] !== undefined && city.people.died[q]! <= t ? "died" : city.people.left[q] !== undefined && city.people.left[q]! <= t ? "left" : city.people.joined[q] !== undefined && city.people.joined[q]! > t ? "unborn" : "away";
          counts[gone] = (counts[gone] ?? 0) + 1;
        }
      }
      col[q * 4] = c[0]; col[q * 4 + 1] = c[1]; col[q * 4 + 2] = c[2]; col[q * 4 + 3] = a;
    }
    people.counts = counts;
  }

  // ---- Windows and pools of light, when anyone's place changes or the hour does ----
  const ver = city.where.version;
  const glow = useMemo(() => {
    const W = city.where, n = B.windows.n;
    const col = new Uint8Array(n * 4);
    const warm = hex(PAL.window);
    for (let i = 0; i < n; i++) {
      const s = B.windows.owner[i]!;
      const st = town.structures[s]!;
      const cap = Math.max(1, Object.values(st.spaces).reduce((a, b) => a + b, 0) * (st.category === "residential" ? 2.2 : 6));
      const frac = Math.min(1, W.count[s]! / cap) * 0.85 + (W.count[s]! > 0 ? 0.2 : 0);
      const lit = B.windows.h[i]! < frac;
      col[i * 4] = warm[0]; col[i * 4 + 1] = warm[1] - B.windows.h[i]! * 30; col[i * 4 + 2] = warm[2] - B.windows.h[i]! * 40;
      col[i * 4 + 3] = lit ? 255 * sky.night : 0;
    }
    const pools: { p: [number, number]; r: number; a: number }[] = [];
    for (const i of B.boxes) {
      const k = W.count[i]!;
      if (k > 0) pools.push({ p: [B.shapes[i]!.cx, B.shapes[i]!.cy], r: 10 + Math.min(20, Math.sqrt(k) * 4.5), a: Math.min(1, 0.3 + k / 12) });
    }
    return { col, pools, data: { length: n, attributes: { getPosition: { value: B.windows.pos, size: 3 }, getFillColor: { value: col, size: 4, normalized: true } } } };
  }, [ver, sky.night, B, city]);

  // ---- Static data (kept by reference, so deck.gl does not recompute it each frame) ----
  const staticLayers = useMemo(() => ({
    W: town.ground.w * cell, H: town.ground.h * cell,
    trees: { length: B.trees.length / 4 },
    lamps: { length: B.lamps.length / 3, attributes: { getPosition: { value: B.lamps, size: 3 } } },
    wildlife: { length: town.wildlife.cells.length / 4 },
    nets: town.networks.filter((l) => l.mode !== "road"),
    labels0: B.labels.filter((l) => l.tier === 0),
    labels1: B.labels,
  }), [town, cell, B]);

  const buildingColor = useCallback((i: number): RGBA => {
    const s = town.structures[i]!;
    if (overlays.colour === "disrepair") {
      const v = s.vars?.disrepair;
      if (v === undefined) return hex("#4a4f5a");
      const f = Math.sqrt(v / B.disrepairMax);
      return f < 0.5 ? mix(hex("#7e8fa6"), hex("#d9c08a"), f * 2) : mix(hex("#d9c08a"), hex("#d0603a"), (f - 0.5) * 2);
    }
    const base = hex(PAL.category[s.category] ?? PAL.category.other!);
    const r = hash01(strHash(s.id), 3);
    return mix(base, [base[0] * 0.82, base[1] * 0.82, base[2] * 0.82, 255], r * 0.6);
  }, [town, overlays.colour, B]);

  const visibleBoxes = useMemo(() => B.boxes.filter((i) => { const s = town.structures[i]!; return s.started === undefined || s.started <= t; }), [B, town, Math.floor(t / 3600)]);
  const underWay = (i: number) => { const s = town.structures[i]!; return s.started !== undefined && (s.completed === undefined || s.completed > t); };
  const roofBoxes = useMemo(() => visibleBoxes.filter((i) => !underWay(i)), [visibleBoxes]);

  // The selected person's day so far: each move since midnight, along the roads.
  const trail = useMemo(() => {
    if (selP < 0) return [];
    const rows = personRows(city)[selP]!;
    const day0 = Math.floor(t / DAY) * DAY;
    const out: { path: [number, number, number][]; done: boolean }[] = [];
    const tmp: [number, number] = [0, 0];
    for (const r of rows) {
      if (city.rows.k[r]! >= 0 || city.rows.t[r]! > t) continue;
      const nx = city.nextIn[r]!;
      if (nx < 0 || city.rows.t[nx]! < day0) continue;
      const a = city.rows.s[r]!, b = city.rows.s[nx]!;
      if (a < 0 || b < 0 || a === b) continue;
      const route = B.roads.route(town.structures[a]!, town.structures[b]!);
      const t1 = city.rows.t[r]!, t2 = city.rows.t[nx]!;
      const f = t >= t2 ? 1 : (t - t1) / Math.max(1, t2 - t1);
      const path: [number, number, number][] = [];
      for (let i = 0; i < route.pts.length && route.cum[i]! <= f * route.len; i++) path.push([route.pts[i]![0], route.pts[i]![1], 1.2]);
      along(route, f, tmp);
      path.push([tmp[0], tmp[1], 1.2]);
      if (path.length > 1) out.push({ path, done: f >= 1 });
    }
    return out;
  }, [selP, city, B, town, Math.floor(t / 120)]);

  const actsNow = useMemo(() => {
    return town.acts.filter((a) => (a.t <= t && a.t > t - ACT_WINDOW) || a.seq === selAct);
  }, [town, Math.floor(t / 600), selAct]);
  const arcs = useMemo(() => {
    const hall = town.hall;
    if (hall === undefined) return [];
    const src = B.shapes[hall]!;
    const out: { from: [number, number, number]; to: [number, number, number]; age: number; act: (typeof town.acts)[number]; target: string; refused: boolean }[] = [];
    for (const a of actsNow) {
      const seen = new Set<number>();
      for (const bl of a.blocks) for (const id of bl.to) {
        const tg = town.targets[id];
        let s = -1;
        if (tg?.kind === "entity" && tg.structure !== undefined) s = tg.structure;
        else if (tg?.kind === "person" && tg.person) s = placeAt(city, tg.person, a.t);
        if (s < 0 || s === hall || seen.has(s)) continue;
        seen.add(s);
        const sh = B.shapes[s]!;
        out.push({ from: [src.cx, src.cy, src.height + 2], to: [sh.cx, sh.cy, sh.height + 1], age: Math.max(0, t - a.t) / ACT_WINDOW, act: a, target: tg?.name ?? id, refused: a.status === "refused" });
      }
    }
    return out;
  }, [actsNow, B, city, town, Math.floor(t / 600)]);

  const layers = [
    new BitmapLayer({
      id: "beyond", image: B.beyond as any, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      bounds: [-staticLayers.W * 1.5, -staticLayers.H * 2.5, staticLayers.W * 2.5, staticLayers.H * 1.5],
      tintColor: sky.groundTint, parameters: { depthWriteEnabled: false },
    }),
    new BitmapLayer({
      id: "ground", image: B.ground as any, bounds: [0, -staticLayers.H, staticLayers.W, 0], coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      tintColor: sky.groundTint, textureParameters: { minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" } as any,
    }),
    new PathLayer({
      id: "river", data: town.river, getPath: ((c: [number, number][]) => c.map(([x, y]) => [(x + 0.5) * cell, -(y + 0.5) * cell, 0.2])) as any,
      getColor: [...mix(hex("#3f7fa0"), hex("#1b3550"), sky.night * 0.7).slice(0, 3), 200] as any, getWidth: cell * 0.62, widthUnits: "meters", capRounded: true, jointRounded: true,
      updateTriggers: { getColor: sky.night },
    }),
    new LineLayer({
      id: "roads-bed", data: B.roads.segments, getSourcePosition: (s: any) => [s.a[0], s.a[1], 0.25], getTargetPosition: (s: any) => [s.b[0], s.b[1], 0.25],
      getColor: mix(hex("#4c5058"), hex("#2a2e37"), sky.night) as any, getWidth: cell * 0.5, widthUnits: "meters", updateTriggers: { getColor: sky.night },
    }),
    new LineLayer({
      id: "roads-line", data: B.roads.segments, getSourcePosition: (s: any) => [s.a[0], s.a[1], 0.35], getTargetPosition: (s: any) => [s.b[0], s.b[1], 0.35],
      getColor: [230, 224, 210, 70 - sky.night * 40], getWidth: 0.5, widthUnits: "meters", widthMinPixels: 0.5, updateTriggers: { getColor: sky.night },
    }),
    new SolidPolygonLayer({
      id: "parks", data: B.parks, getPolygon: (i: number) => { const sh = B.shapes[i]!; return rect(sh.cx, sh.cy, sh.fw, sh.fh, 0.3); },
      getFillColor: [92, 128, 84, 255], extruded: false, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 40],
    }),
    new ColumnLayer({
      id: "trees", data: staticLayers.trees, diskResolution: 7, extruded: true,
      getPosition: (_: any, { index }: any) => [B.trees[index * 4]!, B.trees[index * 4 + 1]!, 0],
      getElevation: (_: any, { index }: any) => B.trees[index * 4 + 2]!,
      getFillColor: (_: any, { index }: any) => { const r = hash01(index, 17); return [52 + r * 30, 86 + r * 34, 50 + r * 18, 255]; },
      radius: 3.4, radiusUnits: "meters", getLineColor: [0, 0, 0, 0],
      material: { ambient: 0.5, diffuse: 0.6, shininess: 8, specularColor: [30, 40, 30] },
    } as any),
    new SolidPolygonLayer({
      id: "buildings", data: visibleBoxes, extruded: true, wireframe: false, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 50],
      getPolygon: (i: number) => { const sh = B.shapes[i]!; return rect(sh.cx, sh.cy, sh.fw, sh.fh); },
      getElevation: (i: number) => { const sh = B.shapes[i]!; if (!underWay(i)) return sh.height; const s = town.structures[i]!; const f = s.completed ? 1 : Math.min(1, (t - s.started!) / (s.completed ?? s.started! + 90 * DAY)); return Math.max(0.6, sh.height * f); },
      getFillColor: (i: number) => underWay(i) ? [190, 175, 150, 140] : i === selS ? mix(buildingColor(i), hex(PAL.seat), 0.35) : buildingColor(i),
      material: { ambient: 0.42, diffuse: 0.62, shininess: 24, specularColor: [60, 60, 70] },
      updateTriggers: { getFillColor: [overlays.colour, selS, Math.floor(t / 3600)], getElevation: Math.floor(t / 3600) },
    }),
    new SolidPolygonLayer({
      id: "roofs", data: roofBoxes, extruded: true,
      getPolygon: (i: number) => { const sh = B.shapes[i]!; return rect(sh.cx, sh.cy, sh.fw - 1.6, sh.fh - 1.6, sh.height); },
      getElevation: (i: number) => B.shapes[i]!.roof,
      getFillColor: (i: number) => { const c = buildingColor(i); return [c[0] * 0.7, c[1] * 0.68, c[2] * 0.66, 255]; },
      material: { ambient: 0.4, diffuse: 0.55, shininess: 12, specularColor: [40, 40, 50] },
      updateTriggers: { getFillColor: [overlays.colour] },
    }),
    // Night: street lamps, lit windows, pools of light.
    sky.night > 0.02 && new ScatterplotLayer({
      id: "lamps", data: staticLayers.lamps,
      getFillColor: [255, 196, 120, 38 * sky.night], getRadius: 3.2, radiusUnits: "meters", billboard: false, updateTriggers: { getFillColor: sky.night },
      parameters: ADDITIVE,
    }),
    sky.night > 0.02 && new ScatterplotLayer({
      id: "pools", data: glow.pools, getPosition: (d: any) => [d.p[0], d.p[1], 0.5], getRadius: (d: any) => d.r, radiusUnits: "meters", billboard: false,
      getFillColor: (d: any) => [255, 170, 90, 26 * d.a * sky.night], parameters: ADDITIVE, updateTriggers: { getFillColor: sky.night },
    }),
    sky.night > 0.02 && new ScatterplotLayer({
      id: "windows", data: glow.data,
      getRadius: 1.1, radiusUnits: "meters", radiusMinPixels: 0.8, radiusMaxPixels: 5, billboard: true, parameters: { depthWriteEnabled: false },
    }),
    // Overlays.
    overlays.networks && new LineLayer({
      id: "networks", data: staticLayers.nets,
      getSourcePosition: (l: any) => [(l.a[0] + 0.5) * cell + NET_OFF[l.mode]!, -(l.a[1] + 0.5) * cell + NET_OFF[l.mode]!, 0.6],
      getTargetPosition: (l: any) => [(l.b[0] + 0.5) * cell + NET_OFF[l.mode]!, -(l.b[1] + 0.5) * cell + NET_OFF[l.mode]!, 0.6],
      getColor: (l: any) => hex(NET_COL[l.mode] ?? "#cccccc", 200), getWidth: 2, widthUnits: "pixels", pickable: true,
    }),
    overlays.wildlife && new ScatterplotLayer({
      id: "wildlife", data: staticLayers.wildlife,
      getPosition: (_: any, { index }: any) => { const c = town.wildlife.cells; return [(c[index * 4]! + 0.2 + 0.6 * hash01(index, 1)) * cell, -(c[index * 4 + 1]! + 0.2 + 0.6 * hash01(index, 2)) * cell, 1]; },
      getRadius: (_: any, { index }: any) => 3 + Math.sqrt(town.wildlife.cells[index * 4 + 3]!) * 2.5,
      getFillColor: (_: any, { index }: any) => hex(SPECIES_COL[town.wildlife.cells[index * 4 + 2]! % SPECIES_COL.length]!, 210),
      radiusUnits: "meters", radiusMinPixels: 1.5, billboard: false, pickable: true, stroked: false,
    }),
    overlays.acts && arcs.length > 0 && new ArcLayer({
      id: "acts", data: arcs, getSourcePosition: (d: any) => d.from, getTargetPosition: (d: any) => d.to,
      getSourceColor: (d: any) => hex(d.refused ? PAL.flag : PAL.seat, (d.act.seq === selAct ? 255 : 235) * (1 - d.age * 0.8)),
      getTargetColor: (d: any) => hex(d.refused ? PAL.flag : "#ffe2a6", (d.act.seq === selAct ? 255 : 220) * (1 - d.age * 0.85)),
      getWidth: (d: any) => (d.act.seq === selAct ? 4 : 1.6 + 1.6 * (1 - d.age)), getHeight: 0.45, greatCircle: false, pickable: true,
      updateTriggers: { getSourceColor: [selAct], getTargetColor: [selAct], getWidth: [selAct] },
    }),
    overlays.acts && new ScatterplotLayer({
      id: "act-hits", data: arcs.filter((d) => t - d.act.t < 12 * 3600 || d.act.seq === selAct),
      getPosition: (d: any) => [d.to[0], d.to[1], d.to[2]], getRadius: (d: any) => 8 + ((t - d.act.t) / 3600) * 2.5, radiusUnits: "meters", billboard: false,
      stroked: true, filled: false, getLineColor: (d: any) => hex(d.refused ? PAL.flag : PAL.seat, Math.max(0, 230 * (1 - (t - d.act.t) / (12 * 3600)))), getLineWidth: 1.5, lineWidthUnits: "pixels",
      updateTriggers: { getRadius: Math.floor(t / 300), getLineColor: Math.floor(t / 300) },
    }),
    // The seat's hall: a quiet amber ring when it acted lately.
    town.hall !== undefined && overlays.acts && new ScatterplotLayer({
      id: "hall", data: [town.hall], getPosition: (i: number) => [B.shapes[i]!.cx, B.shapes[i]!.cy, 0.6], getRadius: 22, radiusUnits: "meters", billboard: false,
      stroked: true, filled: true, getFillColor: hex(PAL.seat, 26), getLineColor: hex(PAL.seat, 150), getLineWidth: 1.2, lineWidthUnits: "pixels",
    }),
    // People.
    overlays.people && new ScatterplotLayer({
      id: "people-halo", data: { length: nP, attributes: { getPosition: { value: people.pos, size: 3 }, getFillColor: { value: people.col, size: 4, normalized: true } } },
      getRadius: 1.9, radiusUnits: "meters", radiusMinPixels: 2.2, radiusMaxPixels: 7, billboard: true, opacity: 0.16 + 0.22 * sky.night, parameters: ADDITIVE,
    }),
    overlays.people && new ScatterplotLayer({
      id: "people", data: { length: nP, attributes: { getPosition: { value: people.pos, size: 3 }, getFillColor: { value: people.col, size: 4, normalized: true } } },
      getRadius: 0.7, radiusUnits: "meters", radiusMinPixels: 0.9, radiusMaxPixels: 3, billboard: true, pickable: true, parameters: { depthWriteEnabled: false },
    }),
    // Selection.
    trail.length > 0 && new PathLayer({
      id: "sel-trail", data: trail, getPath: (d: any) => d.path, getColor: (d: any) => hex(PAL.seat, d.done ? 150 : 255), getWidth: 2.2, widthUnits: "pixels",
      capRounded: true, jointRounded: true, parameters: { depthCompare: "always" },
    }),
    selS >= 0 && new PathLayer({
      id: "sel-outline", data: [selS], getPath: (i: number) => { const sh = B.shapes[i]!; const r = rect(sh.cx, sh.cy, sh.fw + 3, sh.fh + 3, 0.6); return [...r, r[0]!]; },
      getColor: hex(PAL.seat), getWidth: 2, widthUnits: "pixels",
    }),
    hovS >= 0 && hovS !== selS && new PathLayer({
      id: "hov-outline", data: [hovS], getPath: (i: number) => { const sh = B.shapes[i]!; const r = rect(sh.cx, sh.cy, sh.fw + 3, sh.fh + 3, 0.6); return [...r, r[0]!]; },
      getColor: [255, 255, 255, 160], getWidth: 1.5, widthUnits: "pixels",
    }),
    selP >= 0 && people.col[selP * 4 + 3]! > 0 && new ScatterplotLayer({
      id: "sel-person", data: [selP], getPosition: (q: number) => [people.pos[q * 3]!, people.pos[q * 3 + 1]!, people.pos[q * 3 + 2]!], getRadius: 7, radiusUnits: "pixels",
      stroked: true, filled: false, getLineColor: hex(PAL.seat), getLineWidth: 2, lineWidthUnits: "pixels", billboard: true, parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: t },
    }),
    overlays.labels && new TextLayer({
      id: "labels", data: (view.zoom as number) > 0.9 ? staticLayers.labels1 : staticLayers.labels0, getPosition: (l: any) => l.pos, getText: (l: any) => l.text, getSize: (l: any) => l.size,
      getColor: (l: any) => (l.tier === 0 ? [232, 230, 225, 150] : [232, 230, 225, 215]), fontFamily: "Inter Variable, Inter, system-ui, sans-serif", fontWeight: 500,
      characterSet: "auto", billboard: true, getTextAnchor: "middle", getAlignmentBaseline: "bottom", fontSettings: { sdf: true, fontSize: 64, buffer: 6 },
      outlineWidth: 3, outlineColor: [11, 15, 23, 200], parameters: { depthCompare: "always" },
      ...({ getPixelOffset: [0, -2] } as any),
    }),
  ];

  const onHover = useCallback((info: PickingInfo) => {
    const s = pickToSelection(city, info);
    const cur = useLens.getState().hovered;
    if (JSON.stringify(cur) !== JSON.stringify(s)) hover(s);
    setTip(s || info.layer?.id === "networks" || info.layer?.id === "wildlife" ? { x: info.x, y: info.y, layer: info.layer!.id, object: info.object, index: info.index } : null);
  }, [city, hover]);
  const onClick = useCallback((info: PickingInfo) => {
    const s = pickToSelection(city, info);
    select(s);
  }, [city, select]);

  return (
    <div ref={wrap} className={`lc-wrap${dark ? "" : " light"}`} style={{ background: `rgb(${sky.backdrop.join(",")})` }}>
      <DeckGL
        views={new OrbitView({ id: "city", orbitAxis: "Z", fovy: 32, near: 1, far: 20000 } as any)}
        viewState={view as any}
        onViewStateChange={({ viewState }) => setView(viewState as OrbitViewState)}
        controller={{ dragMode: "pan", inertia: 250, scrollZoom: { speed: 0.012, smooth: true }, touchRotate: true } as any}
        layers={layers.filter(Boolean) as any}
        effects={effects}
        onHover={onHover}
        onClick={onClick}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        useDevicePixels={Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        parameters={{ depthCompare: "less-equal" } as any}
      />
      <div className="lc-vignette" />
      <Clock t={t} sky={sky} town={town} />
      <Panel overlays={overlays} setOverlays={setOverlays} counts={people.counts} kinds={kindNames} city={city} t={t} arcs={arcs.length} onHome={() => setView({ ...home, transitionDuration: 800, transitionInterpolator: new LinearInterpolator(["target", "zoom", "rotationX", "rotationOrbit"]) } as any)} />
      {tip && <Tooltip tip={tip} city={city} t={t} name={(i) => structureName(city, i)} />}
      {card && <Card city={city} t={t} selection={selection} name={(i) => structureName(city, i)} onClose={() => select(null)} />}
    </div>
  );
}

const ADDITIVE = { depthWriteEnabled: false, blend: true, blendColorOperation: "add", blendColorSrcFactor: "src-alpha", blendColorDstFactor: "one", blendAlphaOperation: "add", blendAlphaSrcFactor: "one", blendAlphaDstFactor: "one" } as any;
const NET_COL: Record<string, string> = { pipe: "#5fb0e8", sewer: "#a48a62", wire: "#f2d36b" };
const NET_OFF: Record<string, number> = { pipe: -4, sewer: 4, wire: 0 };
export const SPECIES_COL = ["#9fe0a0", "#7fd0e6", "#f0c987", "#e7a3d8", "#c0c8ff"];

function actLabel(a: CityData["town"]["acts"][number]): string {
  const b = a.blocks[0];
  if (!b) return "act";
  const to = b.to.slice(0, 3).join(", ");
  return `${b.block}${b.kind ? ` (${b.kind})` : ""}${to ? ` to ${to}` : ""}${a.blocks.length > 1 ? ` +${a.blocks.length - 1}` : ""}`;
}
function momentLabel(m: CityData["town"]["moments"][number]): string {
  switch (m.kind) {
    case "building_begun": return `building begun: ${m.subject} (${m.detail})`;
    case "building_completed": return `building completed: ${m.subject}`;
    case "death": return `died: ${m.subject}`;
    case "left": return `left town: ${m.subject}`;
    case "arrived": return `arrived: ${m.subject}`;
    default: return `${m.kind}: ${m.subject}`;
  }
}

function sel2structure(c: CityData, s: ReturnType<typeof useLens.getState>["selection"]): number {
  if (!s) return -1;
  if (s.kind === "structure") return c.sById.get(s.id) ?? -1;
  if (s.kind === "entity") return c.town.entities[s.id]?.structure ?? -1;
  return -1;
}

function pickToSelection(c: CityData, info: PickingInfo): ReturnType<typeof useLens.getState>["selection"] {
  if (!info.layer || info.index < 0) return null;
  const id = info.layer.id;
  if (id === "buildings" || id === "parks" || id === "roofs") { const i = info.object as number; return { kind: "structure", id: c.town.structures[i]!.id }; }
  if (id === "people") { const q = info.index; return { kind: "person", id: c.people.people[q]![0] }; }
  if (id === "acts" || id === "act-hits") return { kind: "act", seq: (info.object as any).act.seq };
  return null;
}

function personXY(c: CityData, B: Built, q: number, t: number): [number, number] | undefined {
  const s = c.where.at[q]!;
  if (s >= 0) return [B.shapes[s]!.cx, B.shapes[s]!.cy];
  const p = placeAt(c, c.people.people[q]![0], t);
  return p >= 0 ? [B.shapes[p]!.cx, B.shapes[p]!.cy] : undefined;
}

/** Dark unless the shell says light (<html data-theme="light">, or the system prefers light and no theme is set). */
function useDark(): boolean {
  const read = () => {
    if (typeof document === "undefined") return true;
    const th = document.documentElement.dataset.theme;
    if (th) return th !== "light";
    return !(typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches);
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const on = () => setDark(read());
    window.addEventListener("lens-theme", on);
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : undefined;
    mq?.addEventListener("change", on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.removeEventListener("lens-theme", on); mq?.removeEventListener("change", on); mo.disconnect(); };
  }, []);
  return dark;
}
