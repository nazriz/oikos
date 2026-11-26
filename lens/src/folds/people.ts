// Everyone in the town and where they were: each person (name, sex, birth, household, first home) and the columns of
// every `occupied` / `vacated` event (and the header's initial occupancy, at t = 0), so the map can place everyone at any
// moment. A person in no space is on their way somewhere or out of town; the log says which only by the gap.
//
// Columns (little-endian typed arrays, one row per event, in log order):
//   t.bin   Uint32  seconds since the run began
//   p.bin   Uint16  person index (people.json `people`)
//   s.bin   Uint16  structure index (people.json `structures`; the town fold's order, by id)
//   k.bin   Int8    +(kind+1) for occupied, -(kind+1) for vacated; kind indexes people.json `spaceKinds`

import type { Fold, FoldResult, LogLine } from "../shared/fold";

export interface PeopleBundle {
  v: number;
  /** [id, name, sex ("f"/"m"/""), born_at (s), household index or -1, first home structure index or -1]. */
  people: [string, string, string, number, number, number][];
  households: string[];
  structures: string[];
  spaceKinds: string[];
  /** Per person index: when they died / left town, if they did. */
  died: Record<number, number>;
  left: Record<number, number>;
  /** When a person came into the world during the run (birth, arrival): index → t. */
  joined: Record<number, number>;
  rows: number;
}

class Grow<T extends Uint32Array | Uint16Array | Int8Array> {
  n = 0;
  constructor(public a: T, private make: (n: number) => T) {}
  push(v: number) {
    if (this.n === this.a.length) { const b = this.make(this.a.length * 2); b.set(this.a as any); this.a = b; }
    this.a[this.n++] = v;
  }
  done(): Uint8Array { return new Uint8Array(this.a.buffer, 0, this.n * this.a.BYTES_PER_ELEMENT).slice(); }
}

export function peopleFold(): Fold {
  const out: PeopleBundle = { v: 1, people: [], households: [], structures: [], spaceKinds: [], died: {}, left: {}, joined: {}, rows: 0 };
  const pIndex = new Map<string, number>();
  const sIndex = new Map<string, number>();
  const kIndex = new Map<string, number>();
  const T = new Grow(new Uint32Array(1 << 16), (n) => new Uint32Array(n));
  const P = new Grow(new Uint16Array(1 << 16), (n) => new Uint16Array(n));
  const S = new Grow(new Uint16Array(1 << 16), (n) => new Uint16Array(n));
  const K = new Grow(new Int8Array(1 << 16), (n) => new Int8Array(n));

  const person = (id: string, name = id, sex = "", born = 0): number => {
    let i = pIndex.get(id);
    if (i === undefined) { i = out.people.length; pIndex.set(id, i); out.people.push([id, name, sex, born, -1, -1]); }
    return i;
  };
  const structure = (id: string): number => {
    let i = sIndex.get(id);
    if (i === undefined) { i = out.structures.length; sIndex.set(id, i); out.structures.push(id); }
    return i;
  };
  const kind = (k: string): number => {
    let i = kIndex.get(k);
    if (i === undefined) { i = out.spaceKinds.length; kIndex.set(k, i); out.spaceKinds.push(k); }
    return i;
  };
  function row(t: number, who: string, space: string, inOut: 1 | -1) {
    const slash = space.indexOf("/");
    if (slash < 0) return;
    const p = person(who);
    const s = structure(space.slice(0, slash));
    const dot = space.indexOf(".", slash);
    const k = kind(space.slice(slash + 1, dot < 0 ? undefined : dot));
    T.push(t); P.push(p); S.push(s); K.push(inOut * (k + 1));
  }

  return {
    name: "people",
    version: 1,
    line(l: LogLine) {
      if (l.kind === "event") {
        const b = l.body;
        switch (b.event) {
          case "occupied": return row(l.t, b.occupant, b.space, 1);
          case "vacated": return row(l.t, b.occupant, b.space, -1);
          case "structure_started": structure(b.structure); return;
          case "person_created": {
            const i = person(b.person, b.name ?? b.person, b.sex === "female" ? "f" : b.sex === "male" ? "m" : "", b.born_at ?? l.t);
            const p = out.people[i]!; p[1] = b.name ?? p[1]; p[3] = b.born_at ?? p[3];
            out.joined[i] = l.t;
            return;
          }
          case "person_died": out.died[person(b.person)] = l.t; return;
          case "person_left": out.left[person(b.person)] = l.t; return;
        }
        return;
      }
      if (l.kind !== "header") return;
      const w = l.body?.config?.world ?? {};
      for (const s of w.structures ?? []) structure(s.id);
      for (const e of w.entities ?? []) if (e.kind === "person") person(e.id, e.name ?? e.id, e.sex === "female" ? "f" : e.sex === "male" ? "m" : "", e.born_at ?? 0);
      for (const r of w.records ?? []) {
        if (r.kind !== "household") continue;
        const h = out.households.length;
        out.households.push(r.id);
        for (const m of r.data?.members ?? []) { const i = pIndex.get(m.person); if (i !== undefined) out.people[i]![4] = h; }
      }
      for (const o of w.occupancy ?? []) {
        row(0, o.occupant, o.space, 1);
        const i = pIndex.get(o.occupant)!;
        if (/\/dwelling\b/.test(o.space) && out.people[i]![5] < 0) out.people[i]![5] = sIndex.get(o.space.slice(0, o.space.indexOf("/")))!;
      }
    },
    finish(): FoldResult {
      out.rows = T.n;
      return { json: out, files: { t: T.done(), p: P.done(), s: S.done(), k: K.done() } };
    },
  };
}
