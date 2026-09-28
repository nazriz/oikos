// What a participant knows: everything it has observed, indexed for the resolver.
// The resolver fills gaps and turns names into ids only from this (P8): it
// never looks at the world beyond what the participant has seen.

import type { Observation, Record, SiteSpace, StatementRecord } from "@terrarium/participants";

export interface AccountFact {
  account: string;
  holder: string;
  custodian: string;
}

/** A building the participant has seen: its type, corner cell and the spaces inside. */
export interface StructureFact {
  type: string;
  at: string;
  spaces: SiteSpace[];
}

export class Knowledge {
  readonly withdrawn = new Set<string>();
  readonly accounts = new Map<string, AccountFact>(); // accounts the participant can see directly
  /** What the entity acted for holds, and where (phase B): `at|kind` -> quantity (a decimal-string integer). */
  readonly holdings = new Map<string, { kind: string; at: string; quantity: string }>();
  /** entity -> accounts it has asked to be paid into (the shared outcome language: a money outcome with no `from`, in a statement it speaks for). */
  readonly stated = new Map<string, Set<string>>();
  readonly names = new Map<string, string>(); // entity -> name
  /** participant -> the person it acts as. */
  readonly participantPerson = new Map<string, string>();
  /** position -> the organisation it acts for. */
  readonly positions = new Map<string, string>();
  /** Positions the participant has held (the observation lists those it holds now). */
  readonly held = new Set<string>();
  readonly structures = new Map<string, StructureFact>();
  /** Cells seen, with their terrain and whether a building stands on them. */
  readonly cells = new Map<string, { x: number; y: number; terrain?: string; built: boolean }>();
  /** Lots in a registry the participant has seen (statements of kind "lot"): lot -> its cells. */
  readonly lots = new Map<string, string[]>();
  private readonly formsById = new Map<string, StatementRecord>();
  /** Laws and claims the participant has seen: what law warnings are judged against (§10). */
  readonly laws = new Map<string, StatementRecord>();
  readonly claims: Record[] = [];
  private readonly claimIds = new Set<string>();
  entity = "";
  t = 0;

  absorb(obs: Observation): void {
    this.entity = obs.entity;
    this.t = obs.t;
    for (const p of obs.positions ?? []) {
      this.positions.set(p.position, p.entity);
      this.held.add(p.position);
    }
    for (const ch of Object.values(obs.channels)) {
      if (ch.kind === "accounts") {
        for (const a of ch.accounts) {
          if (a.closed) this.accounts.delete(a.account);
          else this.accounts.set(a.account, { account: a.account, holder: a.holder, custodian: a.custodian });
        }
      } else if (ch.kind === "holdings") {
        for (const h of ch.holdings) {
          if (h.quantity === "0") this.holdings.delete(`${h.at}|${h.kind}`);
          else this.holdings.set(`${h.at}|${h.kind}`, h);
        }
      } else if (ch.kind === "sites") {
        for (const c of ch.cells) {
          this.cells.set(c.cell, { x: c.x, y: c.y, ...(c.terrain ? { terrain: c.terrain } : {}), built: !!c.structure });
          if (c.structure) this.structures.set(c.structure.structure, { type: c.structure.type, at: c.structure.at, spaces: c.structure.spaces });
        }
      } else if (ch.kind === "directory") {
        for (const e of ch.entities) {
          this.names.set(e.entity, e.name);
          if (e.participant) this.participantPerson.set(e.participant, e.entity);
        }
        for (const p of ch.positions) this.positions.set(p.position, p.entity);
      } else if (ch.kind === "records") {
        for (const r of ch.records) this.add(r);
      }
    }
  }

  private add(r: Record): void {
    if (r.record === "withdrawal") {
      this.withdrawn.add(r.withdraws);
      this.lots.delete(r.withdraws);
    }
    if ((r.record === "claim" || r.record === "claim_release" || r.record === "withdrawal") && !this.claimIds.has(r.id)) {
      this.claimIds.add(r.id);
      this.claims.push(r);
    }
    if (r.record === "entity_declaration") this.names.set(r.entity, r.name);
    if (r.record === "statement") {
      if (r.kind === "form") this.formsById.set(r.id, r);
      if (r.kind === "law" && r.formal?.condition) this.laws.set(r.id, r);
      if (r.kind === "lot" && Array.isArray(r.data?.cells)) this.lots.set(r.id, r.data.cells as string[]);
      // Someone asking to be paid names where the money should go: that's where they receive money.
      const who = r.speaks_for;
      const m = r.data?.outcome?.money;
      if (who && m && typeof m.to === "string" && m.from === undefined) this.stated.set(who, new Set([...(this.stated.get(who) ?? []), m.to]));
    }
  }

  /** The entity an id refers to: a participant's person, a position's organisation, or the entity itself. */
  entityOf(id: string): string {
    return this.participantPerson.get(id) ?? this.positions.get(id) ?? id;
  }

  /** The entity acting in a capacity: a position's organisation, or (as itself) the participant's own. */
  actingFor(as?: string): string {
    return (as && this.positions.get(as)) || this.entity;
  }

  /** The building a space is in, and whether the id names a space at all (`apts-3/dwelling.2`). */
  static structureOf(space: string): string {
    return space.split("/")[0]!;
  }

  /** Accounts the participant knows to be held by an entity. */
  accountsOf(entity: string): string[] {
    const own = [...this.accounts.values()].filter((a) => a.holder === entity).map((a) => a.account);
    return [...new Set([...own, ...(this.stated.get(entity) ?? [])])].sort();
  }

  isAccount(id: string): boolean {
    return this.accounts.has(id) || [...this.stated.values()].some((s) => s.has(id));
  }

  /** An entity id for a name the participant wrote, if exactly one matches. */
  byName(name: string): string[] {
    const n = name.trim().toLowerCase();
    return [...this.names].filter(([, v]) => v.toLowerCase() === n).map(([k]) => k).sort();
  }

  name(id: string): string {
    const e = this.entityOf(id);
    const n = this.names.get(e);
    return n && n !== e ? `${n} (${e})` : e;
  }

  /** Forms the participant has seen and that still stand. */
  get forms(): StatementRecord[] {
    return [...this.formsById.values()].filter((f) => !this.withdrawn.has(f.id));
  }

  /** Where the entity holds some of a kind (phase B). */
  placesHolding(kind: string): string[] {
    return [...this.holdings.values()].filter((h) => h.kind === kind).map((h) => h.at).sort();
  }

  /** The standing form, by its name or its record's id, published by an institution a participant, position or entity id names. */
  form(to: string, name: string): StatementRecord | undefined {
    const ent = this.entityOf(to);
    return [...this.formsById.values()]
      .filter((f) => !this.withdrawn.has(f.id) && (f.data?.form === name || f.id === name) && (f.author === to || f.in_position === to || f.speaks_for === ent || (f.data?.submit_to ?? []).includes(ent)))
      .sort((a, b) => b.at - a.at)[0];
  }
}
