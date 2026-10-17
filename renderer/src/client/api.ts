// The client's view of the server: fetches, the shapes it gets back, and the palette every view shares.

export const BASE: string = (globalThis as any).OIKOS_BASE ?? "";
export const DAY = 86_400;

export async function getJson<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
export async function getBin(path: string): Promise<ArrayBuffer> {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.arrayBuffer();
}

export type Cls = "self" | "person" | "system" | "seat" | "world";
export const CLASSES: Cls[] = ["self", "person", "system", "seat", "world"];
export const CLASS_LABEL: Record<Cls, string> = { self: "the person themselves", person: "another person", system: "an organisation's system", seat: "a model seat", world: "the world (no one's act)" };
export const CLASS_SHORT: Record<Cls, string> = { self: "self", person: "person", system: "system", seat: "model seat", world: "world" };
export const CLASS_COLOR: Record<Cls, string> = { self: "#8c9bb0", person: "#f2c14e", system: "#3fd0c9", seat: "#ff4fa0", world: "#6f7a8c" };
export const HARD_COLOR = "#ff5a4f";
export const SEAT_COLORS = ["#ff4fa0", "#b48cff", "#ffad4a", "#4cc3ff", "#a6f04e", "#ff7b6b"];

export const CATEGORY: Record<string, { wall: string; roof: string }> = {
  residential: { wall: "#efe4cf", roof: "#c0644a" },
  commercial: { wall: "#cfe0f2", roof: "#5b7fa8" },
  industrial: { wall: "#d6cbbb", roof: "#7b6a58" },
  civic: { wall: "#f4dcae", roof: "#c9952f" },
  health: { wall: "#f7d7dc", roof: "#c25b6d" },
  education: { wall: "#dbeccb", roof: "#6c9a43" },
  utility: { wall: "#c9ced8", roof: "#6c7688" },
  transport: { wall: "#c7beb6", roof: "#7d7068" },
  other: { wall: "#dddddd", roof: "#888888" },
};

export interface WorldData {
  meta: { runId: string; days: number; lastT: number; end?: any; persons: number; spaces: [number, string, number][]; extraStructures: string[]; seats: string[]; kept: number; lines: number; movesDay: number[]; pulses: number; indexSeconds: any };
  world: { runId: string; name: string; description: string; seed: number; currency: any; ground: { w: number; h: number; cell: number; terrain: { x: number; y: number; w: number; h: number; label: string }[] }; water: [number, number][]; lotCells: [number, number][][]; structures: { id: string; type: string; category: string; x: number; y: number; w: number; h: number; spaces: number; levels: number }[]; orgs: { id: string; kind: string; name: string; premises: number[] }[]; posts: { id: string; entity?: string; title?: string; role?: string; holder?: string }[]; participants: { id: string; cls: Cls; model?: string; title?: string; impl?: string; person?: string }[]; households: { id: string; members: string[] }[]; jobs: [string, string, number][]; titles: { lot: string; holder: string }[] };
  persons: string[];
  pilot: null | { overview: any; seats: { id: string; title: string; model: string; framing?: string; calls: number; sittings: number; cost: number; acts: number; requests: number; confirmed: number; declined: number }[]; twin: any; town: any };
  seatActs: SeatAct[];
  townPulse: { byClass: Record<Cls, number[]>; hard: number[] };
}
export interface SeatAct { ord: number; t: number; endT?: number; participant: string; as: string; kinds: string[]; text: string; status?: string; from: number; targets: { id: string; kind: "person" | "org"; struct: number }[]; via?: string }

export function money(minor: number | string, cur: any = {}): string {
  const txt = String(Math.round(Number(minor)));
  if (!/^-?\d+$/.test(txt)) return String(minor);
  const places = cur.minor_units ?? 2, neg = txt.startsWith("-"), d = txt.replace("-", "").padStart(places + 1, "0");
  return `${neg ? "−" : ""}${cur.symbol ?? ""}${d.slice(0, d.length - places).replace(/\B(?=(\d{3})+(?!\d))/g, cur.group_mark ?? ",")}${places ? (cur.decimal_mark ?? ".") + d.slice(-places) : ""}`;
}
export function clock(t: number): { day: number; hh: string; mm: string; hour: number } {
  const s = ((t % DAY) + DAY) % DAY;
  return { day: Math.floor(t / DAY), hh: String(Math.floor(s / 3600)).padStart(2, "0"), mm: String(Math.floor((s % 3600) / 60)).padStart(2, "0"), hour: s / 3600 };
}
export const stampOf = (t: number) => { const c = clock(t); return `day ${c.day} · ${c.hh}:${c.mm}`; };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
