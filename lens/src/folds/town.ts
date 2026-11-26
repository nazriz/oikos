// The town as a place: the ground and its covers, the river, every structure (where, what kind, whose, its condition),
// the roads and the utility networks, wildlife, the organisations and posts, and what the seat's acts reached. The map
// (src/client/city) draws from this; people's whereabouts are the `people` fold's.
//
// Everything is read from the header's world (contracts/ world config) and a handful of events; nothing is judged. The
// one inference: which structure an act "reached". A message or publication names entities, posts or people; an entity
// is drawn at its premises (a structure whose id starts with the entity's id, else one it owns on the property roll,
// non-residential first), a post at its holder (a person, placed by the client at that moment) or its entity, and a
// person by the client from the people fold. Unplaceable targets are kept, unplaced (the client lists them).

import type { Fold, FoldContext, FoldResult, LogLine } from "../shared/fold";

export interface TownStructure {
  id: string;
  /** Cell coordinates (the ground's grid; metres = cell × ground.cell). */
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  category: string;
  /** Owner on the property roll, if any. */
  owner?: string;
  /** Number of spaces of each kind ("dwelling": 12...). */
  spaces: Record<string, number>;
  /** The structure's own variables at the start (disrepair...), raw. */
  vars?: Record<string, number>;
  /** For one begun during the run: when work started and when it was completed (undefined while unfinished). */
  started?: number;
  completed?: number;
  /** The organisation it houses (premises/works of an entity), when the world says so. */
  houses?: string;
}

export interface TownAct {
  seq: number;
  t: number;
  participant: string;
  /** The post it acted as ("mayor"). */
  as?: string;
  blocks: { block: string; kind?: string; text?: string; to: string[] }[];
  status: "sent" | "applied" | "refused";
  refusal?: string;
  /** Why, in the seat's own words, when the command carries it (provenance reasoning / proposal). */
  why?: string;
}

export interface TownTarget {
  /** "entity" placed at a structure; "person" placed by the client at the act's moment; "none" not placeable. */
  kind: "entity" | "person" | "none";
  structure?: number;
  person?: string;
  name: string;
}

export interface TownBundle {
  v: number;
  name?: string;
  ground: { cell: number; w: number; h: number };
  places: { id: string; kind: string; name: string; area: { x: number; y: number; w: number; h: number }; within?: string }[];
  terrain: { x: number; y: number; w: number; h: number; cover: string }[];
  /** The river as chains of cells, upstream first. */
  river: [number, number][][];
  types: Record<string, { category: string; spaces: Record<string, number>; capacity: number; footprint: [number, number] }>;
  structures: TownStructure[];
  /** Utility and road networks: node cells, links by mode (only links whose ends both have a cell). */
  networks: { mode: string; a: [number, number]; b: [number, number]; id: string; capacity?: number }[];
  /** Wildlife at the start: [x, y, species index, count]. */
  wildlife: { species: string[]; cells: number[] };
  /** The nature census through the run: per species, cells and count; covers by cell count. */
  census: { t: number; species: Record<string, { cells: number; count: number }>; covers: Record<string, number> }[];
  entities: Record<string, { kind: string; name: string; structure?: number }>;
  positions: Record<string, { entity: string; title: string; holder?: string }>;
  /** The participants that are seats (a model in the chair, or a code twin of one): their acts are drawn. */
  seats: string[];
  /** The seat's seat of government: the civic structure of the government entity (arcs start here). */
  hall?: number;
  acts: TownAct[];
  targets: Record<string, TownTarget>;
  /** Town-level moments for the timeline: building begun/completed, births, deaths, departures, arrivals. */
  moments: { t: number; kind: string; subject: string; detail?: string }[];
  span: [number, number];
}

const cellXY = (c: unknown): [number, number] | undefined => {
  if (typeof c !== "string" || !c.startsWith("cell.")) return undefined;
  const i = c.indexOf(".", 5);
  return [+c.slice(5, i), +c.slice(i + 1)];
};

const PLACEABLE_FIRST = ["civic", "commercial", "industrial", "health", "education", "utility", "residential", "green", "transport"];

export function townFold(): Fold {
  let b: TownBundle | undefined;
  const sIndex = new Map<string, number>();
  const seatSet = new Set<string>();
  /** command seq → act index; action id → act index. */
  const actBySeq = new Map<number, number>();
  const actByAction = new Map<string, number>();
  let tMax = 0;

  function addStructure(s: TownStructure) {
    sIndex.set(s.id, b!.structures.length);
    b!.structures.push(s);
  }

  function header(body: any) {
    const cfg = body.config ?? {};
    const w = cfg.world ?? {};
    const cat = cfg.catalogue ?? {};
    const g = w.ground ?? { cell: 25, w: 0, h: 0, terrain: [] };
    b = {
      v: 1,
      name: cfg.meta?.name,
      ground: { cell: g.cell ?? 25, w: g.w ?? 0, h: g.h ?? 0 },
      places: (w.places ?? []).map((p: any) => ({ id: p.id, kind: p.kind, name: p.name ?? p.id, area: p.area, within: p.within })),
      terrain: (g.terrain ?? []).map((r: any) => ({ x: r.x, y: r.y, w: r.w, h: r.h, cover: r.label ?? r.cover ?? "ground" })),
      river: [],
      types: {},
      structures: [],
      networks: [],
      wildlife: { species: [], cells: [] },
      census: [],
      entities: {},
      positions: {},
      seats: [],
      acts: [],
      targets: {},
      moments: [],
      span: [0, 0],
    };
    for (const st of cat.structure_types ?? []) {
      const spaces: Record<string, number> = {};
      let capacity = 0;
      for (const sp of st.spaces ?? []) {
        spaces[sp.kind] = (spaces[sp.kind] ?? 0) + (sp.count ?? 1);
        capacity += (sp.capacity ?? 0) * (sp.count ?? 1);
      }
      b.types[st.id] = { category: st.category ?? "other", spaces, capacity, footprint: [st.footprint?.w ?? 1, st.footprint?.h ?? 1] };
    }
    // Owners from the property roll.
    const owner = new Map<string, string>();
    for (const r of w.records ?? []) {
      if (r.kind !== "property_roll") continue;
      for (const bl of r.data?.buildings ?? []) if (bl.structure && r.data?.owner) owner.set(bl.structure, r.data.owner);
    }
    for (const s of w.structures ?? []) {
      const xy = cellXY(s.at);
      if (!xy) continue;
      const ty = b.types[s.type];
      addStructure({
        id: s.id, x: xy[0], y: xy[1], w: ty?.footprint[0] ?? 1, h: ty?.footprint[1] ?? 1,
        type: s.type, category: ty?.category ?? "other", owner: owner.get(s.id), spaces: ty?.spaces ?? {},
        vars: s.variables && Object.keys(s.variables).length ? s.variables : undefined,
      });
    }
    // River: follow the flows from cells nothing flows into.
    const next = new Map<string, string>();
    const into = new Set<string>();
    for (const f of w.flows ?? []) { next.set(f.from, f.to); into.add(f.to); }
    const seen = new Set<string>();
    for (const start of next.keys()) {
      if (into.has(start)) continue;
      const chain: [number, number][] = [];
      let c: string | undefined = start;
      while (c && !seen.has(c)) { seen.add(c); const xy = cellXY(c); if (xy) chain.push(xy); c = next.get(c); }
      if (c) { const xy = cellXY(c); if (xy) chain.push(xy); }
      if (chain.length > 1) b.river.push(chain);
    }
    // Networks.
    const nodes = new Map<string, [number, number]>();
    for (const n of w.network?.nodes ?? []) { const xy = cellXY(n.cell); if (xy) nodes.set(n.id, xy); }
    for (const l of w.network?.links ?? []) {
      const a = nodes.get(l.from), z = nodes.get(l.to);
      if (a && z) b.networks.push({ mode: l.mode, a, b: z, id: l.id, capacity: l.capacity });
    }
    // Wildlife.
    const sp = new Map<string, number>();
    for (const p of w.populations ?? []) {
      const xy = cellXY(p.cell);
      if (!xy) continue;
      let i = sp.get(p.species);
      if (i === undefined) { i = sp.size; sp.set(p.species, i); b.wildlife.species.push(p.species); }
      b.wildlife.cells.push(xy[0], xy[1], i, p.count ?? 1);
    }
    // Entities, positions, and where each organisation is.
    for (const e of w.entities ?? []) if (e.kind !== "person") b.entities[e.id] = { kind: e.kind, name: e.name ?? e.id };
    for (const p of cfg.positions ?? []) b.positions[p.id] = { entity: p.entity, title: p.title ?? p.id, holder: p.holder };
    placeEntities();
    // Seats: a model in the chair, or a person-kind participant that is no citizen's own (a code twin of the chair).
    for (const p of cfg.participants ?? []) {
      if (p.controller?.type === "llm" || (p.kind === "person" && typeof p.id === "string" && !p.id.endsWith("-self"))) seatSet.add(p.id);
    }
    b.seats = [...seatSet];
    // The hall: the government's civic structure.
    const gov = Object.entries(b.entities).find(([, e]) => e.kind === "government");
    if (gov) b.hall = gov[1].structure;
    if (b.hall === undefined) {
      const civic = b.structures.findIndex((s) => s.category === "civic");
      if (civic >= 0) b.hall = civic;
    }
  }

  function placeEntities() {
    const byOwner = new Map<string, number[]>();
    b!.structures.forEach((s, i) => { if (s.owner) (byOwner.get(s.owner) ?? byOwner.set(s.owner, []).get(s.owner)!).push(i); });
    for (const [id, e] of Object.entries(b!.entities)) {
      let at = b!.structures.findIndex((s) => s.id.startsWith(id + "-") && s.category !== "residential" && s.category !== "transport");
      if (at < 0) {
        const owned = (byOwner.get(id) ?? []).slice().sort((p, q) => PLACEABLE_FIRST.indexOf(b!.structures[p]!.category) - PLACEABLE_FIRST.indexOf(b!.structures[q]!.category));
        if (owned.length && b!.structures[owned[0]!]!.category !== "residential" && b!.structures[owned[0]!]!.category !== "transport") at = owned[0]!;
      }
      if (at >= 0) { e.structure = at; b!.structures[at]!.houses ??= id; }
    }
  }

  function target(id: string): TownTarget {
    const e = b!.entities[id];
    if (e) return e.structure !== undefined ? { kind: "entity", structure: e.structure, name: e.name } : { kind: "none", name: e.name };
    const p = b!.positions[id];
    if (p) {
      if (p.holder?.endsWith("-self")) return { kind: "person", person: p.holder.slice(0, -5), name: p.title };
      const pe = b!.entities[p.entity];
      return pe?.structure !== undefined ? { kind: "entity", structure: pe.structure, name: p.title } : { kind: "none", name: p.title };
    }
    // Otherwise a person (the client places them at the moment of the act).
    return { kind: "person", person: id, name: id };
  }

  return {
    name: "town",
    version: 1,
    line(l: LogLine) {
      if (l.t > tMax) tMax = l.t;
      if (l.kind === "header") return header(l.body);
      if (!b) return;
      const body = l.body;
      if (l.kind === "event") {
        switch (body.event) {
          case "action_started": {
            if (actBySeq.size === 0) return;
            const i = actBySeq.get(body.cause);
            if (i !== undefined) actByAction.set(body.action, i);
            return;
          }
          case "action_applied": case "action_refused": {
            if (actByAction.size === 0) return;
            const i = actByAction.get(body.action);
            if (i === undefined) return;
            const a = b.acts[i]!;
            if (body.event === "action_refused") { a.status = "refused"; a.refusal = [body.code, body.detail].filter(Boolean).join(": "); }
            else if (a.status !== "refused") a.status = "applied";
            return;
          }
          case "structure_started": {
            const xy = cellXY(body.on);
            if (!xy || sIndex.has(body.structure)) return;
            const ty = b.types[body.structure_type];
            addStructure({ id: body.structure, x: xy[0], y: xy[1], w: ty?.footprint[0] ?? 1, h: ty?.footprint[1] ?? 1, type: body.structure_type, category: ty?.category ?? "other", owner: body.built_by, spaces: ty?.spaces ?? {}, started: l.t });
            b.moments.push({ t: l.t, kind: "building_begun", subject: body.structure, detail: body.structure_type });
            return;
          }
          case "structure_completed": {
            const i = sIndex.get(body.structure);
            if (i !== undefined) b.structures[i]!.completed = l.t;
            b.moments.push({ t: l.t, kind: "building_completed", subject: body.structure });
            return;
          }
          case "appointed": {
            const p = b.positions[body.position];
            if (p) p.holder = body.holder;
            return;
          }
          case "entity_created":
            b.entities[body.entity] = { kind: body.kind ?? "entity", name: body.name ?? body.entity };
            return;
          case "nature_census":
            b.census.push({ t: l.t, species: body.species ?? {}, covers: body.covers ?? {} });
            return;
          case "person_died": b.moments.push({ t: l.t, kind: "death", subject: body.person, detail: body.died_of }); return;
          case "person_left": b.moments.push({ t: l.t, kind: "left", subject: body.person, detail: body.to }); return;
          case "person_arrived": b.moments.push({ t: l.t, kind: "arrived", subject: body.person, detail: body.via }); return;
          case "birth_started": b.moments.push({ t: l.t, kind: "birth_begun", subject: (body.parents ?? []).join(", ") }); return;
        }
        return;
      }
      if (l.kind === "command" && body.command === "act" && seatSet.has(body.participant)) {
        const blocks = (body.blocks ?? []).map((bl: any) => {
          const to: string[] = [...(bl.to ?? []), ...(bl.addressed_to ?? [])];
          for (const id of to) if (!b!.targets[id]) b!.targets[id] = target(id);
          return { block: bl.block, kind: bl.kind, text: typeof bl.text === "string" ? bl.text.slice(0, 600) : undefined, to };
        });
        const why = body.provenance?.reasoning ?? body.reasoning ?? body.provenance?.proposal;
        actBySeq.set(l.seq, b.acts.length);
        b.acts.push({ seq: l.seq, t: l.t, participant: body.participant, as: body.as, blocks, status: "sent", why: typeof why === "string" ? why.slice(0, 600) : undefined });
      }
    },
    finish(_ctx: FoldContext): FoldResult {
      if (!b) throw new Error("town fold: no header line");
      b.span = [0, tMax];
      return { json: b };
    },
  };
}
