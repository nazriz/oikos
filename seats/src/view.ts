// A seat's view: what it has perceived, kept up to date from its looks.
//
// Perception is changes, not snapshots (contracts v0.3): each look through a
// channel delivers only what changed in its scope since the seat's last look
// through it. The seat runtime applies those changes here, so every
// controller (code module, language model, human, RL) works from the same
// current picture without the kernel re-sending it. The kernel's perception
// invariant test checks that a view built this way always equals the full
// picture (kernel/tests/perception.rs).

import type { ChannelData, Observation, Record, SiteParcel } from "./contracts";

type AccountItem = Extract<ChannelData, { kind: "accounts" }>["accounts"][number];
type DirectoryData = Extract<ChannelData, { kind: "directory" }>;

/** A channel's items, sorted by id (the kernel's order). The list is shared between observations until the channel changes: read it, don't modify it. */
const byKey = <T>(m: Map<string, T>) => [...m.keys()].sort().map((k) => m.get(k)!);

export class View {
  private accounts = new Map<string, Map<string, AccountItem>>();
  private sites = new Map<string, { as_of: number; parcels: Map<string, SiteParcel> }>();
  private directories = new Map<string, { entities: Map<string, DirectoryData["entities"][number]>; seats: Map<string, DirectoryData["seats"][number]> }>();
  private kept = new Map<string, Map<string, Record>>();
  /** Each channel's current picture as a sorted list, rebuilt only when the channel changed. */
  private cache = new Map<string, unknown[] | { entities: unknown[]; seats: unknown[] }>();

  /** `full`: records channels whose every record the seat should always see (standing documents); others show what's new. */
  constructor(private readonly full: Set<string> = new Set()) {}

  /**
   * Apply a look, and return the observation as the seat's controller reads it:
   * accounts, sites and the directory as their full current picture (a channel
   * not looked through this time shows what the seat last saw, with no new
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
      } else if (ch.kind === "sites") {
        const v = this.sites.get(id) ?? { as_of: ch.as_of, parcels: new Map() };
        v.as_of = ch.as_of;
        for (const p of ch.parcels) v.parcels.set(p.parcel, p);
        this.sites.set(id, v);
        if (ch.parcels.length) this.cache.delete(id);
      } else if (ch.kind === "directory") {
        const v = this.directories.get(id) ?? { entities: new Map(), seats: new Map() };
        for (const e of ch.entities) v.entities.set(e.entity, e);
        for (const s of ch.seats) v.seats.set(s.seat, s);
        this.directories.set(id, v);
        if (ch.entities.length || ch.seats.length) this.cache.delete(id);
      } else if (ch.search) {
        channels[id] = ch; // a search's results: what matches now, as they are
      } else if (this.full.has(id)) {
        const m = this.kept.get(id) ?? new Map();
        for (const r of ch.records) m.set(r.id, r);
        this.kept.set(id, m);
      } else channels[id] = ch;
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
    for (const [id, v] of this.sites) channels[id] = { kind: "sites", as_of: v.as_of, parcels: cached(id, () => byKey(v.parcels)) };
    for (const [id, v] of this.directories) {
      const d = cached(id, () => ({ entities: byKey(v.entities), seats: byKey(v.seats) }));
      channels[id] = { kind: "directory", entities: d.entities, seats: d.seats };
    }
    for (const [id, m] of this.kept) channels[id] = { kind: "records", records: [...m.values()] };
    return { ...obs, channels: Object.fromEntries(Object.keys(channels).sort().map((k) => [k, channels[k]!])) };
  }
}
