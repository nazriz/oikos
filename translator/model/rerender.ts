// Translator v4's data by code (docs/design/translator-v4.md, section 3, step 1): a training row re-rendered inside a
// real seat's full view of cards. No model is called.
//
// What the shift is (measured on v3's data, 2026-11-07): real choose inputs are long because of the cards, not the
// request. validation-real's median request is 224 characters against training's 178, but it is shown 6 forms (90th
// percentile 15) against training's 1 (14); the synthetic, log and case rows, two thirds of training, are shown none.
// Real programs are one line as often as training's (99th percentile 2 lines in both), so joining rows into programs of
// 2 to 5 lines would open a new shift, not close one: not done (docs/decisions.md, 2026-11-07, "Translator v4: data").
//
// The rule, for each training and validation row:
//   1. a row shown 3 forms or more is left as it is (it already sits in a seat's view);
//   2. so is a row whose answer depends on what was not shown (`none(unknown_form)`, `none(no_such_act)`): a card added
//      could make it an act, and the label would be wrong;
//   3. for the rest, a number of cards is drawn from validation-real's own counts (real views are bimodal: a mayor's two
//      town forms, or an office's 10 to 25); a draw of 0 or 1 leaves the row as it is, so that a row shown few cards is
//      not, by that alone, one of rule 2's;
//   4. the row is given a card list a seat really had (the train side's pilot and in-situ rows, never a test pilot's),
//      of the length nearest the draw: where the row fills a form and a list holds a form of that name, one such list,
//      with the row's own line in that form's place; otherwise any list, the row's lines put in at seeded places;
//   5. a card is left out where its name or office shares a word of the request that the row's own forms do not
//      (the card might be what the request means: the label would be wrong), where its name or record id is one of the
//      row's own, or where it is one of the forms kept out of training (validation-uf);
//   6. the result must still read in two passes to its own program (`cardRows`), or the row is kept as it was.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardRows } from "./export";
import { partsOf, wordsOf } from "./subset";

/** Pilots whose seat-days are test only (docs/design/translator-v4.md, section 3): their card lists are never used. */
export const TEST_ONLY = /^(?:pilot )?(?:lv-07a|lv-07b|lv-07|lv-08|lv-10|lv-12|r180)\b/i;

/** Rows whose answer depends on which forms were shown: never given more. */
const BY_ABSENCE = /^none\((?:unknown_form|no_such_act)\b/;

export interface Row { id: string; request: string; forms: string[]; program: string; kind: string; origin?: string; source?: string; groups?: Record<string, string>; spans?: unknown[] }

/** The card lists seats really had, from rows of the train side: one per distinct list, with the seat it came from. */
export function cardLists(rows: Row[], min = 2): { seat: string; lines: string[] }[] {
  const seen = new Set<string>();
  const out: { seat: string; lines: string[] }[] = [];
  for (const r of rows) {
    if ((r.origin !== "pilot" && r.origin !== "in_situ") || r.forms.length < min || TEST_ONLY.test(String(r.source ?? ""))) continue;
    const k = r.forms.join("\n");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ seat: String(r.source ?? "").replace(/\/d\d+(?:\/.*)?$/, ""), lines: r.forms });
  }
  return out;
}

const namesFilled = (program: string): string[] => [...program.matchAll(/\bform=([\w.-]+)/g)].map((m) => m[1]!);
const cardWords = (line: string): Set<string> => {
  const p = partsOf(line);
  const office = /, to=([^,]+),/.exec(line)?.[1] ?? "";
  return wordsOf(`${p.name.replace(/_/g, " ")} ${office.replace(/[-_]/g, " ")}`);
};

/** The row inside a real seat's cards, by the rule above (undefined: left as it was, for the reason given). */
export function rerender(e: Row, lists: { seat: string; lines: string[] }[], rand: () => number, sizes: number[], keptOut: Set<string> = new Set()): { row: Row } | { left: string } {
  if (e.forms.length >= 3) return { left: "already in a view" };
  if (BY_ABSENCE.test(String(e.program))) return { left: "answer depends on what was not shown" };
  const want = sizes[Math.floor(rand() * sizes.length)]!;
  if (want < 2) return { left: "drawn 0 or 1 cards: kept as it was" };
  if (!lists.length) return { left: "no card lists" };
  const own = e.forms.map(partsOf);
  const ownNames = new Set(own.map((p) => p.name)), ownIds = new Set(own.map((p) => p.id));
  const fills = namesFilled(e.program);
  const safe = new Set<string>();
  if (fills.length) for (const l of e.forms) for (const w of cardWords(l)) safe.add(w);
  const asked = wordsOf(e.request);
  const near = fills.length ? lists.filter((x) => x.lines.some((l) => fills.includes(partsOf(l).name))) : [];
  const pool = near.length ? near : lists;
  const gap = Math.min(...pool.map((x) => Math.abs(x.lines.length - want)));
  const closest = pool.filter((x) => Math.abs(x.lines.length - want) <= Math.max(gap, 1));
  const list = closest[Math.floor(rand() * closest.length)]!;
  const out: string[] = [];
  const placed = new Set<string>();
  for (const l of list.lines) {
    const p = partsOf(l);
    if (ownNames.has(p.name)) {
      const mine = e.forms.find((x) => partsOf(x).name === p.name)!;
      if (!placed.has(mine)) { out.push(mine); placed.add(mine); }
      continue;
    }
    if (ownIds.has(p.id) || keptOut.has(p.name)) continue;
    if ([...cardWords(l)].some((w) => asked.has(w) && !safe.has(w))) continue;
    out.push(l);
  }
  for (const l of e.forms) if (!placed.has(l)) out.splice(Math.floor(rand() * (out.length + 1)), 0, l);
  const row = { ...e, forms: out, groups: { ...(e.groups ?? {}), cards: list.seat } };
  if (!cardRows(row as never)) return { left: "does not read in two passes inside the list" };
  return { row };
}

if (import.meta.main) {
  // bun translator/model/rerender.ts <joined dir> <out dir>: train and validation re-rendered; validation-real and
  // validation-uf copied as they are; the leak check against the held-out cases and the test pilots' requests (by code).
  const [src, out] = process.argv.slice(2) as [string, string];
  mkdirSync(out, { recursive: true });
  const jl = (f: string): Row[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  let seed = 20261107;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
  const keptOut = new Set<string>(manifest.unseen_forms ?? []);
  const train = jl(join(src, "train.jsonl"));
  const lists = cardLists(train);
  const sizes = jl(join(src, "validation-real.jsonl")).map((e) => e.forms.length);
  const report: Record<string, unknown> = { from: src, card_lists: lists.length, seats: new Set(lists.map((l) => l.seat)).size };
  const { loadHeldOut, sharesWording } = await import("../eval/held-out");
  const held = loadHeldOut();
  const shares = held ? sharesWording(held) : () => false;
  report.held_out_checked_by_code = !!held;
  for (const side of ["train", "validation"]) {
    const rows = side === "train" ? train : jl(join(src, `${side}.jsonl`));
    const why: Record<string, number> = {};
    const done = rows.map((e) => {
      const r = rerender(e, lists, rand, sizes, keptOut);
      if ("row" in r) { why["re-rendered"] = (why["re-rendered"] ?? 0) + 1; return r.row; }
      why[r.left] = (why[r.left] ?? 0) + 1;
      return e;
    }).filter((e) => !shares(e.request) && !TEST_ONLY.test(String(e.source ?? "")));
    why["leak or test-only source: dropped"] = rows.length - done.length;
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
    const n = done.map((e) => e.forms.length);
    report[side] = { rows: done.length, ...why, forms_median: q(n, 0.5), forms_p90: q(n, 0.9), multi_line_share: +(done.filter((e) => e.program.includes("\n")).length / done.length).toFixed(4) };
    writeFileSync(join(out, `${side}.jsonl`), done.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  for (const side of ["validation-real", "validation-uf"]) {
    const rows = jl(join(src, `${side}.jsonl`));
    const n = rows.map((e) => e.forms.length).sort((a, b) => a - b);
    report[side] = { rows: rows.length, forms_median: n[Math.floor(n.length / 2)], multi_line_share: +(rows.filter((e) => e.program.includes("\n")).length / rows.length).toFixed(4) };
    writeFileSync(join(out, `${side}.jsonl`), rows.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...report, unseen_forms: [...keptOut].sort() }, null, 1) + "\n");
  console.log(JSON.stringify(report, null, 1));
}
