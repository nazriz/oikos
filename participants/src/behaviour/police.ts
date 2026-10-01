// police.station: a police station's officer in charge (docs/behaviour/crime.md; docs/design/world-expansion.md 7.2).
// The police keep the officers their establishment says (hired and paid like any employer's staff), take reports of
// goods taken, and investigate each: work at the station that finds who took them, with the world's chance (only the
// police learn it). Found: a charge to the tribunal, with what they found as evidence, asking that the taker make good
// what was taken. Not found: the report stays unsolved, as most do.

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, nextLook, outOfTime, say, type Step, usd } from "./common";
import { Staffing, stepper } from "./firms";

export const station: BehaviourModule = {
  name: "police.station",
  version: "0.1.0",
  doc: "docs/behaviour/crime.md",
  cadence: () => DAY,
  firstWake: (ctx) => 10 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      building: "", workplace: "", // the station, and where its officers work (the world must say)
      account: "", // what it pays its staff from (its funding comes in there)
      officers: 0, // the establishment (its funder's)
      role: "police officer", wage: 0, period: 14 * DAY, notice_days: 14, industry: "public_safety",
      task: "investigate", task_seconds: 4 * 3600, working_day: 8 * 3600,
      tribunal: "", // where charges go
      look_at: 0, look_days: 5,
      channel: "premises",
    }, ctx.params);
    need(p, ["building", "workplace", "account", "tribunal"], "police.station");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, industry: p.industry });
    let view: SiteStructure | undefined;
    const queue: { report: string; from: string; at: string; kind: string; value: number; account?: string }[] = [];
    const taken = new Set<string>();
    const used = new Map<string, number>();
    let usedDay = -1;
    const asked = new Map<string, (typeof queue)[number]>(); // an investigation under way -> its report
    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        const ch = obs.channels[p.channel];
        if (ch?.kind === "sites") for (const c of ch.cells) if (c.structure?.structure === p.building) view = c.structure;
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        steps.push(...staffing.routine(obs, book, p.account, { target: p.officers, wage: p.wage, canPost: staffing.workers(book, t).length < p.officers,
          why: `The station's establishment is ${p.officers} officers; we have ${staffing.workers(book, t).length}: posting a job.` }));
        // Reports of goods taken, in the order they came.
        for (const r of book.open("crime_report").filter((x) => (x.addressed_to ?? []).includes(me) && !taken.has(x.id))) {
          taken.add(r.id);
          queue.push({ report: r.id, from: r.speaks_for!, at: String(r.data?.at), kind: String(r.data?.kind), value: Number(r.data?.value ?? 0), account: r.data?.account as string | undefined });
        }
        // What our investigations found (only we see it): a charge where we found who; else, unsolved.
        for (const o of obs.outcomes) {
          const found = o.investigated;
          const q = asked.get(o.action);
          if (!found || !q) continue;
          asked.delete(o.action);
          if (found.taker) steps.push(because(`Our investigation of report ${q.report} found who took the ${q.kind}: ${found.taker}. Charging them.`,
            say("tribunal_application", `Charge: ${found.taker} took ${q.kind} from ${q.from} at ${q.at} (report ${q.report}); we ask that they make good the ${usd(q.value)} it was worth.`,
              { to: [p.tribunal], visible: [me, p.tribunal, found.taker], basis: q.report, data: { kind: "charge", against: found.taker, victim: q.from, report: q.report, amount: q.value, account: q.account, evidence: { found: found.taker, at: q.at, goods: q.kind } } })));
          else steps.push(because(`Our investigation of report ${q.report} found nothing to say who took it: unsolved.`,
            say("investigation_closed", `Report ${q.report}: unsolved.`, { to: [q.from], visible: [me, q.from], basis: q.report, data: { report: q.report, solved: false } })));
        }
        // A working day's investigations, as the officers' hours allow.
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        const mine = new Set(staffing.workers(book, t));
        const here = [...new Set(view?.spaces.find((sp) => sp.space === p.workplace)?.occupants ?? [])].filter((w) => mine.has(w)).sort();
        while (queue.length) {
          const officer = here.find((w) => p.working_day - (used.get(w) ?? 0) >= p.task_seconds);
          if (!officer) break;
          const q = queue.shift()!;
          used.set(officer, (used.get(officer) ?? 0) + p.task_seconds);
          const st = because(`Investigating report ${q.report}: ${q.kind} taken from ${q.from} at ${q.at}.`,
            C.call("work", { task: p.task, units: "1", at: p.building, by: C.json([officer]), investigate: q.from, taken_at: q.at, kind: q.kind }));
          st.then = (out) => {
            if (out.status === "applied") return void asked.set(out.action, q);
            queue.unshift(q);
            const short = outOfTime(out);
            if (short?.who) used.set(short.who, p.working_day - short.left);
          };
          steps.push(st);
        }
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
    );
  },
};
