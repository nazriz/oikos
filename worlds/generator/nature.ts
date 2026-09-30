// The landscape around a town (docs/design/world-expansion.md 2): covers in blocks, the river's course, where species
// live at the start, and the catalogue's nature, all from the profile's `nature` (real units, with sources), converted
// to cells with its cell size. Generic: no place's figures here.

import type { Profile } from "./profile";

type Nature = NonNullable<Profile["values"]["nature"]>;
type Rng = { below(n: number | bigint): number };

export interface Landscape {
  /** The whole ground (the town at its corner, the landscape east and south of it). */
  ground: { w: number; h: number; terrain: { label: string; x: number; y: number; w: number; h: number }[] };
  /** The places: the district (the root: all of it) and the town within it, both detailed. */
  places: { id: string; kind: string; name?: string; within?: string; area: { x: number; y: number; w: number; h: number }; detailed: true }[];
  /** The landscape's lots (blocks of cells), each with its cover. */
  lots: { id: string; cells: string[]; cover: string }[];
  flows: { from: string; to: string }[];
  populations: { species: string; cell: string; count: number }[];
  /** For the catalogue. */
  land_covers: { id: string; succeeds_to?: { cover: string; after_days: number } }[];
  default_cover: string;
  cleared_cover: string;
  fields: object[];
  species: object[];
  /** Covers a building may stand on (all but water). */
  buildable: string[];
  /** The survey task: labour per cell. */
  survey_labour: number;
  /** The species listed as threatened (the profile says which), and the covers each lives on. */
  listed: { id: string; name: string; covers: string[] }[];
}

const cell = (x: number, y: number) => `cell.${x}.${y}`;

export function landscape(N: Nature, grid: { w: number; h: number }, townName: string, rng: (k: string) => Rng, factoryType: string): Landscape {
  const m = N.landscape.margin_cells;
  const b = N.landscape.block_cells;
  const W = grid.w + m;
  const H = grid.h + m;
  const cellHa = (N.cell_m * N.cell_m) / 10_000;
  const YEAR = 365;
  // The landscape's blocks: the band east of the town (all rows) and the band south of it (the town's columns).
  const blocks: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < H; y += b) for (let x = grid.w; x < W; x += b) blocks.push({ x, y, w: Math.min(b, W - x), h: Math.min(b, H - y) });
  for (let y = grid.h; y < H; y += b) for (let x = 0; x < grid.w; x += b) blocks.push({ x, y, w: Math.min(b, grid.w - x), h: Math.min(b, H - y) });
  // The river runs along the town's last row, east to the world's edge: its row of blocks is where wetland lies.
  const riverY = grid.h - 1;
  const cover: (string | undefined)[] = blocks.map(() => undefined);
  const counts = Object.fromEntries(Object.entries(N.landscape.shares_bps).map(([k, bps]) => [k, Math.round((blocks.length * bps) / 10_000)]));
  const r = rng("landscape");
  const adjacent = (i: number, j: number) => {
    const [p, q] = [blocks[i]!, blocks[j]!];
    return (p.x === q.x + q.w || q.x === p.x + p.w) && p.y < q.y + q.h && q.y < p.y + p.h || (p.y === q.y + q.h || q.y === p.y + p.h) && p.x < q.x + q.w && q.x < p.x + p.w;
  };
  // Wetland: blocks beside the river.
  const byRiver = blocks.map((_, i) => i).filter((i) => blocks[i]!.y <= riverY + 1 && blocks[i]!.y + blocks[i]!.h >= riverY);
  for (let k = 0; k < (counts.wetland ?? 0) && byRiver.length; k++) cover[byRiver.splice(r.below(byRiver.length), 1)[0]!] = "wetland";
  // Woodland: grown from a few seeds into patches (so there's habitat big enough for a home range, and gaps between).
  const woodland = counts.woodland ?? 0;
  const seeds = Math.max(1, N.landscape.woodland_patches);
  const frontier: number[] = [];
  for (let k = 0; k < seeds; k++) {
    const free = blocks.map((_, i) => i).filter((i) => cover[i] === undefined);
    if (!free.length) break;
    const i = free[r.below(free.length)]!;
    cover[i] = "woodland";
    frontier.push(i);
  }
  let grown = frontier.length;
  while (grown < woodland && frontier.length) {
    const from = frontier[r.below(frontier.length)]!;
    const next = blocks.map((_, i) => i).filter((i) => cover[i] === undefined && adjacent(from, i));
    if (!next.length) {
      frontier.splice(frontier.indexOf(from), 1);
      continue;
    }
    const i = next[r.below(next.length)]!;
    cover[i] = "woodland";
    frontier.push(i);
    grown++;
  }
  // The rest by their shares, at random.
  const rest = blocks.map((_, i) => i).filter((i) => cover[i] === undefined);
  const bag = Object.entries(counts).filter(([k]) => k !== "wetland" && k !== "woodland").flatMap(([k, n]) => Array(n).fill(k) as string[]);
  for (const i of rest) cover[i] = bag.length ? bag.splice(r.below(bag.length), 1)[0]! : N.default_cover;
  // Terrain: the town is the default cover (labelled, so building types can list what they stand on), then the blocks,
  // then the river's row over everything.
  const terrain = [
    { label: N.default_cover, x: 0, y: 0, w: grid.w, h: grid.h },
    ...blocks.map((bl, i) => ({ label: cover[i]!, ...bl })),
    { label: N.river_cover, x: 0, y: riverY, w: W, h: 1 },
  ];
  const lots = blocks.map((bl, i) => {
    const cells: string[] = [];
    for (let y = bl.y; y < bl.y + bl.h; y++) for (let x = bl.x; x < bl.x + bl.w; x++) cells.push(cell(x, y));
    return { id: `lot-land-${String(i + 1).padStart(3, "0")}`, cells, cover: cover[i]! };
  });
  // The river flows east along its row.
  const flows = Array.from({ length: W - 1 }, (_, x) => ({ from: cell(x, riverY), to: cell(x + 1, riverY) }));
  // Each cell's cover, for where species start.
  const coverAt = (x: number, y: number) => {
    if (y === riverY) return N.river_cover;
    if (x < grid.w && y < grid.h) return N.default_cover;
    const i = blocks.findIndex((bl) => x >= bl.x && x < bl.x + bl.w && y >= bl.y && y < bl.y + bl.h);
    return cover[i]!;
  };
  // Capacity per 1,000 cells, from density per hectare; home range as cells each way (a square of the same area).
  const perThousand = (perHa: number) => Math.round(perHa * cellHa * 1000);
  const rangeCells = (ha: number) => (ha > 0 ? Math.max(0, Math.round((Math.sqrt(ha / cellHa) - 1) / 2)) : 0);
  const species = N.species.map((s) => ({
    id: s.id, name: s.name,
    capacity_per_1000_cells: Object.fromEntries(Object.entries(s.density_per_ha).map(([c, d]) => [c, perThousand(d)])),
    ...(rangeCells(s.home_range_ha) ? { home_range: rangeCells(s.home_range_ha) } : {}),
    growth_bps_per_year: s.growth_bps_per_year, mortality_bps_per_year: s.mortality_bps_per_year, dispersal_bps_per_year: s.dispersal_bps_per_year,
    ...(s.dispersal_m ? { dispersal_range: Math.max(1, Math.round(s.dispersal_m / N.cell_m)) } : {}),
    ...(s.barriers?.length ? { barriers: s.barriers } : {}), min_viable: s.min_viable,
    ...(s.tolerance ? { tolerance: s.tolerance } : {}), detection_bps: s.detection_bps, ...(s.conspicuous ? { conspicuous: true } : {}),
  }));
  // Where they start: at about their capacity (outside the town), each cell's expectation rounded by a draw.
  const populations: { species: string; cell: string; count: number }[] = [];
  const pr = rng("populations");
  for (const s of N.species) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x < grid.w && y < riverY) continue; // (the town proper: none at the start)
      const per = perThousand(s.density_per_ha[coverAt(x, y)] ?? 0);
      if (!per) continue;
      const count = Math.floor(per / 1000) + (pr.below(1000) < per % 1000 ? 1 : 0);
      if (count > 0) populations.push({ species: s.id, cell: cell(x, y), count });
    }
  }
  const P = N.pollution;
  return {
    ground: { w: W, h: H, terrain },
    places: [
      { id: "district", kind: "district", name: `${townName} district`, area: { x: 0, y: 0, w: W, h: H }, detailed: true },
      { id: "town", kind: "town", name: townName, within: "district", area: { x: 0, y: 0, w: grid.w, h: grid.h }, detailed: true },
    ],
    lots, flows, populations,
    land_covers: N.covers.map((c) => ({ id: c.id, ...(c.succeeds_to ? { succeeds_to: { cover: c.succeeds_to.cover, after_days: Math.round(c.succeeds_to.after_years * YEAR) } } : {}) })),
    default_cover: N.default_cover,
    cleared_cover: N.cleared_cover,
    fields: [{ id: "pollution", min: 0, max: 1_000_000_000, decay_bps_per_day: P.decay_bps_per_day, diffusion_bps_per_day: P.diffusion_bps_per_day, flow_bps_per_day: P.flow_bps_per_day,
      from_structures: { [factoryType]: P.per_factory_per_day }, from_covers: { farmland: P.per_farmland_cell_per_day } }],
    species,
    buildable: N.covers.map((c) => c.id),
    survey_labour: Math.round(N.survey_hours_per_ha * cellHa * 3600),
    listed: N.species.filter((s) => s.listed).map((s) => ({ id: s.id, name: s.name, covers: Object.keys(s.density_per_ha) })),
  };
}
