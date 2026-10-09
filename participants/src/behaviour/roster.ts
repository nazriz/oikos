// An office's own staff, as whoever holds the office knows them (docs/behaviour/office-papers.md, "An office's own staff"): its posts, who
// holds each and since when, and which are vacant. Read from the office's own papers and nothing else (the knowing
// rules' `mine`): the employment agreements its organisation is a party to, in the office's role, and, where the
// posts are what a budget line pays for, the organisation's adopted budget. The code that runs such an office reads
// the same papers the same way (`Staffing`, firms.ts); a person in the office is shown them as a list, because nobody
// in a seat counted agreements to find out it had no staff (2026-10-09: a works manager set two standing work orders
// for a crew of nobody, and watched 301 complaints arrive).

import { cents, moneyNow } from "../money";
import type { Observation } from "../contracts";
import type { BehaviourModule, ParticipantContext } from "../module";
import { Book, DAY } from "./common";
import { Staffing } from "./firms";

const YEAR = 365 * DAY;
type Staffed = ReturnType<NonNullable<BehaviourModule["staffed"]>>;

/** A date as papers write one. */
const dated = (t: number) => `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;

export interface RosterNow {
  /** What one of the staff is called, and several. */
  role: string;
  /** Those in post: who, since when, under which agreement. */
  held: { person: string; since?: number; agreement: string }[];
  /** How many posts the office has, and by what; undefined where nothing on its file says (no budget adopted). */
  posts?: number;
  /** Why that many, in words. */
  by: string;
  /** The office's job advertisement form, if it has one on file. */
  form?: string;
}

/** The roster of one office, kept from what its holder is shown. */
export class Roster {
  private readonly book = new Book();
  private readonly staffing: Staffing;
  constructor(ctx: ParticipantContext, private readonly entity: string, private readonly office: string, private readonly staffed: Staffed) {
    this.staffing = new Staffing(ctx, entity, { period: 14 * DAY, notice_days: 0, role: staffed.role, ...(staffed.own ? { own: staffed.own } : {}), does: { hire: false, pay: false } });
  }

  /** Take in what the office-holder was just shown. */
  absorb(obs: Observation): void {
    this.book.absorb(obs);
  }

  now(t: number): RosterNow {
    const role = this.staffed.role;
    const held = this.staffing.staff(this.book, t).map((a: any) => ({ person: String(a.terms.parties[1]), ...(this.book.signedAt(a.id) !== undefined ? { since: this.book.signedAt(a.id)! } : {}), agreement: String(a.id) }));
    const form = this.book.open("form").find((f) => f.data?.office === this.office && f.data?.form === "job_advertisement")?.id;
    const p = this.staffed.posts;
    if ("establishment" in p) return { role, held, posts: p.establishment, by: "the office's establishment", ...(form ? { form } : {}) };
    const year = Math.floor(t / YEAR) + 1;
    const budget = this.book.open("budget").filter((b) => b.data?.year === year).sort((a, b) => b.at - a.at)[0];
    const annual = p.period > 0 ? Math.floor((p.wage * YEAR) / p.period) : 0;
    if (!budget) return { role, held, by: `no budget adopted for year ${year} is on file, so nothing says how many the ${p.budget_line} line pays for`, ...(form ? { form } : {}) };
    const line = cents(budget.data?.lines?.[p.budget_line] ?? 0);
    return { role, held, posts: annual > 0 ? Math.floor(line / annual) : 0, ...(form ? { form } : {}),
      by: `the ${p.budget_line} line of the budget for year ${year} (${budget.id}), ${moneyNow(line)}, pays for that many at ${moneyNow(annual)} a year each` };
  }

  /** How many are in post now. */
  count(t: number): number {
    return this.staffing.staff(this.book, t).length;
  }

  /** The roster as the office-holder reads it. `called`: a person's name, where they have one. */
  text(t: number, title: string, called: (id: string) => string | undefined = () => undefined): string {
    const r = this.now(t);
    const n = r.held.length;
    const vacant = r.posts === undefined ? undefined : Math.max(0, r.posts - n);
    const who = (id: string) => (called(id) && called(id) !== id ? `${called(id)} (${id})` : id);
    return [
      `## ${title}: Staff of your office`,
      `Posts (${r.role}): ${r.posts === undefined ? `not set (${r.by})` : `${r.posts} (${r.by})`}.`,
      n ? `In post (${n}): ${r.held.map((h) => `${who(h.person)}${h.since !== undefined ? `, since ${dated(h.since)}` : ""}, under ${h.agreement}`).join("; ")}.` : "In post: nobody.",
      ...(vacant !== undefined ? [`Vacant: ${vacant}.${r.posts !== undefined && n > r.posts ? ` (${n - r.posts} more in post than there are posts.)` : ""}`] : []),
      ...(n ? [] : [`There is nobody in post, so the work that is the staff's is done by nobody.${r.form ? ` The office takes on its own staff, beginning with an advertisement on its job advertisement form (${r.form}).` : ""}`]),
    ].join("\n");
  }
}
