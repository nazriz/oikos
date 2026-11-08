// Translator v4, round 2, step 2c: batch 1's data (joined-v4a: the rows in real seats' cards and the assistants' papers)
// with the scope pilot's keyed train-side requests, four times (the design's weight for real requests).
//   bun translator/train/v4-pilot/join.ts <joined-v4a dir> <keyed dir> <out dir> [--repeat 4]
// validation, validation-real and validation-uf are batch 1's as they were (so before and after read the same sets);
// the pilot's validation side and test side stay in the keyed folder, never joined. A train row whose source is a
// test-side seat-day would be refused here (it cannot be: keep.ts writes the sides apart; this is the backstop).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const [base, keyed, out] = args;
if (!base || !keyed || !out) throw new Error("usage: bun join.ts <joined-v4a> <keyed> <out> [--repeat N]");
const repeat = Number(args[args.indexOf("--repeat") + 1] ?? 4) || 4;
const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
mkdirSync(out, { recursive: true });
const pilot = lines(join(keyed, "train.jsonl"));
const split = JSON.parse(readFileSync(join(keyed, "split.json"), "utf8")).seat_days as { [day: string]: string };
const testDays = new Set(Object.entries(split).filter(([, s]) => s !== "train").map(([d]) => d));
for (const l of pilot) {
  const r = JSON.parse(l);
  if (r.groups?.side !== "train" || testDays.has(r.groups?.seat_day)) throw new Error(`${r.id}: not a train-side row`);
}
const train = lines(join(base, "train.jsonl"));
writeFileSync(join(out, "train.jsonl"), [...train, ...Array.from({ length: repeat }, () => pilot).flat()].join("\n") + "\n");
for (const f of ["validation.jsonl", "validation-real.jsonl", "validation-uf.jsonl"]) copyFileSync(join(base, f), join(out, f));
const manifest = { from: base, keyed, pilot_train_rows: pilot.length, repeat, train_rows: train.length + repeat * pilot.length, test_and_validation_seat_days_checked: testDays.size };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest));
