// What stands open at each office, as its clerk reads it from the office's own papers and accounts
// (docs/behaviour/office-books.md). One reader an office module (`books`), each a plain restatement of what that
// module's code works out for itself wake after wake, from the same papers, read the same way: who is behind with the
// rent, what waits for an answer, what is unpaid. Nothing here decides or does anything, and nothing is read that the
// office's code is not shown.

import { basesOf, channels, cites, type Observation, type StatementRecord } from "../contracts";
import { dateWords } from "../forms";
import type { OfficeBooks, OpenHeading, OpenItem, ParticipantContext } from "../module";
import { cents } from "../money";
import { billSettled, Book, broughtForward, noticesOf, DAY, leaseTerms, madeAt, MONTH, ownAccount, usd, whenWords } from "./common";
import { PAPER } from "./frictions";

const addressed = (r: StatementRecord, me: string) => (r.addressed_to ?? []).includes(me);
const oldestFirst = (a: OpenItem, b: OpenItem) => (a.since ?? 0) - (b.since ?? 0) || (a.id < b.id ? -1 : 1);
const heading = (what: string, items: OpenItem[]): OpenHeading[] => (items.length ? [{ what, items: items.sort(oldestFirst) }] : []);

/**
 * When rent under a lease first falls due, counted from when the lease begins (`begins`): the day the lease itself
 * names (`attrs.first_due`, so long after it begins: a tenancy's own rent day), or the day it begins.
 */
export const firstDueOf = (a: any, begins: number): number => begins + (Number.isSafeInteger(a?.terms?.attrs?.first_due) && a.terms.attrs.first_due > 0 ? (a.terms.attrs.first_due as number) : 0);

/** What an organisation has seen leave and come into its own account: what settled which paper, and each receipt by payer. */
export class Money {
  readonly settled = new Set<string>();
  /** Each receipt by paying account, with what the payer said it was for where the bank's statement says (`memo`). */
  readonly received = new Map<string, { t: number; amount: number; memo?: string }[]>();
  account: string | undefined;
  balance = 0;
  absorb(obs: Observation): void {
    const acc = ownAccount(obs);
    if (!acc) return;
    this.account = acc.account;
    this.balance = acc.balance;
    for (const tx of channels.transactions(obs)) {
      if (tx.from === acc.account && tx.settles) this.settled.add(tx.settles);
      if (tx.to === acc.account && tx.from !== acc.account) this.received.set(tx.from, [...(this.received.get(tx.from) ?? []), { t: tx.t, amount: cents(tx.amount), ...(tx.memo ? { memo: tx.memo } : {}) }]);
    }
  }
}

/**
 * What any organisation that others may ask something of has open (docs/behaviour/frictions.md): a request to put
 * something right with no answer of ours; a venue's notice of a complaint against us with no answer of ours; a
 * decision against us to pay that we have not paid.
 */
export function askedOfUs(book: Book, me: string, money: Money, forms: { notice: string; response: string; decision: string }[] = []): OpenHeading[] {
  const answers = book.all(PAPER.answer).filter((r) => r.speaks_for === me);
  const requests = book.open(PAPER.request).filter((r) => addressed(r, me) && !answers.some((a) => cites(a, r.id) || a.data?.request === r.id))
    .map((r): OpenItem => ({ id: r.id, since: madeAt(r), ...(r.data?.amount !== undefined ? { amount: cents(r.data.amount) } : {}),
      line: `${r.id}: ${r.speaks_for} asks us to put right ${String(r.data?.matter ?? "something").replace(/_/g, " ")}${r.data?.structure ? ` at ${r.data.structure}` : ""}${r.data?.about ? ` (about ${r.data.about})` : ""}${r.data?.amount !== undefined ? `, ${usd(cents(r.data.amount))}` : ""}, asked ${whenWords(madeAt(r))}, not answered` }));
  const all = [{ notice: PAPER.notice, response: PAPER.response, decision: PAPER.decision }, ...forms];
  const notices: OpenItem[] = [], decisions: OpenItem[] = [];
  for (const f of all) {
    const ours = book.all(f.response).filter((r) => r.speaks_for === me);
    for (const n of book.open(f.notice)) {
      const d = n.data ?? {};
      if (!addressed(n, me) || d.against !== me || typeof d.application !== "string" || ours.some((r) => cites(r, d.application) || r.data?.application === d.application)) continue;
      if (book.all(f.decision).some((x) => x.data?.application === d.application || cites(x, d.application))) continue;
      const by = Number(d.answer_by ?? d.hearing_at);
      notices.push({ id: n.id, since: madeAt(n), line: `${n.id}: ${n.speaks_for} tells us of ${d.applicant ?? "someone"}'s complaint (${String(d.matter ?? "").replace(/_/g, " ")}, application ${d.application})${Number.isFinite(by) ? `, to be answered by ${dateWords(by)}` : ""}, not answered` });
    }
    for (const x of book.open(f.decision)) {
      const d = x.data ?? {};
      if (d.against !== me || d.finding !== "pay" || money.settled.has(x.id)) continue;
      decisions.push({ id: x.id, since: x.at, ...(d.amount !== undefined ? { amount: cents(d.amount) } : {}), line: `${x.id}: ${x.speaks_for} ${d.binding === false ? "recommends" : "orders"} that we pay ${d.applicant ?? "the applicant"} ${usd(cents(d.amount ?? 0))}${Number.isFinite(Number(d.due)) ? ` by ${dateWords(Number(d.due))}` : ""}, not paid` });
    }
  }
  return [...heading("Requests to put something right, not answered", requests), ...heading("Complaints against us before a body that hears them, not answered", notices), ...heading("Decisions against us to pay, not paid", decisions)];
}

/** Invoices addressed to us and sums recorded against us (a fine, rates) that we have not been seen to pay. */
export function owedByUs(book: Book, me: string, money: Money): OpenHeading[] {
  const invoices = book.open("invoice").filter((r) => addressed(r, me) && r.data?.outcome?.money && !money.settled.has(r.id))
    .map((r): OpenItem => ({ id: r.id, since: madeAt(r), amount: cents(r.data!.outcome.money.amount), line: `${r.id}: invoice from ${r.speaks_for ?? r.author} for ${usd(cents(r.data!.outcome.money.amount))}, dated ${whenWords(madeAt(r))}, not paid` }));
  const sums = book.ofType("claim").filter((r: any) => r.record === "claim" && r.position === "right" && r.counterparty === me && ["fine", "tax_penalty", "rates", "rates_interest"].includes(r.about?.kind) && !billSettled(book, r, money.settled) && !book.released.has(r.id))
    .map((r: any): OpenItem => ({ id: r.id, since: r.at, amount: cents(r.about.amount), line: `${r.id}: ${String(r.about.kind).replace(/_/g, " ")} of ${usd(cents(r.about.amount))} recorded against us by ${r.holder}${Number.isFinite(Number(r.about?.due)) ? `, due ${dateWords(Number(r.about.due))}` : ""}, not paid${noticesOf(book, r).length ? ` (one bill: the city's notice for it is ${noticesOf(book, r).map((n: any) => n.id).join(", ")}, and paying either settles it)` : ""}` }));
  return [...heading("Invoices addressed to us, not paid", invoices), ...heading("Sums recorded against us (rates, fines), not paid", sums)];
}

/**
 * A landlord's letting office (firm.landlord): the rent book (what has fallen due under each lease in force against
 * what has come in from the tenant's account since its rent began), tenancies near their end with nothing offered,
 * homes listed and unlet, applications and tenants' requests not answered, repairs ordered and not done, and what
 * the landlord itself owes.
 */
export function landlordBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const p = ctx.params ?? {};
  const noticeDays = Number(p.landlord_notice_days ?? 60);
  const book = new Book();
  const money = new Money();
  return {
    absorb(obs) { book.absorb(obs); money.absorb(obs); },
    open(t) {
      const leases = (book.ofType("agreement") as any[]).filter((r) => r.record === "agreement" && r.terms.template === "lease" && r.terms.parties[0] === me);
      const active = leases.filter((a) => book.inForce(a.id));
      const tenantOf = (a: any): string => a.terms.parties.find((x: string) => x !== me);
      const increases = book.open("rent_increase").filter((r) => r.speaks_for === me);
      const rentAt = (a: any, at: number) => increases.filter((r) => r.data?.lease === a.id && Number(r.data?.from) <= at).sort((x, y) => Number(y.data!.from) - Number(x.data!.from))[0]?.data?.rent ?? leaseTerms(a, tenantOf(a)).rent;
      const payingAccount = new Map<string, string>();
      for (const r of book.all("rental_application")) if (r.speaks_for && !payingAccount.has(r.speaks_for)) payingAccount.set(r.speaks_for, r.data?.account);
      for (const a of leases) {
        const tenant = tenantOf(a);
        const from = a.terms.commitments?.find((c: any) => c.who === tenant)?.does?.outcome?.money?.from;
        if (tenant && from && !payingAccount.get(tenant)) payingAccount.set(tenant, from);
      }
      const noticed = (a: any) => (book.notices.get(a.id) ?? []).length > 0;
      // ---- the rent book ----
      const arrears: OpenItem[] = [];
      const asked = new Map<string, number>(); // a lease -> when we last wrote to ask for the rent owed under it
      for (const r of book.all(PAPER.request)) if (r.speaks_for === me && r.data?.matter === "arrears" && typeof r.data?.about === "string") asked.set(r.data.about, r.at);
      // ---- tenancies being ended for arrears under the law on possession (docs/behaviour/justice.md, "Possession"):
      // where each has got to, by the papers on file, and what the law's procedure has next. ----
      const law = book.open("law").filter((r) => r.data?.tenancy === "possession").sort((x, y) => y.at - x.at)[0];
      const ending: OpenItem[] = [];
      const behindUnder = new Map<string, number>();
      // (A tenant given notice to vacate who has gone gives notice on the lease as they go: the home is given up from
      // that day, whatever the lease's own notice period then says of when it ends on the record. The rent book
      // stops there: what was owed on the day they left is what is owed. Until 2026-10-12 the book went on counting a
      // rent a month against someone who had left, and nothing in it said they had: docs/decisions.md, "What the
      // fourth living pilot found".)
      const vacated = new Map<string, number>();
      for (const a of leases) {
        const went = (book.notices.get(a.id) ?? []).filter((n) => n.as === tenantOf(a)).sort((x, y) => x.at - y.at)[0];
        if (went && book.all("notice_to_vacate").some((r) => r.speaks_for === me && r.data?.lease === a.id && r.at <= went.at)) vacated.set(a.id, went.at);
      }
      const gone: OpenItem[] = [];
      for (const a of leases.filter((x) => book.inForce(x.id) || vacated.has(x.id))) {
        const tenant = tenantOf(a);
        // (A lease that renews one of ours: its rent runs from the end of that one's term.)
        const begins = Math.max(book.signedAt(a.id) ?? a.at, 0, ...basesOf(a).filter((b) => leases.some((x) => x.id === b)).map((b) => book.endsAt(b) ?? 0));
        const since = firstDueOf(a, begins);
        // (Rent owed when the year began, by our statement of the rent account: owed with the rest, and the oldest.)
        const carried = broughtForward(book, me, a.id);
        if (t < since && !carried) continue;
        const leftAt = vacated.get(a.id);
        const due = t < since ? 0 : Math.floor((Math.min(t, leftAt ?? t) - since) / MONTH) + 1;
        let owed = carried?.owed ?? 0;
        for (let k = 0; k < due; k++) owed += cents(rentAt(a, since + k * MONTH));
        const account = payingAccount.get(tenant);
        const receipts = ((account && money.received.get(account)) || []).filter((x) => x.t >= begins);
        const paid = receipts.reduce((n, x) => n + x.amount, 0);
        const last = receipts.at(-1);
        const rent = cents(rentAt(a, t));
        const behind = owed - paid;
        if (leftAt !== undefined) {
          const applied = book.open("tribunal_application").filter((r) => r.speaks_for === me && r.data?.kind === "possession" && r.data?.about === a.id).sort((x, y) => y.at - x.at)[0];
          const decided = applied && book.all("tribunal_order").some((o) => o.data?.application === applied.id);
          const ends = book.endsAt(a.id);
          // (It stands in the book while the lease is still on the record, or an application about it is undecided.)
          if (!book.inForce(a.id) && !(applied && !decided)) continue;
          gone.push({ id: a.id, since: leftAt, ...(behind > 0 ? { amount: behind } : {}),
            line: `${a.id}: ${tenant} gave notice on the lease ${dateWords(leftAt)}, after our notice to vacate, and has given up ${leaseTerms(a, tenant).space ?? "the home"}: the tenancy is over${ends !== undefined && ends > t ? ` (on the record the lease runs out ${dateWords(ends)})` : ""}; ${behind > 0 ? `${usd(behind)} of rent was owed under it when they left, and is still owed` : "no rent is owed under it"}${applied && !decided ? `; our application for possession ${applied.id} (${dateWords(applied.at)}) still stands at the tribunal, undecided${law ? `: ${law.id} gives possession only where the tenant has not left` : ""}` : ""}` });
          continue;
        }
        if (rent <= 0 || behind < rent) continue;
        // (The day the oldest rent not yet paid fell due; a rent less than a week late is not yet in the book as arrears.)
        const rents = Math.floor(behind / rent);
        // (What was owed as the year began is the oldest, while any of it stands.)
        const oldest = carried && paid < carried.owed ? carried.since + Math.floor(paid / rent) * MONTH : since + (due - rents) * MONTH;
        if (t - oldest < 7 * DAY) continue;
        behindUnder.set(a.id, behind);
        arrears.push({ id: a.id, since: oldest, amount: behind, line: `${a.id}: ${tenant}${leaseTerms(a, tenant).space ? `, ${leaseTerms(a, tenant).space}` : ""}, is ${usd(behind)} behind with the rent (${rents} rent${rents === 1 ? "" : "s"} of ${usd(rent)}), since ${whenWords(oldest)}${carried && paid < carried.owed ? ` (${usd(carried.owed)} of it stood on the rent account as the year began: ${carried.id})` : ""}; ${last ? `the last payment from ${account} came ${dateWords(last.t)} (${usd(last.amount)}${last.memo ? `, "${last.memo}"` : ""})` : "nothing has come from the tenant's account under this lease"}${asked.has(a.id) ? `; we wrote to ask for it ${dateWords(asked.get(a.id)!)}` : ""}${noticed(a) ? "; notice has been given on the lease" : ""}` });
      }
      if (law) for (const a of leases) {
        const tenant = tenantOf(a);
        if (book.all("warrant_executed").some((w) => w.data?.lease === a.id)) continue; // (carried out: over)
        const left = (book.notices.get(a.id) ?? []).some((n) => n.as === tenant);
        const vacate = book.open("notice_to_vacate").filter((r) => r.speaks_for === me && r.data?.lease === a.id).sort((x, y) => y.at - x.at)[0];
        // (An application we have withdrawn is no longer before the tribunal: it is not shown as waiting.)
        const applied = book.all("tribunal_application").filter((r) => r.speaks_for === me && r.data?.kind === "possession" && r.data?.about === a.id && !book.withdrawn.has(r.id)).sort((x, y) => y.at - x.at)[0];
        const order = book.all("tribunal_order").filter((o) => o.data?.kind === "possession" && o.data?.applicant === me && o.data?.about === a.id).sort((x, y) => y.at - x.at)[0];
        if ((!vacate && !applied && !order) || left || !book.inForce(a.id) && !order) continue;
        const now = behindUnder.get(a.id);
        const owes = now !== undefined ? `${tenant} is ${usd(now)} behind now` : `${tenant} is less than a rent behind now`;
        const home = leaseTerms(a, tenant).space ?? "the home";
        let stage: string, since: number;
        const decided = order && (!applied || order.at >= applied.at) ? order : undefined;
        if (decided?.data?.finding === "possession") {
          const due = Number(decided.data.due);
          const asked = book.all("warrant_request").filter((r) => r.speaks_for === me && r.data?.order === decided.id).sort((x, y) => y.at - x.at)[0];
          const warrant = book.all("warrant").filter((w) => w.data?.order === decided.id).sort((x, y) => y.at - x.at)[0];
          const lapsed = warrant && book.all("warrant_lapsed").some((w) => w.data?.lease === a.id && w.at >= warrant.at);
          since = decided.at;
          stage = `the tribunal ordered possession of ${home} by ${dateWords(due)} (${decided.id})` + (lapsed ? `; the warrant ${warrant!.id} ran out without being carried out; by ${law.id} another may be asked of the tribunal's registrar`
            : warrant ? `; a warrant is out (${warrant.id}), to be carried out by ${dateWords(Number(warrant.data?.until))} by those who enforce the tribunal's orders, and by nobody else`
            : asked ? `; a warrant was asked of the tribunal's registrar ${dateWords(asked.at)} (${asked.id}) and has not been issued`
            : t >= due + DAY ? `; that date has passed and the tenant has not left; by ${law.id} a warrant may be asked of the tribunal's registrar, and nobody else may put them out`
            : `; if the tenant is still there a day after that date, a warrant may be asked of the tribunal's registrar`);
        } else if (decided?.data?.finding === "plan") {
          since = decided.at;
          stage = `the tribunal set a plan to pay ${dateWords(decided.at)} (${decided.id}): the rent as it falls due and ${usd(cents(decided.data.instalment ?? 0))} a month toward what is owed; if it is not kept, the landlord may apply again for possession`;
        } else if (decided) continue; // (dismissed: it begins again only if they fall behind)
        else if (applied) {
          // What has changed since the application, as this office's own papers and rent book show it: what is
          // owed now beside what the application said; what the tenant has answered the tribunal, and whether we
          // have replied; terms we have come to with the tenant since. And what is ordinarily done where the
          // arrears are cleared: said as the practice it is, never as what to do. (The fifth living pilot's seat
          // kept an application before the tribunal after the tenant had paid in full, and another after granting
          // a stay: nothing in its books set the application beside either.)
          since = applied.at;
          const said = applied.data?.amount !== undefined ? cents(applied.data.amount) : undefined;
          const changed: string[] = [];
          if (now === undefined) changed.push(`${said !== undefined ? `the application said ${usd(said)} was owed; ` : ""}the rent book shows less than a rent owed now`);
          else if (said !== undefined && now !== said) changed.push(`the application said ${usd(said)} was owed; the rent book shows ${usd(now)} now`);
          const answer = book.all("tribunal_response").filter((r) => r.speaks_for === tenant && String(r.data?.application ?? "") === applied.id).sort((x, y) => y.at - x.at)[0];
          if (answer) {
            const replied = book.all("tribunal_reply").some((r) => r.speaks_for === me && String(r.data?.application ?? "") === applied.id && r.at >= answer.at);
            changed.push(`${tenant} answered the tribunal ${dateWords(answer.at)} (${answer.id})${answer.data?.left ? ", saying they have left" : answer.data?.offer !== undefined ? (cents(answer.data.offer) > 0 ? `, offering ${usd(cents(answer.data.offer))} a month toward what is owed` : ", saying they can pay nothing toward what is owed") : ""}; ${replied ? "we have replied" : "we have not replied (reply to a tenant's answer form)"}`);
          }
          const terms = [...book.all("plan_answer").filter((r) => r.speaks_for === tenant && r.data?.lease === a.id && r.data?.accepts === true && r.at >= applied.at).map((r) => `${tenant} accepted our offer of a plan ${dateWords(r.at)} (${r.id})`),
            ...book.all("variation_answer").filter((r) => r.speaks_for === me && addressed(r, tenant) && r.data?.granted === true && r.at >= applied.at).map((r) => `we granted ${tenant}'s request ${dateWords(r.at)} (${r.id})`)];
          if (terms.length) changed.push(`since the application ${terms.join(", and ")}`);
          stage = `we applied to the tribunal for possession ${applied.data?.brought_forward ? "before the year began" : dateWords(applied.at)} (${applied.id}); it has not decided${changed.length ? `. Since the application: ${changed.join("; ")}` : ""}${now === undefined || terms.length ? ". An application stands until it is decided or withdrawn; where the rent owed has been paid or terms agreed, landlords ordinarily withdraw it" : ""}`;
        }
        else {
          const by = Number(vacate!.data?.by);
          since = vacate!.at;
          stage = `notice to vacate given ${whenWords(Number(vacate!.data?.given ?? vacate!.at))} (${vacate!.id}), to leave by ${whenWords(by)}; ${now === undefined ? `the arrears are paid, so by ${law.id} the notice lapses` : t >= by ? `that date has passed and the tenant has not left; by ${law.id} the landlord may now apply to the tribunal for possession, and may not put them out` : `paid before then it lapses; still there and behind after it, the landlord may apply to the tribunal for possession`}`;
        }
        ending.push({ id: a.id, since, ...(now !== undefined ? { amount: now } : {}), line: `${a.id}: ${home}; ${owes}; ${stage}` });
      }
      // ---- tenancies near their end ----
      const closing: OpenItem[] = [];
      for (const a of active) {
        const ends = book.endsAt(a.id);
        if (a.terms.then === "periodic" || ends === undefined || ends - t > noticeDays * DAY || noticed(a)) continue;
        if (leases.some((x) => x.id !== a.id && cites(x, a.id) && tenantOf(x) === tenantOf(a))) continue;
        closing.push({ id: a.id, since: ends, line: `${a.id}: the tenancy of ${tenantOf(a)}${leaseTerms(a, tenantOf(a)).space ? ` at ${leaseTerms(a, tenantOf(a)).space}` : ""} ends ${dateWords(ends)}; no new lease has been offered and no notice given` });
      }
      // ---- homes to let ----
      const listings = book.open("rental_listing").filter((l) => l.speaks_for === me);
      const offeredOn = (id: string) => leases.some((x) => cites(x, id));
      const unlet = listings.filter((l) => t - l.at >= MONTH).map((l): OpenItem => ({ id: l.id, since: l.at, line: `${l.id}: ${l.data?.space} has been listed at ${usd(cents(l.data?.rent ?? 0))} a month since ${dateWords(l.at)} and is not let` }));
      const applications = book.open("rental_application").filter((r) => addressed(r, me) && !offeredOn(r.id) && listings.some((l) => l.id === r.data?.listing))
        .map((r): OpenItem => ({ id: r.id, since: r.at, line: `${r.id}: ${r.speaks_for} applied ${dateWords(r.at)} for ${listings.find((l) => l.id === r.data?.listing)?.data?.space ?? r.data?.listing}${r.data?.household?.people ? ` (a household of ${r.data.household.people})` : ""}; no lease offered` }));
      // ---- asked of us by tenants ----
      const varied = book.all("variation_answer").filter((r) => r.speaks_for === me);
      const variations = book.open("variation_request").filter((r) => addressed(r, me) && !varied.some((a) => cites(a, r.id)))
        .map((r): OpenItem => ({ id: r.id, since: r.at, line: `${r.id}: ${r.speaks_for} asks, ${dateWords(r.at)}: "${String(r.text ?? "").slice(0, 120)}"${r.data?.about ? ` (about ${r.data.about})` : ""}; not answered` }));
      // ---- repairs ----
      const repairs = book.open("repair_order").filter((r) => r.speaks_for === me && ![...book.all("repair_done"), ...book.all("repair_declined")].some((d) => d.data?.structure === r.data?.structure && d.at >= r.at))
        .map((r): OpenItem => ({ id: r.id, since: r.at, line: `${r.id}: the repair of ${r.data?.structure} was ordered ${dateWords(r.at)} and is not reported done` }));
      // ---- a tenant's death registered, the lease still standing ----
      const dead = new Set([...book.all("death_registration"), ...book.all("death_certificate")].map((r) => String(r.data?.deceased)));
      const estates = active.filter((a) => dead.has(tenantOf(a)) && !noticed(a)).map((a): OpenItem => ({ id: a.id, since: a.at, line: `${a.id}: the tenant ${tenantOf(a)} is registered as having died; the lease still stands` }));
      return [
        ...heading("Rent in arrears", arrears),
        ...heading("Tenants who have left on our notice to vacate: tenancies over", gone),
        ...heading("Tenancies being ended for arrears under the law on possession, and where each has got to", ending),
        ...heading("Tenancies ending with nothing offered", closing),
        ...heading("Applications for a home, not answered", applications),
        ...heading("Tenants' requests to vary something, not answered", variations),
        ...askedOfUs(book, me, money, [{ notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }]),
        ...heading("Homes listed a month or more and not let", unlet),
        ...heading("Repairs ordered and not reported done", repairs),
        ...heading("Tenants who have died, their leases still standing", estates),
        ...owedByUs(book, me, money),
      ];
    },
  };
}

/**
 * The support office (world.transfers), for whoever holds it: what its staff have put before them and is not yet
 * decided, and what is asked of the office (a review of a refusal, a complaint before a body that hears them). The
 * claims the law's conditions settle, and their payment, are the staff's, and are in the staff's own report.
 */
export function supportBooks(ctx: ParticipantContext): OfficeBooks {
  const me = ctx.entity;
  const book = new Book();
  const money = new Money();
  return {
    absorb(obs) { book.absorb(obs); money.absorb(obs); },
    open() {
      const decided = new Set(book.all("benefit_decision").filter((r) => r.speaks_for === me).map((r) => String(r.data?.claim)));
      const cases = book.open("case_for_decision").filter((r) => r.speaks_for === me && typeof r.data?.claim === "string" && !decided.has(r.data.claim))
        .map((r): OpenItem => ({ id: r.data!.claim as string, since: r.at, ...(r.data?.amount !== undefined ? { amount: cents(r.data.amount) } : {}),
          line: `${r.data!.claim}: ${r.data?.claimant}'s claim for ${r.data?.payment} support, put before the office-holder ${dateWords(r.at)} (${r.id}): ${r.data?.fails}; not decided` }));
      // What a claim waits for (foundations F8): the papers and confirmations the office has asked for, not yet come, with the day each is due by.
      const came = new Set(["evidence", "confirmation_answer"].flatMap((k) => book.open(k)).filter((r) => (r.addressed_to ?? []).includes(me) && typeof r.data?.claim === "string").map((r) => `${r.data!.claim}|${r.data!.need}`));
      const waiting = ["evidence_request", "confirmation_request"].flatMap((k) => book.open(k)).filter((r) => r.speaks_for === me && typeof r.data?.claim === "string" && !decided.has(r.data.claim) && !came.has(`${r.data.claim}|${r.data.need}`))
        .sort((a, b) => Number(a.data?.by ?? 0) - Number(b.data?.by ?? 0) || (a.id < b.id ? -1 : 1))
        .map((r): OpenItem => ({ id: r.id, since: r.at, ...(Number.isFinite(Number(r.data?.by)) ? { due: Number(r.data!.by) } : {}),
          line: `${r.data!.claim}: ${r.kind === "evidence_request" ? "the claimant" : String(r.addressed_to?.[0] ?? "the last employer")} was asked ${dateWords(r.at)} for ${r.data?.what} (${r.id}), due by ${Number.isFinite(Number(r.data?.by)) ? dateWords(Number(r.data!.by)) : "no day given"}; not yet answered` }));
      return [...heading("Claims waiting for papers or a confirmation asked for, not yet come", waiting),
        ...heading("Claims the staff have put before the office-holder, not decided", cases),
        ...askedOfUs(book, me, money, [{ notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }])];
    },
  };
}
