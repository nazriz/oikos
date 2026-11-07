import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


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
  version: "0.7.0", // 0.7.0: the station's head (in_charge_role) is a sworn officer and takes the station's work after its officers when there (Rust); 0.6.0: run in parts where a model holds the office (part): the officers carry out warrants, look into reports and call at homes under standing work orders in force at the start, and report what they did; the office-holder hires and stands down officers and makes the orders; a station run by code is unchanged; 0.5.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.5.0: a warrant carried out says how many of the household were there and were put out (none, where nobody was: possession is given all the same); one its registrar has withdrawn is not gone on; 0.4.0: carries out a tribunal's warrant of possession, in an officer's hours (docs/behaviour/justice.md, "Possession"); 0.3.1: a death that someone at home outlived by more than a day is not "found" at a later call; 0.3.0: calls at a home when asked to (a welfare check), by going there; no longer shown the town's homes
  doc: "docs/behaviour/crime.md",
  cadence: () => DAY,
  firstWake: (ctx) => 10 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("police.station"),
};
