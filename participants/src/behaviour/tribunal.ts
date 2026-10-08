// tribunal.member and tribunal.registrar: a civil tribunal (docs/behaviour/justice.md; docs/design/world-expansion.md
// 5). Justice is people and records: a party applies; the tribunal lists the application for a hearing and tells both
// sides; the respondent may answer; on the day the member decides on the record, under the laws in force, and makes an
// order. Nothing happens because of an order unless someone acts on it: the parties obey it or not, and an unpaid
// order to pay is enforced by the registrar, who orders the debtor's bank to pay from what it holds (a garnishee order).

import { cites } from "../contracts";
import { cents } from "../money";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, breaches, noting, DAY, say, type Step, usd } from "./common";
import { stepper } from "./firms";
import * as P from "./papers";

/** The kinds of application a tribunal hears here: a notice of rent increase said to breach the law; a debt unpaid. */
export const APPLICATION_KINDS = ["rent_increase", "debt", "charge"] as const;

export const member: BehaviourModule = {
  name: "tribunal.member",
  answers: {"office": "the tribunal", "acts": "What it acts on: an application made to it by a party to a dispute, which it hears and decides by the laws in force."},
  issues: P.TRIBUNAL_MEMBER,
  version: "0.2.1",
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      hearing_after_days: 21, // listed for a hearing this long after it's made (the respondent's time to answer)
      pay_within_days: 28, // an order to pay: within this long
    }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const listed = new Map<string, number>(); // application -> its hearing
    const decided = new Set<string>();
    return noting(book, stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- applications: listed for a hearing, both sides told ----
        for (const a of book.open("tribunal_application").filter((x) => (x.addressed_to ?? []).includes(me) && !listed.has(x.id) && !decided.has(x.id))) {
          const kind = String(a.data?.kind ?? "");
          const against = String(a.data?.against ?? "");
          const applicant = a.speaks_for!;
          if (!(APPLICATION_KINDS as readonly string[]).includes(kind) || !against || against === applicant) {
            decided.add(a.id);
            steps.push(because(`An application we can't hear (${kind || "of no kind"}${against ? "" : ", against no one"}): rejected.`,
              say("tribunal_order", `Application ${a.id} rejected: the tribunal can't hear it.`, { to: [applicant], visible: [applicant, me], basis: a.id, data: { application: a.id, kind, finding: "rejected" } })));
            continue;
          }
          const hearing = t + p.hearing_after_days * DAY;
          listed.set(a.id, hearing);
          steps.push(because(`An application (${kind}) by ${applicant} against ${against}: listing it for a hearing on day ${Math.floor(hearing / DAY)}, and telling both.`,
            say("hearing_notice", `Notice of hearing: application ${a.id} (${kind}) by ${applicant} against ${against}, to be heard on day ${Math.floor(hearing / DAY)}. The respondent may answer before then.`,
              { to: [applicant, against], visible: [applicant, against, me], basis: a.id, data: { application: a.id, kind, applicant, against, hearing_at: hearing } })));
        }
        // ---- hearings: on the day, on the record ----
        for (const [id, hearing] of [...listed]) {
          if (t < hearing) continue;
          listed.delete(id);
          decided.add(id);
          const a = book.records.get(id) as any;
          if (!a) continue;
          const kind = String(a.data.kind), applicant = a.speaks_for as string, against = String(a.data.against);
          const answer = book.open("tribunal_response").filter((r) => cites(r, id) && r.speaks_for === against).sort((x, y) => y.at - x.at)[0];
          const order = (finding: string, text: string, data: object, why: string) => steps.push(because(why,
            say("tribunal_order", `Order on application ${id}: ${text}`, { to: [applicant, against], visible: [applicant, against, me], basis: id, data: { application: id, kind, applicant, against, finding, ...data } })));
          if (kind === "rent_increase") {
            // The notice, tested against the laws in force when it was given, as the landlord gave it.
            // (The original if we can see it; otherwise the copy the applicant tendered: what passed between the parties.)
            const n = (book.records.get(String(a.data.notice)) ?? (a.data.evidence?.id === a.data.notice ? a.data.evidence : undefined)) as any;
            if (n?.record !== "statement" || n.kind !== "rent_increase" || n.speaks_for !== against || !(n.addressed_to ?? []).includes(applicant)) {
              order("dismissed", "dismissed: no such notice from the respondent to the applicant.", { notice: a.data.notice }, "The notice the application names isn't on the record as the respondent's to the applicant: dismissed.");
              continue;
            }
            const broken = breaches(book, { block: "publish", kind: "rent_increase", data: n.data }, against, n.at);
            if (broken.length) order("invalid", `the notice of rent increase ${n.id} breaches ${broken.map((l) => l.id).join(", ")} and is invalid; the rent stays as it was.`, { notice: n.id, laws: broken.map((l) => l.id) },
              `The notice breaches ${broken.map((l) => l.id).join(", ")}${answer ? " (whatever the respondent says)" : " (the respondent didn't answer)"}: the increase is invalid.`);
            else order("valid", `the notice of rent increase ${n.id} is valid; the application is dismissed.`, { notice: n.id }, "The notice breaches no law in force when it was given: dismissed.");
          } else if (kind === "charge") {
            // A charge (crime): the police's evidence that the respondent took goods; proven, the taker makes good what they
            // were worth to whom they were taken from.
            const ev = a.data.evidence ?? {};
            if (ev.found !== against || !a.data.account) {
              order("dismissed", "dismissed: the evidence doesn't show the respondent took them.", {}, "The evidence doesn't name the respondent: dismissed.");
              continue;
            }
            const amount = cents(a.data.amount ?? 0);
            order("pay", `proven: the respondent took ${ev.goods ?? "goods"} from ${a.data.victim} at ${ev.at}, and is to pay them ${usd(amount)} by day ${Math.floor((t + p.pay_within_days * DAY) / DAY)}.`,
              { victim: a.data.victim, amount, to: a.data.account, due: t + p.pay_within_days * DAY, report: a.data.report },
              `The police's investigation found ${against} took them${answer ? " (whatever they say)" : " (they didn't answer)"}: proven; ordering them to make good the ${usd(amount)}.`);
          } else if (kind === "debt") {
            // A debt on the record (the applicant's, against the respondent), less what the respondent says it has paid.
            const c = (book.records.get(String(a.data.claim)) ?? (a.data.evidence?.id === a.data.claim ? a.data.evidence : undefined)) as any;
            if (c?.record !== "claim" || c.holder !== applicant || c.counterparty !== against) {
              order("dismissed", "dismissed: no such debt recorded by the applicant against the respondent.", { claim: a.data.claim }, "The debt the application names isn't on the record: dismissed.");
              continue;
            }
            const paid = answer ? cents(answer.data?.paid ?? 0) : 0;
            const owed = cents(c.about?.amount ?? 0) - paid;
            if (owed <= 0) order("paid", "the debt has been paid; dismissed.", { claim: c.id, paid }, `The respondent says it has paid the ${usd(paid)} owed: dismissed.`);
            else order("pay", `the respondent is to pay the applicant ${usd(owed)} by day ${Math.floor((t + p.pay_within_days * DAY) / DAY)}.`,
              { claim: c.id, amount: owed, to: a.data.account, due: t + p.pay_within_days * DAY },
              `A debt of ${usd(cents(c.about?.amount ?? 0))} on the record${paid ? `, ${usd(paid)} of it paid, the respondent says` : answer ? "" : " (the respondent didn't answer)"}: ordering payment of ${usd(owed)}.`);
          }
        }
        return steps;
      },
    ));
  },
};

export const registrar: BehaviourModule = {
  name: "tribunal.registrar",
  answers: {"office": "the tribunal's registry", "acts": "What it acts on: an order of the tribunal to pay that has gone unpaid, which it enforces by an order to the debtor's bank."},
  issues: P.TRIBUNAL_REGISTRAR,
  issuesWith: (p) => ({ banks: p.banks ?? [] }),
  version: "0.1.0",
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 10 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({ banks: [] as string[] }, ctx.params); // the banks it can order (the world's)
    need(p, ["banks"], "tribunal.registrar");
    const me = ctx.entity;
    const book = new Book();
    const done = new Set<string>();
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // A creditor asks for an order to pay to be enforced: once it's due, the debtor's banks are ordered to pay it from
        // what they hold for the debtor (what's unpaid, as the creditor says).
        for (const r of book.open("enforcement_request").filter((x) => (x.addressed_to ?? []).includes(me) && !done.has(x.id))) {
          const o = book.records.get(String(r.data?.order)) as any;
          if (o?.kind === "tribunal_order" && o.data?.finding === "pay" && t < Number(o.data.due)) continue; // (not due yet)
          done.add(r.id);
          if (o?.kind !== "tribunal_order" || o.data?.finding !== "pay" || o.data.applicant !== r.speaks_for || !o.data.to) {
            steps.push(because("A request to enforce something that isn't an order to pay this creditor: declined.", say("enforcement_decline", "Declined: no order to pay you to enforce.", { to: [r.speaks_for!], visible: [r.speaks_for!, me], basis: r.id })));
            continue;
          }
          const unpaid = Math.min(cents(o.data.amount), cents(r.data?.unpaid ?? o.data.amount));
          if (unpaid <= 0) continue;
          steps.push(because(`An order to pay ${usd(unpaid)}, due and unpaid: ordering ${o.data.against}'s bank to pay it from what it holds.`,
            say("garnishee_order", `Garnishee order: pay ${usd(unpaid)} owed by ${o.data.against} under order ${o.id} to ${o.data.to}, from what you hold for them.`,
              { to: p.banks, visible: [...p.banks, me, o.data.against, o.data.applicant], basis: o.id, data: { order: o.id, debtor: o.data.against, amount: unpaid, to: o.data.to, claim: o.data.claim } })));
        }
        return steps;
      },
    );
  },
};
