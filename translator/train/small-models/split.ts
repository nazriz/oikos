// Small models' requests, step 2 (before any keying): split by seat-day into train and a held-out test side, within each
// writing model (a seeded hash orders its seat-days; the first 30%, rounded up, are test), then deduplicated, so the
// readers are not asked the same thing twice.
//   bun translator/train/small-models/split.ts <collect dir> <out dir>
// Only requests that reached the translator are keyed (the rest it never saw: counted in collect's described.json).
// A request is its words with its cards. Within a side, repeats are one request (how many times it was said is kept).
// A train-side request in the same words as a test-side one is dropped from train (counted): the 7B model repeats
// itself across runs of the same town, and the test side must be requests the trained model never saw.
// Written: requests.jsonl (each distinct request with its side, model, seat-days and the outcomes of its sayings),
// blind.jsonl (shuffled {id, request, forms}; ids are hashes), split.json, counts.json.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prng, shuffle } from "../v4-assistants/lib";

export const SPLIT_SEED = "translator-small-models-2026-11-11";
const [collect, out] = process.argv.slice(2);
if (!collect || !out) throw new Error("usage: bun split.ts <collect dir> <out dir>");
const TEST_SHARE = 0.3;
const h = (s: string) => createHash("sha256").update(`${SPLIT_SEED}|${s}`).digest("hex");
const all: any[] = readFileSync(join(collect, "requests.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const reached = all.filter((r) => r.draft);

const days = new Map<string, string>();
for (const r of reached) days.set(r.seat_day, r.model);
const side = new Map<string, "train" | "test">();
for (const m of [...new Set(days.values())].sort()) {
  const ks = [...days.entries()].filter(([, x]) => x === m).map(([k]) => k).sort((a, b) => (h(a) < h(b) ? -1 : 1));
  const nTest = Math.ceil(ks.length * TEST_SHARE);
  ks.forEach((k, i) => side.set(k, i < nTest ? "test" : "train"));
}

const words = (r: any) => r.request.replace(/[\r\n]+/g, " ").trim();
const keyOf = (r: any) => `${words(r)}\u0000${r.forms.join("\n")}`;
const distinct = new Map<string, any>();
for (const r of reached) {
  const s = side.get(r.seat_day)!;
  const k = `${s}\u0001${keyOf(r)}`;
  const d = distinct.get(k) ?? { id: `sm-${h(k).slice(0, 12)}`, request: words(r), forms: r.forms, ...(r.currency ? { currency: r.currency } : {}), side: s, model: r.model, said: 0, seat_days: [] as string[], sources: [] as string[], outcomes: {} as any, signed: {} as any, ours: [] as any[], asked_back_with: [] as string[], self_talk: r.self_talk, english: r.english, unseen_ids: r.unseen_ids };
  d.said++;
  if (!d.seat_days.includes(r.seat_day)) d.seat_days.push(r.seat_day);
  d.sources.push(r.source);
  d.outcomes[r.outcome] = (d.outcomes[r.outcome] ?? 0) + 1;
  if (r.signed) d.signed[r.signed] = (d.signed[r.signed] ?? 0) + 1;
  if (r.ours && d.ours.length < 3) d.ours.push(r.ours);
  if (r.asked_back_with && !d.asked_back_with.includes(r.asked_back_with)) d.asked_back_with.push(r.asked_back_with);
  distinct.set(k, d);
}
const testWords = new Set([...distinct.values()].filter((d) => d.side === "test").map((d) => d.request));
let droppedFromTrain = 0;
const rows = [...distinct.values()].filter((d) => (d.side === "train" && testWords.has(d.request) ? (droppedFromTrain++, false) : true));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "split.json"), JSON.stringify({ seed: SPLIT_SEED, rule: `by seat-day, within each writing model: ${TEST_SHARE * 100}% (rounded up) test by seeded hash; the rest train`, seat_days: Object.fromEntries([...side.entries()].sort()) }, null, 1));
writeFileSync(join(out, "requests.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const blind = shuffle(prng(2026_11_11), rows.map((r) => ({ id: r.id, request: r.request, forms: r.forms })));
writeFileSync(join(out, "blind.jsonl"), blind.map((b) => JSON.stringify(b)).join("\n") + "\n");
const counts: any = { reached: reached.length, distinct_by_side: rows.length, train_dropped_same_words_as_test: droppedFromTrain, by_model: {} };
for (const [k, m] of days) ((counts.by_model[m] ??= { seat_days: { train: 0, test: 0 }, said: { train: 0, test: 0 }, distinct: { train: 0, test: 0 } }).seat_days[side.get(k)!]++);
for (const r of reached) counts.by_model[r.model].said[side.get(r.seat_day)!]++;
for (const r of rows) counts.by_model[r.model].distinct[r.side]++;
writeFileSync(join(out, "counts.json"), JSON.stringify(counts, null, 1));
console.log(JSON.stringify(counts, null, 1));
