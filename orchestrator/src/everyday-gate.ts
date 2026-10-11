// The teachers' gate for the everyday model (docs/design/ai-citizens.md 11): before a large model's odds may teach a
// small one, it must be shown to read the person and not only the situation. On recorded situations, for each teacher:
//   - repeats: the same request asked again (the noise everything else is set against);
//   - scrambled records: the same situation with another person in it;
//   - one-thing edits: the same person with one thing set low and high (trust in a venue, trust in the landlord, the
//     sense of agency, how long they have lived here): the odds must move the way the record explains;
//   - option order: the options listed the other way round;
//   - rewording: the whole request in other words;
//   - the town's totals: over the town's actual people, beside the code mind's (which is calibrated to the surveys);
//   - agreement between teachers.
// The thresholds are constants here, written before any teacher was asked, and never lowered after a result.
// Every call is kept in full in `calls.jsonl` beside the report (prompt, answer, tokens, cost); a second run over the
// same folder serves what it has and asks only what is missing. A teacher that does not answer is skipped for that
// call and counted. Nothing here is read by a run, and nothing is scored as good or bad for the town.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, Randomness } from "@oikos/participants";
import { callModel, ModelCallFailed, SpendingLimitReached, type Budget, type ContentBlock, type LlmAdapter, type LlmResponse, type Price } from "@oikos/participants/llm";
import { answerSchema, ask, baseLine, byClass, codeOdds, codeOddsFor, edited, editable, EDIT_FIELDS, EDIT_MOVES, optionsOf, readAnswer, scrambled, stageOf, TEACHER_VERSION, tv, zAgency, type Design, type EditField, type Harvested } from "./everyday";

export const GATE_VERSION = "0.1.0";

/** The thresholds (docs/design/ai-citizens.md 11c), fixed on 2026-10-11 before any teacher call. Distances are total
 * variation between two sets of odds over the same options, in points of 100. */
export const THRESHOLDS = {
  /** Scrambled records: the median distance to another person's odds is at least this many times the median distance
   * between two askings of the same request; at least this many points; and larger than the same situation's repeat
   * distance in at least this share of situations. */
  scrambled_over_repeat: 2, scrambled_points: 8, scrambled_beats_repeat_share: 0.75,
  /** One-thing edits: from low to high the class of option the field bears on moves the right way in at least this
   * share of the situations edited, by at least this many points on average. */
  edit_right_share: 10 / 12, edit_points: { agency: 5, trust_venue: 3, trust_landlord: 3, residence: 3 } as { [f in EditField]: number },
  /** Option order: the median distance between the two orders is at most 1.5 times the repeat distance plus this;
   * and an option gains at most this many points on average from being listed first rather than last. */
  order_over_repeat: 1.5, order_plus_points: 2, first_place_points: 3,
  /** Rewording: the median distance is at most 1.5 times the repeat distance plus this, and at most half the
   * scrambled distance; where the likeliest option led by 10 points, it is still the likeliest in this share. */
  reword_over_repeat: 1.5, reword_plus_points: 3, reword_under_scrambled: 0.5, reword_same_top_share: 0.8,
  /** The town's totals: over the town's actual people each class of option is within this many points of the code
   * mind's rate; asking, a venue and acting at all are within these ratios of it where the code mind's rate is at
   * least 5 in 100. */
  town_points: 15, town_ratio: [0.67, 1.5] as [number, number], town_ratio_classes: ["ask", "venue", "act"],
  /** A class of option is assessed in the town's totals only where at least this many of the sample's situations had
   * it open (the coordinator's ruling, 2026-10-11, before any full gate was run: a teacher neither passes nor fails
   * on a class that rests on fewer; it is marked not assessed). */
  town_min_situations: 10,
  /** Answers that could not be read, at most. */
  unread_share: 0.05,
};

export interface GateOptions {
  sample: Harvested[];
  /** Every harvested situation of the same split: donors for scrambles, the base line, and the town's true mix. */
  pool: Harvested[];
  teachers: Map<string, LlmAdapter>;
  design: Design;
  prices: Record<string, Price>;
  budget?: Budget;
  outDir: string;
  /** How many situations each one-thing edit is made on (0: none), and how many calls go at once. */
  edits?: number;
  jobs?: number;
  /** Leave out kinds of call (to spend less on a first look): "repeat", "reversed", "reworded", "scrambled". */
  skip?: string[];
  seed?: number;
  log?: (msg: string) => void;
}
interface Kept { key: string; model: string; system_sha256: string; input: unknown; output: ContentBlock[]; usage: LlmResponse["usage"]; cost_microusd: number; failed?: string }
type Odds = { [id: string]: number };

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** The requests of the gate for one sample: what is asked, of whom, under which key. The same for every teacher. */
export function requests(o: Pick<GateOptions, "sample" | "pool" | "design" | "edits" | "skip" | "seed">) {
  const rng = new Randomness(BigInt(o.seed ?? 4));
  const skip = new Set(o.skip ?? []);
  const out: { key: string; variant: string; of: Harvested; shown: Harvested; order: number[]; wording: "a" | "b"; field?: EditField; level?: string }[] = [];
  const editOn = new Map<EditField, Harvested[]>(EDIT_FIELDS.map((f) => [f, o.sample.filter((h) => editable(h, f)).slice(0, o.edits ?? 0)]));
  for (const h of o.sample) {
    const n = optionsOf(h.situation).length;
    const order = [...Array(n).keys()];
    const r = rng.stream(["order", h.id]);
    for (let i = n - 1; i > 0; i--) { const j = r.below(i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
    const add = (variant: string, shown: Harvested, ord: number[], wording: "a" | "b", more: object = {}) => out.push({ key: `${o.design}/${variant}/${h.id}`, variant, of: h, shown, order: ord, wording, ...more });
    add("base", h, order, "a");
    if (!skip.has("repeat")) add("repeat", h, order, "a");
    if (!skip.has("reversed")) add("reversed", h, [...order].reverse(), "a");
    if (!skip.has("reworded")) add("reworded", h, order, "b");
    if (!skip.has("scrambled")) {
      // Two other people from the same town's kind (the same profile, the same matter), drawn on a seeded stream.
      const donors = o.pool.filter((d) => d.profile === h.profile && d.situation.want.about === h.situation.want.about && `${d.run}/${d.participant}` !== `${h.run}/${h.participant}`);
      const d = rng.stream(["donor", h.id]);
      const picked: Harvested[] = [];
      for (let k = 0; k < 2 && donors.length > k; k++) { let x: Harvested; do { x = donors[d.below(donors.length)]!; } while (picked.some((p) => p.participant === x.participant && p.run === x.run)); picked.push(x); }
      picked.forEach((x, k) => add(`scrambled${k + 1}`, scrambled(h, x), order, "a"));
    }
    for (const f of EDIT_FIELDS) if (editOn.get(f)!.includes(h)) for (const level of ["low", "high"] as const) add(`edit:${f}:${level}`, edited(h, f, level), order, "a", { field: f, level });
  }
  return out;
}

export async function gate(o: GateOptions) {
  mkdirSync(o.outDir, { recursive: true });
  const callsPath = join(o.outDir, "calls.jsonl");
  const kept = new Map<string, Kept>();
  if (existsSync(callsPath)) for (const l of readFileSync(callsPath, "utf8").split("\n")) if (l.trim()) { const k = JSON.parse(l) as Kept; kept.set(k.key, k); }
  const log = o.log ?? (() => {});
  const seen = new Set<string>();
  const reqs = requests(o);
  const counts: { [model: string]: { asked: number; served: number; unanswered: number; unread: number; declined: number; cost_microusd: number; input_tokens: number; output_tokens: number } } = {};
  const answers = new Map<string, Odds>(); // model|key -> odds
  const bearing = new Map<string, string[]>();
  let stop = false;
  const one = async (name: string, adapter: LlmAdapter, q: (typeof reqs)[number]) => {
    const c = (counts[name] ??= { asked: 0, served: 0, unanswered: 0, unread: 0, declined: 0, cost_microusd: 0, input_tokens: 0, output_tokens: 0 });
    const a = ask(q.shown, { design: o.design, wording: q.wording, order: q.order, base: baseLine(q.of, o.pool) });
    const id = `${name}|${q.key}`;
    const before = kept.get(id);
    let out: ContentBlock[] | undefined;
    if (before && before.system_sha256 === sha256(a.system) && canonical(before.input) === canonical(a.user)) {
      c.served++;
      out = before.failed ? undefined : before.output;
    } else if (!stop) {
      const notes: any[] = [];
      const schema = answerSchema(a.labels);
      try {
        const res = await callModel({ adapter, annotate: async (x) => void notes.push(x), now: () => 0, prices: o.prices, ...(o.budget ? { budget: o.budget } : {}) },
          { purpose: "consult", subject: "everyday-gate", ref: q.key, system: a.system, messages: [{ role: "user", content: a.user }], maxTokens: 700, answer: { name: "estimate", schema }, tools: [{ name: "estimate", description: "The estimate, or that you decline it.", input_schema: schema }], context: { everyday: { asked: a, shown: q.shown, variant: q.variant } } }, seen);
        const cost = Number(notes.find((x) => x.annotation === "usage")?.cost_microusd ?? 0);
        c.asked++; c.cost_microusd += cost; c.input_tokens += (res.usage.input_tokens ?? 0) + ((res.usage as any).cache_read_tokens ?? 0) + ((res.usage as any).cache_write_tokens ?? 0); c.output_tokens += res.usage.output_tokens ?? 0;
        const k: Kept = { key: id, model: name, system_sha256: sha256(a.system), input: a.user, output: res.content, usage: res.usage, cost_microusd: cost };
        kept.set(id, k);
        appendFileSync(callsPath, `${JSON.stringify({ ...k, system: a.system, variant: q.variant, situation: q.of.id, shown: q.shown.id, labels: a.labels, ids: a.ids })}\n`);
        out = res.content;
      } catch (e) {
        if (e instanceof SpendingLimitReached) { stop = true; log(`  the spending limit was reached: no more calls`); return; }
        if (!(e instanceof ModelCallFailed)) throw e;
        c.unanswered++;
        log(`  ${name} did not answer (${q.key}): ${String((e as Error).message).slice(0, 160)}`);
        return;
      }
    } else return;
    const tool = (out ?? []).find((b) => b.type === "tool_use") as { input?: unknown } | undefined;
    const text = (out ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
    let obj: unknown = tool?.input;
    if (obj === undefined) { const i = text.indexOf("{"), j = text.lastIndexOf("}"); if (i >= 0 && j > i) try { obj = JSON.parse(text.slice(i, j + 1)); } catch { /* unread */ } }
    const read = readAnswer(obj, a);
    if (!read) { c.unread++; return; }
    if ("declined" in read) { c.declined++; return; }
    answers.set(id, read.odds);
    bearing.set(id, read.bearing);
  };
  for (const [name, adapter] of o.teachers) {
    log(`${name}: ${reqs.length} requests on ${o.sample.length} situations (design ${o.design})`);
    let next = 0;
    await Promise.all([...Array(Math.max(1, o.jobs ?? 1))].map(async () => { while (next < reqs.length) { const q = reqs[next++]!; await one(name, adapter, q); } }));
  }

  // ------------------------------------------------------------------------------------------------ the statistics
  const strata = (h: Harvested) => `${h.situation.want.about}|${stageOf(h.situation)}|${zAgency(h.situation) < -0.5 ? "lo" : zAgency(h.situation) > 0.5 ? "hi" : "mid"}`;
  const inPool = new Map<string, number>(), inSample = new Map<string, number>();
  for (const h of o.pool) inPool.set(strata(h), (inPool.get(strata(h)) ?? 0) + 1);
  for (const h of o.sample) inSample.set(strata(h), (inSample.get(strata(h)) ?? 0) + 1);
  const weight = (h: Harvested) => (inPool.get(strata(h)) ?? 1) / (inSample.get(strata(h)) ?? 1);
  const T = THRESHOLDS;
  const per = [...o.teachers.keys()].map((name) => {
    const get = (variant: string, h: Harvested) => answers.get(`${name}|${o.design}/${variant}/${h.id}`);
    const rows = o.sample.flatMap((h) => { const base = get("base", h); return base ? [{ h, base }] : []; });
    const repeat = rows.flatMap((x) => { const y = get("repeat", x.h); return y ? [{ id: x.h.id, d: tv(x.base, y) }] : []; });
    const scr = rows.flatMap((x) => { const ys = [get("scrambled1", x.h), get("scrambled2", x.h)].filter((y) => y) as Odds[]; return ys.length ? [{ id: x.h.id, d: mean(ys.map((y) => tv(x.base, y)))! }] : []; });
    const rev = rows.flatMap((x) => { const y = get("reversed", x.h); return y ? [{ x, y, d: tv(x.base, y) }] : []; });
    const rew = rows.flatMap((x) => { const y = get("reworded", x.h); return y ? [{ x, y, d: tv(x.base, y) }] : []; });
    const repeatOf = new Map(repeat.map((x) => [x.id, x.d]));
    const beats = scr.filter((x) => repeatOf.has(x.id));
    // What an option gains from being listed first and not last: its odds where first, less its odds where last.
    const order = new Map(requests(o).filter((q) => q.variant === "base").map((q) => [q.of.id, q.order]));
    const firstGain = rev.flatMap(({ x, y }) => { const opts = optionsOf(x.h.situation), ord = order.get(x.h.id)!; const a = opts[ord[0]!]!.id, b = opts[ord.at(-1)!]!.id; return [100 * ((x.base[a] ?? 0) - (y[a] ?? 0)), 100 * ((y[b] ?? 0) - (x.base[b] ?? 0))]; });
    const top = (p: Odds) => Object.entries(p).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const clear = rew.filter(({ x }) => { const t = top(x.base); return t.length > 1 && t[0]![1] - t[1]![1] >= 0.1; });
    const edits = Object.fromEntries(EDIT_FIELDS.map((f) => {
      const pairs = o.sample.flatMap((h) => { const lo = get(`edit:${f}:low`, h), hi = get(`edit:${f}:high`, h); if (!lo || !hi) return []; const m = EDIT_MOVES[f]; const d = 100 * ((byClass(h.situation, hi)[m.cls] ?? 0) - (byClass(h.situation, lo)[m.cls] ?? 0)); return [m.down ? -d : d]; });
      return [f, { pairs: pairs.length, right: pairs.filter((d) => d > 0).length, mean_points: r1(mean(pairs)), needed_points: T.edit_points[f] }];
    })) as { [f in EditField]: { pairs: number; right: number; mean_points: number | null; needed_points: number } };
    // The town's totals: the teacher's odds (the two orders averaged where both were read) beside the code mind's on
    // the same decisions, each weighted back to the town's true mix.
    const town: { [cls: string]: { teacher: number; code: number; n: number } } = {};
    let W = 0;
    for (const { h, base } of rows) {
      const y = get("reversed", h);
      const p: Odds = y ? Object.fromEntries(Object.keys(base).map((k) => [k, (base[k]! + (y[k] ?? 0)) / 2])) : base;
      const t = byClass(h.situation, p), c = byClass(h.situation, codeOdds(h.situation)), w = weight(h);
      W += w;
      // (The code mind never draws giving up: its waiting is set beside the teacher's leaving it and giving up together.)
      t.not_acting = (t.leave ?? 0) + (t.give_up ?? 0); c.not_acting = (c.leave ?? 0) + (c.give_up ?? 0);
      for (const cls of new Set([...Object.keys(t), ...Object.keys(c)])) { const x = (town[cls] ??= { teacher: 0, code: 0, n: 0 }); x.teacher += w * (t[cls] ?? 0); x.code += w * (c[cls] ?? 0); if (cls in t || cls in c) x.n++; }
    }
    const totals = Object.fromEntries(Object.entries(town).filter(([cls]) => cls !== "leave" && cls !== "give_up").sort(([a], [b]) => (a < b ? -1 : 1)).map(([cls, x]) => [cls, { teacher: r1((100 * x.teacher) / Math.max(1e-9, W))!, code: r1((100 * x.code) / Math.max(1e-9, W))!, situations: x.n, assessed: x.n >= T.town_min_situations }]));
    const assessed = Object.entries(totals).filter(([, x]) => x.assessed);
    // What the code mind's own sway makes of the same scrambles and edits (how far it tells people apart by itself).
    const reqOf = new Map(reqs.map((q) => [q.key, q]));
    const shownAs = (variant: string, h: Harvested) => reqOf.get(`${o.design}/${variant}/${h.id}`)?.shown;
    const codeScr = o.sample.flatMap((h) => { const ds = ["scrambled1", "scrambled2"].flatMap((v) => { const sh = shownAs(v, h); return sh ? [tv(codeOdds(h.situation), codeOddsFor(sh.situation, h.situation))] : []; }); return ds.length ? [mean(ds)!] : []; });
    const codeEdits = Object.fromEntries(EDIT_FIELDS.map((f) => {
      const pairs = o.sample.flatMap((h) => { const lo = shownAs(`edit:${f}:low`, h), hi = shownAs(`edit:${f}:high`, h); if (!lo || !hi) return []; const m = EDIT_MOVES[f]; const d = 100 * ((byClass(h.situation, codeOddsFor(hi.situation, h.situation))[m.cls] ?? 0) - (byClass(h.situation, codeOddsFor(lo.situation, h.situation))[m.cls] ?? 0)); return [m.down ? -d : d]; });
      return [f, { pairs: pairs.length, right: pairs.filter((d) => d > 0).length, mean_points: r1(mean(pairs)) }];
    }));
    const mRepeat = median(repeat.map((x) => x.d)), mScr = median(scr.map((x) => x.d)), mRev = median(rev.map((x) => x.d)), mRew = median(rew.map((x) => x.d));
    const c = counts[name] ?? { asked: 0, served: 0, unanswered: 0, unread: 0, declined: 0, cost_microusd: 0, input_tokens: 0, output_tokens: 0 };
    const total = reqs.length;
    const pass = {
      unread: total > 0 && c.unread / total <= T.unread_share,
      scrambled: mRepeat !== null && mScr !== null && mScr >= T.scrambled_over_repeat * mRepeat && mScr >= T.scrambled_points && beats.length > 0 && beats.filter((x) => x.d > repeatOf.get(x.id)!).length / beats.length >= T.scrambled_beats_repeat_share,
      edits: EDIT_FIELDS.every((f) => edits[f].pairs > 0 && edits[f].right / edits[f].pairs >= T.edit_right_share && (edits[f].mean_points ?? 0) >= T.edit_points[f]),
      order: mRepeat !== null && mRev !== null && mRev <= T.order_over_repeat * mRepeat + T.order_plus_points && Math.abs(mean(firstGain) ?? 99) <= T.first_place_points,
      reworded: mRepeat !== null && mRew !== null && mScr !== null && mRew <= T.reword_over_repeat * mRepeat + T.reword_plus_points && mRew <= T.reword_under_scrambled * mScr && clear.length > 0 && clear.filter(({ x, y }) => top(x.base)[0]![0] === top(y)[0]![0]).length / clear.length >= T.reword_same_top_share,
      town: !assessed.length ? ("not assessed" as const) : assessed.every(([cls, x]) => Math.abs(x.teacher - x.code) <= T.town_points && (!T.town_ratio_classes.includes(cls) || x.code < 5 || (x.teacher / x.code >= T.town_ratio[0] && x.teacher / x.code <= T.town_ratio[1]))),
    };
    return {
      teacher: name, calls: { ...c, cost_usd: Math.round(c.cost_microusd / 1e4) / 100 }, read: rows.length,
      repeat: { n: repeat.length, median: r1(mRepeat), mean: r1(mean(repeat.map((x) => x.d))) },
      scrambled: { n: scr.length, median: r1(mScr), mean: r1(mean(scr.map((x) => x.d))), beats_repeat: beats.filter((x) => x.d > repeatOf.get(x.id)!).length, of: beats.length },
      edits,
      order: { n: rev.length, median: r1(mRev), first_place_gain_points: r1(mean(firstGain)) },
      reworded: { n: rew.length, median: r1(mRew), clear: clear.length, same_top: clear.filter(({ x, y }) => top(x.base)[0]![0] === top(y)[0]![0]).length },
      town: totals, code_mind: { scrambled: { n: codeScr.length, median: r1(median(codeScr)), mean: r1(mean(codeScr)) }, edits: codeEdits },
      pass, passed: Object.values(pass).every((x) => x === true || x === "not assessed"),
    };
  });
  // Agreement between teachers: the distance between their odds on the same request, and whether another person in the
  // situation moves acting at all the same way for both.
  const names = [...o.teachers.keys()];
  const agreement = names.flatMap((a, i) => names.slice(i + 1).map((b) => {
    const both = o.sample.flatMap((h) => { const x = answers.get(`${a}|${o.design}/base/${h.id}`), y = answers.get(`${b}|${o.design}/base/${h.id}`); return x && y ? [{ h, x, y }] : []; });
    const moves = both.flatMap(({ h, x, y }) => ["scrambled1", "scrambled2"].flatMap((v) => { const xa = answers.get(`${a}|${o.design}/${v}/${h.id}`), yb = answers.get(`${b}|${o.design}/${v}/${h.id}`); if (!xa || !yb) return []; return [[byClass(h.situation, xa).act! - byClass(h.situation, x).act!, byClass(h.situation, yb).act! - byClass(h.situation, y).act!] as [number, number]]; }));
    const large = moves.filter(([p, q]) => Math.abs(p) >= 0.05 || Math.abs(q) >= 0.05);
    const byCls: { [cls: string]: number[] } = {};
    for (const { h, x, y } of both) { const p = byClass(h.situation, x), q = byClass(h.situation, y); for (const cls of Object.keys(p)) (byCls[cls] ??= []).push(100 * ((p[cls] ?? 0) - (q[cls] ?? 0))); }
    return { a, b, n: both.length, median_distance: r1(median(both.map(({ x, y }) => tv(x, y)))), same_direction_when_the_person_changes: { same: large.filter(([p, q]) => p * q > 0).length, of: large.length },
      a_less_b_points_by_class: Object.fromEntries(Object.entries(byCls).sort(([p], [q]) => (p < q ? -1 : 1)).map(([cls, xs]) => [cls, r1(mean(xs))])) };
  }));
  const report = { gate: "oikos-everyday-gate", version: GATE_VERSION, teacher_prompt: TEACHER_VERSION, design: o.design, thresholds: T,
    situations: o.sample.map((h) => ({ id: h.id, about: h.situation.want.about, stage: stageOf(h.situation), options: optionsOf(h.situation).map((x) => x.id) })),
    requests: reqs.length, teachers: per, agreement,
    answers: Object.fromEntries([...answers].map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([id, p]) => [id, Math.round(p * 1000) / 1000]))])), bearing: Object.fromEntries(bearing) };
  await Bun.write(join(o.outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function gateText(r: Awaited<ReturnType<typeof gate>>): string {
  const L: string[] = [`Everyday gate ${r.version} (teacher prompt ${r.teacher_prompt}, design ${r.design}): ${r.situations.length} situations, ${r.requests} requests a teacher`];
  const ok = (b: boolean) => (b ? "pass" : "FAIL");
  for (const t of r.teachers) {
    L.push(`${t.teacher}: ${t.passed ? "PASSES" : "does not pass"}; asked ${t.calls.asked}, served from file ${t.calls.served}, unanswered ${t.calls.unanswered}, unread ${t.calls.unread}, declined ${t.calls.declined}; ${t.calls.cost_usd} USD as priced`);
    L.push(`  repeat (the same request again): median ${t.repeat.median} points over ${t.repeat.n}`);
    L.push(`  scrambled records [${ok(t.pass.scrambled)}]: median ${t.scrambled.median} points over ${t.scrambled.n}; above its own repeat in ${t.scrambled.beats_repeat} of ${t.scrambled.of}`);
    L.push(`  one-thing edits [${ok(t.pass.edits)}]: ${Object.entries(t.edits).map(([f, e]) => `${f} right way ${e.right} of ${e.pairs}, mean ${e.mean_points} (needs ${e.needed_points})`).join("; ")}`);
    L.push(`  option order [${ok(t.pass.order)}]: median ${t.order.median} points over ${t.order.n}; listed first rather than last gains ${t.order.first_place_gain_points} points`);
    L.push(`  reworded [${ok(t.pass.reworded)}]: median ${t.reworded.median} points over ${t.reworded.n}; the same likeliest option in ${t.reworded.same_top} of ${t.reworded.clear} where it led clearly`);
    L.push(`  the town's totals [${t.pass.town === "not assessed" ? "not assessed" : ok(t.pass.town)}], teacher against the code mind, of 100 (situations behind it; * not assessed, under ${r.thresholds.town_min_situations}): ${Object.entries(t.town).map(([cls, x]) => `${cls} ${x.teacher}/${x.code} (${x.situations}${x.assessed ? "" : "*"})`).join("; ")}`);
    L.push(`  the code mind's own sway on the same requests: scrambled median ${t.code_mind.scrambled.median} points over ${t.code_mind.scrambled.n}; edits: ${Object.entries(t.code_mind.edits).map(([f, e]) => `${f} right way ${e.right} of ${e.pairs}, mean ${e.mean_points}`).join("; ")}`);
  }
  for (const a of r.agreement) L.push(`${a.a} and ${a.b}: median ${a.median_distance} points apart over ${a.n}; another person moves acting at all the same way in ${a.same_direction_when_the_person_changes.same} of ${a.same_direction_when_the_person_changes.of}; first less second by class: ${Object.entries(a.a_less_b_points_by_class).map(([c, x]) => `${c} ${x}`).join(", ")}`);
  return L.join("\n");
}
