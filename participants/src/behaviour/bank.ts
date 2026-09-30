// bank.payment_system: a bank's automated payment system. Documented in
// docs/behaviour/bank-payment-system.md.
//
// It reads payment requests addressed to its bank (the standard encoding,
// docs/design/translator-and-resolver.md §9.1: one-off payments and standing
// orders), applies the bank's procedure (only the account holder may
// instruct; the money must be there), and moves money it holds in custody.
// It is content: a bank run by a different module (or an AI) can freeze
// accounts, ignore instructions, or pay the wrong people. Physics doesn't stop it.

import { cents } from "../money";
import type { Observation, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { DAY, wait, type BehaviourModule, type ParticipantContext } from "../module";
import { refusalText } from "../llm/words";
import * as C from "../calls";
import { because, Book, callAction, Letters, message, pay, type Step, usd } from "./common";

interface Payment { instruction: string; from: string; to: string; amount: number; due: number; settles?: string }

export const bankPaymentSystem: BehaviourModule = {
  name: "bank.payment_system",
  version: "0.9.0",
  doc: "docs/behaviour/bank-payment-system.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx: ParticipantContext) {
    const verifyAuthor = ctx.params.verify_author ?? true;
    const maxBatch = Math.min(32, ctx.params.max_batch ?? 32);
    const done = new Set<string>(); // one-off instructions handled
    const settled = new Map<string, string[]>(); // death registration -> the heirs' accounts its estate goes to
    const p = { town: (ctx.params.town as string | undefined) ?? "" }; // an estate with no heirs goes to the town, if the world names one
    const nextDue = new Map<string, number>(); // standing order -> next due time
    // Instructions, read once as they arrive: a one-off is dealt with then; a standing order is kept until it's withdrawn
    // (so a plan never rescans every instruction ever made).
    let cursor = 0;
    const standing = new Map<string, StatementRecord>();
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
      const withdrawn = book.withdrawn;
      const custody = new Map(channels.accounts(obs).filter((a) => a.custodian === me).map((a) => [a.account, { ...a, balance: cents(a.balance) }]));
      const all = book.all("request");
      const fresh = all.slice(cursor).filter((r) => (r.addressed_to ?? []).includes(me));
      cursor = all.length;
      for (const r of fresh) if (Number.isInteger(r.data?.every) && r.data!.every > 0 && !Array.isArray(r.data?.payments)) standing.set(r.id, r);
      for (const id of [...standing.keys()]) if (withdrawn.has(id)) standing.delete(id);
      const instructions = [...new Map([...standing, ...fresh.map((r) => [r.id, r] as const)]).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const out: Payment[] = [];
      // Deaths registered: the dead person's instructions are no longer carried out (law-succession).
      const deaths = book.all("death_registration");
      const dead = new Set(deaths.map((r) => r.data?.deceased as string));
      for (const ins of instructions) {
        if (withdrawn.has(ins.id) || dead.has(ins.speaks_for ?? "")) continue;
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
        const d = { from: m.from, to: m.to, pay: cents(m.amount), settles: m.settles, every: bulk ? undefined : ins.data.every, first: ins.data.first };
        const acc = custody.get(d.from);
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
          let due = nextDue.get(ins.id) ?? ins.at + (Number.isInteger(d.first) ? d.first : d.every);
          while (due <= obs.t) {
            out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due });
            due += d.every;
          }
          nextDue.set(ins.id, due);
        } else if (bulk && !done.has(ins.id)) {
          done.add(ins.id);
          for (const b of bulk) out.push({ instruction: ins.id, from: d.from, to: b.to as string, amount: cents(b.amount as any), due: ins.at });
        } else if (!done.has(ins.id)) {
          done.add(ins.id);
          out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due: ins.at, ...(typeof d.settles === "string" ? { settles: d.settles } : {}) }); // the payer's reference, as given
        }
      }
      // Settling an estate, as law-succession says: to the partner; else equally to the adult children; else the town.
      // The heirs are settled once; what comes into the estate later (a dividend, a refund) is passed on to them too,
      // as an estate's administrator does.
      const accountOf = (holder: string) => [...custody.values()].find((a) => a.holder === holder && !dead.has(holder))?.account;
      for (const r of deaths) {
        if (!settled.has(r.id)) {
          const heirs = [r.data?.partner].filter((x): x is string => !!x && !!accountOf(x));
          if (!heirs.length) heirs.push(...((r.data?.adult_children ?? []) as string[]).filter((x) => !!accountOf(x)));
          settled.set(r.id, heirs.length ? heirs.map((h) => accountOf(h)!) : [accountOf(p.town)].filter((x): x is string => !!x));
        }
        const to = settled.get(r.id)!;
        if (!to.length) continue;
        for (const acc of custody.values()) {
          if (acc.holder !== r.data?.deceased || acc.balance <= 0) continue;
          const each = Math.floor(acc.balance / to.length);
          to.forEach((account, i) => {
            const amount = i === 0 ? acc.balance - each * (to.length - 1) : each;
            if (amount > 0) out.push({ instruction: r.id, from: acc.account, to: account, amount, due: obs.t });
          });
        }
      }
      out.sort((a, b) => a.due - b.due || (a.instruction < b.instruction ? -1 : 1));
      return out;
    };

    // Letters to the bank (pilot 9: a mayor wrote 34 times and heard nothing): each answered with the writer's own
    // accounts here, their balances and their latest payments, and how to instruct the bank.
    const letters = new Letters();
    let replies: Step[] = [];
    const accountReport = (obs: Observation, holder?: string) => {
      const mine = channels.accounts(obs).filter((a) => a.custodian === obs.entity && a.holder === holder).sort((a, b) => (a.account < b.account ? -1 : 1));
      if (!mine.length) return `Report from ${obs.entity}: we hold no account for you. To open one, ask us for one in writing.`;
      const ids = new Set(mine.map((a) => a.account));
      const recent = channels.transactions(obs).filter((x) => ids.has(x.from) || ids.has(x.to)).sort((a, b) => b.t - a.t).slice(0, 8);
      return `Report from ${obs.entity}: your accounts with us: ${mine.map((a) => `${a.account}, balance ${usd(cents(a.balance))}`).join("; ")}. ` +
        (recent.length ? `Latest payments: ${recent.map((x) => `day ${Math.floor(x.t / 86_400) + 1}: ${usd(cents(x.amount))} ${ids.has(x.from) ? `to ${x.to}` : `from ${x.from}`}${x.memo ? ` (${x.memo})` : ""}${x.per_instruction ? `, under your instruction ${x.per_instruction}` : ""}`).join("; ")}. ` : "No payments yet. ") +
        "We pay on your written instruction (a request to pay, once or every so often), from an account you hold, if its balance covers it.";
    };

    return {
      step(obs) {
        book.absorb(obs);
        letters.take(obs);
        if (queuedAt !== obs.t) {
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
          if (holder) refusals.push(message([holder], `Payment of ${p.amount} cents to ${p.to} (request ${p.instruction}) couldn't be made: ${refusalText(last.refusal?.code)}.`, p.instruction));
        }
        inFlight = [];
        if (refusals.length) return callAction(because("Telling account holders about requests we couldn't carry out.", ...refusals.splice(0, 32)));
        // (Who wrote: the organisation of the position written in, or the participant's person, from the directory.)
        replies.push(...letters.answer(({ participant, as }) => accountReport(obs, as ? book.positions.get(as)?.entity : book.participantPerson.get(participant)),
          "A letter to the bank: answering with the writer's own accounts and latest payments."));
        if (replies.length) return callAction(replies.shift()!);
        if (opens.length) return callAction(because("Opening accounts people asked for.", ...opens.splice(0, 32)));
        if (queue.length === 0) return wait();

        const balance = new Map(channels.accounts(obs).map((a) => [a.account, cents(a.balance)]));
        const holderOf = new Map(channels.accounts(obs).map((a) => [a.account, a.holder]));
        const blocks: Step = [];
        while (queue.length && blocks.length < maxBatch) {
          const p = queue.shift()!;
          const have = balance.get(p.from) ?? 0;
          if (have >= p.amount) {
            blocks.push(pay(p.to, p.amount, { from: p.from, per_request: p.instruction, settles: p.settles }));
            balance.set(p.from, have - p.amount);
            inFlight.push(p);
          } else {
            // Not enough money: the payment isn't made, and the account holder is told.
            const holder = holderOf.get(p.from);
            if (holder) blocks.push(message([holder], `Payment of ${p.amount} cents to ${p.to} (request ${p.instruction}) failed: insufficient funds.`, p.instruction));
          }
          if ((p as any).single) break;
        }
        return blocks.length ? callAction(Object.assign(blocks, { why: "Carrying out the payment requests due (each names its request), in order." })) : wait();
      },
    };
  },
};
