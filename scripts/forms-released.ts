// The forms a trained model's draft may be offered for: written beside the model's config.json as forms-released.json
// (`{"forms_released": [...], "basis": {...}}`), after forms-trained.json (scripts/forms-trained.ts) and read the same
// way (translator/model/adapter.ts `readerOf`). A form the model was taught is not for that reason one it answers for
// the world: it is released when, on its own real requests, it passes its own mark (the owner, 2026-10-14: a form is
// handed to our model as soon as it passes its mark, even while the model is under 90% on the whole; docs/decisions.md,
// "The third round, step 0"). A form not on the list is `form_unseen`, as a form never taught is: our draft is recorded
// and the translator behind drafts for the world. A folder with no such file is read as before (the forms taught).
// No model is called.
//
//   bun scripts/forms-released.ts MODEL_DIR RESULTS.json
//
// RESULTS.json: [{ "form": "rent_reminder", "real": { "n": 9, "right": 9, "wrong_drafts": 0 }, "generated": { "n": 40, "right": 38 } }, ...]
// (per form: its real requests, and its generated tests, as the evaluation counts them). Every form on the list must
// be one the model was taught (forms-trained.json beside it).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SIDECAR = "forms-released.json";

/** The per-form mark: at least `real_min` real requests of the form, `right_share` of them right with at most
 * `wrong_drafts` wrong drafts, and `right_share` of its generated tests right. */
export const MARK = { real_min: 8, right_share: 0.9, wrong_drafts: 0 };

export interface FormResult { form: string; real: { n: number; right: number; wrong_drafts: number }; generated: { n: number; right: number } }

/** Why a form is not released, or undefined where it is. */
export function whyNot(r: FormResult, mark = MARK): string | undefined {
  if (r.real.n < mark.real_min) return `${r.real.n} real requests, fewer than ${mark.real_min}`;
  if (r.real.wrong_drafts > mark.wrong_drafts) return `${r.real.wrong_drafts} wrong drafts on real requests`;
  if (r.real.right < Math.ceil(mark.right_share * r.real.n)) return `${r.real.right} of ${r.real.n} real requests right, under ${mark.right_share * 100}%`;
  if (r.generated.n === 0 || r.generated.right < Math.ceil(mark.right_share * r.generated.n)) return `${r.generated.right} of ${r.generated.n} generated tests right, under ${mark.right_share * 100}%`;
  return undefined;
}

/** The release table: the sorted names that pass, and for each that does not, why. A form is counted once. */
export function table(results: FormResult[], mark = MARK): { released: string[]; behind: { form: string; why: string }[] } {
  const by = new Map<string, FormResult>();
  for (const r of results) {
    if (by.has(r.form)) throw new Error(`${r.form} is in the results twice`);
    by.set(r.form, r);
  }
  const released: string[] = [], behind: { form: string; why: string }[] = [];
  for (const [form, r] of [...by].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const why = whyNot(r, mark);
    if (why) behind.push({ form, why });
    else released.push(form);
  }
  return { released, behind };
}

/** The arrangement's release (the third round, step 5; docs/decisions.md): the forms the model served before keep being
 * served (`old`: the forms a model already in use was taught: behaviour as it was), and a form taught since is released
 * only if the run as a whole may release any (`runRuleFired` false: wrong drafts on the new real set within the
 * plan's 2%) and it passes its own mark. A new form that passes its mark while the run rule has fired is named
 * ("passes, held by the run rule"). A form listed as taught with no per-form result (no example behind it) is behind. */
export function arrangement(results: FormResult[], trained: string[], old: string[], runRuleFired: boolean, mark = MARK): { released: string[]; behind: { form: string; why: string }[]; old_kept: number } {
  const t = table(results, mark);
  const oldSet = new Set(old), passes = new Set(t.released);
  const released = trained.filter((f) => oldSet.has(f));
  const behind: { form: string; why: string }[] = [];
  const have = new Map(results.map((r) => [r.form, r]));
  for (const f of trained.filter((f) => !oldSet.has(f)).sort()) {
    if (!have.has(f)) { behind.push({ form: f, why: "no per-form result: taught with no example behind it" }); continue; }
    if (passes.has(f)) {
      if (runRuleFired) behind.push({ form: f, why: "passes its own mark, held behind by the run-level rule (wrong drafts on the new real set above 2%)" });
      else released.push(f);
    } else behind.push({ form: f, why: t.behind.find((b) => b.form === f)!.why });
  }
  return { released: released.sort(), behind, old_kept: released.filter((f) => oldSet.has(f)).length };
}

/** A scorer's per-form block (step 4's RESULTS.json `per_form`) as the table reads it. */
export function fromPerForm(perForm: Record<string, { real: { right: number; of: number; wrong: number }; generated_tests: { right: number; of: number } }>): FormResult[] {
  return Object.entries(perForm).map(([form, p]) => ({ form, real: { n: p.real.of, right: p.real.right, wrong_drafts: p.real.wrong }, generated: { n: p.generated_tests.of, right: p.generated_tests.right } }));
}

/** The list written beside a model: "wrote", or "same"; a different list is refused (nothing is overwritten). Every name
 * must be a form the model was taught, where its folder says which. */
export function writeSidecar(modelDir: string, names: string[], basis: { mark: typeof MARK; behind: { form: string; why: string }[]; results?: string }): "wrote" | "same" {
  const trained = (() => { try { return JSON.parse(readFileSync(join(modelDir, "forms-trained.json"), "utf8")).forms_trained as string[]; } catch { return undefined; } })();
  if (trained) {
    const strange = names.filter((n) => !trained.includes(n));
    if (strange.length) throw new Error(`not forms the model was taught: ${strange.slice(0, 5).join(", ")}`);
  }
  const file = join(modelDir, SIDECAR);
  if (existsSync(file)) {
    let old: unknown;
    try { old = JSON.parse(readFileSync(file, "utf8")).forms_released; } catch { old = undefined; }
    if (JSON.stringify(old) === JSON.stringify(names)) return "same";
    throw new Error(`${file} exists with a different list; not overwritten`);
  }
  writeFileSync(file, JSON.stringify({ forms_released: names, basis }, null, 1) + "\n", { flag: "wx" });
  return "wrote";
}

if (import.meta.main && process.argv[2] === "--arrangement") {
  // bun scripts/forms-released.ts --arrangement MODEL_DIR RESULTS.json MODEL_NAME OLD_FORMS_TRAINED.json fired|clear [--dry]
  const [modelDir, resultsFile, name, oldFile, rule] = process.argv.slice(3);
  if (!modelDir || !resultsFile || !name || !oldFile || (rule !== "fired" && rule !== "clear")) { console.error("usage: bun scripts/forms-released.ts --arrangement MODEL_DIR RESULTS.json MODEL_NAME OLD_FORMS_TRAINED.json fired|clear [--dry]"); process.exit(2); }
  const trained = JSON.parse(readFileSync(join(modelDir, "forms-trained.json"), "utf8")).forms_trained as string[];
  const old = JSON.parse(readFileSync(oldFile, "utf8")).forms_trained as string[];
  const a = arrangement(fromPerForm(JSON.parse(readFileSync(resultsFile, "utf8"))[name].per_form), trained, old, rule === "fired");
  console.log(`${a.released.length} released (${a.old_kept} the model served before); ${a.behind.length} new forms stay behind`);
  for (const b of a.behind) console.log(`  behind: ${b.form}: ${b.why}`);
  if (!process.argv.includes("--dry")) console.log(writeSidecar(modelDir, a.released, { mark: MARK, behind: a.behind, results: resultsFile }));
} else if (import.meta.main) {
  const [modelDir, resultsFile] = process.argv.slice(2);
  if (!modelDir || !resultsFile) { console.error("usage: bun scripts/forms-released.ts MODEL_DIR RESULTS.json"); process.exit(2); }
  const t = table(JSON.parse(readFileSync(resultsFile, "utf8")) as FormResult[]);
  console.log(`${t.released.length} forms pass their mark; ${t.behind.length} stay behind`);
  for (const b of t.behind) console.log(`  behind: ${b.form}: ${b.why}`);
  console.log(writeSidecar(modelDir, t.released, { mark: MARK, behind: t.behind, results: resultsFile }) === "same" ? `${join(modelDir, SIDECAR)} already carries this list; nothing done` : `wrote ${join(modelDir, SIDECAR)}`);
}
