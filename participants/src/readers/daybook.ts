// An office's own file: what it has sent, filed and paid, and what stands open at it (docs/behaviour/office-books.md,
// "The office's own file").
//
// A person in an office sits every few days and carries between sittings only the notes they keep. A real office-holder
// has more on the desk than notes: the file of what the office sent out and when, the ledger of what it paid and was
// paid, the day book, the list of what is still open. In the sixth living pilot the letting office's seat paid a
// rates notice on day 31 and again on day 73, let another fall overdue, and said afterwards that it had "depended on the
// notebook for continuity, and missed some things"; the tribunal member re-read cases it had decided. None of that was
// judgement: the papers were the office's own, and the seat was shown each one once, as it came.
//
// This is the office's own record, kept by code from what the seat itself has been shown (`mine`, and its own accounts):
// its own papers (sent, filed, ordered, decided) newest first, each with the paper that followed it where one has; its
// own payments out and what came in; and what stands open, as the office's books (each module's `books`) read it, the
// same reading the clerk files. Nothing is asked of the engine, nothing is said of anyone else's papers or money, and
// nothing in it says what to do with it. It is set out at every sitting, in a bounded space: the most recent are
// listed, the older and the overflow are counted by kind, by code, never by a model.

import { basesOf, channels, type Observation, type Record as Paper } from "../contracts";
import { dateWords } from "../forms";
import type { OfficeBooks } from "../module";
import { cents, moneyNow } from "../money";

const DAY = 86_400;
/** How far back the office's own acts are listed; before that they are counted. */
export const LISTED_DAYS = 40;
/** The most a day book's text may run to, in characters (the seat reads it on every sitting). */
export const DAYBOOK_MAX = 4_500;
const SENT_CHARS = 1_700, OPEN_CHARS = 1_400, IN_CHARS = 500;
const LINE = 170;
/** Papers that are the office's own bookkeeping, not its acts: what its clerk files and its staff report. */
const NOT_ACTS = new Set(["office_books", "staff_report"]);


/** Which part of the file an entry stands in: what is done and what came of it; what was sent or asked of others and is
 * theirs to act on (nothing seen of it yet); and what is overdue. The file is a record, not a list of things to do
 * (2026-11-10: a 7B model read "asked the bank to pay ...; no payment out of the account seen yet", repeated at every
 * sitting, as work it could not finish, and gave "incomplete tasks" as its reason for stopping). */
type Part = "done" | "theirs" | "overdue";
interface Entry { at: number; kind: string; line: string; id?: string; n?: number; part: Part; /** when it last changed: made, paid, followed */ changed: number }
interface Flow { t: number; with: string; amount: number; memo?: string; settles?: string }

const words = (s: string): string => s.replace(/_/g, " ");
/** Whole numbers of four figures or more grouped as a person writes them, so that a quantity never reads as a reference
 * ("183937 inputs" read as an invoice's number, 2026-11-10). Ids, sums and decimals are left as they are. */
const grouped = (s: string): string => s.replace(/(?<![\w.\p{Sc},/:-])\d{4,}(?![\w.,/:-]*\d)(?![\w])/gu, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const cut = (s: string, n: number): string => {
  const one = grouped(s.replace(/\s+/g, " ").trim());
  return one.length <= n ? one : `${one.slice(0, n - 1).trimEnd()}…`;
};
/** Lines whole, as many as fit in `room` characters (the rest left to be counted by the caller). */
function fit(lines: string[], room: number): { shown: string[]; left: number } {
  const shown: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > room) break;
    shown.push(l);
    used += l.length + 1;
  }
  return { shown, left: lines.length - shown.length };
}
/** The fields in which a paper names the day it is to be answered or done by. */
const DUE_FIELDS = ["answer_by", "due", "by"] as const;
/** The day a paper of the office's own names as the one it is to be answered or done by, if it names one. */
function dueOf(r: Paper): number | undefined {
  const d = r.record === "statement" ? (r.data as any) : undefined;
  for (const k of DUE_FIELDS) if (typeof d?.[k] === "number" && Number.isFinite(d[k]) && d[k] > r.at) return d[k];
  return undefined;
}
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
/** "3 rent reminders, 2 payments out": the most common kinds, then the number of the rest. */
function counted(by: Map<string, number>, most = 5): string {
  const all = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rest = all.slice(most).reduce((n, [, k]) => n + k, 0);
  return [...all.slice(0, most).map(([k, n]) => (n === 1 ? `1 ${k}` : `${n} ${k}s`)), ...(rest ? [`${plural(rest, "other paper")}`] : [])].join(", ");
}

export interface DayBookOptions {
  /** Whose acts these are: the entity, and the participant ids that act for it (its seat; its staff's posts). */
  entity: string;
  authors: string[];
  /** The office's books, where its module keeps them: what stands open. */
  books?: OfficeBooks;
  /** What a person or office is called in the world (an id the seat is not shown never reaches it). */
  name?: (id: string) => string | undefined;
}

/** The parts of the file, in the order they are set out, with what each heading says. */
const PARTS: { part: Part; head: string }[] = [
  { part: "overdue", head: "Overdue: its day has passed and nothing has followed it" },
  { part: "theirs", head: "Sent or asked of others: theirs to act on, and nothing seen of it yet" },
  { part: "done", head: "Done, with what came of it" },
];

export class DayBook {
  private readonly own = new Map<string, Paper>();
  /** A record cited by a paper of someone else's (or by a reply that names it): who, when, what kind. */
  private readonly followed = new Map<string, { at: number; kind: string; by: string }>();
  /** The latest time a paper of someone else's cited each record (a reply to a notice may cite what the notice rests on). */
  private readonly citedLast = new Map<string, number>();
  private readonly accounts = new Set<string>();
  private readonly out: Flow[] = [];
  private readonly into: Flow[] = [];
  private readonly seen = new Set<string>();
  private readonly authors: Set<string>;

  constructor(private readonly o: DayBookOptions) {
    this.authors = new Set(o.authors);
  }

  /** Take in what the seat was just shown. */
  absorb(obs: Observation): void {
    this.o.books?.absorb(obs);
    for (const ch of Object.values(obs.channels)) {
      if (ch.kind === "accounts") for (const a of ch.accounts) if (a.holder === this.o.entity) this.accounts.add(a.account);
      if (ch.kind !== "records") continue;
      for (const r of ch.records) {
        if (this.own.has(r.id)) continue;
        if (this.authors.has(r.author)) {
          if (r.record === "statement" && NOT_ACTS.has(r.kind)) continue;
          if (["statement", "vote", "signature", "notice", "withdrawal", "agreement"].includes(r.record)) this.own.set(r.id, r);
          continue;
        }
        // (A paper of someone else's that names one of ours: it follows it.)
        const d = r.record === "statement" ? (r.data as any) : undefined;
        const refs = [...basesOf(r), ...(["request", "application", "order", "reply_to"] as const).map((k) => d?.[k]).filter((x): x is string => typeof x === "string"), ...(r.record === "withdrawal" ? [r.withdraws] : [])];
        for (const id of refs) {
          if (!this.followed.has(id) || this.followed.get(id)!.at > r.at) this.followed.set(id, { at: r.at, kind: r.record === "statement" ? r.kind : r.record, by: r.speaks_for ?? r.author });
          if ((this.citedLast.get(id) ?? -1) < r.at) this.citedLast.set(id, r.at);
        }
      }
    }
    for (const tx of channels.transactions(obs)) {
      const key = `${tx.t}|${tx.from}|${tx.to}|${tx.amount}|${tx.settles ?? ""}|${tx.memo ?? ""}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const [from, to] = [this.accounts.has(tx.from), this.accounts.has(tx.to)];
      if (from === to) continue;
      (from ? this.out : this.into).push({ t: tx.t, with: from ? tx.to : tx.from, amount: cents(tx.amount), ...(tx.memo ? { memo: tx.memo } : {}), ...(tx.settles ? { settles: tx.settles } : {}) });
    }
  }

  private name(id: string): string {
    return this.o.name?.(id) ?? id;
  }
  /** Those a paper is addressed to, other than the office's own organisation, by name. */
  private toWords(r: Paper): string {
    const to = r.record === "statement" ? (r.addressed_to ?? []).filter((x) => x !== this.o.entity) : [];
    return to.length ? `${to.slice(0, 2).map((x) => this.name(x)).join(" and ")}${to.length > 2 ? ` and ${to.length - 2} more` : ""}` : "";
  }

  /** The payment out that a request to pay was carried out as, if one has been seen (each payment answers one request). */
  private paidAs(r: Paper, taken: Set<Flow>): Flow | undefined {
    const m = r.record === "statement" ? (r.data as any)?.outcome?.money : undefined;
    if (!m || this.accounts.has(m.to)) return undefined;
    const p = this.out.find((f) => !taken.has(f) && f.t >= r.at && f.with === m.to && f.amount === cents(m.amount) && (m.settles === undefined || f.settles === m.settles));
    if (p) taken.add(p);
    return p;
  }
  /** The payment in that a request of ours to be paid (an invoice) was answered by, if one has been seen. */
  private paidIn(r: Paper, taken: Set<Flow>): Flow | undefined {
    const m = r.record === "statement" ? (r.data as any)?.outcome?.money : undefined;
    if (!m || !this.accounts.has(m.to)) return undefined;
    const p = this.into.find((f) => !taken.has(f) && f.t >= r.at && f.amount === cents(m.amount) && (f.settles === undefined || f.settles === r.id));
    if (p) taken.add(p);
    return p;
  }

  /** What the office's own acts come to, newest first, each with what came of it and the part of the file it is in. */
  private entries(now: number): Entry[] {
    const taken = new Set<Flow>(), takenIn = new Set<Flow>();
    const list: Entry[] = [];
    for (const r of [...this.own.values()].sort((a, b) => a.at - b.at)) {
      const m = r.record === "statement" ? (r.data as any)?.outcome?.money : undefined;
      if (m && !this.accounts.has(m.to)) {
        // A request that money go out: carried out as a payment seen, or not yet (and, where the office is shown no bank
        // account, nothing it can see: said once, at the head of the part).
        const paid = this.paidAs(r, taken);
        const asked = "the bank"; // (money out of its account goes by whoever keeps the account)
        list.push(paid
          ? { at: paid.t, changed: paid.t, kind: "payment", id: r.id, part: "done", line: `${dateWords(paid.t)}: paid ${moneyNow(paid.amount)} to ${this.name(paid.with)}${paid.settles ? `, settling ${paid.settles}` : ""}${paid.memo ? ` ("${cut(paid.memo, 60)}")` : ""}; asked of ${asked} ${dateWords(r.at)} (${r.id})` }
          : { at: r.at, changed: r.at, kind: "payment", id: r.id, part: "theirs", line: `${dateWords(r.at)}: asked ${asked} to pay ${moneyNow(cents(m.amount))} to ${this.name(m.to)}${m.settles ? `, settling ${m.settles}` : ""} (${r.id})${this.accounts.size ? "; no payment out of the account seen yet" : ""}` });
        continue;
      }
      const f = this.followed.get(r.id);
      const what = r.record === "statement" ? words(r.kind) : r.record === "vote" ? "vote" : r.record === "signature" ? "signature" : r.record === "agreement" ? "agreement drawn up" : r.record === "withdrawal" ? "withdrawal" : "notice";
      const body = r.record === "statement" ? cut(r.text ?? "", 90)
        : r.record === "vote" ? `voted "${r.choice}" on ${r.ballot}`
        : r.record === "signature" ? `signed ${r.agreement}`
        : r.record === "withdrawal" ? `withdrew ${r.withdraws}`
        : r.record === "notice" ? `gave notice on ${r.agreement}` : r.record === "agreement" ? cut(String((r.terms as any)?.template ?? ""), 40) : "";
      const to = this.toWords(r);
      // (A request of ours to be paid, an invoice say: paid in, or nothing has come in for it yet.)
      const paidIn = m ? this.paidIn(r, takenIn) : undefined;
      // (A paper that names a day by which it is to be answered or done, with nothing following it by then: overdue.)
      const due = dueOf(r);
      // (Nothing has followed it: no paper of anyone else's cites it, nor, since it was made, what it rests on.)
      const answered = basesOf(r).some((b) => (this.citedLast.get(b) ?? -1) > r.at);
      const late = !f && !answered && !paidIn && due !== undefined && now > due;
      const came = paidIn ? `; paid in ${dateWords(paidIn.t)}: ${moneyNow(paidIn.amount)} from ${this.name(paidIn.with)}`
        : m ? "; nothing has come in for it yet"
        : f ? `; followed ${dateWords(f.at)} by a ${words(f.kind)} (${this.name(f.by)})`
        : late ? `; its day (${dateWords(due!)}) has passed` : "";
      list.push({ at: r.at, changed: Math.max(r.at, paidIn?.t ?? -1, f?.at ?? -1, late ? due! : -1), kind: what, id: r.id, part: late ? "overdue" : paidIn || f ? "done" : "theirs",
        line: `${dateWords(r.at)}: ${what}${to ? ` to ${to}` : ""}${body ? `: "${cut(body, late ? 50 : 90)}"` : ""} (${r.id})${came}` });
    }
    // (Payments out that no request of ours led to: a standing pay, an instruction given another way. The same sum for
    // the same stated reason, to one payee or many, is one line: how many, to whom, since when, the latest.)
    const standing = new Map<string, Flow[]>();
    for (const p of this.out) {
      if (taken.has(p)) continue;
      const key = p.settles ? `${p.with}|${p.amount}|${p.settles}` : `${p.amount}|${(p.memo ?? "").replace(/\b(for|to)\s+\S+$/i, "").trim().toLowerCase()}`;
      standing.set(key, [...(standing.get(key) ?? []), p]);
    }
    for (const ps of standing.values()) {
      const last = ps.reduce((a, b) => (b.t >= a.t ? b : a));
      const payees = new Set(ps.map((x) => x.with));
      list.push({ at: last.t, changed: last.t, kind: "payment", n: ps.length, part: "done", line: `${dateWords(last.t)}: paid ${moneyNow(last.amount)} to ${payees.size > 1 ? `${payees.size} payees` : this.name(last.with)}${last.settles ? `, settling ${last.settles}` : ""}${last.memo && payees.size === 1 ? ` ("${cut(last.memo, 60)}")` : last.memo ? ` ("${cut(last.memo.replace(/\b(for|to)\s+\S+$/i, "").trim(), 40)}")` : ""}${ps.length > 1 ? `; ${plural(ps.length, "payment")} in all since ${dateWords(Math.min(...ps.map((x) => x.t)))}` : ""}` });
    }
    // (Many papers of one kind in one day, in one part, are one line: a day's listings, a day's withdrawals.)
    const days = new Map<string, Entry[]>();
    for (const e of list) days.set(`${e.kind}|${e.part}|${Math.floor(e.at / DAY)}`, [...(days.get(`${e.kind}|${e.part}|${Math.floor(e.at / DAY)}`) ?? []), e]);
    for (const es of days.values()) {
      if (es.length < 3 || es[0]!.kind === "payment") continue;
      for (const e of es) list.splice(list.indexOf(e), 1);
      const ids = es.map((e) => e.id).filter(Boolean) as string[];
      list.push({ at: Math.max(...es.map((e) => e.at)), changed: Math.max(...es.map((e) => e.changed)), kind: es[0]!.kind, n: es.length, part: es[0]!.part, line: `${dateWords(es[0]!.at)}: ${es.length} ${es[0]!.kind}s (${ids[0]} to ${ids[ids.length - 1]})` });
    }
    return list.sort((a, b) => b.at - a.at);
  }

  /**
   * The text for a sitting at `t`; empty where the office has no acts, no payments and nothing open yet. `since`: when
   * the seat's last sitting opened. What has not changed since then is not set out again line by line: each part says
   * how many such lines it has, with their papers' ids, to be looked up again by id (a paper of the office's own is in
   * its papers). A 7B model was shown the same lines at every sitting and wrote them into its notebook each time.
   */
  text(t: number, title: string, since?: number): string {
    const all = this.entries(t);
    const recent = all.filter((e) => t - e.at <= LISTED_DAYS * DAY);
    const isNew = (e: Entry) => since === undefined || since < 0 || e.changed >= since;
    const older = all.slice(recent.length);
    const out = [`## ${title}: The office's own file, ${dateWords(t)}`,
      "A record of what the office has done and what is known to have come of each, from its own papers and accounts: what others have yet to do is theirs, and nothing here is for the office to do unless a line says so."];
    let room = SENT_CHARS;
    const folded = new Map<string, number>();
    let any = false;
    for (const { part, head } of PARTS) {
      const here = recent.filter((e) => e.part === part);
      if (!here.length) continue;
      const fresh = here.filter(isNew), same = here.filter((e) => !isNew(e));
      const f = fit(fresh.map((e) => `- ${cut(e.line, LINE + 60)}`), room);
      room -= f.shown.join("\n").length;
      for (const e of fresh.slice(f.shown.length)) folded.set(e.kind, (folded.get(e.kind) ?? 0) + (e.n ?? 1));
      const ids = same.map((e) => e.id).filter((x): x is string => !!x);
      const sameLine = same.length ? `- ${f.shown.length ? "And " : ""}${plural(same.length, "line")} as at your last sitting, unchanged${ids.length ? ` (${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ` and ${ids.length - 8} more` : ""}: to read one again, look it up by its id)` : ""}.` : "";
      const blind = part === "theirs" && !this.accounts.size && here.some((e) => e.kind === "payment") ? ["(This office is not shown its bank account: what the bank did with what it was asked is not something this office can see.)"] : [];
      out.push("", `${head}${since !== undefined && since >= 0 && fresh.length ? " (new or changed since your last sitting first)" : ""}:`, ...blind, ...f.shown, ...(sameLine ? [sameLine] : []));
      any = true;
    }
    for (const e of older) folded.set(e.kind, (folded.get(e.kind) ?? 0) + (e.n ?? 1));
    if (folded.size) { out.push("", `${any ? "Before that" : "Earlier"}${any && room < SENT_CHARS ? " and beyond the lines above" : ""}: ${counted(folded)}.`); any = true; }
    const money: string[] = [];
    const byPayer = new Map<string, Flow[]>();
    for (const f of this.into.filter((x) => t - x.t <= LISTED_DAYS * DAY)) byPayer.set(f.with, [...(byPayer.get(f.with) ?? []), f]);
    for (const [from, fs] of [...byPayer].sort((a, b) => b[1][b[1].length - 1]!.t - a[1][a[1].length - 1]!.t)) {
      const last = fs[fs.length - 1]!;
      const sum = fs.reduce((n, f) => n + f.amount, 0);
      money.push(fs.length === 1 ? `- ${dateWords(last.t)}: ${moneyNow(last.amount)} from ${this.name(from)}${last.memo ? ` ("${cut(last.memo, 60)}")` : ""}`
        : `- ${plural(fs.length, "payment")} from ${this.name(from)}, ${moneyNow(sum)} in all, the latest ${dateWords(last.t)}${last.memo ? ` ("${cut(last.memo, 60)}")` : ""}`);
    }
    const inFit = fit(money, IN_CHARS);
    if (inFit.shown.length) { out.push("", `Into the office's account in the last ${LISTED_DAYS} days:`, ...inFit.shown, ...(inFit.left ? [`- and ${plural(inFit.left, "payer")} more`] : [])); any = true; }
    // What is the office's own to do, as its books stand: said as such.
    const heads = (this.o.books?.open(t) ?? []).filter((h) => h.items.length);
    const open = heads.flatMap((h) => [`- ${h.what} (${h.items.length}):`, ...h.items.slice(0, 3).map((x) => `  - ${cut(x.line, LINE)}`), ...(h.items.length > 3 ? [`  - and ${h.items.length - 3} more`] : [])]);
    const openFit = fit(open, OPEN_CHARS);
    if (openFit.shown.length) { out.push("", "Standing open on the books now: the office's own to see to, each settled by the paper or payment its line names:", ...openFit.shown, ...(openFit.left ? [`- and ${openFit.left} more lines`] : [])); any = true; }
    if (!any) return "";
    return out.filter((l, i, a) => !(l === "" && (a[i - 1] === "" || i === a.length - 1))).join("\n");
  }
}
