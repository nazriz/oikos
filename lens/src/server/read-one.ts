// One fork's study reading, in its own process (the server's background loop starts one at a time, so reading a
// 4.6-million-line fork never holds up the server's answers): `bun read-one.ts <log> <ReadingInput as JSON>` prints
// the ForkReading as JSON, or `null` where the study's reader does not apply.
import { readOnly } from "./ingest";

const [log, input] = process.argv.slice(2);
if (!log || !input) {
  console.error("usage: bun read-one.ts <log> <reading input json>");
  process.exit(2);
}
const r = await readOnly(log, JSON.parse(input));
process.stdout.write(JSON.stringify(r ?? null));
