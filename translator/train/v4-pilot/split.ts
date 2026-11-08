// Translator v4, round 2, step 1: the scope pilot's real requests split by code, before any keying
// (docs/design/translator-v4.md, section 3: "before the Claude pilot's requests are keyed, a third of its seat-days
// (seeded, by seat-day) are made test-only").
//   bun translator/train/v4-pilot/split.ts <in-situ dir> <arms dir> <out dir>
// <in-situ dir>: `oikos in-situ` over the pilot's model arms (real-unlabelled.jsonl); <arms dir>: one folder an arm,
// each with `ds/log.dataset/translations.jsonl` (`oikos dataset`), for the seat's own sign-off of each draft.
// A seat-day is one seat of one arm of one seed on one day. Within each seat model, its seat-days are ordered by a
// seeded hash and the first third (rounded up) is test-only: every request of a test seat-day is test, never trained,
// rewritten or tuned on. One in ten of the remaining seat-days of each model (by the same order) is validation (kept
// out of training, used for calibration with validation-real). Written: split.json (each seat-day and its side),
// requests.jsonl (every request, with its side, model, seat-day, the draft the seat signed and its decision),
// blind.jsonl (shuffled {id, request, forms}: ids that say nothing of model, side or seat), counts.json.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prng, shuffle } from "../v4-assistants/lib";

export const SPLIT_SEED = "translator-v4-r2-split-2026-11-08";
const [inSitu, arms, out] = process.argv.slice(2);
if (!inSitu || !arms || !out) throw new Error("usage: bun split.ts <in-situ dir> <arms dir> <out dir> [--all validation]");
// --all validation (round 4): arms of pilot rounds after the split (4 and 5), none of whose requests was trained on and
// none of whose seat-days is a test seat-day (a seat-day names its arm), all made validation, for certifying a cut-off.
const allTo = process.argv.includes("--all") ? (process.argv[process.argv.indexOf("--all") + 1] as "validation") : undefined;
const jsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const h = (s: string) => createHash("sha256").update(`${SPLIT_SEED}|${s}`).digest("hex");

const real = jsonl(join(inSitu, "real-unlabelled.jsonl"));
// situation id: <runs-relative arms dir>/<arm>/<seat>/d<day>/<n>
const armOf = (sit: string) => sit.split("/").at(-4)!;
const seatDayOf = (sit: string) => sit.split("/").slice(-4, -1).join("/");
const modelOf = (w: string) => w.replace(/ \(seat\)$/, "");

// The seat's own sign-off of each draft: what it confirmed (the drafted program) or declined.
const signed = new Map<string, { decision: string | null; call?: string; result?: string; by?: string }>();
for (const r of real) {
  const arm = armOf(r.from.situation);
  if (signed.has(`${arm}|`)) continue;
  signed.set(`${arm}|`, { decision: null });
  for (const t of jsonl(join(arms, arm, "ds/log.dataset/translations.jsonl")))
    signed.set(`${arm}|${t.draft}`, { decision: t.signoff?.decision ?? null, ...(t.call ? { call: t.call } : {}), result: t.result, by: t.model });
}

const days = new Map<string, { model: string; n: number }>();
for (const r of real) {
  const k = seatDayOf(r.from.situation);
  const d = days.get(k) ?? { model: modelOf(r.from.writer), n: 0 };
  d.n++;
  days.set(k, d);
}
const side = new Map<string, "test" | "validation" | "train">();
const models = [...new Set([...days.values()].map((d) => d.model))].sort();
for (const m of models) {
  const ks = [...days.entries()].filter(([, d]) => d.model === m).map(([k]) => k).sort((a, b) => (h(a) < h(b) ? -1 : 1));
  const nTest = Math.ceil(ks.length / 3);
  ks.forEach((k, i) => side.set(k, allTo ?? (i < nTest ? "test" : (i - nTest) % 10 === 9 ? "validation" : "train")));
}

const rows = real.map((r) => {
  const sd = seatDayOf(r.from.situation), arm = armOf(r.from.situation);
  const s = r.from.draft ? signed.get(`${arm}|${r.from.draft}`) : undefined;
  return {
    id: `sp-${h(r.id).slice(0, 12)}`, request: r.request, forms: r.forms, currency: r.currency,
    side: side.get(sd)!, model: modelOf(r.from.writer), seat_day: sd, arm, source: r.id,
    from: { ...r.from, writer: r.from.writer },
    ...(s ? { signed: s } : {}),
  };
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "split.json"), JSON.stringify({ seed: SPLIT_SEED, rule: allTo ? `every seat-day ${allTo} (arms after the split)` : "by seat-day, within each seat model: a third (rounded up) test-only by seeded hash; of the rest one in ten validation", seat_days: Object.fromEntries([...side.entries()].sort()) }, null, 1));
writeFileSync(join(out, "requests.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const blind = shuffle(prng(2026_11_08), rows.map((r) => ({ id: r.id, request: r.request.replace(/[\r\n]/g, " "), forms: r.forms })));
writeFileSync(join(out, "blind.jsonl"), blind.map((b) => JSON.stringify(b)).join("\n") + "\n");
const counts: any = {};
for (const r of rows) {
  const c = (counts[r.model] ??= { seat_days: { test: 0, validation: 0, train: 0 }, requests: { test: 0, validation: 0, train: 0 }, confirmed: 0 });
  c.requests[r.side]++;
  if (r.signed?.decision === "accept") c.confirmed++;
}
for (const [k, d] of days) counts[d.model].seat_days[side.get(k)!]++;
writeFileSync(join(out, "counts.json"), JSON.stringify(counts, null, 1));
console.log(JSON.stringify(counts, null, 1));
