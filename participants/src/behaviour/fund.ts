// fund.retirement: a retirement fund's trustee. Documented in docs/behaviour/firm-ownership.md.

import type { Observation } from "../contracts";
import { DAY, need, params, type BehaviourModule } from "../module";
import { because, Book, ownAccount, pay, say, usd, type Step } from "./common";
import { stepper } from "./firms";

/** A member as the fund's register has them: where they're paid, when they were born, and their units of the fund. */
interface Member { member: string; account: string; born_at: number; units: number }

/**
 * fund.retirement: the trustee of a retirement fund, which holds shares for its members (it is on those firms' registers
 * as any holder is, and they pay it as they pay any holder). Every `pay_every_days` it takes what has come in since it
 * last did; pays its costs out of that (`cost_bps_of_income`, to its administrator); and credits the rest to its members
 * by their units, from the register it keeps (its latest `fund_members` statement). A member below `access_age` is paid
 * nothing: their part is kept for them. A member from that age is paid their part as it comes, as a pension, and with
 * it what was kept for them before, at the yearly rate for their age (`drawdown_bps_by_age`). When a member's death is
 * registered, what was kept for them is paid to their account (their estate's), and their units end. A member who has
 * left is paid nothing more here; their part is kept. Every `report_every_days` (0: never) it reports publicly what it
 * took in, paid and keeps. It takes no contributions and admits no members.
 */
export const retirementFund: BehaviourModule = {
  name: "fund.retirement",
  answers: {"office": "the retirement fund", "acts": "What it acts on: its members' accounts and the pensions it pays from them, as its rules say."},
  version: "0.1.0",
  doc: "docs/behaviour/firm-ownership.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create(ctx) {
    const p = params(
      {
        administrator_account: "", // where its costs are paid: its administrator's account (the world must say)
        access_age: null as number | null, // the age from which a member is paid (the world must say)
        cost_bps_of_income: 0, // none unless the world says
        pay_every_days: 30, // placeholder
        drawdown_bps_by_age: [] as { from: number; bps: number }[], // none unless the world says: only what comes in is paid
        report_every_days: 0, // never unless the world says
        year: 365 * DAY,
      },
      ctx.params,
    );
    need(p, ["administrator_account", "access_age"], "fund.retirement");
    const me = ctx.entity;
    const book = new Book();
    const every = p.pay_every_days * DAY;
    let next = every;
    let nextReport = p.report_every_days > 0 ? p.report_every_days * DAY : Infinity;
    let members: Map<string, Member> | undefined;
    const kept = new Map<string, number>(); // member -> what is kept for them
    const away = new Set<string>();
    const period = { income: 0, costs: 0, pensions: 0, on_death: 0 };
    const rateAt = (age: number) => [...p.drawdown_bps_by_age].sort((a, b) => b.from - a.from).find((b) => b.from <= age)?.bps ?? 0;
    return stepper(
      (obs: Observation) => book.absorb(obs),
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const register = book.open("fund_members").filter((r) => r.speaks_for === me).sort((a, b) => b.at - a.at)[0];
        if (!members && register) members = new Map(((register.data?.members ?? []) as Member[]).map((m) => [m.member, m]));
        const acc = ownAccount(obs);
        if (t < next || !members || !acc) return steps;
        while (next <= t) next += every;
        for (const r of book.all("departure")) if (r.speaks_for) away.add(r.speaks_for);
        // What has come in: what we hold beyond what is kept for members.
        const income = Math.max(0, acc.balance - [...kept.values()].reduce((x, y) => x + y, 0));
        const lines: { to: string; amount: string; for: string }[] = [];
        // Deaths, as registered: what was kept for the member, to their account; their units end.
        let onDeath = 0;
        for (const who of [...new Set(book.all("death_registration").map((r) => String(r.data?.deceased)))].sort()) {
          const m = members.get(who);
          if (!m) continue;
          const sum = kept.get(who) ?? 0;
          if (sum > 0) lines.push({ to: m.account, amount: String(sum), for: "Death benefit." });
          onDeath += sum;
          kept.delete(who);
          members.delete(who);
        }
        const cost = Math.floor((income * p.cost_bps_of_income) / 10_000);
        const net = income - cost;
        const units = [...members.values()].reduce((x, m) => x + m.units, 0);
        let pensions = 0;
        if (units > 0) for (const m of [...members.values()].sort((a, b) => (a.member < b.member ? -1 : 1))) {
          const part = Math.floor((net * m.units) / units);
          const age = Math.floor((t - m.born_at) / p.year);
          const had = kept.get(m.member) ?? 0;
          if (age < p.access_age! || away.has(m.member)) {
            if (part > 0) kept.set(m.member, had + part);
            continue;
          }
          const draw = Math.min(had, Math.floor((had * rateAt(age) * every) / (10_000 * p.year)));
          if (draw > 0) kept.set(m.member, had - draw);
          if (part + draw > 0) lines.push({ to: m.account, amount: String(part + draw), for: "Pension." });
          pensions += part + draw;
        }
        if (cost > 0) steps.push(because(`We took in ${usd(income)} since we last paid: ${p.cost_bps_of_income / 100}% of it goes on our costs.`, pay(p.administrator_account, cost, { from: acc.account, for: "Administration and investment costs." })));
        // One instruction to the bank for them all (docs/behaviour/bank-payment-system.md).
        if (lines.length) steps.push(because(`Of the ${usd(net)} left, each member's part by their units: kept for those not yet ${p.access_age}; paid to those who are, with what was kept for them before at the yearly rate for their age (${lines.length} payment${lines.length > 1 ? "s" : ""}, ${usd(pensions + onDeath)}, in one instruction to the bank).`,
          say("request", `Please pay these from ${acc.account}: ${lines.length} payments.`, { to: [acc.custodian], data: { from: acc.account, payments: lines } })));
        period.income += income; period.costs += cost; period.pensions += pensions; period.on_death += onDeath;
        if (t >= nextReport) {
          while (nextReport <= t) nextReport += p.report_every_days * DAY;
          const keeps = [...kept.values()].reduce((x, y) => x + y, 0);
          steps.push(because("Our report for the period: what we took in, what it cost, what we paid, and what we keep for our members.",
            say("fund_report", `${me}: ${members.size} members; took in ${usd(period.income)}, costs ${usd(period.costs)}, pensions paid ${usd(period.pensions)}, paid on members' deaths ${usd(period.on_death)}; ${usd(keeps)} kept for members.`,
              { visible: "public", data: { members: members.size, ...period, kept: keeps } })));
          period.income = period.costs = period.pensions = period.on_death = 0;
        }
        return steps;
      },
    );
  },
};
