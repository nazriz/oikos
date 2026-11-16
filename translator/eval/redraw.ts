// Real requests drawn again by our own translator (offline: the served model, no key, no spend), on the forms as each
// seat was shown them or on a changed form, and scored as score.ts scores (ruled on the seat's knowledge as it stood,
// against the set's target, by the same acts). What a change to a form's blanks does can only be measured so: score.ts
// replays the logged draws on the logged forms (docs/decisions.md, 2026-11-17, "Redrawn by our translator").
//
//   bun translator/eval/redraw.ts --keys <file: run|arm|ref per line> --variants <set>:<name,...> [--model round3-s2]
//
// A variant (redraw-forms.ts) changes each form the seat holds before it is shown and maps a draw's blank names back.
// It writes one JSON line per request and variant: the logged draw, the draw now, ruled, whether right, and, for a
// variant that types a list as counts, whether the resolver would refuse it. Needs OIKOS_TRANSLATOR_MODELS (the
// models' folder, as served.json says).
import { readFileSync } from "node:fs";
import { calls } from "@oikos/participants";
import { DecideAdapter } from "../model/adapter";
import { formShownTo } from "../src/index";
import { resolve } from "../src/resolver";
import * as R from "../src/rules";
import { canon, withKnowledge } from "./requests";
import { REDRAW_VARIANTS } from "./redraw-forms";
import { itemKey, loadArms, loadSet } from "./score";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const want = new Set(readFileSync(flag("--keys")!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean));
const [set, list] = (flag("--variants") ?? "tribunal:a").split(":");
const variants = REDRAW_VARIANTS[set!]!;
const names = list!.split(",");
const targets = new Map<string, string>(loadSet().items.map((x) => [itemKey(x), x.target]));
const effect = (p: calls.Program, k: any) => { const res = resolve(p, k, () => undefined, [...k.held][0], { written: true }); return res.ok ? JSON.stringify(res.blocks) : `asked: ${res.questions.join(" ")}`; };

const a = new DecideAdapter(flag("--model") ?? "round3-s2", { first: true, quiet: true, unreleased: true });
await a.ready();
for (const arm of loadArms()) for (const [r, k] of withKnowledge(arm)) {
  const key = `${arm.run}|${arm.arm}|${r.ref}`;
  if (!want.has(key)) continue;
  for (const v of names) {
    const vt = variants[v]!;
    const x = await a.translate(r.request, k.forms.map((f) => formShownTo(vt.change(f) as typeof f, k.held)), { draft: true });
    const program = x.wrote ?? x.program;
    const back = vt.back(program);
    let ok = false, now = "";
    try {
      const ru = R.ruled(R.formRules(calls.parseProgram(back), r.request, k, R.recordTest(k)), r.request, R.recordTest(k));
      now = ru.ok ? calls.programText(ru.program) : `(asked: ${ru.ask})`;
      const t = targets.get(key);
      ok = !!t && ru.ok && (canon(now) === canon(t) || effect(ru.program, k) === effect(calls.parseProgram(t), k));
    } catch (e) { now = `(failed: ${String(e).slice(0, 80)})`; }
    const refused = vt.refuses?.(back) ?? false;
    console.log(JSON.stringify({ key, variant: v, raw: r.raw, program, back, now, ok, refused, sure: x.sure }));
  }
}
a.close();
process.exit(0);
