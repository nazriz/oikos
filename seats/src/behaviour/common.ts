// Shared helpers for behaviour modules: turning what a seat has seen into
// memory. Records arrive through `new_only` channels, so each module keeps
// its own book of the records relevant to it, as a person would.

import type { Block, Observation, Record, StatementRecord } from "../contracts";
import { channels } from "../contracts";

export const DAY = 86_400;
export const MONTH = 30 * DAY;

/** Everything a seat has perceived so far, indexed. */
export class Book {
  readonly records = new Map<string, Record>();
  readonly withdrawn = new Set<string>();
  readonly signatures = new Map<string, Set<string>>(); // agreement -> parties who signed
  readonly notices = new Map<string, { as: string; at: number }[]>(); // agreement -> notices
  readonly seatEntity = new Map<string, string>();
  readonly entityKind = new Map<string, string>();

  absorb(obs: Observation): Record[] {
    const fresh: Record[] = [];
    for (const r of channels.records(obs)) {
      if (this.records.has(r.id)) continue;
      this.records.set(r.id, r);
      fresh.push(r);
      if (r.record === "withdrawal") this.withdrawn.add(r.withdraws);
      if (r.record === "signature") {
        const s = this.signatures.get(r.agreement) ?? new Set();
        s.add(r.as);
        this.signatures.set(r.agreement, s);
      }
      if (r.record === "notice") this.notices.set(r.agreement, [...(this.notices.get(r.agreement) ?? []), { as: r.as, at: r.at }]);
    }
    const dir = channels.directory(obs);
    if (dir) {
      for (const s of dir.seats) this.seatEntity.set(s.seat, s.entity);
      for (const e of dir.entities) this.entityKind.set(e.entity, e.kind);
    }
    return fresh;
  }

  /** Statements of a kind that are still standing (not withdrawn). */
  open(kind: string): StatementRecord[] {
    return [...this.records.values()].filter((r): r is StatementRecord => r.record === "statement" && r.kind === kind && !this.withdrawn.has(r.id));
  }

  signedBy(agreement: string, party: string): boolean {
    return this.signatures.get(agreement)?.has(party) ?? false;
  }

  /** Signed by every party. */
  inForce(agreement: string): boolean {
    const a = this.records.get(agreement);
    return a?.record === "agreement" && a.terms.parties.every((p) => this.signedBy(agreement, p));
  }

  /** The time the last party signed, if all have. */
  signedAt(agreement: string): number | undefined {
    if (!this.inForce(agreement)) return undefined;
    const times = [...this.records.values()].flatMap((r) => (r.record === "signature" && r.agreement === agreement ? [r.at] : []));
    return Math.max(...times);
  }

  entitiesOfKind(kind: string): string[] {
    return [...this.entityKind].filter(([, k]) => k === kind).map(([e]) => e).sort();
  }
}

/** The seat's own account (held by its entity). */
export function ownAccount(obs: Observation): { account: string; balance: number; custodian: string } | undefined {
  return channels.accounts(obs).find((a) => a.holder === obs.entity);
}

/** Ask one's bank to pay (a one-off instruction). */
export function payInstruction(me: string, bank: string, from: string, to: string, amount: number, text: string, extra: object = {}): Block {
  return { block: "publish", kind: "instruction", speaks_for: me, addressed_to: [bank], visible_to: [me, bank], text, data: { pay: amount, from, to, ...extra } };
}

/** Ask one's bank to pay repeatedly. */
export function standingOrder(me: string, bank: string, from: string, to: string, amount: number, every: number, first: number, basis: string, text: string): Block {
  return { block: "publish", kind: "instruction", speaks_for: me, addressed_to: [bank], visible_to: [me, bank], basis, text, data: { pay: amount, from, to, every, first } };
}

export const between = (lo: number, hi: number, u: number) => lo + Math.floor(u * (hi - lo + 1));
