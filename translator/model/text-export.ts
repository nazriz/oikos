// Translator v4's text writer (docs/design/translator-v4.md, section 2, run C): its training rows, as the request, the
// cards and the program written out in the call language. The program is the label the encoders are trained on, made
// one way (py/fair.py `canonical`, applied to the export's steps): each example's choose row and fill rows are joined
// back (encode.ts `joinCards`) and written as the program they decode to, so all three runs of batch 1 learn one key.
//   bun translator/model/text-export.ts <joined dir> <canonical export dir> <out dir>
// Writes <out>/{train,validation,validation-real,validation-uf}.jsonl: {id, kind, request, forms, program}.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { decodeSlots, inputOf, joinCards } from "./encode";
import { stepsOf, type Row } from "./export";

/** An example's program from its two passes' rows (choose, then each fill in order), as the export wrote them. */
export function programOfRows(e: { request: string; forms: string[] }, choose: Row, fills: Row[]): string {
  const steps = joinCards(e.request, e.forms, stepsOf(choose, choose.steps), fills.map((f) => stepsOf(f, f.steps)));
  return decodeSlots(inputOf(e.request, e.forms), steps);
}

if (import.meta.main) {
  const [joined, exp, out] = process.argv.slice(2) as [string, string, string];
  mkdirSync(out, { recursive: true });
  const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const report: Record<string, object> = {};
  for (const side of ["train", "validation", "validation-real", "validation-uf"]) {
    if (!existsSync(join(joined, `${side}.jsonl`))) continue;
    // (The export writes each example's rows in order, choose then its fills, and leaves out the ones it cuts: read in
    // step. An id can stand more than once in the joined data.)
    const xs = jl(join(exp, `${side}.jsonl`)) as Row[];
    let at = 0;
    const n = { examples: 0, written: 0, changed_by_canonical: 0, not_exported: 0, not_joined: 0 };
    const lines: string[] = [];
    for (const e of jl(join(joined, `${side}.jsonl`))) {
      n.examples++;
      if (xs[at]?.id !== e.id || xs[at]?.mode !== "choose") { n.not_exported++; continue; }
      const choose = xs[at++]!;
      const fills: Row[] = [];
      while (xs[at]?.mode === "fill" && xs[at]!.id.startsWith(`${e.id}#f`)) fills.push(xs[at++]!);
      let program: string;
      try { program = programOfRows(e, choose, fills); } catch { n.not_joined++; continue; }
      if (program !== calls.programText(calls.parseProgram(e.program))) n.changed_by_canonical++;
      lines.push(JSON.stringify({ id: e.id, kind: e.kind, request: e.request, forms: e.forms, program, ...(e.groups ? { groups: e.groups } : {}), ...(e.currency ? { currency: e.currency } : {}) }));
      n.written++;
    }
    writeFileSync(join(out, `${side}.jsonl`), lines.join("\n") + "\n");
    report[side] = n;
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ joined, export: exp, ...report }, null, 1) + "\n");
  console.log(JSON.stringify(report));
}
