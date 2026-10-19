import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import { hearingNotice, type Hears } from "../shared/hearings";
import * as P from "../shared/papers";


/** What the union says it takes up for its members: its public notice. */
const unionHears = (me: string, hears: Hears[]) => hearingNotice(me, "The union takes up for its members", hears.map((h) => ({ ...h, can: ["represent"] as Hears["can"] })), { members_of: me, members_apply: true });

export const organiser: BehaviourModule = {
  name: "union.organiser",
  answers: {"office": "the union's office", "acts": "What it acts on: an application to join; its members' votes on its ballots; and an employer's answer to a claim it has made."},
  issues: P.UNION,
  opens: (p, me) => ((p.hears ?? []).length ? [unionHears(me, p.hears)] : []),
  version: "0.8.0", // 0.7.0: weighs its members' lost pay: after a stoppage it strikes again only while the pay a stoppage costs them is less than the rest of the gap would add over a year, else it takes the standing offer or lets the dispute rest (docs/behaviour/unions.md, "Concession"); 0.6.1: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.0: takes up a member's grievance with their employer, where the world says it hears such (docs/behaviour/frictions.md)
  doc: "docs/behaviour/unions.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("union.organiser"),
};
