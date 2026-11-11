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
import { AgreeAdapter, DecideAdapter, SERVING_CHECKS } from "./adapter";
import * as C from "./v4-curve";
import { right } from "./v4-right";
import { taught } from "./taught";

const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]!] : []));
const one = (k: string) => all(k)[0];
const rows: any[] = readFileSync(one("set")!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

interface Ans { id: string; program: string | null; sure: number; ms: number; ok: boolean; writer: string; parts?: object; steps?: number; own?: string | null; own_ok?: boolean; withheld?: string }
/** Served: an answer that is an act or a refusal other than asking back (`none(unclear)`, or no program: the request is
 * asked back to the seat in the world's own terms, never counted confidently wrong). */
const servable = (a: Ans) => !!a.program && a.program.trim() !== "none(unclear)";
const curve = (xs: Ans[], bound: boolean) => C.curve(xs.map((a) => ({ sure: a.sure, ok: a.ok, served: servable(a), writer: a.writer })), bound);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };
const writerOf = (r: any) => r.groups?.writer ?? r.from?.writer ?? "(not recorded)";

const report: any = { set: one("set"), rows: rows.length, models: {} };
for (const m of all("model")) {
  const answers: Ans[] = [];
  if (m.startsWith("decide/")) {
    // (`decide/<a>+<b>`: two models, served only where both write the same program: AgreeAdapter.)
    const a = m.includes("+") ? new AgreeAdapter(m.slice(7), { first: true, quiet: true, unreleased: true }) : new DecideAdapter(m.slice(7), { first: true, quiet: true, unreleased: true });
    await a.ready();
    for (const r of rows) {
      const t0 = performance.now();
      const x = await a.translate(r.request, r.forms, { draft: true });
      // The model's own answer, before anything this adapter withholds for reasons of its own (a form not shown, a
      // release by kind): what is scored. A serving check (SERVING_CHECKS: two models disagreeing, copied words cut
      // short) is part of what is served, so its answer is asked back, and the model's own is kept beside it.
      // (`--taught`: a model trained before 2026-11-10 read as the host now serves it, what code sets by rule left out
      // and a payment's for= as its memo, so that it is scored on the same keys as one taught the new language.)
      const asTaught = (p: string) => { if (!args.includes("--taught")) return p; try { return taught(p) ?? "none(unclear)"; } catch { return p; } };
      const own = asTaught(x.wrote ?? x.program);
      const program = x.withheld && SERVING_CHECKS.includes(x.withheld) ? asTaught(x.program) : own;
      // (Its sureness in parts, for a calibration measured outside: calibrate.py.)
      const last = a.answers.at(-1);
      answers.push({ id: r.id, program, sure: x.sure, ms: x.ms ?? performance.now() - t0, ok: right(program, r.program, r), writer: writerOf(r), ...(program !== own ? { own, own_ok: right(own, r.program, r), withheld: x.withheld } : {}), ...(last?.parts ? { parts: last.parts } : {}), ...(last?.steps !== undefined ? { steps: last.steps } : {}) });
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
    right: answers.filter((a) => a.own_ok ?? a.ok).length, of: answers.length, asked_back_by_checks: answers.filter((a) => a.withheld).length,
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
