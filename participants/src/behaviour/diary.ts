// An office-holder's diary: how long its own work takes the one who holds the office, and what its staff have to give it
// (docs/design/foundations.md, section 4, "Its own time"; docs/behaviour/office-books.md, "The diary").
//
// A person in an office knows how long a letter takes to write and how long a decision does, and how many hours the clerks they
// employ have between them in a week. Without it a seat that decides every case itself cannot tell it is falling behind, and one
// that has staff cannot tell what they could do for it. Everything here is the office's own, and the town's practice as the town
// states it: the time the world's table of work gives a person for each kind of paper (the table itself is never shown), the
// week the staff's employment agreements give them, and what stands open on the office's books. Nothing in it says what to do.

import { durationWords } from "../forms";
import type { Issued } from "../module";
import type { RosterNow } from "./roster";

/** How a person's time in a row of the table of work is read: the row for what is made, else for the block. */
export function personSeconds(times: { [row: string]: number }, block: string, kind?: string): number | undefined {
  return (kind !== undefined ? times[`${block}/${kind}`] : undefined) ?? times[block];
}

export interface DiaryOptions {
  title: string;
  /** What a person's act takes, by the table of work's rows ("message", "publish", "publish/benefit_decision"). */
  times: { [row: string]: number };
  /** The kinds of paper this office writes on its own forms (its module's `issues`), with each form's title. */
  issues: Pick<Issued, "title" | "writes">[];
  /** A person's working day, in seconds, where the world has one. */
  workday?: number;
  /** Its staff, as the roster has them now; none where the office employs nobody. */
  staff?: RosterNow;
}

/**
 * The diary, as the office-holder reads it. `undefined` where there is nothing to say (no table of work, and no staff).
 */
export function diaryText(o: DiaryOptions): string | undefined {
  const lines: string[] = [];
  const word = (s: number) => durationWords(s);
  const own: string[] = [];
  const letter = personSeconds(o.times, "message");
  if (letter) own.push(`a letter ${word(letter)}`);
  const seen = new Set<string>();
  for (const x of o.issues) {
    const s = personSeconds(o.times, "publish", x.writes.kind);
    if (!s || seen.has(x.writes.kind)) continue;
    seen.add(x.writes.kind);
    own.push(`${x.title.charAt(0).toLowerCase()}${x.title.slice(1)} ${word(s)}`);
  }
  const paper = personSeconds(o.times, "publish");
  if (paper) own.push(`any other paper ${word(paper)}`);
  if (own.length) {
    lines.push(`Your own time${o.workday ? `: a working day is ${word(o.workday)} of work, yours and each of your staff's` : ""}. What your own acts take you, one by one: ${own.join("; ")}. What you do yourself comes out of your day, and what is not done in a day waits for the next.`);
  }
  if (o.staff) {
    const n = o.staff.held.length;
    const hours = o.staff.held.reduce((a, h) => a + (h.hours ?? 0), 0);
    lines.push(n
      ? `Your staff's time: ${n} in post (${o.staff.role}), ${hours > 0 ? `${Math.round(hours)} hours a week between them under their agreements` : "their agreements state no hours"}${o.workday ? `, and no more than ${word(o.workday)} of work in a day each` : ""}. What you ask them to do (by a standing work order, or by naming one of them in a request) comes out of their hours, not yours.`
      : `Your staff's time: nobody is in post, so nothing is done by your staff.`);
  }
  return lines.length ? [`## ${o.title}: Your time, and your staff's`, ...lines].join("\n") : undefined;
}
