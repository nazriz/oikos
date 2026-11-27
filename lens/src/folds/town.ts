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
  /** `public`: the block is published for everyone (visible_to "public"). */
  blocks: { block: string; kind?: string; text?: string; to: string[]; public?: boolean }[];
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
  /** Elections for an office held by a public poll (a ballot with candidates). The researcher's view: every vote. */
  elections: TownElection[];
  /** Petitions and who signed them, when. */
  petitions: { id: string; t: number; by: string; text: string; signers: [number, string][] }[];
  /** Papers about a place or a person (complaints, tribunal orders, warrants, benefit decisions...): where they point. */
  papers: TownPaper[];
  /** Work done at each structure (index): task → [times, last t]. */
  work: Record<number, Record<string, [number, number]>>;
  /** Who holds power: the posts, their holders over time, and the ties between people. */
  power: TownPower;
}

export interface TownPower {
  /** Every post of an organisation of the town (not the outside's), in the header's order. */
  posts: { id: string; entity: string; title: string }[];
  institutions: Record<string, { name: string; kind: string }>;
  /** Holder changes: [t, post, holder participant or null (vacated), by participant or null]; t = 0 rows are the start. */
  history: [number, string, string | null, string | null][];
  /** A participant's person: "c0066-self" → "c0066"; a seat → the person whose body it shares. */
  bodies: Record<string, string>;
  /** Parents of each person who has them on record, and couples (partners). */
  parents: Record<string, string[]>;
  couples: [string, string][];
  /** Household of each person (record id), at the start. */
  household: Record<string, string>;
  names: Record<string, string>;
  /** The seats' persons (participant → person). */
  seats: Record<string, string>;
}

export interface TownElection {
  ballot: string; t: number; office?: string; text?: string;
  candidates: { number: string; participant: string; person: string; name: string; nomination?: string }[];
  /** [t, voter person, choice as written ("1>3>4>2")]. */
  votes: [number, string, string][];
  roll?: string[];
  nominations: { t: number; id: string; person: string; text: string }[];
  /** Opinion polls answered by electors: [t, person, first choice (participant), approval]. */
  polls: [number, string, string, number][];
  notice?: { t: number; poll_at?: number; nominations_close_at?: number };
  result?: { t: number; winner?: string; rounds?: Record<string, number>[]; electors?: number; formal?: number; turnout_bps?: number; text?: string };
}

/** A paper that concerns a place (`s`, structure index) or people (`p`, placed by the client at their home then). */
export interface TownPaper { t: number; id: string; kind: string; by?: string; s?: number; p?: string[]; text: string; d?: Record<string, unknown> }

/** The kinds of paper the map shows (others, such as orders and invoices, are trade, not the town's civic life). */
export const PAPER_KINDS = new Set([
  "complaint", "complaint_notice", "venue_decision", "tribunal_application", "hearing_notice", "tribunal_order", "warrant", "warrant_executed",
  "notice_to_vacate", "rent_statement", "rental_application", "stay_request", "benefit_claim", "benefit_decision", "benefit_change",
  "departure", "death_registration", "death_notification", "building_notice", "building_inspection", "permit_application", "permit_decision",
  "petition", "nomination", "closure", "insolvency", "welfare_check_request", "rates_notice", "loan_arrears", "garnishee_order",
  "enforcement_request", "care_request",
]);

const cellXY = (c: unknown): [number, number] | undefined => {
  if (typeof c !== "string" || !c.startsWith("cell.")) return undefined;
  const i = c.indexOf(".", 5);
  return [+c.slice(5, i), +c.slice(i + 1)];
};

const PLACEABLE_FIRST = ["civic", "commercial", "industrial", "health", "education", "utility", "residential", "green", "transport"];

export function townFold(): Fold {
  let b: TownBundle | undefined;
  const persons = new Set<string>();
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
      v: 5, // the fold's version, readable by the client (5: acts' blocks carry `public`)
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
      elections: [], petitions: [], papers: [], work: {},
      power: { posts: [], institutions: {}, history: [], bodies: {}, parents: {}, couples: [], household: {}, names: {}, seats: {} },
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
    for (const e of w.entities ?? []) { if (e.kind !== "person") b.entities[e.id] = { kind: e.kind, name: e.name ?? e.id }; else persons.add(e.id); }
    for (const p of cfg.positions ?? []) b.positions[p.id] = { entity: p.entity, title: p.title ?? p.id, holder: p.holder };
    // Power: the town's own organisations' posts (the outside's are left out), their first holders, and kin.
    const P = b.power;
    for (const e of w.entities ?? []) {
      if (e.kind === "person") { if (Array.isArray(e.parents)) P.parents[e.id] = e.parents; P.names[e.id] = e.name ?? e.id; }
    }
    for (const p of cfg.positions ?? []) {
      const ent = b.entities[p.entity];
      if (!ent || ent.kind === "boundary") continue;
      P.posts.push({ id: p.id, entity: p.entity, title: p.title ?? p.id });
      P.institutions[p.entity] ??= { name: ent.name, kind: ent.kind };
      P.history.push([0, p.id, p.holder ?? null, null]);
    }
    for (const r of w.records ?? []) {
      if (r.kind !== "household") continue;
      for (const m of r.data?.members ?? []) { P.household[m.person] = r.id; if (Array.isArray(m.parents)) P.parents[m.person] ??= m.parents; }
      for (const c of r.data?.couples ?? []) if (Array.isArray(c) && c.length === 2) P.couples.push([c[0], c[1]]);
    }
    for (const p of cfg.participants ?? []) {
      if (typeof p.id !== "string") continue;
      if (typeof p.person === "string") P.bodies[p.id] = p.person;
      else if (p.id.endsWith("-self")) P.bodies[p.id] = p.id.slice(0, -5);
    }
    placeEntities();
    // Seats: a model in the chair, or a person-kind participant that is no citizen's own (a code twin of the chair).
    for (const p of cfg.participants ?? []) {
      if (p.controller?.type === "llm" || (p.kind === "person" && typeof p.id === "string" && !p.id.endsWith("-self"))) seatSet.add(p.id);
    }
    b.seats = [...seatSet];
    for (const s of b.seats) if (b.power.bodies[s]) b.power.seats[s] = b.power.bodies[s]!;
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

  const electionBy = new Map<string, TownElection>();
  const petitionBy = new Map<string, TownBundle["petitions"][number]>();
  let pendingNominations: TownElection["nominations"] = [];
  let pendingPolls: TownElection["polls"] = [];
  let pendingNotice: TownElection["notice"];
  let pendingRoll: string[] | undefined;
  const lotCell = (lot: unknown): [number, number] | undefined => { const m = typeof lot === "string" ? /^lot-(\d+)-(\d+)$/.exec(lot) : null; return m ? [+m[1]!, +m[2]!] : undefined; };
  const atCell = new Map<string, number>();
  const structureAtCell = (x: number, y: number) => {
    if (!atCell.size) b!.structures.forEach((s, i) => { if (s.category !== "transport") atCell.set(`${s.x},${s.y}`, i); });
    return atCell.get(`${x},${y}`);
  };
  /** A person of the town (the header's, and any created during the run). */
  const personish = (v: unknown): v is string => typeof v === "string" && persons.has(v);
  function placePaper(r: any): { s?: number; p?: string[] } {
    const d = r.data ?? {};
    for (const k of ["structure", "about", "premises"]) { const i = typeof d[k] === "string" ? sIndex.get(d[k]) : undefined; if (i !== undefined) return { s: i }; }
    if (typeof d.space === "string") { const i = sIndex.get(d.space.split("/")[0]); if (i !== undefined) return { s: i }; }
    const c = cellXY(d.at) ?? lotCell(d.lot) ?? lotCell(Array.isArray(d.lots) ? d.lots[0] : undefined);
    if (c) { const i = structureAtCell(c[0], c[1]); if (i !== undefined) return { s: i }; }
    if (typeof d.firm === "string" && b!.entities[d.firm]?.structure !== undefined) return { s: b!.entities[d.firm]!.structure };
    const people: string[] = [];
    for (const k of ["deceased", "missing", "tenant", "applicant", "name"]) if (personish(d[k])) people.push(d[k]);
    for (const k of ["household", "members"]) if (Array.isArray(d[k])) for (const x of d[k]) if (personish(x)) people.push(x);
    // Whom it is addressed to first (a decision concerns its addressee), else who wrote it (a claim, a complaint).
    if (!people.length) for (const x of r.addressed_to ?? []) if (personish(x)) people.push(x);
    if (!people.length && personish(r.speaks_for)) people.push(r.speaks_for);
    return people.length ? { p: [...new Set(people)].slice(0, 8) } : {};
  }
  function record(t: number, r: any) {
    if (!r || !b) return;
    const kind: string | undefined = r.kind ?? (r.record === "vote" ? "vote" : undefined);
    if (kind === "vote") {
      const e = electionBy.get(r.ballot);
      if (e) { e.votes.push([t, r.speaks_for, String(r.choice)]); return; }
      const pe = petitionBy.get(r.ballot);
      if (pe && r.choice === "sign") pe.signers.push([t, r.speaks_for]);
      return;
    }
    if (kind === "ballot" && Array.isArray(r.data?.candidates)) {
      const e: TownElection = {
        ballot: r.id, t, office: r.data.office, text: typeof r.text === "string" ? r.text.slice(0, 400) : undefined,
        candidates: r.data.candidates.map((c: any) => ({ number: String(c.number), participant: c.candidate, person: personish(c.for) ? c.for : (c.name ?? c.for), name: c.name ?? c.for, nomination: c.nomination })),
        votes: [], nominations: pendingNominations, polls: pendingPolls, notice: pendingNotice, roll: pendingRoll,
      };
      pendingNominations = []; pendingPolls = []; pendingNotice = undefined; pendingRoll = undefined;
      electionBy.set(r.id, e); b.elections.push(e);
    } else if (kind === "ballot_result" && electionBy.has(r.data?.ballot)) {
      const d = r.data;
      electionBy.get(d.ballot)!.result = { t, winner: d.winner, rounds: d.rounds, electors: d.electors, formal: d.formal, turnout_bps: d.turnout_bps, text: typeof r.text === "string" ? r.text.slice(0, 300) : undefined };
    } else if (kind === "nomination") {
      const person = r.data?.name ?? r.speaks_for;
      const open = b.elections.find((e) => !e.result && e.candidates.some((c) => c.person === person));
      (open ? open.nominations : pendingNominations).push({ t, id: r.id, person, text: String(r.text ?? "").slice(0, 300) });
    } else if (kind === "poll_reply") {
      const fc = r.data?.first_choice;
      if (typeof fc === "string") (b.elections.find((e) => !e.result)?.polls ?? pendingPolls).push([t, r.speaks_for, fc, Number(r.data?.approval ?? 0)]);
    } else if (kind === "election_notice") {
      pendingNotice = { t, poll_at: r.data?.poll_at, nominations_close_at: r.data?.nominations_close_at };
    } else if (kind === "electoral_roll" && Array.isArray(r.data?.electors)) {
      const open = b.elections.find((e) => !e.result);
      if (open) open.roll = r.data.electors; else pendingRoll = r.data.electors;
    } else if (kind === "petition") {
      const pe = { id: r.id, t, by: r.speaks_for, text: String(r.text ?? "").slice(0, 300), signers: [] as [number, string][] };
      petitionBy.set(r.id, pe); b.petitions.push(pe);
    }
    if (kind && PAPER_KINDS.has(kind)) {
      const at = placePaper(r);
      const d: Record<string, unknown> = {};
      for (const k of ["granted", "finding", "matter", "amount", "payment", "removed", "found", "against", "signatures"]) if (r.data?.[k] !== undefined) d[k] = r.data[k];
      b.papers.push({ t, id: r.id, kind, by: r.speaks_for, ...at, text: String(r.text ?? "").slice(0, 240), d: Object.keys(d).length ? d : undefined });
    }
  }

  return {
    name: "town",
    version: 5,
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
            if (b.power.posts.some((x) => x.id === body.position)) b.power.history.push([l.t, body.position, body.holder ?? null, body.by ?? null]);
            return;
          }
          case "position_created": {
            const ent = b.entities[body.entity];
            if (ent && ent.kind !== "boundary" && !b.power.posts.some((x) => x.id === body.position)) {
              b.power.posts.push({ id: body.position, entity: body.entity, title: body.title ?? body.position });
              b.power.institutions[body.entity] ??= { name: ent.name, kind: ent.kind };
            }
            return;
          }
          case "person_created":
            persons.add(body.person);
            b.power.names[body.person] = body.name ?? body.person;
            if (Array.isArray(body.parents)) b.power.parents[body.person] = body.parents;
            if (body.participant) b.power.bodies[body.participant] = body.person;
            return;
          case "entity_created":
            b.entities[body.entity] = { kind: body.kind ?? "entity", name: body.name ?? body.entity };
            return;
          case "recorded": return record(l.t, body.record);
          case "worked": {
            const i = sIndex.get(body.at);
            if (i === undefined || typeof body.task !== "string") return;
            const w = (b.work[i] ??= {});
            const e = (w[body.task] ??= [0, 0]);
            e[0]++; e[1] = l.t;
            return;
          }
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
          return { block: bl.block, kind: bl.kind, text: typeof bl.text === "string" ? bl.text.slice(0, 600) : undefined, to, ...(bl.visible_to === "public" ? { public: true } : {}) };
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
