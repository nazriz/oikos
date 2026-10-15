// A hold, end to end, in a run (docs/behaviour/bank-payment-system.md, "A hold"; docs/design/call-language-gaps.md
// B.1): the town's finance officer, a code participant, puts a hold on the town's standing wage payment at the bank;
// the bank passes over the due date that falls under it; the hold is withdrawn, and payment goes on from the next due
// date with nothing made up. What was not paid is still owed. Run twice: once the town pays it by a payment of its
// own, and the worker goes on working; once it is left unpaid, and the worker does what an unpaid worker here does
// (resigns, and records the wages as a debt against the town). Nothing in the kernel knows what a hold is: the acts
// are a statement and its withdrawal.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

interface Script { held: string | string[]; hold_day: number; lift_day: number; settle?: { to: string; amount: number; from: string } }

/** The town's finance officer, doing its job as its module does it, and on given days these things of its own: a hold
 * on a standing payment, the hold's withdrawal, and (if told to) a payment of what was missed. */
const holding: BehaviourModule = {
  name: "test.finance_holding",
  version: "0.0.1",
  doc: "orchestrator/test/holds-run.test.ts",
  cadence: () => DAY,
  create(ctx) {
    const { script, ...rest } = ctx.params as { script: Script };
    const inner = builtin["city.finance_officer"]!.create({ ...ctx, params: rest });
    const done = new Set<string>();
    let hold: string | undefined;
    const act = (...lines: C.Call[]) => ({ type: "call" as const, call: C.program(...lines) });
    return Object.assign(Object.create(inner), {
      step(obs: any, x: any) {
        // Its own hold, as the world recorded it (it is shown its own papers): the id it is withdrawn by.
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.record === "statement" && r.kind === "hold" && r.speaks_for === obs.entity) hold = r.id;
        if (!done.has("hold") && obs.t >= script.hold_day * DAY) {
          done.add("hold");
          return act(C.call("statement", { hold: typeof script.held === "string" ? script.held : C.json(script.held), text: C.text("Held while the payroll is checked.") }));
        }
        if (hold && !done.has("lift") && obs.t >= script.lift_day * DAY) {
          done.add("lift");
          return act(C.call("statement", { withdraw: hold }));
        }
        if (script.settle && done.has("lift") && !done.has("settle")) {
          done.add("settle");
          return act(C.call("money", { to: script.settle.to, amount: C.amountText(script.settle.amount), from: script.settle.from, for: C.text("wages for the pay day that was held") }));
        }
        return inner.step(obs, x);
      },
    });
  },
};

/** The town for some weeks, with its finance officer holding the town's wage payment from three days after its first
 * pay day (day F) to the day after its second, and then (`settle`) paying what was missed itself, or not. */
async function held(name: string, settle: boolean, asList: boolean) {
  const config = generate({ ...spec, citizens: 40, nature: false });
  const order = (config.world.records as any[]).filter((r) => r.kind === "request" && r.speaks_for === "city" && r.data?.every === 14 * DAY && /-wages$/.test(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const F = order.data.first / DAY, wage = Number(order.data.outcome.money.amount), to: string = order.data.outcome.money.to;
  // It pays under an employment agreement: the record of what the town owes its worker, whatever the bank does.
  expect((config.world.records as any[]).some((r) => r.id === order.basis && r.record === "agreement" && r.terms.template === "employment")).toBe(true);
  const script: Script = { held: asList ? [order.id] : order.id, hold_day: F + 3, lift_day: F + 15, ...(settle ? { settle: { to, amount: wage, from: "acc-city" } } : {}) };
  const finance = officeBy(config, "city.finance_officer");
  finance.run(holding.name, { ...finance.params, script });
  const out = join(root, "runs", `test-holds-run-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: (F + 45) * DAY, modules: { [holding.name]: holding } });
  expect(s.participantErrors).toBe(0);
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  // (Letters, as they were written: the acts that sent them.)
  const letters = lines.filter((e) => e.kind === "command").flatMap((e) => ((e.body.blocks ?? []) as any[]).filter((b) => b.block === "message").map((b) => ({ from: e.body.participant, ...b })));
  const day = (t: number) => Math.floor(t / DAY);
  const transfers = events.filter((e) => e.event === "transfer");
  return { bank: officeBy(config, "bank.payment_system").holder.id as string, order, F, wage, to, day, events, letters, transfers, records: events.filter((e) => e.event === "recorded").map((e) => e.record),
    /** The days on which the bank paid under an instruction. */
    under: (id: string) => transfers.filter((x) => x.per_instruction === id).map((x) => day(x.t)) };
}

test("a code finance officer holds the town's standing wage payment: the bank passes over the due date under the hold and pays again from the next once it is lifted, making nothing up; the town pays what was missed itself", async () => {
  const { bank, order, F, wage, to, day, letters, transfers, records, under } = await held("settled", true, false);
  // The hold: a statement of the town's, made in the finance officer's post, to the bank, seen by the two of them; and
  // its withdrawal. Nothing else was needed of the world.
  const hold = records.find((r) => r.kind === "hold");
  expect(hold).toMatchObject({ record: "statement", speaks_for: "city", in_position: "finance", addressed_to: ["bank"], visible_to: ["bank", "city"], data: { holds: [order.id] }, text: "Held while the payroll is checked." });
  expect(day(hold.at)).toBe(F + 3);
  const lift = records.find((r) => r.record === "withdrawal" && r.withdraws === hold.id);
  expect(day(lift.at)).toBe(F + 15);
  // The bank's answer, once: which payment it stops and from which due date, and that nothing is made up.
  const answers = letters.filter((m) => m.re === hold.id);
  expect(answers.map((m) => [m.from, m.to, m.text])).toEqual([[bank, ["finance"], `Hold ${hold.id} is in place. Not paid while it stands: ${order.id}, from the payment due on day ${F + 15}. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw ${hold.id}; payments then go on from the next due date.`]]);
  // Paid on its first pay day; not on the one under the hold; again on each of the next two, once, the same sum.
  expect(under(order.id)).toEqual([F, F + 28, F + 42]);
  for (const x of transfers.filter((x) => x.per_instruction === order.id)) expect(x.amount).toBe(String(wage));
  // What it missed was paid by the town itself, the day the hold was lifted: one pay day's wages, by a payment of its
  // own and under no standing instruction. So the worker is paid in full, and went on working: no notice on the
  // agreement, and no debt recorded against the town.
  const own = transfers.filter((x) => x.to === to && x.from === "acc-city" && x.per_instruction !== order.id);
  expect(own.map((x) => [day(x.t), x.amount])).toEqual([[F + 15, String(wage)]]);
  expect(records.find((r) => r.id === own[0].per_instruction)).toMatchObject({ kind: "request", speaks_for: "city", in_position: "finance", data: { outcome: { money: { to, amount: String(wage), for: "wages for the pay day that was held" } } } });
  expect(transfers.filter((x) => x.to === to && x.from === "acc-city").length).toBe(4); // four pay days, four payments
  expect(records.filter((r) => r.record === "notice" && r.agreement === order.basis)).toEqual([]);
  expect(records.filter((r) => r.record === "claim" && r.basis === order.basis)).toEqual([]);
}, 300_000);

test("left unpaid, what a held payment was for is still owed: the bank makes nothing up, and the worker records the wages as a debt against the town", async () => {
  const { order, F, to, day, transfers, records, under } = await held("unpaid", false, true);
  const hold = records.find((r) => r.kind === "hold");
  expect(hold.data).toEqual({ holds: [order.id] }); // (a list of one is that one)
  expect(records.some((r) => r.record === "withdrawal" && r.withdraws === hold.id && day(r.at) === F + 15)).toBe(true);
  // The pay day under the hold was passed over, and nothing came in its place when the hold was lifted.
  expect(under(order.id).slice(0, 1)).toEqual([F]);
  expect(transfers.filter((x) => x.to === to && x.from === "acc-city" && day(x.t) > F && day(x.t) < F + 28)).toEqual([]);
  // The world's own record of what is owed is the worker's: the wages haven't come for a pay period and five days, so
  // they resign and record the debt against the town, citing the employment agreement (docs/behaviour/citizen.md).
  const debt = records.find((r) => r.record === "claim" && r.basis === order.basis && r.about?.kind === "debt");
  expect(debt).toMatchObject({ position: "right", counterparty: "city", about: { kind: "debt", for: "Unpaid wages (1 pay period)." } });
  expect(day(debt.at)).toBeGreaterThanOrEqual(F + 19);
  expect(day(debt.at)).toBeLessThan(F + 28);
  expect(records.some((r) => r.record === "notice" && r.agreement === order.basis && day(r.at) === day(debt.at))).toBe(true);
}, 300_000);
