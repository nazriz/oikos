import { inEngine } from "../in-engine";
import { hearingNotices } from "../shared/hearings";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


export const desk: BehaviourModule = {
  name: "office.desk",
  opens: (p, me) => ((p.hears ?? []).length && p.part !== "staff" ? hearingNotices(me, `The ${p.title ?? "desk"} hears`, p.hears, { fee: p.fee, account: p.account, members_of: p.members_of }) : []),
  // (Its counter: docs/behaviour/standing-work.md. What is routine is what the procedure settles on the record.)
  routines: [{ task: "answer", at: "office", every: 1, what: "The desk's staff take in each application, tell the one it is against and give them time to answer, and decide what the record settles: the other side's own answer, no answer at all, or a paper the applicant can show. A case the record cannot settle is put before the office-holder.",
    papers: [
      { kind: "application", how: "taken in; the one it is against is told and given time to answer; decided on the record when that time has run, or put before the office-holder" },
      { kind: "complaint_response", how: "filed with its application, which is decided on it when the time to answer has run" },
    ] }],
  answers: { office: "the desk", acts: "What it acts on: an application made to it about something it has said it hears, which it puts to the other side and decides by its procedure." },
  issues: P.DESK,
  version: "0.2.0", // 0.2.0: an application that states no particulars (nothing of what it is about) is dismissed with leave to apply again, as a member would (docs/behaviour/justice.md, "Particulars"); 0.1.2: as the tribunal: a withdrawn application is no case, and cases already listed on its own file are taken as they stand; 0.1.1: what the record cannot settle is drawn by who applied against whom about what, not by the application's number on file; its notice of what it hears is on file when a seat arrives; 0.1.0: a body that hears grievances (docs/behaviour/frictions.md)
  doc: "docs/behaviour/frictions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("office.desk"),
};
