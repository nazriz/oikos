// A participant's view: what it has perceived, kept up to date from its looks.
//
// Perception is changes, not snapshots (contracts v0.3): each look through a
// channel delivers only what changed in its scope since the participant's last look
// through it. The runtime applies those changes here, so every controller
// (code module, language model, human, RL) works from the same
// current picture without the kernel re-sending it. The kernel's perception
// invariant test checks that a view built this way always equals the full
// picture (kernel/tests/perception.rs).

import type { ChannelData, ConnectionItem, HoldingItem, LinkItem, Observation, PositionItem, Record, SiteCell } from "./contracts";

type AccountItem = Extract<ChannelData, { kind: "accounts" }>["accounts"][number];
type DirectoryData = Extract<ChannelData, { kind: "directory" }>;

/** A channel's items, sorted by id (the kernel's order). The list is shared between observations until the channel changes: read it, don't modify it. */
const byKey = <T>(m: Map<string, T>) => [...m.keys()].sort().map((k) => m.get(k)!);

export class View {
  private accounts = new Map<string, Map<string, AccountItem>>();
  private holdings = new Map<string, Map<string, HoldingItem>>();
  /** What flows (foundations-2 C3): each holdings channel's connections and links, whole as last delivered. */
  private flows = new Map<string, { connections?: ConnectionItem[]; links?: LinkItem[] }>();
  private sites = new Map<string, { as_of: number; cells: Map<string, SiteCell> }>();
  /** Places gone to (a visit's channel): when each cell was last seen, and the cells the latest visit saw. */
  private visits = new Map<string, { seen_at: { [cell: string]: number }; fresh: string[] }>();
  private directories = new Map<string, { entities: Map<string, DirectoryData["entities"][number]>; positions: Map<string, PositionItem> }>();
  private kept = new Map<string, Map<string, Record>>();
  /** Each channel's current picture as a sorted list, rebuilt only when the channel changed. */
  private cache = new Map<string, unknown[] | { entities: unknown[]; positions: unknown[] }>();

  /** `full`: records channels whose every record the participant should always see (standing documents); others show what's new. */
  constructor(private readonly full: Set<string> = new Set()) {}

  /**
   * Apply a look, and return the observation as the participant's controller reads it:
   * accounts, sites and the directory as their full current picture (a channel
   * not looked through this time shows what it last saw, with no new
   * transactions); records as what's new, or everything for `full` channels.
   */
  apply(obs: Observation): Observation {
    const channels: Observation["channels"] = {};
    for (const [id, ch] of Object.entries(obs.channels)) {
      if (ch.kind === "accounts") {
        const m = this.accounts.get(id) ?? new Map();
        this.accounts.set(id, m);
        for (const a of ch.accounts) {
          if (a.closed) m.delete(a.account);
          else m.set(a.account, a);
        }
        if (ch.accounts.length) this.cache.delete(id);
      } else if (ch.kind === "holdings") {
        // What's held where, as it changes; a holding that has gone to nothing drops out of the picture.
        const m = this.holdings.get(id) ?? new Map();
        this.holdings.set(id, m);
        for (const h of ch.holdings) {
          if (h.quantity === "0") m.delete(`${h.at}|${h.kind}`);
          else m.set(`${h.at}|${h.kind}`, h);
        }
        if (ch.holdings.length) this.cache.delete(id);
        if (ch.connections?.length || ch.links?.length || this.flows.has(id)) this.flows.set(id, { ...(ch.connections?.length ? { connections: ch.connections } : {}), ...(ch.links?.length ? { links: ch.links } : {}) });
      } else if (ch.kind === "sites") {
        // A move: the whole of the new surroundings replaces the old (what was seen there is the participant's memory, not its view).
        const v = (!ch.whole && this.sites.get(id)) || { as_of: ch.as_of, cells: new Map() };
        v.as_of = ch.as_of;
        for (const c of ch.cells) v.cells.set(c.cell, c);
        this.sites.set(id, v);
        // What a visit found is what was there when the looker was: kept as memory, each cell with when it was seen.
        if (ch.visited) {
          const m = this.visits.get(id) ?? { seen_at: {}, fresh: [] };
          m.seen_at = { ...m.seen_at };
          for (const c of ch.cells) m.seen_at[c.cell] = ch.as_of;
          m.fresh = ch.cells.map((c) => c.cell);
          this.visits.set(id, m);
        }
        if (ch.cells.length || ch.whole) this.cache.delete(id);
      } else if (ch.kind === "directory") {
        const v = this.directories.get(id) ?? { entities: new Map(), positions: new Map() };
        for (const e of ch.entities) v.entities.set(e.entity, e);
        for (const p of ch.positions) v.positions.set(p.position, p);
        this.directories.set(id, v);
        if (ch.entities.length || ch.positions.length) this.cache.delete(id);
      } else if (ch.search) {
        channels[id] = ch; // a search's results: what matches now, as they are
      } else if (this.full.has(id)) {
        const m = (!ch.whole && this.kept.get(id)) || new Map();
        for (const r of ch.records) m.set(r.id, r);
        this.kept.set(id, m);
      } else channels[id] = ch; // what's new (after a move: everything near the new place, all new to the participant)
    }
    const txs = (id: string) => {
      const ch = obs.channels[id];
      return ch?.kind === "accounts" ? ch.transactions : [];
    };
    const cached = <T>(id: string, make: () => T): T => {
      if (!this.cache.has(id)) this.cache.set(id, make() as any);
      return this.cache.get(id) as T;
    };
    for (const [id, m] of this.accounts) channels[id] = { kind: "accounts", accounts: cached(id, () => byKey(m)), transactions: txs(id) };
    for (const [id, m] of this.holdings) channels[id] = { kind: "holdings", holdings: cached(id, () => byKey(m)), ...(this.flows.get(id) ?? {}) };
    for (const [id, v] of this.sites) {
      const visit = this.visits.get(id);
      // (The cells its latest visit saw are said once, with the observation that brings them.)
      channels[id] = { kind: "sites", as_of: v.as_of, cells: cached(id, () => byKey(v.cells)), ...(visit ? { visited: true as const, seen_at: visit.seen_at, fresh: obs.channels[id]?.kind === "sites" ? visit.fresh : [] } : {}) };
    }
    for (const [id, v] of this.directories) {
      const d = cached(id, () => ({ entities: byKey(v.entities), positions: byKey(v.positions) }));
      channels[id] = { kind: "directory", entities: d.entities, positions: d.positions };
    }
    for (const [id, m] of this.kept) channels[id] = { kind: "records", records: [...m.values()] };
    return { ...obs, channels: Object.fromEntries(Object.keys(channels).sort().map((k) => [k, channels[k]!])) };
  }
}
