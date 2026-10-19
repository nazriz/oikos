import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";


/**
 * office.clerk: the staff post of an office that has no routine work of its own to give its staff, where a model
 * holds the office: a clerk who keeps the office's books (`of`: the module that runs the office when code does;
 * `with`: the office's own parameters) and does nothing else of the office's business.
 */
export const clerk: BehaviourModule = {
  name: "office.clerk",
  version: "0.3.1", // 0.3.1: a new clerk carries on from the last paper of the books on the organisation's file, so what left the list since is said (bug hunt 2026-10-17); 0.3.0: the paper's words set out every case whose day has come in full (up to sixty; twelve before), and say how many are on the day's list for the first time (`data.list`: `ripe`, `new`), which is what brings a seat back; 0.2.0: what waits on the office-holder with its day come is named first in every paper, however long it has stood; what moves heading is not said to be closed; a list too long says what it leaves out; 0.1.1: a running figure that has moved is filed once the last paper is a week old; 0.1.0: keeps the books of an office a model holds, and files what has changed
  doc: "docs/behaviour/office-books.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3_600 + ctx.rng("first-wake").below(3 * 3_600),
  create: inEngine("office.clerk"),
};
