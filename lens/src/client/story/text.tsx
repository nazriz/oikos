// Text in the story view: markdown (marked, with any raw HTML shown as text), search hits and lever words marked in
// place, record ids set apart. Everything is marked at render, never by editing the DOM React owns.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Marked } from "marked";

// (As marked escapes text, quotes included, so a phrase escaped here matches the markdown's text.)
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const md = new Marked({ gfm: true, breaks: true, async: false, renderer: { html: (tok: any) => esc(String(tok.text ?? tok.raw ?? "")) } });

/** What to mark: the search query, and phrases the reader flagged (muted for `considered`). */
export interface Marks { query: string; levers: { words: string; muted: boolean }[] }
export const MarksContext = createContext<Marks>({ query: "", levers: [] });

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REC = /\b((?:rec|draft|act|msg)\.[\w.-]*\d)\b/g;
const PERSON = /\b(c\d{4,})\b(?![^<]*>)/g;

/** Click delegation for the person links markText writes: put on the root of any view that shows marked text. */
export function openPerson(e: { target: EventTarget | null; stopPropagation(): void }, select: (s: { kind: "person"; id: string }) => void): void {
  const el = (e.target as HTMLElement | null)?.closest?.("[data-person]") as HTMLElement | null;
  if (!el) return;
  e.stopPropagation();
  select({ kind: "person", id: el.dataset.person! });
}

function markText(text: string, m: Marks, html: boolean): string {
  // (In HTML, the query is matched against the escaped text, so it is escaped the same way.)
  let out = html ? text : esc(text);
  for (const l of m.levers) {
    const p = esc(l.words.trim());
    if (p.length < 8) continue;
    out = out.split(p).join(`<mark class="st-lever${l.muted ? " muted" : ""}">${p}</mark>`);
  }
  out = out.replace(REC, '<span class="st-rec">$1</span>');
  // (A person's id opens their life: a link the page handles by delegation (openPerson), with nav's hover card.)
  out = out.replace(PERSON, '<button type="button" class="id-link" data-person="$1" data-peek="person:$1">$1</button>');
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
  const html = useMemo(() => {
    const raw = md.parse(text) as string;
    return raw.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : markText(part, m, true))).join("");
  }, [text, m]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** Plain text, marked. */
export function Hi({ text, as = "span", className }: { text: string; as?: "span" | "div"; className?: string }) {
  const m = useContext(MarksContext);
  const html = useMemo(() => markText(text, m, false), [text, m]);
  const Tag = as;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
export function hasQuery(text: string, q: string) { return q.trim().length >= 2 && text.toLowerCase().includes(q.trim().toLowerCase()); }
export function Label({ children }: { children: ReactNode }) { return <span className="lbl">{children}</span>; }
