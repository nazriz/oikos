import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


export const auditor: BehaviourModule = {
  name: "office.auditor",
  answers: { office: "the audit office", acts: "What it acts on: the audit law, which says whom it audits and how often; it asks those bodies for named things, and examines what they answer. It acts on no letter." },
  issues: P.AUDIT,
  version: "0.1.0",
  doc: "docs/behaviour/auditor.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("office.auditor"),
};
