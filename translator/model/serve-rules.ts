// Exact checks on a trained model's answer before it is served (docs/design/translator-v4.md, section 4: what is exact
// goes in code). Each is a property of the answer and the request alone, the same for every base and every writer; an
// answer that fails one is asked back, never altered.
import { calls } from "@oikos/participants";

/** The fields whose copied words are said as they stand (a message, a statement, an agreement's terms, what a payment
 * is for, a form's field typed text of three words or more: a shorter one is a label, "waste"): what is sent or filed
 * must not stop part way through a sentence of the request. */
const WHOLE_WORDS: { [fn: string]: string[] } = { message: ["text"], statement: ["text"], agreement: ["text", "terms"], money: ["for"] };
const textFieldsOf = (forms: string[]) => {
  const s = new Set<string>();
  for (const l of forms) for (const m of l.matchAll(/([a-z_]+) \(text(?:, required)?\)/g)) s.add(m[1]!);
  return s;
};
const WORD = /[\p{L}\p{N}]/u;
// (A sentence ends at . ! ? or ; then a space or the end; closing quotes and brackets may stand before it.)
const ENDS = /^[\s"'”’)\]]*([.!?;:]|$)/;
const SENTENCE_END = /[.!?;](?=\s|$)/;

/**
 * Copied words cut short: a text that is a paper's words, copied from the request, stops where the request's sentence
 * goes on, and nothing else the answer says accounts for the rest of that sentence (another argument's value: an id, a
 * record, an amount, other copied words). Round 2's surest wrong answers were of this family (a message's words that
 * stop before the clause that ends them). With `trailing`, also words that end at a sentence's end where the request
 * goes on with sentences nothing else of the answer accounts for: whether those belong to the paper is a reading the
 * copy cannot settle (round 2's surest wrong message left out "A general count of buildings is not what I need."; as
 * many right ones leave out a sentence that is the asker's reason). Not a payment's `for` there, which is a
 * description, not a paper's words. Returns the field and which, or undefined where the answer is neither.
 */
export function cutShort(request: string, program: string, forms: string[] = [], o: { trailing?: boolean } = {}): { field: string; kind: "cut_short" | "trailing" } | undefined {
  let p: calls.Program;
  try {
    p = calls.parseProgram(program);
  } catch {
    return undefined;
  }
  if ("none" in p) return undefined;
  const typed = textFieldsOf(forms);
  const texts: { fn: string; field: string; text: string }[] = [];
  const others: string[] = [];
  const visit = (c: calls.Call) => {
    for (const [k, v] of Object.entries(c.args)) {
      if ("call" in v) visit(v.call);
      else if ("text" in v) {
        if (WHOLE_WORDS[c.fn]?.includes(k) || (c.fn === "form" && typed.has(k) && v.text.trim().split(/\s+/).length >= 3)) texts.push({ fn: c.fn, field: k, text: v.text });
        else others.push(v.text);
      } else if ("id" in v) others.push(v.id);
      else if ("json" in v) others.push(...JSON.stringify(v.json).match(/[\w.@-]{3,}/g) ?? []);
    }
  };
  p.lines.forEach((l) => visit(l.call));
  const accounted = (span: string, text: string) => others.some((x) => x.length >= 2 && span.includes(x)) || texts.some((x) => x.text !== text && x.text.trim().length >= 3 && span.includes(x.text.trim()));
  for (const { fn, field, text } of texts) {
    const t = text.trim();
    if (t.length < 3) continue;
    const at = request.indexOf(t);
    if (at < 0) continue;
    const rest = request.slice(at + t.length);
    if (!WORD.test(rest)) continue;
    if (/[.!?;:]["'”’)\]]*$/.test(t) || ENDS.test(rest)) {
      if (o.trailing && fn !== "money" && !accounted(rest, text)) return { field, kind: "trailing" };
      continue;
    }
    const m = SENTENCE_END.exec(rest);
    const sentence = m ? rest.slice(0, m.index) : rest;
    if (!WORD.test(sentence) || accounted(sentence, text)) continue;
    return { field, kind: "cut_short" };
  }
  return undefined;
}
