// The checked examples as what a model that decides and copies is trained on: the input cut into pieces, and each
// step a choice or a span of pieces (encode.ts). Usage:
//   bun translator/model/export.ts <DATA>/all <OUT>
// reads train.jsonl and validation.jsonl there and writes <OUT>/{train,validation}.jsonl and vocabulary.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, encode, vocabulary, type Encoded, type Step } from "./encode";

/** The pieces of an input: runs of letters and digits, and every other character that isn't space, each with where
 * it starts and ends. A span of the input is a run of whole pieces (checked on export: nothing is cut mid-piece). */
export function pieces(input: string): { text: string; at: [number, number] }[] {
  const out: { text: string; at: [number, number] }[] = [];
  for (const m of input.matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]/gu)) out.push({ text: m[0], at: [m.index!, m.index! + m[0].length] });
  return out;
}

export interface Row { id: string; kind: string; pieces: string[]; at: [number, number][]; breaks: number[]; steps: (string | [string, number, number])[] }

/** An encoded example as pieces: each pointer as the first and last piece of its span. Undefined where a span cuts a piece. */
export function row(id: string, kind: string, e: Encoded): Row | undefined {
  const ps = pieces(e.input);
  const starts = new Map(ps.map((p, i) => [p.at[0], i]));
  const ends = new Map(ps.map((p, i) => [p.at[1], i]));
  const steps: Row["steps"] = [];
  for (const s of e.steps) {
    if (typeof s === "string") steps.push(s);
    else {
      const a = starts.get(s[1]), b = ends.get(s[2]);
      if (a === undefined || b === undefined || b < a) return undefined;
      steps.push([s[0], a, b]);
    }
  }
  // Where each line of the input begins (the request, then each form): a piece index.
  const breaks: number[] = [];
  for (let at = e.input.indexOf("\n"); at >= 0; at = e.input.indexOf("\n", at + 1)) breaks.push(ps.findIndex((p) => p.at[0] > at));
  return { id, kind, pieces: ps.map((p) => p.text), at: ps.map((p) => p.at), breaks, steps };
}

/** A row's steps back as steps over the input's characters. */
export const stepsOf = (r: Pick<Row, "at">, steps: Row["steps"]): Step[] => steps.map((s) => (typeof s === "string" ? s : [s[0] as "id", r.at[s[1]]![0], r.at[s[2]]![1]]));

if (import.meta.main) {
  const [data, out] = process.argv.slice(2) as [string, string];
  mkdirSync(out, { recursive: true });
  const all: Encoded[] = [];
  const report: { [side: string]: { examples: number; cut: number; longest_input: number; longest_steps: number } } = {};
  for (const side of ["train", "validation"]) {
    const rows: Row[] = [];
    let cut = 0;
    for (const l of readFileSync(join(data, `${side}.jsonl`), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const e = JSON.parse(l);
      const enc = encode(e);
      const r = row(e.id, e.kind, enc);
      if (!r || decode(enc.input, stepsOf(r, r.steps)) !== decode(enc.input, enc.steps)) { cut++; continue; }
      all.push(enc);
      rows.push(r);
    }
    writeFileSync(join(out, `${side}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    report[side] = { examples: rows.length, cut, longest_input: Math.max(...rows.map((r) => r.pieces.length)), longest_steps: Math.max(...rows.map((r) => r.steps.length)) };
  }
  writeFileSync(join(out, "vocabulary.json"), JSON.stringify(vocabulary(all), null, 1) + "\n");
  console.log(JSON.stringify(report));
}
