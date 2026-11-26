// The town's civic life on the map: who voted how and from where, the campaign before the poll, petitions, and the
// papers (complaints, orders, warrants, benefit decisions...) at the address they concern. Pure functions of the
// bundles; the map draws them (CityView) and the panel counts them (Panel).
import type { CityData, TownBundle } from "./data";
import { personRows } from "./data";

type Election = TownBundle["elections"][number];
type Paper = TownBundle["papers"][number];

/** Where a person lived at moment t: the last dwelling they entered by then (else their first home). */
export function homeAt(c: CityData, person: string, t: number): number {
  const q = c.pById.get(person);
  if (q === undefined) return -1;
  const dw = c.people.spaceKinds.indexOf("dwelling") + 1;
  const rows = personRows(c)[q]!;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c.rows.t[rows[m]!]! <= t) lo = m + 1; else hi = m; }
  for (let k = lo - 1; k >= 0; k--) { const r = rows[k]!; if (c.rows.k[r] === dw && c.rows.s[r]! >= 0) return c.rows.s[r]!; }
  const home = c.people.people[q]![5];
  return home >= 0 ? c.sMap[home]! : -1;
}

/** Candidate colours: the seat's own candidacy in the seat's amber, the others in quiet, distinct hues. */
const CAND = ["#1F5FAD", "#2F7D5B", "#8C5A3C", "#5B6B78", "#B5523B", "#1D2B36"];
export function candidateColours(e: Election, seats: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let k = 0;
  for (const c of e.candidates) out[c.number] = seats.includes(c.participant) ? "#f2b44b" : CAND[k++ % CAND.length]!;
  return out;
}

/** The election that matters at t: the latest one noticed by then, else the first. */
export function electionAt(town: TownBundle, t: number): Election | undefined {
  const es = town.elections;
  return [...es].reverse().find((e) => (e.notice?.t ?? e.t) <= t) ?? es[0];
}

export interface ElectionView {
  e: Election;
  phase: "before" | "campaign" | "voting" | "declared";
  /** First preferences so far, by candidate number. */
  first: Record<string, number>;
  cast: number;
  roll: number;
  /** Each vote cast by t: home structure and first-preference number. */
  votes: { s: number; n: string; person: string }[];
  /** Candidates' homes at t. */
  homes: { s: number; number: string; name: string; seat: boolean }[];
  /** Opinion-poll answers by t: home and the candidate (number) put first. */
  polls: { s: number; n: string }[];
}

export function electionView(c: CityData, t: number): ElectionView | undefined {
  const e = electionAt(c.town, t);
  if (!e) return undefined;
  const byPart = new Map(e.candidates.map((x) => [x.participant, x.number] as const));
  const first: Record<string, number> = {};
  const votes: ElectionView["votes"] = [];
  for (const [vt, person, choice] of e.votes) {
    if (vt > t) break;
    const n = choice.split(">")[0]!.trim();
    first[n] = (first[n] ?? 0) + 1;
    votes.push({ s: homeAt(c, person, vt), n, person });
  }
  const polls: ElectionView["polls"] = [];
  for (const [pt, person, fc] of e.polls) { if (pt > t) break; const n = byPart.get(fc); if (n) polls.push({ s: homeAt(c, person, pt), n }); }
  const homes = e.candidates.map((x) => ({ s: homeAt(c, x.person, t), number: x.number, name: x.name, seat: c.town.seats.includes(x.participant) }));
  const phase: ElectionView["phase"] = e.result && e.result.t <= t ? "declared" : votes.length ? "voting" : (e.notice?.t ?? e.t) <= t ? "campaign" : "before";
  return { e, phase, first, cast: votes.length, roll: e.roll?.length ?? e.result?.electors ?? 0, votes, homes, polls };
}

// ---------- Blocks: the town's land between its roads ----------

export interface Blocks { of: Int32Array; cells: number[][]; centre: [number, number][] }
/** Flood the town's non-road cells into blocks (4-neighbour), so turnout can be read block by block. */
export function blocksOf(town: TownBundle): Blocks {
  const { w, h } = town.ground;
  const inTown = new Uint8Array(w * h);
  for (const p of town.places) if (p.within) { const a = p.area; for (let y = a.y; y < Math.min(h, a.y + a.h); y++) for (let x = a.x; x < Math.min(w, a.x + a.w); x++) inTown[y * w + x] = 1; }
  for (const s of town.structures) if (s.category === "transport") inTown[s.y * w + s.x] = 0;
  for (const ch of town.river) for (const [x, y] of ch) inTown[y * w + x] = 0;
  const of = new Int32Array(w * h).fill(-1);
  const cells: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    if (!inTown[i] || of[i]! >= 0) continue;
    const id = cells.length, list: number[] = [i];
    of[i] = id;
    for (let k = 0; k < list.length; k++) {
      const j = list[k]!, x = j % w;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (n >= 0 && n < w * h && inTown[n] && of[n]! < 0) { of[n] = id; list.push(n); }
    }
    cells.push(list);
  }
  const centre = cells.map((l) => { let sx = 0, sy = 0; for (const j of l) { sx += j % w; sy += Math.floor(j / w); } return [sx / l.length, sy / l.length] as [number, number]; });
  return { of, cells, centre };
}

/** Turnout by block: electors living there at the poll, and how many of them have voted by t. */
export function turnoutByBlock(c: CityData, B: Blocks, v: ElectionView, at: number): { block: number; roll: number; voted: number }[] {
  const w = c.town.ground.w;
  const blockOf = (s: number) => { if (s < 0) return -1; const st = c.town.structures[s]!; return B.of[st.y * w + st.x]!; };
  const roll = new Map<number, number>(), voted = new Map<number, number>();
  for (const person of v.e.roll ?? []) { const b = blockOf(homeAt(c, person, at)); if (b >= 0) roll.set(b, (roll.get(b) ?? 0) + 1); }
  for (const x of v.votes) { const b = blockOf(x.s); if (b >= 0) voted.set(b, (voted.get(b) ?? 0) + 1); }
  return [...roll.entries()].map(([block, r]) => ({ block, roll: r, voted: Math.min(r, voted.get(block) ?? 0) }));
}

// ---------- Papers ----------

export const PAPER_GROUPS: { id: string; label: string; colour: string; kinds: string[] }[] = [
  { id: "housing", label: "Tenancy and eviction", colour: "#ef9a72", kinds: ["notice_to_vacate", "tribunal_order", "warrant", "warrant_executed", "rent_statement", "rental_application", "stay_request", "tribunal_application", "hearing_notice"] },
  { id: "complaints", label: "Complaints", colour: "#e8c46a", kinds: ["complaint", "complaint_notice", "venue_decision"] },
  { id: "benefits", label: "Benefits", colour: "#7fc2e6", kinds: ["benefit_claim", "benefit_decision", "benefit_change", "care_request"] },
  { id: "civic", label: "Petitions and nominations", colour: "#1F5FAD", kinds: ["petition", "nomination"] },
  { id: "building", label: "Building and permits", colour: "#a9b4c2", kinds: ["building_notice", "building_inspection", "permit_application", "permit_decision"] },
  { id: "money", label: "Rates, debts, closures", colour: "#c7b28f", kinds: ["rates_notice", "loan_arrears", "garnishee_order", "enforcement_request", "insolvency", "closure"] },
  { id: "life", label: "Departures, deaths, welfare", colour: "#cfd3da", kinds: ["departure", "death_registration", "death_notification", "welfare_check_request"] },
];
const GROUP_OF = new Map<string, number>();
PAPER_GROUPS.forEach((g, i) => g.kinds.forEach((k) => GROUP_OF.set(k, i)));
export const paperGroup = (kind: string) => GROUP_OF.get(kind) ?? PAPER_GROUPS.length - 1;

export interface PlacedPaper { p: Paper; s: number; g: number; stack: number }
/** Papers in a window ending at t, placed at the structure they concern (a person's: their home then), stacked. */
export function papersIn(c: CityData, t: number, window: number, groups: Set<number>): PlacedPaper[] {
  const out: PlacedPaper[] = [];
  const stack = new Map<number, number>();
  for (const p of c.town.papers) {
    if (p.t > t || p.t < t - window) continue;
    const g = paperGroup(p.kind);
    if (!groups.has(g)) continue;
    const s = p.s ?? (p.p?.[0] ? homeAt(c, p.p[0], p.t) : -1);
    if (s < 0) continue;
    const k = stack.get(s) ?? 0;
    stack.set(s, k + 1);
    out.push({ p, s, g, stack: k });
  }
  return out;
}

/** A soft heat image of papers over the ground (one pixel per `px` of a cell), for the "heat" mode. */
export function paintHeat(c: CityData, placed: PlacedPaper[], px = 4): HTMLCanvasElement | OffscreenCanvas {
  const { w, h } = c.town.ground;
  const W = w * px, H = h * px;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  // Accumulate density in alpha, then colour it by a ramp.
  ctx.globalCompositeOperation = "lighter";
  const r = px * 3.2;
  for (const x of placed) {
    const st = c.town.structures[x.s]!;
    const cx = (st.x + 0.5) * px, cy = (st.y + 0.5) * px;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0.09)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  // Scaled to the densest place in the window, so the heat reads the same for a day as for the whole run.
  let max = 1;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > max) max = d[i + 3]!;
  const ramp = [[60, 70, 160], [140, 90, 210], [235, 100, 130], [255, 180, 100], [255, 240, 200]];
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 3]! / max;
    if (v < 0.04) { d[i + 3] = 0; continue; }
    const f = v * (ramp.length - 1), k = Math.min(ramp.length - 2, Math.floor(f)), u = f - k;
    const a = ramp[k]!, b = ramp[k + 1]!;
    d[i] = a[0]! + (b[0]! - a[0]!) * u; d[i + 1] = a[1]! + (b[1]! - a[1]!) * u; d[i + 2] = a[2]! + (b[2]! - a[2]!) * u;
    d[i + 3] = Math.min(215, Math.pow(v, 0.7) * 230);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------- A building's story ----------

export interface StructureStory {
  /** Who was in it, by space kind: person index → [total seconds, first t, last t]. */
  stays: Record<string, Map<number, [number, number, number]>>;
  papers: Paper[];
}
const storyCache = new WeakMap<CityData, Map<number, StructureStory>>();
export function structureStory(c: CityData, s: number): StructureStory {
  let m = storyCache.get(c);
  if (!m) { m = new Map(); storyCache.set(c, m); }
  const hit = m.get(s);
  if (hit) return hit;
  const stays: StructureStory["stays"] = {};
  const open = new Map<string, number>();
  const add = (kind: string, q: number, t0: number, t1: number) => {
    const map = (stays[kind] ??= new Map());
    const e = map.get(q) ?? [0, t0, t1];
    e[0] += t1 - t0; e[1] = Math.min(e[1], t0); e[2] = Math.max(e[2], t1);
    map.set(q, e);
  };
  const end = c.rows.n ? c.rows.t[c.rows.n - 1]! : 0;
  for (let i = 0; i < c.rows.n; i++) {
    if (c.rows.s[i] !== s) continue;
    const q = c.rows.p[i]!, k = c.rows.k[i]!;
    const kind = c.people.spaceKinds[Math.abs(k) - 1] ?? "?";
    const key = `${q}:${kind}`;
    if (k > 0) open.set(key, c.rows.t[i]!);
    else { const t0 = open.get(key); if (t0 !== undefined) { open.delete(key); add(kind, q, t0, c.rows.t[i]!); } }
  }
  // Still there at the end: counted to the log's last moment.
  for (const [key, t0] of open) { const [q, kind] = key.split(":"); add(kind!, +q!, t0, end); }
  const papers = c.town.papers.filter((p) => p.s === s);
  const story = { stays, papers };
  m.set(s, story);
  return story;
}
