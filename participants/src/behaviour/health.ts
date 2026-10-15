// clinic.practice: a clinic's practice manager (docs/behaviour/health.md; docs/design/world-expansion.md 4). The clinic
// keeps the doctors its establishment says (hired and paid like any employer's staff) and sees patients who come in and
// ask for care, in the order they asked, as many as its doctors' hours allow each working day. Seeing a patient is work
// done to their body: the world's physics says what care does to a condition. The clinic tells the patient they've
// been seen; what it did for them they feel for themselves.

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, jobTerms, outOfTime, say, StandingWork, type Step } from "./common";
import { Staffing, stepper } from "./firms";
import * as P from "./papers";

const HOUR = 3600;

export const practice: BehaviourModule = {
  name: "clinic.practice",
  answers: {"office": "the clinic", "acts": "It sees whoever comes to it during its hours. It makes no appointment by letter."},
  routines: [{ task: "treat", at: "building", every: 1, what: "Each working day, in the hours the clinic is open, its doctors see those who have asked for care and are waiting, in the order they asked, as far as the doctors' hours go, and each patient is told they have been seen." }],
  issues: [P.JOB_ADVERTISEMENT],
  staffed: (p) => ({ role: p.role ?? "doctor", own: "role_or_unnamed", posts: { establishment: p.doctors ?? 0 } }),
  issuesWith: (p) => P.staffingOwn({ role: p.role ?? "doctor", industry: p.industry ?? "health_care", workplace: p.workplace, notice_days: p.notice_days ?? 14 }),
  version: "0.3.1", // 0.3.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.3.0: 0.3.0: its doctors report to the manager who was seen under the standing order, or why nobody was
  doc: "docs/behaviour/health.md",
  // (When it opens each working day, and whenever a patient asks: someone who comes in and asks is seen then, if it's
  // open.)
  cadence: () => DAY,
  firstWake: (ctx) => 8 * HOUR + ctx.rng("first-wake").below(HOUR),
  create(ctx: ParticipantContext) {
    const p = params({
      building: "", workplace: "", waiting: "", // the clinic, where its doctors work, and its waiting room (the world must say)
      account: "", // what it pays its staff from (its funding comes in there)
      doctors: 0, // the establishment (its funder's)
      role: "doctor", wage: 0, period: 14 * DAY, notice_days: 14, industry: "health_care",
      treat_task: "treat", consult_seconds: 1800, working_day: 8 * HOUR, work_days: 5,
      opens: 8 * HOUR, closes: 18 * HOUR, // the hours it sees patients (placeholder)
      // How many consultations a condition takes, by kind and severity (what its doctors know of care); anything else, one.
      consults: [] as { kind: string; severity?: string; consults: number }[],
      give_up_days: 3, // a patient who asked and isn't here after this long is dropped from the list
      channel: "premises", // its view of the building, who is where in it
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the office-holder alone, who sets the standing work orders; "staff" its staff, who follow them.
      part: "" as "" | "seat" | "staff",
    }, ctx.params);
    need(p, ["building", "workplace", "waiting", "account"], "clinic.practice");
    const me = ctx.entity;
    const book = new Book();
    const routines = new StandingWork(me, p.part);
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, industry: p.industry, own: "role_or_unnamed" });
    let view: SiteStructure | undefined;
    const queue: { request: string; patient: string; kind: string; severity: string; at: number }[] = [];
    const queued = new Set<string>();
    const used = new Map<string, number>(); // doctor -> seconds worked today
    let usedDay = -1;
    let reportDay = -1;
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
        steps.push(...routines.set(book, [{ task: p.treat_task, at: p.building, every: DAY, why: "Setting the doctors' work: those waiting are seen each working day, as a standing work order." }]));
        // (Taking on and paying the doctors is the office-holder's; its staff, where they are a post of their own, see patients.)
        if (p.part !== "staff") steps.push(...staffing.routine(obs, book, p.account, { target: p.doctors, wage: p.wage, canPost: staffing.workers(book, t).length < p.doctors,
          why: `The clinic's establishment is ${p.doctors} doctors; we have ${staffing.workers(book, t).length}: posting a job.` }));

        // Who's asked for care, in the order they asked.
        for (const r of book.open("care_request").filter((x) => (x.addressed_to ?? []).includes(me) && !queued.has(x.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
          queued.add(r.id);
          queue.push({ request: r.id, patient: r.speaks_for!, kind: String(r.data?.kind ?? ""), severity: String(r.data?.severity ?? ""), at: r.at });
        }
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        // Those who asked and never came, long enough ago, are dropped.
        for (let i = queue.length - 1; i >= 0; i--) if (t - queue[i]!.at > p.give_up_days * DAY) queue.splice(i, 1);
        const open = day % 7 < p.work_days && t % DAY >= p.opens && t % DAY < p.closes;
        // (Closed: those who asked are seen when it opens, at its morning look.)
        const inRoom = (space: string) => [...new Set(view?.spaces.find((sp) => sp.space === space)?.occupants ?? [])];
        const mine = new Set(staffing.workers(book, t));
        const doctors = inRoom(p.workplace).filter((w) => mine.has(w)).sort();
        // The doctors' report to the manager, once each day the clinic opens: who was seen, or that nobody of those
        // in post (since before today) was at the clinic (docs/behaviour/standing-work.md, "The staff's report").
        const tell = (): Step[] => {
          if (p.part !== "staff" || !open || reportDay === day) return [];
          const before = staffing.staff(book, t).filter((a: any) => (book.signedAt(a.id) ?? 0) < day * DAY).length;
          if (!doctors.length && !before) return [];
          reportDay = day;
          if (!doctors.length && routines.order(book, p.treat_task, t)) routines.heldUp(p.treat_task, `none of the ${before} in post was at the clinic (${p.workplace}) when it opened`);
          const noPlace = staffing.staff(book, t).filter((a: any) => !jobTerms(a, a.terms.parties[1], book).workplace).map((a: any) => String(a.terms.parties[1]));
          return routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: `the clinic's ${p.role}s`, tasks: { [p.treat_task]: ["patients seen", "consultations"] }, inPost: [...mine].sort(), noPlace });
        };
        if (!open || !queue.length || !routines.does(book, p.treat_task, t, { every: DAY })) return [...steps, ...tell()];
        const waiting = new Set(inRoom(p.waiting));
        for (const q of [...queue]) {
          if (!waiting.has(q.patient)) continue;
          const units = p.consults.find((c) => c.kind === q.kind && (!c.severity || c.severity === q.severity))?.consults ?? 1;
          const need = units * p.consult_seconds;
          const doctor = doctors.find((d) => p.working_day - (used.get(d) ?? 0) >= need);
          if (!doctor) break; // (the doctors' day is full: the rest wait)
          used.set(doctor, (used.get(doctor) ?? 0) + need);
          queue.splice(queue.indexOf(q), 1);
          routines.did(p.treat_task, t, { units, by: [doctor] });
          const st = because(`${q.patient} is waiting with a ${q.severity} ${q.kind}: ${doctor} sees them (${units} consultation${units === 1 ? "" : "s"}).`,
            C.call("work", { task: p.treat_task, units: String(units), at: p.building, by: C.json([doctor]), on: q.patient }),
            say("consultation", `You've been seen at the clinic.`, { to: [q.patient], visible: [q.patient, me], basis: q.request, data: { request: q.request, by: doctor } }));
          st.then = (out) => {
            if (out.status === "applied") return;
            // (Not seen after all: back in the queue, first.)
            queue.unshift(q);
            routines.undid(p.treat_task, { units });
            const short = outOfTime(out);
            if (short?.who) used.set(short.who, p.working_day - short.left);
          };
          steps.push(st);
        }
        steps.push(...tell());
        return steps;
      },
      // (Next: when it next opens, unless it's open now and news comes first. A wake on its cadence would drift with
      // the news that woke it, to hours it's closed.)
      (obs) => {
        const t = obs.t;
        for (let d = Math.floor(t / DAY); ; d++) {
          const at = d * DAY + p.opens;
          if (d % 7 < p.work_days && at > t) return at;
        }
      },
    );
  },
};
