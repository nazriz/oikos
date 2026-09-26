// What a seat knows: everything it has observed, indexed for the resolver.
// The resolver fills gaps and turns names into ids only from this (P8): it
// never looks at the world beyond what the seat has seen.

import type { Observation, Record, StatementRecord } from "@terrarium/seats";

export interface AccountFact {
  account: string;
  holder: string;
  custodian: string;
}

export class Knowledge {
  readonly withdrawn = new Set<string>();
  readonly accounts = new Map<string, AccountFact>(); // accounts the seat can see directly
  readonly stated = new Map<string, Set<string>>(); // entity -> accounts it has stated as its own (invoices' pay_to, reports' account)
  readonly names = new Map<string, string>(); // entity -> name
  readonly seatEntity = new Map<string, string>();
  readonly structures = new Map<string, string>(); // structure -> type
  private readonly formsById = new Map<string, StatementRecord>();
  /** Laws and claims the seat has seen: what law warnings are judged against (§10). */
  readonly laws = new Map<string, StatementRecord>();
  readonly claims: Record[] = [];
  private readonly claimIds = new Set<string>();
  entity = "";
  t = 0;

  absorb(obs: Observation): void {
    this.entity = obs.entity;
    this.t = obs.t;
    for (const ch of Object.values(obs.channels)) {
      if (ch.kind === "accounts") {
        for (const a of ch.accounts) {
          if (a.closed) this.accounts.delete(a.account);
          else this.accounts.set(a.account, { account: a.account, holder: a.holder, custodian: a.custodian });
        }
      } else if (ch.kind === "sites") {
        for (const p of ch.parcels) if (p.structure) this.structures.set(p.structure.structure, p.structure.type);
      } else if (ch.kind === "directory") {
        for (const e of ch.entities) this.names.set(e.entity, e.name);
        for (const s of ch.seats) this.seatEntity.set(s.seat, s.entity);
      } else if (ch.kind === "records") {
        for (const r of ch.records) this.add(r);
      }
    }
  }

  private add(r: Record): void {
    if (r.record === "withdrawal") this.withdrawn.add(r.withdraws);
    if ((r.record === "claim" || r.record === "claim_release" || r.record === "withdrawal") && !this.claimIds.has(r.id)) {
      this.claimIds.add(r.id);
      this.claims.push(r);
    }
    if (r.record === "entity_declaration") this.names.set(r.entity, r.name);
    if (r.record === "statement") {
      if (r.kind === "form") this.formsById.set(r.id, r);
      if (r.kind === "law" && r.formal?.condition) this.laws.set(r.id, r);
      const who = r.speaks_for;
      for (const k of ["pay_to", "account"]) {
        const a = r.data?.[k];
        if (who && typeof a === "string") this.stated.set(who, new Set([...(this.stated.get(who) ?? []), a]));
      }
    }
  }

  /** The entity a seat id or entity id refers to. */
  entityOf(id: string): string {
    return this.seatEntity.get(id) ?? id;
  }

  /** Accounts the seat knows to be held by an entity. */
  accountsOf(entity: string): string[] {
    const own = [...this.accounts.values()].filter((a) => a.holder === entity).map((a) => a.account);
    return [...new Set([...own, ...(this.stated.get(entity) ?? [])])].sort();
  }

  isAccount(id: string): boolean {
    return this.accounts.has(id) || [...this.stated.values()].some((s) => s.has(id));
  }

  /** An entity id for a name the seat wrote, if exactly one matches. */
  byName(name: string): string[] {
    const n = name.trim().toLowerCase();
    return [...this.names].filter(([, v]) => v.toLowerCase() === n).map(([k]) => k).sort();
  }

  name(id: string): string {
    const e = this.entityOf(id);
    const n = this.names.get(e);
    return n && n !== e ? `${n} (${e})` : e;
  }

  /** Forms the seat has seen and that still stand. */
  get forms(): StatementRecord[] {
    return [...this.formsById.values()].filter((f) => !this.withdrawn.has(f.id));
  }

  /** The standing forms published by an institution a seat or entity id names. */
  form(to: string, name: string): StatementRecord | undefined {
    const ent = this.entityOf(to);
    return [...this.formsById.values()]
      .filter((f) => !this.withdrawn.has(f.id) && f.data?.form === name && (f.author === to || f.speaks_for === ent || (f.data?.submit_to ?? []).includes(ent)))
      .sort((a, b) => b.at - a.at)[0];
  }
}
