// The checked examples as what a model that decides and copies is trained on: the input cut into pieces, and each
// step a choice or a span of pieces (encode.ts). Usage:
//   bun translator/model/export.ts <DATA>/all <OUT> [--decoding slots]
// reads train.jsonl and validation.jsonl there and writes <OUT>/{train,validation}.jsonl and vocabulary.json.
// `--decoding slots`: the steps are the decisions of slot-by-slot decoding (encode.ts, "Slot by slot"); export.json
// then says so and carries the contract's slots (`grammar`), each row how many steps it is in the other decoding
// (`old`: a trainer told to can leave out exactly the rows a model of that decoding leaves out), and the report how
// many labels leave a form's required field out (the request does not give it; an answer may too).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { decode, decodeSlots, encode, grammar, joinCards, NotEncodable, ORDER, programFrom, splitCards, vocabulary, type Decoding, type Encoded, type Span, type Step } from "./encode";

/** The pieces of an input: runs of letters and digits, and every other character that isn't space, each with where
 * it starts and ends. A span of the input is a run of whole pieces (checked on export: nothing is cut mid-piece). */
export function pieces(input: string): { text: string; at: [number, number] }[] {
  const out: { text: string; at: [number, number] }[] = [];
  for (const m of input.matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]/gu)) out.push({ text: m[0], at: [m.index!, m.index! + m[0].length] });
  return out;
}

export interface Row { id: string; kind: string; pieces: string[]; at: [number, number][]; breaks: number[]; steps: (string | [string, number, number])[]; old?: number; /** `cards`: which pass the row is (choose, or fill of one form) */ mode?: "choose" | "fill"; /** a fill row's form, by name */ form?: string }

/** An example as the rows of the two passes (`cards`): its choose row, then a fill row for each form it fills. Undefined
 * where it cannot be read in two passes, or where the two put together are not the example's own decisions (counted as
 * cut by the export). */
export function cardRows(e: { id: string; kind: string; request: string; forms: string[]; program: string; spans?: Span[] }): Row[] | undefined {
  let enc: Encoded, split: ReturnType<typeof splitCards>;
  try {
    enc = encode(e, ORDER, "cards");
    if (decodeSlots(enc.input, enc.steps) !== calls.programText(calls.parseProgram(e.program))) return undefined;
    split = splitCards(e.request, e.forms, enc.steps);
    if (JSON.stringify(joinCards(e.request, e.forms, split.choose.steps, split.fills.map((f) => f.steps))) !== JSON.stringify(enc.steps)) return undefined;
  } catch (x) {
    if (x instanceof NotEncodable) return undefined;
    throw x;
  }
  const choose = row(e.id, e.kind, split.choose);
  if (!choose) return undefined;
  const out: Row[] = [{ ...choose, mode: "choose" }];
  for (const [k, f] of split.fills.entries()) {
    const r = row(`${e.id}#f${k}`, e.kind, f);
    if (!r || decodeSlots(enc.input, joinCards(e.request, e.forms, stepsOf(choose, choose.steps), split.fills.map((g, j) => (j === k ? stepsOf(r, r.steps) : g.steps)))) !== decodeSlots(enc.input, enc.steps)) return undefined;
    out.push({ ...r, mode: "fill", form: /^- ([^,]+),/.exec(e.forms[f.form]!)?.[1] });
  }
  return out;
}

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
  const asked = process.argv.includes("--decoding") ? process.argv[process.argv.indexOf("--decoding") + 1] : undefined;
  const decoding: Decoding = asked === "slots" || asked === "cards" ? asked : "steps";
  mkdirSync(out, { recursive: true });
  const all: Encoded[] = [];
  const report: { [side: string]: { examples: number; cut: number; longest_input: number; longest_steps: number; form_required_left_out?: number; lines?: { [n: string]: number } } } = {};
  // (validation-real: requests written in real situations and kept out of training, where the data has them. They
  // add nothing to the closed set of choices: one that makes a choice training never did is left out and counted.)
  // (validation-uf, translator v3: the examples of forms kept out of training entirely, scored as validation-real is.)
  const apart = ["validation-real", "validation-uf"];
  const sides = ["train", "validation", ...apart.filter((s) => existsSync(join(data, `${s}.jsonl`)))];
  const known = new Set<string>();
  for (const side of sides) {
    if (apart.includes(side)) for (const c of vocabulary(all)) known.add(c);
    const rows: Row[] = [];
    let cut = 0, lenient = 0;
    const lines: { [n: string]: number } = {};
    for (const l of readFileSync(join(data, `${side}.jsonl`), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const e = JSON.parse(l);
      if (decoding === "cards") {
        // Two passes: a choose row and a fill row for each form (`cardRows`); the closed set is made of their decisions.
        const rs = cardRows(e);
        if (!rs) { cut++; continue; }
        const encs: Encoded[] = rs.map((r) => ({ input: "", steps: r.steps.map((x) => (typeof x === "string" ? x : ["id", 0, 0])) as Step[] }));
        if (apart.includes(side)) {
          if (encs.some((x) => x.steps.some((y) => typeof y === "string" && !known.has(y)))) { cut++; continue; }
        } else all.push(...encs);
        const n = typeof rs[0]!.steps[1] === "string" && rs[0]!.steps[1].startsWith("lines:") ? rs[0]!.steps[1].slice(6) : "0";
        lines[n] = (lines[n] ?? 0) + 1;
        rows.push(...rs);
        continue;
      }
      const enc = encode(e, ORDER, decoding);
      const r = row(e.id, e.kind, enc);
      if (decoding === "slots") {
        // The decisions must come back to the program itself, as pieces too. (A row the other decoding cuts is cut
        // here as well, so both exports hold the same rows.)
        const want = calls.programText(calls.parseProgram(e.program));
        const other = encode(e);
        const otherRow = row(e.id, e.kind, other);
        if (!r || !otherRow || decode(other.input, stepsOf(otherRow, otherRow.steps)) !== decode(other.input, other.steps) || decodeSlots(enc.input, stepsOf(r, r.steps)) !== want) { cut++; continue; }
        r.old = other.steps.length;
        const lacks: { form: string; field: string }[] = [];
        decodeSlots(enc.input, enc.steps, { lacks });
        if (lacks.length) lenient++;
        const n = typeof enc.steps[1] === "string" && enc.steps[1].startsWith("lines:") ? enc.steps[1].slice(6) : "0";
        lines[n] = (lines[n] ?? 0) + 1;
      } else if (!r || decode(enc.input, stepsOf(r, r.steps)) !== decode(enc.input, enc.steps)) { cut++; continue; }
      if (apart.includes(side)) {
        if (enc.steps.some((x) => typeof x === "string" && !known.has(x))) { cut++; continue; }
      } else all.push(enc);
      rows.push(r);
    }
    writeFileSync(join(out, `${side}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    report[side] = { examples: rows.length, cut, longest_input: Math.max(...rows.map((r) => r.pieces.length)), longest_steps: Math.max(...rows.map((r) => r.steps.length)), ...(decoding !== "steps" ? { form_required_left_out: lenient, lines } : {}), ...(decoding === "cards" ? { choose: rows.filter((r) => r.mode === "choose").length, fill: rows.filter((r) => r.mode === "fill").length } : {}) };
  }
  writeFileSync(join(out, "vocabulary.json"), JSON.stringify(vocabulary(all), null, 1) + "\n");
  // How the steps were written, kept with them: a model answers in the order it was trained in.
  writeFileSync(join(out, "export.json"), JSON.stringify({ order: ORDER, ...(decoding !== "steps" ? { decoding, grammar: grammar() } : {}), from: data, ...report }, null, 1) + "\n");
  console.log(JSON.stringify(report));
}
