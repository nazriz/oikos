// office.desk: a body that hears grievances (docs/behaviour/frictions.md, "Venues"): a council's complaints desk, an
// ombudsman, a consumer desk, a mediation service; and, through `Hearings`, the lists of the tribunal
// (docs/behaviour/justice.md). What it hears it says in an offer anyone may apply to (the contract's `hears`): a
// person with a grievance finds it by what it says, never by its name, so a desk made in a run is found the same way.
//
// A venue has no power over the world. It takes an application, tells the one complained of and gives them time to
// answer, decides by its procedure with the hours its staff have, and says what it decided: words, which the other
// side obeys or does not (a tribunal's order to pay can be enforced: its registrar and the bank). Each step takes
// the time the world says it takes; a desk with more cases than its staff can decide in a day falls behind, and its
// waits are what they come to.

import type { Offer, StatementRecord } from "../contracts";
import { cents } from "../money";
import { dateWords } from "../forms";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { slip, type Slipper } from "../slip";
import { appealLaw } from "./decisions";
import { because, Book, CounterWork, DAY, noting, Occurrences, say, StandingWork, type Step, usd } from "./common";
import { stepper } from "./firms";
import { PAPER, responseTo, type Finding, type Matter } from "./frictions";
import * as P from "./papers";

/** What a venue says it hears (the contract's Offer.hears), with how it goes about it. */
export interface Hears {
  about: string;
  can?: ("order" | "recommend" | "mediate" | "refer" | "represent" | "publish")[];
  undoes?: boolean;
  form?: string;
  within?: number;
  /** What applying about this costs, where it differs from the body's own fee (the law on a decision's appeal states its own: foundations F8). */
  fee?: number;
}

export interface HearingParams {
  hears: Hears[];
  /** The other side's time to answer. */
  answer_days: number;
  /** An order to pay or to do: within this long. */
  within_days: number;
  /** Matters it passes to whoever must act: the office, and the kind of paper that office takes. */
  refer_to: { [matter: string]: { to: string; kind: string } };
  /** Possession of a let home for arrears (docs/behaviour/justice.md, "Possession"), where it hears that: how long
   * after its order the date for possession falls, and the longest plan to pay it will set (the world's law's). */
  possession?: { days: number; plan_months: number;
    /** What the law asks and allows, as the world's law has it (docs/behaviour/justice.md, "A tenant's answer"): the
     * days a notice to vacate must give; whether a plan may be set, must be considered, or there is none; and where
     * a plan is taken away once so many months' rent are owed. */
    notice_days?: number; plan_consider?: "may" | "must" | "none"; plan_barred_rent_months?: number };
}
export const HEARING_DEFAULTS: HearingParams = { hears: [], answer_days: 14, within_days: 28, refer_to: {} };

/** The offer a venue publishes: who it is, what it hears, what applying costs. */
export function hearingOffer(me: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string } = {}): Offer {
  return {
    by: me, take_up: "apply", ...(o.members_of ? { to: { members_of: o.members_of } } : {}),
    hears: hears.map((h) => ({ about: h.about, ...(h.can?.length ? { can: h.can } : {}), ...(h.undoes ? { undoes: true } : {}), ...(h.form ? { form: h.form } : {}), ...(h.within ? { within: h.within } : {}) })),
    ...(o.fee && o.fee > 0 && o.account ? { terms: { commitments: [{ who: "taker", does: { outcome: { money: { to: o.account, amount: String(o.fee), for: "application fee" } } } }] } } : {}),
  } as Offer;
}

const isBinding = (can: readonly string[]) => can.includes("order");
interface Case { id: string; matter: string; applicant: string; against: string; at: number; answerBy: number; data: Matter & { [k: string]: any }; hears: Hears }

/**
 * The hearing of applications, for any venue: listing, telling the other side, deciding on the record, saying so.
 * `forms`: the kinds of paper it uses (a desk's are the common ones; a tribunal's are its own).
 */
export class Hearings {
  private readonly cases = new Map<string, Case>();
  private readonly seen = new Set<string>();
  /** Cases we have decided ourselves: never taken up again from the file, where our own decision may not yet show
   * (a member deciding several cases at one sitting decided some of them two and three times over, until 2026-10-12). */
  private readonly closed = new Set<string>();
  /** Which case each application is to us: by who against whom about what, not by its number on file. */
  private readonly nth = new Occurrences();
  /** What it did, for whoever counts: applications, by finding; days from application to decision. */
  readonly counts: { [what: string]: number } = {};
  readonly waits: number[] = [];
  constructor(
    private readonly me: string,
    /** Whoever hears: where the record cannot settle a case (one side's word against the other's) it finds for the applicant at the
     * rate of the world's table of slips for a venue's decision (`publish/venue_decision`, foundations F7). */
    private readonly ctx: Slipper,
    readonly p: HearingParams,
    private readonly forms: { application: string[]; notice: string; response: string; decision: string } = { application: [PAPER.application], notice: PAPER.notice, response: PAPER.response, decision: PAPER.decision },
    /** Kinds the venue's own code hears itself (a tribunal's older lists): left alone here. */
    private readonly leave: readonly string[] = [],
  ) {}

  get open(): number {
    return this.cases.size;
  }
  private count(what: string) {
    this.counts[what] = (this.counts[what] ?? 0) + 1;
  }

  /**
   * `part`: "all", a whole office (a code office), which takes applications in and decides every case; "staff", its
   * counter staff, who take them in, tell the other side and decide what the record settles (the other side's own
   * answer, or none: a decision in default, or a paper shown), and put before the office-holder, as a note on the
   * office's file, each case the record cannot settle; "seat", the office-holder, who decides those and nothing else.
   * A tribunal's two parts (docs/behaviour/justice.md, "The registry lists; the member decides"): "list", its registry
   * staff, who take applications in and tell both sides, and decide nothing; "decide", its member, who decides every
   * case listed (by anyone: the notices of hearing on the tribunal's file say which cases stand, and until when the
   * other side may answer) and takes none in.
   */
  steps(book: Book, t: number, part: "all" | "staff" | "seat" | "list" | "decide" = "all", /** How many cases can be decided now, where that is not a fixed number a day (a body whose staff are its members' hours). */ canDecide?: number): Step[] {
    const steps: Step[] = [];
    if (part === "seat") {
      // The cases the staff could not settle on the record: decided here as the code office would (failure of proof,
      // at the venue's own rate). A model in the office decides them for itself, on the decision form.
      for (const n of book.open("case_for_decision").filter((x) => x.speaks_for === this.me && !this.seen.has(x.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
        this.seen.add(n.id);
        const c = n.data?.case as Case | undefined;
        if (!c) continue;
        const claimed = c.data.amount !== undefined ? cents(c.data.amount) : 0;
        const upheld = slip(this.ctx, "publish/venue_decision", this.nth.key(c.id, c.applicant, c.against, c.matter));
        const binding = (c.hears.can ?? ["order"]).includes("order"), due = t + this.p.within_days * DAY;
        const finding: Finding = !upheld ? "dismissed" : claimed > 0 ? "pay" : c.hears.undoes && c.data.about ? "set_aside" : "do";
        this.count(finding);
        steps.push(because(`A case the record cannot settle (${c.matter.replace(/_/g, " ")}, ${c.applicant} against ${c.against}): ${upheld ? "on what both say, it is made out" : "the applicant has nothing to show for it, and it is not made out"}.`,
          say(this.forms.decision, `Decision on ${c.id}: ${finding === "pay" ? `${c.against} ${binding ? "is to" : "should"} pay ${c.applicant} ${usd(claimed)} by day ${Math.floor(due / DAY)}.` : finding === "dismissed" ? "not made out; dismissed." : `${c.against} ${binding ? "is to" : "should"} put it right by day ${Math.floor(due / DAY)}.`}`,
            { to: [c.applicant, c.against], visible: [c.applicant, c.against, this.me], basis: c.id, data: { application: c.id, kind: c.matter, matter: c.matter, applicant: c.applicant, against: c.against, finding, binding, waited_days: Math.floor((t - c.at) / DAY),
              ...(c.data.about ? { about: c.data.about } : {}), ...(c.data.structure ? { structure: c.data.structure } : {}), ...(finding === "pay" ? { amount: claimed, ...(c.data.account ? { to: c.data.account } : {}), due } : finding === "do" ? { due } : {}) } })));
      }
      return steps;
    }
    const say2 = (c: Case, finding: Finding, text: string, data: object, why: string, binding = true) => {
      this.cases.delete(c.id);
      this.closed.add(c.id);
      this.count(finding);
      this.waits.push(Math.floor((t - c.at) / DAY));
      if (this.waits.length > 512) this.waits.shift();
      steps.push(because(why, say(this.forms.decision, `Decision on ${c.id}: ${text}`, { to: [c.applicant, c.against].filter((x) => x), visible: [c.applicant, c.against, this.me].filter((x) => x), basis: c.id,
        data: { application: c.id, kind: c.matter, matter: c.matter, applicant: c.applicant, against: c.against, finding, binding, waited_days: Math.floor((t - c.at) / DAY), ...(c.data.about ? { about: c.data.about } : {}), ...(c.data.structure ? { structure: c.data.structure } : {}), ...(c.data.seeks ? { seeks: c.data.seeks } : {}), ...data } })));
    };
    // ---- the member's part: the cases the tribunal's file says are listed, as its notices of hearing have them ----
    if (part === "decide") {
      const decided = new Set(book.all(this.forms.decision).filter((r) => r.speaks_for === this.me).map((r) => String(r.data?.application ?? "")));
      for (const n of book.all(this.forms.notice).filter((r) => r.speaks_for === this.me && typeof r.data?.matter === "string").sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
        const id = String(n.data?.application ?? "");
        const a = book.records.get(id) as StatementRecord | undefined;
        if (!a || decided.has(id) || this.closed.has(id) || book.withdrawn.has(id) || this.leave.includes(String(n.data?.matter))) { this.cases.delete(id); continue; }
        const d = (a.data ?? {}) as Matter & { kind?: string };
        const matter = String(d.matter ?? d.kind ?? n.data?.matter);
        // (The latest notice gives the day: a case put off is decided when its new day has come.)
        this.cases.set(id, { id, matter, applicant: a.speaks_for!, against: String(d.against ?? n.data?.against ?? ""), at: a.at, answerBy: Number(n.data?.answer_by ?? n.data?.hearing_at ?? t), data: d, hears: this.p.hears.find((h) => h.about === matter) ?? { about: matter } });
      }
    }
    // ---- cases our own file says are already listed, that we did not list ourselves (a venue that opens with its
    // list part-way through: docs/behaviour/generator.md, "An ordinary day's caseload"): taken as they stand, with
    // the day their notice gave; never listed again. In a venue that listed everything itself there are none. ----
    if (part !== "decide") {
      const decidedOnFile = new Set(book.all(this.forms.decision).filter((r) => r.speaks_for === this.me).map((r) => String(r.data?.application ?? "")));
      for (const n of book.all(this.forms.notice).filter((r) => r.speaks_for === this.me && typeof r.data?.matter === "string").sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
        const id = String(n.data?.application ?? "");
        if (this.seen.has(id)) continue;
        const a = book.records.get(id) as StatementRecord | undefined;
        if (!a) continue;
        this.seen.add(id);
        const d = (a.data ?? {}) as Matter & { kind?: string };
        const matter = String(d.matter ?? d.kind ?? n.data?.matter);
        if (decidedOnFile.has(id) || this.closed.has(id) || book.withdrawn.has(id) || this.leave.includes(matter) || part === "list") continue;
        this.cases.set(id, { id, matter, applicant: a.speaks_for!, against: String(d.against ?? n.data?.against ?? ""), at: a.at, answerBy: Number(n.data?.answer_by ?? n.data?.hearing_at ?? t), data: d, hears: this.p.hears.find((h) => h.about === matter) ?? { about: matter } });
      }
    }
    // ---- applications: taken, and the other side told ----
    if (part !== "decide") for (const kind of this.forms.application) for (const a of book.open(kind).filter((x) => (x.addressed_to ?? []).includes(this.me) && !this.seen.has(x.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
      const d = (a.data ?? {}) as Matter & { kind?: string };
      const matter = String(d.matter ?? d.kind ?? "");
      if (this.leave.includes(matter)) continue;
      this.seen.add(a.id);
      const applicant = a.speaks_for!;
      const hears = this.p.hears.find((h) => h.about === matter);
      const against = String(d.against ?? "");
      const c: Case = { id: a.id, matter, applicant, against, at: a.at, answerBy: t + this.p.answer_days * DAY, data: d, hears: hears ?? { about: matter } };
      this.count("applications");
      if (!hears || against === applicant) {
        say2(c, "rejected", "we cannot hear it.", {}, `An application we do not hear (${matter || "of no kind"}): saying so.`);
        continue;
      }
      const can = hears.can ?? ["order"];
      const refer = this.p.refer_to[matter];
      if (can.includes("refer") && refer) {
        // Passed to whoever must act, on that office's own paper; the applicant is told where it went.
        steps.push(because(`An application about ${matter.replace(/_/g, " ")}: it is for ${refer.to} to act on; passing it on.`,
          say(refer.kind, `Passed on from ${this.me}: ${a.text}`, { to: [refer.to], visible: [refer.to, this.me, applicant], basis: a.id, data: { ...d, from: applicant, application: a.id } })));
        say2(c, "referred", `passed to ${refer.to}, whose it is to act on.`, { to: refer.to }, `Telling ${applicant} where their application went.`, false);
        continue;
      }
      if (!against) {
        say2(c, "rejected", "it names nobody it is against.", {}, "An application against no one: saying so.");
        continue;
      }
      // An appeal against a decision (the law's, foundations F8): the days it may be made in, counted from the decision, or from the answer to a review
      // where the law makes a review come first. The applicant tenders the dates from their own papers; a venue that cannot set aside takes the matter as it is.
      const law = isBinding(can) ? appealLaw(book, matter) : undefined;
      if (law?.appeal) {
        const decided = Number((d as any).evidence?.at ?? (d as any).decided_on), reviewed = Number((d as any).reviewed_on);
        const from = law.review?.required ? (Number.isFinite(reviewed) ? reviewed : undefined) : Number.isFinite(decided) ? decided : undefined;
        if (law.review?.required && from === undefined) {
          say2(c, "rejected", `the law asks that the decision be looked at again by the office that made it before it is appealed, and there is no answer to that on the papers.`, {}, `An appeal (${matter.replace(/_/g, " ")}) without the review the law asks first: saying so.`);
          continue;
        }
        if (from !== undefined && Math.floor((a.at - from) / DAY) > law.appeal.within_days) {
          say2(c, "rejected", `an appeal is to be made within ${law.appeal.within_days} days of ${law.review?.required ? "the answer to the review" : "the decision"}, and this was made ${Math.floor((a.at - from) / DAY)} days after.`, { out_of_time: true }, `An appeal (${matter.replace(/_/g, " ")}) outside the ${law.appeal.within_days} days the law allows: saying so.`);
          continue;
        }
      }
      this.cases.set(a.id, c);
      steps.push(because(`An application (${matter.replace(/_/g, " ")}) by ${applicant} against ${against}: telling ${against}, who has until day ${Math.floor(c.answerBy / DAY)} to answer.`,
        say(this.forms.notice, `${applicant} has applied to us about ${matter.replace(/_/g, " ")}${d.amount ? `, seeking ${usd(cents(d.amount))}` : ""} (application ${a.id}). You may answer by day ${Math.floor(c.answerBy / DAY)}${can.includes("mediate") ? ", and say whether you will meet them with us" : ""}.`,
          { to: [applicant, against], visible: [applicant, against, this.me], basis: a.id, data: { application: a.id, kind: matter, matter, applicant, against, hearing_at: c.answerBy, answer_by: c.answerBy, ...(d.about ? { about: d.about } : {}), ...(d.amount !== undefined ? { amount: d.amount } : {}), ...(d.structure ? { structure: d.structure } : {}), ...(d.seeks ? { seeks: d.seeks } : {}) } })));
    }
    if (part === "list") return steps;
    // ---- deciding: those whose time to answer has run, oldest first, as far as the day's hours go ----
    // (An application its maker has withdrawn is no longer a case: nothing is decided on it.)
    for (const c of [...this.cases.values()]) if (book.withdrawn.has(c.id)) { this.cases.delete(c.id); this.count("withdrawn"); }
    // (How many it gets through is the hours of whoever decides, not a number: each decision is an act that takes its maker's time, and the
    // ones behind it wait (foundations F6). A seat's own room, where it is given one, is its day's hours.)
    let room = canDecide ?? Infinity;
    // (The member decides a case on or after its day, and its books count the day from its first hour: a member who
    // sits in the morning decides what that day's list has. A whole office run by code decides at the hour, as before.)
    const ripe = (x: Case) => (part === "decide" ? Math.floor(x.answerBy / DAY) <= Math.floor(t / DAY) : t >= x.answerBy);
    for (const c of [...this.cases.values()].filter(ripe).sort((a, b) => a.answerBy - b.answerBy || (a.id < b.id ? -1 : 1))) {
      if (room-- <= 0) break;
      const can = c.hears.can ?? ["order"];
      const binding = can.includes("order");
      const due = t + this.p.within_days * DAY;
      const r = responseTo(book, this.forms.response, c.id, c.against);
      const x = (r?.data ?? {}) as { owed?: number; done?: boolean; wrong?: boolean; known?: boolean; agrees?: boolean; paid?: number };
      const claimed = c.data.amount !== undefined ? cents(c.data.amount) : 0;
      const verb = binding ? "is to" : "should";
      if (can.includes("mediate") && !binding) {
        // Bringing the two together: nothing comes of it unless the other side will.
        if (x.agrees) say2(c, "settled", `${c.applicant} and ${c.against} met with us and came to an understanding.`, {}, `${c.against} agreed to meet ${c.applicant}: they came to an understanding.`, false);
        else say2(c, "dismissed", `${c.against} ${r ? "would not meet" : "did not answer"}; we can do no more.`, {}, `${c.against} ${r ? "would not meet" : "did not answer"}: mediation cannot be made to happen.`, false);
        continue;
      }
      if (c.matter === "possession") {
        // Possession of a let home for arrears. The tenant may answer with what they have paid since, and with what
        // they can pay a month toward the rest. Paid: dismissed. A plan that clears the arrears within the longest
        // the law allows, and that has not been tried and broken: the tenant stays, on the plan. Otherwise the
        // landlord is to have the home on a date; a tenant still there after it is put out by whoever enforces the
        // tribunal's warrants, never by the landlord. (A seat in the tribunal decides for itself.)
        // The code member's rule, in this order, on the papers alone (it weighs nothing else: not hardship, not who
        // lives there, not whether they have anywhere to go; a seat is shown the same papers and decides for itself):
        //  1. the tenant says they have left: dismissed (the law gives possession against a tenant who has not);
        //  2. the notice relied on, by the application's own dates, gave fewer days than the law asks: dismissed;
        //  3. nothing is owed (the landlord's reply where there is one, else the tenant's figure, else the
        //     application's): dismissed;
        //  4. the law gives a plan, not taken away at this sum, none was set and broken before, and what the tenant
        //     offers clears what is owed within the law's longest plan: a plan;
        //  5. otherwise possession, on the law's day.
        const P = this.p.possession ?? { days: 14, plan_months: 0 };
        const reply = book.all("tribunal_reply").filter((y) => y.speaks_for === c.applicant && String(y.data?.application ?? "") === c.id).sort((a, b) => b.at - a.at)[0];
        const stated = (x as any).owes !== undefined ? Math.max(0, cents((x as any).owes)) : (x as any).paid !== undefined ? Math.max(0, claimed - cents((x as any).paid)) : undefined;
        const arrears = reply?.data?.owed !== undefined ? Math.max(0, cents(reply.data.owed)) : stated ?? claimed;
        const offer = Math.max(0, cents((x as any).offer ?? 0));
        const home = c.data.space ? { space: c.data.space, structure: c.data.structure, household: c.data.household } : {};
        const given = Number(c.data.notice_given), by = Number(c.data.notice_by);
        const gave = c.data.notice_given !== undefined && c.data.notice_by !== undefined && Number.isFinite(given) && Number.isFinite(by) ? Math.floor((by - given) / DAY) : undefined;
        const rent = cents(c.data.rent ?? 0);
        const consider = P.plan_months > 0 ? P.plan_consider ?? "may" : "none";
        const barred = consider !== "none" && !!P.plan_barred_rent_months && rent > 0 && arrears >= P.plan_barred_rent_months * rent;
        const whose = reply?.data?.owed !== undefined ? "by the landlord's rent book" : stated !== undefined ? "by the tenant's answer" : "by the application";
        if ((x as any).left) say2(c, "dismissed", `${c.against} has left ${c.data.space ?? "the home"}; there is nothing left to order. Dismissed.`, { left: true }, `${c.against} answers that they have left the home: nothing to order; dismissed.`);
        else if (gave !== undefined && P.notice_days && gave < P.notice_days) say2(c, "dismissed", `the notice to vacate relied on gave ${gave} days, and the law asks at least ${P.notice_days}. Dismissed.`, { notice_short: true }, `The notice relied on gave ${gave} days where the law asks ${P.notice_days}: what the law asks before an order is not met; dismissed.`);
        else if (arrears <= 0) say2(c, "dismissed", "the rent owed has been paid; dismissed.", {}, `Nothing is owed now (${whose}): dismissed.`);
        else if (r && offer > 0 && !c.data.breach && consider !== "none" && !barred && arrears <= offer * P.plan_months) {
          say2(c, "plan", `${c.against} is to pay the rent as it falls due and ${usd(offer)} a month toward the ${usd(arrears)} owed, until it is paid. If the plan is not kept, ${c.applicant} may apply again for possession.`,
            { amount: arrears, instalment: offer, ...(c.data.account ? { to: c.data.account } : {}), ...home },
            `${c.against} is ${usd(arrears)} behind (${whose}) and offers ${usd(offer)} a month, which clears it within ${P.plan_months} months: a plan to pay, and no possession.`);
        } else {
          const date = t + P.days * DAY;
          const why = c.data.breach ? " and has not kept the plan set" : !r ? " and did not answer" : consider === "none" ? "; the law here gives no plan to set" : barred ? `; ${P.plan_barred_rent_months} months' rent or more is owed, where the law allows no plan` : offer > 0 ? `, and what they offer (${usd(offer)} a month) would not clear it within ${P.plan_months} months` : ", and says they can pay nothing toward it";
          say2(c, "possession", `${c.applicant} is to have possession of ${c.data.space ?? "the home"} on ${dateWords(date)}: ${c.against} and their household are to leave by then. If they have not, ${c.applicant} may ask our registrar for a warrant, which is carried out by those who enforce our orders, and by nobody else.`,
            { amount: arrears, due: date, ...home },
            `${c.against} is ${usd(arrears)} behind with the rent (${whose})${why}: ordering possession by ${dateWords(date)}. (Decided on the sum owed and the sum offered alone.)`);
        }
        continue;
      }
      // On the record: what the other side's own books say, where it answered and they can say.
      let finding: Finding;
      let amount = 0;
      let why: string;
      if (r && x.owed !== undefined) { amount = Math.max(0, cents(x.owed)); finding = amount > 0 ? "pay" : "dismissed"; why = `${c.against} answers that its records show ${usd(amount)} owed`; }
      else if (r && x.wrong !== undefined) { finding = x.wrong ? (claimed > 0 ? "pay" : "set_aside") : "dismissed"; amount = x.wrong ? claimed : 0; why = `${c.against} answers that the paper was ${x.wrong ? "wrong" : "right"}`; }
      else if (r && x.done !== undefined) { finding = x.done ? "dismissed" : "do"; why = `${c.against} answers that it is ${x.done ? "done" : "not done"}`; }
      else {
        // No answer, or one that cannot say: in default the applicant's account stands; word against word, the venue's own rate.
        // (The thing complained of happened: nobody lies yet. What the rate stands for is failure of proof: an
        // applicant who can show a paper for it (a receipt, the request they made, the notice) has made it out; one
        // with only their word is believed as often as this venue's own figures say.)
        const shown = c.data.evidence !== undefined || c.data.request !== undefined;
        if (part === "staff" && r && !shown) {
          // Not the counter's to decide: put before the office-holder, with the case as it stands.
          this.cases.delete(c.id);
          this.count("for_decision");
          steps.push(because(`${c.against} cannot say from its records and ${c.applicant} has nothing to show: a decision for the office-holder.`,
            say("case_for_decision", `For decision: application ${c.id} (${c.matter.replace(/_/g, " ")}) by ${c.applicant} against ${c.against}${claimed ? `, seeking ${usd(claimed)}` : ""}. ${c.against} answers that it cannot say from its records; the applicant has shown no paper for it.`,
              { to: [this.me], visible: [this.me], basis: c.id, data: { application: c.id, matter: c.matter, applicant: c.applicant, against: c.against, case: c } })));
          continue;
        }
        const upheld = !r || shown || slip(this.ctx, "publish/venue_decision", this.nth.key(c.id, c.applicant, c.against, c.matter));
        finding = !upheld ? "dismissed" : claimed > 0 ? "pay" : c.hears.undoes && c.data.about ? "set_aside" : "do";
        amount = upheld ? claimed : 0;
        why = r ? `${c.against} cannot say from its records; ${shown ? "the applicant has shown a paper for it" : upheld ? "on what both say, the applicant's account is made out" : "the applicant has nothing to show for it, and it is not made out"}` : `${c.against} did not answer: the applicant's account stands`;
      }
      if (finding === "pay") say2(c, "pay", `${c.against} ${verb} pay ${c.applicant} ${usd(amount)} by day ${Math.floor(due / DAY)}.`, { amount, ...(c.data.account ? { to: c.data.account } : {}), due }, `${why}: ${binding ? "ordering" : "recommending"} payment of ${usd(amount)}.`, binding);
      else if (finding === "do") say2(c, "do", `${c.against} ${verb} put it right by day ${Math.floor(due / DAY)}.`, { due }, `${why}: ${binding ? "ordering" : "recommending"} that it be put right.`, binding);
      else if (finding === "set_aside") say2(c, "set_aside", `the paper ${c.data.about ?? ""} ${binding ? "is set aside" : "should be withdrawn"}.`, {}, `${why}: the paper ${binding ? "is set aside" : "should be withdrawn"}.`, binding);
      else say2(c, "dismissed", "not made out; dismissed.", {}, `${why}: dismissed.`, binding);
    }
    return steps;
  }
}

/** What a body that hears grievances says it hears: its public notice, with the offer whoever has such a matter takes up. */
export function hearingNotice(me: string, words: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string; members_apply?: boolean } = {}): { kind: string; text: string; data: unknown; offer: Offer } {
  const fee = o.fee ?? 0;
  return { kind: "hearing", text: `${words}: ${hears.map((h) => h.about.replace(/_/g, " ")).join(", ")}. ${o.members_apply ? "Members apply" : "Apply"} in writing${fee > 0 ? `; the fee is ${usd(fee)}` : "; there is no fee"}.`,
    offer: hearingOffer(me, hears, { fee: o.fee, account: o.account, members_of: o.members_of }), data: { hears: hears.map((h) => h.about), ...(fee > 0 ? { fee } : {}) } };
}

/** The notices of what a body hears: one, or one for each fee where what it hears is charged differently (an appeal the law makes free beside its other lists). */
export function hearingNotices(me: string, words: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string; members_apply?: boolean } = {}): ReturnType<typeof hearingNotice>[] {
  const byFee = new Map<number, Hears[]>();
  for (const h of hears) { const fee = h.fee ?? o.fee ?? 0; byFee.set(fee, [...(byFee.get(fee) ?? []), h]); }
  return [...byFee].sort(([a], [b]) => a - b).map(([fee, hs]) => hearingNotice(me, words, hs, { ...o, fee }));
}

export const desk: BehaviourModule = {
  name: "office.desk",
  opens: (p, me) => ((p.hears ?? []).length && p.part !== "staff" ? hearingNotices(me, `The ${p.title ?? "desk"} hears`, p.hears, { fee: p.fee, account: p.account, members_of: p.members_of }) : []),
  // (Its counter: docs/behaviour/standing-work.md. What is routine is what the procedure settles on the record.)
  routines: [{ task: "answer", at: "office", every: 1, what: "The desk's staff take in each application, tell the one it is against and give them time to answer, and decide what the record settles: the other side's own answer, no answer at all, or a paper the applicant can show. A case the record cannot settle is put before the office-holder.",
    papers: [
      { kind: "application", how: "taken in; the one it is against is told and given time to answer; decided on the record when that time has run, or put before the office-holder" },
      { kind: "complaint_response", how: "filed with its application, which is decided on it when the time to answer has run" },
    ] }],
  answers: { office: "the desk", acts: "What it acts on: an application made to it about something it has said it hears, which it puts to the other side and decides by its procedure." },
  issues: P.DESK,
  version: "0.1.2", // 0.1.2: as the tribunal: a withdrawn application is no case, and cases already listed on its own file are taken as they stand; 0.1.1: what the record cannot settle is drawn by who applied against whom about what, not by the application's number on file; its notice of what it hears is on file when a seat arrives; 0.1.0: a body that hears grievances (docs/behaviour/frictions.md)
  doc: "docs/behaviour/frictions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      title: "desk", // what it calls itself in its notice
      hears: [] as Hears[],
      answer_days: HEARING_DEFAULTS.answer_days,
      within_days: HEARING_DEFAULTS.within_days,
      refer_to: {} as HearingParams["refer_to"],
      fee: 0, // what applying costs (none: nothing), paid into `account`
      account: "",
      members_of: "", // heard only for members of this organisation (none: anyone)
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the office-holder alone, who decides what the record cannot settle; "staff" the counter staff, who do
      // the rest under a standing order. `counter`: whether the town gives the office a counter (a living town does).
      part: "" as "" | "seat" | "staff", office: "", counter: false,
    }, ctx.params);
    const routines = new StandingWork(ctx.entity, p.part, ctx.position ? new Set([ctx.position.replace(/-staff$/, "")]) : undefined);
    const counter = new CounterWork(routines, !!p.counter);
    const me = ctx.entity;
    const book = new Book();
    const hearings = new Hearings(me, ctx, { hears: p.hears, answer_days: p.answer_days, within_days: p.within_days, refer_to: p.refer_to });
    let said = false;
    return noting(book, stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const steps: Step[] = [];
        steps.push(...routines.set(book, counter.order(p.office || ctx.position || "office")));
        if (!said && p.part !== "staff") {
          said = true;
          const standing = book.open("hearing").find((r: StatementRecord) => r.speaks_for === me && r.offer?.hears);
          if (!standing && p.hears.length) for (const n of hearingNotices(me, `The ${p.title} hears`, p.hears, { fee: p.fee, account: p.account, members_of: p.members_of }))
            steps.push(because("Saying what we hear, so that whoever has such a matter can bring it.", say(n.kind, n.text, { visible: "public", offer: n.offer, data: n.data as object })));
        }
        // (With a counter, and someone in the office: the staff do what the record settles, while their standing
        // order stands; the office-holder decides the rest. Without one, whoever runs the office does it all.)
        const split = counter.offered && p.part !== "";
        if (!split) steps.push(...hearings.steps(book, obs.t));
        else if (p.part === "seat") steps.push(...hearings.steps(book, obs.t, "seat"));
        else if (counter.works(book, obs.t)) {
          const before = { ...hearings.counts };
          steps.push(...hearings.steps(book, obs.t, "staff"));
          for (let i = (before.applications ?? 0); i < (hearings.counts.applications ?? 0); i++) counter.answered("application");
          counter.flush(obs.t);
        }
        if (p.part === "staff" && counter.offered) {
          const report = routines.report(book, obs.t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: `the ${p.title}'s staff`, tasks: { ...counter.tasks } });
          counter.reported(report);
          steps.push(...report);
        }
        return steps;
      },
    ));
  },
};
