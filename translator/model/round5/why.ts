// What a trained model answers to the in-repo real cases (translator/eval/pilot-cases.ts) and why it offers no draft
// where it offers none (the adapter's `withheld`), as the served adapter reads it. For reading a run's R180 score.
//   OIKOS_TRANSLATOR_MODELS=<dir> bun translator/model/round5/why.ts <model> [<n>]
import { DecideAdapter } from "../adapter";
import { PILOT_CASES, FORMS } from "../../eval/pilot-cases";
import { formShown } from "../../src/index";

const [model, n] = process.argv.slice(2);
const a = new DecideAdapter(model!, { quiet: true });
await a.ready();
const why = new Map<string, number>();
for (const c of PILOT_CASES.slice(0, Number(n ?? 40))) {
  const forms = c.forms ? (FORMS[c.forms] as any[]).map((f) => formShown(f)) : [];
  const x = await a.translate(c.request, forms, { draft: false });
  const k = `${x.withheld ?? (x.program.startsWith("none(") ? x.program : "drafted")}`;
  why.set(k, (why.get(k) ?? 0) + 1);
  if (process.env.SHOW) console.log(c.id, k, x.sure.toFixed(3), (x.wrote ?? x.program).slice(0, 160));
}
console.log(Object.fromEntries(why));
a.close();
