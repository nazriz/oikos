// Assistants across the town (2026-11-16; docs/design/broad-seats.md, steps G3 and G9): the stakes run's town and
// settings, with assistants assigned by one spec line (`assistants`, build.ts) instead of the desk and three offices
// alone. Not yet run with a model: its spending limits are nought, so only the code arm and mock forks run on it.
//
// THE SEATS (`OIKOS_SEATS`, default 10):
//   10: the households' desk (one adult in three and everyone in difficulty, as the stakes run), and the assistants of a
//       factory, the finance office, the rates post, a shop, a landlord's office, the builder, the bank's lending
//       office, the planning office and the works office.
//   (40 seats come with stage 2.)
// Every other organisation is offered no assistant (`only`). The offers take paperwork by class (G3): a principal hands
// over the kinds its own forms put in a class the offer takes; a shop's till receipts are not among them.
//
// SCREEN IT (code only, no model):
//   bun experiments/scope-pilot/screen.ts experiments/scope-pilot/broad.ts --out <dir outside runs/>
// A MOCK FORK (every model seat played by the mock):
//   OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/broad.ts --out <dir> --mock-models
import type { Arm } from "../../orchestrator/src/experiment";
import { build, type Assistants } from "./build";
import { DEFAULT_MODEL, modelArm } from "./model-arm";

/** The organisations' posts assigned at each size (post ids of the study town; `module:<code>` assigns every post of a
 * module). */
export const SEATS: { [n: number]: string[] } = {
  10: ["factory-1-manager", "finance", "rates", "shop-1-manager", "landlord-1-office", "builder-foreman", "bank-lending", "planning", "works"],
};
/** The households' cohort, as the stakes run has it. */
const PERSONS = { by: "hand", every: 3, only: true, difficulty: true } as const;

const n = Number(process.env.OIKOS_SEATS ?? 10);
if (!SEATS[n]) throw new Error(`broad.ts: OIKOS_SEATS is one of ${Object.keys(SEATS).join(", ")}`);
export const ASSISTANTS: Assistants = { posts: SEATS[n]!, persons: { ...PERSONS } };

const ARMS: Arm[] = [{ name: "code", steward: { kind: "code" } }, modelArm(DEFAULT_MODEL, []).arm];

export default build({ name: `scope-broad-${n}`, days: 30, seeds: [7], reviewDays: 14, arms: ARMS, budget: { experiment_usd: 0, arm_usd: {} },
  assistants: ASSISTANTS, holdLevels: "run", depth: "matter", wants: true, obstacles: 2, dateOfEffect: "decision", clientPost: "slow" });
