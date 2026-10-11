// Entities' own records, rebuilt from a log (docs/design/ai-citizens.md 10d): the kernel holds each record and chains a
// hash of its changes; this folds the changes back into the record and checks every link against what the kernel
// logged. Reads the log only: nothing here is the world's.

import { canonical, hashWithDomain } from "@oikos/participants";
import { logLines } from "./logs";

export const DOMAIN_ENTITY_RECORD = "oikos.entity_record.v1\n";

/** One change to a record, as the log has it: the command (when, by whom, what was set, why) and the kernel's event
 * (whose record, its count, the chain and the digest of the record after it). */
export interface RecordChangeEntry { seq: number; t: number; participant: string; entity: string; n: number; set: { [section: string]: unknown }; because?: unknown[]; chain: string; digest: string }

/** A record as rebuilt, and whether every link held. */
export interface Rebuilt { entity: string; participant: string; n: number; at: number; chain: string; sections: { [section: string]: unknown }; bytes: number; faults: string[] }

/** The link a change makes over the chain before it, and the digest of the sections after it: as the kernel computes them. */
export const linkOf = (prev: string, t: number, set: unknown, because: unknown) => hashWithDomain(DOMAIN_ENTITY_RECORD, prev + canonical({ t, set, because: because ?? null }));
export const digestOf = (sections: unknown) => hashWithDomain(DOMAIN_ENTITY_RECORD, canonical(sections));

/** Folds changes into records, checking each against the kernel's own hashes. */
export class Records {
  readonly of = new Map<string, Rebuilt>();
  /** A change, applied: the record after it. A fault is noted on the record, never thrown: a reader wants them all. */
  apply(c: RecordChangeEntry): Rebuilt {
    let r = this.of.get(c.entity);
    if (!r) this.of.set(c.entity, (r = { entity: c.entity, participant: c.participant, n: 0, at: 0, chain: "", sections: {}, bytes: 0, faults: [] }));
    const chain = linkOf(r.chain, c.t, c.set, c.because);
    Object.assign(r.sections, c.set);
    r.n += 1;
    r.at = c.t;
    r.chain = chain;
    const text = canonical(r.sections);
    r.bytes = text.length;
    if (r.n !== c.n) r.faults.push(`seq ${c.seq}: change ${r.n} of the log is the kernel's ${c.n}`);
    if (chain !== c.chain) r.faults.push(`seq ${c.seq}: the chain does not follow (rebuilt ${chain.slice(0, 12)}, logged ${c.chain.slice(0, 12)})`);
    if (hashWithDomain(DOMAIN_ENTITY_RECORD, text) !== c.digest) r.faults.push(`seq ${c.seq}: the record rebuilt is not the record the kernel held`);
    return r;
  }
}

/** Every change to a record in a log, in order (each command joined to the event it caused). `only`: one entity or
 * participant; `until`: no later than this time. */
export async function* recordChanges(log: string, o: { only?: string; until?: number } = {}): AsyncGenerator<RecordChangeEntry> {
  let pending: { seq: number; t: number; participant: string; set: any; because?: unknown[] } | undefined;
  for await (const line of logLines(log)) {
    if (!line || !line.includes("entity_record")) continue;
    const e = JSON.parse(line);
    if (o.until !== undefined && e.t > o.until) break;
    if (e.kind === "command" && e.body?.command === "entity_record") pending = { seq: e.seq, t: e.t, participant: e.body.participant, set: e.body.set, ...(e.body.because ? { because: e.body.because } : {}) };
    else if (e.kind === "event" && e.body?.event === "entity_recorded" && pending && e.body.cause === pending.seq) {
      const c: RecordChangeEntry = { ...pending, entity: e.body.entity, n: e.body.n, chain: e.body.chain, digest: e.body.digest };
      pending = undefined;
      if (!o.only || o.only === c.entity || o.only === c.participant) yield c;
    }
  }
}

/** One entity's record, rebuilt from a log and checked (`oikos record`). Undefined: the log has no record of it. */
export async function rebuild(log: string, who: string, until?: number): Promise<(Rebuilt & { largest: number }) | undefined> {
  const rs = new Records();
  let out: Rebuilt | undefined;
  let largest = 0;
  for await (const c of recordChanges(log, { only: who, ...(until !== undefined ? { until } : {}) })) {
    out = rs.apply(c);
    largest = Math.max(largest, out.bytes);
  }
  return out ? { ...out, largest } : undefined;
}

/**
 * What a log can show of a person over a period, recorded and never scored (docs/design/ai-citizens.md 10h): their
 * sense of agency, what they think and what they say of each who holds power over them (and the gap), their trust in
 * each institution, and where their hours went. One row each time a record's hours are written (a week for an
 * adult, a month for a child), from the record as it then stood.
 */
export function periodRow(r: Rebuilt, t: number): { [k: string]: unknown } | undefined {
  const s = r.sections as any;
  if (!s.hours) return undefined;
  return {
    t, participant: r.participant, entity: r.entity, from: s.hours.from, to: s.hours.to, hours: s.hours.seconds ?? {},
    ...(s.agency ? { agency: s.agency.now, agency_own: s.agency.own } : {}),
    views: ((s.views ?? []) as any[]).map((v) => ({ of: v.of, thought: v.private, said: v.expressed, gap: v.expressed - v.private })),
    trust: Object.fromEntries(((s.trust?.in ?? []) as any[]).map((x) => [x.in, x.bps])),
    trust_kinds: Object.fromEntries(((s.trust?.in ?? []) as any[]).map((x) => [x.in, x.kind])),
    ...(s.needs ? { needs: s.needs } : {}),
  };
}
