// police.station: a police station's officer in charge (docs/behaviour/crime.md; docs/design/world-expansion.md 7.2).
// The police keep the officers their establishment says (hired and paid like any employer's staff), take reports of
// goods taken, and investigate each: work at the station that finds who took them, with the world's chance (only the
// police learn it). Found: a charge to the tribunal, with what they found as evidence, asking that the taker make good
// what was taken. Not found: the report stays unsolved, as most do.
//
// They are also who comes to the door of someone who has died with nobody at home to say so (docs/behaviour/deaths.md):
// each working day they look at the town's homes, and a death in a home that has stood empty since is reported to the
// registry once the time it takes for such a person to be found has passed (the world's figures: found_after).

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import type { ParticipantAction, Observation } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, nextLook, outOfTime, say, stoodEmpty, type Step, usd } from "./common";
import { Staffing, stepper } from "./firms";

export const station: BehaviourModule = {
  name: "police.station",
  version: "0.2.0",
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
      // Found dead at home (docs/behaviour/deaths.md): the channel the town's homes are looked at through (asked for, once
      // a working day; none: no such calls are made), where a death is reported, how long after a death someone with
      // nobody at home is found (shares of such deaths found within so many days; the world's figures), and the
      // officer's time a call takes.
      homes_channel: "", registry: "",
      found_after: [] as { within_days: number; bps: number }[],
      call_seconds: 3600,
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
    // What investigations found, as each comes in (one done while the next is under way is seen then, not at our next
    // plan: until 2026-10-02 the first of two in a day was lost).
    const results = new Map<string, { taker?: string | null }>();
    // Deaths seen in a home with nobody in it: where, when, and when we come to its door (drawn once for each).
    const dead = new Map<string, { space: string; at: number; due: number }>();
    const told = new Set<string>();
    let homesAsOf = -1;
    let lookedDay = -1;
    /** How long until someone who has died with nobody at home is found: a band by its share, then any moment in it. */
    const foundAfter = (who: string): number => {
      const total = p.found_after.reduce((n, b) => n + b.bps, 0);
      if (total <= 0) return 0;
      const rng = ctx.rng(`found-${who}`);
      let x = rng.below(total);
      let from = 0;
      for (const b of p.found_after) {
        if (x < b.bps) return from * DAY + rng.below(Math.max(1, (b.within_days - from) * DAY));
        x -= b.bps;
        from = b.within_days;
      }
      return from * DAY;
    };
    const inner = stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        for (const o of obs.outcomes) if (o.investigated) results.set(o.action, o.investigated);
        const ch = obs.channels[p.channel];
        if (ch?.kind === "sites") for (const c of ch.cells) if (c.structure?.structure === p.building) view = c.structure;
        // The homes, as we last looked: a death in one nobody has been in or out of for a day since is ours to report;
        // one where somebody lives is theirs.
        const homes = p.homes_channel ? obs.channels[p.homes_channel] : undefined;
        if (homes?.kind === "sites" && homes.as_of !== homesAsOf) {
          homesAsOf = homes.as_of;
          const seen = new Set<string>();
          for (const c of homes.cells) for (const sp of c.structure?.spaces ?? []) for (const l of sp.left ?? []) {
            if (l.reason !== "died" || told.has(l.occupant) || !stoodEmpty(sp, homes.as_of)) continue;
            seen.add(l.occupant);
            if (!dead.has(l.occupant)) dead.set(l.occupant, { space: sp.space, at: l.at, due: l.at + foundAfter(l.occupant) });
          }
          for (const who of [...dead.keys()]) if (!seen.has(who)) dead.delete(who);
        }
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
        for (const [action, found] of [...results]) {
          const q = asked.get(action);
          if (!q) continue;
          asked.delete(action);
          results.delete(action);
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
        // Found dead at home: called at when the time has come, by an officer with the time for it that day; reported
        // to the registry, unless it has been registered since.
        const registered = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
        for (const [who, d] of [...dead].sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (registered.has(who)) {
            dead.delete(who);
            continue;
          }
          if (t < d.due || !p.registry) continue;
          const officer = here.find((w) => p.working_day - (used.get(w) ?? 0) >= p.call_seconds);
          if (!officer) break;
          used.set(officer, (used.get(officer) ?? 0) + p.call_seconds);
          dead.delete(who);
          told.add(who);
          steps.push(because(`Nobody has been in or out of ${d.space} since ${who} died there: called at, and reporting the death to the registry.`,
            say("death_notification", `${who} was found dead at ${d.space}.`, { to: [p.registry], data: { deceased: who, found_at: d.space } })));
        }
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
    if (!p.homes_channel) return inner;
    // Once a day we work, when the day's other business is in hand, a look at the town's homes (what it shows is acted
    // on at our next plan).
    return {
      step(obs: Observation): ParticipantAction {
        const action = inner.step(obs);
        const day = Math.floor(obs.t / DAY);
        if (action.type !== "wait" || day === lookedDay) return action;
        lookedDay = day;
        return { type: "look", looks: [{ channel: p.homes_channel }] };
      },
    };
  },
};
