// Which forms a trained reader is shown when a seat knows of more than it can read (docs/real-models.md, "Our own
// translator first": "More forms than the reader takes"; docs/decisions.md, "What the fourth living pilot found").
//
// A trained model reads a request with the forms its asker knows of, up to its reader's limit (config.json
// `max_tokens`; a model's folder may also say the most forms it was shown in training, `max_forms`). A letting office
// knows of 25 forms (its own 15 and ten the town publishes): 1,400 tokens of a reader that takes 1,024, and until
// 2026-10-12 every one of its requests was answered "too long" and went to the translator behind. Nothing here
// changes the model, its prompt or the request: the serving side chooses which forms' lines go with the request, by a
// rule that is the same for every request and uses nothing but the request's own words and the forms' own.
//
// The rule, within the reader's limit:
//   1. the office's own forms before everyone else's (a form of a post the asker holds, or of the organisation it
//      acts for; whoever asks the translator says which: `own`);
//   2. within each of the two, a form with more of the request's words in its name, its fields' names and its stated
//      purpose before one with fewer (a word is letters and digits, lower-cased; a name's parts count: `rent_reminder`
//      is "rent" and "reminder"; words of one or two letters and a few words every form shares are left out);
//   3. ties by the order the forms came in.
// Forms are taken in that order while they fit; the ones shown keep the order they came in. What was shown, and of
// how many, is on the request's route. A request that names a form which was not shown gets no draft from this
// model (`form_not_shown`): the translator behind answers it.

export interface FormFacts {
  /** The form's line as the translator is shown it (`- name, to=office, id record: fields …`). */
  line: string;
  /** Whether it is the asker's own office's or organisation's form. */
  own?: boolean;
  /** What the form's own record says it is for (its purpose, in words). */
  about?: string;
}

/** Words every form's line or purpose has, which say nothing of which form a request means. */
const COMMON = new Set(["the", "and", "for", "form", "forms", "fill", "filled", "with", "that", "this", "from", "into", "its", "are", "has", "have", "you", "your", "our", "not", "who", "what", "office", "record", "required", "one", "text", "amount", "entity", "account", "paid", "pay", "day", "days", "year", "ksh", "usd"]);

/** The words of a text that could tell one form from another. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) if (w.length > 2 && !COMMON.has(w) && !/^\d+$/.test(w)) out.add(w);
  return out;
}

/** A form's name, record id and field names, read off its line. */
export function partsOf(line: string): { name: string; id: string; fields: string[] } {
  const m = /^- ([^,]+), to=[^,]*, id ([^\s:(]+)/.exec(line);
  const f = line.indexOf(": fields ");
  return { name: m?.[1] ?? "", id: m?.[2] ?? "", fields: f < 0 ? [] : [...line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)].map((x) => x[1]!) };
}

/** How many of the request's words are in the form's name, field names and purpose: its name's twice over (a
 * request that says "rent reminder" means that form before one that merely has a field called rent). */
export function overlap(request: Set<string>, f: FormFacts): number {
  const p = partsOf(f.line);
  const name = wordsOf(p.name), rest = wordsOf(`${p.fields.join(" ")} ${f.about ?? ""}`);
  let n = 0;
  for (const w of request) n += name.has(w) ? 2 : rest.has(w) ? 1 : 0;
  return n;
}

/** The forms' places in the order they are taken (the rule above). */
export function ranked(request: string, forms: FormFacts[]): number[] {
  const words = wordsOf(request);
  const score = forms.map((f) => overlap(words, f));
  return forms.map((_, i) => i).sort((a, b) => Number(!!forms[b]!.own) - Number(!!forms[a]!.own) || score[b]! - score[a]! || a - b);
}

/** The first `n` by the rule, in the order they came in. */
export const taken = (order: number[], n: number): number[] => order.slice(0, n).sort((a, b) => a - b);

/** The forms a request names (by a form's name, written with underscores or spaces, or by its record's id) among
 * those at `left`: the ones not shown. A name that is one common word ("permit") is only a naming where the request
 * also says "form". */
export function namedAmong(request: string, forms: FormFacts[], left: number[]): string[] {
  const text = ` ${request.toLowerCase().replace(/[_\s]+/g, " ")} `;
  const out: string[] = [];
  for (const i of left) {
    const p = partsOf(forms[i]!.line);
    if (!p.name) continue;
    const name = p.name.toLowerCase().replace(/_/g, " ");
    const whole = new RegExp(`[^\\p{L}\\p{N}]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}\\p{N}]`, "u");
    const byName = whole.test(text) && (name.includes(" ") || new RegExp(`[^\\p{L}\\p{N}]${name} form[^\\p{L}\\p{N}]|[^\\p{L}\\p{N}]form ${name}[^\\p{L}\\p{N}]`, "u").test(text));
    if (byName || (p.id && request.includes(p.id))) out.push(p.id || p.name);
  }
  return out;
}
