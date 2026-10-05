// A scripted exporter, for the trade tests: on given days it ships goods to the outside and invoices them.
import { calls as C, type BehaviourModule } from "@oikos/participants";

const DAY = 86_400;

/** params: account, from_at, price (cents each), script: [{ day, ship, invoice }] (ship 0: invoice without shipping). */
const exporter: BehaviourModule = {
  name: "test.exporter",
  version: "0.0.1",
  doc: "orchestrator/test/fixtures/trade-modules.ts",
  cadence: () => DAY,
  create(ctx) {
    const p = ctx.params as { account: string; from_at: string; price: number; script: { day: number; ship: number; invoice: number }[] };
    const done = new Set<number>();
    return {
      step(obs) {
        const i = p.script.findIndex((s, j) => !done.has(j) && obs.t >= s.day * DAY);
        if (i < 0) return { type: "wait" };
        done.add(i);
        const s = p.script[i]!;
        const lines = [
          ...(s.ship ? [C.call("goods", { kind: "goods", quantity: C.text(String(s.ship)), to: "outside", at: "outside", from_at: p.from_at })] : []),
          C.call("statement", { kind: "invoice", text: C.text(`Invoice: ${s.invoice} goods.`), to: C.json(["outside"]),
            data: C.json({ kind: "goods", quantity: s.invoice, from_at: p.from_at, outcome: { money: { to: p.account, amount: String(s.invoice * p.price) } } }) }),
        ];
        return { type: "call", call: C.program(...lines) };
      },
    };
  },
};

export const modules = Object.fromEntries([exporter].map((m) => [m.name, m]));
