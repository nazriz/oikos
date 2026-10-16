// What stands open at the offices that hear and decide, and at a lender's (docs/behaviour/office-books.md): the
// tribunal's member and registrar, a complaints desk, a union's organiser, a bank's lending office. One reader each,
// a plain restatement of what that module's code works out for itself wake after wake from the same papers, read the
// same way, with the module's own defaults for its parameters. Nothing here decides or does anything, and nothing is
// read that the office's code is not shown. (Where the code keeps a fact only in its memory, the reader derives it
// from the papers the code's acts left on file; each reader says below what it cannot.)

import { planLawWords } from "./papers";
import { basesOf, channels, type Observation, type StatementRecord } from "../contracts";
import { dateWords } from "../forms";
import type { OfficeBooks, OpenHeading, OpenItem, ParticipantContext } from "../module";
import { cents } from "../money";
import { Book, DAY, madeAt, MONTH, ownAccount, usd, whenWords } from "./common";
import { PAPER } from "./frictions";

// ------------------------------------------------------------------ small shared things

const oldestFirst = (a: OpenItem, b: OpenItem) => (a.since ?? 0) - (b.since ?? 0) || (a.id < b.id ? -1 : 1);
const heading = (what: string, items: OpenItem[]): OpenHeading[] => (items.length ? [{ what, items: items.sort(oldestFirst) }] : []);
/** A heading of things whose day has come and that wait on the office-holder: said in every paper (`always`). */
const pressing = (what: string, items: OpenItem[]): OpenHeading[] => heading(what, items).map((h) => ({ ...h, always: true as const }));
/** A heading of things that wait for a day: the soonest first. */
const byDay = (what: string, items: OpenItem[]): OpenHeading[] => (items.length ? [{ what, items: items.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || oldestFirst(a, b)) }] : []);
/** Whether a day named on a paper has come: the day itself counts, from its first hour (a case is decided "on or
 * after its day", and whoever sits that morning must find it on the list). */
const dayCome = (by: number, t: number): boolean => Math.floor(by / DAY) <= Math.floor(t / DAY);
const addressed = (r: StatementRecord, me: string) => (r.addressed_to ?? []).includes(me);
const words = (s: unknown): string => String(s ?? "").replace(/_/g, " ");
const text = (x: unknown): string => (typeof x === "string" ? x : "");
const finite = (x: unknown): number | undefined => (x !== undefined && x !== null && x !== "" && Number.isFinite(Number(x)) ? Number(x) : undefined);
/** An amount in cents, or 0 where what is written is not one. */
const money = (x: unknown): number => {
  try {
    return cents(x as any);
  } catch {
    return 0;
  }
};
/** The applications a paper is about: the one its data names, and any it cites. */
const appsOf = (r: StatementRecord): string[] => {
  const d = (r.data ?? {}) as { application?: unknown };
  return [...new Set([...(typeof d.application === "string" ? [d.application] : []), ...basesOf(r)])];
};

// ------------------------------------------------------------------ venues: applications, notices, decisions

interface Forms { application: string[]; notice: string; response: string; decision: string }
const COMMON_FORMS: Forms = { application: [PAPER.application], notice: PAPER.notice, response: PAPER.response, decision: PAPER.decision };
const TRIBUNAL_FORMS: Forms = { application: ["tribunal_application"], notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" };

/** What an office has filed on the applications made to it: its notices, its decisions, and who has answered. */
class Filed {
  readonly notice = new Map<string, StatementRecord>(); // application -> our latest notice of it
  readonly decided = new Set<string>(); // applications we have decided (or rejected)
  private readonly answers = new Map<string, Set<string>>(); // application -> who answered it
  constructor(book: Book, readonly me: string, readonly forms: Forms) {
    for (const n of book.open(forms.notice)) {
      if (n.speaks_for !== me) continue;
      for (const a of appsOf(n)) if ((this.notice.get(a)?.at ?? -1) <= n.at) this.notice.set(a, n);
    }
    for (const d of book.open(forms.decision)) if (d.speaks_for === me) for (const a of appsOf(d)) this.decided.add(a);
    // (An application its maker has withdrawn stands open no longer.)
    for (const a of this.notice.keys()) if (book.withdrawn.has(a)) this.decided.add(a);
    for (const r of book.open(forms.response)) for (const a of appsOf(r)) this.answers.set(a, (this.answers.get(a) ?? new Set()).add(String(r.speaks_for)));
  }
  answered(application: string, against: string): boolean {
    return this.answers.get(application)?.has(against) ?? false;
  }
}

/** The matter an application or a notice is about, as the venue's papers name it. */
const matterOf = (d: any): string => words(d?.matter ?? d?.kind ?? "something");

/** Applications addressed to the office that it has neither taken in (no notice of ours) nor decided. */
function untaken(book: Book, filed: Filed, why: string): OpenItem[] {
  const out: OpenItem[] = [];
  for (const kind of filed.forms.application) {
    for (const a of book.open(kind)) {
      if (!addressed(a, filed.me) || filed.notice.has(a.id) || filed.decided.has(a.id)) continue;
      const d = (a.data ?? {}) as any;
      out.push({ id: a.id, since: a.at, ...(d.amount !== undefined ? { amount: money(d.amount) } : {}),
        line: `${a.id}: ${a.speaks_for} applied ${dateWords(a.at)} about ${matterOf(d)}${d.against ? ` against ${d.against}` : ""}${d.amount !== undefined ? `, seeking ${usd(money(d.amount))}` : ""}; ${why}` });
    }
  }
  return out;
}

/**
 * Applications the office has taken in (it has told the other side) and not decided: those still within the other
 * side's time to answer, and those whose time has run. A tribunal's own three kinds name a hearing day (`hearing_at`)
 * and have no `answer_by`: those are the member's own, not the lists', and are left to the caller.
 */
function takenIn(book: Book, filed: Filed, t: number, aside: ReadonlySet<string> = new Set()): { waiting: OpenItem[]; ran: OpenItem[] } {
  const waiting: OpenItem[] = [], ran: OpenItem[] = [];
  const seen = new Set<string>();
  for (const [app, n] of filed.notice) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const d = (n.data ?? {}) as any;
    if (filed.decided.has(app) || aside.has(app) || d.answer_by === undefined || !Number.isFinite(Number(d.answer_by))) continue;
    const by = Number(d.answer_by);
    const against = text(d.against);
    const who = text(d.applicant) || String((book.records.get(app) as any)?.speaks_for ?? "someone");
    const amount = d.amount !== undefined ? money(d.amount) : undefined;
    const what = `${who}'s application ${app} about ${matterOf(d)}${against ? ` against ${against}` : ""}${amount ? `, seeking ${usd(amount)}` : ""}`;
    const said = against ? (filed.answered(app, against) ? `${against} has answered` : `${against} has not answered`) : "";
    if (!dayCome(by, t)) waiting.push({ id: n.id, since: madeAt(n), due: by, ...(amount ? { amount } : {}), line: `${n.id}: ${what}, taken in ${whenWords(madeAt(n))}; ${against || "the other side"} has until ${dateWords(by)} to answer${said ? ` (${said})` : ""}` });
    else ran.push({ id: n.id, since: by, due: by, ...(amount ? { amount } : {}), line: `${n.id}: ${what}, taken in ${whenWords(madeAt(n))}; the time to answer ${t >= by ? "ran out" : "runs out today,"} ${dateWords(by)}${said ? ` (${said})` : ""}; not decided` });
  }
  return { waiting, ran };
}

// ------------------------------------------------------------------ tribunal.member

/**
 * The tribunal's member (tribunal.member). Reads, as its code does: applications of kind `tribunal_application`
 * addressed to it; its own `hearing_notice`s (a notice of its three kinds names the hearing day, `hearing_at`; a
 * notice of one of its lists names the day the other side's time to answer runs out, `answer_by`); its own
 * `tribunal_order`s, which close a case; and `tribunal_response`s citing an application, from the respondent.
 * Not expressible from papers: the module's in-memory `listed`/`decided` sets are rebuilt from the notices and orders
 * on file, so an application it rejected or heard is closed here by its order and not otherwise; the cases a day's
 * hearings could not reach (its member's hours, foundations F6) show as "time has run, not decided" as they are.
 */
export function tribunalMemberBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) {
      const filed = new Filed(book, me, TRIBUNAL_FORMS);
      const notYet = untaken(book, filed, "not yet listed for a hearing");
      // (Our own three kinds: a hearing day.)
      const ownDay = new Set<string>();
      const due: OpenItem[] = [], waiting: OpenItem[] = [];
      for (const [app, n] of filed.notice) {
        const d = (n.data ?? {}) as any;
        if (d.answer_by !== undefined || filed.decided.has(app)) continue;
        const day = finite(d.hearing_at);
        if (day === undefined) continue;
        ownDay.add(app);
        const against = text(d.against);
        const who = text(d.applicant) || String((book.records.get(app) as any)?.speaks_for ?? "someone");
        const what = `${who}'s application ${app} (${words(d.kind)}) against ${against || "someone"}`;
        const said = against ? (filed.answered(app, against) ? `${against} has answered` : `${against} has not answered`) : "";
        if (dayCome(day, t)) due.push({ id: n.id, since: day, due: day, line: `${n.id}: ${what}, listed ${dateWords(n.at)} for hearing on ${dateWords(day)}, which has come; no order made (${said || "no respondent named"})` });
        else waiting.push({ id: n.id, since: n.at, due: day, line: `${n.id}: ${what}, listed ${dateWords(n.at)} to be heard on ${dateWords(day)} (${said || "no respondent named"})` });
      }
      // Applications for possession of a let home (docs/behaviour/justice.md, "Possession"): each with the home, what
      // the landlord says is owed, and whether the tenant has answered and with what (what they say they have paid
      // since, what they offer a month toward the rest), as the tribunal's own procedure reads them.
      const possession: OpenItem[] = [], possessionDue: OpenItem[] = [];
      for (const [app, n] of filed.notice) {
        const d = (n.data ?? {}) as any;
        const a = book.records.get(app) as any;
        if (filed.decided.has(app) || (d.matter ?? a?.data?.matter) !== "possession" || ownDay.has(app)) continue;
        ownDay.add(app);
        const ad = (a?.data ?? {}) as any;
        const against = text(d.against) || text(ad.against);
        const who = text(d.applicant) || String(a?.speaks_for ?? "someone");
        const by = finite(d.answer_by ?? d.hearing_at);
        const answer = book.open(TRIBUNAL_FORMS.response).filter((r) => appsOf(r).includes(app) && r.speaks_for === against).sort((x, y) => y.at - x.at)[0];
        // (What the file shows of how the tenant was told: the notice to vacate the application relies on, as the
        // application states it, and our own notice of hearing, on the record addressed to the tenant. That is how
        // a paper is served here; nothing else of it exists.)
        const relied = ad.notice ? `; it relies on notice to vacate ${ad.notice}${finite(ad.notice_given) !== undefined ? `, given ${whenWords(Number(ad.notice_given))}` : ""}${finite(ad.notice_by) !== undefined ? `, to leave by ${whenWords(Number(ad.notice_by))}` : ""}` : "";
        const told = `; our notice of hearing ${n.id} is on the record, addressed to ${(n.addressed_to ?? []).join(" and ") || "both sides"}, since ${dateWords(n.at)}`;
        // (The tenant's answer as the tenant gave it, each thing they told and nothing for what they left out; and
        // the landlord's reply to it, where there is one.)
        const said = answer ? answerWords(against, answer) : `${against || "the tenant"} has not answered`;
        const reply = book.all("tribunal_reply").filter((r) => r.speaks_for === who && String(r.data?.application ?? "") === app).sort((x, y) => y.at - x.at)[0];
        const replied = reply ? `; ${who} replied ${dateWords(reply.at)} (${reply.id}): its rent book shows ${usd(money(reply.data?.owed))} owed${reply.data?.takes_plan === true ? ", and it would take the plan offered" : reply.data?.takes_plan === false ? ", and it would not take the plan offered" : ""}${text(reply.data?.words) ? `; "${text(reply.data?.words)}"` : ""}` : "";
        const owed = ad.amount !== undefined ? money(ad.amount) : undefined;
        (by !== undefined && dayCome(by, t) ? possessionDue : possession).push({ id: app, since: a?.at ?? n.at, ...(by !== undefined ? { due: by } : {}), ...(owed !== undefined ? { amount: owed } : {}),
          line: `${app}: ${who} applies for possession of ${ad.space ?? "a let home"} from ${against || "its tenant"}${ad.about ? ` (lease ${ad.about})` : ""}${owed !== undefined ? `, saying ${usd(owed)} of rent is owed` : ""}${ad.breach ? ", and that a plan the tribunal set was not kept" : ""}${relied}; taken in ${dateWords(n.at)}${told}${by !== undefined ? `, ${t >= by ? `the tenant's time to answer ran out ${dateWords(by)}` : dayCome(by, t) ? `the tenant's time to answer runs out today, ${dateWords(by)}` : `the tenant has until ${dateWords(by)} to answer`}` : ""}; ${said}${replied}; not decided` });
      }
      const lists = takenIn(book, filed, t, ownDay);
      return [
        // (Every case that stands open, with the day the other side may answer by and whether an answer has come:
        // those whose day has come first, said in every paper for as long as they stand; then those waiting, the
        // soonest first, however long ago each was listed.)
        ...pressing(`Applications for possession of a let home whose day has come, not decided${lawOfOrder(book)}`, possessionDue),
        ...pressing("Cases listed whose hearing day has come, with no order made", due),
        ...pressing("Applications on the tribunal's lists whose time to answer has run, not decided", lists.ran),
        ...heading("Applications to the tribunal, not yet listed for a hearing", notYet),
        ...byDay("Applications for possession of a let home, waiting for the tenant's time to answer", possession),
        ...byDay("Cases listed, waiting for their day", [...waiting, ...lists.waiting]),
      ];
    },
  };
}

/** A tenant's answer to an application for possession, as they gave it: what they told, in the order of the
 * tribunal's form, and nothing for what they left out (an answer that says little reads as one). */
function answerWords(against: string, a: StatementRecord): string {
  const d = (a.data ?? {}) as any, parts: string[] = [];
  if (d.left) parts.push(`they have left the home${finite(d.left_at) !== undefined ? `, on ${dateWords(Number(d.left_at))}` : ""}`);
  if (d.owes !== undefined) parts.push(`says ${usd(money(d.owes))} is owed today${d.disputes_sum ? ", less than the landlord says" : ""}`);
  if (d.paid !== undefined) parts.push(`says ${usd(money(d.paid))} has been paid since`);
  if (d.disputes_notice) parts.push("says the notice to vacate did not give the days the law asks");
  if (d.offer !== undefined) parts.push(money(d.offer) > 0 ? `could pay ${usd(money(d.offer))} ${finite(d.every_days) && Number(d.every_days) !== 30 ? `every ${d.every_days} days` : "a month"} toward what is owed, beyond the rent` : "can pay nothing toward what is owed beyond the rent");
  if (finite(d.out_of_work_since) !== undefined) parts.push(`out of work since ${dateWords(Number(d.out_of_work_since))}`);
  if (d.pay_short) parts.push("pay has come short of what was agreed");
  if (d.claim === "refused") parts.push(`a claim for support was refused${finite(d.claim_on) !== undefined ? ` on ${dateWords(Number(d.claim_on))}` : ""}`);
  else if (d.claim === "pending") parts.push("a claim for support has been made and not decided");
  if (d.ill) parts.push("illness in the home");
  if (finite(d.people) !== undefined) parts.push(`${d.people} live in the home${finite(d.children) ? `, ${d.children} of them children` : ""}${Array.isArray(d.ages) && d.ages.length ? ` (aged ${d.ages.join(", ")})` : ""}`);
  if (finite(d.lived_days) !== undefined) parts.push(`has lived there ${d.lived_days} days`);
  if (d.go_to === "nowhere") parts.push("has nowhere else to go");
  else if (d.go_to === "someone_to_ask") parts.push("has someone they could ask to take them in");
  else if (d.go_to === "means_for_another") parts.push("has the means for another home");
  return `${against} answered ${dateWords(a.at)} (${a.id})${parts.length ? `: ${parts.join("; ")}` : ", saying nothing more"}`;
}

/** What the law on possession says of the order, from the law as published (its typed fields), for the head of the
 * member's list of cases to decide: the same words the law itself has. Nothing where no such law is on file. */
function lawOfOrder(book: Book): string {
  const l = book.open("law").filter((r) => r.data?.tenancy === "possession").sort((a, b) => b.at - a.at)[0] ?? book.all("procedure").filter((r) => r.data?.law === "law-possession" && r.data?.plan_consider !== undefined)[0];
  const d = l?.data as any;
  if (!d || d.plan_consider === undefined) return "";
  return `. The law on the order (possession order form): ${planLawWords({ plan_months: Number(d.plan_months ?? 0), plan_consider: d.plan_consider, plan_barred_rent_months: d.plan_barred_rent_months, cure_days: d.cure_days })} An application that does not meet what the law asks is dismissed`;
}

// ------------------------------------------------------------------ tribunal.registrar

/**
 * The tribunal's registrar (tribunal.registrar). Reads `enforcement_request`s addressed to it and the order each
 * names (a `tribunal_order` of finding `pay`, with its due date and amount); a request is answered by a
 * `garnishee_order` of ours for that order made after it, or an `enforcement_decline` citing it. The code also drops,
 * without a paper, a request whose unpaid sum is nothing: those are left out here as it leaves them. Not expressible:
 * nothing else; its only memory (`done`) is what its papers show.
 */
export function tribunalRegistrarBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) {
      const garnished = new Map<string, number[]>(); // order -> when we ordered a bank to pay under it
      for (const g of book.open("garnishee_order")) if (g.speaks_for === me && typeof g.data?.order === "string") garnished.set(g.data.order, [...(garnished.get(g.data.order) ?? []), g.at]);
      const declined = new Set<string>();
      for (const d of book.open("enforcement_decline")) if (d.speaks_for === me) for (const b of basesOf(d)) declined.add(b);
      const items: OpenItem[] = [];
      for (const r of book.open("enforcement_request")) {
        if (!addressed(r, me) || declined.has(r.id) || (garnished.get(String(r.data?.order)) ?? []).some((at) => at >= r.at)) continue;
        const o = book.records.get(String(r.data?.order)) as any;
        const pays = o?.kind === "tribunal_order" && o.data?.finding === "pay" && o.data.applicant === r.speaks_for && !!o.data.to;
        if (!pays) {
          items.push({ id: r.id, since: r.at, line: `${r.id}: ${r.speaks_for} asked ${dateWords(r.at)} for order ${r.data?.order ?? "(none named)"} to be enforced; no order of ours to pay them is on file; not answered` });
          continue;
        }
        const unpaid = Math.min(money(o.data.amount), money(r.data?.unpaid ?? o.data.amount));
        if (unpaid <= 0) continue;
        const due = Number(o.data.due);
        items.push({ id: r.id, since: r.at, amount: unpaid,
          line: `${r.id}: ${r.speaks_for} asked ${dateWords(r.at)} for order ${o.id} to be enforced against ${o.data.against}, ${usd(unpaid)} unpaid; the order falls due ${dateWords(due)}${t >= due ? ", and that date has passed" : ", and that date has not come"}; not answered` });
      }
      // Requests for a warrant of possession (docs/behaviour/justice.md, "Possession"): no warrant of ours on that order
      // since, and not declined.
      const warrants: OpenItem[] = [];
      const issued = new Map<string, number[]>();
      for (const w of book.open("warrant")) if (w.speaks_for === me && typeof w.data?.order === "string") issued.set(w.data.order, [...(issued.get(w.data.order) ?? []), w.at]);
      for (const r of book.open("warrant_request")) {
        if (!addressed(r, me) || declined.has(r.id) || (issued.get(String(r.data?.order)) ?? []).some((at) => at >= r.at)) continue;
        const o = book.records.get(String(r.data?.order)) as any;
        const ours = o?.kind === "tribunal_order" && o.data?.finding === "possession" && o.data.applicant === r.speaks_for;
        const due = Number(o?.data?.due);
        warrants.push({ id: r.id, since: r.at, line: ours
          ? `${r.id}: ${r.speaks_for} asked ${dateWords(r.at)} for a warrant under order ${o.id}, for possession of ${o.data.space ?? "the home"} from ${o.data.against}; the order's date is ${dateWords(due)}${t >= due ? ", which has passed" : ", which has not come"}; no warrant issued`
          : `${r.id}: ${r.speaks_for} asked ${dateWords(r.at)} for a warrant under ${r.data?.order ?? "(no order named)"}; no order for possession to them is on file; not answered` });
      }
      return [...heading("Requests to enforce an order, not answered", items), ...heading("Requests for a warrant of possession, not answered", warrants)];
    },
  };
}

// ------------------------------------------------------------------ office.desk (and a union's cases)

/** The headings of a body that hears grievances on the common forms; `taking` says whose applications they are. */
function venueHeadings(book: Book, me: string, t: number, o: { forDecision: boolean; of: string }): OpenHeading[] {
  const filed = new Filed(book, me, COMMON_FORMS);
  const before = o.forDecision ? book.open("case_for_decision").filter((n) => n.speaks_for === me && typeof n.data?.application === "string" && !filed.decided.has(n.data.application)) : [];
  const forDecision = before.map((n): OpenItem => {
    const d = (n.data ?? {}) as any;
    const claimed = d.case?.data?.amount !== undefined ? money(d.case.data.amount) : 0;
    return { id: n.id, since: n.at, ...(claimed ? { amount: claimed } : {}),
      line: `${n.id}: application ${d.application} (${matterOf(d)}) by ${d.applicant} against ${d.against}${claimed ? `, seeking ${usd(claimed)}` : ""}, put before the office-holder ${dateWords(n.at)}; not decided` };
  });
  const put = new Set(before.map((n) => String(n.data!.application)));
  const { waiting, ran } = takenIn(book, filed, t, put);
  const not = untaken(book, filed, `not yet taken in`);
  return [
    ...(o.forDecision ? pressing("Cases put before the office-holder for decision, not decided", forDecision) : []),
    ...heading(`${o.of} taken in, waiting on the other side's answer`, waiting),
    ...heading(`${o.of} whose time for the other side to answer has run, not decided`, ran),
    ...heading(`${o.of} addressed to us, not yet taken in`, not),
  ];
}

/**
 * The complaints desk (office.desk: a council's desk, an ombudsman, a consumer desk). Reads, on the common forms
 * (`application`, `complaint_notice`, `complaint_response`, `venue_decision`): applications addressed to it; its own
 * notices (`answer_by` is the day the other side's time runs out); its own decisions (which close a case); and its
 * own `case_for_decision` notes, the cases its staff put before the office-holder. Not expressible: a case the code
 * office rejected or referred shows only by its decision on file; the member's hours for deciding (foundations F6) are
 * the kernel's, and show only as cases whose time has run and which stay undecided.
 */
export function deskBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) { return venueHeadings(book, me, t, { forDecision: true, of: "Applications" }); },
  };
}

// ------------------------------------------------------------------ union.organiser

/**
 * A union's organiser (union.organiser). Reads: its own `wage_claim`s and the `wage_offer`s addressed to it on them
 * (`data.claim`), its `offer_accepted`, its `action_ballot`s (`data.closes`; the members it balloted are the ballot's
 * addressees), the `vote` records on them (the latest of each member, as the module counts them), its
 * `ballot_result`s, its `industrial_action` notices (`data.from`, `data.until`) with its `stop_work` and
 * `return_to_work`, the `enterprise_agreement`s addressed to it, employers' public `closure` notices,
 * `membership_application`s addressed to it and the membership agreements it holds, and (where its params say it
 * hears members' matters) the common forms of a venue. Not expressible from papers: the module's `Dispute` stage
 * (it is derived: a claim stands until an agreement, a failed ballot or a closure ends it); the turnout and
 * pass thresholds it applies to a ballot are the module's own and are not judged here (the count is stated).
 */
export function unionBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const p = (ctx.params ?? {}) as { hears?: unknown[] };
  const hears = Array.isArray(p.hears) && p.hears.length > 0;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) {
      const closed = new Set<string>();
      for (const c of book.open("closure")) closed.add(text(c.data?.firm) || String(c.speaks_for));
      const agreedAt = new Map<string, number>(); // employer -> when an enterprise agreement was last sent to us
      for (const ea of book.open("enterprise_agreement")) if (addressed(ea, me) && typeof ea.data?.employer === "string") agreedAt.set(ea.data.employer, Math.max(agreedAt.get(ea.data.employer) ?? 0, ea.at));
      const over = (employer: string, since: number) => closed.has(employer) || (agreedAt.get(employer) ?? -1) >= since;
      // ---- claims and offers ----
      const claims = new Map<string, StatementRecord>(); // employer -> our latest claim
      for (const c of book.open("wage_claim")) if (c.speaks_for === me && typeof c.data?.employer === "string" && (claims.get(c.data.employer)?.at ?? -1) <= c.at) claims.set(c.data.employer, c);
      const ballots = book.open("action_ballot").filter((b) => b.speaks_for === me);
      const results = new Map<string, StatementRecord>();
      for (const r of book.open("ballot_result")) if (r.speaks_for === me) for (const b of appsOf(r).concat(typeof r.data?.ballot === "string" ? [r.data.ballot] : [])) results.set(b, r);
      const failed = new Set<string>(); // claims whose ballot found no mandate
      for (const b of ballots) if (results.get(b.id)?.data?.passed === false && typeof b.data?.claim === "string") failed.add(b.data.claim);
      const offerOf = new Map<string, StatementRecord>(); // claim -> the latest offer on it
      for (const o of book.open("wage_offer")) if (addressed(o, me) && typeof o.data?.claim === "string" && (offerOf.get(o.data.claim)?.at ?? -1) <= o.at) offerOf.set(o.data.claim, o);
      const accepted = new Set<string>();
      for (const a of book.open("offer_accepted")) if (a.speaks_for === me) for (const b of basesOf(a)) accepted.add(b);
      const noOffer: OpenItem[] = [], unanswered: OpenItem[] = [];
      for (const [employer, c] of claims) {
        if (over(employer, c.at) || failed.has(c.id)) continue;
        const rise = Number(c.data?.rise_bps) / 100;
        const o = offerOf.get(c.id);
        if (!o) {
          noOffer.push({ id: c.id, since: c.at, line: `${c.id}: our claim of ${rise}% for everyone at ${employer}, made ${dateWords(c.at)}, has had no offer from ${employer}` });
          continue;
        }
        if (accepted.has(o.id) || ballots.some((b) => b.data?.claim === c.id && b.at >= o.at)) continue;
        unanswered.push({ id: o.id, since: o.at, line: `${o.id}: ${employer} offered ${Number(o.data?.rise_bps) / 100}% on ${dateWords(o.at)} against our claim ${c.id} of ${rise}%; not accepted and no ballot called` });
      }
      // ---- ballots ----
      const live = ballots.filter((b) => !results.has(b.id) && finite(b.data?.closes) !== undefined && !over(text(b.data?.employer), b.at));
      const voters = new Map<string, Map<string, string>>(); // ballot -> member -> latest choice
      if (live.length) {
        const want = new Set(live.map((b) => b.id));
        const votes = (book.ofType("vote") as any[]).filter((v) => want.has(v.ballot)).sort((a, b) => a.at - b.at);
        for (const v of votes) voters.set(v.ballot, (voters.get(v.ballot) ?? new Map()).set((v.speaks_for ?? v.author) as string, v.choice));
      }
      const openBallots: OpenItem[] = [], undeclared: OpenItem[] = [];
      for (const b of live) {
        const eligible = new Set(b.addressed_to ?? []);
        const cast = [...(voters.get(b.id) ?? new Map<string, string>())].filter(([m]) => eligible.has(m));
        const yes = cast.filter(([, c]) => c === "yes").length;
        const count = `${cast.length} of ${eligible.size} voted, ${yes} yes, ${cast.length - yes} no`;
        const closes = Number(b.data!.closes);
        if (t < closes) openBallots.push({ id: b.id, since: b.at, line: `${b.id}: our ballot of members at ${b.data?.employer} on protected action, called ${dateWords(b.at)}, closes ${dateWords(closes)}; ${count} on file` });
        else undeclared.push({ id: b.id, since: closes, line: `${b.id}: our ballot of members at ${b.data?.employer} closed ${dateWords(closes)}; ${count} on file; no result declared` });
      }
      // ---- action ----
      const stopped = (employer: string, since: number) => book.open("stop_work").some((s) => s.speaks_for === me && s.data?.employer === employer && s.at >= since);
      const returned = (employer: string, since: number) => book.open("return_to_work").some((s) => s.speaks_for === me && s.data?.employer === employer && s.at >= since);
      const notBegun: OpenItem[] = [], notEnded: OpenItem[] = [];
      for (const n of book.open("industrial_action")) {
        const from = finite(n.data?.from), until = finite(n.data?.until), employer = text(n.data?.employer);
        if (n.speaks_for !== me || from === undefined || until === undefined || over(employer, n.at) || returned(employer, n.at)) continue;
        const span = `${employer}, from ${dateWords(from)} until ${dateWords(until)}`;
        if (t < from && !stopped(employer, n.at)) notBegun.push({ id: n.id, since: n.at, line: `${n.id}: notice of action at ${span}, given ${dateWords(n.at)}; not yet begun` });
        else notEnded.push({ id: n.id, since: from, line: `${n.id}: action at ${span}, begun and not yet ended` });
      }
      // ---- joining ----
      const inForce = new Set<string>(), offeredOn = new Set<string>();
      for (const a of book.ofType("agreement") as any[]) {
        if (a.record !== "agreement" || a.terms.template !== "membership" || a.terms.parties[0] !== me) continue;
        for (const b of basesOf(a)) offeredOn.add(b);
        if (book.inForce(a.id)) inForce.add(a.terms.parties[1]);
      }
      const joining = book.open("membership_application").filter((a) => addressed(a, me) && !offeredOn.has(a.id) && !inForce.has(String(a.speaks_for)))
        .map((a): OpenItem => ({ id: a.id, since: a.at, line: `${a.id}: ${a.speaks_for} asked ${dateWords(a.at)} to join${typeof a.data?.employer === "string" ? `, working at ${a.data.employer}` : ""}; no membership offered` }));
      return [
        ...heading("Wage claims of ours with no offer from the employer", noOffer),
        ...heading("Offers on our claims, not answered", unanswered),
        ...heading("Ballots of ours open", openBallots),
        ...heading("Ballots of ours closed, no result declared", undeclared),
        ...heading("Action notified, not yet begun", notBegun),
        ...heading("Action begun, not yet ended", notEnded),
        ...heading("Applications to join, no membership offered", joining),
        ...(hears ? venueHeadings(book, me, t, { forDecision: false, of: "Members' matters" }) : []),
      ];
    },
  };
}

// ------------------------------------------------------------------ bank.lending

interface Loan {
  id: string; borrower: string; account: string;
  principal: number; payment: number; months: number;
  /** The loan's first payment named by its agreement (seconds after it began), if any. */
  firstDue?: number;
  /** When repayments began to count: the payout, or the first look at a loan already in force. */
  start?: number;
  repaid: number;
  paidOff: boolean;
}

/**
 * A bank's lending office (bank.lending). Reads: `loan_application`s addressed to it and its own `loan_decision`s;
 * the loan agreements it is the first party to, who signed them, and its own account's transactions (the payout of a
 * loan is a payment from its account that settles the loan; a repayment is a payment into it from the borrower's
 * account, set against the borrower's loans oldest first; a payment into it that settles a loan pays it off); its own
 * `loan_arrears` and `loan_default` letters; `loan_payout_request`s and its own `loan_payout`s. A loan is followed
 * from its payout, or, if in force when the office first looked, from that first look. Its first repayment falls due
 * at `begins + terms.attrs.first_due` where the agreement names one, otherwise one month after the loan starts; a
 * loan less than a week behind is not listed (the code's own notice is after `arrears_days`, default 30).
 * Not expressible from papers: a loan the code kept in its head from before a restart that is neither in force nor
 * paid out on any record seen; and receipts in the very first look at the books of a loan that has no `first_due`
 * are not counted (the code does not count them either).
 */
export function lendingBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  const loans = new Map<string, Loan>();
  const byAccount = new Map<string, Loan[]>(); // borrower's account -> loans started
  let own: string | undefined;
  let adopted = false;
  const begins = (id: string): number => book.signedAt(id) ?? (book.records.get(id) as any)?.at ?? 0;
  const startIt = (l: Loan, at: number) => {
    l.start = at;
    byAccount.set(l.account, [...(byAccount.get(l.account) ?? []), l]);
  };
  // (Repayments missed before the year began, as the bank's statement of the loan account on file says.)
  const missedOf = (l: Loan): number => {
    const x = book.open("loan_statement").filter((r) => r.speaks_for === me && r.data?.loan === l.id && r.data?.brought_forward).sort((a, b) => b.at - a.at)[0];
    return x ? Math.max(0, Math.floor(Number(x.data?.payments) || 0)) : 0;
  };
  const firstDueAt = (l: Loan): number | undefined => (l.start === undefined ? undefined : (l.firstDue !== undefined ? begins(l.id) + l.firstDue : l.start + MONTH) - missedOf(l) * MONTH);
  const countedFrom = (l: Loan): number => (l.firstDue !== undefined ? begins(l.id) : l.start!);
  return {
    absorb(obs: Observation) {
      const fresh = book.absorb(obs);
      own = own ?? ownAccount(obs)?.account;
      for (const r of fresh as any[]) {
        if (r.record !== "agreement" || r.terms.template !== "loan" || r.terms.parties[0] !== me || loans.has(r.id)) continue;
        const who = r.terms.parties[1] as string;
        const repay = r.terms.commitments.find((c: any) => c.who === who)?.does?.outcome?.money;
        if (!repay?.from) continue;
        const lent = r.terms.commitments.find((c: any) => c.who === me)?.does?.outcome?.money;
        const payment = money(repay.amount), months = Math.max(1, Math.round((r.terms.term ?? 0) / MONTH));
        const first = r.terms.attrs?.first_due;
        loans.set(r.id, { id: r.id, borrower: who, account: repay.from, principal: lent ? money(lent.amount) : payment * months, payment, months, repaid: 0, paidOff: false,
          ...(Number.isSafeInteger(first) && first > 0 ? { firstDue: first as number } : {}) });
      }
      // (A loan in force when the office first looked is followed from then.)
      if (!adopted) {
        adopted = true;
        for (const l of loans.values()) if (book.inForce(l.id)) startIt(l, obs.t);
      }
      for (const tx of channels.transactions(obs)) {
        if (!own) break;
        if (tx.from === own && tx.settles) {
          const l = loans.get(tx.settles);
          if (l && l.start === undefined) startIt(l, tx.t); // (the principal paid out)
          continue;
        }
        if (tx.to !== own) continue;
        const paidOff = tx.settles ? loans.get(tx.settles) : undefined;
        if (paidOff) {
          paidOff.paidOff = true;
          paidOff.repaid = paidOff.payment * paidOff.months;
          continue;
        }
        let x = cents(tx.amount);
        for (const l of [...(byAccount.get(tx.from) ?? [])].sort((a, b) => a.start! - b.start!)) {
          if (tx.t < countedFrom(l)) continue;
          const part = Math.min(x, Math.max(0, l.payment * l.months - l.repaid));
          l.repaid += part;
          x -= part;
          if (x <= 0) break;
        }
      }
    },
    open(t) {
      // ---- applications ----
      const decided = new Set<string>();
      for (const d of book.open("loan_decision")) if (d.speaks_for === me) for (const a of appsOf(d)) decided.add(a);
      const applications = book.open("loan_application").filter((a) => addressed(a, me) && !decided.has(a.id)).map((a): OpenItem => {
        const amount = Math.floor(Number(a.data?.amount) || 0);
        return { id: a.id, since: a.at, amount, line: `${a.id}: ${a.speaks_for} applied ${dateWords(a.at)} for ${usd(amount)} over ${Math.max(1, Math.floor(Number(a.data?.months) || 12))} months${a.data?.purpose ? `, for ${a.data.purpose}` : ""}; not decided` };
      });
      // ---- loans signed and not paid out ----
      const unpaid: OpenItem[] = [];
      for (const l of loans.values()) {
        if (l.start !== undefined || l.paidOff || !book.signedBy(l.id, l.borrower)) continue;
        const at = Math.max(...(book.signedTimes.get(l.id) ?? [begins(l.id)]));
        unpaid.push({ id: l.id, since: at, amount: l.principal, line: `${l.id}: ${l.borrower} has signed the loan of ${usd(l.principal)} (${usd(l.payment)} a month for ${l.months} months), signed ${dateWords(at)}; the principal has not been paid out` });
      }
      // ---- loans behind ----
      const letters = new Map<string, "arrears" | "default">();
      for (const k of ["loan_arrears", "loan_default"] as const) for (const r of book.open(k)) {
        const loan = text(r.data?.loan) || basesOf(r)[0];
        if (r.speaks_for === me && loan && letters.get(loan) !== "default") letters.set(loan, k === "loan_default" ? "default" : "arrears");
      }
      const behind: OpenItem[] = [];
      for (const l of loans.values()) {
        const first = firstDueAt(l);
        if (first === undefined || l.paidOff || l.payment <= 0) continue;
        const dueCount = t < first ? 0 : Math.min(l.months, Math.floor((t - first) / MONTH) + 1);
        const owing = dueCount * l.payment - l.repaid;
        if (owing <= 0) continue;
        const since = first + Math.floor(l.repaid / l.payment) * MONTH; // (the earliest payment not covered)
        if (t - since < 7 * DAY) continue;
        const letter = letters.get(l.id);
        behind.push({ id: l.id, since, amount: owing,
          line: `${l.id}: ${l.borrower} is ${usd(owing)} behind on the loan (${usd(l.payment)} a month, ${l.months} months), since ${dateWords(since)}; ${letter === "default" ? "a default notice is on file" : letter === "arrears" ? "a letter of arrears is on file" : "no letter of arrears or default notice is on file"}` });
      }
      // ---- payout figures asked for ----
      const answered = new Set<string>();
      for (const r of book.open("loan_payout")) if (r.speaks_for === me) for (const b of basesOf(r)) answered.add(b);
      const payouts = book.open("loan_payout_request").filter((r) => addressed(r, me) && !answered.has(r.id) && loans.get(String(r.data?.loan))?.borrower === r.speaks_for)
        .map((r): OpenItem => ({ id: r.id, since: r.at, line: `${r.id}: ${r.speaks_for} asked ${dateWords(r.at)} what it takes to pay off loan ${r.data?.loan}; not answered` }));
      return [
        ...heading("Loan applications, not decided", applications),
        ...heading("Loans signed by the borrower, the principal not paid out", unpaid),
        ...heading("Loans behind", behind),
        ...heading("Payout figures asked for, not given", payouts),
      ];
    },
  };
}
