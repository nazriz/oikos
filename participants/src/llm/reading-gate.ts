// The reading gate (docs/design/ai-citizens.md 13f), fixed before any reader is asked. **THRESHOLDS are written here
// and are not lowered after a result.** A step is one point on a line's scale. The harness asks a reader about the
// hand-made pairs (participants/eval/reading-pairs.json) and the controls made from them by code, and says which
// checks hold. It calls whatever `Reader` it is given: a mock in this build (the real gate is step 5, which needs
// the owner's word); this file never constructs a model reader.
//
// The checks that need no reader are tests: "a code town, dial on" (orchestrator/test/reading-dial.test.ts) and, later,
// "extreme readers" (design 13h step 7). They are listed in the report as pending here, so a report is never read as
// more than it is.

import { combineAskings, LINES, NEUTRAL, wellFormed, type Line, type Reading } from "../shared/reading";
import type { Reader, ReadAnswer, ReadRequest } from "./reader";
import { Tagger, type TagWorld } from "./reading-tags";

/** The thresholds of 13f, as fractions of the cases (the spec's "36 of 40" is 0.9). Frozen: a result changes none of them. */
export const THRESHOLDS = Object.freeze({
  repeat: Object.freeze({ same: 0.8, within_step: 0.97 }),
  pairs: Object.freeze({ right: 36 / 40, others_within_step: 34 / 40, line_right: 0.9 }),
  length: Object.freeze({ same: 0.85, mean_abs_step: 0.25 }),
  politeness: Object.freeze({ unmoved: 36 / 40, respect_ok: 32 / 40, respect_up_at_most: 1 }),
  names_and_sums: Object.freeze({ identical: 1 }),
  rewording: Object.freeze({ within_step: 0.95, same: 0.7 }),
  two_readers: Object.freeze({ same: 0.6, within_step: 0.92, kappa: 0.6, both_right_pairs: 34 / 40 }),
  author_family: Object.freeze({ bias_steps: 0.25 }),
  phrases: Object.freeze({ found: 0.95 }),
  readable: Object.freeze({ unread_at_most: 1 / 20 }),
  cost: Object.freeze({ gate_usd: 20, per_call_usd: 0.02 }),
});

export interface Pair {
  id: string;
  kind: "refusal" | "grant" | "order" | "public" | "founder";
  form: string;
  standing: "addressee" | "raised" | "affected" | "public";
  answers?: string;
  a: { label: string; text: string };
  b: { label: string; text: string };
  /** The lines the pair was written to part on, and the way: +1, `a` reads higher by at least a step; -1, lower. */
  parts_on: { [l in Line]?: 1 | -1 };
}

/** Past pilots' decisions by seats of two families, for the author's-family check (the real gate reads them from logs). */
export interface FamilyPaper { family: string; kind: string; standing: Pair["standing"]; paper: string; answers?: string }

export interface Check { id: string; name: string; status: "pass" | "fail" | "pending"; value?: number | string; threshold?: string; detail?: string }
export interface GateReport {
  reader: string;
  version: string;
  checks: Check[];
  /** Every check that can be run here held (pending checks are listed, not counted). */
  passed: boolean;
  calls: number;
  cost_usd: number;
  mean_cost_usd: number;
  declined: number;
  /** Lines the pairs or the two readers say are not told apart: their step is 0 (13f, "What a failure does"). */
  lines_off: Line[];
  /** The slice does not go ahead: respect, reason or answers failed. */
  stops: boolean;
}

type Cell = number | null;
const lineVal = (r: Reading, l: Line): Cell => (l === "respect" || l === "reason" || l === "answers" || l === "recourse" || l === "threat" ? r[l] : r.appeals[l]);

/** Paper text made longer to twice its length with neutral procedure that says nothing a reader should count. */
export const NEUTRAL_PROCEDURE = "This paper is issued under the usual procedure of the office. A copy is kept on the file. Papers are filed in the order in which they are made, and the file is open to those it concerns during office hours.";
export function padded(text: string): string {
  const target = text.split(/\s+/).length * 2;
  let out = text;
  while (out.split(/\s+/).length < target) out += " " + NEUTRAL_PROCEDURE;
  return out;
}
/** Politeness and nothing else: a courtesy before and after, no content. */
export function politely(text: string): string {
  return `Thank you for your message. ${text} We regret any inconvenience. Kind regards.`;
}

/** The tags of a text numbered by first appearance, as the tagger numbers them. */
export function canonTags(text: string): string {
  const seen: { [tag: string]: Map<string, number> } = {};
  return text.replace(/\[(DAY|SUM|ID|PERSON)-(\d+)\]/g, (_m, tag: string, n: string) => {
    const m = (seen[tag] ??= new Map());
    if (!m.has(n)) m.set(n, m.size + 1);
    return `[${tag}-${m.get(n)}]`;
  });
}
/** Real-looking values in place of tags: two sets, to show that what the values are cannot reach the reader. */
export function filled(text: string, set: 0 | 1): string {
  const names = [["Marta Ilves", "Odo Prentiss", "Hana Brevik"], ["Joss Carrow", "Wen Takahe", "Ines Lund"]][set]!;
  return text.replace(/\[(DAY|SUM|ID|PERSON)-(\d+)\]/g, (_m, tag: string, n: string) => {
    const i = Number(n);
    if (tag === "PERSON") return names[(i - 1) % names.length]!;
    if (tag === "SUM") return set === 0 ? `§${(i * 1_137).toLocaleString("en-US")}.40` : `${(i * 83 + 9).toLocaleString("en-US")}.00 §`;
    if (tag === "DAY") return set === 0 ? `year 1, day ${20 + i * 11}` : `year 2, day ${300 - i * 17}`;
    return set === 0 ? `stmt.${400 + i}` : `apts-${i + 6}/dwelling.${i + 2}`;
  });
}
/** The world the gate's tagger knows: its two sets of names, and a currency invented for the test (no place's). */
export const GATE_TAG_WORLD: TagWorld = { names: ["Marta Ilves", "Odo Prentiss", "Hana Brevik", "Joss Carrow", "Wen Takahe", "Ines Lund"], currency: { code: "OIK", symbol: "§" } };

/** Quadratic weighted kappa over two raters' ordinal readings of the same papers; 1 where both are the same constant. */
export function weightedKappa(a: number[], b: number[]): number {
  const n = a.length;
  if (!n) return 1;
  const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b), k = hi - lo + 1;
  if (k === 1) return 1;
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0)), ra = new Array<number>(k).fill(0), rb = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) { O[a[i]! - lo]![b[i]! - lo]!++; ra[a[i]! - lo]!++; rb[b[i]! - lo]!++; }
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const w = ((i - j) / (k - 1)) ** 2; num += w * O[i]![j]!; den += (w * ra[i]! * rb[j]!) / n; }
  return den === 0 ? 1 : 1 - num / den;
}

/** The comparison of two readings cell by cell: how many cells there are, are the same, and are within a step; null against a number is neither. */
function compare(x: Reading, y: Reading, lines: readonly Line[] = LINES): { cells: number; same: number; within: number; abs: { [l in Line]?: number } } {
  let cells = 0, same = 0, within = 0;
  const abs: { [l in Line]?: number } = {};
  for (const l of lines) {
    const u = lineVal(x, l), v = lineVal(y, l);
    cells++;
    if (u === null && v === null) { same++; within++; abs[l] = 0; continue; }
    if (u === null || v === null) { abs[l] = 2; continue; }
    const d = Math.abs(u - v);
    abs[l] = d;
    if (d === 0) same++;
    if (d <= 1) within++;
  }
  return { cells, same, within, abs };
}

interface Asked { first: Reading | null; second: Reading | null; reading: Reading | null; unread: boolean; declined: boolean }

/** `other`: the reader the author's-family check sets the reader against, where it is not the second reader (the second may be the reader's own family, as two Claude models are; the check needs another family's). */
export async function runGate(input: { reader: Reader; second?: Reader; other?: Reader; pairs: Pair[]; family?: FamilyPaper[]; world?: TagWorld }): Promise<GateReport> {
  const { reader, pairs } = input;
  const world = input.world ?? GATE_TAG_WORLD;
  let calls = 0, micro = 0, declined = 0, unreadAskings = 0, askings = 0, phraseLines = 0, phrasesFound = 0, uncosted = 0;
  const asks = async (rd: Reader, kind: string, standing: Pair["standing"], paper: string, answers: string | undefined, wording: 1 | 2, count = true): Promise<{ reading: Reading | null; declined: boolean; unread: boolean }> => {
    const req: ReadRequest = { kind, standing, paper, ...(answers !== undefined ? { answers } : {}), wording };
    let out: ReadAnswer;
    try { out = await rd.read(req); } catch { out = {}; }
    if (count) {
      calls++; askings++;
      if (out.cost_microusd === undefined) uncosted++; else micro += out.cost_microusd;
    }
    if (out.declined) { if (count) declined++; return { reading: null, declined: true, unread: false }; }
    const ok = wellFormed(out.reading);
    let phrasesOk = ok;
    if (ok) {
      const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
      const p = norm(paper);
      for (const l of LINES) {
        const v = lineVal(out.reading!, l);
        if (v === 0 || v === null) continue;
        const q = out.phrases?.[l];
        const found = typeof q === "string" && q.trim().length > 0 && q.trim().split(/\s+/).length <= 12 && p.includes(norm(q));
        if (count) { phraseLines++; if (found) phrasesFound++; }
        if (!found) phrasesOk = false;
      }
    }
    if (!phrasesOk && count) unreadAskings++;
    return { reading: ok && phrasesOk ? out.reading! : null, declined: false, unread: !phrasesOk };
  };
  /** A paper asked twice (the prompt's two wordings), as a run asks it; the reading is the two combined, the plain being the neutral one here. */
  const readBoth = async (rd: Reader, kind: string, standing: Pair["standing"], paper: string, answers?: string): Promise<Asked> => {
    const a = await asks(rd, kind, standing, paper, answers, 1);
    const b = await asks(rd, kind, standing, paper, answers, 2);
    const first = a.reading, second = b.reading;
    return { first, second, reading: first && second ? combineAskings(first, second, NEUTRAL).reading : null, unread: a.unread || b.unread, declined: a.declined || b.declined };
  };

  const texts: { pair: Pair; side: "a" | "b"; text: string }[] = pairs.flatMap((p) => [{ pair: p, side: "a" as const, text: p.a.text }, { pair: p, side: "b" as const, text: p.b.text }]);
  const base = new Map<string, Asked>();
  const key = (t: { pair: Pair; side: "a" | "b" }) => `${t.pair.id}:${t.side}`;
  for (const t of texts) base.set(key(t), await readBoth(reader, t.pair.form, t.pair.standing, t.text, t.pair.answers));
  const R = (t: { pair: Pair; side: "a" | "b" }) => base.get(key(t))!.reading;

  const checks: Check[] = [];
  const frac = (n: number, d: number) => (d ? n / d : 1);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // ---- repeat: the same paper, the same wording, asked again
  {
    let cells = 0, same = 0, within = 0;
    for (const t of texts) {
      const again = await asks(reader, t.pair.form, t.pair.standing, t.text, t.pair.answers, 1);
      const first = base.get(key(t))!.first;
      if (!first || !again.reading) { cells += LINES.length; continue; }
      const c = compare(first, again.reading);
      cells += c.cells; same += c.same; within += c.within;
    }
    const s = frac(same, cells), w = frac(within, cells);
    checks.push({ id: "repeat", name: "Repeat (the yardstick)", status: s >= THRESHOLDS.repeat.same && w >= THRESHOLDS.repeat.within_step ? "pass" : "fail", value: `same ${pct(s)}, within a step ${pct(w)}`, threshold: `same >= ${pct(THRESHOLDS.repeat.same)}, within a step >= ${pct(THRESHOLDS.repeat.within_step)}` });
  }

  // ---- the pairs
  const pairVerdict = (p: Pair, ra: Reading | null, rb: Reading | null) => {
    if (!ra || !rb) return { right: false, rest: false, byLine: {} as { [l in Line]?: boolean } };
    const byLine: { [l in Line]?: boolean } = {};
    let allRight = true, restOk = true;
    for (const l of LINES) {
      const u = lineVal(ra, l), v = lineVal(rb, l);
      const dir = p.parts_on[l];
      if (dir !== undefined) {
        const ok = u !== null && v !== null && dir * (u - v) >= 1;
        byLine[l] = ok;
        if (!ok) allRight = false;
      } else if (u === null && v === null) continue;
      else if (u === null || v === null || Math.abs(u - v) > 1) restOk = false;
    }
    return { right: allRight, rest: restOk, byLine };
  };
  const verdicts = pairs.map((p) => pairVerdict(p, R({ pair: p, side: "a" }), R({ pair: p, side: "b" })));
  {
    const r = verdicts.filter((v) => v.right).length, o = verdicts.filter((v) => v.rest).length;
    const n = pairs.length;
    checks.push({ id: "pairs", name: "The pairs", status: frac(r, n) >= THRESHOLDS.pairs.right && frac(o, n) >= THRESHOLDS.pairs.others_within_step ? "pass" : "fail", value: `right ${r} of ${n}; other lines within a step in ${o} of ${n}`, threshold: `>= ${pct(THRESHOLDS.pairs.right)} right, >= ${pct(THRESHOLDS.pairs.others_within_step)} others within a step` });
  }

  // ---- length: each paper padded to twice its length
  {
    let cells = 0, same = 0;
    const sums: { [l in Line]?: number } = {};
    let n = 0;
    for (const t of texts) {
      const p = await readBoth(reader, t.pair.form, t.pair.standing, padded(t.text), t.pair.answers);
      const o = R(t);
      if (!o || !p.reading) { cells += LINES.length; continue; }
      const c = compare(o, p.reading);
      cells += c.cells; same += c.same; n++;
      for (const l of LINES) sums[l] = (sums[l] ?? 0) + (c.abs[l] ?? 0);
    }
    const s = frac(same, cells);
    const worst = Math.max(0, ...LINES.map((l) => (n ? (sums[l] ?? 0) / n : 0)));
    checks.push({ id: "length", name: "Length", status: s >= THRESHOLDS.length.same && worst <= THRESHOLDS.length.mean_abs_step ? "pass" : "fail", value: `same ${pct(s)}; largest mean move of a line ${worst.toFixed(2)} step`, threshold: `same >= ${pct(THRESHOLDS.length.same)}, no line moved by more than ${THRESHOLDS.length.mean_abs_step} step on average` });
  }

  // ---- politeness alone, added to each curt paper (the b side)
  {
    let unmoved = 0, respectOk = 0, n = 0;
    for (const p of pairs) {
      const b = R({ pair: p, side: "b" }), a = R({ pair: p, side: "a" });
      const pol = await readBoth(reader, p.form, p.standing, politely(p.b.text), p.answers);
      n++;
      if (!b || !a || !pol.reading) continue;
      if (pol.reading.reason === b.reason && pol.reading.answers === b.answers && pol.reading.recourse === b.recourse) unmoved++;
      // (Under the humane wording's respect where the pair was written to part on respect; otherwise only the step bound.)
      const upOk = pol.reading.respect - b.respect <= THRESHOLDS.politeness.respect_up_at_most;
      const under = p.parts_on.respect === undefined || pol.reading.respect < a.respect;
      if (upOk && under) respectOk++;
    }
    const u = frac(unmoved, n), r = frac(respectOk, n);
    checks.push({ id: "politeness", name: "Politeness alone", status: u >= THRESHOLDS.politeness.unmoved && r >= THRESHOLDS.politeness.respect_ok ? "pass" : "fail", value: `reason, answers and recourse unmoved in ${unmoved} of ${n}; respect within bounds in ${respectOk} of ${n}`, threshold: `>= ${pct(THRESHOLDS.politeness.unmoved)} and >= ${pct(THRESHOLDS.politeness.respect_ok)}`, detail: "a reader that fails this is counting pleasantries" });
  }

  // ---- names and sums: the tagger, a test of the code
  {
    let identical = 0, n = 0;
    for (const t of texts) {
      n++;
      const want = canonTags(t.text);
      const x = new Tagger(world).tag(filled(t.text, 0)), y = new Tagger(world).tag(filled(t.text, 1));
      if (x === want && y === want) identical++;
    }
    checks.push({ id: "names_and_sums", name: "Names and sums", status: identical === n ? "pass" : "fail", value: `${identical} of ${n} papers tag to the same text whichever names, sums, days and ids were in them`, threshold: "all identical" });
  }

  // ---- rewording and order: the prompt's second wording
  {
    let cells = 0, same = 0, within = 0;
    for (const t of texts) {
      const b = base.get(key(t))!;
      if (!b.first || !b.second) { cells += LINES.length; continue; }
      const c = compare(b.first, b.second);
      cells += c.cells; same += c.same; within += c.within;
    }
    const s = frac(same, cells), w = frac(within, cells);
    checks.push({ id: "rewording", name: "Rewording and order", status: w >= THRESHOLDS.rewording.within_step && s >= THRESHOLDS.rewording.same ? "pass" : "fail", value: `within a step ${pct(w)}, same ${pct(s)}`, threshold: `within a step >= ${pct(THRESHOLDS.rewording.within_step)}, same >= ${pct(THRESHOLDS.rewording.same)}` });
  }

  // ---- two readers
  let kappas: { [l in Line]?: number } = {};
  let bothRightFail = false;
  if (input.second) {
    const other = new Map<string, Asked>();
    for (const t of texts) other.set(key(t), await readBoth(input.second, t.pair.form, t.pair.standing, t.text, t.pair.answers));
    let cells = 0, same = 0, within = 0;
    for (const t of texts) {
      const x = R(t), y = other.get(key(t))!.reading;
      if (!x || !y) { cells += LINES.length; continue; }
      const c = compare(x, y);
      cells += c.cells; same += c.same; within += c.within;
    }
    for (const l of LINES) {
      const xs: number[] = [], ys: number[] = [];
      for (const t of texts) { const x = R(t), y = other.get(key(t))!.reading; if (!x || !y) continue; const u = lineVal(x, l), v = lineVal(y, l); if (u !== null && v !== null) { xs.push(u); ys.push(v); } }
      kappas[l] = weightedKappa(xs, ys);
    }
    const second = pairs.map((p) => pairVerdict(p, other.get(key({ pair: p, side: "a" }))!.reading, other.get(key({ pair: p, side: "b" }))!.reading));
    const both = verdicts.filter((v, i) => v.right && second[i]!.right).length;
    const s = frac(same, cells), w = frac(within, cells);
    const kmin = Math.min(...LINES.map((l) => kappas[l] ?? 1));
    bothRightFail = frac(both, pairs.length) < THRESHOLDS.two_readers.both_right_pairs;
    checks.push({ id: "two_readers", name: "Two readers", status: s >= THRESHOLDS.two_readers.same && w >= THRESHOLDS.two_readers.within_step && kmin >= THRESHOLDS.two_readers.kappa && !bothRightFail ? "pass" : "fail",
      value: `same ${pct(s)}, within a step ${pct(w)}, lowest weighted kappa ${kmin.toFixed(2)}, both right on ${both} of ${pairs.length} pairs`, threshold: `same >= ${pct(THRESHOLDS.two_readers.same)}, within a step >= ${pct(THRESHOLDS.two_readers.within_step)}, kappa >= ${THRESHOLDS.two_readers.kappa} on each line, both right on >= ${pct(THRESHOLDS.two_readers.both_right_pairs)} of the pairs` });

    // ---- author's family: each reader against the other, on papers by seats of two families
    if (input.family?.length) {
      const fams = [...new Set(input.family.map((f) => f.family))].sort();
      let worst = 0;
      const readers = [reader, input.other ?? input.second];
      for (const [i, rd] of readers.entries()) {
        const own = fams[i];
        const mine = input.family.filter((f) => f.family === own);
        // (Each paper is read once by each of the two, both askings, and both lines taken from those readings.)
        const gaps: { [l in "respect" | "reason"]: { gap: number; n: number } } = { respect: { gap: 0, n: 0 }, reason: { gap: 0, n: 0 } };
        for (const f of mine) {
          const x = await readBoth(rd, f.kind, f.standing, f.paper, f.answers), y = await readBoth(readers[1 - i]!, f.kind, f.standing, f.paper, f.answers);
          if (!x.reading || !y.reading) continue;
          for (const l of ["respect", "reason"] as const) { gaps[l].gap += x.reading[l] - y.reading[l]; gaps[l].n++; }
        }
        for (const l of ["respect", "reason"] as const) worst = Math.max(worst, gaps[l].n ? gaps[l].gap / gaps[l].n : 0);
      }
      checks.push({ id: "author_family", name: "Author's family", status: worst <= THRESHOLDS.author_family.bias_steps ? "pass" : "fail", value: `largest own-family lift ${worst.toFixed(2)} step`, threshold: `<= ${THRESHOLDS.author_family.bias_steps} step`, detail: "a reader that fails may not read a run seating its family" });
    } else checks.push({ id: "author_family", name: "Author's family", status: "pending", detail: "needs decisions from past pilots' logs by seats of two families (step 5 reads them); not run" });
  } else {
    checks.push({ id: "two_readers", name: "Two readers", status: "pending", detail: "no second reader given" });
    checks.push({ id: "author_family", name: "Author's family", status: "pending", detail: "needs two readers and past pilots' decisions" });
  }

  // ---- phrases, readable, cost
  {
    const f = frac(phrasesFound, phraseLines);
    checks.push({ id: "phrases", name: "Quoted phrases", status: f >= THRESHOLDS.phrases.found ? "pass" : "fail", value: `${phrasesFound} of ${phraseLines} lines that are not 0 quote the paper`, threshold: `>= ${pct(THRESHOLDS.phrases.found)}` });
    const u = frac(unreadAskings, askings);
    checks.push({ id: "readable", name: "Readable; declined", status: u <= THRESHOLDS.readable.unread_at_most ? "pass" : "fail", value: `unread ${unreadAskings} of ${askings} askings; declined ${declined}`, threshold: `unread <= ${pct(THRESHOLDS.readable.unread_at_most)}; declines reported` });
    const usd = micro / 1e6, mean = calls ? usd / calls : 0;
    checks.push({ id: "cost", name: "Cost", status: usd <= THRESHOLDS.cost.gate_usd && mean <= THRESHOLDS.cost.per_call_usd && uncosted === 0 ? "pass" : "fail", value: `${usd.toFixed(2)} USD over ${calls} calls, ${mean.toFixed(4)} a call${uncosted ? `; ${uncosted} calls came back with no cost` : ""}`, threshold: `<= ${THRESHOLDS.cost.gate_usd} USD, mean <= ${THRESHOLDS.cost.per_call_usd} USD a call` });
  }
  checks.push({ id: "code_town", name: "A code town, dial on", status: "pending", detail: "no reader: orchestrator/test/reading-dial.test.ts holds the state hash of the same town with the dial off" });
  checks.push({ id: "extreme", name: "Extreme readers", status: "pending", detail: "no reader: design 13h step 7 (the kindest and curtest mocks against the dial off); not built" });

  // ---- what a failure does (13f): lines that fail the pairs or the two readers are off; respect, reason or answers off stops the slice
  const linesOff = new Set<Line>();
  for (const l of ["respect", "reason", "answers", "recourse", "threat"] as const) {
    const parting = pairs.map((p, i) => ({ p, v: verdicts[i]! })).filter((x) => x.p.parts_on[l] !== undefined);
    if (parting.length && frac(parting.filter((x) => x.v.byLine[l]).length, parting.length) < THRESHOLDS.pairs.line_right) linesOff.add(l);
  }
  for (const l of ["conservation", "openness", "enhancement", "transcendence"] as const) {
    const parting = pairs.map((p, i) => ({ p, v: verdicts[i]! })).filter((x) => x.p.parts_on[l] !== undefined);
    if (parting.length && frac(parting.filter((x) => x.v.byLine[l]).length, parting.length) < THRESHOLDS.pairs.line_right) linesOff.add(l);
  }
  for (const l of LINES) if ((kappas[l] ?? 1) < THRESHOLDS.two_readers.kappa) linesOff.add(l);
  const lines_off = LINES.filter((l) => linesOff.has(l));
  const usd = micro / 1e6;
  return {
    reader: reader.model, version: reader.version, checks, passed: checks.every((c) => c.status !== "fail"), calls, cost_usd: usd, mean_cost_usd: calls ? usd / calls : 0, declined,
    lines_off, stops: lines_off.some((l) => l === "respect" || l === "reason" || l === "answers"),
  };
}
