// Shared helpers for behaviour modules: turning what a participant has seen into
// memory. Records arrive as what's new since the participant last looked, so each module keeps
// its own book of the records relevant to it, as a person would.

import * as C from "../calls";
import type { Observation, Record, ParticipantAction, StatementRecord } from "../contracts";
import { channels } from "../contracts";

export const DAY = 86_400;
export const MONTH = 30 * DAY;

/** Everything a participant has perceived so far, indexed. */
export class Book {
  readonly records = new Map<string, Record>();
  readonly withdrawn = new Set<string>();
  readonly signatures = new Map<string, Set<string>>(); // agreement -> parties who signed
  readonly notices = new Map<string, { as: string; at: number }[]>(); // agreement -> notices
  readonly signedTimes = new Map<string, number[]>(); // agreement -> signature times
  private readonly byKind = new Map<string, StatementRecord[]>(); // statement kind -> statements, in the order seen
  /** participant -> the person it acts as (from a directory). */
  readonly participantPerson = new Map<string, string>();
  /** position -> its organisation, role and holder (from a directory). */
  readonly positions = new Map<string, { entity: string; role?: string; holder?: string }>();
  readonly entityKind = new Map<string, string>();
  private lastDirectory: unknown; // the directory lists last read (the view hands back the same lists until they change)

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
        this.signedTimes.set(r.agreement, [...(this.signedTimes.get(r.agreement) ?? []), r.at]);
      }
      if (r.record === "statement") {
        const list = this.byKind.get(r.kind);
        if (list) list.push(r);
        else this.byKind.set(r.kind, [r]);
      }
      if (r.record === "notice") this.notices.set(r.agreement, [...(this.notices.get(r.agreement) ?? []), { as: r.as, at: r.at }]);
    }
    const dir = channels.directory(obs);
    if (dir && dir.positions !== this.lastDirectory) {
      this.lastDirectory = dir.positions;
      for (const p of dir.positions) this.positions.set(p.position, { entity: p.entity, role: p.role, holder: p.holder });
      for (const e of dir.entities) {
        this.entityKind.set(e.entity, e.kind);
        if (e.participant) this.participantPerson.set(e.participant, e.entity);
      }
    }
    return fresh;
  }

  /** Every statement of a kind seen, withdrawn or not, in the order seen. */
  all(kind: string): StatementRecord[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Statements of a kind that are still standing (not withdrawn). */
  open(kind: string): StatementRecord[] {
    return (this.byKind.get(kind) ?? []).filter((r) => !this.withdrawn.has(r.id));
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
    return Math.max(...(this.signedTimes.get(agreement) ?? []));
  }

  /** The entity a record was made for: the organisation of the position it was made in, or its author's person. */
  authorEntity(r: Record): string | undefined {
    if (r.author === "genesis") return r.speaks_for;
    if (r.in_position) return this.positions.get(r.in_position)?.entity;
    return this.participantPerson.get(r.author);
  }

  entitiesOfKind(kind: string): string[] {
    return [...this.entityKind].filter(([, k]) => k === kind).map(([e]) => e).sort();
  }
}

/** Signatures on a petition this participant can see: votes with choice "sign", one per signing entity (the organiser sees them all). */
export function petitionSignatures(book: Book, petition: string): number {
  const who = new Set<string>();
  for (const r of book.records.values()) if (r.record === "vote" && r.ballot === petition && r.choice === "sign" && r.speaks_for) who.add(r.speaks_for);
  return who.size;
}

/** A petition's signature count as its organiser last published it (0 if never), organiser included. */
export function publishedCount(book: Book, petition: StatementRecord): number {
  const counts = book.open("petition_count").filter((c) => c.data?.petition === petition.id && c.speaks_for === petition.speaks_for);
  return counts.length ? (counts.at(-1)!.data.signatures as number) : 0;
}

/** Its own account (held by the entity it acts for). */
export function ownAccount(obs: Observation): { account: string; balance: number; custodian: string } | undefined {
  return channels.accounts(obs).find((a) => a.holder === obs.entity);
}

// ------------------------------------------------------------------ acting through calls
//
// Code participants act the way every participant does (D36, P14): they say
// what they want brought about, as calls, and the resolver turns each into
// their own acts. Paying someone is money(...): the resolver asks the account's bank.

/**
 * One atomic act: lines of calls, optionally binding a name (whose id comes back in the outcome's `created`), and
 * optionally why: the rule that fired, in plain words, which goes into the log with the act (its `reasoning`).
 */
export type Step = (C.Call | [string, C.Call])[] & { why?: string };

/** A step with its reason: `because("Rent is due", pay(...))`. */
export const because = (why: string, ...lines: (C.Call | [string, C.Call])[]): Step => Object.assign(lines, { why });

export const callAction = (step: Step): ParticipantAction => ({ type: "call", call: C.program(...step), ...(step.why ? { reasoning: step.why } : {}) });

/** Dollars, for reasons: 123456 -> "$1,234.56". */
export const usd = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** Money to an account: a one-off or repeating payment. */
export function pay(to: string, amount: number, o: { from?: string; for?: string; settles?: string; every?: number; first?: number; basis?: string; per_request?: string } = {}): C.Call {
  return C.call("money", {
    to, amount: C.dollars(amount), from: o.from, for: o.for ? C.text(o.for) : undefined, settles: o.settles,
    every: o.every ? C.secs(o.every) : undefined, first: o.first !== undefined ? C.secs(o.first) : undefined, basis: o.basis, per_request: o.per_request,
  });
}

/** A published statement: kind, text, and optional addressees, data, visibility and basis. */
export function say(kind: string, text: string, o: { to?: string[]; data?: unknown; visible?: "public" | string[]; basis?: string; for?: string; adico?: unknown; formal?: string; on?: string } = {}): C.Call {
  return C.call("statement", {
    kind, text: C.text(text), to: o.to ? C.json(o.to) : undefined, data: o.data !== undefined ? C.json(o.data) : undefined,
    adico: o.adico !== undefined ? C.json(o.adico) : undefined, formal: o.formal ? C.text(o.formal) : undefined,
    visible: o.visible === undefined ? undefined : o.visible === "public" ? "public" : C.json(o.visible), basis: o.basis, for: o.for, on: o.on,
  });
}

export const withdraw = (record: string, text?: string): C.Call => C.call("statement", { withdraw: record, text: text ? C.text(text) : undefined });
export const sign = (agreement: string): C.Call => C.call("agreement", { sign: agreement });
export const notice = (agreement: string, text: string): C.Call => C.call("agreement", { notice: agreement, text: C.text(text) });
export const message = (to: string[], text: string, re?: string): C.Call => C.call("message", { to: C.json(to), text: C.text(text), re });
/** Go into a space (a home, a workplace floor). */
export const moveIn = (space: string): C.Call => C.call("occupancy", { in: space });
/** Come out of a space, or a whole building. */
export const moveOut = (from: string, who: string): C.Call => C.call("occupancy", { in: from, who, leave: "yes" });
export const vote = (ballot: string, choice: string, visible?: "public"): C.Call => C.call("vote", { ballot, choice, visible });
export const record = (position: "right" | "liberty", holder: string, about: unknown, o: { against?: string; basis?: string } = {}): C.Call =>
  C.call("claim", { position, holder, about: C.json(about), against: o.against, basis: o.basis });

/** Offer an agreement (signed on our side). `we` and `they` are the outcomes each side commits to. */
export function offer(withWhom: string, o: { template: string; we?: C.Call; they?: C.Call; term?: number; ourNotice?: number; theirNotice?: number; text?: string; basis?: string }): C.Call {
  return C.call("agreement", {
    with: withWhom, template: o.template, we_do: o.we, they_do: o.they, term: o.term ? C.secs(o.term) : undefined,
    our_notice: o.ourNotice ? C.secs(o.ourNotice) : undefined, their_notice: o.theirNotice ? C.secs(o.theirNotice) : undefined,
    terms: o.text ? C.text(o.text) : undefined, basis: o.basis,
  });
}

// ------------------------------------------------------------------ reading agreements (the standard encoding, §9.2)

export type Outcome = { money?: { from?: string; to: string; amount: number; for?: string }; occupancy?: { who: string; in: string; leave?: boolean }; structure?: { type?: string; on?: string; remove?: string } };

/** The structure a space is in (`apts-3/dwelling.2` -> `apts-3`). */
export const structureOf = (space: string) => space.split("/")[0]!;

/** What a party commits to bring about in an agreement, and how often. */
export function commitmentOf(a: Record | undefined, who: string): { outcome?: Outcome; every?: number } {
  if (a?.record !== "agreement") return {};
  const c = a.terms.commitments.find((x) => x.who === who);
  return { outcome: c?.does?.outcome, every: c?.every };
}

/** A lease's rent (paid by the tenant, into which account) and home: the space given by the other party, and its building. */
export function leaseTerms(a: Record | undefined, tenant: string): { rent: number; rentTo?: string; space?: string; structure?: string } {
  if (a?.record !== "agreement") return { rent: 0 };
  const other = a.terms.parties.find((x) => x !== tenant)!;
  const pays = commitmentOf(a, tenant).outcome?.money;
  const space = commitmentOf(a, other).outcome?.occupancy?.in;
  return { rent: pays?.amount ?? 0, rentTo: pays?.to, space, structure: space ? structureOf(space) : undefined };
}

/** A job's wage and pay period (from the employer) and workplace (the space the worker commits to be in). */
export function jobTerms(a: Record | undefined, worker: string): { wage: number; period: number; workplace?: string } {
  if (a?.record !== "agreement") return { wage: 0, period: 14 * DAY };
  const employer = a.terms.parties.find((x) => x !== worker)!;
  const pays = commitmentOf(a, employer);
  return { wage: pays.outcome?.money?.amount ?? 0, period: pays.every ?? 14 * DAY, workplace: commitmentOf(a, worker).outcome?.occupancy?.in };
}

export const between = (lo: number, hi: number, u: number) => lo + Math.floor(u * (hi - lo + 1));

// ------------------------------------------------------------------ land: lots are registry records over cells

/** The cells a lot covers, from its registry record (a statement of kind "lot"). */
export function cellsOf(book: Book, lot: string): string[] {
  const r = book.records.get(lot);
  return r?.record === "statement" && r.kind === "lot" && !book.withdrawn.has(lot) ? ((r.data?.cells as string[]) ?? []) : [];
}

/** The standing lot a cell is in, if the registry has one. */
export function lotOf(book: Book, cell: string): string | undefined {
  return book.open("lot").find((l) => (l.data?.cells as string[] | undefined)?.includes(cell))?.id;
}
