// Everyday frictions, and how they are heard (docs/behaviour/frictions.md; docs/design/ai-citizens.md 10k step 2b).
//
// Things really go wrong: a home falls into disrepair and the repair asked for is not done; a bond is kept; pay comes
// short; a bill is wrong; a claim is wrongly refused; a road is left; a neighbour is loud; what was bought is faulty.
// Each is a mechanism where its cause lives (a building's age and its owner's upkeep, an employer's character and cash,
// an office's load), at a rate the world's profile gives with its source and the world's dial scales
// (`dials.friction_bps`; 0 or absent: none of it arises). Nothing here blocks or carries anything out: a friction leaves
// a state of the world or a paper; whoever suffers it puts up with it, asks, or goes to a venue that says it hears
// such things (an offer's `hears`); a venue decides by its own procedure, and its decision is words that the other
// side obeys or does not.
//
// This file is the shared part: the dial and the arithmetic of a rate, the papers a grievance travels on, and what an
// organisation does when it is asked to put something right, told of a complaint, or ordered to (`Respondent`).
// Arithmetic only; every draw is from a stream the module is handed.

import { cites } from "../contracts";
import type { StatementRecord } from "../contracts";
import { cents } from "../money";
import type { Rng } from "../rng";
import { because, type Book, DAY, Occurrences, pay, say, type Step, usd } from "./common";
import { dateWords } from "../forms";
import { KIND } from "./decisions";
import type { Org } from "./orgwants";
import { swayed } from "./wants";

/** The world's dial for how much goes wrong (basis points; 10,000: the profile's rates as sourced; 0: nothing). */
export const frictionDial = (world: { dials?: { [name: string]: unknown } }): number => Math.max(0, Math.floor(Number(world.dials?.friction_bps ?? 0)) || 0);

/** The chance, in parts per million, that something with a yearly rate (basis points of the exposed, a year) happens
 * in `days`, at the dial. Whole numbers, so the same on every machine; linear, which is exact enough while a period's
 * chance is small, and never over certainty. */
export function chancePpm(perYearBps: number, days: number, dialBps: number): number {
  if (!(perYearBps > 0) || !(dialBps > 0) || !(days > 0)) return 0;
  return Math.min(1_000_000, Math.floor((perYearBps * dialBps * days) / (100 * 365)));
}
export const arises = (rng: Rng, perYearBps: number, days: number, dialBps: number): boolean => rng.below(1_000_000) < chancePpm(perYearBps, days, dialBps);

/** The papers a grievance travels on. A tribunal keeps its own forms (docs/behaviour/justice.md): an offer's `hears`
 * names the form an application to it is made on. */
export const PAPER = {
  /** To the other side: put this right. */
  request: KIND.request,
  /** Their answer. */
  answer: "remedy_answer",
  /** To a venue that hears the matter (unless its `hears` names another form). */
  application: "application",
  /** The venue to the one complained of: what is said, and by when to answer. */
  notice: "complaint_notice",
  /** Their answer to the venue. */
  response: "complaint_response",
  /** What the venue decided, to both. */
  decision: "venue_decision",
} as const;

/** What a grievance says, on any of its papers (`data`). */
export interface Matter {
  /** The matter, in the world's labels: what a venue's `hears` names. */
  matter: string;
  /** The other side. */
  against?: string;
  /** The paper it is about, where there is one (a bill, a decision, an agreement, a receipt). */
  about?: string;
  /** Money sought, and the account to pay it into. */
  amount?: number;
  account?: string;
  /** The building it is about (disrepair, a service not done). */
  structure?: string;
  /** What was asked of the other side first, if anything. */
  request?: string;
  /** In a word, what is sought where it is not money: `repair`, `stop`, `review`, `done`. */
  seeks?: string;
}

/** What a venue found (its decision's `finding`), in the tribunal's words where it has them. */
export type Finding = "pay" | "do" | "set_aside" | "settled" | "dismissed" | "rejected" | "referred" | "published" | "plan" | "possession";

/** What an organisation's own books say of something complained of: what it owes, whether what was asked is done,
 * or nothing (it cannot know: goods said to be faulty). */
export interface Truth { owed?: number; done?: boolean; wrong?: boolean }

export interface RespondParams {
  /** Asked to put something right, by matter: how often an organisation of the town's mean character does (`other`
   * for the rest). The profile's, with sources (docs/behaviour/frictions.md). */
  grant_bps: { [matter: string]: number };
  /** Not doing it: how often it at least says so (the rest is silence). PLACEHOLDER. */
  answers_bps: number;
  /** Told of a complaint by a venue: how often it answers. PLACEHOLDER. */
  responds_bps: number;
  /** Ordered: how often it does as ordered unasked again; recommended to: how often it does. */
  comply_bps: number;
  heed_bps: number;
  /** How far a standard deviation of character sways each (a share of the rate). PLACEHOLDER. */
  sway: number;
}
export const RESPOND_DEFAULTS: RespondParams = { grant_bps: { other: 5_000 }, answers_bps: 5_000, responds_bps: 8_000, comply_bps: 8_000, heed_bps: 6_000, sway: 0.5 };
export const respondParams = (given: Partial<RespondParams> | undefined): RespondParams => ({ ...RESPOND_DEFAULTS, ...(given ?? {}), grant_bps: { ...RESPOND_DEFAULTS.grant_bps, ...(given?.grant_bps ?? {}) } });

/**
 * An organisation asked to put something right, told of a complaint, or ordered to: what its post does about each
 * paper, once. `truth`: what its own books say (it answers a venue truthfully when it answers: nobody lies yet;
 * what it may do is not answer, and not pay). `remedy`: the steps that put a thing right other than by paying (a
 * repair ordered, a bill corrected); `afford`: what it can pay now.
 *
 * Whether it grants, answers, complies or heeds is its character's (docs/behaviour/firm-wants.md): keeping those it
 * deals with and being thought well of, against paying less; one with no character (the dial for initiative off)
 * answers at the profile's rates.
 */
export class Respondent {
  private readonly handled = new Set<string>();
  /** Which request, notice or decision each paper is to us: by who and what about, not by its number on file. */
  private readonly nth = new Occurrences();
  readonly p: RespondParams;
  /** What it did, for whoever counts (nothing reads it back). */
  readonly counts: { [what: string]: number } = {};
  constructor(
    private readonly rng: (purpose: string) => Rng,
    private readonly me: string,
    private readonly org: Org | null,
    private readonly o: {
      params?: Partial<RespondParams>;
      truth: (m: Matter, from: string, book: Book, t: number) => Truth | undefined;
      remedy?: (m: Matter, from: string, t: number, why: string, basis: string) => Step[] | undefined;
      /** What putting it right would cost us beyond what is owed (a repair to be paid for): we do it only if we can. */
      cost?: (m: Matter) => number;
      /** Forms of the venues it is answerable to, beyond the common ones (a tribunal's). */
      forms?: { notice: string; response: string; decision: string }[];
      /** Whether it answers requests to put something right itself (default: it does). An office that looks at its own decisions again by the law's route
       * (`Reconsiderations`, foundations F8) answers its requests there, and uses this for the venues' notices and orders only. */
      requests?: boolean;
    },
  ) {
    this.p = respondParams(o.params);
  }

  private lean(): number {
    const c = this.org?.lively ? this.org.character : undefined;
    return c ? (c.keep + c.standing) / 2 - c.pay_less : 0;
  }
  private draw(key: string, bps: number, lean = this.lean()): boolean {
    return this.rng(key).below(10_000) < swayed(bps, lean, this.p.sway);
  }
  private count(what: string) {
    this.counts[what] = (this.counts[what] ?? 0) + 1;
    this.org?.count(what);
  }

  steps(book: Book, t: number, account: string | undefined, balance: number): Step[] {
    const steps: Step[] = [];
    let left = balance;
    const mine = (r: StatementRecord) => (r.addressed_to ?? []).includes(this.me) && !this.handled.has(r.id);
    // ---- asked to put something right ----
    for (const r of this.o.requests === false ? [] : book.open(PAPER.request).filter(mine)) {
      this.handled.add(r.id);
      const m = (r.data ?? {}) as Matter;
      const from = r.speaks_for!;
      const truth = this.o.truth(m, from, book, t);
      // (What our books say is owed, where they say; what is asked, where they cannot say; nothing, where they say none is.)
      const owed = truth?.owed !== undefined ? truth.owed : m.amount !== undefined && truth?.wrong !== false ? cents(m.amount) : 0;
      const nothing = truth !== undefined && (truth.wrong === false || truth.done === true || (truth.owed !== undefined && truth.owed <= 0 && truth.wrong !== true && truth.done !== false));
      const which = this.nth.key(r.id, from, m.matter, m.structure ?? m.about);
      const rate = this.p.grant_bps[m.matter] ?? this.p.grant_bps.other ?? 5_000;
      const cost = Math.max(0, owed) + (this.o.cost?.(m) ?? 0);
      const granted = !nothing && this.draw(`remedy-${which}`, rate) && (cost <= 0 || (account !== undefined && left >= cost));
      if (granted) {
        const how = this.o.remedy?.(m, from, t, `Asked by ${from} to put right ${m.matter.replace(/_/g, " ")}: doing it.`, r.id) ?? [];
        steps.push(because(`Asked by ${from} to put something right (${m.matter.replace(/_/g, " ")}${owed > 0 ? `, ${usd(owed)}` : ""}): we will.`,
          say(PAPER.answer, `Answer to your request ${r.id}: yes${owed > 0 ? `, ${usd(owed)} is paid to you` : ""}.`, { to: [from], visible: [from, this.me], basis: r.id, data: { request: r.id, matter: m.matter, granted: true, ...(owed > 0 ? { amount: owed } : {}) } }),
          ...(owed > 0 && m.account && account ? [pay(m.account, owed, { from: account, for: `Putting right: ${m.matter.replace(/_/g, " ")}.`, settles: r.id })] : [])));
        steps.push(...how);
        left -= cost;
        this.count("remedy_granted");
        this.org?.remember(t, "remedy_granted", from);
      } else if (nothing || this.draw(`answers-${which}`, this.p.answers_bps)) {
        steps.push(because(`Asked by ${from} to put something right (${m.matter.replace(/_/g, " ")}): ${nothing ? "our books show nothing to put right" : "we will not"}; saying so.`,
          say(PAPER.answer, `Answer to your request ${r.id}: no${nothing ? ": our records show nothing owed" : ""}.`, { to: [from], visible: [from, this.me], basis: r.id, data: { request: r.id, matter: m.matter, granted: false, ...(nothing ? { reason: "nothing owed on our records" } : {}) } })));
        this.count("remedy_refused");
        this.org?.remember(t, "remedy_refused", from);
      } else this.count("remedy_ignored");
    }
    // ---- told of a complaint by a venue: answering from our books ----
    const forms = [{ notice: PAPER.notice, response: PAPER.response, decision: PAPER.decision }, ...(this.o.forms ?? [])];
    for (const f of forms) {
      for (const n of book.open(f.notice).filter(mine)) {
        const m = (n.data ?? {}) as Matter & { application?: string; applicant?: string };
        if (typeof m.matter !== "string" || m.against !== this.me || !m.application) continue; // (a tribunal's notices of other kinds are the module's own)
        this.handled.add(n.id);
        if (!this.draw(`responds-${this.nth.key(n.id, n.speaks_for, String(m.applicant ?? ""), m.matter, m.structure ?? m.about)}`, this.p.responds_bps, this.org?.lively ? this.org.character.standing : 0)) { this.count("complaint_unanswered"); continue; }
        const truth = this.o.truth(m, String(m.applicant ?? ""), book, t);
        const venue = n.speaks_for!;
        steps.push(because(`${venue} tells us of a complaint by ${m.applicant} (${m.matter.replace(/_/g, " ")}): answering from our books.`,
          say(f.response, `Answer on ${m.application}: ${truth?.owed !== undefined ? `our records show ${usd(truth.owed)} owed` : truth?.done !== undefined ? (truth.done ? "it is done" : "it is not yet done") : truth?.wrong !== undefined ? (truth.wrong ? "the paper was wrong" : "the paper was right") : "we have nothing on our records about it"}.`,
            { to: [venue], visible: [venue, this.me, ...(m.applicant ? [String(m.applicant)] : [])], basis: m.application, data: { application: m.application, ...(truth ?? {}), known: truth !== undefined } })));
        this.count("complaint_answered");
      }
      // ---- a decision against us: doing as ordered or recommended, or not ----
      for (const d of book.open(f.decision).filter((r) => !this.handled.has(r.id) && r.data?.against === this.me && typeof r.data?.matter === "string" && (r.data?.finding === "pay" || r.data?.finding === "do" || r.data?.finding === "set_aside"))) {
        this.handled.add(d.id);
        const x = d.data as any;
        const binding = x.binding !== false;
        const amount = (x.finding === "pay" ? cents(x.amount ?? 0) : 0) + (x.finding === "do" ? this.o.cost?.({ matter: x.matter, structure: x.structure }) ?? 0 : 0);
        const will = this.draw(`complies-${this.nth.key(d.id, d.speaks_for, String(x.applicant ?? ""), String(x.matter), x.structure ?? x.about)}`, binding ? this.p.comply_bps : this.p.heed_bps, this.org?.lively ? this.org.character.standing - this.org.character.pay_less / 2 : 0) && (amount <= 0 || (account !== undefined && left >= amount));
        if (!will) { this.count(binding ? "order_defied" : "recommendation_unheeded"); this.org?.remember(t, binding ? "order_defied" : "recommendation_unheeded", String(x.applicant ?? "")); continue; }
        const m: Matter = { matter: x.matter, against: this.me, ...(x.about ? { about: x.about } : {}), ...(x.structure ? { structure: x.structure } : {}), ...(x.seeks ? { seeks: x.seeks } : {}) };
        const why = `${d.speaks_for} ${binding ? "orders" : "recommends"} that we ${x.finding === "pay" ? `pay ${x.applicant} ${usd(amount)}` : x.finding === "do" ? `put right ${String(x.matter).replace(/_/g, " ")}` : "withdraw the paper"}: doing so.`;
        if (x.finding === "pay" && amount > 0 && x.to && account) steps.push(because(why, pay(String(x.to), amount, { from: account, for: `Under ${d.id}.`, settles: d.id })));
        left -= amount;
        // (And whatever puts it right from here on: the work done, the paper withdrawn, the pay set right.)
        steps.push(...(this.o.remedy?.(m, String(x.applicant ?? ""), t, why, d.id) ?? []));
        this.count(binding ? "order_obeyed" : "recommendation_heeded");
        this.org?.remember(t, binding ? "order_obeyed" : "recommendation_heeded", String(x.applicant ?? ""));
      }
    }
    return steps;
  }
}

/** The copy of a paper tendered to a venue that cannot see what passed between the parties. */
export const tendered = (r: any): unknown => (r ? { id: r.id, record: r.record, kind: r.kind, at: r.at, speaks_for: r.speaks_for, addressed_to: r.addressed_to, data: r.data } : undefined);

/**
 * What a person who applies to a venue states about what they apply for, from their own record: the dispute (what it
 * is, against whom, about which paper or place), the sum if their record shows one, what they seek, and the dates (when it
 * arose, when they asked the other side and what came of it). A real application form asks for exactly this, and a
 * venue turns away one that says nothing (docs/behaviour/justice.md, "Particulars"). A sum is stated only where the
 * person's record has one: nothing is made up for them.
 */
export function particularsOf(g: { matter: string; party: string; since: number; about?: string; amount?: number; structure?: string; seeks?: string; asked?: { t: number }; answer?: string }, t: number): string {
  const words = g.matter.replace(/_/g, " ");
  const arose = g.since < 0 ? `${Math.ceil(-g.since / DAY)} days before the year began` : `on ${dateWords(g.since)}`;
  const asked = g.asked ? `we asked them ${g.asked.t < 0 ? `${Math.ceil(-g.asked.t / DAY)} days before the year began` : `on ${dateWords(g.asked.t)}`}${g.answer === "refused" ? " and they refused" : g.answer === "ignored" ? " and they have not answered" : g.answer === "granted" ? " and they agreed, but it is not done" : ""}` : "we have not yet asked them";
  return `${words} against ${g.party}${g.about ? `, about ${g.about}` : ""}${g.structure ? `, at ${g.structure}` : ""}${g.seeks ? `; what we seek: ${g.seeks.replace(/_/g, " ")}` : ""}${g.amount ? `; the sum: ${usd(g.amount)}` : ""}; it arose ${arose}; ${asked}; made on ${dateWords(t)}.`;
}

/** Whether an application says what it is about: it gives its particulars, or names a paper, a place, a sum, what is sought, or evidence. */
export const hasParticulars = (d: { [k: string]: any } | undefined): boolean =>
  !!d && ((typeof d.particulars === "string" && d.particulars.trim() !== "") || d.about !== undefined || d.structure !== undefined || d.seeks !== undefined || Number(d.amount) > 0 || d.evidence !== undefined);

/** Whether a response on file answers an application (the latest from the respondent). */
export const responseTo = (book: Book, kind: string, application: string, from: string): StatementRecord | undefined =>
  book.open(kind).filter((r) => cites(r, application) && r.speaks_for === from).sort((a, b) => b.at - a.at)[0];

export const days = (seconds: number): number => Math.floor(seconds / DAY);
