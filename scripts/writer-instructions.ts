// Writes translator/train/in-situ/writer-instructions.txt from the words a seat is given for its tools
// (`inSituInstructions`, orchestrator/src/in-situ.ts): run after a seat's tool descriptions change, so that the file in
// the repo is what a writer would be told now (orchestrator/test/pipeline.test.ts holds the two equal).
//
//   bun scripts/writer-instructions.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inSituInstructions } from "../orchestrator/src/in-situ";

const file = join(import.meta.dir, "../translator/train/in-situ/writer-instructions.txt");
writeFileSync(file, inSituInstructions());
console.log(`written: ${file}`);
