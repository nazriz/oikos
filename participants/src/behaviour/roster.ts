// An office's own staff, as whoever holds the office knows them (docs/behaviour/office-papers.md, "An office's own staff"): its posts, who
// holds each and since when, and which are vacant. Read from the office's own papers and nothing else (the knowing
// rules' `mine`): the employment agreements its organisation is a party to, in the office's role, and, where the
// posts are what a budget line pays for, the organisation's adopted budget. The code that runs such an office reads
// the same papers the same way (`Staffing`, firms.ts); a person in the office is shown them as a list, because nobody
// in a seat counted agreements to find out it had no staff (2026-10-09: a works manager set two standing work orders
// for a crew of nobody, and watched 301 complaints arrive).

import { cents, moneyNow } from "../money";
import type { Observation, StatementRecord } from "../contracts";
import type { BehaviourModule, ParticipantContext } from "../module";
import { Book, DAY } from "./common";
import { hoursLaw, ordinaryHours, Staffing } from "./firms";

const YEAR = 365 * DAY;
type Staffed = ReturnType<NonNullable<BehaviourModule["staffed"]>>;

/** A date as papers write one. */
const dated = (t: number) => `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;

export interface RosterNow {
  /** What one of the staff is called, and several. */
  role: string;
  /** Those in post: who, since when, under which agreement. */
  held: { person: string; since?: number; agreement: string; /** Their ordinary week, in hours, as their agreement has it (or the law's ordinary week). */ hours?: number }[];
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
  /** `routines`: the tasks the office's staff have as routines (its module's), where it has any. */
  constructor(ctx: ParticipantContext, private readonly entity: string, private readonly office: string, private readonly staffed: Staffed, private readonly routines: string[] = []) {
    this.staffing = new Staffing(ctx, entity, { period: 14 * DAY, notice_days: 0, role: staffed.role, ...(staffed.own ? { own: staffed.own } : {}), does: { hire: false, pay: false } });
  }

  /** Take in what the office-holder was just shown. */
  absorb(obs: Observation): void {
    this.book.absorb(obs);
  }

  now(t: number): RosterNow {
    const role = this.staffed.role;
    const law = hoursLaw(this.book);
    const held = this.staffing.staff(this.book, t).map((a: any) => {
      const hours = ordinaryHours(a, String(a.terms.parties[1]), law);
      return { person: String(a.terms.parties[1]), ...(this.book.signedAt(a.id) !== undefined ? { since: this.book.signedAt(a.id)! } : {}), agreement: String(a.id), ...(hours > 0 ? { hours } : {}) };
    });
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

  /** The staff's latest report to this office (docs/behaviour/standing-work.md, "The staff's report"), if they have made one. */
  private report(): StatementRecord | undefined {
    return this.book.all("staff_report").filter((r) => r.speaks_for === this.entity && r.data?.office === this.office).reduce<StatementRecord | undefined>((a, b) => (!a || b.at >= a.at ? b : a), undefined);
  }

  /**
   * The office's standing work orders that stand, each with how it stands: as the staff last reported it; or, with
   * nobody in post, that nobody carries it out; or that the staff have not reported on it yet. From the office's own
   * papers: the orders on its file and its staff's reports.
   */
  orders(t: number): { order: string; task: string; every: number; schedule?: string; says: string }[] {
    const tasks = this.routines;
    const mine = this.book.standingOf("work_order").filter((r) => r.speaks_for === this.entity && (r.in_position === this.office || (tasks.includes(String(r.data?.work?.task)) && (r.in_position === undefined || r.in_position === this.office)))).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const report = this.report();
    const told = new Map<string, string>(((report?.data?.orders ?? []) as { order: string; says: string }[]).map((x) => [x.order, x.says]));
    const n = this.count(t);
    return mine.map((r) => ({ order: r.id, task: String(r.data?.work?.task), every: Number(r.data?.every) || 0, ...(typeof r.data?.schedule === "string" ? { schedule: r.data.schedule as string } : {}),
      says: !n ? `carried out by nobody: there is nobody in post` : told.get(r.id) ?? (report && r.at <= report.at ? "not in your staff's last report" : "your staff have not reported on it yet (they report when the day's work is next set out)") }));
  }

  /** The roster as the office-holder reads it. `called`: a person's name, where they have one. */
  text(t: number, title: string, called: (id: string) => string | undefined = () => undefined): string {
    const r = this.now(t);
    const n = r.held.length;
    const vacant = r.posts === undefined ? undefined : Math.max(0, r.posts - n);
    const who = (id: string) => (called(id) && called(id) !== id ? `${called(id)} (${id})` : id);
    // What each last did and when, as the staff last reported it (someone taken on since is not in it yet).
    const report = this.report();
    const last = new Map<string, { last?: number; task?: string; no_place?: boolean }>(((report?.data?.staff ?? []) as { person: string; last?: number; task?: string; no_place?: boolean }[]).map((x) => [x.person, x]));
    const did = (person: string) => {
      const x = last.get(person);
      if (!x) return "";
      return x.last !== undefined ? `, last at work ${dated(x.last)} (${x.task})` : `, has not come in to work${x.no_place ? ": no place of work in the employment agreement or in an advertisement it cites" : ""}`;
    };
    const orders = this.orders(t);
    return [
      `## ${title}: Staff of your office`,
      `Posts (${r.role}): ${r.posts === undefined ? `not set (${r.by})` : `${r.posts} (${r.by})`}.`,
      n ? `In post (${n}): ${r.held.map((h) => `${who(h.person)}${h.since !== undefined ? `, since ${dated(h.since)}` : ""}, under ${h.agreement}${h.hours ? `, ${h.hours} hours a week` : ""}${did(h.person)}`).join("; ")}.` : "In post: nobody.",
      ...(vacant !== undefined ? [`Vacant: ${vacant}.${r.posts !== undefined && n > r.posts ? ` (${n - r.posts} more in post than there are posts.)` : ""}`] : []),
      ...(n ? [] : [`There is nobody in post, so the work that is the staff's is done by nobody.${r.form ? ` The office takes on its own staff, beginning with an advertisement on its job advertisement form (${r.form}).` : ""}`]),
      ...(orders.length ? [`Your standing work orders${report && n ? `, as your staff reported on ${dated(report.at)} (${report.id})` : ""}:`, ...orders.map((o) => `- ${o.order}, ${o.task} ${o.schedule ? `as ${o.schedule} sets` : `every ${Math.round(o.every / DAY) || "?"} day${Math.round(o.every / DAY) === 1 ? "" : "s"}`}: ${o.says}.`)] : []),
    ].join("\n");
  }
}
