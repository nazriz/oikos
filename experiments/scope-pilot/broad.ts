// Assistants across the town (2026-11-16; docs/design/broad-seats.md, steps G3 and G9): the stakes run's town and
// settings, with assistants assigned by one spec line (`assistants`, build.ts) instead of the desk and three offices
// alone. Not yet run with a model: its limits are a dry run's (five dollars), for the code arm and mock forks only.
//
// THE SEATS (`OIKOS_SEATS`: 10, the default; 40; or busy):
//   10: the households' desk (one adult in three and everyone in difficulty, as the stakes run), and the assistants of a
//       factory, the finance office, the rates post, a shop, a landlord's office, the builder, the planning office,
//       the works office and the inspector. (Not the bank's lending office: a bank keeps its own account, and cannot yet
//       pay a provider's fee from it: risk MT-52.)
//   40: the desk and 39 organisations' assistants: all ten factories, thirteen shops, six landlords' offices, the finance
//       office, the rates post, the builder, planning, the inspector, the police, the energy
//       retailer, the mayor, the electoral office and the environment office (stage 2). Not seatable yet:
//       the bank's lending office (MT-52), the support office (MT-45), the utilities' billing (MT-46), the school and the
//       clinic (their only form is the job advertisement, and hiring is not offered: MT-51), and the auditor and the
//       complaints desks (the ombudsman's, the consumer desk's, the town's): none is a principal, since their bodies'
//       accounts are opened after the town's principals are made (MT-53); and the works office, whose holder also
//       holds the planning office and engages for one post only (MT-54).
//   busy: the counted whole-town run's seats (2026-11-16), chosen from the 40-seat code screen (30 days after the day-30
//       fork, seed 7, slow pace with offices' in-trays; matters handed to each seat in its month): every seat with two
//       or more. The desk (20), all ten factories (7 to 17 each), twelve shops (2 to 15: shops 1 to 9 and 11 to 13) and
//       the rates post (14): 24 seats. Dropped as thin, each handed one matter or none in the month: shop 10 (1), the
//       finance office (1, its monthly return), the energy retailer (1), the mayor, planning, the inspector, the
//       police, the builder, the electoral and environment offices and the six landlords' offices (0 each). A thin
//       seat adds a debrief and a seat-month and nothing to count. Read from one seed's one month: a seat near the
//       line may fall either side in another (the screen at more seeds would settle it; the design's own bar was about
//       five a seat-month, which would keep 16).
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
export const SEATS: { [n: string]: string[] } = {
  10: ["factory-1-manager", "finance", "rates", "shop-1-manager", "landlord-1-office", "builder-foreman", "planning", "works", "inspector"],
  // (Every factory; thirteen shops and six landlords' offices of the town's thirty and twenty, by number; and the town's offices
  // on the other side of the counter whose forms are of a class the offer takes: the police's charges,
  // the energy retailer's orders and answers, the mayor's approvals and answers to petitions, the electoral office's
  // notices and the environment office's register of habitats.)
  40: ["module:firm.producer", ...Array.from({ length: 13 }, (_, i) => `shop-${i + 1}-manager`), ...Array.from({ length: 6 }, (_, i) => `landlord-${i + 1}-office`),
    "finance", "rates", "builder-foreman", "planning", "inspector", "police-oic", "energy-operations", "mayor", "electoral", "environment"],
  // (The counted whole-town run's seats, chosen from the 40-seat code screen (header, "busy"): every seat of the 40 that
  // was handed two matters or more in its month.)
  busy: ["module:firm.producer", ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13].map((i) => `shop-${i}-manager`), "rates"],
};
/** The households' cohort, as the stakes run has it. */
export const PERSONS = { by: "hand", every: 3, only: true, difficulty: true } as const;

const n = process.env.OIKOS_SEATS ?? "10";
if (!SEATS[n]) throw new Error(`broad.ts: OIKOS_SEATS is one of ${Object.keys(SEATS).join(", ")}`);
export const ASSISTANTS: Assistants = { posts: SEATS[n]!, persons: { ...PERSONS } };

const ARMS: Arm[] = [{ name: "code", steward: { kind: "code" } }, modelArm(DEFAULT_MODEL, []).arm];
/** A dry run's limits: enough for the harness to admit the mock's seats and their debriefs (the mock spends nothing).
 * A real-model run sets its own, by the cost estimate, with the owner's go-ahead. */
const DRY = { experiment_usd: 5, arm_usd: { haiku: 5 } };

/** How the principals get to their post (`OIKOS_PACE`, default `slow`): the clients' post and, under `assistants`, each
 * office's in-tray (stage 1b): `slow` the study's stated shares, `ordinary` the profile's habits, `off` neither (a
 * client's post by the profile's habit; an office at its next wake, as before 2026-11-16). */
const pace = (process.env.OIKOS_PACE ?? "slow") as "slow" | "ordinary" | "off";
if (!["slow", "ordinary", "off"].includes(pace)) throw new Error("broad.ts: OIKOS_PACE is slow, ordinary or off");

export default build({ name: `scope-broad-${n}${pace === "slow" ? "" : `-${pace}`}`, days: 30, seeds: [7], reviewDays: 14, arms: ARMS, budget: DRY,
  assistants: ASSISTANTS, holdLevels: "run", depth: "matter", wants: true, obstacles: 2, dateOfEffect: "decision", ...(pace === "off" ? {} : { clientPost: pace }) });
