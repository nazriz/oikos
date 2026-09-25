// bank.payment_system: a bank's automated payment system. Documented in
// docs/behaviour/bank-payment-system.md.
//
// It reads instructions addressed to its bank (one-off payments, standing
// orders), applies the bank's procedure (only the account holder may
// instruct; the money must be there), and moves money it holds in custody.
// It is content: a bank run by a different module (or an AI) can freeze
// accounts, ignore instructions, or pay the wrong people. Physics doesn't stop it.

import type { Block, Observation, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { act, DAY, wait, type BehaviourModule, type SeatContext } from "../module";

interface Payment { instruction: string; from: string; to: string; amount: number; due: number; payee_holder?: string }

export const bankPaymentSystem: BehaviourModule = {
  name: "bank.payment_system",
  version: "0.1.0",
  doc: "docs/behaviour/bank-payment-system.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx: SeatContext) {
    const verifyAuthor = ctx.params.verify_author ?? true;
    const maxBatch = Math.min(32, ctx.params.max_batch ?? 32);
    const done = new Set<string>(); // one-off instructions handled
    const nextDue = new Map<string, number>(); // standing order -> next due time
    let queue: Payment[] = [];
    let queuedAt = -1;
    let inFlight: Payment[] = [];

    const plan = (obs: Observation) => {
      const me = obs.entity;
      const records = channels.records(obs);
      const withdrawn = new Set(records.flatMap((r) => (r.record === "withdrawal" ? [r.withdraws] : [])));
      const seatEntity = new Map((channels.directory(obs)?.seats ?? []).map((s) => [s.seat, s.entity]));
      const custody = new Map(channels.accounts(obs).filter((a) => a.custodian === me).map((a) => [a.account, a]));
      const instructions = records
        .filter((r): r is StatementRecord => r.record === "statement" && r.kind === "instruction" && (r.addressed_to ?? []).includes(me))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const out: Payment[] = [];
      for (const ins of instructions) {
        if (withdrawn.has(ins.id)) continue;
        const d = ins.data ?? {};
        const acc = custody.get(d.from);
        if (!acc || !Number.isInteger(d.pay) || d.pay <= 0 || typeof d.to !== "string") continue;
        // The bank's procedure: only the account holder may instruct it.
        const authorEntity = ins.author === "genesis" ? ins.speaks_for : seatEntity.get(ins.author);
        if (ins.speaks_for !== acc.holder || (verifyAuthor && authorEntity !== acc.holder)) continue;
        if (Number.isInteger(d.every) && d.every > 0) {
          let due = nextDue.get(ins.id) ?? ins.at + (Number.isInteger(d.first) ? d.first : d.every);
          while (due <= obs.t) {
            out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due });
            due += d.every;
          }
          nextDue.set(ins.id, due);
        } else if (!done.has(ins.id)) {
          done.add(ins.id);
          out.push({ instruction: ins.id, from: d.from, to: d.to, amount: d.pay, due: ins.at });
        }
      }
      out.sort((a, b) => a.due - b.due || (a.instruction < b.instruction ? -1 : 1));
      return out;
    };

    return {
      step(obs) {
        if (queuedAt !== obs.t) {
          queue = plan(obs);
          queuedAt = obs.t;
          inFlight = [];
        }
        // If the last batch was refused (the world changed under us), retry it one payment at a time.
        const last = obs.outcomes.at(-1);
        if (last?.status === "refused" && inFlight.length > 1) queue.unshift(...inFlight.map((p) => ({ ...p, single: true }) as Payment));
        inFlight = [];
        if (queue.length === 0) return wait();

        const balance = new Map(channels.accounts(obs).map((a) => [a.account, a.balance]));
        const holderOf = new Map(channels.accounts(obs).map((a) => [a.account, a.holder]));
        const blocks: Block[] = [];
        while (queue.length && blocks.length < maxBatch) {
          const p = queue.shift()!;
          const have = balance.get(p.from) ?? 0;
          if (have >= p.amount) {
            blocks.push({ block: "transfer", from: p.from, to: p.to, amount: p.amount, per_instruction: p.instruction });
            balance.set(p.from, have - p.amount);
            inFlight.push(p);
          } else {
            // Not enough money: the payment isn't made, and the account holder is told.
            const holder = holderOf.get(p.from);
            if (holder) blocks.push({ block: "message", to: [holder], text: `Payment of ${p.amount} cents to ${p.to} (instruction ${p.instruction}) failed: insufficient funds.`, re: p.instruction });
          }
          if ((p as any).single) break;
        }
        return blocks.length ? act(blocks) : wait();
      },
    };
  },
};
