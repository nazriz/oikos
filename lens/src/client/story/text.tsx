// Text in the story view: markdown (marked, with any raw HTML shown as text), search hits and lever words marked in
// place, record ids set apart. Everything is marked at render, never by editing the DOM React owns.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Marked } from "marked";
import { useLens } from "../state";
import { useCity } from "../city/CityView";
import { useResearcher } from "../mode";
import { plainText, replaceIds, YEAR1, yearOne, type PlainNames } from "../plain";

/** The person ids the AI mayor holds office as, in the open run (from the town's records of its seats). */
function useSeatIds(): Set<string> {
  const run = useLens((s) => s.run);
  const { city } = useCity(run ? `/api/run/${encodeURIComponent(run)}` : null);
  return useMemo(() => new Set(Object.values(city?.town.power?.seats ?? {}).map((p) => p.replace(/-self$/, ""))), [city]);
}

/** What the open run's town knows of its ids (organisations, posts, the AI mayor's seats), for the plain formatter. */
export function usePlainNames(): PlainNames {
  const run = useLens((s) => s.run);
  const { city } = useCity(run ? `/api/run/${encodeURIComponent(run)}` : null);
  return useMemo(() => {
    const t = city?.town;
    if (!t) return {};
    const seats = new Set<string>(t.seats ?? []);
    for (const [part, person] of Object.entries(t.power?.seats ?? {})) { seats.add(part); seats.add(person.replace(/-self$/, "")); }
    return { entities: t.entities, positions: t.positions, seats };
  }, [city]);
}
/** The plain formatter for this page: Story mode says the world's ids as names (lens/src/client/plain.ts); Researcher
 * mode keeps them as they are. A page across runs passes `town` false: the open run's names are not its runs'. */
export function usePlain(town = true): (s: string) => string {
  const names = usePlainNames();
  const researcher = useResearcher();
  return useMemo(() => (researcher ? (s: string) => s : (s: string) => plainText(s, town ? names : undefined)), [researcher, names, town]);
}

// (As marked escapes text, quotes included, so a phrase escaped here matches the markdown's text.)
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const md = new Marked({ gfm: true, breaks: true, async: false, renderer: { html: (tok: any) => esc(String(tok.text ?? tok.raw ?? "")) } });

/** What to mark: the search query, phrases the reader flagged (muted for `considered`), and (where a view asks for it)
 * the key sentences: those that mention the election or power, by `keys`. */
export interface Marks { query: string; levers: { words: string; muted: boolean }[]; keys?: RegExp | null }
export const MarksContext = createContext<Marks>({ query: "", levers: [] });

/** The words that make a sentence a key one: the election, rivals, appointments, the posts that run the poll or the
 * paper, staying in office, and the mayor's own children (their ids, as its prompt names them). A reading aid, not a
 * measure: the study's checker is the measure. */
export function keyWords(children: string[] = []): RegExp {
  const words = [
    "elections?", "electoral", "electorate", "re-?elect\\w*", "polls?", "polling", "poll day", "voters?", "voting", "candidates?", "candidacy",
    "nominat\\w*", "rivals?", "opponents?", "challengers?", "campaign\\w*", "tenure", "term of office", "term", "stay(?:s|ing)? (?:as )?mayor",
    "remain(?:s|ing)? mayor", "in office", "keep (?:my|the) (?:seat|office|post)", "appoint\\w*", "commissioner", "editor", "successor",
    "my (?:own )?(?:child|children|son|daughter|family)", "postpon\\w*", "cancel\\w*", "power",
  ];
  return new RegExp(`\\b(?:${[...words, ...children.map(reEsc)].join("|")})\\b`, "i");
}

const BLOCK = /^<\/?(p|li|ul|ol|h[1-6]|blockquote|pre|table|thead|tbody|tr|td|th|div|br|hr)\b/i;
const VOID = /^<(br|img|input|wbr|hr)\b/i;
/** Wrap each sentence of `html` that matches `re` in a highlight. Sentences end at . ! ? before a space, only where no
 * inline element is open, so every highlight nests cleanly; block elements end a sentence. */
export function keyWrap(html: string, re: RegExp): string {
  const parts = html.split(/(<[^>]+>)/);
  let out = "", sent = "", plain = "", depth = 0;
  const flush = () => { if (sent) out += plain.trim() && re.test(plain) ? `<span class="st-key">${sent}</span>` : sent; sent = ""; plain = ""; };
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("<")) {
      if (BLOCK.test(p)) { flush(); out += p; depth = 0; continue; }
      sent += p;
      if (p.startsWith("</")) depth = Math.max(0, depth - 1); else if (!p.endsWith("/>") && !VOID.test(p)) depth++;
      continue;
    }
    if (depth > 0) { sent += p; plain += p; continue; }
    const end = /([.!?…]+["”’)]*)(\s+)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = end.exec(p))) { const e = m.index + m[1]!.length; sent += p.slice(last, e); plain += p.slice(last, e); flush(); out += m[2]; last = e + m[2]!.length; }
    sent += p.slice(last); plain += p.slice(last);
  }
  flush();
  return out;
}
/** The key sentences of a text, as plain strings (for a skim of a long passage). */
export function keySentences(text: string, re: RegExp): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?…]["”’)]*)\s+/).map((s) => s.trim()).filter((s) => s && re.test(s));
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REC = /\b((?:rec|draft|act|msg)\.[\w.-]*\d)\b/g;
const REC_ID = /^(?:rec|draft|act|msg)\./;
const NONE = new Set<string>();
const PERSON = /\b(c\d{4,})\b(?![^<]*>)/g;

/** Click delegation for the person links markText writes: put on the root of any view that shows marked text. */
export function openPerson(e: { target: EventTarget | null; stopPropagation(): void }, select: (s: { kind: "person"; id: string }) => void): void {
  const el = (e.target as HTMLElement | null)?.closest?.("[data-person]") as HTMLElement | null;
  if (!el) return;
  e.stopPropagation();
  select({ kind: "person", id: el.dataset.person! });
}

function markText(text: string, m: Marks, html: boolean, seats: Set<string> = NONE, names: PlainNames | null = null): string {
  const story = names !== null;
  // (In HTML, the query is matched against the escaped text, so it is escaped the same way.)
  let out = html ? text : esc(text);
  for (const l of m.levers) {
    const p = esc(l.words.trim());
    if (p.length < 8) continue;
    out = out.split(p).join(`<mark class="st-lever${l.muted ? " muted" : ""}">${p}</mark>`);
  }
  // (What a model wrote stays word for word, in every mode: an id or date in it is never rewritten. Story mode underlines
  // each one subtly and says on hover what it is: "rec.99036 = a record", "apts-15 = Apartments 15", "year 1, day 181 =
  // day 181". A record's card is a hover away in both modes.)
  out = out.replace(REC, (id) => {
    const tip = story ? ` title="${id} = ${id.startsWith("rec.") ? "a record (its card opens on hover)" : `${id.split(".")[0]} of the office`}"` : "";
    return id.startsWith("rec.") ? `<span class="st-rec${story ? " st-id" : ""}" data-peek="record:${id}"${tip}>${id}</span>` : `<span class="st-rec${story ? " st-id" : ""}"${tip}>${id}</span>`;
  });
  if (names) out = out.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part
    : replaceIds(part, names, (id, said) => (REC_ID.test(id) ? id : `<span class="st-id" title="${id} = ${esc(said)}">${id}</span>`), true)
      .replace(YEAR1, (d: string, y: string, n: string) => `<span class="st-id" title="${d} = ${yearOne(d, y, n)}">${d}</span>`)
      // (Its own shorthand for a date, "Y1 d122" or "d181", the same way.)
      .replace(/\b(?:Y1 )?d(\d{1,3})\b/g, (d: string, n: string) => `<span class="st-id" title="${d} = day ${n}">${d}</span>`))).join("");
  // (A person's id opens their life: a link the page handles by delegation (openPerson), with nav's hover card.)
  // (The AI mayor's own person is said to be it, in square brackets: an editor's note, so a quote keeps its words.)
  out = out.replace(PERSON, (_, id: string) => `<button type="button" class="id-link" data-person="${id}" data-peek="person:${id}">${id}</button>${seats.has(id) ? '<span class="id-seat"> [the AI mayor]</span>' : ""}`);
  if (m.query.trim().length >= 2) {
    const q = new RegExp(`(${reEsc(esc(m.query.trim()))})`, "gi");
    // (Only in text between tags: never inside an attribute or the record-id spans' markup.)
    out = out.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : part.replace(q, '<mark class="st-hit">$1</mark>'))).join("");
  }
  return out;
}

/** Markdown, marked. */
export function Md({ text, className = "st-prose" }: { text: string; className?: string }) {
  const m = useContext(MarksContext);
  const seats = useSeatIds();
  const researcher = useResearcher(), town = usePlainNames();
  const names = researcher ? null : town;
  const html = useMemo(() => {
    const raw = md.parse(text) as string;
    const html = raw.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : markText(part, m, true, seats, names))).join("");
    return m.keys ? keyWrap(html, m.keys) : html;
  }, [text, m, seats, names]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** Plain text, marked. */
export function Hi({ text, as = "span", className }: { text: string; as?: "span" | "div"; className?: string }) {
  const m = useContext(MarksContext);
  const seats = useSeatIds();
  const researcher = useResearcher(), town = usePlainNames();
  const names = researcher ? null : town;
  const html = useMemo(() => { const h = markText(text, m, false, seats, names); return m.keys ? keyWrap(h, m.keys) : h; }, [text, m, seats, names]);
  const Tag = as;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** The office's own ids in a line Lens says, in plain words (Story mode), without the town's names: the shared formatter
 * (lens/src/client/plain.ts). In a component, prefer usePlain(), which names organisations and posts as the town does.
 * Never applied to a quote. */
export const plainWords = (s: string): string => plainText(s);
/** A reason the clerk could not draw a request up, as a plain sentence. */
export function plainReason(r: string): string {
  const m = /^You don't know of anyone or anything called (.+?)\.?$/.exec(r.trim());
  if (m) return `the mayor named ${m[1]}, which the office has no record of.`;
  return plainWords(r);
}
export function hasQuery(text: string, q: string) { return q.trim().length >= 2 && text.toLowerCase().includes(q.trim().toLowerCase()); }
export function Label({ children }: { children: ReactNode }) { return <span className="lbl">{children}</span>; }
