// What stands open at the town's offices, as each office's clerk reads it from the office's own papers and accounts
// (docs/behaviour/office-books.md): the finance office, the mayor's, the works and environment offices, the planning
// office and the council clerk's. Each reader is a plain restatement of what that module's code works out for itself
// wake after wake, from the same papers, read the same way and with the same figures; nothing here decides or does
// anything, and nothing is read that the office's code is not shown.

import { basesOf, channels, type Observation, type StatementRecord } from "../contracts";
import { dateWords, durationWords } from "../forms";
import type { OfficeBooks, OpenHeading, OpenItem, ParticipantContext } from "../module";
import { cents } from "../money";
import { approvalOf, Book, commitmentOf, DAY, Directions, jobTerms, madeAt, ownAccount, usd, whenWords } from "./common";
import { Staffing, staffingUnder } from "./firms";
import { dueFrom, returnsOf } from "./returns";
import { incomeTaxLaw, withheld } from "./tax";

const YEAR = 365 * DAY;
const addressed = (r: StatementRecord, me: string) => (r.addressed_to ?? []).includes(me);
const oldestFirst = (a: OpenItem, b: OpenItem) => (a.since ?? 0) - (b.since ?? 0) || (a.id < b.id ? -1 : 1);
const heading = (what: string, items: OpenItem[]): OpenHeading[] => (items.length ? [{ what, items: items.sort(oldestFirst) }] : []);
const yearInDays = (year: number): string => `day ${(year - 1) * 365} to day ${year * 365 - 1}`;
/** The town's budget for a year, of those adopted (the latest, if the council adopted more than one for it). */
const budgetFor = (book: Book, year: number): StatementRecord | undefined => book.open("budget").filter((b) => b.data?.year === year).sort((a, b) => b.at - a.at)[0];
const linesWords = (lines: { [k: string]: number }): string => Object.entries(lines).map(([k, v]) => `${k} ${usd(cents(v))}`).join(", ");
const dead = (book: Book): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of [...book.all("death_registration"), ...book.all("death_certificate")]) {
    const who = r.data?.deceased;
    if (typeof who === "string" && !m.has(who)) m.set(who, r.at);
  }
  return m;
};

/** What an office has seen leave its own account (what settled which paper) and the wages its standing payments paid. */
class Paid {
  readonly settled = new Set<string>();
  /** Each payment seen to settle a paper: which, when, and how much. */
  readonly settling: { id: string; t: number; amount: number; line?: string }[] = [];
  /** Each payment seen made under a standing payment of the office's: which, when, and how much (after what was withheld). */
  readonly byOrder: { t: number; order: string; amount: number; line?: string }[] = [];
  /** What has left the account, by what each payment said it was for (the bank's statement line, `memo`): when and how much. */
  readonly saidFor: { t: number; memo: string; amount: number }[] = [];
  account: string | undefined;
  absorb(obs: Observation): void {
    const acc = ownAccount(obs);
    if (!acc) return;
    this.account = acc.account;
    for (const tx of channels.transactions(obs)) {
      if (tx.from !== acc.account) continue;
      if (tx.memo) this.saidFor.push({ t: tx.t, memo: tx.memo, amount: cents(tx.amount) });
      if (tx.settles) {
        this.settled.add(tx.settles);
        this.settling.push({ id: tx.settles, t: tx.t, amount: cents(tx.amount), ...(tx.line ? { line: tx.line } : {}) });
      }
      if (tx.per_instruction) this.byOrder.push({ t: tx.t, order: tx.per_instruction, amount: cents(tx.amount), ...(tx.line ? { line: tx.line } : {}) });
    }
  }
}

/** The employment agreements of an employer's own (the staff's `contracts`, as the code that runs the office reads them). */
const contractsOf = (staffing: Staffing, book: Book): any[] => (staffing as any).contracts(book);

// ------------------------------------------------------------------ the finance office

/**
 * city.finance_officer: invoices addressed to the town and not paid; the town's employees whose wage is not being paid;
 * wages still being paid to someone who has died or whose employment has ended; the year's budget against what has
 * been paid; and the tax withheld from wages and not yet paid over.
 */
export function financeBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const p = { period: 14 * DAY, notice_days: 14, procedure: "", payroll_wait_days: 3, ...(ctx.params ?? {}) } as any;
  const book = new Book();
  const money = new Paid();
  const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, role: "staff", does: { hire: false, pay: true }, notice_wait: p.payroll_wait_days * DAY });
  return {
    absorb(obs) { book.absorb(obs); money.absorb(obs); },
    open(t) {
      const year = Math.floor(t / YEAR) + 1;
      // ---- invoices addressed to the town, not paid ----
      const rule = approvalOf(book, p.procedure);
      const approved = new Set(rule ? book.open("approval").filter((a) => a.in_position === rule.by).map((a) => String(a.data?.invoice)) : []);
      const invoices = book.open("invoice").filter((r) => addressed(r, me) && r.data?.outcome?.money && !money.settled.has(r.id)).map((r): OpenItem => {
        const amount = cents(r.data!.outcome.money.amount);
        const over = !!rule && amount > rule.over;
        return { id: r.id, since: madeAt(r), amount, line: `${r.id}: invoice from ${r.speaks_for ?? r.author} for ${usd(amount)}, dated ${whenWords(madeAt(r))}, not paid${over ? `; it is over the payments procedure's figure of ${usd(rule!.over)} and ${approved.has(r.id) ? "the mayor's written approval is on file" : "the mayor's written approval is not on file"}` : ""}` };
      });
      // ---- wages: the standing payments on file, by the agreement each rests on ----
      const orders = new Map<string, StatementRecord[]>(); // agreement -> its standing payments, not withdrawn
      for (const r of book.open("request")) if (r.speaks_for === me && r.data?.every) for (const b of basesOf(r)) orders.set(b, [...(orders.get(b) ?? []), r]);
      const deaths = dead(book);
      const starters = new Map<string, StatementRecord>();
      for (const n of book.open("payroll_notice")) if (n.speaks_for === me && n.data?.notice === "starter" && typeof n.data?.agreement === "string") starters.set(n.data.agreement, n);
      const unpaid: OpenItem[] = [];
      for (const a of staffing.staff(book, t)) {
        const worker = a.terms.parties[1] as string;
        if (orders.has(a.id) || deaths.has(worker)) continue;
        // (Work by the day is paid for each day worked, and has no standing payment.)
        if (a.terms.commitments?.some((c: any) => c.who === me && c.every === DAY && c.does?.outcome?.money)) continue;
        const signed = book.signedAt(a.id) ?? a.at;
        const told = starters.get(a.id);
        // (The office waits a few days for the hiring office's notice before it sets the wage up from the agreement.)
        if (!told && t - signed < p.payroll_wait_days * DAY) continue;
        const pays = jobTerms(a, worker);
        unpaid.push({ id: a.id, since: signed, amount: pays.wage,
          line: `${a.id}: ${worker} works for the town on ${usd(pays.wage)} every ${durationWords(pays.period)}, in force since ${dateWords(signed)}; no standing payment of the wage is on file${told ? `; the hiring office's payroll notice ${told.id} names it${typeof told.data?.line === "string" ? `, as a post the ${told.data.line} line of the adopted budget pays for` : ""}` : "; no payroll notice has come for it"}` });
      }
      const stale: OpenItem[] = [];
      for (const [agreement, rs] of orders) {
        const a = book.records.get(agreement);
        if (a?.record !== "agreement" || a.terms.template !== "employment" || a.terms.parties[0] !== me) continue;
        const worker = a.terms.parties[1] as string;
        const ends = book.endsAt(agreement);
        const why = deaths.has(worker) ? { since: deaths.get(worker)!, words: `${worker}, whose death is registered (${dateWords(deaths.get(worker)!)})` }
          : ends !== undefined && t >= ends ? { since: ends, words: `${worker}, whose employment ended ${dateWords(ends)}` } : undefined;
        if (!why) continue;
        for (const r of rs) {
          const amount = cents(r.data?.outcome?.money?.amount ?? 0);
          stale.push({ id: r.id, since: why.since, amount, line: `${r.id}: a standing payment of ${usd(amount)} every ${durationWords(Number(r.data?.every))} for ${why.words}, under agreement ${agreement}, is not withdrawn` });
        }
      }
      // ---- the budget for the year ----
      // (The office's papers keep payments in total: a payment that settles an invoice is not marked with a line of the
      // budget, nor a wage, so what is paid against the budget can be told only for the year as a whole.)
      const from = (year - 1) * YEAR, to = year * YEAR;
      const invoiceIds = new Set(book.all("invoice").map((r) => r.id));
      const invoicesPaid = money.settling.filter((x) => x.t >= from && x.t < to && invoiceIds.has(x.id)).reduce((n, x) => n + x.amount, 0);
      // (What each payment drawn on the budget says line it is drawn on: an invoice paid, a wage paid with what was
      // withheld from it. A payment that names none is unallocated: shown so, never refused.)
      const spentOn = new Map<string, number>();
      const draw = (line: string | undefined, n: number) => spentOn.set(line ?? "", (spentOn.get(line ?? "") ?? 0) + n);
      for (const x of money.settling) if (x.t >= from && x.t < to && invoiceIds.has(x.id)) draw(x.line, x.amount);
      const perPay = (order: string): number => {
        const r = book.records.get(order);
        if (r?.record !== "statement") return 0;
        const net = cents(r.data?.outcome?.money?.amount ?? 0);
        for (const b of basesOf(r)) {
          const a = book.records.get(b);
          if (a?.record === "agreement") return Math.max(0, cents(commitmentOf(a, me).outcome?.money?.amount ?? 0) - net);
        }
        return 0;
      };
      const held = new Map<string, number>();
      let wages = 0, withheldSince = 0;
      const reports = book.open("withholding_report").filter((r) => r.speaks_for === me);
      const lastReportEnd = reports.reduce((m, r) => Math.max(m, Number(r.data?.period_end ?? r.at)), -1);
      for (const x of money.byOrder) {
        if (!held.has(x.order)) held.set(x.order, perPay(x.order));
        if (x.t >= from && x.t < to) { wages += x.amount + held.get(x.order)!; draw(x.line, x.amount + held.get(x.order)!); }
        if (x.t > lastReportEnd) withheldSince += held.get(x.order)!;
      }
      const adopted = budgetFor(book, year);
      const last = adopted ?? book.open("budget").filter((b) => typeof b.data?.year === "number" && b.data.year < year).sort((a, b) => b.data.year - a.data.year || b.at - a.at)[0];
      const budget: OpenItem[] = [];
      // (What the year's payments said they were for, as the bank's statement has them: the nearest the office's papers
      // come to telling one kind of spending from another. The five largest, and the rest together.)
      const forWhat = new Map<string, number>();
      for (const x of money.saidFor) if (x.t >= from && x.t < to) forWhat.set(x.memo, (forWhat.get(x.memo) ?? 0) + x.amount);
      const byMemo = [...forWhat].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const saidWords = byMemo.length ? `. By what the payments said they were for: ${byMemo.slice(0, 5).map(([m, n]) => `"${m}" ${usd(n)}`).join("; ")}${byMemo.length > 5 ? `; ${byMemo.length - 5} other kinds ${usd(byMemo.slice(5).reduce((n, x) => n + x[1], 0))}` : ""}` : "";
      // Room left by line: each line of the adopted budget, what has been drawn on it and what is left; and what no line was
      // named for. Lines the payments name that the budget does not have are said too.
      const byLine = (lines: { [k: string]: number }): string => {
        const names = [...new Set([...Object.keys(lines), ...[...spentOn.keys()].filter((k) => k)])].sort();
        const each = names.map((k) => lines[k] === undefined ? `${k} (not a line of the budget) ${usd(spentOn.get(k) ?? 0)} drawn` : `${k} ${usd(spentOn.get(k) ?? 0)} drawn of ${usd(cents(lines[k]!))}, ${usd(cents(lines[k]!) - (spentOn.get(k) ?? 0))} left`);
        const none = spentOn.get("") ?? 0;
        return `${each.join("; ")}; ${none ? `${usd(none)} unallocated (payments that name no line)` : "nothing unallocated"}`;
      };
      if (adopted) {
        const lines = (adopted.data?.lines ?? {}) as { [k: string]: number };
        const total = Object.values(lines).reduce((n, v) => n + cents(v), 0);
        const spent = invoicesPaid + wages;
        budget.push({ id: adopted.id, running: true, since: adopted.at, amount: total - spent,
          line: `${adopted.id}: the budget adopted for year ${year} (${yearInDays(year)}) is ${usd(total)} in all (${linesWords(lines)}); paid so far this year ${usd(spent)} (${usd(invoicesPaid)} on invoices, ${usd(wages)} in wages, the wages counted before tax withheld); ${usd(total - spent)} is left. By line: ${byLine(lines)}${saidWords}` });
      } else {
        const lines = (last?.data?.lines ?? {}) as { [k: string]: number };
        const total = Object.values(lines).reduce((n, v) => n + cents(v), 0);
        budget.push({ id: `budget-year-${year}`, running: true, since: from,
          line: last ? `no budget is adopted for year ${year} (${yearInDays(year)}); under the budget last adopted (${last.id}, year ${last.data?.year}: ${linesWords(lines)}; ${usd(total)} in all) and at no more each month than a twelfth of it; paid so far this year ${usd(invoicesPaid + wages)} (${usd(invoicesPaid)} on invoices, ${usd(wages)} in wages; ${byLine(lines)})` : `no budget has been adopted for year ${year} (${yearInDays(year)}), and none before it; paid so far this year ${usd(invoicesPaid + wages)}` });
      }
      // ---- tax withheld from wages, not yet paid over ----
      const latest = new Map<string, StatementRecord>(); // collector -> its latest report
      for (const r of reports) {
        const c = (r.addressed_to ?? [])[0] ?? "the collector";
        const was = latest.get(c);
        if (!was || Number(r.data?.period_end ?? r.at) >= Number(was.data?.period_end ?? was.at)) latest.set(c, r);
      }
      const tax: OpenItem[] = [];
      for (const [collector, r] of latest) {
        const owing = cents(r.data?.withheld ?? 0) - cents(r.data?.paid ?? 0);
        if (owing > 0) tax.push({ id: r.id, since: r.at, amount: owing, line: `${r.id}: at the report to ${collector} of ${dateWords(r.at)} the town owed ${usd(cents(r.data?.withheld ?? 0))} of tax withheld from wages and paid over ${usd(cents(r.data?.paid ?? 0))}; ${usd(owing)} was still owing` });
      }
      if (withheldSince > 0) tax.push({ id: "withheld-since-last-report", running: true, amount: withheldSince, ...(lastReportEnd >= 0 ? { since: lastReportEnd } : {}),
        line: `${usd(withheldSince)} of tax has been withheld from wages paid ${lastReportEnd >= 0 ? `since the last report to a collector (${dateWords(lastReportEnd)})` : "so far, with no report yet to a collector"}` });
      // ---- the returns of tax withheld that fall due, by the law's calendar (participants/src/behaviour/returns.ts) ----
      const falling: OpenItem[] = [];
      const law = incomeTaxLaw(book);
      if (law) {
        const orderEvery = (order: string): number => { const r = book.records.get(order); return r?.record === "statement" && Number(r.data?.every) > 0 ? Number(r.data?.every) : p.period; };
        for (const rule of returnsOf(law)) {
          const next = dueFrom(rule, t);
          const filed = reports.filter((r) => r.data?.return === rule.id).reduce((m, r) => Math.max(m, Number(r.data?.period_end ?? r.at)), -1);
          // (What each pay withheld under this return's charges, as the law reckons it from the gross: the pay as paid, and what was held.)
          let sum = 0;
          for (const x of money.byOrder) {
            if (x.t <= filed) continue;
            const hold = held.get(x.order) ?? 0;
            const parts = withheld(law, x.amount + hold, orderEvery(x.order)).parts;
            const all = parts.reduce((n, c) => n + c.amount, 0);
            const mine = parts.filter((c) => rule.charges === undefined || rule.charges.includes(c.charge.id)).reduce((n, c) => n + c.amount, 0);
            sum += all > 0 ? Math.round((hold * mine) / all) : 0;
          }
          const names = (rule.charges ?? law.charges.map((c) => c.id)).map((id) => law.charges.find((c) => c.id === id)?.name ?? id).join(", ");
          const days = Math.round((next.due - Math.floor(t / DAY) * DAY) / DAY);
          falling.push({ id: `${rule.id}-${next.due}`, running: true, due: next.due, amount: sum,
            line: `${rule.name ?? "Return of tax withheld from wages"} (${names}), under ${law.id}: the next falls due on ${dateWords(next.due)} (${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}), for pay from ${dateWords(next.from)} to ${dateWords(next.to - 1)}; the last was ${filed >= 0 ? `made on ${dateWords(filed)}` : "none yet"}; ${usd(sum)} of this has been withheld from wages paid since` });
        }
      }
      return [
        ...heading("Invoices addressed to the town, not paid", invoices),
        ...heading("Employees of the town with no standing payment of their wage on file", unpaid),
        ...heading("Wages still being paid to someone who has died or whose employment has ended", stale),
        ...heading("The budget for the year, against what has been paid", budget),
        ...heading("Tax withheld from wages and not yet paid over", tax),
        ...(falling.length ? [{ what: "Returns of tax withheld from wages falling due, and the day each is due by", items: falling.sort((a, b) => (a.due ?? 0) - (b.due ?? 0) || (a.id < b.id ? -1 : 1)) }] : []),
      ];
    },
  };
}

// ------------------------------------------------------------------ the mayor's office

/**
 * city.mayor_code: petitions (their published counts against the town's threshold), invoices for work the office
 * commissioned and has not approved, permits granted on its applications and no builder commissioned, the budget (tabled
 * and not decided; years with none adopted), complaints about the town's services, and debts claimed against the town.
 */
export function mayorBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const p = { petition_threshold_bps: 1500, population: 200, budget_lead_days: 0, ...(ctx.params ?? {}) } as any;
  const book = new Book();
  const money = new Paid();
  // The office's own records: made in this position (whoever held it then), or by this participant as itself.
  const ours = (r: { author: string; in_position?: string }) => (ctx.position ? r.in_position === ctx.position : r.author === ctx.participant);
  const acted = new Set<string>(); // what the office has acted on (the bases of its records)
  return {
    absorb(obs) {
      for (const r of book.absorb(obs)) if (ours(r)) {
        for (const b of basesOf(r)) acted.add(b);
        // (A paper of the office's own that names a petition in its words is the office acting on it, as one that
        // cites it is: a seat put two petitions to the council on the proposal form, whose paper cites nothing, and
        // its books listed all four as not acted on for the 45 days that followed: the third living pilot.)
        if (r.record === "statement" && (r.kind === "proposal" || r.kind === "petition_response") && typeof r.text === "string") for (const id of r.text.match(/\brec\.[0-9]+\b/g) ?? []) acted.add(id);
      }
      money.absorb(obs);
    },
    open(t) {
      const needed = Math.ceil((p.petition_threshold_bps * p.population) / 10_000);
      const reached = (n: number) => n * 10_000 >= p.petition_threshold_bps * p.population;
      // ---- petitions ----
      const counts = new Map<string, number>(); // petition -> the organiser's latest published count
      const petitions = book.open("petition");
      const byId = new Map(petitions.map((r) => [r.id, r]));
      for (const c of book.open("petition_count")) {
        const pet = byId.get(String(c.data?.petition));
        if (pet && c.speaks_for === pet.speaks_for && typeof c.data?.signatures === "number") counts.set(pet.id, c.data.signatures);
      }
      const threshold = `the town's threshold of ${needed} signature${needed === 1 ? "" : "s"}`;
      const over: OpenItem[] = [], below: OpenItem[] = [];
      for (const pet of petitions) {
        if (acted.has(pet.id)) continue;
        const n = counts.get(pet.id) ?? 0;
        const what = String(pet.data?.demand?.text ?? pet.text ?? "").slice(0, 120);
        const base = `${pet.id}: ${pet.speaks_for ?? pet.author}'s petition of ${dateWords(pet.at)} (${what}) has ${n} signature${n === 1 ? "" : "s"} by its organiser's latest count`;
        if (reached(n)) over.push({ id: pet.id, since: pet.at, line: `${base}, at or over ${threshold}; it has not been put to the council or answered` });
        else if (addressed(pet, me)) below.push({ id: pet.id, since: pet.at, line: `${base}, short of ${threshold}` });
      }
      // ---- invoices for work the office commissioned, awaiting its approval ----
      const approvals = new Set(book.open("approval").filter((a) => ours(a)).map((a) => String(a.data?.invoice)));
      const invoices: OpenItem[] = [];
      for (const inv of book.open("invoice")) {
        if (!addressed(inv, me) || approvals.has(inv.id) || money.settled.has(inv.id)) continue;
        const ag = basesOf(inv).map((b) => book.records.get(b)).find((x) => x?.record === "agreement" && ours(x));
        if (!ag) continue;
        const amount = cents(inv.data?.outcome?.money?.amount ?? 0);
        invoices.push({ id: inv.id, since: inv.at, amount, line: `${inv.id}: invoice from ${inv.speaks_for ?? inv.author} for ${usd(amount)}, dated ${dateWords(inv.at)}, for work commissioned under ${ag!.id}; no written approval of ours is on file` });
      }
      // ---- permits granted on the office's applications, no builder commissioned ----
      const permits: OpenItem[] = [];
      for (const d of book.open("permit_decision")) {
        if (acted.has(d.id) || !addressed(d, me) || d.data?.decision !== "granted") continue;
        const app = book.records.get(String(d.data?.application));
        if (app?.record !== "statement" || !ours(app)) continue;
        permits.push({ id: d.id, since: d.at, line: `${d.id}: the permit to build ${app.data?.structure_type} on ${app.data?.lot} (our application ${app.id}) was granted ${dateWords(d.at)}; no builder has been commissioned` });
      }
      // ---- the budget ----
      const year = Math.floor(t / YEAR) + 1;
      const decided = new Set(book.open("ballot_result").map((r) => String(r.data?.ballot)));
      const ballotOf = new Map<string, StatementRecord>();
      for (const b of book.open("ballot")) if (typeof b.data?.proposal === "string") ballotOf.set(b.data.proposal, b);
      const tabled: OpenItem[] = [];
      for (const r of book.open("proposal")) {
        if (!ours(r) || r.data?.enact?.kind !== "budget") continue;
        const b = ballotOf.get(r.id);
        if (b && decided.has(b.id)) continue;
        const y = r.data?.enact?.data?.year;
        tabled.push({ id: r.id, since: r.at, line: `${r.id}: the budget for year ${y} tabled ${dateWords(r.at)}; ${b ? (b.data?.closed === true || t >= (b.data?.closes_at ?? Infinity) ? `its ballot ${b.id} has closed and no result is on file` : `its ballot ${b.id} is open until ${dateWords(b.data.closes_at)}`) : "no ballot has been opened"}` });
      }
      const missing: OpenItem[] = [];
      if (!budgetFor(book, year)) missing.push({ id: `budget-year-${year}`, since: (year - 1) * YEAR, line: `no budget is adopted for year ${year} (${yearInDays(year)})` });
      else if (p.budget_lead_days > 0 && year * YEAR - t <= p.budget_lead_days * DAY && !budgetFor(book, year + 1)) missing.push({ id: `budget-year-${year + 1}`, since: year * YEAR, line: `no budget is adopted yet for year ${year + 1} (${yearInDays(year + 1)}), which begins ${dateWords(year * YEAR)}` });
      // ---- complaints about the town's services, open: a count by kind, and the oldest few ----
      const kinds = new Map<string, { n: number; oldest: number }>();
      const open: StatementRecord[] = [];
      for (const c of book.open("complaint")) {
        if (!addressed(c, me) || acted.has(c.id)) continue;
        open.push(c);
        const k = String(c.data?.about ?? "the town's services");
        const was = kinds.get(k);
        kinds.set(k, { n: (was?.n ?? 0) + 1, oldest: Math.min(was?.oldest ?? Infinity, c.at) });
      }
      const byKind = [...kinds].map(([k, v]): OpenItem => ({ id: `kind:${k}`, since: v.oldest, line: `${v.n} open complaint${v.n === 1 ? "" : "s"} about ${k.replace(/_/g, " ")}, the oldest of ${dateWords(v.oldest)}` }));
      const oldest = open.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(0, 3).map((c): OpenItem => ({ id: c.id, since: c.at, line: `${c.id}: ${c.speaks_for ?? c.author} complained ${dateWords(c.at)} about ${String(c.data?.about ?? "the town's services").replace(/_/g, " ")}${c.data?.structure ? ` at ${c.data.structure}` : ""}${c.data?.days !== undefined ? `, saying it had gone about ${c.data.days} days` : ""}` }));
      // ---- debts claimed against the town ----
      const debts = (book.ofType("claim") as any[]).filter((r) => r.record === "claim" && r.position === "right" && r.counterparty === me && !money.settled.has(r.id) && !book.released.has(r.id))
        .map((r): OpenItem => ({ id: r.id, since: r.at, ...(r.about?.amount !== undefined ? { amount: cents(r.about.amount) } : {}),
          line: `${r.id}: ${r.holder} claims ${r.about?.amount !== undefined ? usd(cents(r.about.amount)) : "a debt"} from the town (${String(r.about?.kind ?? "a debt").replace(/_/g, " ")}${r.about?.for ? `: ${r.about.for}` : ""}), recorded ${dateWords(r.at)}, not settled` }));
      return [
        ...heading("Petitions at or over the town's threshold, not put to the council or answered", over),
        ...heading("Petitions addressed to the mayor, short of the town's threshold", below),
        ...heading("Invoices for work the mayor's office commissioned, awaiting its written approval", invoices),
        ...heading("Permits granted on the office's applications, no builder commissioned", permits),
        ...heading("Budgets put to the council with no result yet", tabled),
        ...heading("Years with no budget adopted", missing),
        ...heading("Complaints about the town's services, still open, by kind", byKind),
        ...heading("The oldest of the open complaints", oldest),
        ...heading("Debts claimed against the town, not settled", debts),
      ];
    },
  };
}

// ------------------------------------------------------------------ the works and environment offices (staffing)

const FORMS: { [form: string]: string } = { works_staffing: "the works office's staffing form", works_collection: "the works office's collection form", environment_staffing: "the environment office's staffing form" };

/**
 * An office that employs staff and leaves their pay to the finance office (city.works, city.environment), as its
 * office-holder keeps it: applications for its advertised posts not answered; starters and leavers the finance office
 * has not been told of; and the directions on its forms that stand.
 */
function employerBooks(ctx: ParticipantContext, o: { role: string; own: "role" | "role_or_unnamed"; forms: string[] }): OfficeBooks {
  const me = ctx.entity;
  const p = { role: o.role, period: 14 * DAY, notice_days: 14, workplace: "", industry: "", payroll_office: "", directed_under: "", direction_compliance_bps: 10_000, ...(ctx.params ?? {}) } as any;
  const book = new Book();
  const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), does: { hire: true, pay: false }, own: o.own, ...(p.payroll_office ? { payroll: p.payroll_office } : {}) });
  const directions = new Directions(ctx, { under: p.directed_under, compliance_bps: p.direction_compliance_bps, office_words: "the office" });
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) {
      // ---- applications for an advertised post, not answered ----
      const posts = new Map(staffing.postings(book).map((j) => [j.id, j]));
      const offeredOn = new Set<string>();
      const contracts = contractsOf(staffing, book);
      for (const a of contracts) for (const b of basesOf(a)) offeredOn.add(b);
      const applications: OpenItem[] = [];
      if (posts.size) for (const a of book.open("job_application")) {
        const post = posts.get(String(a.data?.posting));
        if (!post || !addressed(a, me) || offeredOn.has(a.id)) continue;
        applications.push({ id: a.id, since: a.at, line: `${a.id}: ${a.speaks_for ?? a.author} applied ${dateWords(a.at)} for the post advertised in ${post.id}${post.data?.role ? ` (${post.data.role})` : ""}; no offer has been made${book.onHold(post.id, [me]) ? "; the advertisement is on hold" : ""}` });
      }
      // ---- starters and leavers the finance office has not been told of ----
      const starters: OpenItem[] = [], leavers: OpenItem[] = [];
      if (p.payroll_office) {
        const notices = book.open("payroll_notice").filter((n) => n.speaks_for === me);
        const sent = (what: string) => new Set(notices.filter((n) => n.data?.notice === what).map((n) => String(n.data?.agreement)));
        const starterSent = sent("starter"), leaverSent = sent("leaver");
        for (const a of staffing.staff(book, t)) {
          const signed = book.signedAt(a.id);
          // (Those the organisation started with were on its payroll before the year began.)
          if (a.author === "genesis" || signed === undefined || starterSent.has(a.id) || !staffing.payee(book, a)) continue;
          const worker = a.terms.parties[1] as string, pays = jobTerms(a, worker);
          starters.push({ id: a.id, since: signed, amount: pays.wage, line: `${a.id}: ${worker} signed ${dateWords(signed)} for ${usd(pays.wage)} every ${durationWords(pays.period)}; the ${p.payroll_office} office has had no payroll notice of the new starter from us` });
        }
        const deaths = dead(book);
        for (const a of contracts) {
          if (!book.concluded(a.id) || leaverSent.has(a.id)) continue;
          const worker = a.terms.parties[1] as string;
          const died = deaths.has(worker) && book.inForce(a.id);
          const end = died ? deaths.get(worker)! : book.endsAt(a.id);
          if (end === undefined) continue;
          leavers.push({ id: a.id, since: end, line: `${a.id}: ${worker}, who worked for us, ${died ? `died (registered ${dateWords(end)})` : `leaves on ${dateWords(end)}`}; the ${p.payroll_office} office has had no payroll notice of the leaver from us` });
        }
      }
      // ---- directions that stand ----
      const directed: OpenItem[] = [];
      for (const form of o.forms) {
        const d = directions.standing(book, form);
        if (!d) continue;
        const says = form.endsWith("_staffing") ? (() => { const s = staffingUnder(d); return !s.recruit ? "to recruit nobody, to take down its advertisements and to offer nobody employment" : s.posts ? `to recruit up to ${s.posts} post${s.posts === 1 ? "" : "s"}, or fewer where the budget pays for fewer` : "to recruit up to what its budget pays for"; })()
          : Number.isSafeInteger(d.data?.every) ? `to collect from each address every ${durationWords(d.data!.every as number)}` : "as it is written";
        directed.push({ id: d.id, since: d.at, line: `${d.id}: ${d.in_position ?? d.author} directed the office on ${FORMS[form] ?? form}, ${dateWords(d.at)}: ${says}; it stands until replaced or withdrawn` });
      }
      return [
        ...heading("Applications for an advertised post, not answered", applications),
        ...heading("New starters the finance office has not been told of", starters),
        ...heading("Staff who have left or died, the finance office not told", leavers),
        ...heading("Directions on the office's forms that stand", directed),
      ];
    },
  };
}

/** city.works, the office-holder's side (the round, the upkeep and the complaints are its staff's). */
export const worksBooks = (ctx: ParticipantContext): OfficeBooks => employerBooks(ctx, { role: "works crew", own: "role_or_unnamed", forms: ["works_staffing", "works_collection"] });

/** city.environment (the survey round is not read: nothing on file says where it stands). */
export const environmentBooks = (ctx: ParticipantContext): OfficeBooks => employerBooks(ctx, { role: "environmental scientist", own: "role", forms: ["environment_staffing"] });

// ------------------------------------------------------------------ the planning office

/** city.planning_officer: permit applications addressed to the town with no decision of ours yet. */
export function planningBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open() {
      const decided = new Set<string>();
      for (const d of book.all("permit_decision")) {
        if (d.speaks_for !== me) continue;
        if (typeof d.data?.application === "string") decided.add(d.data.application);
        for (const b of basesOf(d)) decided.add(b);
      }
      const items = book.open("permit_application").filter((a) => addressed(a, me) && !decided.has(a.id)).map((a): OpenItem => ({ id: a.id, since: madeAt(a),
        line: `${a.id}: ${a.speaks_for ?? a.author} applied ${whenWords(madeAt(a))} for a permit to build ${a.data?.structure_type ?? "(the kind of building is not said)"} on ${a.data?.lot ?? "(no lot is named)"}; no decision has been made` }));
      return heading("Permit applications, not decided", items);
    },
  };
}

// ------------------------------------------------------------------ the council clerk

/** city.council_clerk, the office-holder's side: proposals with no ballot opened, and ballots closed with no result declared. */
export function clerkBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  return {
    absorb(obs) { book.absorb(obs); },
    open(t) {
      const ballots = book.open("ballot").filter((b) => b.speaks_for === me);
      const balloted = new Set(ballots.map((b) => String(b.data?.proposal)));
      const results = new Set(book.open("ballot_result").filter((r) => r.speaks_for === me).map((r) => String(r.data?.ballot)));
      const proposals = book.open("proposal").filter((r) => addressed(r, me) && !balloted.has(r.id)).map((r): OpenItem => ({ id: r.id, since: r.at,
        line: `${r.id}: ${r.speaks_for ?? r.author} put a proposal to the council on ${dateWords(r.at)} (${String(r.text ?? "").slice(0, 120)}); no ballot has been opened` }));
      const closed = ballots.filter((b) => b.data?.electorate === "council" && (b.data?.closed === true || t >= (b.data?.closes_at ?? Infinity)) && !results.has(b.id))
        .map((b): OpenItem => ({ id: b.id, since: Number.isFinite(b.data?.closes_at) ? b.data.closes_at : b.at, line: `${b.id}: the ballot on ${b.data?.proposal} ${Number.isFinite(b.data?.closes_at) ? `closed ${dateWords(b.data.closes_at)}` : "has closed"}; no result has been declared` }));
      return [...heading("Proposals to the council with no ballot opened", proposals), ...heading("Ballots closed with no result declared", closed).map((h) => ({ ...h, always: true as const }))];
    },
  };
}
