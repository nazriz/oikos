// What a decision waits for, and how it is looked at again (docs/design/foundations.md, law 5, step F8; docs/behaviour/decisions.md).
//
// Review and appeal of a decision are routes the law states, as data, for any kind of decision: the world publishes a law
// (`data.decisions`, a list of rules, each for a kind of decision and, where it differs by payment, for some payments only) saying
//
//   - `needs`: what the decision waits for before it is made: papers from the claimant, a confirmation from the claimant's last
//     employer; within how many days; and what comes of it when they do not come (`else`: refuse, or decide on what is on hand);
//   - `review`: that the office whose decision it was will look at it again if asked within so many days, on what grounds, and
//     whether an appeal may be made only after that;
//   - `appeal`: the matter a venue that can set the decision aside hears, within how many days of the decision (or the review's
//     answer), on what grounds, and what applying costs;
//   - `refused_by`: who may refuse, where the office is a head and staff (the staff's procedure says it).
//
// Nothing here makes a decision wait or come out differently by itself. The office writes the request for papers (an act that takes
// its performer's time), the claimant answers when they do (theirs), the employer answers from its own books (its staff's time);
// the office decides at its next round when what it waited for has come or its time has run, and a review is the office doing the
// deciding again on the facts then on file, as work with its time. The kernel knows none of this: these are statements.

import type { StatementRecord } from "../contracts";
import { because, type Book, DAY, madeAt, Occurrences, say, type Step } from "./common";

/** The papers this runs on. A request to look at a decision again is the one request of every grievance (docs/behaviour/frictions.md). */
export const KIND = {
  /** To whoever did it or put it wrong: look at this again / put this right. */
  request: "review_request",
  /** Their answer, to the one who asked. */
  answer: "remedy_answer",
  /** The office's record that it looked at one of its decisions again: what was found. */
  review: "decision_review",
  /** The office to a claimant: send these papers, by this day. */
  evidence_request: "evidence_request",
  /** The claimant to the office: the papers. */
  evidence: "evidence",
  /** The office to an organisation: confirm this about a person, by this day. */
  confirmation_request: "confirmation_request",
  /** The organisation's answer, from its own books. */
  confirmation: "confirmation_answer",
} as const;

export interface Need {
  id: string;
  /** From whom: the claimant (their papers), or the claimant's last employer (found from the pay reports on the office's file). */
  from: "claimant" | "employer";
  /** In words: what is asked for. */
  what: string;
  /** Within so many days of the asking. */
  within_days: number;
  /** When it has not come in time: refuse the claim, or decide on what is on hand. */
  else: "refuse" | "decide";
}
export interface ReviewRoute {
  /** Asked within so many days of the decision. */
  within_days: number;
  /** On what grounds, in words. */
  grounds: string;
  /** An appeal lies only after a review has been asked for and answered. */
  required?: boolean;
}
export interface AppealRoute {
  /** The matter a venue that can set the decision aside says it hears. */
  matter: string;
  /** Within so many days of the decision, or of the review's answer where a review is required. */
  within_days: number;
  grounds: string;
  /** What applying costs, in the smallest unit of the money (none: nothing). */
  fee?: number;
}
export interface DecisionLaw {
  /** The kind of decision: the kind of statement the office makes. */
  kind: string;
  name: string;
  /** For these payments only (a support payment's id); none: for every decision of the kind. */
  payments?: string[];
  needs?: Need[];
  review?: ReviewRoute;
  appeal?: AppealRoute;
  /** Who may refuse where the office is a head and staff: the head alone (`office-holder`), or the staff as well. */
  refused_by?: "office-holder" | "staff";
}

/** The law on file for a decision of a kind (and, where it differs by payment, for that payment): the latest published and not withdrawn. */
export function decisionLaw(book: Book, kind: string, payment?: string): DecisionLaw | undefined {
  let best: DecisionLaw | undefined, bestAt = -1;
  for (const l of book.open("law")) {
    const list = l.data?.decisions;
    if (!Array.isArray(list)) continue;
    for (const d of list as DecisionLaw[]) {
      if (!d || d.kind !== kind) continue;
      const fits = d.payments === undefined || (payment !== undefined && d.payments.includes(payment));
      if (!fits) continue;
      // (A rule for named payments is the more particular, and wins over one for the kind.)
      const score = (d.payments ? 1e12 : 0) + l.at;
      if (score > bestAt) { best = d; bestAt = score; }
    }
  }
  return best;
}

/** The law on file whose appeal is about this matter (a venue that hears it reads the days an appeal may be made in). */
export function appealLaw(book: Book, matter: string): DecisionLaw | undefined {
  let best: DecisionLaw | undefined, bestAt = -1;
  for (const l of book.open("law")) {
    if (!Array.isArray(l.data?.decisions)) continue;
    for (const d of l.data!.decisions as DecisionLaw[]) if (d?.appeal?.matter === matter && l.at >= bestAt) { best = d; bestAt = l.at; }
  }
  return best;
}

/** What a rule says, in words a law's text can carry (neutral: the places' figures are the profile's). */
export function decisionsInWords(rules: DecisionLaw[], written: (amount: number) => string): string {
  return rules.map((r) => {
    const parts: string[] = [];
    for (const n of r.needs ?? []) parts.push(`before it is decided, ${n.from === "claimant" ? "the claimant is asked for" : "the claimant's last employer is asked to confirm"} ${n.what}, to send it within ${n.within_days} days; ${n.else === "refuse" ? "if it does not come in time, the claim is refused" : "if it does not come in time, the claim is decided on what is on hand"}`);
    if (r.review) parts.push(`the office that made the decision will look at it again if asked within ${r.review.within_days} days of it (${r.review.grounds})${r.review.required ? ", and an appeal lies only after that" : ""}`);
    if (r.appeal) parts.push(`it may be appealed to a body that hears ${r.appeal.matter.replace(/_/g, " ")} and can set it aside, within ${r.appeal.within_days} days of ${r.review?.required ? "the answer to the review" : "the decision"} (${r.appeal.grounds}); ${r.appeal.fee ? `applying costs ${written(r.appeal.fee)}` : "applying costs nothing"}`);
    if (r.refused_by === "office-holder") parts.push("where the office has staff under a head, only the head refuses a claim");
    if (r.refused_by === "staff") parts.push("the office's staff may refuse a claim");
    return `${r.name}${r.payments ? ` (${r.payments.join(", ")})`: ""}: ${parts.join("; ")}.`;
  }).join(" ");
}

/** The time a decision's review or appeal may still be asked, from its date: whole days left (negative: gone). */
export const daysLeft = (from: number, within_days: number, t: number): number => within_days - Math.floor((t - from) / DAY);

/**
 * What a decision waits for, for an office that decides claims. Per claim: the requests it has made, what has come, what is late.
 * It makes the requests (each an act of the office, which takes its performer's time) and reads the answers on the file; it decides
 * nothing. `state(...)` is asked at each round of the office, for each claim not yet decided:
 *   - `ready`: nothing is left to wait for (nothing was needed; everything has come; or what did not come in time is to be decided
 *     without, as the law says);
 *   - `waiting`: something is out and not yet late (the claim stays where it is);
 *   - `lapsed`: something did not come in time and the law says refuse: the reason is in words.
 */
export class Waits {
  /** need key (claim|need) -> when we asked and the day it is due by. */
  private readonly asked = new Map<string, { at: number; by: number; request?: string }>();
  private readonly nth = new Occurrences();
  constructor(private readonly me: string) {}

  /** The employer to ask: the last one that reported pay for the claimant to us (the office's own file of reports). */
  static employerOf(book: Book, me: string, who: string): string | undefined {
    // Whom the claimant's own papers name as their last employer (what they send with a claim), else whoever last reported pay for them.
    const named = book.open(KIND.evidence).filter((r) => r.speaks_for === who && (r.addressed_to ?? []).includes(me) && typeof r.data?.last_employer === "string").sort((a, b) => b.at - a.at)[0];
    if (named) return named.data!.last_employer as string;
    let best: { at: number; by: string } | undefined;
    for (const r of book.all("withholding_report")) {
      if (!(r.addressed_to ?? []).includes(me) || !r.speaks_for || !Array.isArray(r.data?.staff)) continue;
      if (!(r.data!.staff as { worker: string }[]).some((l) => l.worker === who)) continue;
      if (!best || r.at > best.at) best = { at: r.at, by: r.speaks_for };
    }
    return best?.by;
  }

  state(book: Book, law: DecisionLaw | undefined, c: StatementRecord, t: number): { state: "ready"; steps: Step[] } | { state: "waiting"; steps: Step[] } | { state: "lapsed"; why: string; steps: Step[] } {
    const needs = law?.needs ?? [];
    const steps: Step[] = [];
    const who = c.speaks_for!;
    let waiting = false, lapsed: string | undefined;
    for (const n of needs) {
      const key = `${c.id}|${n.id}`;
      const came = n.from === "claimant"
        ? book.open(KIND.evidence).find((r) => r.speaks_for === who && (r.addressed_to ?? []).includes(this.me) && r.data?.claim === c.id && r.data?.need === n.id)
        : book.open(KIND.confirmation).find((r) => (r.addressed_to ?? []).includes(this.me) && r.data?.claim === c.id && r.data?.need === n.id);
      if (came) continue;
      let asked = this.asked.get(key);
      if (!asked) {
        const employer = n.from === "employer" ? Waits.employerOf(book, this.me, who) : undefined;
        if (n.from === "employer" && !employer) {
          // (Nobody to ask yet: the claimant's papers may name their last employer, so while those are out we wait; once they are in, or none are asked for, and
          // no one is named and no pay was ever reported for the claimant, what cannot be had is not waited for.)
          if (needs.some((x) => x.from === "claimant" && !book.open(KIND.evidence).some((r) => r.speaks_for === who && (r.addressed_to ?? []).includes(this.me) && r.data?.claim === c.id && r.data?.need === x.id) && t < (this.asked.get(`${c.id}|${x.id}`)?.by ?? -Infinity))) waiting = true;
          continue;
        }
        asked = { at: t, by: t + n.within_days * DAY };
        this.asked.set(key, asked);
        const data = { claim: c.id, need: n.id, what: n.what, by: asked.by, ...(n.from === "employer" ? { about: who } : {}) };
        steps.push(because(n.from === "claimant" ? `Claim ${c.id} waits for what the law asks of the claimant (${n.what}): asking ${who}, to send it within ${n.within_days} days.` : `Claim ${c.id} waits for ${employer} to confirm ${n.what}: asking, to answer within ${n.within_days} days.`,
          n.from === "claimant"
            ? say(KIND.evidence_request, `For your claim ${c.id}: please send ${n.what}, within ${n.within_days} days (by day ${Math.floor(asked.by / DAY)}).`, { to: [who], visible: [who, this.me], basis: c.id, data })
            : say(KIND.confirmation_request, `For the claim ${c.id} of ${who}: please confirm ${n.what}, within ${n.within_days} days (by day ${Math.floor(asked.by / DAY)}).`, { to: [employer!], visible: [employer!, this.me], basis: c.id, data })));
        waiting = true;
        continue;
      }
      if (t < asked.by) { waiting = true; continue; }
      if (n.else === "refuse") lapsed ??= `${n.from === "claimant" ? "the papers asked for did not come" : "the confirmation asked for did not come"} within ${n.within_days} days (${n.what})`;
    }
    if (lapsed) return { state: "lapsed", why: lapsed, steps };
    return waiting ? { state: "waiting", steps } : { state: "ready", steps };
  }
}

/**
 * An office looking at its own decision again when asked (the generic route of law 5): a request on file addressed to it, about one
 * of its decisions of a kind whose law has a review. Inside the law's time it does the deciding again, on the facts now on file and
 * as the office's own `redo` has it, and records what it found: a record that the decision was reviewed (by whom and when are the
 * record's own author and time), and its answer to the one who asked. A decision found wrong is put right by the office itself
 * (`redo`'s steps); one found right is said to stand. A request after the time the law gives is answered no, and why.
 */
export class Reconsiderations {
  private readonly handled = new Set<string>();
  /** Reviews done this round, by decision (the file shows them from the next look). A decision is looked at once; a second request on the same one is answered from the first. */
  private readonly done = new Map<string, "changed" | "upheld">();
  readonly counts: { [what: string]: number } = {};
  constructor(private readonly me: string, private readonly kinds: readonly string[]) {}

  private count(what: string) { this.counts[what] = (this.counts[what] ?? 0) + 1; }

  /** The reviews on file that we made, newest first. */
  static reviews(book: Book, me: string, decision?: string): StatementRecord[] {
    return book.all(KIND.review).filter((r) => r.speaks_for === me && (decision === undefined || r.data?.decision === decision)).sort((a, b) => b.at - a.at);
  }

  steps(book: Book, t: number, redo: (decision: StatementRecord, request: StatementRecord) => { changed: boolean; found: string; steps?: Step[] } | undefined): Step[] {
    const steps: Step[] = [];
    for (const r of book.open(KIND.request).filter((x) => (x.addressed_to ?? []).includes(this.me) && !this.handled.has(x.id)).sort((a, b) => madeAt(a) - madeAt(b) || (a.id < b.id ? -1 : 1))) {
      const about = typeof r.data?.about === "string" ? (book.records.get(r.data.about) as StatementRecord | undefined) : undefined;
      // (Not about one of our decisions of a kind with a review: some other request, not ours to look at again.)
      if (!about || about.record !== "statement" || about.speaks_for !== this.me || !about.kind || !this.kinds.includes(about.kind)) continue;
      const payment = typeof about.data?.payment === "string" ? about.data.payment : undefined;
      const law = decisionLaw(book, about.kind, payment);
      if (!law?.review) continue;
      this.handled.add(r.id);
      const from = r.speaks_for!;
      const matter = String(r.data?.matter ?? "");
      const left = daysLeft(about.at, law.review.within_days, t);
      const say2 = (granted: boolean, outcome: "changed" | "upheld" | "out_of_time", found: string, text: string, more: Step[] = []) => {
        this.count(`review_${outcome}`);
        steps.push(because(`${from} asks us to look at our decision ${about.id} again: ${found}.`,
          say(KIND.review, `Review of ${about.id}, asked by ${from}: ${text}`, { to: [from], visible: [from, this.me], basis: about.id, data: { decision: about.id, kind: about.kind, request: r.id, outcome, found, asked_by: from, decided_on: about.at } }),
          say(KIND.answer, `Answer to your request ${r.id}: ${granted ? "yes" : "no"}: ${text}`, { to: [from], visible: [from, this.me], basis: r.id, data: { request: r.id, matter, granted, review: outcome, decision: about.id, ...(granted ? {} : { reason: found }) } })));
        steps.push(...more);
      };
      if (left < 0) {
        say2(false, "out_of_time", `the law allows ${law.review.within_days} days to ask, and the decision was made ${Math.floor((t - about.at) / DAY)} days ago`, `it was asked for after the ${law.review.within_days} days the law allows.`);
        continue;
      }
      // (Looked at already: from the file, which is the record of it; or from this round's, before it shows.)
      const filed = Reconsiderations.reviews(book, this.me, about.id).find((x) => x.data?.outcome === "changed" || x.data?.outcome === "upheld")?.data?.outcome as "changed" | "upheld" | undefined;
      const first = this.done.get(about.id) ?? filed;
      if (first !== undefined) {
        // (Looked at already: the answer stands as it was.)
        say2(first === "changed", first, "it has been looked at already", first === "changed" ? "it was found wrong and has been put right." : "it was looked at and stands.");
        continue;
      }
      const out = redo(about, r);
      if (!out) { this.handled.delete(r.id); continue; }
      this.done.set(about.id, out.changed ? "changed" : "upheld");
      say2(out.changed, out.changed ? "changed" : "upheld", out.found, out.changed ? `found wrong: ${out.found}; put right.` : `looked at again: ${out.found}; it stands.`, out.steps ?? []);
    }
    return steps;
  }
}
