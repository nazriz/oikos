// world.export_demand: the outside world buying from the town (a boundary
// condition, D31). Documented in docs/behaviour/boundary.md. Researcher-set:
// params.purchases = [{ to: account, amount: cents, every: seconds, memo? }].

import type { Block } from "../contracts";
import { channels } from "../contracts";
import { act, DAY, wait, type BehaviourModule } from "../module";

export const exportDemand: BehaviourModule = {
  name: "world.export_demand",
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const purchases: { to: string; amount: number; every: number; memo?: string }[] = ctx.params.purchases ?? [];
    const next = purchases.map((p) => p.every);
    return {
      step(obs) {
        const mine = channels.accounts(obs).find((a) => a.holder === obs.entity && a.custodian === obs.entity);
        if (!mine) return wait();
        const blocks: Block[] = [];
        purchases.forEach((p, i) => {
          while (next[i]! <= obs.t && blocks.length < 32) {
            blocks.push({ block: "transfer", from: mine.account, to: p.to, amount: p.amount, memo: p.memo ?? "export sales" });
            next[i]! += p.every;
          }
        });
        return blocks.length ? act(blocks) : wait();
      },
    };
  },
};

/** idle: a seat that does nothing (placeholder, and a control condition). */
export const idle: BehaviourModule = {
  name: "idle",
  version: "0.1.0",
  doc: "docs/behaviour/README.md",
  cadence: () => 30 * DAY,
  create: () => ({ step: () => wait() }),
};
