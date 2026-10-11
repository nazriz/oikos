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
import type { Rng } from "../rng";
import { because, Book, CounterWork, DAY, noting, say, StandingWork, type Step, usd } from "./common";
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
}

export interface HearingParams {
  hears: Hears[];
  /** The other side's time to answer. */
  answer_days: number;
  /** How many cases its staff can decide in a working day (their hours over the hours a case takes). */
  cases_per_day: number;
  /** Where the record cannot settle it (one side's word against the other's): how often it finds for the applicant,
   * by matter (`other` for the rest). The profile's, where a venue's own figures give it. */
  uphold_bps: { [matter: string]: number };
  /** An order to pay or to do: within this long. */
  within_days: number;
  /** Matters it passes to whoever must act: the office, and the kind of paper that office takes. */
  refer_to: { [matter: string]: { to: string; kind: string } };
  /** Possession of a let home for arrears (docs/behaviour/justice.md, "Possession"), where it hears that: how long
   * after its order the date for possession falls, and the longest plan to pay it will set (the world's law's). */
  possession?: { days: number; plan_months: number };
}
export const HEARING_DEFAULTS: HearingParams = { hears: [], answer_days: 14, cases_per_day: 4, uphold_bps: { other: 5_000 }, within_days: 28, refer_to: {} };

/** The offer a venue publishes: who it is, what it hears, what applying costs. */
export function hearingOffer(me: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string } = {}): Offer {
  return {
    by: me, take_up: "apply", ...(o.members_of ? { to: { members_of: o.members_of } } : {}),
    hears: hears.map((h) => ({ about: h.about, ...(h.can?.length ? { can: h.can } : {}), ...(h.undoes ? { undoes: true } : {}), ...(h.form ? { form: h.form } : {}), ...(h.within ? { within: h.within } : {}) })),
    ...(o.fee && o.fee > 0 && o.account ? { terms: { commitments: [{ who: "taker", does: { outcome: { money: { to: o.account, amount: String(o.fee), for: "application fee" } } } }] } } : {}),
  } as Offer;
}

interface Case { id: string; matter: string; applicant: string; against: string; at: number; answerBy: number; data: Matter & { [k: string]: any }; hears: Hears }

/**
 * The hearing of applications, for any venue: listing, telling the other side, deciding on the record, saying so.
 * `forms`: the kinds of paper it uses (a desk's are the common ones; a tribunal's are its own).
 */
export class Hearings {
  private readonly cases = new Map<string, Case>();
  private readonly seen = new Set<string>();
  /** What it did, for whoever counts: applications, by finding; days from application to decision. */
  readonly counts: { [what: string]: number } = {};
  readonly waits: number[] = [];
  constructor(
    private readonly me: string,
    private readonly rng: (purpose: string) => Rng,
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
   */
  steps(book: Book, t: number, part: "all" | "staff" | "seat" = "all"): Step[] {
    const steps: Step[] = [];
    if (part === "seat") {
      // The cases the staff could not settle on the record: decided here as the code office would (failure of proof,
      // at the venue's own rate). A model in the office decides them for itself, on the decision form.
      for (const n of book.open("case_for_decision").filter((x) => x.speaks_for === this.me && !this.seen.has(x.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
        this.seen.add(n.id);
        const c = n.data?.case as Case | undefined;
        if (!c) continue;
        const claimed = c.data.amount !== undefined ? cents(c.data.amount) : 0;
        const upheld = this.rng(`uphold-${c.id}`).below(10_000) < (this.p.uphold_bps[c.matter] ?? this.p.uphold_bps.other ?? 5_000);
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
      this.count(finding);
      this.waits.push(Math.floor((t - c.at) / DAY));
      if (this.waits.length > 512) this.waits.shift();
      steps.push(because(why, say(this.forms.decision, `Decision on ${c.id}: ${text}`, { to: [c.applicant, c.against].filter((x) => x), visible: [c.applicant, c.against, this.me].filter((x) => x), basis: c.id,
        data: { application: c.id, kind: c.matter, matter: c.matter, applicant: c.applicant, against: c.against, finding, binding, waited_days: Math.floor((t - c.at) / DAY), ...(c.data.about ? { about: c.data.about } : {}), ...(c.data.structure ? { structure: c.data.structure } : {}), ...(c.data.seeks ? { seeks: c.data.seeks } : {}), ...data } })));
    };
    // ---- applications: taken, and the other side told ----
    for (const kind of this.forms.application) for (const a of book.open(kind).filter((x) => (x.addressed_to ?? []).includes(this.me) && !this.seen.has(x.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))) {
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
      this.cases.set(a.id, c);
      steps.push(because(`An application (${matter.replace(/_/g, " ")}) by ${applicant} against ${against}: telling ${against}, who has until day ${Math.floor(c.answerBy / DAY)} to answer.`,
        say(this.forms.notice, `${applicant} has applied to us about ${matter.replace(/_/g, " ")}${d.amount ? `, seeking ${usd(cents(d.amount))}` : ""} (application ${a.id}). You may answer by day ${Math.floor(c.answerBy / DAY)}${can.includes("mediate") ? ", and say whether you will meet them with us" : ""}.`,
          { to: [applicant, against], visible: [applicant, against, this.me], basis: a.id, data: { application: a.id, kind: matter, matter, applicant, against, hearing_at: c.answerBy, answer_by: c.answerBy, ...(d.about ? { about: d.about } : {}), ...(d.amount !== undefined ? { amount: d.amount } : {}), ...(d.structure ? { structure: d.structure } : {}), ...(d.seeks ? { seeks: d.seeks } : {}) } })));
    }
    // ---- deciding: those whose time to answer has run, oldest first, as far as the day's hours go ----
    let room = Math.max(1, Math.floor(this.p.cases_per_day));
    for (const c of [...this.cases.values()].filter((x) => t >= x.answerBy).sort((a, b) => a.answerBy - b.answerBy || (a.id < b.id ? -1 : 1))) {
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
        const P = this.p.possession ?? { days: 14, plan_months: 0 };
        const arrears = Math.max(0, claimed - cents((x as any).paid ?? 0));
        const offer = Math.max(0, cents((x as any).offer ?? 0));
        const home = c.data.space ? { space: c.data.space, structure: c.data.structure, household: c.data.household } : {};
        if (arrears <= 0) say2(c, "dismissed", "the rent owed has been paid; dismissed.", {}, `${c.against} answers that the rent owed is paid: dismissed.`);
        else if (r && offer > 0 && !c.data.breach && P.plan_months > 0 && arrears <= offer * P.plan_months) {
          say2(c, "plan", `${c.against} is to pay the rent as it falls due and ${usd(offer)} a month toward the ${usd(arrears)} owed, until it is paid. If the plan is not kept, ${c.applicant} may apply again for possession.`,
            { amount: arrears, instalment: offer, ...(c.data.account ? { to: c.data.account } : {}), ...home },
            `${c.against} is ${usd(arrears)} behind and offers ${usd(offer)} a month, which clears it within ${P.plan_months} months: a plan to pay, and no possession.`);
        } else {
          const date = t + P.days * DAY;
          say2(c, "possession", `${c.applicant} is to have possession of ${c.data.space ?? "the home"} on ${dateWords(date)}: ${c.against} and their household are to leave by then. If they have not, ${c.applicant} may ask our registrar for a warrant, which is carried out by those who enforce our orders, and by nobody else.`,
            { amount: arrears, due: date, ...home },
            `${c.against} is ${usd(arrears)} behind with the rent${c.data.breach ? " and has not kept the plan set" : r ? (offer > 0 ? `, and what they offer (${usd(offer)} a month) would not clear it within ${P.plan_months} months` : " and offers no plan to pay") : " and did not answer"}: ordering possession by ${dateWords(date)}.`);
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
        const upheld = !r || shown || this.rng(`uphold-${c.id}`).below(10_000) < (this.p.uphold_bps[c.matter] ?? this.p.uphold_bps.other ?? 5_000);
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

export const desk: BehaviourModule = {
  name: "office.desk",
  // (Its counter: docs/behaviour/standing-work.md. What is routine is what the procedure settles on the record.)
  routines: [{ task: "answer", at: "office", every: 1, what: "The desk's staff take in each application, tell the one it is against and give them time to answer, and decide what the record settles: the other side's own answer, no answer at all, or a paper the applicant can show. A case the record cannot settle is put before the office-holder.",
    papers: [
      { kind: "application", how: "taken in; the one it is against is told and given time to answer; decided on the record when that time has run, or put before the office-holder" },
      { kind: "complaint_response", how: "filed with its application, which is decided on it when the time to answer has run" },
    ] }],
  answers: { office: "the desk", acts: "What it acts on: an application made to it about something it has said it hears, which it puts to the other side and decides by its procedure." },
  issues: P.DESK,
  version: "0.1.0", // 0.1.0: a body that hears grievances (docs/behaviour/frictions.md)
  doc: "docs/behaviour/frictions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      title: "desk", // what it calls itself in its notice
      hears: [] as Hears[],
      answer_days: HEARING_DEFAULTS.answer_days,
      cases_per_day: HEARING_DEFAULTS.cases_per_day,
      uphold_bps: HEARING_DEFAULTS.uphold_bps,
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
    const hearings = new Hearings(me, ctx.rng, { hears: p.hears, answer_days: p.answer_days, cases_per_day: p.cases_per_day, uphold_bps: { ...HEARING_DEFAULTS.uphold_bps, ...p.uphold_bps }, within_days: p.within_days, refer_to: p.refer_to });
    let said = false;
    return noting(book, stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const steps: Step[] = [];
        steps.push(...routines.set(book, counter.order(p.office || ctx.position || "office")));
        if (!said && p.part !== "staff") {
          said = true;
          const standing = book.open("hearing").find((r: StatementRecord) => r.speaks_for === me && r.offer?.hears);
          if (!standing && p.hears.length) steps.push(because("Saying what we hear, so that whoever has such a matter can bring it.",
            say("hearing", `The ${p.title} hears: ${p.hears.map((h) => h.about.replace(/_/g, " ")).join(", ")}. Apply in writing${p.fee > 0 ? `; the fee is ${usd(p.fee)}` : "; there is no fee"}.`,
              { visible: "public", offer: hearingOffer(me, p.hears, { fee: p.fee, account: p.account, members_of: p.members_of }), data: { hears: p.hears.map((h) => h.about), ...(p.fee > 0 ? { fee: p.fee } : {}) } })));
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
