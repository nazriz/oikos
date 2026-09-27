// world.export_demand: the outside world buying from the town (a boundary
// condition, D31). Documented in docs/behaviour/boundary.md. Researcher-set:
// params.purchases = [{ to: account, amount: cents, every: seconds, memo? }].

import * as C from "../calls";
import { channels, type ParticipantAction, type StatementRecord } from "../contracts";
import { DAY, params, wait, type BehaviourModule } from "../module";
import { Book, callAction, pay, say, type Step } from "./common";
import { DEFAULT_HOUSEHOLDS, drawHousehold, type HouseholdSpec } from "./household";

export const exportDemand: BehaviourModule = {
  name: "world.export_demand",
  version: "0.2.0",
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
        const blocks: Step = [];
        purchases.forEach((p, i) => {
          while (next[i]! <= obs.t && blocks.length < 32) {
            blocks.push(pay(p.to, p.amount, { from: mine.account, for: p.memo ?? "export sales" }));
            next[i]! += p.every;
          }
        });
        return blocks.length ? callAction(blocks) : wait();
      },
    };
  },
};

/** idle: a participant that does nothing (placeholder, and a control condition). */
export const idle: BehaviourModule = {
  name: "idle",
  version: "0.1.0",
  doc: "docs/behaviour/README.md",
  cadence: () => 30 * DAY,
  create: () => ({ step: () => wait() }),
};

/**
 * world.migration: people moving to the town from elsewhere (a boundary condition, D31), after Harris & Todaro
 * (1970, "Migration, Unemployment and Development", AER 60(1)): people move when the income they expect where they're
 * going beats what they have where they are, and what they expect is the wage times the chance of getting a job.
 *
 * Monthly, it looks at the town's standing job postings (as someone thinking of moving would). A newcomer expects the
 * mean posted wage times the chance of a job: postings / (postings + the adults it has brought in the last
 * `memory_days`, who are competing for them). For each posting, a household comes with probability
 * `response_bps` x the gap over `outside_monthly_income` (capped). Households are drawn from the same census shares as
 * the town's; adults bring a few months' income elsewhere as savings. It writes the household's paperwork (the
 * `household` record the newcomers bring). Documented in docs/behaviour/boundary.md.
 */
export const migration: BehaviourModule = {
  name: "world.migration",
  version: "0.1.0",
  doc: "docs/behaviour/boundary.md",
  cadence: () => 30 * DAY,
  firstWake: () => 30 * DAY,
  create(ctx) {
    const p = params(
      {
        outside_monthly_income: 250_000, // what a household's earner could get elsewhere, cents a month (placeholder)
        response_bps: 1000, // chance per posting, per 100% gap, that a household comes this month (placeholder)
        max_households_per_month: 8,
        memory_days: 90,
        savings_months: [1, 3] as [number, number],
        templates: { female: "newcomer-female", male: "newcomer-male" },
        households: {} as Partial<HouseholdSpec>,
        search_limit: 200,
      },
      ctx.params,
    );
    const H: HouseholdSpec = { ...DEFAULT_HOUSEHOLDS, ...p.households };
    const book = new Book();
    const brought: { t: number; adults: number }[] = [];
    let arrivals = 0;
    let looked = -1;
    let postings: StatementRecord[] = [];
    let todo: Step[] = [];
    // Households that have crossed, waiting for their paperwork: members by person, once the ids come back.
    const pending: { refs: string[]; persons?: string[]; sex: ("female" | "male")[]; born_at: number[]; couples: [number, number][]; leaseholder: number }[] = [];
    let expecting: (typeof pending)[number] | null = null;

    return {
      step(obs): ParticipantAction {
        book.absorb(obs);
        const jobs = obs.channels.jobs;
        if (jobs?.kind === "records" && jobs.search) postings = jobs.records as StatementRecord[];
        // The ids of the household that just crossed.
        if (expecting) {
          const created = Object.assign({}, ...obs.outcomes.map((o) => o.created ?? {}));
          if (expecting.refs.every((r) => created[r])) {
            expecting.persons = expecting.refs.map((r) => created[r]);
            pending.push(expecting);
          }
          expecting = null;
        }
        // Paperwork for households whose members we can now reach (the directory names their participants).
        const reachOf = new Map([...book.participantPerson].map(([par, person]) => [person, par]));
        for (let i = pending.length - 1; i >= 0; i--) {
          const h = pending[i]!;
          if (!h.persons!.every((x) => reachOf.has(x))) continue;
          pending.splice(i, 1);
          const members = h.persons!.map((person, j) => ({ person, participant: reachOf.get(person)!, born_at: h.born_at[j]!, sex: h.sex[j]! }));
          const lh = h.persons![h.leaseholder]!;
          todo.unshift([say("household", `Household: ${h.persons!.join(", ")}.`, {
            to: h.persons, visible: h.persons, for: lh,
            data: { leaseholder: lh, members, couples: h.couples.map(([a, b]) => [h.persons![a], h.persons![b]]) },
          })]);
        }
        if (looked !== obs.t && todo.length === 0 && !expecting) {
          looked = obs.t;
          return { type: "look", looks: [{ channel: "jobs", query: { standing: true, limit: p.search_limit } }] };
        }
        if (looked === obs.t && postings.length && todo.length === 0 && !expecting && !pending.length) {
          const monthly = postings.map((x) => Math.floor(((x.data?.wage ?? 0) * 30 * DAY) / (x.data?.period ?? 14 * DAY)));
          const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
          const recent = brought.filter((b) => obs.t - b.t < p.memory_days * DAY).reduce((a, b) => a + b.adults, 0);
          const chance = postings.length / (postings.length + recent);
          const gapBps = Math.floor(((mean * chance - p.outside_monthly_income) * 10_000) / p.outside_monthly_income);
          const perPosting = Math.min(10_000, Math.max(0, Math.floor((gapBps * p.response_bps) / 10_000)));
          let n = 0;
          for (let i = 0; i < postings.length && n < p.max_households_per_month; i++) if (ctx.rng(`come-${obs.t}-${i}`).below(10_000) < perPosting) n++;
          const r = ctx.rng(`households-${obs.t}`);
          for (let k = 0; k < n; k++) {
            const d = drawHousehold(H, (m) => r.below(m));
            const refs = d.members.map((_, j) => `m${j}`);
            const born_at = d.members.map((m) => obs.t - (m.age * 365 + m.day) * DAY);
            const blocks = d.members.map((m, j) => C.call("presence", {
              name: C.text(`m${++arrivals}`), age: C.text(`${m.age * 365 + m.day} days`), template: p.templates[m.sex],
              ...(m.age >= 18 ? { carrying: C.dollars(Math.floor(((p.savings_months[0] + r.below(p.savings_months[1] - p.savings_months[0] + 1)) * p.outside_monthly_income))) } : {}),
            }));
            todo.push(blocks.map((b, j) => [refs[j]!, b] as [string, C.Call]));
            brought.push({ t: obs.t, adults: d.members.filter((m) => m.age >= 18).length });
            (todo.at(-1) as any).household = { refs, sex: d.members.map((m) => m.sex), born_at, couples: d.couples, leaseholder: d.leaseholder };
          }
        }
        const next = todo.shift();
        if (!next) return wait();
        if ((next as any).household) expecting = (next as any).household;
        return callAction(next);
      },
    };
  },
};
