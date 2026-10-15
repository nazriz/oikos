// bank.payment_system: a bank's automated payment system. Documented in
// docs/behaviour/bank-payment-system.md.
//
// It reads payment requests addressed to its bank (the standard encoding,
// docs/design/translator-and-resolver.md §9.1: one-off payments and standing
// orders), applies the bank's procedure (only the account holder may
// instruct; the money must be there), and moves money it holds in custody.
// It is content: a bank run by a different module (or an AI) can freeze
// accounts, ignore instructions, or pay the wrong people. Physics doesn't stop it.

import { cents, moneyNow } from "../money";
import type { Observation, Record, StatementRecord, Transaction } from "../contracts";
import { basesOf, channels } from "../contracts";
import { DAY, wait, type BehaviourModule, type ParticipantContext } from "../module";
import { refusalText } from "../llm/words";
import * as C from "../calls";
import { dateWords } from "../forms";
import { because, Book, callAction, firstDue, Letters, message, pay, PAYEE_DIED, PAYMENT_FAILED, type Step, usd, Asked, whoWrote, filedBefore } from "./common";

/** `memo`: what the payer said the payment is for, as the payee's statement narrates it (a bank statement's line). */
interface Payment { instruction: string; from: string; to: string; amount: number; due: number; settles?: string; memo?: string; line?: string }

/** Things kept by a time, the soonest first out (a binary heap; those of one time in no promised order). */
class Soonest {
  private readonly items: [number, string][] = [];

  first(): [number, string] | undefined {
    return this.items[0];
  }

  add(at: number, what: string): void {
    const items = this.items;
    let i = items.length;
    items.push([at, what]);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (items[up]![0] <= items[i]![0]) break;
      [items[up], items[i]] = [items[i]!, items[up]!];
      i = up;
    }
  }

  take(): [number, string] | undefined {
    const items = this.items;
    const top = items[0], last = items.pop();
    if (items.length && last) {
      items[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let least = i;
        if (l < items.length && items[l]![0] < items[least]![0]) least = l;
        if (r < items.length && items[r]![0] < items[least]![0]) least = r;
        if (least === i) break;
        [items[least], items[i]] = [items[i]!, items[least]!];
        i = least;
      }
    }
    return top;
  }
}

/**
 * What a bank writes, once, to whoever put a hold on standing instructions of theirs (docs/behaviour/
 * bank-payment-system.md, "A hold"): which it will not pay under and from which due date, that nothing missed is made
 * up, that what the payments were for is still owed, and how the hold is lifted. `taken`: each instruction with the
 * first due date the hold stops, in the bank's words.
 */
export const HOLD_NOTE = {
  taken: (hold: string, taken: string[]) => `Hold ${hold} is in place. Not paid while it stands: ${taken.join("; ")}. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw ${hold}; payments then go on from the next due date.`,
};

export const bankPaymentSystem: BehaviourModule = {
  name: "bank.payment_system",
  keeps: [
    { what: "request", why: "A bank keeps its own customers' instructions: every standing order and payment request it is asked to carry out is addressed to it." },
    { what: "accounts", why: "The ledger is the bank's own book: it keeps its customers' accounts, and pays from them as they instruct." },
  ],
  version: "0.17.0", // 0.17.0: each payment carries what its payer said it was for (the line on a statement: docs/behaviour/firms.md, "Wages owed"); 0.16.0: a withdrawal of a standing instruction, of a hold, or an instruction that replaces another, is acted on only from whoever may instruct on the paying account; anyone else is answered and the instruction stands. 0.15.0: its list of a customer's standing instructions says of each who gave it, when, and what it cites. 0.14.0: it keeps a ledger of what it has paid in and out of each account, and a letter is answered with a statement from it (until then, with the payments new at that look: nearly always none)
  doc: "docs/behaviour/bank-payment-system.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx: ParticipantContext) {
    const verifyAuthor = ctx.params.verify_author ?? true;
    // Where it looks up who wrote an instruction (its channel onto who's who: nobody is shown it; none: it knows of
    // writers only what it is shown).
    const who: string | undefined = ctx.params.who;
    const asked = new Asked();
    const reviewAll: boolean = ctx.params.review_all ?? false; // go through every standing order at every plan (the long way: for checking the short one)
    const maxBatch = Math.min(32, ctx.params.max_batch ?? 32);
    const done = new Set<string>(); // one-off instructions handled
    const settled = new Map<string, string[]>(); // death registration -> the heirs' accounts its estate goes to
    const p = { town: (ctx.params.town as string | undefined) ?? "", // an estate with no heirs goes to the town, if the world names one
      courts: (ctx.params.courts as string[] | undefined) ?? [] }; // whose garnishee orders it carries out (the world's tribunals and courts)
    const nextDue = new Map<string, number>(); // standing order -> next due time
    // Instructions, read once as they arrive: a one-off is dealt with then; a standing order is kept until it's withdrawn
    // (so a plan never rescans every instruction ever made).
    let cursor = 0;
    const standing = new Map<string, StatementRecord>();
    // A standing order is gone through again when it's next due, not at every plan: going through one that isn't due
    // does nothing unless what the bank's checks read has changed since (the accounts it keeps and whose they are, the
    // signatories it has been told of, whom it has learnt the writers are: `changed` below), and then every one is gone
    // through, as before.
    // `byDue` holds each order under its next due time (an entry is stale once that has moved on); `undated` the
    // orders with no due time yet (never got as far as being due: refused, or not their holder's), gone through at
    // every plan as they always were.
    const byDue = new Soonest();
    const undated = new Set<string>();
    // What has been withdrawn, as the bank acts on it (docs/behaviour/bank-payment-system.md, "Who may withdraw"): an
    // instruction or a hold, and when its withdrawal took effect. A withdrawal is a record anyone can make of any
    // paper; the bank acts on one only from whoever may instruct on the account the instruction pays from, as it does
    // for the instruction itself and for a hold. The others it answers, once.
    const ended = new Map<string, number>();
    let withdrawalCursor = 0;
    let unplaced: Extract<Record, { record: "withdrawal" }>[] = []; // withdrawals of a paper it has not been shown yet
    let withdrawalNotes: Step = [];
    // Holds (docs/behaviour/bank-payment-system.md, "A hold"): a customer's instruction not to pay under a standing
    // order while the hold stands. Read once as they arrive; each order's accepted holds, with the time from which
    // each counts (when it was given, plus the notice the bank asks for). A hold is lifted by withdrawing it.
    const holdNotice: number = Math.max(0, ctx.params.hold_notice ?? 86_400); // how long before a due date a hold must be given to stop that payment (seconds)
    const lettersList: number = Math.max(0, ctx.params.letter_lists ?? 40); // how many of a customer's standing instructions a letter lists
    // The bank's ledger (docs/behaviour/bank-payment-system.md, "A statement"). What it is shown of a payment it is
    // shown once, when the payment is made; a statement written later needs the bank to have kept it. For each account:
    // how many entries there have been and what they come to, in and out, and the latest of them (as many as a
    // statement lists). And for each customer written to, where the account's ledger stood at their last statement:
    // a statement runs from the one before it.
    const statementLists: number = Math.max(1, ctx.params.statement_lists ?? 40); // how many entries a statement lists, the latest, before giving the rest as a count within the totals
    interface Ledger { n: number; paidIn: number; paidOut: number; latest: Transaction[] }
    const ledgers = new Map<string, Ledger>();
    const statedTo = new Map<string, { n: number; paidIn: number; paidOut: number; t: number }>(); // "<writer> <account>" -> where the ledger stood at the last statement to them
    let ledgerFrom: number | undefined; // when the ledger begins: the bank's first look
    const enter = (account: string, x: Transaction, out: boolean) => {
      let l = ledgers.get(account);
      if (!l) ledgers.set(account, (l = { n: 0, paidIn: 0, paidOut: 0, latest: [] }));
      l.n++;
      if (out) l.paidOut += cents(x.amount);
      else l.paidIn += cents(x.amount);
      l.latest.push(x);
      if (l.latest.length > 2 * statementLists) l.latest.splice(0, l.latest.length - statementLists);
    };
    let holdCursor = 0;
    const holdsOn = new Map<string, { hold: string; from: number }[]>();
    let holdNotes: Step = [];
    let read: { accounts: string[]; holders: string[]; signatories?: unknown; directory?: unknown } | undefined;
    let queue: Payment[] = [];
    let queuedAt = -1;
    let inFlight: Payment[] = [];

    // The bank's own book of instructions, built up from what it has seen
    // (its channel can show only what's new; it doesn't reread the archive).
    const book = new Book();
    let refusals: Step = [];
    const opens: Step = []; // accounts to open, as asked
    /** The positions an account holder has told the bank may instruct payments from an account (latest standing list), if any. */
    const signatories = (holder: string, account: string): string[] | undefined => {
      const lists = book.open("signatories").filter((r) => r.speaks_for === holder && r.data?.account === account);
      return lists.length ? (lists.at(-1)!.data.positions as string[]) : undefined;
    };
    const plan = (obs: Observation) => {
      const me = obs.entity;
      const kept = channels.accounts(obs).filter((a) => a.custodian === me);
      // (The accounts it keeps, by id: made when first asked for. Balances are read where they're used.)
      let byId: Map<string, (typeof kept)[number]> | undefined;
      const custody = () => (byId ??= new Map(kept.map((a) => [a.account, a])));
      // Has what the checks read changed since the last plan?
      // (Who's who as far as it has been shown or has looked up: who wrote an order it could not place before may be
      // known now. Looked up, a writer is learnt before their instruction is first read, so nothing is gone through
      // again for it: the count below moves only where a directory is shown.)
      const signatoryLists = book.standingOf("signatories"), directory = who ? undefined : channels.directory(obs)?.positions;
      const changed = reviewAll || !read || read.signatories !== signatoryLists || read.directory !== directory || read.accounts.length !== kept.length || kept.some((a, i) => a.account !== read!.accounts[i] || a.holder !== read!.holders[i]);
      if (changed) read = { accounts: kept.map((a) => a.account), holders: kept.map((a) => a.holder), signatories: signatoryLists, directory };
      const all = book.all("request");
      const fresh = all.slice(cursor).filter((r) => (r.addressed_to ?? []).includes(me));
      cursor = all.length;
      for (const r of fresh) {
        if (Number.isInteger(r.data?.every) && r.data!.every > 0 && !Array.isArray(r.data?.payments) && !ended.has(r.id)) {
          standing.set(r.id, r);
          if (!nextDue.has(r.id)) undated.add(r.id);
        }
      }
      /** May whoever made this record instruct on this account: written for its holder, by one of the holder's own
       * seats, and where the holder has named signatories for the account, in one of those posts. */
      const mayInstruct = (r: { author: string; in_position?: string; speaks_for?: string }, acc: (typeof kept)[number] | undefined): boolean => {
        if (!acc || r.speaks_for !== acc.holder || (verifyAuthor && book.authorEntity(r as Record) !== acc.holder)) return false;
        const named = signatories(acc.holder, acc.account);
        return !named || r.author === "genesis" || named.includes(r.in_position ?? "");
      };
      /** Why not, in one sentence that tells the writer nothing they could not know: one of the account holder's own
       * people who is not a signatory is told that; anyone else, that there is nothing of theirs by that reference. */
      const whyNot = (r: { author: string; in_position?: string; speaks_for?: string }, acc: (typeof kept)[number] | undefined): string | undefined =>
        acc && r.speaks_for === acc.holder && (!verifyAuthor || book.authorEntity(r as Record) === acc.holder) ? `${r.in_position ?? r.author} is not an authorised signatory for ${acc.account}` : undefined;
      const payingAccount = (order: StatementRecord | undefined) => (order ? custody().get(order.data?.outcome?.money?.from ?? order.data?.from) : undefined);
      // Withdrawals that have arrived since the last plan, and instructions that say they replace another. Each is
      // acted on only from whoever may instruct on the account; the rest are answered, and what they named stands.
      const justEnded: string[] = [];
      const lifts: { w: (typeof unplaced)[number]; hold: StatementRecord; to: string[] }[] = [];
      const withdrawals = book.ofType("withdrawal");
      const toPlace = [...unplaced, ...withdrawals.slice(withdrawalCursor)];
      withdrawalCursor = withdrawals.length;
      unplaced = [];
      for (const w of toPlace) {
        const target = book.records.get(w.withdraws);
        if (!target) {
          if (unplaced.length < 256) unplaced.push(w); // (the paper it names has not reached us yet: looked at again next plan)
          continue;
        }
        if (target.record !== "statement" || !(target.addressed_to ?? []).includes(me) || ended.has(target.id)) continue;
        const to = [w.author === "genesis" ? w.speaks_for ?? me : w.in_position ?? w.author];
        if (target.kind === "request") {
          const acc = payingAccount(target);
          if (mayInstruct(w, acc)) {
            ended.set(target.id, w.at);
            justEnded.push(target.id);
          } else if (standing.has(target.id) || !done.has(target.id)) {
            const why = whyNot(w, acc);
            withdrawalNotes.push(message(to, why ? `Withdrawal ${w.id} is not acted on, and ${target.id} stands: ${why}.` : `Withdrawal ${w.id} does not apply to ${target.id}: we have no standing instruction of yours by that reference.`, w.id));
          }
        } else if (target.kind === "hold") lifts.push({ w, hold: target, to }); // (looked at once the holds that have arrived are read: below)
      }
      // (An instruction that names the one it replaces: the earlier one ends when the later was given, if whoever gave
      // the later may instruct on the account the earlier pays from. Otherwise the earlier stands; the later is
      // answered for itself, below, as any instruction is.)
      for (const r of fresh) {
        const old = typeof r.data?.replaces === "string" ? book.records.get(r.data.replaces) : undefined;
        if (old?.record !== "statement" || old.kind !== "request" || !(old.addressed_to ?? []).includes(me) || ended.has(old.id) || !mayInstruct(r, payingAccount(old))) continue;
        ended.set(old.id, r.at);
        justEnded.push(old.id);
      }
      // (A payment that fell due before its order was withdrawn is still made: the bank goes through its plans a day
      // apart, and an order replaced in the hours after its pay day, a wage at a new rate say, would lose that pay.)
      const lastCall = new Map<string, { order: StatementRecord; until: number }>();
      for (const id of justEnded) {
        const r = standing.get(id);
        if (!r) continue;
        const until = ended.get(id) ?? obs.t;
        const next = nextDue.get(id) ?? firstDue(r, r.data!.every as number);
        if (next <= until) lastCall.set(id, { order: r, until });
        standing.delete(id);
        undated.delete(id);
      }
      // Holds that have arrived since the last plan. One counts for a standing order the bank has from whoever may
      // instruct on the account it pays from (the same check as for any instruction); for anything else the writer
      // is told, in one sentence that says nothing of anyone else's instructions. Either way it is answered, once.
      const holds = book.all("hold");
      for (const h of holds.slice(holdCursor)) {
        if (!(h.addressed_to ?? []).includes(me) || !Array.isArray(h.data?.holds)) continue;
        const taken: string[] = [], not: string[] = [], unsigned: string[] = [];
        for (const id of [...new Set(h.data!.holds as unknown[])].filter((x): x is string => typeof x === "string").slice(0, 64)) {
          const order = standing.get(id);
          const acc = payingAccount(order);
          if (!order || !mayInstruct(h, acc)) {
            // (One of the account holder's own people who is not a signatory is told so; anyone else is told nothing
            // of whose the instruction is.)
            const why = order ? whyNot(h, acc) : undefined;
            if (why) unsigned.push(`Hold ${h.id} is not in place on ${id}: ${why}.`);
            else not.push(id);
            continue;
          }
          const from = h.at + holdNotice;
          holdsOn.set(id, [...(holdsOn.get(id) ?? []), { hold: h.id, from }]);
          // (The first payment it stops: the first due at or after the time it counts from.)
          const every = order.data!.every as number;
          const next = nextDue.get(id) ?? firstDue(order, every);
          const first = next >= from ? next : next + Math.ceil((from - next) / every) * every;
          taken.push(`${id}, from the payment due on day ${Math.floor(first / DAY) + 1}`);
        }
        if (!taken.length && !not.length && !unsigned.length) continue;
        holdNotes.push(message([h.author === "genesis" ? h.speaks_for ?? me : h.in_position ?? h.author], [
          ...(taken.length ? [HOLD_NOTE.taken(h.id, taken)] : []),
          ...unsigned,
          ...(not.length ? [`Hold ${h.id} does not apply to ${not.join(", ")}: we have no standing instruction of yours by that reference.`] : []),
        ].join(" "), h.id));
      }
      holdCursor = holds.length;
      // Holds withdrawn: a hold is lifted by whoever may instruct on the accounts its orders pay from, every one of
      // them. (The accounts as they were when the hold was taken: an order since ended is no longer looked at.)
      for (const { w, hold, to } of lifts) {
        const orders = [...holdsOn].filter(([, on]) => on.some((h) => h.hold === hold.id)).map(([order]) => order);
        if (!orders.length) continue; // (a hold we never took: nothing to lift)
        const accounts = orders.map((order) => payingAccount(standing.get(order) ?? (book.records.get(order) as StatementRecord | undefined)));
        if (accounts.every((acc) => mayInstruct(w, acc))) ended.set(hold.id, w.at);
        else {
          const why = whyNot(w, accounts.find((acc) => !mayInstruct(w, acc)));
          withdrawalNotes.push(message(to, why ? `Withdrawal ${w.id} is not acted on, and hold ${hold.id} stands: ${why}.` : `Withdrawal ${w.id} does not apply to ${hold.id}: we have no hold of yours by that reference.`, w.id));
        }
      }
      /** Whether a payment under an order, due at a time, is under a hold: one that counted by then and had not been lifted. */
      const held = (order: string, at: number): boolean => {
        const on = holdsOn.get(order);
        if (!on) return false;
        return on.some((h) => {
          const lifted = ended.get(h.hold);
          return h.from <= at && (lifted === undefined || lifted > at);
        });
      };
      // The instructions to go through: the new ones, and of the standing orders every one if what's checked has
      // changed, else those due by now and those with no due time.
      const look = new Map<string, StatementRecord>();
      const due: [number, string][] = [];
      if (changed) for (const [id, r] of standing) look.set(id, r);
      else {
        for (const id of undated) look.set(id, standing.get(id)!);
        for (let e = byDue.first(); e && e[0] <= obs.t; e = byDue.first()) {
          byDue.take();
          const r = standing.get(e[1]);
          if (!r || nextDue.get(e[1]) !== e[0] || look.has(e[1])) continue; // (withdrawn, or its due time has moved on)
          look.set(e[1], r);
          due.push(e);
        }
      }
      for (const r of fresh) look.set(r.id, r);
      for (const [id, x] of lastCall) look.set(id, x.order);
      const instructions = [...look.values()].sort(filedBefore);
      const out: Payment[] = [];
      // Deaths registered: the dead person's instructions are no longer carried out (law-succession).
      const deaths = book.all("death_registration");
      const dead = new Set(deaths.map((r) => r.data?.deceased as string));
      for (const ins of instructions) {
        if ((ended.has(ins.id) && !lastCall.has(ins.id)) || dead.has(ins.speaks_for ?? "")) continue;
        // Requests the bank can't carry out get a reply, once, as a real bank's would (§9.3).
        const cannot = (why: string) => {
          if (done.has(ins.id)) return;
          done.add(ins.id);
          refusals.push(message([ins.author === "genesis" ? ins.speaks_for ?? me : ins.in_position ?? ins.author], `Request ${ins.id} not carried out: ${why}`, ins.id));
        };
        // Opening an account: for whoever asks, in their own name (the bank's procedure; no checks beyond that yet).
        const opening = ins.data?.outcome?.account;
        if (opening && !opening.close) {
          if (done.has(ins.id)) continue;
          done.add(ins.id);
          if (opening.holder !== ins.speaks_for || book.authorEntity(ins) !== ins.speaks_for) cannot("an account can only be opened by the person or organisation it's for.");
          else opens.push(C.call("account", { holder: opening.holder, at: me }));
          continue;
        }
        // A bulk payment (a share registry's dividends, say): one instruction, from one account, to many, once.
        const bulk = Array.isArray(ins.data?.payments) ? (ins.data!.payments as { to?: unknown; amount?: unknown }[]) : null;
        const m = bulk ? { from: ins.data?.from, to: "(many)", amount: String(bulk.reduce((x, b) => x + (cents(b.amount as any) || 0), 0)) } : ins.data?.outcome?.money;
        if (!m) {
          cannot("this bank only makes payments and opens accounts.");
          continue;
        }
        if (bulk && bulk.some((b) => typeof b.to !== "string" || !Number.isInteger(cents(b.amount as any)) || cents(b.amount as any) <= 0)) {
          cannot("a payment in it doesn't say a valid amount and account to pay.");
          continue;
        }
        const d = { from: m.from, to: m.to, pay: cents(m.amount), settles: m.settles, every: bulk ? undefined : ins.data.every };
        // (What the payer said it is for goes with the money: the line on the payee's statement.)
        const said = (x: any) => ({ ...(typeof x?.for === "string" && x.for ? { memo: x.for.replace(/\.$/, "").slice(0, 120) } : {}), ...(typeof x?.line === "string" && x.line ? { line: x.line } : {}) });
        const acc = custody().get(d.from);
        if (acc && dead.has(acc.holder)) continue; // the account holder has died: it pays out only to settle the estate
        if (!acc) {
          cannot(`this bank doesn't keep account ${d.from}.`);
          continue;
        }
        if (!Number.isInteger(d.pay) || d.pay <= 0 || typeof d.to !== "string") {
          cannot("it doesn't say a valid amount and account to pay.");
          continue;
        }
        // The bank's procedure: only the account holder may instruct it (someone acting for it: the person
        // themselves, or one of its positions), and if the holder has named the positions that may sign for this
        // account, only those.
        const authorEntity = book.authorEntity(ins);
        if (ins.speaks_for !== acc.holder || (verifyAuthor && authorEntity !== acc.holder)) continue;
        const named = signatories(acc.holder, d.from);
        if (named && ins.author !== "genesis" && !named.includes(ins.in_position ?? "")) {
          cannot(`${ins.in_position ?? ins.author} is not an authorised signatory for ${d.from}.`);
          continue;
        }
        if (Number.isInteger(d.every) && d.every > 0) {
          // A standing order into the account of someone we've been told has died: the payer is told, once (how an
          // employer comes to know: docs/behaviour/deaths.md). It is still carried out, into the estate.
          const was = nextDue.get(ins.id);
          let due = was ?? firstDue(ins, d.every);
          // (Said when a payment under it next falls due, so that it is said at the same moment however often the
          // order is gone through.)
          const payee = due <= obs.t ? custody().get(d.to) : undefined;
          if (payee && dead.has(payee.holder) && !done.has(`died:${ins.id}`)) {
            done.add(`died:${ins.id}`);
            refusals.push(message([ins.author === "genesis" ? ins.speaks_for ?? me : ins.in_position ?? ins.author], PAYEE_DIED.note(payee.holder, d.to, ins.id), ins.id));
          }
          const until = Math.min(obs.t, lastCall.get(ins.id)?.until ?? obs.t);
          while (due <= until) {
            // (A due date under a hold is passed over: not paid then, and not made up when the hold is lifted.)
            if (!held(ins.id, due)) out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due, ...said(m) });
            due += d.every;
          }
          nextDue.set(ins.id, due);
          if (due !== was && standing.has(ins.id)) {
            undated.delete(ins.id);
            byDue.add(due, ins.id);
          }
        } else if (bulk && !done.has(ins.id)) {
          done.add(ins.id);
          for (const b of bulk) out.push({ instruction: ins.id, from: d.from, to: b.to as string, amount: cents(b.amount as any), due: ins.at, ...said(b) });
        } else if (!done.has(ins.id)) {
          done.add(ins.id);
          out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due: ins.at, ...(typeof d.settles === "string" ? { settles: d.settles } : {}), ...said(m) }); // the payer's reference, as given
        }
      }
      // (An order that was due and wasn't gone through to its payments, its holder dead or its author not the holder's:
      // still due, so gone through again at the next plan.)
      for (const e of due) if (standing.has(e[1]) && nextDue.get(e[1]) === e[0]) byDue.add(e[0], e[1]);
      // Settling an estate, as law-succession says: to the partner; else equally to the adult children; else the town.
      // The heirs are settled once; what comes into the estate later (a dividend, a refund) is passed on to them too,
      // as an estate's administrator does.
      const accountOf = (holder: string) => [...custody().values()].find((a) => a.holder === holder && !dead.has(holder))?.account;
      for (const r of deaths) {
        if (!settled.has(r.id)) {
          const heirs = [r.data?.partner].filter((x): x is string => !!x && !!accountOf(x));
          if (!heirs.length) heirs.push(...((r.data?.adult_children ?? []) as string[]).filter((x) => !!accountOf(x)));
          settled.set(r.id, heirs.length ? heirs.map((h) => accountOf(h)!) : [accountOf(p.town)].filter((x): x is string => !!x));
        }
        const to = settled.get(r.id)!;
        if (!to.length) continue;
        for (const acc of custody().values()) {
          if (acc.holder !== r.data?.deceased) continue;
          const balance = cents(acc.balance);
          if (balance <= 0) continue;
          const each = Math.floor(balance / to.length);
          to.forEach((account, i) => {
            const amount = i === 0 ? balance - each * (to.length - 1) : each;
            if (amount > 0) out.push({ instruction: r.id, from: acc.account, to: account, amount, due: obs.t });
          });
        }
      }
      // Garnishee orders (docs/behaviour/justice.md): a court's or tribunal's order to pay a debt from what we hold for the
      // debtor, carried out as the law requires: what the debtor's accounts here hold, up to the amount, to the creditor,
      // settling the debt. Once each.
      for (const g of book.open("garnishee_order").filter((r) => (r.addressed_to ?? []).includes(me) && !done.has(r.id) && p.courts.includes(r.speaks_for ?? ""))) {
        done.add(g.id);
        let left = cents(g.data?.amount ?? 0);
        const to = g.data?.to;
        if (typeof to !== "string" || left <= 0) continue;
        for (const acc of [...custody().values()].map((a) => ({ ...a, balance: cents(a.balance) })).filter((a) => a.holder === g.data?.debtor && a.balance > 0).sort((a, b) => (a.account < b.account ? -1 : 1))) {
          const amount = Math.min(left, acc.balance);
          left -= amount;
          out.push({ instruction: g.id, from: acc.account, to, amount, due: obs.t, ...(typeof g.data?.claim === "string" ? { settles: g.data.claim } : {}) });
          if (left <= 0) break;
        }
      }
      out.sort((a, b) => a.due - b.due || filedBefore({ id: a.instruction }, { id: b.instruction }));
      return out;
    };

    // Letters to the bank (pilot 9: a mayor wrote 34 times and heard nothing): each answered with the writer's own
    // accounts here, their balances and their latest payments, and how to instruct the bank.
    const letters = new Letters();
    let replies: Step[] = [];
    const accountReport = (obs: Observation, holder: string | undefined, writer: string) => {
      const mine = channels.accounts(obs).filter((a) => a.custodian === obs.entity && a.holder === holder).sort((a, b) => (a.account < b.account ? -1 : 1));
      if (!mine.length) return `Report from ${obs.entity}: we hold no account for you. To open one, ask us for one in writing.`;
      const ids = new Set(mine.map((a) => a.account));
      // A statement of each account, from the bank's ledger: what was paid in and out since the last statement to
      // this writer (the first: since the ledger began), by date, with the account paid or paying, what the payer
      // said it was for, and the references a customer may know (their own instruction; what a payment settles).
      // The payer's instruction is not named to whoever was paid: it is the payer's paper.
      const statement = (a: (typeof mine)[number]) => {
        const l = ledgers.get(a.account) ?? { n: 0, paidIn: 0, paidOut: 0, latest: [] };
        const key = `${writer} ${a.account}`, before = statedTo.get(key);
        const since = before ?? { n: 0, paidIn: 0, paidOut: 0, t: ledgerFrom ?? obs.t };
        statedTo.set(key, { n: l.n, paidIn: l.paidIn, paidOut: l.paidOut, t: obs.t });
        const n = l.n - since.n, paidIn = l.paidIn - since.paidIn, paidOut = l.paidOut - since.paidOut;
        const balance = cents(a.balance);
        const period = `${dateWords(since.t)} to ${dateWords(obs.t)}${before ? " (since our last statement to you)" : ""}`;
        if (!n) return `Statement of ${a.account}, ${period}: nothing was paid in or out. Balance ${usd(balance)}.`;
        const listed = l.latest.slice(-Math.min(n, statementLists, l.latest.length));
        const entry = (x: Transaction) => {
          const out = x.from === a.account;
          const what = x.memo ? ` (${x.memo.replace(/\.$/, "")})` : "";
          return `${dateWords(x.t)}: paid ${out ? `out ${usd(cents(x.amount))} to ${x.to}` : `in ${usd(cents(x.amount))} from ${x.from}`}${what}${out && x.per_instruction ? `, under your instruction ${x.per_instruction}` : ""}${x.settles ? `, settling ${x.settles}` : ""}`;
        };
        return `Statement of ${a.account}, ${period}: balance brought forward ${usd(balance - paidIn + paidOut)}. ${listed.map(entry).join("; ")}. ` +
          (n > listed.length ? `Those are the latest ${listed.length} of ${n} entries; the ${n - listed.length} before them are in the totals. ` : "") +
          `In all ${usd(paidOut)} paid out and ${usd(paidIn)} paid in. Balance carried forward ${usd(balance)}.`;
      };
      // The writer's own standing instructions, each by its reference (what it is named by to withdraw it or to hold
      // it): from an account of theirs, in their name. Nobody else's.
      const orders = [...standing.values()].filter((r) => r.speaks_for === holder && ids.has(r.data?.outcome?.money?.from)).sort(filedBefore);
      const order = (r: StatementRecord) => {
        const m = r.data!.outcome.money, every = r.data!.every as number, next = nextDue.get(r.id);
        const on = (holdsOn.get(r.id) ?? []).filter((h) => ended.get(h.hold) === undefined).map((h) => h.hold);
        // (Who gave it and when, and what it cites: what the instruction itself says, which is the customer's own paper.)
        const cited = basesOf(r);
        const given = `, given ${r.author === "genesis" ? "before the year began" : `on ${dateWords(r.at)}`}${r.in_position ? ` in your post ${r.in_position}` : ""}${cited.length ? `, citing ${cited.join(", ")}` : ""}`;
        return `${r.id}: ${usd(cents(m.amount))} from ${m.from} to ${m.to} every ${every % DAY === 0 ? `${every / DAY} day${every === DAY ? "" : "s"}` : `${every} seconds`}${next !== undefined ? `, next due day ${Math.floor(next / DAY) + 1}` : ""}${given}${on.length ? `, on hold (${on.join(", ")})` : ""}`;
      };
      return `Report from ${obs.entity}: ${mine.map(statement).join(" ")} ` +
        (orders.length ? `Your standing instructions with us: ${orders.slice(0, lettersList).map(order).join("; ")}${orders.length > lettersList ? `; and ${orders.length - lettersList} more` : ""}. ` : "You have no standing instructions with us. ") +
        "We pay on your written instruction (a request to pay, once or every so often), from an account you hold, if its balance covers it. To end a standing instruction, withdraw it by its reference; to pause one, put a hold on it by its reference, and withdraw the hold to resume.";
    };

    return {
      step(obs) {
        book.absorb(obs);
        // Into the ledger: each payment in or out of an account, as the bank is shown it (once).
        ledgerFrom ??= obs.t;
        for (const x of channels.transactions(obs)) {
          enter(x.from, x, true);
          if (x.to !== x.from) enter(x.to, x, false);
        }
        letters.take(obs, book);
        if (queuedAt !== obs.t && (obs.woke_for !== "done" || queue.length === 0)) { // (a wake's payments, planned when it begins or its plan is done: the stepper)
          // Who wrote the instructions it is about to read for the first time: looked up first, each writer once
          // (docs/behaviour/bank-payment-system.md, "Who wrote it"). Its payment platform is a system under licence, and a payment takes it a second (foundations F5): it plans knowing the answers.
          // (And who wrote a hold it is about to read: a hold is its customer's instruction too.)
          const whom = whoWrote(book, asked, who, [...[...book.all("request").slice(cursor), ...book.all("hold").slice(holdCursor)].filter((r) => (r.addressed_to ?? []).includes(obs.entity!)),
            // (And who wrote a withdrawal it is about to read: only whoever may instruct on an account ends an instruction on it.)
            ...book.ofType("withdrawal").slice(withdrawalCursor)]);
          if (whom.length) return { type: "look", looks: whom };
          // Payments a busy moment didn't get to (a wake allows only so many actions) are made first at the next: they're
          // already counted as due (a one-off as handled, a standing order's next date moved on), so never dropped.
          queue = [...queue, ...plan(obs)];
          queuedAt = obs.t;
          inFlight = [];
        }
        // If the last batch was refused (the world changed under us), retry it one payment at a time;
        // a single payment that's refused is reported to the account holder, in plain words.
        const last = obs.outcomes.at(-1);
        if (last?.status === "refused" && inFlight.length > 1) queue.unshift(...inFlight.map((p) => ({ ...p, single: true }) as Payment));
        else if (last?.status === "refused" && inFlight.length === 1) {
          const p = inFlight[0]!;
          const holder = channels.accounts(obs).find((a) => a.account === p.from)?.holder;
          if (holder) refusals.push(message([holder], `Payment of ${moneyNow(p.amount)} to ${p.to} (request ${p.instruction}) couldn't be made: ${refusalText(last.refusal?.code)}.`, p.instruction));
        }
        inFlight = [];
        if (refusals.length) return callAction(because("Telling account holders about requests we couldn't carry out.", ...refusals.splice(0, 32)));
        if (withdrawalNotes.length) return callAction(because("Answering withdrawals of standing instructions and holds that we do not act on: whoever gave them may not instruct on the account, or there is nothing of theirs by that reference.", ...withdrawalNotes.splice(0, 32)));
        if (holdNotes.length) return callAction(because("Answering instructions to hold standing payments: what is held and from when, or that there is nothing of theirs by that reference.", ...holdNotes.splice(0, 32)));
        // (Who wrote: the organisation of the position written in, or the participant's person, from the directory.)
        replies.push(...letters.answer(({ participant, as, entity }) => accountReport(obs, entity ?? (as ? book.positions.get(as)?.entity : book.participantPerson.get(participant)), as ?? participant),
          "A letter to the bank: answering with a statement of the writer's own accounts (what was paid in and out since the last one) and their standing instructions."));
        if (replies.length) return callAction(replies.shift()!);
        if (opens.length) return callAction(because("Opening accounts people asked for.", ...opens.splice(0, 32)));
        if (queue.length === 0) return wait();

        // (Each account as it's seen, and beside it what's left in those this batch pays from.)
        const seen = new Map(channels.accounts(obs).map((a) => [a.account, a]));
        const left = new Map<string, number>();
        const blocks: Step = [];
        while (queue.length && blocks.length < maxBatch) {
          const p = queue.shift()!;
          const from = seen.get(p.from);
          const have = left.get(p.from) ?? (from ? cents(from.balance) : 0);
          if (have >= p.amount) {
            blocks.push(pay(p.to, p.amount, { from: p.from, per_request: p.instruction, settles: p.settles, for: p.memo, line: p.line }));
            left.set(p.from, have - p.amount);
            inFlight.push(p);
          } else {
            // Not enough money: the payment isn't made, and the account holder is told.
            const holder = from?.holder;
            if (holder) blocks.push(message([holder], PAYMENT_FAILED.note(moneyNow(p.amount), p.to, p.instruction), p.instruction));
          }
          if ((p as any).single) break;
        }
        return blocks.length ? callAction(Object.assign(blocks, { why: "Carrying out the payment requests due (each names its request), in order." })) : wait();
      },
    };
  },
};
