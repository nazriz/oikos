// Right, as translator v4 scores it (docs/design/translator-v4.md, section 5), shared by v4-score.ts, v4-serve.ts and
// the keys' third reader (train/v4-pilot/third.ts): the same act by meaning (meaning.ts, which follows
// contracts/test/id-or-words.json), copied free text allowed to differ at its edges by punctuation or at most two words
// with no figure (fair.py's rule); two refusals the seat is told in the same words are one answer (resolver.ts
// `toldAlike`).
import { calls } from "@oikos/participants";
import { formOfLine } from "../train/blind";
import { sameMeaning } from "../train/meaning";
import { toldAlike } from "../src/resolver";

const FREE: { [fn: string]: string[] } = { message: ["text"], statement: ["text"], agreement: ["text", "terms"], money: ["for", "memo"] };
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
/** `got` read as the same answer as `gold` for row `r` ({forms, currency?}). */
export function right(got: string | null | undefined, gold: string, r: { forms: string[]; currency?: string }): boolean {
  if (!got) return false;
  if (toldAlike(got, gold)) return true;
  const ctx = { ...(r.currency ? { currency: r.currency } : {}), forms: r.forms.map(formOfLine).filter(Boolean) };
  try {
    if (sameMeaning(got, gold, ctx as never)) return true;
    if (!sameMeaning(got, gold, { ...ctx, freeText: false } as never)) return false;
  } catch { return false; }
  const a = freeTexts(got), b = freeTexts(gold);
  return a.length === b.length && a.every((t, k) => t === b[k] || edgesOnly(t, b[k]!));
}
