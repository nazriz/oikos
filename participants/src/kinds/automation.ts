import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";


/**
 * The outside world's seller of systems. It sells what its profile lists, at the profile's prices as of the month (held fixed,
 * or moving at the rate the world gives: a scenario's, from the first day). Orders are paid with the order, as any order to a
 * seller is; it delivers, and offers the licence. It owns nothing in the town: what the town pays leaves it.
 */
export const vendor: BehaviourModule = {
  name: "world.vendor",
  version: "0.1.0",
  doc: "docs/behaviour/automation.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("world.vendor"),
};
