// The map: a stylised 3D town that follows Lens's one clock. Ground painted by cover, roads, buildings extruded by
// kind and size under a light that follows the hour, people as glowing points at the building they are in and
// moving along the roads between, and overlays: who is where, the seat's acts, disrepair, wildlife, the networks.
// Reads the town and people bundles (src/folds/town.ts, people.ts); talks to the rest of Lens only through useLens.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, LightingEffect, LinearInterpolator, OrbitView } from "@deck.gl/core";
import type { OrbitViewState, PickingInfo } from "@deck.gl/core";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import { ArcLayer, BitmapLayer, ColumnLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { useLens } from "../state";
import { hash01, loadCity, personRows, placeAt, strHash, tripOf, type CityData } from "./data";
import { along, hex, hipFaces, mix, PAL, paintBeyond, paintGround, rect, shadowOf, type Mass, Roads, shapeOf, treesOf, WHERE_LABEL, type RGBA, type Shape } from "./scene";
import { skyAt } from "./sky";
import { Panel, Tooltip, Clock, type Overlays, type HoverInfo, DEFAULT_OVERLAYS, Card, fmtDay } from "./Panel";
import { CITY_CSS } from "./style";
import { blocksOf, candidateColours, electionView, homeAt, paintHeat, PAPER_GROUPS, papersIn, turnoutByBlock } from "./civic";
import { Tour, useSeat, useTourSteps } from "./Tour";
import { captionAt, download, makeRecorder, PresentBar, PRESENT_CSS, type Caption } from "./Present";
import { Minimap } from "./Minimap";
import { actSentence, CITY_WORDS } from "./words";
import { useMode } from "../mode";

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
  /** Start with the Layers panel open (default: collapsed to a small pill). */
  layers?: boolean;
  /** Start the tour at this step once the run is read (for demos and the dev page). */
  tour?: number;
  /** Start presenting ("show") or recording the tour ("record") once the run is read. */
  present?: "show" | "record";
  /** Story mode (for newcomers): only who is where and the AI mayor's actions, written on the map in plain words. */
  story?: boolean;
  /** Start with these overlays set (e.g. { election: true }). */
  overlays?: Partial<Overlays>;
  /** Where the bundle is served; defaults to `/api/run/<key>`. */
  base?: string;
  /** Start the camera here instead of framed on the town (zoom, rotationX = tilt, rotationOrbit = turn, target in metres). */
  camera?: Partial<{ zoom: number; rotationX: number; rotationOrbit: number; target: [number, number, number] }>;
}

export function CityView({ runKey, run: runProp, base, camera, card = true, layers = false, tour, overlays, present, story: storyProp }: CityViewProps) {
  // Story mode unless told otherwise: the shell's mode (src/client/mode.ts), or the prop when the host sets it.
  const modeStory = useMode((s) => s.mode === "story");
  const story = storyProp ?? modeStory;
  const open = useLens((s) => s.run);
  const key = runKey ?? runProp ?? open;
  const url = base ?? (key ? `/api/run/${encodeURIComponent(key)}` : null);
  const { city, error } = useCity(url);
  return (
    <div className="lens-city">
      <style>{CITY_CSS}{PRESENT_CSS}</style>
      {city ? <Map city={city} camera={camera} card={card} layersOpen={layers} base={url} tour0={tour} overlays0={overlays} present0={present} story={story} /> : <div className="lc-loading">{error ? <span className="lc-err">The town could not be read: {error}</span> : url ? <><div className="lc-spin" />Drawing the town</> : "No run open"}</div>}
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
  labels: { pos: [number, number, number]; text: string; size: number; tier: number; prio: number }[];
  masses: { i: number; m: Mass }[];
  hips: { i: number; poly: [number, number, number][]; n: [number, number, number]; base: RGBA }[];
  caps: { i: number; m: Mass }[];
}

function build(c: CityData, plan = false): Built {
  const town = c.town, cell = town.ground.cell;
  const shapes = town.structures.map((s) => shapeOf(s, cell));
  const boxes: number[] = [], parks: number[] = [];
  shapes.forEach((sh, i) => { if (sh.kind === "box") boxes.push(i); else if (sh.kind === "flat") parks.push(i); });
  // Windows: on each wall, a row per floor.
  const wp: number[] = [], wo: number[] = [], wh: number[] = [];
  const masses: { i: number; m: Mass }[] = [];
  for (const i of boxes) {
    const s = town.structures[i]!;
    for (const m of shapes[i]!.masses) masses.push({ i, m });
    if (!["residential", "commercial", "civic", "health", "education"].includes(s.category)) continue;
    for (const m of shapes[i]!.masses) {
      if (m.w < 4 || m.h < 4 || m.height < 2.5) continue;
      const floors = Math.max(1, Math.round(m.height / 3.2)), fl = m.height / floors;
      for (let f = 0; f < floors; f++) {
        const z = m.z + f * fl + fl * 0.55;
        for (const [ax, ay, len, nx, ny] of [[1, 0, m.w, 0, -1], [1, 0, m.w, 0, 1], [0, 1, m.h, -1, 0], [0, 1, m.h, 1, 0]] as const) {
          const n = Math.max(1, Math.floor(len / 4.2));
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n - 0.5;
            const x = m.cx + ax * u * len * 0.86 + nx * (m.w / 2 + 0.25);
            const y = m.cy + ay * u * len * 0.86 + ny * (m.h / 2 + 0.25);
            wp.push(x, y, z); wo.push(i); wh.push(hash01(wp.length, i));
          }
        }
      }
    }
  }
  const hips: { i: number; poly: [number, number, number][]; n: [number, number, number]; base: RGBA }[] = [];
  const caps: { i: number; m: Mass }[] = [];
  for (const { i, m } of masses) {
    if (m.roof === "hip") { const base = hex(PAL.roofs[Math.floor(hash01(i, 23) * PAL.roofs.length)]!); for (const f of hipFaces(m)) hips.push({ i, ...f, base }); }
    else if (m.w > 3) caps.push({ i, m });
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
    if (p.kind === "district") labels.push({ pos: [(a.x + a.w * 0.5) * cell, -(a.y + a.h - 3) * cell, 0], text: p.name, size: 14, tier: 0, prio: 5 });
    else labels.push({ pos: [(a.x + a.w / 2) * cell, -(a.y - 1.6) * cell, 0], text: p.name, size: 17, tier: 0, prio: 9 });
  }
  town.structures.forEach((s, i) => {
    if (!["civic", "health", "education", "utility"].includes(s.category) && !(s.category === "commercial" && /office/.test(s.type))) return;
    const sh = shapes[i]!;
    labels.push({ pos: [sh.cx, sh.cy, sh.top + 5], text: structureName(c, i), size: 11, tier: 1, prio: s.category === "civic" ? 3 : 1 });
  });
  return {
    shapes, boxes, parks, masses, hips, caps,
    windows: { pos: new Float32Array(wp), owner: new Uint32Array(wo), h: new Float32Array(wh), n: wo.length },
    lamps: new Float32Array(lamps), trees: treesOf(town), ground: paintGround(town, 10, plan), beyond: paintBeyond(plan), roads: new Roads(town), jx, jy, jz, disrepairMax, labels,
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

export interface PaneProps {
  city: CityData; camera?: CityViewProps["camera"]; card: boolean; layersOpen: boolean; base: string | null; tour0?: number; overlays0?: Partial<Overlays>;
  /** A camera shared with another pane (Two towns): its state and setter. */
  sharedView?: [OrbitViewState | null, (v: OrbitViewState | ((v: OrbitViewState) => OrbitViewState)) => void];
  /** The other arm, for the difference overlay. */
  twin?: CityData;
  /** Overlays shared with another pane (Two towns). */
  sharedOverlays?: [Overlays, (o: Overlays | ((o: Overlays) => Overlays)) => void];
  /** A name over the pane (Two towns). */
  label?: string;
  story?: boolean;
  /** Leave out the panel, tour and clock (the second pane of Two towns). */
  bare?: boolean;
  present0?: "show" | "record";
}

/** One map pane over a loaded city (CityView is this plus loading; TwoTowns puts two side by side). */
export function CityPane(p: PaneProps) {
  return <div className="lens-city"><style>{CITY_CSS}</style><Map {...p} /></div>;
}

function Map({ city, camera, card, layersOpen, base, tour0, overlays0, sharedView, sharedOverlays, twin, label, bare, present0, story }: PaneProps) {
  const t = useLens((s) => s.t);
  const selection = useLens((s) => s.selection);
  const hovered = useLens((s) => s.hovered);
  const select = useLens((s) => s.select);
  const hover = useLens((s) => s.hover);
  const setTrack = useLens((s) => s.setTrack);
  const setSpan = useLens((s) => s.setSpan);
  const span = useLens((s) => s.span);
  const dark = useDark();
  const B = useMemo(() => build(city, !dark), [city, dark]);
  const town = city.town, cell = town.ground.cell;
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [ownOverlays, setOwnOverlays] = useState<Overlays>(() => {
    try { return { ...DEFAULT_OVERLAYS, ...JSON.parse(localStorage.getItem("lens.city.overlays") ?? "{}"), ...overlays0 }; } catch { return { ...DEFAULT_OVERLAYS, ...overlays0 }; }
  });
  const overlaysRaw = sharedOverlays?.[0] ?? ownOverlays;
  // Story mode shows only who is where and the AI mayor's actions, whatever the stored choices.
  const overlays: Overlays = story ? { ...overlaysRaw, people: true, acts: true, election: false, papers: false, wildlife: false, networks: false, colour: "kind", diff: false, labels: true } : overlaysRaw;
  const setOverlays = (sharedOverlays?.[1] ?? setOwnOverlays) as (o: Overlays | ((o: Overlays) => Overlays)) => void;
  useEffect(() => { if (sharedOverlays) return; try { localStorage.setItem("lens.city.overlays", JSON.stringify(overlaysRaw)); } catch { /* private mode */ } }, [overlaysRaw]);
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
  const [ownView, setOwnView] = useState<OrbitViewState>(home);
  const view = (sharedView?.[0] ?? ownView) as OrbitViewState;
  const setView = (sharedView?.[1] ?? setOwnView) as (v: OrbitViewState | ((v: OrbitViewState) => OrbitViewState)) => void;
  const homed = useRef(false);
  useEffect(() => { if (!homed.current && size.w > 1) { homed.current = true; if (!sharedView || !sharedView[0] || !bare) setView(home); } }, [home, size.w]);

  // Where everyone is, now.
  city.where.seek(t);
  const hour = ((t % DAY) + DAY) % DAY / 3600;
  // The light in one-minute steps: at 1 h/s a coarser step (it was 5 min) made the light and shadows pulse 12 times a
  // second, which reads as flicker at dusk and dawn.
  const sky = useMemo(() => skyAt(Math.round(hour * 60) / 60, dark), [Math.round(hour * 60), dark]);
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
  // The tour (a run's key moments): its step, and the acts it lights up.
  const [tour, setTour] = useState<number | null>(null);
  const tourStarted = useRef(false);
  const steps = useTourSteps(base, city);
  const seat = useSeat(base);
  // Presentation (a room, a recording): the chrome goes, a caption bar speaks, the camera moves on its own.
  const [present, setPresent] = useState(false);
  const recorder = useRef<ReturnType<typeof makeRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const deckRef = useRef<any>(null);
  const before = useRef<{ playing: boolean; speed: number } | null>(null);
  const [tourActs, setTourActs] = useState<number[]>([]);
  const hi = useMemo(() => new Set([...(selAct >= 0 ? [selAct] : []), ...(tour !== null ? tourActs : [])]), [selAct, tour, tourActs.join(",")]);
  const hiKey = [...hi].join(",");
  useEffect(() => { if (tour0 !== undefined && !tourStarted.current && steps.length) { tourStarted.current = true; setTour(Math.min(tour0, steps.length - 1)); } }, [steps.length]);

  // Follow: a selected person is tracked by the camera while time runs, until the viewer moves the map.
  const playing = useLens((s) => s.playing);
  const [follow, setFollow] = useState(false);
  // The camera never moves unless asked: following a person is a choice (the Follow button), not a side effect.
  useEffect(() => { if (selP < 0) setFollow(false); }, [selP]);

  // Fly to what is selected.
  useEffect(() => {
    let p: [number, number, number] | undefined;
    if (selS >= 0) { const sh = B.shapes[selS]!; p = [sh.cx, sh.cy, 0]; }
    else if (selP >= 0) { const xy = personXY(city, B, selP, useLens.getState().t); if (xy) p = [xy[0], xy[1], 0]; }
    if (!p) return;
    // Only when it is off screen (or at the very edge): then ease there, keeping the zoom.
    const vpNow: any = (ORBIT as any).makeViewport({ width: size.w, height: size.h, viewState: view });
    const [px, py] = vpNow.project(p);
    const m = 60;
    if (px > m && py > m && px < size.w - m && py < size.h - m) return;
    setView((v) => ({ ...v, target: p!, transitionDuration: 600, transitionEasing: (x: number) => 1 - Math.pow(1 - x, 3), transitionInterpolator: new LinearInterpolator(["target"]) } as any));
  }, [selS, selP]);

  const ver = city.where.version;
  // ---- People, every frame ----
  const nP = city.where.nP;
  const people = useMemo(() => ({ pos: new Float32Array(nP * 3), col: new Uint8Array(nP * 4), counts: {} as Record<string, number> }), [nP]);
  const kindNames = city.people.spaceKinds;
  const inkLight = !dark && sky.night < 0.5;
  // Plan inks by day, lamplit at night (on the dark theme, always the lamplit ones).
  const nightK = dark ? 1 : Math.round(sky.night * 8) / 8;
  const whereCol = useMemo(() => kindNames.map((k) => mix(hex(PAL.where[k] ?? PAL.where.other!), hex(PAL.whereNight[k] ?? PAL.whereNight.other!), nightK)), [kindNames, nightK]);
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
        const mm = sh.masses[0];
        pos[q * 3] = (mm?.cx ?? sh.cx) + B.jx[q]! * sh.fw * 0.6;
        pos[q * 3 + 1] = (mm?.cy ?? sh.cy) + B.jy[q]! * sh.fh * 0.6;
        pos[q * 3 + 2] = sh.top + 0.8 + B.jz[q]! * 0.6;
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

  // The camera follows the selected person (a gentle ease toward them each frame).
  useEffect(() => {
    if (!follow || selP < 0 || people.col[selP * 4 + 3] === 0) return;
    const x = people.pos[selP * 3]!, y = people.pos[selP * 3 + 1]!;
    setView((v) => {
      const tg = (v.target ?? [0, 0, 0]) as number[];
      const k = playing ? 0.12 : 0.25;
      if (Math.abs(tg[0]! - x) + Math.abs(tg[1]! - y) < 0.3) return v;
      return { ...v, target: [tg[0]! + (x - tg[0]!) * k, tg[1]! + (y - tg[1]!) * k, 0], transitionDuration: 0 } as any;
    });
  });

  // ---- Crowds: at a distance, each building's people read as one soft glow sized by how many ----
  const crowds = useMemo(() => {
    const W = city.where, out: { p: [number, number, number]; n: number; c: RGBA }[] = [];
    for (const i of B.boxes) {
      const n = W.count[i]!;
      if (!n) continue;
      let best = 0, bk = 0;
      for (let k = 0; k < W.nK; k++) { const m = W.countKind[k * W.nS + i]!; if (m > best) { best = m; bk = k; } }
      const sh = B.shapes[i]!;
      out.push({ p: [sh.cx, sh.cy, sh.top + 2], n, c: whereCol[bk] ?? movingCol });
    }
    return out;
  }, [ver, B, city]);
  const zoomNow = view.zoom as number;
  const crowdF = Math.max(0, Math.min(1, (1.5 - zoomNow) / 1.1));

  // ---- Windows and pools of light, when anyone's place changes or the hour does ----
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
    // Trees by crown size, one layer each (a column has one radius per layer).
    trees: [2.2, 3.2, 4.2].map((r, k, all) => {
      const idx: number[] = [];
      for (let i = 0; i < B.trees.length / 4; i++) { const tr = B.trees[i * 4 + 3]!; const lo = k ? (all[k - 1]! + r) / 2 : 0, hi = k < all.length - 1 ? (r + all[k + 1]!) / 2 : 99; if (tr >= lo && tr < hi) idx.push(i); }
      return { r, idx };
    }),
    lamps: { length: B.lamps.length / 3, attributes: { getPosition: { value: B.lamps, size: 3 } } },
    wildlife: { length: town.wildlife.cells.length / 4 },
    nets: town.networks.filter((l) => l.mode !== "road"),
    labels0: B.labels.filter((l) => l.tier === 0),
    labels1: B.labels,
    labels1NoHall: B.labels.filter((l) => l.text !== "Town hall"),
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
  const visibleMasses = useMemo(() => { const v = new Set(visibleBoxes); return B.masses.filter((d) => v.has(d.i)); }, [visibleBoxes, B]);
  const roofCaps = useMemo(() => { const v = new Set(visibleBoxes.filter((i) => !underWay(i))); return B.caps.filter((d) => v.has(d.i)); }, [visibleBoxes, B]);
  const roofHips = useMemo(() => { const v = new Set(visibleBoxes.filter((i) => !underWay(i))); return B.hips.filter((d) => v.has(d.i)); }, [visibleBoxes, B]);

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
    return town.acts.filter((a) => (a.t <= t && a.t > t - ACT_WINDOW) || hi.has(a.seq));
  }, [town, Math.floor(t / 600), hiKey]);
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
        out.push({ from: [src.cx, src.cy, src.top + 2], to: [sh.cx, sh.cy, sh.top + 1], age: Math.max(0, t - a.t) / ACT_WINDOW, act: a, target: tg?.name ?? id, refused: a.status === "refused" });
      }
    }
    return out;
  }, [actsNow, B, city, town, Math.floor(t / 600)]);

  // ---- The tour: go to each step's moment and frame what it touched ----
  const tourElection = useRef<boolean | null>(null);
  useEffect(() => {
    if (tour === null) { if (tourElection.current !== null) { const was = tourElection.current; tourElection.current = null; setOverlays((o) => ({ ...o, election: was })); } return; }
    const st = steps[tour];
    if (!st) { setTour(null); return; }
    const L = useLens.getState();
    L.setPlaying(false);
    L.setT(st.t + 30);
    // Presenting, the town keeps moving through each step (a quarter of an hour a second).
    if (present) { L.setSpeed(900); L.setPlaying(true); }
    setTourActs(st.acts);
    if (st.election) { if (tourElection.current === null) tourElection.current = overlays.election; setOverlays((o) => ({ ...o, election: true })); }
    const pts: [number, number][] = [];
    if (town.hall !== undefined) pts.push([B.shapes[town.hall]!.cx, B.shapes[town.hall]!.cy]);
    for (const seq of st.acts) {
      const a = town.acts.find((x) => x.seq === seq);
      for (const id of a?.blocks.flatMap((b) => b.to) ?? []) {
        const tg = town.targets[id];
        const s = tg?.kind === "entity" ? tg.structure ?? -1 : tg?.kind === "person" && tg.person ? placeAt(city, tg.person, st.t) : -1;
        if (s !== undefined && s >= 0) pts.push([B.shapes[s]!.cx, B.shapes[s]!.cy]);
      }
    }
    if (st.election) { const e = electionView(city, st.t + 30); for (const h of e?.homes ?? []) if (h.s >= 0) pts.push([B.shapes[h.s]!.cx, B.shapes[h.s]!.cy]); }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = pts.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (home.target as number[])[0]!, cy = pts.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : (home.target as number[])[1]!;
    const ext = pts.length > 1 ? Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.3, 160) : 260;
    const zoom = Math.max(-0.2, Math.min(2.4, Math.log2(Math.min(size.w / (ext * 1.5), size.h / (ext * 1.8)))));
    setView((v) => ({ ...v, target: [cx, cy - ext * 0.12, 0], zoom, rotationX: 50, rotationOrbit: -18 + (((tour * 23) % 50) - 25),
      transitionDuration: 2600, transitionInterpolator: new LinearInterpolator(["target", "zoom", "rotationX", "rotationOrbit"]), transitionEasing: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) } as any));
  }, [tour, steps]);

  // ---- The election and the papers ----
  const blocks = useMemo(() => blocksOf(town), [town]);
  const tMin = Math.floor(t / 600);
  const ev = useMemo(() => (town.elections.length ? electionView(city, t) : undefined), [city, tMin]);
  const candCol = useMemo(() => (ev ? candidateColours(ev.e, town.seats) : {}), [ev?.e, town]);
  const turnout = useMemo(() => (overlays.election && ev && ev.cast > 0 ? turnoutByBlock(city, blocks, ev, ev.e.notice?.poll_at ?? t) : []), [overlays.election, ev, blocks]);
  const townTurnout = useMemo(() => { let r = 0, v = 0; for (const b of turnout) { r += b.roll; v += b.voted; } return r ? v / r : 0; }, [turnout]);
  // Only blocks with enough electors to say anything, and only where they differ from the town by 3 points or more.
  const turnoutCells = useMemo(() => turnout.filter((b) => b.roll >= 8 && Math.abs(b.voted / b.roll - townTurnout) >= 0.03).flatMap((b) => blocks.cells[b.block]!.map((j) => ({ j, dev: b.voted / b.roll - townTurnout }))), [turnout, blocks, townTurnout]);
  // Pies: per building, the votes cast there by first preference (the campaign: opinion-poll answers).
  const { pies, pieRims } = useMemo(() => {
    const out: { poly: [number, number, number][]; n: string; s: number; count: number; total: number; poll: boolean }[] = [];
    const rims: { path: [number, number, number][] }[] = [];
    if (!overlays.election || !ev) return { pies: out, pieRims: rims };
    const poll = ev.phase === "campaign";
    const by = new globalThis.Map<number, globalThis.Map<string, number>>();
    for (const x of poll ? ev.polls : ev.votes) { if (x.s < 0) continue; const m = by.get(x.s) ?? by.set(x.s, new globalThis.Map()).get(x.s)!; m.set(x.n, (m.get(x.n) ?? 0) + 1); }
    for (const [st, m] of by) {
      const sh = B.shapes[st]!, total = [...m.values()].reduce((a, b) => a + b, 0);
      const r = 2.6 + Math.sqrt(total) * 2.1, z = sh.top + 1.2, cx = sh.cx, cy = sh.cy;
      let a0 = -Math.PI / 2;
      for (const c of ev.e.candidates) {
        const k = m.get(c.number);
        if (!k) continue;
        const a1 = a0 + (k / total) * Math.PI * 2;
        const poly: [number, number, number][] = [[cx, cy, z]];
        const steps = Math.max(2, Math.ceil((a1 - a0) / 0.2));
        for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; poly.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
        out.push({ poly, n: c.number, s: st, count: k, total, poll });
        a0 = a1;
      }
      const ring: [number, number, number][] = [];
      for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2; ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
      rims.push({ path: ring });
    }
    return { pies: out, pieRims: rims };
  }, [overlays.election, ev, B]);
  const petitionSigners = useMemo(() => {
    if (!overlays.election || !ev || ev.phase !== "campaign") return [];
    const out: { s: number; person: string }[] = [];
    for (const pe of town.petitions) for (const [st, who] of pe.signers) if (st <= t) out.push({ s: homeAt(city, who, st), person: who });
    return out.filter((x) => x.s >= 0);
  }, [overlays.election, ev, town, city, tMin]);
  const paperGroupsSet = useMemo(() => new Set(overlays.paperGroups), [overlays.paperGroups.join(",")]);
  const placedPapers = useMemo(() => (overlays.papers ? papersIn(city, t, overlays.paperDays ? overlays.paperDays * DAY : Infinity, paperGroupsSet) : []), [overlays.papers, overlays.paperDays, paperGroupsSet, city, Math.floor(t / 900)]);
  const papersShown = useMemo(() => { const n = PAPER_GROUPS.map(() => 0); for (const x of (overlays.papers ? papersIn(city, t, overlays.paperDays ? overlays.paperDays * DAY : Infinity, new Set(PAPER_GROUPS.map((_, i) => i))) : [])) n[x.g]!++; return n; }, [overlays.papers, overlays.paperDays, city, Math.floor(t / 900)]);
  const heat = useMemo(() => (overlays.papers && overlays.paperMode === "heat" ? paintHeat(city, placedPapers) : null), [overlays.papers, overlays.paperMode, placedPapers]);
  const jit = (k: number, salt: number, sh: Shape) => [(hash01(k, salt) - 0.5) * sh.fw * 0.7, (hash01(k, salt + 1) - 0.5) * sh.fh * 0.7] as const;

  // ---- The difference from the other arm (Two towns): people elsewhere, papers only here or only there ----
  const diff = useMemo(() => {
    if (!twin || !overlays.diff) return null;
    // Past the end of either arm there is nothing to compare: the one that stopped would look frozen.
    const ended = Math.min(city.town.span[1], twin.town.span[1]);
    if (t > ended) return { moves: [], elsewhere: 0, compared: 0, onlyHere: [], onlyThere: [], ended };
    twin.where.seek(t);
    const moves: { from: [number, number, number]; to: [number, number, number]; person: string; a: number; b: number }[] = [];
    let elsewhere = 0, compared = 0;
    for (let q = 0; q < city.where.nP; q++) {
      const id = city.people.people[q]![0];
      const q2 = twin.pById.get(id);
      if (q2 === undefined) continue;
      const sa = city.where.at[q]!, sbRaw = twin.where.at[q2]!;
      const sb = sbRaw >= 0 ? city.sById.get(twin.town.structures[sbRaw]!.id) ?? -1 : -1;
      if (sa < 0 && sb < 0) continue;
      compared++;
      if (sa === sb) continue;
      elsewhere++;
      if (sa >= 0 && sb >= 0) {
        const A = B.shapes[sa]!, Bs = B.shapes[sb]!;
        moves.push({ from: [Bs.cx, Bs.cy, Bs.top + 1], to: [A.cx, A.cy, A.top + 1], person: id, a: sa, b: sb });
      }
    }
    // Papers: matched by kind, place and day (record ids differ between arms after the fork).
    const sig = (c: CityData, p: CityData["town"]["papers"][number]) => {
      const sid = p.s !== undefined ? c.town.structures[p.s]?.id : p.p?.[0];
      return `${p.kind}|${sid}|${Math.floor(p.t / DAY)}`;
    };
    const win = 7 * DAY;
    const twinSigs = new Set(twin.town.papers.filter((p) => p.t <= t && p.t > t - win).map((p) => sig(twin, p)));
    const ownSigs = new Set(city.town.papers.filter((p) => p.t <= t && p.t > t - win).map((p) => sig(city, p)));
    const onlyHere = papersIn(city, t, win, new Set(PAPER_GROUPS.map((_, i) => i))).filter((x) => !twinSigs.has(sig(city, x.p)));
    const onlyThere = papersIn(twin, t, win, new Set(PAPER_GROUPS.map((_, i) => i))).filter((x) => !ownSigs.has(sig(twin, x.p)))
      .map((x) => ({ ...x, s: city.sById.get(twin.town.structures[x.s]!.id) ?? -1 })).filter((x) => x.s >= 0);
    return { moves, elsewhere, compared, onlyHere, onlyThere, ended: undefined as number | undefined };
  }, [twin, overlays.diff, city, B, Math.floor(t / 300)]);

  const layers = [
    new BitmapLayer({
      id: "beyond", image: B.beyond as any, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      bounds: [-staticLayers.W * 1.5, -staticLayers.H * 2.5, staticLayers.W * 2.5, staticLayers.H * 1.5],
      tintColor: sky.groundTint, parameters: GROUND,
    }),
    new BitmapLayer({
      id: "ground", image: B.ground as any, bounds: [0, -staticLayers.H, staticLayers.W, 0], coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      tintColor: sky.groundTint, textureParameters: { minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" } as any,
      parameters: GROUND,
    }),
    new PathLayer({
      id: "river", data: town.river, getPath: ((c: [number, number][]) => c.map(([x, y]) => [(x + 0.5) * cell, -(y + 0.5) * cell, 0.2])) as any,
      getColor: [...mix(hex("#3f7fa0"), hex("#1b3550"), sky.night * 0.7).slice(0, 3), 200] as any, getWidth: cell * 0.62, widthUnits: "meters", capRounded: true, jointRounded: true,
      updateTriggers: { getColor: sky.night }, parameters: GROUND,
    }),
    new PathLayer({
      id: "roads-edge", data: B.roads.segments, getPath: ((d: any) => [[d.a[0], d.a[1], 0.25], [d.b[0], d.b[1], 0.25]]) as any,
      getColor: (dark ? mix(hex("#4a4e55"), hex("#1d2129"), sky.night) : mix(hex("#B9B3A6"), hex("#1d2129"), sky.night)) as any, getWidth: cell * 0.42, widthUnits: "meters", capRounded: true,
      updateTriggers: { getColor: [sky.night, dark] }, parameters: GROUND,
    }),
    new PathLayer({
      id: "roads", data: B.roads.segments, getPath: ((d: any) => [[d.a[0], d.a[1], 0.3], [d.b[0], d.b[1], 0.3]]) as any,
      getColor: (dark ? mix(hex("#8f9296"), hex("#33373f"), sky.night) : mix(hex("#E4DFD5"), hex("#3A4652"), sky.night)) as any, getWidth: cell * 0.37, widthUnits: "meters", capRounded: true,
      updateTriggers: { getColor: [sky.night, dark] }, parameters: GROUND,
    }),
    new PathLayer({
      id: "roads-line", data: B.roads.segments, getPath: ((d: any) => [[d.a[0], d.a[1], 0.35], [d.b[0], d.b[1], 0.35]]) as any,
      getColor: [246, 242, 232, 60 - sky.night * 35], getWidth: 0.35, widthUnits: "meters", widthMinPixels: 0.4, updateTriggers: { getColor: sky.night }, parameters: GROUND,
    }),
    new SolidPolygonLayer({
      id: "parks", data: B.parks, getPolygon: (i: number) => { const sh = B.shapes[i]!; return rect(sh.cx, sh.cy, sh.fw, sh.fh, 0.3); },
      getFillColor: [92, 128, 84, 255], extruded: false, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 40], parameters: GROUND,
    }),
    // Depth: soft contact shading round each footprint, and the sun's shadow.
    new SolidPolygonLayer({
      id: "ao", data: visibleMasses, getPolygon: (d: any) => rect(d.m.cx, d.m.cy, d.m.w + 5, d.m.h + 5, 0.37),
      getFillColor: [12, 16, 24, 34], extruded: false, parameters: GROUND,
    }),
    new SolidPolygonLayer({
      id: "ao2", data: visibleMasses, getPolygon: (d: any) => rect(d.m.cx, d.m.cy, d.m.w + 1.6, d.m.h + 1.6, 0.38),
      getFillColor: [12, 16, 24, 50], extruded: false, parameters: GROUND,
    }),
    sky.day > 0.02 && zoomNow > -0.8 && new SolidPolygonLayer({
      id: "shadows", data: visibleMasses, getPolygon: ((d: any) => shadowOf(d.m, sky.sunDir).map(([x, y]) => [x, y, 0.4])) as any,
      getFillColor: [16, 20, 30, 78 * Math.min(1, sky.day * 1.3)], extruded: false, parameters: GROUND,
      updateTriggers: { getPolygon: sky.sunDir.join(","), getFillColor: sky.day },
    }),
    ...staticLayers.trees.map(({ r, idx }) => new ColumnLayer({
      id: `trees-${r}`, data: idx, diskResolution: 7, extruded: true,
      getPosition: (i: number) => [B.trees[i * 4]!, B.trees[i * 4 + 1]!, 0],
      getElevation: (i: number) => B.trees[i * 4 + 2]!,
      getFillColor: (i: number) => { const q = hash01(i, 17); return [76 + q * 22, 96 + q * 22, 80 + q * 14, 255]; },
      radius: r, radiusUnits: "meters", getLineColor: [0, 0, 0, 0],
      material: { ambient: 0.55, diffuse: 0.55, shininess: 8, specularColor: [30, 40, 30] },
    } as any)),
    new SolidPolygonLayer({
      id: "buildings", data: visibleMasses, extruded: true, wireframe: false, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 50],
      getPolygon: (d: any) => rect(d.m.cx, d.m.cy, d.m.w, d.m.h, d.m.z),
      getElevation: (d: any) => { if (!underWay(d.i)) return d.m.height; const s = town.structures[d.i]!; const f = Math.min(1, (t - s.started!) / ((s.completed ?? s.started! + 90 * DAY) - s.started!)); return Math.max(0.6, d.m.height * f); },
      getFillColor: (d: any) => underWay(d.i) ? [190, 175, 150, 140] : d.i === selS ? mix(buildingColor(d.i), hex(PAL.seat), 0.35) : buildingColor(d.i),
      material: { ambient: 0.5, diffuse: 0.55, shininess: 20, specularColor: [50, 50, 56] },
      updateTriggers: { getFillColor: [overlays.colour, selS, Math.floor(t / 3600)], getElevation: Math.floor(t / 3600) },
    }),
    new SolidPolygonLayer({
      id: "roofs", data: roofCaps, extruded: true,
      getPolygon: (d: any) => rect(d.m.cx, d.m.cy, d.m.w - 1.2, d.m.h - 1.2, d.m.z + d.m.height),
      getElevation: 0.45,
      getFillColor: (d: any) => { const c = buildingColor(d.i); return [Math.min(255, c[0] * 1.06 + 8), Math.min(255, c[1] * 1.06 + 8), Math.min(255, c[2] * 1.06 + 8), 255]; },
      material: { ambient: 0.55, diffuse: 0.55, shininess: 30, specularColor: [70, 70, 76] },
      updateTriggers: { getFillColor: [overlays.colour] },
    }),
    new SolidPolygonLayer({
      id: "hips", data: roofHips, extruded: false, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 50],
      getPolygon: (d: any) => d.poly, material: false as any,
      getFillColor: (d: any) => {
        const L = [-sky.sunDir[0], -sky.sunDir[1], -sky.sunDir[2]], ll = Math.hypot(L[0]!, L[1]!, L[2]!);
        const lam = Math.max(0, (d.n[0] * L[0]! + d.n[1] * L[1]! + d.n[2] * L[2]!) / ll);
        const k = (ch: number) => 0.5 * sky.ambientIntensity * sky.ambientColor[ch]! / 255 + 0.55 * sky.sunIntensity * lam * sky.sunColor[ch]! / 255;
        const c = overlays.colour === "disrepair" ? buildingColor(d.i) : d.base;
        return [Math.min(255, c[0] * k(0)), Math.min(255, c[1] * k(1)), Math.min(255, c[2] * k(2)), 255];
      },
      updateTriggers: { getFillColor: [sky.sunDir.join(","), sky.sunIntensity, sky.ambientIntensity, overlays.colour] },
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
      // One act picked (here or in the story): it stands out, the others step back.
      // Road-marking yellow at night; by day the darker ochre, which reads on paper.
      getSourceColor: (d: any) => hex(d.refused ? PAL.flag : inkLight ? "#8A6A00" : PAL.seat, hi.has(d.act.seq) ? 255 : 235 * (1 - d.age * 0.8) * (hi.size ? 0.25 : 1)),
      getTargetColor: (d: any) => hex(d.refused ? PAL.flag : inkLight ? "#B08A10" : "#ffe2a6", hi.has(d.act.seq) ? 255 : 220 * (1 - d.age * 0.85) * (hi.size ? 0.25 : 1)),
      getWidth: (d: any) => (hi.has(d.act.seq) ? 4.5 : 1.6 + 1.6 * (1 - d.age)), getHeight: 0.45, greatCircle: false, pickable: true,
      updateTriggers: { getSourceColor: [hiKey, inkLight], getTargetColor: [hiKey, inkLight], getWidth: [hiKey] },
    }),
    overlays.acts && new ScatterplotLayer({
      id: "act-hits", data: arcs.filter((d) => t - d.act.t < 12 * 3600 || hi.has(d.act.seq)),
      getPosition: (d: any) => [d.to[0], d.to[1], d.to[2]], getRadius: (d: any) => (hi.has(d.act.seq) ? 16 : 8 + ((t - d.act.t) / 3600) * 2.5), radiusUnits: "meters", billboard: false,
      stroked: true, filled: false, getLineColor: (d: any) => hex(d.refused ? PAL.flag : PAL.seat, hi.has(d.act.seq) ? 255 : Math.max(0, 230 * (1 - (t - d.act.t) / (12 * 3600)))), getLineWidth: (d: any) => (hi.has(d.act.seq) ? 2.5 : 1.5), lineWidthUnits: "pixels",
      updateTriggers: { getRadius: [Math.floor(t / 300), hiKey], getLineColor: [Math.floor(t / 300), hiKey], getLineWidth: hiKey },
    }),
    // The seat's hall: a quiet amber ring when it acted lately.
    town.hall !== undefined && overlays.acts && town.seats.length > 0 && new ScatterplotLayer({
      id: "hall", data: [town.hall], getPosition: (i: number) => [B.shapes[i]!.cx, B.shapes[i]!.cy, 0.6], getRadius: 22, radiusUnits: "meters", billboard: false,
      stroked: true, filled: true, getFillColor: hex(PAL.seat, 26), getLineColor: hex(PAL.seat, 150), getLineWidth: 1.2, lineWidthUnits: "pixels",
    }),
    // The election: turnout by block, each vote at the voter's home, the campaign, the candidates' homes.
    // Turnout only where a block differs from the town's (diverging about the town's turnout so far).
    overlays.election && turnoutCells.length > 0 && new SolidPolygonLayer({
      id: "turnout", data: turnoutCells, getPolygon: (d: any) => { const x = d.j % town.ground.w, y = Math.floor(d.j / town.ground.w); return rect((x + 0.5) * cell, -(y + 0.5) * cell, cell, cell, 0.42); },
      getFillColor: (d: any) => (d.dev >= 0 ? [120, 170, 255, Math.min(90, d.dev * 600)] : [235, 150, 90, Math.min(90, -d.dev * 600)]), extruded: false, parameters: { depthWriteEnabled: false, depthCompare: "always" },
    }),
    // Each building's votes (or, in the campaign, its opinion-poll answers): a pie by first preference on its roof, sized by count.
    overlays.election && pies.length > 0 && new SolidPolygonLayer({
      id: "pies", data: pies, getPolygon: (d: any) => d.poly, getFillColor: (d: any) => hex(candCol[d.n] ?? "#ffffff", d.poll ? 170 : 245),
      extruded: false, material: false as any, pickable: true, parameters: { depthCompare: "always" }, updateTriggers: { getFillColor: [candCol] },
    }),
    overlays.election && pies.length > 0 && new PathLayer({
      id: "pie-rims", data: pieRims, getPath: (d: any) => d.path, getColor: [11, 15, 23, 200], getWidth: 1, widthUnits: "pixels", parameters: { depthCompare: "always" },
    }),
    overlays.election && petitionSigners.length > 0 && new ScatterplotLayer({
      id: "signers", data: petitionSigners,
      getPosition: (v: any, { index }: any) => { const sh = B.shapes[v.s]!; const [dx, dy] = jit(index, 51, sh); return [sh.cx + dx, sh.cy + dy, sh.top + 1.5]; },
      getFillColor: hex(PAL.election, 220), getRadius: 1.1, radiusUnits: "meters", radiusMinPixels: 1.8, billboard: true, parameters: { depthCompare: "always" },
    }),
    overlays.election && ev && ev.phase !== "before" && new ScatterplotLayer({
      id: "cand-homes", data: ev.homes.filter((h) => h.s >= 0), pickable: true,
      getPosition: (h: any) => [B.shapes[h.s]!.cx, B.shapes[h.s]!.cy, 0.7], getRadius: 17, radiusUnits: "meters", billboard: false, filled: true, stroked: true,
      getFillColor: (h: any) => hex(candCol[h.number] ?? "#fff", 40), getLineColor: (h: any) => hex(candCol[h.number] ?? "#fff", 230), getLineWidth: 2, lineWidthUnits: "pixels",
      parameters: { depthCompare: "always" }, updateTriggers: { getFillColor: [candCol], getLineColor: [candCol] },
    }),
    overlays.election && ev && ev.phase !== "before" && new TextLayer({
      id: "cand-labels", data: ev.homes.filter((h) => h.s >= 0), getPosition: (h: any) => [B.shapes[h.s]!.cx, B.shapes[h.s]!.cy, B.shapes[h.s]!.top + 8],
      getText: (h: any) => `${h.number}. ${h.name}${h.seat ? ", the AI mayor" : ""}`, getSize: 12, getColor: (h: any) => hex(candCol[h.number] ?? "#fff"),
      fontFamily: "Inter Variable, Inter, system-ui, sans-serif", fontWeight: 600, characterSet: "auto", billboard: true, getAlignmentBaseline: "bottom",
      fontSettings: { sdf: true, fontSize: 64, buffer: 6 }, outlineWidth: 3, outlineColor: [11, 15, 23, 220], parameters: { depthCompare: "always" }, updateTriggers: { getColor: [candCol] },
    }),
    // Papers: pins at the address, stacked, fading over the window; or a heat of them.
    overlays.papers && overlays.paperMode === "pins" && placedPapers.length > 0 && new LineLayer({
      id: "paper-stems", data: placedPapers,
      getSourcePosition: (d: any) => { const sh = B.shapes[d.s]!; return [sh.cx + sh.fw * 0.32, sh.cy - sh.fh * 0.32, sh.top]; },
      getTargetPosition: (d: any) => { const sh = B.shapes[d.s]!; return [sh.cx + sh.fw * 0.32, sh.cy - sh.fh * 0.32, sh.top + 4 + d.stack * 3]; },
      getColor: (d: any) => hex(PAPER_GROUPS[d.g]!.colour, 200), getWidth: 1.2, widthUnits: "pixels",
    }),
    overlays.papers && overlays.paperMode === "pins" && placedPapers.length > 0 && new ScatterplotLayer({
      id: "papers", data: placedPapers, pickable: true,
      getPosition: (d: any) => { const sh = B.shapes[d.s]!; return [sh.cx + sh.fw * 0.32, sh.cy - sh.fh * 0.32, sh.top + 4 + d.stack * 3]; },
      getFillColor: (d: any) => { const age = overlays.paperDays ? (t - d.p.t) / (overlays.paperDays * DAY) : 0; return hex(PAPER_GROUPS[d.g]!.colour, 255 * (1 - 0.6 * age)); },
      getRadius: 1.9, radiusUnits: "meters", radiusMinPixels: 4.2, radiusMaxPixels: 9, billboard: true, stroked: true, getLineColor: [255, 255, 255, 170], lineWidthMinPixels: 0.8, parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: [Math.floor(t / 900), overlays.paperDays] },
    }),
    overlays.papers && overlays.paperMode === "heat" && heat && new BitmapLayer({
      id: "heat", image: heat as any, bounds: [0, -staticLayers.H, staticLayers.W, 0], coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      parameters: { depthWriteEnabled: false, depthCompare: "always" },
    }),
    // The difference from the other arm.
    diff && diff.moves.length > 0 && new ArcLayer({
      id: "diff-moves", data: diff.moves, getSourcePosition: (d: any) => d.from, getTargetPosition: (d: any) => d.to, getHeight: 0.25, greatCircle: false,
      getSourceColor: [47, 125, 91, 40], getTargetColor: [47, 125, 91, 220], getWidth: 1.4, widthUnits: "pixels", parameters: { depthCompare: "always" },
    }),
    diff && diff.onlyHere.length > 0 && new ScatterplotLayer({
      id: "diff-here", data: diff.onlyHere, getPosition: (d: any) => { const sh = B.shapes[d.s]!; return [sh.cx - sh.fw * 0.3, sh.cy + sh.fh * 0.3, sh.top + 4 + d.stack * 3]; },
      getFillColor: (d: any) => hex(PAPER_GROUPS[d.g]!.colour), getRadius: 2, radiusUnits: "meters", radiusMinPixels: 4.5, billboard: true, stroked: true, getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 1.2, parameters: { depthCompare: "always" }, pickable: true,
    }),
    diff && diff.onlyThere.length > 0 && new ScatterplotLayer({
      id: "diff-there", data: diff.onlyThere, getPosition: (d: any) => { const sh = B.shapes[d.s]!; return [sh.cx - sh.fw * 0.3, sh.cy + sh.fh * 0.3, sh.top + 4 + d.stack * 3]; },
      getLineColor: (d: any) => hex(PAPER_GROUPS[d.g]!.colour), filled: false, stroked: true, getRadius: 2, radiusUnits: "meters", radiusMinPixels: 4.5, lineWidthMinPixels: 1.6, billboard: true, parameters: { depthCompare: "always" }, pickable: true,
    }),
    // People: crowds at a distance, points up close.
    overlays.people && !overlays.election && crowdF > 0.02 && new ScatterplotLayer({
      id: "crowds", data: crowds, getPosition: (d: any) => [d.p[0], d.p[1], 0.6], getRadius: (d: any) => 5 + Math.sqrt(d.n) * 3.4, radiusUnits: "meters", radiusMinPixels: 1.5,
      getFillColor: (d: any) => d.c, billboard: false, opacity: crowdF * (0.22 + 0.2 * sky.night) * (overlays.election || overlays.papers ? 0.3 : 1), parameters: { ...(sky.night > 0.5 ? ADDITIVE : { depthWriteEnabled: false }), depthCompare: "always" },
    }),
    overlays.people && !overlays.election && crowdF > 0.02 && new ScatterplotLayer({
      id: "crowds-core", data: crowds, getPosition: (d: any) => [d.p[0], d.p[1], 0.7], getRadius: (d: any) => 2 + Math.sqrt(d.n) * 1.5, radiusUnits: "meters", radiusMinPixels: 1,
      getFillColor: (d: any) => d.c, billboard: false, opacity: crowdF * 0.55 * (overlays.election || overlays.papers ? 0.3 : 1), parameters: { depthWriteEnabled: false, depthCompare: "always" },
    }),
    overlays.people && !overlays.election && new ScatterplotLayer({
      id: "people-halo", data: { length: nP, attributes: { getPosition: { value: people.pos, size: 3 }, getFillColor: { value: people.col, size: 4, normalized: true } } },
      getRadius: 1.9, radiusUnits: "meters", radiusMinPixels: 2.2, radiusMaxPixels: 7, billboard: true, opacity: 0.38 * sky.night * (1 - crowdF * 0.6) * (overlays.election || overlays.papers ? 0.35 : 1), parameters: ADDITIVE,
    }),
    overlays.people && new ScatterplotLayer({
      id: "people", data: { length: nP, attributes: { getPosition: { value: people.pos, size: 3 }, getFillColor: { value: people.col, size: 4, normalized: true } } },
      getRadius: 0.7, radiusUnits: "meters", radiusMinPixels: 0.9, radiusMaxPixels: 3, billboard: true, pickable: true, opacity: overlays.election ? 0.18 : overlays.papers ? 0.4 : 1, parameters: { depthWriteEnabled: false },
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
    false && new TextLayer({
      id: "labels", data: [], getPosition: (l: any) => l.pos, getText: (l: any) => l.text, getSize: (l: any) => l.size,
      // Written on the plan like a street map: drafting navy on paper by day, pale on slate at night.
      getColor: (l: any) => (inkLight ? [29, 43, 54, l.tier === 0 ? 230 : 255] : [228, 234, 238, l.tier === 0 ? 200 : 235]), fontFamily: "Overpass Variable, Overpass, system-ui, sans-serif", fontWeight: 700,
      characterSet: "auto", billboard: true, getTextAnchor: "middle", getAlignmentBaseline: "bottom", fontSettings: { sdf: true, fontSize: 64, buffer: 6 },
      outlineWidth: 4, outlineColor: inkLight ? [237, 240, 242, 230] : [22, 33, 43, 220], parameters: { depthCompare: "always" }, updateTriggers: { getColor: inkLight },
      // Names give way to each other, the town's first, then civic buildings.
      extensions: [COLLIDE], ...({ collisionEnabled: true, getCollisionPriority: (l: any) => l.prio, collisionTestProps: { sizeScale: 1.6 }, getPixelOffset: [0, -2] } as any),
    }),
  ];

  const onHover = useCallback((info: PickingInfo) => {
    if (info.object !== undefined && info.object !== null && (useLens.getState() as any).prompt === "maphint") dropHint();
    const s = pickToSelection(city, info);
    const cur = useLens.getState().hovered;
    if (JSON.stringify(cur) !== JSON.stringify(s)) hover(s);
    setTip(s || info.layer?.id === "networks" || info.layer?.id === "wildlife" ? { x: info.x, y: info.y, layer: info.layer!.id, object: info.object, index: info.index } : null);
  }, [city, hover]);
  const onClick = useCallback((info: PickingInfo) => {
    const s = pickToSelection(city, info);
    select(s);
  }, [city, select]);

  // ---- Words on the map: the town hall, and in Story mode each action as it happens ----
  const vp: any = useMemo(() => (ORBIT as any).makeViewport({ width: size.w, height: size.h, viewState: view }), [view, size.w, size.h]);
  const onScreen = (x: number, y: number, z: number) => { const [px0, py0] = vp.project([x, y, z]); const px = Math.round(px0), py = Math.round(py0); return px > -40 && py > -40 && px < size.w + 40 && py < size.h + 40 ? [px, py] as const : null; };
  const hallAt = town.hall !== undefined && town.seats.length > 0 ? onScreen(B.shapes[town.hall]!.cx, B.shapes[town.hall]!.cy, B.shapes[town.hall]!.top + 4) : null;
  const actNotes = useMemo(() => {
    if (!story) return [];
    const recent = town.acts.filter((a) => a.t <= t && t - a.t < 8 * 3600).slice(-2);
    return recent.map((a) => {
      const arc = arcs.find((x) => x.act.seq === a.seq);
      return { seq: a.seq, text: actSentence(town, a), refused: a.status === "refused", age: (t - a.t) / (8 * 3600), at: arc ? arc.to : null };
    });
  }, [story, town, arcs, Math.floor(t / 300)]);
  // Building names written on the plan when zoomed in, skipping any that would overlap one already placed.
  const shownLabels = useRef(new Set<string>());
  const placeLabels = (() => {
    const out: { x: number; y: number; text: string; w: number; big?: boolean }[] = [];
    if (!overlays.labels || present) return out;
    // The town's and district's names always; buildings' when zoomed in.
    for (const l of B.labels.filter((x) => x.tier === 0)) { const p = onScreen(l.pos[0], l.pos[1], l.pos[2]); if (p) out.push({ x: p[0], y: p[1], text: l.text, w: l.text.length * 9, big: true }); }
    const zoomed = (view.zoom as number) > (shownLabels.current.size ? 0.85 : 0.95);
    if (!zoomed) { shownLabels.current = new Set(); return out; }
    // Those shown last frame keep their place ahead of equals, so labels don't swap as the camera moves.
    const was = shownLabels.current;
    const sorted = [...B.labels].filter((l) => l.tier === 1 && l.text !== "Town hall").sort((a, b) => b.prio - a.prio || (was.has(b.text) ? 1 : 0) - (was.has(a.text) ? 1 : 0));
    for (const l of sorted) {
      const p = onScreen(l.pos[0], l.pos[1], l.pos[2]);
      if (!p) continue;
      const w = l.text.length * 6.6 + 8;
      if (hallAt && Math.abs(p[0] - hallAt[0]) < (w + 220) / 2 && Math.abs(p[1] - hallAt[1]) < 22) continue;
      if (out.some((o) => Math.abs(o.x - p[0]) < (o.w + w) / 2 && Math.abs(o.y - p[1]) < 18)) continue;
      out.push({ x: p[0], y: p[1], text: l.text, w });
    }
    shownLabels.current = new Set(out.map((o) => o.text));
    return out;
  })();
  // A first hint, once per browser.
  // One prompt at a time (docs/design/lens-look.md): the shell orders them (walkthrough, the play bar, then this) in
  // the shared flag `prompt`; the hint shows while the flag is "maphint", once per browser, and goes on the first
  // interaction anywhere or after 10 s, handing the turn back (prompt = null).
  const promptTurn = useLens((s) => (s as any).prompt as string | null | undefined);
  const [hint, setHint] = useState(false);
  const dropHint = () => {
    setHint(false);
    try { localStorage.setItem("lens.city.hinted", "1"); } catch { /* private mode */ }
    const L = useLens.getState() as any;
    if (L.prompt === "maphint") L.setPrompt?.(null);
  };
  useEffect(() => {
    if (promptTurn !== "maphint" || bare || present) return;
    setHint(true);
    const opts = { capture: true, passive: true } as AddEventListenerOptions;
    const go = () => dropHint();
    const id = setTimeout(go, 10_000);
    // (The interaction that ended the previous prompt has already happened; listen from the next frame.)
    const raf = requestAnimationFrame(() => { for (const e of ["pointerdown", "wheel", "keydown"]) window.addEventListener(e, go, opts); });
    return () => { clearTimeout(id); cancelAnimationFrame(raf); for (const e of ["pointerdown", "wheel", "keydown"]) window.removeEventListener(e, go, opts); };
  }, [promptTurn]);

  // ---- Presentation ----
  const caption: Caption | null = present ? (tour !== null && steps[tour] ? { kicker: `${steps[tour]!.kicker}, day ${fmtDay(steps[tour]!.t).day} at ${fmtDay(steps[tour]!.t).clock}`, title: steps[tour]!.title, words: steps[tour]!.words, tone: steps[tour]!.tone === "flag" ? "flag" : steps[tour]!.tone === "election" ? "election" : "seat" } : captionAt(t, seat, town)) : null;
  const captionRef = useRef<Caption | null>(null);
  captionRef.current = caption;
  const manual = useRef(0);
  const startPresent = (record: boolean) => {
    const L = useLens.getState();
    before.current = { playing: L.playing, speed: L.speed };
    setPresent(true);
    try { if (!record) wrap.current?.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
    if (record) {
      try { recorder.current = makeRecorder(); setRecording(true); } catch (e) { console.error("recording is not available here", e); }
      setTour(0);
    } else {
      L.setSpeed(3600);
      L.setPlaying(true);
    }
  };
  const stopPresent = async () => {
    setPresent(false);
    setTour(null);
    const L = useLens.getState();
    if (before.current) { L.setPlaying(before.current.playing); L.setSpeed(before.current.speed); before.current = null; }
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
    const r = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (r) { const blob = await r.stop(); download(blob, `lens-${(base ?? "run").split("/").pop()}-tour.${r.type.includes("mp4") ? "mp4" : "webm"}`); }
  };
  const presented = useRef(false);
  useEffect(() => { if (present0 && !presented.current && (present0 === "show" || steps.length)) { presented.current = true; startPresent(present0 === "record"); } }, [steps.length]);
  // A recording ends with its tour.
  const hadTour = useRef(false);
  useEffect(() => { if (tour !== null) hadTour.current = true; else if (present && recording && hadTour.current) { hadTour.current = false; stopPresent(); } }, [tour]);
  useEffect(() => {
    if (!present) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && tour === null) stopPresent(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [present, tour]);
  // The camera on its own (not in the tour, which moves it itself): toward what the seat's acts touched in the last
  // 12 hours, else the town; a slow drift round; a hand on the map holds it for a few seconds.
  const autoRef = useRef({ arcs, home, t });
  autoRef.current = { arcs, home, t };
  useEffect(() => {
    if (!present || tour !== null) return;
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (performance.now() - manual.current < 4000) return;
      const { arcs: A, home: Hm, t: now } = autoRef.current;
      const recent = A.filter((a) => now - a.act.t < 12 * 3600);
      let cx = (Hm.target as number[])[0]!, cy = (Hm.target as number[])[1]!, zoom = Hm.zoom as number;
      if (recent.length) {
        const xs = recent.flatMap((a) => [a.from[0], a.to[0]]), ys = recent.flatMap((a) => [a.from[1], a.to[1]]);
        cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const ext = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.3, 220);
        zoom = Math.max(-0.2, Math.min(2.2, Math.log2(Math.min(size.w / (ext * 1.5), size.h / (ext * 1.9)))));
      }
      setView((v) => {
        const tg = (v.target ?? [0, 0, 0]) as number[], k = 0.02;
        return { ...v, target: [tg[0]! + (cx - tg[0]!) * k, tg[1]! + (cy - tg[1]!) * k, 0], zoom: (v.zoom as number) + (zoom - (v.zoom as number)) * k,
          rotationX: (v.rotationX as number) + (50 - (v.rotationX as number)) * k, rotationOrbit: (v.rotationOrbit as number) + 0.03, transitionDuration: 0 } as any;
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [present, tour, size.w, size.h]);

  // The panel only changes with the clock (by the minute), the overlays and the run: not on every camera frame.
  const canTour = steps.length > 0 && (town.acts.length > 0 || town.elections.some((e) => e.result));
  const panel = useMemo(() => (
    <Panel story={story} twin={!!twin} open0={layersOpen} ev={ev} candCol={candCol} papersShown={papersShown} onTour={canTour ? () => setTour(0) : undefined} onPresent={() => startPresent(false)} onRecord={canTour && typeof MediaRecorder !== "undefined" ? () => startPresent(true) : undefined} overlays={overlays} setOverlays={(o) => setOverlays(story ? { ...overlaysRaw, people: o.people, acts: o.acts, labels: o.labels } : o)} counts={people.counts} kinds={kindNames} city={city} t={t} arcs={arcs.length} onHome={() => setView({ ...home, transitionDuration: 800, transitionInterpolator: new LinearInterpolator(["target", "zoom", "rotationX", "rotationOrbit"]) } as any)} />
  ), [story, twin, layersOpen, ev, candCol, papersShown, canTour, overlays, ver, Math.floor(t / 60), arcs.length, city, home]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} data-tour="city-map" id="city-map" className={`lc-wrap${dark ? "" : " light"}`} style={{ background: `rgb(${sky.backdrop.join(",")})` }}>
      <DeckGL
        ref={deckRef}
        onAfterRender={() => { const r = recorder.current; const cv = deckRef.current?.deck?.getCanvas?.() ?? deckRef.current?.deck?.canvas; if (r && cv && captionRef.current) r.frame(cv, captionRef.current); }}
        views={ORBIT}
        viewState={view as any}
        onViewStateChange={({ viewState, interactionState }) => { if (interactionState?.isDragging || interactionState?.isPanning || interactionState?.isZooming) { setFollow(false); manual.current = performance.now(); } setView(viewState as OrbitViewState); }}
        controller={{ dragMode: "pan", inertia: 250, scrollZoom: { speed: 0.012, smooth: true }, touchRotate: true, touchZoom: true, doubleClickZoom: true, keyboard: true } as any}
        layers={layers.filter(Boolean) as any}
        effects={effects}
        onHover={onHover}
        onClick={onClick}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        useDevicePixels={Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        parameters={{ depthCompare: "less-equal" } as any}
      />
      <div className="lc-haze" style={{ opacity: Math.max(0, Math.min(1, (82 - (view.rotationX as number)) / 40)), background: `linear-gradient(to bottom, rgba(${sky.backdrop.join(",")},0.92) 0%, rgba(${sky.backdrop.join(",")},0.5) 16%, rgba(${sky.backdrop.join(",")},0) 44%)` }} />
      <div className="lc-vignette" />
      {!present && selP >= 0 && <button className={`lc-follow ${follow ? "on" : ""}`} onClick={() => setFollow(!follow)}>{follow ? <>Stop following {city.people.people[selP]![1]}</> : <>Follow {city.people.people[selP]![1]}</>}</button>}
      {label && <div className={`lc-pane-label${bare ? " bare" : ""}`}>{label}</div>}
      {!bare && !present && <Clock t={t} sky={sky} town={town} />}
      {hallAt && !present && <div className={`lc-anno hall${inkLight ? "" : " night"}`} data-tour="city-town-hall" id="city-town-hall" style={{ left: Math.min(size.w - 130, Math.max(130, hallAt[0])), top: hallAt[1] }}>{story ? CITY_WORDS.hall : "Town hall"}</div>}
      {placeLabels.map((l) => <div key={l.text} className={`lc-anno place${l.big ? " big" : ""}${inkLight ? "" : " night"}`} style={{ left: l.x, top: l.y }}>{l.text}</div>)}
      {actNotes.map((n) => { const p = n.at ? onScreen(n.at[0], n.at[1], n.at[2] + 10) : null; return p && <div key={n.seq} className={`lc-anno act ${n.refused ? "refused" : ""}${inkLight ? "" : " night"}`} style={{ left: Math.min(size.w - 150, Math.max(150, p[0])), top: p[1], opacity: 1 - n.age * 0.7 }}><b />{n.text}</div>; })}
      {hint && !present && !bare && <div className="lc-hint" data-lens-prompt="city-hint" onMouseEnter={dropHint}>{CITY_WORDS.hint} <button className="lc-ghost" onClick={dropHint}>Got it</button></div>}
      {diff && diff.ended !== undefined && <div className="lc-diff"><b>What differs from the other town</b><span>One town's run ended on day {Math.floor(diff.ended / DAY)}, so there is nothing to compare after it.</span></div>}
      {diff && diff.ended === undefined && <div className="lc-diff"><b>What differs from the other town</b><span><i className="sw arc" />{diff.elsewhere} of {diff.compared} people are somewhere else there right now</span><span><i className="sw dot" />{diff.onlyHere.length} {diff.onlyHere.length === 1 ? "paper" : "papers"} in the last 7 days only in this town</span><span><i className="sw ring" />{diff.onlyThere.length} only in the other town</span></div>}
      {!present && <Minimap B={B} town={town} view={view} size={size} setView={setView} />}
      {!bare && !present && panel}
      {present && caption && <PresentBar c={caption} recording={recording} onExit={() => stopPresent()} />}
      {!present && tip && <Tooltip tip={tip} city={city} t={t} name={(i) => structureName(city, i)} />}
      {!bare && tour !== null && <Tour steps={steps} at={tour} setAt={setTour} onExit={() => setTour(null)} hidden={present} />}
      {card && tour === null && !present && <Card city={city} t={t} selection={selection} name={(i) => structureName(city, i)} onClose={() => select(null)} />}
    </div>
  );
}

const COLLIDE = new CollisionFilterExtension();
/** Flat things on the ground (the painted ground, roads, river, parks, contact shading, shadows): drawn first, in
 * order, without testing or writing depth, so coplanar layers never fight (z-fighting was the map's flicker). */
const GROUND = { depthCompare: "always", depthWriteEnabled: false } as any;
const ORBIT = new OrbitView({ id: "city", orbitAxis: "Z", fovy: 32, near: 1, far: 20000 } as any);
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
  if (id === "buildings" || id === "parks" || id === "roofs" || id === "hips") { const o = info.object as any; const i = typeof o === "number" ? o : o.i; return { kind: "structure", id: c.town.structures[i]!.id }; }
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
export function useDark(): boolean {
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
