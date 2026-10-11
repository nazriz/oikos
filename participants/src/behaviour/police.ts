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
import { because, Book, DAY, goSee, nextLook, outOfTime, say, type Step, usd, visited, VISIT_MAX } from "./common";
import { Staffing, stepper } from "./firms";
import * as P from "./papers";

export const station: BehaviourModule = {
  name: "police.station",
  answers: {"office": "the police station", "acts": "What it acts on: a report of a crime, which it investigates; and a request to call at a home where nobody has been seen."},
  issues: [P.JOB_ADVERTISEMENT, ...P.POLICE],
  staffed: (p) => ({ role: p.role ?? "police officer", posts: { establishment: p.officers ?? 0 } }),
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "police officer", industry: p.industry ?? "public_safety", workplace: p.workplace, notice_days: p.notice_days ?? 14 }), tribunal: p.tribunal, registry: p.registry }),
  version: "0.3.1", // 0.3.1: a death that someone at home outlived by more than a day is not "found" at a later call; 0.3.0: calls at a home when asked to (a welfare check), by going there; no longer shown the town's homes
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
    // Homes we are asked to call at, in the order asked; those an officer is on the way to; those whose dead we have reported.
    const calls: { request: string; space: string; structure: string }[] = [];
    const called = new Set<string>();
    const takenCalls = new Set<string>();
    const answered = new Set<string>(); // a home and the silence asked about (`space@since`): called at once
    const found: { who: string; space: string }[] = [];
    const told = new Set<string>();
    return stepper(

      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        for (const o of obs.outcomes) if (o.investigated) results.set(o.action, o.investigated);
        const ch = obs.channels[p.channel];
        if (ch?.kind === "sites") for (const c of ch.cells) if (c.structure?.structure === p.building) view = c.structure;
        // Asked to call at a home, taken as it comes in so that an officer sets out at this wake (once for each home and each silence: several neighbours may ask).
        for (const r of book.open("welfare_check_request").filter((x) => (x.addressed_to ?? []).includes(me) && !takenCalls.has(x.id))) {
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
        // Found dead at a home we called at: reported to the registry, unless we have been told it is registered.
        const registered = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
        for (const f of found.splice(0)) {
          if (registered.has(f.who) || !p.registry) continue;
          steps.push(because(`Called at ${f.space}, as we were asked to: ${f.who} was found dead there. Reporting the death to the registry.`,
            say("death_notification", `${f.who} was found dead at ${f.space}.`, { to: [p.registry], data: { deceased: f.who, found_at: f.space } })));
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
      // Going to the homes we are asked to call at (an officer's going: it takes the station's time; what is found
      // comes when they are back).
      () => {
        if (!p.calls_channel || !calls.length) return [];
        const go = calls.splice(0, VISIT_MAX);
        for (const c of go) called.add(c.space);
        return [goSee(p.calls_channel, [...new Set(go.map((c) => c.structure))])];
      },
    );
  },
};
