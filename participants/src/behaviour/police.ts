// police.station: a police station's officer in charge (docs/behaviour/crime.md; docs/design/world-expansion.md 7.2).
// The police keep the officers their establishment says (hired and paid like any employer's staff), take reports of
// goods taken, and investigate each: work at the station that finds who took them, with the world's chance (only the
// police learn it). Found: a charge to the tribunal, with what they found as evidence, asking that the taker make good
// what was taken. Not found: the report stays unsolved, as most do.
//
// They are also who comes to the door of someone who has died with nobody at home to say so (docs/behaviour/deaths.md).
// They do not look into homes: somebody asks them to call (a neighbour who has seen nobody come out, in the generated
// town). An officer goes to that one home, which takes the station's time (the way there and back, and the time at the
// door), goes in, and reports whoever is found dead there to the registry.

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import type { ParticipantAction, Observation } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, goSee, nextLook, outOfTime, say, StandingWork, type Step, usd, visited, VISIT_MAX } from "./common";
import { Staffing, stepper } from "./firms";
import * as P from "./papers";

export const station: BehaviourModule = {
  name: "police.station",
  answers: {"office": "the police station", "acts": "What it acts on: a report of a crime, which it investigates; and a request to call at a home where nobody has been seen."},
  // The station's routine, where a model holds the office (docs/behaviour/standing-work.md, "The police station"): its
  // officers do these by standing work order; whoever holds the office hires and stands down officers and makes the orders.
  routines: [
    { task: "carry_out_warrants", at: "workplace", every: 1, what: "On each working day an officer at the station carries out the tribunal's warrants of possession that have come to it, in the order they came and once the day each gives has come: the officer goes to the home and puts out whoever of the household is there, and the tenant and the landlord are told it is done and how many were there. A warrant its registrar has withdrawn is not gone on; one not carried out by its last day lapses and the landlord is told, and must ask again." },
    { task: "look_into_reports", at: "workplace", every: 1, what: "Each working day the officers at the station look into the reports of goods taken that have been made to it, in the order they came, as many as their hours allow (four hours each). Where they find who took them, they lay a charge before the tribunal with what they found as evidence; where they do not, the report is closed unsolved and the person who made it is told." },
    { task: "call_at_homes", at: "workplace", every: 1, what: "Each working day an officer goes to each home the station has been asked to call at, where a neighbour has seen nobody come out; if someone is found dead there who is not yet registered as dead, the death is reported to the registry." },
  ],
  issues: [P.JOB_ADVERTISEMENT, ...P.POLICE],
  staffed: (p) => ({ role: p.role ?? "police officer", own: "role_or_unnamed", posts: { establishment: p.officers ?? 0 } }),
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "police officer", industry: p.industry ?? "public_safety", workplace: p.workplace, notice_days: p.notice_days ?? 14 }), tribunal: p.tribunal, registry: p.registry }),
  version: "0.6.0", // 0.6.0: run in parts where a model holds the office (part): the officers carry out warrants, look into reports and call at homes under standing work orders in force at the start, and report what they did; the office-holder hires and stands down officers and makes the orders; a station run by code is unchanged; 0.5.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.5.0: a warrant carried out says how many of the household were there and were put out (none, where nobody was: possession is given all the same); one its registrar has withdrawn is not gone on; 0.4.0: carries out a tribunal's warrant of possession, in an officer's hours (docs/behaviour/justice.md, "Possession"); 0.3.1: a death that someone at home outlived by more than a day is not "found" at a later call; 0.3.0: calls at a home when asked to (a welfare check), by going there; no longer shown the town's homes
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
      // Welfare checks (docs/behaviour/deaths.md): the channel its officers go to a home through when asked to call
      // there (none: no calls are made), and where a death found is reported.
      calls_channel: "", registry: "",
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs it; "seat"
      // whoever holds it; "staff" its officers, who do the routine while a standing work order for it is in force.
      part: "" as "" | "seat" | "staff",
    }, ctx.params);
    need(p, ["building", "workplace", "account", "tribunal"], "police.station");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, industry: p.industry, own: "role_or_unnamed" });
    const routines = new StandingWork(me, p.part);
    const TASKS = { warrants: "carry_out_warrants", reports: "look_into_reports", calls: "call_at_homes" } as const;
    let callingNow = p.part === ""; // (whether the calls we are asked for are ours to make now: the plan says)
    let view: SiteStructure | undefined;
    const queue: { report: string; from: string; at: string; kind: string; value: number; account?: string }[] = [];
    const taken = new Set<string>();
    const used = new Map<string, number>();
    let usedDay = -1;
    const asked = new Map<string, (typeof queue)[number]>(); // an investigation under way -> its report
    // What investigations found, as each comes in (one done while the next is under way is seen then, not at our next
    // plan: until 2026-10-02 the first of two in a day was lost).
    const results = new Map<string, { taker?: string | null }>();
    // Homes we are asked to call at, in the order asked; those an officer is on the way to; those whose dead we have reported.
    const calls: { request: string; space: string; structure: string }[] = [];
    const called = new Set<string>();
    const takenCalls = new Set<string>();
    const answered = new Set<string>(); // a home and the silence asked about (`space@since`): called at once
    const found: { who: string; space: string }[] = [];
    const told = new Set<string>();
    // Warrants of possession sent us by a tribunal's registrar (docs/behaviour/justice.md, "Possession"): those not yet carried out.
    const warrants: { id: string; lease: string; tenant: string; landlord: string; structure: string; space: string; household: string[]; notBefore: number; until: number }[] = [];
    const takenWarrants = new Set<string>();
    return stepper(

      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        for (const o of obs.outcomes) if (o.investigated) results.set(o.action, o.investigated);
        const ch = obs.channels[p.channel];
        if (ch?.kind === "sites") for (const c of ch.cells) if (c.structure?.structure === p.building) view = c.structure;
        // Asked to call at a home, taken as it comes in so that an officer sets out at this wake (once for each home and each silence: several neighbours may ask).
        for (const r of routines.does(book, TASKS.calls, obs.t, { every: DAY }) ? book.open("welfare_check_request").filter((x) => (x.addressed_to ?? []).includes(me) && !takenCalls.has(x.id)) : []) {
          takenCalls.add(r.id);
          // (To the ground the home stands on, where the request says it: a building may be gone, its ground is there.)
          const space = String(r.data?.space ?? ""), structure = String(r.data?.at ?? r.data?.structure ?? "");
          const silence = `${space}@${r.data?.since ?? ""}`;
          if (!space || !structure || answered.has(silence)) continue;
          answered.add(silence);
          calls.push({ request: r.id, space, structure });
        }
        // What a call found: whoever died in the home we were asked about (having gone in, we see who left it and why).
        if (p.calls_channel) for (const c of visited(obs, p.calls_channel)) for (const sp of c.structure?.spaces ?? []) {
          if (!called.delete(sp.space)) continue;
          for (const l of sp.left ?? []) if (l.reason === "died" && !told.has(l.occupant)) {
            told.add(l.occupant);
            // Someone who went on living there after the death (they left the home more than a day after it) was at
            // home with it: the death was theirs to report, long ago, and is no finding of ours. Only a death nobody
            // at home outlived is found by a call. (Until 2026-10-11 every death the home had ever seen was "found":
            // a registrar was sent "found dead" of people it had registered 82 and 103 days before, wave 2c's review.)
            if ((sp.left ?? []).some((x) => x.occupant !== l.occupant && x.at > l.at + DAY)) continue;
            found.push({ who: l.occupant, space: sp.space });
          }
        }
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        steps.push(...routines.set(book, [
          { task: TASKS.warrants, at: p.workplace, every: DAY, why: "Setting the officers' work: the tribunal's warrants of possession carried out on their day, as a standing work order." },
          { task: TASKS.reports, at: p.workplace, every: DAY, why: "Setting the officers' work: reports of goods taken looked into, as a standing work order." },
          { task: TASKS.calls, at: p.workplace, every: DAY, why: "Setting the officers' work: homes the station is asked to call at, as a standing work order." }]));
        const carrying = !!routines.does(book, TASKS.warrants, t, { every: DAY }), looking = !!routines.does(book, TASKS.reports, t, { every: DAY }), calling = !!routines.does(book, TASKS.calls, t, { every: DAY });
        callingNow = calling;
        if (p.part !== "staff") steps.push(...staffing.routine(obs, book, p.account, { target: p.officers, wage: p.wage, canPost: staffing.workers(book, t).length < p.officers,
          why: `The station's establishment is ${p.officers} officers; we have ${staffing.workers(book, t).length}: posting a job.` }));
        // Reports of goods taken, in the order they came.
        for (const r of looking ? book.open("crime_report").filter((x) => (x.addressed_to ?? []).includes(me) && !taken.has(x.id)) : []) {
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
        // Found dead at a home we called at: reported to the registry, unless we have been told it is registered.
        const registered = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
        for (const f of calling ? found.splice(0) : []) {
          if (registered.has(f.who) || !p.registry) continue;
          steps.push(because(`Called at ${f.space}, as we were asked to: ${f.who} was found dead there. Reporting the death to the registry.`,
            say("death_notification", `${f.who} was found dead at ${f.space}.`, { to: [p.registry], data: { deceased: f.who, found_at: f.space } })));
        }
        // Warrants of possession: once the tenant has had the notice of the day the warrant gives, an officer with the
        // hours for it goes to the home on a working day and puts out
        // whoever of the household is there; the tenant and the landlord are told it is done. With no officer free
        // it waits for one; one not carried out by its last day lapses, and the landlord must ask again.
        for (const w of carrying ? book.open("warrant").filter((x) => (x.addressed_to ?? []).includes(me) && !takenWarrants.has(x.id)) : []) {
          takenWarrants.add(w.id);
          const d = w.data ?? {};
          if (typeof d.structure !== "string" || typeof d.tenant !== "string") continue;
          warrants.push({ id: w.id, lease: String(d.lease ?? ""), tenant: d.tenant, landlord: String(d.landlord ?? ""), structure: d.structure, space: String(d.space ?? ""), household: Array.isArray(d.household) ? (d.household as string[]) : [d.tenant], notBefore: Number(d.not_before) || 0, until: Number(d.until) || Infinity });
        }
        // (In the order they came; one whose day has not come waits, and those behind it with it: the list is short.)
        const due = warrants.filter((w) => t >= w.notBefore).length;
        let carried = 0;
        while (carrying && warrants.length && day % 7 < p.look_days) {
          const w = warrants[0]!;
          if (t < w.notBefore) break;
          if (t > w.until + DAY) {
            warrants.shift();
            steps.push(because(`The warrant ${w.id} ran out before an officer could carry it out: telling ${w.landlord}.`, say("warrant_lapsed", `Warrant ${w.id} was not carried out by its last day, and has lapsed.`, { to: [w.landlord], visible: [me, w.landlord], basis: w.id, data: { warrant: w.id, lease: w.lease } })));
            continue;
          }
          // (A warrant its registrar has withdrawn, the landlord having said the tenant is gone: nobody goes.)
          if (book.withdrawn.has(w.id)) { warrants.shift(); continue; }
          const officer = here.find((x) => p.working_day - (used.get(x) ?? 0) >= p.task_seconds);
          if (!officer) break;
          warrants.shift();
          carried++;
          routines.did(TASKS.warrants, t, { units: 1, by: [officer] });
          used.set(officer, (used.get(officer) ?? 0) + p.task_seconds);
          // (Each on their own: someone not at home is not there to be put out, and comes back to a home that is no
          // longer theirs. The warrant gives the landlord possession whoever is there; what the officer says is what
          // they found: how many of the household were put out, or that nobody was there and nobody was removed. An
          // officer cannot tell a home given up from one whose tenant is out for the day, so possession is given
          // either way and the tenant told. Until 2026-10-12 every warrant an officer went on was said to have put
          // the household out; in the fifth living pilot 11 of 23 had put out nobody.)
          let put = 0;
          w.household.forEach((who, i) => {
            const st = because(`Carrying out warrant ${w.id} at ${w.space}: putting ${who} out, if they are there.`, C.call("occupancy", { in: w.structure, who, leave: "yes" }));
            st.then = (out) => {
              if (out.status === "applied") put++;
              if (i < w.household.length - 1) return;
              const hours = Math.round(p.task_seconds / 3600);
              return [because(put > 0 ? `Warrant ${w.id} carried out at ${w.space} (${hours} hours of an officer's day): ${put} of the household put out; possession is ${w.landlord}'s. Telling both.`
                  : `Warrant ${w.id} carried out at ${w.space} (${hours} hours of an officer's day): nobody of the household was there, and nobody was removed; possession is ${w.landlord}'s. Telling both.`,
                say("warrant_executed", `Warrant ${w.id} has been carried out at ${w.space}: of ${w.tenant} and their household, ${put} were there and were put out. Possession is ${w.landlord}'s.`, { to: [w.tenant, w.landlord], visible: [...new Set([me, w.tenant, w.landlord, ...w.household])], basis: w.id, data: { warrant: w.id, lease: w.lease, tenant: w.tenant, space: w.space, household: w.household, removed: put } }))];
            };
            steps.push(st);
          });
        }
        // (What the officers say of the warrants: those whose day has come that no officer at the station had the hours for.)
        if (carrying && due > carried && warrants.length) routines.heldUp(TASKS.warrants, `${warrants.length} warrant${warrants.length === 1 ? "" : "s"} waiting, ${here.length ? "and none of the officers at the station had the hours for it" : `and none of the ${staffing.workers(book, t).length} in post was at the station (${p.workplace}) when the day's work was set out`}`);
        routines.note(TASKS.warrants, warrants.length ? `${warrants.length} still waiting, the oldest ${warrants[0]!.id}` : undefined);
        let looked = 0;
        while (looking && queue.length) {
          const officer = here.find((w) => p.working_day - (used.get(w) ?? 0) >= p.task_seconds);
          if (!officer) break;
          const q = queue.shift()!;
          looked++;
          routines.did(TASKS.reports, t, { units: 1, by: [officer] });
          used.set(officer, (used.get(officer) ?? 0) + p.task_seconds);
          const st = because(`Investigating report ${q.report}: ${q.kind} taken from ${q.from} at ${q.at}.`,
            C.call("work", { task: p.task, units: "1", at: p.building, by: C.json([officer]), investigate: q.from, taken_at: q.at, kind: q.kind }));
          st.then = (out) => {
            if (out.status === "applied") return void asked.set(out.action, q);
            queue.unshift(q);
            routines.undid(TASKS.reports, { units: 1 });
            const short = outOfTime(out);
            if (short?.who) used.set(short.who, p.working_day - short.left);
          };
          steps.push(st);
        }
        if (looking && queue.length) routines.note(TASKS.reports, `${queue.length} report${queue.length === 1 ? "" : "s"} waiting for an officer's hours`);
        else routines.note(TASKS.reports, undefined);
        if (calling && calls.length) routines.note(TASKS.calls, `${calls.length} home${calls.length === 1 ? "" : "s"} still to call at`);
        if (p.part === "staff" && t >= DAY / 2) steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the station's officers",
          tasks: { [TASKS.warrants]: ["days' work", "warrants carried out"], [TASKS.reports]: ["days' work", "reports looked into"], [TASKS.calls]: ["days' work", "homes called at"] }, inPost: staffing.workers(book, t) }));
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
      // Going to the homes we are asked to call at (an officer's going: it takes the station's time; what is found
      // comes when they are back).
      () => {
        if (!p.calls_channel || !calls.length || !callingNow) return [];
        const go = calls.splice(0, VISIT_MAX);
        for (const c of go) called.add(c.space);
        return [goSee(p.calls_channel, [...new Set(go.map((c) => c.structure))])];
      },
    );
  },
};
