// The forms a trained model was taught: the sorted distinct form names in its training export, written beside the
// model's config.json as forms-trained.json (`{"forms_trained": [...], "export": "<the export>"}`). config.json and the
// weights are never opened for writing: the Python loader takes config.json's keys as they are, so the list lives apart
// (translator/model/adapter.ts `readerOf` reads it). No model is called.
//
//   bun scripts/forms-trained.ts MODEL_DIR EXPORT_DIR [OTHER_EXPORT_DIR]
//
// EXPORT_DIR is either the joined source (train.jsonl rows with `forms`: the form lines shown, whole strings) or the
// encoded export (train.jsonl rows with `pieces` and `breaks`: a form line begins at each break piece "-", its name
// the pieces up to the first ","). Train rows only. A second directory is a cross-check: both lists must agree.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { partsOf } from "../translator/model/subset";

export const SIDECAR = "forms-trained.json";

/** The sorted distinct form names in an export's train.jsonl (train rows only). */
export function formNamesOf(exportDir: string): string[] {
  const names = new Set<string>();
  for (const row of readFileSync(join(exportDir, "train.jsonl"), "utf8").split("\n")) {
    if (!row) continue;
    const r = JSON.parse(row);
    if (Array.isArray(r.forms)) {
      for (const line of r.forms as string[]) { const n = partsOf(line).name; if (n) names.add(n); }
    } else if (Array.isArray(r.pieces) && Array.isArray(r.breaks)) {
      // (A break is any line of the input, a bulleted request's included: a form line is `- name , to = ...`, so from
      // each `, to =` look back to the nearest "-" piece, which must be a break.)
      const p = r.pieces as string[], breaks = new Set<number>(r.breaks);
      for (let i = 1; i + 2 < p.length; i++) {
        if (p[i] !== "," || p[i + 1] !== "to" || p[i + 2] !== "=") continue;
        let b = i - 1;
        while (b >= 0 && p[b] !== "-") b--;
        if (b >= 0 && breaks.has(b) && i > b + 1) names.add(p.slice(b + 1, i).join(""));
      }
    } else throw new Error(`${exportDir}/train.jsonl: a row has neither forms nor pieces and breaks`);
  }
  return [...names].sort();
}

/** Write the sidecar. "wrote", or "same" (one already there with this very list: nothing done); a different one is refused. */
export function writeSidecar(modelDir: string, exportDir: string, names: string[]): "wrote" | "same" {
  const file = join(modelDir, SIDECAR);
  if (existsSync(file)) {
    let old: unknown;
    try { old = JSON.parse(readFileSync(file, "utf8")).forms_trained; } catch { old = undefined; }
    if (JSON.stringify(old) === JSON.stringify(names)) return "same";
    throw new Error(`${file} exists with a different list; not overwritten`);
  }
  writeFileSync(file, JSON.stringify({ forms_trained: names, export: exportDir }, null, 1) + "\n", { flag: "wx" });
  return "wrote";
}

if (import.meta.main) {
  const [modelDir, exportDir, other] = process.argv.slice(2);
  if (!modelDir || !exportDir) { console.error("usage: bun scripts/forms-trained.ts MODEL_DIR EXPORT_DIR [OTHER_EXPORT_DIR]"); process.exit(2); }
  const names = formNamesOf(exportDir);
  console.log(`${names.length} form names in ${exportDir}; sample: ${[0, 1, 2, Math.floor(names.length / 2), names.length - 1].map((i) => names[i]).join(", ")}`);
  if (other) {
    const b = formNamesOf(other);
    const same = JSON.stringify(b) === JSON.stringify(names);
    console.log(`${b.length} in ${other}: ${same ? "the two lists agree" : "THEY DIFFER"}`);
    if (!same) { console.log("only in first:", names.filter((n) => !b.includes(n)).slice(0, 10), "only in second:", b.filter((n) => !names.includes(n)).slice(0, 10)); process.exit(1); }
  }
  console.log(writeSidecar(modelDir, exportDir, names) === "same" ? `${join(modelDir, SIDECAR)} already carries this list; nothing done` : `wrote ${join(modelDir, SIDECAR)}`);
}
