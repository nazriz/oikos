// Several towns in one world (law 9, foundations-2 S6): towns generated one by one, each from its own seed under the
// one weather, laid side by side on one ground and joined by road, sharing the outside world.
//
// Each town is generated whole by the generator, as a one-town world would be; this module only composes them. The first
// town keeps its ids; every id another town defines is given that town's prefix (`t2-`, `t3-`, ...), wherever it is
// written: as a value, as the part of a space's id before the slash (`apts-2/dwelling.9`), or as a key of a map. A word
// of the world's vocabulary (a kind, a type, a mode, a role...) is never an id, even where it is spelled like one (the
// police are an entity and a kind). Every cell of town k is moved east by the widths of the grounds before it.
//
// Shared, kept once (the first town's): the outside world's entities (the world's boundaries) and their accounts, the
// network's nodes off the ground (the far end of each town's road out and the edges there) and the links between them,
// the currencies, the catalogue (a space's capacity is the largest any town gives it), what is published, life, the
// clock and the log. Each town's own road out runs to the shared far end, and a road joins each town's gate to the next
// town's, its length the distance between them. Nothing of a town's own is merged with another's: two towns are two
// sets of people, bodies, buildings, papers and posts.

/** Keys whose values are the world's vocabulary, never an id (the shapes the contract gives them). */
const VOCABULARY = new Set([
  "kind", "type", "mode", "role", "category", "record", "block", "what", "species", "label", "impl", "statement_kinds",
  "records", "has", "way", "disclosure", "industry", "uses", "task", "class", "field", "variable", "resource", "cover",
  "terrains", "code", "unit_words", "minor_words", "statement_kind", "kinds", "covers", "land_cover", "default_cover",
  "cleared_cover", "produces", "output", "input", "fuel", "title", "name", "text", "description", "reason", "why",
  "visits", "tax", "order", "channel", "sites", "attribute", "deontic", "aim", "condition",
]);

/** Where the things a town defines are listed: only an item there has its `id` renamed (a channel's, a venture's or a
 * line's own name within something is not an id of the world's). */
const DEFINING = new Set(["world.entities.id", "world.accounts.id", "world.structures.id", "world.records.id", "world.places.id",
  "world.connections.id", "world.network.nodes.id", "world.network.links.id", "world.network.supplies.id", "travel.vehicles.id",
  "participants.id", "positions.id", "templates.id"]);

const CELL = /^cell\.(\d+)\.(\d+)$/;

/** Every id a town defines, outside what the towns share. */
function definedIds(c: any, shared: Set<string>): Set<string> {
  const w = c.world;
  const out = new Set<string>();
  const add = (xs: any[] | undefined) => { for (const x of xs ?? []) if (typeof x?.id === "string" && !shared.has(x.id)) out.add(x.id); };
  add(w.entities); add(w.accounts); add(w.structures); add(w.records); add(w.places); add(w.connections);
  add(w.network?.nodes); add(w.network?.links); add(w.network?.supplies);
  add(c.travel?.vehicles); add(c.participants); add(c.positions); add(c.templates);
  return out;
}

/** What the towns share, read from the first: the boundaries, their accounts, the network off the ground. */
function sharedIds(c: any): Set<string> {
  const w = c.world;
  const b = new Set<string>(w.boundaries ?? []);
  const s = new Set<string>(b);
  for (const a of w.accounts ?? []) if (b.has(a.holder)) s.add(a.id);
  const off = new Set<string>((w.network?.nodes ?? []).filter((n: any) => !n.cell).map((n: any) => n.id));
  for (const n of off) s.add(n);
  for (const l of w.network?.links ?? []) if (off.has(l.from) && off.has(l.to)) s.add(l.id);
  return s;
}

/** The town with its ids prefixed and its cells moved east by `dx`. */
function renamed(c: any, ids: Set<string>, prefix: string, dx: number): any {
  const id = (s: string): string => {
    if (ids.has(s)) return prefix + s;
    const m = CELL.exec(s);
    if (m) return dx ? `cell.${Number(m[1]) + dx}.${m[2]}` : s;
    const slash = s.indexOf("/");
    if (slash > 0) {
      const head = s.slice(0, slash);
      if (ids.has(head)) return prefix + s;
      const cm = CELL.exec(head);
      if (cm && dx) return `cell.${Number(cm[1]) + dx}.${cm[2]}${s.slice(slash)}`;
    }
    return s;
  };
  const key = (k: string): string => {
    // (A map keyed by ids, or a table row named after a template: `template.<id>.<what>`.)
    const r = id(k);
    if (r !== k) return r;
    const parts = k.split(".");
    if (parts.length >= 3 && parts[0] === "template" && ids.has(parts[1]!)) return [parts[0], prefix + parts[1], ...parts.slice(2)].join(".");
    return k;
  };
  // (A key is renamed only where it is spelled as no field is, with a dash, a digit or a dot: a plain word is a field's
  // name, the bank's or the school's though it be.)
  const idLike = (k: string) => /[-0-9./]/.test(k);
  const walk = (v: any, under: string | undefined, path: string): any => {
    if (typeof v === "string") return under && VOCABULARY.has(under) ? v : under === "id" && !DEFINING.has(path) ? v : id(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, under, path));
    if (v && typeof v === "object") {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) {
        // (An area on the ground: moved with its town.)
        if (k === "x" && typeof x === "number" && typeof v.w === "number" && typeof v.y === "number") { o[k] = x + dx; continue; }
        o[VOCABULARY.has(k) || !idLike(k) ? k : key(k)] = walk(x, k, path ? `${path}.${k}` : k);
      }
      return o;
    }
    return v;
  };
  return walk(c, undefined, "");
}

/** Two sections that should be the same in every town, merged: a conflict is an error, except a space's capacity (the
 * largest) and the cap on entities created (the sum). Arrays the same are kept; different ones are joined, each item once. */
function merged(a: any, b: any, path: string): any {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    // (Items with ids: merged by id, in the first's order, then the second's new ones.)
    if (a.every((x) => typeof x?.id === "string") && b.every((x) => typeof x?.id === "string")) {
      const byId = new Map<string, any>(a.map((x) => [x.id, x]));
      for (const x of b) byId.set(x.id, byId.has(x.id) ? merged(byId.get(x.id), x, `${path}[${x.id}]`) : x);
      return [...byId.values()];
    }
    if (a.length === b.length && path.endsWith(".spaces")) return a.map((x, i) => merged(x, b[i], `${path}[${i}]`));
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const o: any = { ...a };
    for (const k of Object.keys(b)) o[k] = merged(a[k], b[k], `${path}.${k}`);
    return o;
  }
  // (One design of each building in the world, as big as the town that needs most of it: a school's classrooms, a
  // shop's places of work.)
  if (/\.spaces\[\d+\]\.(capacity|count)$/.test(path) && typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (path.endsWith(".max_created_entities") && typeof a === "number" && typeof b === "number") return a + b;
  // (A rate the generator derives from its town's people, in a table the world has one of: a building's wear a day, from
  // the town's adults over its homes; how often pay comes short, over its jobs. The towns are of one spec, so theirs are
  // near one another; the world's is the first town's.)
  if ((/^catalogue\.variables\[[^\]]+\]\.per_day$/.test(path) || /^orchestration\.slip\.[a-z]+\.[^.]+\.bps$/.test(path)) && typeof a === "number" && typeof b === "number") return a;
  throw new Error(`towns: ${path} differs between the towns (${JSON.stringify(a)?.slice(0, 80)} and ${JSON.stringify(b)?.slice(0, 80)}): they cannot share one world`);
}

/**
 * What of a later town is the outside world's and the same as the first town's, and names nothing of its own town: a
 * template written alike (an agency's system), an office of the outside's with the system that holds it (the weather
 * bureau). These are the world's once, the first town's: the ids returned are not renamed, and the later town's copies
 * are dropped. A thing that names something of its town (the outside's trade desk, which deals with its factories)
 * stays the town's.
 */
function theOutsidesOwn(c: any, first: any, ids: Set<string>, shared: Set<string>): Set<string> {
  const firsts = new Map<string, string>([...(first.positions ?? []), ...(first.participants ?? []), ...(first.templates ?? [])].map((x: any) => [x.id, JSON.stringify(x)]));
  const outsiders = [
    ...(c.templates ?? []),
    ...(c.positions ?? []).filter((x: any) => shared.has(x.entity)),
    ...(c.participants ?? []).filter((x: any) => shared.has(x.owner)),
  ].filter((x: any) => firsts.get(x.id) === JSON.stringify(x));
  const strings = (v: any, out: string[] = []): string[] => {
    if (typeof v === "string") out.push(v.split("/")[0]!);
    else if (Array.isArray(v)) for (const x of v) strings(x, out);
    else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
    return out;
  };
  const same = new Set<string>(outsiders.map((x: any) => x.id));
  // (Until nothing changes: one that names a thing of the town's not itself the outside's is the town's, and so is any
  // that names it.)
  for (let changed = true; changed;) {
    changed = false;
    for (const x of outsiders) if (same.has(x.id) && strings({ ...x, id: undefined }).some((s) => ids.has(s) && !same.has(s))) { same.delete(x.id); changed = true; }
    // (A post and the system that holds it go together.)
    for (const p of c.positions ?? []) if (p.holder && same.has(p.id) !== same.has(p.holder)) { same.delete(p.id); same.delete(p.holder); changed = true; }
  }
  return same;
}

const cellOf = (s: string) => { const m = CELL.exec(s)!; return [Number(m[1]), Number(m[2])] as const; };

/**
 * One world of the towns given, the first's ids kept, the others' prefixed. Each town must be a generated one-town
 * world of the same profile and weather (the generator's `towns`).
 */
export function composeTowns(towns: any[]): any {
  if (towns.length === 1) return towns[0];
  const first = towns[0];
  const shared = sharedIds(first);
  let dx = 0;
  const parts: any[] = [];
  for (const [k, raw] of towns.entries()) {
    // (A citizen's and the arrivals office's templates by default: named, so that each town's are its own.)
    const c = structuredClone(raw);
    for (const p of [...c.participants, ...c.templates]) {
      const ctl = p.controller;
      if (ctl?.impl === "citizen.default" && ctl.params && ctl.params.child_template === undefined) ctl.params.child_template = "child";
      if (ctl?.impl === "world.migration" && ctl.params && ctl.params.template === undefined) ctl.params.template = "newcomer";
    }
    const ids = definedIds(c, shared);
    if (k > 0) {
      const same = theOutsidesOwn(c, towns[0], ids, shared);
      for (const x of same) ids.delete(x);
      c.positions = (c.positions ?? []).filter((x: any) => !same.has(x.id));
      c.participants = (c.participants ?? []).filter((x: any) => !same.has(x.id));
      c.templates = (c.templates ?? []).filter((x: any) => !same.has(x.id));
    }
    parts.push(renamed(c, ids, k === 0 ? "" : `t${k + 1}-`, dx));
    dx += c.world.ground.w;
  }
  const w0 = first.world;
  const out: any = structuredClone(parts[0]);
  const W = out.world;
  W.ground = { ...W.ground, w: dx, h: Math.max(...parts.map((p) => p.world.ground.h)), terrain: parts.flatMap((p) => p.world.ground.terrain ?? []) };
  for (const key of ["entities", "accounts", "structures", "occupancy", "records", "connections", "populations", "flows", "places"]) {
    const seen = new Set<string>();
    W[key] = parts.flatMap((p) => p.world[key] ?? []).filter((x: any) => {
      if (typeof x?.id !== "string" || !shared.has(x.id)) return true;
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  }
  // (The places: each town's own tree, within one region that is the whole ground.)
  const roots = W.places.filter((p: any) => !p.within);
  W.places = [{ id: "region", kind: "region", name: parts.map((p) => p.meta.name).join(", "), area: { x: 0, y: 0, w: W.ground.w, h: W.ground.h }, detailed: true },
    ...W.places.map((p: any) => (roots.includes(p) ? { ...p, within: "region" } : p))];
  // (What the outside holds: one holding of each kind at each place, the towns' together.)
  const holdings = new Map<string, any>();
  for (const h of parts.flatMap((p) => p.world.holdings ?? [])) {
    const key = `${h.holder}\u0000${h.at}\u0000${h.kind}`;
    const was = holdings.get(key);
    holdings.set(key, was ? { ...was, quantity: String(BigInt(was.quantity) + BigInt(h.quantity)) } : h);
  }
  W.holdings = [...holdings.values()];
  for (const key of Object.keys(w0)) {
    if (["ground", "holdings", "network", "entities", "accounts", "structures", "occupancy", "records", "connections", "populations", "flows", "places"].includes(key)) continue;
    W[key] = parts.map((p) => p.world[key]).reduce((a, b) => merged(a, b, `world.${key}`));
  }
  // The network: each town's own, the shared nodes and links off the ground once, and a road from each town's gate to the
  // next town's.
  if (w0.network) {
    const once = <T extends { id: string }>(xs: T[]) => { const seen = new Set<string>(); return xs.filter((x) => !seen.has(x.id) && (seen.add(x.id), true)); };
    const nodes = once(parts.flatMap((p) => p.world.network?.nodes ?? []));
    const links = once(parts.flatMap((p) => p.world.network?.links ?? []));
    const supplies = parts.flatMap((p) => p.world.network?.supplies ?? []);
    const cellOfNode = new Map<string, string>(nodes.filter((n: any) => n.cell).map((n: any) => [n.id, n.cell]));
    // (A town's gate: where its road leaves the ground.)
    const gates = parts.map((p) => (p.world.network?.links ?? []).find((l: any) => cellOfNode.has(l.from) && shared.has(l.to) && l.mode === "road")).filter(Boolean);
    const metres = first.world.ground.cell;
    for (let i = 0; i + 1 < gates.length; i++) {
      const [a, b] = [gates[i], gates[i + 1]];
      const [x1, y1] = cellOf(cellOfNode.get(a.from)!), [x2, y2] = cellOf(cellOfNode.get(b.from)!);
      const { id: _, from: __, to: ___, length_m: ____, ...road } = a;
      links.push({ id: `road-between-${i + 1}-${i + 2}`, from: a.from, to: b.from, ...road, length_m: Math.round(Math.hypot(x2 - x1, y2 - y1) * metres) });
    }
    W.network = { ...w0.network, nodes, links, ...(supplies.length || w0.network.supplies ? { supplies } : {}) };
  }
  out.positions = parts.flatMap((p) => p.positions ?? []);
  out.participants = parts.flatMap((p) => p.participants ?? []);
  out.templates = parts.flatMap((p) => p.templates ?? []);
  if (first.travel) out.travel = { ...parts.map((p) => ({ ...p.travel, vehicles: [] })).reduce((a, b) => merged(a, b, "travel")), vehicles: parts.flatMap((p) => p.travel?.vehicles ?? []) };
  for (const key of ["catalogue", "knowing", "orchestration", "life", "caps"]) if (first[key] !== undefined) out[key] = parts.map((p) => p[key]).reduce((a, b) => merged(a, b, key));
  out.meta = { ...first.meta, name: parts.map((p) => p.meta.name).join(", "), description: `${towns.length} towns on one ground, joined by road and sharing the outside world. ${parts.map((p) => p.meta.description).join(" ")}` };
  return out;
}
