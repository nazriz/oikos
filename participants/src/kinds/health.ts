import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


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
  create: inEngine("clinic.practice"),
};
