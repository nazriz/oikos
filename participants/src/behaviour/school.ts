// school.principal: a school's principal (docs/behaviour/education.md; docs/design/world-expansion.md 4). The school
// keeps the teachers its establishment says (hired and paid like any employer's staff), gives a place to each child of
// school age who asks (enrolment), and on each school day has a teacher teach each classroom: work done to everyone in
// the room, which is what raises a pupil's skill (the world's physics). A pupil who leaves at the end of school gets a
// certificate of the years they were taught here and before. What a pupil learns is physics; what the school says of
// it is its own.

import * as C from "../calls";
import type { SiteStructure } from "../contracts";
import { basesOf } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, jobTerms, outOfTime, say, type Step } from "./common";
import { Staffing, stepper } from "./firms";
import { StandingWork } from "./common";
import * as P from "./papers";

/** Schooling: who goes to school (the ages), and what adults have had (their highest level, as years). */
export interface SchoolingSpec { school_ages: [number, number]; attainment: { label: string; share_bps: number; years: number }[] }

/** Years of schooling at an age: a child's, the years since starting (to the end of school); an adult's, drawn from the
 * attainment shares (`pick(n)`: a uniform draw below n). Shared by the world's generator and the migration office. */
export function yearsOfSchooling(age: number, s: SchoolingSpec, pick: (n: number) => number): number {
  if (age < 18) return Math.max(0, Math.min(age, s.school_ages[1] + 1) - s.school_ages[0]);
  const total = s.attainment.reduce((a, x) => a + x.share_bps, 0);
  let x = pick(Math.max(1, total));
  for (const a of s.attainment) {
    if (x < a.share_bps) return a.years;
    x -= a.share_bps;
  }
  return s.attainment.at(-1)?.years ?? 0;
}

export const principal: BehaviourModule = {
  name: "school.principal",
  answers: {"office": "the school", "acts": "It teaches the children who come to it on school days. It enrols nobody by letter."},
  routines: [
    { task: "teach", at: "building", every: 1, what: "Each school day, each classroom with pupils in it is taught by one of the teachers at work." },
    { task: "enrol", at: "building", every: 1, what: "The school office answers each enrolment: a place in the least full classroom for a child of school age, or a letter saying why not; and gives each leaver a certificate of their years." },
  ],
  issues: [P.JOB_ADVERTISEMENT],
  staffed: (p) => ({ role: p.role ?? "teacher", own: "role_or_unnamed", posts: { establishment: p.teachers ?? 0 } }),
  issuesWith: (p) => P.staffingOwn({ role: p.role ?? "teacher", industry: p.industry ?? "education", workplace: p.workplace, notice_days: p.notice_days ?? 14 }),
  keeps: [
    { what: "school_enrolment", why: "A school keeps its own roll: every pupil's enrolment is made with it." },
    { what: "school_place", why: "The places it has given, each to a pupil on its own roll." },
  ],
  version: "0.3.1", // 0.3.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.3.0: 0.3.0: its teachers report to the principal the lessons taught under the standing order, or why none were
  doc: "docs/behaviour/education.md",
  cadence: () => DAY,
  firstWake: (ctx) => 8 * 3600 + ctx.rng("first-wake").below(1800),
  create(ctx: ParticipantContext) {
    const p = params({
      building: "", workplace: "", // the school, and where its teachers work (the world must say)
      classrooms: [] as string[], // its classrooms (spaces of the building)
      account: "", // what it pays its staff from (its funding comes in there)
      teachers: 0, // the establishment: how many teachers it keeps (its funder's)
      role: "teacher", wage: 0, period: 14 * DAY, notice_days: 14, industry: "education",
      teach_task: "teach", working_day: 8 * 3600, lesson_seconds: 6 * 3600,
      starts: 8.5 * 3600, // when the school day starts (placeholder)
      // The school year: weekdays in term. A term is the first `term_days` of each 91 days (placeholder: 10 weeks of 13).
      term_days: 70,
      school_ages: [5, 17] as [number, number], // from the year one turns the first, to the end of the year one is the second
      year: 365 * DAY,
      channel: "premises", // its view of the building, who is where in it
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the office-holder alone, who sets the standing work orders; "staff" its staff, who follow them.
      part: "" as "" | "seat" | "staff",
    }, ctx.params);
    need(p, ["building", "workplace", "account"], "school.principal");
    const me = ctx.entity;
    const book = new Book();
    const routines = new StandingWork(me, p.part);
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, industry: p.industry, own: "role_or_unnamed" });
    let view: SiteStructure | undefined;
    const pupils = new Map<string, { since: number; years_before: number; born_at?: number }>(); // who's been in our classrooms
    const answered = new Set<string>();
    const certified = new Set<string>(); // pupils who've finished (or died): off the roll
    let taughtDay = -1;
    let reportDay = -1;
    let telling = false; // the school day has just begun: the teachers take stock
    const year = p.year;
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
        steps.push(...routines.set(book, [
          { task: p.teach_task, at: p.building, every: DAY, why: "Setting the teachers' work: every classroom with pupils taught each school day, as a standing work order." },
          { task: "enrol", at: p.building, every: DAY, why: "Setting the school office's work: enrolments answered and leavers' certificates given, as a standing work order." }]));
        const enrolling = routines.does(book, "enrol", t, { every: DAY });
        if (p.part !== "staff") steps.push(...staffing.routine(obs, book, p.account, { target: p.teachers, wage: p.wage, canPost: staffing.workers(book, t).length < p.teachers,
          why: `The school's establishment is ${p.teachers} teachers; we have ${staffing.workers(book, t).length}: posting a job.` }));

        // ---- enrolment: a place for each child of school age who asks, in the least full classroom ----
        const inRoom = (space: string) => [...new Set(view?.spaces.find((sp) => sp.space === space)?.occupants ?? [])];
        // (Our roll: the places we've given, the world's pupils' among them.)
        const placed = new Map(book.open("school_place").filter((x) => x.speaks_for === me).map((x) => [String((x.addressed_to ?? [])[0]), x]));
        for (const r of enrolling ? book.open("school_enrolment").filter((x) => (x.addressed_to ?? []).includes(me) && !answered.has(x.id)) : []) {
          answered.add(r.id);
          routines.did("enrol", t);
          const who = r.speaks_for!;
          if (placed.has(who)) continue; // (already has a place)
          const born = Number(r.data?.born_at);
          const age = Number.isFinite(born) ? Math.floor((t - born) / year) : -1;
          const ok = age >= p.school_ages[0] && age <= p.school_ages[1] && p.classrooms.length > 0;
          const room = [...p.classrooms].sort((a, b) => inRoom(a).length - inRoom(b).length || (a < b ? -1 : 1))[0];
          if (ok) pupils.set(who, { since: t, years_before: Number(r.data?.years_before ?? 0), born_at: born });
          steps.push(because(ok ? `A child of school age (${age}) asks for a place: offering one in ${room}.` : `An enrolment for someone not of school age (${age}): declined.`,
            say(ok ? "school_place" : "school_decline", ok ? `A place at the school, in ${room}.` : "No place: not of school age.", { to: [who], visible: [who, me], basis: r.id, data: ok ? { classroom: room, building: p.building } : {} })));
        }
        for (const [who, place] of placed) if (!pupils.has(who) && !certified.has(who)) {
          const e = book.records.get(basesOf(place)[0] ?? "") as any;
          pupils.set(who, { since: place.at, years_before: Number(e?.data?.years_before ?? 0), born_at: e ? Number(e.data?.born_at) : undefined });
        }

        // ---- a school day: each classroom with pupils, taught by a teacher at work ----
        const day = Math.floor(t / DAY);
        const schoolDay = day % 7 < 5 && day % 91 < p.term_days;
        if (schoolDay && taughtDay !== day && routines.does(book, p.teach_task, t, { every: DAY })) {
          taughtDay = day;
          const mine = new Set(staffing.workers(book, t));
          const here = inRoom(p.workplace).filter((w) => mine.has(w)).sort();
          const rooms = p.classrooms.filter((room) => inRoom(room).some((x) => !mine.has(x)));
          // (For the teachers' report: who taught, the classrooms left without a teacher, or that nobody of those in
          // post since before today was at the school.)
          const before = staffing.staff(book, t).filter((a: any) => (book.signedAt(a.id) ?? 0) < day * DAY).length;
          if (!here.length && before) routines.heldUp(p.teach_task, `none of the ${before} in post was at the school (${p.workplace}) when the school day began`);
          routines.note(p.teach_task, here.length && rooms.length > here.length ? `${rooms.length - here.length} classroom${rooms.length - here.length > 1 ? "s" : ""} with pupils had no teacher today` : undefined);
          telling = p.part === "staff" && (here.length > 0 || before > 0);
          rooms.forEach((room, i) => {
            const teacher = here[i];
            if (!teacher) return;
            routines.did(p.teach_task, t, { units: 1, by: [teacher] });
            const st = because(`A school day: ${teacher} teaches ${room} (${inRoom(room).length} pupils).`,
              C.call("work", { task: p.teach_task, units: "1", at: p.building, by: C.json([teacher]), on: room }));
            st.then = (out) => {
              if (out.status !== "applied") routines.undid(p.teach_task, { units: 1 });
              if (out.status !== "applied" && outOfTime(out)) taughtDay = -1; // (try again later today)
            };
            steps.push(st);
          });
        }

        // ---- leaving: a pupil past school age gets a certificate of their years (one who has died, nothing) ----
        const dead = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
        for (const [who, x] of enrolling ? pupils : []) {
          const age = x.born_at !== undefined && Number.isFinite(x.born_at) ? Math.floor((t - x.born_at) / year) : undefined;
          if (!dead.has(who) && (age === undefined || age <= p.school_ages[1])) continue;
          pupils.delete(who);
          certified.add(who);
          if (dead.has(who)) continue;
          const years = Math.round((x.years_before * year + (t - x.since)) / year);
          steps.push(because(`${who} has finished school: a certificate of ${years} years.`,
            say("school_certificate", `Certificate: ${who} completed ${years} years of school.`, { to: [who], visible: [who, me], data: { person: who, years, school: me } })));
        }
        // The teachers' report to the principal, once each school day (docs/behaviour/standing-work.md, "The staff's report").
        if (telling && reportDay !== day) {
          reportDay = day;
          const noPlace = staffing.staff(book, t).filter((a: any) => !jobTerms(a, a.terms.parties[1], book).workplace).map((a: any) => String(a.terms.parties[1]));
          steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: `the school's ${p.role}s`, tasks: { [p.teach_task]: ["lessons"], enrol: ["enrolments answered"] }, inPost: staffing.workers(book, t), noPlace }));
        }
        telling = false;
        return steps;
      },
      // (Next: the morning, when the school day starts; not wherever the news that last woke it left its cadence.)
      (obs) => (Math.floor(obs.t / DAY) + 1) * DAY + p.starts,
    );
  },
};
