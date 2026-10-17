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
/** The most the whole text may come to, in characters (a space kept, a section at a time, lines whole). */
export const DAYBOOK_MAX = 4_500;
/** How far back the office's own acts are listed; before that they are counted. */
export const LISTED_DAYS = 40;
const SENT_CHARS = 1_700, OPEN_CHARS = 1_400, IN_CHARS = 500;
const LINE = 170;
/** Papers that are the office's own bookkeeping, not its acts: what its clerk files and its staff report. */
const NOT_ACTS = new Set(["office_books", "staff_report"]);

interface Entry { at: number; kind: string; line: string; id?: string; n?: number }
interface Flow { t: number; with: string; amount: number; memo?: string; settles?: string }

const words = (s: string): string => s.replace(/_/g, " ");
const cut = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
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

export class DayBook {
  private readonly own = new Map<string, Paper>();
  /** A record cited by a paper of someone else's (or by a reply that names it): who, when, what kind. */
  private readonly followed = new Map<string, { at: number; kind: string; by: string }>();
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
        for (const id of refs) if (!this.followed.has(id) || this.followed.get(id)!.at > r.at) this.followed.set(id, { at: r.at, kind: r.record === "statement" ? r.kind : r.record, by: r.speaks_for ?? r.author });
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

  /** The payment out that a request to pay was carried out as, if one has been seen (each payment answers one request). */
  private paidAs(r: Paper, taken: Set<Flow>): Flow | undefined {
    const m = r.record === "statement" ? (r.data as any)?.outcome?.money : undefined;
    if (!m) return undefined;
    const p = this.out.find((f) => !taken.has(f) && f.t >= r.at && f.with === m.to && f.amount === cents(m.amount) && (m.settles === undefined || f.settles === m.settles));
    if (p) taken.add(p);
    return p;
  }

  /** What the office's own acts come to, newest first, each with what came of it. */
  private entries(): Entry[] {
    const taken = new Set<Flow>();
    const list: Entry[] = [];
    for (const r of [...this.own.values()].sort((a, b) => a.at - b.at)) {
      const paid = this.paidAs(r, taken);
      if (r.record === "statement" && (r.data as any)?.outcome?.money) {
        const m = (r.data as any).outcome.money;
        list.push({ at: paid?.t ?? r.at, kind: "payment", id: r.id, line: paid
          ? `${dateWords(paid.t)}: paid ${moneyNow(paid.amount)} to ${this.name(paid.with)}${paid.settles ? `, settling ${paid.settles}` : ""}${paid.memo ? ` ("${cut(paid.memo, 60)}")` : ""}; asked of the bank ${dateWords(r.at)} (${r.id})`
          : `${dateWords(r.at)}: asked the bank to pay ${moneyNow(cents(m.amount))} to ${this.name(m.to)}${m.settles ? `, settling ${m.settles}` : ""} (${r.id}); ${this.accounts.size ? "no payment out of the account seen yet" : "this office is not shown its bank account, so what came of it is not known to it"}` });
        continue;
      }
      const f = this.followed.get(r.id);
      const to = r.record === "statement" ? (r.addressed_to ?? []).filter((x) => x !== this.o.entity) : [];
      const what = r.record === "statement" ? words(r.kind) : r.record === "vote" ? "vote" : r.record === "signature" ? "signature" : r.record === "agreement" ? "agreement drawn up" : r.record === "withdrawal" ? "withdrawal" : "notice";
      const body = r.record === "statement" ? cut(r.text ?? "", 90)
        : r.record === "vote" ? `voted "${r.choice}" on ${r.ballot}`
        : r.record === "signature" ? `signed ${r.agreement}`
        : r.record === "withdrawal" ? `withdrew ${r.withdraws}`
        : r.record === "notice" ? `gave notice on ${r.agreement}` : r.record === "agreement" ? cut(String((r.terms as any)?.template ?? ""), 40) : "";
      list.push({ at: r.at, kind: what, id: r.id,
        line: `${dateWords(r.at)}: ${what}${to.length ? ` to ${to.slice(0, 2).map((x) => this.name(x)).join(" and ")}${to.length > 2 ? ` and ${to.length - 2} more` : ""}` : ""}${body ? `: "${cut(body, 90)}"` : ""} (${r.id})${f ? `; followed ${dateWords(f.at)} by a ${words(f.kind)} (${this.name(f.by)})` : ""}` });
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
      list.push({ at: last.t, kind: "payment", n: ps.length, line: `${dateWords(last.t)}: paid ${moneyNow(last.amount)} to ${payees.size > 1 ? `${payees.size} payees` : this.name(last.with)}${last.settles ? `, settling ${last.settles}` : ""}${last.memo && payees.size === 1 ? ` ("${cut(last.memo, 60)}")` : last.memo ? ` ("${cut(last.memo.replace(/\b(for|to)\s+\S+$/i, "").trim(), 40)}")` : ""}${ps.length > 1 ? `; ${plural(ps.length, "payment")} in all since ${dateWords(Math.min(...ps.map((x) => x.t)))}` : ""}` });
    }
    // (Many papers of one kind in one day are one line: a day's listings, a day's withdrawals.)
    const days = new Map<string, Entry[]>();
    for (const e of list) days.set(`${e.kind}|${Math.floor(e.at / DAY)}`, [...(days.get(`${e.kind}|${Math.floor(e.at / DAY)}`) ?? []), e]);
    for (const es of days.values()) {
      if (es.length < 3 || es[0]!.kind === "payment") continue;
      for (const e of es) list.splice(list.indexOf(e), 1);
      const ids = es.map((e) => e.id).filter(Boolean) as string[];
      list.push({ at: Math.max(...es.map((e) => e.at)), kind: es[0]!.kind, n: es.length, line: `${dateWords(es[0]!.at)}: ${es.length} ${es[0]!.kind}s (${ids[0]} to ${ids[ids.length - 1]})` });
    }
    return list.sort((a, b) => b.at - a.at);
  }

  /** The text for a sitting at `t`; empty where the office has no acts, no payments and nothing open yet. */
  text(t: number, title: string): string {
    const all = this.entries();
    const recent = all.filter((e) => t - e.at <= LISTED_DAYS * DAY);
    const sent = fit(recent.map((e) => `- ${cut(e.line, LINE + 60)}`), SENT_CHARS);
    const older = [...all.slice(recent.length), ...recent.slice(sent.shown.length)];
    const folded = new Map<string, number>();
    for (const e of older) folded.set(e.kind, (folded.get(e.kind) ?? 0) + (e.n ?? 1));
    const heads = (this.o.books?.open(t) ?? []).filter((h) => h.items.length);
    const open = heads.flatMap((h) => [`- ${h.what} (${h.items.length}):`, ...h.items.slice(0, 3).map((x) => `  - ${cut(x.line, LINE)}`), ...(h.items.length > 3 ? [`  - and ${h.items.length - 3} more`] : [])]);
    const openFit = fit(open, OPEN_CHARS);
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
    if (!sent.shown.length && !folded.size && !openFit.shown.length && !inFit.shown.length) return "";
    const out = [`## ${title}: The office's own file, ${dateWords(t)}`,
      "What the office has sent, filed and paid (newest first), what has come into its account, and what stands open on its books, from its own papers and accounts."];
    if (sent.shown.length) out.push("", `Sent, filed and paid in the last ${LISTED_DAYS} days:`, ...sent.shown);
    if (folded.size) out.push("", `${sent.shown.length ? "Before that" : "Earlier"}${sent.left ? " and beyond the lines above" : ""}: ${counted(folded)}.`);
    if (inFit.shown.length) out.push("", `Into the office's account in the last ${LISTED_DAYS} days:`, ...inFit.shown, ...(inFit.left ? [`- and ${plural(inFit.left, "payer")} more`] : []));
    if (openFit.shown.length) out.push("", "Standing open on the books now:", ...openFit.shown, ...(openFit.left ? [`- and ${openFit.left} more lines`] : []));
    return out.filter((l, i, a) => !(l === "" && (a[i - 1] === "" || i === a.length - 1))).join("\n");
  }
}
