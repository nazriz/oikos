// The prompt a sitting's first call was shown, read back into its parts so the reader can lay it out as a document:
// the mayor's notebook, then each day's digest ("Since you last looked", then "Now"), each day's facts about the mayor,
// and its "## " sections, whose lines are records ("- [rec.1] news from paper (year 1, day 4): "..." (meta), citing
// rec.0"), list items with their indented lines, sub-headings ("Done, with what came of it:"), "Label: a; b; c" lists,
// and the office's own small print in parentheses. Nothing is dropped: every line of the input lands in exactly one
// part, in order, and a prompt that does not have this shape comes back as one plain part.

export interface PromptRecord { id: string; kind: string; from?: string; to?: string; year?: number; day?: number; text?: string; meta?: string; citing?: string }
export type PromptItem =
  | { k: "rec"; rec: PromptRecord; sub: string[] }
  | { k: "li"; text: string; sub: string[] }
  | { k: "head"; text: string }
  | { k: "list"; label: string; items: string[] }
  | { k: "note"; text: string }
  | { k: "p"; text: string };
export interface PromptSection { title: string; count?: string; items: PromptItem[] }
export interface PromptDay { year?: number; day?: number; facts: string[]; items: PromptItem[]; sections: PromptSection[] }
export interface PromptGroup { label?: "Since you last looked" | "Now"; days: PromptDay[] }
export interface Prompt { notebook?: { text: string; used?: string }; groups: PromptGroup[]; shaped: boolean }

const DAY_LINE = /^It is year (\d+), day (\d+)\.\s*$/;
const USED = /^\(([\d,]+) of the ([\d,]+) characters it holds are used\.\)\s*$/;
const FACT = /^(You are |About you:|Your children:|Your child:|You hold |You have no |You live )/;

/** One record line: "- [rec.1] kind from a, to b (year 1, day 4): "text" (meta), citing rec.0", or the listing form
 * "- [rec.1] kind, year 1, day 4, from a: to b: "text"". */
export function parseRecord(line: string): PromptRecord | null {
  const m = /^- \[((?:rec|draft|act|msg)\.[\w.-]+)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  const id = m[1]!, rest = m[2]!;
  const q = rest.indexOf(': "');
  let head = rest, text: string | undefined, tail = "";
  if (q >= 0) {
    head = rest.slice(0, q);
    const after = rest.slice(q + 3), end = after.lastIndexOf('"');
    text = end >= 0 ? after.slice(0, end) : after;
    tail = end >= 0 ? after.slice(end + 1).replace(/^[\s,]+/, "") : "";
  }
  const date = /year (\d+), day (\d+)/.exec(head);
  const from = /\bfrom ([^,:()]+?)(?=,|:|\s\(|$)/.exec(head)?.[1]?.trim();
  const to = /\bto ([^:()]+?)(?=:|\s\(|$)/.exec(head.replace(/\bfrom [^,:()]+/, ""))?.[1]?.trim();
  const kind = head.split(/,| from | to | \(/)[0]!.trim();
  let meta: string | undefined, citing: string | undefined;
  const mm = /^\(([^]*?)\)(?=,|$)/.exec(tail);
  if (mm) { meta = mm[1]; tail = tail.slice(mm[0].length).replace(/^[\s,]+/, ""); }
  const c = /^citing (.+)$/.exec(tail);
  if (c) { citing = c[1]; tail = ""; }
  if (tail) meta = meta ? `${meta}; ${tail}` : tail;
  return { id, kind, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(date ? { year: +date[1]!, day: +date[2]! } : {}), ...(text !== undefined ? { text } : {}), ...(meta ? { meta } : {}), ...(citing ? { citing } : {}) };
}

/** The lines of a section (or of a day before its first section) as items. */
export function parseItems(lines: string[]): PromptItem[] {
  const out: PromptItem[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const last = out.at(-1);
    // (An indented line belongs to the item above it.)
    if (/^\s+\S/.test(line) && last && (last.k === "rec" || last.k === "li")) { last.sub.push(line.trim()); continue; }
    const rec = parseRecord(line.trim());
    if (rec) { out.push({ k: "rec", rec, sub: [] }); continue; }
    if (/^\s*- /.test(line)) { out.push({ k: "li", text: line.trim().slice(2), sub: [] }); continue; }
    if (/^\(.*\)$/.test(line.trim())) { out.push({ k: "note", text: line.trim().slice(1, -1) }); continue; }
    if (/^[A-Z][^:]{2,140}:$/.test(line.trim())) { out.push({ k: "head", text: line.trim().slice(0, -1) }); continue; }
    const l = /^([A-Z][\w' ]{1,30}): (.+; .+)$/.exec(line.trim());
    if (l) { out.push({ k: "list", label: l[1]!, items: l[2]!.replace(/\.$/, "").split(/;\s+/) }); continue; }
    out.push({ k: "p", text: line.trim() });
  }
  return out;
}

function section(head: string, body: string[]): PromptSection {
  const m = /^(.*?)\s*\(([^()]*\d[^()]*)\)\s*$/.exec(head.trim());
  return { title: m ? m[1]! : head.trim(), ...(m ? { count: m[2]! } : {}), items: parseItems(body) };
}

export function readPrompt(input: string): Prompt {
  const lines = input.split("\n");
  let i = 0;
  let notebook: Prompt["notebook"];
  if (/^Your notebook:/.test(lines[0] ?? "")) {
    const end = lines.findIndex((l) => USED.test(l));
    const stop = end >= 0 ? end : lines.findIndex((l, k) => k > 0 && (DAY_LINE.test(l) || /^(Since you last looked|Now):\s*$/.test(l)));
    const upto = stop >= 0 ? stop : lines.length;
    notebook = { text: lines.slice(0, upto).join("\n").replace(/^Your notebook:\s*/, "").trim(), ...(end >= 0 ? { used: USED.exec(lines[end]!)![0].slice(1, -1) } : {}) };
    i = end >= 0 ? end + 1 : upto;
  }
  const groups: PromptGroup[] = [];
  let group: PromptGroup | undefined, day: PromptDay | undefined, sec: { head: string; body: string[] } | undefined, pre: string[] = [];
  const closeSec = () => { if (sec && day) day.sections.push(section(sec.head, sec.body)); sec = undefined; };
  const closeDay = () => { closeSec(); if (day) { day.items = parseItems(pre); group!.days.push(day); } day = undefined; pre = []; };
  const openDay = (d: Partial<PromptDay> = {}) => { closeDay(); if (!group) { group = { days: [] }; groups.push(group); } day = { facts: [], items: [], sections: [], ...d }; };
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const g = /^(Since you last looked|Now):\s*$/.exec(l);
    if (g) { closeDay(); group = { label: g[1] as PromptGroup["label"], days: [] }; groups.push(group); continue; }
    const d = DAY_LINE.exec(l);
    if (d) { openDay({ year: +d[1]!, day: +d[2]! }); continue; }
    if (!day) { if (!l.trim()) continue; openDay(); }
    if (l.startsWith("## ")) { closeSec(); sec = { head: l.slice(3), body: [] }; continue; }
    if (sec) sec.body.push(l);
    else if (FACT.test(l)) day!.facts.push(l.trim());
    else pre.push(l);
  }
  closeDay();
  const shaped = !!notebook || groups.some((g) => g.label || g.days.some((d) => d.day !== undefined));
  return { ...(notebook ? { notebook } : {}), groups, shaped };
}

/** A section in one line, for its folded heading: what kinds of record it holds, or its first line. */
export function sectionGist(s: PromptSection): string {
  const recs = s.items.filter((x): x is Extract<PromptItem, { k: "rec" }> => x.k === "rec");
  if (recs.length) {
    const by = new Map<string, number>();
    for (const r of recs) by.set(r.rec.kind, (by.get(r.rec.kind) ?? 0) + 1);
    const kinds = [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${n === 1 || /s$/.test(k) ? k : `${k}s`}`);
    const days = recs.map((r) => r.rec.day).filter((d): d is number => d !== undefined);
    return `${kinds.slice(0, 3).join(", ")}${kinds.length > 3 ? `, ${kinds.length - 3} other kinds` : ""}${days.length > 1 ? `; days ${Math.min(...days)} to ${Math.max(...days)}` : days.length ? `; day ${days[0]}` : ""}`;
  }
  const first = s.items.find((x) => x.k === "li" || x.k === "p" || x.k === "head" || x.k === "list");
  if (!first) return "";
  const t = first.k === "list" ? `${first.label}: ${first.items.length}` : first.text;
  const money = /(-?\$[\d,]+(?:\.\d+)?)\s*$/.exec(t);
  if (money && first.k === "li") return money[1]!;
  return t.length > 96 ? `${t.slice(0, 95)}…` : t;
}

/** A short name for a section, for a day's one-line summary: "Correspondence and filings concerning the town" →
 * "Correspondence and filings". */
export function shortTitle(t: string): string {
  const s = t.split(/:|\(| concerning | sent to /)[0]!.trim();
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}
