// One worker of the experiment harness (orchestrator/src/experiment.ts): `bun experiment-worker.ts <hand.json>`. Runs the
// bases and forks the hand names (its forks together, so their seats' calls are in flight at once) and writes the results
// where the hand says.
import { readFileSync, writeFileSync } from "node:fs";
import { workHand } from "./experiment";

const hand = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const results = await workHand(hand);
writeFileSync(hand.result, JSON.stringify(results));
