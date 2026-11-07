// Translator v4's scores (docs/design/translator-v4.md, section 5): one request at a time, whole (every pass), each
// model's program against the label by meaning, as the resolver would act on it. Offline; nothing is sent behind.
//
//   bun translator/model/v4-score.ts --set <rows.jsonl> --model decide/<name> [--model text:<answers.jsonl>] ... --out <file.json>
//
// rows: text-export.ts's {id, request, forms, program, groups?, currency?}. A `decide/` model is asked through the
// adapter (its own answer, before any release or cut-off: `wrote`, and its sureness); a `text:` model's answers come
// from text_model.py `answer` over the same rows. Right: the same act by meaning (meaning.ts, which follows
// contracts/test/id-or-words.json), copied free text allowed to differ at its edges by punctuation or at most two words
// with no figure (fair.py's rule). Reported for each model: right in all; the cut-off on sureness where confidently
// wrong (wrong and served) is at most 1% of what is served, and right served there (the headline); the same cut-off
// held to a one-sided 95% bound (Clopper-Pearson) instead of the point; by writer at that cut-off (parity); latency.
import { readFileSync, writeFileSync } from "node:fs";
import { calls } from "@oikos/participants";
import { formOfLine } from "../train/blind";
import { sameMeaning } from "../train/meaning";
import { DecideAdapter } from "./adapter";

const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]!] : []));
const one = (k: string) => all(k)[0];
const rows: any[] = readFileSync(one("set")!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const FREE: { [fn: string]: string[] } = { message: ["text"], statement: ["text"], agreement: ["text", "terms"], money: ["for"] };
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
/** Free texts of a program, in order. */
function freeTexts(p: string): string[] {
  try {
    const x = calls.parseProgram(p);
    if ("none" in x) return [];
    const out: string[] = [];
    const visit = (c: calls.Call) => { for (const [k, v] of Object.entries(c.args)) { if ("call" in v) visit(v.call); else if ("text" in v && (FREE[c.fn]?.includes(k) || (c.fn === "form" && v.text.split(" ").length > 6))) out.push(v.text); } };
    x.lines.forEach((l) => visit(l.call));
    return out;
  } catch { return []; }
}
/** Two copies of one text that differ only at their edges: punctuation, or at most two words with no figure. */
function edgesOnly(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (l.length - s.length > 2) return false;
  for (let k = 0; k + s.length <= l.length; k++) {
    if (s.every((w, j) => l[k + j] === w)) return [...l.slice(0, k), ...l.slice(k + s.length)].every((w) => !/\d/.test(w));
  }
  return false;
}
function right(got: string | null | undefined, gold: string, r: any): boolean {
  if (!got) return false;
  const ctx = { ...(r.currency ? { currency: r.currency } : {}), forms: r.forms.map(formOfLine).filter(Boolean) };
  if (sameMeaning(got, gold, ctx)) return true;
  if (!sameMeaning(got, gold, { ...ctx, freeText: false })) return false;
  const a = freeTexts(got), b = freeTexts(gold);
  return a.length === b.length && a.every((t, k) => t === b[k] || edgesOnly(t, b[k]!));
}

/** The upper end of a one-sided 95% interval on a rate of k in n (Clopper-Pearson, by bisection on the binomial tail). */
function upper(k: number, n: number): number {
  if (n === 0) return 1;
  const tail = (p: number) => { let s = 0, t = Math.pow(1 - p, n); for (let i = 0; i <= k; i++) { s += t; t = (t * (n - i) / (i + 1)) * (p / (1 - p)); } return s; };
  let lo = k / n, hi = 1;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; tail(m) > 0.05 ? (lo = m) : (hi = m); }
  return hi;
}
interface Ans { id: string; program: string | null; sure: number; ms: number; ok: boolean; writer: string }
/** Served: an answer that is an act or a refusal other than asking back (`none(unclear)`, or no program: the request is
 * asked back to the seat in the world's own terms, never counted confidently wrong). */
const servable = (a: Ans) => !!a.program && a.program.trim() !== "none(unclear)";
function curve(xs: Ans[], bound: boolean) {
  const sorted = xs.filter(servable).sort((a, b) => b.sure - a.sure);
  let best = { cut: 1.01, served: 0, right: 0, wrong: 0 };
  let r = 0, w = 0;
  for (let k = 0; k < sorted.length; k++) {
    sorted[k]!.ok ? r++ : w++;
    if (sorted[k + 1] && sorted[k + 1]!.sure === sorted[k]!.sure) continue;
    const served = r + w;
    const okRate = bound ? upper(w, served) <= 0.01 : w <= 0.01 * served;
    if (okRate && r > best.right) best = { cut: sorted[k]!.sure, served, right: r, wrong: w };
  }
  return best;
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };
const writerOf = (r: any) => r.groups?.writer ?? r.from?.writer ?? "(not recorded)";

const report: any = { set: one("set"), rows: rows.length, models: {} };
for (const m of all("model")) {
  const answers: Ans[] = [];
  if (m.startsWith("decide/")) {
    const a = new DecideAdapter(m.slice(7), { first: true, quiet: true, unreleased: true });
    await a.ready();
    for (const r of rows) {
      const t0 = performance.now();
      const x = await a.translate(r.request, r.forms, { draft: true });
      const program = x.wrote ?? x.program;
      answers.push({ id: r.id, program, sure: x.sure, ms: x.ms ?? performance.now() - t0, ok: right(program, r.program, r), writer: writerOf(r) });
    }
    a.close();
  } else if (m.startsWith("text:")) {
    const got = new Map(readFileSync(m.slice(5), "utf8").split("\n").filter((l) => l.trim()).map((l) => { const x = JSON.parse(l); return [x.id, x]; }));
    for (const r of rows) {
      const x: any = got.get(r.id) ?? { program: null, sure: 0, ms: 0 };
      answers.push({ id: r.id, program: x.program, sure: x.sure ?? 0, ms: x.ms ?? 0, ok: right(x.program, r.program, r), writer: writerOf(r) });
    }
  } else throw new Error(`a model is decide/<name> or text:<answers.jsonl>: ${m}`);
  const point = curve(answers, false), bound = curve(answers, true);
  const byWriter: any = {};
  for (const w of [...new Set(answers.map((a) => a.writer))].sort()) {
    const xs = answers.filter((a) => a.writer === w);
    const served = xs.filter((a) => a.sure >= point.cut && servable(a));
    byWriter[w] = { n: xs.length, right: xs.filter((a) => a.ok).length, right_served: served.filter((a) => a.ok).length, wrong_served: served.filter((a) => !a.ok).length, asked_back: xs.length - served.length };
  }
  const shares = Object.values(byWriter).filter((v: any) => v.n >= 20).map((v: any) => v.right_served / v.n);
  report.models[m] = {
    right: answers.filter((a) => a.ok).length, of: answers.length,
    at_1pct: { ...point, right_served_share: +(point.right / answers.length).toFixed(4) },
    at_1pct_bound95: { ...bound, right_served_share: +(bound.right / answers.length).toFixed(4) },
    parity_spread_points: shares.length > 1 ? +(100 * (Math.max(...shares) - Math.min(...shares))).toFixed(1) : null,
    by_writer: byWriter,
    ms: { median: Math.round(q(answers.map((a) => a.ms), 0.5)), p95: Math.round(q(answers.map((a) => a.ms), 0.95)) },
  };
  if (one("answers")) writeFileSync(`${one("answers")}.${m.replace(/[^\w.-]+/g, "_")}.jsonl`, answers.map((a) => JSON.stringify(a)).join("\n") + "\n");
  console.error(m, JSON.stringify({ right: report.models[m].right, of: answers.length, at_1pct: report.models[m].at_1pct, ms: report.models[m].ms }));
}
writeFileSync(one("out")!, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
