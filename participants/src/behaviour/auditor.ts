// office.auditor: an office of the town that examines other bodies' accounts and decisions as the place's law says, on a sample, and
// publishes a report (docs/behaviour/auditor.md; docs/design/foundations.md, B9; docs/design/gradual-disempowerment.md 2.3 e).
//
// It has no power over anything it examines. The law (a published paper, from the profile's `audit`) says whom it audits, how often, how
// large a sample, and how long a body has to answer; the office asks each body for named things (the count of the period's decisions
// of a kind, then the nth of them for each number it draws; or the body's statement for the period), the body answers from its own books
// (its work, and its time), and the office decides each on the file under the law and the procedure published for it, writes what it found
// to the body, and at the end publishes one report a body and period. It judges nothing: a decision does or does not agree with the law's
// conditions, accounts do or do not reconcile. What follows a finding is for people, by the review and appeal routes the law already has.

import type { StatementRecord } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, say, usd, type Step } from "./common";
import { incomeTaxLaw, withholding } from "./tax";
import { decideClaim, supportLaw, type Declared, type PaymentRule } from "./payments";
import { stepper } from "./firms";
import * as P from "./papers";

/** The papers this runs on. */
export const KIND = {
  /** The auditor to a body: this named thing, by this day. Made in public, as the law that empowers it is, and addressed to no one: a paper addressed to an organisation wakes every post of it (foundations F6). */
  request: "audit_request",
  /** The body's answer, from its own books. */
  answer: "audit_answer",
  /** The auditor's working paper on one item: what the examination found. The auditor's own; the report is what is published. */
  finding: "audit_finding",
  /** The auditor's report on a body for a period: public. */
  report: "audit_report",
} as const;

export type Role = "support" | "town_finance";
/** Each role in the words a report uses. */
export const ROLE_WORDS: { [role in Role]: string } = { support: "the office that decides claims for support", town_finance: "the town's finance office" };
export type Check = "decisions" | "accounts";
export interface AuditBody { body: Role; entity: string; every_days: number; checks: Check[]; kind?: string; sample?: { share_bps: number; least: number; most: number } }
export interface AuditLaw { id: string; auditor: string; office: string; answer_within_days: number; report_within_days: number; bodies: AuditBody[] }

/** The audit law on file: the latest published and not withdrawn. */
export function auditLaw(book: Book): AuditLaw | undefined {
  const laws = book.open("law").filter((r) => r.data?.audit && typeof r.data.audit === "object").sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const l = laws[0];
  if (!l) return undefined;
  const a = l.data!.audit as Omit<AuditLaw, "id">;
  return Array.isArray(a.bodies) && typeof a.auditor === "string" ? { id: l.id, auditor: a.auditor, office: a.office, answer_within_days: a.answer_within_days, report_within_days: a.report_within_days, bodies: a.bodies } : undefined;
}

/** How many of a period's `n` decisions are examined: the law's share, no fewer than `least`, no more than `most`, never more than there are. */
export function sampleSize(n: number, s: { share_bps: number; least: number; most: number }): number {
  if (n <= 0) return 0;
  return Math.min(n, Math.max(s.least, Math.min(s.most, Math.ceil((n * s.share_bps) / 10_000))));
}

/** `k` distinct numbers of 1 to `n`, in order, drawn from a stream (Floyd's algorithm: k draws, the same whatever the hour). */
export function drawSample(rng: { below(n: number): number }, n: number, k: number): number[] {
  const chosen = new Set<number>();
  for (let j = n - k; j < n; j++) {
    const r = rng.below(j + 1) + 1;
    chosen.add(chosen.has(r) ? j + 1 : r);
  }
  return [...chosen].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ the audited side

/** The decision a request for "the nth" names, and the file it was made on: what the body's answer carries. */
export interface DecisionFile {
  decision: { id: string; at: number; on: number; granted: boolean; amount?: number; every?: number; until?: number; reason?: string; lapsed?: boolean };
  /** Absent: the claim the decision names is not on the body's file. */
  claim?: { id: string; by: string; payment: string; born_at: number; account: string; declares: Declared };
  /** The pay reported for the claimant to the body up to the day it decided, newest first. */
  reported: { at: number; gross: number }[];
  /** Whether the body paid the claimant another payment for age. */
  pays_other: boolean;
}

/** What a body that is audited can answer, from its own books. */
export interface Answerer {
  /** How many decisions of a kind it made in [from, to), counted in the order `nth` takes them. */
  count?(kind: string, from: number, to: number): number;
  /** The nth (from 1) of them, with the file it was made on. */
  nth?(kind: string, from: number, to: number, nth: number): DecisionFile | undefined;
  /** Its payments in the books and the bank's record of them, for [from, to). */
  statement?(from: number, to: number): Statement | undefined;
}
export interface Statement {
  books: { id: string; amount: number; at: number }[];
  bank: { id: string; amount: number; t: number }[];
}

/**
 * The answering side of an audit, for any body (docs/behaviour/auditor.md, "A body that is audited"): it answers a request from the
 * auditor the law names, for a body the law names, with the thing asked for and nothing else. Each answer is a paper the body makes (its
 * performer's time, the work table's `publish/audit_answer`). It does not decide whether to be audited and cannot refuse: the law is
 * the law's.
 */
export class Audited {
  private readonly done = new Set<string>();
  constructor(private readonly me: string) {}
  steps(book: Book, answer: Answerer): Step[] {
    const steps: Step[] = [];
    const law = auditLaw(book);
    if (!law) return steps;
    // (A new holder of the post has no memory but the office's papers: a request already answered stays answered.)
    for (const a of book.all(KIND.answer)) if (a.speaks_for === this.me && typeof a.data?.request === "string") this.done.add(a.data.request);
    for (const r of book.open(KIND.request).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
      if (this.done.has(r.id) || r.speaks_for !== law.auditor) continue;
      const entry = law.bodies.find((b) => b.entity === this.me && b.body === r.data?.body);
      if (!entry) continue;
      this.done.add(r.id);
      const from = Math.floor(Number(r.data?.from)), to = Math.floor(Number(r.data?.to)), ask = String(r.data?.ask), kind = String(r.data?.kind ?? "");
      let reply: object | undefined;
      let words = "";
      if (ask === "count" && answer.count) {
        const count = answer.count(kind, from, to);
        reply = { count };
        words = `${count} decision${count === 1 ? "" : "s"} (${kind.replace(/_/g, " ")}) made between day ${Math.floor(from / DAY)} and day ${Math.floor(to / DAY)}.`;
      } else if (ask === "nth" && answer.nth) {
        const nth = Math.floor(Number(r.data?.nth));
        const file = answer.nth(kind, from, to, nth);
        reply = file ? { found: true, file } : { found: false };
        words = file ? `Decision ${file.decision.id} (number ${nth} of the period), with the claim and the record it was made on.` : `There is no decision number ${nth} in the period.`;
      } else if (ask === "statement" && answer.statement) {
        const statement = answer.statement(from, to);
        reply = statement ? { statement } : { statement: null };
        words = statement ? `The payments in our books for the period and the bank's record of them: ${statement.books.length} in the books, ${statement.bank.length} in the bank's record.` : "We hold no books for the period.";
      }
      if (!reply) continue;
      steps.push(because(`The auditor asks for ${ask === "count" ? "the count of our decisions" : ask === "nth" ? `our decision number ${r.data?.nth}` : "our statement of payments"} for an audit the law provides: answering.`,
        say(KIND.answer, `Answer to audit request ${r.id}: ${words}`, { to: [r.speaks_for!], visible: [r.speaks_for!, this.me], basis: r.id,
          data: { request: r.id, audit: r.data?.audit, ask, ...(ask === "nth" ? { nth: r.data?.nth } : {}), ...reply } })));
    }
    return steps;
  }
}

// ------------------------------------------------------------------ examining

export interface Finding {
  /** Whether it agrees with the law: true, false, or null where it cannot be told from the file (and why). */
  agrees: boolean | null;
  /** In the law's terms. */
  says: string;
}

/** A decision, decided again from the file under the support law's rule for its payment. */
export function examineDecision(file: DecisionFile, rule: PaymentRule | undefined, book: Book, year: number): Finding {
  const d = file.decision;
  if (!file.claim) return { agrees: null, says: "the claim the decision names is not on the body's file: not re-decided" };
  if (d.lapsed) return { agrees: null, says: "the claim waited for papers that did not come in time, and was refused on that: the decision rests on the procedure's days for the wait, not on the conditions of the payment; not re-decided" };
  if (!rule) return { agrees: null, says: `no support law for the payment ${file.claim!.payment} is on file: not re-decided` };
  const c = file.claim;
  const claim = { id: c.id, record: "statement", speaks_for: c.by, data: { account: c.account, born_at: c.born_at, declares: c.declares, payment: c.payment } } as unknown as StatementRecord;
  const tax = incomeTaxLaw(book);
  const again = decideClaim(rule, claim, d.on, {
    year,
    reported: (since) => file.reported.filter((r) => r.at >= since && r.at <= d.on).sort((a, b) => b.at - a.at),
    paysOtherPension: () => file.pays_other,
    withheld: (gross, seconds) => withholding(tax, gross, seconds),
  }, usd);
  if (d.granted) {
    if (!again.ok) return { agrees: false, says: `granted, though the claim does not meet the conditions the law states for the payment${again.why ? `: ${again.why}` : ""}` };
    if (again.amount !== d.amount) return { agrees: false, says: `granted at ${usd(d.amount ?? 0)} every ${Math.round((d.every ?? 0) / DAY)} days; the law's rule for the payment gives ${usd(again.amount)}` };
    return { agrees: true, says: "granted; the claim meets the conditions the law states for the payment, at the sum the law's rule gives" };
  }
  if (again.ok) return { agrees: false, says: `refused${d.reason ? ` (${d.reason})` : ""}, though the claim meets the conditions the law states for the payment (the law's rule gives ${usd(again.amount)} every ${rule.every_days} days)` };
  return { agrees: true, says: `refused; the claim does not meet the conditions the law states for the payment${again.why ? `: ${again.why}` : ""}` };
}

/** The books' payments against the bank's record of them (the body's statement), for the period: each side's items not matched by the other's. */
export function reconcile(s: Statement, from: number, to: number, grace: number): { matched: number; inBooksNotBank: { id: string; amount: number }[]; inBankNotBooks: { id: string; amount: number }[]; differ: { id: string; books: number; bank: number }[] } {
  const bank = new Map(s.bank.map((x) => [x.id, x]));
  const books = new Map(s.books.map((x) => [x.id, x]));
  const out = { matched: 0, inBooksNotBank: [] as { id: string; amount: number }[], inBankNotBooks: [] as { id: string; amount: number }[], differ: [] as { id: string; books: number; bank: number }[] };
  for (const b of s.books.filter((x) => x.at >= from && x.at < to - grace).sort((a, c) => (a.id < c.id ? -1 : 1))) {
    const k = bank.get(b.id);
    if (!k) out.inBooksNotBank.push({ id: b.id, amount: b.amount });
    else if (k.amount !== b.amount) out.differ.push({ id: b.id, books: b.amount, bank: k.amount });
    else out.matched++;
  }
  for (const k of s.bank.filter((x) => x.t >= from && x.t < to).sort((a, c) => (a.id < c.id ? -1 : 1))) if (!books.has(k.id)) out.inBankNotBooks.push({ id: k.id, amount: k.amount });
  return out;
}

// ------------------------------------------------------------------ the office

interface Item { nth: number; asked: number; by: number; state: "asked" | "examined" | "late" }
interface Run {
  key: string; body: AuditBody; check: Check; n: number; from: number; to: number;
  ask: { at: number; by: number; state: "asked" | "answered" | "late" };
  population?: number; items: Item[];
  agreed: number; notAgreed: number; notChecked: number; notFound: number;
  particulars: { item: string; nth: number; finding: string }[];
  statement?: ReturnType<typeof reconcile>;
  reported: boolean;
}

export const auditor: BehaviourModule = {
  name: "office.auditor",
  answers: { office: "the audit office", acts: "What it acts on: the audit law, which says whom it audits and how often; it asks those bodies for named things, and examines what they answer. It acts on no letter." },
  issues: P.AUDIT,
  version: "0.1.0",
  doc: "docs/behaviour/auditor.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({ year: 365 * DAY }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const runs = new Map<string, Run>();
    const answerTo = (run: Run, ask: string, nth?: number): StatementRecord | undefined =>
      book.open(KIND.answer).find((a) => (a.addressed_to ?? []).includes(me) && a.speaks_for === run.body.entity && a.data?.audit === run.key && a.data?.ask === ask && (nth === undefined || a.data?.nth === nth));
    /** A run as the office's own papers leave it, or undefined where none was begun. */
    const restore = (key: string, body: AuditBody, check: Check, kind: string | undefined, n: number, law: AuditLaw): Run | undefined => {
      const mine = (k: string) => book.all(k).filter((r) => r.speaks_for === me && r.data?.audit === key);
      const asked = mine(KIND.request);
      if (!asked.length) return undefined;
      const run: Run = { key, body: { ...body, ...(kind ? { kind } : {}) }, check, n, from: (n - 1) * body.every_days * DAY, to: n * body.every_days * DAY, ask: { at: asked[0]!.at, by: Number(asked[0]!.data?.answer_by) || asked[0]!.at + law.answer_within_days * DAY, state: "asked" },
        items: [], agreed: 0, notAgreed: 0, notChecked: 0, notFound: 0, particulars: [], reported: mine(KIND.report).length > 0 };
      if (run.reported || check === "accounts") return run;
      const nths = asked.filter((r) => r.data?.ask === "nth");
      if (!nths.length) return run; // (the count, answered or not: the sample is drawn from it again, the same numbers)
      run.population = Math.max(0, Math.floor(Number(answerTo(run, "count")?.data?.count) || 0));
      const found = mine(KIND.finding);
      for (const r of nths) {
        const nth = Math.floor(Number(r.data?.nth));
        const f = found.find((x) => x.data?.nth === nth);
        run.items.push({ nth, asked: r.at, by: Number(r.data?.answer_by) || r.at + law.answer_within_days * DAY, state: f ? "examined" : "asked" });
        if (!f) continue;
        if (f.data?.agrees === true) run.agreed++;
        else if (f.data?.agrees === false) { run.notAgreed++; run.particulars.push({ item: String(f.data?.item), nth, finding: String(f.data?.says) }); }
        else if (/no decision by that number/.test(String(f.data?.says))) run.notFound++;
        else run.notChecked++;
      }
      return run;
    };
    const request = (run: Run, law: AuditLaw, t: number, ask: "count" | "nth" | "statement", nth?: number): Step => {
      const by = t + law.answer_within_days * DAY;
      const what = ask === "count" ? `the count of its ${run.body.kind?.replace(/_/g, " ")}s in the period` : ask === "nth" ? `its decision number ${nth} of the period` : "its statement of payments for the period";
      return because(`Auditing ${run.body.entity} for days ${Math.floor(run.from / DAY)} to ${Math.floor(run.to / DAY)} as the law provides: asking for ${what}, to be answered by day ${Math.floor(by / DAY)}.`,
        say(KIND.request, `Audit request: ${what}, for the period from day ${Math.floor(run.from / DAY)} to day ${Math.floor(run.to / DAY)} (audit law ${law.id}). To be answered by day ${Math.floor(by / DAY)}.`,
          { visible: "public", basis: law.id, data: { audit: run.key, body: run.body.body, ask, ...(nth !== undefined ? { nth } : {}), ...(run.check === "decisions" ? { kind: run.body.kind } : {}), from: run.from, to: run.to, answer_by: by } }));
    };
    const report = (run: Run, law: AuditLaw, t: number): Step => {
      run.reported = true;
      const due = run.to + law.report_within_days * DAY;
      const window = `days ${Math.floor(run.from / DAY)} to ${Math.floor(run.to / DAY)}`;
      let words: string, data: object;
      if (run.check === "decisions") {
        const late = run.items.filter((i) => i.state === "late").length;
        words = run.population === undefined
          ? `Audit of ${ROLE_WORDS[run.body.body]} (${run.body.entity}), decisions of ${run.body.kind?.replace(/_/g, " ")}, ${window}: the body did not answer the request for the count of its decisions in the days the law gives, and no sample was drawn.`
          : `Audit of ${ROLE_WORDS[run.body.body]} (${run.body.entity}), decisions of ${run.body.kind?.replace(/_/g, " ")}, ${window}: ${run.population} made; ${run.items.length} drawn for examination; ${run.agreed} agree with the law and the procedure published for the kind, ${run.notAgreed} do not agree, ${run.notChecked} could not be told from the file${run.notFound ? `, ${run.notFound} not found by the number asked` : ""}${late ? `, ${late} not answered in the days the law gives` : ""}.` +
            (run.particulars.length ? ` Where they do not agree: ${run.particulars.map((x) => `decision ${x.item} (number ${x.nth}): ${x.finding}`).join("; ")}.` : "");
        data = { audit: run.key, body: run.body.entity, check: "decisions", kind: run.body.kind, period: run.n, from: run.from, to: run.to, due, population: run.population ?? null, sample: run.items.length, agreed: run.agreed, not_agreed: run.notAgreed, not_checked: run.notChecked, not_found: run.notFound, not_answered: late || (run.population === undefined ? 1 : 0), disagreements: run.particulars };
      } else {
        const s = run.statement;
        words = !s
          ? `Audit of ${ROLE_WORDS[run.body.body]} (${run.body.entity}), accounts, ${window}: ${run.ask.state === "late" ? "the body did not answer the request for its statement in the days the law gives" : "the body holds no books for the period"}.`
          : `Audit of ${ROLE_WORDS[run.body.body]} (${run.body.entity}), accounts, ${window}: ${s.matched} payment${s.matched === 1 ? "" : "s"} in the books agree with the bank's record; ${s.inBooksNotBank.length} in the books are not in the bank's record; ${s.inBankNotBooks.length} in the bank's record are not in the books; ${s.differ.length} differ in the sum.` +
            (s.inBooksNotBank.length + s.inBankNotBooks.length + s.differ.length ? ` ${[...s.inBooksNotBank.map((x) => `${x.id}: in the books (${usd(x.amount)}), not in the bank's record`), ...s.inBankNotBooks.map((x) => `${x.id}: in the bank's record (${usd(x.amount)}), not in the books`), ...s.differ.map((x) => `${x.id}: books ${usd(x.books)}, bank ${usd(x.bank)}`)].join("; ")}.` : "");
        data = { audit: run.key, body: run.body.entity, check: "accounts", period: run.n, from: run.from, to: run.to, due, reconciles: !!s && !s.inBooksNotBank.length && !s.inBankNotBooks.length && !s.differ.length, matched: s?.matched ?? 0, in_books_not_bank: s?.inBooksNotBank ?? [], in_bank_not_books: s?.inBankNotBooks ?? [], differ: s?.differ ?? [], not_answered: run.ask.state === "late" ? 1 : 0 };
      }
      return because(`The audit of ${run.body.entity} for ${window} is examined: publishing the report${t > due ? ` (the law's day for it, day ${Math.floor(due / DAY)}, has passed)` : ""}.`,
        say(KIND.report, `${words}${t > due ? ` (Due by day ${Math.floor(due / DAY)}.)` : ""}`, { visible: "public", basis: law.id, data }));
    };
    const found = (run: Run, id: string, nth: number | undefined, f: Finding): Step =>
      because(`Examined ${nth !== undefined ? `decision ${id}` : "the statement"} of ${run.body.entity}: ${f.agrees === null ? "cannot be told from the file" : f.agrees ? "agrees with the law" : "does not agree"}.`,
        say(KIND.finding, `Audit finding on ${id}: ${f.says}.`, { visible: [me], ...(nth !== undefined ? { basis: id } : {}), data: { audit: run.key, item: id, ...(nth !== undefined ? { nth } : {}), agrees: f.agrees, says: f.says } }));
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const law = auditLaw(book);
        if (!law || law.auditor !== me) return steps;
        const support = supportLaw(book)?.payments ?? [];
        for (const body of law.bodies) for (const check of body.checks) {
          const kind = check === "decisions" ? (body.kind ?? "benefit_decision") : undefined;
          for (let n = 1; n * body.every_days * DAY <= t; n++) {
            const key = `${body.body}|${check}|${n}`;
            if (runs.has(key)) continue;
            // (A new holder of the post starts with no memory but the office's papers: what was begun, answered, examined and reported is read from them.)
            const before = restore(key, body, check, kind, n, law);
            if (before) { runs.set(key, before); continue; }
            const run: Run = { key, body: { ...body, ...(kind ? { kind } : {}) }, check, n, from: (n - 1) * body.every_days * DAY, to: n * body.every_days * DAY, ask: { at: t, by: t + law.answer_within_days * DAY, state: "asked" },
              items: [], agreed: 0, notAgreed: 0, notChecked: 0, notFound: 0, particulars: [], reported: false };
            runs.set(key, run);
            steps.push(request(run, law, t, check === "decisions" ? "count" : "statement"));
          }
        }
        for (const run of [...runs.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
          if (run.reported) continue;
          if (run.check === "accounts") {
            const a = answerTo(run, "statement");
            if (a) {
              run.ask.state = "answered";
              run.statement = a.data?.statement ? reconcile(a.data.statement as Statement, run.from, run.to, 2 * DAY) : undefined;
              const s = run.statement;
              steps.push(found(run, `statement-${run.key}`, undefined, { agrees: s ? !s.inBooksNotBank.length && !s.inBankNotBooks.length && !s.differ.length : null, says: s ? `${s.matched} payments agree with the bank's record, ${s.inBooksNotBank.length + s.inBankNotBooks.length + s.differ.length} do not` : "the body holds no books for the period" }));
              steps.push(report(run, law, t));
            } else if (t > run.ask.by) { run.ask.state = "late"; steps.push(report(run, law, t)); }
            continue;
          }
          // Decisions: the count first, then the numbers drawn.
          if (run.population === undefined) {
            const a = answerTo(run, "count");
            if (!a) {
              if (t > run.ask.by) { run.ask.state = "late"; steps.push(report(run, law, t)); }
              continue;
            }
            run.ask.state = "answered";
            run.population = Math.max(0, Math.floor(Number(a.data?.count) || 0));
            const k = sampleSize(run.population, body(run, law).sample ?? { share_bps: 0, least: 0, most: 0 });
            // (Named for the body, the check and the period, never the hour: a sample is the same whenever the office gets to it.)
            for (const nth of drawSample(ctx.rng(`audit/${run.body.entity}/${run.check}/${run.n}`), run.population, k)) {
              run.items.push({ nth, asked: t, by: t + law.answer_within_days * DAY, state: "asked" });
              steps.push(request(run, law, t, "nth", nth));
            }
            if (!run.items.length) steps.push(report(run, law, t));
            continue;
          }
          for (const item of run.items.filter((i) => i.state === "asked")) {
            const a = answerTo(run, "nth", item.nth);
            if (!a) { if (t > item.by) item.state = "late"; continue; }
            item.state = "examined";
            const file = a.data?.file as DecisionFile | undefined;
            if (!a.data?.found || !file) { run.notFound++; steps.push(found(run, `${run.key}#${item.nth}`, item.nth, { agrees: null, says: "no decision by that number" })); continue; }
            const f = examineDecision(file, support.find((r) => r.id === file.claim?.payment), book, p.year);
            if (f.agrees === true) run.agreed++;
            else if (f.agrees === false) { run.notAgreed++; run.particulars.push({ item: file.decision.id, nth: item.nth, finding: f.says }); }
            else run.notChecked++;
            steps.push(found(run, file.decision.id, item.nth, f));
          }
          if (run.items.every((i) => i.state !== "asked")) steps.push(report(run, law, t));
        }
        return steps;
      },
    );
  },
};

const body = (run: Run, law: AuditLaw): AuditBody => law.bodies.find((b) => b.body === run.body.body && b.entity === run.body.entity) ?? run.body;
