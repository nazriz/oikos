// tribunal.member and tribunal.registrar: a civil tribunal (docs/behaviour/justice.md; docs/design/world-expansion.md
// 5). Justice is people and records: a party applies; the tribunal lists the application for a hearing and tells both
// sides; the respondent may answer; on the day the member decides on the record, under the laws in force, and makes an
// order. Nothing happens because of an order unless someone acts on it: the parties obey it or not, and an unpaid
// order to pay is enforced by the registrar, who orders the debtor's bank to pay from what it holds (a garnishee order).

import { dateWords } from "../forms";
import { cites } from "../contracts";
import { cents } from "../money";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, breaches, CounterWork, noting, DAY, say, StandingWork, type Step, usd, withdraw } from "./common";
import { hearingNotice, Hearings, HEARING_DEFAULTS, type Hears } from "./desk";
import { stepper } from "./firms";
import * as P from "./papers";

/** The kinds of application a tribunal hears here: a notice of rent increase said to breach the law; a debt unpaid. */
export const APPLICATION_KINDS = ["rent_increase", "debt", "charge"] as const;

/** Everything the tribunal says it hears: its own three lists apart from a charge (the police's), and the world's. */
const tribunalHears = (hears: Hears[]): Hears[] => [{ about: "rent_increase", can: ["order"], undoes: true, form: "tribunal_application" }, { about: "debt", can: ["order"], form: "tribunal_application" }, ...hears.map((h) => ({ ...h, form: "tribunal_application" }))];

export const member: BehaviourModule = {
  name: "tribunal.member",
  // (Its registry: docs/behaviour/justice.md, "The registry lists; the member decides". Listing is routine; deciding is not.)
  routines: [{ task: "answer", at: "office", every: 1, what: "The tribunal's registry staff take in each application, list it for a hearing and tell both sides, with the day the other side may answer by. They decide nothing: every case is the member's to decide, on or after its day.",
    papers: [
      { kind: "tribunal_application", how: "taken in and listed; both sides are told, and the other side given the tribunal's time to answer. An application the tribunal does not hear is told so. The case is then the member's to decide" },
      { kind: "tribunal_response", how: "filed with its application, for the member who decides it" },
    ] }],
  opens: (p, me) => ((p.hears ?? []).length && p.part !== "staff" ? [hearingNotice(me, "The tribunal hears", tribunalHears(p.hears), { fee: p.fee, account: p.account })] : []),
  answers: {"office": "the tribunal", "acts": "What it acts on: an application made to it by a party to a dispute, which it hears and decides by the laws in force."},
  issues: P.TRIBUNAL_MEMBER,
  version: "0.7.0", // 0.7.0: decides an application for possession by a stated rule on the tenant's answer and the landlord's reply (left; a notice shorter than the law asks; nothing owed; a plan where the law has one and the offer clears what is owed; else possession), the law on plans read from the world's; 0.6.0: an application for possession of a home the tenant has left is dismissed, and one its maker withdraws is decided by nobody; cases its own file says are already listed are taken as they stand, never listed again; 0.5.0: where a model holds the member's chair in a living town, the tribunal's registry staff list each application and tell both sides, under a standing work order, and the member decides (docs/behaviour/justice.md, "The registry lists; the member decides"); its notice of what it hears is on file when a seat arrives; 0.4.0: hears applications for possession of a let home for arrears: a plan to pay, or possession on a date (docs/behaviour/justice.md, "Possession"); 0.3.0: lists (docs/behaviour/frictions.md): the matters the world says it hears beyond its own three, heard by the common procedure on its own forms, as far as its hearing days go; it says what it hears and what applying costs
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      hearing_after_days: 21, // listed for a hearing this long after it's made (the respondent's time to answer)
      pay_within_days: 28, // an order to pay: within this long
      // Its lists (docs/behaviour/frictions.md, "Venues"): the matters it hears beyond a rent increase, a debt and
      // a charge (none: it hears those three and says nothing of it, as before); how many such cases a day's
      // hearings decide; how often it finds for an applicant with nothing to show; what applying costs, and where
      // the fee is paid.
      hears: [] as Hears[],
      uphold_bps: HEARING_DEFAULTS.uphold_bps,
      fee: 0,
      account: "",
      // Possession of a let home (docs/behaviour/justice.md, "Possession"), where it hears that: the days from its
      // order to the date for possession, and the longest plan to pay it sets (the world's law's figures).
      possession: null as { days: number; plan_months: number; notice_days?: number; plan_consider?: "may" | "must" | "none"; plan_barred_rent_months?: number } | null,
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole tribunal, as code runs one;
      // "staff" its registry, who list; "seat" the member, who decides. `counter`: whether the town gives it a registry.
      part: "" as "" | "seat" | "staff", office: "", counter: false,
    }, ctx.params);
    const routines = new StandingWork(ctx.entity, p.part, ctx.position ? new Set([ctx.position.replace(/-staff$/, "")]) : undefined);
    const counter = new CounterWork(routines, !!p.counter);
    const me = ctx.entity;
    const book = new Book();
    const listed = new Map<string, number>(); // application -> its hearing
    const decided = new Set<string>();
    const lists = p.hears.length ? new Hearings(me, ctx.rng, { hears: p.hears, answer_days: p.hearing_after_days, uphold_bps: { ...HEARING_DEFAULTS.uphold_bps, ...p.uphold_bps }, within_days: p.pay_within_days, refer_to: {}, ...(p.possession ? { possession: p.possession } : {}) },
      { application: ["tribunal_application"], notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }, APPLICATION_KINDS) : undefined;
    const listKinds = new Set(p.hears.map((h) => h.about));
    let said = false;
    return noting(book, stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // (With a registry, and someone in the member's chair: the staff list, while their standing order stands; the
        // member decides. Without one, whoever runs the tribunal does both.)
        const split = counter.offered && p.part !== "";
        const lists_ = !split || (p.part === "staff" && counter.works(book, t)), decides = !split || p.part === "seat";
        steps.push(...routines.set(book, counter.order(p.office || ctx.position || "office")));
        // ---- what it hears, said once, so that whoever has such a matter can bring it ----
        if (lists && !said && p.part !== "staff") {
          said = true;
          const n = hearingNotice(me, "The tribunal hears", tribunalHears(p.hears), { fee: p.fee, account: p.account });
          if (!book.open("hearing").some((r) => r.speaks_for === me)) steps.push(because("Saying what the tribunal hears, so that whoever has such a matter can bring it.", say(n.kind, n.text, { visible: "public", offer: n.offer, data: n.data as object })));
        }
        if (lists && (lists_ || decides)) {
          const before = lists.counts.applications ?? 0;
          steps.push(...lists.steps(book, t, !split ? "all" : lists_ ? "list" : "decide"));
          for (let i = before; i < (lists.counts.applications ?? 0); i++) counter.answered("tribunal_application");
        }
        // (The member's part: the cases on its own three lists that the tribunal's file says are listed, by its
        // notices of hearing, and that no order has yet decided.)
        if (split && decides) {
          const ordered = new Set(book.all("tribunal_order").filter((r) => r.speaks_for === me).map((r) => String(r.data?.application ?? "")));
          for (const n of book.all("hearing_notice").filter((r) => r.speaks_for === me && typeof r.data?.matter !== "string")) {
            const id = String(n.data?.application ?? "");
            if (ordered.has(id)) { decided.add(id); listed.delete(id); } else if (!decided.has(id) && Number.isFinite(Number(n.data?.hearing_at))) listed.set(id, Number(n.data!.hearing_at));
          }
        }
        // ---- applications: listed for a hearing, both sides told ----
        for (const a of !lists_ ? [] : book.open("tribunal_application").filter((x) => (x.addressed_to ?? []).includes(me) && !listed.has(x.id) && !decided.has(x.id))) {
          const kind = String(a.data?.kind ?? "");
          if (listKinds.has(kind)) continue; // (heard on its lists, above)
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
          counter.answered("tribunal_application");
          steps.push(because(`An application (${kind}) by ${applicant} against ${against}: listing it for a hearing on day ${Math.floor(hearing / DAY)}, and telling both.`,
            say("hearing_notice", `Notice of hearing: application ${a.id} (${kind}) by ${applicant} against ${against}, to be heard on day ${Math.floor(hearing / DAY)}. The respondent may answer before then.`,
              { to: [applicant, against], visible: [applicant, against, me], basis: a.id, data: { application: a.id, kind, applicant, against, hearing_at: hearing } })));
        }
        // ---- hearings: on the day, on the record ----
        for (const [id, hearing] of !decides ? [] : [...listed]) {
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
        if (split && p.part === "staff") {
          counter.flush(t);
          const report = routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the tribunal's registry staff", tasks: { ...counter.tasks } });
          counter.reported(report);
          steps.push(...report);
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
  issuesWith: (p) => ({ banks: p.banks ?? [], enforcer: p.enforcer || undefined }),
  version: "0.3.0", // 0.3.0: withdraws a warrant not yet carried out when the landlord withdraws its request (the tenant has gone); 0.2.0: issues a warrant of possession, to whoever carries its warrants out, on an order whose date has passed; 0.1.1: an order to pay that rests on no recorded debt is settled against the order itself
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 10 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    // (The banks it can order; and, where the tribunal orders possession, whoever carries its warrants out and how
    // long they have: the world's.)
    const p = params({ banks: [] as string[], enforcer: "", warrant_days: 14, eviction_notice_days: 0 }, ctx.params);
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
              { to: p.banks, visible: [...p.banks, me, o.data.against, o.data.applicant], basis: o.id, data: { order: o.id, debtor: o.data.against, amount: unpaid, to: o.data.to, claim: o.data.claim ?? o.id } })));
        }
        // A landlord asks for a warrant on an order for possession whose date has passed: issued to whoever carries
        // our warrants out (the world's: its police), naming the home, the tenant and their household, and the day
        // it runs out. The tenant is told. Nothing is done by the paper: someone must go.
        for (const r of book.open("warrant_request").filter((x) => (x.addressed_to ?? []).includes(me) && !done.has(x.id))) {
          const o = book.records.get(String(r.data?.order)) as any;
          if (o?.kind === "tribunal_order" && o.data?.finding === "possession" && t < Number(o.data.due)) continue; // (not due yet)
          done.add(r.id);
          if (!p.enforcer || o?.kind !== "tribunal_order" || o.data?.finding !== "possession" || o.data.applicant !== r.speaks_for) {
            steps.push(because("A request for a warrant on something that isn't an order for possession to this applicant: declined.", say("enforcement_decline", "Declined: no order for possession to you to enforce.", { to: [r.speaks_for!], visible: [r.speaks_for!, me], basis: r.id })));
            continue;
          }
          // (Not before the tenant has had the law's notice of the day; not after the warrant's last day.)
          const notBefore = (Math.floor(t / DAY) + 1 + p.eviction_notice_days) * DAY, until = Math.max(notBefore, t + p.warrant_days * DAY);
          steps.push(because(`An order for possession whose date has passed, and the tenant has not left: a warrant to ${p.enforcer}, to be carried out from ${dateWords(notBefore)} to ${dateWords(until)}.`,
            say("warrant", `Warrant of possession under order ${o.id}: ${o.data.against} and their household are to be removed from ${o.data.space ?? "the home"}, and possession given to ${o.data.applicant}. To be carried out ${p.eviction_notice_days > 0 ? `no sooner than ${dateWords(notBefore)} and ` : ""}by ${dateWords(until)}.`,
              { to: [p.enforcer], visible: [p.enforcer, me, o.data.against, o.data.applicant], basis: o.id, data: { order: o.id, lease: o.data.about, tenant: o.data.against, landlord: o.data.applicant, space: o.data.space, structure: o.data.structure, household: o.data.household ?? [o.data.against], not_before: notBefore, until } })));
        }
        // A landlord who withdraws its request for a warrant (the tenant has gone): the warrant we issued on it, if
        // not yet carried out or run out, is withdrawn, which whoever was to carry it out reads.
        for (const w of book.open("warrant").filter((x) => x.speaks_for === me && !done.has(`w:${x.id}`))) {
          const req = book.all("warrant_request").find((r) => r.data?.order === w.data?.order && r.speaks_for === w.data?.landlord && book.withdrawn.has(r.id));
          if (!req) continue;
          done.add(`w:${w.id}`);
          if (t > Number(w.data?.until ?? Infinity) || book.all("warrant_executed").some((x) => x.data?.warrant === w.id)) continue;
          steps.push(because(`${w.data?.landlord} has withdrawn its request for the warrant ${w.id} (the tenant has left): withdrawing the warrant.`, withdraw(w.id, "Withdrawn: the landlord says the tenant has left the home.")));
        }
        return steps;
      },
    );
  },
};
