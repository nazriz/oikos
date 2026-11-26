// The city's data in the browser: the town and people bundles, and the whereabouts engine that answers "where is
// everyone at t" fast enough to ask every frame (keyframes per day, then a replay of that day's rows).
import type { TownBundle, TownStructure } from "../../folds/town";
import type { PeopleBundle } from "../../folds/people";

export type { TownBundle, TownStructure, PeopleBundle };

export interface CityData {
  town: TownBundle;
  people: PeopleBundle;
  /** people-bundle structure index → town structure index (-1 when the town does not place it). */
  sMap: Int32Array;
  /** Town structure id → index. */
  sById: Map<string, number>;
  /** Person id → index. */
  pById: Map<string, number>;
  rows: { t: Uint32Array; p: Uint16Array; s: Int32Array; k: Int8Array; n: number };
  /** For a vacated row: the row of the same person's next occupied row (-1 when none). */
  nextIn: Int32Array;
  where: Whereabouts;
}

const DAY = 86_400;

async function bin(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadCity(base: string): Promise<CityData> {
  const [town, people, tb, pb, sb, kb] = await Promise.all([
    fetch(`${base}/town`).then((r) => { if (!r.ok) throw new Error(`town: ${r.status}`); return r.json() as Promise<TownBundle>; }),
    fetch(`${base}/people`).then((r) => { if (!r.ok) throw new Error(`people: ${r.status}`); return r.json() as Promise<PeopleBundle>; }),
    bin(`${base}/people/t`), bin(`${base}/people/p`), bin(`${base}/people/s`), bin(`${base}/people/k`),
  ]);
  return makeCity(town, people, new Uint32Array(tb), new Uint16Array(pb), new Uint16Array(sb), new Int8Array(kb));
}

export function makeCity(town: TownBundle, people: PeopleBundle, t: Uint32Array, p: Uint16Array, s16: Uint16Array, k: Int8Array): CityData {
  const sById = new Map(town.structures.map((s, i) => [s.id, i] as const));
  const sMap = new Int32Array(people.structures.length).fill(-1);
  people.structures.forEach((id, i) => { const j = sById.get(id); if (j !== undefined) sMap[i] = j; });
  const n = t.length;
  const s = new Int32Array(n);
  for (let i = 0; i < n; i++) s[i] = sMap[s16[i]!]!;
  const pById = new Map(people.people.map((q, i) => [q[0], i] as const));
  const nextIn = new Int32Array(n).fill(-1);
  const lastOut = new Int32Array(people.people.length).fill(-1);
  for (let i = 0; i < n; i++) {
    const q = p[i]!;
    if (k[i]! < 0) lastOut[q] = i;
    else if (lastOut[q]! >= 0) { nextIn[lastOut[q]!] = i; lastOut[q] = -1; }
  }
  const rows = { t, p, s, k, n };
  const city: CityData = { town, people, sMap, sById, pById, rows, nextIn, where: undefined as any };
  city.where = new Whereabouts(city);
  return city;
}

/** Everyone's place at a moment: `at[p]` the town structure index (-1 nowhere), `kind[p]` the space kind index (-1),
 * `out[p]` the row they last left by (when nowhere), `count[s]` how many are in structure s. */
export class Whereabouts {
  readonly at: Int32Array;
  readonly kind: Int8Array;
  readonly out: Int32Array;
  readonly count: Uint16Array;
  /** By space kind: how many in each structure (kind-major: count by kind k at k * nS + s). */
  readonly countKind: Uint16Array;
  private keys: { row: number; at: Int32Array; kind: Int8Array; out: Int32Array }[] = [];
  private row = 0; // rows applied: [0, row)
  t = -1;
  /** Bumped whenever anyone's place changes: views key their updates on it. */
  version = 0;
  readonly nP: number;
  readonly nS: number;
  readonly nK: number;

  constructor(private c: CityData) {
    this.nP = c.people.people.length;
    this.nS = c.town.structures.length;
    this.nK = c.people.spaceKinds.length;
    this.at = new Int32Array(this.nP).fill(-1);
    this.kind = new Int8Array(this.nP).fill(-1);
    this.out = new Int32Array(this.nP).fill(-1);
    this.count = new Uint16Array(this.nS);
    this.countKind = new Uint16Array(this.nS * Math.max(1, this.nK));
    // Keyframes at the start of every day.
    const { t, n } = c.rows;
    // Key d holds every row with t < d days applied.
    const days = Math.floor((n ? t[n - 1]! : 0) / DAY) + 1;
    let i = 0;
    for (let d = 0; d <= days; d++) {
      while (i < n && t[i]! < d * DAY) this.apply(i++);
      this.keys.push({ row: i, at: this.at.slice(), kind: this.kind.slice(), out: this.out.slice() });
    }
    this.reset(0);
  }

  private apply(i: number) {
    const { p, s, k } = this.c.rows;
    const q = p[i]!, st = s[i]!, kk = k[i]!;
    if (kk > 0) {
      if (this.at[q]! >= 0) this.take(q);
      this.at[q] = st; this.kind[q] = kk - 1; this.out[q] = -1;
      if (st >= 0) { this.count[st]!++; this.countKind[(kk - 1) * this.nS + st]!++; }
    } else if (this.at[q] === st) {
      this.take(q);
      this.at[q] = -1; this.kind[q] = -1; this.out[q] = i;
    }
  }
  private take(q: number) {
    const st = this.at[q]!;
    if (st >= 0) { this.count[st]!--; this.countKind[this.kind[q]! * this.nS + st]!--; }
  }

  private reset(dayIndex: number) {
    const key = this.keys[Math.max(0, Math.min(this.keys.length - 1, dayIndex))]!;
    this.at.set(key.at); this.kind.set(key.kind); this.out.set(key.out);
    this.count.fill(0); this.countKind.fill(0);
    for (let q = 0; q < this.nP; q++) {
      const st = this.at[q]!;
      if (st >= 0) { this.count[st]!++; this.countKind[this.kind[q]! * this.nS + st]!++; }
    }
    this.row = key.row;
  }

  /** Move to moment t (inclusive of rows at t). */
  seek(t: number) {
    if (t === this.t) return;
    const { t: T, n } = this.c.rows;
    const startRow = this.row;
    if (t < this.t || Math.floor(t / DAY) > Math.floor(Math.max(0, this.t) / DAY) + 1) this.reset(Math.floor(t / DAY));
    while (this.row < n && T[this.row]! <= t) this.apply(this.row++);
    if (this.row !== startRow || t < this.t) this.version++;
    this.t = t;
  }
}

/** A trip in progress for someone in no space: where from, where to, and when (to undefined when the log has no next). */
export function tripOf(c: CityData, q: number): { from: number; to: number; t1: number; t2: number } | undefined {
  const r = c.where.out[q]!;
  if (r < 0) return undefined;
  const nx = c.nextIn[r]!;
  return { from: c.rows.s[r]!, to: nx >= 0 ? c.rows.s[nx]! : -1, t1: c.rows.t[r]!, t2: nx >= 0 ? c.rows.t[nx]! : Infinity };
}

/** A stable hash in [0, 1) for jitter. */
export function hash01(n: number, salt = 0): number {
  let h = (n * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where a person was at moment t: the structure they were in, or the one they had just left (else home). */
export function placeAt(c: CityData, person: string, t: number): number {
  const q = c.pById.get(person);
  if (q === undefined) return -1;
  // The rows are in time order; scan this person's rows backward from the first after t.
  const rows = personRows(c)[q]!;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c.rows.t[rows[m]!]! <= t) lo = m + 1; else hi = m; }
  const r = rows[lo - 1];
  if (r !== undefined) return c.rows.s[r]!;
  const home = c.people.people[q]![5];
  return home >= 0 ? c.sMap[home]! : -1;
}
const rowsCache = new WeakMap<CityData, Int32Array[]>();
export function personRows(c: CityData): Int32Array[] {
  let r = rowsCache.get(c);
  if (r) return r;
  const n = c.people.people.length;
  const counts = new Int32Array(n);
  for (let i = 0; i < c.rows.n; i++) counts[c.rows.p[i]!]!++;
  r = Array.from({ length: n }, (_, q) => new Int32Array(counts[q]!));
  const fill = new Int32Array(n);
  for (let i = 0; i < c.rows.n; i++) { const q = c.rows.p[i]!; r[q]![fill[q]!++] = i; }
  rowsCache.set(c, r);
  return r;
}

