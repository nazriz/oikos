// The town's network for what flows (foundations-2 C4, law 8; docs/nothing-from-nothing.md; docs/behaviour/utilities.md):
// a water main, an electricity feeder and a sewer, each a tree from its works out to the town's districts and from each
// district to every building it serves. The kernel settles every connection on it by its physics (pressure, ratings,
// a drain); nothing here decides who goes short.
//
// The layout is the generator's stand-in for a town's real one: the buildings are grouped into districts (the quarters of
// the town around its middle), each district fed by one main from the works and each building by a service from its
// district's node. Capacities are sized from what the buildings ask at the start, with the profile's margins
// (`utilities.network`), so that a town at its first size is served in full and one that grows, or a store run low,
// meets the network's limits as a real one would: the far end and the most loaded district first.

export interface NetworkFigures {
  /** The water works' head when its store is full, the head at which a tap runs as it should, and below which nothing comes, in metres. */
  head_m: number;
  service_head_m: number;
  min_head_m: number;
  /** The works' store: so many days of the town's use at the start. */
  storage_days: number;
  /** A pipe or a wire is sized for this many times its users' average flow at the start (basis points of it). */
  pipe_peak_bps: number;
  wire_margin_bps: number;
  /** The head a main and a service lose carrying their capacity, in metres. */
  main_loss_m: number;
  service_loss_m: number;
  /** How a household's day of electricity falls over its hours (24 shares, summing to 10,000). */
  shape_bps: number[];
}

export interface User {
  /** Who holds what is delivered, and where. */
  holder: string;
  at: string;
  water_l_day: number;
  energy_kwh_day: number;
  /** What is delivered is held there for its own processes to use (a works, a data centre), not used as it comes. */
  store?: boolean;
}

export interface Site {
  structure: string;
  cell: string;
  holder: string;
}

const xy = (cell: string): [number, number] => {
  const [, x, y] = cell.split(".");
  return [Number(x), Number(y)];
};

/** The network and its connections at the start: a node at each building served, at each district and at each works. */
export function townNetwork(opts: { structures: { id: string; at: string }[]; homes: { id: string; dwellings: number }[]; users: User[]; water: Site; power: Site; sewer: Site; f: NetworkFigures }) {
  const { users, f } = opts;
  // Every home is served, whether or not it is lived in at the start: a household that moves into an empty one is
  // connected on its node, and its service is sized for its dwellings at a household's average use.
  const served = [...new Set([...users.map((u) => u.at), ...opts.homes.map((h) => h.id)])].sort();
  const avgW = users.length ? users.reduce((a, u) => a + u.water_l_day, 0) / users.length : 0;
  const avgE = users.length ? users.reduce((a, u) => a + u.energy_kwh_day, 0) / users.length : 0;
  const dwellings = new Map(opts.homes.map((h) => [h.id, h.dwellings]));
  const cellOf = new Map(opts.structures.map((s) => [s.id, s.at]));
  // Districts: the quarters of the town around the middle of what is served.
  const pts = served.map((s) => xy(cellOf.get(s)!));
  const mid = (i: 0 | 1) => { const v = pts.map((p) => p[i]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)]! : 0; };
  const [mx, my] = [mid(0), mid(1)];
  const district = (s: string) => { const [x, y] = xy(cellOf.get(s)!); return `d${x < mx ? 0 : 1}${y < my ? 0 : 1}`; };
  const districts = [...new Set(served.map(district))].sort();
  const water = new Map<string, number>(), power = new Map<string, number>();
  for (const u of users) {
    water.set(u.at, (water.get(u.at) ?? 0) + u.water_l_day);
    power.set(u.at, (power.get(u.at) ?? 0) + u.energy_kwh_day);
  }
  // (Sized for what a building's dwellings would ask full, at the average household's use, where that is more.)
  for (const s of served) {
    const n = dwellings.get(s) ?? 1;
    water.set(s, Math.max(water.get(s) ?? 0, n * avgW));
    power.set(s, Math.max(power.get(s) ?? 0, n * avgE));
  }
  const peakShare = Math.max(...f.shape_bps);
  const sum = (m: Map<string, number>, d: string) => served.filter((s) => district(s) === d).reduce((a, s) => a + (m.get(s) ?? 0), 0);
  const pipe = (daily: number) => Math.max(1, Math.ceil((daily * f.pipe_peak_bps) / 10_000 / 24));
  const wire = (daily: number) => Math.max(1, Math.ceil((daily * peakShare * f.wire_margin_bps) / 10_000 / 10_000));
  const len = (a: string, b: string) => { const [x1, y1] = xy(a), [x2, y2] = xy(b); return (Math.abs(x1 - x2) + Math.abs(y1 - y2)) * 10; };
  const dcell = (d: string) => { const s = served.find((x) => district(x) === d)!; return cellOf.get(s)!; };
  const nodes = [
    { id: "n-water-works", cell: opts.water.cell }, { id: "n-substation", cell: opts.power.cell },
    ...(opts.sewer.cell !== opts.water.cell ? [{ id: "n-treatment", cell: opts.sewer.cell }] : []),
    ...districts.map((d) => ({ id: `n-${d}`, cell: dcell(d) })),
    ...served.map((s) => ({ id: `n-${s}`, cell: cellOf.get(s)! })),
  ];
  const sewerNode = opts.sewer.cell !== opts.water.cell ? "n-treatment" : "n-water-works";
  const links: any[] = [];
  for (const d of districts) {
    links.push({ id: `pipe-${d}`, from: "n-water-works", to: `n-${d}`, mode: "pipe", length_m: len(opts.water.cell, dcell(d)), capacity: pipe(sum(water, d)), loss_m: f.main_loss_m });
    links.push({ id: `wire-${d}`, from: "n-substation", to: `n-${d}`, mode: "wire", length_m: len(opts.power.cell, dcell(d)), capacity: wire(sum(power, d)) });
    links.push({ id: `sewer-${d}`, from: sewerNode, to: `n-${d}`, mode: "sewer", length_m: len(opts.sewer.cell, dcell(d)), capacity: pipe(sum(water, d)) });
  }
  for (const s of served) {
    const d = district(s);
    links.push({ id: `pipe-${s}`, from: `n-${d}`, to: `n-${s}`, mode: "pipe", length_m: len(dcell(d), cellOf.get(s)!), capacity: pipe(water.get(s) ?? 0), loss_m: f.service_loss_m });
    links.push({ id: `wire-${s}`, from: `n-${d}`, to: `n-${s}`, mode: "wire", length_m: len(dcell(d), cellOf.get(s)!), capacity: wire(power.get(s) ?? 0) });
    links.push({ id: `sewer-${s}`, from: `n-${d}`, to: `n-${s}`, mode: "sewer", length_m: len(dcell(d), cellOf.get(s)!), capacity: pipe(water.get(s) ?? 0) });
  }
  const town = users.reduce((a, u) => a + u.water_l_day, 0);
  const storage = Math.max(1, Math.round(town * f.storage_days));
  const supplies = [
    { id: "water-supply", kind: "water", mode: "pipe", node: "n-water-works", holder: opts.water.holder, at: opts.water.structure, physics: "pressure", head_m: f.head_m, storage: String(storage), service_head_m: f.service_head_m, min_head_m: f.min_head_m },
    { id: "power-supply", kind: "energy", mode: "wire", node: "n-substation", holder: opts.power.holder, at: opts.power.structure, physics: "rating" },
    { id: "sewer", kind: "wastewater", mode: "sewer", node: sewerNode, holder: opts.sewer.holder, at: opts.sewer.structure, physics: "drain" },
  ];
  const connections: any[] = [];
  users.forEach((u, i) => {
    const tag = `${u.holder}-${u.at}`.replace(/[^a-z0-9_-]/g, "-").slice(0, 50);
    connections.push({ id: `w-${tag}`, kind: "water", node: `n-${u.at}`, holder: u.holder, at: u.at, rate: Math.round(u.water_l_day), ...(u.store ? {} : { uses: "use_water" }) });
    connections.push({ id: `e-${tag}`, kind: "energy", node: `n-${u.at}`, holder: u.holder, at: u.at, rate: Math.round(u.energy_kwh_day), ...(u.store ? {} : { uses: "use_energy" }), meter: "remote" });
    connections.push({ id: `s-${tag}`, kind: "wastewater", node: `n-${u.at}`, holder: u.holder, at: u.at, rate: 1_000_000 });
    void i;
  });
  return { network: { nodes, links, supplies }, connections, storage };
}
