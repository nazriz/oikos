// Small pure helpers of the pilot viewer: days, money, clipping, a reading's notebook, the words of a request, and how
// two acts are set beside each other. Nothing here reads a file; the tests (../test/parse.test.ts) hold them.

export const DAY = 86_400;

/** The day a time falls on, counted from 1 as the seats' own readings count ("year 1, day 52"). */
export const dayOf = (t: number): number => Math.floor(t / DAY) + 1;

/** "d52 09:30" */
export function stamp(t: number): string {
  const s = ((t % DAY) + DAY) % DAY;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0"), mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `day ${dayOf(t)} ${hh}:${mm}`;
}

/** An integer count of a currency's smallest unit as money: "$1,234.50". Digits only; anything else is passed through. */
export function money(minor: string | number | bigint, cur: { symbol?: string; minor_units?: number; group_mark?: string; decimal_mark?: string } = {}): string {
  const text = String(minor);
  if (!/^-?\d+$/.test(text)) return text;
  const neg = text.startsWith("-"), digits = text.replace("-", ""), places = cur.minor_units ?? 2;
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, padded.length - places), frac = places ? padded.slice(-places) : "";
  const g = cur.group_mark ?? ",", d = cur.decimal_mark ?? ".";
  return `${neg ? "-" : ""}${cur.symbol ?? ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, g)}${frac ? d + frac : ""}`;
}

/** The first `n` characters of a text, said so when cut. */
export function clip(s: unknown, n: number): string {
  const t = typeof s === "string" ? s : s === undefined || s === null ? "" : JSON.stringify(s);
  return t.length <= n ? t : t.slice(0, n) + ` [... ${t.length - n} more characters]`;
}

/** The notebook at the head of a seat's opening message ("Your notebook: ...", up to the first blank line that starts the
 * next part), or undefined where the message does not open that way. "(empty)" is an empty notebook. */
export function notebookOf(opening: string): string | undefined {
  const m = /^Your notebook:[ \t]*([\s\S]*?)(?:\n\n(?:Since you last looked|It is year|##)|$)/.exec(opening);
  if (!m) return undefined;
  const text = m[1]!.trim();
  return text === "(empty)" ? "" : text;
}

/** What a translator was asked: the head of its input before the list of forms. */
export function requestWords(input: string): string {
  const cut = input.indexOf("\n\nForms this person knows");
  const head = cut < 0 ? input : input.slice(0, cut);
  return head.replace(/^Request:\s*/, "").trim();
}

/** The tool-result texts in a later turn's input (a list of messages), each with the id of the tool use it answers. */
export function toolResults(input: unknown): { id: string; text: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { id: string; text: string }[] = [];
  for (const m of input as any[]) {
    if (m?.type !== "tool_result") continue;
    const c = m.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join("\n") : "";
    out.push({ id: String(m.tool_use_id ?? ""), text });
  }
  return out;
}

/** Ids in a text that are in `known` (an id is a run of letters, digits, '-', '_' and '.'; a trailing '.' is not part of it). */
export function mentions(text: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9_.-]*/g)) {
    let id = m[0];
    if (known.has(id)) found.add(id);
    else { id = id.replace(/[.-]+$/, ""); if (known.has(id)) found.add(id); }
  }
  return [...found];
}

export interface BlockSummary { block: string; kind?: string; to?: string[]; text?: string; basis?: string; facts: { [k: string]: string | number | boolean } }

/** An act's blocks in a form a person can read: what kind of thing, to whom, in what words, and its short facts. */
export function summariseBlocks(blocks: any[] | undefined): BlockSummary[] {
  return (blocks ?? []).map((b) => {
    const facts: BlockSummary["facts"] = {};
    for (const [k, v] of Object.entries<any>(b?.data ?? {})) {
      if (typeof v === "boolean" || typeof v === "number") facts[k] = v;
      else if (typeof v === "string") facts[k] = v.length > 400 ? v.slice(0, 400) + "..." : v;
    }
    const basis = Array.isArray(b?.basis) ? b.basis.join(", ") : b?.basis;
    return { block: String(b?.block ?? "?"), ...(b?.kind ? { kind: String(b.kind) } : {}), ...(b?.addressed_to ? { to: [].concat(b.addressed_to) } : {}), ...(b?.text ? { text: String(b.text) } : {}), ...(basis ? { basis: String(basis) } : {}), facts };
  });
}

const ID_LIKE = /^(rec|application|notice|act|draft|ent|msg)[.-]|^application-|^rec\.\d+$/;
/** The part of an act that is the decision rather than the paper it is about: its blocks' kinds and their short facts, without
 * ids of papers and without free text (a reason, a statement). Two acts that decide the same thing have equal signatures. */
export function decisionSignature(blocks: BlockSummary[]): string {
  return blocks.map((b) => {
    const facts = Object.entries(b.facts).filter(([k, v]) => !/^(reason|statement|text|note|notes|detail|summary)$/.test(k) && !(typeof v === "string" && (ID_LIKE.test(v) || v.length > 40))).sort(([a], [c]) => (a < c ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
    return `${b.block}${b.kind ? ":" + b.kind : ""}${facts.length ? " " + facts.join(" ") : ""}`;
  }).join(" | ");
}

/** What an act is about, for setting two runs' acts side by side: who it is to and what matter it names. Ids of papers differ
 * between a model run and its code twin, so the key is the parties and the kind of matter. */
export function subjectKey(as: string, blocks: BlockSummary[]): string {
  return [as, ...blocks.map((b) => [b.block, b.kind ?? "", (b.to ?? []).slice().sort().join("+"), String(b.facts.kind ?? b.facts.matter ?? ""), String(b.facts.applicant ?? b.facts.against ?? "")].join("/"))].join("|");
}

export interface ActLike { t: number; as: string; blocks: BlockSummary[]; reasoning?: string }
export interface Pair { key: string; seat?: ActLike & { i: number }; twin?: ActLike & { i: number }; same: boolean }

/** Sets a seat's acts beside its twin's: each seat act with the nearest unused twin act on the same subject; what is left on
 * either side is alone. Order is by time. */
export function compareActs(seat: ActLike[], twin: ActLike[]): Pair[] {
  const byKey = new Map<string, number[]>();
  twin.forEach((a, i) => { const k = subjectKey(a.as, a.blocks); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(i); });
  const used = new Set<number>(), out: Pair[] = [];
  seat.forEach((a, i) => {
    const k = subjectKey(a.as, a.blocks);
    const cands = (byKey.get(k) ?? []).filter((j) => !used.has(j));
    let best = -1;
    for (const j of cands) if (best < 0 || Math.abs(twin[j]!.t - a.t) < Math.abs(twin[best]!.t - a.t)) best = j;
    if (best >= 0) {
      used.add(best);
      out.push({ key: k, seat: { ...a, i }, twin: { ...twin[best]!, i: best }, same: decisionSignature(a.blocks) === decisionSignature(twin[best]!.blocks) });
    } else out.push({ key: k, seat: { ...a, i }, same: false });
  });
  twin.forEach((a, j) => { if (!used.has(j)) out.push({ key: subjectKey(a.as, a.blocks), twin: { ...a, i: j }, same: false }); });
  return out.sort((a, b) => (a.seat?.t ?? a.twin!.t) - (b.seat?.t ?? b.twin!.t));
}

/** A seat's opening message without the notebook that heads it (the notebook is shown apart). */
export function readingOf(opening: string): string {
  if (!opening.startsWith("Your notebook:")) return opening;
  const m = /\n\n(?=Since you last looked|It is year|##)/.exec(opening);
  return m ? opening.slice(m.index + 2) : "";
}

/** A look's result without the standing lines every one starts with ("It is year 1, day 52. You are 25 ... post: ..."), up to its first heading. */
export function lookBody(result: string): string {
  if (!/^It is year \d+, day \d+/.test(result)) return result;
  const i = result.indexOf("\n## ");
  return i < 0 ? result : result.slice(i + 1);
}
