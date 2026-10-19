import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import { staffingForm } from "../readers/staffing";
import * as P from "../shared/papers";


export const environment: BehaviourModule = {
  name: "city.environment",
  answers: {"office": "the environment office", "acts": "What it acts on: the adopted budget's environment line, which sets its staff; and a direction on its staffing form from those the town's rule on directions names. It surveys the district's wildlife each quarter and publishes what it finds.", "forms": [{"about": ["staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "On staffing it follows a direction on its staffing form (environment_staffing) from those the town's rule on directions names, and no letter."}]},
  issues: [P.JOB_ADVERTISEMENT, ...P.PAYROLL, ...P.ENVIRONMENT],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "environmental scientist", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), planning: p.planning, payroll_office: p.payroll_office || undefined, budget_line: p.staff_line ?? "environment" }),
  staffed: (p) => ({ role: p.role ?? "environmental scientist", own: "role", posts: { budget_line: p.staff_line ?? "environment", wage: p.wage ?? 0, period: p.period ?? 14 * DAY } }),
  takes: [staffingForm("environment_staffing", "the environment office", "environmental scientists")],
  version: "0.5.2", // 0.5.2: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.5.1: 0.5.1: its notice of a new starter names the budget line the post is on; told not to recruit, it says what that does of an offer already made (it stands if signed); 0.5.0: sends the office that pays the town's staff a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"); 0.4.0: takes a written direction on its staffing (docs/behaviour/directions.md); 0.3.0: samples habitat from its own habitat map and asks the land registry which lot a cell is on; no longer shown the district or the register of lots
  doc: "docs/behaviour/environment.md",
  cadence: () => DAY,
  firstWake: (ctx) => 8 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("city.environment"),
};
