import { Org } from "../shared/orgwants";
import { cents, moneyNow } from "../money";
import * as C from "../calls";
import { dateWords, durationWords } from "../forms";
import type { Observation, Offer, StatementRecord } from "../contracts";
import { basesOf, channels } from "../contracts";
import { type Belief, type ParticipantContext, type Taken } from "../module";
import { dayPayPeriod, incomeTaxLaw, withheld, type Charge } from "../shared/tax";
import { nextReturn, returnsOf, type ReturnRule } from "../shared/returns";
import { message } from "../shared/common";
import { slip } from "../slip";
import { KIND as DECISION } from "../shared/decisions";
import { swayed } from "../shared/wants";
import { advertisedJob, because, Book, firstDue, PAYEE_DIED, PAYMENT_FAILED, usd, commitmentOf, DAY, jobTerms, MONTH, notice, offer, pay, say, structureOf, withdraw, type Step } from "../shared/common";


/**
 * The staffing direction an office that hires takes (docs/behaviour/directions.md): whether it recruits, and the most
 * posts it fills. `office` and `staff` are the form's words for whose it is and whom it hires.
 */
export function staffingForm(form: string, office: string, staff: string): Taken {
  return {
    form, title: `Staffing direction to ${office}`,
    fields: {
      recruit: { type: "choice", options: ["yes", "no"], required: true, description: `Whether ${office} recruits: yes, it advertises and fills the posts it is short of; no, it advertises none and takes nobody on.` },
      posts: { type: "count", description: `The most ${staff} it is to have, where that is fewer than its budget pays for. Left out: as many as the budget pays for.` },
    },
    follows: `While a direction with recruit no stands, ${office} advertises no post, takes down the advertisements it has out and offers nobody employment. With recruit yes it recruits up to what its budget pays for, or up to posts where that is fewer. Nobody is stood down by it and nobody's pay changes.`,
  };
}

/** A staffing direction as it bears on hiring (none standing: recruit as the office would). */
export function staffingUnder(d: StatementRecord | undefined): { recruit: boolean; posts?: number } {
  const posts = d?.data?.posts;
  return { recruit: d?.data?.recruit !== "no", ...(Number.isSafeInteger(posts) && posts > 0 ? { posts: posts as number } : {}) };
}

/**
 * A firm's staff (shared by firm.employer and firm.producer): hiring through job postings and offers, wages by
 * standing order through the firm's bank, notice, and a worker's death. What headcount and wage to aim for is the
 * module's own rule; this is how any employer carries it out.
 */
type Withheld = { total: number; parts: { charge: Charge; amount: number }[] };
const NOTHING_WITHHELD: Withheld = { total: 0, parts: [] };

/** Work by the day (docs/behaviour/firms.md, "Work by the day"): an employment agreement whose pay is a day's. The hand
 * is paid for each day worked, by a payment that day and no standing order, and either side ends it without notice. */
export const byTheDay = (a: any): boolean => a?.record === "agreement" && a.terms?.template === "employment" && a.terms.commitments?.some((c: any) => c.who === a.terms.parties[0] && c.every === DAY && c.does?.outcome?.money);
/** The notice such an agreement gives: none (the least a term can say). */
export const NO_NOTICE = 1;

/**
 * The law on ending a job for redundancy, as its lawmaker published it (docs/behaviour/firms.md, "Adjusting labour"):
 * the least notice and the redundancy pay an employer owes, each by length of service, in days of pay (a week is seven); and the size
 * of employer below which no redundancy pay is owed, where the law has one. A record an employer reads; nothing here
 * holds any place's figures, and a world with no such law owes what its agreements say and nothing more.
 */
export interface TerminationLaw { id: string; notice: { from_years: number; days: number }[]; redundancy_pay: { from_years: number; days: number }[]; small_employer_under?: number }
export function terminationLaw(book: Book): TerminationLaw | undefined {
  const l = book.open("law").filter((r) => r.data?.employment === "termination").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
  if (!l) return undefined;
  const steps = (x: unknown) => (Array.isArray(x) ? x.filter((b) => Number.isFinite(b?.from_years) && Number.isFinite(b?.days)).map((b) => ({ from_years: Number(b.from_years), days: Number(b.days) })).sort((a, b) => a.from_years - b.from_years) : []);
  const under = Number(l.data?.small_employer_under);
  return { id: l.id, notice: steps(l.data?.notice), redundancy_pay: steps(l.data?.redundancy_pay), ...(under > 0 ? { small_employer_under: under } : {}) };
}
/**
 * The law on cutting an employee's hours in place of ending the job (docs/behaviour/firms.md, "Hours before heads"),
 * as its lawmaker published it: whether an employer may reduce hours for want of work (`may_cut`: "notice" by giving
 * notice, "consent" with the employee's agreement, "no" not at all), the ordinary week, the notice, the least hours it
 * may cut to (a share of the ordinary), the longest spell, and the pay owed for the hours not worked (a share of the
 * pay for them, from an employer of that many staff). A record an employer and a worker read; nothing here holds
 * any place's figures, and a world with no such law has firms that do not cut hours.
 */
export interface HoursLaw { id: string; may_cut: "notice" | "consent" | "no"; ordinary_week_hours: number; notice_days: number; floor_bps: number; max_days: number; pay_bps: number; pay_owed_from: number; consent_bps: number }
export function hoursLaw(book: Book): HoursLaw | undefined {
  const l = book.open("law").filter((r) => r.data?.employment === "hours").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0];
  if (!l) return undefined;
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : d);
  const may = l.data?.may_cut === "notice" || l.data?.may_cut === "consent" ? (l.data.may_cut as "notice" | "consent") : "no";
  return { id: l.id, may_cut: may, ordinary_week_hours: n(l.data?.ordinary_week_hours, 40), notice_days: n(l.data?.notice_days, 0), floor_bps: Math.min(10_000, n(l.data?.floor_bps, 0)), max_days: n(l.data?.max_days, 0),
    pay_bps: Math.min(10_000, n(l.data?.pay_bps, 0)), pay_owed_from: n(l.data?.pay_owed_from, 0), consent_bps: Math.min(10_000, n(l.data?.consent_bps, 10_000)) };
}
/** A cut of someone's hours that we have made (`set`) or put to them for their agreement (`proposed`). */
interface Cut { agreement: string; worker: string; full: number; hoursBps: number; paidBps: number; wage: number; from: number; until: number; since: number; state: "proposed" | "set"; replyBy: number }
/** The days a paper to the staff goes ahead of the pay it changes, where the law gives none (ours: it must reach them before the first pay it changes). */
export const HOURS_GRACE_DAYS = 3;
/** The ordinary week of a job in hours: its agreement's hours term, else the law's ordinary week. */
export const ordinaryHours = (a: any, worker: string, law: HoursLaw | undefined): number => { const h = jobTerms(a, worker).hours; return h ? h / 3600 : law?.ordinary_week_hours ?? 0; };
/** The pay a cut leaves, in 10,000ths of the ordinary pay: the hours worked at full pay, and the hours cut at the share the law owes for them. */
export const paidShare = (hoursBps: number, payBps: number): number => hoursBps + Math.floor(((10_000 - hoursBps) * payBps) / 10_000);

/** A schedule by service (days of pay), read at a length of service as weeks of pay (the last step at or below it; before the first: nothing). */
export const weeksAt = (steps: { from_years: number; days: number }[], years: number): number => steps.reduce((x, b) => (years >= b.from_years ? b.days : x), 0) / 7;

/** How a hiring office's letter to the payroll office begins (an office's note: `officeNote`). */
export const PAYROLL_NOTE = "Payroll notice from the hiring office, ";

/** How long before a pay run a change of pay is left to the run after (payroll's cut-off: longer than any act takes). */
const PAY_CUTOFF = 2 * DAY;

export class Staffing {
  private readonly orders = new Map<string, string>(); // agreement -> wage standing order
  private readonly pendingOrder = new Map<string, string>(); // step marker -> agreement
  private readonly replacing = new Map<string, number>(); // agreement -> when we replaced its wage order (until the replacement is on the book, or a couple of days pass)
  private readonly handled = new Set<string>();
  readonly noticed = new Map<string, number>(); // agreement -> when we gave notice
  /** Whom our bank has told us has died: someone a standing order of ours pays (docs/behaviour/deaths.md). */
  private readonly bankSaysDead = new Set<string>();
  private n = 0; // unique names for standing orders we create
  // What the tax law's charges take from wages (docs/behaviour/public-finance.md): what each wage order withholds a pay,
  // charge by charge; what we've withheld under each charge and not yet paid over; and when we next pay it over.
  private readonly withholds = new Map<string, Withheld>(); // wage standing order -> withheld each pay
  private readonly pendingWithhold = new Map<string, Withheld>(); // step marker -> withheld each pay
  private readonly owed = new Map<string, { charge: Charge; law: string; amount: number }>(); // charge -> withheld, not yet paid over
  private readonly paidSince = new Map<string, Map<string, number>>(); // return -> agreement -> gross wages paid since our last report under it
  private readonly returnDay = new Map<string, number>(); // return -> the day it next falls due (the law's calendar: returns.ts; this only remembers which we have made)
  private rules: ReturnRule[] = returnsOf(undefined); // the returns of the law we last read
  private lawId: string | undefined; // the tax law we last read
  private owe(law: string | undefined, w: Withheld, agreement?: string, gross = 0) {
    for (const x of w.parts) {
      const o = this.owed.get(x.charge.id) ?? { charge: x.charge, law: law ?? "", amount: 0 };
      this.owed.set(x.charge.id, { charge: x.charge, law: law ?? o.law, amount: o.amount + x.amount });
    }
    if (agreement && gross > 0) for (const r of this.rules) if (r.charges === undefined || w.parts.some((x) => r.charges!.includes(x.charge.id))) {
      const m = this.paidSince.get(r.id) ?? new Map<string, number>();
      m.set(agreement, (m.get(agreement) ?? 0) + gross);
      this.paidSince.set(r.id, m);
    }
  }

  // Hours before heads (docs/behaviour/firms.md): cuts we have made or put to the staff, by agreement, and wage changes
  // waiting for the day their paper names.
  private readonly cuts = new Map<string, Cut>();
  private readonly due: { at: number; agreement: string; wage: number; why: string; short?: number; /** A rise held back to the pay run (see `raise`). */ held?: boolean }[] = [];
  private readonly declined = new Set<string>(); // agreements whose worker has not agreed to a cut, this spell
  private noCutUntil = -Infinity;
  private repliesRead = 0;
  /** Wages our orders have paid, gross (what they paid, and what they withheld), since we began. */
  wagesPaid = 0;
  // Pay that's changed since hiring (an enterprise agreement), and pay stopped (a strike: no pay for time on strike).
  private readonly gross = new Map<string, number>(); // agreement -> the wage now
  private readonly stopped = new Map<string, { since: number; lastDue: number }>(); // agreement -> its pay stopped when, and the pay day before
  // The one rule for any change of pay (a rise, a stop, a restart, a death, an end of employment): the pay run is the unit,
  // and what an order actually paid is what the books say it paid. Withdrawing an order takes the manager's time (the act
  // waits for them), and an order withdrawn after its pay moment still pays it. So an order we have withdrawn stays on
  // our books (what it pays in that time is booked, with its tax), the pay moments it paid are read from its payments
  // (`paidTo`), and a change that can be held to a pay run is (`heldToRun`, `holdRise`, `PAY_CUTOFF`).
  private readonly withdrawn = new Map<string, { agreement: string; at: number }>(); // a standing order we have withdrawn -> its agreement, and when we decided to
  private readonly paidTo = new Map<string, number>(); // agreement -> the latest pay moment a withdrawn order of it paid

  /**
   * `does`: which half of it this office does. Most employers do both; an organisation where one office hires and
   * another runs the payroll (a town: its works manager, its finance officer) gives each its half.
   */
  /** `own`: when several offices of one organisation hire (the town's works and environment offices), which staff and
   * postings are this office's: those in its `role` ("role"), or those or ones that name no role (the staff the world
   * started with: "role_or_unnamed"). Absent: all of the organisation's (a payroll). */
  /** `payroll`: for an office that hires and does not pay, the office of its organisation that does (a post): it is
   * sent a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"). `notice_wait`: for an
   * office that pays and does not hire, how long it waits for the hiring office's notice of a new starter before it
   * sets the wage up from the agreement on file (seconds; absent: it acts on the agreement at once, as an employer
   * that does both does). */
  /** `registered_bps`: of the jobs this employer fills, the share it puts on its payroll returns (10,000, or nothing
   * said: all of them). A job it does not register is paid whole: nothing is withheld from it and no report names
   * its worker (docs/behaviour/firms.md, "Jobs an employer does not register"). */
  constructor(private readonly ctx: ParticipantContext, private readonly me: string, private readonly o: { period: number; notice_days: number; workplace?: string; role: string; industry?: string; does?: { hire?: boolean; pay?: boolean }; own?: "role" | "role_or_unnamed"; payroll?: string; /** The line of the organisation's adopted budget this office's posts are paid from: said on its payroll notices, so that the paying office knows which line a wage is on. */ line?: string; notice_wait?: number; registered_bps?: number; casual_bps?: number; day_wage?: number; work_days?: number; week_days?: number; short?: { by_bps: number }; /** How often the office wakes (seconds; absent: daily): a return falling due before its next look is filed at this one. */ wakes?: number }) {}
  /** When we last let someone go because we could not pay them (from then we take on only with more in hand: the module asks). */
  cashLayoffAt = -Infinity;
  /** Redundancy pay (and pay in lieu of notice the agreement fell short of) owed at the end of a job we ended for redundancy: agreement -> the sum. */
  private readonly severance = new Map<string, number>();
  // Work by the day (`casual_bps`: of the jobs this employer fills, the share it fills by the day; `day_wage`: what it
  // pays for a day, at the wage it began with; `work_days`: the days of the week it works; `week_days`: the working days of the world's week, over which a day's
  // pay is reckoned as a year's for what the law withholds). Whom we have paid for
  // which day; and the wage we began with, by which the day's pay moves as ours does.
  private readonly paidOn = new Map<string, number>(); // agreement -> the day we last paid for
  private wage0: number | undefined;
  private dayWage(wage: number): number {
    return Math.max(1, Math.round(((this.o.day_wage ?? 0) * wage) / Math.max(1, this.wage0 ?? wage)));
  }
  /** Whether the job we post next is one by the day (the share the world gives; drawn for each posting). */
  private postsByTheDay(t: number): boolean {
    const share = this.o.casual_bps ?? 0;
    return share > 0 && (this.o.day_wage ?? 0) > 0 && this.ctx.rng(`by-the-day`).below(10_000) < share;
  }
  /** A posting: for a job on a standing wage, or (the employer's share of them) for work by the day. */
  private posting(t: number, wage: number, account: string, byDay = this.postsByTheDay(t)): C.Call {
    const place = this.o.workplace ? { workplace: structureOf(this.o.workplace), space: this.o.workplace } : {};
    if (byDay) {
      const day = this.dayWage(wage);
      return say("job_posting", `Hiring by the day: ${moneyNow(day)} for each day worked.`, { data: { wage: day, period: DAY, by_the_day: true, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...place },
        offer: { by: this.me, to: { min_age_years: 18 }, take_up: "apply", available: 1, terms: { template: "employment",
          commitments: [{ who: this.me, does: { outcome: { money: { ...(account ? { from: account } : {}), amount: String(day), for: "a day's work" } } }, every: DAY },
            ...(this.o.workplace ? [{ who: "taker", does: { outcome: { occupancy: { in: this.o.workplace } } } } as const] : [])],
          termination: [{ party: this.me, notice: NO_NOTICE }, { party: "taker" as const, notice: NO_NOTICE }] } } });
    }
    return say("job_posting", `Hiring: ${moneyNow(wage)} every ${this.o.period / DAY} days.`, { data: { wage, period: this.o.period, role: this.o.role, ...(this.o.industry ? { industry: this.o.industry } : {}), ...place }, offer: this.jobOffer(wage, account) });
  }
  // Jobs we have not registered: our own note of each (a record only we see), from the start or made when we took
  // the worker on; and the jobs we have already decided about.
  private readonly offBooks = new Set<string>();
  private readonly decided = new Set<string>();
  private notesRead = 0;
  /** Whether a job is one we do not register (decided once, when its wages start; a note of ours says so after). */
  private readNotes(book: Book) {
    const notes = book.all("off_books");
    for (; this.notesRead < notes.length; this.notesRead++) {
      const r = notes[this.notesRead]!;
      if (r.speaks_for === this.me && r.data?.agreement) this.offBooks.add(String(r.data.agreement));
    }
  }
  private unregistered(book: Book, agreement: string): { off: boolean; note?: C.Call } {
    this.readNotes(book);
    if (this.offBooks.has(agreement)) return { off: true };
    const share = this.o.registered_bps ?? 10_000;
    if (share >= 10_000 || this.decided.has(agreement)) return { off: false };
    this.decided.add(agreement);
    if (this.ctx.rng(`registers-${agreement}`).below(10_000) < share) return { off: false };
    this.offBooks.add(agreement);
    return { off: true, note: say("off_books", `Not on our payroll returns: ${agreement}.`, { visible: [this.me], basis: agreement, data: { agreement } }) };
  }
  /** Payroll notices this office has sent, by "<starter|leaver>:<agreement>" (and what is on file says the same). */
  private readonly notified = new Set<string>();
  /** The role an employment agreement names ("... works for X as <role> for <the wage> every N days."), if any; one
   * that names none and was made on an advertisement is for the post advertised (an offer in the office-holder's own
   * words: docs/behaviour/firms.md, "An offer made on an advertisement"). */
  private roleOf(a: any, book: Book): string | undefined {
    const named = / as (.+?) for (?:(?! for ).)+ every \d+ days\.(?: First pay .*)?$/.exec(a.terms?.text ?? "")?.[1];
    if (named !== undefined) return named;
    const advertised = advertisedJob(book, a)?.data?.role;
    return typeof advertised === "string" && advertised ? advertised : undefined;
  }
  private ours(role: string | undefined): boolean {
    return !this.o.own || role === this.o.role || (this.o.own === "role_or_unnamed" && role === undefined);
  }

  absorb(obs: Observation) {
    for (const m of obs.inbox) {
      const who = PAYEE_DIED.who(m.text);
      if (who) this.bankSaysDead.add(who);
      // (A wage our account could not cover: the bank says so, naming our order. It is still owed: the ledger below.)
      if (m.re && PAYMENT_FAILED.is(m.text)) this.failed.push({ order: m.re, t: obs.t });
    }
    for (const x of obs.outcomes) for (const [ref, id] of Object.entries(x.created ?? {})) if (this.pendingOrder.has(ref)) {
      this.orders.set(this.pendingOrder.get(ref)!, id);
      this.replacing.delete(this.pendingOrder.get(ref)!);
      this.pendingOrder.delete(ref);
      if (this.pendingWithhold.has(ref)) this.withholds.set(id, this.pendingWithhold.get(ref)!);
      this.pendingWithhold.delete(ref);
    }
    // Wages paid by our standing orders: what each withheld is now owed to the collector.
    const ours = new Map<string, string>([...[...this.orders].map(([agreement, order]) => [order, agreement] as [string, string]), ...[...this.withdrawn].map(([order, w]) => [order, w.agreement] as [string, string])]);
    for (const tx of channels.transactions(obs)) {
      if (!tx.per_instruction || !ours.has(tx.per_instruction)) continue;
      // (A withdrawn order pays only inside the act that withdraws it, which waits a couple of days at most: a payment later than that is not its.)
      const gone = this.withdrawn.get(tx.per_instruction);
      if (gone && tx.t > gone.at + 2 * DAY) continue;
      if (gone) this.paidTo.set(ours.get(tx.per_instruction)!, Math.max(this.paidTo.get(ours.get(tx.per_instruction)!) ?? 0, tx.t));
      const w = this.withholds.get(tx.per_instruction) ?? NOTHING_WITHHELD;
      if (!this.offBooks.has(ours.get(tx.per_instruction)!)) this.owe(this.lawId, w, ours.get(tx.per_instruction), cents(tx.amount) + w.total);
      this.wagesPaid += cents(tx.amount) + w.total;
      const short = this.skim.get(ours.get(tx.per_instruction)!);
      if (short) this.kept.set(ours.get(tx.per_instruction)!, (this.kept.get(ours.get(tx.per_instruction)!) ?? 0) + short);
    }
  }

  private readonly confirmed = new Set<string>(); // requests for a confirmation of someone's employment, answered
  /** The employment of a person as our own agreements show it: with us now (and since when), ended (and on what day), or no record of it. */
  private employment(book: Book, t: number, who: string): { employed: boolean; known: boolean; ended_on?: number } {
    const mine = this.contracts(book).filter((a) => a.terms.parties[1] === who && book.signedBy(a.id, who));
    if (!mine.length) return { employed: false, known: false };
    if (mine.some((a) => book.inForce(a.id) && t < this.endOf(book, a))) return { employed: true, known: true };
    const last = Math.max(...mine.map((a) => Math.min(t, this.endOf(book, a))));
    return { employed: false, known: true, ended_on: last };
  }
  private confirm(book: Book, t: number): Step[] {
    const steps: Step[] = [];
    for (const r of book.open(DECISION.confirmation_request).filter((x) => (x.addressed_to ?? []).includes(this.me) && !this.confirmed.has(x.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
      this.confirmed.add(r.id);
      const who = String(r.data?.about ?? ""), office = r.speaks_for;
      if (!who || !office || typeof r.data?.claim !== "string") continue;
      const e = this.employment(book, t, who);
      steps.push(because(`${office} asks us to confirm the employment of ${who} for their claim ${r.data.claim}: answering from our books.`,
        say(DECISION.confirmation, `Answer to your request ${r.id}: ${e.employed ? `${who} is in our employment` : e.known ? `${who}'s employment with us ended on day ${Math.floor((e.ended_on ?? t) / DAY)}` : `we have no record of ${who} in our employment`}.`,
          { to: [office], visible: [office, this.me], basis: r.id, data: { claim: r.data.claim, need: r.data.need, request: r.id, subject: who, ...e } })));
    }
    return steps;
  }

  private contracts(book: Book): any[] {
    return book.ofType("agreement").filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === this.me && this.ours(this.roleOf(r, book)));
  }
  private endOf(book: Book, a: any): number {
    return book.endsAt(a.id) ?? Infinity;
  }
  /** Employment agreements in force and not yet ended, oldest first. */
  staff(book: Book, t: number): any[] {
    return this.contracts(book).filter((a) => book.inForce(a.id) && t < this.endOf(book, a)).sort((x, y) => book.signedAt(x.id)! - book.signedAt(y.id)!);
  }
  /** Those of our staff we know to have died: by the registry's entry or by our bank's word (docs/behaviour/deaths.md). */
  knownDead(book: Book, t: number): string[] {
    const dead = new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...this.bankSaysDead]);
    return this.staff(book, t).map((a) => a.terms.parties[1] as string).concat(this.contracts(book).filter((a) => this.noticed.has(a.id)).map((a) => a.terms.parties[1] as string)).filter((w, i, all) => dead.has(w) && all.indexOf(w) === i);
  }
  /** Our staff, as we have them (truth audits). */
  beliefs(book: Book): Belief[] {
    // (An office that keeps only its own role's staff doesn't hold its organisation's whole list: it says nothing of it.)
    if (this.o.own) return [];
    return [{ of: "held", party: this.me, template: "employment", agreements: this.staff(book, book.now).map((a) => a.id) }];
  }
  /** What a direction not to recruit does and does not do, in the office's words (docs/behaviour/directions.md): no
   * post is advertised and no new offer made; an offer already out is the office's word already given, and stands
   * if the worker signs it. Until 2026-10-11 the office wrote that it "takes nobody on", and a worker who signed an
   * offer made two days before the direction read to a mayor and a finance officer as the office defying it. */
  notRecruiting(book: Book, t: number): string {
    const out = this.offered(book, t);
    return `The office advertises no post, takes down the advertisements it has out and makes no new offer of employment.${out.length ? ` ${out.length === 1 ? "One offer" : `${out.length} offers`} it had already made ${out.length === 1 ? "is" : "are"} not yet signed by the worker (${out.map((a) => `${a.id}, to ${a.terms.parties[1]}`).join("; ")}): a direction ends no offer already made, and ${out.length === 1 ? "it stands if the worker signs it" : "each stands if the worker signs it"}.` : " It has no offer out that is not yet signed."}`;
  }
  /** Offers we've made in the last month that the worker hasn't signed yet. */
  offered(book: Book, t: number): any[] {
    return this.contracts(book).filter((a) => !book.concluded(a.id) && !book.signedBy(a.id, a.terms.parties[1]) && t - a.at < MONTH);
  }
  /** Our standing job postings. */
  postings(book: Book) {
    return book.open("job_posting").filter((j) => j.speaks_for === this.me && this.ours(j.data?.role as string | undefined));
  }
  /** The workers we're paying, by person. */
  workers(book: Book, t: number): string[] {
    return this.staff(book, t).map((a) => a.terms.parties[1] as string);
  }

  /** How many of our staff are staying: those we haven't given notice. (Someone working out their notice is still on
   * the staff and still paid, so a firm that lets people go until it can cover its wages counts those who stay: counted
   * with those going, one shortfall let the whole staff go, one after another, in a day.) */
  staying(book: Book, t: number): number {
    return this.staff(book, t).filter((a) => !this.noticed.has(a.id)).length;
  }

  /**
   * The routine: start wages for new hires and stop them for the dead and the departed; offer each posting's job to
   * one applicant at random (at the posting's wage); post a job at `wage` while short of `target` and `canPost`.
   */
  /** A posting's offer (docs/design/ai-citizens.md 2a): the terms of the employment it's for, in the typed vocabulary. */
  jobOffer(wage: number, account: string): Offer {
    return { by: this.me, to: { min_age_years: 18 }, take_up: "apply", available: 1, terms: { template: "employment",
      commitments: [
        // (The account it's paid from, where the office says; a payroll elsewhere in the organisation pays it otherwise.)
        { who: this.me, does: { outcome: { money: { ...(account ? { from: account } : {}), amount: String(wage), for: "wages" } } }, every: this.o.period },
        ...(this.o.workplace ? [{ who: "taker", does: { outcome: { occupancy: { in: this.o.workplace } } } } as const] : []),
      ],
      // (Notice, where the employer says what it is.)
      ...(Number.isInteger(this.o.notice_days) && this.o.notice_days > 0 ? { termination: [{ party: this.me, notice: this.o.notice_days * DAY }, { party: "taker" as const, notice: this.o.notice_days * DAY }] } : {}) } };
  }

  /** `recruit: false`: the office has been directed not to recruit (docs/behaviour/directions.md): it advertises no
   * post, takes its standing advertisements down (saying why: `stopped`), and makes no offer to an applicant, while
   * that stands. Those it employs, their pay and their notice go on as they were. */
  routine(obs: Observation, book: Book, account: string, want: { target: number; wage: number; canPost: boolean; why?: string; recruit?: boolean; stopped?: string; /** Whether there is work today for hands by the day (nothing said: yes). */ work?: boolean }): Step[] {
    const t = obs.t;
    const me = this.me;
    // Genesis standing orders for existing staff (what each withholds: the agreed wage less what it pays; charge by
    // charge as the law reckons it, where that comes to the same).
    const law = incomeTaxLaw(book);
    this.lawId = law?.id ?? this.lawId;
    this.readNotes(book);
    for (const r of book.open("request")) for (const b of r.speaks_for === me && r.data?.every ? basesOf(r) : []) if (b && !this.orders.has(b) && !this.isReplacing(b, t)) { // (not one whose replacement is made but not yet on the book: the act waits for its performer's time)
      this.orders.set(b, r.id);
      const a = book.records.get(b);
      const gross = a?.record === "agreement" ? cents(commitmentOf(a, me).outcome?.money?.amount ?? 0) : 0;
      const net = cents(r.data?.outcome?.money?.amount ?? 0);
      if (gross > net && net > 0) {
        const w = withheld(law, gross, Number(r.data?.every) || this.o.period);
        this.withholds.set(r.id, w.total === gross - net ? w : { total: gross - net, parts: law?.charges[0] ? [{ charge: law.charges[0], amount: gross - net }] : [] });
      }
    }
    const contracts = this.contracts(book);
    const staff = this.staff(book, t);
    const offered = this.offered(book, t);
    const steps: Step[] = [];
    let offersNow = 0;
    const doesPay = this.o.does?.pay !== false;
    // An office that waits to decide a claim of one of our people asks us to confirm it (the law's, foundations F8): we answer from our own books, once, as
    // an employer does a request from the payments office for a separation certificate. Whoever of our offices runs the payroll answers.
    if (doesPay) steps.push(...this.confirm(book, t));
    // (Directed not to recruit: its advertisements come down, and nothing below that hires is done.)
    const recruiting = want.recruit !== false;
    const doesHire = this.o.does?.hire !== false && recruiting;
    if (!recruiting && this.o.does?.hire !== false) {
      const up = this.postings(book);
      if (up.length) steps.push(because(want.stopped ?? "Directed not to recruit: taking our advertisements down.", ...up.map((j) => withdraw(j.id, "Withdrawn: recruiting is stopped by direction."))));
    }

    // Newly signed: start paying wages by standing order, at the wage agreed less what the tax law's charges say to
    // withhold.
    // (A payroll that another office hires for acts on that office's notice of a new starter, and pays from the first
    // pay day it gives. With no notice after `notice_wait`, it sets the wage up from the agreement on file, whose
    // first pay day is a pay period after both signed: docs/behaviour/firms.md, "Payroll notices".)
    const starters = this.o.notice_wait !== undefined ? book.open("payroll_notice").filter((n) => n.speaks_for === me && n.data?.notice === "starter") : [];
    for (const a of doesPay ? staff : []) {
      // (Not a job we've given notice on: a worker who died has their order withdrawn, and isn't a new hire.)
      if (this.orders.has(a.id) || this.stopped.has(a.id) || this.noticed.has(a.id) || [...this.pendingOrder.values()].includes(a.id)) continue;
      if (byTheDay(a)) continue; // (paid for each day worked, below: no standing order)
      const worker = a.terms.parties[1];
      const pays = { ...jobTerms(a, worker) };
      pays.wage = this.gross.get(a.id) ?? pays.wage;
      const told = starters.find((n) => n.data?.agreement === a.id);
      const signed = book.signedAt(a.id) ?? a.at;
      if (this.o.notice_wait !== undefined && !told && t - signed < this.o.notice_wait) continue;
      const to = commitmentOf(a, me).outcome?.money?.to ?? (typeof told?.data?.account === "string" ? (told.data.account as string) : undefined) ?? ((book.all("job_application").find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === worker) as any)?.data?.account);
      if (!to) continue;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      // (A job we do not register is paid whole: nothing withheld, and our returns will not name it.)
      const reg = this.unregistered(book, a.id);
      const w = reg.off ? NOTHING_WITHHELD : withheld(law, pays.wage, pays.period), tax = w.total;
      if (tax > 0) this.pendingWithhold.set(ref, w);
      // (The first pay day: the notice's; with none, the agreement's; for an employer that hires and pays itself, a pay
      // period from now, as it has always been.)
      const firstPay = this.o.notice_wait === undefined ? undefined : Number.isSafeInteger(told?.data?.first_pay) ? (told!.data!.first_pay as number) : signed + pays.period;
      const first = firstPay === undefined ? pays.period : Math.max(0, firstPay - t);
      const on = this.o.notice_wait === undefined ? "A new hire has signed" : told ? `Payroll notice ${told.id}: a new starter, first pay day ${dateWords(firstPay!)}` : `A new starter's agreement (${a.id}) is on file and no payroll notice has come for it: setting the wage up from the agreement, first pay day ${dateWords(firstPay!)}`;
      if (reg.off) {
        steps.push(because(`${on}: starting their wages by standing order, whole. This job is not going on our payroll returns.`,
          [ref, pay(to, pays.wage, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`, ...(typeof told?.data?.line === "string" ? { line: told.data.line } : {}) })], ...(reg.note ? [reg.note] : [])));
        continue;
      }
      steps.push(because(tax > 0 ? `${on}: starting their wages by standing order, ${usd(pays.wage - tax)} after the ${usd(tax)} of income tax the law says to withhold.` : `${on}: starting their wages by standing order.`,
        [ref, pay(to, pays.wage - tax, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`, ...(typeof told?.data?.line === "string" ? { line: told.data.line } : {}) })]));
    }
    // An office that hires and does not pay tells the office that does (docs/behaviour/firms.md, "Payroll notices"): of each new
    // starter once both have signed (who, the post, the pay, the pay period, the first pay day, the account, the
    // agreement), and of each leaver once the employment has an end (the last day). Each once, by the office's own
    // file: whoever holds the office carries on from its papers.
    if (this.o.payroll && !doesPay && this.o.does?.hire !== false) {
      const filed = book.open("payroll_notice").filter((n) => n.speaks_for === me);
      const sent = (what: string, a: any) => this.notified.has(`${what}:${a.id}`) || filed.some((n) => n.data?.notice === what && n.data?.agreement === a.id);
      const post = (a: any) => this.roleOf(a, book) ?? this.o.role;
      for (const a of staff) {
        const signed = book.signedAt(a.id);
        // (Those the organisation started with were on its payroll before the year began.)
        if (a.author === "genesis" || signed === undefined || sent("starter", a)) continue;
        const worker = a.terms.parties[1] as string, pays = jobTerms(a, worker), to = this.payee(book, a);
        if (!to) continue;
        this.notified.add(`starter:${a.id}`);
        const firstPay = signed + pays.period;
        // (Which line of the budget the post is on: the hiring office took the worker on within its own line, and the
        // office that pays must not have to guess it. Until 2026-10-11 the notice named no line: a finance seat set a
        // hire on the environment line against the staff line, found that full, and left the worker unpaid.)
        const onLine = this.o.line ? ` The post is one of those the ${this.o.line} line of the adopted budget pays for: the wage is on that line.` : "";
        steps.push(because(`${worker} has signed and started: sending the ${this.o.payroll} office a payroll notice (who, the post, the pay, the first pay day, the agreement), for it to set the wage up.`,
          say("payroll_notice", `Payroll notice, new starter: ${worker}, ${post(a)}, under employment agreement ${a.id}. Pay: ${usd(pays.wage)} every ${durationWords(pays.period)} before tax, into ${to}; first pay day ${dateWords(firstPay)}, then every ${durationWords(pays.period)}.${onLine} For the ${this.o.payroll} office: the wage payment is to be set up from that day.`,
            { to: [me], visible: [me], basis: a.id, data: { notice: "starter", office: this.o.payroll, employee: worker, post: post(a), agreement: a.id, wage: String(pays.wage), period: pays.period, first_pay: firstPay, account: to, ...(this.o.line ? { line: this.o.line } : {}) } }),
          // (And put in front of the payroll office: a paper on the organisation's own file is not news to anyone in
          // it, so the notice goes to the office's post as a letter, in its own words, naming the agreement.)
          message([this.o.payroll], `${PAYROLL_NOTE}new starter: ${worker}, ${post(a)}, under employment agreement ${a.id}. Pay: ${usd(pays.wage)} every ${durationWords(pays.period)} before tax, into ${to}; first pay day ${dateWords(firstPay)}, then every ${durationWords(pays.period)}.${onLine} The notice is on the organisation's file. The wage payment is to be set up from that day: a payment from the organisation's account to ${to} every ${durationWords(pays.period)}, first on ${dateWords(firstPay)}, citing ${a.id}, of the pay less what the tax law says to withhold.`, a.id)));
      }
      const deaths = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
      for (const a of contracts) {
        if (!book.concluded(a.id) || sent("leaver", a)) continue;
        const worker = a.terms.parties[1] as string;
        const died = deaths.has(worker) && book.inForce(a.id) && t < this.endOf(book, a);
        const end = died ? t : book.endsAt(a.id);
        if (end === undefined) continue;
        this.notified.add(`leaver:${a.id}`);
        const reason = died ? "died" : "notice";
        // (A member of staff who has died: the employment is ended on record by the office that employed them, if
        // nobody of the organisation has yet.)
        const ends = died && !(book.notices.get(a.id) ?? []).some((n) => n.as === me) ? [notice(a.id, "The employee has died.")] : [];
        if (died) this.noticed.set(a.id, t);
        steps.push(because(died ? `${worker}, who worked for us, has died: ending the employment on record and telling the ${this.o.payroll} office.` : `${worker}'s employment ends on ${dateWords(end)}: telling the ${this.o.payroll} office.`,
          ...ends,
          say("payroll_notice", `Payroll notice, leaver: ${worker}, ${post(a)}, employment agreement ${a.id} ends on ${dateWords(end)} (${reason}). For the ${this.o.payroll} office: pay is due to that day, and the wage payment under the agreement is to end then.`,
            { to: [me], visible: [me], basis: a.id, data: { notice: "leaver", office: this.o.payroll, employee: worker, post: post(a), agreement: a.id, last_day: end, reason } }),
          message([this.o.payroll], `${PAYROLL_NOTE}leaver: ${worker}, ${post(a)}, employment agreement ${a.id} ends on ${dateWords(end)} (${reason}). The notice is on the organisation's file. Pay is due to that day, and the standing payment of their wage is to be withdrawn then.`, a.id)));
      }
    }
    // A worker who has died: stop the wages, and end the employment on record. We know of it when we are told: by the
    // registry's entry, if whoever reported the death named us, or by our bank, when a wage is next paid into the
    // account of someone it has been told has died (nobody is shown the register: docs/behaviour/deaths.md).
    const died = doesPay ? [...new Set([...book.all("death_registration").map((r) => r.data?.deceased as string), ...this.bankSaysDead])] : [];
    for (const who of died) {
      const a = staff.find((x) => x.terms.parties[1] === who);
      // (Someone already under notice, let go or leaving, who dies while it runs: their wages stop now all the same.
      // Until 2026-10-09 they were paid to the end of the notice.)
      const underNotice = !!a && this.noticed.has(a.id);
      if (!a || (underNotice && !this.orders.has(a.id))) continue;
      this.noticed.set(a.id, t);
      // (No second notice where the office that employed them has already ended the employment on record.)
      const ended = (book.notices.get(a.id) ?? []).some((n) => n.as === me);
      const s: Step = because(`${who}, who worked for us, has died: stopping their wages.`, ...(underNotice || ended ? [] : [notice(a.id, "The employee has died.")]));
      if (this.orders.has(a.id)) {
        s.push(this.retire(a.id, "The employee has died; stop wages.", t));
      }
      steps.push(s);
    }
    // Ended (notice served): stop the wages.
    for (const a of doesPay ? contracts : []) if (book.concluded(a.id) && t >= this.endOf(book, a) && this.orders.has(a.id)) {
      steps.push(because("Employment has ended: stopping the wages.", this.retire(a.id, "Employment ended; stop wages.", t)));
    }
    // Ended for redundancy, with pay owed under the law: owed in our books from the day the job ends, and paid with
    // the wages we owe (at once if the account covers it; late if not).
    for (const a of doesPay ? contracts : []) if (this.severance.has(a.id) && book.concluded(a.id) && t >= this.endOf(book, a)) {
      const to = this.payee(book, a);
      if (to) this.unpaid.push({ agreement: a.id, to, amount: this.severance.get(a.id)!, withheld: NOTHING_WITHHELD, due: this.endOf(book, a), what: "Redundancy pay" });
      this.severance.delete(a.id);
    }

    if (doesPay) steps.push(...this.applyHours(book, t, account));
    if (doesPay) steps.push(...this.latePay(book, t, account, (() => { const b = channels.accounts(obs).find((x) => x.account === account)?.balance; return b === undefined ? undefined : cents(b); })(),
      staff.reduce((x, a) => x + (this.noticed.has(a.id) || byTheDay(a) ? 0 : this.wageOf(a)), 0)));

    // Work by the day: each hand who is at work today is paid the day's wage today, once, by a payment of its own
    // (less what the law withholds from a day's pay, where the job is one we register). A day we have no work for
    // them (`want.work` false), a day that is not a working day, a hand who is not there: no pay, and nothing owed.
    // Short of the money for all of them, we pay those we can, the longest with us first.
    this.wage0 ??= want.wage;
    const hands = doesPay ? staff.filter((a) => byTheDay(a) && !this.noticed.has(a.id)) : [];
    const today = Math.floor(t / DAY);
    if (hands.length && want.work !== false && today % 7 < (this.o.work_days ?? 5)) {
      const here = this.o.workplace ? new Set(channels.cells(obs).flatMap((c) => (c.structure?.structure === structureOf(this.o.workplace!) ? c.structure.spaces.filter((sp) => sp.space === this.o.workplace).flatMap((sp) => sp.occupants ?? []) : []))) : undefined;
      let left = cents(channels.accounts(obs).find((x) => x.account === account)?.balance ?? 0);
      const lines: C.Call[] = [];
      for (const a of hands) {
        const worker = a.terms.parties[1] as string;
        if (this.paidOn.get(a.id) === today || (here && !here.has(worker))) continue;
        const day = this.wageOf(a); // (the day's pay agreed, with any rise since)
        const to = this.payee(book, a);
        if (!to || day > left) continue;
        const reg = this.unregistered(book, a.id);
        const w = reg.off ? NOTHING_WITHHELD : withheld(law, day, dayPayPeriod(this.o.week_days ?? 5));
        this.paidOn.set(a.id, today);
        left -= day;
        if (!reg.off) this.owe(law?.id, w, a.id, day);
        this.wagesPaid += day;
        lines.push(pay(to, day - w.total, { from: account, basis: a.id, for: `A day's work: ${worker}.` }), ...(reg.note ? [reg.note] : []));
      }
      for (let i = 0; i < lines.length; i += 30) steps.push(because(`Paying today's hands for the day (${lines.length} by the day).`, ...lines.slice(i, i + 30)));
    }

    // Hiring: one applicant at random per posting, at the posting's wage.
    const posts = this.postings(book);
    const apps = book.open("job_application").filter((a) => (a.addressed_to ?? []).includes(me) && !this.handled.has(a.id));
    for (const post of doesHire ? posts : []) {
      // (An advertisement of ours that we have put on hold: nobody is offered the post while the hold stands; those
      // who applied are still on file when it is lifted.)
      if (book.onHold(post.id, [me])) continue;
      const mine = apps.filter((a) => a.data?.posting === post.id).sort((x, y) => (x.id < y.id ? -1 : 1));
      for (const a of mine) this.handled.add(a.id);
      if (!mine.length) continue;
      const chosen = this.ctx.rng(`hire-${post.id}`).pick(mine);
      const worker = chosen.speaks_for!;
      const wage = Number.isInteger(post.data?.wage) ? (post.data!.wage as number) : want.wage;
      if (post.data?.by_the_day) {
        steps.push(because(`Taking on a hand by the day: an applicant picked at random among ${mine.length}.`,
          ["job", offer(worker, { template: "employment", ourNotice: NO_NOTICE, theirNotice: NO_NOTICE,
            we: pay(chosen.data?.account ?? worker, wage, { every: DAY, for: "a day's work" }),
            they: this.o.workplace ? C.call("occupancy", { who: worker, in: this.o.workplace }) : undefined,
            text: `${worker} works for ${me} by the day, for ${moneyNow(wage)} for each day worked; either may end it at once.`, basis: chosen.id })],
          withdraw(post.id, "Filled.")));
        offersNow++;
        continue;
      }
      steps.push(because(`Hiring for our posting: an applicant picked at random among ${mine.length}.`,
        ["job", offer(worker, {
          template: "employment", ourNotice: this.o.notice_days * DAY, theirNotice: this.o.notice_days * DAY,
          // (The job's ordinary hours in a week, as the world's law has the ordinary week: the agreement's hours term.)
          ...(hoursLaw(book)?.ordinary_week_hours ? { hours: hoursLaw(book)!.ordinary_week_hours * 3600 } : {}),
          we: pay(chosen.data?.account ?? worker, wage, { every: this.o.period, for: "wages" }),
          they: this.o.workplace ? C.call("occupancy", { who: worker, in: this.o.workplace }) : undefined,
          text: `${worker} works for ${me} as ${post.data?.role ?? "staff"} for ${moneyNow(wage)} every ${this.o.period / DAY} days. First pay ${this.o.period / DAY} days after both have signed.`,
          basis: chosen.id,
        })],
        withdraw(post.id, "Filled."),
      ));
      offersNow++;
    }

    // On the law's days: what we've withheld, paid over to the tax's collector, with a return of it. The law lists its
    // returns (which charges each reports, how often, the day of the month it falls due by: returns.ts); we file each on
    // its day, for every employer alike. A period with nothing withheld files nothing; its day is still the calendar's.
    // Short of money, we pay what we can, keeping the next pay period's wages, and what's left is still owed (carried
    // to the next return).
    this.rules = returnsOf(law);
    const early = Math.max(0, (this.o.wakes ?? DAY) - DAY); // (an office that looks in weekly files by the day, not after it)
    for (const rule of this.rules) {
      if (!this.returnDay.has(rule.id)) this.returnDay.set(rule.id, nextReturn(rule, t).due);
      const falls = this.returnDay.get(rule.id)!;
      if (!doesPay || t + early < falls) continue;
      this.returnDay.set(rule.id, nextReturn(rule, falls).due);
      const period = nextReturn(rule, falls - 1);
      const balance = channels.accounts(obs).find((a) => a.account === account)?.balance;
      const due = [...this.owed.values()].filter((x) => x.amount > 0 && x.charge.account && x.charge.collector && (rule.charges === undefined || rule.charges.includes(x.charge.id)));
      if (due.length && balance !== undefined) {
        // (Keeping the next pay period's wages aside: they go first.)
        const keep = staff.reduce((x, a) => x + jobTerms(a, a.terms.parties[1]).wage, 0);
        let left = Math.max(0, cents(balance) - keep);
        // Who was paid what since we last reported, for a charge whose report names each worker.
        const lines = [...(this.paidSince.get(rule.id) ?? [])].filter(([agreement]) => !this.offBooks.has(agreement)).map(([agreement, gross]) => ({ worker: (book.records.get(agreement) as any)?.terms?.parties?.[1] as string | undefined, gross }))
          .filter((x): x is { worker: string; gross: number } => !!x.worker).sort((a, b) => (a.worker < b.worker ? -1 : a.worker > b.worker ? 1 : 0));
        const label = rule.name ?? "Return of tax withheld from wages";
        const mark = { return: rule.id, due: falls, period_from: period.from, period_to: period.to };
        // One report to each collector, in the law's order, with what is paid into each of its accounts.
        for (const collector of [...new Set(due.map((x) => x.charge.collector))]) {
          const parts = due.filter((x) => x.charge.collector === collector).map((x) => {
            const paid = Math.min(x.amount, left);
            left -= paid;
            this.owed.set(x.charge.id, { ...x, amount: x.amount - paid });
            return { charge: x.charge, owed: x.amount, paid };
          });
          const owed = parts.reduce((x, c) => x + c.owed, 0), paid = parts.reduce((x, c) => x + c.paid, 0);
          const accounts = [...new Set(parts.map((c) => c.charge.account))];
          const itemised = parts.some((c) => c.charge.itemised);
          const basis = due.find((x) => x.charge.collector === collector)!.law || law?.id;
          // (A law whose charges all go to one account, none reported worker by worker: one sum, as it has always been said.)
          const oneAccount = !law || (new Set(law.charges.map((c) => c.account)).size === 1 && !law.charges.some((c) => c.itemised));
          if (oneAccount && accounts.length === 1 && !itemised) {
            steps.push(because(paid === owed ? `${label}, due ${dateWords(falls)}: paying over the ${usd(owed)} of income tax we withheld from wages.` : `${label}, due ${dateWords(falls)}: we owe ${usd(owed)} of income tax withheld from wages and have ${usd(paid)}: paying that, and still owing the rest.`,
              say("withholding_report", `Income tax withheld from wages, owed: ${usd(owed)}; paid now: ${usd(paid)}.`, { to: [collector], visible: [me, collector], ...(basis ? { basis } : {}), data: { withheld: owed, paid, period_end: t, account, ...mark } }),
              ...(paid > 0 ? [pay(accounts[0]!, paid, { from: account, for: "Income tax withheld from wages." })] : [])));
            continue;
          }
          // Several accounts, or a charge reported worker by worker: the report says what is owed and paid under each
          // charge, and (where a charge asks it) each worker's pay in the period.
          const named = (c: Charge) => c.name ?? c.id;
          steps.push(because(paid === owed ? `${label}, due ${dateWords(falls)}: paying over the ${usd(owed)} we withheld from wages (${parts.map((c) => `${named(c.charge)} ${usd(c.owed)}`).join(", ")}).` : `${label}, due ${dateWords(falls)}: we owe ${usd(owed)} withheld from wages and have ${usd(paid)}: paying that, and still owing the rest.`,
            say("withholding_report", `Withheld from wages, owed: ${usd(owed)}; paid now: ${usd(paid)}. ${parts.map((c) => `${named(c.charge)}: owed ${usd(c.owed)}, paid ${usd(c.paid)}`).join("; ")}.`, { to: [collector], visible: [me, collector], ...(basis ? { basis } : {}),
              data: { withheld: owed, paid, period_end: t, account, ...mark, charges: parts.map((c) => ({ charge: c.charge.id, to: c.charge.account, withheld: c.owed, paid: c.paid })), ...(itemised ? { staff: lines } : {}) } }),
            ...accounts.map((to) => ({ to, sum: parts.filter((c) => c.charge.account === to).reduce((x, c) => x + c.paid, 0), what: parts.filter((c) => c.charge.account === to).map((c) => named(c.charge)).join(", ") }))
              .filter((x) => x.sum > 0).map((x) => pay(x.to, x.sum, { from: account, for: `Withheld from wages: ${x.what}.` }))));
        }
      }
      this.paidSince.delete(rule.id);
    }

    // A posting unfilled at an old wage (ours has moved since): published again at the wage we offer now.
    for (const post of doesHire ? posts : []) if (!apps.some((a) => a.data?.posting === post.id) && Number.isInteger(post.data?.wage) && post.data!.wage !== (post.data?.by_the_day ? this.dayWage(want.wage) : want.wage) && want.canPost) {
      steps.push(because(`Our posting is still open, at ${usd(post.data!.wage as number)}; we offer ${usd(post.data?.by_the_day ? this.dayWage(want.wage) : want.wage)} now: posting it again at that.`, withdraw(post.id, "Superseded: a new wage."),
        this.posting(t, want.wage, account, !!post.data?.by_the_day)));
    }

    // Post a job if short-staffed (and the module says we can).
    const have = staff.length + offered.length + offersNow;
    if (doesHire && have < want.target && posts.length === 0 && want.canPost) {
      steps.push(because(want.why ?? `Short-staffed (${have} of ${want.target}): posting a job.`, this.posting(t, want.wage, account)));
    }
    return steps;
  }

  /** The pay day after `t` of a wage standing order (its start, then every period). */
  private nextDue(book: Book, order: string, t: number): number {
    const r = book.records.get(order);
    const every = r?.record === "statement" ? Number(r.data?.every) || this.o.period : this.o.period;
    const start = r?.record === "statement" ? firstDue(r, every) : (r?.at ?? 0) + every;
    return start > t ? start : start + Math.ceil((t - start + 1) / every) * every;
  }

  /** The account a worker's wages go to. */
  /** The account an employee is paid into, as their agreement says. */
  payee(book: Book, a: any): string | undefined {
    const worker = a.terms.parties[1];
    return commitmentOf(a, this.me).outcome?.money?.to ?? ((book.all("job_application").find((r) => r.record === "statement" && r.kind === "job_application" && r.speaks_for === worker) as any)?.data?.account);
  }

  /** The wage an agreement pays now (after any rise). */
  wageOf(a: any): number {
    return this.gross.get(a.id) ?? jobTerms(a, a.terms.parties[1]).wage;
  }

  /**
   * A rise for everyone we employ (an enterprise agreement, docs/behaviour/unions.md): each wage order is replaced by
   * one at the new wage (net of the tax withheld), from the next pay day on.
   */
  raise(book: Book, t: number, account: string, riseBps: number, why: string, one?: { agreement: string; wage: number; /** Paid this much less than that, each pay (pay come short: above). */ short?: number }): Step[] {
    const law = incomeTaxLaw(book);
    const lines: C.Call[] = [];
    const refs: [string, string, Withheld][] = [];
    for (const a of this.staff(book, t)) {
      if (one && a.id !== one.agreement) continue; // (a rise for one of us, at the wage asked)
      let wage = one ? one.wage : Math.floor((this.wageOf(a) * (10_000 + riseBps)) / 10_000);
      // (A rise for someone on cut hours is a rise of their full wage, and they are paid their hours' share of it.)
      const cut = this.cuts.get(a.id);
      if (cut && !one) { cut.full = Math.floor((cut.full * (10_000 + riseBps)) / 10_000); wage = Math.floor((cut.full * cut.paidBps) / 10_000); cut.wage = wage; }
      this.gross.set(a.id, wage);
      if (one?.short) this.skim.set(a.id, one.short); else this.skim.delete(a.id); // (a wage set afresh is paid as set)
      const to = this.payee(book, a);
      // (A replacement already made, and not yet on the book: the act waits for its performer's time. Not replaced again
      // until it is: the order it would withdraw is the one already withdrawn, and a second would be made beside the first.)
      if (this.isReplacing(a.id, t)) {
        this.holdRise(a.id, t + DAY, wage, why, one?.short);
        continue;
      }
      const order = this.orders.get(a.id);
      if (!order || !to || this.stopped.has(a.id)) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      // A change of pay takes effect from a pay run, as payroll does it: with a cut-off. Replacing the order takes the
      // manager's time (the act waits for them), and an order withdrawn after its pay moment still pays it, so a pay
      // moment inside the act would be paid by the old order and again by the new. Within the cut-off before a pay run
      // the change is held until the run has been made, and then made for the run after it.
      const run = this.heldToRun(book, order, period, t);
      if (run !== undefined) {
        this.holdRise(a.id, run, wage, why, one?.short);
        continue;
      }
      const tax = this.offBooks.has(a.id) ? NOTHING_WITHHELD : withheld(law, wage, period);
      const ref = `wo${this.n++}`;
      lines.push(this.retire(a.id, "Superseded: a new wage.", t), [ref, pay(to, wage - tax.total - (one?.short ?? 0), { from: account, every: period, first: Math.max(DAY, this.nextDue(book, order, t) - t), basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })] as any);
      refs.push([ref, a.id, tax]);
    }
    for (const [ref, id, tax] of refs) {
      this.pendingOrder.set(ref, id);
      this.replacing.set(id, t);
      if (tax.total > 0) this.pendingWithhold.set(ref, tax);
    }
    const out: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) out.push(because(why, ...lines.slice(i, i + 30)));
    return out;
  }

  /** Withdraw an agreement's wage order; it stays on our books until its payments are seen (see `withdrawn`). */
  private retire(agreement: string, why: string, t: number): C.Call {
    const order = this.orders.get(agreement)!;
    this.withdrawn.set(order, { agreement, at: t });
    this.orders.delete(agreement);
    return withdraw(order, why);
  }

  /** The pay run a change of pay must wait for, if the next one is within the cut-off (else it may be made now). */
  private heldToRun(book: Book, order: string, period: number, t: number): number | undefined {
    const next = this.nextDue(book, order, t);
    return next - t < Math.min(PAY_CUTOFF, Math.floor(period / 2)) ? next : undefined;
  }

  private isReplacing(agreement: string, t: number): boolean {
    const since = this.replacing.get(agreement);
    return since !== undefined && t - since < 2 * DAY && [...this.pendingOrder.values()].includes(agreement);
  }

  /** A change of pay left for a later look (the latest for an agreement is the one kept). */
  private holdRise(agreement: string, at: number, wage: number, why: string, short?: number) {
    const kept = this.due.findIndex((d) => d.held && d.agreement === agreement);
    if (kept >= 0) this.due.splice(kept, 1);
    this.due.push({ at, agreement, wage, why, short, held: true });
  }

  /** The organisation's wants, where the post that runs it has them (docs/behaviour/firm-wants.md). */
  org?: Org;

  // Pay that comes short (docs/behaviour/frictions.md, "Pay"): each year, of the people an employer pays, the share
  // it begins to pay less than it agreed (a slip, `transfer/wages` in the world's table of slips, at the world's dial), by `short.by_bps`
  // of the pay; more often the more its character would pay less, and twice as often while it has less in the bank
  // than two pay periods' wages. What it has kept back from each, pay by pay, is on its own books: it knows what
  // it owes, and says so truthfully to a venue that asks; what it may do is not pay.
  private readonly skim = new Map<string, number>(); // agreement -> what each pay is short by
  private readonly kept = new Map<string, number>(); // agreement -> what we have kept back in all, not yet made good
  private shortWeek = -1;
  /** The week's look at whom we begin to pay short (at most once a week, each on their own draw). */
  shortening(book: Book, t: number, account: string, balance: number): Step[] {
    const s = this.o.short, week = Math.floor(t / (7 * DAY));
    if (!s || !(s.by_bps > 0) || week === this.shortWeek) return [];
    this.shortWeek = week;
    const staff = this.staff(book, t).filter((a) => this.orders.has(a.id) && !this.skim.has(a.id) && !this.stopped.has(a.id) && !this.noticed.has(a.id) && !byTheDay(a));
    const bill = staff.reduce((x, a) => x + this.wageOf(a), 0);
    // (More often the more its character would pay less, and twice as often while it is short of cash: the performer's lean on the row's rate.)
    const lean = (bps: number) => swayed(bps, this.org?.lively ? this.org.character.pay_less : 0, 1) * (balance < 2 * bill ? 2 : 1);
    const law = incomeTaxLaw(book);
    const steps: Step[] = [];
    for (const a of staff) {
      if (!slip(this.ctx, "transfer/wages", `${a.terms.parties[1]}-${week}`, { days: 7, lean })) continue;
      const wage = this.wageOf(a), period = jobTerms(a, a.terms.parties[1]).period;
      const net = wage - (this.offBooks.has(a.id) ? 0 : withheld(law, wage, period).total);
      const short = Math.floor((net * s.by_bps) / 10_000);
      if (short > 0) steps.push(...this.raise(book, t, account, 0, `Paying ${a.terms.parties[1]} ${usd(short)} a pay less than we agreed, from the next pay day.`, { agreement: a.id, wage, short }));
    }
    return steps;
  }
  // The wage ledger (docs/behaviour/firms.md, "Wages owed"): an agreed wage is owed in full. What we kept back from a
  // pay (above) and a pay our account could not cover on its day (the bank tells us, naming our order) both stand in
  // our books as owed to that worker under that agreement, until paid. A missed pay is paid late, oldest first, as
  // soon as the account covers it beside the next pay day's wages for those we keep; a worker who has left and
  // recorded the wages as a debt against us is paid as any creditor is, and the ledger's line gives way to the debt.
  private readonly failed: { order: string; t: number }[] = [];
  private readonly unpaid: { agreement: string; to: string; amount: number; withheld: Withheld; due: number; what?: string }[] = [];
  /** What our books say we owe someone in wages under an agreement: kept back, and missed. */
  owedShort(agreement: string): number {
    return (this.kept.get(agreement) ?? 0) + this.unpaid.reduce((x, u) => x + (u.agreement === agreement ? u.amount : 0), 0);
  }
  /** Wages our books say are owed and unpaid, in all (for whoever winds us up, and for what we can spend). */
  wagesOwed(): number {
    return this.unpaid.reduce((x, u) => x + u.amount, 0);
  }
  /** Whether we are in no state to pay out to our owners (docs/behaviour/firms.md, "Before a dividend"): wages are owed in our books, or someone
   * of our staff is under notice (a notice we gave because we could not cover the wage bill, or for want of trade). In words, or "" if neither. */
  strained(book: Book, t: number): string {
    const owed = this.wagesOwed();
    if (owed > 0) return `wages are owed in our books (${usd(owed)})`;
    const going = this.staff(book, t).filter((a) => this.noticed.has(a.id)).length;
    return going ? `${going} of our staff ${going === 1 ? "is" : "are"} under notice` : "";
  }
  /** Missed pays entered in the ledger, and those the account now covers paid late (keeping `keep` for the next pay day). */
  private latePay(book: Book, t: number, account: string, balance: number | undefined, keep: number): Step[] {
    const byOrder = new Map([...this.orders].map(([agreement, order]) => [order, agreement]));
    for (const f of this.failed.splice(0)) {
      const agreement = byOrder.get(f.order);
      const money = (book.records.get(f.order) as any)?.data?.outcome?.money;
      if (!agreement || !money?.to || !(cents(money.amount) > 0)) continue;
      this.unpaid.push({ agreement, to: money.to, amount: cents(money.amount), withheld: this.withholds.get(f.order) ?? NOTHING_WITHHELD, due: f.t });
    }
    if (!this.unpaid.length) return [];
    // (A worker's own claim for the wages, recorded as a debt against us, replaces our line: it is paid as a debt.)
    const claimed = new Set(book.ofType("claim").filter((c: any) => c.counterparty === this.me && c.about?.kind === "debt").flatMap((c: any) => basesOf(c)));
    for (let i = this.unpaid.length - 1; i >= 0; i--) if (claimed.has(this.unpaid[i]!.agreement)) this.unpaid.splice(i, 1);
    if (balance === undefined) return [];
    let left = balance - keep;
    const lines: C.Call[] = [];
    while (this.unpaid.length && this.unpaid[0]!.amount <= left && lines.length < 30) {
      const u = this.unpaid.shift()!;
      left -= u.amount;
      const worker = (book.records.get(u.agreement) as any)?.terms?.parties?.[1] ?? "our employee";
      if (!this.offBooks.has(u.agreement)) this.owe(this.lawId, u.withheld, u.agreement, u.amount + u.withheld.total);
      this.wagesPaid += u.amount + u.withheld.total;
      lines.push(pay(u.to, u.amount, { from: account, basis: u.agreement, for: u.what ? `${u.what} for ${worker}.` : `Wages for ${worker}, late: due ${dateWords(u.due)}.` }));
    }
    return lines.length ? [because(`Owed in our books to people who work or worked for us (wages not paid on their day, redundancy pay): paying ${lines.length} of them now.`, ...lines)] : [];
  }
  /** Winding up: what we owe our staff, and what we withheld from their wages and have not paid over, come before our
   * shareholders (and our other creditors): wages and redundancy pay owed in our books, then the tax withheld, paid
   * from `balance` as far as it goes. What was paid is returned beside the steps. */
  windUpOwed(book: Book, t: number, account: string, balance: number): { steps: Step[]; paid: number } {
    const steps: Step[] = [];
    let paid = 0;
    for (let round = 0; round < 20; round++) {
      const before = this.wagesOwed();
      const s = this.latePay(book, t, account, balance - paid, 0);
      if (!s.length) break;
      steps.push(...s);
      paid += before - this.wagesOwed();
    }
    const lines: C.Call[] = [];
    for (const x of [...this.owed.values()]) {
      if (!(x.amount > 0) || !x.charge.account) continue;
      const amount = Math.min(x.amount, balance - paid);
      if (amount <= 0) continue;
      this.owed.set(x.charge.id, { ...x, amount: x.amount - amount });
      paid += amount;
      lines.push(pay(x.charge.account, amount, { from: account, for: "Winding up: tax withheld from wages, paid over." }));
    }
    if (lines.length) steps.push(because("Winding up: the tax we withheld from wages and had not paid over comes before our shareholders.", ...lines));
    return { steps, paid };
  }
  /** Putting short pay right from here on: their wage order replaced by one at the wage agreed. (What was kept back
   * is paid by whoever answers for us.) */
  payInFull(book: Book, t: number, account: string, agreement: string, why: string): Step[] {
    this.kept.delete(agreement);
    for (let i = this.unpaid.length - 1; i >= 0; i--) if (this.unpaid[i]!.agreement === agreement) this.unpaid.splice(i, 1);
    if (!this.skim.delete(agreement)) return [];
    const a = this.staff(book, t).find((x) => x.id === agreement);
    return a ? this.raise(book, t, account, 0, why, { agreement, wage: this.wageOf(a) }) : [];
  }
  private readonly askedAnswered = new Set<string>();
  /**
   * Asked by one of ours for a rise (docs/behaviour/firm-wants.md): answered in writing, yes or no, by our character
   * (keeping a worker and being thought well of, against paying less), by how long they have been with us, and only
   * where what we have in the bank covers the new wage bill for a few pay periods; saying yes, their wage order is
   * replaced by one at the wage asked, from the next pay day. An employer with no wants of its own answers nothing.
   */
  asked(book: Book, t: number, account: string, balance: number): Step[] {
    const org = this.org;
    if (!org?.lively) return [];
    const steps: Step[] = [];
    for (const r of book.open("variation_request")) {
      if (this.askedAnswered.has(r.id) || !(r.addressed_to ?? []).includes(this.me)) continue;
      this.askedAnswered.add(r.id);
      const a = this.staff(book, t).find((x) => x.id === r.data?.agreement);
      const worker = a?.terms.parties[1];
      if (!a || r.speaks_for !== worker) continue;
      const wage = Math.floor(Number(r.data?.would?.does?.outcome?.money?.amount));
      const now = this.wageOf(a);
      const reply = (granted: boolean, words: string) => say("variation_answer", words, { to: [worker], visible: [this.me, worker], basis: r.id, data: { about: a.id, granted, ...(granted ? { wage } : {}) } });
      const bill = this.staff(book, t).reduce((x, s) => x + this.wageOf(s), 0);
      const can = Number.isSafeInteger(wage) && wage > now && wage <= now * 2 && balance >= org.p.rise_cover_periods * (bill + wage - now);
      const years = (t - (book.signedAt(a.id) ?? t)) / (365 * DAY);
      const g = can ? org.grants("rise", this.ctx.rng(`rise-${r.id}`), Math.max(-1, Math.min(1, years - 1)), t) : { granted: false, chance: 0 };
      org.remember(t, g.granted ? "gave_rise" : "refused_rise", worker, 2_000);
      if (g.granted) steps.push(...this.raise(book, t, account, 0, `${worker} asks for a rise, to ${usd(wage)}: we would sooner keep them (for us, ${g.chance / 100}% of such requests): their wage is ${usd(wage)} from the next pay day.`, { agreement: a.id, wage }),
        because(`Telling ${worker} their rise is granted.`, reply(true, `Granted: your pay is ${usd(wage)} from the next pay day.`)));
      else steps.push(because(can ? `${worker} asks for a rise: no (for us, ${g.chance / 100}% of such requests are granted).` : `${worker} asks for a rise we cannot give.`, reply(false, "Not granted: your pay stays as it is.")));
    }
    return steps;
  }

  /** Pay stopped for these workers (on strike: no pay for time on strike). */
  stop(book: Book, t: number, workers: string[], why: string): Step[] {
    const lines: C.Call[] = [];
    for (const a of this.staff(book, t).filter((x) => workers.includes(x.terms.parties[1]) && !this.stopped.has(x.id))) {
      const order = this.orders.get(a.id);
      if (!order) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      this.stopped.set(a.id, { since: t, lastDue: this.nextDue(book, order, t) - period });
      this.paidTo.delete(a.id);
      lines.push(this.retire(a.id, "Stopped: on strike.", t));
    }
    const out: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) out.push(because(why, ...lines.slice(i, i + 30)));
    return out;
  }

  /**
   * Pay restarted for workers back from a strike: what they earned between their last pay day and the strike, paid now
   * (net of tax), and their wages from now on, a period at a time.
   */
  resume(book: Book, t: number, account: string, workers: string[], why: string): Step[] {
    const law = incomeTaxLaw(book);
    const lines: (C.Call | [string, C.Call])[] = [];
    for (const a of this.staff(book, t).filter((x) => workers.includes(x.terms.parties[1]) && this.stopped.has(x.id))) {
      const { since, lastDue } = this.stopped.get(a.id)!;
      this.stopped.delete(a.id);
      const to = this.payee(book, a);
      if (!to) continue;
      const period = jobTerms(a, a.terms.parties[1]).period;
      const wage = this.wageOf(a);
      // (What the order actually paid, not what we decided when we withdrew it: a pay moment inside the act is paid by the
      // old order. Paid through that moment, nothing before the strike is owed again; and the strike days it paid are
      // taken off the first pay after the return, by starting it that many seconds later: a pay covers the period before it.)
      const paidThrough = Math.max(lastDue, this.paidTo.get(a.id) ?? 0);
      const over = Math.min(period, Math.max(0, paidThrough - since));
      const earned = Math.max(0, Math.floor((wage * Math.min(period, Math.max(0, since - paidThrough))) / period));
      const each = this.offBooks.has(a.id) ? NOTHING_WITHHELD : withheld(law, wage, period), perPay = each.total;
      // (For the part of a pay period worked: that part of what a whole pay withholds, charge by charge.)
      const tax = Math.floor((perPay * earned) / Math.max(1, wage));
      const part = each.parts.map((c) => ({ charge: c.charge, amount: Math.floor((c.amount * earned) / Math.max(1, wage)) }));
      if (part[0]) part[0].amount += tax - part.reduce((x, c) => x + c.amount, 0);
      if (!this.offBooks.has(a.id)) this.owe(law?.id, { total: tax, parts: part }, a.id, earned);
      this.wagesPaid += earned;
      const ref = `wo${this.n++}`;
      this.pendingOrder.set(ref, a.id);
      if (perPay > 0) this.pendingWithhold.set(ref, each);
      if (earned - tax > 0) lines.push(pay(to, earned - tax, { from: account, for: `Wages for ${a.terms.parties[1]} to the strike.` }));
      lines.push([ref, pay(to, wage - perPay, { from: account, every: period, first: period + over, basis: a.id, for: `Wages for ${a.terms.parties[1]}.` })]);
    }
    // (Batched: a program has at most 32 lines, and a wake only so many actions.)
    const steps: Step[] = [];
    for (let i = 0; i < lines.length; i += 30) steps.push(because(why, ...(lines.slice(i, i + 30) as any[])));
    return steps;
  }

  // ---- Hours before heads (docs/behaviour/firms.md): the hours term of an agreement, cut and restored by a paper to the worker ----

  /** What the wage of an agreement is when its hours are whole: the cut's full wage where it is cut, else the wage now. */
  fullWageOf(a: any): number {
    const c = this.cuts.get(a.id);
    return c?.state === "set" ? c.full : this.wageOf(a);
  }
  /** The share of the ordinary hours someone works at `t` (10,000: whole), as our cuts stand. */
  hoursBpsAt(worker: string, t: number): number {
    for (const c of this.cuts.values()) if (c.worker === worker && c.state === "set" && t >= c.from && t < c.until) return c.hoursBps;
    return 10_000;
  }
  /** Whether any of our staff is on cut hours or has been put a cut. */
  get cutting(): boolean { return this.cuts.size > 0; }

  /**
   * The month's look at hours (called by a shop or a factory whose staff outrun its trade, or whose trade has come back).
   * `targetBps`: the share of the ordinary hours the trade expected needs of the staff we have (10,000 or more: all of
   * them). Where the law lets an employer cut hours, we cut across all our staff to that share (never below the law's
   * floor), by a paper to each; where the trade has come back, or the law's longest spell is run, hours are restored by
   * another. Returns the steps and the share our staff will work, which the module reads to see whether a surplus of
   * hands is left (and only then lets anyone go). A world with no such law, or one that does not allow it: nothing, 10,000.
   */
  reviewHours(book: Book, t: number, targetBps: number, stepBps = 1_000): { steps: Step[]; achieved: number; why: string } {
    const none = { steps: [] as Step[], achieved: 10_000, why: "" };
    const law = hoursLaw(book);
    if (this.o.does?.pay === false || this.o.does?.hire === false) return none;
    const staff = this.staff(book, t).filter((a) => !this.noticed.has(a.id) && !byTheDay(a));
    const steps: Step[] = [];
    const restore = (why: string, only?: Cut[]) => {
      for (const c of only ?? [...this.cuts.values()]) {
        this.cuts.delete(c.agreement);
        const text = `Your hours are back to the ordinary ${ordinaryHours(book.records.get(c.agreement), c.worker, law)} a week, and your pay with them: ${usd(c.full)} every ${durationWords(jobTerms(book.records.get(c.agreement), c.worker).period)}.`;
        const at = t + HOURS_GRACE_DAYS * DAY;
        if (c.state === "set") this.due.push({ at, agreement: c.agreement, wage: c.full, why: `Hours restored: ${c.worker} back on ${usd(c.full)}.` });
        steps.push(because(why, say("hours_restored", text, { to: [c.worker], visible: [this.me, c.worker], basis: c.agreement, data: { employer: this.me, agreement: c.agreement, wage: c.full, hours_bps: 10_000, from: at, ...(law ? { law: law.id } : {}) } })));
      }
    };
    // The law's longest spell: a cut that has run it is ended, and we cut no more for as long again.
    const over = [...this.cuts.values()].filter((c) => c.state === "set" && t >= c.until - HOURS_GRACE_DAYS * DAY);
    if (over.length) { restore(`The longest spell the law allows on cut hours (${law?.max_days} days) is run for ${over.length} of our staff: back to their ordinary hours.`, over); this.noCutUntil = t + (law?.max_days ?? 0) * DAY; }
    // Proposals not agreed to in time are dropped, and not put again this spell.
    for (const c of [...this.cuts.values()]) if (c.state === "proposed" && t > c.replyBy) { this.cuts.delete(c.agreement); this.declined.add(c.agreement); }
    if (!law || law.may_cut === "no") {
      if (this.cuts.size) restore("The law no longer lets us cut hours: back to the ordinary.");
      return { ...none, steps };
    }
    if (targetBps >= 10_000 - stepBps) {
      if (this.cuts.size) restore("Trade has come back to what our staff at their ordinary hours need: their hours are restored.");
      this.declined.clear();
      return { steps, achieved: 10_000, why: "" };
    }
    if (t < this.noCutUntil || !staff.length) return { steps, achieved: this.achieved(staff), why: "" };
    const goal = Math.min(10_000, Math.max(law.floor_bps, Math.ceil(targetBps / 100) * 100));
    const each = staff.length >= law.pay_owed_from ? law.pay_bps : 0;
    let changed = 0;
    for (const a of staff) {
      const worker = a.terms.parties[1] as string, now = this.cuts.get(a.id);
      if (this.declined.has(a.id)) continue;
      const current = now?.hoursBps ?? 10_000;
      if (Math.abs(current - goal) < stepBps) continue;
      const full = now?.state === "set" ? now.full : this.wageOf(a);
      const paidBps = paidShare(goal, each);
      const wage = Math.floor((full * paidBps) / 10_000);
      const ordinary = ordinaryHours(a, worker, law);
      const notice = Math.max(law.notice_days, HOURS_GRACE_DAYS);
      const since = now?.since ?? t;
      const until = law.max_days > 0 ? since + law.max_days * DAY : t + 20 * 365 * DAY;
      const from = t + notice * DAY;
      const period = jobTerms(a, worker).period;
      const consent = law.may_cut === "consent";
      const hours = Math.round((ordinary * goal) / 100) / 100;
      const text = `${consent ? "We ask you to agree to" : "We are cutting"} your hours from ${ordinary} a week to ${hours}, ${consent ? "from the day you agree" : `from ${dateWords(from)}`}, because there is not the trade for everyone's full week. Your pay for them is ${usd(wage)} every ${durationWords(period)}, where it was ${usd(full)}.${law.pay_bps > 0 && each > 0 ? ` (The law owes ${law.pay_bps / 100}% of pay for hours not worked.)` : ""}${law.max_days > 0 ? ` It is for at most ${law.max_days} days.` : ""} We would sooner do this than let anyone go.`;
      this.cuts.set(a.id, { agreement: a.id, worker, full, hoursBps: goal, paidBps, wage, from, until, since, state: consent ? "proposed" : "set", replyBy: t + Math.max(law.notice_days, 7) * DAY });
      if (!consent) this.due.push({ at: from, agreement: a.id, wage, why: `Hours cut to ${hours} a week: ${worker} on ${usd(wage)} from the next pay.` });
      steps.push(because(`${now ? "Changing" : "Cutting"} ${worker}'s hours to ${goal / 100}% of the ordinary, in place of letting anyone go (docs/behaviour/firms.md, "Hours before heads").`,
        say("hours_notice", text, { to: [worker], visible: [this.me, worker], basis: a.id, data: { employer: this.me, agreement: a.id, hours_bps: goal, ordinary_week_hours: Math.round(ordinary), minutes_week: Math.round(hours * 60), wage, was: full, from, until, consent, consent_bps: law.consent_bps, law: law.id, reply_by: t + Math.max(law.notice_days, 7) * DAY } })));
      changed++;
    }
    return { steps, achieved: this.achieved(staff), why: changed ? `cut hours across our staff to ${goal / 100}% of the ordinary` : "" };
  }
  /** The average share of the ordinary hours our staff work, counting what is put to them for their agreement. */
  private achieved(staff: any[]): number {
    return staff.length ? Math.round(staff.reduce((x, a) => x + (this.cuts.get(a.id)?.hoursBps ?? 10_000), 0) / staff.length) : 10_000;
  }
  /** Agreements to cuts we put (an `hours_reply` of the worker's), and the wage changes whose day has come. */
  applyHours(book: Book, t: number, account: string): Step[] {
    const steps: Step[] = [];
    const replies = book.open("hours_reply").filter((r) => (r.addressed_to ?? []).includes(this.me));
    for (const r of replies) {
      const c = this.cuts.get(String(r.data?.agreement));
      if (!c || c.state !== "proposed" || r.speaks_for !== c.worker || this.handled.has(r.id)) continue;
      this.handled.add(r.id);
      if (r.data?.agree === true) {
        c.state = "set"; c.from = Math.max(t + HOURS_GRACE_DAYS * DAY, c.from);
        this.due.push({ at: c.from, agreement: c.agreement, wage: c.wage, why: `${c.worker} has agreed to the cut: on ${usd(c.wage)} from the next pay.` });
      } else { this.cuts.delete(c.agreement); this.declined.add(c.agreement); }
    }
    const now = this.due.filter((d) => d.at <= t);
    for (const d of now) {
      this.due.splice(this.due.indexOf(d), 1);
      if (this.noticed.has(d.agreement) || !this.staff(book, t).some((a) => a.id === d.agreement)) { this.cuts.delete(d.agreement); continue; }
      steps.push(...this.raise(book, t, account, 0, d.why, { agreement: d.agreement, wage: d.wage, short: d.short }));
    }
    return steps;
  }

  /** Let one worker go (the most recent hire not already under notice), with the notice their contract gives. */
  letGo(book: Book, t: number, why: string, reason: string): Step[] {
    const staff = this.staff(book, t);
    const last = staff.filter((a) => !this.noticed.has(a.id)).sort((x, y) => book.signedAt(y.id)! - book.signedAt(x.id)!)[0];
    if (!last) return [];
    this.noticed.set(last.id, t);
    const owes = this.redundancyOwed(book, t, last, staff.length);
    if (owes.sum > 0) this.severance.set(last.id, owes.sum);
    return [because(owes.sum > 0 ? `${why} Under ${owes.law}, ${owes.words}: ${usd(owes.sum)}, paid when the job ends.` : why, notice(last.id, reason))];
  }

  /** How long the most recent hire we are keeping has been with us, in years (nobody: 0). */
  lastHireYears(book: Book, t: number): number {
    const last = this.staff(book, t).filter((a) => !this.noticed.has(a.id)).sort((x, y) => book.signedAt(y.id)! - book.signedAt(x.id)!)[0];
    return last ? this.serviceYears(book, t, last) : 0;
  }
  /** How long someone has worked for us under an agreement, in years (those we began with: as long as the run). */
  serviceYears(book: Book, t: number, a: any): number {
    return Math.max(0, (t - (book.signedAt(a.id) ?? a.at ?? t)) / (365 * DAY));
  }
  /** What the law on ending a job says we owe someone let go for redundancy, beyond their notice: redundancy pay for
   * their service (unless we are smaller than the law's small employer), and pay for the notice the law gives them
   * beyond what their agreement does. In weeks of their pay. No such law in the world: nothing. */
  redundancyOwed(book: Book, t: number, a: any, staff: number): { sum: number; law: string; words: string } {
    const law = terminationLaw(book);
    if (!law || byTheDay(a)) return { sum: 0, law: "", words: "" };
    const terms = jobTerms(a, a.terms.parties[1]), years = this.serviceYears(book, t, a);
    const weekly = (this.fullWageOf(a) * 7 * DAY) / terms.period;
    const small = !!law.small_employer_under && staff < law.small_employer_under;
    const redundancy = small ? 0 : weeksAt(law.redundancy_pay, years);
    const agreed = (a.terms.termination?.find((x: any) => x.party === this.me)?.notice ?? 0) / (7 * DAY);
    const lieu = Math.max(0, weeksAt(law.notice, years) - agreed);
    const sum = Math.floor(weekly * (redundancy + lieu));
    return { sum, law: law.id, words: [redundancy > 0 ? `${redundancy} weeks' redundancy pay` : "", lieu > 0 ? `${Math.round(lieu * 10) / 10} weeks' pay for notice beyond the agreement's` : ""].filter(Boolean).join(" and ") + ` for ${Math.floor(years)} years' service` };
  }

  /** Let everyone go, with the notice their contracts give (in batches: a program has at most 32 lines). */
  letGoAll(book: Book, t: number, why: string, reason: string): Step[] {
    const all = this.staff(book, t).filter((a) => !this.noticed.has(a.id));
    for (const a of all) {
      this.noticed.set(a.id, t);
      const owes = this.redundancyOwed(book, t, a, all.length);
      if (owes.sum > 0) this.severance.set(a.id, owes.sum);
    }
    const out: Step[] = [];
    for (let i = 0; i < all.length; i += 30) out.push(because(why, ...all.slice(i, i + 30).map((a) => notice(a.id, reason))));
    return out;
  }
}
