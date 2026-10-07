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
import { because, Book, DAY, outOfTime, say, type Step } from "./common";
import { Staffing, stepper } from "./firms";

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
  version: "0.2.0",
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
    }, ctx.params);
    need(p, ["building", "workplace", "account"], "school.principal");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, industry: p.industry });
    let view: SiteStructure | undefined;
    const pupils = new Map<string, { since: number; years_before: number; born_at?: number }>(); // who's been in our classrooms
    const answered = new Set<string>();
    const certified = new Set<string>(); // pupils who've finished (or died): off the roll
    let taughtDay = -1;
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
        steps.push(...staffing.routine(obs, book, p.account, { target: p.teachers, wage: p.wage, canPost: staffing.workers(book, t).length < p.teachers,
          why: `The school's establishment is ${p.teachers} teachers; we have ${staffing.workers(book, t).length}: posting a job.` }));

        // ---- enrolment: a place for each child of school age who asks, in the least full classroom ----
        const inRoom = (space: string) => [...new Set(view?.spaces.find((sp) => sp.space === space)?.occupants ?? [])];
        // (Our roll: the places we've given, the world's pupils' among them.)
        const placed = new Map(book.open("school_place").filter((x) => x.speaks_for === me).map((x) => [String((x.addressed_to ?? [])[0]), x]));
        for (const r of book.open("school_enrolment").filter((x) => (x.addressed_to ?? []).includes(me) && !answered.has(x.id))) {
          answered.add(r.id);
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
        if (schoolDay && taughtDay !== day) {
          taughtDay = day;
          const mine = new Set(staffing.workers(book, t));
          const here = inRoom(p.workplace).filter((w) => mine.has(w)).sort();
          const rooms = p.classrooms.filter((room) => inRoom(room).some((x) => !mine.has(x)));
          rooms.forEach((room, i) => {
            const teacher = here[i];
            if (!teacher) return;
            const st = because(`A school day: ${teacher} teaches ${room} (${inRoom(room).length} pupils).`,
              C.call("work", { task: p.teach_task, units: "1", at: p.building, by: C.json([teacher]), on: room }));
            st.then = (out) => {
              if (out.status !== "applied" && outOfTime(out)) taughtDay = -1; // (try again later today)
            };
            steps.push(st);
          });
        }

        // ---- leaving: a pupil past school age gets a certificate of their years (one who has died, nothing) ----
        const dead = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
        for (const [who, x] of pupils) {
          const age = x.born_at !== undefined && Number.isFinite(x.born_at) ? Math.floor((t - x.born_at) / year) : undefined;
          if (!dead.has(who) && (age === undefined || age <= p.school_ages[1])) continue;
          pupils.delete(who);
          certified.add(who);
          if (dead.has(who)) continue;
          const years = Math.round((x.years_before * year + (t - x.since)) / year);
          steps.push(because(`${who} has finished school: a certificate of ${years} years.`,
            say("school_certificate", `Certificate: ${who} completed ${years} years of school.`, { to: [who], visible: [who, me], data: { person: who, years, school: me } })));
        }
        return steps;
      },
      // (Next: the morning, when the school day starts; not wherever the news that last woke it left its cadence.)
      (obs) => (Math.floor(obs.t / DAY) + 1) * DAY + p.starts,
    );
  },
};
