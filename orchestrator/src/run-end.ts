// What a run reads of its own log when it ends (the kernel has written all of it out by then: its `flush`): what each
// model seat did, for its debrief (debrief-summary.ts), and each person's own record as it stands, for the exit
// accounts of a sample of them (participants/src/llm/account.ts). One pass, a line at a time; only the lines that
// could matter are parsed. The same reading is used afterwards by whatever sets a debrief beside its record
// (debriefs.ts): the summary a seat was shown can always be made again from the log.

import { logLines } from "./logs";
import { SeatRecords } from "./debrief-summary";

export interface PersonAtEnd { participant: string; entity: string; n: number; sections: { [section: string]: any } }

/** Each person's own record as it stands, from log entries one after another (a record set, then the event it made):
 * what `readForEnd` reads of a log, and what a fork of an experiment keeps from its base and reads on (fork-composer.ts). */
export class PeopleAtEndReader {
  readonly people = new Map<string, PersonAtEnd>();
  private pending: { seq: number; participant: string; set: any; person: boolean } | undefined;
  constructor(saved?: PersonAtEnd[]) { for (const p of saved ?? []) this.people.set(p.entity, p); }
  /** Whether the entry was one of a record's (taken in). */
  see(e: any): boolean {
    const b = e?.body ?? {};
    if (e?.kind === "command" && b.command === "entity_record") { this.pending = { seq: e.seq, participant: b.participant, set: b.set, person: b.entity === undefined }; return true; }
    if (e?.kind === "event" && b.event === "entity_recorded" && this.pending && b.cause === this.pending.seq) {
      if (this.pending.person) {
        let p = this.people.get(b.entity);
        if (!p) this.people.set(b.entity, (p = { participant: this.pending.participant, entity: b.entity, n: 0, sections: {} }));
        Object.assign(p.sections, this.pending.set);
        p.n = b.n;
      }
      this.pending = undefined;
      return true;
    }
    return false;
  }
  save(): PersonAtEnd[] { return [...this.people.values()]; }
}

export async function readForEnd(logPath: string, seats: { id: string; known: string[]; direct?: string[] }[], nameOf: ((participant: string, as?: string) => string[]) | undefined, wantPeople: boolean): Promise<{ seats: SeatRecords; people: Map<string, PersonAtEnd>; founded: Map<string, string> }> {
  const records = new SeatRecords(seats, nameOf);
  const ids = seats.map((s) => s.id);
  const reader = new PeopleAtEndReader();
  /** Bodies created during the run, by the name they were given (the founder's words, or the plain code name): the config does not hold them. */
  const founded = new Map<string, string>();
  for await (const line of logLines(logPath)) {
    if (!line) continue;
    const rec = wantPeople && line.includes("entity_record");
    const made = wantPeople && line.includes('"entity_created"');
    if (!rec && !made && !(ids.length && SeatRecords.wants(line, ids))) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; } // (a last line cut off as a process ended)
    const b = e.body ?? {};
    if (made && e.kind === "event" && b.event === "entity_created" && b.entity && typeof b.name === "string" && b.name && b.name !== b.entity) { founded.set(b.entity, b.name); }
    if (rec && reader.see(e)) continue;
    if (ids.length) records.add(e);
  }
  return { seats: records, people: reader.people, founded };
}
