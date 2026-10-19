import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


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
  create: inEngine("school.principal"),
};
